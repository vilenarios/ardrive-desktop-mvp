// @vitest-environment node
//
// SYNC-26: editing a synced file must produce an ArFS REVISION of the SAME
// fileId (new dataTx + metadata), not a brand-new file entity. The live bug
// (UAT-SYNC-OPS-LIVE2) re-uploaded an edit under a fresh fileId
// (82624855…→912d5fda…), breaking the file's revision history.
//
// ardrive-core-js keys revisions off `wrappedFile.existingId`
// (arfsdao.prepareFile: `fileId = wrappedFile.existingId ?? EID(uuid())`). The
// fix threads the recorded on-chain fileId onto the wrapped file so the upload
// deterministically reuses it. These tests mock the ArFS layer and NEVER spend.
//
// Runs under node (not jsdom): the ardrive-core-js import chain fails its ecc
// self-check under jsdom (see sync-manager.test.ts header).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub ONLY wrapFileOrFolder so no real file is read from disk. Everything else
// (crucially the real EID, which validates UUID shape and provides toString())
// passes through unchanged.
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
}));

vi.mock('chokidar', () => {
  const watch = vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }));
  return { watch, default: { watch } };
});

vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(Buffer.from('edited content v2')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 17, isFile: () => true, isDirectory: () => false }),
}));

import { SyncManager } from '@/main/sync-manager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';
import { driveKeyManager } from '@/main/drive-key-manager';

// UUID-shaped ids (EID() validates RFC-4122 shape). ORIGINAL_FILE_ID stands in
// for the live "82624855…" fileId the edit must reuse.
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
const privateMapping = { ...publicMapping, drivePrivacy: 'private' as const, driveName: 'Secret Drive' };

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

describe('SYNC-26: edit re-uploads as an ArFS revision (fileId reuse)', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // A fresh wrapped-file object per wrap call, so we observe exactly what the
    // upload engine mutates (existingId) and forwards to core-js.
    mockWrapFileOrFolder.mockImplementation(() => ({ destinationBaseName: 'doc.txt' }));

    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);
    mockArDrive = createMockArDrive();
    (mockArDrive as any).uploadAllEntities = vi.fn(async () => fileUploadResult());

    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
    // Drive context (uploadFileWithArDriveCore early-returns without it)
    syncManager['driveId'] = testDriveId;
    syncManager['rootFolderId'] = testRootFolderId;
  });

  afterEach(async () => {
    driveKeyManager.clearAllKeys();
    await syncManager.stopSync();
  });

  const makeUpload = (over: any = {}) =>
    ({
      id: 'upload-edit-1',
      driveId: testDriveId,
      localPath: `${testSyncPath}/doc.txt`,
      fileName: 'doc.txt',
      fileSize: 17,
      status: 'uploading',
      progress: 0,
      uploadMethod: 'turbo',
      createdAt: new Date(),
      ...over,
    }) as any;

  // --- (1) THE fix: an edit WITH a recorded fileId reuses it (revision) ------

  it('threads the SAME existing fileId into core-js (revision, not a fresh file)', async () => {
    const upload = makeUpload({ existingArfsFileId: ORIGINAL_FILE_ID });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFileWithArDriveCore'](upload);

    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    const opts = (mockArDrive as any).uploadAllEntities.mock.calls[0][0];
    const wrappedEntity = opts.entitiesToUpload[0].wrappedEntity;

    // The revision-defining assertion: core-js receives the ORIGINAL fileId.
    // (core-js reuses it verbatim: `fileId = wrappedFile.existingId ?? EID(uuid())`.)
    expect(wrappedEntity.existingId).toBeDefined();
    expect(String(wrappedEntity.existingId)).toBe(ORIGINAL_FILE_ID);

    // And it is NOT a fresh-file mint — existingId is present, not undefined.
    expect(wrappedEntity.existingId).not.toBeUndefined();

    // End-to-end: the completed record carries that same fileId (history intact).
    expect(upload.fileId).toBe(ORIGINAL_FILE_ID);
    expect(mockDatabaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'upload-edit-1', status: 'completed', fileId: ORIGINAL_FILE_ID })
    );
  });

  // --- (2) Fallback: an edit with NO recorded fileId uploads as a new file ---

  it('falls back to a NEW file (no existingId) when there is no recorded fileId', async () => {
    const upload = makeUpload({}); // no existingArfsFileId (e.g. original upload never completed)
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFileWithArDriveCore'](upload);

    expect((mockArDrive as any).uploadAllEntities).toHaveBeenCalledTimes(1);
    const opts = (mockArDrive as any).uploadAllEntities.mock.calls[0][0];
    // No existingId => core-js mints a fresh fileId (a genuinely new file).
    expect(opts.entitiesToUpload[0].wrappedEntity.existingId).toBeUndefined();
  });

  it('does NOT thread a non-UUID id (e.g. a dataTxId) as a fileId', async () => {
    // A legacy processed_files row can carry a dataTxId in the id column; it must
    // never be passed to core-js as a fileId (EID would throw / wrong identity).
    const upload = makeUpload({ existingArfsFileId: 'a-raw-data-tx-id-not-a-uuid' });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFileWithArDriveCore'](upload);

    const opts = (mockArDrive as any).uploadAllEntities.mock.calls[0][0];
    expect(opts.entitiesToUpload[0].wrappedEntity.existingId).toBeUndefined();
  });

  // --- (3) Private drives: revision still routes private (PRIV-8 intact) -----

  it('private-drive edit reuses the fileId AND still routes through the private (encrypted) path', async () => {
    mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
    const driveKey = { keyData: Buffer.from('secret') } as any;
    driveKeyManager.cacheKey(testDriveId, driveKey);

    const upload = makeUpload({ existingArfsFileId: ORIGINAL_FILE_ID });
    syncManager.addToUploadQueue(upload);

    await syncManager['uploadFileWithArDriveCore'](upload);

    const opts = (mockArDrive as any).uploadAllEntities.mock.calls[0][0];
    const entity = opts.entitiesToUpload[0];
    // Revision: same fileId threaded...
    expect(String(entity.wrappedEntity.existingId)).toBe(ORIGINAL_FILE_ID);
    // ...and the private drive key is attached (encrypted upload — no plaintext leak).
    expect(entity.driveKey).toBe(driveKey);
  });

  it('private-drive edit on a LOCKED drive (no key) refuses and spends nothing (PRIV-8 fail-closed)', async () => {
    mockDatabaseManager.getDriveMappings.mockResolvedValue([privateMapping]);
    // No key cached => locked.
    const upload = makeUpload({ existingArfsFileId: ORIGINAL_FILE_ID });
    syncManager.addToUploadQueue(upload);

    // The revision path does not weaken PRIV-8: a locked private drive throws
    // before any paid work — the fileId threading never opens a public escape.
    await expect(syncManager['uploadFileWithArDriveCore'](upload)).rejects.toThrow(/locked/i);

    // The paid upload never fired (no spend, no plaintext-public fallback).
    expect((mockArDrive as any).uploadAllEntities).not.toHaveBeenCalled();
  });
});

