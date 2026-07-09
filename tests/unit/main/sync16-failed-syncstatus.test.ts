// @vitest-environment node
//
// SYNC-16 — drive_metadata_cache.syncStatus must accept 'failed' on a REAL DB.
//
// The bug: live download/sync code writes syncStatus='failed' (DownloadManager,
// sync-manager — via DatabaseManager.updateFileSyncStatus), but the v3 CHECK
// constraint only allowed ('synced','pending','downloading','queued',
// 'cloud_only','error'). On a real SQLite database those UPDATEs THROW a CHECK
// violation, so the failed state was never persisted — a defect invisible under
// the mocked DB (the mock has no CHECK). The v7 migration widens the CHECK.
//
// These tests run against a REAL node:sqlite engine (behind the sqlite3-shaped
// shim used by database-migrations.test.ts / migration-adversarial.test.ts),
// exercising the ACTUAL DatabaseManager.updateFileSyncStatus / getFilesByStatus
// code paths — not the mock. Rows are seeded DB-SHAPED (integer booleans 0/1,
// SQL NULLs) per CLAUDE.md, so reads return the raw integer/null shapes.
// node:sqlite needs Node >= 22.5; on older runtimes the suite skips itself.
import { describe, it, expect, vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';
import { MIGRATIONS, CURRENT_SCHEMA_VERSION, Migration } from '../../../src/main/migrations';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-ardrive') },
}));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/tmp/test-ardrive/${profileId}/${fileName}`
    ),
  },
}));
// Production sqlite3 native binding isn't loadable in the test env; the real
// engine is injected directly via the shim below.
vi.mock('sqlite3', () => ({ Database: vi.fn() }));

const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
let DatabaseSync: any = null;
try {
  DatabaseSync = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;
} catch {
  // node:sqlite unavailable — suite skips below.
}

/** sqlite3-callback-shaped shim over a node:sqlite engine (reference pattern). */
function createShim(engine: any) {
  const shuffle = (params: any, cb: any) =>
    typeof params === 'function' ? { params: [], cb: params } : { params: params ?? [], cb };
  return {
    exec(sql: string, cb?: (err: Error | null) => void) {
      try { engine.exec(sql); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
    run(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try {
        const info = engine.prepare(sql).run(...params);
        cb?.call(
          { changes: Number(info.changes), lastID: Number(info.lastInsertRowid) },
          null
        );
      } catch (e) { cb?.(e as Error); }
    },
    get(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try { cb?.(null, engine.prepare(sql).get(...params)); } catch (e) { cb?.(e as Error); }
    },
    all(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try { cb?.(null, engine.prepare(sql).all(...params)); } catch (e) { cb?.(e as Error); }
    },
    close(cb?: (err: Error | null) => void) {
      try { engine.close(); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
  };
}

function managerOn(engine: any): DatabaseManager {
  const dm = new DatabaseManager();
  (dm as any).db = createShim(engine);
  return dm;
}

/** Migrations up to (and including) a given version — models a pre-v7 DB. */
function migrationsUpTo(version: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version <= version);
}

/**
 * Seeds a DB-SHAPED (integer booleans, NULLs) drive_mappings parent + one
 * drive_metadata_cache row in the given syncStatus. Runs directly on the
 * engine so the stored shapes are authentic (0/1, NULL), exactly what a real
 * profile DB holds — not clean JS booleans/undefined.
 */
function seedDbShapedRow(engine: any, syncStatus: string): void {
  engine.prepare(
    `INSERT INTO drive_mappings (id, driveId, driveName, drivePrivacy, localFolderPath, rootFolderId, isActive, syncDirection, uploadPriority)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run('mapping-1', 'drive-1', 'My Drive', 'public', 'C:\\ARDRIVE', 'root-1', 1, 'bidirectional', 0);

  engine.prepare(
    `INSERT INTO drive_metadata_cache (id, mappingId, fileId, parentFolderId, name, path, type, size, lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash, localPath, localFileExists, syncStatus, syncPreference, downloadPriority, lastError)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    'meta-1', 'mapping-1', 'file-1', 'root-1', 'photo.jpg', '/photo.jpg', 'file',
    1048576, 1751450400000, 'dataTx-1', null, 'image/jpeg', null, null,
    0 /* localFileExists: integer, not false */, syncStatus, 'auto', 0, null
  );
}

function userVersion(engine: any): number {
  return Number(engine.prepare('PRAGMA user_version').get().user_version);
}

describe.skipIf(!DatabaseSync)('SYNC-16 — syncStatus=failed on a real drive_metadata_cache', () => {
  it('reproduces the bug: the PRE-v7 schema rejects syncStatus=failed (CHECK violation)', async () => {
    const engine = new DatabaseSync(':memory:');
    const dm = managerOn(engine);
    await (dm as any).runMigrations(migrationsUpTo(6));
    expect(userVersion(engine)).toBe(6);
    seedDbShapedRow(engine, 'error');

    // The exact live-code call (DownloadManager / sync-manager use this method)
    // throws against the un-widened CHECK — the defect SYNC-16 fixes.
    await expect(
      dm.updateFileSyncStatus('file-1', 'failed', 'Download failed: gateway 404')
    ).rejects.toThrow(/constraint/i);

    // The row is unchanged — the failed state was NOT persisted (the bug).
    const stillError = await dm.getFilesByStatus('mapping-1', 'error');
    expect(stillError).toHaveLength(1);
    expect(stillError[0].syncStatus).toBe('error');
  });

  it('after the v7 migration, updateFileSyncStatus(..., "failed") succeeds and persists (real code path)', async () => {
    const engine = new DatabaseSync(':memory:');
    const dm = managerOn(engine);
    await (dm as any).runMigrations();
    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(7);
    seedDbShapedRow(engine, 'downloading');

    await expect(
      dm.updateFileSyncStatus('file-1', 'failed', 'Download failed: gateway 404')
    ).resolves.toBeUndefined();

    const failed = await dm.getFilesByStatus('mapping-1', 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].fileId).toBe('file-1');
    expect(failed[0].syncStatus).toBe('failed');
    expect(failed[0].lastError).toBe('Download failed: gateway 404');
    // DB-shaped read: the raw integer boolean is preserved (not coerced).
    expect(failed[0].localFileExists).toBe(0);
    expect(failed[0].isHidden).toBe(0);
  });

  it('a direct INSERT of a syncStatus=failed row is accepted by the v7 CHECK', async () => {
    const engine = new DatabaseSync(':memory:');
    const dm = managerOn(engine);
    await (dm as any).runMigrations();
    // Seeding a brand-new row already in the 'failed' state must not throw.
    expect(() => seedDbShapedRow(engine, 'failed')).not.toThrow();
    const failed = await dm.getFilesByStatus('mapping-1', 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].syncStatus).toBe('failed');
  });

  it('upgrades an existing pre-v7 DB to v7 without data loss, then accepts failed', async () => {
    const engine = new DatabaseSync(':memory:');
    const dm = managerOn(engine);

    // Existing profile DB at v6 with a real row (DB-shaped).
    await (dm as any).runMigrations(migrationsUpTo(6));
    seedDbShapedRow(engine, 'synced');
    const before = engine.prepare('SELECT * FROM drive_metadata_cache').all().map((r: any) => ({ ...r }));
    expect(before).toHaveLength(1);

    // Upgrade: the runner sees user_version=6 and applies ONLY v7 (the rebuild).
    await (dm as any).runMigrations();
    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);

    // Lossless: the pre-existing row survives byte-identical through the rebuild.
    const after = engine.prepare('SELECT * FROM drive_metadata_cache').all().map((r: any) => ({ ...r }));
    expect(after).toEqual(before);

    // And the widened CHECK is now in force on the rebuilt table.
    await expect(
      dm.updateFileSyncStatus('file-1', 'failed', 'boom')
    ).resolves.toBeUndefined();
    const failed = await dm.getFilesByStatus('mapping-1', 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toBe('boom');

    // The v4 composite index survives the rebuild (still serves the lookup).
    const idx = engine
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_metadata_mapping_sync_status'")
      .get();
    expect(Number(idx.n)).toBe(1);
  });
});
