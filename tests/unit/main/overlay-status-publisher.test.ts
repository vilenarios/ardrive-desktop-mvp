// @vitest-environment node
//
// FEAT-9 Phase 0: unit coverage for the platform-agnostic OverlayStatusPublisher
// core (src/main/overlay-status-publisher.ts) - the shared spine the future
// Windows (memory-mapped table) and macOS (App-Group snapshot) native overlay
// layers will consume. See docs/product/OVERLAYS-PLAN-2026-07-09.md §1.
//
// Covers: the 7->3 syncStatus->bucket collapse (pure function, exhaustive),
// fileId->localPath resolution via a narrow OverlayMetadataSource (DB-shaped
// fixtures per CLAUDE.md - explicit `null`, never `undefined`, for nullable
// columns), snapshot add/update/remove grouped by directory, debounced
// repaint coalescing, and that the flag-off default does no DB work at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';

// overlay-status-publisher.ts exports a module-singleton wired to the real
// `databaseManager` (mirroring the existing databaseManager/turboManager/
// arnsService singleton pattern) so DownloadManager/main.ts can import one
// shared instance without constructor threading. That singleton's transitive
// import chain (database-manager -> profile-manager -> arns-service -> gateway
// -> config-manager) constructs a ConfigManager at module-load time, which
// reads `app.getPath('userData')` immediately - so 'electron' must be mocked
// before importing, same as tests/unit/main/sync16-failed-syncstatus.test.ts.
// None of these real singletons are exercised below; every test here drives
// the class directly against a fake OverlayMetadataSource.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-ardrive') },
}));

import {
  statusToBucket,
  OverlayStatusPublisher,
  OverlayMetadataSource,
  OverlaySink,
  NoopOverlaySink,
  OverlayBucket,
  OVERLAYS_ENABLED,
} from '../../../src/main/overlay-status-publisher';

describe('OVERLAYS_ENABLED flag (FEAT-9 Phase 0)', () => {
  it('is off by default - Phase 0 ships with no native transport', () => {
    expect(OVERLAYS_ENABLED).toBe(false);
  });
});

describe('statusToBucket (7 -> 3 collapse)', () => {
  it('maps synced -> synced', () => {
    expect(statusToBucket('synced')).toBe('synced');
  });

  it('maps pending, queued, downloading -> syncing', () => {
    expect(statusToBucket('pending')).toBe('syncing');
    expect(statusToBucket('queued')).toBe('syncing');
    expect(statusToBucket('downloading')).toBe('syncing');
  });

  it('maps error, failed -> error', () => {
    expect(statusToBucket('error')).toBe('error');
    expect(statusToBucket('failed')).toBe('error');
  });

  it('maps cloud_only -> null (not on disk, nothing to badge)', () => {
    expect(statusToBucket('cloud_only')).toBeNull();
  });

  it('fails safe to null for unknown/legacy values and nullish input', () => {
    expect(statusToBucket('some-future-status')).toBeNull();
    expect(statusToBucket(null)).toBeNull();
    expect(statusToBucket(undefined)).toBeNull();
  });
});

// A fake OverlayMetadataSource - the narrow DB slice the publisher depends on.
// Fixtures are DB-shaped: nullable columns are explicit `null` (never
// `undefined`), matching what node-sqlite3 actually returns (CLAUDE.md trap).
function makeFakeDb(rows: Array<{ fileId: string; localPath: string | null; syncStatus: string | null }> = []) {
  const byFileId = new Map(rows.map((r) => [r.fileId, r]));
  return {
    getDriveMetadataByFileId: vi.fn(async (fileId: string) => byFileId.get(fileId) ?? null),
    getAllDriveMetadataWithLocalPath: vi.fn(async () =>
      rows.filter((r) => r.localPath !== null) as Array<{ fileId: string; localPath: string; syncStatus: string | null }>
    ),
  } satisfies OverlayMetadataSource;
}

function makeSpySink() {
  const applyBadges = vi.fn();
  const clear = vi.fn();
  const sink: OverlaySink = { applyBadges, clear };
  return { sink, applyBadges, clear };
}

const DIR_A = path.join('/sync', 'DriveA');
const DIR_B = path.join('/sync', 'DriveB');
const FILE_1 = path.join(DIR_A, 'one.txt');
const FILE_2 = path.join(DIR_A, 'two.txt');
const FILE_3 = path.join(DIR_B, 'three.txt');

