// @vitest-environment node
//
// UX-22 (+ UX-21, D-005): behavioral tests for the new sync:pause and
// sync:resume IPC handlers in main.ts, exercised through a mocked electron
// surface (handlers captured from ipcMain.handle and invoked directly — same
// technique as tests/unit/main/main-approve-handlers.test.ts). These prove:
//   - sync:pause stops the SAME SyncManager engine the UX-30 tray's "Pause
//     Sync" menu item stops (SyncManager.stopSync(), no parallel engine) AND
//     persists the choice via configManager.setAutoSyncEnabled(false), so a
//     pause is honored on the next boot (UX-21's restoreSyncState gate), not
//     just for the rest of this session;
//   - sync:resume starts the same engine (SyncManager.startSync(), the exact
//     startSyncEngine path sync:start also uses) AND persists
//     setAutoSyncEnabled(true);
//   - both are envelope-wrapped (D-005): success resolves
//     { success: true, data }, and a thrown precondition failure inside the
//     shared startSyncEngine resolves { success: false, error } rather than
//     rejecting or persisting the preference.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as os from 'os';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  class MockBrowserWindow {
    webContents = {
      openDevTools: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn().mockResolvedValue(''),
    };
    loadURL = vi.fn();
    loadFile = vi.fn();
    once = vi.fn();
    on = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    isDestroyed = vi.fn(() => false);
    static getAllWindows = vi.fn(() => [] as unknown[]);
  }

  const databaseManager = {
    initialize: vi.fn().mockResolvedValue(undefined),
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
    getDriveMappings: vi.fn().mockResolvedValue([]),
    getPendingUploads: vi.fn().mockResolvedValue([]),
    getUploads: vi.fn().mockResolvedValue([]),
  };

  const turboManager = {
    isInitialized: vi.fn(() => false),
  };

  const walletManagerInstance = {
    hasStoredWallet: vi.fn().mockResolvedValue(false),
    attemptAutoLoad: vi.fn().mockResolvedValue(false),
    isWalletLoaded: vi.fn(() => false),
    getArDrive: vi.fn(() => ({ mockArDrive: true })),
    getWalletInfo: vi.fn().mockResolvedValue({ address: 'mock-address', balance: '0', walletType: 'arweave' }),
    listDrives: vi.fn().mockResolvedValue([]),
  };

  const syncManagerInstance = {
    addToUploadQueue: vi.fn(),
    executeMetadataOperation: vi.fn(),
    setArDrive: vi.fn(),
    setSyncFolder: vi.fn(),
    startSync: vi.fn().mockResolvedValue(true),
    stopSync: vi.fn().mockResolvedValue(true),
    cancelUpload: vi.fn(),
  };

  const configManager = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ isFirstRun: false, syncFolder: null }),
    setSyncFolder: vi.fn().mockResolvedValue(undefined),
    setAutoSyncEnabled: vi.fn().mockResolvedValue(undefined),
  };

  return { handlers, MockBrowserWindow, databaseManager, turboManager, walletManagerInstance, syncManagerInstance, configManager };
});

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/mock-user-data-ux22'),
  },
  BrowserWindow: h.MockBrowserWindow,
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn);
    }),
    removeHandler: vi.fn(),
  },
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn(() => ({})),
  },
  Tray: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    destroy: vi.fn(),
  })),
  nativeImage: {
    createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({})) })),
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock('../../../src/main/wallet-manager-secure', () => ({
  SecureWalletManager: vi.fn().mockImplementation(() => h.walletManagerInstance),
}));
vi.mock('../../../src/main/sync-manager', () => ({
  SyncManager: vi.fn().mockImplementation(() => h.syncManagerInstance),
}));
vi.mock('../../../src/main/database-manager', () => ({
  databaseManager: h.databaseManager,
}));
vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: h.turboManager,
}));
// configManager IS mocked here (unlike config-notifications-ipc.test.ts) so
// these tests can assert exactly what sync:pause/sync:resume persist without
// needing a real active profile (setAutoSyncEnabled requires one — see
// ConfigManager.setAutoSyncEnabled) — that per-profile plumbing is orthogonal
// to what's under test: the pause/resume handlers' own wiring.
vi.mock('../../../src/main/config-manager', () => ({
  configManager: h.configManager,
}));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getActiveProfile: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../../src/main/arns-service', () => ({ arnsService: {} }));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: {
    getPrivateKeyData: vi.fn().mockResolvedValue(null),
    isUnlocked: vi.fn(() => true),
  },
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));
// CORE-10: main.ts now applies the configured GraphQL page size to
// ardrive-core-js at init (src/main/gql-page-size.ts) — mock the whole
// package so importing the real main.ts here stays fast/deterministic (this
// suite doesn't exercise anything GraphQL-related).
vi.mock('ardrive-core-js', () => ({ setGqlPageSize: vi.fn() }));

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

// A real, existing directory — startSyncEngine's fs.access(localFolderPath)
// check runs against the real filesystem (not mocked), so this must resolve.
const REAL_FOLDER = os.tmpdir();

