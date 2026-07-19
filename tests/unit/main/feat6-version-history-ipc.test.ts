// @vitest-environment node
//
// FEAT-6: behavioral test for the `files:get-versions` IPC handler in main.ts,
// exercised through a mocked electron surface (handler captured from
// ipcMain.handle and invoked directly, same harness as
// main-approve-handlers.test.ts).
//
// Proves the handler:
//   - returns the version list wrapped in the D-005 IpcResult envelope
//     ({ success: true, data: [...] }), newest-first as getFileVersions gives,
//   - validates the path argument (a traversal path fails closed with
//     { success: false }, and getFileVersions is never queried),
//   - forwards the validated path straight to databaseManager.getFileVersions.
// The version rows use the shape the DB method emits (real boolean isLatest,
// null tx ids) per CLAUDE.md trap 6.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

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
    getFileVersions: vi.fn().mockResolvedValue([]),
  };

  const turboManager = {
    isInitialized: vi.fn(() => false),
    getBalance: vi.fn(),
    getUploadCosts: vi.fn(),
  };

  const walletManagerInstance = {
    hasStoredWallet: vi.fn().mockResolvedValue(false),
    attemptAutoLoad: vi.fn().mockResolvedValue(false),
    isWalletLoaded: vi.fn(() => false),
    getArDrive: vi.fn(() => null),
    getWalletInfo: vi.fn().mockResolvedValue({
      address: 'mock-address',
      balance: '0',
      walletType: 'arweave',
    }),
  };

  const syncManagerInstance = {
    addToUploadQueue: vi.fn(),
    executeMetadataOperation: vi.fn(),
    setArDrive: vi.fn(),
    setSyncFolder: vi.fn(),
    startSync: vi.fn().mockResolvedValue(true),
    cancelUpload: vi.fn(),
    forceDownloadExistingFiles: vi.fn().mockResolvedValue(undefined),
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
    getPath: vi.fn(() => '/tmp/mock-user-data'),
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
vi.mock('../../../src/main/config-manager', () => ({
  configManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ isFirstRun: true, syncFolder: null }),
  },
}));
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

// DB-emitted shape: real boolean isLatest, null (not undefined) tx ids, an
// ISO/Date createdAt. version DESC ordering is getFileVersions' contract.
const dbVersion = (overrides: Record<string, unknown> = {}) => ({
  id: `ver-${Math.random().toString(36).slice(2)}`,
  fileHash: 'abc123',
  fileName: 'report.txt',
  filePath: '/sync/report.txt',
  relativePath: 'report.txt',
  fileSize: 2048,
  arweaveId: 'TX_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  turboId: null,
  version: 2,
  parentVersion: null,
  changeType: 'update',
  uploadMethod: 'turbo',
  createdAt: new Date('2026-07-04T12:00:00Z'),
  isLatest: true,
  ...overrides,
});

beforeAll(async () => {
  await import('../../../src/main/main');
  await vi.waitFor(() => {
    if (!h.handlers.has('files:get-versions')) {
      throw new Error('files:get-versions handler not registered yet');
    }
  });
});

beforeEach(() => {
  h.databaseManager.getFileVersions.mockClear().mockResolvedValue([]);
});

describe('files:get-versions — permanent version history IPC (FEAT-6)', () => {
  it('returns the version list wrapped in the IpcResult envelope', async () => {
    const rows = [
      dbVersion({ version: 3, isLatest: true, changeType: 'update' }),
      dbVersion({ version: 2, isLatest: false, changeType: 'update', turboId: 'TX_TURBO_2', arweaveId: null }),
      dbVersion({ version: 1, isLatest: false, changeType: 'create' }),
    ];
    h.databaseManager.getFileVersions.mockResolvedValue(rows);

    const result: any = await invoke('files:get-versions', '/sync/report.txt');

    expect(result).toMatchObject({ success: true });
    expect(result.data).toHaveLength(3);
    expect(result.data.map((v: any) => v.version)).toEqual([3, 2, 1]);
    // Validated path forwarded verbatim to the DB query.
    expect(h.databaseManager.getFileVersions).toHaveBeenCalledWith('/sync/report.txt');
  });

  it('returns an empty list (not an error) for a file with no recorded versions', async () => {
    h.databaseManager.getFileVersions.mockResolvedValue([]);
    const result: any = await invoke('files:get-versions', '/sync/never-edited.txt');
    expect(result).toEqual({ success: true, data: [] });
  });

  it('fails closed on a path-traversal argument and never queries the DB', async () => {
    const result: any = await invoke('files:get-versions', '/sync/../../etc/passwd');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(h.databaseManager.getFileVersions).not.toHaveBeenCalled();
  });

  it('rejects a non-string path argument', async () => {
    const result: any = await invoke('files:get-versions', 12345);
    expect(result.success).toBe(false);
    expect(h.databaseManager.getFileVersions).not.toHaveBeenCalled();
  });
});
