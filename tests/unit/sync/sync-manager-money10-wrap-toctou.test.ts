// @vitest-environment node
//
// MONEY-10 ACCEPTANCE — wrapped-size assertion closes the re-stat → wrap TOCTOU.
//
// MONEY-10 re-stats the file at the START of uploadFile (revalidateApprovedFileSize)
// and compares the on-disk size to the approved size. But the bytes actually
// uploaded are read LATER, by wrapFileOrFolder(upload.localPath) inside
// uploadFileWithArDriveCore (normal path + the File-ID-tag retry re-wrap). Between
// the re-stat and the wrap there are awaits — most notably getTargetFolderId(),
// which can create parent folders on-chain with 1s/2s retry sleeps. If the file
// changes in that window, wrapFileOrFolder reads the NEWER bytes at the NEWER
// size; without a guard, uploadAllEntities would upload them at a size the user
// never approved.
//
// Invariant under test: "no bytes are ever uploaded at a size the user did not
// approve." The fix asserts the WRAPPED file's size (ArFSFileToUpload.size — the
// exact bytes that will be uploaded) == the approved size immediately BEFORE
// uploadAllEntities, on BOTH the normal and retry wrap sites; on mismatch it
// re-queues for approval at the current size and aborts with no spend. These
// tests drive the residual window (approve free → grow to paid AFTER the re-stat)
// and prove the upload does NOT fire and the item is re-queued. They mock fs.stat
// + wrapFileOrFolder + the ArFS layer and NEVER spend. Run under node (the
// ardrive-core-js import chain fails its ecc self-check under jsdom).
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

// fs.stat models the TOCTOU: the FIRST call (revalidate) sees the approved size,
// so revalidate passes; the file then grows before the wrap reads it. The wrap
// mock (not stat) is what supplies the grown "bytes to upload" the assert catches.
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

import { SyncManager } from '@/main/sync-manager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';
import { driveKeyManager } from '@/main/drive-key-manager';

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

function fileUploadResult() {
  return {
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
  };
}

describe('MONEY-10 acceptance: wrapped-size assertion closes the re-stat → wrap TOCTOU', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;
  let fsStat: ReturnType<typeof vi.fn>;

  const approvedFreeSize = TURBO_FREE_SIZE_LIMIT; // approved as FREE
  const grownPaidSize = TURBO_FREE_SIZE_LIMIT + 10_000; // grows to PAID after the re-stat

  beforeEach(async () => {
    vi.clearAllMocks();

    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);
    mockArDrive = createMockArDrive();
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => fileUploadResult());

    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
    syncManager['driveId'] = testDriveId;
    syncManager['rootFolderId'] = testRootFolderId;

    // Deterministic, network-free costs for the recompute-on-requeue path.
    syncManager['costCalculator'] = {
      isFileTooBig: vi.fn(() => false),
      isFreeWithTurbo: vi.fn((size: number) => size <= TURBO_FREE_SIZE_LIMIT),
      calculateUploadCosts: vi.fn(async () => ({
        estimatedCost: 0.0002,
        estimatedTurboCost: 42,
        recommendedMethod: 'turbo',
        hasSufficientTurboBalance: true,
      })),
      getFolderCost: vi.fn(() => 0.000001),
      formatCostInAR: vi.fn(() => '0.000000'),
    } as any;

    const fs = await import('fs/promises');
    fsStat = vi.mocked(fs.stat) as unknown as ReturnType<typeof vi.fn>;

    // revalidate (first stat) sees the approved size and passes; the file then
    // grows on disk, so any later stat would see the LARGER bytes.
    fsStat.mockResolvedValueOnce({ size: approvedFreeSize, isFile: () => true, isDirectory: () => false } as any);
    fsStat.mockResolvedValue({ size: grownPaidSize, isFile: () => true, isDirectory: () => false } as any);
  });

  afterEach(async () => {
    driveKeyManager.clearAllKeys();
    await syncManager.stopSync();
  });

  const makeUpload = (over: any = {}) =>
    ({
      id: 'toctou-1',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: approvedFreeSize, // user approved FREE
      status: 'pending',
      progress: 0,
      uploadMethod: 'turbo',
      createdAt: new Date(),
      ...over,
    }) as any;

  // --- Normal wrap path (~sync-manager.ts:2883) ------------------------------

  it('NORMAL PATH: a file that grew after the re-stat but before the wrap is NOT uploaded — it is re-queued', async () => {
    // The wrap reflects the grown (paid) file the user never approved.
    mockWrapFileOrFolder.mockImplementation(() => ({
      destinationBaseName: 'doc.txt',
      size: grownPaidSize,
    }));

    const upload = makeUpload({ existingArfsFileId: '82624855-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    syncManager.addToUploadQueue(upload);
    await syncManager['uploadFile'](upload);

    // The grown (paid) bytes are NEVER uploaded — the assert fired before uploadAllEntities.
    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();

    // Re-queued for approval at the NEW (wrapped) size via the shared re-queue path.
    expect(mockDatabaseManager.removeUpload).toHaveBeenCalledWith('toctou-1');
    expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(requeued.status).toBe('awaiting_approval');
    expect(requeued.fileSize).toBe(grownPaidSize);
    // Amplifier neutralized: the free→paid crossing is caught, not silently made free.
    expect(requeued.conflictDetails).toContain('free-tier');
    // SYNC-26 revision target preserved through the re-queue.
    expect(requeued.arfsFileId).toBe('82624855-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('NORMAL PATH: an unchanged file (wrapped size == approved size) uploads exactly once', async () => {
    // Re-stat and wrap both agree with the approved size — nothing changed.
    fsStat.mockReset();
    fsStat.mockResolvedValue({ size: approvedFreeSize, isFile: () => true, isDirectory: () => false } as any);
    mockWrapFileOrFolder.mockImplementation(() => ({
      destinationBaseName: 'doc.txt',
      size: approvedFreeSize,
    }));

    const upload = makeUpload();
    syncManager.addToUploadQueue(upload);
    await syncManager['uploadFile'](upload);

    // The assert allowed the upload through (bytes == approval); it fired once.
    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
  });

  // --- Retry wrap path (~sync-manager.ts:2984, File-ID-tag re-wrap) ----------

  it('RETRY PATH: a file that grows before the File-ID-tag retry re-wrap is NOT re-uploaded — it is re-queued', async () => {
    // First wrap matches the approval (assert passes), so the first upload
    // attempt fires and then throws the File-ID-tag error that triggers the
    // retry. The retry re-wraps and sees the grown bytes — the retry assert must
    // catch them BEFORE the second (paid) uploadAllEntities call.
    mockWrapFileOrFolder
      .mockReturnValueOnce({ destinationBaseName: 'doc.txt', size: approvedFreeSize })
      .mockReturnValue({ destinationBaseName: 'doc.txt', size: grownPaidSize });

    (mockArDrive as any).uploadAllEntities = vi.fn(async () => {
      throw new Error('File-ID tag missing on the created entity');
    });

    const upload = makeUpload();
    syncManager.addToUploadQueue(upload);
    await syncManager['uploadFile'](upload);

    // Exactly ONE upload attempt (the first, which threw). The retry NEVER
    // uploaded the grown bytes — the retry-site assert re-queued instead.
    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(requeued.status).toBe('awaiting_approval');
    expect(requeued.fileSize).toBe(grownPaidSize);
  });
});
