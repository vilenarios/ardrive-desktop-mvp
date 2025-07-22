export interface SyncState {
  phase: 'idle' | 'syncing' | 'monitoring';
  isActive: boolean;
  progress: number;
  currentFile?: string;
  totalFiles: number;
  syncedFiles: number;
  estimatedTimeRemaining?: string;
  error?: string;
}

export interface FileProcessingState {
  isDownloading: boolean;
  recentlyDownloaded: Set<string>;
  downloadingFiles: Map<string, Promise<void>>;
  processingFiles: Set<string>;
  fileProcessingQueue: Map<string, NodeJS.Timeout>;
}