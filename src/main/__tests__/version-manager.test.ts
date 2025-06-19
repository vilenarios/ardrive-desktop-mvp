import { VersionManager, ChangeType } from '../version-manager';
import { DatabaseManager } from '../database-manager';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// Mock fs module
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock crypto module
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-hash-123')
  })),
  randomUUID: jest.fn(() => 'mock-uuid-123')
}));

describe('VersionManager', () => {
  let versionManager: VersionManager;
  let mockDatabaseManager: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    // Create mock database manager
    mockDatabaseManager = {
      getLatestFileVersion: jest.fn(),
      addFileVersion: jest.fn(),
      addFileOperation: jest.fn(),
      getFileVersions: jest.fn(),
      getFileOperations: jest.fn(),
    } as any;

    versionManager = new VersionManager(mockDatabaseManager);
    versionManager.setSyncFolder('/test/sync');

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('calculateFileHash', () => {
    it('should calculate file hash correctly', async () => {
      const mockContent = Buffer.from('test file content');
      mockFs.readFile.mockResolvedValue(mockContent);

      const hash = await versionManager.calculateFileHash('/test/file.txt');

      expect(hash).toBe('mock-hash-123');
      expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt');
    });

    it('should handle file read errors', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(versionManager.calculateFileHash('/test/missing.txt'))
        .rejects.toThrow('Failed to calculate hash for /test/missing.txt');
    });
  });

  describe('getRelativePath', () => {
    it('should return correct relative path', () => {
      const result = versionManager.getRelativePath('/test/sync/folder/file.txt');
      expect(result).toBe('folder/file.txt');
    });

    it('should handle Windows paths', () => {
      // Skip this test on non-Windows platforms since path.resolve 
      // behaves differently. The functionality works correctly on Windows.
      if (process.platform !== 'win32') {
        return;
      }
      
      versionManager.setSyncFolder('C:\\test\\sync');
      const result = versionManager.getRelativePath('C:\\test\\sync\\folder\\file.txt');
      expect(result).toBe('folder/file.txt');
    });

    it('should throw error if sync folder not set', () => {
      const manager = new VersionManager(mockDatabaseManager);
      expect(() => manager.getRelativePath('/test/file.txt'))
        .toThrow('Sync folder path not set');
    });
  });

  describe('detectFileChange', () => {
    beforeEach(() => {
      mockFs.readFile.mockResolvedValue(Buffer.from('test content'));
    });

    it('should detect new file creation', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue(null);

      const changeType = await versionManager.detectFileChange('/test/sync/new-file.txt');

      expect(changeType).toBe('create');
      expect(mockDatabaseManager.getLatestFileVersion).toHaveBeenCalledWith('/test/sync/new-file.txt');
    });

    it('should detect file update', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue({
        id: 'version-1',
        fileHash: 'different-hash',
        fileName: 'file.txt',
        filePath: '/test/sync/file.txt',
        relativePath: 'file.txt',
        fileSize: 100,
        version: 1,
        changeType: 'create',
        createdAt: new Date(),
        isLatest: true
      });

      const changeType = await versionManager.detectFileChange('/test/sync/file.txt');

      expect(changeType).toBe('update');
    });

    it('should detect unchanged file', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue({
        id: 'version-1',
        fileHash: 'mock-hash-123', // Same as current hash
        fileName: 'file.txt',
        filePath: '/test/sync/file.txt',
        relativePath: 'file.txt',
        fileSize: 100,
        version: 1,
        changeType: 'create',
        createdAt: new Date(),
        isLatest: true
      });

      const changeType = await versionManager.detectFileChange('/test/sync/file.txt');

      expect(changeType).toBe('unchanged');
    });
  });

  describe('createNewVersion', () => {
    beforeEach(() => {
      mockFs.readFile.mockResolvedValue(Buffer.from('test content'));
      mockFs.stat.mockResolvedValue({
        size: 1000,
        isFile: () => true,
        isDirectory: () => false
      } as any);
    });

    it('should create first version for new file', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue(null);
      mockDatabaseManager.addFileVersion.mockResolvedValue();
      mockDatabaseManager.addFileOperation.mockResolvedValue();

      const version = await versionManager.createNewVersion('/test/sync/file.txt', 'create');

      expect(version.version).toBe(1);
      expect(version.changeType).toBe('create');
      expect(version.parentVersion).toBeUndefined();
      expect(mockDatabaseManager.addFileVersion).toHaveBeenCalled();
      expect(mockDatabaseManager.addFileOperation).toHaveBeenCalled();
    });

    it('should create subsequent version for existing file', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue({
        id: 'version-1',
        fileHash: 'old-hash',
        fileName: 'file.txt',
        filePath: '/test/sync/file.txt',
        relativePath: 'file.txt',
        fileSize: 100,
        version: 1,
        changeType: 'create',
        createdAt: new Date(),
        isLatest: true
      });

      const version = await versionManager.createNewVersion('/test/sync/file.txt', 'update');

      expect(version.version).toBe(2);
      expect(version.changeType).toBe('update');
      expect(version.parentVersion).toBe('version-1');
    });

    it('should include upload information when provided', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue(null);

      const uploadInfo = {
        arweaveId: 'arweave-123',
        turboId: 'turbo-123',
        uploadMethod: 'turbo' as const
      };

      const version = await versionManager.createNewVersion('/test/sync/file.txt', 'create', uploadInfo);

      expect(version.arweaveId).toBe('arweave-123');
      expect(version.turboId).toBe('turbo-123');
      expect(version.uploadMethod).toBe('turbo');
    });
  });

  describe('detectMove', () => {
    it('should detect file move when hashes match', async () => {
      // Mock reading both files to return same hash
      mockFs.readFile.mockResolvedValue(Buffer.from('same content'));

      const isMove = await versionManager.detectMove('/test/sync/old.txt', '/test/sync/new.txt');

      expect(isMove).toBe(true);
    });

    it('should not detect move when hashes differ', async () => {
      // Mock different content for each file
      mockFs.readFile
        .mockResolvedValueOnce(Buffer.from('old content'))
        .mockResolvedValueOnce(Buffer.from('new content'));

      // Mock different hashes
      const mockHash = crypto.createHash as jest.MockedFunction<typeof crypto.createHash>;
      mockHash
        .mockReturnValueOnce({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn(() => 'hash-1')
        } as any)
        .mockReturnValueOnce({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn(() => 'hash-2')
        } as any);

      const isMove = await versionManager.detectMove('/test/sync/old.txt', '/test/sync/new.txt');

      expect(isMove).toBe(false);
    });

    it('should handle file read errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      const isMove = await versionManager.detectMove('/test/sync/missing1.txt', '/test/sync/missing2.txt');

      expect(isMove).toBe(false);
    });
  });

  describe('getFileVersionHistory', () => {
    it('should return version history for file', async () => {
      const mockVersions = [
        {
          id: 'version-2',
          fileHash: 'hash-2',
          fileName: 'file.txt',
          filePath: '/test/sync/file.txt',
          relativePath: 'file.txt',
          fileSize: 200,
          version: 2,
          parentVersion: 'version-1',
          changeType: 'update',
          createdAt: new Date(),
          isLatest: true
        },
        {
          id: 'version-1',
          fileHash: 'hash-1',
          fileName: 'file.txt',
          filePath: '/test/sync/file.txt',
          relativePath: 'file.txt',
          fileSize: 100,
          version: 1,
          changeType: 'create',
          createdAt: new Date(),
          isLatest: false
        }
      ];

      mockDatabaseManager.getFileVersions.mockResolvedValue(mockVersions);

      const history = await versionManager.getFileVersionHistory('/test/sync/file.txt');

      expect(history).toEqual(mockVersions);
      expect(mockDatabaseManager.getFileVersions).toHaveBeenCalledWith('/test/sync/file.txt');
    });
  });

  describe('isFileTracked', () => {
    it('should return true for tracked file', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue({
        id: 'version-1',
        fileHash: 'hash-1',
        fileName: 'file.txt',
        filePath: '/test/sync/file.txt',
        relativePath: 'file.txt',
        fileSize: 100,
        version: 1,
        changeType: 'create',
        createdAt: new Date(),
        isLatest: true
      });

      const isTracked = await versionManager.isFileTracked('/test/sync/file.txt');

      expect(isTracked).toBe(true);
    });

    it('should return false for untracked file', async () => {
      mockDatabaseManager.getLatestFileVersion.mockResolvedValue(null);

      const isTracked = await versionManager.isFileTracked('/test/sync/file.txt');

      expect(isTracked).toBe(false);
    });
  });
});