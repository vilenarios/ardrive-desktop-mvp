// @vitest-environment node
//
// SYNC-30 efficacy proof, run against the REAL ardrive-core-js 4.1.0
// `ArFSDAOAnonymousIncrementalSync` loop + `detectChanges`. Only the two I/O
// seams are stubbed on the instance (`gqlRequest` returns synthetic edges;
// `processFile/FolderBatch` map edges -> entities); the early-stop counter, the
// `stopAfterKnownCount` threshold, latest-revision selection and unreachable
// detection are all core's real code.
//
// The bug: core scans the 240-block reorg look-back window newest-first and
// early-stops after `stopAfterKnownCount` already-known entities of ONE type
// (default 10), dropping the rest of the in-window entities from the fetch and
// reporting them `unreachable`. DownloadManager treats `unreachable > 0` as
// "fall back to a full re-list", so any drive with >10 unchanged entities of one
// type in the trailing window fell back to a full listing on EVERY sync.
//
// The fix: IncrementalSyncService passes `stopAfterKnownCount =
// knownEntityCount + buffer`, so the early-stop cannot trip inside the bounded
// window and the fast path (unreachable === 0) engages for active drives.
//
// Main-process suite: runs under node (not jsdom) — ardrive-core-js's ecc
// self-check fails under jsdom.
import { describe, it, expect } from 'vitest';
import { ArFSDAOAnonymousIncrementalSync, EID, TxID, UnixTime } from 'ardrive-core-js';

const DRIVE_ID = 'dddddddd-0000-4000-8000-000000000001';
const ROOT = 'ffffffff-0000-4000-8000-000000000000';
const LAST_BLOCK = 1500000;
// Comfortably inside the look-back window (minBlock = 1500000 - 240 = 1499760).
const IN_WINDOW_BLOCK = 1499800;

const eid = (i: number) => EID('ffffffff-0000-4000-8000-' + String(i).padStart(12, '0'));
const txid = (i: number) => TxID(('tx' + i).padEnd(43, '0'));

// N unchanged, in-window file entities — the case that used to fall back forever
// once N > core's default stopAfterKnownCount (10).
const N = 15;

function priorStateWithNKnownFiles() {
  const entityStates = new Map<string, any>();
  for (let i = 1; i <= N; i++) {
    entityStates.set(`${eid(i)}`, {
      entityId: eid(i),
      txId: txid(i),
      blockHeight: IN_WINDOW_BLOCK,
      parentFolderId: EID(ROOT),
      name: `f${i}.txt`,
      entityType: 'file',
    });
  }
  return {
    driveId: EID(DRIVE_ID),
    drivePrivacy: 'public' as const,
    lastSyncedBlockHeight: LAST_BLOCK,
    lastSyncedTimestamp: new UnixTime(1700000000),
    entityStates,
  };
}

// Build a real DAO, stubbing only the network/build seams. The look-back re-fetch
// returns the SAME N known files (unchanged: same txId as prior state).
function makeDao() {
  const fileEdges = Array.from({ length: N }, (_, k) => ({ cursor: `c${k + 1}`, node: { _i: k + 1 } }));
  const fakeGatewayApi = {
    gqlRequest: async (gqlQuery: any) => {
      const isFile = gqlQuery.query.includes('"file"');
      return isFile
        ? { edges: fileEdges, pageInfo: { hasNextPage: false } }
        : { edges: [], pageInfo: { hasNextPage: false } }; // no folders
    },
  };
  const dao: any = new ArFSDAOAnonymousIncrementalSync({} as any, 'test', '1.0', undefined, fakeGatewayApi as any);
  dao.getPublicDrive = async () => ({});
  dao.processFileBatch = async (edges: any[]) =>
    edges.map((e) => {
      const i = e.node._i;
      return {
        entityType: 'file',
        entityId: eid(i),
        txId: txid(i),
        parentFolderId: EID(ROOT),
        name: `f${i}.txt`,
        blockHeight: IN_WINDOW_BLOCK,
        unixTime: new UnixTime(1700000000 + i),
      };
    });
  dao.processFolderBatch = async () => [];
  return dao;
}

async function sync(stopAfterKnownCount: number) {
  const dao = makeDao();
  return dao.getPublicDriveIncrementalSync(EID(DRIVE_ID), 'owner', {
    syncState: priorStateWithNKnownFiles(),
    stopAfterKnownCount,
  });
}

describe('SYNC-30: incremental early-stop efficacy (real core)', () => {
  it('REGRESSION: default stopAfterKnownCount (10) reports >10-in-window entities as unreachable → full re-list forever', async () => {
    const res = await sync(10);
    // Early-stops after 10 known → only 10 of the 15 in-window files fetched.
    expect(res.entities.length).toBe(10);
    // The other 5 in-window-but-unfetched entities are mislabelled unreachable.
    expect(res.changes.unreachable.length).toBe(N - 10);
    // Which is exactly what DownloadManager treats as "fall back to full re-list".
    expect(res.changes.unreachable.length).toBeGreaterThan(0);
  });

  it('FIX: stopAfterKnownCount above the known-entity count engages the fast path (unreachable === 0, all in-window entities fetched)', async () => {
    // The value IncrementalSyncService now derives: knownEntityCount + buffer.
    const res = await sync(N + 100);
    // No early-stop inside the window → all 15 in-window entities fetched.
    expect(res.entities.length).toBe(N);
    // Nothing missing → no spurious unreachable → DownloadManager takes the FAST path.
    expect(res.changes.unreachable.length).toBe(0);
    // Unchanged drive: nothing added or modified either.
    expect(res.changes.added.length).toBe(0);
    expect(res.changes.modified.length).toBe(0);
  });

  it('SAFETY: a genuinely-gone in-window entity is still reported unreachable even with a high count (fallback preserved)', async () => {
    // Prior state has N known files, but the look-back re-fetch is now MISSING
    // the newest one (id N) — e.g. reorged out / ownership changed. A high count
    // must NOT hide that: it must still surface as unreachable so DownloadManager
    // falls back to a full re-list.
    const dao: any = makeDao();
    dao.processFileBatch = async (edges: any[]) =>
      edges
        .filter((e) => e.node._i !== N) // drop entity N from the fetch
        .map((e) => {
          const i = e.node._i;
          return {
            entityType: 'file',
            entityId: eid(i),
            txId: txid(i),
            parentFolderId: EID(ROOT),
            name: `f${i}.txt`,
            blockHeight: IN_WINDOW_BLOCK,
            unixTime: new UnixTime(1700000000 + i),
          };
        });

    const res = await dao.getPublicDriveIncrementalSync(EID(DRIVE_ID), 'owner', {
      syncState: priorStateWithNKnownFiles(),
      stopAfterKnownCount: N + 100,
    });

    expect(res.entities.length).toBe(N - 1);
    expect(res.changes.unreachable.length).toBe(1);
    expect(`${res.changes.unreachable[0].entityId}`).toBe(`${eid(N)}`);
  });
});
