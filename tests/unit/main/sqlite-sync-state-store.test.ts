// @vitest-environment node
//
// D-026 acceptance test: SqliteSyncStateStore round-trips ardrive-core-js's
// DriveSyncState through the REAL DatabaseManager (real schema + generated SQL
// via node:sqlite), proving the persistence backing incremental delta-resync.
//
// It drives the exact boundary the sync engine uses: save(driveId, state) ->
// load(driveId) -> clear(driveId) -> list(). Serialization goes through core's
// serializeSyncState/deserializeSyncState (never hand-rolled), so a successful
// round-trip proves the on-disk TEXT is a faithful, reloadable representation.
//
// Per-drive isolation is asserted (two drives, independent rows), matching the
// per-profile isolation the DB connection already provides.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';
import { SqliteSyncStateStore } from '../../../src/main/sync/sqlite-sync-state-store';
import {
  serializeSyncState,
  deserializeSyncState,
  EID,
  DriveSyncState,
  SerializedDriveSyncState,
} from 'ardrive-core-js';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test-ardrive-syncstate') } }));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/tmp/test-ardrive-syncstate/${profileId}/${fileName}`
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

const DRIVE_A = '11111111-1111-4111-8111-111111111111';
const DRIVE_B = '99999999-9999-4999-8999-999999999999';

function makeSerialized(driveId: string, block: number): SerializedDriveSyncState {
  return {
    driveId,
    drivePrivacy: 'public',
    lastSyncedBlockHeight: block,
    lastSyncedTimestamp: 1751500000,
    entityStates: [
      {
        entityId: '22222222-2222-4222-8222-222222222222',
        txId: 'a'.repeat(43),
        blockHeight: block - 100,
        parentFolderId: '33333333-3333-4333-8333-333333333333',
        name: 'report.txt',
        entityType: 'file',
      },
      {
        entityId: '44444444-4444-4444-8444-444444444444',
        txId: 'b'.repeat(43),
        blockHeight: block - 50,
        // top-level entity (no parent) — exercises the optional parentFolderId path
        name: 'photos',
        entityType: 'folder',
      },
    ],
  };
}

const stateFrom = (s: SerializedDriveSyncState): DriveSyncState => deserializeSyncState(s);

const suite = DatabaseSync ? describe : describe.skip;

suite('D-026: SqliteSyncStateStore round-trips DriveSyncState (real sqlite)', () => {
  let dm: DatabaseManager;
  let shim: ReturnType<typeof createSqlite3Shim>;
  let store: SqliteSyncStateStore;

  beforeEach(async () => {
    dm = new DatabaseManager();
    shim = createSqlite3Shim();
    (dm as any).db = shim;
    await (dm as any).runMigrations();
    store = new SqliteSyncStateStore(dm);
  });

  afterEach(async () => { await dm.close().catch(() => undefined); });

  it('migration v6 creates the sync_state table (drive_id PK + state TEXT)', () => {
    const cols = shim.engine.prepare(`PRAGMA table_info(sync_state)`).all() as any[];
    const byName = new Map(cols.map((c: any) => [c.name, c]));
    expect(byName.has('drive_id')).toBe(true);
    expect(byName.has('state')).toBe(true);
    expect((byName.get('drive_id') as any).pk).toBe(1); // primary key
    // state column is NOT NULL
    expect((byName.get('state') as any).notnull).toBe(1);
  });

  it('save -> load returns an equivalent state (via core serialize/deserialize)', async () => {
    const original = makeSerialized(DRIVE_A, 1500000);
    await store.save(EID(DRIVE_A), stateFrom(original));

    const loaded = await store.load(EID(DRIVE_A));
    expect(loaded).toBeDefined();
    // Re-serialize the reloaded state and compare to the original serialized form:
    // proves lossless persistence of the block height, timestamp, and every entity.
    expect(serializeSyncState(loaded!)).toEqual(original);
    // The row itself: exactly one, keyed by drive_id, holding parseable JSON.
    const row = shim.engine.prepare(`SELECT drive_id, state FROM sync_state WHERE drive_id = ?`).get(DRIVE_A) as any;
    expect(row.drive_id).toBe(DRIVE_A);
    expect(() => JSON.parse(row.state)).not.toThrow();
  });

  it('save is an upsert — a second save for the same drive replaces (never duplicates)', async () => {
    await store.save(EID(DRIVE_A), stateFrom(makeSerialized(DRIVE_A, 1500000)));
    await store.save(EID(DRIVE_A), stateFrom(makeSerialized(DRIVE_A, 1600000)));

    const rows = shim.engine.prepare(`SELECT COUNT(*) AS n FROM sync_state WHERE drive_id = ?`).get(DRIVE_A) as any;
    expect(Number(rows.n)).toBe(1);
    const loaded = await store.load(EID(DRIVE_A));
    expect(loaded!.lastSyncedBlockHeight).toBe(1600000);
  });

  it('load returns undefined for an unknown drive (→ callers do a full listing)', async () => {
    expect(await store.load(EID(DRIVE_B))).toBeUndefined();
  });

  it('load returns undefined (not a throw) for a corrupt row', async () => {
    await dm.saveSyncState(DRIVE_A, '{ this is : not valid json');
    expect(await store.load(EID(DRIVE_A))).toBeUndefined();
  });

  it('list returns every drive with stored state; clear removes exactly one', async () => {
    await store.save(EID(DRIVE_A), stateFrom(makeSerialized(DRIVE_A, 1500000)));
    await store.save(EID(DRIVE_B), stateFrom(makeSerialized(DRIVE_B, 1234567)));

    const listed = (await store.list()).map((d) => `${d}`).sort();
    expect(listed).toEqual([DRIVE_A, DRIVE_B].sort());

    await store.clear(EID(DRIVE_A));
    expect(await store.load(EID(DRIVE_A))).toBeUndefined();
    // DRIVE_B is untouched — per-drive isolation.
    expect(await store.load(EID(DRIVE_B))).toBeDefined();
    expect((await store.list()).map((d) => `${d}`)).toEqual([DRIVE_B]);

    await store.clearAll();
    expect(await store.list()).toEqual([]);
  });
});
