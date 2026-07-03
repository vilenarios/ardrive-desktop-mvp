// @vitest-environment node
//
// UX-2: applySyncFolderChange is the whole behavior of the sync:setFolder IPC
// handler — folder creation, config persistence, SyncManager update, and
// (Settings path only, via updateActiveMapping: true) active-mapping
// agreement (SYNC-7). Onboarding flows (SyncFolderSetup, DriveAndSyncSetup)
// call setFolder BEFORE creating their drive's mapping and must never touch
// whatever mapping happens to be active.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { applySyncFolderChange, SyncFolderChangeDeps } from '../../../src/main/utils/sync-folder-change';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
}));

describe('applySyncFolderChange (UX-2)', () => {
  let deps: SyncFolderChangeDeps & {
    setConfigSyncFolder: ReturnType<typeof vi.fn>;
    getDriveMappings: ReturnType<typeof vi.fn>;
    updateDriveMapping: ReturnType<typeof vi.fn>;
    setSyncManagerFolder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
    deps = {
      setConfigSyncFolder: vi.fn().mockResolvedValue(undefined),
      getDriveMappings: vi.fn().mockResolvedValue([]),
      updateDriveMapping: vi.fn().mockResolvedValue(undefined),
      setSyncManagerFolder: vi.fn(),
    };
  });

  it('creates the folder, persists config, and updates the sync manager', async () => {
    await applySyncFolderChange('/new/sync/folder', deps);

    expect(fs.mkdir).toHaveBeenCalledWith('/new/sync/folder', { recursive: true });
    expect(deps.setConfigSyncFolder).toHaveBeenCalledWith('/new/sync/folder');
    expect(deps.setSyncManagerFolder).toHaveBeenCalledWith('/new/sync/folder');
  });

  it('Settings path: updates the active drive mapping so config and mapping agree (SYNC-7)', async () => {
    deps.getDriveMappings.mockResolvedValue([
      { id: 'mapping-inactive', isActive: false },
      { id: 'mapping-active', isActive: true },
    ]);

    await applySyncFolderChange('/new/sync/folder', deps, { updateActiveMapping: true });

    expect(deps.updateDriveMapping).toHaveBeenCalledTimes(1);
    expect(deps.updateDriveMapping).toHaveBeenCalledWith('mapping-active', {
      localFolderPath: '/new/sync/folder',
    });
  });

  it('Settings path: falls back to the first mapping when none is marked active (mirrors sync:start)', async () => {
    deps.getDriveMappings.mockResolvedValue([
      { id: 'mapping-1', isActive: false },
      { id: 'mapping-2', isActive: false },
    ]);

    await applySyncFolderChange('/new/sync/folder', deps, { updateActiveMapping: true });

    expect(deps.updateDriveMapping).toHaveBeenCalledWith('mapping-1', {
      localFolderPath: '/new/sync/folder',
    });
  });

  it('Settings path: skips the mapping update silently when no mappings exist', async () => {
    deps.getDriveMappings.mockResolvedValue([]);

    await applySyncFolderChange('/new/sync/folder', deps, { updateActiveMapping: true });

    expect(deps.updateDriveMapping).not.toHaveBeenCalled();
    // Config and sync manager still updated
    expect(deps.setConfigSyncFolder).toHaveBeenCalledWith('/new/sync/folder');
    expect(deps.setSyncManagerFolder).toHaveBeenCalledWith('/new/sync/folder');
  });

  it("onboarding default: never touches mappings — another drive's active mapping is not clobbered", async () => {
    // A DIFFERENT drive's mapping is active while onboarding sets the folder
    // for a new drive (its own mapping doesn't exist yet).
    deps.getDriveMappings.mockResolvedValue([
      { id: 'other-drives-mapping', isActive: true },
    ]);

    await applySyncFolderChange('/new-drive/folder', deps);

    expect(deps.updateDriveMapping).not.toHaveBeenCalled();
    expect(deps.getDriveMappings).not.toHaveBeenCalled();
    // Config and sync manager still updated
    expect(deps.setConfigSyncFolder).toHaveBeenCalledWith('/new-drive/folder');
    expect(deps.setSyncManagerFolder).toHaveBeenCalledWith('/new-drive/folder');
  });

  it('fails with a clear error when the folder cannot be created', async () => {
    vi.mocked(fs.mkdir).mockRejectedValue(new Error('EACCES'));

    await expect(
      applySyncFolderChange('/forbidden', deps, { updateActiveMapping: true })
    ).rejects.toThrow('Failed to create sync folder');
    // Nothing was persisted after the failure
    expect(deps.setConfigSyncFolder).not.toHaveBeenCalled();
    expect(deps.updateDriveMapping).not.toHaveBeenCalled();
    expect(deps.setSyncManagerFolder).not.toHaveBeenCalled();
  });
});
