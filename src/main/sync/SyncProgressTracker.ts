import { ISyncProgressTracker } from './interfaces';
import { BrowserWindow } from 'electron';

export class SyncProgressTracker implements ISyncProgressTracker {
  private lastEmitTime: Map<string, number> = new Map();
  private pendingEmits: Map<string, any> = new Map();
  private flushInterval: NodeJS.Timeout | null = null;
  private MIN_EMIT_INTERVAL = 500; // 500ms between updates per item
  
  constructor() {
    // Flush pending emits every 250ms
    this.flushInterval = setInterval(() => {
      this.flushPendingEmits();
    }, 250);
  }
  
  private flushPendingEmits(): void {
    if (this.pendingEmits.size === 0) return;
    
    const now = Date.now();
    const emitsToProcess = Array.from(this.pendingEmits.entries());
    
    for (const [key, data] of emitsToProcess) {
      const lastEmit = this.lastEmitTime.get(key) || 0;
      if (now - lastEmit >= this.MIN_EMIT_INTERVAL) {
        this.pendingEmits.delete(key);
        this.lastEmitTime.set(key, now);
        
        // Emit based on type
        if (data.type === 'download') {
          this.doEmitDownloadProgress(data.progress);
        } else if (data.type === 'sync') {
          this.doEmitSyncProgress(data.progress);
        }
      }
    }
  }
  
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Clear all pending emits and tracking
    this.pendingEmits.clear();
    this.lastEmitTime.clear();
  }
  emitSyncProgress(progress: any): void {
    console.log('🟣 [PROGRESS-TRACKER] emitSyncProgress queued:', {
      phase: progress.phase,
      description: progress.description,
      timestamp: new Date().toISOString()
    });
    // For non-critical sync progress, throttle
    const key = `sync-${progress.phase || 'general'}`;
    this.pendingEmits.set(key, { type: 'sync', progress });
  }
  
  private doEmitSyncProgress(progress: any): void {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        console.log('🟣 [PROGRESS-TRACKER] Sending sync:progress to renderer:', {
          phase: progress.phase,
          description: progress.description,
          timestamp: new Date().toISOString()
        });
        mainWindow.webContents.send('sync:progress', progress);
      } else {
        console.log('🟣 [PROGRESS-TRACKER] Window not available, cannot send progress');
      }
    } catch (error) {
      // Window was destroyed, stop trying to emit
      console.debug('🟣 [PROGRESS-TRACKER] Cannot emit sync progress - error:', error);
    }
  }

  emitUploadProgress(uploadId: string, progress: number, status: string, error?: string): void {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('upload:progress', {
          uploadId,
          progress,
          status,
          error
        });
      }
    } catch (error) {
      // Window was destroyed, ignore
      console.debug('Cannot emit upload progress - window not available');
    }
  }

  emitDownloadProgress(progress: {
    downloadId: string;
    fileName: string;
    progress: number;
    bytesDownloaded: number;
    totalBytes: number;
    speed: number;
    remainingTime: number;
  }): void {
    const key = `download-${progress.downloadId}`;
    
    // Always emit completion immediately
    if (progress.progress === 100) {
      this.doEmitDownloadProgress(progress);
      this.lastEmitTime.set(key, Date.now());
      this.pendingEmits.delete(key);
    } else {
      // Throttle other updates
      this.pendingEmits.set(key, { type: 'download', progress });
    }
  }
  
  private doEmitDownloadProgress(progress: any): void {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download:progress', progress);
      }
    } catch (error) {
      // Window was destroyed, stop trying to emit
      console.debug('Cannot emit download progress - window not available');
      // Clear pending emits if window is gone
      this.pendingEmits.clear();
    }
  }
}