// @vitest-environment node
//
// CORE-10 / D-005: behavioral tests for the config:get-gql-page-size and
// config:set-gql-page-size IPC handlers in main.ts, exercised through a
// mocked electron surface (handlers captured from ipcMain.handle and invoked
// directly — same technique as config-notifications-ipc.test.ts). These
// prove:
//   - both handlers are wrapped in envelopeHandler (D-005): every response is
//     the { success, data } / { success, error } envelope, never a raw value
//     or a rejected promise;
//   - get/set round-trips through the REAL ConfigManager (not mocked here)
//     so the persisted value survives a get -> set -> get cycle;
//   - the default (before any set call) is 1000 (the ar.io gateway max);
//   - app startup (ArDriveApp.initialize) applies the configured value to
//     ardrive-core-js's setGqlPageSize (mocked — this is a unit test, not an
//     integration test against the real package);
//   - InputValidator.validateGqlPageSize rejects an out-of-range/non-integer/
//     non-number payload with an envelope error instead of throwing out of
//     the IPC boundary, and the bad payload is never persisted.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs/promises';

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
    getArDrive: vi.fn(() => null),
  };

  const syncManagerInstance = {
    addToUploadQueue: vi.fn(),
    executeMetadataOperation: vi.fn(),
    setArDrive: vi.fn(),
    setSyncFolder: vi.fn(),
    startSync: vi.fn().mockResolvedValue(true),
    cancelUpload: vi.fn(),
  };

  // ardrive-core-js's setGqlPageSize — main.ts imports this (via
  // src/main/gql-page-size.ts) and calls it once at app init and again on a
  // successful config:set-gql-page-size. Mocked (not the real package) so
  // this stays a fast, deterministic unit test.
  const setGqlPageSizeMock = vi.fn();

  return { handlers, MockBrowserWindow, databaseManager, turboManager, walletManagerInstance, syncManagerInstance, setGqlPageSizeMock };
});

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/mock-user-data-core10'),
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
// NOTE: config-manager is intentionally NOT mocked — this test exercises the
// REAL ConfigManager (backed by a real config.json under a throwaway
// userData dir) so the get/set round-trip is genuine, not a mock echoing
// itself back.
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getActiveProfile: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../../src/main/arns-service', () => ({ arnsService: {} }));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: { getPrivateKeyData: vi.fn().mockResolvedValue(null) },
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));
// CORE-10: main.ts's gql-page-size module imports ardrive-core-js's real
// setGqlPageSize; mock the whole package so this stays fast/deterministic
// (matches every other main-process test's treatment of ardrive-core-js).
vi.mock('ardrive-core-js', () => ({
  setGqlPageSize: h.setGqlPageSizeMock,
}));

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

beforeAll(async () => {
  await fs.rm('/tmp/mock-user-data-core10', { recursive: true, force: true }).catch(() => {});
  // Real ConfigManager.saveGlobalConfig() writes here directly (no mkdir -p) —
  // the directory must exist before configManager.initialize() runs during
  // ardriveApp.initialize() below, or the whole handler-registration chain
  // never completes.
  await fs.mkdir('/tmp/mock-user-data-core10', { recursive: true });
  await import('../../../src/main/main');
  // Handlers register inside app.whenReady().then(...) — wait for them
  await vi.waitFor(() => {
    if (!h.handlers.has('config:get-gql-page-size') || !h.handlers.has('config:set-gql-page-size')) {
      throw new Error('IPC handlers not registered yet');
    }
  });
});

describe('CORE-10 startup: applies the configured GraphQL page size to ardrive-core-js', () => {
  it('calls setGqlPageSize with the default (1000) at app init (no config set yet)', () => {
    // ArDriveApp.initialize() runs applyConfiguredGqlPageSize() before the
    // IPC handlers are even registered, so by the time beforeAll resolves
    // this must already have happened exactly once with the default.
    expect(h.setGqlPageSizeMock).toHaveBeenCalledWith(1000);
  });
});

describe('config:get-gql-page-size / config:set-gql-page-size (CORE-10, D-005 envelope)', () => {
  // NOTE: these tests share ONE real ConfigManager singleton across the whole
  // file (module-scoped, exactly as it is in the running app) and therefore
  // run in declaration order deliberately — the default-value assertion runs
  // first, before any `set` call.
  it('defaults to 1000 before any set call', async () => {
    const res = (await invoke('config:get-gql-page-size')) as { success: boolean; data?: number };

    expect(res.success).toBe(true);
    expect(res.data).toBe(1000);
  });

  it('round-trips a valid value: set(250) then get() reflects it, and re-applies it to core-js', async () => {
    h.setGqlPageSizeMock.mockClear();
    const setRes = (await invoke('config:set-gql-page-size', 250)) as { success: boolean; data?: number };
    expect(setRes.success).toBe(true);
    expect(setRes.data).toBe(250);
    expect(h.setGqlPageSizeMock).toHaveBeenCalledWith(250);

    const getRes = (await invoke('config:get-gql-page-size')) as { success: boolean; data?: number };
    expect(getRes.success).toBe(true);
    expect(getRes.data).toBe(250);
  });

  it('accepts the ar.io max (1000) explicitly', async () => {
    const setRes = (await invoke('config:set-gql-page-size', 1000)) as { success: boolean; data?: number };
    expect(setRes.success).toBe(true);
    expect(setRes.data).toBe(1000);
  });

  it('rejects 0 (below the minimum) with an envelope error, and does not persist it', async () => {
    // Prior test left the persisted value at 1000.
    const res = (await invoke('config:set-gql-page-size', 0)) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/at least 1/i);

    const getRes = (await invoke('config:get-gql-page-size')) as { success: boolean; data?: number };
    expect(getRes.data).toBe(1000);
  });

  it('rejects 2000 (above the ar.io max) with an envelope error, and does not persist it', async () => {
    const res = (await invoke('config:set-gql-page-size', 2000)) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cannot exceed 1000/i);

    const getRes = (await invoke('config:get-gql-page-size')) as { success: boolean; data?: number };
    expect(getRes.data).toBe(1000);
  });

  it('rejects a non-integer value (3.5) with an envelope error', async () => {
    const res = (await invoke('config:set-gql-page-size', 3.5)) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must be an integer/i);
  });

  it('rejects a non-number payload (string) with an envelope error (never throws out of the IPC boundary)', async () => {
    const res = (await invoke('config:set-gql-page-size', 'abc')) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must be a valid number/i);
  });

  it('rejects undefined/missing payload the same way', async () => {
    const res = (await invoke('config:set-gql-page-size', undefined)) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must be a valid number/i);
  });
});