describe('OverlayStatusPublisher (enabled: true, for direct unit coverage)', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let sink: OverlaySink;
  let applyBadges: ReturnType<typeof vi.fn>;
  let clearSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePublisher(rows: Array<{ fileId: string; localPath: string | null; syncStatus: string | null }> = [], debounceMs = 200) {
    db = makeFakeDb(rows);
    const spy = makeSpySink();
    sink = spy.sink;
    applyBadges = spy.applyBadges;
    clearSpy = spy.clear;
    return new OverlayStatusPublisher(db, { sink, debounceMs, enabled: true });
  }

  describe('updateFileStatus - fileId -> localPath resolution', () => {
    it('resolves fileId to localPath via the DB and publishes the bucket', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'synced');
      expect(db.getDriveMetadataByFileId).toHaveBeenCalledWith('file-1');
      expect(publisher.getBucketForPath(FILE_1)).toBe('synced');
    });

    it('skips gracefully (no throw) when the DB row has a null localPath (e.g. cloud_only, never downloaded)', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: null, syncStatus: 'cloud_only' },
      ]);

      await expect(publisher.updateFileStatus('file-1', 'cloud_only')).resolves.toBeUndefined();
      expect(publisher.getBucketForPath('/wherever')).toBeNull();

      vi.advanceTimersByTime(1000);
      expect(applyBadges).not.toHaveBeenCalled();
    });

    it('skips gracefully (no throw) when the fileId is not cached in the DB at all', async () => {
      const publisher = makePublisher([]); // empty - row not found -> null

      await expect(publisher.updateFileStatus('missing-file-id', 'synced')).resolves.toBeUndefined();
      vi.advanceTimersByTime(1000);
      expect(applyBadges).not.toHaveBeenCalled();
    });

    it('falls back to the DB row syncStatus when the caller passes an undefined status', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: 'error' },
      ]);

      await publisher.updateFileStatus('file-1', undefined);
      expect(publisher.getBucketForPath(FILE_1)).toBe('error');
    });
  });

  describe('snapshot add/update/remove, grouped by directory', () => {
    it('groups multiple files under the same directory', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
        { fileId: 'file-2', localPath: FILE_2, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'synced');
      await publisher.updateFileStatus('file-2', 'downloading');

      const entries = publisher.getDirEntries(DIR_A);
      expect(entries.get(FILE_1)).toBe('synced');
      expect(entries.get(FILE_2)).toBe('syncing');
      expect(entries.size).toBe(2);
    });

    it('updates a bucket in place when the same file transitions status', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'downloading');
      expect(publisher.getBucketForPath(FILE_1)).toBe('syncing');

      await publisher.updateFileStatus('file-1', 'synced');
      expect(publisher.getBucketForPath(FILE_1)).toBe('synced');
      expect(publisher.getDirEntries(DIR_A).size).toBe(1);
    });

    it('removes the entry (and empties the directory) when the bucket collapses to null', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'synced');
      expect(publisher.getDirEntries(DIR_A).size).toBe(1);

      await publisher.updateFileStatus('file-1', 'cloud_only');
      expect(publisher.getBucketForPath(FILE_1)).toBeNull();
      expect(publisher.getDirEntries(DIR_A).size).toBe(0);
    });

    it('keeps separate directories independent', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
        { fileId: 'file-3', localPath: FILE_3, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'synced');
      await publisher.updateFileStatus('file-3', 'error');

      expect(publisher.getDirEntries(DIR_A).get(FILE_1)).toBe('synced');
      expect(publisher.getDirEntries(DIR_B).get(FILE_3)).toBe('error');
    });
  });

  describe('hydrateFromDb', () => {
    it('seeds the snapshot from drive_metadata_cache, grouped by directory', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: 'synced' },
        { fileId: 'file-2', localPath: FILE_2, syncStatus: 'queued' },
        { fileId: 'file-3', localPath: FILE_3, syncStatus: 'failed' },
        // DB-shaped: a cloud_only row commonly still has a stale/absent localPath.
        { fileId: 'file-4', localPath: null, syncStatus: 'cloud_only' },
      ]);

      await publisher.hydrateFromDb();

      expect(db.getAllDriveMetadataWithLocalPath).toHaveBeenCalledTimes(1);
      expect(publisher.getBucketForPath(FILE_1)).toBe('synced');
      expect(publisher.getBucketForPath(FILE_2)).toBe('syncing');
      expect(publisher.getBucketForPath(FILE_3)).toBe('error');
      expect(publisher.getDirEntries(DIR_A).size).toBe(2);
      expect(publisher.getDirEntries(DIR_B).size).toBe(1);
    });

    it('clears any prior snapshot before reseeding (profile switch)', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: 'synced' },
      ]);
      await publisher.hydrateFromDb();
      expect(publisher.getBucketForPath(FILE_1)).toBe('synced');

      // Simulate a profile switch: fresh DB, disjoint set of files.
      db.getAllDriveMetadataWithLocalPath.mockResolvedValueOnce([
        { fileId: 'file-3', localPath: FILE_3, syncStatus: 'error' },
      ]);
      await publisher.hydrateFromDb();

      expect(publisher.getBucketForPath(FILE_1)).toBeNull(); // gone - different profile's DB
      expect(publisher.getBucketForPath(FILE_3)).toBe('error');
    });
  });

  describe('debounced repaint notifications', () => {
    it('coalesces a burst of updates to the same directory into a single sink.applyBadges call', async () => {
      const publisher = makePublisher(
        [
          { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
          { fileId: 'file-2', localPath: FILE_2, syncStatus: null },
        ],
        200
      );

      // A "full-drive sync" burst: many rapid status changes to the same dir.
      await publisher.updateFileStatus('file-1', 'downloading');
      await publisher.updateFileStatus('file-2', 'downloading');
      await publisher.updateFileStatus('file-1', 'synced');
      await publisher.updateFileStatus('file-2', 'synced');

      // Not yet flushed - still inside the debounce window.
      expect(applyBadges).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);

      // Exactly one repaint for DIR_A, reflecting the FINAL state, not one per update.
      expect(applyBadges).toHaveBeenCalledTimes(1);
      const [dirArg, entriesArg] = applyBadges.mock.calls[0];
      expect(dirArg).toBe(DIR_A);
      expect((entriesArg as Map<string, OverlayBucket>).get(FILE_1)).toBe('synced');
      expect((entriesArg as Map<string, OverlayBucket>).get(FILE_2)).toBe('synced');
    });

    it('flushes again for a second burst after the first debounce window elapses', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'downloading');
      vi.advanceTimersByTime(200);
      expect(applyBadges).toHaveBeenCalledTimes(1);

      await publisher.updateFileStatus('file-1', 'synced');
      vi.advanceTimersByTime(200);
      expect(applyBadges).toHaveBeenCalledTimes(2);
    });

    it('notifies each touched directory independently within one debounce window', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
        { fileId: 'file-3', localPath: FILE_3, syncStatus: null },
      ]);

      await publisher.updateFileStatus('file-1', 'synced');
      await publisher.updateFileStatus('file-3', 'error');
      vi.advanceTimersByTime(200);

      expect(applyBadges).toHaveBeenCalledTimes(2);
      const dirsNotified = applyBadges.mock.calls.map((call) => call[0]).sort();
      expect(dirsNotified).toEqual([DIR_A, DIR_B].sort());
    });
  });

  describe('destroy', () => {
    it('clears the sink and stops any pending flush', async () => {
      const publisher = makePublisher([
        { fileId: 'file-1', localPath: FILE_1, syncStatus: null },
      ]);
      await publisher.updateFileStatus('file-1', 'synced');

      publisher.destroy();
      expect(clearSpy).toHaveBeenCalledTimes(1);

      // The pending flush must not fire after destroy.
      vi.advanceTimersByTime(1000);
      expect(applyBadges).not.toHaveBeenCalled();
      expect(publisher.getBucketForPath(FILE_1)).toBeNull();
    });
  });
});

