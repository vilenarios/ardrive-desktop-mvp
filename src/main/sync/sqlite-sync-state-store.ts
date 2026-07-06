// SqliteSyncStateStore (D-026) — persists ardrive-core-js DriveSyncState in the
// active profile's SQLite database so an incremental delta-resync can resume
// from the last synced block instead of re-listing the whole drive every time.
//
// This is a concrete implementation of core-js's `SyncStateStore` interface
// (save/load/clear/list/clearAll), modelled on core's FileSystemSyncStateStore
// reference adapter — the only difference is the storage backend: instead of one
// JSON file per drive, each drive's state is one row in the `sync_state` table.
//
// Serialization is delegated to core's serializeSyncState/deserializeSyncState
// (NOT hand-rolled) so the on-disk shape always matches core's expectations;
// the DB layer only ever sees the opaque TEXT that JSON.stringify produces from
// the serialized form. Per-profile isolation comes for free: DatabaseManager
// swaps its underlying connection on profile switch, so a store built once and
// reused always reads/writes the CURRENT profile's database.

import {
  DriveID,
  DriveSyncState,
  EID,
  serializeSyncState,
  deserializeSyncState,
} from 'ardrive-core-js';
import type { SyncStateStore } from 'ardrive-core-js';
import { DatabaseManager } from '../database-manager';

export class SqliteSyncStateStore implements SyncStateStore {
  constructor(private readonly databaseManager: DatabaseManager) {}

  async save(driveId: DriveID, state: DriveSyncState): Promise<void> {
    // serializeSyncState -> JSON-safe object; JSON.stringify -> TEXT column.
    // Exactly the pipeline core's BaseSyncStateStore uses, but keyed by driveId.
    const serialized = serializeSyncState(state);
    const data = JSON.stringify(serialized);
    await this.databaseManager.saveSyncState(`${driveId}`, data);
  }

  async load(driveId: DriveID): Promise<DriveSyncState | undefined> {
    const data = await this.databaseManager.loadSyncState(`${driveId}`);
    if (!data) {
      return undefined;
    }
    try {
      const serialized = JSON.parse(data);
      return deserializeSyncState(serialized);
    } catch (error) {
      // A corrupt/unreadable row must degrade to "no prior state" (→ full
      // listing) rather than throw — correctness over optimization.
      console.error(`[SqliteSyncStateStore] Failed to parse sync state for drive ${driveId}:`, error);
      return undefined;
    }
  }

  async clear(driveId: DriveID): Promise<void> {
    await this.databaseManager.clearSyncState(`${driveId}`);
  }

  async list(): Promise<DriveID[]> {
    const ids = await this.databaseManager.listSyncStateDriveIds();
    return ids.map((id) => EID(id));
  }

  async clearAll(): Promise<void> {
    await this.databaseManager.clearAllSyncState();
  }
}
