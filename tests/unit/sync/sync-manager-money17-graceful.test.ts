// @vitest-environment node
//
// MONEY-17: graceful handling when the user is out of free tier / credits.
//
// The app assumes small file = free = skip the affordability check, so a "free"
// upload can't be pre-checked. Under Turbo's new CUMULATIVE free tier a small
// file CAN be rejected once the quota is spent. The old code (a) detected this
// by a brittle string-match and (b) printed a MISLEADING "should be FREE... may
// be a configuration issue" line, treating the now-normal exhausted-quota case
// as a glitch, and left the upload in a DEAD `failed` state.
//
// These behavioral tests drive the REAL uploadFile path with a mocked ArFS layer
// (never spends) and DB-SHAPED fixtures (integer/nullable columns) to prove:
//   1. a free-eligible small file rejected for funds lands in the RECOVERABLE
//      state (status 'failed' + errorReason 'insufficient_funds') with the HONEST
//      message — never "configuration issue", never marked completed/synced;
//   2. the top-up CTA fires exactly ONCE across repeated rejections (anti-spam);
//   3. it AUTO-RESUMES when funds arrive (resumeUploadsBlockedOnFunds re-queues
//      it, clears the marker, re-arms the nudge);
//   4. a genuinely terminal failure stays terminal (no funds marker, no CTA, not
//      resumed);
//   5. the current free upload still SUCCEEDS (the funnel is untouched).
//
// Runs under node (the ardrive-core-js import chain fails its ecc self-check
// under jsdom — see sync-manager.test.ts header).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TURBO_FREE_SIZE_LIMIT } from '@/utils/turbo-utils';

const { mockWrapFileOrFolder } = vi.hoisted(() => ({
  mockWrapFileOrFolder: vi.fn(),
}));

vi.mock('ardrive-core-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ardrive-core-js')>();
  return { ...actual, wrapFileOrFolder: mockWrapFileOrFolder };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { getPath: vi.fn(() => '/mock/user-data') },
  Notification: { isSupported: vi.fn(() => false) },
}));

vi.mock('chokidar', () => {
  const watch = vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }));
  return { watch, default: { watch } };
});

vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(Buffer.from('content')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false }),
}));

// SYNC-10: sync-manager.ts now hashes via the real streaming utility
// (fs.createReadStream), which would try to open the (non-existent, mocked)
// test file path on the REAL filesystem. Hash the same mocked
// `fs/promises.readFile` content the old inline `readFile + createHash` code
// used to.
vi.mock('@/main/sync/streaming-hash', () => ({
  hashFileStream: vi.fn(async (filePath: string) => {
    const fsp = await import('fs/promises');
    const crypto = await import('crypto');
    const content = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(content as any).digest('hex');
  }),
}));

import { SyncManager } from '@/main/sync-manager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';
import { driveKeyManager } from '@/main/drive-key-manager';
import { notificationService } from '@/main/notification-service';

const testDriveId = '11111111-1111-4111-8111-111111111111';
const testRootFolderId = '22222222-2222-4222-8222-222222222222';
const testSyncPath = '/test/sync/folder';

const publicMapping = {
  id: 'test-mapping-id',
  driveId: testDriveId,
  driveName: 'Test Drive',
  drivePrivacy: 'public' as const,
  rootFolderId: testRootFolderId,
  localFolderPath: testSyncPath,
  isActive: true,
};

