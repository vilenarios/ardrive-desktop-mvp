// @vitest-environment node
//
// PRIV-7: the drive:unlock IPC handler previously ran the unlock password
// through InputValidator.validatePassword (8-char NEW-password policy), so a
// private drive created by ANOTHER ArDrive client with a shorter password could
// never be unlocked — the request was rejected at the validator before trial
// decryption (PRIV-2) ever ran.
//
// These tests drive the real main.ts handlers (captured from ipcMain.handle,
// same technique as main-approve-handlers.test.ts) and assert:
//   (a) a short (<8 char) password on drive:unlock is ACCEPTED — it reaches
//       walletManager.unlockPrivateDrive and unlocks when correct;
//   (b) a WRONG password (even a short one) still FAILS via the trial-decrypt
//       rejection surfaced by unlockPrivateDrive — the gate wasn't just deleted;
//   (c) drive:create-private (NEW password we mint) STILL enforces the 8-char
//       minimum and never reaches createPrivateDrive on a short password.
//
// Negative control: before the fix, (a) would return {success:false} with an
// "at least 8 characters" error and unlockPrivateDrive would NOT be called.
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

  const walletManagerInstance = {
    // init-path stubs
    hasStoredWallet: vi.fn().mockResolvedValue(false),
    attemptAutoLoad: vi.fn().mockResolvedValue(false),
    isWalletLoaded: vi.fn(() => true),
    getWalletInfo: vi.fn().mockResolvedValue({ address: 'mock', balance: '0', walletType: 'arweave' }),
    // handler-path stubs
    unlockPrivateDrive: vi.fn(),
    createPrivateDrive: vi.fn(),
    getArDrive: vi.fn(() => ({ fake: 'ardrive' })),
    listDrivesWithStatus: vi.fn().mockResolvedValue([]),
  };

  const syncManagerInstance = {
    setArDrive: vi.fn(),
    setSyncFolder: vi.fn(),
    startSync: vi.fn().mockResolvedValue(true),
  };

  const driveKeyManager = {
    getPrivateKeyData: vi.fn().mockResolvedValue({ fake: 'pkd' }),
  };

  return { handlers, MockBrowserWindow, walletManagerInstance, syncManagerInstance, driveKeyManager };
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
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({})) },
  Tray: vi.fn().mockImplementation(() => ({
    on: vi.fn(), setContextMenu: vi.fn(), setToolTip: vi.fn(), destroy: vi.fn(),
  })),
  nativeImage: { createFromPath: vi.fn(() => ({ resize: vi.fn(() => ({})) })) },
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
  databaseManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
    getDriveMappings: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { isInitialized: vi.fn(() => false) },
}));
vi.mock('../../../src/main/config-manager', () => ({
  configManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ isFirstRun: true, syncFolder: null }),
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
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
  driveKeyManager: h.driveKeyManager,
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const SHORT_PASSWORD = 'abc'; // 3 chars — below the 8-char NEW-password minimum

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

beforeAll(async () => {
  await import('../../../src/main/main');
  await vi.waitFor(() => {
    if (!h.handlers.has('drive:unlock') || !h.handlers.has('drive:create-private')) {
      throw new Error('IPC handlers not registered yet');
    }
  });
});

beforeEach(() => {
  h.walletManagerInstance.unlockPrivateDrive.mockReset();
  h.walletManagerInstance.createPrivateDrive.mockReset();
  h.walletManagerInstance.listDrivesWithStatus.mockReset().mockResolvedValue([]);
  h.syncManagerInstance.setArDrive.mockClear();
});

describe('drive:unlock — accepts EXISTING short passwords (PRIV-7)', () => {
  it('(a) accepts a <8-char CORRECT password and unlocks (reaches trial-decrypt)', async () => {
    h.walletManagerInstance.unlockPrivateDrive.mockResolvedValue({ success: true });
    h.walletManagerInstance.listDrivesWithStatus.mockResolvedValue([
      { id: DRIVE_ID, name: 'Secret Drive', privacy: 'private' },
    ]);

    const result = (await invoke('drive:unlock', DRIVE_ID, SHORT_PASSWORD)) as {
      success: boolean;
      drive?: { id: string };
      error?: string;
    };

    // The short password passed validation and reached trial-decryption —
    // pre-fix this call never happened (rejected at validatePassword).
    expect(h.walletManagerInstance.unlockPrivateDrive).toHaveBeenCalledWith(DRIVE_ID, SHORT_PASSWORD);
    expect(result.success).toBe(true);
    expect(result.drive).toEqual(expect.objectContaining({ id: DRIVE_ID }));
    expect(result.error).toBeUndefined();
  });

  it('(b) still REJECTS a wrong (short) password via trial-decrypt rejection', async () => {
    // unlockPrivateDrive owns the security invariant (PRIV-2): a wrong password
    // derives a garbage key, getPrivateDrive fails to decrypt, and it returns
    // success:false. The handler must surface that rejection unchanged.
    h.walletManagerInstance.unlockPrivateDrive.mockResolvedValue({
      success: false,
      error: 'Invalid password. Please check your password and try again.',
    });

    const result = (await invoke('drive:unlock', DRIVE_ID, SHORT_PASSWORD)) as {
      success: boolean;
      error?: string;
    };

    // It was NOT short-circuited by a length check — the derive/trial ran...
    expect(h.walletManagerInstance.unlockPrivateDrive).toHaveBeenCalledWith(DRIVE_ID, SHORT_PASSWORD);
    // ...and still failed. The security gate is intact.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid password/);
    // No decrypted drive leaked back on failure.
    expect(h.syncManagerInstance.setArDrive).not.toHaveBeenCalled();
  });

  it('rejects an empty password without attempting an unlock', async () => {
    const result = (await invoke('drive:unlock', DRIVE_ID, '')) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be empty/);
    expect(h.walletManagerInstance.unlockPrivateDrive).not.toHaveBeenCalled();
  });
});

describe('drive:create-private — NEW-password 8-char minimum is UNCHANGED (PRIV-7)', () => {
  it('(c) rejects a <8-char password and never mints the drive', async () => {
    const result = (await invoke('drive:create-private', 'My Private Drive', SHORT_PASSWORD)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at least 8 characters/);
    expect(h.walletManagerInstance.createPrivateDrive).not.toHaveBeenCalled();
  });

  it('creates the drive when the new password meets the minimum', async () => {
    h.walletManagerInstance.createPrivateDrive.mockResolvedValue({ id: DRIVE_ID, name: 'My Private Drive' });

    const result = (await invoke('drive:create-private', 'My Private Drive', 'longenough')) as {
      success: boolean;
      data?: { id: string };
    };

    expect(h.walletManagerInstance.createPrivateDrive).toHaveBeenCalledWith('My Private Drive', 'longenough');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({ id: DRIVE_ID }));
  });
});
