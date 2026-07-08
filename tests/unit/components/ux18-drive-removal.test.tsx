// UX-18: the backend to remove a drive mapping has existed since day one
// (databaseManager.removeDriveMapping + the enveloped `drive-mappings:remove`
// IPC handler, main.ts:3193-3196 — D-005) but no product UI ever called it:
// `onDriveDeleted` plumbing (App -> Dashboard -> StorageTab) was wired but
// never invoked, and zero `driveMappings.remove` callers existed anywhere.
//
// This drives the REAL Dashboard (DriveSelector stubbed, matching the
// sibling dashboard-toasts.test.tsx suite's pattern — the actual remove
// button/label on DriveSelector is covered separately in
// ux18-drive-removal-selector.test.tsx) to prove the full
// confirm -> IPC -> refresh chain: opening the in-app confirm with honest,
// permanence-safe copy; cancelling doing nothing; confirming calling the
// existing removal IPC and refreshing the drive list; and the
// active-drive / last-drive edge handling (stop sync first, then hand off
// to another mapped drive or land in drive-setup).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- child component stubs -------------------------------------------------
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: (props: any) => (
    <div>
      <button onClick={() => props.onRemoveDrive('drive-a-id')}>stub-remove-active-drive</button>
      <button onClick={() => props.onRemoveDrive('other-drive-id')}>stub-remove-other-drive</button>
    </div>
  ),
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
vi.mock('../../../src/renderer/components/common/TabNavigation', () => ({ TabNavigation: () => null }));
vi.mock('../../../src/renderer/components/dashboard/OverviewTab', () => ({ OverviewTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/ActivityTab', () => ({ ActivityTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/StorageTab', () => ({ StorageTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/DownloadQueueTab', () => ({ DownloadQueueTab: () => null }));

// ---- electronAPI mock -------------------------------------------------------
const driveA = {
  id: 'drive-a-id',
  name: 'Drive A',
  privacy: 'public',
  rootFolderId: 'root-a',
  isLocked: false,
};
const otherDrive = {
  id: 'other-drive-id',
  name: 'Other Drive',
  privacy: 'public',
  rootFolderId: 'root-other',
  isLocked: false,
};
const mappingA = {
  id: 'mapping-a',
  driveId: 'drive-a-id',
  driveName: 'Drive A',
  drivePrivacy: 'public',
  localFolderPath: '/sync/a',
  rootFolderId: 'root-a',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const mappingOther = {
  id: 'mapping-other',
  driveId: 'other-drive-id',
  driveName: 'Other Drive',
  drivePrivacy: 'public',
  localFolderPath: '/sync/other',
  rootFolderId: 'root-other',
  isActive: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockElectronAPI = {
  drive: {
    getMapped: vi.fn(),
    listWithStatus: vi.fn(),
    switchTo: vi.fn(),
  },
  driveMappings: {
    list: vi.fn(),
    remove: vi.fn(),
  },
  uploads: {
    getPending: vi.fn(),
  },
  files: {
    getDownloads: vi.fn(),
    getQueueStatus: vi.fn(),
  },
  sync: {
    manual: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
  wallet: {
    getInfo: vi.fn(),
  },
  profiles: {
    list: vi.fn(),
  },
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });
// jsdom cannot navigate; Dashboard reloads after a successful drive switch.
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: vi.fn() },
  writable: true,
});

describe('UX-18: Dashboard drive-removal wiring', () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const onDriveDeleted = vi.fn();

  const defaultProps = {
    config: { syncFolder: '/sync' } as any,
    walletInfo: { address: 'addr', balance: '1.0', walletType: 'arweave', turboBalance: '0.5' } as any,
    currentProfile: { id: 'p1', name: 'P1', address: 'addr' } as any,
    drive: driveA as any,
    syncStatus: null,
    syncProgress: null,
    uploads: [] as any[],
    onLogout: vi.fn(),
    onDriveDeleted,
    toast,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.drive.getMapped.mockResolvedValue({ success: true, data: [driveA, otherDrive] });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [driveA, otherDrive] });
    mockElectronAPI.driveMappings.list.mockResolvedValue({ success: true, data: [mappingA, mappingOther] });
    mockElectronAPI.driveMappings.remove.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.sync.stop.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.sync.getStatus.mockResolvedValue({
      success: true,
      data: { isActive: false, totalFiles: 0, uploadedFiles: 0, failedFiles: 0, health: 'healthy' },
    });
    mockElectronAPI.uploads.getPending.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.files.getDownloads.mockResolvedValue([]);
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({ queued: 0, active: 0, total: 0 });
    mockElectronAPI.profiles.list.mockResolvedValue([]);
  });

  const renderDashboard = async () => {
    render(<Dashboard {...defaultProps} />);
    await waitFor(() => expect(mockElectronAPI.drive.getMapped).toHaveBeenCalled());
  };

  const confirmMessageText = () => document.getElementById('confirm-modal-message')?.textContent || '';

  it('clicking Remove opens the in-app confirm dialog with honest, permanence-safe copy', async () => {
    await renderDashboard();

    fireEvent.click(await screen.findByText('stub-remove-other-drive'));

    expect(await screen.findByText('Remove "Other Drive" from this device?')).toBeInTheDocument();
    const message = confirmMessageText();
    // Must say the data survives on Arweave...
    expect(message).toMatch(/does NOT delete.*Arweave/i);
    expect(message).toMatch(/permanent/i);
    // ...and must NOT say anything implying deletion of the user's files.
    expect(message.toLowerCase()).not.toMatch(/delete your files/);
    expect(mockElectronAPI.driveMappings.remove).not.toHaveBeenCalled();
  });

  it('cancelling the confirm does nothing — no IPC call, no toast, mapping untouched', async () => {
    await renderDashboard();

    fireEvent.click(await screen.findByText('stub-remove-other-drive'));
    await screen.findByText('Remove "Other Drive" from this device?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Remove "Other Drive" from this device?')).not.toBeInTheDocument();
    });
    expect(mockElectronAPI.driveMappings.remove).not.toHaveBeenCalled();
    expect(mockElectronAPI.sync.stop).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('confirming removal of a non-active drive calls the removal IPC, refreshes the list, and never touches sync', async () => {
    await renderDashboard();

    fireEvent.click(await screen.findByText('stub-remove-other-drive'));
    await screen.findByText('Remove "Other Drive" from this device?');
    fireEvent.click(screen.getByRole('button', { name: 'Remove drive' }));

    await waitFor(() => {
      // Resolves via the mapping's own id, not the ArFS driveId.
      expect(mockElectronAPI.driveMappings.remove).toHaveBeenCalledWith('mapping-other');
    });
    // Not the currently-syncing drive — no watcher to stop.
    expect(mockElectronAPI.sync.stop).not.toHaveBeenCalled();
    // Drive list refreshed after removal.
    expect(mockElectronAPI.drive.getMapped).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Arweave'));
    });
  });

  it('confirming removal of the currently-syncing drive stops sync first, then hands off to another remaining drive without a second confirm', async () => {
    // After removal, only otherDrive remains mapped.
    mockElectronAPI.drive.getMapped
      .mockResolvedValueOnce({ success: true, data: [driveA, otherDrive] })
      .mockResolvedValue({ success: true, data: [otherDrive] });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [otherDrive] });
    mockElectronAPI.drive.switchTo.mockResolvedValue({ success: true, data: otherDrive });

    await renderDashboard();

    fireEvent.click(await screen.findByText('stub-remove-active-drive'));
    await screen.findByText('Remove "Drive A" from this device?');
    fireEvent.click(screen.getByRole('button', { name: 'Remove drive' }));

    await waitFor(() => {
      expect(mockElectronAPI.sync.stop).toHaveBeenCalled();
    });
    expect(mockElectronAPI.driveMappings.remove).toHaveBeenCalledWith('mapping-a');

    // Hands off to the remaining drive WITHOUT a second "Switch to...?"
    // confirm — the user already confirmed the removal that triggers this.
    await waitFor(() => {
      expect(mockElectronAPI.drive.switchTo).toHaveBeenCalledWith('other-drive-id');
    });
    expect(screen.queryByText(/^Switch to /)).not.toBeInTheDocument();
    expect(onDriveDeleted).not.toHaveBeenCalled();
  });

  it('removing the last remaining drive stops sync and lands in drive-setup via onDriveDeleted', async () => {
    mockElectronAPI.drive.getMapped
      .mockResolvedValueOnce({ success: true, data: [driveA] })
      .mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.driveMappings.list.mockResolvedValue({ success: true, data: [mappingA] });

    await renderDashboard();

    fireEvent.click(await screen.findByText('stub-remove-active-drive'));
    await screen.findByText('Remove "Drive A" from this device?');
    fireEvent.click(screen.getByRole('button', { name: 'Remove drive' }));

    await waitFor(() => {
      expect(mockElectronAPI.sync.stop).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onDriveDeleted).toHaveBeenCalled();
    });
    expect(mockElectronAPI.drive.switchTo).not.toHaveBeenCalled();
  });
});