describe('SYNC-26: edit detection stamps the revision fileId onto the pending upload', () => {
  let syncManager: SyncManager;
  let mockDatabaseManager: any;
  let mockArDrive: any;
  const filePath = `${testSyncPath}/doc.txt`;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDatabaseManager = createMockDatabaseManager();
    mockDatabaseManager.getDriveMappings.mockResolvedValue([publicMapping]);
    mockArDrive = createMockArDrive();
    syncManager = new SyncManager(mockDatabaseManager);
    syncManager.setSyncFolder(testSyncPath);
    syncManager.setArDrive(mockArDrive);
    syncManager['driveId'] = testDriveId;
    syncManager['rootFolderId'] = testRootFolderId;

    // Deterministic, network-free costs (mirrors SYNC-1 suite).
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
    vi.mocked(fs.stat).mockResolvedValue({ size: 17, isFile: () => true, isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('edited content v2') as any);
  });

  afterEach(async () => {
    await syncManager.stopSync();
  });

  // An already-uploaded file at this path (different hash => an edit).
  const editedProcessedFiles = [
    {
      fileHash: 'old-content-hash',
      fileName: 'doc.txt',
      fileSize: 10,
      localPath: filePath,
      source: 'upload' as const,
      processedAt: new Date(),
    },
  ];

  it('records the existing on-chain fileId so approval threads it as a revision', async () => {
    mockDatabaseManager.getProcessedFiles.mockResolvedValue(editedProcessedFiles);
    mockDatabaseManager.getFileByPath.mockResolvedValue({
      fileHash: 'old-content-hash',
      arfsFileId: ORIGINAL_FILE_ID,
      arweaveId: ORIGINAL_FILE_ID,
    });

    await syncManager['handleNewFile'](filePath, 'update');

    expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        localPath: filePath,
        status: 'awaiting_approval',
        arfsFileId: ORIGINAL_FILE_ID,
      })
    );
  });

  it('leaves the revision fileId undefined (new upload) when nothing is recorded', async () => {
    mockDatabaseManager.getProcessedFiles.mockResolvedValue(editedProcessedFiles);
    mockDatabaseManager.getFileByPath.mockResolvedValue(null);

    await syncManager['handleNewFile'](filePath, 'update');

    expect(mockDatabaseManager.addPendingUpload).toHaveBeenCalledTimes(1);
    const pending = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(pending.localPath).toBe(filePath);
    expect(pending.arfsFileId).toBeUndefined();
  });

  it('does not stamp a non-UUID recorded id (guards against a dataTxId fallback)', async () => {
    mockDatabaseManager.getProcessedFiles.mockResolvedValue(editedProcessedFiles);
    mockDatabaseManager.getFileByPath.mockResolvedValue({
      arfsFileId: undefined,
      arweaveId: 'a-raw-data-tx-id-not-a-uuid',
    });

    await syncManager['handleNewFile'](filePath, 'update');

    const pending = mockDatabaseManager.addPendingUpload.mock.calls[0][0];
    expect(pending.arfsFileId).toBeUndefined();
  });
});
