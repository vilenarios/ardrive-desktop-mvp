import { ArDrive } from 'ardrive-core-js';

export class MockArDrive {
  public getAllFoldersInDrive = vi.fn();
  public getAllFilesInDrive = vi.fn();
  public downloadFileData = vi.fn();
  public uploadPublicFile = vi.fn();
  public createPublicFolder = vi.fn();
  public getPublicFolder = vi.fn();
  public getPublicFile = vi.fn();

  constructor() {
    // Set up default mock implementations
    this.getAllFoldersInDrive.mockResolvedValue([]);
    this.getAllFilesInDrive.mockResolvedValue([]);
    this.downloadFileData.mockResolvedValue(Buffer.from('test data'));
    this.uploadPublicFile.mockResolvedValue({
      created: [{ entityId: 'test-file-id' }]
    });
    this.createPublicFolder.mockResolvedValue({
      created: [{ entityId: 'test-folder-id' }]
    });
  }

  reset() {
    vi.clearAllMocks();
  }
}

export function createMockArDrive(): ArDrive {
  return new MockArDrive() as unknown as ArDrive;
}