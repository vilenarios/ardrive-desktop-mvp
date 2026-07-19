// Versioned schema migrations for ArDrive Desktop databases (INFRA-7).
//
// This file is the single source of truth for the database schema. Fresh
// databases and existing ones take the same path: DatabaseManager's
// migration runner applies every migration whose version is greater than
// the database's current `PRAGMA user_version`, each inside its own
// transaction, stamping `user_version` as part of that transaction (SQLite
// stores user_version in the database header, so a rollback reverts the
// stamp together with the schema changes — a failed migration leaves the
// database exactly at its prior version).
//
// Version history:
//   0  — fresh (empty) database, OR a legacy database created by the
//        pre-INFRA-7 `createTables()` path, which never stamped a version.
//        The v3 baseline below is the v3 schema DDL verbatim and uses
//        IF NOT EXISTS throughout, so it no-ops losslessly on those legacy
//        v3 databases and creates everything on fresh ones. Databases older
//        than the v3 shape (pre-multi-drive dev databases) were already
//        unsupported by the released createTables() code and remain so.
//   3  — baseline: the full schema as shipped before this framework existed.
//   4  — composite index for drive_metadata_cache status lookups
//        (getFilesByStatus: WHERE mappingId = ? AND syncStatus = ?).
//   5  — isHidden column on drive_metadata_cache (SYNC-5): reflects ArFS
//        hidden state (local delete → hide) in the Permaweb view. Preserved
//        across metadata re-syncs (the upsert's DO UPDATE SET omits it), and
//        reconciled against core truth on a forced refresh.
//   6  — sync_state table (D-026): persists ardrive-core-js's serialized
//        DriveSyncState per drive so an unchanged re-sync fetches only the
//        delta since the last synced block (incremental delta-resync).
//   7  — add 'failed' to drive_metadata_cache.syncStatus's CHECK set (SYNC-16).
//        Live download/sync code writes syncStatus='failed' (DownloadManager,
//        sync-manager), but the v3 CHECK omitted it, so those UPDATEs THREW on
//        a real SQLite DB (invisible under mocked tests) and the failed state
//        was never persisted. SQLite cannot ALTER a CHECK in place, so this
//        rebuilds the table (create-new → copy → drop → rename → recreate
//        indexes) — the standard SQLite "changing a CHECK" procedure. Lossless:
//        the new allowed set is a strict superset of the old, and no pre-v7 row
//        could ever have held 'failed' (the old CHECK rejected it).
//   9  — index on processed_files.localPath (SYNC-10): the per-file-event
//        dedup/edit-detection lookups in sync-manager.ts and DownloadManager.ts
//        query processed_files by localPath (in addition to the already-indexed
//        fileHash) once per sync/download event. Without this index that side
//        of the lookup was a full-table scan.
//
// Rules for adding a migration:
//   - NEVER edit an existing migration (databases in the wild have already
//     run it) — append a new one with the next version number.
//   - Keep each migration self-contained SQL. Do NOT include BEGIN/COMMIT;
//     the runner owns transaction boundaries.
//   - Bump CURRENT_SCHEMA_VERSION to match the last migration's version.

export interface Migration {
  /** The schema version this migration brings the database up to. */
  version: number;
  description: string;
  /** SQL executed inside a single transaction. No BEGIN/COMMIT inside. */
  sql: string;
}

// v3 baseline — createTables() DDL verbatim (do not edit; append migrations).
const BASELINE_V3_SQL = `
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

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 3,
    description: 'baseline schema (pre-framework v3)',
    sql: BASELINE_V3_SQL,
  },
  {
    version: 4,
    description:
      'composite index for drive_metadata_cache status lookups (getFilesByStatus)',
    sql: `
          CREATE INDEX IF NOT EXISTS idx_metadata_mapping_sync_status ON drive_metadata_cache(mappingId, syncStatus);
`,
  },
  {
    version: 5,
    description:
      'isHidden column on drive_metadata_cache (SYNC-5 delete->ArFS hide)',
    sql: `
          ALTER TABLE drive_metadata_cache ADD COLUMN isHidden BOOLEAN DEFAULT 0;
