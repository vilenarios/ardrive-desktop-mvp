import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import { app } from 'electron';
import { FileUpload, PendingUpload, FileDownload, DriveSyncMapping, DriveSyncStatus } from '../types';
import { profileManager } from './profile-manager';
import { MIGRATIONS, CURRENT_SCHEMA_VERSION, Migration } from './migrations';
import * as crypto from 'crypto';

export class DatabaseManager {
  private db: sqlite3.Database | null = null;
  private currentProfileId: string | null = null;

  constructor() {
    // Database path will be determined dynamically based on active profile
  }

  private getDbPath(): string {
    if (!this.currentProfileId) {
      // Fallback to global database for backwards compatibility
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'ardrive.db');
    }
    return profileManager.getProfileStoragePath(this.currentProfileId, 'data.db');
  }

  async setActiveProfile(profileId: string | null): Promise<void> {
    // Close current database if open
    if (this.db) {
      await this.close();
    }
    
    this.currentProfileId = profileId;
    
    // Initialize database for new profile
    if (profileId) {
      await this.initialize();
    }
  }

  async initialize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const dbPath = this.getDbPath();
      console.log(`DatabaseManager - initializing database at: ${dbPath}`);
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Migrations must complete before the database is considered ready.
        // Fail closed: on any migration error, close the handle so no query
        // can run against a database in an unknown/newer schema state.
        this.runMigrations().then(resolve).catch((migrationError) => {
          const failedDb = this.db;
          this.db = null;
          if (failedDb) {
            failedDb.close(() => reject(migrationError));
          } else {
            reject(migrationError);
          }
        });
      });
    });
    
    // SYNC-3: crash recovery — rows stuck in transient states from a killed
    // process must never stay stuck.
    await this.recoverInterruptedOperations();
  }

  /**
   * SYNC-3: reset rows left in transient states by a crash/kill.
   *
   * - uploads stuck 'uploading' become terminal 'failed' with an honest
   *   message: the network call may or may not have completed on Arweave, so
   *   blindly re-queueing could pay for the same file twice. The user
   *   retries deliberately via uploads:retry (admission-guarded by MONEY-2).
   * - uploads stuck 'pending' (approved and queued in the memory-only queue,
   *   never started) also become 'failed' with a never-charged message —
   *   otherwise they are unreachable forever (qa-gate finding: retry-all
   *   only consumes 'failed', and the watcher dedup blocks re-detection).
   * - downloads stuck 'downloading' become 'failed' (free to redo).
   * - drive metadata syncStatus stuck 'downloading'/'queued' resets to
   *   'pending', which the boot sync flow re-queues automatically.
   *
   * Returns counts for observability/tests.
   */
  async recoverInterruptedOperations(): Promise<{
    uploadsReset: number;
    downloadsReset: number;
    metadataReset: number;
  }> {
    const run = (sql: string, params: unknown[] = []): Promise<number> =>
      new Promise((resolve, reject) => {
        this.db!.run(sql, params, function (this: { changes?: number } | undefined, err: Error | null) {
          if (err) reject(err);
          // sqlite3 binds a RunResult as `this`; be defensive for callers
          // (and test stubs) that invoke the callback unbound.
          else resolve(this?.changes ?? 0);
        });
      });

    const interruptedUploadMessage =
      'Interrupted by app shutdown mid-upload — the file may or may not have reached Arweave; verify before retrying';

    const uploadsReset = await run(
      `UPDATE uploads SET status = 'failed', error = ? WHERE status = 'uploading'`,
      [interruptedUploadMessage]
    );

    const pendingUploadsReset = await run(
      `UPDATE uploads SET status = 'failed', error = 'Interrupted before starting — nothing was charged; use Retry to re-queue' WHERE status = 'pending'`
    );

    const downloadsReset = await run(
      `UPDATE downloads SET status = 'failed', error = 'Interrupted by app shutdown' WHERE status IN ('downloading', 'queued', 'pending')`
    );

    const metadataReset = await run(
      `UPDATE drive_metadata_cache SET syncStatus = 'pending', lastError = NULL WHERE syncStatus IN ('downloading', 'queued')`
    );

    if (uploadsReset || pendingUploadsReset || downloadsReset || metadataReset) {
      console.log(
        `DatabaseManager - crash recovery: ${uploadsReset} in-flight uploads -> failed (verify-before-retry), ` +
        `${pendingUploadsReset} queued uploads -> failed (never charged), ` +
        `${downloadsReset} downloads -> failed, ${metadataReset} metadata rows -> pending`
      );
    }

    return { uploadsReset: uploadsReset + pendingUploadsReset, downloadsReset, metadataReset };
  }

  /**
   * Versioned schema migration runner (INFRA-7).
   *
   * The schema version lives in SQLite's `PRAGMA user_version` (stored in
   * the database file header). Every migration in migrations.ts with a
   * version greater than the database's current version runs in order, each
   * inside its own IMMEDIATE transaction; the version stamp is written
   * inside that same transaction, so a failed migration rolls back
   * completely and leaves the database at its prior version (fail closed —
   * never a half-migrated database).
   *
   * A database stamped NEWER than this build supports is refused without
   * being touched: writing to it could corrupt data created by a newer app.
   *
   * @param migrations overridable for tests; production uses MIGRATIONS.
   */
  private async runMigrations(migrations: readonly Migration[] = MIGRATIONS): Promise<void> {
    // Sanity-check the migration list itself: strictly ascending versions.
    for (let i = 1; i < migrations.length; i++) {
      if (migrations[i].version <= migrations[i - 1].version) {
        throw new Error(
          `Migration list is not strictly ascending at index ${i} (v${migrations[i].version})`
        );
      }
    }

    const currentVersion = await this.getSchemaVersion();
    const targetVersion = migrations.length > 0
      ? migrations[migrations.length - 1].version
      : CURRENT_SCHEMA_VERSION;

    if (currentVersion > targetVersion) {
      throw new Error(
        `This database uses schema version ${currentVersion}, but this version of ArDrive Desktop only supports up to version ${targetVersion}. ` +
        'It was likely created by a newer version of the app. Please update ArDrive Desktop to open this profile.'
      );
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) {
        continue;
      }
      await this.applyMigration(migration);
    }
  }

  /** Reads the schema version from the SQLite header (0 = fresh or legacy pre-framework DB). */
  private async getSchemaVersion(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db!.get('PRAGMA user_version', (err, row: { user_version?: number } | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(row?.user_version ?? 0);
        }
      });
    });
  }

  /** Applies one migration atomically: BEGIN IMMEDIATE → sql → version stamp → COMMIT, ROLLBACK on any failure. */
  private async applyMigration(migration: Migration): Promise<void> {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Invalid migration version: ${migration.version}`);
    }

    const db = this.db!;
    const exec = (sql: string) =>
      new Promise<void>((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
      });

    console.log(
      `DatabaseManager - applying schema migration v${migration.version} (${migration.description})`
    );

    await exec('BEGIN IMMEDIATE');
    try {
      await exec(migration.sql);
      // Stamped inside the transaction: user_version lives in the database
      // header, so ROLLBACK reverts it together with the schema changes.
      await exec(`PRAGMA user_version = ${migration.version}`);
      await exec('COMMIT');
      console.log(`DatabaseManager - schema migrated to v${migration.version}`);
    } catch (error) {
      await exec('ROLLBACK').catch((rollbackError) => {
        console.error(
          'DatabaseManager - ROLLBACK after failed migration also failed:',
          rollbackError
        );
      });
      throw new Error(
        `Database migration to schema v${migration.version} (${migration.description}) failed and was rolled back: ` +
        `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async addUpload(upload: Omit<FileUpload, 'createdAt'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO uploads (id, mappingId, driveId, localPath, fileName, fileSize, status, progress, uploadMethod, transactionId, dataTxId, metadataTxId, fileId, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        upload.id,
        null, // mappingId is deprecated
        upload.driveId,
        upload.localPath,
        upload.fileName,
        upload.fileSize,
        upload.status,
        upload.progress,
        upload.uploadMethod,
        upload.transactionId,
        upload.dataTxId,
        upload.metadataTxId,
        upload.fileId,
        upload.error
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateUpload(id: string, updates: Partial<FileUpload>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    return new Promise((resolve, reject) => {
      const sql = `UPDATE uploads SET ${fields} WHERE id = ?`;
      
      this.db!.run(sql, [...values, id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getUploads(): Promise<FileUpload[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM uploads 
        ORDER BY createdAt DESC
      `;
      
      this.db!.all(sql, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const uploads = rows.map(row => ({
            ...row,
            createdAt: new Date(row.createdAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          }));
          resolve(uploads);
        }
      });
    });
  }

  async getUploadsByStatus(status: string): Promise<FileUpload[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM uploads 
        WHERE status = ?
        ORDER BY createdAt DESC
      `;
      
      this.db!.all(sql, [status], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const uploads = rows.map(row => ({
            ...row,
            createdAt: new Date(row.createdAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          }));
          resolve(uploads);
        }
      });
    });
  }

  // Pending Upload Management
  async addPendingUpload(upload: Omit<PendingUpload, 'createdAt'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO pending_uploads (
          id, localPath, fileName, fileSize, estimatedCost, estimatedTurboCost, 
          recommendedMethod, hasSufficientTurboBalance, conflictType, conflictDetails, 
          status, operationType, previousPath, arfsFileId, arfsFolderId, metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        upload.id,
        upload.localPath,
        upload.fileName,
        upload.fileSize,
        upload.estimatedCost,
        upload.estimatedTurboCost,
        upload.recommendedMethod,
        upload.hasSufficientTurboBalance,
        upload.conflictType || 'none',
        upload.conflictDetails,
        upload.status,
        upload.operationType || 'upload',
        upload.previousPath || null,
        upload.arfsFileId || null,
        upload.arfsFolderId || null,
        upload.metadata ? JSON.stringify(upload.metadata) : null
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getPendingUploads(): Promise<PendingUpload[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM pending_uploads 
        WHERE status = 'awaiting_approval'
        ORDER BY createdAt DESC
      `;
      
      this.db!.all(sql, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          // Normalize raw sqlite3 scalars to the PendingUpload TS shape at the
          // DB boundary (MONEY-3): BOOLEAN columns come back as 0/1 integers
          // and empty optional columns as NULL. Renderer cost display must
          // never have to reason about raw DB scalars (a `0` truthy-passing
          // `!== false` once classified no-quote files as 0-credit Turbo).
          const uploads = rows.map(row => ({
            ...row,
            hasSufficientTurboBalance: !!row.hasSufficientTurboBalance,
            estimatedTurboCost: row.estimatedTurboCost ?? null,
            recommendedMethod: row.recommendedMethod ?? undefined,
            conflictDetails: row.conflictDetails ?? undefined,
            previousPath: row.previousPath ?? undefined,
            arfsFileId: row.arfsFileId ?? undefined,
            arfsFolderId: row.arfsFolderId ?? undefined,
            createdAt: new Date(row.createdAt),
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
          }));

          // Sort uploads to ensure proper order for folder structure
          const sortedUploads = this.sortPendingUploadsForFolderStructure(uploads);
          resolve(sortedUploads);
        }
      });
    });
  }
  
  private sortPendingUploadsForFolderStructure(uploads: PendingUpload[]): PendingUpload[] {
    // Separate folders and files
    const folders = uploads.filter(u => u.fileName.endsWith('/'));
    const files = uploads.filter(u => !u.fileName.endsWith('/'));
    
    // Sort folders by path depth (parent folders first)
    folders.sort((a, b) => {
      const depthA = (a.localPath.match(/[/\\]/g) || []).length;
      const depthB = (b.localPath.match(/[/\\]/g) || []).length;
      
      // First sort by depth (shallower paths first)
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      
      // Then sort alphabetically within same depth
      return a.localPath.localeCompare(b.localPath);
    });
    
    // Sort files by path to group them with their parent folders
    files.sort((a, b) => {
      const dirA = path.dirname(a.localPath);
      const dirB = path.dirname(b.localPath);
      
      // First sort by directory
      if (dirA !== dirB) {
        return dirA.localeCompare(dirB);
      }
      
      // Then by filename within directory
      return a.fileName.localeCompare(b.fileName);
    });
    
    // Return folders first, then files
    return [...folders, ...files];
  }

  async updatePendingUploadStatus(id: string, status: 'approved' | 'rejected'): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE pending_uploads SET status = ? WHERE id = ?`;
      
      this.db!.run(sql, [status, id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updatePendingUpload(id: string, updates: Partial<PendingUpload>): Promise<void> {
    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    return new Promise((resolve, reject) => {
      const sql = `UPDATE pending_uploads SET ${fields} WHERE id = ?`;
      
      this.db!.run(sql, [...values, id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async removePendingUpload(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM pending_uploads WHERE id = ?`;
      
      this.db!.run(sql, [id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async clearAllPendingUploads(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM pending_uploads`;
      
      this.db!.run(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Processed Files Management
  async addProcessedFile(
    fileHash: string, 
    fileName: string, 
    fileSize: number, 
    localPath: string, 
    source: 'download' | 'upload',
    arweaveId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // CRITICAL: Use INSERT OR IGNORE to prevent overwriting download entries with upload entries
      // This ensures that if a file was downloaded, it remains marked as 'download' source
      const sql = `
        INSERT OR IGNORE INTO processed_files (fileHash, fileName, fileSize, localPath, source, arweaveId)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [fileHash, fileName, fileSize, localPath, source, arweaveId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async isFileProcessed(fileHash: string, mappingId?: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Add mappingId filtering to prevent cross-profile data access
      let sql = `SELECT 1 FROM processed_files WHERE fileHash = ?`;
      const params: any[] = [fileHash];
      
      if (mappingId) {
        sql += ` AND mappingId = ?`;
        params.push(mappingId);
      } else {
        // For legacy compatibility, filter by current profile's mappings
        sql += ` AND mappingId IN (SELECT id FROM drive_mappings)`;
      }
      
      sql += ` LIMIT 1`;
      
      this.db!.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      });
    });
  }

  async getProcessedFiles(): Promise<Array<{
    fileHash: string;
    fileName: string;
    fileSize: number;
    localPath: string;
    source: 'download' | 'upload';
    arweaveId?: string;
    processedAt: Date;
  }>> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM processed_files ORDER BY processedAt DESC`;
      
      this.db!.all(sql, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const files = rows.map(row => ({
            ...row,
            processedAt: new Date(row.processedAt)
          }));
          resolve(files);
        }
      });
    });
  }

  async removeProcessedFile(fileHash: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM processed_files WHERE fileHash = ?`;
      
      this.db!.run(sql, [fileHash], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateProcessedFileSource(fileHash: string, newSource: 'download' | 'upload'): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE processed_files SET source = ? WHERE fileHash = ?`;
      
      this.db!.run(sql, [newSource, fileHash], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // File Version Management
  async addFileVersion(version: {
    id: string;
    fileHash: string;
    fileName: string;
    filePath: string;
    relativePath: string;
    fileSize: number;
    arweaveId?: string;
    turboId?: string;
    version: number;
    parentVersion?: string;
    changeType: 'create' | 'update' | 'rename' | 'move';
    uploadMethod?: 'ar' | 'turbo';
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      // First, mark any existing versions as not latest
      const updateSql = `UPDATE file_versions SET isLatest = 0 WHERE filePath = ? AND isLatest = 1`;
      
      this.db!.run(updateSql, [version.filePath], (updateErr) => {
        if (updateErr) {
          reject(updateErr);
          return;
        }
        
        // Insert new version
        const insertSql = `
          INSERT INTO file_versions (id, fileHash, fileName, filePath, relativePath, fileSize, arweaveId, turboId, version, parentVersion, changeType, uploadMethod, isLatest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `;
        
        this.db!.run(insertSql, [
          version.id,
          version.fileHash,
          version.fileName,
          version.filePath,
          version.relativePath,
          version.fileSize,
          version.arweaveId,
          version.turboId,
          version.version,
          version.parentVersion,
          version.changeType,
          version.uploadMethod
        ], (insertErr) => {
          if (insertErr) {
            reject(insertErr);
          } else {
            resolve();
          }
        });
      });
    });
  }

  async getFileVersions(filePath: string, mappingId?: string): Promise<Array<{
    id: string;
    fileHash: string;
    fileName: string;
    filePath: string;
    relativePath: string;
    fileSize: number;
    arweaveId?: string;
    turboId?: string;
    version: number;
    parentVersion?: string;
    changeType: string;
    uploadMethod?: string;
    createdAt: Date;
    isLatest: boolean;
  }>> {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Add mappingId filtering to prevent cross-profile data access
      let sql = `SELECT * FROM file_versions WHERE filePath = ?`;
      const params: any[] = [filePath];
      
      if (mappingId) {
        sql += ` AND mappingId = ?`;
        params.push(mappingId);
      } else {
        // For legacy compatibility, filter by current profile's mappings
        sql += ` AND mappingId IN (SELECT id FROM drive_mappings)`;
      }
      
      sql += ` ORDER BY version DESC`;
      
      this.db!.all(sql, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const versions = rows.map(row => ({
            ...row,
            isLatest: !!row.isLatest,
            createdAt: new Date(row.createdAt)
          }));
          resolve(versions);
        }
      });
    });
  }

  async getLatestFileVersion(filePath: string, mappingId?: string): Promise<{
    id: string;
    fileHash: string;
    fileName: string;
    filePath: string;
    relativePath: string;
    fileSize: number;
    arweaveId?: string;
    turboId?: string;
    version: number;
    parentVersion?: string;
    changeType: string;
    uploadMethod?: string;
    createdAt: Date;
    isLatest: boolean;
  } | null> {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Add mappingId filtering to prevent cross-profile data access
      let sql = `SELECT * FROM file_versions WHERE filePath = ? AND isLatest = 1`;
      const params: any[] = [filePath];
      
      if (mappingId) {
        sql += ` AND mappingId = ?`;
        params.push(mappingId);
      } else {
        // For legacy compatibility, filter by current profile's mappings
        sql += ` AND mappingId IN (SELECT id FROM drive_mappings)`;
      }
      
      sql += ` LIMIT 1`;
      
      this.db!.get(sql, params, (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ...row,
            isLatest: !!row.isLatest,
            createdAt: new Date(row.createdAt)
          });
        }
      });
    });
  }

  /**
   * SYNC-28: Back-fill the on-chain data-tx id onto the file_versions row that
   * createNewVersion wrote at QUEUE time (before the upload existed, so its
   * arweaveId/turboId were null). Called from processUploadResult once the
   * data-tx id is known — this is what lets the version-history UI (FEAT-6)
   * link View/Download to an actual transaction.
   *
   * WHICH ROW (clobber-safety): targets the isLatest = 1 row for this filePath
   * whose tx-id columns are BOTH still null. Consequences:
   *   - It can only ever touch the CURRENT latest version, never a demoted
   *     older revision (isLatest = 0) — so an older revision's tx id can never
   *     be overwritten.
   *   - The `arweaveId IS NULL AND turboId IS NULL` guard makes a repeat call
   *     (e.g. the retry path re-entering processUploadResult) a no-op instead
   *     of rewriting an already-populated row.
   * Rows are scoped by filePath (an absolute local path unique to a mapping
   * within a profile) inside the active profile's isolated DB, so no
   * cross-mapping/cross-profile clobber is possible.
   *
   * Assumption (documented, SYNC-28): the version a given upload corresponds
   * to is the latest not-yet-populated row for its filePath. There is no
   * persisted upload->version link, so in the rare interleaving where a second
   * edit mints version N+1 before version N's upload result is processed, N's
   * tx id would land on N+1's row. In practice the approval queue processes an
   * upload before the next edit's version row is created, so this holds.
   *
   * The column written matches the payment rail: 'turbo' -> turboId,
   * 'ar' -> arweaveId; uploadMethod is set alongside so the row is internally
   * consistent (the UI reads the column matching uploadMethod).
   *
   * @returns true if a row was updated, false if there was no matching
   *          unpopulated latest row.
   */
  async updateFileVersionTxId(
    filePath: string,
    txId: string,
    options: { method: 'ar' | 'turbo' }
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // `column` is derived from a fixed ternary, never user input — no injection.
      const column = options.method === 'turbo' ? 'turboId' : 'arweaveId';
      const sql = `
        UPDATE file_versions
        SET ${column} = ?, uploadMethod = ?
        WHERE filePath = ?
          AND isLatest = 1
          AND arweaveId IS NULL
          AND turboId IS NULL
      `;

      this.db!.run(sql, [txId, options.method, filePath], function (err) {
        if (err) {
          reject(err);
        } else {
          // sqlite3 exposes affected-row count as `this.changes` on the
          // statement context (hence the non-arrow callback).
          resolve(this.changes > 0);
        }
      });
    });
  }

  // File Operations Tracking
  async addFileOperation(operation: {
    id: string;
    fileHash: string;
    operation: 'upload' | 'download' | 'rename' | 'move' | 'delete';
    fromPath?: string;
    toPath?: string;
    metadata?: any;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO file_operations (id, fileHash, operation, fromPath, toPath, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        operation.id,
        operation.fileHash,
        operation.operation,
        operation.fromPath,
        operation.toPath,
        operation.metadata ? JSON.stringify(operation.metadata) : null
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getFileOperations(fileHash: string): Promise<Array<{
    id: string;
    fileHash: string;
    operation: string;
    fromPath?: string;
    toPath?: string;
    metadata?: any;
    timestamp: Date;
  }>> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM file_operations WHERE fileHash = ? ORDER BY timestamp DESC`;
      
      this.db!.all(sql, [fileHash], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const operations = rows.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            timestamp: new Date(row.timestamp)
          }));
          resolve(operations);
        }
      });
    });
  }

  // Folder Structure Management
  async addFolder(folder: {
    id: string;
    folderPath: string;
    relativePath: string;
    parentPath?: string;
    arfsFolderId?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO folder_structure (id, folderPath, relativePath, parentPath, arfsFolderId, isDeleted)
        VALUES (?, ?, ?, ?, ?, 0)
      `;
      
      this.db!.run(sql, [
        folder.id,
        folder.folderPath,
        folder.relativePath,
        folder.parentPath,
        folder.arfsFolderId
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getFolders(mappingId?: string): Promise<Array<{
    id: string;
    folderPath: string;
    relativePath: string;
    parentPath?: string;
    arfsFolderId?: string;
    createdAt: Date;
    isDeleted: boolean;
  }>> {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Add mappingId filtering to prevent cross-profile data access
      let sql = `SELECT * FROM folder_structure WHERE isDeleted = 0`;
      const params: any[] = [];
      
      if (mappingId) {
        sql += ` AND mappingId = ?`;
        params.push(mappingId);
      } else {
        // For legacy compatibility, filter by current profile's mappings
        sql += ` AND mappingId IN (SELECT id FROM drive_mappings)`;
      }
      
      sql += ` ORDER BY relativePath`;
      
      this.db!.all(sql, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const folders = rows.map(row => ({
            ...row,
            isDeleted: !!row.isDeleted,
            createdAt: new Date(row.createdAt)
          }));
          resolve(folders);
        }
      });
    });
  }

  async getFolderByPath(folderPath: string): Promise<{
    id: string;
    folderPath: string;
    relativePath: string;
    parentPath?: string;
    arfsFolderId?: string;
    createdAt: Date;
    isDeleted: boolean;
  } | null> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM folder_structure WHERE folderPath = ? AND isDeleted = 0 LIMIT 1`;
      
      this.db!.get(sql, [folderPath], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ...row,
            isDeleted: !!row.isDeleted,
            createdAt: new Date(row.createdAt)
          });
        }
      });
    });
  }

  async checkFolderInDriveMetadata(folderPath: string): Promise<any | null> {
    // First try exact localPath match
    const exactMatch = await new Promise<any | null>((resolve, reject) => {
      const sql = `
        SELECT * FROM drive_metadata_cache 
        WHERE localPath = ? AND type = 'folder'
        LIMIT 1
      `;
      
      this.db!.get(sql, [folderPath], (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });

    if (exactMatch) {
      return exactMatch;
    }

    // If no match on localPath, try to find by constructing the path
    const mappings = await this.getDriveMappings();
    if (mappings.length === 0) {
      return null;
    }
    
    for (const mapping of mappings) {
      const syncFolder = mapping.localFolderPath;
      if (folderPath.startsWith(syncFolder)) {
        // Extract relative path
        let relativePath = folderPath.substring(syncFolder.length);
        if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
          relativePath = relativePath.substring(1);
        }
        const parts = relativePath.replace(/\\/g, '/').split('/');
        const folderName = parts[parts.length - 1] || '';
        const parentPath = parts.slice(0, -1).join('/');
        
        // Try to find by path and name combination
        const pathMatch = await new Promise<any | null>((resolve, reject) => {
          const sql2 = `
            SELECT * FROM drive_metadata_cache 
            WHERE type = 'folder' 
            AND name = ? 
            AND path = ?
            AND mappingId = ?
            LIMIT 1
          `;
          
          this.db!.get(sql2, [folderName, parentPath, mapping.id], (err2, row2: any) => {
            if (err2) {
              reject(err2);
            } else {
              resolve(row2 || null);
            }
          });
        });

        if (pathMatch) {
          return pathMatch;
        }
      }
    }
    
    return null;
  }

  async markFolderDeleted(folderPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE folder_structure SET isDeleted = 1 WHERE folderPath = ?`;
      
      this.db!.run(sql, [folderPath], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getAllFolders(): Promise<{
    id: string;
    folderPath: string;
    relativePath: string;
    parentPath?: string;
    arfsFolderId?: string;
    createdAt: Date;
    isDeleted: boolean;
  }[]> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM folder_structure ORDER BY folderPath`;
      
      this.db!.all(sql, [], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const folders = rows.map(row => ({
            ...row,
            isDeleted: !!row.isDeleted,
            createdAt: new Date(row.createdAt)
          }));
          resolve(folders);
        }
      });
    });
  }

  async updateFolderPath(folderId: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE folder_structure SET folderPath = ?, relativePath = ? WHERE id = ?`;
      const relativePath = path.basename(newPath);
      
      this.db!.run(sql, [newPath, relativePath, folderId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateFolderArweaveId(folderId: string, arfsFolderId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE folder_structure SET arfsFolderId = ? WHERE id = ?`;
      
      this.db!.run(sql, [arfsFolderId, folderId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Downloads management
  async addDownload(download: Omit<FileDownload, 'downloadedAt'> & { priority?: number; isCancelled?: boolean }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO downloads (id, driveId, fileName, localPath, fileSize, fileId, dataTxId, metadataTxId, status, progress, priority, isCancelled, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        download.id,
        download.driveId,
        download.fileName,
        download.localPath,
        download.fileSize,
        download.fileId,
        download.dataTxId,
        download.metadataTxId,
        download.status,
        download.progress,
        download.priority || 0,
        download.isCancelled ? 1 : 0,
        download.error
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateDownload(id: string, updates: Partial<FileDownload>): Promise<void> {
    return new Promise((resolve, reject) => {
      const setClause = Object.keys(updates)
        .filter(key => key !== 'id' && key !== 'downloadedAt')
        .map(key => `${key} = ?`)
        .join(', ');
      
      if (setClause === '') {
        resolve();
        return;
      }

      let sql = `UPDATE downloads SET ${setClause}`;
      const values = Object.entries(updates)
        .filter(([key]) => key !== 'id' && key !== 'downloadedAt')
        .map(([, value]) => value);

      if (updates.status === 'completed') {
        sql += ', completedAt = CURRENT_TIMESTAMP';
      }

      sql += ' WHERE id = ?';
      values.push(id);

      this.db!.run(sql, values, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getDownloads(): Promise<FileDownload[]> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM downloads ORDER BY downloadedAt DESC`;
      
      this.db!.all(sql, [], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const downloads = rows.map(row => ({
            ...row,
            downloadedAt: new Date(row.downloadedAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          }));
          resolve(downloads);
        }
      });
    });
  }

  async getDownloadByFileId(fileId: string): Promise<FileDownload | null> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM downloads WHERE fileId = ? ORDER BY downloadedAt DESC LIMIT 1`;
      
      this.db!.get(sql, [fileId], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (row) {
          const download = {
            ...row,
            downloadedAt: new Date(row.downloadedAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          };
          resolve(download);
        } else {
          resolve(null);
        }
      });
    });
  }

  async getDownloadByPath(localPath: string): Promise<FileDownload | null> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM downloads WHERE localPath = ? ORDER BY downloadedAt DESC LIMIT 1`;
      
      this.db!.get(sql, [localPath], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (row) {
          const download = {
            ...row,
            downloadedAt: new Date(row.downloadedAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          };
          resolve(download);
        } else {
          resolve(null);
        }
      });
    });
  }

  async cancelDownload(downloadId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE downloads 
        SET isCancelled = 1, status = 'failed', error = 'Cancelled by user', completedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `;
      
      this.db!.run(sql, [downloadId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getQueuedDownloads(mappingId?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let sql = `
        SELECT * FROM downloads 
        WHERE status IN ('downloading', 'pending') AND isCancelled = 0
        ORDER BY priority DESC, fileSize ASC
      `;
      let params: any[] = [];
      
      if (mappingId) {
        sql = `
          SELECT * FROM downloads 
          WHERE mappingId = ? AND status IN ('downloading', 'pending') AND isCancelled = 0
          ORDER BY priority DESC, fileSize ASC
        `;
        params = [mappingId];
      }
      
      this.db!.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Drive Mapping Management
  async addDriveMapping(mapping: Omit<DriveSyncMapping, 'createdAt' | 'updatedAt'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO drive_mappings (
          id, driveId, driveName, drivePrivacy, localFolderPath, rootFolderId, 
          isActive, excludePatterns, maxFileSize, syncDirection, uploadPriority
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        mapping.id,
        mapping.driveId,
        mapping.driveName,
        mapping.drivePrivacy,
        mapping.localFolderPath,
        mapping.rootFolderId,
        mapping.isActive ? 1 : 0,
        mapping.syncSettings?.excludePatterns ? JSON.stringify(mapping.syncSettings.excludePatterns) : null,
        mapping.syncSettings?.maxFileSize || null,
        mapping.syncSettings?.syncDirection || 'bidirectional',
        mapping.syncSettings?.uploadPriority || 0
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getDriveMappings(): Promise<DriveSyncMapping[]> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM drive_mappings ORDER BY createdAt ASC`;
      
      this.db!.all(sql, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const mappings = rows.map(row => ({
            id: row.id,
            driveId: row.driveId,
            driveName: row.driveName,
            drivePrivacy: row.drivePrivacy,
            localFolderPath: row.localFolderPath,
            rootFolderId: row.rootFolderId,
            isActive: Boolean(row.isActive),
            lastSyncTime: row.lastSyncTime ? new Date(row.lastSyncTime) : undefined,
            lastMetadataSyncAt: row.lastMetadataSyncAt ? new Date(row.lastMetadataSyncAt) : undefined,
            syncSettings: {
              excludePatterns: row.excludePatterns ? JSON.parse(row.excludePatterns) : undefined,
              maxFileSize: row.maxFileSize || undefined,
              syncDirection: row.syncDirection || 'bidirectional',
              uploadPriority: row.uploadPriority || 0
            },
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt)
          }));
          resolve(mappings);
        }
      });
    });
  }

  async updateDriveMapping(id: string, updates: Partial<DriveSyncMapping>): Promise<void> {
    return new Promise((resolve, reject) => {
      const updateFields: string[] = [];
      const values: any[] = [];
      
      if (updates.driveName !== undefined) {
        updateFields.push('driveName = ?');
        values.push(updates.driveName);
      }
      // UX-2: without this branch a folder change from Settings generated
      // `UPDATE drive_mappings SET updatedAt = CURRENT_TIMESTAMP` — the new
      // path never persisted and sync:start kept validating the old folder.
      if (updates.localFolderPath !== undefined) {
        updateFields.push('localFolderPath = ?');
        values.push(updates.localFolderPath);
      }
      if (updates.isActive !== undefined) {
        updateFields.push('isActive = ?');
        values.push(updates.isActive ? 1 : 0);
      }
      if (updates.lastSyncTime !== undefined) {
        updateFields.push('lastSyncTime = ?');
        values.push(updates.lastSyncTime?.toISOString());
      }
      if (updates.syncSettings !== undefined) {
        updateFields.push('excludePatterns = ?', 'maxFileSize = ?', 'syncDirection = ?', 'uploadPriority = ?');
        values.push(
          updates.syncSettings.excludePatterns ? JSON.stringify(updates.syncSettings.excludePatterns) : null,
          updates.syncSettings.maxFileSize || null,
          updates.syncSettings.syncDirection || 'bidirectional',
          updates.syncSettings.uploadPriority || 0
        );
      }
      
      updateFields.push('updatedAt = CURRENT_TIMESTAMP');
      values.push(id);
      
      const sql = `UPDATE drive_mappings SET ${updateFields.join(', ')} WHERE id = ?`;
      
      this.db!.run(sql, values, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async removeDriveMapping(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM drive_mappings WHERE id = ?`;
      
      this.db!.run(sql, [id], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateMetadataSyncTimestamp(mappingId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE drive_mappings SET lastMetadataSyncAt = CURRENT_TIMESTAMP WHERE id = ?`;
      
      this.db!.run(sql, [mappingId], (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Updated metadata sync timestamp for mapping ${mappingId}`);
          resolve();
        }
      });
    });
  }

  async getDriveMappingById(id: string): Promise<DriveSyncMapping | null> {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM drive_mappings WHERE id = ?`;
      
      this.db!.get(sql, [id], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          const mapping: DriveSyncMapping = {
            id: row.id,
            driveId: row.driveId,
            driveName: row.driveName,
            drivePrivacy: row.drivePrivacy,
            localFolderPath: row.localFolderPath,
            rootFolderId: row.rootFolderId,
            isActive: Boolean(row.isActive),
            lastSyncTime: row.lastSyncTime ? new Date(row.lastSyncTime) : undefined,
            lastMetadataSyncAt: row.lastMetadataSyncAt ? new Date(row.lastMetadataSyncAt) : undefined,
            syncSettings: {
              excludePatterns: row.excludePatterns ? JSON.parse(row.excludePatterns) : undefined,
              maxFileSize: row.maxFileSize || undefined,
              syncDirection: row.syncDirection || 'bidirectional',
              uploadPriority: row.uploadPriority || 0
            },
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt)
          };
          resolve(mapping);
        }
      });
    });
  }

  // Get uploads for a specific drive
  async getUploadsByDrive(driveId: string): Promise<FileUpload[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM uploads 
        WHERE driveId = ?
        ORDER BY createdAt DESC
      `;
      
      this.db!.all(sql, [driveId], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const uploads = rows.map(row => ({
            ...row,
            createdAt: new Date(row.createdAt),
            completedAt: row.completedAt ? new Date(row.completedAt) : undefined
          }));
          resolve(uploads);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('Database closed successfully');
          }
          this.db = null;
          this.currentProfileId = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Check if database is for a specific profile
  isProfileActive(profileId: string): boolean {
    return this.currentProfileId === profileId;
  }

  // Helper method for running queries that return rows
  async query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Drive metadata cache methods
  async upsertDriveMetadata(metadata: {
    mappingId: string;
    fileId: string;
    parentFolderId?: string;
    name: string;
    path: string;
    type: 'file' | 'folder';
    size?: number;
    lastModifiedDate?: number;
    dataTxId?: string;
    metadataTxId?: string;
    contentType?: string;
    fileHash?: string;
    localPath?: string;
    localFileExists?: boolean;
    syncStatus?: string;
    syncPreference?: string;
    downloadPriority?: number;
    lastError?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO drive_metadata_cache (
          id, mappingId, fileId, parentFolderId, name, path, type, size,
          lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash,
          localPath, localFileExists, syncStatus, syncPreference, downloadPriority, lastError
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fileId) DO UPDATE SET
          mappingId = excluded.mappingId,
          parentFolderId = excluded.parentFolderId,
          name = excluded.name,
          path = excluded.path,
          type = excluded.type,
          size = excluded.size,
          lastModifiedDate = excluded.lastModifiedDate,
          dataTxId = excluded.dataTxId,
          metadataTxId = excluded.metadataTxId,
          contentType = excluded.contentType,
          fileHash = excluded.fileHash,
          localPath = excluded.localPath,
          localFileExists = excluded.localFileExists,
          syncStatus = CASE 
            WHEN excluded.syncStatus IS NULL OR excluded.syncStatus = 'pending' 
            THEN COALESCE(drive_metadata_cache.syncStatus, excluded.syncStatus, 'pending')
            ELSE excluded.syncStatus 
          END,
          syncPreference = COALESCE(excluded.syncPreference, syncPreference),
          downloadPriority = COALESCE(excluded.downloadPriority, downloadPriority),
          lastError = excluded.lastError,
          lastSyncedAt = CURRENT_TIMESTAMP
      `;
      
      const id = crypto.randomUUID();
      this.db!.run(sql, [
        id,
        metadata.mappingId,
        metadata.fileId,
        metadata.parentFolderId || null,
        metadata.name,
        metadata.path,
        metadata.type,
        metadata.size || null,
        metadata.lastModifiedDate || null,
        metadata.dataTxId || null,
        metadata.metadataTxId || null,
        metadata.contentType || null,
        metadata.fileHash || null,
        metadata.localPath || null,
        metadata.localFileExists ? 1 : 0,
        metadata.syncStatus || 'pending',
        metadata.syncPreference || 'auto',
        metadata.downloadPriority || 0,
        metadata.lastError || null
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getDriveMetadata(mappingId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM drive_metadata_cache 
        WHERE mappingId = ? 
        ORDER BY type DESC, path ASC
      `;
      
      this.db!.all(sql, [mappingId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  async getDriveMetadataByPath(mappingId: string, path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM drive_metadata_cache 
        WHERE mappingId = ? AND path = ?
        LIMIT 1
      `;
      
      this.db!.get(sql, [mappingId, path], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async updateDriveMetadataStatus(fileId: string, status: string, localFileExists: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE drive_metadata_cache 
        SET syncStatus = ?, localFileExists = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;
      
      this.db!.run(sql, [status, localFileExists ? 1 : 0, fileId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async clearDriveMetadataCache(mappingId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM drive_metadata_cache WHERE mappingId = ?`;
      
      this.db!.run(sql, [mappingId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Sync preference management
  async updateFileSyncPreference(fileId: string, syncPreference: 'auto' | 'cloud_only'): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE drive_metadata_cache 
        SET syncPreference = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;
      
      this.db!.run(sql, [syncPreference, fileId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateFileSyncStatus(fileId: string, syncStatus: string, lastError?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE drive_metadata_cache 
        SET syncStatus = ?, lastError = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;
      
      this.db!.run(sql, [syncStatus, lastError || null, fileId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  async updateDriveMetadataName(fileId: string, newName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Update lastModifiedDate to current time (in milliseconds, matching our patched ArDrive Core)
      const currentTimeInMillis = Date.now();
      const sql = `
        UPDATE drive_metadata_cache 
        SET name = ?, lastModifiedDate = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;
      
      this.db!.run(sql, [newName, currentTimeInMillis, fileId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  
  // SYNC-5: reflect ArFS hidden state (local delete -> hide) in the cache so the
  // Permaweb view shows it without waiting for a fresh network listing. Keyed on
  // fileId, which for the cache is the entity id (file OR folder). Deliberately
  // does NOT touch lastModifiedDate — an ArFS hide is a no-op on that field
  // (CORE-4 mechanism), so edit-detection must not see a spurious change.
  async updateDriveMetadataHidden(entityId: string, isHidden: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE drive_metadata_cache
        SET isHidden = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;

      this.db!.run(sql, [isHidden ? 1 : 0, entityId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async updateDriveMetadataParent(fileId: string, newParentFolderId: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Update lastModifiedDate to current time (in milliseconds, matching our patched ArDrive Core)
      const currentTimeInMillis = Date.now();
      const sql = `
        UPDATE drive_metadata_cache 
        SET parentFolderId = ?, path = ?, lastModifiedDate = ?, lastSyncedAt = CURRENT_TIMESTAMP
        WHERE fileId = ?
      `;
      
      this.db!.run(sql, [newParentFolderId, newPath, currentTimeInMillis, fileId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getFilesByStatus(mappingId: string, syncStatus: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM drive_metadata_cache 
        WHERE mappingId = ? AND syncStatus = ?
        ORDER BY downloadPriority DESC, size ASC
      `;
      
      this.db!.all(sql, [mappingId, syncStatus], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  // Get the active mapping ID
  private async getActiveMappingId(): Promise<string | null> {
    const mappings = await this.getDriveMappings();
    const activeMapping = mappings.find((m: any) => m.isActive);
    return activeMapping?.id || null;
  }

  // Add folder operation to history
  async addFolderOperation(operation: {
    id: string;
    operationType: 'rename' | 'move' | 'rename_and_move' | 'delete';
    oldPath: string;
    newPath?: string;
    arfsFolderId?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    error?: string;
    createdAt: string;
    completedAt?: string;
  }): Promise<void> {
    const mappingId = await this.getActiveMappingId();
    
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO folder_operations 
        (id, mappingId, operationType, oldPath, newPath, arfsFolderId, status, error, createdAt, completedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        operation.id,
        mappingId,
        operation.operationType,
        operation.oldPath,
        operation.newPath,
        operation.arfsFolderId,
        operation.status,
        operation.error,
        operation.createdAt,
        operation.completedAt
      ], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Get child folders of a parent path
  async getChildFolders(parentPath: string): Promise<Array<{
    id: string;
    folderPath: string;
    relativePath: string;
    parentPath?: string;
    arfsFolderId?: string;
    createdAt: Date;
    isDeleted: boolean;
  }>> {
    const mappingId = await this.getActiveMappingId();
    
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM folder_structure 
        WHERE parentPath = ? AND mappingId = ? AND isDeleted = 0
      `;
      
      this.db!.all(sql, [parentPath, mappingId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as any[]);
        }
      });
    });
  }

  // Get child files of a parent folder
  async getChildFiles(parentFolderPath: string): Promise<Array<{
    id: string;
    localPath: string;
    fileName: string;
    fileSize: number;
  }>> {
    const mappingId = await this.getActiveMappingId();
    
    return new Promise((resolve, reject) => {
      // First get all uploads in this folder
      const uploadsSql = `
        SELECT id, localPath, fileName, fileSize 
        FROM uploads 
        WHERE mappingId = ? 
          AND localPath LIKE ? 
          AND localPath NOT LIKE ?
          AND status IN ('completed', 'pending', 'uploading')
      `;
      
      const pathPattern = parentFolderPath + '/%';
      const excludeSubfolders = parentFolderPath + '/%/%';
      
      this.db!.all(uploadsSql, [mappingId, pathPattern, excludeSubfolders], (err, uploadRows) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Also get processed files
        const processedSql = `
          SELECT localPath, fileName, fileSize 
          FROM processed_files 
          WHERE mappingId = ? 
            AND localPath LIKE ? 
            AND localPath NOT LIKE ?
        `;
        
        this.db!.all(processedSql, [mappingId, pathPattern, excludeSubfolders], (err, processedRows) => {
          if (err) {
            reject(err);
          } else {
            // Combine results, avoiding duplicates
            const allFiles = new Map();
            
            // Add uploads
            (uploadRows as any[]).forEach(row => {
              allFiles.set(row.localPath, {
                id: row.id,
                localPath: row.localPath,
                fileName: row.fileName,
                fileSize: row.fileSize
              });
            });
            
            // Add processed files not in uploads
            (processedRows as any[]).forEach(row => {
              if (!allFiles.has(row.localPath)) {
                allFiles.set(row.localPath, {
                  id: crypto.randomUUID(),
                  localPath: row.localPath,
                  fileName: row.fileName,
                  fileSize: row.fileSize
                });
              }
            });
            
            resolve(Array.from(allFiles.values()));
          }
        });
      });
    });
  }

  // Update file path (for move operations)
  async updateFilePath(fileId: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Update in uploads table
      const uploadSql = `UPDATE uploads SET localPath = ? WHERE id = ?`;
      
      this.db!.run(uploadSql, [newPath, fileId], (err) => {
        if (err) {
          // If not found in uploads, it might be in processed_files
          // For processed files, we need to update by the old path
          console.log('File not found in uploads, checking processed_files');
          resolve();
        } else {
          resolve();
        }
      });
    });
  }

  // Get file information by path (checks multiple tables)
  async getFilesByHash(hash: string): Promise<Array<{
    id: string;
    localPath: string;
    fileName: string;
    fileHash: string;
    fileSize: number;
  }>> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT fileHash as id, localPath, fileName, fileHash, fileSize
        FROM processed_files
        WHERE fileHash = ?
        AND fileHash NOT LIKE 'downloading-%'
        ORDER BY processedAt DESC
      `;
      
      this.db!.all(sql, [hash], (err, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  async getFileByPath(filePath: string): Promise<{
    id?: string;
    fileHash?: string;
    arweaveId?: string;
    arfsFileId?: string;
    mimeType?: string;
    fileSize?: number;
  } | null> {
    return new Promise((resolve, reject) => {
      // First check uploads table
      const uploadSql = `
        SELECT id, localPath, fileName, fileSize, fileId as arfsFileId
        FROM uploads 
        WHERE localPath = ? 
        ORDER BY createdAt DESC 
        LIMIT 1
      `;
      
      this.db!.get(uploadSql, [filePath], (err, uploadRow: any) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (uploadRow) {
          // Found in uploads, now get the hash from processed_files
          const processedSql = `
            SELECT fileHash, arweaveId 
            FROM processed_files 
            WHERE localPath = ? 
            AND fileHash NOT LIKE 'downloading-%'
            ORDER BY processedAt DESC
            LIMIT 1
          `;
          
          this.db!.get(processedSql, [filePath], (err2, processedRow: any) => {
            if (err2) {
              reject(err2);
              return;
            }
            
            resolve({
              id: uploadRow.id,
              fileHash: processedRow?.fileHash,
              arweaveId: processedRow?.arweaveId || uploadRow.arfsFileId,
              arfsFileId: uploadRow.arfsFileId,
              mimeType: undefined, // mimeType column doesn't exist in uploads table
              fileSize: uploadRow.fileSize
            });
          });
        } else {
          // Not in uploads, check processed_files
          const processedSql = `
            SELECT fileHash, arweaveId, fileName, fileSize
            FROM processed_files 
            WHERE localPath = ? 
            AND fileHash NOT LIKE 'downloading-%'
            ORDER BY processedAt DESC
            LIMIT 1
          `;
          
          this.db!.get(processedSql, [filePath], (err, row: any) => {
            if (err) {
              reject(err);
            } else if (row) {
              resolve({
                fileHash: row.fileHash,
                arweaveId: row.arweaveId,
                arfsFileId: row.arweaveId, // Same thing for processed files
                fileSize: row.fileSize
              });
            } else {
              resolve(null);
            }
          });
        }
      });
    });
  }

}

export const databaseManager = new DatabaseManager();