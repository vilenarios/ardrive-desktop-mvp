// @vitest-environment node
//
// FEAT-6 acceptance test (real DatabaseManager, real schema + generated SQL via
// node:sqlite), exercising the exact end-to-end path that populates the
// version-history modal: `files:get-versions` -> DatabaseManager.getFileVersions.
//
// It drives the REAL boundary the IPC handler uses:
//   1. addFileVersion(...) at queue time, carrying the mappingId of the drive
//      being synced (this is what createNewVersion now threads through — the
//      qa-gate CRITICAL fix). Before the fix, mappingId was never written, so
//      every row had mappingId = NULL.
//   2. updateFileVersionTxId(...) — the SYNC-28 back-fill on upload completion.
//   3. getFileVersions(filePath) with NO mappingId arg (the FEAT-6 IPC path),
//      which scopes rows to `mappingId IN (SELECT id FROM drive_mappings)`.
//
// With the fix, the row carries a real mappingId that IS in drive_mappings, so
// getFileVersions RETURNS it (with its back-filled tx id) instead of dropping
// it — the modal shows the version instead of "No versions recorded yet".
//
// Isolation: the last assertion proves a version scoped to mapping-1 does NOT
// surface when getFileVersions is scoped to a different mapping — a version can
// never leak across drives/profiles.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test-ardrive') } }));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/tmp/test-ardrive/${profileId}/${fileName}`
    ),
  },
}));
vi.mock('sqlite3', () => ({ Database: vi.fn() }));

const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
let DatabaseSync: any = null;
try {
  DatabaseSync = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;
} catch {
  /* node:sqlite unavailable — suite skips */
}

function createSqlite3Shim() {
  const engine = new DatabaseSync(':memory:');
  const bind = (params: any[]) => params.map((p) => (p === undefined ? null : p));
  const shuffle = (params: any, cb: any) =>
    typeof params === 'function' ? { params: [], cb: params } : { params: bind(params ?? []), cb };
  return {
    engine,
    exec(sql: string, cb?: (err: Error | null) => void) {
      try { engine.exec(sql); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
    run(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try {
        const info = engine.prepare(sql).run(...params);
        cb?.call({ changes: Number(info.changes ?? 0) }, null);
      } catch (e) { cb?.call({ changes: 0 }, e as Error); }
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

const FILE_PATH = '/test/sync/report.txt';

const suite = DatabaseSync ? describe : describe.skip;

suite('FEAT-6: getFileVersions returns mappingId-scoped rows (history is non-empty)', () => {
  let dm: DatabaseManager;
  let shim: ReturnType<typeof createSqlite3Shim>;

  beforeEach(async () => {
    dm = new DatabaseManager();
    shim = createSqlite3Shim();
    (dm as any).db = shim;
    await (dm as any).runMigrations();
    // Realistic prod state: the active drive mapping the file belongs to.
    shim.engine.prepare(
      `INSERT INTO drive_mappings (id, driveId, driveName, drivePrivacy, localFolderPath, rootFolderId, isActive)
       VALUES ('mapping-1', 'drive-1', 'Test', 'public', '/sync', 'root-1', 1)`
    ).run();
  });

  afterEach(async () => { await dm.close().catch(() => undefined); });

  it('returns the version the UI needs, carrying its back-filled tx id', async () => {
    // Exactly what createNewVersion -> addFileVersion now writes at queue time:
    // the version row is scoped to the drive being synced (mapping-1).
    await dm.addFileVersion({
      id: 'version-1',
      mappingId: 'mapping-1',
      fileHash: 'hash-v1',
      fileName: 'report.txt',
      filePath: FILE_PATH,
      relativePath: 'report.txt',
      fileSize: 100,
      version: 1,
      changeType: 'create',
    });
    // SYNC-28 back-fill runs on upload completion.
    await dm.updateFileVersionTxId(FILE_PATH, 'tx-v1', { method: 'turbo' });

    // THE FEAT-6 IPC PATH: getFileVersions(filePath) with no mappingId arg.
    const versions = await dm.getFileVersions(FILE_PATH);

    // The row is returned (was [] before the fix) with its tx id, so View/Download
    // can link to a real transaction instead of "No versions recorded yet".
    expect(versions).toHaveLength(1);
    expect(versions[0]?.turboId).toBe('tx-v1');
    expect((versions[0] as any).mappingId).toBe('mapping-1');
  });

  it('keeps a version isolated to its own mapping (no cross-drive leak)', async () => {
    await dm.addFileVersion({
      id: 'version-1',
      mappingId: 'mapping-1',
      fileHash: 'hash-v1',
      fileName: 'report.txt',
      filePath: FILE_PATH,
      relativePath: 'report.txt',
      fileSize: 100,
      version: 1,
      changeType: 'create',
    });

    // Same file path, but scoped to a DIFFERENT mapping: the version belongs to
    // mapping-1 and must NOT surface under mapping-2.
    const otherDrive = await dm.getFileVersions(FILE_PATH, 'mapping-2');
    expect(otherDrive).toHaveLength(0);

    // Scoped to its own mapping, it IS returned.
    const ownDrive = await dm.getFileVersions(FILE_PATH, 'mapping-1');
    expect(ownDrive).toHaveLength(1);
  });
});
