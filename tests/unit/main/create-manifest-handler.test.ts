// @vitest-environment node
//
// UAT (manifest site-deploy verification, SYNC-18 follow-up): behavioral
// tests for the `drive:create-manifest` IPC handler (main.ts:1424) — the
// only entry point that turns a folder into a browsable Arweave path
// manifest via `arDrive.uploadPublicManifest(...)`.
//
// What this pins down (never previously covered by a test):
//   1. Input validation runs BEFORE anything touches ArDrive (bad driveId /
//      folderId never reach core-js).
//   2. Public vs private drives are routed to the right core-js listing call
//      (listPublicFolder vs listPrivateFolder with the unlocked drive key);
//      a locked private drive fails loudly instead of silently listing
//      nothing.
//   3. uploadPublicManifest is called with the EntityID-wrapped folder, the
//      user's manifest name (or the 'DriveManifest.json' default), and
//      'upsert' conflict resolution (so re-running updates the same-named
//      manifest instead of erroring).
//   4. The handler is a PASS-THROUGH for the link core-js/ardrive-core-js's
//      GatewayAPI produces — it does not rewrite, rebuild, or otherwise
//      touch `result.links`. Those links are built by core-js from the
//      `Arweave` instance the app constructed at wallet-load time via
//      `Arweave.init(getGatewayConfig(...))` (wallet-manager-secure.ts
//      :424-434 / :525-535), which resolves to the app's configured gateway
//      — turbo-gateway.com by default (src/main/gateway.ts, pinned by
//      tests/unit/main/gateway.test.ts) — and NEVER arweave.net. This test
//      proves the handler forwards that link verbatim (using a fixture link
//      built from the real DEFAULT_GATEWAY_HOST constant, not a hand-typed
//      string) into the `{ success, data: { manifestUrl, fileUrls } }`
//      envelope that CreateManifestModal.handleConfirmCreate/onSuccess
//      receives — see create-manifest-modal.test.tsx for the renderer side
//      of that same contract.
//   5. The manifest upload is recorded to upload history (addUpload) and the
//      UI is told to refresh (`drive:metadata-updated` / `drive:update`).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { DEFAULT_GATEWAY_HOST } from '../../../src/main/gateway';

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const FOLDER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_FOLDER_ID = '33333333-3333-4333-8333-333333333333';

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
    getDriveMetadata: vi.fn().mockResolvedValue([]),
  };

  const turboManager = {
    isInitialized: vi.fn(() => false),
    getBalance: vi.fn(),
    getUploadCosts: vi.fn(),
  };

  // The mock arDrive instance returned by walletManager.getArDrive(). Its
  // listPublicFolder/listPrivateFolder/uploadPublicManifest calls are the
  // exact three core-js entry points main.ts's create-manifest handler
  // drives — asserting against these vi.fn()s is the "calls core-js with
  // the right drive/folder" half of the acceptance bar.
  const mockArDrive = {
    listPublicFolder: vi.fn(),
    listPrivateFolder: vi.fn(),
    uploadPublicManifest: vi.fn(),
  };

  const walletManagerInstance = {
    hasStoredWallet: vi.fn().mockResolvedValue(false),
    attemptAutoLoad: vi.fn().mockResolvedValue(false),
    isWalletLoaded: vi.fn(() => false),
    getArDrive: vi.fn((): typeof mockArDrive | null => mockArDrive),
    listDrives: vi.fn().mockResolvedValue([]),
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
  };

  const driveKeyManagerMock = {
    getDriveKey: vi.fn(),
    getPrivateKeyData: vi.fn().mockResolvedValue(null),
  };

  // Minimal EntityID stand-in: preserves the id so assertions can check the
  // handler wrapped the right raw string, without pulling in real core-js
  // (which needs a live ecc self-check environment this suite avoids).
  class MockEntityID {
    constructor(public id: string) {}
    toString() {
      return this.id;
    }
  }

  return {
    handlers,
    MockBrowserWindow,
    databaseManager,
    turboManager,
    walletManagerInstance,
    syncManagerInstance,
    mockArDrive,
    driveKeyManagerMock,
    MockEntityID,
  };
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
  driveKeyManager: h.driveKeyManagerMock,
}));
// The handler does `await import('ardrive-core-js')` for the EntityID class
// at call time. Mocked at the package level (not just wallet-manager-secure,
// which is itself entirely mocked below) so that dynamic import resolves to
// this lightweight stand-in instead of loading the real native/ecc-checked
// package under vitest's node environment.
vi.mock('ardrive-core-js', () => ({
  EntityID: h.MockEntityID,
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

const publicFile = (name: string) => ({ entityType: 'file', name, path: `/${name}` });
const aFolder = (name: string) => ({ entityType: 'folder', name, path: `/${name}` });

beforeAll(async () => {
  await import('../../../src/main/main');
  await vi.waitFor(() => {
    if (!h.handlers.has('drive:create-manifest')) {
      throw new Error('IPC handler not registered yet');
    }
  });
});

beforeEach(() => {
  h.mockArDrive.listPublicFolder.mockReset();
  h.mockArDrive.listPrivateFolder.mockReset();
  h.mockArDrive.uploadPublicManifest.mockReset();
  h.walletManagerInstance.getArDrive.mockReset().mockReturnValue(h.mockArDrive);
  h.walletManagerInstance.listDrives.mockReset().mockResolvedValue([]);
  h.driveKeyManagerMock.getDriveKey.mockReset();
  h.databaseManager.addUpload.mockClear();
});

describe('drive:create-manifest (SYNC-18 follow-up — site-deploy verification)', () => {
  describe('input validation — rejected before touching ArDrive', () => {
    it('rejects a malformed driveId', async () => {
      // driveId validation (InputValidator.validateDriveId) uses a loose
      // 36-char alphanumeric+hyphen PROFILE_ID pattern — an underscore is
      // enough to fail it (exercises the format assertion, not a length guard).
      const res = (await invoke('drive:create-manifest', {
        driveId: 'not_a_valid_drive_id_1234567890abcde',
        folderId: FOLDER_ID,
      })) as { success: boolean; error?: string };

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/driveId/);
      expect(h.walletManagerInstance.getArDrive).not.toHaveBeenCalled();
      expect(h.mockArDrive.uploadPublicManifest).not.toHaveBeenCalled();
    });

    it('rejects a malformed folderId', async () => {
      const res = (await invoke('drive:create-manifest', {
        driveId: DRIVE_ID,
        folderId: 'also-not-a-uuid-also-not-a-uuid-abcd',
      })) as { success: boolean; error?: string };

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/valid entity id/i);
      expect(h.mockArDrive.uploadPublicManifest).not.toHaveBeenCalled();
    });
  });

  it('errors if ArDrive has not been initialized (no wallet loaded)', async () => {
    h.walletManagerInstance.getArDrive.mockReturnValue(null);

    const res = (await invoke('drive:create-manifest', {
      driveId: DRIVE_ID,
      folderId: FOLDER_ID,
    })) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/ArDrive not initialized/);
  });

  it('errors when the folder has no files (nothing to publish)', async () => {
    h.walletManagerInstance.listDrives.mockResolvedValue([
      { id: DRIVE_ID, rootFolderId: FOLDER_ID, privacy: 'public' },
    ]);
    h.mockArDrive.listPublicFolder.mockResolvedValue([aFolder('empty-subfolder')]);

    const res = (await invoke('drive:create-manifest', {
      driveId: DRIVE_ID,
      folderId: FOLDER_ID,
    })) as { success: boolean; error?: string };

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/No files found/);
    expect(h.mockArDrive.uploadPublicManifest).not.toHaveBeenCalled();
  });

  describe('public drive — happy path', () => {
    // The link fixture is deliberately built from the real DEFAULT_GATEWAY_HOST
    // constant (src/main/gateway.ts), not a hand-typed 'turbo-gateway.com'
    // string, so this test is actually pinned to the app's configured-gateway
    // source of truth rather than a coincidentally-matching literal.
    const manifestTxId = 'TX_MANIFEST_ABC123';
    const links = [
      `https://${DEFAULT_GATEWAY_HOST}/${manifestTxId}`,
      `https://${DEFAULT_GATEWAY_HOST}/${manifestTxId}/a.txt`,
      `https://${DEFAULT_GATEWAY_HOST}/${manifestTxId}/sub/b.txt`,
    ];

    beforeEach(() => {
      h.walletManagerInstance.listDrives.mockResolvedValue([
        { id: DRIVE_ID, rootFolderId: FOLDER_ID, privacy: 'public' },
      ]);
      h.mockArDrive.listPublicFolder.mockResolvedValue([
        publicFile('a.txt'),
        publicFile('sub/b.txt'),
        aFolder('sub'),
      ]);
      h.mockArDrive.uploadPublicManifest.mockResolvedValue({
        created: [{ dataTxId: manifestTxId }],
        links,
        fees: { [manifestTxId]: '0' },
        manifest: { manifest: 'arweave/paths', version: '0.2.0', index: { path: 'a.txt' }, paths: {} },
      });
    });

    it('lists the public folder recursively (root included, uncapped depth)', async () => {
      await invoke('drive:create-manifest', { driveId: DRIVE_ID, folderId: FOLDER_ID });

      expect(h.mockArDrive.listPublicFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          folderId: expect.objectContaining({ id: FOLDER_ID }),
          maxDepth: Number.MAX_SAFE_INTEGER,
          includeRoot: false,
        })
      );
    });

    it('calls uploadPublicManifest with the EntityID-wrapped folder, the given name, and upsert conflict resolution', async () => {
      await invoke('drive:create-manifest', {
        driveId: DRIVE_ID,
        folderId: FOLDER_ID,
        manifestName: 'MySite.json',
      });

      expect(h.mockArDrive.uploadPublicManifest).toHaveBeenCalledWith({
        folderId: expect.objectContaining({ id: FOLDER_ID }),
        destManifestName: 'MySite.json',
        conflictResolution: 'upsert',
      });
    });

    it('defaults the manifest name to DriveManifest.json when none is supplied', async () => {
      await invoke('drive:create-manifest', { driveId: DRIVE_ID, folderId: FOLDER_ID });

      expect(h.mockArDrive.uploadPublicManifest).toHaveBeenCalledWith(
        expect.objectContaining({ destManifestName: 'DriveManifest.json' })
      );
    });

    it('returns the envelope with the manifest txId and the gateway-correct links, verbatim (no rewriting)', async () => {
      const res = (await invoke('drive:create-manifest', {
        driveId: DRIVE_ID,
        folderId: FOLDER_ID,
        manifestName: 'MySite.json',
      })) as {
        success: boolean;
        data: {
          manifestUrl: string;
          fileUrls: string[];
          txId: string;
          fileCount: number;
          manifestName: string;
        };
      };

      expect(res.success).toBe(true);
      expect(res.data.manifestUrl).toBe(links[0]);
      expect(res.data.fileUrls).toEqual(links.slice(1));
      expect(res.data.txId).toBe(manifestTxId);
      expect(res.data.fileCount).toBe(2); // 2 files, the folder is excluded
      expect(res.data.manifestName).toBe('MySite.json');

      // The load-bearing gateway assertion: turbo-gateway.com (the app's
      // configured default per src/main/gateway.ts), never arweave.net.
      expect(res.data.manifestUrl.startsWith(`https://${DEFAULT_GATEWAY_HOST}/`)).toBe(true);
      expect(res.data.manifestUrl).not.toContain('arweave.net');
    });

    it('records the manifest to upload history and pings the renderer to refresh', async () => {
      await invoke('drive:create-manifest', { driveId: DRIVE_ID, folderId: FOLDER_ID, manifestName: 'MySite.json' });

      expect(h.databaseManager.addUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          driveId: DRIVE_ID,
          fileName: 'MySite.json',
          status: 'completed',
          uploadMethod: 'turbo',
          dataTxId: manifestTxId,
          transactionId: manifestTxId,
        })
      );
    });
  });

  describe('private drive routing', () => {
    it('fails loudly (not a silent empty manifest) when the private drive key is not unlocked', async () => {
      h.walletManagerInstance.listDrives.mockResolvedValue([
        { id: DRIVE_ID, rootFolderId: OTHER_FOLDER_ID, privacy: 'private' },
      ]);
      h.driveKeyManagerMock.getDriveKey.mockReturnValue(undefined);

      const res = (await invoke('drive:create-manifest', {
        driveId: DRIVE_ID,
        folderId: OTHER_FOLDER_ID,
      })) as { success: boolean; error?: string };

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Private drive is locked/);
      expect(h.mockArDrive.listPrivateFolder).not.toHaveBeenCalled();
      expect(h.mockArDrive.uploadPublicManifest).not.toHaveBeenCalled();
    });

    it('routes to listPrivateFolder with the unlocked drive key when the drive is private', async () => {
      const fakeDriveKey = { key: 'derived-key-material' };
      h.walletManagerInstance.listDrives.mockResolvedValue([
        { id: DRIVE_ID, rootFolderId: OTHER_FOLDER_ID, privacy: 'private' },
      ]);
      h.driveKeyManagerMock.getDriveKey.mockReturnValue(fakeDriveKey);
      h.mockArDrive.listPrivateFolder.mockResolvedValue([publicFile('secret.txt')]);
      h.mockArDrive.uploadPublicManifest.mockResolvedValue({
        created: [{ dataTxId: 'TX_PRIV' }],
        links: [`https://${DEFAULT_GATEWAY_HOST}/TX_PRIV`, `https://${DEFAULT_GATEWAY_HOST}/TX_PRIV/secret.txt`],
        fees: {},
        manifest: { manifest: 'arweave/paths', version: '0.2.0', index: { path: 'secret.txt' }, paths: {} },
      });

      const res = (await invoke('drive:create-manifest', {
        driveId: DRIVE_ID,
        folderId: OTHER_FOLDER_ID,
      })) as { success: boolean };

      expect(h.mockArDrive.listPrivateFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          folderId: expect.objectContaining({ id: OTHER_FOLDER_ID }),
          driveKey: fakeDriveKey,
          includeRoot: false,
        })
      );
      expect(res.success).toBe(true);
      // Note: uploadPublicManifest is public-only in core-js (see
      // DownloadManager.ts:694/:1166 comments) — a "private manifest" still
      // publishes a PUBLIC path-manifest tx over the listed private-drive
      // entities. That's an existing core-js/app design constraint, not
      // something this handler controls; left as-is here, matching current
      // behavior.
    });
  });
});
