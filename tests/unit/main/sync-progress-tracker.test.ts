// @vitest-environment node
//
// SYNC-4: SyncProgressTracker must survive a destroy -> ensureStarted cycle.
// stopSync destroys it in place (the SyncManager object graph keeps the same
// instance), so a later startSync must be able to re-arm the flush interval —
// the audited bug was throttled progress queueing forever after any stop.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncProgressTracker } from '../../../src/main/sync/SyncProgressTracker';

const { mockSend, mockGetAllWindows, mockWindow } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockWindow = {
    isDestroyed: () => false,
    webContents: { send: mockSend, isDestroyed: () => false },
  };
  return { mockSend, mockGetAllWindows: vi.fn(() => [mockWindow]), mockWindow };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
}));

describe('SyncProgressTracker lifecycle (SYNC-4)', () => {
  let tracker: SyncProgressTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetAllWindows.mockImplementation(() => [mockWindow]);
    tracker = new SyncProgressTracker();
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it('emits throttled sync progress while alive', () => {
    tracker.emitSyncProgress({ phase: 'metadata', description: 'listing' });

    vi.advanceTimersByTime(600);

    expect(mockSend).toHaveBeenCalledWith('sync:progress', {
      phase: 'metadata',
      description: 'listing',
    });
  });

  it('emits nothing after destroy (the pre-fix dead state)', () => {
    tracker.destroy();

    tracker.emitSyncProgress({ phase: 'metadata' });
    vi.advanceTimersByTime(2000);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('emits again after destroy -> ensureStarted', () => {
    tracker.destroy();

    tracker.ensureStarted();
    tracker.emitSyncProgress({ phase: 'files', description: 'queueing' });
    vi.advanceTimersByTime(600);

    expect(mockSend).toHaveBeenCalledWith('sync:progress', {
      phase: 'files',
      description: 'queueing',
    });
  });

  it('is idempotent — repeated ensureStarted does not stack intervals', () => {
    tracker.ensureStarted();
    tracker.ensureStarted();
    tracker.ensureStarted();

    tracker.emitSyncProgress({ phase: 'files' });
    vi.advanceTimersByTime(600);

    // One flush, one send — stacked intervals would re-send the same item
    // only once anyway (pendingEmits is keyed), so assert via the interval
    // handle: it must be a single stable handle.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const handle = (tracker as any).flushInterval;
    tracker.ensureStarted();
    expect((tracker as any).flushInterval).toBe(handle);
  });
});
