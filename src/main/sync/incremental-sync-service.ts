// IncrementalSyncService (D-026) — the thin adapter between ArDrive Desktop's
// sync engine and ardrive-core-js 4.1.0's incremental delta-resync.
//
// WHY a dedicated ArDrive here (not the wallet-manager's main one):
// core's high-level `ArDrive.syncPublic/PrivateDrive` only work when the
// underlying ArFSDAO is an `ArFSDAOIncrementalSync` (it dispatches through
// `arFsDao.anonymousIncSync` / `instanceof ArFSDAOIncrementalSync`). The default
// arDriveFactory builds a PLAIN ArFSDAO (no incremental sync), AND swapping the
// main DAO for the incremental one would drop the Turbo wiring the factory adds
// to the plain DAO — regressing the (funds-spending) upload path. So we build a
// separate, read-only ArDrive whose DAO IS the incremental one, used ONLY for
// listing. Uploads/downloads keep using the main ArDrive untouched.
//
// This service owns ALL sync-state persistence explicitly (load prior state →
// pass it to core, which applies the 240-block reorg look-back via
// incrementalMinBlock → merge with core's returned state → save). The store is
// deliberately NOT handed to the DAO, so there is exactly one persistence path.

import Arweave from 'arweave';
import {
  ArDrive,
  arDriveFactory,
  ArFSDAOIncrementalSync,
  EID,
  incrementalMinBlock,
  mergeSyncStates,
  DriveSyncState,
  IncrementalSyncResult,
  Wallet,
  DriveKey,
} from 'ardrive-core-js';
import { getGatewayConfig } from '../gateway';
import { databaseManager } from '../database-manager';
import { SqliteSyncStateStore } from './sqlite-sync-state-store';

class IncrementalSyncService {
  private wallet: Wallet | null = null;
  private arDrive: ArDrive | null = null;
  private store: SqliteSyncStateStore | null = null;

  /**
   * Provide the authenticated wallet. Called by the wallet manager whenever a
   * wallet is loaded/imported (i.e. on login and profile switch). Resets the
   * memoized ArDrive so its in-memory sync-state cache never leaks across
   * profiles/wallets.
   */
  setWallet(wallet: Wallet | null): void {
    this.wallet = wallet;
    this.arDrive = null;
  }

  /** Tear down on logout / profile switch. */
  clear(): void {
    this.wallet = null;
    this.arDrive = null;
  }

  /** Incremental sync is only possible once an authenticated wallet is present. */
  isReady(): boolean {
    return this.wallet !== null;
  }

  private getStore(): SqliteSyncStateStore {
    if (!this.store) {
      // Bound to the DatabaseManager singleton, which is itself per-profile.
      this.store = new SqliteSyncStateStore(databaseManager);
    }
    return this.store;
  }

  private getArDrive(): ArDrive {
    if (!this.wallet) {
      throw new Error('IncrementalSyncService: wallet not set');
    }
    if (!this.arDrive) {
      const arweave = Arweave.init(getGatewayConfig({ timeout: 120000 }));
      // Read-only incremental DAO. The store is intentionally omitted (last arg)
      // — this service persists state explicitly, so there is a single writer.
      const incrementalDao = new ArFSDAOIncrementalSync(this.wallet, arweave);
      this.arDrive = arDriveFactory({
        wallet: this.wallet,
        arweave,
        arfsDao: incrementalDao,
      });
    }
    return this.arDrive;
  }

  /** Load the previously persisted sync state for a drive (undefined = first sync). */
  async loadState(driveId: string): Promise<DriveSyncState | undefined> {
    return this.getStore().load(EID(driveId));
  }

  /** Forget a drive's sync state (forces the next sync back to a full listing). */
  async clearState(driveId: string): Promise<void> {
    await this.getStore().clear(EID(driveId));
  }

  /**
   * Persist the post-sync state. When a prior state exists we `mergeSyncStates`
   * it with core's returned state (belt-and-suspenders: core already folds the
   * prior state into `newSyncState`, and mergeSyncStates keeps the latest
   * revision per entity, so this can never regress the tip).
   */
  async persistState(
    driveId: string,
    priorState: DriveSyncState | undefined,
    newState: DriveSyncState
  ): Promise<void> {
    const merged = priorState ? mergeSyncStates(priorState, newState) : newState;
    await this.getStore().save(EID(driveId), merged);
  }

  /**
   * Incremental sync of a PUBLIC drive. Passing `priorState` makes core apply
   * the reorg look-back (min block = max(0, lastSyncedBlockHeight - 240)) and
   * fetch only the delta; omitting it lists from genesis (used to establish the
   * initial state after a first full listing). Owner resolves from the wallet.
   */
  async syncPublicDrive(
    driveId: string,
    priorState?: DriveSyncState
  ): Promise<IncrementalSyncResult> {
    this.logLookBack(driveId, priorState);
    return this.getArDrive().syncPublicDrive(EID(driveId), undefined, {
      syncState: priorState,
    });
  }

  /** Incremental sync of a PRIVATE drive (drive key required for decryption). */
  async syncPrivateDrive(
    driveId: string,
    driveKey: DriveKey,
    priorState?: DriveSyncState
  ): Promise<IncrementalSyncResult> {
    this.logLookBack(driveId, priorState);
    return this.getArDrive().syncPrivateDrive(EID(driveId), driveKey, undefined, {
      syncState: priorState,
    });
  }

  private logLookBack(driveId: string, priorState?: DriveSyncState): void {
    const minBlock = incrementalMinBlock(priorState?.lastSyncedBlockHeight);
    if (minBlock === undefined) {
      console.log(`[IncrementalSync] ${driveId}: full listing from genesis (no prior block height)`);
    } else {
      console.log(
        `[IncrementalSync] ${driveId}: delta from block >= ${minBlock} ` +
        `(last synced ${priorState?.lastSyncedBlockHeight}, 240-block reorg look-back)`
      );
    }
  }
}

export const incrementalSyncService = new IncrementalSyncService();
export { IncrementalSyncService };