describe('MONEY-17: graceful out-of-funds / free-quota handling', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;
  let fsStat: ReturnType<typeof vi.fn>;
  let ctaSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // A free-tier small file: the wrap reports exactly the approved size so the
    // MONEY-10 checkpoints pass and execution reaches uploadAllEntities.
    mockWrapFileOrFolder.mockImplementation(() => ({ destinationBaseName: 'doc.txt', size: 100 }));

    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);
    mockArDrive = createMockArDrive();

    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
    syncManager['driveId'] = testDriveId;
    syncManager['rootFolderId'] = testRootFolderId;

    syncManager['costCalculator'] = {
      isFileTooBig: vi.fn(() => false),
      isFreeWithTurbo: vi.fn((size: number) => size <= TURBO_FREE_SIZE_LIMIT),
      calculateUploadCosts: vi.fn(async () => ({
        estimatedCost: 0.0002,
        estimatedTurboCost: 0,
        recommendedMethod: 'turbo',
        hasSufficientTurboBalance: true,
      })),
      getFolderCost: vi.fn(() => 0.000001),
      formatCostInAR: vi.fn(() => '0.000000'),
    } as any;

    // Count CTA fires without touching the OS layer.
    ctaSpy = vi.spyOn(notificationService, 'notifyOutOfFreeStorage').mockImplementation(() => {});

    const fs = await import('fs/promises');
    fsStat = vi.mocked(fs.stat) as unknown as ReturnType<typeof vi.fn>;
    fsStat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false } as any);
  });

  afterEach(async () => {
    driveKeyManager.clearAllKeys();
    ctaSpy.mockRestore();
    await syncManager.stopSync();
  });

  // A DB-shaped approved upload row (INTEGER size, method column present).
  const makeUpload = (over: any = {}) =>
    ({
      id: 'upload-money17-1',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: 100, // free-tier size
      status: 'pending',
      progress: 0,
      uploadMethod: 'turbo',
      createdAt: new Date(),
      ...over,
    }) as any;

  function lastFailedUpdate(): any {
    const call = mockDatabaseManager.updateUpload.mock.calls
      .filter((c: any[]) => c[1] && c[1].status === 'failed')
      .pop();
    return call?.[1];
  }

  // --- (1) free file rejected for funds → recoverable state + honest message ---

  it('a FREE small file rejected for funds lands in the recoverable insufficient_funds state with the HONEST message', async () => {
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => {
      throw new Error('insufficient balance');
    });

    const upload = makeUpload();
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    // The upload WAS attempted (free files are still tried — the funnel is intact).
    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);

    const failUpdate = lastFailedUpdate();
    expect(failUpdate).toBeTruthy();
    // Distinguishable, recoverable marker — NOT a generic failure.
    expect(failUpdate.errorReason).toBe('insufficient_funds');
    // Honest, actionable message — the misleading line is GONE.
    expect(failUpdate.error.toLowerCase()).not.toContain('configuration issue');
    expect(failUpdate.error.toLowerCase()).not.toContain('should be free');
    expect(failUpdate.error).toContain('free storage');
    expect(failUpdate.error).toContain('Top up');
    // In-memory record reflects the recoverable reason.
    expect(upload.errorReason).toBe('insufficient_funds');

    // NOT marked synced/completed (no false success).
    expect(mockDatabaseManager.addUpload).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
    expect(mockDatabaseManager.updateUpload).not.toHaveBeenCalledWith(
      'upload-money17-1',
      expect.objectContaining({ status: 'completed' })
    );

    // Actionable CTA fired exactly once.
    expect(ctaSpy).toHaveBeenCalledTimes(1);
  });

  // --- (2) anti-spam: repeated rejections fire the CTA once ------------------

  it('fires the top-up CTA once across repeated funds rejections (anti-spam)', async () => {
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => {
      throw new Error('Insufficient Turbo Credits. Required: 0.5, Available: 0');
    });

    const u1 = makeUpload({ id: 'u-1' });
    const u2 = makeUpload({ id: 'u-2' });
    await syncManager['uploadFile'](u1);
    await syncManager['uploadFile'](u2);

    // Two funds rejections, ONE toast (edge-triggered, still low).
    expect(ctaSpy).toHaveBeenCalledTimes(1);
    expect(u1.errorReason).toBe('insufficient_funds');
    expect(u2.errorReason).toBe('insufficient_funds');
  });

  // --- (3) auto-resume when funds arrive -------------------------------------

  it('AUTO-RESUMES funds-blocked uploads when credits arrive (re-queue + clear marker + re-arm)', async () => {
    // The DB row as node-sqlite3 returns it: integer-free but with the funds
    // marker and NO charge evidence (nothing was uploaded).
    const blockedRow = {
      id: 'upload-money17-1',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: 100,
      status: 'failed',
      progress: 0,
      uploadMethod: 'turbo',
      error: "You've used your free storage. Top up $5 to get 10 MB free every month, or add credits to continue.",
      errorReason: 'insufficient_funds',
      dataTxId: null,
      fileId: null,
      createdAt: new Date(),
    };
    mockDatabaseManager.getFundsBlockedUploads.mockResolvedValue([blockedRow]);

    // Simulate having already notified (out-of-funds episode in progress).
    syncManager['turboBalanceLow'] = true;
    const queueSpy = vi.spyOn(syncManager, 'addToUploadQueue').mockImplementation(() => {});

    const resumed = await syncManager.resumeUploadsBlockedOnFunds();

    expect(resumed).toBe(1);
    // Re-queued for a fresh attempt through the normal (money-safe) upload path.
    expect(queueSpy).toHaveBeenCalledTimes(1);
    // Reset to pending with the recoverable marker + error CLEARED.
    expect(mockDatabaseManager.updateUpload).toHaveBeenCalledWith(
      'upload-money17-1',
      expect.objectContaining({ status: 'pending', errorReason: undefined, error: undefined })
    );
    // The out-of-funds/low nudge is re-armed so a later shortfall notifies again.
    expect(syncManager['turboBalanceLow']).toBe(false);
  });

  it('does NOT resume a funds-blocked row that already carries on-chain charge evidence (no double-charge)', async () => {
    const chargedRow = {
      id: 'upload-money17-2',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: 100,
      status: 'failed',
      uploadMethod: 'turbo',
      errorReason: 'insufficient_funds',
      dataTxId: 'already-on-chain-tx', // charged
      fileId: null,
      createdAt: new Date(),
    };
    mockDatabaseManager.getFundsBlockedUploads.mockResolvedValue([chargedRow]);
    const queueSpy = vi.spyOn(syncManager, 'addToUploadQueue').mockImplementation(() => {});

    const resumed = await syncManager.resumeUploadsBlockedOnFunds();

    expect(resumed).toBe(0);
    expect(queueSpy).not.toHaveBeenCalled();
    expect(mockDatabaseManager.updateUpload).not.toHaveBeenCalled();
  });

  // --- (4) a genuinely terminal failure stays terminal ----------------------

  it('a genuinely terminal (network) failure is NOT marked recoverable and fires no CTA', async () => {
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => {
      throw new Error('network error: ECONNRESET');
    });

    const upload = makeUpload();
    await syncManager['uploadFile'](upload);

    const failUpdate = lastFailedUpdate();
    expect(failUpdate.status).toBe('failed');
    expect(failUpdate.errorReason).not.toBe('insufficient_funds');
    expect(ctaSpy).not.toHaveBeenCalled();

    // And it is NOT picked up by the resume trigger (only insufficient_funds rows are).
    mockDatabaseManager.getFundsBlockedUploads.mockResolvedValue([]);
    const resumed = await syncManager.resumeUploadsBlockedOnFunds();
    expect(resumed).toBe(0);
  });

  // --- (5) the current free upload still succeeds (funnel untouched) ---------

  it('a 0-credit user uploading a free (<=105 KiB) file STILL succeeds today', async () => {
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => ({
      created: [
        {
          type: 'file',
          entityId: { toString: () => '82624855-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          dataTxId: { toString: () => 'new-data-tx' },
          metadataTxId: { toString: () => 'new-meta-tx' },
        },
      ],
      tips: [],
      fees: {},
    }));

    const upload = makeUpload({ fileSize: TURBO_FREE_SIZE_LIMIT }); // exactly free
    fsStat.mockResolvedValue({ size: TURBO_FREE_SIZE_LIMIT, isFile: () => true, isDirectory: () => false } as any);
    mockWrapFileOrFolder.mockImplementation(() => ({ destinationBaseName: 'doc.txt', size: TURBO_FREE_SIZE_LIMIT }));

    syncManager.addToUploadQueue(upload);
    await syncManager['uploadFile'](upload);

    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    // Completed truthfully; no funds marker, no CTA.
    expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'upload-money17-1', status: 'completed' })
    );
    expect(ctaSpy).not.toHaveBeenCalled();
    expect(upload.errorReason).toBeUndefined();
  });
});
