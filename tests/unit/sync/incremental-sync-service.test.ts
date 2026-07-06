// @vitest-environment node
//
// SYNC-30 wiring proof: IncrementalSyncService passes core the right
// `stopAfterKnownCount` at BOTH the public and private call sites, so core's
// early-stop cannot trip inside the 240-block look-back window and the
// incremental fast path engages for active drives (see the efficacy proof in
// incremental-early-stop.test.ts for the real-core behavior this value drives).
//
// The real service is exercised; only core's `arDriveFactory` /
// `ArFSDAOIncrementalSync` are mocked so `getArDrive()` returns a spyable ArDrive
// (EID, incrementalMinBlock, etc. remain the real implementations).
//
// Main-process suite: runs under node (not jsdom) — ardrive-core-js's ecc
// self-check fails under jsdom.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { fakeArDrive } = vi.hoisted(() => ({
  fakeArDrive: {
    syncPublicDrive: vi.fn().mockResolvedValue({}),
    syncPrivateDrive: vi.fn().mockResolvedValue({}),
  },
}));

// Partial-mock core: keep every real export (EID, incrementalMinBlock, ...) but
// swap the DAO/factory so getArDrive() hands back the spyable fake ArDrive.
vi.mock('ardrive-core-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ardrive-core-js')>();
  return {
    ...actual,
    ArFSDAOIncrementalSync: vi.fn(() => ({})),
    arDriveFactory: vi.fn(() => fakeArDrive),
  };
});
// The service constructs Arweave.init(...) in getArDrive(); keep it inert.
vi.mock('arweave', () => ({ default: { init: vi.fn(() => ({})) } }));
// The gateway module transitively loads config/profile managers that touch
// electron's app.getPath at import time; stub it (and electron) so the import
// chain stays inert under node.
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/user-data') } }));
vi.mock('@/main/gateway', () => ({ getGatewayConfig: vi.fn(() => ({ timeout: 120000 })) }));
// getStore() is never reached by the sync methods under test, but the import
// chain (database-manager) is heavy — stub it defensively.
vi.mock('@/main/database-manager', () => ({ databaseManager: {} }));
vi.mock('@/main/sync/sqlite-sync-state-store', () => ({
  SqliteSyncStateStore: vi.fn(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() })),
}));

import { IncrementalSyncService } from '@/main/sync/incremental-sync-service';
import type { DriveSyncState } from 'ardrive-core-js';

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';

// A prior state carrying `size` known entities (values are irrelevant here —
// only the map's size feeds the stopAfterKnownCount derivation).
const priorStateOfSize = (size: number): DriveSyncState => {
  const entityStates = new Map<string, any>();
  for (let i = 0; i < size; i++) {
    entityStates.set(`e${i}`, { entityId: { toString: () => `e${i}` } });
  }
  return {
    lastSyncedBlockHeight: 1500000,
    entityStates,
  } as unknown as DriveSyncState;
};

describe('SYNC-30: IncrementalSyncService passes core a look-back-safe stopAfterKnownCount', () => {
  let svc: IncrementalSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new IncrementalSyncService();
    svc.setWallet({} as any);
  });

  it('public: derives stopAfterKnownCount = knownEntityCount + buffer (100) from the prior state', async () => {
    await svc.syncPublicDrive(DRIVE_ID, priorStateOfSize(15));

    expect(fakeArDrive.syncPublicDrive).toHaveBeenCalledTimes(1);
    const options = fakeArDrive.syncPublicDrive.mock.calls[0][2];
    // 15 known entities in the window would trip the default (10) and force a
    // full re-list; 15 + 100 = 115 cannot trip, so the fast path engages.
    expect(options.stopAfterKnownCount).toBe(115);
    expect(options.syncState).toBeDefined();
  });

  it('private: passes the same look-back-safe stopAfterKnownCount', async () => {
    await svc.syncPrivateDrive(DRIVE_ID, {} as any, priorStateOfSize(42));

    expect(fakeArDrive.syncPrivateDrive).toHaveBeenCalledTimes(1);
    const options = fakeArDrive.syncPrivateDrive.mock.calls[0][3];
    expect(options.stopAfterKnownCount).toBe(142);
    expect(options.syncState).toBeDefined();
  });

  it('scales with the drive: a bigger known-entity count yields a proportionally higher threshold', async () => {
    await svc.syncPublicDrive(DRIVE_ID, priorStateOfSize(500));
    expect(fakeArDrive.syncPublicDrive.mock.calls[0][2].stopAfterKnownCount).toBe(600);
  });

  it('first/genesis listing (no prior state): leaves stopAfterKnownCount unset (nothing known — default is harmless)', async () => {
    await svc.syncPublicDrive(DRIVE_ID);

    const options = fakeArDrive.syncPublicDrive.mock.calls[0][2];
    expect(options.stopAfterKnownCount).toBeUndefined();
    expect(options.syncState).toBeUndefined();
  });
});
