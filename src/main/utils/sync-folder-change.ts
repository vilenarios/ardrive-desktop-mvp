import * as fs from 'fs/promises';

/**
 * Applying a sync-folder change (UX-2).
 *
 * A folder change from Settings must land in three places or sync silently
 * diverges (audit §2.8 / SYNC-7): the app config, the ACTIVE drive mapping's
 * localFolderPath (what `sync:start` actually validates and watches), and the
 * running SyncManager. Extracted from the `sync:setFolder` IPC handler with
 * injected dependencies so the behavior is unit-testable without Electron.
 *
 * Which callers update the drive mapping:
 * - Settings "Change Folder" (Settings.tsx) passes `updateActiveMapping: true`
 *   — the user is moving the folder of the drive currently being synced.
 * - Onboarding flows (SyncFolderSetup.tsx, DriveAndSyncSetup.tsx) do NOT pass
 *   the flag. They call sync:setFolder BEFORE creating the new drive's own
 *   mapping; if a different drive's mapping were active at that moment, a
 *   blanket active-mapping update would clobber that drive's folder path.
 *   Their mapping gets the correct path when it is created, right after.
 */
export interface SyncFolderChangeDeps {
  setConfigSyncFolder(folderPath: string): Promise<void>;
  getDriveMappings(): Promise<Array<{ id: string; isActive?: boolean }>>;
  updateDriveMapping(id: string, updates: { localFolderPath: string }): Promise<void>;
  setSyncManagerFolder(folderPath: string): void;
}

export interface SyncFolderChangeOptions {
  /** Re-point the active drive mapping's localFolderPath (Settings path only). */
  updateActiveMapping?: boolean;
}

export async function applySyncFolderChange(
  folderPath: string,
  deps: SyncFolderChangeDeps,
  options: SyncFolderChangeOptions = {}
): Promise<void> {
  // Create the folder if it doesn't exist
  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch (error) {
    console.error('Error creating sync folder:', error);
    throw new Error('Failed to create sync folder');
  }

  await deps.setConfigSyncFolder(folderPath);

  if (options.updateActiveMapping === true) {
    // SYNC-7: keep the mapping `sync:start` reads (the active one, falling
    // back to the first — the same selection as its primaryMapping) in
    // agreement with the config. No mapping yet — skip silently.
    const mappings = await deps.getDriveMappings();
    const activeMapping = mappings.find((m) => m.isActive) || mappings[0];
    if (activeMapping) {
      await deps.updateDriveMapping(activeMapping.id, { localFolderPath: folderPath });
    }
  }

  deps.setSyncManagerFolder(folderPath);
}
