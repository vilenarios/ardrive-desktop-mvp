import { IFileStateManager } from './interfaces';

/**
 * SYNC-13: an in-flight "expected download" for a path.
 *
 * `expectedSize`, when known, is the size reported by ArFS metadata at the
 * moment the download started. It lets `isRecentlyDownloaded` distinguish
 * "this really is the download we're waiting on" from "something unrelated
 * just happened to touch this exact path while a download is in flight" —
 * without needing to hash the file (the real content hash isn't known until
 * the download finishes; see performFileDownload).
 *
 * `backstopTimer` is a safety net ONLY. The primary eviction mechanism is an
 * explicit call to `clearDownload()` once the download is finalized (both
 * callers - DownloadManager and sync-manager - already call clearDownload
 * from a try/finally around the download promise, success or failure) —
 * never a fixed short timer. A 30s fixed window
 * (the previous implementation) expires while large/slow downloads are
 * still landing, so chokidar's `add` event for the just-written file would
 * fall through and get treated as a brand-new local file — triggering a
 * re-upload of a file that was JUST downloaded (a feedback loop that spends
 * real money). See docs/product/BACKLOG.md SYNC-13 / AUDIT §2.14.
 */
interface ExpectedDownloadEntry {
  expectedSize?: number;
  backstopTimer: NodeJS.Timeout;
}

export class FileStateManager implements IFileStateManager {
  // Generous backstop only - not the primary eviction mechanism. Large
  // (multi-GB) files over slow connections can legitimately take a long
  // time; this exists purely so a download that crashes/hangs without ever
  // reaching its finally-block cleanup doesn't leak an entry forever and
  // permanently block real local edits at that path.
  private static readonly BACKSTOP_MS = 30 * 60 * 1000; // 30 minutes

  private expectedDownloads = new Map<string, ExpectedDownloadEntry>();
  private downloadingFiles = new Map<string, Promise<void>>();
  private processingFiles = new Set<string>();
  private fileProcessingQueue = new Map<string, NodeJS.Timeout>();

  isFileBeingProcessed(filePath: string): boolean {
    return this.downloadingFiles.has(filePath) ||
           this.expectedDownloads.has(filePath) ||
           this.processingFiles.has(filePath);
  }

  /**
   * Call when a download STARTS (before any bytes are fetched). `expectedSize`
   * should be the size known from ArFS metadata, if available.
   */
  markAsDownloaded(filePath: string, expectedSize?: number): void {
    // Fresh call (e.g. a retry) replaces any previous timer/entry rather than
    // stacking a second one that could fire independently.
    this.clearExpectedDownloadEntry(filePath);

    const backstopTimer = setTimeout(() => {
      console.warn(
        `[FileStateManager] Backstop timeout: clearing expected-download tracking for ${filePath} ` +
        `after ${FileStateManager.BACKSTOP_MS}ms with no finalize call. This is a safety net for a ` +
        `hung/crashed download, not expected in normal operation.`
      );
      this.expectedDownloads.delete(filePath);
    }, FileStateManager.BACKSTOP_MS);
    // Never let the safety-net timer keep the process alive.
    if (typeof backstopTimer.unref === 'function') {
      backstopTimer.unref();
    }

    this.expectedDownloads.set(filePath, { expectedSize, backstopTimer });
    console.log(`Added ${filePath} to expected downloads (expectedSize=${expectedSize ?? 'unknown'})`);
  }

  /**
   * True if `filePath` matches an in-flight (or just-finalized) expected
   * download. When `actualSize` is provided and we know the expected size,
   * a mismatch means this is NOT the download we're waiting on (e.g. an
   * unrelated edit racing the same path) - don't suppress it.
   */
  isRecentlyDownloaded(filePath: string, actualSize?: number): boolean {
    const entry = this.expectedDownloads.get(filePath);
    if (!entry) {
      return false;
    }
    if (
      actualSize !== undefined &&
      entry.expectedSize !== undefined &&
      actualSize !== entry.expectedSize
    ) {
      return false;
    }
    return true;
  }

  private clearExpectedDownloadEntry(filePath: string): void {
    const entry = this.expectedDownloads.get(filePath);
    if (entry) {
      clearTimeout(entry.backstopTimer);
      this.expectedDownloads.delete(filePath);
    }
  }

  markAsProcessing(filePath: string): void {
    this.processingFiles.add(filePath);
  }

  clearProcessing(filePath: string): void {
    this.processingFiles.delete(filePath);
  }

  // Additional methods to match current functionality
  isDownloading(filePath: string): boolean {
    return this.downloadingFiles.has(filePath);
  }

  setDownloadPromise(filePath: string, promise: Promise<void>): void {
    this.downloadingFiles.set(filePath, promise);
  }

  getDownloadPromise(filePath: string): Promise<void> | undefined {
    return this.downloadingFiles.get(filePath);
  }

  /**
   * Call when a download attempt is FINALIZED - success or failure, this is
   * always invoked from the try/finally around the download promise in both
   * DownloadManager.downloadFile and sync-manager's (dead-code) equivalent.
   * This is the primary eviction path for expected-download tracking; the
   * backstop timer set in markAsDownloaded only fires if this is somehow
   * never reached.
   */
  clearDownload(filePath: string): void {
    this.downloadingFiles.delete(filePath);
    this.clearExpectedDownloadEntry(filePath);
  }

  // File processing queue methods
  setProcessingTimeout(filePath: string, timeout: NodeJS.Timeout): void {
    // Clear any existing timeout first
    const existingTimeout = this.fileProcessingQueue.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    this.fileProcessingQueue.set(filePath, timeout);
  }

  clearProcessingTimeout(filePath: string): void {
    const timeout = this.fileProcessingQueue.get(filePath);
    if (timeout) {
      clearTimeout(timeout);
      this.fileProcessingQueue.delete(filePath);
    }
  }

  clearAllProcessing(): void {
    // Clear all pending file processing timeouts
    for (const [filePath, timeout] of this.fileProcessingQueue) {
      clearTimeout(timeout);
      console.log(`Cleared pending timeout for: ${filePath}`);
    }
    this.fileProcessingQueue.clear();
    
    // Clear processing files set
    this.processingFiles.clear();
  }
}