describe('OverlayStatusPublisher (default/disabled - Phase 0 ships OFF)', () => {
  it('constructing with no explicit `enabled` option defaults to OVERLAYS_ENABLED (false)', async () => {
    const db = makeFakeDb([{ fileId: 'file-1', localPath: FILE_1, syncStatus: 'synced' }]);
    const { sink, applyBadges } = makeSpySink();
    const publisher = new OverlayStatusPublisher(db, { sink });

    expect(publisher.isEnabled()).toBe(false);

    await publisher.hydrateFromDb();
    await publisher.updateFileStatus('file-1', 'synced');

    // No DB reads and no subscriptions/repaints at all while disabled.
    expect(db.getAllDriveMetadataWithLocalPath).not.toHaveBeenCalled();
    expect(db.getDriveMetadataByFileId).not.toHaveBeenCalled();
    expect(applyBadges).not.toHaveBeenCalled();
    expect(publisher.getBucketForPath(FILE_1)).toBeNull();
  });
});

describe('NoopOverlaySink (Phase 0 default transport)', () => {
  it('is inert - applyBadges and clear are safe no-ops', () => {
    const sink = new NoopOverlaySink();
    expect(() => sink.applyBadges('/some/dir', new Map([['file', 'synced']]))).not.toThrow();
    expect(() => sink.clear()).not.toThrow();
  });
});
