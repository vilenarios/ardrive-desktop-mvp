// @vitest-environment node
//
// MONEY-1 (D-010 Turbo-only): behavioral tests for the uploads:approve and
// uploads:approve-all IPC handlers in main.ts, exercised through a mocked
// electron surface (handlers captured from ipcMain.handle and invoked
// directly). Every ardrive-core upload executes via Turbo (factory
// turboSettings), so:
//   - the DB uploadMethod written on approval must be 'turbo' — never the
//     old `recommendedMethod || 'ar'` fiction, even against adversarial
//     rows/arguments that claim 'ar';
//   - the AR-denominated balance gate (hardcoded 1 winston/byte against the
//     AR wallet balance) must be gone from approve-all;
//   - a row whose real Turbo cost exceeds the balance is blocked (single
//     approve throws; approve-all skips it with a per-file reason);
//   - free-tier rows approve without any balance check.
// Pending rows use the raw sqlite shape (integer booleans, null quotes,
// legacy recommendedMethod strings) per CLAUDE.md trap 6.
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
    addUpload: vi.fn().mockResolvedValue(undefined),
    removePendingUpload: vi.fn().mockResolvedValue(undefined),
    updatePendingUploadStatus: vi.fn().mockResolvedValue(undefined),
    clearAllPendingUploads: vi.fn().mockResolvedValue(undefined),
    updateUpload: vi.fn().mockResolvedValue(undefined),
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
      balance: '0', // 0 AR — the removed AR gate would have blocked everything
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

const FILE_SIZE_5MB = 5 * 1024 * 1024;
const FILE_SIZE_50KB = 50 * 1024;

// Raw sqlite row shape (integer booleans, null quotes). Adversarial default:
// recommendedMethod 'ar' — the field the old approve path recorded as truth.
const dbShapedPending = (overrides: Record<string, unknown> = {}) => ({
  id: `pending-${Math.random().toString(36).slice(2)}`,
  driveId: 'drive-1',
  localPath: '/sync/folder/file.bin',
  fileName: 'file.bin',
  fileSize: FILE_SIZE_5MB,
  estimatedCost: FILE_SIZE_5MB / 1e12,
  estimatedTurboCost: null,
  hasSufficientTurboBalance: 0,
  recommendedMethod: 'ar',
  conflictType: 'none',
  conflictDetails: null,
  status: 'awaiting_approval',
  operationType: 'upload',
  previousPath: null,
  arfsFileId: null,
  arfsFolderId: null,
  createdAt: new Date(),
  ...overrides,
});

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

beforeAll(async () => {
  await import('../../../src/main/main');
  // Handlers register inside app.whenReady().then(...) — wait for them
  await vi.waitFor(() => {
    if (!h.handlers.has('uploads:approve') || !h.handlers.has('uploads:approve-all')) {
      throw new Error('IPC handlers not registered yet');
    }
  });
});

beforeEach(() => {
  h.databaseManager.getPendingUploads.mockClear().mockResolvedValue([]);
  h.databaseManager.getUploads.mockClear().mockResolvedValue([]);
  h.databaseManager.addUpload.mockClear();
  h.databaseManager.removePendingUpload.mockClear();
  h.syncManagerInstance.addToUploadQueue.mockClear();
  h.turboManager.isInitialized.mockReset().mockReturnValue(false);
  h.turboManager.getBalance.mockReset();
  h.turboManager.getUploadCosts.mockReset();
  h.walletManagerInstance.getWalletInfo.mockClear().mockResolvedValue({
    address: 'mock-address',
    balance: '0',
    walletType: 'arweave',
  });
});

