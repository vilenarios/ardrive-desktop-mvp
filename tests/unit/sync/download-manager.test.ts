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
    // SYNC-23: a public DATA download now fails over across ALL gateways
    // (turbo-gateway.com → perma.online → arweave.net) before it surfaces a
    // failure, so the DownloadManager-level requeue only fires once the WHOLE
    // gateway list has been exhausted. Reject on every gateway to reach that
    // requeue path; the requeued attempt then succeeds on the first gateway.
    mockStreamingDownload
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // turbo-gateway.com
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // perma.online
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // arweave.net
      .mockResolvedValueOnce({ hash: goodHash }); // re-queued retry succeeds

    await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

    // Transient failure below the retry limit: retry tracked, row NOT failed yet
    expect((downloadManager as any).failedDownloads.get(FILE_ID)).toBe(1);
    expect(failedWrites()).toHaveLength(0);

    // The re-queued download is picked up and succeeds (4th call = 3 failover
    // attempts that all failed + 1 successful retry).
    await vi.waitFor(() => {
      expect(mockStreamingDownload).toHaveBeenCalledTimes(4);
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

    // SYNC-23: the 404 IS retried on the other gateways first (turbo-gateway.com
    // 404-storms data that perma.online serves fine), so downloadFile is called
    // once PER gateway (3). But once the whole ordered list is exhausted the
    // permanent 404 is recorded failed with NO DownloadManager-level requeue —
    // no *fourth* attempt is ever made.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockStreamingDownload).toHaveBeenCalledTimes(3);
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
    // SYNC-23: the first file's download fails over across all three gateways
    // before it surfaces the failure, so reject on each gateway (3 calls); the
    // second file then succeeds on its first gateway (1 call) = 4 total.
    mockStreamingDownload
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // file 1 @ turbo-gateway.com
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // file 1 @ perma.online
      .mockRejectedValueOnce(new Error('read ECONNRESET')) // file 1 @ arweave.net
      .mockResolvedValueOnce({ hash: goodHash }); // file 2 @ turbo-gateway.com

    await downloadManager.downloadMissingFiles();

    // First file's failure is recorded...
    expect(mockDatabaseManager.updateFileSyncStatus).toHaveBeenCalledWith(
      FILE_ID,
      'failed',
      expect.stringContaining('ECONNRESET')
    );
    // ...and the batch still attempted the second file
    expect(mockStreamingDownload).toHaveBeenCalledTimes(4);
    const failedForSecond = failedWrites().filter((call: any[]) => call[0] === FILE_ID_2);
    expect(failedForSecond).toHaveLength(0);
  });

  describe('expected-download tracking wiring (SYNC-13)', () => {
    // These prove DownloadManager's own call sites - not just FileStateManager
    // in isolation - correctly signal download start (with the expected size)
    // and finalize, so the fixed-timer eviction bug can't reappear here even
    // if FileStateManager's internals change later.

    it('marks the path as an expected download with the ArFS metadata size BEFORE fetching', async () => {
      await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow({ size: 2048 }));

      expect(mockFileStateManager.markAsDownloaded).toHaveBeenCalledWith(EXPECTED_LOCAL_PATH, 2048);

      // Marked before the network call, not after - so a watcher event firing
      // any time during the download is protected.
      const markOrder = mockFileStateManager.markAsDownloaded.mock.invocationCallOrder[0];
      const streamOrder = mockStreamingDownload.mock.invocationCallOrder[0];
      expect(markOrder).toBeLessThan(streamOrder);
    });

    it('clears expected-download tracking on a SUCCESSFUL finalize (not a fixed timer)', async () => {
      await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

      expect(mockFileStateManager.clearDownload).toHaveBeenCalledWith(EXPECTED_LOCAL_PATH);
    });

    it('clears expected-download tracking on a FAILED finalize too (path is not left protected forever)', async () => {
      (downloadManager as any).maxRetries = 1;
      mockStreamingDownload.mockRejectedValue(new Error('Request failed with status code 404'));

      await (downloadManager as any).startConcurrentDownload(FILE_ID, makeFileRow());

      expect(mockFileStateManager.clearDownload).toHaveBeenCalledWith(EXPECTED_LOCAL_PATH);
    });
  });
});
