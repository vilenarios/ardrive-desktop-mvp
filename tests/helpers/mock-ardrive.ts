import { vi } from 'vitest';
import { ArDrive } from 'ardrive-core-js';

export class MockArDrive {
  public getAllFoldersInDrive = vi.fn();
  public getAllFilesInDrive = vi.fn();
  public listPublicFolder = vi.fn();
  public listPrivateFolder = vi.fn();
  public downloadFileData = vi.fn();
  public uploadPublicFile = vi.fn();
  public createPublicFolder = vi.fn();
  public getPublicFolder = vi.fn();
  public getPublicFile = vi.fn();
  // SYNC-5 hide/unhide (metadata revision) — mocked so tests NEVER spend.
  public hidePublicFile = vi.fn();
  public hidePrivateFile = vi.fn();
  public hidePublicFolder = vi.fn();
  public hidePrivateFolder = vi.fn();
  public unhidePublicFile = vi.fn();
  public unhidePrivateFile = vi.fn();
  public unhidePublicFolder = vi.fn();
  public unhidePrivateFolder = vi.fn();

  constructor() {
    // Set up default mock implementations
    this.getAllFoldersInDrive.mockResolvedValue([]);
    this.getAllFilesInDrive.mockResolvedValue([]);
    this.listPublicFolder.mockResolvedValue([]);
    this.listPrivateFolder.mockResolvedValue([]);
    this.downloadFileData.mockResolvedValue(Buffer.from('test data'));
    this.uploadPublicFile.mockResolvedValue({
      created: [{ entityId: 'test-file-id' }]
    });
    this.createPublicFolder.mockResolvedValue({
      created: [{ entityId: 'test-folder-id' }]
    });
    const hideResult = { created: [{ type: 'file', metadataTxId: { toString: () => 'hide-meta-tx' } }], fees: {} };
    this.hidePublicFile.mockResolvedValue(hideResult);
    this.hidePrivateFile.mockResolvedValue(hideResult);
    this.hidePublicFolder.mockResolvedValue(hideResult);
    this.hidePrivateFolder.mockResolvedValue(hideResult);
    this.unhidePublicFile.mockResolvedValue(hideResult);
    this.unhidePrivateFile.mockResolvedValue(hideResult);
    this.unhidePublicFolder.mockResolvedValue(hideResult);
    this.unhidePrivateFolder.mockResolvedValue(hideResult);
  }

  reset() {
    vi.clearAllMocks();
  }
}

export function createMockArDrive(): ArDrive {
  return new MockArDrive() as unknown as ArDrive;
}