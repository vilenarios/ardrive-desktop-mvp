// UX-4: StorageTab must (a) clean up EVERY IPC listener it registers on
// unmount — including 'upload:progress', which previously leaked with no
// cleanup at all — and (b) do so with SCOPED removal, so tearing down
// StorageTab never clobbers another component subscribed to the same channel
// (e.g. App's sync monitor also listens on 'drive:update').
//
// The fake electronAPI here mimics the real preload contract: each on* returns
// a scoped disposer that removes ONLY the handler it registered. If StorageTab
// reverted to a channel-wide removeAllListeners, the co-subscriber assertion
// below would fail — and removeAllListeners no longer exists on the API to call.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StorageTab } from '../../../src/renderer/components/dashboard/StorageTab';
import { DriveInfo, AppConfig } from '../../../src/types';

// A minimal registry-backed IPC event bus with scoped disposers.
const registry = (() => {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const on = (channel: string) => (cb: (...a: unknown[]) => void) => {
    if (!handlers.has(channel)) handlers.set(channel, new Set());
    handlers.get(channel)!.add(cb);
    return () => {
      handlers.get(channel)?.delete(cb);
    };
  };
  const emit = (channel: string, ...args: unknown[]) => {
    [...(handlers.get(channel) ?? [])].forEach((cb) => cb(...args));
  };
  const count = (channel: string) => handlers.get(channel)?.size ?? 0;
  return { handlers, on, emit, count };
})();

const mockElectronAPI = {
  drive: {
    getPermawebFiles: vi.fn(async () => ({ success: true, data: [] })),
  },
  onSyncComplete: registry.on('sync:completed'),
  onUploadProgress: registry.on('upload:progress'),
  onFileStateChanged: registry.on('sync:file-state-changed'),
  onDriveUpdate: registry.on('drive:update'),
  onDriveMetadataUpdated: registry.on('drive:metadata-updated'),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

const drive: DriveInfo = {
  id: 'drive-1',
  name: 'Test Drive',
  privacy: 'public',
  rootFolderId: 'root-folder',
  dateCreated: Date.now(),
  size: 0,
};
const config = { syncFolder: '/sync/folder' } as AppConfig;

const renderTab = () =>
  render(<StorageTab drive={drive} config={config} syncStatus={null} onDriveDeleted={() => {}} />);

describe('StorageTab IPC listener lifecycle (UX-4)', () => {
  beforeEach(() => {
    registry.handlers.clear();
    vi.clearAllMocks();
    mockElectronAPI.drive.getPermawebFiles.mockResolvedValue({ success: true, data: [] });
  });

  it('cleans up its upload:progress listener on unmount (the former leak)', async () => {
    const { unmount } = renderTab();
    await screen.findByPlaceholderText('Search files and folders...');

    // Registered exactly one handler on the channel that used to leak.
    expect(registry.count('upload:progress')).toBe(1);

    unmount();

    // Cleanup ran — the handler is gone, no accumulation across remounts.
    expect(registry.count('upload:progress')).toBe(0);
  });

  it('disposes only its OWN handlers on unmount — a co-subscriber on the shared drive:update channel keeps firing', async () => {
    // Stand in for App's sync monitor: an independent subscriber on the same
    // channel, registered BEFORE StorageTab mounts.
    const coSubscriber = vi.fn();
    registry.on('drive:update')(coSubscriber);

    const { unmount } = renderTab();
    await screen.findByPlaceholderText('Search files and folders...');

    // StorageTab added its own drive:update handler alongside the co-subscriber.
    expect(registry.count('drive:update')).toBe(2);

    unmount();

    // StorageTab removed ONLY its own handler; the co-subscriber survives...
    expect(registry.count('drive:update')).toBe(1);

    // ...and still fires after StorageTab is gone (no clobber).
    registry.emit('drive:update');
    expect(coSubscriber).toHaveBeenCalledTimes(1);
  });

  it('cleans up all of its subscriptions on unmount (no leftover handlers on any channel)', async () => {
    const { unmount } = renderTab();
    await screen.findByPlaceholderText('Search files and folders...');

    expect(registry.count('sync:completed')).toBe(1);
    expect(registry.count('upload:progress')).toBe(1);
    expect(registry.count('sync:file-state-changed')).toBe(1);
    expect(registry.count('drive:update')).toBe(1);
    expect(registry.count('drive:metadata-updated')).toBe(1);

    unmount();

    expect(registry.count('sync:completed')).toBe(0);
    expect(registry.count('upload:progress')).toBe(0);
    expect(registry.count('sync:file-state-changed')).toBe(0);
    expect(registry.count('drive:update')).toBe(0);
    expect(registry.count('drive:metadata-updated')).toBe(0);
  });
});
