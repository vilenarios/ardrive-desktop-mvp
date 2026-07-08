// @vitest-environment node
//
// MONEY-10: an approved upload must never upload at a size/cost the user did
// NOT approve. An upload is approved at size X (the cost shown + OK'd was
// computed from X). Between approval and execution the file can change on disk
// (the user edits it). The old behaviour wrapped + uploaded whatever was on
// disk NOW — so a file that grew after approval uploaded at the LARGER size,
// crossing the Turbo free-tier boundary (107520 bytes) or costing more than
// approved: an UNAPPROVED SPEND.
//
// The fix re-stats the file just before wrapping/uploading. If the current size
// differs from the approved size (exact-match tolerance), the item is returned
// to the approval queue and NO upload happens. If the file is gone, the upload
// is cancelled cleanly. These tests mock fs.stat + the ArFS layer and NEVER
// spend. They run under node (the ardrive-core-js import chain fails its ecc
// self-check under jsdom — see sync-manager.test.ts header).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TURBO_FREE_SIZE_LIMIT } from '@/utils/turbo-utils';

// Stub ONLY wrapFileOrFolder so no real file is read from disk; keep the real
// EID (validates UUID shape + provides toString()).
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

// fs.stat is the money-critical re-validation input — each test overrides it.
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
const ORIGINAL_FILE_ID = '82624855-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
        entityId: { toString: () => ORIGINAL_FILE_ID },
        dataTxId: { toString: () => 'new-data-tx' },
        metadataTxId: { toString: () => 'new-meta-tx' },
      },
    ],
    tips: [],
    fees: {},
  };
}