describe('uploads:approve — records the payment rail that actually executes (MONEY-1)', () => {
  it('records uploadMethod turbo for a quoted, funded row (never the recommendedMethod ar fiction)', async () => {
    const row = dbShapedPending({ estimatedTurboCost: 0.01, hasSufficientTurboBalance: 1 });
    h.databaseManager.getPendingUploads.mockResolvedValue([row]);
    h.turboManager.isInitialized.mockReturnValue(true);
    h.turboManager.getUploadCosts.mockResolvedValue({ winc: String(FILE_SIZE_5MB) });
    h.turboManager.getBalance.mockResolvedValue({ winc: String(FILE_SIZE_5MB * 10), ar: '0.05' });

    await invoke('uploads:approve', row.id);

    expect(h.databaseManager.addUpload).toHaveBeenCalledTimes(1);
    expect(h.databaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, uploadMethod: 'turbo' })
    );
    expect(h.databaseManager.removePendingUpload).toHaveBeenCalledWith(row.id);
    expect(h.syncManagerInstance.addToUploadQueue).toHaveBeenCalledWith(
      expect.objectContaining({ uploadMethod: 'turbo' })
    );
  });

  it('records turbo even if a stale renderer still sends ar as the method argument', async () => {
    const row = dbShapedPending();
    h.databaseManager.getPendingUploads.mockResolvedValue([row]);
    // Turbo not initialized: the old code would fall back to 'ar' here

    await invoke('uploads:approve', row.id, 'ar');

    expect(h.databaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, uploadMethod: 'turbo' })
    );
  });

  it('blocks approval (envelope error) when the real Turbo cost exceeds the balance, writing nothing', async () => {
    const row = dbShapedPending({ estimatedTurboCost: 0.05, hasSufficientTurboBalance: 0 });
    h.databaseManager.getPendingUploads.mockResolvedValue([row]);
    h.turboManager.isInitialized.mockReturnValue(true);
    h.turboManager.getUploadCosts.mockResolvedValue({ winc: '50000000000' });
    h.turboManager.getBalance.mockResolvedValue({ winc: '1000', ar: '0.000000001' });

    // UX-3 (D-005): the handler is envelope-wrapped, so a business-rule block
    // resolves { success: false, error } instead of rejecting. The renderer's
    // `if (!result.success)` guard (Dashboard.handleApproveUpload) depends on
    // exactly this shape — a bare `if (result)` would wrongly treat it as OK.
    const res = (await invoke('uploads:approve', row.id)) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Insufficient Turbo Credits/);

    expect(h.databaseManager.addUpload).not.toHaveBeenCalled();
    expect(h.databaseManager.removePendingUpload).not.toHaveBeenCalled();
    expect(h.syncManagerInstance.addToUploadQueue).not.toHaveBeenCalled();
  });

  it('approves a free-tier row with zero balance and no balance lookup', async () => {
    const row = dbShapedPending({ fileSize: FILE_SIZE_50KB, estimatedCost: FILE_SIZE_50KB / 1e12 });
    h.databaseManager.getPendingUploads.mockResolvedValue([row]);
    h.turboManager.isInitialized.mockReturnValue(true);
    // If the free path consulted pricing/balance, these would blow up the handler
    h.turboManager.getUploadCosts.mockRejectedValue(new Error('must not be called'));
    h.turboManager.getBalance.mockRejectedValue(new Error('must not be called'));

    await invoke('uploads:approve', row.id);

    expect(h.turboManager.getUploadCosts).not.toHaveBeenCalled();
    expect(h.databaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, uploadMethod: 'turbo' })
    );
  });
});

