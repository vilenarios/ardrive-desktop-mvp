// @vitest-environment node
//
// SYNC-2 behavioral tests: failed downloads must be recorded as failed.
// DownloadManager previously swallowed downloadFile errors, so
// startConcurrentDownload unconditionally wrote syncStatus='synced',
// localFileExists=true even when nothing landed on disk, and the
// retry/permanent-error classification was unreachable dead code.
//
// Main-process suite: runs under node (not jsdom) - see sync-manager.test.ts
// for the ecc-library rationale.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DownloadManager } from '@/main/sync/DownloadManager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';

const { mockWebContentsSend, mockGetAllWindows, fsMocks, mockStreamingDownload, mockCancelDownload, mockCancelAllDownloads } = vi.hoisted(() => {
  const mockWebContentsSend = vi.fn();
  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: mockWebContentsSend,
      isDestroyed: () => false,
    },
  };
  return {
    mockWebContentsSend,
    mockGetAllWindows: vi.fn(() => [mockWindow]),
    fsMocks: {
      access: vi.fn(),
      mkdir: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      rename: vi.fn(),
      rm: vi.fn(),
    },
    mockStreamingDownload: vi.fn(),
    mockCancelDownload: vi.fn(),
    mockCancelAllDownloads: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
  },
}));

vi.mock('fs/promises', () => fsMocks);

vi.mock('@/main/sync/StreamingDownloader', () => ({
  StreamingDownloader: vi.fn(() => ({
    downloadFile: mockStreamingDownload,
    cancelDownload: mockCancelDownload,
    cancelAllDownloads: mockCancelAllDownloads,
  })),
}));

const TEST_DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_ROOT_FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SYNC_PATH = '/test/sync/folder';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const FILE_ID_2 = '44444444-4444-4444-8444-444444444444';
const EXPECTED_LOCAL_PATH = '/test/sync/folder/docs/report.pdf';

// DB-shaped fixture: rows come from node-sqlite3, so booleans are integers
// (0/1) and absent values are null - NOT false/undefined.
const makeFileRow = (overrides: Record<string, unknown> = {}) => ({
  fileId: FILE_ID,
  mappingId: 'mapping-1',
  parentFolderId: TEST_ROOT_FOLDER_ID,
  name: 'report.pdf',
  path: 'docs',
  type: 'file',
  size: 2048,
  lastModifiedDate: 1751500000000,
  dataTxId: 'dTxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
  metadataTxId: 'mTxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
  contentType: 'application/pdf',
  localFileExists: 0,
  syncStatus: 'pending',
  lastError: null,
  ...overrides,
});

const goodStats = { size: 2048, isFile: () => true, isDirectory: () => false };
const goodHash = 'a1b2c3d4'.repeat(8);

