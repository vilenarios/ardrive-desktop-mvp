// @vitest-environment node
//
// UX-4: the preload's event subscriptions (on*) must return a SCOPED disposer
// that removes ONLY the handler it registered (ipcRenderer.removeListener), so
// two independent subscribers on the SAME channel can coexist and clean up in
// isolation. Before the fix, cleanup went through channel-wide
// ipcRenderer.removeAllListeners(channel) helpers, so one subscriber's teardown
// silently killed every other subscriber on that channel (App vs
// TurboCreditsManager on 'wallet-info-updated', App vs StorageTab on
// 'drive:update', etc.). This suite drives the REAL preload against a fake
// ipcRenderer to prove the mechanism.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// A fake ipcRenderer that tracks handlers per channel exactly like Electron's
// EventEmitter would, so we can assert which handlers survive a disposer call.
const mock = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  const removeAllListeners = vi.fn((channel: string) => {
    handlers.delete(channel);
  });
  const ipcRenderer = {
    on(channel: string, handler: (...a: unknown[]) => void) {
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel)!.push(handler);
    },
    removeListener(channel: string, handler: (...a: unknown[]) => void) {
      const list = handlers.get(channel);
      if (!list) return;
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    },
    removeAllListeners,
    invoke: vi.fn(() => Promise.resolve()),
  };
  let exposed: Record<string, unknown> | undefined;
  const contextBridge = {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      exposed = api;
    },
  };
  const emit = (channel: string, ...args: unknown[]) => {
    [...(handlers.get(channel) ?? [])].forEach((h) => h({}, ...args));
  };
  const count = (channel: string) => handlers.get(channel)?.length ?? 0;
  return { handlers, removeAllListeners, ipcRenderer, contextBridge, emit, count, getApi: () => exposed };
});

vi.mock('electron', () => ({ ipcRenderer: mock.ipcRenderer, contextBridge: mock.contextBridge }));

// Importing the preload runs contextBridge.exposeInMainWorld(api); capture it.
import '../../../src/main/preload';

const api = mock.getApi() as {
  onWalletInfoUpdated: (cb: (info: unknown) => void) => () => void;
  onUploadProgress: (cb: (data: unknown) => void) => () => void;
  onDriveUpdate: (cb: () => void) => () => void;
  payment: { onPaymentCompleted: (cb: () => void) => () => void };
} & Record<string, unknown>;

describe('preload IPC listener lifecycle (UX-4)', () => {
  beforeEach(() => {
    mock.handlers.clear();
    mock.removeAllListeners.mockClear();
  });

  it('on* returns a scoped disposer; disposing one subscriber leaves a co-subscriber on the same channel firing', () => {
    const a = vi.fn();
    const b = vi.fn();

    // Two independent subscribers on the SAME channel (as App and
    // TurboCreditsManager both do for 'wallet-info-updated').
    const disposeA = api.onWalletInfoUpdated(a);
    api.onWalletInfoUpdated(b);
    expect(mock.count('wallet-info-updated')).toBe(2);

    // Both fire before any teardown.
    mock.emit('wallet-info-updated', { balance: '1' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    // Subscriber A tears down — via its OWN scoped disposer.
    disposeA();

    // Only A was removed; B's subscription is untouched.
    expect(mock.count('wallet-info-updated')).toBe(1);
    mock.emit('wallet-info-updated', { balance: '2' });
    expect(a).toHaveBeenCalledTimes(1); // did NOT fire again
    expect(b).toHaveBeenCalledTimes(2); // co-subscriber still alive

    // Crucially, the disposer used scoped removeListener, never the
    // channel-wide removeAllListeners that caused the original clobber.
    expect(mock.removeAllListeners).not.toHaveBeenCalled();
  });

  it('scoped disposal works the same on other shared channels (upload:progress, drive:update, payment-completed)', () => {
    const appUpload = vi.fn();
    const queueUpload = vi.fn();
    const disposeApp = api.onUploadProgress(appUpload);
    api.onUploadProgress(queueUpload);

    const appDrive = vi.fn();
    const storageDrive = vi.fn();
    api.onDriveUpdate(appDrive);
    const disposeStorage = api.onDriveUpdate(storageDrive);

    const pay = vi.fn();
    const disposePay = api.payment.onPaymentCompleted(pay);

    disposeApp();
    disposeStorage();
    disposePay();

    // The survivors on each shared channel are exactly the ones NOT disposed.
    mock.emit('upload:progress', { uploadId: 'x' });
    mock.emit('drive:update');
    mock.emit('payment-completed');

    expect(appUpload).not.toHaveBeenCalled();
    expect(queueUpload).toHaveBeenCalledTimes(1);
    expect(storageDrive).not.toHaveBeenCalled();
    expect(appDrive).toHaveBeenCalledTimes(1);
    expect(pay).not.toHaveBeenCalled();
    expect(mock.removeAllListeners).not.toHaveBeenCalled();
  });

  it('no channel-clobbering remove helpers survive on the preload surface', () => {
    // The old footguns must be gone: nothing may nuke a whole channel.
    expect((api as Record<string, unknown>).removeAllListeners).toBeUndefined();
    expect((api as Record<string, unknown>).removeWalletInfoUpdatedListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeSyncProgressListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeUploadProgressListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeDriveUpdateListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeDriveMetadataUpdatedListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeFileStateChangedListener).toBeUndefined();
    expect((api as Record<string, unknown>).removeDownloadProgressListener).toBeUndefined();
    const payment = (api as Record<string, unknown>).payment as Record<string, unknown>;
    expect(payment.removePaymentCompletedListener).toBeUndefined();
    expect(payment.removePaymentCancelledListener).toBeUndefined();
  });
});
