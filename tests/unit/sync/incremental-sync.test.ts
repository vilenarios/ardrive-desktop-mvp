// @vitest-environment node
//
// D-026 acceptance tests: DownloadManager.syncDriveMetadata takes the
// incremental delta-resync path when a prior sync state exists, and falls back
// to the full recursive listing otherwise. These prove the behavior the whole
// feature exists for:
//
//   * INCREMENTAL: with prior state, the drive is NOT re-listed folder-by-folder
//     (0 recursive listPublicFolder reads) and only the DELTA entities are
//     upserted — far fewer reads/writes than a full sync.
//   * FALLBACK: first sync (no prior state) and any incremental error both fall
//     back to the proven full listing (never regress correctness).
//   * NO DROPPED/DUPLICATED ENTITIES: the incremental path never clears the cache
//     and upserts by fileId, so unchanged entities survive and a re-fetched
//     reorg-look-back revision updates its row in place (no duplicate row).
//   * STRUCTURAL CHANGE: a folder rename/move in the delta forces a full re-list
//     (descendant paths would otherwise go stale).
//
// Main-process suite: runs under node (not jsdom) — ardrive-core-js's ecc
// self-check fails under jsdom.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGetAllWindows, fsMocks } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn(() => []),
  fsMocks: { access: vi.fn(), mkdir: vi.fn(), stat: vi.fn() },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
  app: { getPath: vi.fn(() => '/mock/user-data') },
}));
vi.mock('fs/promises', () => fsMocks);
vi.mock('@/main/sync/StreamingDownloader', () => ({
  StreamingDownloader: vi.fn(() => ({ downloadFile: vi.fn(), cancelDownload: vi.fn(), cancelAllDownloads: vi.fn() })),
}));
// The drive-key manager is only consulted for private drives here (public tests).
vi.mock('@/main/drive-key-manager', () => ({
  driveKeyManager: { getDriveKey: vi.fn(() => null) },
}));
// Mock the incremental sync service so we drive the core-js boundary directly.
vi.mock('@/main/sync/incremental-sync-service', () => ({
  incrementalSyncService: {
    isReady: vi.fn(() => true),
    loadState: vi.fn(),
    syncPublicDrive: vi.fn(),
    syncPrivateDrive: vi.fn(),
    persistState: vi.fn().mockResolvedValue(undefined),
    clearState: vi.fn(),
    setWallet: vi.fn(),
    clear: vi.fn(),
  },
}));

import { DownloadManager } from '@/main/sync/DownloadManager';
import { createMockDatabaseManager } from '../../helpers/mock-database';
import { createMockArDrive } from '../../helpers/mock-ardrive';
import { incrementalSyncService } from '@/main/sync/incremental-sync-service';

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const ROOT = '22222222-2222-4222-8222-222222222222';
const FOLDER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE_1 = 'ffffffff-1111-4111-8111-111111111111';
const FILE_2 = 'ffffffff-2222-4222-8222-222222222222';
const SYNC_PATH = '/test/sync/folder';

const eid = (s: string) => ({ toString: () => s });

// A flat ArFS entity as returned by core's incremental sync (delta), with the
// blockHeight core attaches. No `path` — the desktop reconstructs it.
const deltaFile = (id: string, parentId: string, name: string, over: any = {}) => ({
  entityType: 'file',
  entityId: eid(id),
  parentFolderId: eid(parentId),
  name,
  txId: eid(over.txId ?? `mtx-${id}`),
  dataTxId: eid(over.dataTxId ?? `dtx-${id}`),
  dataContentType: 'application/octet-stream',
  size: { valueOf: () => over.size ?? 100 },
  lastModifiedDate: { unixTime: 1751500000 },
  blockHeight: over.blockHeight ?? 1500000,
});
const deltaFolder = (id: string, parentId: string, name: string) => ({
  entityType: 'folder',
  entityId: eid(id),
  parentFolderId: eid(parentId),
  name,
  txId: eid(`mtx-${id}`),
  blockHeight: 1500000,
});

const incResult = (entities: any[], over: any = {}) => ({
  entities,
  changes: { added: [], modified: [], unreachable: over.unreachable ?? [] },
  newSyncState: { driveId: DRIVE_ID, lastSyncedBlockHeight: 1500000, entityStates: new Map() },
  stats: { totalProcessed: entities.length, fromNetwork: entities.length, fromCache: 0, lowestBlockHeight: 0, highestBlockHeight: 0 },
});

