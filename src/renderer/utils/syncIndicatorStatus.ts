// UX-28: pure status-derivation for the persistent header sync indicator.
//
// Mirrors src/main/tray-status.ts's honest-status vocabulary (UX-30) so the
// header chip and the tray tooltip can never disagree — "Up to date" /
// "Syncing N files…" / "Paused". Deliberately a separate, renderer-local
// module rather than an import of tray-status.ts: the renderer process must
// never depend on src/main/* (Electron main-process code, IPC wiring, no
// business being in the webpack renderer bundle) — see CLAUDE.md's process
// boundary. Dashboard only ever renders post-authentication, so unlike the
// tray (visible before sign-in too) there is no "signed-out" state here.
export type SyncIndicatorKind = 'paused' | 'syncing' | 'up-to-date';

export interface SyncIndicatorSnapshot {
  /** SyncManager.getStatus().isActive via window.electronAPI.sync.getStatus() — the watcher/upload engine is running. */
  isActive: boolean;
  /**
   * Total files still in flight: upload-pending (totalFiles - uploadedFiles,
   * the same math the tray uses) PLUS the download queue's live total
   * (queued + active, the same count the Download Queue tab already shows
   * via files:get-queue-status). Combining both means the header is honest
   * during an initial/background drive download, not just while uploading.
   */
  pendingCount: number;
}

/**
 * Reduces the raw sync signals to one of the three ambient states surfaced
 * in the header: paused (engine stopped) overrides pending work, then
 * syncing (pending files) vs up-to-date (engine running, nothing pending).
 */
export function resolveSyncIndicatorKind(snapshot: SyncIndicatorSnapshot): SyncIndicatorKind {
  if (!snapshot.isActive) return 'paused';
  return snapshot.pendingCount > 0 ? 'syncing' : 'up-to-date';
}

/**
 * The honest, user-facing status line for the header chip — e.g.
 * "Up to date", "Syncing 3 files…", "Paused". A negative pendingCount (a
 * stale/racy count) reads as nothing pending rather than a negative file
 * count.
 */
export function syncIndicatorLabelFor(snapshot: SyncIndicatorSnapshot): string {
  const kind = resolveSyncIndicatorKind(snapshot);
  switch (kind) {
    case 'paused':
      return 'Paused';
    case 'up-to-date':
      return 'Up to date';
    case 'syncing': {
      const n = Math.max(0, snapshot.pendingCount);
      return `Syncing ${n} file${n === 1 ? '' : 's'}…`;
    }
  }
}
