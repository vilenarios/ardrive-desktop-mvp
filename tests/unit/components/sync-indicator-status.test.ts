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

  // SYNC-9: a broken/offline sync must never look healthy — the degraded
  // states win over the ambient paused/syncing/up-to-date states.
  describe('degraded / offline health (SYNC-9)', () => {
    it("is 'offline' when health is offline, overriding a healthy-looking pendingCount", () => {
      // The engine can even still report isActive with pending files — offline
      // still wins, because sync is actually not reaching the network.
      expect(
        resolveSyncIndicatorKind({ isActive: true, pendingCount: 3, health: 'offline' })
      ).toBe('offline');
      expect(
        syncIndicatorLabelFor({ isActive: true, pendingCount: 3, health: 'offline' })
      ).toBe('Offline — sync paused');
    });

    it("is 'error' when health is error, overriding 'paused' (a failed start leaves isActive false)", () => {
      // A failed startSync leaves isActive=false; without SYNC-9 that read as a
      // benign "Paused". Health 'error' must override it so the failure shows.
      expect(
        resolveSyncIndicatorKind({ isActive: false, pendingCount: 0, health: 'error' })
      ).toBe('error');
      expect(
        syncIndicatorLabelFor({ isActive: false, pendingCount: 0, health: 'error' })
      ).toBe('Sync error');
    });

    it('offline wins over error when both are somehow indicated (health offline is offline)', () => {
      expect(
        resolveSyncIndicatorKind({ isActive: false, pendingCount: 0, health: 'offline' })
      ).toBe('offline');
    });

    it("flips to 'offline' from the navigator.onLine HINT even when main-process health is still healthy", () => {
      expect(
        resolveSyncIndicatorKind({ isActive: true, pendingCount: 0, health: 'healthy', isOnline: false })
      ).toBe('offline');
      expect(
        syncIndicatorLabelFor({ isActive: true, pendingCount: 0, isOnline: false })
      ).toBe('Offline — sync paused');
    });

    it('recovery: health back to healthy (and online) returns to the ambient states', () => {
      // syncing again...
      expect(
        resolveSyncIndicatorKind({ isActive: true, pendingCount: 2, health: 'healthy', isOnline: true })
      ).toBe('syncing');
      // ...or up to date
      expect(
        resolveSyncIndicatorKind({ isActive: true, pendingCount: 0, health: 'healthy', isOnline: true })
      ).toBe('up-to-date');
    });

    it('back-compat: a snapshot with no health/isOnline behaves exactly like pre-SYNC-9', () => {
      expect(resolveSyncIndicatorKind({ isActive: true, pendingCount: 0 })).toBe('up-to-date');
      expect(resolveSyncIndicatorKind({ isActive: false, pendingCount: 0 })).toBe('paused');
    });
  });
});