// WithPaths-ish entities for the FULL recursive listing (listPublicFolder).
const fullFolder = (id: string, name: string) => ({ entityType: 'folder', name, folderId: eid(id), lastModifiedDate: { unixTime: 1751500000 } });
const fullFile = (id: string, name: string) => ({ entityType: 'file', name, fileId: eid(id), size: { valueOf: () => 100 }, dataTxId: eid(`dtx-${id}`), dataContentType: 'text/plain', lastModifiedDate: { unixTime: 1751500000 } });

// DB-shaped rows (node-sqlite3: integer booleans, nulls — NOT false/undefined).
const dbFolder = (fileId: string, name: string, path: string, parentFolderId: string | null) => ({
  fileId, mappingId: 'mapping-1', type: 'folder', name, path, parentFolderId,
  size: null, dataTxId: null, metadataTxId: null, contentType: null,
  localFileExists: 0, syncStatus: 'synced', isHidden: 0, lastError: null,
});
const dbFile = (fileId: string, name: string, path: string, parentFolderId: string, dataTxId: string) => ({
  fileId, mappingId: 'mapping-1', type: 'file', name, path, parentFolderId,
  size: 100, dataTxId, metadataTxId: `mtx-${fileId}`, contentType: 'text/plain',
  localFileExists: 1, syncStatus: 'synced', isHidden: 0, lastError: null,
});

const svc = incrementalSyncService as any;

