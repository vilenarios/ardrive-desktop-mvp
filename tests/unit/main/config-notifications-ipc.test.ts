// @vitest-environment node
//
// UX-29 / D-005: behavioral tests for the config:get-notifications-enabled and
// config:set-notifications-enabled IPC handlers in main.ts, exercised through
// a mocked electron surface (handlers captured from ipcMain.handle and invoked
// directly — same technique as tests/unit/main/main-approve-handlers.test.ts).
// These prove:
//   - both handlers are wrapped in envelopeHandler (D-005): every response is
//     the { success, data } / { success, error } envelope, never a raw value
//     or a rejected promise;
//   - get/set round-trips through the REAL ConfigManager (not mocked here,
//     unlike main-approve-handlers.test.ts) so the persisted value survives a
//     get -> set -> get cycle;
//   - the default (before any set call) is true — notifications ship on;
//   - InputValidator.validateBoolean rejects a non-boolean payload with an
//     envelope error instead of throwing out of the IPC boundary.
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

  return { handlers, MockBrowserWindow, databaseManager, turboManager, walletManagerInstance, syncManagerInstance };
});

vi.mock('electron', () => ({
  app: {
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/mock-user-data-ux29'),
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

beforeAll(async () => {
  await fs.rm('/tmp/mock-user-data-ux29', { recursive: true, force: true }).catch(() => {});
  // Real ConfigManager.saveGlobalConfig() writes here directly (no mkdir -p) —
  // the directory must exist before configManager.initialize() runs during
  // ardriveApp.initialize() below, or the whole handler-registration chain
  // never completes.
  await fs.mkdir('/tmp/mock-user-data-ux29', { recursive: true });
  await import('../../../src/main/main');
  // Handlers register inside app.whenReady().then(...) — wait for them
  await vi.waitFor(() => {
    if (!h.handlers.has('config:get-notifications-enabled') || !h.handlers.has('config:set-notifications-enabled')) {
      throw new Error('IPC handlers not registered yet');
    }
  });
});

describe('config:get-notifications-enabled / config:set-notifications-enabled (UX-29, D-005 envelope)', () => {
  // NOTE: these tests share ONE real ConfigManager singleton across the whole
  // file (module-scoped, exactly as it is in the running app) and therefore
  // run in declaration order deliberately — the default-value assertion runs
  // first, before any `set` call, matching how the singleton actually behaves
  // across a single app session.
  it('defaults to true before any set call', async () => {
    const res = (await invoke('config:get-notifications-enabled')) as { success: boolean; data?: boolean };

    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
  });

  it('round-trips false: set(false) then get() reflects it', async () => {
    const setRes = (await invoke('config:set-notifications-enabled', false)) as { success: boolean; data?: boolean };
    expect(setRes.success).toBe(true);
    expect(setRes.data).toBe(false);

    const getRes = (await invoke('config:get-notifications-enabled')) as { success: boolean; data?: boolean };
    expect(getRes.success).toBe(true);
    expect(getRes.data).toBe(false);
  });

  it('round-trips true after having been set false (toggle back on)', async () => {
    await invoke('config:set-notifications-enabled', false);
    const setRes = (await invoke('config:set-notifications-enabled', true)) as { success: boolean; data?: boolean };
    expect(setRes.success).toBe(true);
    expect(setRes.data).toBe(true);

    const getRes = (await invoke('config:get-notifications-enabled')) as { success: boolean; data?: boolean };
    expect(getRes.data).toBe(true);
  });

  it('rejects a non-boolean payload with an envelope error (never throws out of the IPC boundary)', async () => {
    const res = (await invoke('config:set-notifications-enabled', 'yes')) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must be a boolean/i);

    // The bad payload must not have been persisted — a subsequent get() still
    // reads the pre-call value (true, the default in this fresh-per-test file).
    const getRes = (await invoke('config:get-notifications-enabled')) as { success: boolean; data?: boolean };
    expect(getRes.data).toBe(true);
  });

  it('rejects undefined/missing payload the same way', async () => {
    const res = (await invoke('config:set-notifications-enabled', undefined)) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/must be a boolean/i);
  });
});
