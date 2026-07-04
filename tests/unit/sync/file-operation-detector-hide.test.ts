// @vitest-environment node
//
// SYNC-5: the FileOperationDetector's confirmed-delete cache used to be dead
// (getRecentOperation had zero callers). It now drives an onConfirmDelete
// callback so a real local delete becomes an ArFS hide. These tests pin that
// wiring: the callback fires for a CONFIRMED delete, and does NOT fire when the
// delete was actually a move/rename (pending cleared before the window).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileOperationDetector } from '@/main/sync/FileOperationDetector';
import { createMockDatabaseManager } from '../../helpers/mock-database';

vi.mock('fs/promises', () => ({
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

describe('FileOperationDetector — confirmed delete wiring (SYNC-5)', () => {
  let detector: FileOperationDetector;

  const arfsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new FileOperationDetector(createMockDatabaseManager());
  });

  afterEach(() => {
    detector.clearAllOperations();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('fires the confirm callback with a delete detection once the window passes', async () => {
    const onConfirm = vi.fn();
    await detector.onFileDelete('/sync/gone.txt', 'hash-abc', arfsId, onConfirm);

    // Nothing before the 3s detection window elapses.
    expect(onConfirm).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3100);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const detection = onConfirm.mock.calls[0][0];
    expect(detection.type).toBe('delete');
    expect(detection.oldPath).toBe('/sync/gone.txt');
    expect(detection.oldArfsFileId).toBe(arfsId);
  });

  it('does NOT fire the callback when the delete is resolved as a move (pending cleared)', async () => {
    const onConfirm = vi.fn();
    await detector.onFileDelete('/sync/gone.txt', 'hash-abc', arfsId, onConfirm);

    // A matching add (move/rename) clears the pending delete before the window,
    // exactly as detectByHash/detectByMetadata do on a real move.
    detector['clearPendingDelete']('/sync/gone.txt');

    await vi.advanceTimersByTimeAsync(3100);

    // The delete never "confirms" -> a moved file is not proposed for hide.
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