describe('D-026: incremental delta-resync in syncDriveMetadata', () => {
  let dm: any;
  let db: any;
  let arDrive: any;

  const mapping = { id: 'mapping-1', driveId: DRIVE_ID, drivePrivacy: 'public', rootFolderId: ROOT };

  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.access.mockRejectedValue(new Error('ENOENT'));
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.stat.mockResolvedValue({ isFile: () => true, isDirectory: () => false });

    db = createMockDatabaseManager();
    (db.getDriveMappings as any).mockResolvedValue([mapping]);
    (db.getDriveMetadata as any).mockResolvedValue([]);

    arDrive = createMockArDrive();
    // Full recursive listing: root holds [FOLDER_A, FILE_1]; FOLDER_A holds [FILE_2].
    (arDrive.listPublicFolder as any).mockImplementation(async ({ folderId }: any) => {
      const id = folderId.toString();
      if (id === ROOT) return [fullFolder(FOLDER_A, 'photos'), fullFile(FILE_1, 'a.txt')];
      if (id === FOLDER_A) return [fullFile(FILE_2, 'b.txt')];
      return [];
    });

    svc.isReady.mockReturnValue(true);
    svc.syncPublicDrive.mockResolvedValue(incResult([]));

    dm = new DownloadManager(db, {} as any, { emitSyncProgress: vi.fn() } as any, arDrive, DRIVE_ID, ROOT, SYNC_PATH);
  });

  afterEach(() => dm.destroy());

  const recursiveReadCount = () => (arDrive.listPublicFolder as any).mock.calls.length;

  it('takes the incremental path when prior state exists — 0 recursive reads, only the delta upserted', async () => {
    // Prior state present → incremental. Delta = one brand-new top-level file.
    svc.loadState.mockResolvedValue({ lastSyncedBlockHeight: 1500000, entityStates: new Map() });
    svc.syncPublicDrive.mockResolvedValue(incResult([deltaFile(FILE_1, ROOT, 'a.txt')]));

    await dm.syncDriveMetadata();

    // The whole point: NO folder-by-folder re-listing.
    expect(recursiveReadCount()).toBe(0);
    expect(db.clearDriveMetadataCache).not.toHaveBeenCalled();
    // Only the single changed entity was written.
    expect(db.upsertDriveMetadata).toHaveBeenCalledTimes(1);
    expect(db.upsertDriveMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE_1, type: 'file', path: '', name: 'a.txt', dataTxId: 'dtx-' + FILE_1 })
    );
    // New state persisted for next time.
    expect(svc.persistState).toHaveBeenCalledWith(DRIVE_ID, expect.anything(), expect.anything());
  });

  it('CONTRAST: first sync (no prior state) uses the full listing (many reads) then establishes state', async () => {
    svc.loadState.mockResolvedValue(undefined); // first sync

    await dm.syncDriveMetadata();

    // Full recursive listing: root + FOLDER_A = 2 reads (> the incremental path's 0).
    expect(recursiveReadCount()).toBe(2);
    expect(db.clearDriveMetadataCache).toHaveBeenCalledWith('mapping-1');
    // All 3 entities inserted (folder + 2 files).
    expect(db.upsertDriveMetadata).toHaveBeenCalledTimes(3);
    // Initial state established via a state-only incremental sync (no prior state).
    expect(svc.syncPublicDrive).toHaveBeenCalledWith(DRIVE_ID);
    expect(svc.persistState).toHaveBeenCalledWith(DRIVE_ID, undefined, expect.anything());
  });

  it('falls back to the full listing when the incremental sync throws (correctness first)', async () => {
    svc.loadState.mockResolvedValue({ lastSyncedBlockHeight: 1500000, entityStates: new Map() });
    svc.syncPublicDrive.mockRejectedValueOnce(new Error('gateway 500'));

    await dm.syncDriveMetadata();

    // Fell through to the full listing.
    expect(recursiveReadCount()).toBe(2);
    expect(db.clearDriveMetadataCache).toHaveBeenCalledWith('mapping-1');
    expect(db.upsertDriveMetadata).toHaveBeenCalledTimes(3);
  });

  it('absorbs a reorg-look-back re-fetch: unchanged entities survive, the revised one updates in place (no dup, no drop)', async () => {
    // The cache already holds folder + 2 files from a prior full sync.
    (db.getDriveMetadata as any).mockResolvedValue([
      dbFolder(FOLDER_A, 'photos', '', ROOT),
      dbFile(FILE_1, 'a.txt', '', ROOT, 'dtx-old-1'),
      dbFile(FILE_2, 'b.txt', 'photos', FOLDER_A, 'dtx-old-2'),
    ]);
    svc.loadState.mockResolvedValue({ lastSyncedBlockHeight: 1500000, entityStates: new Map() });
    // The 240-block look-back re-fetches FILE_1 as a reorged/newer revision
    // (same entityId, new dataTxId + higher block). core already deduped to the
    // latest revision, so we see exactly ONE entity for FILE_1.
    svc.syncPublicDrive.mockResolvedValue(
      incResult([deltaFile(FILE_1, ROOT, 'a.txt', { dataTxId: 'dtx-new-1', blockHeight: 1500050 })])
    );

    await dm.syncDriveMetadata();

    // Never cleared → FILE_2 and FOLDER_A are NOT dropped.
    expect(db.clearDriveMetadataCache).not.toHaveBeenCalled();
    // Exactly one upsert, for FILE_1, carrying the NEW revision (in-place, no dup).
    expect(db.upsertDriveMetadata).toHaveBeenCalledTimes(1);
    expect(db.upsertDriveMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE_1, dataTxId: 'dtx-new-1' })
    );
  });

  it('unchanged re-sync (empty delta) mutates nothing', async () => {
    (db.getDriveMetadata as any).mockResolvedValue([dbFile(FILE_1, 'a.txt', '', ROOT, 'dtx-1')]);
    svc.loadState.mockResolvedValue({ lastSyncedBlockHeight: 1500000, entityStates: new Map() });
    svc.syncPublicDrive.mockResolvedValue(incResult([])); // nothing changed

    await dm.syncDriveMetadata();

    expect(recursiveReadCount()).toBe(0);
    expect(db.clearDriveMetadataCache).not.toHaveBeenCalled();
    expect(db.upsertDriveMetadata).not.toHaveBeenCalled();
    expect(svc.persistState).toHaveBeenCalled();
  });

  it('forces a full re-list when a folder is renamed/moved in the delta (descendant paths would go stale)', async () => {
    // FOLDER_A exists in the cache as "photos"; the delta renames it to "pics".
    (db.getDriveMetadata as any).mockResolvedValue([
      dbFolder(FOLDER_A, 'photos', '', ROOT),
      dbFile(FILE_2, 'b.txt', 'photos', FOLDER_A, 'dtx-2'),
    ]);
    svc.loadState.mockResolvedValue({ lastSyncedBlockHeight: 1500000, entityStates: new Map() });
    svc.syncPublicDrive.mockResolvedValue(incResult([deltaFolder(FOLDER_A, ROOT, 'pics')]));

    await dm.syncDriveMetadata();

    // A structural change → full re-list (clear + recursive read), not a partial upsert.
    expect(db.clearDriveMetadataCache).toHaveBeenCalledWith('mapping-1');
    expect(recursiveReadCount()).toBe(2);
    // State still persisted (reusing core's returned state — no extra traversal).
    expect(svc.persistState).toHaveBeenCalled();
  });

  it('never attempts incremental when the service is not ready (falls straight to full listing)', async () => {
    svc.isReady.mockReturnValue(false);

    await dm.syncDriveMetadata();

    expect(svc.loadState).not.toHaveBeenCalled();
    expect(svc.syncPublicDrive).not.toHaveBeenCalled();
    expect(recursiveReadCount()).toBe(2);
  });
});
