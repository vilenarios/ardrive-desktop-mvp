// UX-28 / SYNC-9: pure status-derivation for the persistent header sync
// indicator.
//
// UX-28 mirrored src/main/tray-status.ts's honest-status vocabulary (UX-30) so
// the header chip and the tray tooltip can never disagree — "Up to date" /
// "Syncing N files…" / "Paused". SYNC-9 extends that vocabulary with the two
// DEGRADED states — "Offline — sync paused" and "Sync error" — so a broken or
// offline sync is visible from every tab instead of the app looking healthy.
//
// Deliberately a separate, renderer-local module rather than an import of
// tray-status.ts: the renderer process must never depend on src/main/*
// (Electron main-process code, IPC wiring, no business being in the webpack
// renderer bundle) — see CLAUDE.md's process boundary. Dashboard only ever
// renders post-authentication, so unlike the tray (visible before sign-in too)
// there is no "signed-out" state here.
import type { SyncHealth } from '../../types';

export type SyncIndicatorKind =
  | 'offline'
  | 'error'
  | 'paused'
  | 'syncing'
  | 'up-to-date';

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
  /**
   * SYNC-9: the authoritative sync-health from SyncManager.getStatus().health.
   * 'error'/'offline' mean sync is actually broken and MUST be visible — they
   * override the ambient paused/syncing/up-to-date states so the app can never
   * look healthy while sync is failing. Absent ⇒ treated as 'healthy'
   * (back-compat with pre-SYNC-9 snapshots).
   */
  health?: SyncHealth;
  /** SYNC-9: honest detail for the degraded state (surfaced as a tooltip). */
  healthMessage?: string;
  /**
   * SYNC-9 renderer-side HINT: navigator.onLine. A hint only — the main
   * process's gateway-unreachable health is authoritative — but it lets the
   * chip flip to "Offline" instantly when the OS reports the link is down,
   * before the next status poll confirms it. Absent ⇒ treated as online.
   */
  isOnline?: boolean;
}

/**
 * Reduces the raw sync signals to one of the five ambient states surfaced in
 * the header. SYNC-9 degraded states win first (a broken/offline sync must
 * never hide behind "Paused"/"Up to date"): offline (gateway unreachable OR the
 * OS reports the link is down) → error → then the UX-28 ambient states
 * (paused → syncing → up-to-date).
 */
export function resolveSyncIndicatorKind(snapshot: SyncIndicatorSnapshot): SyncIndicatorKind {
  const health = snapshot.health ?? 'healthy';
  const online = snapshot.isOnline ?? true;

  if (health === 'offline' || !online) return 'offline';
  if (health === 'error') return 'error';
  if (!snapshot.isActive) return 'paused';
  return snapshot.pendingCount > 0 ? 'syncing' : 'up-to-date';
}

/**
 * The honest, user-facing status line for the header chip — e.g.
 * "Up to date", "Syncing 3 files…", "Paused", "Offline — sync paused",
 * "Sync error". A negative pendingCount (a stale/racy count) reads as nothing
 * pending rather than a negative file count.
 */
export function syncIndicatorLabelFor(snapshot: SyncIndicatorSnapshot): string {
  const kind = resolveSyncIndicatorKind(snapshot);
  switch (kind) {
    case 'offline':
      return 'Offline — sync paused';
    case 'error':
      return 'Sync error';
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
