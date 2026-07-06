// UX-30: pure status-derivation for the tray's ambient status center.
//
// Kept separate from main.ts (which owns Tray/Menu construction and gathers
// the raw signals — wallet auth state, SyncManager.getStatus()) so the
// state -> string mapping is unit-testable without booting Electron.
//
// Honest-status rule: these strings are the ONLY thing surfaced in the tray
// tooltip/menu for sync state. Never include secrets (wallet balance/address,
// tx ids, file paths) here — callers append that separately.

export type TrayStatusKind = 'signed-out' | 'paused' | 'syncing' | 'up-to-date';

export interface TraySyncSnapshot {
  /** Whether a wallet is currently loaded (SecureWalletManager.isWalletLoaded()). */
  isAuthenticated: boolean;
  /** SyncManager.getStatus().isActive — the watcher/upload engine is running. */
  isActive: boolean;
  /** Files not yet uploaded (totalFiles - uploadedFiles, same math the tray already used pre-UX-30). */
  pendingCount: number;
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
