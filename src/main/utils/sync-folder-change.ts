import * as fs from 'fs/promises';

/**
 * Applying a sync-folder change (UX-2).
 *
 * A folder change must land in three places or sync silently diverges
 * (audit §2.8 / SYNC-7): the app config, the ACTIVE drive mapping's
 * localFolderPath (the future single source of truth), and the running
 * SyncManager. Extracted from the `sync:setFolder` IPC handler with injected
 * dependencies so the behavior is unit-testable without Electron.
 */
export interface SyncFolderChangeDeps {
  setConfigSyncFolder(folderPath: string): Promise<void>;
  getDriveMappings(): Promise<Array<{ id: string; isActive?: boolean }>>;
  updateDriveMapping(id: string, updates: { localFolderPath: string }): Promise<void>;
  setSyncManagerFolder(folderPath: string): void;
}

export async function applySyncFolderChange(
  folderPath: string,
  deps: SyncFolderChangeDeps
): Promise<void> {
  // Create the folder if it doesn't exist
  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch (error) {
    console.error('Error creating sync folder:', error);
    throw new Error('Failed to create sync folder');
  }

  await deps.setConfigSyncFolder(folderPath);

  // SYNC-7: keep the active drive mapping's localFolderPath in agreement with
  // the config. During onboarding no mapping exists yet — skip silently.
  const mappings = await deps.getDriveMappings();
  const activeMapping = mappings.find((m) => m.isActive) || mappings[0];
  if (activeMapping) {
    await deps.updateDriveMapping(activeMapping.id, { localFolderPath: folderPath });
  }

  deps.setSyncManagerFolder(folderPath);
}
