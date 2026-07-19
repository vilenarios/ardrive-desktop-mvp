// @vitest-environment node
//
// INFRA-7 — versioned database migration framework.
//
// Two layers, following the drive-mapping-folder-persistence.test.ts pattern:
//
// 1. REAL-SQLite tests (node:sqlite behind the sqlite3-shaped shim): a frozen
//    v3 fixture database with realistic DB-shaped rows (integer booleans,
//    NULLs, an EMPTY schema_version table — exactly what the pre-framework
//    createTables() path produced) is opened by the new migration runner and
//    must come out at the current version with every row intact. Also: fresh-DB stamping,
//    failing-migration rollback, future-version refusal, idempotence, and a
//    fresh-vs-migrated schema-convergence guard.
//    node:sqlite needs Node >= 22.5; on older runtimes the suite skips itself.
//
// 2. Capturing-stub tests (run everywhere): prove initialize() wires the
//    runner — migrations execute inside BEGIN IMMEDIATE...COMMIT before the
//    DB is considered ready, failures ROLLBACK and close the handle, and a
//    newer-versioned database is refused without executing anything.
import { describe, it, expect, vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';
import { MIGRATIONS, CURRENT_SCHEMA_VERSION, Migration } from '../../../src/main/migrations';

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

// The production sqlite3 native binding isn't loadable in the test
// environment. The stub-based initialize() tests route through this mock;
// the real-SQLite tests inject a shim directly.
const { sqlite3DbHolder } = vi.hoisted(() => ({
  sqlite3DbHolder: { current: null as any },
}));

vi.mock('sqlite3', () => ({
  Database: vi.fn().mockImplementation((dbPath: string, callback?: (err: Error | null) => void) => {
    if (callback) callback(null);
    return sqlite3DbHolder.current;
  }),
}));

// process.getBuiltinModule (Node >= 22.3) instead of `import('node:sqlite')`:
// vite-node's builtin-module list predates node:sqlite and rewrites the
// import into a file lookup that fails. On runtimes without either API the
// real-SQLite suite skips.
const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
let DatabaseSync: any = null;
try {
  DatabaseSync = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;
} catch {
  // node:sqlite unavailable — real-SQLite suite skips below.
}

// ---------------------------------------------------------------------------
// FROZEN v3 fixture schema.
//
// This is the DDL the pre-INFRA-7 createTables() executed (main @ a483d94),
// frozen here as an independent fixture: it must NEVER track future edits to
// migrations.ts. A test below pins MIGRATIONS[0].sql to this text — if that
// pin breaks, someone edited the baseline migration instead of appending a
// new migration.
// ---------------------------------------------------------------------------
const V3_FIXTURE_DDL = `
          -- Drive mappings for multi-drive support
          CREATE TABLE IF NOT EXISTS drive_mappings (
            id TEXT PRIMARY KEY,
            driveId TEXT NOT NULL,
            driveName TEXT NOT NULL,
            drivePrivacy TEXT NOT NULL CHECK (drivePrivacy IN ('public', 'private')),
            localFolderPath TEXT NOT NULL,
            rootFolderId TEXT NOT NULL,
            isActive BOOLEAN DEFAULT 1,
            lastSyncTime DATETIME,
            lastMetadataSyncAt DATETIME,
            excludePatterns TEXT, -- JSON array of patterns
            maxFileSize INTEGER,
            syncDirection TEXT DEFAULT 'bidirectional' CHECK (syncDirection IN ('bidirectional', 'upload-only', 'download-only')),
            uploadPriority INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(driveId, localFolderPath)
          );
          
          CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            localPath TEXT NOT NULL,
            fileName TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            status TEXT NOT NULL,
            progress REAL DEFAULT 0,
            uploadMethod TEXT,
            transactionId TEXT,
            dataTxId TEXT,
            metadataTxId TEXT,
            fileId TEXT,
            error TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            completedAt DATETIME,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          -- Drive metadata cache for permaweb view
          CREATE TABLE IF NOT EXISTS drive_metadata_cache (
            id TEXT PRIMARY KEY,
            mappingId TEXT NOT NULL,
            fileId TEXT NOT NULL UNIQUE,
            parentFolderId TEXT,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT CHECK (type IN ('file', 'folder')),
            size INTEGER,
            lastModifiedDate INTEGER,
            dataTxId TEXT,
            metadataTxId TEXT,
            contentType TEXT,
            fileHash TEXT,
            lastSyncedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            localPath TEXT,
            localFileExists BOOLEAN DEFAULT 0,
            syncStatus TEXT DEFAULT 'pending' CHECK (syncStatus IN ('synced', 'pending', 'downloading', 'queued', 'cloud_only', 'error')),
            syncPreference TEXT DEFAULT 'auto' CHECK (syncPreference IN ('auto', 'cloud_only')),
            downloadPriority INTEGER DEFAULT 0,
            lastError TEXT,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
          
          CREATE INDEX IF NOT EXISTS idx_metadata_mapping ON drive_metadata_cache(mappingId);
          CREATE INDEX IF NOT EXISTS idx_metadata_parent ON drive_metadata_cache(parentFolderId);
          CREATE INDEX IF NOT EXISTS idx_metadata_path ON drive_metadata_cache(path);
          CREATE INDEX IF NOT EXISTS idx_metadata_fileId ON drive_metadata_cache(fileId);
        
          CREATE TABLE IF NOT EXISTS pending_uploads (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            localPath TEXT NOT NULL,
            fileName TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            estimatedCost REAL NOT NULL,
            estimatedTurboCost REAL,
            recommendedMethod TEXT,
            hasSufficientTurboBalance BOOLEAN,
            conflictType TEXT DEFAULT 'none',
            conflictDetails TEXT,
            status TEXT DEFAULT 'awaiting_approval',
            operationType TEXT DEFAULT 'upload',
            previousPath TEXT,
            arfsFileId TEXT,
            arfsFolderId TEXT,
            metadata TEXT, -- JSON string for extensible metadata
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          CREATE TABLE IF NOT EXISTS processed_files (
            fileHash TEXT,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            fileName TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            localPath TEXT NOT NULL,
            source TEXT NOT NULL,
            arweaveId TEXT,
            processedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (fileHash, mappingId),
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          -- File version tracking
          CREATE TABLE IF NOT EXISTS file_versions (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            fileHash TEXT NOT NULL,
            fileName TEXT NOT NULL,
            filePath TEXT NOT NULL,
            relativePath TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            arweaveId TEXT,
            turboId TEXT,
            version INTEGER NOT NULL,
            parentVersion TEXT,
            changeType TEXT NOT NULL,
            uploadMethod TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            isLatest BOOLEAN DEFAULT 1,
            FOREIGN KEY (parentVersion) REFERENCES file_versions(id),
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          -- File operation history
          CREATE TABLE IF NOT EXISTS file_operations (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            fileHash TEXT NOT NULL,
            operation TEXT NOT NULL,
            fromPath TEXT,
            toPath TEXT,
            metadata TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          -- Folder structure tracking
          CREATE TABLE IF NOT EXISTS folder_structure (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            folderPath TEXT NOT NULL,
            relativePath TEXT NOT NULL,
            parentPath TEXT,
            arfsFolderId TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            isDeleted BOOLEAN DEFAULT 0,
            UNIQUE(folderPath, mappingId),
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
          
          -- Folder operations tracking
          CREATE TABLE IF NOT EXISTS folder_operations (
            id TEXT PRIMARY KEY,
            mappingId TEXT,
            operationType TEXT NOT NULL CHECK (operationType IN ('rename', 'move', 'rename_and_move', 'delete')),
            oldPath TEXT NOT NULL,
            newPath TEXT,
            arfsFolderId TEXT,
            status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
            error TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            completedAt DATETIME,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
        
          -- Downloads tracking
          CREATE TABLE IF NOT EXISTS downloads (
            id TEXT PRIMARY KEY,
            mappingId TEXT, -- NEW: Reference to drive_mappings
            driveId TEXT,   -- Legacy support
            fileName TEXT NOT NULL,
            localPath TEXT NOT NULL,
            fileSize INTEGER NOT NULL,
            fileId TEXT NOT NULL,
            dataTxId TEXT,
            metadataTxId TEXT,
            status TEXT NOT NULL,
            progress REAL DEFAULT 0,
            priority INTEGER DEFAULT 0,
            isCancelled BOOLEAN DEFAULT 0,
            error TEXT,
            downloadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            completedAt DATETIME,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );
          
          -- Drive sync state tracking for incremental sync
          CREATE TABLE IF NOT EXISTS drive_sync_state (
            drive_id TEXT PRIMARY KEY,
            last_sync_time TEXT,
            last_full_scan TEXT,
            total_files INTEGER,
            sync_version INTEGER DEFAULT 1
          );
          
          -- Schema version tracking
          CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        
          -- Indexes for performance
          CREATE INDEX IF NOT EXISTS idx_drive_mappings_active ON drive_mappings(isActive);
          CREATE INDEX IF NOT EXISTS idx_drive_mappings_drive_id ON drive_mappings(driveId);
          CREATE INDEX IF NOT EXISTS idx_uploads_mapping ON uploads(mappingId);
          CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
          CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(createdAt);
          CREATE INDEX IF NOT EXISTS idx_pending_uploads_mapping ON pending_uploads(mappingId);
          CREATE INDEX IF NOT EXISTS idx_pending_uploads_status ON pending_uploads(status);
          CREATE INDEX IF NOT EXISTS idx_processed_files_mapping ON processed_files(mappingId);
          CREATE INDEX IF NOT EXISTS idx_processed_files_hash ON processed_files(fileHash);
          CREATE INDEX IF NOT EXISTS idx_processed_files_source ON processed_files(source);
          CREATE INDEX IF NOT EXISTS idx_file_versions_mapping ON file_versions(mappingId);
          CREATE INDEX IF NOT EXISTS idx_file_versions_path ON file_versions(filePath);
          CREATE INDEX IF NOT EXISTS idx_file_versions_latest ON file_versions(isLatest);
          CREATE INDEX IF NOT EXISTS idx_file_versions_hash ON file_versions(fileHash);
          CREATE INDEX IF NOT EXISTS idx_file_operations_mapping ON file_operations(mappingId);
          CREATE INDEX IF NOT EXISTS idx_file_operations_hash ON file_operations(fileHash);
          CREATE INDEX IF NOT EXISTS idx_folder_structure_mapping ON folder_structure(mappingId);
          CREATE INDEX IF NOT EXISTS idx_folder_structure_path ON folder_structure(folderPath);
          CREATE INDEX IF NOT EXISTS idx_downloads_mapping ON downloads(mappingId);
          CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
          CREATE INDEX IF NOT EXISTS idx_downloads_file_id ON downloads(fileId);
      `;

/**
 * Seeds rows shaped exactly like a real v3 profile database: integer
 * booleans (0/1), SQL NULLs in optional columns, datetime strings — and an
 * EMPTY schema_version table (its only writer was dead code that never ran).
 */
function seedV3Rows(engine: any): void {
  engine.exec(`
    INSERT INTO drive_mappings (id, driveId, driveName, drivePrivacy, localFolderPath, rootFolderId, isActive, lastSyncTime, lastMetadataSyncAt, excludePatterns, maxFileSize, syncDirection, uploadPriority, createdAt, updatedAt)
    VALUES ('mapping-1', 'drive-1', 'My Drive', 'public', 'C:\\ARDRIVE', 'root-folder-1', 1, '2026-07-01 10:00:00', NULL, NULL, NULL, 'bidirectional', 0, '2026-06-01 09:00:00', '2026-07-01 10:00:00');

    INSERT INTO uploads (id, mappingId, driveId, localPath, fileName, fileSize, status, progress, uploadMethod, transactionId, dataTxId, metadataTxId, fileId, error, createdAt, completedAt)
    VALUES ('upload-1', NULL, 'drive-1', 'C:\\ARDRIVE\\report.pdf', 'report.pdf', 52133, 'completed', 100, 'turbo', NULL, 'dataTx-1', 'metaTx-1', 'file-1', NULL, '2026-07-01 10:05:00', '2026-07-01 10:06:00');
    INSERT INTO uploads (id, mappingId, driveId, localPath, fileName, fileSize, status, progress, uploadMethod, transactionId, dataTxId, metadataTxId, fileId, error, createdAt, completedAt)
    VALUES ('upload-2', 'mapping-1', NULL, 'C:\\ARDRIVE\\big.bin', 'big.bin', 9273444, 'uploading', 42.5, NULL, NULL, NULL, NULL, NULL, NULL, '2026-07-02 08:00:00', NULL);

    INSERT INTO drive_metadata_cache (id, mappingId, fileId, parentFolderId, name, path, type, size, lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash, lastSyncedAt, localPath, localFileExists, syncStatus, syncPreference, downloadPriority, lastError)
    VALUES ('meta-1', 'mapping-1', 'file-1', 'root-folder-1', 'report.pdf', '/report.pdf', 'file', 52133, 1751364000000, 'dataTx-1', 'metaTx-1', 'application/pdf', 'abc123hash', '2026-07-01 10:06:00', 'C:\\ARDRIVE\\report.pdf', 1, 'synced', 'auto', 0, NULL);
    INSERT INTO drive_metadata_cache (id, mappingId, fileId, parentFolderId, name, path, type, size, lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash, lastSyncedAt, localPath, localFileExists, syncStatus, syncPreference, downloadPriority, lastError)
    VALUES ('meta-2', 'mapping-1', 'file-2', 'root-folder-1', 'photo.jpg', '/photo.jpg', 'file', 1048576, 1751450400000, 'dataTx-2', NULL, 'image/jpeg', NULL, '2026-07-02 12:00:00', NULL, 0, 'error', 'auto', 0, 'Download failed: network error');

    INSERT INTO pending_uploads (id, mappingId, driveId, localPath, fileName, fileSize, estimatedCost, estimatedTurboCost, recommendedMethod, hasSufficientTurboBalance, conflictType, conflictDetails, status, operationType, previousPath, arfsFileId, arfsFolderId, metadata, createdAt)
    VALUES ('pending-1', 'mapping-1', NULL, 'C:\\ARDRIVE\\new.txt', 'new.txt', 2048, 0.000001, NULL, NULL, 0, 'none', NULL, 'awaiting_approval', 'upload', NULL, NULL, NULL, NULL, '2026-07-02 14:00:00');

    INSERT INTO downloads (id, mappingId, driveId, fileName, localPath, fileSize, fileId, dataTxId, metadataTxId, status, progress, priority, isCancelled, error, downloadedAt, completedAt)
    VALUES ('download-1', 'mapping-1', NULL, 'photo.jpg', 'C:\\ARDRIVE\\photo.jpg', 1048576, 'file-2', 'dataTx-2', NULL, 'failed', 37.2, 0, 0, 'Download failed: network error', '2026-07-02 12:00:00', NULL);

    INSERT INTO processed_files (fileHash, mappingId, driveId, fileName, fileSize, localPath, source, arweaveId, processedAt)
    VALUES ('abc123hash', 'mapping-1', NULL, 'report.pdf', 52133, 'C:\\ARDRIVE\\report.pdf', 'upload', 'dataTx-1', '2026-07-01 10:06:00');

    INSERT INTO drive_sync_state (drive_id, last_sync_time, last_full_scan, total_files, sync_version)
    VALUES ('drive-1', '2026-07-01T10:06:00.000Z', NULL, 2, 1);
    -- schema_version deliberately left EMPTY: real v3 databases have the
    -- table (createTables made it) but no rows (nothing ever inserted).
  `);
}

/** sqlite3-callback-shaped shim over a node:sqlite engine (reference pattern). */
function createShim(engine: any) {
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
        const info = engine.prepare(sql).run(...params);
        // node-sqlite3 binds run() callbacks to a Statement-like context
        // exposing changes/lastID (SYNC-3's recovery reads this.changes).
        cb?.call(
          { changes: Number(info.changes), lastID: Number(info.lastInsertRowid) },
          null
        );
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

function userVersion(engine: any): number {
  return Number(engine.prepare('PRAGMA user_version').get().user_version);
}

/** Plain-object dump of every row of every user table, for lossless-migration comparison. */
function dumpAllRows(engine: any): Record<string, any[]> {
  const tables = engine
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name as string);
  const dump: Record<string, any[]> = {};
  for (const table of tables) {
    dump[table] = engine
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((row: any) => ({ ...row }));
  }
  return dump;
}

/** Structural schema shape: table/index names + full column definitions. */
function schemaShape(engine: any): { tables: string[]; indexes: string[]; columns: Record<string, any[]> } {
  const tables = engine
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name as string);
  const indexes = engine
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r: any) => r.name as string);
  const columns: Record<string, any[]> = {};
  for (const table of tables) {
    columns[table] = engine
      .prepare(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid`)
      .all(table)
      .map((c: any) => ({ ...c }));
  }
  return { tables, indexes, columns };
}

function managerOn(engine: any): { dm: DatabaseManager; shim: ReturnType<typeof createShim> } {
  const dm = new DatabaseManager();
  const shim = createShim(engine);
  (dm as any).db = shim;
  return { dm, shim };
}

describe.skipIf(!DatabaseSync)('database migrations — real SQLite (INFRA-7)', () => {
  it('pins the v3 baseline migration to the frozen fixture DDL (edit-detection guard)', () => {
    // If this fails, the baseline migration in migrations.ts was edited.
    // Databases in the wild have already run it — append a NEW migration
    // instead, and leave this fixture frozen.
    const normalize = (s: string) =>
      s.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '').join('\n');
    expect(normalize(MIGRATIONS[0].sql)).toBe(normalize(V3_FIXTURE_DDL));
  });

  it('migrates a v3 profile DB to the current version losslessly: every row survives byte-identical, index appears', async () => {
    const engine = new DatabaseSync(':memory:');
    engine.exec(V3_FIXTURE_DDL);
    seedV3Rows(engine);
    expect(userVersion(engine)).toBe(0); // legacy v3 DBs were never stamped

    const before = dumpAllRows(engine);
    const { dm } = managerOn(engine);
    await (dm as any).runMigrations();

    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(9);

    // Lossless: all rows of all tables identical to the pre-migration dump —
    // including the integer booleans, NULLs, and the empty schema_version.
    // v5 (SYNC-5) additively adds drive_metadata_cache.isHidden (default 0);
    // strip that additive column for the byte-identical comparison. v6 (D-026)
    // additively adds an empty sync_state table; strip it too. v8 (MONEY-17)
    // additively adds uploads.errorReason (default NULL) — strip it as well.
    const after = dumpAllRows(engine);
    const stripAdditive = (d: Record<string, any[]>) => {
      const { sync_state: _syncState, ...rest } = d;
      return {
        ...rest,
        drive_metadata_cache: (d.drive_metadata_cache ?? []).map(({ isHidden, ...r }: any) => r),
        uploads: (d.uploads ?? []).map(({ errorReason, ...r }: any) => r),
      };
    };
    expect(stripAdditive(after)).toEqual(before);
    expect(after.drive_metadata_cache.every((r: any) => r.isHidden === 0)).toBe(true);
    // v8 (MONEY-17): the additive uploads.errorReason column defaults to NULL on
    // every pre-existing row (a migrated failure is a generic one, not a
    // paused-for-credits one).
    expect(after.uploads.every((r: any) => r.errorReason === null)).toBe(true);
    expect(after.uploads).toHaveLength(2);
    expect(after.drive_metadata_cache).toHaveLength(2);
    expect(after.schema_version).toHaveLength(0);

    // The v4 index exists and actually serves getFilesByStatus's lookup.
    const index = engine
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_metadata_mapping_sync_status'")
      .get();
    expect(index).toBeTruthy();
    const plan = engine
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM drive_metadata_cache WHERE mappingId = ? AND syncStatus = ?')
      .all('mapping-1', 'error');
    expect(JSON.stringify(plan)).toContain('idx_metadata_mapping_sync_status');

    // And production query paths still read the migrated data (raw DB shapes).
    const errorRows = await dm.getFilesByStatus('mapping-1', 'error');
    expect(errorRows).toHaveLength(1);
    expect(errorRows[0].fileId).toBe('file-2');
    expect(errorRows[0].localFileExists).toBe(0); // still the raw integer — untouched
    expect(errorRows[0].lastError).toBe('Download failed: network error');

    // SYNC-10 (v9): processed_files.localPath is indexed too — the per-event
    // edit-detection/dedup lookups (getProcessedFilesByPath) must not fall
    // back to a full-table scan.
    const localPathIndex = engine
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_processed_files_localpath'")
      .get();
    expect(localPathIndex).toBeTruthy();
    const localPathPlan = engine
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM processed_files WHERE localPath = ?')
      .all('C:\\ARDRIVE\\report.pdf');
    expect(JSON.stringify(localPathPlan)).toContain('idx_processed_files_localpath');
    expect(JSON.stringify(localPathPlan)).not.toContain('SCAN');

    // fileHash was already indexed pre-SYNC-10 (v3 baseline PRIMARY KEY +
    // idx_processed_files_hash) — pin that the hash lookup ALSO uses an index.
    const hashPlan = engine
      .prepare('EXPLAIN QUERY PLAN SELECT * FROM processed_files WHERE fileHash = ?')
      .all('abc123hash');
    expect(JSON.stringify(hashPlan)).not.toContain('SCAN TABLE processed_files');

    const dbHashMatches = await dm.getProcessedFilesByHash('abc123hash');
    expect(dbHashMatches).toHaveLength(1);
    expect(dbHashMatches[0].localPath).toBe('C:\\ARDRIVE\\report.pdf');
    const dbPathMatches = await dm.getProcessedFilesByPath('C:\\ARDRIVE\\report.pdf');
    expect(dbPathMatches).toHaveLength(1);
    expect(dbPathMatches[0].fileHash).toBe('abc123hash');
  });

  it('stamps a fresh (empty) DB at the current version with the full schema', async () => {
    const engine = new DatabaseSync(':memory:');
    const { dm } = managerOn(engine);
    await (dm as any).runMigrations();

    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);
    const shape = schemaShape(engine);
    expect(shape.tables).toEqual([
      'downloads',
      'drive_mappings',
      'drive_metadata_cache',
      'drive_sync_state',
      'file_operations',
      'file_versions',
      'folder_operations',
      'folder_structure',
      'pending_uploads',
      'processed_files',
      'schema_version',
      'sync_state',
      'uploads',
    ]);
    expect(shape.indexes).toContain('idx_metadata_mapping_sync_status');
  });

  it('produces the same schema for a fresh DB and a migrated v3 DB (no divergent definitions)', async () => {
    const freshEngine = new DatabaseSync(':memory:');
    await (managerOn(freshEngine).dm as any).runMigrations();

    const legacyEngine = new DatabaseSync(':memory:');
    legacyEngine.exec(V3_FIXTURE_DDL);
    seedV3Rows(legacyEngine);
    await (managerOn(legacyEngine).dm as any).runMigrations();

    expect(schemaShape(legacyEngine)).toEqual(schemaShape(freshEngine));
  });

  it('rolls back a failing migration completely: prior version, no partial schema, data intact', async () => {
    const engine = new DatabaseSync(':memory:');
    engine.exec(V3_FIXTURE_DDL);
    seedV3Rows(engine);
    const before = dumpAllRows(engine);

    // Injected v4: first statement succeeds, second fails — the first must
    // NOT survive (transaction per migration, fail closed).
    const failingMigration: Migration = {
      version: 4,
      description: 'injected failing migration',
      sql: `
        CREATE TABLE migration_should_roll_back (id TEXT PRIMARY KEY);
        ALTER TABLE does_not_exist ADD COLUMN boom TEXT;
      `,
    };

    const { dm } = managerOn(engine);
    await expect(
      (dm as any).runMigrations([MIGRATIONS[0], failingMigration])
    ).rejects.toThrow(/migration to schema v4 .*failed and was rolled back/);

    // Baseline (a lossless no-op on this DB) committed at v3; the failed v4
    // left nothing behind.
    expect(userVersion(engine)).toBe(3);
    const partial = engine
      .prepare("SELECT name FROM sqlite_master WHERE name='migration_should_roll_back'")
      .get();
    expect(partial).toBeUndefined();
    expect(dumpAllRows(engine)).toEqual(before);
  });

  it('refuses a DB stamped newer than this build supports, touching nothing', async () => {
    const engine = new DatabaseSync(':memory:');
    engine.exec(V3_FIXTURE_DDL);
    seedV3Rows(engine);
    engine.exec('PRAGMA user_version = 99');
    const before = dumpAllRows(engine);

    const { dm } = managerOn(engine);
    await expect((dm as any).runMigrations()).rejects.toThrow(
      /schema version 99.*only supports up to version 9/
    );

    expect(userVersion(engine)).toBe(99); // not downgraded
    expect(dumpAllRows(engine)).toEqual(before);
  });

  it('is idempotent: reopening an already-migrated DB executes no SQL at all', async () => {
    const engine = new DatabaseSync(':memory:');
    engine.exec(V3_FIXTURE_DDL);
    seedV3Rows(engine);

    const first = managerOn(engine);
    await (first.dm as any).runMigrations();
    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);
    const afterFirst = dumpAllRows(engine);

    // Second open: spy on every write-capable shim method.
    const second = managerOn(engine);
    const execSpy = vi.spyOn(second.shim, 'exec');
    const runSpy = vi.spyOn(second.shim, 'run');
    await (second.dm as any).runMigrations();

    expect(execSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
    expect(userVersion(engine)).toBe(CURRENT_SCHEMA_VERSION);
    expect(dumpAllRows(engine)).toEqual(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// initialize() wiring — capturing stub, runs on every runtime.
// ---------------------------------------------------------------------------

function createCapturingStub(options: {
  userVersion?: number;
  failOnSql?: (sql: string) => boolean;
} = {}) {
  // node-sqlite3 invokes statement callbacks with `this` bound to a
  // Statement-like context carrying run metadata (`changes`, `lastID`) —
  // SYNC-3's recoverInterruptedOperations reads `this.changes` in its run()
  // callbacks. Model that context ONCE, for every callback the stub fires,
  // so future initialize()-time statements never re-break these tests.
  const statementContext = { changes: 0, lastID: 0 };
  const invoke = (cb: ((...cbArgs: any[]) => void) | undefined, ...args: any[]) => {
    cb?.call(statementContext, ...args);
  };
  const stub = {
    execCalls: [] as string[],
    runCalls: [] as string[],
    /** Unified statement order across exec() and run() — for ordering pins. */
    sqlLog: [] as string[],
    closed: false,
    exec(sql: string, cb?: (err: Error | null) => void) {
      stub.execCalls.push(sql);
      stub.sqlLog.push(sql);
      if (options.failOnSql?.(sql)) {
        invoke(cb, new Error('SQLITE_ERROR: injected failure'));
        return;
      }
      invoke(cb, null);
    },
    get(sql: string, maybeParams?: any, maybeCb?: any) {
      const cb = typeof maybeParams === 'function' ? maybeParams : maybeCb;
      if (sql === 'PRAGMA user_version') {
        invoke(cb, null, { user_version: options.userVersion ?? 0 });
      } else {
        invoke(cb, null, undefined);
      }
    },
    run(sql: string, maybeParams?: any, maybeCb?: any) {
      const cb = typeof maybeParams === 'function' ? maybeParams : maybeCb;
      stub.runCalls.push(sql);
      stub.sqlLog.push(sql);
      invoke(cb, null);
    },
    all(sql: string, maybeParams?: any, maybeCb?: any) {
      const cb = typeof maybeParams === 'function' ? maybeParams : maybeCb;
      invoke(cb, null, []);
    },
    close(cb?: (err: Error | null) => void) {
      stub.closed = true;
      invoke(cb, null);
    },
  };
  return stub;
}

// SYNC-3's startup crash recovery runs these AFTER migrations complete; the
// wiring tests below pin both the set and the ordering.
const RECOVERY_STATEMENT_PATTERNS = [
  /^UPDATE uploads SET status = 'failed'.*WHERE status = 'uploading'/,
  /^UPDATE uploads SET status = 'failed'.*WHERE status = 'pending'/,
  /^UPDATE downloads SET status = 'failed'.*WHERE status IN \('downloading', 'queued', 'pending'\)/,
  /^UPDATE drive_metadata_cache SET syncStatus = 'pending'.*WHERE syncStatus IN \('downloading', 'queued'\)/,
];

function expectRecoveryStatements(runCalls: string[]): void {
  expect(runCalls).toHaveLength(RECOVERY_STATEMENT_PATTERNS.length);
  RECOVERY_STATEMENT_PATTERNS.forEach((pattern, i) => {
    expect(runCalls[i]).toMatch(pattern);
  });
}

function managerWithStub(stub: ReturnType<typeof createCapturingStub>): DatabaseManager {
  sqlite3DbHolder.current = stub;
  const dm = new DatabaseManager();
  // Pre-inject like the sibling suites: the mocked Database constructor
  // invokes its callback synchronously, before initialize() finishes the
  // `this.db =` assignment.
  (dm as any).db = stub;
  return dm;
}

describe('initialize() wiring (capturing stub)', () => {
  it('runs every pending migration in order — BEGIN IMMEDIATE, sql, version stamp, COMMIT — before the DB is ready', async () => {
    const stub = createCapturingStub({ userVersion: 0 });
    const dm = managerWithStub(stub);

    await dm.initialize();

    const expected = MIGRATIONS.flatMap((m) => [
      'BEGIN IMMEDIATE',
      m.sql,
      `PRAGMA user_version = ${m.version}`,
      'COMMIT',
    ]);
    expect(stub.execCalls).toEqual(expected);
    // Pins the shipped versions: baseline v3 then the later migrations, ending
    // at the current version (the last stamp before the final COMMIT).
    expect(stub.execCalls).toContain('PRAGMA user_version = 3');
    expect(stub.execCalls[stub.execCalls.length - 2]).toBe(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    expect((dm as any).db).toBe(stub); // ready
  });

  it('runs SYNC-3 crash recovery strictly AFTER the final version stamp and COMMIT (combined initialize() contract)', async () => {
    // The INFRA-7 + SYNC-3 merge relies on this ordering: recovery UPDATEs
    // reference status columns/values whose shape belongs to the migrated
    // schema, so they must never execute against a not-yet-migrated (or
    // refused) database. Pin it so it can't silently invert.
    const stub = createCapturingStub({ userVersion: 0 });
    const dm = managerWithStub(stub);

    await dm.initialize();

    // All four recovery statements ran, exactly once each, via run().
    expectRecoveryStatements(stub.runCalls);

    // Ordering in the unified statement log: the LAST migration statement
    // (final COMMIT, preceded by the v4 stamp) comes before the FIRST
    // recovery statement.
    const lastCommitIdx = stub.sqlLog.lastIndexOf('COMMIT');
    const stampIdx = stub.sqlLog.indexOf(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
    const firstRecoveryIdx = stub.sqlLog.findIndex((sql) =>
      RECOVERY_STATEMENT_PATTERNS[0].test(sql)
    );
    expect(stampIdx).toBeGreaterThan(-1);
    expect(firstRecoveryIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeLessThan(lastCommitIdx);
    expect(lastCommitIdx).toBeLessThan(firstRecoveryIdx);
    // Nothing migration-shaped after recovery starts (no interleaving).
    expect(stub.sqlLog.slice(firstRecoveryIdx)).toHaveLength(
      RECOVERY_STATEMENT_PATTERNS.length
    );
  });

  it('runs no migration statements when the DB is already at the current version (recovery still runs)', async () => {
    const stub = createCapturingStub({ userVersion: CURRENT_SCHEMA_VERSION });
    const dm = managerWithStub(stub);

    await dm.initialize();

    // Migration channel (exec) is silent — nothing to migrate...
    expect(stub.execCalls).toEqual([]);
    // ...but SYNC-3 startup recovery still runs, and ONLY recovery.
    expectRecoveryStatements(stub.runCalls);
    expect((dm as any).db).toBe(stub);
  });

  it('refuses a future-version DB: rejects with a clear error, executes nothing, closes the handle', async () => {
    const stub = createCapturingStub({ userVersion: 99 });
    const dm = managerWithStub(stub);

    await expect(dm.initialize()).rejects.toThrow(
      /schema version 99.*only supports up to version 9.*update ArDrive Desktop/i
    );

    expect(stub.execCalls).toEqual([]); // data never touched
    expect(stub.runCalls).toEqual([]); // recovery never reached either
    expect(stub.closed).toBe(true);
    expect((dm as any).db).toBeNull(); // fail closed — DB is NOT ready
  });

  it('surfaces a failed migration: ROLLBACK issued, initialize rejects, handle closed', async () => {
    const stub = createCapturingStub({
      userVersion: 0,
      failOnSql: (sql) => sql === MIGRATIONS[1].sql,
    });
    const dm = managerWithStub(stub);

    await expect(dm.initialize()).rejects.toThrow(/failed and was rolled back/);

    expect(stub.execCalls).toEqual([
      'BEGIN IMMEDIATE',
      MIGRATIONS[0].sql,
      'PRAGMA user_version = 3',
      'COMMIT',
      'BEGIN IMMEDIATE',
      MIGRATIONS[1].sql,
      'ROLLBACK',
    ]);
    expect(stub.runCalls).toEqual([]); // recovery never runs on a failed migration
    expect(stub.closed).toBe(true);
    expect((dm as any).db).toBeNull();
  });

  it('rejects a mis-ordered migration list before touching the database (framework self-check)', async () => {
    const stub = createCapturingStub({ userVersion: 0 });
    const dm = managerWithStub(stub);

    const outOfOrder: Migration[] = [
      { version: 4, description: 'later', sql: 'SELECT 1;' },
      { version: 3, description: 'earlier', sql: 'SELECT 1;' },
    ];
    await expect((dm as any).runMigrations(outOfOrder)).rejects.toThrow(
      /not strictly ascending/
    );
    expect(stub.execCalls).toEqual([]);
  });
});
