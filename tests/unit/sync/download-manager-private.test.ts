// @vitest-environment node
//
// PRIV-1: private-drive downloads previously fetched raw ciphertext from
// https://arweave.net/{dataTxId} and wrote it into the sync folder (audit
// §3.1). They must route through ardrive-core's downloadPrivateFile, which
// decrypts to plaintext — and must fail loudly when the drive is locked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { DownloadManager } from '../../../src/main/sync/DownloadManager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { driveKeyManager } from '../../../src/main/drive-key-manager';

const { mockStreamingDownload } = vi.hoisted(() => ({
  mockStreamingDownload: vi.fn(),
}));

vi.mock('../../../src/main/sync/StreamingDownloader', () => ({
  StreamingDownloader: vi.fn().mockImplementation(() => ({
    downloadFile: mockStreamingDownload,
    cancelDownload: vi.fn(),
    cancelAllDownloads: vi.fn(),
  })),
}));

vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: {
    getDriveKey: vi.fn(),
    getPrivateKeyData: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

vi.mock('fs/promises', () => ({
  rename: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  stat: vi.fn(),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
}));

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const ROOT_FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const SYNC_PATH = '/test/sync';

const PLAINTEXT = Buffer.from('decrypted plaintext content');
const PLAINTEXT_SHA256 = crypto.createHash('sha256').update(PLAINTEXT).digest('hex');

describe('DownloadManager private downloads (PRIV-1)', () => {
  let manager: DownloadManager;
  let mockDb: any;
  let mockArDrive: any;
  let progressTracker: any;
  let fileStateManager: any;

  const fileData = {
    fileId: FILE_ID,
    name: 'secret.txt',
    path: '',
    size: PLAINTEXT.length,
    dataTxId: 'raw-data-tx-id',
    type: 'file',
  };

  const localFilePath = `${SYNC_PATH}/secret.txt`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabaseManager();
    mockArDrive = {
      downloadPrivateFile: vi.fn().mockResolvedValue(undefined),
    };
    progressTracker = {
      emitSyncProgress: vi.fn(),
      emitUploadProgress: vi.fn(),
      emitDownloadProgress: vi.fn(),
      destroy: vi.fn(),
      reset: vi.fn(),
      ensureStarted: vi.fn(),
    };
    fileStateManager = {
      setDownloadPromise: vi.fn(),
      clearDownload: vi.fn(),
      isDownloading: vi.fn(() => false),
      clearAllProcessing: vi.fn(),
      markProcessing: vi.fn(),
      isProcessing: vi.fn(() => false),
      clearProcessing: vi.fn(),
      addRecentDownload: vi.fn(),
      isRecentDownload: vi.fn(() => false),
    };

    manager = new DownloadManager(
      mockDb,
      fileStateManager,
      progressTracker,
      mockArDrive,
      DRIVE_ID,
      ROOT_FOLDER_ID,
      SYNC_PATH
    );

    vi.mocked(fs.readFile).mockResolvedValue(PLAINTEXT as any);
    vi.mocked(fs.stat).mockResolvedValue({ size: PLAINTEXT.length } as any);
  });

  afterEach(() => {
    manager.destroy();
  });

  const privateMapping = {
    id: 'mapping-1',
    driveId: DRIVE_ID,
    driveName: 'Secret Drive',
    drivePrivacy: 'private',
    rootFolderId: ROOT_FOLDER_ID,
    localFolderPath: SYNC_PATH,
    isActive: true,
  };

  it('routes private files through downloadPrivateFile and writes plaintext', async () => {
    mockDb.getDriveMappings.mockResolvedValue([privateMapping]);
    const mockKey = { keyData: Buffer.from('drive-key') };
    vi.mocked(driveKeyManager.getDriveKey).mockReturnValue(mockKey as any);

    await manager['performFileDownload'](fileData, localFilePath, SYNC_PATH, 'dl-1', 'placeholder-hash');

    // Decrypting core API used — with the drive key and the ArFS file id
    expect(mockArDrive.downloadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        driveKey: mockKey,
        destFolderPath: SYNC_PATH,
        defaultFileName: 'secret.txt.downloading',
      })
    );
    // Raw ciphertext streaming path NOT used
    expect(mockStreamingDownload).not.toHaveBeenCalled();
    // Temp name renamed into place (watcher ignores .downloading)
    expect(fs.rename).toHaveBeenCalledWith(
      path.join(SYNC_PATH, 'secret.txt.downloading'),
      localFilePath
    );
    // The PLAINTEXT hash (not ciphertext) is what enters processed_files
    expect(mockDb.addProcessedFile).toHaveBeenCalledWith(
      PLAINTEXT_SHA256,
      'secret.txt',
      PLAINTEXT.length,
      localFilePath,
      'download',
      FILE_ID
    );
    // Completion recorded
    expect(mockDb.updateDownload).toHaveBeenCalledWith('dl-1', {
      status: 'completed',
      progress: 100,
    });
  });

  it('fails loudly when the private drive is locked — no ciphertext fallback', async () => {
    mockDb.getDriveMappings.mockResolvedValue([privateMapping]);
    vi.mocked(driveKeyManager.getDriveKey).mockReturnValue(undefined);

    await expect(
      manager['performFileDownload'](fileData, localFilePath, SYNC_PATH, 'dl-1', 'placeholder-hash')
    ).rejects.toThrow(/Private drive is locked/);

    expect(mockArDrive.downloadPrivateFile).not.toHaveBeenCalled();
    expect(mockStreamingDownload).not.toHaveBeenCalled();
    // Nothing recorded as completed
    expect(
      mockDb.updateDownload.mock.calls.some((c: any[]) => c[1]?.status === 'completed')
    ).toBe(false);
  });

  it('public drives keep the streaming download path', async () => {
    mockDb.getDriveMappings.mockResolvedValue([
      { ...privateMapping, drivePrivacy: 'public' },
    ]);
    mockStreamingDownload.mockResolvedValue({ hash: 'streamed-hash' });

    await manager['performFileDownload'](fileData, localFilePath, SYNC_PATH, 'dl-1', 'placeholder-hash');

    expect(mockStreamingDownload).toHaveBeenCalledWith(
      `https://arweave.net/${fileData.dataTxId}`,
      localFilePath,
      'dl-1',
      expect.any(Object)
    );
    expect(mockArDrive.downloadPrivateFile).not.toHaveBeenCalled();
  });

  it('propagates decryption/download failures from the core call', async () => {
    mockDb.getDriveMappings.mockResolvedValue([privateMapping]);
    vi.mocked(driveKeyManager.getDriveKey).mockReturnValue({ keyData: Buffer.from('k') } as any);
    mockArDrive.downloadPrivateFile.mockRejectedValue(new Error('decrypt failed'));

    await expect(
      manager['performFileDownload'](fileData, localFilePath, SYNC_PATH, 'dl-1', 'placeholder-hash')
    ).rejects.toThrow('decrypt failed');

    // No rename, nothing completed
    expect(fs.rename).not.toHaveBeenCalled();
    expect(
      mockDb.updateDownload.mock.calls.some((c: any[]) => c[1]?.status === 'completed')
    ).toBe(false);
  });
});
