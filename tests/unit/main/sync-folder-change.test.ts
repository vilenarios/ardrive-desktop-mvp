// @vitest-environment node
//
// UX-2: applySyncFolderChange is the whole behavior of the sync:setFolder IPC
// handler — folder creation, config persistence, active-mapping agreement
// (SYNC-7), and SyncManager update.
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

  it('updates the active drive mapping so config and mapping agree (SYNC-7)', async () => {
    deps.getDriveMappings.mockResolvedValue([
      { id: 'mapping-inactive', isActive: false },
      { id: 'mapping-active', isActive: true },
    ]);

    await applySyncFolderChange('/new/sync/folder', deps);

    expect(deps.updateDriveMapping).toHaveBeenCalledTimes(1);
    expect(deps.updateDriveMapping).toHaveBeenCalledWith('mapping-active', {
      localFolderPath: '/new/sync/folder',
    });
  });

  it('falls back to the first mapping when none is marked active', async () => {
    deps.getDriveMappings.mockResolvedValue([
      { id: 'mapping-1', isActive: false },
      { id: 'mapping-2', isActive: false },
    ]);

    await applySyncFolderChange('/new/sync/folder', deps);

    expect(deps.updateDriveMapping).toHaveBeenCalledWith('mapping-1', {
      localFolderPath: '/new/sync/folder',
    });
  });

  it('skips the mapping update during onboarding (no mappings yet)', async () => {
    deps.getDriveMappings.mockResolvedValue([]);

    await applySyncFolderChange('/new/sync/folder', deps);

    expect(deps.updateDriveMapping).not.toHaveBeenCalled();
    // Config and sync manager still updated
    expect(deps.setConfigSyncFolder).toHaveBeenCalledWith('/new/sync/folder');
    expect(deps.setSyncManagerFolder).toHaveBeenCalledWith('/new/sync/folder');
  });

  it('fails with a clear error when the folder cannot be created', async () => {
    vi.mocked(fs.mkdir).mockRejectedValue(new Error('EACCES'));

    await expect(applySyncFolderChange('/forbidden', deps)).rejects.toThrow(
      'Failed to create sync folder'
    );
    // Nothing was persisted after the failure
    expect(deps.setConfigSyncFolder).not.toHaveBeenCalled();
    expect(deps.updateDriveMapping).not.toHaveBeenCalled();
    expect(deps.setSyncManagerFolder).not.toHaveBeenCalled();
  });
});
