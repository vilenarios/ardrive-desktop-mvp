import { DatabaseManager } from '../database-manager';
import { FileUpload, PendingUpload } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-ardrive'),
  },
}));

// Mock sqlite3
const mockDbInstance = {
  exec: jest.fn((sql, callback) => {
    if (callback) callback(null);
  }),
  run: jest.fn((sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
    }
    if (callback) callback(null);
  }),
  get: jest.fn((sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
    }
    if (callback) callback(null, null);
  }),
  all: jest.fn((sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
    }
    if (callback) callback(null, []);
  }),
  close: jest.fn((callback) => {
    if (callback) callback(null);
  }),
};

jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation((dbPath, callback) => {
    // Simulate successful database connection
    if (callback) callback(null);
    
    return mockDbInstance;
  }),
}));

describe('DatabaseManager', () => {
  let databaseManager: DatabaseManager;

  beforeEach(async () => {
    databaseManager = new DatabaseManager();
    jest.clearAllMocks();
    
    // Mock the private db property directly
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
      const fileHash = 'abc123';
      
      const result = await databaseManager.isFileProcessed(fileHash);
      expect(typeof result).toBe('boolean');
    });

    it('should get processed files list', async () => {
      const result = await databaseManager.getProcessedFiles();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should remove a processed file', async () => {
      const fileHash = 'abc123';
      
      await expect(
        databaseManager.removeProcessedFile(fileHash)
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
      mockDbInstance.get.mockImplementation((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
        }
        
        if (sql.includes('isLatest = 1')) {
          // Mock latest version response
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

      mockDbInstance.all.mockImplementation((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
        }
        
        if (sql.includes('file_versions')) {
          // Mock versions list response
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
      mockDbInstance.get.mockImplementationOnce((sql, params, callback) => {
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
      mockDbInstance.all.mockImplementationOnce((sql, params, callback) => {
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
    const mockFolder = {
      id: 'folder-1',
      folderPath: '/path/to/folder',
      relativePath: 'folder',
      parentPath: '/path/to',
      arweaveFolderId: 'arweave-folder-123',
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
          mockFolder.arweaveFolderId
        ]),
        expect.any(Function)
      );
    });

    it('should get folders', async () => {
      mockDbInstance.all.mockImplementationOnce((sql, params, callback) => {
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
      mockDbInstance.get.mockImplementationOnce((sql, params, callback) => {
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
      mockDbInstance.get.mockImplementationOnce((sql, params, callback) => {
        if (typeof params === 'function') {
          callback = params;
        }
        callback(null, null);
      });

      const result = await databaseManager.getFolderByPath('/path/to/nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      await expect(databaseManager.close()).resolves.not.toThrow();
    });
  });
});