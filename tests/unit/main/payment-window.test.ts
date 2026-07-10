// @vitest-environment node
//
// MONEY-7: behavioral tests for the hardened `payment:open-window` IPC
// handler in main.ts. The Electron BrowserWindow + webContents are mocked so
// no real payment window ever opens and no checkout is ever completed — every
// navigation / redirect / close is simulated. Nothing here spends money.
//
// The handler is captured from the mocked ipcMain.handle and invoked directly;
// the payment window it creates is grabbed from the mock's instance list, and
// its navigation/close events are driven manually. Assertions cover:
//   1. host pinning: navigation to a non-checkout host is blocked, same-host
//      nav is allowed, and a loose `success` substring on the checkout host is
//      NOT treated as completion;
//   2. success: a will-redirect / did-navigate to the EXACT success URL fires
//      exactly one 'payment-completed' and triggers a wallet balance refresh;
//   3. cancel: 'closed' before success fires exactly one 'payment-cancelled'
//      and does NOT refresh the balance;
//   4. once-guard: 'closed' AFTER a success fires no second/cancel event.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  class MockWebContents {
    private listeners = new Map<string, Array<(...a: unknown[]) => unknown>>();
    send = vi.fn();
    setWindowOpenHandler = vi.fn();
    openDevTools = vi.fn();
    executeJavaScript = vi.fn().mockResolvedValue(undefined);
    getURL = vi.fn().mockResolvedValue('');
    on = vi.fn((event: string, cb: (...a: unknown[]) => unknown) => {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
      return this;
    });
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
  }

  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    options: Record<string, unknown>;
    webContents = new MockWebContents();
    private winListeners = new Map<string, Array<(...a: unknown[]) => unknown>>();
    loadURL = vi.fn().mockResolvedValue(undefined);
    loadFile = vi.fn().mockResolvedValue(undefined);
    once = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    close = vi.fn();
    isDestroyed = vi.fn(() => false);
    on = vi.fn((event: string, cb: (...a: unknown[]) => unknown) => {
      const arr = this.winListeners.get(event) ?? [];
      arr.push(cb);
      this.winListeners.set(event, arr);
      return this;
    });
    emitWin(event: string, ...args: unknown[]) {
      for (const cb of this.winListeners.get(event) ?? []) cb(...args);
    }
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      MockBrowserWindow.instances.push(this);
    }
    static getAllWindows = vi.fn(() => MockBrowserWindow.instances);
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
      balance: '1.5',
      walletType: 'arweave',
    }),
  };

  const syncManagerInstance = {
    addToUploadQueue: vi.fn(),
    setArDrive: vi.fn(),
    setSyncFolder: vi.fn(),
    startSync: vi.fn().mockResolvedValue(true),
    // MONEY-17: the payment-completed handler fires this post-top-up to resume
    // funds-blocked uploads. Best-effort in production; stubbed here.
    resumeUploadsBlockedOnFunds: vi.fn().mockResolvedValue(0),
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

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3';
const SUCCESS_URL = 'https://app.ardrive.io';

const invoke = (channel: string, ...args: unknown[]) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(null, ...args);
};

// The main window is the first BrowserWindow created during app init; its
// webContents.send is where completion/cancel events are dispatched.
const mainWin = () => h.MockBrowserWindow.instances[0];
// The payment window is the most recently created BrowserWindow.
const lastWin = () => h.MockBrowserWindow.instances[h.MockBrowserWindow.instances.length - 1];
const sentEvents = () => mainWin().webContents.send.mock.calls.map((c) => c[0] as string);
const fakeNavEvent = () => ({ preventDefault: vi.fn() });

beforeAll(async () => {
  await import('../../../src/main/main');
  await vi.waitFor(() => {
    if (!h.handlers.has('payment:open-window')) {
      throw new Error('payment:open-window handler not registered yet');
    }
  });
  // A main window must have been created during init.
  expect(h.MockBrowserWindow.instances.length).toBeGreaterThanOrEqual(1);
});

beforeEach(() => {
  mainWin().webContents.send.mockClear();
  h.walletManagerInstance.getWalletInfo.mockClear();
});

describe('payment:open-window — validation & envelope (MONEY-7)', () => {
  it('rejects a non-HTTPS URL with a {success:false} envelope and opens no window', async () => {
    const before = h.MockBrowserWindow.instances.length;
    const res = (await invoke('payment:open-window', 'http://checkout.stripe.com/x')) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/HTTPS/i);
    expect(h.MockBrowserWindow.instances.length).toBe(before); // no window created
  });

  it('opens a sandboxed, popup-denying window and returns {success:true}', async () => {
    const res = (await invoke('payment:open-window', CHECKOUT_URL)) as { success: boolean };
    expect(res).toEqual({ success: true });

    const pw = lastWin();
    // sandbox: true on the payment window
    const webPrefs = (pw.options.webPreferences ?? {}) as Record<string, unknown>;
    expect(webPrefs.sandbox).toBe(true);
    // popups denied
    expect(pw.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const openHandler = pw.webContents.setWindowOpenHandler.mock.calls[0][0] as () => unknown;
    expect(openHandler()).toEqual({ action: 'deny' });
    // the checkout URL was actually loaded
    expect(pw.loadURL).toHaveBeenCalledWith(CHECKOUT_URL);
  });
});

