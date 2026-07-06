// UX-28: proves the persistent header sync indicator sources LIVE state
// through Dashboard — window.electronAPI.sync.getStatus() (the same call
// UX-30's tray polls) combined with the download-queue's live total (the
// same count the Download Queue tab badge already shows) — and that it
// stays visible in the header regardless of which tab is active, since the
// header renders once, outside the per-tab content (unlike the old gap where
// overall progress was ONLY visible on the Download Queue tab).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- child component stubs -------------------------------------------------
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

// A minimal, real tab bar so switching tabs is actually exercised (unlike
// most Dashboard suites, which stub TabNavigation to null).
vi.mock('../../../src/renderer/components/common/TabNavigation', () => ({
  TabNavigation: (props: any) => (
    <div>
      {props.tabs.map((tab: any) => (
        <button key={tab.id} onClick={() => props.onTabChange(tab.id)}>
          tab-{tab.id}
        </button>
      ))}
    </div>
  ),
}));

// ---- electronAPI mock -------------------------------------------------------
const driveA = { id: 'drive-a-id', name: 'Drive A', privacy: 'public', rootFolderId: 'root-a', isLocked: false };

const mockElectronAPI = {
  drive: { getMapped: vi.fn(), listWithStatus: vi.fn(), switchTo: vi.fn() },
  uploads: { getPending: vi.fn() },
  files: { getDownloads: vi.fn(), getQueueStatus: vi.fn() },
  sync: { manual: vi.fn(), getStatus: vi.fn() },
  shell: { openPath: vi.fn() },
  wallet: { getInfo: vi.fn() },
  profiles: { list: vi.fn() },
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

describe('Dashboard header sync indicator (UX-28)', () => {
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

  it('shows "Syncing N files…" during an active sync, with N from the live sync.getStatus() state', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 10, uploadedFiles: 4, failedFiles: 0 },
    });

    render(<Dashboard {...defaultProps} />);

    // 10 total - 4 uploaded = 6 pending, no downloads queued.
    await waitFor(() => {
      expect(screen.getByText('Syncing 6 files…')).toBeInTheDocument();
    });
  });

  it('adds the live download-queue count into the same "Syncing N files…" total', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 2, uploadedFiles: 2, failedFiles: 0 },
    });
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({
      success: true,
      data: { queued: 3, active: 1, total: 4 },
    });

    render(<Dashboard {...defaultProps} />);

    // 0 upload-pending + 4 downloading/queued = 4.
    await waitFor(() => {
      expect(screen.getByText('Syncing 4 files…')).toBeInTheDocument();
    });
  });

  it('shows "Up to date" when idle (active engine, nothing pending)', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 5, uploadedFiles: 5, failedFiles: 0 },
    });

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Up to date')).toBeInTheDocument();
    });
  });

  it('shows "Paused" when the sync engine is not active', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: false, totalFiles: 5, uploadedFiles: 2, failedFiles: 0 },
    });

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });
  });

  it('stays visible in the header regardless of which dashboard tab is active', async () => {
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: true, totalFiles: 8, uploadedFiles: 3, failedFiles: 0 },
    });

    render(<Dashboard {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Syncing 5 files…')).toBeInTheDocument();
    });

    // Switch away from the default Overview tab — before UX-28 this was
    // exactly the gap: overall progress was only visible on the Download
    // Queue tab, and every other tab (including Overview) showed nothing.
    fireEvent.click(screen.getByText('tab-activity'));
    await waitFor(() => {
      expect(screen.getByText('activity-panel-content')).toBeInTheDocument();
    });
    expect(screen.getByText('Syncing 5 files…')).toBeInTheDocument();

    fireEvent.click(screen.getByText('tab-download-queue'));
    await waitFor(() => {
      expect(screen.getByText('download-queue-panel-content')).toBeInTheDocument();
    });
    expect(screen.getByText('Syncing 5 files…')).toBeInTheDocument();
  });
});