`,
  },
  {
    version: 6,
    description:
      'sync_state table for incremental delta-resync (D-026): drive_id PK + serialized DriveSyncState',
    sql: `
          CREATE TABLE IF NOT EXISTS sync_state (
            drive_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
`,
  },
  {
    version: 7,
    description:
      "add 'failed' to drive_metadata_cache.syncStatus CHECK set (SYNC-16) via table rebuild",
    // SQLite cannot ALTER a CHECK constraint in place, so this follows the
    // standard "changing a CHECK" recipe: build a new table with the widened
    // CHECK, copy every row, drop the old table, rename the new one into place,
    // and recreate all of drive_metadata_cache's indexes (DROP TABLE drops
    // them). foreign_keys is never enabled on these connections (SQLite default
    // OFF), and nothing references drive_metadata_cache, so the drop/rename is
    // safe. The column list below is the v3 baseline PLUS v5's additive
    // isHidden column — i.e. the table's shape at v6 — so the rebuild is
    // lossless. The only change versus v6 is the extra 'failed' literal in the
    // syncStatus CHECK.
    sql: `
          CREATE TABLE drive_metadata_cache_new (
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
            syncStatus TEXT DEFAULT 'pending' CHECK (syncStatus IN ('synced', 'pending', 'downloading', 'queued', 'cloud_only', 'error', 'failed')),
            syncPreference TEXT DEFAULT 'auto' CHECK (syncPreference IN ('auto', 'cloud_only')),
            downloadPriority INTEGER DEFAULT 0,
            lastError TEXT,
            isHidden BOOLEAN DEFAULT 0,
            FOREIGN KEY (mappingId) REFERENCES drive_mappings(id) ON DELETE CASCADE
          );

          INSERT INTO drive_metadata_cache_new (
            id, mappingId, fileId, parentFolderId, name, path, type, size,
            lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash,
            lastSyncedAt, localPath, localFileExists, syncStatus, syncPreference,
            downloadPriority, lastError, isHidden
          )
          SELECT
            id, mappingId, fileId, parentFolderId, name, path, type, size,
            lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash,
            lastSyncedAt, localPath, localFileExists, syncStatus, syncPreference,
            downloadPriority, lastError, isHidden
          FROM drive_metadata_cache;

          DROP TABLE drive_metadata_cache;

          ALTER TABLE drive_metadata_cache_new RENAME TO drive_metadata_cache;

          CREATE INDEX IF NOT EXISTS idx_metadata_mapping ON drive_metadata_cache(mappingId);
          CREATE INDEX IF NOT EXISTS idx_metadata_parent ON drive_metadata_cache(parentFolderId);
          CREATE INDEX IF NOT EXISTS idx_metadata_path ON drive_metadata_cache(path);
          CREATE INDEX IF NOT EXISTS idx_metadata_fileId ON drive_metadata_cache(fileId);
          CREATE INDEX IF NOT EXISTS idx_metadata_mapping_sync_status ON drive_metadata_cache(mappingId, syncStatus);
`,
  },
  {
    version: 8,
    description:
      "errorReason column on uploads (MONEY-17): first-class 'insufficient_funds' marker for a recoverable, auto-resumable out-of-funds/quota rejection",
    // Additive nullable column (like v5's isHidden). Existing rows default to
    // NULL — i.e. no recovery reason — which is correct: a pre-MONEY-17 failed
    // row is a generic terminal failure, not a paused-for-credits one. Only rows
    // whose upload was rejected for funds/quota carry 'insufficient_funds', which
    // the resume trigger keys off. No CHECK (uploads.status itself is un-CHECKed
    // pending INFRA-7; a free-text reason column matches that and avoids a
    // table rebuild).
    sql: `
          ALTER TABLE uploads ADD COLUMN errorReason TEXT;
`,
  },
  {
    version: 9,
    description:
      'index on processed_files.localPath (SYNC-10): per-file-event dedup/edit-detection lookups are indexed, not full-table scans',
    sql: `
          CREATE INDEX IF NOT EXISTS idx_processed_files_localpath ON processed_files(localPath);
`,
  },
];

// Derived from the list so it can never drift from the migrations actually
// shipped (the pre-INFRA-7 `currentSchemaVersion = 3` field was exactly that
// kind of decorative constant — nothing read it).
export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
