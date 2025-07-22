import { ISyncProgressTracker } from './interfaces';

export class SyncProgressTracker implements ISyncProgressTracker {
  emitSyncProgress(progress: any): void {
    console.log('🔄 Emitting sync progress:', progress);
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('📤 Sending sync:progress to renderer');
      mainWindow.webContents.send('sync:progress', progress);
    } else {
      console.log('⚠️ No main window available for sync progress');
    }
  }

  emitUploadProgress(uploadId: string, progress: number, status: string, error?: string): void {
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('upload:progress', {
        uploadId,
        progress,
        status,
        error
      });
    }
  }
}