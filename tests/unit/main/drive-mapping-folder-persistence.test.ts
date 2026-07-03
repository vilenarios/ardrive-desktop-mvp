// @vitest-environment node
//
// UX-2 fix verification against a REAL SQLite engine.
//
// QA-traced failure: DatabaseManager.updateDriveMapping had no
// localFolderPath branch, so the Settings "Change Folder" flow generated
// `UPDATE drive_mappings SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?` —
// the new path never persisted, and sync:start's
// `fs.access(primaryMapping.localFolderPath)` gate kept validating the OLD
// folder. Mock-level tests can't prove the round trip, so this suite runs
// the manager's real schema and real generated SQL through node:sqlite
// (in-memory), then replicates the gate's exact read.
//
// node:sqlite ships with Node >= 22.5 (this repo develops on 23.x); on older
// runtimes (CI's Node 18) the suite skips itself — the SQL-construction tests
// in database-manager.test.ts still run there.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DatabaseManager } from '../../../src/main/database-manager';
import { applySyncFolderChange } from '../../../src/main/utils/sync-folder-change';

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
// environment; the engine below is injected directly, so the module mock
// only has to satisfy the import.
vi.mock('sqlite3', () => ({
  Database: vi.fn(),
}));

// process.getBuiltinModule (Node >= 22.3) instead of `import('node:sqlite')`:
// vite-node's builtin-module list predates node:sqlite and rewrites the
// import into a file lookup that fails. On runtimes without either API
// (CI's Node 18) DatabaseSync stays null and the suite skips.
const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
let DatabaseSync: any = null;
try {
  DatabaseSync = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;
} catch {
  // node:sqlite unavailable — suite skips below.
}

/**
 * Adapts node:sqlite's synchronous API to the sqlite3 callback shape
 * DatabaseManager uses. Every SQL string and bound value the manager builds
 * is parsed and executed by a real SQLite engine — a mis-built UPDATE either
 * throws or leaves the row unchanged, and the read-back assertions catch it.
 */
function createSqlite3Shim() {
  const engine = new DatabaseSync(':memory:');
  const shuffle = (params: any, cb: any) =>
    typeof params === 'function' ? { params: [], cb: params } : { params: params ?? [], cb };
  return {
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
        engine.prepare(sql).run(...params);
        cb?.(null);
      } catch (e) {
        cb?.(e as Error);
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

const baseMapping = (overrides: Record<string, unknown>) =>
  ({
    id: 'mapping-1',
    driveId: 'drive-1',
    driveName: 'My Drive',
    drivePrivacy: 'public',
    localFolderPath: '/unset',
    rootFolderId: 'root-1',
    isActive: true,
    ...overrides,
  } as any);

describe.skipIf(!DatabaseSync)('drive mapping folder persistence — real SQL (UX-2)', () => {
  let dm: DatabaseManager;
  let oldDir: string;
  let newDir: string;
  const cleanupDirs: string[] = [];

  beforeEach(async () => {
    dm = new DatabaseManager();
    (dm as any).db = createSqlite3Shim();
    // Real production schema, via the manager's own migration runner (INFRA-7)
    await (dm as any).runMigrations();

    oldDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux2-old-'));
    newDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux2-new-'));
    cleanupDirs.push(oldDir, newDir);
  });

  afterEach(async () => {
    await dm.close().catch(() => undefined);
    await Promise.all(
      cleanupDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true }))
    );
  });

  it('persists a Settings folder change so the sync:start gate validates the NEW path', async () => {
    await dm.addDriveMapping(baseMapping({ localFolderPath: oldDir, isActive: true }));

    // The Settings path: helper calls updateDriveMapping with the new folder
    await dm.updateDriveMapping('mapping-1', { localFolderPath: newDir });

    // Old folder disappears (the scenario that used to hard-fail sync:start)
    await fs.rm(oldDir, { recursive: true, force: true });

    // Replicate sync:start's exact gate (main.ts): primary mapping selection
    // followed by fs.access on its localFolderPath
    const mappings = await dm.getDriveMappings();
    const primaryMapping = mappings.find((m) => m.isActive) || mappings[0];
    expect(primaryMapping.localFolderPath).toBe(newDir);
    await expect(fs.access(primaryMapping.localFolderPath)).resolves.toBeUndefined();
    // ...whereas the stale path would have thrown
    await expect(fs.access(oldDir)).rejects.toThrow();
  });

  it('updates only the targeted row and preserves its other columns', async () => {
    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ux2-other-'));
    cleanupDirs.push(otherDir);
    await dm.addDriveMapping(baseMapping({ localFolderPath: oldDir, isActive: true }));
    await dm.addDriveMapping(
      baseMapping({
        id: 'mapping-2',
        driveId: 'drive-2',
        driveName: 'Other Drive',
        localFolderPath: otherDir,
        isActive: false,
      })
    );

    await dm.updateDriveMapping('mapping-1', { localFolderPath: newDir });

    const mappings = await dm.getDriveMappings();
    const m1 = mappings.find((m) => m.id === 'mapping-1')!;
    const m2 = mappings.find((m) => m.id === 'mapping-2')!;
    expect(m1.localFolderPath).toBe(newDir);
    // untouched columns survive the UPDATE
    expect(m1.driveName).toBe('My Drive');
    expect(m1.rootFolderId).toBe('root-1');
    expect(m1.isActive).toBe(true);
    // the other drive's row is untouched
    expect(m2.localFolderPath).toBe(otherDir);
    expect(m2.isActive).toBe(false);
  });

  it('end-to-end helper (Settings flag): the mapping the gate reads gets the new path', async () => {
    await dm.addDriveMapping(baseMapping({ localFolderPath: oldDir, isActive: true }));

    // Folder that doesn't exist yet — the helper must create it
    const target = path.join(os.tmpdir(), `ux2-target-${Date.now()}`);
    cleanupDirs.push(target);

    const configWrites: string[] = [];
    await applySyncFolderChange(
      target,
      {
        setConfigSyncFolder: async (p) => {
          configWrites.push(p);
        },
        getDriveMappings: () => dm.getDriveMappings(),
        updateDriveMapping: (id, updates) => dm.updateDriveMapping(id, updates),
        setSyncManagerFolder: () => undefined,
      },
      { updateActiveMapping: true }
    );

    expect(configWrites).toEqual([target]);
    const mappings = await dm.getDriveMappings();
    const primaryMapping = mappings.find((m) => m.isActive) || mappings[0];
    expect(primaryMapping.localFolderPath).toBe(target);
    await expect(fs.access(primaryMapping.localFolderPath)).resolves.toBeUndefined();
  });

  it('end-to-end helper (onboarding, no flag): an existing drive mapping is NOT clobbered', async () => {
    // A different drive is already set up and active...
    await dm.addDriveMapping(baseMapping({ localFolderPath: oldDir, isActive: true }));

    // ...and an onboarding flow sets the folder for a NEW drive before
    // creating that drive's mapping (SyncFolderSetup / DriveAndSyncSetup)
    const onboardingDir = path.join(os.tmpdir(), `ux2-onboarding-${Date.now()}`);
    cleanupDirs.push(onboardingDir);
    await applySyncFolderChange(onboardingDir, {
      setConfigSyncFolder: async () => undefined,
      getDriveMappings: () => dm.getDriveMappings(),
      updateDriveMapping: (id, updates) => dm.updateDriveMapping(id, updates),
      setSyncManagerFolder: () => undefined,
    });

    const mappings = await dm.getDriveMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].localFolderPath).toBe(oldDir);
  });
});
