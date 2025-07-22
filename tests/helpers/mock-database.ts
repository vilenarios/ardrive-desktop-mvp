import { DatabaseManager } from '@/main/database-manager';

export class MockDatabaseManager {
  public addDriveMapping = vi.fn();
  public getDriveMapping = vi.fn();
  public updateDriveMapping = vi.fn();
  public deleteDriveMapping = vi.fn();
  public addUploadToHistory = vi.fn();
  public getUploadHistory = vi.fn();
  public updateUploadStatus = vi.fn();
  public addPendingUpload = vi.fn();
  public getPendingUploads = vi.fn();
  public removePendingUpload = vi.fn();
  public updatePendingUpload = vi.fn();

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
    this.getPendingUploads.mockResolvedValue([]);
    this.getUploadHistory.mockResolvedValue([]);
  }

  reset() {
    vi.clearAllMocks();
  }
}

export function createMockDatabaseManager(): DatabaseManager {
  return new MockDatabaseManager() as unknown as DatabaseManager;
}