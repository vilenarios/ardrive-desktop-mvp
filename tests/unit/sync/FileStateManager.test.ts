// @vitest-environment node
//
// SYNC-13 behavioral tests: the old FileStateManager evicted "recently
// downloaded" tracking on a fixed 30-second timer, independent of whether
// the download had actually finished. A download that takes longer than
// 30s to finalize (large file / slow gateway) would fall out of the
// protection window while still landing on disk; chokidar's `add` event for
// the file would then be treated as a brand-new LOCAL file and re-uploaded
// - a feedback loop that spends real money. See AUDIT-2026-07-02.md §2.14
// and BACKLOG.md SYNC-13.
//
// The fix replaces the fixed timer with explicit lifecycle tracking:
// markAsDownloaded() at download START, clearDownload() at FINALIZE (both
// real callers - DownloadManager.downloadFile and sync-manager's dead-code
// equivalent - already call clearDownload from a try/finally around the
// download promise, success or failure). A generous timer remains only as a
// backstop against a hung/crashed download that never reaches finalize.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileStateManager } from '@/main/sync/FileStateManager';

const OLD_FIXED_WINDOW_MS = 30 * 1000;
const PATH = '/sync/folder/big-file.bin';
const EXPECTED_SIZE = 2 * 1024 * 1024 * 1024; // 2GiB (SYNC-6 cap)

describe('FileStateManager (SYNC-13 expected-download tracking)', () => {
  let fsm: FileStateManager;

  beforeEach(() => {
    vi.useFakeTimers();
    fsm = new FileStateManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('(a) a slow download finalizing AFTER the old 30s window is NOT re-detected as a local add', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);

    // Old implementation auto-evicted here via a fixed setTimeout, regardless
    // of whether the download had finished. Advance well past it.
    vi.advanceTimersByTime(OLD_FIXED_WINDOW_MS + 1000);

    // The download is STILL in flight (no clearDownload call yet) - a
    // chokidar `add` firing right now must still be suppressed, or the sync
    // engine would treat the still-landing download as a new local file and
    // queue a re-upload.
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(true);

    // Even much later (large file over a slow gateway) - still protected,
    // because eviction is not time-based.
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(true);
  });

  it('(b) a genuine local edit after the download completes (different size) IS still detected', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);
    vi.advanceTimersByTime(OLD_FIXED_WINDOW_MS + 1000);

    // Download finalizes: the real caller calls clearDownload() from its
    // try/finally once the download promise settles (success or failure).
    fsm.clearDownload(PATH);

    // No longer protected - a subsequent genuine local edit at this path
    // must be processed normally (queued for upload), not silently dropped.
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(false);
  });

  it('(b2) a size mismatch DURING the in-flight window is not suppressed (no over-suppression)', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);

    // Something else wrote a different-sized file at the same path while the
    // download is still in flight - this is not the download we're waiting
    // on, so it must not be silently swallowed.
    expect(fsm.isRecentlyDownloaded(PATH, EXPECTED_SIZE - 1)).toBe(false);

    // The actual expected download content (matching size) is still
    // suppressed.
    expect(fsm.isRecentlyDownloaded(PATH, EXPECTED_SIZE)).toBe(true);

    // Callers that don't have a size handy yet (fast pre-stat path) still
    // get the conservative "suppress" default.
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(true);
  });

  it('(c) the expected-download entry clears on finalize - no memory/timer leak', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);
    expect((fsm as any).expectedDownloads.size).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    fsm.clearDownload(PATH);

    expect((fsm as any).expectedDownloads.size).toBe(0);
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(false);
    // The backstop timer for this path was cancelled, not just left to fire
    // later into an empty map.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a retry (second markAsDownloaded call for the same path) does not leave a stray timer that evicts early', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);
    vi.advanceTimersByTime(5000);
    // Retry: download restarted for the same path (e.g. transient network
    // failure) - refreshes tracking rather than stacking a second timer.
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);

    // Only one backstop timer should be pending, not two.
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(OLD_FIXED_WINDOW_MS);
    // Still protected - the first attempt's now-stale timer must not have
    // fired and evicted the entry out from under the retry.
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(true);
  });

  it('the backstop timer eventually self-heals a download that never calls clearDownload', () => {
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);
    expect(fsm.isRecentlyDownloaded(PATH)).toBe(true);

    // Well past the 30-minute generous backstop - this is a safety net for a
    // hung/crashed download only, never expected to be reached in normal
    // operation.
    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(fsm.isRecentlyDownloaded(PATH)).toBe(false);
  });

  it('isFileBeingProcessed reflects an in-flight expected download', () => {
    expect(fsm.isFileBeingProcessed(PATH)).toBe(false);
    fsm.markAsDownloaded(PATH, EXPECTED_SIZE);
    expect(fsm.isFileBeingProcessed(PATH)).toBe(true);
    fsm.clearDownload(PATH);
    expect(fsm.isFileBeingProcessed(PATH)).toBe(false);
  });
});
