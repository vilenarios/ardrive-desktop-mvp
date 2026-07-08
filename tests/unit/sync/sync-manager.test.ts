// @vitest-environment node
//
// Main-process suite: runs under node (not jsdom). Under jsdom the transitive
// ardrive-core-js / @ardrive/turbo-sdk -> @keplr-wallet/crypto -> bitcoinjs-lib
// import chain fails its ecc self-check at collection time ("ecc library invalid").
//
// NOTE (INFRA-2): the former placeholder tests (`expect(true).toBe(true)`) for
// file watching, upload queue processing, and download synchronization were
// deleted. Real coverage for those paths arrives with the Phase-2 SYNC items
// (SYNC-1..SYNC-4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '@/main/sync-manager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { driveKeyManager } from '@/main/drive-key-manager';
import { createMockArDrive } from '../../helpers/mock-ardrive';
import { notificationService } from '@/main/notification-service';
import { CostCalculator } from '@/main/sync/CostCalculator';
import { MAX_SYNC_FILE_SIZE_BYTES } from '@/main/sync/constants';
import * as chokidar from 'chokidar';

const { mockWatcher, mockWebContentsSend, mockGetAllWindows, mockWindow } = vi.hoisted(() => {
  const mockWebContentsSend = vi.fn();
  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: mockWebContentsSend,
      isDestroyed: () => false,
    },
  };
  return {
    mockWatcher: {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    },
    mockWebContentsSend,
    mockGetAllWindows: vi.fn(() => [mockWindow]),
    mockWindow,
  };
});

vi.mock('chokidar', () => {
  const watch = vi.fn(() => mockWatcher);
  return { watch, default: { watch } };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
  },
  // UX-29: sync-manager.ts now imports notification-service.ts, which checks
  // Notification.isSupported() before doing anything else — false here means
  // every notify* call short-circuits without needing a configManager mock.
  Notification: {
    isSupported: vi.fn(() => false),
  },
}));

vi.mock('fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(Buffer.from('')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0, isFile: () => true, isDirectory: () => false }),
}));