describe('DownloadManager download-status truth (SYNC-2)', () => {
  let downloadManager: DownloadManager;
  let mockDatabaseManager: any;
  let mockFileStateManager: any;
  let mockProgressTracker: any;

  const syncedWrites = () =>
    mockDatabaseManager.updateDriveMetadataStatus.mock.calls.filter(
      (call: any[]) => call[1] === 'synced'
    );

  const failedWrites = () =>
    mockDatabaseManager.updateFileSyncStatus.mock.calls.filter(
      (call: any[]) => call[1] === 'failed'
    );

  beforeEach(() => {
    mockWebContentsSend.mockClear();
    mockStreamingDownload.mockReset().mockResolvedValue({ hash: goodHash });
    fsMocks.access.mockReset().mockRejectedValue(new Error('ENOENT'));
    fsMocks.mkdir.mockReset().mockResolvedValue(undefined);
    fsMocks.stat.mockReset().mockResolvedValue(goodStats);

    mockDatabaseManager = createMockDatabaseManager();
    mockFileStateManager = {
      isFileBeingProcessed: vi.fn(() => false),
      markAsDownloaded: vi.fn(),
      isRecentlyDownloaded: vi.fn(() => false),
      markAsProcessing: vi.fn(),
      clearProcessing: vi.fn(),
      isDownloading: vi.fn(() => false),
      setDownloadPromise: vi.fn(),
      getDownloadPromise: vi.fn(() => undefined),
      clearDownload: vi.fn(),
      setProcessingTimeout: vi.fn(),
      clearProcessingTimeout: vi.fn(),
      clearAllProcessing: vi.fn(),
    };
    mockProgressTracker = {
      emitSyncProgress: vi.fn(),
      emitUploadProgress: vi.fn(),
      emitDownloadProgress: vi.fn(),
      destroy: vi.fn(),
    };

    downloadManager = new DownloadManager(
      mockDatabaseManager,
      mockFileStateManager,
      mockProgressTracker,
      createMockArDrive(),
      TEST_DRIVE_ID,
      TEST_ROOT_FOLDER_ID,
      TEST_SYNC_PATH
    );
  });

  afterEach(() => {
    downloadManager.destroy();
  });

  it('(a) records failed - not synced - when the fetch rejects mid-stream', async () => {
    // Single attempt so the transient error is recorded instead of re-queued
    (downloadManager as any).maxRetries = 1;
    mockStreamingDownload.mockRejectedValue(new Error('read ECONNRESET'));

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    // Drive metadata row: failed with the error message, never synced
    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('ECONNRESET')
    );
    expect(syncedWrites()).toHaveLength(0);

    // Downloads-table row is also honest
    expect(mockDatabaseManager.updateDownload).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('ECONNRESET'),
      })
    );

    // UI is told about the failure over the existing channel
    expect(mockWebContentsSend).toHaveBeenCalledWith('sync:file-state-changed', {
      fileId: FILE_ID,
      syncStatus: 'failed',
    });
  });

  it('(b) records failed when the temp-file finalize (rename) fails', async () => {
    (downloadManager as any).maxRetries = 1;
    // StreamingDownloader wraps rename failures in this message
    mockStreamingDownload.mockRejectedValue(
      new Error('Failed to save downloaded file: Error: EACCES: permission denied')
    );

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('Failed to save downloaded file')
    );
    expect(syncedWrites()).toHaveLength(0);
  });

  it('(c) marks synced only after the on-disk existence check passes', async () => {
    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    expect(fsMocks.stat).toHaveBeenCalledWith(EXPECTED_LOCAL_PATH);
    expect(mockDatabaseManager.updateDriveMetadataStatus).toHaveBeenCalledWith(
      FILE_ID,
      'synced',
      true
    );

    // The existence check runs before the synced write
    const lastStatOrder = Math.max(...fsMocks.stat.mock.invocationCallOrder);
    const syncedCallIndex = mockDatabaseManager.updateDriveMetadataStatus.mock.calls.findIndex(
      (call: any[]) => call[1] === 'synced'
    );
    const syncedOrder =
      mockDatabaseManager.updateDriveMetadataStatus.mock.invocationCallOrder[syncedCallIndex];
    expect(lastStatOrder).toBeLessThan(syncedOrder);
  });

  it('(c) never writes synced when the file is missing on disk after a "successful" download', async () => {
    (downloadManager as any).maxRetries = 1;
    // First stat: performFileDownload's internal size check passes.
    // Second stat: the caller's existence verification finds nothing on disk.
    fsMocks.stat
      .mockResolvedValueOnce(goodStats)
      .mockRejectedValue(Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }));

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    expect(syncedWrites()).toHaveLength(0);
    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('missing on disk')
    );
  });

  it('(d) re-queues transient failures and the retry actually runs (formerly dead code)', async () => {
    mockStreamingDownload
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce({ hash: goodHash });

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    // Transient failure below the retry limit: retry tracked, row NOT failed yet
    expect((downloadManager as any).failedDownloads.get(FILE_ID)).toBe(1);
    expect(failedWrites()).toHaveLength(0);

    // The re-queued download is picked up and succeeds on the second attempt
    await vi.waitFor(() => {
      expect(mockStreamingDownload).toHaveBeenCalledTimes(2);
      expect(mockDatabaseManager.updateDriveMetadataStatus).toHaveBeenCalledWith(
        FILE_ID,
        'synced',
        true
      );
    });
  });

  it('(e) permanent errors are recorded failed with no retry', async () => {
    mockStreamingDownload.mockRejectedValue(
      new Error('Request failed with status code 404')
    );

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('404')
    );
    expect(syncedWrites()).toHaveLength(0);
    expect((downloadManager as any).downloadQueue.has(FILE_ID)).toBe(false);
    expect((downloadManager as any).failedDownloads.has(FILE_ID)).toBe(false);

    // No second attempt is ever made
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockStreamingDownload).toHaveBeenCalledTimes(1);
  });

  it('(e) oversized files fail permanently without touching the network and are never synced', async () => {
    const hugeRow = makeFileRow({ size: 6 * 1024 * 1024 * 1024 }); // over the 5GB cap

    await (downloadManager as any).startConcurrentDownload(FILE_ID, hugeRow);

    expect(mockStreamingDownload).not.toHaveBeenCalled();
    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('File too large')
    );
    expect(syncedWrites()).toHaveLength(0);
    expect((downloadManager as any).downloadQueue.has(FILE_ID)).toBe(false);
  });

  it('sequential downloadMissingFiles records per-file failures and continues the batch', async () => {
    mockDatabaseManager.getDriveMappings.mockResolvedValue([
      {
        id: 'mapping-1',
        driveId: TEST_DRIVE_ID,
        driveName: 'Test Drive',
        drivePrivacy: 'public',
        rootFolderId: TEST_ROOT_FOLDER_ID,
        localFolderPath: TEST_SYNC_PATH,
        isActive: 1, // DB-shaped integer boolean
      },
    ]);
    mockDatabaseManager.getDriveMetadata.mockResolvedValue([
      makeFileRow(),
      makeFileRow({ fileId: FILE_ID_2, name: 'second.pdf' }),
    ]);
    mockStreamingDownload
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockResolvedValueOnce({ hash: goodHash });

    await downloadManager.downloadMissingFiles();

    // First file's failure is recorded...
    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('ECONNRESET')
    );
    // ...and the batch still attempted the second file
    expect(mockStreamingDownload).toHaveBeenCalledTimes(2);
    const failedForSecond = failedWrites().filter((call: any[]) => call[0] === FILE_ID_2);
    expect(failedForSecond).toHaveLength(0);
  });
});