describe('uploads:approve-all — Turbo-only semantics, no AR gate (MONEY-1)', () => {
  it('approves paid rows with a 0 AR wallet balance (the old 1-winston/byte AR gate is gone)', async () => {
    // Old behavior: recommendedMethod 'ar' → arBalance(0) < fileSize → every
    // row skipped with "Insufficient AR balance".
    const rows = [
      dbShapedPending({ fileName: 'a.bin' }),
      dbShapedPending({ fileName: 'b.bin' }),
    ];
    h.databaseManager.getPendingUploads.mockResolvedValue(rows);
    h.turboManager.isInitialized.mockReturnValue(false); // no quotes available

    // UX-3 (D-005): approve-all is envelope-wrapped — the summary is nested
    // under `.data`. Dashboard.handleApproveAll unwraps `.data` after checking
    // `.success`; a stale call site reading `.approvedCount` off the raw
    // envelope would read `undefined`.
    const envelope = (await invoke('uploads:approve-all')) as {
      success: true;
      data: { approvedCount: number; totalCount: number; errors?: string[] };
    };
    expect(envelope.success).toBe(true);
    const result = envelope.data;

    expect(result.approvedCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.errors).toBeUndefined();
    expect(h.databaseManager.addUpload).toHaveBeenCalledTimes(2);
    for (const call of h.databaseManager.addUpload.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ uploadMethod: 'turbo' }));
    }
    // No AR-denominated error text anywhere
    expect(JSON.stringify(result)).not.toMatch(/Insufficient AR balance/);
  });

  it('skips rows whose Turbo cost exceeds the balance with a per-file reason; approves the rest as turbo', async () => {
    const free = dbShapedPending({ fileName: 'free.bin', fileSize: FILE_SIZE_50KB });
    const big = dbShapedPending({ fileName: 'big.bin', fileSize: 10 * 1024 * 1024 });
    const small = dbShapedPending({ fileName: 'small.bin', fileSize: 1024 * 1024 });
    h.databaseManager.getPendingUploads.mockResolvedValue([free, big, small]);
    h.turboManager.isInitialized.mockReturnValue(true);
    // cost = fileSize winc; balance covers only the 1MB file
    h.turboManager.getUploadCosts.mockImplementation(async (size: number) => ({ winc: String(size) }));
    h.turboManager.getBalance.mockResolvedValue({ winc: String(2 * 1024 * 1024), ar: '0.000002' });

    // UX-3 (D-005): unwrap the envelope's `.data` (see the approve-all note above).
    const envelope = (await invoke('uploads:approve-all')) as {
      success: true;
      data: { approvedCount: number; totalCount: number; errors?: string[] };
    };
    expect(envelope.success).toBe(true);
    const result = envelope.data;

    expect(result.approvedCount).toBe(2); // free + small
    expect(result.totalCount).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toMatch(/big\.bin: Insufficient Turbo Credits/);

    // The skipped row is written nowhere and stays pending
    const writtenIds = h.databaseManager.addUpload.mock.calls.map(c => (c[0] as { id: string }).id);
    expect(writtenIds).toContain(free.id);
    expect(writtenIds).toContain(small.id);
    expect(writtenIds).not.toContain(big.id);
    expect(h.databaseManager.removePendingUpload).not.toHaveBeenCalledWith(big.id);

    for (const call of h.databaseManager.addUpload.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ uploadMethod: 'turbo' }));
    }
  });

  it('free-tier rows are approved even when the Turbo balance is zero', async () => {
    const free = dbShapedPending({ fileName: 'free.bin', fileSize: FILE_SIZE_50KB });
    h.databaseManager.getPendingUploads.mockResolvedValue([free]);
    h.turboManager.isInitialized.mockReturnValue(true);
    h.turboManager.getUploadCosts.mockImplementation(async (size: number) => ({ winc: String(size) }));
    h.turboManager.getBalance.mockResolvedValue({ winc: '0', ar: '0' });

    // UX-3 (D-005): unwrap the envelope's `.data` (see the approve-all note above).
    const envelope = (await invoke('uploads:approve-all')) as {
      success: true;
      data: { approvedCount: number; errors?: string[] };
    };
    expect(envelope.success).toBe(true);
    const result = envelope.data;

    expect(result.approvedCount).toBe(1);
    expect(result.errors).toBeUndefined();
    expect(h.databaseManager.addUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: free.id, uploadMethod: 'turbo' })
    );
  });
});

// UX-3 (D-005) trap #1: uploads:reject / reject-all / cancel now return
// IpcResult<boolean>. The envelope is ALWAYS a truthy object, so a call site
// doing `if (result)` / `if (!result)` on the raw envelope is silently wrong —
// only `.success` reveals the true outcome. These tests pin the exact shape the
// renderer guards (Dashboard.handleRejectUpload/handleRejectAll,
// UploadApprovalQueueModern.handleCancelUpload) depend on.
describe('uploads:reject / reject-all / cancel — IpcResult envelope for boolean handlers (UX-3 trap #1)', () => {
  it('reject resolves { success: true, data: true } and marks the row rejected', async () => {
    h.databaseManager.updatePendingUploadStatus.mockClear().mockResolvedValue(undefined);

    const res = (await invoke('uploads:reject', 'up-1')) as { success: boolean; data?: boolean };

    expect(res).toBeTruthy(); // the envelope object is always truthy — hence trap #1
    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
    expect(h.databaseManager.updatePendingUploadStatus).toHaveBeenCalledWith('up-1', 'rejected');
  });

  it('reject resolves { success: false, error } when the DB write fails (still a truthy object)', async () => {
    h.databaseManager.updatePendingUploadStatus.mockClear().mockRejectedValueOnce(new Error('db down'));

    const res = (await invoke('uploads:reject', 'up-1')) as { success: boolean; error?: string };

    // A bare `if (res)` would treat this failure as success — the renderer's
    // `if (!res.success)` guard is the only thing that catches it.
    expect(res).toBeTruthy();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/db down/);
  });

  it('reject-all resolves { success: true, data: true } and clears the pending queue', async () => {
    h.databaseManager.clearAllPendingUploads.mockClear().mockResolvedValue(undefined);

    const res = (await invoke('uploads:reject-all')) as { success: boolean; data?: boolean };

    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
    expect(h.databaseManager.clearAllPendingUploads).toHaveBeenCalled();
  });

  it('cancel resolves { success: true, data: true } when the queue cancels a pending item', async () => {
    h.syncManagerInstance.cancelUpload.mockReturnValueOnce({ cancelled: true, wasInFlight: false });
    h.databaseManager.updateUpload.mockClear().mockResolvedValue(undefined);

    const res = (await invoke('uploads:cancel', 'up-1')) as { success: boolean; data?: boolean };

    expect(res.success).toBe(true);
    expect(res.data).toBe(true);
  });
});
