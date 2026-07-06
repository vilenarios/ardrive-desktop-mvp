import { Notification, BrowserWindow } from 'electron';
import { configManager } from './config-manager';

// UX-29: thin wrapper around Electron's MAIN-PROCESS `Notification` API (the
// renderer has no access to it — see CLAUDE.md). The app had ZERO native OS
// notifications before this; the goal is the cheap "ambient — it works" win
// (sync/upload complete, sync error, approval needed), not a general-purpose
// notification framework. Every public method:
//   - is gated on `configManager.getNotificationsEnabled()` (Settings opt-out,
//     default ON) — no notification fires when disabled;
//   - checks `Notification.isSupported()` first so an unsupported platform
//     (e.g. a headless/CI environment) never throws;
//   - carries only honest, non-sensitive copy (file names/counts/error
//     messages) — never secrets (wallet address, seed phrase, password);
//   - focuses/shows the main window on click, so the notification is a useful
//     shortcut back into the app rather than a dead-end toast.
class NotificationService {
  private show(title: string, body: string): void {
    if (!Notification.isSupported()) {
      return;
    }
    if (!configManager.getNotificationsEnabled()) {
      return;
    }

    try {
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win || win.isDestroyed()) {
          return;
        }
        if (win.isMinimized()) {
          win.restore();
        }
        win.show();
        win.focus();
      });
      notification.show();
    } catch (error) {
      // Notifications are pure ambient polish — a failure here must never
      // interrupt (or throw out of) the sync/upload flow that triggered it.
      console.error('[NotificationService] Failed to show notification:', error);
    }
  }

  /**
   * A sync pass finished (metadata sync + files either downloaded or queued
   * for background download — see sync-manager.ts's 'complete' phase).
   * `fileCount` is the drive's current known file count, an honest,
   * DB-backed number rather than a guess at how many bytes just moved.
   */
  notifySyncComplete(fileCount: number): void {
    const body = fileCount > 0
      ? `Sync complete — ${fileCount} file${fileCount === 1 ? '' : 's'}`
      : 'Your drive is up to date';
    this.show('ArDrive Desktop', body);
  }

  /** A single file finished uploading to Arweave. */
  notifyUploadComplete(fileName: string): void {
    this.show('Upload complete', fileName);
  }

  /** The sync engine hit an error (failed to start, or the file watcher died). */
  notifySyncError(message: string): void {
    this.show('Sync error', message);
  }

  /** One or more cost-bearing uploads are now waiting on the approval queue. */
  notifyApprovalNeeded(count: number): void {
    const body = count === 1
      ? '1 file is waiting for your approval to upload'
      : `${count} files are waiting for your approval to upload`;
    this.show('Upload approval needed', body);
  }
}

export const notificationService = new NotificationService();
