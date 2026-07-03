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
import { createMockArDrive } from '../../helpers/mock-ardrive';
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