describe('payment:open-window — host pinning (MONEY-7)', () => {
  it('blocks navigation to a non-checkout host and fires no event', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    const evt = fakeNavEvent();
    pw.webContents.emit('will-navigate', evt, 'https://evil.example.com/phish');
    expect(evt.preventDefault).toHaveBeenCalledTimes(1);

    // a server redirect to another origin is blocked the same way
    const evt2 = fakeNavEvent();
    pw.webContents.emit('will-redirect', evt2, 'https://phish.stripe.com.evil.io/');
    expect(evt2.preventDefault).toHaveBeenCalledTimes(1);

    expect(sentEvents()).not.toContain('payment-completed');
    expect(sentEvents()).not.toContain('payment-cancelled');
  });

  it('allows navigation within the exact checkout host', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    const evt = fakeNavEvent();
    pw.webContents.emit('will-navigate', evt, 'https://checkout.stripe.com/c/pay/step-2');
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('does NOT treat a `success` substring on the checkout host as completion (exact match only)', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    const evt = fakeNavEvent();
    pw.webContents.emit('will-navigate', evt, 'https://checkout.stripe.com/pay?status=success');
    // same host → allowed, NOT prevented
    expect(evt.preventDefault).not.toHaveBeenCalled();
    // and definitely not a completion
    expect(sentEvents()).not.toContain('payment-completed');
    expect(h.walletManagerInstance.getWalletInfo).not.toHaveBeenCalled();
  });
});

describe('payment:open-window — success detection (MONEY-7)', () => {
  it('fires exactly ONE payment-completed on a will-redirect to the EXACT success URL and refreshes the balance', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    const evt = fakeNavEvent();
    // trailing slash — normalized to an exact match
    pw.webContents.emit('will-redirect', evt, `${SUCCESS_URL}/`);

    expect(evt.preventDefault).toHaveBeenCalled(); // success page not rendered
    expect(sentEvents().filter((e) => e === 'payment-completed')).toHaveLength(1);
    expect(pw.close).toHaveBeenCalledTimes(1);
    // balance refresh on the success path
    expect(h.walletManagerInstance.getWalletInfo).toHaveBeenCalledTimes(1);
    // no cancel
    expect(sentEvents()).not.toContain('payment-cancelled');
  });

  it('detects success via did-navigate too (belt), with a query string, exactly once', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    pw.webContents.emit('did-navigate', {}, `${SUCCESS_URL}/?session_id=cs_test_x`);

    expect(sentEvents().filter((e) => e === 'payment-completed')).toHaveLength(1);
    expect(h.walletManagerInstance.getWalletInfo).toHaveBeenCalledTimes(1);
  });
});

describe('payment:open-window — cancel & once-guard (MONEY-7)', () => {
  it('fires exactly ONE payment-cancelled when the window is closed before success (no balance refresh)', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    pw.emitWin('closed');

    expect(sentEvents().filter((e) => e === 'payment-cancelled')).toHaveLength(1);
    expect(sentEvents()).not.toContain('payment-completed');
    // cancel must not refresh the balance
    expect(h.walletManagerInstance.getWalletInfo).not.toHaveBeenCalled();
  });

  it('does NOT fire a cancel when the window closes AFTER a success (once-guard: exactly one success, never both)', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    // complete first
    const evt = fakeNavEvent();
    pw.webContents.emit('will-redirect', evt, SUCCESS_URL);
    // then the window closes (our own close() + OS both surface as 'closed')
    pw.emitWin('closed');

    const events = sentEvents();
    expect(events.filter((e) => e === 'payment-completed')).toHaveLength(1);
    expect(events).not.toContain('payment-cancelled');
  });

  it('a second success signal after the first is a no-op (exactly one event total)', async () => {
    await invoke('payment:open-window', CHECKOUT_URL);
    const pw = lastWin();

    pw.webContents.emit('will-redirect', fakeNavEvent(), SUCCESS_URL);
    pw.webContents.emit('will-navigate', fakeNavEvent(), `${SUCCESS_URL}/`);
    pw.webContents.emit('did-navigate', {}, SUCCESS_URL);

    expect(sentEvents().filter((e) => e === 'payment-completed')).toHaveLength(1);
  });
});
