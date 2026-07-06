// UX-28: unit coverage for the persistent header sync indicator's pure
// status-derivation logic (src/renderer/utils/syncIndicatorStatus.ts). This
// mirrors tests/unit/main/tray-status.test.ts (UX-30) — same vocabulary
// ("Up to date" / "Syncing N files…" / "Paused"), so the header chip and the
// tray tooltip are provably consistent even though they're separate,
// renderer-local vs main-process modules.
import { describe, it, expect } from 'vitest';
import {
  resolveSyncIndicatorKind,
  syncIndicatorLabelFor,
  SyncIndicatorSnapshot
} from '../../../src/renderer/utils/syncIndicatorStatus';

describe('syncIndicatorStatus (UX-28)', () => {
  describe('resolveSyncIndicatorKind', () => {
    it('is paused when the sync engine is not active, regardless of pendingCount', () => {
      expect(resolveSyncIndicatorKind({ isActive: false, pendingCount: 0 })).toBe('paused');
      // Even with a nonzero pendingCount, an inactive engine reads as paused —
      // "pending" only means something while actively syncing (matches
      // tray-status.ts's resolveTrayStatusKind).
      expect(resolveSyncIndicatorKind({ isActive: false, pendingCount: 5 })).toBe('paused');
    });

    it('is syncing when active with pending files', () => {
      expect(resolveSyncIndicatorKind({ isActive: true, pendingCount: 1 })).toBe('syncing');
    });

    it('is up-to-date when active with nothing pending', () => {
      expect(resolveSyncIndicatorKind({ isActive: true, pendingCount: 0 })).toBe('up-to-date');
    });
  });

  describe('syncIndicatorLabelFor', () => {
    it('returns "Paused" when the engine is stopped', () => {
      const snapshot: SyncIndicatorSnapshot = { isActive: false, pendingCount: 0 };
      expect(syncIndicatorLabelFor(snapshot)).toBe('Paused');
    });

    it('returns "Up to date" when active with nothing pending', () => {
      const snapshot: SyncIndicatorSnapshot = { isActive: true, pendingCount: 0 };
      expect(syncIndicatorLabelFor(snapshot)).toBe('Up to date');
    });

    it('returns "Syncing N files…" (plural) for N pending files', () => {
      const snapshot: SyncIndicatorSnapshot = { isActive: true, pendingCount: 3 };
      expect(syncIndicatorLabelFor(snapshot)).toBe('Syncing 3 files…');
    });

    it('singularizes "file" for exactly one pending file', () => {
      const snapshot: SyncIndicatorSnapshot = { isActive: true, pendingCount: 1 };
      expect(syncIndicatorLabelFor(snapshot)).toBe('Syncing 1 file…');
    });

    it('treats a negative pendingCount (e.g. a stale/racy count) as nothing pending rather than a negative file count', () => {
      const snapshot: SyncIndicatorSnapshot = { isActive: true, pendingCount: -2 };
      expect(syncIndicatorLabelFor(snapshot)).toBe('Up to date');
    });
  });
});
