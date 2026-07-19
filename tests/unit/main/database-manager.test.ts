// @vitest-environment node
//
// Migrated from src/main/__tests__/database-manager.test.ts (jest) as part of
// INFRA-2. Main-process suite: runs under node with sqlite3 fully mocked so no
// native bindings are required.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseManager } from '../../../src/main/database-manager';
import { FileUpload, PendingUpload } from '../../../src/types';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-ardrive'),
  },
}));

// Mock profile-manager (imported by database-manager for profile DB paths);
// mocked with a factory so sqlite3/keytar-adjacent modules never load.
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/tmp/test-ardrive/${profileId}/${fileName}`
    ),
  },
}));

// Shared sqlite3 database mock (hoisted so the vi.mock factory can use it)
const { mockDbInstance } = vi.hoisted(() => ({
  mockDbInstance: {
    exec: vi.fn((sql: string, callback?: (err: Error | null) => void) => {
      if (callback) callback(null);
    }),
    run: vi.fn((sql: string, params?: any, callback?: (err: Error | null) => void) => {
      if (typeof params === 'function') {
        callback = params;
      }
      // sqlite3 invokes the callback with `this.changes` set — SYNC-3's
      // recovery counts rely on it
      if (callback) callback.call({ changes: 0 }, null);
    }),
    get: vi.fn((sql: string, params?: any, callback?: (err: Error | null, row?: any) => void) => {
      if (typeof params === 'function') {
        callback = params;
      }
      if (callback) callback(null, null);
    }),
    all: vi.fn((sql: string, params?: any, callback?: (err: Error | null, rows?: any[]) => void) => {
      if (typeof params === 'function') {
        callback = params;
      }
      if (callback) callback(null, []);
    }),
    close: vi.fn((callback?: (err: Error | null) => void) => {
      if (callback) callback(null);
    }),
  },
}));

vi.mock('sqlite3', () => ({
  Database: vi.fn().mockImplementation((dbPath: string, callback?: (err: Error | null) => void) => {
    // Simulate successful database connection
    if (callback) callback(null);
    return mockDbInstance;
  }),
}));

describe('DatabaseManager', () => {
  let databaseManager: DatabaseManager;

  beforeEach(() => {
    databaseManager = new DatabaseManager();
    vi.clearAllMocks();

    // Inject the mock db directly (the class opens it lazily otherwise)
    (databaseManager as any).db = mockDbInstance;
  });

  describe('initialize', () => {
    it('should initialize the database successfully', async () => {
      await expect(databaseManager.initialize()).resolves.not.toThrow();
    });

    it('runs crash recovery as part of initialization (SYNC-3)', async () => {
      await databaseManager.initialize();

      const sqls = mockDbInstance.run.mock.calls.map((c: any[]) => String(c[0]));
      expect(sqls.some((q) => q.includes("SET status = 'failed'") && q.includes('uploads') && q.includes("status = 'uploading'"))).toBe(true);
      expect(sqls.some((q) => q.includes('downloads') && q.includes("'downloading', 'queued', 'pending'"))).toBe(true);
      expect(sqls.some((q) => q.includes('drive_metadata_cache') && q.includes("syncStatus = 'pending'"))).toBe(true);
    });
  });

  describe('recoverInterruptedOperations (SYNC-3)', () => {
    it('fails interrupted uploads with a verify-before-retry message (never re-queues them)', async () => {
      await databaseManager.recoverInterruptedOperations();

      const uploadCall = mockDbInstance.run.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE uploads')
      );
      expect(uploadCall).toBeDefined();
      // Terminal failed — NOT 'pending': blind re-queueing an interrupted
      // upload could pay for the same file twice (MONEY-2)
      expect(String(uploadCall![0])).toContain("SET status = 'failed'");
      expect(String(uploadCall![0])).toContain("WHERE status = 'uploading'");
      expect(uploadCall![1][0]).toMatch(/may or may not have reached Arweave/);
    });

    it('fails never-started pending uploads with a never-charged message (batch-crash gap)', async () => {
      await databaseManager.recoverInterruptedOperations();

      const pendingCall = mockDbInstance.run.mock.calls.find((c: any[]) =>
        String(c[0]).includes("WHERE status = 'pending'") && String(c[0]).includes('uploads')
      );
      expect(pendingCall).toBeDefined();
      expect(String(pendingCall![0])).toContain("SET status = 'failed'");
      expect(String(pendingCall![0])).toContain('nothing was charged');
    });

    it('resets stuck download rows and metadata to recoverable states', async () => {
      await databaseManager.recoverInterruptedOperations();

      const sqls = mockDbInstance.run.mock.calls.map((c: any[]) => String(c[0]));
      const downloadSql = sqls.find((q) => q.includes('UPDATE downloads'));
      const metaSql = sqls.find((q) => q.includes('UPDATE drive_metadata_cache'));

      expect(downloadSql).toContain("SET status = 'failed'");
      expect(downloadSql).toContain("IN ('downloading', 'queued', 'pending')");
      // Metadata rows go back to 'pending' so the boot sync re-queues the
      // downloads automatically (free to redo)
      expect(metaSql).toContain("SET syncStatus = 'pending'");
      expect(metaSql).toContain("IN ('downloading', 'queued')");
    });

    it('reports how many rows were recovered', async () => {
      mockDbInstance.run.mockImplementation((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') callback = params;
        const changes = String(sql).includes('UPDATE uploads') ? 2
          : String(sql).includes('UPDATE downloads') ? 3
          : String(sql).includes('UPDATE drive_metadata_cache') ? 5 : 0;
        // note: both uploads statements (in-flight + pending) report 2 each
        if (callback) callback.call({ changes }, null);
      });

      let result;
      try {
        result = await databaseManager.recoverInterruptedOperations();
      } finally {
        // restore the default impl — mockImplementation (not ...Once) would
        // otherwise leak into later tests (qa-gate hygiene note)
        mockDbInstance.run.mockImplementation((sql: string, params?: any, callback?: any) => {
          if (typeof params === 'function') callback = params;
          if (callback) callback.call({ changes: 0 }, null);
        });
      }

      // uploadsReset = in-flight (2) + never-started pending (2)
      expect(result).toEqual({ uploadsReset: 4, downloadsReset: 3, metadataReset: 5 });
    });

    it('propagates database errors', async () => {
      mockDbInstance.run.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') callback = params;
        if (callback) callback.call({ changes: 0 }, new Error('db locked'));
      });

      await expect(databaseManager.recoverInterruptedOperations()).rejects.toThrow('db locked');
    });
  });

  describe('processed files management', () => {
    it('should add a processed file', async () => {
      const fileHash = 'abc123';
      const fileName = 'test.txt';
      const fileSize = 1024;
      const localPath = '/path/to/test.txt';
      const source = 'download' as const;

      await expect(
        databaseManager.addProcessedFile(fileHash, fileName, fileSize, localPath, source)
      ).resolves.not.toThrow();
    });

    it('should check if file is processed', async () => {
      const result = await databaseManager.isFileProcessed('abc123');
      expect(typeof result).toBe('boolean');
    });

    it('should get processed files list', async () => {
      const result = await databaseManager.getProcessedFiles();
      expect(Array.isArray(result)).toBe(true);
    });

    // SYNC-10: indexed single-row-shaped lookups (getProcessedFilesByHash /
    // getProcessedFilesByPath) replace the per-file-event
    // getProcessedFiles()-then-filter-in-JS pattern in sync-manager.ts /
    // DownloadManager.ts. Pin that they query by the indexed column, not the
    // unfiltered full-table SELECT.
    it('getProcessedFilesByHash queries WHERE fileHash = ? (indexed column)', async () => {
      const result = await databaseManager.getProcessedFilesByHash('abc123hash');
      expect(Array.isArray(result)).toBe(true);
      const [sql, params] = mockDbInstance.all.mock.calls[mockDbInstance.all.mock.calls.length - 1];
      expect(sql).toContain('WHERE fileHash = ?');
      expect(params).toEqual(['abc123hash']);
    });

    it('getProcessedFilesByPath queries WHERE localPath = ? (indexed column, SYNC-10 migration v9)', async () => {
      const result = await databaseManager.getProcessedFilesByPath('/path/to/test.txt');
      expect(Array.isArray(result)).toBe(true);
      const [sql, params] = mockDbInstance.all.mock.calls[mockDbInstance.all.mock.calls.length - 1];
      expect(sql).toContain('WHERE localPath = ?');
      expect(params).toEqual(['/path/to/test.txt']);
    });

    it('should remove a processed file', async () => {
      await expect(
        databaseManager.removeProcessedFile('abc123')
      ).resolves.not.toThrow();
    });
  });

  describe('upload management', () => {
    const mockUpload: Omit<FileUpload, 'createdAt'> = {
      id: 'test-upload-1',
      localPath: '/path/to/file.txt',
      fileName: 'file.txt',
      fileSize: 1024,
      status: 'pending',
      progress: 0,
    };

    it('should add an upload', async () => {
      await expect(databaseManager.addUpload(mockUpload)).resolves.not.toThrow();
    });

    it('should update an upload', async () => {
      const updates = { status: 'completed' as const, progress: 100 };

      await expect(
        databaseManager.updateUpload('test-upload-1', updates)
      ).resolves.not.toThrow();
    });

    it('should get uploads', async () => {
      const result = await databaseManager.getUploads();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should get uploads by status', async () => {
      const result = await databaseManager.getUploadsByStatus('pending');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('pending upload management', () => {
    const mockPendingUpload: Omit<PendingUpload, 'createdAt'> = {
      id: 'test-pending-1',
      localPath: '/path/to/file.txt',
      fileName: 'file.txt',
      fileSize: 1024,
      estimatedCost: 1000,
      estimatedTurboCost: 500,
      recommendedMethod: 'turbo',
      hasSufficientTurboBalance: true,
      status: 'awaiting_approval',
    };

    it('should add a pending upload', async () => {
      await expect(
        databaseManager.addPendingUpload(mockPendingUpload)
      ).resolves.not.toThrow();
    });

    it('should get pending uploads', async () => {
      const result = await databaseManager.getPendingUploads();
      expect(Array.isArray(result)).toBe(true);
    });

    it('normalizes raw sqlite scalars (0/1 booleans, NULLs) at the DB boundary (MONEY-3)', async () => {
      // Exactly what sqlite3 hands back for a SELECT *: BOOLEAN columns as
      // integers, empty optional columns as null. These rows are spread
      // through IPC to the renderer, so they must leave here as real
      // booleans / explicit nulls — a raw 0 passing `!== false` once
      // classified no-quote files as 0-credit Turbo uploads.
      const baseDbRow = {
        id: 'row-no-quote',
        mappingId: null,
        driveId: null,
        localPath: '/sync/big.bin',
        fileName: 'big.bin',
        fileSize: 5 * 1024 * 1024,
        estimatedCost: 0.000005,
        estimatedTurboCost: null,     // SQLite NULL — no quote
        recommendedMethod: null,
        hasSufficientTurboBalance: 0, // SQLite false -> integer 0
        conflictType: 'none',
        conflictDetails: null,
        status: 'awaiting_approval',
        operationType: 'upload',
        previousPath: null,
        arfsFileId: null,
        arfsFolderId: null,
        metadata: null,
        createdAt: '2026-07-03T00:00:00.000Z',
      };
      const quotedDbRow = {
        ...baseDbRow,
        id: 'row-quoted',
        localPath: '/sync/quoted.bin',
        fileName: 'quoted.bin',
        estimatedTurboCost: 0.01,
        hasSufficientTurboBalance: 1, // SQLite true -> integer 1
        recommendedMethod: 'turbo',
        previousPath: '/sync/old.bin',
      };

      mockDbInstance.all.mockImplementationOnce(
        (sql: string, callback: (err: Error | null, rows?: any[]) => void) => {
          callback(null, [baseDbRow, quotedDbRow]);
        }
      );

      const result = await databaseManager.getPendingUploads();
      const noQuote = result.find(u => u.id === 'row-no-quote')!;
      const quoted = result.find(u => u.id === 'row-quoted')!;

      // Integer booleans become real booleans
      expect(noQuote.hasSufficientTurboBalance).toBe(false);
      expect(quoted.hasSufficientTurboBalance).toBe(true);
      // Missing quote stays an explicit null (never 0 / never a number)
      expect(noQuote.estimatedTurboCost).toBeNull();
      expect(quoted.estimatedTurboCost).toBe(0.01);
      // Sibling nullable columns normalize to undefined per the TS shape
      expect(noQuote.recommendedMethod).toBeUndefined();
      expect(noQuote.conflictDetails).toBeUndefined();
      expect(noQuote.previousPath).toBeUndefined();
      expect(noQuote.arfsFileId).toBeUndefined();
      expect(noQuote.arfsFolderId).toBeUndefined();
      expect(quoted.previousPath).toBe('/sync/old.bin');
      // Existing conversions still apply
      expect(noQuote.createdAt).toBeInstanceOf(Date);
      expect(noQuote.metadata).toBeUndefined();
    });

    it('should update pending upload status', async () => {
      await expect(
        databaseManager.updatePendingUploadStatus('test-pending-1', 'approved')
      ).resolves.not.toThrow();
    });

    it('should update pending upload fields', async () => {
      const updates = { hasSufficientTurboBalance: false, estimatedTurboCost: 800 };

      await expect(
        databaseManager.updatePendingUpload('test-pending-1', updates)
      ).resolves.not.toThrow();
    });

    it('should remove a pending upload', async () => {
      await expect(
        databaseManager.removePendingUpload('test-pending-1')
      ).resolves.not.toThrow();
    });

    it('should clear all pending uploads', async () => {
      await expect(databaseManager.clearAllPendingUploads()).resolves.not.toThrow();
    });
  });

  describe('file version management', () => {
    const mockFileVersion = {
      id: 'version-1',
      fileHash: 'abc123hash',
      fileName: 'test.txt',
      filePath: '/path/to/test.txt',
      relativePath: 'test.txt',
      fileSize: 1024,
      arweaveId: 'arweave-123',
      turboId: 'turbo-123',
      version: 1,
      parentVersion: undefined,
      changeType: 'create' as const,
      uploadMethod: 'ar' as const,
    };

    beforeEach(() => {
      // Mock database responses for version tests
      mockDbInstance.get.mockImplementation((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }

        if (sql.includes('isLatest = 1')) {
          const mockRow = {
            ...mockFileVersion,
            isLatest: 1,
            createdAt: '2023-01-01T00:00:00.000Z'
          };
          callback(null, mockRow);
        } else {
          callback(null, null);
        }
      });

      mockDbInstance.all.mockImplementation((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }

        if (sql.includes('file_versions')) {
          const mockRows = [
            {
              ...mockFileVersion,
              isLatest: 1,
              createdAt: '2023-01-01T00:00:00.000Z'
            }
          ];
          callback(null, mockRows);
        } else {
          callback(null, []);
        }
      });
    });

    it('should add a file version', async () => {
      await expect(
        databaseManager.addFileVersion(mockFileVersion)
      ).resolves.not.toThrow();

      // Verify that it first updates existing versions to not latest
      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE file_versions SET isLatest = 0'),
        expect.any(Array),
        expect.any(Function)
      );

      // Verify that it inserts the new version
      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO file_versions'),
        expect.arrayContaining([
          mockFileVersion.id,
          mockFileVersion.fileHash,
          mockFileVersion.fileName
        ]),
        expect.any(Function)
      );
    });

    it('should get file versions', async () => {
      const result = await databaseManager.getFileVersions('/path/to/test.txt');

      expect(Array.isArray(result)).toBe(true);
      expect(mockDbInstance.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM file_versions WHERE filePath = ?'),
        ['/path/to/test.txt'],
        expect.any(Function)
      );
    });

    it('should get latest file version', async () => {
      const result = await databaseManager.getLatestFileVersion('/path/to/test.txt');

      expect(result).toBeTruthy();
      expect(mockDbInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM file_versions WHERE filePath = ? AND isLatest = 1'),
        ['/path/to/test.txt'],
        expect.any(Function)
      );
    });

    it('should return null for non-existent file version', async () => {
      mockDbInstance.get.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }
        callback(null, null);
      });

      const result = await databaseManager.getLatestFileVersion('/path/to/nonexistent.txt');
      expect(result).toBeNull();
    });
  });

  describe('file operations tracking', () => {
    const mockFileOperation = {
      id: 'operation-1',
      fileHash: 'abc123hash',
      operation: 'upload' as const,
      fromPath: undefined,
      toPath: '/path/to/test.txt',
      metadata: { uploadMethod: 'ar', fileSize: 1024 },
    };

    it('should add a file operation', async () => {
      await expect(
        databaseManager.addFileOperation(mockFileOperation)
      ).resolves.not.toThrow();

      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO file_operations'),
        expect.arrayContaining([
          mockFileOperation.id,
          mockFileOperation.fileHash,
          mockFileOperation.operation,
          mockFileOperation.fromPath,
          mockFileOperation.toPath,
          JSON.stringify(mockFileOperation.metadata)
        ]),
        expect.any(Function)
      );
    });

    it('should get file operations', async () => {
      mockDbInstance.all.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }

        const mockRows = [
          {
            ...mockFileOperation,
            metadata: JSON.stringify(mockFileOperation.metadata),
            timestamp: '2023-01-01T00:00:00.000Z'
          }
        ];
        callback(null, mockRows);
      });

      const result = await databaseManager.getFileOperations('abc123hash');

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('metadata');
      expect(result[0]).toHaveProperty('timestamp');
      expect(mockDbInstance.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM file_operations WHERE fileHash = ?'),
        ['abc123hash'],
        expect.any(Function)
      );
    });

    it('should handle operations with no metadata', async () => {
      const operationWithoutMetadata = {
        ...mockFileOperation,
        metadata: undefined,
      };

      await expect(
        databaseManager.addFileOperation(operationWithoutMetadata)
      ).resolves.not.toThrow();

      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO file_operations'),
        expect.arrayContaining([
          operationWithoutMetadata.id,
          operationWithoutMetadata.fileHash,
          operationWithoutMetadata.operation,
          operationWithoutMetadata.fromPath,
          operationWithoutMetadata.toPath,
          null
        ]),
        expect.any(Function)
      );
    });
  });

  describe('folder structure management', () => {
    // NOTE: field renamed from arweaveFolderId to arfsFolderId since the
    // original jest suite was written (schema uses the arfsFolderId column).
    const mockFolder = {
      id: 'folder-1',
      folderPath: '/path/to/folder',
      relativePath: 'folder',
      parentPath: '/path/to',
      arfsFolderId: 'arweave-folder-123',
    };

    it('should add a folder', async () => {
      await expect(
        databaseManager.addFolder(mockFolder)
      ).resolves.not.toThrow();

      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO folder_structure'),
        expect.arrayContaining([
          mockFolder.id,
          mockFolder.folderPath,
          mockFolder.relativePath,
          mockFolder.parentPath,
          mockFolder.arfsFolderId
        ]),
        expect.any(Function)
      );
    });

    it('should get folders', async () => {
      mockDbInstance.all.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }

        const mockRows = [
          {
            ...mockFolder,
            isDeleted: 0,
            createdAt: '2023-01-01T00:00:00.000Z'
          }
        ];
        callback(null, mockRows);
      });

      const result = await databaseManager.getFolders();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('isDeleted', false);
      expect(result[0]).toHaveProperty('createdAt');
      expect(mockDbInstance.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM folder_structure WHERE isDeleted = 0'),
        [],
        expect.any(Function)
      );
    });

    it('should get folder by path', async () => {
      mockDbInstance.get.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }

        const mockRow = {
          ...mockFolder,
          isDeleted: 0,
          createdAt: '2023-01-01T00:00:00.000Z'
        };
        callback(null, mockRow);
      });

      const result = await databaseManager.getFolderByPath('/path/to/folder');

      expect(result).toBeTruthy();
      expect(result?.folderPath).toBe('/path/to/folder');
      expect(mockDbInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM folder_structure WHERE folderPath = ?'),
        ['/path/to/folder'],
        expect.any(Function)
      );
    });

    it('should mark folder as deleted', async () => {
      await expect(
        databaseManager.markFolderDeleted('/path/to/folder')
      ).resolves.not.toThrow();

      expect(mockDbInstance.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE folder_structure SET isDeleted = 1'),
        ['/path/to/folder'],
        expect.any(Function)
      );
    });

    it('should return null for non-existent folder', async () => {
      mockDbInstance.get.mockImplementationOnce((sql: string, params?: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
        }
        callback(null, null);
      });

      const result = await databaseManager.getFolderByPath('/path/to/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('drive mapping updates (UX-2)', () => {
    // QA-traced regression: updateDriveMapping had no localFolderPath branch,
    // so a Settings folder change generated
    //   UPDATE drive_mappings SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?
    // — the new path never persisted and sync:start kept fs.access-ing the
    // old folder. These tests pin the REAL SQL construction, not a mock of
    // updateDriveMapping.
    it('generates an UPDATE whose SQL and values actually set localFolderPath', async () => {
      await databaseManager.updateDriveMapping('mapping-1', {
        localFolderPath: '/new/sync/folder',
      });

      expect(mockDbInstance.run).toHaveBeenCalledWith(
        'UPDATE drive_mappings SET localFolderPath = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
        ['/new/sync/folder', 'mapping-1'],
        expect.any(Function)
      );
    });

    it('combines localFolderPath with other mapped fields in one UPDATE', async () => {
      await databaseManager.updateDriveMapping('mapping-1', {
        driveName: 'Renamed Drive',
        localFolderPath: '/new/sync/folder',
        isActive: true,
      });

      const [sql, values] = mockDbInstance.run.mock.calls[0];
      expect(sql).toContain('driveName = ?');
      expect(sql).toContain('localFolderPath = ?');
      expect(sql).toContain('isActive = ?');
      expect(sql).toContain('WHERE id = ?');
      // Values in SQL-clause order, id last; isActive stored as SQLite int
      expect(values).toEqual(['Renamed Drive', '/new/sync/folder', 1, 'mapping-1']);
    });

    it('rejects when the UPDATE fails', async () => {
      mockDbInstance.run.mockImplementationOnce(
        (sql: string, params?: any, callback?: any) => {
          if (typeof params === 'function') callback = params;
          callback(new Error('SQLITE_ERROR'));
        }
      );

      await expect(
        databaseManager.updateDriveMapping('mapping-1', { localFolderPath: '/new' })
      ).rejects.toThrow('SQLITE_ERROR');
    });
  });

  // [MONEY-15 / DB hardening] DB-boundary shape audit. CLAUDE.md trap #6:
  // node-sqlite3 returns BOOLEAN columns as 0/1 integers and empty nullable
  // columns as null. getPendingUploads (above) is the model: it normalizes
  // every scalar at the boundary. These blocks pin the SAME contract for the
  // other methods that carry boolean-ish columns, documenting where it holds
  // and where it doesn't (findings filed in docs/product/BACKLOG.md MONEY-15).
  describe('drive mapping normalization — DB-shaped fixtures (locks in correct behavior)', () => {
    // migrations.ts: `isActive BOOLEAN DEFAULT 1` on drive_mappings. Both
    // getDriveMappings and getDriveMappingById already coerce with
    // Boolean(row.isActive) — these tests pin that against the REAL sqlite
    // shape (integer 0/1, null dates, null JSON column) rather than a clean
    // JS fixture, so a regression here is caught immediately.
    const dbShapedMappingRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'mapping-1',
      driveId: 'drive-1',
      driveName: 'My Drive',
      drivePrivacy: 'public',
      localFolderPath: '/sync/folder',
      rootFolderId: 'root-1',
      isActive: 0, // SQLite false -> integer 0
      lastSyncTime: null,
      lastMetadataSyncAt: null,
      excludePatterns: null,
      maxFileSize: null,
      syncDirection: 'bidirectional',
      uploadPriority: 0,
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
      ...overrides,
    });

    it('getDriveMappings: integer isActive 0/1 becomes a real boolean; null dates/JSON become undefined', async () => {
      mockDbInstance.all.mockImplementationOnce(
        (sql: string, callback: (err: Error | null, rows?: any[]) => void) => {
          callback(null, [
            dbShapedMappingRow({ id: 'inactive' }),
            dbShapedMappingRow({ id: 'active', isActive: 1, excludePatterns: '["*.tmp"]', maxFileSize: 1000 }),
          ]);
        }
      );

      const [inactive, active] = await databaseManager.getDriveMappings();

      expect(inactive.isActive).toBe(false);
      expect(active.isActive).toBe(true);
      expect(inactive.lastSyncTime).toBeUndefined();
      expect(inactive.lastMetadataSyncAt).toBeUndefined();
      expect(inactive.syncSettings?.excludePatterns).toBeUndefined();
      expect(active.syncSettings?.excludePatterns).toEqual(['*.tmp']);
      expect(inactive.createdAt).toBeInstanceOf(Date);
    });

    it('getDriveMappingById: the same DB-shaped row normalizes identically', async () => {
      mockDbInstance.get.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, row?: any) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, dbShapedMappingRow({ isActive: 1, lastSyncTime: '2026-07-01T00:00:00.000Z' }));
        }
      );

      const mapping = await databaseManager.getDriveMappingById('mapping-1');

      expect(mapping?.isActive).toBe(true);
      expect(mapping?.lastSyncTime).toBeInstanceOf(Date);
    });
  });

  describe('downloads — isCancelled normalization gap [DB-1 finding, MONEY-15]', () => {
    // migrations.ts: `isCancelled BOOLEAN DEFAULT 0` on `downloads`. Unlike
    // getPendingUploads/getDriveMappings/getFolders/getFileVersions,
    // getDownloads/getDownloadByFileId/getDownloadByPath spread the raw
    // sqlite row through with NO boolean coercion — isCancelled reaches
    // callers as the literal SQLite integer, even though FileDownload types
    // it `isCancelled?: boolean`.
    //
    // FINDING (DB-1, latent risk — NOT currently exploited): every read of
    // `.isCancelled` in the app stays inside SQL WHERE clauses written by
    // database-manager.ts itself (`WHERE ... AND isCancelled = 0`); no
    // consumer reads it off a returned FileDownload object today, so nothing
    // misbehaves in production right now. But the method breaks the
    // DB-boundary contract the normalized methods follow: a future call site
    // written against the FileDownload type that does
    // `download.isCancelled === true` (or `!== false`) would silently
    // misclassify a cancelled download — the exact MONEY-3 failure mode.
    // These tests pin the CURRENT (unnormalized) behavior so the gap is
    // visible; if a future fix normalizes it, update the `.toBe(1)` /
    // `.toBe(0)` assertions to `.toBe(true)` / `.toBe(false)`.
    const dbShapedDownloadRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'download-1',
      driveId: 'drive-1',
      fileName: 'file.bin',
      localPath: '/sync/file.bin',
      fileSize: 1024,
      fileId: 'arfs-file-1',
      dataTxId: null,
      metadataTxId: null,
      status: 'failed',
      progress: 0,
      priority: 0,
      isCancelled: 1, // SQLite true -> integer 1
      error: 'Cancelled by user',
      downloadedAt: '2026-07-03T00:00:00.000Z',
      completedAt: null,
      ...overrides,
    });

    it('getDownloads: isCancelled reaches the caller as a raw integer, not a boolean', async () => {
      mockDbInstance.all.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, rows?: any[]) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, [dbShapedDownloadRow()]);
        }
      );

      const [download] = await databaseManager.getDownloads();

      // Documents current (unnormalized) behavior, not the FileDownload
      // type's contract.
      expect((download as any).isCancelled).toBe(1);
      expect((download as any).isCancelled).not.toBe(true);
      // Dates ARE normalized — this part of the boundary is fine.
      expect(download.downloadedAt).toBeInstanceOf(Date);
      expect(download.completedAt).toBeUndefined();
    });

    it('getDownloadByFileId: same raw-integer isCancelled shape', async () => {
      mockDbInstance.get.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, row?: any) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, dbShapedDownloadRow({ isCancelled: 0 }));
        }
      );

      const download = await databaseManager.getDownloadByFileId('arfs-file-1');
      expect((download as any)?.isCancelled).toBe(0);
    });

    it('getDownloadByPath: same raw-integer isCancelled shape', async () => {
      mockDbInstance.get.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, row?: any) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, dbShapedDownloadRow({ isCancelled: 1, localPath: '/sync/file.bin' }));
        }
      );

      const download = await databaseManager.getDownloadByPath('/sync/file.bin');
      expect((download as any)?.isCancelled).toBe(1);
    });
  });

  describe('drive metadata cache — localFileExists/isHidden not normalized [DB-2 finding, MONEY-15]', () => {
    // migrations.ts: `localFileExists BOOLEAN DEFAULT 0` (v3 baseline) and
    // `isHidden BOOLEAN DEFAULT 0` (migration v5, SYNC-5) on
    // drive_metadata_cache. getDriveMetadata/getFilesByStatus return
    // `resolve(rows || [])` verbatim — no boolean coercion at all, unlike
    // getPendingUploads/getDriveMappings/getFolders/getFileVersions above.
    //
    // FINDING (DB-2, latent risk): main.ts is currently the only in-tree
    // consumer, and it defends itself inline at TWO call sites with explicit
    // `=== 1` / `=== true` comparisons (main.ts:1177 `item.localFileExists
    // === 1`, main.ts:1187 `item.isHidden === 1`) before these rows reach the
    // renderer — but a THIRD call site (main.ts:1400, the force-refresh /
    // merged-with-live-entities path) does NOT: `isDownloaded:
    // localData.localFileExists` forwards the raw SQLite integer straight
    // through an IPC payload typed as `boolean`. It is harmless today only
    // because StorageTab.tsx exclusively truthy-checks `isDownloaded`
    // (`item.isDownloaded || false`, `if (item.isDownloaded && ...)`), so 1/0
    // behave like true/false there. But getDriveMetadata/getFilesByStatus
    // themselves provide NO defense in depth: any future caller that forwards
    // a row without main.ts's manual `=== 1` guard leaks a raw integer to a
    // renderer expecting a real boolean. The companion renderer test
    // (storage-tab-hidden-dbshape.test.tsx) demonstrates the concrete
    // failure mode for `isHidden` specifically: StorageTab's OWN boundary
    // check (`item.isHidden === true`) is written in the exact strict-equality
    // style this trap describes, and would silently un-hide an actually-
    // hidden file if fed this raw shape.
    const dbShapedMetadataRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'meta-1',
      mappingId: 'mapping-1',
      fileId: 'arfs-file-1',
      parentFolderId: null,
      name: 'secret.txt',
      path: '/secret.txt',
      type: 'file',
      size: 100,
      lastModifiedDate: 1751500000000,
      dataTxId: 'tx-1',
      metadataTxId: 'meta-tx-1',
      contentType: 'text/plain',
      fileHash: null,
      lastSyncedAt: '2026-07-03T00:00:00.000Z',
      localPath: '/sync/secret.txt',
      localFileExists: 1, // SQLite true -> integer 1
      syncStatus: 'synced',
      syncPreference: 'auto',
      downloadPriority: 0,
      lastError: null,
      isHidden: 1, // SQLite true -> integer 1 (the file IS hidden on Arweave)
      ...overrides,
    });

    it('getDriveMetadata: returns localFileExists/isHidden as raw integers, not booleans', async () => {
      mockDbInstance.all.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, rows?: any[]) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, [dbShapedMetadataRow()]);
        }
      );

      const [row] = await databaseManager.getDriveMetadata('mapping-1');

      expect(row.localFileExists).toBe(1);
      expect(row.localFileExists).not.toBe(true);
      expect(row.isHidden).toBe(1);
      expect(row.isHidden).not.toBe(true);
    });

    it('getFilesByStatus: same raw-integer shape (method has no in-tree caller today — dead but part of the public boundary)', async () => {
      mockDbInstance.all.mockImplementationOnce(
        (sql: string, params?: any, callback?: (err: Error | null, rows?: any[]) => void) => {
          if (typeof params === 'function') callback = params;
          callback!(null, [dbShapedMetadataRow({ localFileExists: 0 })]);
        }
      );

      const [row] = await databaseManager.getFilesByStatus('mapping-1', 'synced');
      expect(row.localFileExists).toBe(0);
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      await expect(databaseManager.close()).resolves.not.toThrow();
    });
  });
});
