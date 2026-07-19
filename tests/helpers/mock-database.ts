import { vi } from 'vitest';
import { DatabaseManager } from '@/main/database-manager';

export class MockDatabaseManager {
  public addDriveMapping = vi.fn();
  public getDriveMapping = vi.fn();
  public getDriveMappings = vi.fn();
  public updateDriveMapping = vi.fn();
  public deleteDriveMapping = vi.fn();
  public getDriveMetadata = vi.fn();
  public upsertDriveMetadata = vi.fn();
  public clearDriveMetadataCache = vi.fn();
  public updateMetadataSyncTimestamp = vi.fn();
  public updateDriveMetadataStatus = vi.fn();
  public updateFileSyncStatus = vi.fn();
  public addUploadToHistory = vi.fn();
  public getUploadHistory = vi.fn();
  public updateUploadStatus = vi.fn();
  public getUploads = vi.fn();
  public getUploadsByStatus = vi.fn();
  public getFundsBlockedUploads = vi.fn();
  public addUpload = vi.fn();
  public updateUpload = vi.fn();
  public removeUpload = vi.fn();
  public addPendingUpload = vi.fn();
  public getPendingUploads = vi.fn();
  public removePendingUpload = vi.fn();
  public updatePendingUpload = vi.fn();
  public getDownloads = vi.fn();
  public addDownload = vi.fn();
  public updateDownload = vi.fn();
  public cancelDownload = vi.fn();
  public getProcessedFiles = vi.fn();
  // SYNC-10: indexed lookups added alongside getProcessedFiles(). Derived from
  // whatever getProcessedFiles() is configured to resolve for a given test —
  // this makes them behave exactly like the pre-SYNC-10 "fetch all, filter in
  // JS" code these replaced, so existing tests that only set up
  // getProcessedFiles.mockResolvedValue([...]) keep working unchanged.
  public getProcessedFilesByHash = vi.fn(async (fileHash: string) => {
    const all = (await this.getProcessedFiles()) ?? [];
    return all.filter((f: any) => f.fileHash === fileHash);
  });
  public getProcessedFilesByPath = vi.fn(async (localPath: string) => {
    const all = (await this.getProcessedFiles()) ?? [];
    return all.filter((f: any) => f.localPath === localPath);
  });
  public addProcessedFile = vi.fn();
  public removeProcessedFile = vi.fn();
  public getLatestFileVersion = vi.fn();
  public getFileByPath = vi.fn();
  public getFolderByPath = vi.fn();
  public markFolderDeleted = vi.fn();
  public updateFilePath = vi.fn();
  public updateDriveMetadataName = vi.fn();
  public updateDriveMetadataParent = vi.fn();
  public updateDriveMetadataHidden = vi.fn();
  public addFolder = vi.fn();
  public updateFolderArweaveId = vi.fn();
  public addFileVersion = vi.fn();
  public updateFileVersionTxId = vi.fn();
  public addFileOperation = vi.fn();
  public getFileVersions = vi.fn();
  public getFileOperations = vi.fn();

  constructor() {
    // Set up default mock implementations
    this.getDriveMapping.mockResolvedValue({
      id: 'test-drive-id',
      driveId: 'test-drive-id',
      rootFolderId: 'test-root-folder-id',
      driveName: 'Test Drive',
      syncFolderPath: '/test/sync/folder',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    this.getDriveMappings.mockResolvedValue([]);
    this.getDriveMetadata.mockResolvedValue([]);
    this.upsertDriveMetadata.mockResolvedValue(undefined);
    this.clearDriveMetadataCache.mockResolvedValue(undefined);
    this.updateMetadataSyncTimestamp.mockResolvedValue(undefined);
    this.getPendingUploads.mockResolvedValue([]);
    this.getUploadHistory.mockResolvedValue([]);
    this.getUploads.mockResolvedValue([]);
    this.getUploadsByStatus.mockResolvedValue([]);
    this.getFundsBlockedUploads.mockResolvedValue([]);
    this.getDownloads.mockResolvedValue([]);
    this.getProcessedFiles.mockResolvedValue([]);
    this.getLatestFileVersion.mockResolvedValue(null);
    this.getFileByPath.mockResolvedValue(null);
    this.getFolderByPath.mockResolvedValue(null);
    this.markFolderDeleted.mockResolvedValue(undefined);
    this.updateFilePath.mockResolvedValue(undefined);
    this.updateDriveMetadataName.mockResolvedValue(undefined);
    this.updateDriveMetadataParent.mockResolvedValue(undefined);
    this.updateDriveMetadataHidden.mockResolvedValue(undefined);
    this.addFolder.mockResolvedValue(undefined);
    this.updateFolderArweaveId.mockResolvedValue(undefined);
    // SYNC-28: default to "row updated" so processUploadResult's back-fill
    // call resolves cleanly in tests that don't care about version tx ids.
    this.updateFileVersionTxId.mockResolvedValue(true);
  }

  reset() {
    vi.clearAllMocks();
  }
}

export function createMockDatabaseManager(): DatabaseManager {
  return new MockDatabaseManager() as unknown as DatabaseManager;
}