describe('MONEY-10: re-validate file size at upload time (no unapproved-size upload)', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;
  let fsStat: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // MONEY-10 (TOCTOU): the wrap now reports the exact bytes to be uploaded and
    // that size is asserted == the approved size before uploadAllEntities. A real
    // ArFSFileToUpload always exposes a numeric `size`; the only test here that
    // reaches the wrap is the UNCHANGED-size case (approved 100 → wrap 100).
    mockWrapFileOrFolder.mockImplementation(() => ({ destinationBaseName: 'doc.txt', size: 100 }));

    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);
    // getPendingUploads is read after a re-queue (for the notify count); default
    // is [] from the mock — fine, we assert on addPendingUpload directly.
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
  });

  afterEach(async () => {
    driveKeyManager.clearAllKeys();
    await syncManager.stopSync();
  });

  // The approved-size row is a SQLite-shaped FileUpload: fileSize is the size the
  // user approved. (DB booleans are 0/1, nullable cols are null — we only rely on
  // fileSize here, an INTEGER column.)
  const makeUpload = (over: any = {}) =>
    ({
      id: 'upload-money10-1',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: 100, // approved size
      status: 'pending',
      progress: 0,
      uploadMethod: 'turbo',
      createdAt: new Date(),
      ...over,
    }) as any;

  // --- (1) Grew past the free-tier boundary after approval ------------------

  it('a file that GREW past the free-tier boundary is returned to awaiting_approval and NOT uploaded', async () => {
    // Approved as free (<= limit); now the file is larger than the free-tier
    // boundary — uploading it would be an unapproved paid spend.
    const approvedSize = TURBO_FREE_SIZE_LIMIT; // exactly free at approval
    const grownSize = TURBO_FREE_SIZE_LIMIT + 5000; // now paid
    fsStat.mockResolvedValue({ size: grownSize, isFile: () => true, isDirectory: () => false } as any);

    const upload = makeUpload({ fileSize: approvedSize });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    // The paid upload NEVER fired.
    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
    expect(mockWrapFileOrFolder).not.toHaveBeenCalled();

    // The stale execution record was dropped and the item re-queued for approval
    // at the NEW size, with a clear re-approve note.
    expect(mockDatabaseManager.removeUpload).toHaveBeenCalledWith('upload-money10-1');
    expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(requeued.id).toBe('upload-money10-1');
    expect(requeued.status).toBe('awaiting_approval');
    expect(requeued.fileSize).toBe(grownSize);
    expect(requeued.conflictDetails).toContain('File changed since approval');
    expect(requeued.conflictDetails).toContain(`${approvedSize} → ${grownSize}`);
    expect(requeued.conflictDetails).toContain('free-tier'); // boundary-crossing warning
  });

  // --- (2) Grew but still paid tier (costs more than approved) ---------------

  it('a file that GREW within the paid tier (costs more than approved) is re-queued, not uploaded', async () => {
    const approvedSize = 200_000; // already paid
    const grownSize = 900_000; // costs more than approved
    fsStat.mockResolvedValue({ size: grownSize, isFile: () => true, isDirectory: () => false } as any);

    const upload = makeUpload({ fileSize: approvedSize });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(requeued.fileSize).toBe(grownSize);
    // Both paid — no free-tier crossing note in this case.
    expect(requeued.conflictDetails).not.toContain('free-tier');
    // Cost recomputed for the new size (not carried over from approval).
    expect(syncManager['costCalculator'].calculateUploadCosts).toHaveBeenCalledWith(grownSize);
  });

  // --- (3) Unchanged size uploads normally -----------------------------------

  it('a file whose size is UNCHANGED uploads normally (no re-queue)', async () => {
    fsStat.mockResolvedValue({ size: 100, isFile: () => true, isDirectory: () => false } as any);

    const upload = makeUpload({ fileSize: 100, existingArfsFileId: ORIGINAL_FILE_ID });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    // The upload proceeded to the ArFS layer exactly once.
    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    // It was NOT returned to the approval queue.
    expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    expect(mockDatabaseManager.removeUpload).not.toHaveBeenCalled();
    // Completed truthfully.
    expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'upload-money10-1', status: 'completed' })
    );
  });

  // --- (4) A file that SHRANK still differs from approval → re-queue ---------

  it('a file that SHRANK differs from what was approved and is re-queued (safe default)', async () => {
    const approvedSize = 500_000;
    const shrunkSize = 50_000; // cheaper, but not what was approved
    fsStat.mockResolvedValue({ size: shrunkSize, isFile: () => true, isDirectory: () => false } as any);

    const upload = makeUpload({ fileSize: approvedSize });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(requeued.fileSize).toBe(shrunkSize);
    expect(requeued.status).toBe('awaiting_approval');
  });

  // --- (5) Deleted / missing file → cancelled cleanly, no crash --------------

  it('a file DELETED before upload is skipped/cancelled cleanly (no crash, no upload, no re-queue)', async () => {
    const enoent: NodeJS.ErrnoException = new Error('ENOENT: no such file');
    enoent.code = 'ENOENT';
    fsStat.mockRejectedValue(enoent);

    const upload = makeUpload({ fileSize: 100 });
    syncManager.addToUploadQueue(upload);

    // Must not throw.
    await expect(syncManager['uploadFile'](upload)).resolves.toBeUndefined();

    // No upload, and NOT re-queued (there is nothing to upload).
    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
    expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();

    // Recorded as failed with a clear note.
    expect(mockDatabaseManager.updateUpload).toHaveBeenCalledWith(
      'upload-money10-1',
      expect.objectContaining({ status: 'failed' })
    );
    const failUpdate = mockDatabaseManager.updateUpload.mock.calls.find(
      (c: any[]) => c[1] && c[1].status === 'failed'
    );
    expect(failUpdate?.[1].error).toContain('no longer exists');
  });

  // --- (6) A non-regular file now at the path is treated as gone -------------

  it('a path that is no longer a regular file (e.g. replaced by a directory) is cancelled, not uploaded', async () => {
    fsStat.mockResolvedValue({ size: 0, isFile: () => false, isDirectory: () => true } as any);

    const upload = makeUpload({ fileSize: 100 });
    syncManager.addToUploadQueue(upload);

    await expect(syncManager['uploadFile'](upload)).resolves.toBeUndefined();

    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
    expect(mockDatabaseManager.addPendingUpload).not.toHaveBeenCalled();
    expect(mockDatabaseManager.updateUpload).toHaveBeenCalledWith(
      'upload-money10-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  // --- (7) Re-queue preserves the SYNC-26 revision target --------------------

  it('re-queue preserves the SYNC-26 revision fileId so re-approval still uploads a revision', async () => {
    fsStat.mockResolvedValue({ size: 999_999, isFile: () => true, isDirectory: () => false } as any);

    const upload = makeUpload({ fileSize: 100, existingArfsFileId: ORIGINAL_FILE_ID });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFile'](upload);

    const requeued = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    // arfsFileId is the revision target on the pending-upload shape.
    expect(requeued.arfsFileId).toBe(ORIGINAL_FILE_ID);
  });
});
