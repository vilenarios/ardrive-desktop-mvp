// @vitest-environment node
//
// UX-30: unit coverage for the tray's ambient-status pure logic
// (src/main/tray-status.ts). This is the only part of the "live tray status
// center" work that's cheaply testable without booting Electron/Tray/Menu —
// main.ts (createTray/updateTrayMenu) just gathers the raw signals (wallet
// auth state, SyncManager.getStatus(), drive mappings) and hands them to
// these functions, so exercising the four named states here (signed-out /
// paused / syncing-N / up-to-date) is a direct behavioral check on what the
// user actually reads in the tooltip and menu.
import { describe, it, expect } from 'vitest';
import {
  resolveTrayStatusKind,
  trayTooltipFor,
  trayMenuLabelFor,
  resolveTrayIconKind,
  trayIconAssetFor,
  TraySyncSnapshot
} from '../../../src/main/tray-status';

describe('tray-status (UX-30)', () => {
  describe('resolveTrayStatusKind', () => {
    it('is signed-out whenever not authenticated, regardless of sync state', () => {
      expect(
        resolveTrayStatusKind({ isAuthenticated: false, isActive: true, pendingCount: 5 })
      ).toBe('signed-out');
      expect(
        resolveTrayStatusKind({ isAuthenticated: false, isActive: false, pendingCount: 0 })
      ).toBe('signed-out');
    });

    it('is paused when authenticated but the sync engine is not active', () => {
      expect(
        resolveTrayStatusKind({ isAuthenticated: true, isActive: false, pendingCount: 0 })
      ).toBe('paused');
      // Even with a nonzero pendingCount, an inactive engine reads as paused —
      // "pending" only means something while actively syncing.
      expect(
        resolveTrayStatusKind({ isAuthenticated: true, isActive: false, pendingCount: 3 })
      ).toBe('paused');
    });

    it('is syncing when active with pending files', () => {
      expect(
        resolveTrayStatusKind({ isAuthenticated: true, isActive: true, pendingCount: 1 })
      ).toBe('syncing');
    });

    it('is up-to-date when active with nothing pending', () => {
      expect(
        resolveTrayStatusKind({ isAuthenticated: true, isActive: true, pendingCount: 0 })
      ).toBe('up-to-date');
    });
  });

  describe('trayTooltipFor', () => {
    it('returns "Not signed in" for signed-out', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: false, isActive: false, pendingCount: 0 };
      expect(trayTooltipFor(snapshot)).toBe('Not signed in');
    });

    it('returns "Paused" when the engine is stopped', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: true, isActive: false, pendingCount: 0 };
      expect(trayTooltipFor(snapshot)).toBe('Paused');
    });

    it('returns "Up to date" when active with nothing pending', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: true, isActive: true, pendingCount: 0 };
      expect(trayTooltipFor(snapshot)).toBe('Up to date');
    });

    it('returns "Syncing N files…" (plural) for N pending files', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: true, isActive: true, pendingCount: 3 };
      expect(trayTooltipFor(snapshot)).toBe('Syncing 3 files…');
    });

    it('singularizes "file" for exactly one pending file', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: true, isActive: true, pendingCount: 1 };
      expect(trayTooltipFor(snapshot)).toBe('Syncing 1 file…');
    });

    it('treats a negative pendingCount (e.g. a stale/racy count) as nothing pending rather than a negative file count', () => {
      const snapshot: TraySyncSnapshot = { isAuthenticated: true, isActive: true, pendingCount: -2 };
      expect(trayTooltipFor(snapshot)).toBe('Up to date');
    });
  });

  describe('trayMenuLabelFor', () => {
    it('prefixes each honest status string with its status emoji', () => {
      expect(trayMenuLabelFor({ isAuthenticated: false, isActive: false, pendingCount: 0 }))
        .toBe('🔒 Not signed in');
      expect(trayMenuLabelFor({ isAuthenticated: true, isActive: false, pendingCount: 0 }))
        .toBe('⏸ Paused');
      expect(trayMenuLabelFor({ isAuthenticated: true, isActive: true, pendingCount: 0 }))
        .toBe('✅ Up to date');
      expect(trayMenuLabelFor({ isAuthenticated: true, isActive: true, pendingCount: 2 }))
        .toBe('🔄 Syncing 2 files…');
    });
  });

  // UX-36: the tray ICON glyph now reflects the resolved status kind (parity
  // with OneDrive/Dropbox, whose menu-bar glyph changes — not just the tooltip).
  // resolveTrayIconKind is the pure decision main.ts feeds to tray.setImage();
  // trayIconAssetFor is the pure platform->file mapping. Exercising both here is
  // a direct behavioral check that the icon changes with the status kind.
  describe('resolveTrayIconKind (UX-36)', () => {
    it('maps up-to-date to the neutral idle glyph', () => {
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 0 }))
        .toBe('idle');
    });

    it('maps active-with-pending to the syncing glyph', () => {
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 4 }))
        .toBe('syncing');
    });

    it('maps a stopped engine to the paused glyph', () => {
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: false, pendingCount: 0 }))
        .toBe('paused');
    });

    it('changes glyph as the status kind changes (idle -> syncing -> paused)', () => {
      const kinds = [
        resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 0 }),
        resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 2 }),
        resolveTrayIconKind({ isAuthenticated: true, isActive: false, pendingCount: 2 }),
      ];
      expect(kinds).toEqual(['idle', 'syncing', 'paused']);
    });

    it('a broken sync (error/offline health) overrides to the error glyph', () => {
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 3, health: 'error' }))
        .toBe('error');
      // Offline folds into the same alert glyph, even though the text status
      // would still read "Syncing"/"Up to date".
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 0, health: 'offline' }))
        .toBe('error');
    });

    it('healthy sync health does not force the error glyph', () => {
      expect(resolveTrayIconKind({ isAuthenticated: true, isActive: true, pendingCount: 1, health: 'healthy' }))
        .toBe('syncing');
    });

    it('signed-out reuses the neutral idle glyph regardless of stale sync signals', () => {
      expect(resolveTrayIconKind({ isAuthenticated: false, isActive: true, pendingCount: 9, health: 'error' }))
        .toBe('idle');
    });
  });

  describe('trayIconAssetFor (UX-36 asset + macOS template mapping)', () => {
    it('uses the colored variants on Windows/Linux, never as template images', () => {
      expect(trayIconAssetFor('idle', 'win32')).toEqual({ file: 'tray-icon.png', isTemplate: false });
      expect(trayIconAssetFor('syncing', 'win32')).toEqual({ file: 'tray-icon-syncing.png', isTemplate: false });
      expect(trayIconAssetFor('paused', 'linux')).toEqual({ file: 'tray-icon-paused.png', isTemplate: false });
      expect(trayIconAssetFor('error', 'linux')).toEqual({ file: 'tray-icon-error.png', isTemplate: false });
    });

    it('uses template silhouettes on macOS for idle/syncing/paused', () => {
      expect(trayIconAssetFor('idle', 'darwin')).toEqual({ file: 'trayTemplate.png', isTemplate: true });
      expect(trayIconAssetFor('syncing', 'darwin')).toEqual({ file: 'trayTemplate-syncing.png', isTemplate: true });
      expect(trayIconAssetFor('paused', 'darwin')).toEqual({ file: 'trayTemplate-paused.png', isTemplate: true });
    });

    it('macOS error is the COLORED red icon as a NON-template image (documented decision)', () => {
      // Template images render monochrome and can\'t be tinted, so an errored
      // sync deliberately drops out of template mode to actually read as red.
      expect(trayIconAssetFor('error', 'darwin')).toEqual({ file: 'tray-icon-error.png', isTemplate: false });
    });
  });
});
