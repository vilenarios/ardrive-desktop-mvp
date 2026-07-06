// @vitest-environment node
//
// SYNC-28 fix verification against a REAL SQLite engine.
//
// The gap: file_versions rows are written at QUEUE time by createNewVersion
// (via addFileVersion) BEFORE the upload exists, so arweaveId/turboId are null.
// processUploadResult now back-fills the data-tx id via
// DatabaseManager.updateFileVersionTxId. Data correctness is critical here —
// the UPDATE must target ONLY the version this upload corresponds to (the
// latest, not-yet-populated row for the filePath) and must NEVER clobber an
// older revision's already-recorded tx id.
//
// Mock-level tests can't prove which row a real UPDATE touches, so this suite
// runs the manager's real schema and its real generated SQL through
// node:sqlite (in-memory), following the drive-mapping-folder-persistence.test
// pattern. node:sqlite ships with Node >= 22.5; on older runtimes the suite
// skips itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-ardrive'),
  },
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/tmp/test-ardrive/${profileId}/${fileName}`
    ),
  },
}));

// The production `sqlite3` native binding isn't loadable in the test
// environment; the engine below is injected directly, so the module mock only
// has to satisfy the import.
vi.mock('sqlite3', () => ({
  Database: vi.fn(),
}));

// process.getBuiltinModule (Node >= 22.3) instead of `import('node:sqlite')`:
// vite-node's builtin-module list predates node:sqlite and rewrites the import
// into a file lookup that fails. On runtimes without either API DatabaseSync
// stays null and the suite skips.
const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
let DatabaseSync: any = null;
try {
  DatabaseSync = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;
} catch {
  // node:sqlite unavailable — suite skips below.
}

/**
 * Adapts node:sqlite's synchronous API to the sqlite3 callback shape
 * DatabaseManager uses. The `run` callback receives `this.changes` because the
 * SYNC-28 method resolves its boolean from it.
 */
function createSqlite3Shim() {
  const engine = new DatabaseSync(':memory:');
  // Faithful to production: node-sqlite3 binds `undefined` params as NULL,
  // whereas node:sqlite throws — coerce so the manager's real INSERTs (which
  // pass undefined for unset optional columns) behave as they do in prod.
  const bind = (params: any[]) => params.map((p) => (p === undefined ? null : p));
  const shuffle = (params: any, cb: any) =>
    typeof params === 'function'
      ? { params: [], cb: params }
      : { params: bind(params ?? []), cb };
  return {
    engine,
    exec(sql: string, cb?: (err: Error | null) => void) {
      try {
        engine.exec(sql);
        cb?.(null);
      } catch (e) {
        cb?.(e as Error);
      }
    },
    run(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try {
        const info = engine.prepare(sql).run(...params);
        // Mirror node-sqlite3's callback context: `this.changes` = rows affected.
        cb?.call({ changes: Number(info.changes ?? 0) }, null);
      } catch (e) {
        cb?.call({ changes: 0 }, e as Error);
      }
    },
    get(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try {
        cb?.(null, engine.prepare(sql).get(...params));
      } catch (e) {
        cb?.(e as Error);
      }
    },
    all(sql: string, maybeParams?: any, maybeCb?: any) {
      const { params, cb } = shuffle(maybeParams, maybeCb);
      try {
        cb?.(null, engine.prepare(sql).all(...params));
      } catch (e) {
        cb?.(e as Error);
      }
    },
    close(cb?: (err: Error | null) => void) {
      try {
        engine.close();
        cb?.(null);
      } catch (e) {
        cb?.(e as Error);
      }
    },
  };
}

const FILE_PATH = '/test/sync/report.txt';

// DB-shaped fixture matching what createNewVersion writes at queue time:
// addFileVersion inserts with null arweaveId/turboId/uploadMethod and marks the
// row isLatest, demoting any prior latest for the same path.
const queueTimeVersion = (overrides: Record<string, unknown> = {}) => ({
  id: 'version-1',
  fileHash: 'hash-v1',
  fileName: 'report.txt',
  filePath: FILE_PATH,
  relativePath: 'report.txt',
  fileSize: 100,
  version: 1,
  changeType: 'create' as const,
  ...overrides,
});

describe.skipIf(!DatabaseSync)('per-version tx id persistence — real SQL (SYNC-28)', () => {
  let dm: DatabaseManager;
  let shim: ReturnType<typeof createSqlite3Shim>;

  // Read rows straight off the engine — getFileVersions filters by mappingId,
  // and addFileVersion writes null mappingId, so a raw read is the honest view
  // of what the UPDATE actually touched.
  const readVersions = (filePath: string): any[] =>
    shim.engine
      .prepare('SELECT * FROM file_versions WHERE filePath = ? ORDER BY version ASC')
      .all(filePath);

  beforeEach(async () => {
    dm = new DatabaseManager();
    shim = createSqlite3Shim();
    (dm as any).db = shim;
    await (dm as any).runMigrations();
  });

  afterEach(async () => {
    await dm.close().catch(() => undefined);
  });

  it('back-fills the Turbo tx id onto the latest version (turboId, not arweaveId)', async () => {
    await dm.addFileVersion(queueTimeVersion());

    const updated = await dm.updateFileVersionTxId(FILE_PATH, 'tx-v1', { method: 'turbo' });

    expect(updated).toBe(true);
    const [row] = readVersions(FILE_PATH);
    expect(row.turboId).toBe('tx-v1');
    expect(row.arweaveId).toBeNull();
    expect(row.uploadMethod).toBe('turbo');
    expect(row.isLatest).toBe(1); // DB-shaped boolean (integer)
  });

  it('routes a legacy AR upload to arweaveId (turboId stays null)', async () => {
    await dm.addFileVersion(queueTimeVersion());

    const updated = await dm.updateFileVersionTxId(FILE_PATH, 'ar-tx-v1', { method: 'ar' });

    expect(updated).toBe(true);
    const [row] = readVersions(FILE_PATH);
    expect(row.arweaveId).toBe('ar-tx-v1');
    expect(row.turboId).toBeNull();
    expect(row.uploadMethod).toBe('ar');
  });

  it('a SECOND edit populates its OWN tx id without clobbering the first version', async () => {
    // Edit #1 -> version 1 created at queue time, then upload completes.
    await dm.addFileVersion(queueTimeVersion());
    await dm.updateFileVersionTxId(FILE_PATH, 'tx-v1', { method: 'turbo' });

    // Edit #2 -> addFileVersion demotes v1 (isLatest = 0) and inserts v2 (latest,
    // null tx ids) — exactly what createNewVersion does for the next revision.
    await dm.addFileVersion(
      queueTimeVersion({
        id: 'version-2',
        fileHash: 'hash-v2',
        version: 2,
        parentVersion: 'version-1',
        changeType: 'update',
      })
    );

    // Upload #2 completes -> back-fill v2's tx id.
    const updated = await dm.updateFileVersionTxId(FILE_PATH, 'tx-v2', { method: 'turbo' });
    expect(updated).toBe(true);

    const [v1, v2] = readVersions(FILE_PATH);
    // v1's tx id is intact — an older revision was NOT clobbered.
    expect(v1.version).toBe(1);
    expect(v1.turboId).toBe('tx-v1');
    expect(v1.isLatest).toBe(0);
    // v2 got its own tx id, and only v2.
    expect(v2.version).toBe(2);
    expect(v2.turboId).toBe('tx-v2');
    expect(v2.isLatest).toBe(1);
  });

  it('is idempotent: a repeat call on an already-populated latest is a no-op (null-guard)', async () => {
    await dm.addFileVersion(queueTimeVersion());
    await dm.updateFileVersionTxId(FILE_PATH, 'tx-v1', { method: 'turbo' });

    // e.g. the retry path re-entering processUploadResult with a different id.
    const secondUpdate = await dm.updateFileVersionTxId(FILE_PATH, 'tx-SHOULD-NOT-WIN', {
      method: 'turbo',
    });

    expect(secondUpdate).toBe(false);
    const [row] = readVersions(FILE_PATH);
    expect(row.turboId).toBe('tx-v1'); // original value preserved
  });

  it('returns false when there is no matching version row (unknown path)', async () => {
    const updated = await dm.updateFileVersionTxId('/test/sync/nope.txt', 'tx-x', {
      method: 'turbo',
    });
    expect(updated).toBe(false);
  });

  it('never targets a demoted (isLatest = 0) revision', async () => {
    // v1 latest but intentionally left UNpopulated, then demoted by a v2 edit.
    await dm.addFileVersion(queueTimeVersion());
    await dm.addFileVersion(
      queueTimeVersion({ id: 'version-2', fileHash: 'hash-v2', version: 2, changeType: 'update' })
    );

    // Back-fill should land on v2 (the current latest), leaving the demoted v1
    // untouched even though v1 also has null tx ids.
    await dm.updateFileVersionTxId(FILE_PATH, 'tx-latest', { method: 'turbo' });

    const [v1, v2] = readVersions(FILE_PATH);
    expect(v1.turboId).toBeNull();
    expect(v2.turboId).toBe('tx-latest');
  });
});