describe('SyncManager', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;

  // EID() in DownloadManager validates entity IDs, so these must be UUID-shaped
  const testDriveId = '11111111-1111-4111-8111-111111111111';
  const testRootFolderId = '22222222-2222-4222-8222-222222222222';
  const testSyncPath = '/test/sync/folder';
  const testMapping = {
    id: 'test-mapping-id',
    driveId: testDriveId,
    driveName: 'Test Drive',
    drivePrivacy: 'public',
    rootFolderId: testRootFolderId,
    localFolderPath: testSyncPath,
    isActive: true,
  };
  const otherDriveId = '33333333-3333-4333-8333-333333333333';
  const otherRootFolderId = '44444444-4444-4444-8444-444444444444';
  const otherMapping = {
    id: 'other-mapping-id',
    driveId: otherDriveId,
    driveName: 'Other Drive',
    drivePrivacy: 'public',
    rootFolderId: otherRootFolderId,
    localFolderPath: '/other/profile/folder',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks does not undo mockReturnValue overrides from prior tests
    mockGetAllWindows.mockImplementation(() => [mockWindow]);
    mockWatcher.close.mockResolvedValue(undefined);
    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);
    mockArDrive = createMockArDrive();
    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
  });

  afterEach(async () => {
    // Tear down watchers/intervals created by startSync and the constructor
    await syncManager.stopSync();
  });

  describe('Initialization', () => {
    it('should create sync manager with proper initial state', async () => {
      expect(syncManager).toBeDefined();
      expect(syncManager.getCurrentSyncState()).toBe('idle');
      const status = await syncManager.getStatus();
      expect(status.isActive).toBe(false);
    });

    it('should set sync folder correctly', () => {
      const testPath = '/new/test/path';
      syncManager.setSyncFolder(testPath);
      expect(syncManager['syncFolderPath']).toBe(testPath);
    });

    it('should set ArDrive instance correctly', () => {
      const newMockArDrive = createMockArDrive();
      syncManager.setArDrive(newMockArDrive);
      expect(syncManager['arDrive']).toBe(newMockArDrive);
    });

    it('should refuse to start without a sync folder and ArDrive instance', async () => {
      const bareManager = new SyncManager(createMockDatabaseManager());

      await expect(bareManager.startSync(testDriveId, testRootFolderId))
        .rejects.toThrow('Sync folder and ArDrive instance must be set');

      await bareManager.stopSync();
    });
  });

  describe('State Transitions', () => {
    it('should reach monitoring state and start the file watcher after a successful sync', async () => {
      const result = await syncManager.startSync(testDriveId, testRootFolderId);

      expect(result).toBe(true);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');

      const status = await syncManager.getStatus();
      expect(status.isActive).toBe(true);

      // The watcher is pointed at the configured sync folder...
      expect(vi.mocked(chokidar.watch)).toHaveBeenCalledWith(
        testSyncPath,
        expect.objectContaining({ ignoreInitial: true })
      );
      // ...and wired up to file events
      const watchedEvents = mockWatcher.on.mock.calls.map((call) => call[0]);
      expect(watchedEvents).toEqual(
        expect.arrayContaining(['add', 'addDir', 'change', 'unlink', 'unlinkDir', 'error'])
      );
    });

    it('should handle sync stop correctly', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');

      const stopped = await syncManager.stopSync();

      expect(stopped).toBe(true);
      expect(syncManager.getCurrentSyncState()).toBe('idle');
      expect(mockWatcher.close).toHaveBeenCalled();

      const status = await syncManager.getStatus();
      expect(status.isActive).toBe(false);
    });

    it('should reject a second sync start while the first is in progress', async () => {
      const firstSync = syncManager.startSync(testDriveId, testRootFolderId);
      const secondSync = syncManager.startSync(testDriveId, testRootFolderId);

      const firstResult = await firstSync;
      const secondResult = await secondSync;

      expect(firstResult).toBe(true);
      expect(secondResult).toBe(false);
    });

    it('should report success for a start request while already monitoring', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);

      const secondResult = await syncManager.startSync(testDriveId, testRootFolderId);

      expect(secondResult).toBe(true);
      expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(1);
    });
  });

  describe('Logout / profile-switch teardown (SEC-3)', () => {
    it('should sever every wallet-bearing reference after stopAndClearAllState', async () => {
      const fakePrivateKeyData = { fake: 'privateKeyData' } as any;
      syncManager.setArDrive(mockArDrive, fakePrivateKeyData);
      await syncManager.startSync(testDriveId, testRootFolderId);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');

      await syncManager.stopAndClearAllState();

      // No active watcher...
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(syncManager.getCurrentSyncState()).toBe('idle');
      // ...and no wallet-bearing or profile-specific state anywhere
      expect(syncManager['arDrive']).toBeNull();
      expect(syncManager['privateKeyData']).toBeUndefined();
      expect(syncManager['downloadManager']['arDrive']).toBeNull();
      expect(syncManager['syncFolderPath']).toBeNull();
      expect(syncManager['driveId']).toBeNull();
      expect(syncManager['rootFolderId']).toBeNull();
    });

    it('should be safe to call when sync was never started', async () => {
      await expect(syncManager.stopAndClearAllState()).resolves.toBeUndefined();
      expect(syncManager.getCurrentSyncState()).toBe('idle');
      expect(syncManager['arDrive']).toBeNull();
    });

    it('should let a new profile start sync against its own drive after teardown', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);
      await syncManager.stopAndClearAllState();

      // Simulate the next profile's sync:start (handler re-sets folder + ArDrive)
      const otherFolder = '/other/profile/folder';
      const otherArDrive = createMockArDrive();
      mockDatabaseManager.getDriveMappings.mockResolvedValue([otherMapping]);
      syncManager.setSyncFolder(otherFolder);
      syncManager.setArDrive(otherArDrive);

      const result = await syncManager.startSync(otherDriveId, otherRootFolderId);

      expect(result).toBe(true);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');
      expect(syncManager['driveId']).toBe(otherDriveId);
      expect(vi.mocked(chokidar.watch)).toHaveBeenLastCalledWith(
        otherFolder,
        expect.objectContaining({ ignoreInitial: true })
      );
    });
  });

  describe('Re-targeting while monitoring (SEC-3)', () => {
    it('should re-target when a different drive is requested while monitoring', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping, otherMapping]);
      await syncManager.startSync(testDriveId, testRootFolderId);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');

      const result = await syncManager.startSync(otherDriveId, otherRootFolderId);

      expect(result).toBe(true);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');
      expect(syncManager['driveId']).toBe(otherDriveId);
      expect(syncManager['rootFolderId']).toBe(otherRootFolderId);
      // Old watcher closed, new one created
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(2);
    });

    it('should re-target when the sync folder changed for the same drive', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);
      expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(1);

      const newFolder = '/moved/sync/folder';
      syncManager.setSyncFolder(newFolder);
      const result = await syncManager.startSync(testDriveId, testRootFolderId);

      expect(result).toBe(true);
      expect(vi.mocked(chokidar.watch)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(chokidar.watch)).toHaveBeenLastCalledWith(
        newFolder,
        expect.objectContaining({ ignoreInitial: true })
      );
    });
  });

  describe('Stop -> start lifecycle (SYNC-4)', () => {
    it('should keep sync progress reaching the renderer after stop -> start', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);
      await syncManager.stopSync();

      // Restart: this must re-arm the destroyed progress tracker
      const restarted = await syncManager.startSync(testDriveId, testRootFolderId);
      expect(restarted).toBe(true);

      mockWebContentsSend.mockClear();
      syncManager['emitSyncProgress']({ phase: 'files', description: 'post-restart probe' });

      // Real timers: the tracker flushes every 250ms
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(mockWebContentsSend).toHaveBeenCalledWith('sync:progress', {
        phase: 'files',
        description: 'post-restart probe',
      });
    });

    it('should re-arm the download manager intervals after stop -> start', async () => {
      await syncManager.startSync(testDriveId, testRootFolderId);
      await syncManager.stopSync();

      // destroy() cleared both intervals
      expect(syncManager['downloadManager']['progressFlushInterval']).toBeNull();
      expect(syncManager['downloadManager']['memoryCleanupInterval']).toBeNull();

      await syncManager.startSync(testDriveId, testRootFolderId);

      expect(syncManager['downloadManager']['progressFlushInterval']).not.toBeNull();
      expect(syncManager['downloadManager']['memoryCleanupInterval']).not.toBeNull();
    });

    it('should keep progress alive across a drive switch (switchDrive)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping, otherMapping]);
      await syncManager.startSync(testDriveId, testRootFolderId);

      const switched = await syncManager.switchDrive(otherDriveId, otherRootFolderId);
      expect(switched).toBe(true);

      mockWebContentsSend.mockClear();
      syncManager['emitSyncProgress']({ phase: 'files', description: 'post-switch probe' });
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(mockWebContentsSend).toHaveBeenCalledWith('sync:progress', {
        phase: 'files',
        description: 'post-switch probe',
      });
    });
  });

  describe('Upload cancellation (MONEY-2)', () => {
    const makeUpload = (status: 'pending' | 'uploading') =>
      ({
        id: 'upload-1',
        driveId: testDriveId,
        localPath: `${testSyncPath}/doc.txt`,
        fileName: 'doc.txt',
        fileSize: 1024,
        status,
        progress: 0,
        createdAt: new Date(),
      }) as any;

    it('cancelling a pending upload removes it before any paid work', () => {
      const upload = makeUpload('pending');
      syncManager.addToUploadQueue(upload);

      const result = syncManager.cancelUpload('upload-1');

      expect(result).toEqual({ cancelled: true, wasInFlight: false });
      expect(syncManager.getQueueEntryStatus('upload-1')).toBeUndefined();
    });

    it('cancelling an in-flight upload registers a request instead of lying', () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);

      const result = syncManager.cancelUpload('upload-1');

      expect(result).toEqual({ cancelled: true, wasInFlight: true });
      expect(syncManager.isUploadCancellationPending('upload-1')).toBe(true);
    });

    it('spend checkpoint: a cancellation requested before the paid call skips it entirely', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('upload-1'); // registers the in-flight request

      (mockArDrive as any).uploadAllEntities = vi.fn();
      await syncManager['uploadFileWithArDriveCore'](upload);

      // No network/paid call, upload finalized as cancelled
      expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
      expect(mockDatabaseManager.updateUpload).toHaveBeenCalledWith('upload-1', {
        status: 'failed',
        error: 'Cancelled by user',
      });
      expect(syncManager.isUploadCancellationPending('upload-1')).toBe(false);
      expect(syncManager.getQueueEntryStatus('upload-1')).toBeUndefined();
    });

    it('completion never resurrects a cancelled record (truthful charged state)', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('upload-1');

      // Simulate the network call having completed despite the cancellation
      const fakeResult = {
        created: [
          {
            type: 'file',
            entityId: { toString: () => 'file-entity-id' },
            dataTxId: { toString: () => 'data-tx-id' },
            metadataTxId: { toString: () => 'meta-tx-id' },
          },
        ],
        fees: {},
      };

      await syncManager['processUploadResult'](upload, fakeResult);

      // Status stays terminal-cancelled, but the truth (stored + charged,
      // with tx ids as evidence) is recorded — never flipped to 'completed'
      const calls = mockDatabaseManager.updateUpload.mock.calls;
      const finalWrite = calls[calls.length - 1];
      expect(finalWrite[0]).toBe('upload-1');
      expect(finalWrite[1].status).toBe('failed');
      expect(finalWrite[1].error).toMatch(/already completed on Arweave/);
      expect(finalWrite[1].dataTxId).toBe('data-tx-id');
      expect(
        calls.some((c: any[]) => c[1] && c[1].status === 'completed')
      ).toBe(false);
      expect(syncManager.isUploadCancellationPending('upload-1')).toBe(false);
    });

    it('an uncancelled completion still records completed (control)', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);

      const fakeResult = {
        created: [
          {
            type: 'file',
            entityId: { toString: () => 'file-entity-id' },
            dataTxId: { toString: () => 'data-tx-id' },
            metadataTxId: { toString: () => 'meta-tx-id' },
          },
        ],
        fees: {},
      };

      await syncManager['processUploadResult'](upload, fakeResult);

      expect(upload.status).toBe('completed');
      // The completed state persists via addUpload (history insert; falls
      // back to updateUpload only on duplicate ids)
      expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'upload-1', status: 'completed', dataTxId: 'data-tx-id' })
      );
    });
  });

  // SYNC-28: processUploadResult must back-fill the completed upload's data-tx
  // id onto the file_versions row created at queue time, so version history
  // (FEAT-6) can link View/Download to a real transaction. Both the normal
  // (:2776) and retry (:2842) paths route through processUploadResult, so
  // exercising it directly covers both.
  describe('per-version tx id back-fill (SYNC-28)', () => {
    beforeEach(() => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
    });

    const makeUpload = (uploadMethod?: 'ar' | 'turbo') =>
      ({
        id: 'upload-1',
        driveId: testDriveId,
        localPath: `${testSyncPath}/doc.txt`,
        fileName: 'doc.txt',
        fileSize: 1024,
        status: 'uploading',
        progress: 0,
        uploadMethod,
        createdAt: new Date(),
      }) as any;

    const fakeResult = {
      created: [
        {
          type: 'file',
          entityId: { toString: () => 'file-entity-id' },
          dataTxId: { toString: () => 'data-tx-id' },
          metadataTxId: { toString: () => 'meta-tx-id' },
        },
      ],
      fees: {},
    };

    it('back-fills the Turbo data-tx id (turboId column) onto the file version', async () => {
      const upload = makeUpload('turbo');
      syncManager.addToUploadQueue(upload);

      await syncManager['processUploadResult'](upload, fakeResult);

      expect(mockDatabaseManager.updateFileVersionTxId).toHaveBeenCalledWith(
        `${testSyncPath}/doc.txt`,
        'data-tx-id',
        { method: 'turbo' }
      );
    });

    it('routes a legacy AR upload to the arweaveId column (method: ar)', async () => {
      const upload = makeUpload('ar');
      syncManager.addToUploadQueue(upload);

      await syncManager['processUploadResult'](upload, fakeResult);

      expect(mockDatabaseManager.updateFileVersionTxId).toHaveBeenCalledWith(
        `${testSyncPath}/doc.txt`,
        'data-tx-id',
        { method: 'ar' }
      );
    });

    it('defaults an unset uploadMethod to Turbo (current Turbo-only beta)', async () => {
      const upload = makeUpload(undefined);
      syncManager.addToUploadQueue(upload);

      await syncManager['processUploadResult'](upload, fakeResult);

      expect(mockDatabaseManager.updateFileVersionTxId).toHaveBeenCalledWith(
        `${testSyncPath}/doc.txt`,
        'data-tx-id',
        { method: 'turbo' }
      );
    });

    it('does NOT back-fill a version when the upload was skipped (no created entities)', async () => {
      const upload = makeUpload('turbo');
      syncManager.addToUploadQueue(upload);

      await syncManager['processUploadResult'](upload, { created: [], fees: {} });

      expect(mockDatabaseManager.updateFileVersionTxId).not.toHaveBeenCalled();
    });

    it('a back-fill failure never breaks a successful upload', async () => {
      const upload = makeUpload('turbo');
      syncManager.addToUploadQueue(upload);
      mockDatabaseManager.updateFileVersionTxId.mockRejectedValueOnce(new Error('db locked'));

      await expect(
        syncManager['processUploadResult'](upload, fakeResult)
      ).resolves.not.toThrow();

      // Upload still completes and is recorded
      expect(upload.status).toBe('completed');
      expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'upload-1', status: 'completed', dataTxId: 'data-tx-id' })
      );
    });
  });

  describe('Upload cancellation — qa-gate fix round (MONEY-2)', () => {
    beforeEach(() => {
      // These tests drive the upload pipeline directly (no startSync), so
      // give the manager its drive context — uploadFile/ensureFolderStructure
      // early-return without it.
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
    });

    const makeUpload = (status: 'pending' | 'uploading') =>
      ({
        id: 'upload-1',
        driveId: testDriveId,
        localPath: `${testSyncPath}/doc.txt`,
        fileName: 'doc.txt',
        fileSize: 1024,
        status,
        progress: 0,
        createdAt: new Date(),
      }) as any;
    const makeFolderUpload = () =>
      ({
        id: 'folder-upload-1',
        driveId: testDriveId,
        localPath: `${testSyncPath}/NewFolder`,
        fileName: 'NewFolder',
        fileSize: 0,
        status: 'uploading',
        progress: 0,
        createdAt: new Date(),
      }) as any;

    it('folder short-circuit honors cancellation instead of resurrecting (free path)', async () => {
      const upload = makeFolderUpload();
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('folder-upload-1');
      // Folder already exists on Arweave — the free short-circuit
      mockDatabaseManager.getFolderByPath.mockResolvedValue({
        id: 'db-folder-1',
        folderPath: upload.localPath,
        arfsFolderId: 'existing-arfs-id',
        isDeleted: false,
      });

      await syncManager['uploadFileWithArDriveCore'](upload);

      const writes = mockDatabaseManager.updateUpload.mock.calls;
      expect(writes.some((c: any[]) => c[1]?.status === 'completed')).toBe(false);
      expect(writes.some((c: any[]) => c[1]?.status === 'failed' && c[1]?.error === 'Cancelled by user')).toBe(true);
      expect(syncManager.isUploadCancellationPending('folder-upload-1')).toBe(false);
    });

    it('created-folder completion records the charged truth, never completed', async () => {
      const upload = makeFolderUpload();
      syncManager.addToUploadQueue(upload);
      mockDatabaseManager.getFolderByPath.mockResolvedValue(null);
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);
      // Cancellation arrives WHILE the paid folder creation is in flight
      (mockArDrive as any).createPublicFolder = vi.fn(async () => {
        syncManager.cancelUpload('folder-upload-1');
        return { created: [{ type: 'folder', entityId: { toString: () => 'new-arfs-folder-id' } }] };
      });

      await syncManager['uploadFileWithArDriveCore'](upload);

      const writes = mockDatabaseManager.updateUpload.mock.calls;
      expect(writes.some((c: any[]) => c[1]?.status === 'completed')).toBe(false);
      const truthWrite = writes.find((c: any[]) => c[1]?.status === 'failed');
      expect(truthWrite![1].error).toMatch(/folder had already been created on Arweave/);
      expect(truthWrite![1].fileId).toBe('new-arfs-folder-id');
      expect(syncManager.isUploadCancellationPending('folder-upload-1')).toBe(false);
    });

    it('the paid folder-structure loop stops at a pending cancellation', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('upload-1');
      mockDatabaseManager.getFolderByPath.mockResolvedValue(null);
      (mockArDrive as any).createPublicFolder = vi.fn();

      // Deep nested path -> multiple paid folder creations would launch
      await expect(
        syncManager['ensureFolderStructure'](`${testSyncPath}/a/b/c`, 'upload-1')
      ).rejects.toThrow('UPLOAD_CANCELLED_BY_USER');

      expect((mockArDrive as any).createPublicFolder).not.toHaveBeenCalled();
    });

    it('registers the cancelled-but-charged file in processed_files (no watcher re-charge)', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('upload-1');

      const fakeResult = {
        created: [
          {
            type: 'file',
            entityId: { toString: () => 'file-entity-id' },
            dataTxId: { toString: () => 'data-tx-id' },
            metadataTxId: { toString: () => 'meta-tx-id' },
          },
        ],
        fees: {},
      };

      await syncManager['processUploadResult'](upload, fakeResult);

      expect(mockDatabaseManager.addProcessedFile).toHaveBeenCalledWith(
        expect.any(String),
        upload.fileName,
        upload.fileSize,
        upload.localPath,
        'upload'
      );
    });

    it('a cancelled upload that then throws resolves the cancellation (no request leak)', async () => {
      const upload = makeUpload('uploading');
      syncManager.addToUploadQueue(upload);
      syncManager.cancelUpload('upload-1');
      // Force a genuine failure after the cancellation was requested: the
      // pre-spend checkpoint would normally finalize first, so simulate the
      // request arriving mid-flight by re-registering inside the throw path
      const spy = vi
        .spyOn(syncManager as any, 'uploadFileWithArDriveCore')
        .mockRejectedValue(new Error('network died'));

      await syncManager['uploadFile'](upload);
      spy.mockRestore();

      // Request resolved — retry is not blocked forever
      expect(syncManager.isUploadCancellationPending('upload-1')).toBe(false);
      const writes = mockDatabaseManager.updateUpload.mock.calls;
      expect(writes.some((c: any[]) => c[1]?.status === 'failed' && c[1]?.error === 'Cancelled by user')).toBe(true);
      expect(writes.some((c: any[]) => c[1]?.status === 'completed')).toBe(false);
    });
  });

  describe('Locked private drives (PRIV-5)', () => {
    const privateMapping = {
      ...testMapping,
      drivePrivacy: 'private' as const,
      driveName: 'Secret Drive',
    };

    afterEach(() => {
      driveKeyManager.clearAllKeys();
    });

    it('refuses to sync a locked private drive loudly — no silent empty sync', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      // driveKeyManager has no key cached for this drive => locked

      await expect(syncManager.startSync(testDriveId, testRootFolderId))
        .rejects.toThrow(/Secret Drive.*locked — unlock it to sync/);

      expect(syncManager.getCurrentSyncState()).toBe('idle');
      // The metadata cache was NOT wiped and no watcher started
      expect(mockDatabaseManager.clearDriveMetadataCache).not.toHaveBeenCalled();
      expect(vi.mocked(chokidar.watch)).not.toHaveBeenCalled();
    });

    it('manual sync on a locked engine target fails loudly too (no empty-wipe)', async () => {
      // qa-gate finding: sync:manual could still empty-wipe a locked drive
      // that was already the engine's nominal target
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;

      await expect(syncManager.forceDownloadExistingFiles())
        .rejects.toThrow(/Secret Drive.*locked — unlock it to sync/);
    });

    it('a failed locked start leaves no nominal drive target', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);

      await expect(syncManager.startSync(testDriveId, testRootFolderId)).rejects.toThrow(/locked/);

      // qa-gate finding: the lingering target enabled later manual empty-wipes
      expect(syncManager['driveId']).toBeNull();
      expect(syncManager['rootFolderId']).toBeNull();
    });

    it('syncs an unlocked private drive normally', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      driveKeyManager.cacheKey(testDriveId, { keyData: Buffer.from('k') } as any);

      const result = await syncManager.startSync(testDriveId, testRootFolderId);

      expect(result).toBe(true);
      expect(syncManager.getCurrentSyncState()).toBe('monitoring');
    });
  });

  describe('Edited files re-upload (SYNC-1)', () => {
    const filePath = `${testSyncPath}/doc.txt`;
    const NEW_CONTENT = Buffer.from('edited content v2');
    let NEW_HASH: string;

    beforeEach(async () => {
      const crypto = await import('crypto');
      NEW_HASH = crypto.createHash('sha256').update(NEW_CONTENT).digest('hex');

      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
      // Deterministic costs, no network
      syncManager['costCalculator'] = {
        isFileTooBig: vi.fn(() => false),
        isFreeWithTurbo: vi.fn(() => true),
        calculateUploadCosts: vi.fn(async () => ({
          estimatedCost: 0,
          estimatedTurboCost: 100,
          recommendedMethod: 'turbo',
          hasSufficientTurboBalance: true,
        })),
        // qa-gate hygiene finding: without this the handleNewFile tail threw
        // inside the swallow-all catch, leaving later code silently untested
        formatCostInAR: vi.fn(() => '0.000000 AR'),
      } as any;

      const fs = await import('fs/promises');
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({ size: NEW_CONTENT.length, isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFile).mockResolvedValue(NEW_CONTENT as any);
    });

    it('queues a new revision when a previously uploaded file is edited', async () => {
      // The audited dead-end: same path, DIFFERENT content
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([
        {
          fileHash: 'old-content-hash',
          fileName: 'doc.txt',
          fileSize: 10,
          localPath: filePath,
          source: 'upload',
          processedAt: new Date(),
        },
      ]);

      await syncManager['handleNewFile'](filePath, 'update');

      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath: filePath,
          fileName: 'doc.txt',
          status: 'awaiting_approval',
        })
      );
      // The NEW content hash is registered so event storms don't re-queue it
      expect(mockDatabaseManager.addProcessedFile).toHaveBeenCalledWith(
        NEW_HASH,
        'doc.txt',
        NEW_CONTENT.length,
        filePath,
        'upload'
      );
    });

    it('still skips identical, already-uploaded content (dedup control)', async () => {
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([
        {
          fileHash: NEW_HASH, // same content
          fileName: 'doc.txt',
          fileSize: NEW_CONTENT.length,
          localPath: filePath,
          source: 'upload',
          processedAt: new Date(),
        },
      ]);

      await syncManager['handleNewFile'](filePath, 'update');

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('queues a new revision when a DOWNLOADED file is edited locally', async () => {
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([
        {
          fileHash: 'hash-of-downloaded-original',
          fileName: 'doc.txt',
          fileSize: 10,
          localPath: filePath,
          source: 'download',
          processedAt: new Date(),
        },
      ]);
      // Downloads-table row exists for the path — must not block the edit
      mockDatabaseManager.getDownloads.mockResolvedValue([
        { id: 'dl-1', localPath: filePath, status: 'completed', fileId: 'arfs-file-id' },
      ]);

      await syncManager['handleNewFile'](filePath, 'update');

      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledWith(
        expect.objectContaining({ localPath: filePath, status: 'awaiting_approval' })
      );
    });

    it('still skips identical downloaded content (no echo re-upload)', async () => {
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([
        {
          fileHash: NEW_HASH, // identical to what is on disk
          fileName: 'doc.txt',
          fileSize: NEW_CONTENT.length,
          localPath: filePath,
          source: 'download',
          processedAt: new Date(),
        },
      ]);

      await syncManager['handleNewFile'](filePath, 'update');

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('does not double-queue while a pending approval already exists', async () => {
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([
        {
          fileHash: 'old-content-hash',
          fileName: 'doc.txt',
          fileSize: 10,
          localPath: filePath,
          source: 'upload',
          processedAt: new Date(),
        },
      ]);
      mockDatabaseManager.getPendingUploads.mockResolvedValue([
        { id: 'pending-1', localPath: filePath, status: 'awaiting_approval' },
      ]);

      await syncManager['handleNewFile'](filePath, 'update');

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });
  });

  describe('File-size cap is surfaced, not silently skipped (SYNC-6)', () => {
    const oversizeName = 'big.zip';
    const filePath = `${testSyncPath}/${oversizeName}`;
    const OVERSIZE_BYTES = 240 * 1024 * 1024; // 240 MiB — comfortably over the cap
    let notifySpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
      // A too-big file: the cost calculator flags it and disk reports 240 MiB.
      syncManager['costCalculator'] = {
        isFileTooBig: vi.fn((size: number) => size > MAX_SYNC_FILE_SIZE_BYTES),
        isFreeWithTurbo: vi.fn(() => false),
        calculateUploadCosts: vi.fn(async () => ({
          estimatedCost: 0,
          estimatedTurboCost: 100,
          recommendedMethod: 'turbo',
          hasSufficientTurboBalance: true,
        })),
        formatCostInAR: vi.fn(() => '0.000000 AR'),
      } as any;

      const fs = await import('fs/promises');
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({
        size: OVERSIZE_BYTES,
        isFile: () => true,
        isDirectory: () => false,
      } as any);
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([]);

      // The OS-notification surface short-circuits (Notification.isSupported()
      // is mocked false); stub the method so we only observe that it fired with
      // honest copy naming the file, its size, and the limit.
      notifySpy = vi.spyOn(notificationService, 'notifySyncError').mockImplementation(() => {});
    });

    afterEach(() => {
      notifySpy.mockRestore();
    });

    it('surfaces an oversized file (OS notification + persistent failed record) and does NOT upload it', async () => {
      (mockArDrive as any).uploadAllEntities = vi.fn();

      await syncManager['handleNewFile'](filePath, 'create');

      // 1) LOUD, not silent: an OS notification naming the file, its size, and the limit.
      expect(notifySpy).toHaveBeenCalledTimes(1);
      const message = notifySpy.mock.calls[0][0] as string;
      expect(message).toContain(oversizeName);
      expect(message).toContain('240 MB');
      expect(message).toContain('100 MB');
      expect(message.toLowerCase()).toContain("won't sync");

      // 2) Persistent surface: a 'failed' uploads row carrying the same honest reason.
      expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          localPath: filePath,
          fileName: oversizeName,
          fileSize: OVERSIZE_BYTES,
          status: 'failed',
          error: message,
        })
      );

      // 3) SKIP preserved / money-safe: never queued for upload, never uploaded.
      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
      expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
      expect(mockDatabaseManager.addProcessedFile).not.toHaveBeenCalled();
    });

    it('does not spam: a burst of watcher events for the same too-big file notifies once', async () => {
      await syncManager['handleNewFile'](filePath, 'create');
      await syncManager['handleNewFile'](filePath, 'change');
      await syncManager['handleNewFile'](filePath, 'change');

      expect(notifySpy).toHaveBeenCalledTimes(1);
    });

    it('blocks an oversized file on the queued/retry route too (never uploads over the cap)', async () => {
      const upload: any = {
        id: 'upload-oversize-1',
        driveId: testDriveId,
        localPath: filePath,
        fileName: oversizeName,
        fileSize: 50 * 1024 * 1024, // approved small; grew past the cap on disk
        status: 'pending',
        progress: 0,
      };

      const handled = await syncManager['revalidateApprovedFileSize'](upload);

      expect(handled).toBe(true); // caller stops before any upload work
      expect(upload.status).toBe('failed');
      expect(upload.error).toContain('100 MB');
      expect(mockDatabaseManager.updateUpload).toHaveBeenCalledWith(
        'upload-oversize-1',
        expect.objectContaining({ status: 'failed' })
      );
      expect(notifySpy).toHaveBeenCalledTimes(1);
      // It is NOT re-queued for an approval the user could never grant.
      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('lets a file UNDER the cap sync normally (queued for approval, no oversize notice)', async () => {
      const okName = 'small.txt';
      const okPath = `${testSyncPath}/${okName}`;
      const OK_CONTENT = Buffer.from('a modest amount of content');
      const fs = await import('fs/promises');
      vi.mocked(fs.stat).mockResolvedValue({
        size: OK_CONTENT.length,
        isFile: () => true,
        isDirectory: () => false,
      } as any);
      vi.mocked(fs.readFile).mockResolvedValue(OK_CONTENT as any);
      mockDatabaseManager.getProcessedFiles.mockResolvedValue([]);
      mockDatabaseManager.getPendingUploads.mockResolvedValue([]);

      await syncManager['handleNewFile'](okPath, 'create');

      expect(notifySpy).not.toHaveBeenCalled();
      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledWith(
        expect.objectContaining({ localPath: okPath, status: 'awaiting_approval' })
      );
    });

    it('the beta cap is a single source: CostCalculator.isFileTooBig keys off MAX_SYNC_FILE_SIZE_BYTES', () => {
      const calc = new CostCalculator();
      // Exactly at the limit is allowed; a single byte over is rejected — proving
      // the check derives from the constant (not a separate magic number).
      expect(calc.isFileTooBig(MAX_SYNC_FILE_SIZE_BYTES)).toBe(false);
      expect(calc.isFileTooBig(MAX_SYNC_FILE_SIZE_BYTES + 1)).toBe(true);
      expect(MAX_SYNC_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024);
    });
  });

  describe('Slow-download eviction feedback loop (SYNC-13)', () => {
    // FileStateManager used to auto-evict "recently downloaded" tracking on
    // a FIXED 30-second timer, regardless of whether the download had
    // actually finished. A download that takes longer than 30s (large file
    // / slow gateway) would fall out of protection while still landing on
    // disk; the watcher's `add` event for it would then reach handleNewFile
    // and get queued as a brand-new local file - re-uploading a file that
    // was JUST downloaded (a feedback loop that spends real money). See
    // AUDIT-2026-07-02.md §2.14 / BACKLOG.md SYNC-13.
    //
    // These exercise the REAL SyncManager + REAL FileStateManager (not
    // mocked) through the exact call site handleNewFile uses
    // (isRecentlyDownloaded, sync-manager.ts ~2103), proving the fix at the
    // actual integration point, not just FileStateManager in isolation.
    const filePath = `${testSyncPath}/big-file.bin`;
    const FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GiB (SYNC-6 cap)

    beforeEach(async () => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
      syncManager['costCalculator'] = {
        isFileTooBig: vi.fn(() => false),
        isFreeWithTurbo: vi.fn(() => true),
        calculateUploadCosts: vi.fn(async () => ({
          estimatedCost: 0,
          estimatedTurboCost: 100,
          recommendedMethod: 'turbo',
          hasSufficientTurboBalance: true,
        })),
        formatCostInAR: vi.fn(() => '0.000000 AR'),
      } as any;

      const fs = await import('fs/promises');
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({ size: FILE_SIZE, isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFile).mockResolvedValue(Buffer.alloc(0) as any);
    });

    it('a watcher add firing well past the OLD 30s window - download still in flight - does NOT queue a re-upload', async () => {
      vi.useFakeTimers();
      try {
        // Simulates DownloadManager.downloadFile's start-of-download call.
        syncManager['fileStateManager'].markAsDownloaded(filePath, FILE_SIZE);

        // The old implementation auto-evicted here via a fixed setTimeout.
        // The download is slow and is STILL in flight - no clearDownload
        // (finalize) call has happened.
        await vi.advanceTimersByTimeAsync(35000);

        // The watcher's (possibly delayed) `add` event reaches handleNewFile
        // while the download is still landing on disk.
        await syncManager['handleNewFile'](filePath, 'create');
      } finally {
        vi.useRealTimers();
      }

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('once the download FINALIZES, a genuine local edit at the same path IS still queued (no over-suppression)', async () => {
      syncManager['fileStateManager'].markAsDownloaded(filePath, FILE_SIZE);
      // Finalize: the real caller does this from a try/finally once the
      // download promise settles, success or failure.
      syncManager['fileStateManager'].clearDownload(filePath);

      // A genuinely different local edit shows up at the same path
      // afterward - different size/content than what was downloaded.
      const EDITED = Buffer.from('a genuinely different local edit');
      const fs = await import('fs/promises');
      vi.mocked(fs.stat).mockResolvedValue({ size: EDITED.length, isFile: () => true, isDirectory: () => false } as any);
      vi.mocked(fs.readFile).mockResolvedValue(EDITED as any);

      await syncManager['handleNewFile'](filePath, 'create');

      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledWith(
        expect.objectContaining({ localPath: filePath, status: 'awaiting_approval' })
      );
    });
  });

  describe('Upsert-skip honesty (SYNC-1 qa-gate finding)', () => {
    it('an empty core result records a skip, never a completed with undefined tx ids', async () => {
      const upload = {
        id: 'upload-skip', driveId: testDriveId, localPath: `${testSyncPath}/same.txt`,
        fileName: 'same.txt', fileSize: 10, status: 'uploading', progress: 0, createdAt: new Date(),
      } as any;
      syncManager.addToUploadQueue(upload);

      await syncManager['processUploadResult'](upload, { created: [], fees: {} });

      const writes = mockDatabaseManager.updateUpload.mock.calls;
      expect(writes.some((c: any[]) => c[1]?.status === 'completed')).toBe(false);
      const skipWrite = writes.find((c: any[]) => c[1]?.status === 'failed');
      expect(skipWrite![1].error).toMatch(/skipped by conflict resolution.*nothing was charged/);
      expect(mockDatabaseManager.addUpload).not.toHaveBeenCalled();
    });
  });

  describe('Folder follows the drive (SYNC-7)', () => {
    it('switchDrive re-points the watcher at the NEW mapping folder', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping, otherMapping]);
      await syncManager.startSync(testDriveId, testRootFolderId);
      expect(vi.mocked(chokidar.watch)).toHaveBeenLastCalledWith(
        testSyncPath,
        expect.objectContaining({ ignoreInitial: true })
      );

      const switched = await syncManager.switchDrive(otherDriveId, otherRootFolderId);

      expect(switched).toBe(true);
      // The audited divergence: the watcher stayed on the OLD drive's folder
      // while uploads targeted the new drive
      expect(vi.mocked(chokidar.watch)).toHaveBeenLastCalledWith(
        otherMapping.localFolderPath,
        expect.objectContaining({ ignoreInitial: true })
      );
      expect(syncManager['syncFolderPath']).toBe(otherMapping.localFolderPath);
      expect(syncManager['driveId']).toBe(otherDriveId);
    });

    it('switchDrive keeps the current folder when the new mapping lacks one (legacy fallback)', async () => {
      const folderlessMapping = { ...otherMapping, localFolderPath: undefined } as any;
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping, folderlessMapping]);
      await syncManager.startSync(testDriveId, testRootFolderId);

      await syncManager.switchDrive(otherDriveId, otherRootFolderId);

      expect(syncManager['syncFolderPath']).toBe(testSyncPath);
    });
  });

  describe('Deletes propagate as ArFS hide (SYNC-5)', () => {
    // Valid entity ids (EID() validates UUID shape).
    const fileEntityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const folderEntityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const privateMapping = { ...testMapping, drivePrivacy: 'private' as const };

    beforeEach(() => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
    });

    afterEach(() => {
      driveKeyManager.clearAllKeys();
    });

    const makeHideOp = (over: any = {}) =>
      ({
        id: 'hide-op-1',
        driveId: testDriveId,
        localPath: `${testSyncPath}/gone.txt`,
        fileName: 'gone.txt',
        fileSize: 0,
        status: 'awaiting_approval',
        operationType: 'hide',
        metadata: { isHidden: true },
        createdAt: new Date(),
        ...over,
      }) as any;

    // --- executeMetadataOperation routing (money-critical; mutation target) ---

    it('hides a PUBLIC file via hidePublicFile (no driveKey)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);

      await syncManager.executeMetadataOperation(makeHideOp({ arfsFileId: fileEntityId }));

      expect(mockArDrive.hidePublicFile).toHaveBeenCalledTimes(1);
      expect(mockArDrive.hidePublicFile.mock.calls[0][0].fileId.toString()).toBe(fileEntityId);
      // Never the private path, never a folder path
      expect(mockArDrive.hidePrivateFile).not.toHaveBeenCalled();
      expect(mockArDrive.hidePublicFolder).not.toHaveBeenCalled();
    });

    it('hides a PRIVATE file via hidePrivateFile WITH the cached drive key', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(makeHideOp({ arfsFileId: fileEntityId }));

      expect(mockArDrive.hidePrivateFile).toHaveBeenCalledTimes(1);
      const arg = mockArDrive.hidePrivateFile.mock.calls[0][0];
      expect(arg.fileId.toString()).toBe(fileEntityId);
      expect(arg.driveKey).toBe(key);
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    it('refuses to hide on a LOCKED private drive (no key) — spends nothing', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      // No key cached => locked

      await expect(
        syncManager.executeMetadataOperation(makeHideOp({ arfsFileId: fileEntityId }))
      ).rejects.toThrow(/locked/i);

      expect(mockArDrive.hidePrivateFile).not.toHaveBeenCalled();
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    it('hides a PUBLIC folder via hidePublicFolder (folder id path, not file path)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);

      await syncManager.executeMetadataOperation(
        makeHideOp({ arfsFolderId: folderEntityId, mimeType: 'folder', fileName: 'GoneFolder' })
      );

      expect(mockArDrive.hidePublicFolder).toHaveBeenCalledTimes(1);
      expect(mockArDrive.hidePublicFolder.mock.calls[0][0].folderId.toString()).toBe(folderEntityId);
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    it('hides a PRIVATE folder via hidePrivateFolder WITH the drive key', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(
        makeHideOp({ arfsFolderId: folderEntityId, mimeType: 'folder' })
      );

      expect(mockArDrive.hidePrivateFolder).toHaveBeenCalledTimes(1);
      const arg = mockArDrive.hidePrivateFolder.mock.calls[0][0];
      expect(arg.folderId.toString()).toBe(folderEntityId);
      expect(arg.driveKey).toBe(key);
    });

    it('UNHIDE reverses: a public-file unhide calls unhidePublicFile, never hide', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);

      await syncManager.executeMetadataOperation(
        makeHideOp({ operationType: 'unhide', arfsFileId: fileEntityId, metadata: { isHidden: false } })
      );

      expect(mockArDrive.unhidePublicFile).toHaveBeenCalledTimes(1);
      expect(mockArDrive.unhidePublicFile.mock.calls[0][0].fileId.toString()).toBe(fileEntityId);
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    it('UNHIDE on a private folder calls unhidePrivateFolder with the drive key', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(
        makeHideOp({ operationType: 'unhide', arfsFolderId: folderEntityId, mimeType: 'folder', metadata: { isHidden: false } })
      );

      expect(mockArDrive.unhidePrivateFolder).toHaveBeenCalledTimes(1);
      expect(mockArDrive.unhidePrivateFolder.mock.calls[0][0].driveKey).toBe(key);
      expect(mockArDrive.hidePrivateFolder).not.toHaveBeenCalled();
    });

    it('records the new hidden state in the metadata cache (true on hide, false on unhide)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);

      await syncManager.executeMetadataOperation(makeHideOp({ arfsFileId: fileEntityId }));
      expect(mockDatabaseManager.updateDriveMetadataHidden).toHaveBeenCalledWith(fileEntityId, true);

      mockDatabaseManager.updateDriveMetadataHidden.mockClear();
      await syncManager.executeMetadataOperation(
        makeHideOp({ operationType: 'unhide', arfsFileId: fileEntityId, metadata: { isHidden: false } })
      );
      expect(mockDatabaseManager.updateDriveMetadataHidden).toHaveBeenCalledWith(fileEntityId, false);
    });

    it('throws (and spends nothing) when the entity id is missing', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);

      await expect(
        syncManager.executeMetadataOperation(makeHideOp({ arfsFileId: undefined, arfsFolderId: undefined }))
      ).rejects.toThrow(/Missing entity ID/);
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    // --- confirmed local delete -> hide op in the approval queue ---

    it('a confirmed file delete queues a hide op (awaiting_approval) for an uploaded file', async () => {
      await syncManager['confirmFileDelete']({
        type: 'delete',
        oldPath: `${testSyncPath}/gone.txt`,
        oldArfsFileId: fileEntityId,
        reason: 'confirmed',
      } as any);

      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
      const op = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
      expect(op).toMatchObject({
        operationType: 'hide',
        status: 'awaiting_approval',
        arfsFileId: fileEntityId,
        metadata: { isHidden: true },
      });
      // Honest, free metadata-op cost
      expect(op.estimatedTurboCost).toBe(0);
      expect(
        mockWebContentsSend.mock.calls.some((c: any[]) => c[0] === 'sync:pending-uploads-updated')
      ).toBe(true);
    });

    it('a confirmed delete of a NEVER-uploaded file queues nothing (nothing to hide)', async () => {
      await syncManager['confirmFileDelete']({
        type: 'delete',
        oldPath: `${testSyncPath}/local-only.txt`,
        oldArfsFileId: undefined,
        reason: 'confirmed',
      } as any);

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('does not double-queue a hide when one is already pending for the file', async () => {
      mockDatabaseManager.getPendingUploads.mockResolvedValue([
        { id: 'existing', operationType: 'hide', arfsFileId: fileEntityId, status: 'awaiting_approval' },
      ]);

      await syncManager['confirmFileDelete']({
        type: 'delete', oldPath: `${testSyncPath}/gone.txt`, oldArfsFileId: fileEntityId, reason: 'x',
      } as any);

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    });

    it('a confirmed folder delete queues a folder hide op AND marks the folder deleted', async () => {
      await syncManager['confirmFolderDelete'](`${testSyncPath}/GoneFolder`, folderEntityId);

      expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
      const op = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
      expect(op).toMatchObject({
        operationType: 'hide',
        status: 'awaiting_approval',
        arfsFolderId: folderEntityId,
        mimeType: 'folder',
        metadata: { isHidden: true },
      });
      expect(mockDatabaseManager.markFolderDeleted).toHaveBeenCalledWith(`${testSyncPath}/GoneFolder`);
    });

    it('a confirmed delete of an un-uploaded folder queues nothing but still marks it deleted', async () => {
      await syncManager['confirmFolderDelete'](`${testSyncPath}/LocalFolder`, undefined);

      expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
      expect(mockDatabaseManager.markFolderDeleted).toHaveBeenCalledWith(`${testSyncPath}/LocalFolder`);
    });
  });

  describe('Fail-closed privacy routing for metadata ops (PRIV-8)', () => {
    // The whole metadata-op family used `mapping?.drivePrivacy === 'private'`,
    // which is FALSE when the mapping is UNRESOLVED — so a PRIVATE entity's op
    // would silently route to the unencrypted PUBLIC ArFS path AND spend. The
    // fix funnels every site through resolveDrivePrivacyOrThrow, which THROWS on
    // an unresolved privacy state instead of defaulting to public.
    const fileEntityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const folderEntityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const publicMapping = { ...testMapping, drivePrivacy: 'public' as const };
    const privateMapping = { ...testMapping, drivePrivacy: 'private' as const, driveName: 'Secret Drive' };

    beforeEach(() => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
      // Mock BOTH the public and the PRIV-6 private move/rename paths so a
      // regression (leaking to public, or skipping the encrypted path) is
      // observable, never a silent no-op.
      (mockArDrive as any).renamePublicFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).movePublicFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).renamePublicFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).movePublicFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).renamePrivateFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).movePrivateFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).renamePrivateFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).movePrivateFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).createPrivateFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder', entityId: { toString: () => 'priv-folder' } }] });
      // executeFolderRename/Move record success/failure history via this method;
      // the shared mock DB doesn't stub it (no prior test drove those paths).
      (mockDatabaseManager as any).addFolderOperation = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
      driveKeyManager.clearAllKeys();
    });

    const makeHideOp = (over: any = {}) =>
      ({
        id: 'hide-op-priv8',
        driveId: testDriveId,
        localPath: `${testSyncPath}/gone.txt`,
        fileName: 'gone.txt',
        fileSize: 0,
        status: 'awaiting_approval',
        operationType: 'hide',
        metadata: { isHidden: true },
        arfsFileId: fileEntityId,
        createdAt: new Date(),
        ...over,
      }) as any;

    const makeRenameOp = (over: any = {}) =>
      ({
        id: 'rename-op-priv8',
        driveId: testDriveId,
        localPath: `${testSyncPath}/renamed.txt`,
        previousPath: `${testSyncPath}/renamed.txt`,
        fileName: 'renamed.txt',
        fileSize: 0,
        status: 'awaiting_approval',
        operationType: 'rename',
        arfsFileId: fileEntityId,
        createdAt: new Date(),
        ...over,
      }) as any;

    // --- (a) THE critical case: private entity + UNRESOLVED mapping -----------

    it('BLOCKS a hide op when the mapping is UNRESOLVED — never the public path, spends nothing', async () => {
      // The entity is really on a private drive, but its mapping is missing.
      mockDatabaseManager.getDriveMappings.mockResolvedValue([]);

      await expect(
        syncManager.executeMetadataOperation(makeHideOp())
      ).rejects.toThrow(/refusing to write to avoid leaking private data as public/i);

      // The unencrypted PUBLIC path was NOT taken (no leak)...
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
      expect(mockArDrive.hidePublicFolder).not.toHaveBeenCalled();
      // ...and the private path was not taken either — nothing was written/spent.
      expect(mockArDrive.hidePrivateFile).not.toHaveBeenCalled();
      // No local cache mutation either (the write never happened).
      expect(mockDatabaseManager.updateDriveMetadataHidden).not.toHaveBeenCalled();
    });

    it('BLOCKS a hide op when drivePrivacy is null (DB-shaped null column crosses raw)', async () => {
      // DB-shaped fixture: a real SQLite row surfaces a null column as null, not
      // as an absent key — the too-optimistic type says 'public'|'private'.
      mockDatabaseManager.getDriveMappings.mockResolvedValue([
        { ...testMapping, drivePrivacy: null },
      ]);

      await expect(
        syncManager.executeMetadataOperation(makeHideOp())
      ).rejects.toThrow(/Cannot resolve drive privacy/i);

      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
      expect(mockArDrive.hidePrivateFile).not.toHaveBeenCalled();
    });

    // --- (spend proof) the PAID folder-create path also fails closed ---------

    it('BLOCKS folder creation on an UNRESOLVED mapping — no paid createFolder call of either kind', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([]);

      await expect(
        syncManager['createFolderOnArweave'](`${testSyncPath}/NewFolder`)
      ).rejects.toThrow(/Cannot resolve drive privacy/i);

      // Neither the public nor the private paid folder-creation call fired.
      expect(mockArDrive.createPublicFolder).not.toHaveBeenCalled();
      expect((mockArDrive as any).createPrivateFolder).not.toHaveBeenCalled();
    });

    // --- (b) no regression: positively-public still uses the public path -----

    it('positively-public hide still routes to hidePublicFile (no regression)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);

      await syncManager.executeMetadataOperation(makeHideOp());

      expect(mockArDrive.hidePublicFile).toHaveBeenCalledTimes(1);
      expect(mockArDrive.hidePrivateFile).not.toHaveBeenCalled();
    });

    // --- (c) no regression: positively-private still encrypts ----------------

    it('positively-private hide still routes to hidePrivateFile WITH the drive key (no regression)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(makeHideOp());

      expect(mockArDrive.hidePrivateFile).toHaveBeenCalledTimes(1);
      expect(mockArDrive.hidePrivateFile.mock.calls[0][0].driveKey).toBe(key);
      expect(mockArDrive.hidePublicFile).not.toHaveBeenCalled();
    });

    // --- move/rename: public-only ArFS paths must also fail closed -----------

    it('BLOCKS a file rename on a LOCKED private drive (no key) — never any public/private write', async () => {
      // PRIV-6 added the private path, but a LOCKED drive (no cached key) must
      // still fail closed — never fall through to the unencrypted public write.
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      // No key cached => locked.

      await expect(
        syncManager.executeMetadataOperation(makeRenameOp())
      ).rejects.toThrow(/locked/i);

      // Neither the public plaintext rename NOR the private one fired (no spend).
      expect((mockArDrive as any).renamePublicFile).not.toHaveBeenCalled();
      expect((mockArDrive as any).renamePrivateFile).not.toHaveBeenCalled();
    });

    it('BLOCKS a file rename when the mapping is UNRESOLVED — never renamePublicFile', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([]);

      await expect(
        syncManager.executeMetadataOperation(makeRenameOp())
      ).rejects.toThrow(/Cannot resolve drive privacy/i);

      expect((mockArDrive as any).renamePublicFile).not.toHaveBeenCalled();
    });

    it('a file rename on a positively-PUBLIC drive still calls renamePublicFile (no regression)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);

      await syncManager.executeMetadataOperation(makeRenameOp());

      expect((mockArDrive as any).renamePublicFile).toHaveBeenCalledTimes(1);
      expect((mockArDrive as any).renamePublicFile.mock.calls[0][0].fileId.toString()).toBe(fileEntityId);
    });

    it('BLOCKS an auto-sync FOLDER rename on a LOCKED private drive — never renamePublicFolder', async () => {
      // No key cached => locked. PRIV-6's private path is unavailable, so it
      // must fail closed rather than leak the folder's new name as public.
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);

      await expect(
        syncManager['executeFolderRename'](folderEntityId, `${testSyncPath}/Old`, `${testSyncPath}/New`)
      ).rejects.toThrow(/locked/i);

      expect((mockArDrive as any).renamePublicFolder).not.toHaveBeenCalled();
      expect((mockArDrive as any).renamePrivateFolder).not.toHaveBeenCalled();
    });

    it('an auto-sync FOLDER rename on a public drive still calls renamePublicFolder (no regression)', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);

      await syncManager['executeFolderRename'](folderEntityId, `${testSyncPath}/Old`, `${testSyncPath}/New`);

      expect((mockArDrive as any).renamePublicFolder).toHaveBeenCalledTimes(1);
    });
  });

  describe('Private move/rename routed through the encrypted ArFS path (PRIV-6)', () => {
    // PRIV-8 fails a private/unresolved move/rename CLOSED (blocks). PRIV-6 adds
    // the positively-private branch: route through the *Private* ArFS calls WITH
    // the drive key so the metadata revision is ENCRYPTED — never a public
    // plaintext write. The fail-closed invariant (unresolved / locked → throw,
    // never public) is preserved.
    const fileEntityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const folderEntityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const parentFolderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const publicMapping = { ...testMapping, drivePrivacy: 'public' as const };
    const privateMapping = { ...testMapping, drivePrivacy: 'private' as const, driveName: 'Secret Drive' };

    beforeEach(() => {
      syncManager['driveId'] = testDriveId;
      syncManager['rootFolderId'] = testRootFolderId;
      // Mock BOTH public and private move/rename so a wrong route is observable.
      (mockArDrive as any).renamePublicFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).movePublicFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).renamePublicFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).movePublicFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).renamePrivateFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).movePrivateFile = vi.fn().mockResolvedValue({ created: [{ type: 'file' }], fees: {} });
      (mockArDrive as any).renamePrivateFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockArDrive as any).movePrivateFolder = vi.fn().mockResolvedValue({ created: [{ type: 'folder' }], fees: {} });
      (mockDatabaseManager as any).addFolderOperation = vi.fn().mockResolvedValue(undefined);
      // executeFolderMove resolves the destination parent's ArFS id from the DB.
      mockDatabaseManager.getFolderByPath.mockResolvedValue({ arfsFolderId: parentFolderId });
    });

    afterEach(() => {
      driveKeyManager.clearAllKeys();
    });

    const makeRenameOp = (over: any = {}) =>
      ({
        id: 'rename-op-priv6',
        driveId: testDriveId,
        localPath: `${testSyncPath}/renamed.txt`,
        previousPath: `${testSyncPath}/renamed.txt`,
        fileName: 'renamed.txt',
        fileSize: 0,
        status: 'awaiting_approval',
        operationType: 'rename',
        arfsFileId: fileEntityId,
        createdAt: new Date(),
        ...over,
      }) as any;

    const makeMoveOp = (over: any = {}) =>
      ({
        id: 'move-op-priv6',
        driveId: testDriveId,
        localPath: `${testSyncPath}/sub/moved.txt`,
        fileName: 'moved.txt',
        fileSize: 0,
        status: 'awaiting_approval',
        operationType: 'move',
        arfsFileId: fileEntityId,
        metadata: { newParentFolderId: parentFolderId },
        createdAt: new Date(),
        ...over,
      }) as any;

    // --- positively-private: encrypted path WITH the drive key ---------------

    it('a positively-PRIVATE file rename calls renamePrivateFile WITH the key — never renamePublicFile', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(makeRenameOp());

      expect((mockArDrive as any).renamePrivateFile).toHaveBeenCalledTimes(1);
      const arg = (mockArDrive as any).renamePrivateFile.mock.calls[0][0];
      expect(arg.fileId.toString()).toBe(fileEntityId);
      expect(arg.newName).toBe('renamed.txt');
      expect(arg.driveKey).toBe(key);
      // The unencrypted public path was NEVER taken.
      expect((mockArDrive as any).renamePublicFile).not.toHaveBeenCalled();
    });

    it('a positively-PRIVATE file move calls movePrivateFile WITH the key — never movePublicFile', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager.executeMetadataOperation(makeMoveOp());

      expect((mockArDrive as any).movePrivateFile).toHaveBeenCalledTimes(1);
      const arg = (mockArDrive as any).movePrivateFile.mock.calls[0][0];
      expect(arg.fileId.toString()).toBe(fileEntityId);
      expect(arg.newParentFolderId.toString()).toBe(parentFolderId);
      expect(arg.driveKey).toBe(key);
      expect((mockArDrive as any).movePublicFile).not.toHaveBeenCalled();
    });

    it('a positively-PRIVATE folder rename calls renamePrivateFolder WITH the key — never renamePublicFolder', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager['executeFolderRename'](folderEntityId, `${testSyncPath}/Old`, `${testSyncPath}/New`);

      expect((mockArDrive as any).renamePrivateFolder).toHaveBeenCalledTimes(1);
      const arg = (mockArDrive as any).renamePrivateFolder.mock.calls[0][0];
      expect(arg.folderId.toString()).toBe(folderEntityId);
      expect(arg.driveKey).toBe(key);
      expect((mockArDrive as any).renamePublicFolder).not.toHaveBeenCalled();
    });

    it('a positively-PRIVATE folder move calls movePrivateFolder WITH the key — never movePublicFolder', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      const key = { keyData: Buffer.from('secret') } as any;
      driveKeyManager.cacheKey(testDriveId, key);

      await syncManager['executeFolderMove'](folderEntityId, `${testSyncPath}/Old/Child`, `${testSyncPath}/New/Child`);

      expect((mockArDrive as any).movePrivateFolder).toHaveBeenCalledTimes(1);
      const arg = (mockArDrive as any).movePrivateFolder.mock.calls[0][0];
      expect(arg.folderId.toString()).toBe(folderEntityId);
      expect(arg.newParentFolderId.toString()).toBe(parentFolderId);
      expect(arg.driveKey).toBe(key);
      expect((mockArDrive as any).movePublicFolder).not.toHaveBeenCalled();
    });

    // --- no regression: positively-public still takes the public path --------

    it('a positively-PUBLIC file move still calls movePublicFile — never movePrivateFile', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);

      await syncManager.executeMetadataOperation(makeMoveOp());

      expect((mockArDrive as any).movePublicFile).toHaveBeenCalledTimes(1);
      expect((mockArDrive as any).movePrivateFile).not.toHaveBeenCalled();
    });

    it('a positively-PUBLIC folder move still calls movePublicFolder — never movePrivateFolder', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);

      await syncManager['executeFolderMove'](folderEntityId, `${testSyncPath}/Old/Child`, `${testSyncPath}/New/Child`);

      expect((mockArDrive as any).movePublicFolder).toHaveBeenCalledTimes(1);
      expect((mockArDrive as any).movePrivateFolder).not.toHaveBeenCalled();
    });

    // --- fail-closed preserved (PRIV-8) --------------------------------------

    it('an UNRESOLVED mapping still fails closed on a file move — never public OR private', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([]);

      await expect(
        syncManager.executeMetadataOperation(makeMoveOp())
      ).rejects.toThrow(/Cannot resolve drive privacy/i);

      expect((mockArDrive as any).movePublicFile).not.toHaveBeenCalled();
      expect((mockArDrive as any).movePrivateFile).not.toHaveBeenCalled();
    });

    it('a LOCKED private drive fails closed on a file move (no key) — never public OR private', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      // No key cached => locked.

      await expect(
        syncManager.executeMetadataOperation(makeMoveOp())
      ).rejects.toThrow(/locked/i);

      expect((mockArDrive as any).movePublicFile).not.toHaveBeenCalled();
      expect((mockArDrive as any).movePrivateFile).not.toHaveBeenCalled();
    });

    // --- SEC-1: the drive key must NEVER reach the logs ----------------------

    it('logs only the whitelisted summary of a private result — the drive key never leaks', async () => {
      mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
      driveKeyManager.cacheKey(testDriveId, { keyData: Buffer.from('secret') } as any);

      // A realistic private ArFS result carries key material: created[].key is an
      // EntityKey whose toString() is the raw url-encoded drive key, and some
      // shapes attach a top-level driveKey. summarizeArFSResult must strip both.
      const SECRET = 'RAW_DRIVE_KEY_MATERIAL_MUST_NOT_LEAK';
      (mockArDrive as any).renamePrivateFolder = vi.fn().mockResolvedValue({
        created: [{ type: 'folder', entityId: { toString: () => folderEntityId }, key: { toString: () => SECRET } }],
        driveKey: { toString: () => SECRET },
        fees: {},
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await syncManager['executeFolderRename'](folderEntityId, `${testSyncPath}/Old`, `${testSyncPath}/New`);
      } finally {
        // Serialize every console.log argument and prove the secret is absent.
        const logged = logSpy.mock.calls
          .flat()
          .map(a => {
            try { return typeof a === 'string' ? a : JSON.stringify(a); }
            catch { return String(a); }
          })
          .join(' || ');
        logSpy.mockRestore();
        expect(logged).not.toContain(SECRET);
      }

      // Sanity: the encrypted path really did run (so the log path was exercised).
      expect((mockArDrive as any).renamePrivateFolder).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Scenarios', () => {
    it('should surface database failures and return to idle', async () => {
      mockDatabaseManager.getDriveMappings.mockRejectedValue(new Error('Database error'));

      await expect(syncManager.startSync(testDriveId, testRootFolderId))
        .rejects.toThrow('Database error');

      expect(syncManager.getCurrentSyncState()).toBe('idle');
      const status = await syncManager.getStatus();
      expect(status.isActive).toBe(false);
      // The watcher must not be started after a failed sync
      expect(vi.mocked(chokidar.watch)).not.toHaveBeenCalled();
    });
  });

  describe('Progress Tracking', () => {
    // Managers constructed inside these tests; stopped in afterEach so their
    // progress-tracker intervals don't leak across tests.
    const extraManagers: SyncManager[] = [];

    const createManager = (): SyncManager => {
      const manager = new SyncManager(createMockDatabaseManager());
      extraManagers.push(manager);
      return manager;
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(async () => {
      vi.useRealTimers();
      await Promise.all(extraManagers.splice(0).map((manager) => manager.stopSync()));
    });

    it('should emit sync progress to the renderer window (throttled)', () => {
      const manager = createManager();
      const testProgress = {
        phase: 'syncing',
        description: 'Halfway there',
      };

      manager['emitSyncProgress'](testProgress);

      // Progress emission is throttled through SyncProgressTracker: nothing is
      // sent synchronously, the tracker flushes on an interval.
      expect(mockWebContentsSend).not.toHaveBeenCalled();

      vi.advanceTimersByTime(600);

      expect(mockWebContentsSend).toHaveBeenCalledWith('sync:progress', testProgress);
    });

    it('should not emit sync progress when silent flag is set', () => {
      const manager = createManager();

      manager['emitSyncProgress']({ phase: 'syncing' }, true);
      vi.advanceTimersByTime(600);

      expect(mockWebContentsSend).not.toHaveBeenCalled();
    });

    it('should handle missing main window gracefully', () => {
      mockGetAllWindows.mockReturnValue([]);
      const manager = createManager();

      manager['emitSyncProgress']({ phase: 'syncing' });

      expect(() => vi.advanceTimersByTime(600)).not.toThrow();
      expect(mockWebContentsSend).not.toHaveBeenCalled();
    });
  });
});
