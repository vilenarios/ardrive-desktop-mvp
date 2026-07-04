export interface ISyncProgressTracker {
  emitSyncProgress(progress: any): void;
  emitUploadProgress(uploadId: string, progress: number, status: string, error?: string): void;
  emitDownloadProgress(progress: {
    downloadId: string;
    fileName: string;
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
    speed: number;
    remainingTime: number;
  }): void;
  destroy(): void;
}

export interface IFileStateManager {
  isFileBeingProcessed(filePath: string): boolean;
  // SYNC-13: expectedSize (from ArFS metadata, when known) lets
  // isRecentlyDownloaded distinguish the download we're waiting on from an
  // unrelated write to the same path. Eviction happens via clearDownload()
  // at finalize, not a fixed timer - see FileStateManager.ts.
  markAsDownloaded(filePath: string, expectedSize?: number): void;
  isRecentlyDownloaded(filePath: string, actualSize?: number): boolean;
  markAsProcessing(filePath: string): void;
  clearProcessing(filePath: string): void;
  isDownloading(filePath: string): boolean;
  setDownloadPromise(filePath: string, promise: Promise<void>): void;
  getDownloadPromise(filePath: string): Promise<void> | undefined;
  clearDownload(filePath: string): void;
  setProcessingTimeout(filePath: string, timeout: NodeJS.Timeout): void;
  clearProcessingTimeout(filePath: string): void;
  clearAllProcessing(): void;
}

export interface IFileWatcher {
  start(syncFolderPath: string): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
}