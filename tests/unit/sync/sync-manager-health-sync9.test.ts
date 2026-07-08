// @vitest-environment node
//
// SYNC-9: a degraded/offline sync must be VISIBLE, never a silent
// healthy-looking app. These tests drive SyncManager's real start/stop/watcher
// flow and assert that the honest sync-health signal (surfaced through
// getStatus().health — the same channel the persistent header indicator + tray
// poll) reflects offline/error/recovery instead of pretending everything is
// fine.
//
// Runs under node (not jsdom) for the same reason as sync-manager.test.ts: the
// transitive ardrive-core-js import chain fails its ecc self-check under jsdom.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '@/main/sync-manager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';

const { mockWatcher, mockWindow } = vi.hoisted(() => {
  const mockWebContentsSend = vi.fn();
  const mockWindow = {
    isDestroyed: () => false,
    webContents: { send: mockWebContentsSend, isDestroyed: () => false },
  };
  return {
    mockWatcher: {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    },
    mockWebContentsSend,
    mockWindow,
  };
});

vi.mock('chokidar', () => {
  const watch = vi.fn(() => mockWatcher);
  return { watch, default: { watch } };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWindow]) },
  app: { getPath: vi.fn(() => '/mock/user-data') },
  // Notification unsupported ⇒ notifySyncError short-circuits (no configManager
  // mock needed); we assert on the health STATE, not the OS notification.
  Notification: { isSupported: vi.fn(() => false) },
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

describe('SyncManager sync-health (SYNC-9)', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;

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
    mockWatcher.close.mockResolvedValue(undefined);
    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([testMapping]);
    mockArDrive = createMockArDrive();
    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
  });

  afterEach(async () => {
    // Tears down the watcher AND clears the offline reconnect watchdog
    // (stopSync -> markSyncHealthy), so no timer leaks across tests.
    await syncManager.stopSync();
  });

  // Force the drive-metadata read to fail with the given error. This is the
  // gateway GQL fetch inside performFullDriveSync (already wrapped in SYNC-20
  // retryWithBackoff) — the authoritative point where "offline" is detected.
  const failMetadataWith = (error: Error) =>
    vi.spyOn(syncManager['downloadManager'], 'syncDriveMetadata').mockRejectedValue(error);

  it('starts HEALTHY and reports health:"healthy" once monitoring', async () => {
    const started = await syncManager.startSync(testDriveId, testRootFolderId);
    expect(started).toBe(true);
    const status = await syncManager.getStatus();
    expect(status.isActive).toBe(true);
    expect(status.health).toBe('healthy');
    expect(status.healthMessage).toBeUndefined();
  });

  it(
    'metadata-sync failing with a NETWORK-DOWN error (after SYNC-20 retries) → health "offline", not a fake "up to date"',
    async () => {
      failMetadataWith(new Error('getaddrinfo ENOTFOUND turbo-gateway.com'));

      await expect(
        syncManager.startSync(testDriveId, testRootFolderId)
      ).rejects.toThrow();

      const status = await syncManager.getStatus();
      // The app must NOT look healthy: not active, and health is explicitly offline.
      expect(status.isActive).toBe(false);
      expect(status.health).toBe('offline');
      expect(status.healthMessage).toMatch(/offline|gateway/i);
    },
    20000
  );

  it('metadata-sync failing with a NON-network error → health "error" (user-actionable, not offline)', async () => {
    failMetadataWith(new Error('Invalid drive metadata: schema mismatch'));

    await expect(
      syncManager.startSync(testDriveId, testRootFolderId)
    ).rejects.toThrow();

    const status = await syncManager.getStatus();
    expect(status.isActive).toBe(false);
    expect(status.health).toBe('error');
    // A failed start without SYNC-9 read as a benign "Paused" (isActive=false);
    // the health signal is what makes the failure visible.
    expect(status.healthMessage).toMatch(/sync error/i);
  });

  it('a mid-session watcher error → visible health "error" state (was only a console line)', async () => {
    await syncManager.startSync(testDriveId, testRootFolderId);
    expect((await syncManager.getStatus()).health).toBe('healthy');

    // Grab the 'error' handler chokidar was wired with and fire it, as a real
    // watcher crash would (e.g. EMFILE / inotify limit).
    const errorHandler = mockWatcher.on.mock.calls.find((c) => c[0] === 'error')?.[1] as
      | ((err: unknown) => void)
      | undefined;
    expect(errorHandler).toBeTypeOf('function');
    errorHandler!(new Error('EMFILE: too many open files, watch'));

    const status = await syncManager.getStatus();
    expect(status.health).toBe('error');
    expect(status.healthMessage).toMatch(/EMFILE|sync error/i);
  });

  it(
    'RECOVERY: a successful (re)start after an offline failure clears the degraded state back to "healthy"',
    async () => {
      const spy = failMetadataWith(new Error('fetch failed'));

      await expect(
        syncManager.startSync(testDriveId, testRootFolderId)
      ).rejects.toThrow();
      expect((await syncManager.getStatus()).health).toBe('offline');

      // Connectivity returns — the next start succeeds.
      spy.mockResolvedValue(undefined);
      const restarted = await syncManager.startSync(testDriveId, testRootFolderId);

      expect(restarted).toBe(true);
      const status = await syncManager.getStatus();
      expect(status.isActive).toBe(true);
      expect(status.health).toBe('healthy');
      expect(status.healthMessage).toBeUndefined();
    },
    20000
  );

  it('an intentional stopSync clears a degraded state (paused, not "Sync error")', async () => {
    failMetadataWith(new Error('Invalid drive metadata: schema mismatch'));
    await expect(
      syncManager.startSync(testDriveId, testRootFolderId)
    ).rejects.toThrow();
    expect((await syncManager.getStatus()).health).toBe('error');

    await syncManager.stopSync();

    const status = await syncManager.getStatus();
    expect(status.isActive).toBe(false);
    // Health healthy again ⇒ the indicator reads the honest "Paused", not a
    // stale "Sync error" after the user deliberately paused.
    expect(status.health).toBe('healthy');
  });
});
