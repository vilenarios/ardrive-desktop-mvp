// UX-30: pure status-derivation for the tray's ambient status center.
//
// Kept separate from main.ts (which owns Tray/Menu construction and gathers
// the raw signals — wallet auth state, SyncManager.getStatus()) so the
// state -> string mapping is unit-testable without booting Electron.
//
// Honest-status rule: these strings are the ONLY thing surfaced in the tray
// tooltip/menu for sync state. Never include secrets (wallet balance/address,
// tx ids, file paths) here — callers append that separately.

import type { SyncHealth } from '../types';

export type TrayStatusKind = 'signed-out' | 'paused' | 'syncing' | 'up-to-date';

// UX-36: the tray icon GLYPH kind (distinct from the four text states above).
// OneDrive/Dropbox change the tray glyph itself, not just the tooltip — this
// reduces the richer signal set (auth + engine state + pending + sync health)
// to the four icon variants we actually render (assets/tray-icon{,-syncing,
// -paused,-error}.png). 'error' folds offline in — both are a broken sync the
// user must see. Signed-out reuses the neutral idle glyph (the menu already
// says "Not signed in"; no dedicated signed-out icon).
export type TrayIconKind = 'idle' | 'syncing' | 'paused' | 'error';

export interface TraySyncSnapshot {
  /** Whether a wallet is currently loaded (SecureWalletManager.isWalletLoaded()). */
  isAuthenticated: boolean;
  /** SyncManager.getStatus().isActive — the watcher/upload engine is running. */
  isActive: boolean;
  /** Files not yet uploaded (totalFiles - uploadedFiles, same math the tray already used pre-UX-30). */
  pendingCount: number;
  /**
   * UX-36: SyncManager.getStatus().health — 'error'/'offline' means sync is
   * broken and the icon must show the alert glyph. Optional so existing
   * callers/tests (UX-30) that only care about the text status keep working
   * unchanged; absent is treated as 'healthy'.
   */
  health?: SyncHealth;
}

const STATUS_EMOJI: Record<TrayStatusKind, string> = {
  'signed-out': '🔒',
  paused: '⏸',
  syncing: '🔄',
  'up-to-date': '✅',
};

/**
 * Reduces the raw sync signals to one of the four ambient states named in
 * UX-30: signed-out overrides everything else, then paused (engine stopped),
 * then syncing (pending work) vs up-to-date (engine running, nothing pending).
 */
export function resolveTrayStatusKind(snapshot: TraySyncSnapshot): TrayStatusKind {
  if (!snapshot.isAuthenticated) return 'signed-out';
  if (!snapshot.isActive) return 'paused';
  return snapshot.pendingCount > 0 ? 'syncing' : 'up-to-date';
}

/**
 * The honest, user-facing status line for the tray tooltip/menu — e.g.
 * "Up to date", "Syncing 3 files…", "Paused", "Not signed in".
 */
export function trayTooltipFor(snapshot: TraySyncSnapshot): string {
  const kind = resolveTrayStatusKind(snapshot);
  switch (kind) {
    case 'signed-out':
      return 'Not signed in';
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

/** Same status line, prefixed with the emoji already used across the tray menu/tooltip. */
export function trayMenuLabelFor(snapshot: TraySyncSnapshot): string {
  const kind = resolveTrayStatusKind(snapshot);
  return `${STATUS_EMOJI[kind]} ${trayTooltipFor(snapshot)}`;
}

/**
 * UX-36: reduce the snapshot to the tray ICON glyph to render. Kept separate
 * from resolveTrayStatusKind (the text-status logic UX-30 owns, which must not
 * regress) because the icon set is intentionally coarser and health-aware:
 *   - a broken sync (error/offline) OVERRIDES everything except signed-out —
 *     an alert glyph a user can't miss, matching the OneDrive red-badge cue;
 *   - signed-out has no dedicated glyph, so it reuses the neutral idle mark;
 *   - otherwise paused / syncing / up-to-date map to paused / syncing / idle.
 */
export function resolveTrayIconKind(snapshot: TraySyncSnapshot): TrayIconKind {
  if (!snapshot.isAuthenticated) return 'idle';
  if (snapshot.health === 'error' || snapshot.health === 'offline') return 'error';
  const kind = resolveTrayStatusKind(snapshot);
  switch (kind) {
    case 'paused':
      return 'paused';
    case 'syncing':
      return 'syncing';
    default:
      return 'idle';
  }
}

/**
 * UX-36: map an icon kind + platform to its on-disk asset base name and whether
 * it should be set as a macOS template image. Pure (no Electron/fs) so the
 * platform-specific decision is unit-testable, in particular the documented
 * macOS choice: template images can't be tinted, so idle/syncing/paused use
 * distinct template SILHOUETTES while ERROR uses the COLORED red icon as a
 * NON-template image (so a broken sync actually reads as red in the menu bar).
 * Only the base name is returned — Electron's nativeImage.createFromPath loads
 * the matching "@2x" HiDPI file automatically (the UX-35 convention).
 */
export function trayIconAssetFor(
  kind: TrayIconKind,
  platform: NodeJS.Platform
): { file: string; isTemplate: boolean } {
  const isTemplate = platform === 'darwin' && kind !== 'error';
  if (isTemplate) {
    return { file: kind === 'idle' ? 'trayTemplate.png' : `trayTemplate-${kind}.png`, isTemplate: true };
  }
  return { file: kind === 'idle' ? 'tray-icon.png' : `tray-icon-${kind}.png`, isTemplate: false };
}
