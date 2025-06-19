import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import { app } from 'electron';
import { FileUpload, PendingUpload, FileDownload, DriveSyncMapping, DriveSyncStatus } from '../types';
import { profileManager } from './profile-manager';
import * as crypto from 'crypto';

export class DatabaseManager {
  private db: sqlite3.Database | null = null;
  private currentProfileId: string | null = null;
  private readonly currentSchemaVersion = 2; // Incremented for multi-drive support

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
    return new Promise((resolve, reject) => {
      const dbPath = this.getDbPath();
      console.log(`DatabaseManager - initializing database at: ${dbPath}`);
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  private async createTables(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Create tables directly - no migrations needed
        
        const sql = `
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
            syncStatus TEXT DEFAULT 'pending' CHECK (syncStatus IN ('synced', 'pending', 'downloading', 'error')),
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
            arweaveFolderId TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            isDeleted BOOLEAN DEFAULT 0,
            UNIQUE(folderPath, mappingId),
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

        this.db!.exec(sql, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  
  private async runMigrations(): Promise<void> {
    return new Promise((resolve, reject) => {
      // First, check if schema_version table exists
      this.db!.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
        async (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          let currentVersion = 0;
          
          if (row) {
            // Get current schema version
            this.db!.get(
              "SELECT MAX(version) as version FROM schema_version",
              async (err, versionRow: any) => {
                if (err) {
                  reject(err);
                  return;
                }
                currentVersion = versionRow?.version || 0;
                await this.applyMigrations(currentVersion, resolve, reject);
              }
            );
          } else {
            // No schema_version table means this is either a new database or pre-migration
            // Check if any tables exist to determine if this is a legacy database
            this.db!.get(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='uploads'",
              async (err, uploadsRow) => {
                if (err) {
                  reject(err);
                  return;
                }
                
                if (uploadsRow) {
                  // Legacy database exists, start from version 1
                  currentVersion = 1;
                }
                
                await this.applyMigrations(currentVersion, resolve, reject);
              }
            );
          }
        }
      );
    });
  }
  
  private async applyMigrations(currentVersion: number, resolve: () => void, reject: (error: any) => void): Promise<void> {
    try {
      if (currentVersion < 2) {
        await this.migrateTo2();
        
        // Create schema_version table if it doesn't exist before recording
        this.db!.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)", (createErr) => {
          if (createErr) {
            console.error('Failed to create schema_version table:', createErr);
            reject(createErr);
            return;
          }
          
          // Now record the migration
          this.db!.run("INSERT INTO schema_version (version) VALUES (2)", (insertErr) => {
            if (insertErr) {
              console.error('Failed to record migration to version 2:', insertErr);
              // Don't reject here - migration was successful even if recording failed
            } else {
              console.log('Migration to version 2 recorded successfully');
            }
            resolve();
          });
        });
      } else {
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  }
  
  private async migrateTo2(): Promise<void> {
    // Migration to add multi-drive support
    return new Promise((resolve, reject) => {
      console.log('DatabaseManager - Migrating to schema version 2 (multi-drive support)');
      
      // First check which tables exist
      const checkTablesQuery = `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('uploads', 'pending_uploads', 'processed_files', 'file_versions', 'file_operations', 'folder_structure', 'downloads')
      `;
      
      this.db!.all(checkTablesQuery, (err, existingTables: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        
        const tableNames = existingTables.map(row => row.name);
        console.log('Existing tables for migration:', tableNames);
        
        const migrations: string[] = [];
        
        // Only add migrations for tables that exist
        if (tableNames.includes('uploads')) {
          migrations.push(
            "ALTER TABLE uploads ADD COLUMN mappingId TEXT",
            "ALTER TABLE uploads ADD COLUMN uploadMethod TEXT",
            "ALTER TABLE uploads ADD COLUMN fileId TEXT"
          );
        }
        
        if (tableNames.includes('pending_uploads')) {
          migrations.push("ALTER TABLE pending_uploads ADD COLUMN mappingId TEXT");
        }
        
        if (tableNames.includes('processed_files')) {
          migrations.push("ALTER TABLE processed_files ADD COLUMN mappingId TEXT");
        }
        
        if (tableNames.includes('file_versions')) {
          migrations.push("ALTER TABLE file_versions ADD COLUMN mappingId TEXT");
        }
        
        if (tableNames.includes('file_operations')) {
          migrations.push("ALTER TABLE file_operations ADD COLUMN mappingId TEXT");
        }
        
        if (tableNames.includes('folder_structure')) {
          migrations.push("ALTER TABLE folder_structure ADD COLUMN mappingId TEXT");
        }
        
        if (tableNames.includes('downloads')) {
          migrations.push("ALTER TABLE downloads ADD COLUMN mappingId TEXT");
        }
        
        if (migrations.length === 0) {
          console.log('No migrations needed - tables will be created with new schema');
          resolve();
          return;
        }
        
        // Execute migrations one by one
        let completed = 0;
        const total = migrations.length;
        
        migrations.forEach((migration, index) => {
          this.db!.run(migration, (err) => {
            // Ignore errors for columns that may already exist
            if (err && !err.message.includes('duplicate column name')) {
              console.error(`Migration ${index + 1} failed:`, err);
            } else if (!err) {
              console.log(`Migration ${index + 1} completed successfully`);
            }
            
            completed++;
            if (completed === total) {
              console.log('DatabaseManager - Schema migration to version 2 completed');
              resolve();
            }
          });
        });
      });
    });
  }

  async addUpload(upload: Omit<FileUpload, 'createdAt'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO uploads (id, mappingId, driveId, localPath, fileName, fileSize, status, progress, uploadMethod, transactionId, dataTxId, metadataTxId, fileId, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        upload.id,
        upload.mappingId,
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
        INSERT INTO pending_uploads (id, localPath, fileName, fileSize, estimatedCost, estimatedTurboCost, recommendedMethod, hasSufficientTurboBalance, conflictType, conflictDetails, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        upload.status
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
          const uploads = rows.map(row => ({
            ...row,
            createdAt: new Date(row.createdAt)
          }));
          resolve(uploads);
        }
      });
    });
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
      const sql = `
        INSERT OR REPLACE INTO processed_files (fileHash, fileName, fileSize, localPath, source, arweaveId)
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
      let params: any[] = [fileHash];
      
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
      let params: any[] = [filePath];
      
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
      let params: any[] = [filePath];
      
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
    arweaveFolderId?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO folder_structure (id, folderPath, relativePath, parentPath, arweaveFolderId, isDeleted)
        VALUES (?, ?, ?, ?, ?, 0)
      `;
      
      this.db!.run(sql, [
        folder.id,
        folder.folderPath,
        folder.relativePath,
        folder.parentPath,
        folder.arweaveFolderId
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
    arweaveFolderId?: string;
    createdAt: Date;
    isDeleted: boolean;
  }>> {
    return new Promise((resolve, reject) => {
      // SECURITY FIX: Add mappingId filtering to prevent cross-profile data access
      let sql = `SELECT * FROM folder_structure WHERE isDeleted = 0`;
      let params: any[] = [];
      
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
    arweaveFolderId?: string;
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

  // Downloads management
  async addDownload(download: Omit<FileDownload, 'downloadedAt'>): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO downloads (id, fileName, localPath, fileSize, fileId, dataTxId, metadataTxId, status, progress, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      this.db!.run(sql, [
        download.id,
        download.fileName,
        download.localPath,
        download.fileSize,
        download.fileId,
        download.dataTxId,
        download.metadataTxId,
        download.status,
        download.progress,
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

  // Get uploads for a specific drive mapping
  async getUploadsByMapping(mappingId: string): Promise<FileUpload[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM uploads 
        WHERE mappingId = ?
        ORDER BY createdAt DESC
      `;
      
      this.db!.all(sql, [mappingId], (err, rows: any[]) => {
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
          resolve();
        });
      } else {
        resolve();
      }
    });
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
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO drive_metadata_cache (
          id, mappingId, fileId, parentFolderId, name, path, type, size,
          lastModifiedDate, dataTxId, metadataTxId, contentType, fileHash,
          localPath, localFileExists, syncStatus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          syncStatus = excluded.syncStatus,
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
        metadata.syncStatus || 'pending'
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

}

export const databaseManager = new DatabaseManager();