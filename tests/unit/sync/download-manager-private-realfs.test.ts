// @vitest-environment node
//
// ============================================================================
// QA-GATE PROBE for PRIV-1 (re-verification round, commit 4c3973d) —
// Adopted from the PRIV-1 qa-gate round-2 verification (2026-07-03). Real filesystem (fs/promises NOT mocked); fake
// arDrive.downloadPrivateFile reproduces ardrive-core-js's verified
// semantics (write plaintext to join(destFolderPath, defaultFileName)).
// DISCARD BEFORE MERGE.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as os from 'os';
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

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const ROOT_FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';

const PLAINTEXT = Buffer.from('QA probe round-2 decrypted plaintext — PRIV-1');
const PLAINTEXT_SHA256 = crypto.createHash('sha256').update(PLAINTEXT).digest('hex');
const MANIFEST_BODY = Buffer.from('{"manifest":"arweave/paths","version":"0.1.0","paths":{}}');
const MANIFEST_SHA256 = crypto.createHash('sha256').update(MANIFEST_BODY).digest('hex');

describe('QA PROBE round 2: PRIV-1 after 4c3973d', () => {
  let tmpDir: string;
  let manager: DownloadManager;
  let mockDb: any;
  let mockArDrive: any;

  const mapping = (privacy: 'private' | 'public') => ({
    id: 'mapping-1',
    driveId: DRIVE_ID,
    driveName: 'Drive',
    drivePrivacy: privacy,
    rootFolderId: ROOT_FOLDER_ID,
    localFolderPath: '',
    isActive: true,
  });

  const mkManager = (arDrive: any) =>
    new DownloadManager(
      mockDb,
      {
        setDownloadPromise: vi.fn(),
        clearDownload: vi.fn(),
        isDownloading: vi.fn(() => false),
        clearAllProcessing: vi.fn(),
        markProcessing: vi.fn(),
        isProcessing: vi.fn(() => false),
        clearProcessing: vi.fn(),
        addRecentDownload: vi.fn(),
        isRecentDownload: vi.fn(() => false),
        markAsDownloaded: vi.fn(),
        getDownloadPromise: vi.fn(),
      } as any,
      {
        emitSyncProgress: vi.fn(),
        emitUploadProgress: vi.fn(),
        emitDownloadProgress: vi.fn(),
        destroy: vi.fn(),
        reset: vi.fn(),
        ensureStarted: vi.fn(),
      } as any,
      arDrive,
      DRIVE_ID,
      ROOT_FOLDER_ID,
      tmpDir
    );

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-priv1-r2-'));
    mockDb = createMockDatabaseManager();
    vi.mocked(driveKeyManager.getDriveKey).mockReturnValue({
      keyData: Buffer.from('fake-drive-key'),
    } as any);
    // Core-faithful: writes decrypted plaintext to destFolderPath/defaultFileName
    mockArDrive = {
      downloadPrivateFile: vi.fn(async ({ destFolderPath, defaultFileName }: any) => {
        await fs.access(destFolderPath);
        await fs.writeFile(path.join(destFolderPath, defaultFileName), PLAINTEXT);
      }),
    };
  });

  afterEach(async () => {
    manager?.destroy();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('INVERTED DEFECT PROBE: manifest-NAMED file in a PRIVATE drive now decrypts to plaintext (real fs)', async () => {
    mockDb.getDriveMappings.mockResolvedValue([mapping('private')]);
    manager = mkManager(mockArDrive);
    const localFilePath = path.join(tmpDir, 'manifest.json');
    const fileData = {
      fileId: FILE_ID,
      name: 'manifest.json', // exact name that previously bypassed decryption
      path: '',
      size: PLAINTEXT.length,
      dataTxId: 'raw-data-tx-id',
      type: 'file',
      contentType: 'application/json',
    };

    await manager['performFileDownload'](fileData, localFilePath, tmpDir, 'dl-1', 'ph-1');

    // Decrypt route used; raw fetch untouched
    expect(mockArDrive.downloadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({ destFolderPath: tmpDir, defaultFileName: 'manifest.json.downloading' })
    );
    expect(mockStreamingDownload).not.toHaveBeenCalled();
    // PLAINTEXT on disk at final path, hash-equal; temp gone
    const onDisk = await fs.readFile(localFilePath);
    expect(onDisk.equals(PLAINTEXT)).toBe(true);
    await expect(fs.access(`${localFilePath}.downloading`)).rejects.toThrow();
    // plaintext hash recorded, completed
    expect(mockDb.addProcessedFile).toHaveBeenCalledWith(
      PLAINTEXT_SHA256, 'manifest.json', PLAINTEXT.length, localFilePath, 'download', FILE_ID
    );
    expect(mockDb.updateDownload).toHaveBeenCalledWith('dl-1', { status: 'completed', progress: 100 });
  });

  it('REGRESSION: a REAL manifest in a PUBLIC drive still takes downloadManifestFile (raw /raw/ fetch)', async () => {
    mockDb.getDriveMappings.mockResolvedValue([mapping('public')]);
    manager = mkManager(mockArDrive);
    const localFilePath = path.join(tmpDir, 'DriveManifest.json');
    const fileData = {
      fileId: FILE_ID,
      name: 'DriveManifest.json',
      path: '',
      size: MANIFEST_BODY.length,
      dataTxId: 'manifest-tx',
      type: 'file',
      contentType: 'application/x.arweave-manifest+json',
    };
    mockStreamingDownload.mockImplementation(async (_url: string, dest: string) => {
      await fs.writeFile(dest, MANIFEST_BODY);
      return { hash: MANIFEST_SHA256 };
    });

    await manager['performFileDownload'](fileData, localFilePath, tmpDir, 'dl-2', 'ph-2');

    expect(mockStreamingDownload).toHaveBeenCalledWith(
      'https://arweave.net/raw/manifest-tx',
      localFilePath,
      'dl-2',
      expect.any(Object)
    );
    expect(mockArDrive.downloadPrivateFile).not.toHaveBeenCalled();
    expect(mockDb.updateDownload).toHaveBeenCalledWith('dl-2', { status: 'completed', progress: 100 });
  });

  it('REGRESSION: ordinary PUBLIC file keeps the direct streaming path (non-raw URL)', async () => {
    mockDb.getDriveMappings.mockResolvedValue([mapping('public')]);
    manager = mkManager(mockArDrive);
    const localFilePath = path.join(tmpDir, 'photo.jpg');
    const fileData = {
      fileId: FILE_ID,
      name: 'photo.jpg',
      path: '',
      size: MANIFEST_BODY.length,
      dataTxId: 'pub-tx',
      type: 'file',
    };
    mockStreamingDownload.mockImplementation(async (_url: string, dest: string) => {
      await fs.writeFile(dest, MANIFEST_BODY);
      return { hash: MANIFEST_SHA256 };
    });

    await manager['performFileDownload'](fileData, localFilePath, tmpDir, 'dl-3', 'ph-3');

    expect(mockStreamingDownload).toHaveBeenCalledWith(
      'https://arweave.net/pub-tx',
      localFilePath,
      'dl-3',
      expect.any(Object)
    );
    expect(mockArDrive.downloadPrivateFile).not.toHaveBeenCalled();
  });

  it('REAL FS: ordinary private file round-trip still plaintext (round-1 probe 1 re-run)', async () => {
    mockDb.getDriveMappings.mockResolvedValue([mapping('private')]);
    manager = mkManager(mockArDrive);
    const localFilePath = path.join(tmpDir, 'secret.txt');
    const fileData = {
      fileId: FILE_ID,
      name: 'secret.txt',
      path: '',
      size: PLAINTEXT.length,
      dataTxId: 'raw-data-tx-id',
      type: 'file',
    };

    await manager['performFileDownload'](fileData, localFilePath, tmpDir, 'dl-4', 'ph-4');

    const onDisk = await fs.readFile(localFilePath);
    expect(crypto.createHash('sha256').update(onDisk).digest('hex')).toBe(PLAINTEXT_SHA256);
    expect(mockDb.addProcessedFile).toHaveBeenCalledWith(
      PLAINTEXT_SHA256, 'secret.txt', PLAINTEXT.length, localFilePath, 'download', FILE_ID
    );
  });

  it('REAL FS: locked private drive still fails loudly for manifest-named files too (no raw fallback)', async () => {
    mockDb.getDriveMappings.mockResolvedValue([mapping('private')]);
    vi.mocked(driveKeyManager.getDriveKey).mockReturnValue(undefined);
    manager = mkManager(mockArDrive);
    const localFilePath = path.join(tmpDir, 'manifest.json');
    const fileData = {
      fileId: FILE_ID,
      name: 'manifest.json',
      path: '',
      size: 10,
      dataTxId: 'raw-data-tx-id',
      type: 'file',
    };

    await expect(
      manager['performFileDownload'](fileData, localFilePath, tmpDir, 'dl-5', 'ph-5')
    ).rejects.toThrow(/Private drive is locked/);
    expect(mockStreamingDownload).not.toHaveBeenCalled();
    expect(mockArDrive.downloadPrivateFile).not.toHaveBeenCalled();
    // nothing written to disk
    await expect(fs.access(localFilePath)).rejects.toThrow();
  });
});
