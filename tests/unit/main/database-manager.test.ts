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
      if (callback) callback(null);
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

  describe('close', () => {
    it('should close the database connection', async () => {
      await expect(databaseManager.close()).resolves.not.toThrow();
    });
  });
});
