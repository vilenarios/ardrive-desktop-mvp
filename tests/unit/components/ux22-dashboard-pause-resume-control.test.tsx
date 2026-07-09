// UX-22: "No user control to pause/stop continuous sync." Dashboard used to
// show a read-only "Sync Paused" state with no way to reach it (the "Sync"
// button was a one-shot manual pass; preload had an unused channel). This
// proves the new Pause/Resume header control is reachable and wired to the
// SAME start/stop path the UX-30 tray uses — no new sync engine:
//   - it reflects the LIVE engine state (window.electronAPI.sync.getStatus(),
//     the same call the header's "Syncing/Paused" indicator already polls —
//     see tests/unit/components/ux28-sync-indicator-dashboard.test.tsx);
//   - clicking it while active calls sync.pause() (never sync.stop()/start()
//     directly — pausing must persist the choice, see the main.ts handler);
//   - clicking it while paused calls sync.resume();
//   - after a toggle, it re-polls sync.getStatus() and flips label/state to
//     match, without waiting for the next background poll tick.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- child component stubs (same set as ux28-sync-indicator-dashboard.test.tsx) ----
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: () => null,
}));
vi.mock('../../../src/renderer/components/CreateDriveModal', () => ({ CreateDriveModal: () => null }));
vi.mock('../../../src/renderer/components/AddExistingDriveModal', () => ({ AddExistingDriveModal: () => null }));
vi.mock('../../../src/renderer/components/UploadApprovalQueueModern', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/TurboCreditsManager', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/FileMetadataModal', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/UserMenu', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/WalletExport', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/ProfileSwitcher', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/Settings', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/SyncProgressDisplay', () => ({ SyncProgressDisplay: () => null }));
vi.mock('../../../src/renderer/components/dashboard/OverviewTab', () => ({ OverviewTab: () => <div>overview-panel-content</div> }));
vi.mock('../../../src/renderer/components/dashboard/ActivityTab', () => ({ ActivityTab: () => <div>activity-panel-content</div> }));
vi.mock('../../../src/renderer/components/dashboard/StorageTab', () => ({ StorageTab: () => <div>permaweb-panel-content</div> }));
vi.mock('../../../src/renderer/components/dashboard/DownloadQueueTab', () => ({ DownloadQueueTab: () => <div>download-queue-panel-content</div> }));
vi.mock('../../../src/renderer/components/common/TabNavigation', () => ({
  TabNavigation: () => <div />,
}));

const driveA = { id: 'drive-a-id', name: 'Drive A', privacy: 'public', rootFolderId: 'root-a', isLocked: false };

const mockElectronAPI = {
  drive: { getMapped: vi.fn(), listWithStatus: vi.fn(), switchTo: vi.fn() },
  uploads: { getPending: vi.fn() },
  files: { getDownloads: vi.fn(), getQueueStatus: vi.fn() },
  sync: { manual: vi.fn(), getStatus: vi.fn(), pause: vi.fn(), resume: vi.fn() },
  shell: { openPath: vi.fn() },
  wallet: { getInfo: vi.fn() },
  profiles: { list: vi.fn() },
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

describe('Dashboard pause/resume sync control (UX-22)', () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  const defaultProps = {
    config: { syncFolder: '/sync' } as any,
    walletInfo: { address: 'addr', balance: '1.0', walletType: 'arweave', turboBalance: '0.5' } as any,
    currentProfile: { id: 'p1', name: 'P1', address: 'addr' } as any,
    drive: driveA as any,
    syncStatus: null,
    syncProgress: null,
    uploads: [] as any[],
    onLogout: vi.fn(),
    onDriveDeleted: vi.fn(),
    toast,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.drive.getMapped.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.uploads.getPending.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.files.getDownloads.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({ success: true, data: { queued: 0, active: 0, total: 0 } });
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [] });
  });

  it('is disabled until the first sync.getStatus() poll resolves (no guessed state)', async () => {
    // Never resolves within this test's lifetime.
    mockElectronAPI.sync.getStatus.mockReturnValue(new Promise(() => {}));

    render(<Dashboard {...defaultProps} />);

    const button = screen.getByRole('button', { name: /resume|pause/i });
    expect(button).toBeDisabled();
  });

  it('shows "Pause" while the engine is active, and clicking it calls sync.pause() (never a raw stop/start)', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 5, uploadedFiles: 5, failedFiles: 0 },
    });
    mockElectronAPI.sync.pause.mockResolvedValue({ success: true, data: true });

    render(<Dashboard {...defaultProps} />);

    const button = await screen.findByRole('button', { name: 'Pause' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockElectronAPI.sync.pause).toHaveBeenCalledTimes(1);
    });
    expect(mockElectronAPI.sync.resume).not.toHaveBeenCalled();
  });

  it('shows "Resume" while the engine is paused, and clicking it calls sync.resume()', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: false, totalFiles: 5, uploadedFiles: 2, failedFiles: 0 },
    });
    mockElectronAPI.sync.resume.mockResolvedValue({ success: true, data: true });

    render(<Dashboard {...defaultProps} />);

    const button = await screen.findByRole('button', { name: 'Resume' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockElectronAPI.sync.resume).toHaveBeenCalledTimes(1);
    });
    expect(mockElectronAPI.sync.pause).not.toHaveBeenCalled();
  });

  it('re-polls status after a pause and flips its own label to "Resume" without waiting for the next background tick', async () => {
    mockElectronAPI.sync.getStatus
      .mockResolvedValueOnce({
        success: true,
        data: { isActive: true, totalFiles: 5, uploadedFiles: 5, failedFiles: 0 },
      })
      // The re-poll triggered by handleToggleSync's finally block.
      .mockResolvedValue({
        success: true,
        data: { isActive: false, totalFiles: 5, uploadedFiles: 5, failedFiles: 0 },
      });
    mockElectronAPI.sync.pause.mockResolvedValue({ success: true, data: true });

    render(<Dashboard {...defaultProps} />);

    const pauseButton = await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(pauseButton);

    await screen.findByRole('button', { name: 'Resume' });
    expect(toast.success).toHaveBeenCalledWith('Sync paused');
  });

  it('surfaces a toast and leaves the label unchanged when sync.pause() fails', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 5, uploadedFiles: 5, failedFiles: 0 },
    });
    mockElectronAPI.sync.pause.mockResolvedValue({ success: false, error: 'watcher teardown failed' });

    render(<Dashboard {...defaultProps} />);

    const button = await screen.findByRole('button', { name: 'Pause' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('watcher teardown failed'));
    });
    // Still active per the (unchanged) polled status — label stays "Pause".
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });
});