const activeMapping = {
  id: 'mapping-1',
  driveId: 'drive-1',
  rootFolderId: 'root-1',
  driveName: 'Test Drive',
  drivePrivacy: 'public' as const,
  localFolderPath: REAL_FOLDER,
  isActive: true,
};

beforeAll(async () => {
  await import('../../../src/main/main');
  // Handlers register inside app.whenReady().then(...) — wait for them
  await vi.waitFor(() => {
    if (!h.handlers.has('sync:pause') || !h.handlers.has('sync:resume')) {
      throw new Error('IPC handlers not registered yet');
    }
  });
});

beforeEach(() => {
  h.syncManagerInstance.stopSync.mockClear().mockResolvedValue(true);
  h.syncManagerInstance.startSync.mockClear().mockResolvedValue(true);
  h.syncManagerInstance.setArDrive.mockClear();
  h.syncManagerInstance.setSyncFolder.mockClear();
  h.configManager.setAutoSyncEnabled.mockClear().mockResolvedValue(undefined);
  h.configManager.getConfig.mockClear().mockResolvedValue({ isFirstRun: false, syncFolder: REAL_FOLDER });
  h.databaseManager.getDriveMappings.mockClear().mockResolvedValue([activeMapping]);
  h.databaseManager.getUploads.mockClear().mockResolvedValue([]);
  h.walletManagerInstance.getArDrive.mockClear().mockReturnValue({ mockArDrive: true });
  h.walletManagerInstance.listDrives.mockClear().mockResolvedValue([
    { id: 'drive-1', name: 'Test Drive', privacy: 'public', rootFolderId: 'root-1' },
  ]);
});

describe('sync:pause (UX-22)', () => {
  it('stops the sync engine and persists autoSyncEnabled: false', async () => {
    const res = (await invoke('sync:pause')) as { success: boolean; data?: boolean };

    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
    expect(h.syncManagerInstance.stopSync).toHaveBeenCalledTimes(1);
    expect(h.configManager.setAutoSyncEnabled).toHaveBeenCalledWith(false);
    // Never touches the start path.
    expect(h.syncManagerInstance.startSync).not.toHaveBeenCalled();
  });

  it('resolves { success: false, error } (never throws out of the IPC boundary) if stopSync itself fails', async () => {
    h.syncManagerInstance.stopSync.mockRejectedValueOnce(new Error('watcher teardown failed'));

    const res = (await invoke('sync:pause')) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/watcher teardown failed/);
    // A failed stop must not be recorded as a successful pause.
    expect(h.configManager.setAutoSyncEnabled).not.toHaveBeenCalled();
  });
});

describe('sync:resume (UX-22)', () => {
  it('starts the sync engine (the active drive mapping) and persists autoSyncEnabled: true', async () => {
    const res = (await invoke('sync:resume')) as { success: boolean; data?: boolean };

    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
    expect(h.syncManagerInstance.startSync).toHaveBeenCalledWith('drive-1', 'root-1', 'Test Drive');
    expect(h.configManager.setAutoSyncEnabled).toHaveBeenCalledWith(true);
    // Never touches the stop path.
    expect(h.syncManagerInstance.stopSync).not.toHaveBeenCalled();
  });

  it('resolves { success: false, error } and does NOT persist true when no drive mapping exists', async () => {
    h.databaseManager.getDriveMappings.mockResolvedValue([]);

    const res = (await invoke('sync:resume')) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No drive mappings found/);
    expect(h.configManager.setAutoSyncEnabled).not.toHaveBeenCalled();
    expect(h.syncManagerInstance.startSync).not.toHaveBeenCalled();
  });

  it('resolves { success: false, error } and does NOT persist true when the primary drive is a locked private drive', async () => {
    h.databaseManager.getDriveMappings.mockResolvedValue([
      { ...activeMapping, drivePrivacy: 'private' },
    ]);
    const { driveKeyManager } = await import('../../../src/main/drive-key-manager');
    (driveKeyManager.isUnlocked as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const res = (await invoke('sync:resume')) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/locked/i);
    expect(h.configManager.setAutoSyncEnabled).not.toHaveBeenCalled();
  });
});

describe('sync:pause -> sync:resume round trip (UX-21/UX-22)', () => {
  it('a pause followed by a resume ends by persisting true (last write wins) and restarts the engine', async () => {
    const pauseRes = (await invoke('sync:pause')) as { success: boolean };
    expect(pauseRes.success).toBe(true);
    expect(h.configManager.setAutoSyncEnabled).toHaveBeenLastCalledWith(false);

    const resumeRes = (await invoke('sync:resume')) as { success: boolean };
    expect(resumeRes.success).toBe(true);
    expect(h.configManager.setAutoSyncEnabled).toHaveBeenLastCalledWith(true);

    expect(h.syncManagerInstance.stopSync).toHaveBeenCalledTimes(1);
    expect(h.syncManagerInstance.startSync).toHaveBeenCalledTimes(1);
  });
});
