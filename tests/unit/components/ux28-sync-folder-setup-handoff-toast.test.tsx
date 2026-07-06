// UX-28: hand-off toast when the sync-setup modal closes into a background
// download. Found by the UI-during-sync UAT (2026-07-05): SyncFolderSetup
// (the "sync an existing, already-selected drive" flow) navigates to the
// dashboard immediately and only starts the sync engine 100ms later in a
// bare setTimeout — completely silent, no "downloading in background" cue.
// sync.start() resolves only once the full-drive listing (and download
// queueing) is done, so the download queue's live total is already accurate
// the moment it resolves — these tests prove the toast fires with that real,
// live count (never a fabricated number), and stays silent when there's
// nothing to download.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SyncFolderSetup from '../../../src/renderer/components/SyncFolderSetup';

const drive = {
  id: 'drive-a-id',
  name: 'My Drive',
  privacy: 'public',
  rootFolderId: 'root-a',
  dateCreated: 0,
  size: 0,
} as any;

const mockElectronAPI = {
  dialog: { selectFolder: vi.fn() },
  sync: { setFolder: vi.fn(), start: vi.fn() },
  driveMappings: { add: vi.fn() },
  config: { markFirstRunComplete: vi.fn() },
  files: { getQueueStatus: vi.fn() },
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

describe('SyncFolderSetup background hand-off toast (UX-28)', () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const onSetupComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.dialog.selectFolder.mockResolvedValue({ success: true, data: '/home/tester/ArDriveSync' });
    mockElectronAPI.sync.setFolder.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.driveMappings.add.mockResolvedValue({ success: true, data: {} });
    mockElectronAPI.config.markFirstRunComplete.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.sync.start.mockResolvedValue({ success: true, data: true });
  });

  const chooseFolderAndStartSyncing = async () => {
    render(<SyncFolderSetup drive={drive} onSetupComplete={onSetupComplete} toast={toast} />);
    fireEvent.click(screen.getByText('Choose Folder'));
    await screen.findByText('/home/tester/ArDriveSync');
    fireEvent.click(screen.getByText('Start Syncing'));
    // Flush the synchronous part of handleSetup (folder + mapping setup)
    // within act() before the test moves on to the background hand-off.
    await waitFor(() => expect(mockElectronAPI.driveMappings.add).toHaveBeenCalled());
  };

  it('navigates to the dashboard immediately (hand-off is not blocked on sync.start)', async () => {
    await chooseFolderAndStartSyncing();
    await waitFor(() => expect(onSetupComplete).toHaveBeenCalled());
  });

  it('shows "Downloading N files in the background" once sync.start resolves, using the live queue total', async () => {
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({
      success: true,
      data: { queued: 2, active: 1, total: 3 },
    });

    await chooseFolderAndStartSyncing();

    await waitFor(() => expect(mockElectronAPI.sync.start).toHaveBeenCalled());
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Downloading 3 files in the background');
    });
  });

  it('singularizes "file" for exactly one queued/active download', async () => {
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({
      success: true,
      data: { queued: 1, active: 0, total: 1 },
    });

    await chooseFolderAndStartSyncing();

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('Downloading 1 file in the background');
    });
  });

  it('does not show a toast when there is nothing to download (e.g. an already-synced or empty drive)', async () => {
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({
      success: true,
      data: { queued: 0, active: 0, total: 0 },
    });

    await chooseFolderAndStartSyncing();

    await waitFor(() => expect(mockElectronAPI.files.getQueueStatus).toHaveBeenCalled());
    // Give the same microtask queue a chance to settle before asserting a negative.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('never throws or blocks the hand-off if the queue-status fetch fails', async () => {
    mockElectronAPI.files.getQueueStatus.mockRejectedValue(new Error('queue status unavailable'));

    await chooseFolderAndStartSyncing();

    await waitFor(() => expect(mockElectronAPI.sync.start).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
