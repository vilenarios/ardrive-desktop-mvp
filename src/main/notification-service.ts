import { Notification, BrowserWindow, shell } from 'electron';
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
//     messages) — never secrets (wallet address, seed phrase, password).
//
// UX-36: clicking a notification now opens the RELEVANT target (OneDrive/
// Dropbox parity) rather than only focusing the window:
//   - upload-complete  -> reveal the uploaded file in the OS file manager;
//   - download-complete-> reveal the file / open the sync folder;
//   - sync-complete    -> open the sync folder;
//   - approval-needed  -> focus the app on the upload-queue tab;
//   - low Turbo balance-> focus the app on the top-up flow;
//   - sync-error       -> focus the app.
// The target is threaded in from the sync-manager fire sites (a folder/file
// path, or a renderer navigation target).

/** Where a notification click should take the user. */
export type NotificationAction =
  | { type: 'focus' }
  | { type: 'reveal-file'; path: string }
  | { type: 'open-folder'; path: string }
  | { type: 'navigate'; target: 'upload-queue' | 'top-up' };

class NotificationService {
  /** Focus/show the main window — the shared fallback click behavior. */
  private focusMainWindow(): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  }

  /**
   * Run a notification click action. Reveal/open actions go straight to the OS
   * file manager (they don't need the app window); navigate/focus actions bring
   * the window forward, and navigate additionally tells the renderer where to go
   * (UX-36). Any failure here is swallowed — a click handler must never throw.
   */
  private runAction(action: NotificationAction): void {
    try {
      switch (action.type) {
        case 'reveal-file':
          shell.showItemInFolder(action.path);
          return;
        case 'open-folder':
          void shell.openPath(action.path);
          return;
        case 'navigate': {
          this.focusMainWindow();
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send('navigate', action.target);
          }
          return;
        }
        case 'focus':
        default:
          this.focusMainWindow();
      }
    } catch (error) {
      console.error('[NotificationService] Notification action failed:', error);
    }
  }

  private show(title: string, body: string, action: NotificationAction = { type: 'focus' }): void {
    if (!Notification.isSupported()) {
      return;
    }
    if (!configManager.getNotificationsEnabled()) {
      return;
    }

    try {
      const notification = new Notification({ title, body });
      notification.on('click', () => this.runAction(action));
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
   * UX-36: clicking opens the sync folder when we know it.
   */
  notifySyncComplete(fileCount: number, syncFolderPath?: string): void {
    const body = fileCount > 0
      ? `Sync complete — ${fileCount} file${fileCount === 1 ? '' : 's'}`
      : 'Your drive is up to date';
    this.show('ArDrive Desktop', body, this.openFolderOrFocus(syncFolderPath));
  }

  /**
   * A single file finished uploading to Arweave.
   * UX-36: clicking reveals the uploaded file in the OS file manager.
   */
  notifyUploadComplete(fileName: string, localPath?: string): void {
    this.show(
      'Upload complete',
      fileName,
      localPath ? { type: 'reveal-file', path: localPath } : { type: 'focus' }
    );
  }

  /**
   * UX-36: files finished downloading from the drive to the local sync folder.
   * `fileCount` is honest (the number that just completed). Clicking reveals the
   * single downloaded file, or opens the sync folder for a batch.
   */
  notifyDownloadComplete(fileCount: number, opts?: { fileName?: string; localPath?: string; syncFolderPath?: string }): void {
    if (fileCount <= 0) {
      return;
    }
    const single = fileCount === 1;
    const body = single && opts?.fileName
      ? opts.fileName
      : `${fileCount} file${single ? '' : 's'} downloaded`;
    let action: NotificationAction;
    if (single && opts?.localPath) {
      action = { type: 'reveal-file', path: opts.localPath };
    } else {
      action = this.openFolderOrFocus(opts?.syncFolderPath);
    }
    this.show('Download complete', body, action);
  }

  /**
   * The sync engine hit an error (failed to start, or the file watcher died).
   * UX-36: clicking focuses the app so the user can see the degraded state.
   */
  notifySyncError(message: string): void {
    this.show('Sync error', message, { type: 'focus' });
  }

  /**
   * One or more cost-bearing uploads are now waiting on the approval queue.
   * UX-36: clicking focuses the app on the upload-queue tab.
   */
  notifyApprovalNeeded(count: number): void {
    const body = count === 1
      ? '1 file is waiting for your approval to upload'
      : `${count} files are waiting for your approval to upload`;
    this.show('Upload approval needed', body, { type: 'navigate', target: 'upload-queue' });
  }

  /**
   * UX-36: Turbo credits fell below (or are insufficient for) what's needed to
   * keep uploading — the paid-product "quota low" cue. Clicking opens the top-up
   * flow. Anti-spam (fire-once-per low->ok transition) is the CALLER's
   * responsibility (see SyncManager.maybeNotifyLowTurboBalance); this method
   * just renders the toast.
   */
  notifyLowTurboBalance(): void {
    this.show(
      'Turbo credits low',
      'Top up to keep uploading your files.',
      { type: 'navigate', target: 'top-up' }
    );
  }

  /**
   * MONEY-17: an upload was REJECTED for funds/free-quota (not merely projected
   * to be low — actually turned away by Turbo). Under the cumulative free-tier
   * model a small "free" file can hit this once the quota is spent, so the copy
   * is honest ("used your free storage") and actionable — clicking opens the
   * top-up flow (the same UX-36 navigate:'top-up' CTA). Anti-spam (fire once per
   * out-of-funds episode, re-arm on recovery) is the CALLER's responsibility
   * (SyncManager reuses the turboBalanceLow flag); this only renders the toast.
   */
  notifyOutOfFreeStorage(): void {
    this.show(
      "You've used your free storage",
      'Top up $5 to get 10 MB free every month, or add credits to keep uploading.',
      { type: 'navigate', target: 'top-up' }
    );
  }

  private openFolderOrFocus(folderPath?: string): NotificationAction {
    return folderPath ? { type: 'open-folder', path: folderPath } : { type: 'focus' };
  }
}

export const notificationService = new NotificationService();
