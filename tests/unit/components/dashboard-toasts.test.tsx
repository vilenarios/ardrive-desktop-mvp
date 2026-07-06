// UX-1: Dashboard's user feedback goes through its `toast` prop. These tests
// exercise the toast-emitting flows (drive switch failure/success, sync
// completion/failure, drive creation) with the prop provided — the companion
// suite app-toast-wiring.test.tsx proves App actually passes the prop.
//
// Heavy child components are stubbed; stubs expose buttons wired to the props
// Dashboard hands them, so the flows are driven through Dashboard's real code.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- child component stubs -------------------------------------------------
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: (props: any) => (
    <button onClick={() => props.onDriveSelect('other-drive-id')}>stub-switch-drive</button>
  ),
}));
vi.mock('../../../src/renderer/components/CreateDriveModal', () => ({
  CreateDriveModal: (props: any) => (
    <button
      onClick={() =>
        props.onDriveCreated({
          id: 'new-drive-id',
          name: 'New Drive',
          privacy: 'public',
          rootFolderId: 'root-new',
        })
      }
    >
      stub-create-drive
    </button>
  ),
}));
vi.mock('../../../src/renderer/components/AddExistingDriveModal', () => ({
  AddExistingDriveModal: () => null,
}));
vi.mock('../../../src/renderer/components/UploadApprovalQueueModern', () => ({
  default: () => null,
}));
vi.mock('../../../src/renderer/components/TurboCreditsManager', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/FileMetadataModal', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/UserMenu', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/WalletExport', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/ProfileSwitcher', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/Settings', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/SyncProgressDisplay', () => ({
  SyncProgressDisplay: () => null,
}));
vi.mock('../../../src/renderer/components/common/TabNavigation', () => ({
  TabNavigation: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/OverviewTab', () => ({
  OverviewTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/ActivityTab', () => ({
  ActivityTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/StorageTab', () => ({
  StorageTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/DownloadQueueTab', () => ({
  DownloadQueueTab: () => null,
}));

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

const mockElectronAPI = {
  drive: {
    getMapped: vi.fn(),
    listWithStatus: vi.fn(),
    switchTo: vi.fn(),
  },
  uploads: {
    getPending: vi.fn(),
    approve: vi.fn(),
    approveAll: vi.fn(),
    reject: vi.fn(),
    rejectAll: vi.fn(),
  },
  files: {
    getDownloads: vi.fn(),
    getQueueStatus: vi.fn(),
  },
  sync: {
    manual: vi.fn(),
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

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// jsdom cannot navigate; Dashboard reloads after a successful drive switch
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: vi.fn() },
  writable: true,
});

describe('Dashboard toast feedback (UX-1)', () => {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  const defaultProps = {
    config: { syncFolder: '/sync' } as any,
    walletInfo: {
      address: 'addr',
      balance: '1.0',
      walletType: 'arweave',
      turboBalance: '0.5',
    } as any,
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
    // UX-3: both drive:getMapped and drive:listWithStatus return the {success,
    // data} envelope. (The legacy-raw-array test below overrides listWithStatus
    // to exercise the defensive fallback that survives the migration.)
    mockElectronAPI.drive.getMapped.mockResolvedValue({
      success: true,
      data: [driveA, otherDrive],
    });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({
      success: true,
      data: [driveA, otherDrive],
    });
    mockElectronAPI.uploads.getPending.mockResolvedValue({ success: true, data: [] }); // UX-3: enveloped
    mockElectronAPI.files.getDownloads.mockResolvedValue([]);
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({ queued: 0, active: 0, total: 0 });
    mockElectronAPI.profiles.list.mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  const renderDashboard = async () => {
    render(<Dashboard {...defaultProps} />);
    // Wait for the mount-time drive load so the switch flow can find its target
    await waitFor(() => {
      expect(mockElectronAPI.drive.getMapped).toHaveBeenCalled();
    });
  };

  // UX-9: drive switching now shows the in-app ConfirmModal (not window.confirm).
  // Click its "Switch" button to proceed past the confirmation.
  const confirmSwitch = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Switch' }));
  };

  it('shows an error toast when a drive switch fails', async () => {
    mockElectronAPI.drive.switchTo.mockRejectedValue(new Error('switch blew up'));

    await renderDashboard();
    fireEvent.click(await screen.findByText('stub-switch-drive'));
    await confirmSwitch();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to switch to "Other Drive"')
      );
    });
  });

  it('shows info and success toasts for a successful drive switch', async () => {
    // UX-3: switchTo returns the switched-to drive in the envelope `data` field.
    mockElectronAPI.drive.switchTo.mockResolvedValue({
      success: true,
      data: { name: 'Other Drive' },
    });

    await renderDashboard();
    fireEvent.click(await screen.findByText('stub-switch-drive'));
    await confirmSwitch();

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('Switching to "Other Drive"'));
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Successfully switched to "Other Drive"')
      );
    });
  });

  it('shows a success toast when manual sync completes', async () => {
    mockElectronAPI.sync.manual.mockResolvedValue({ success: true });

    await renderDashboard();
    fireEvent.click(screen.getByText('Sync'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Sync completed successfully!');
    });
  });

  it('shows an error toast when manual sync fails', async () => {
    mockElectronAPI.sync.manual.mockResolvedValue({
      success: false,
      error: 'Network unreachable',
    });

    await renderDashboard();
    fireEvent.click(screen.getByText('Sync'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Sync failed: Network unreachable');
    });
  });

  it('shows a success toast when a drive is created', async () => {
    await renderDashboard();
    fireEvent.click(screen.getByText('stub-create-drive'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Drive "New Drive" created successfully!');
    });
  });

  it('does not fire a false error toast on mount with real handler shapes', async () => {
    // Regression guard (qa-gate finding): wiring the toast prop surfaced a
    // false "Failed to load drives" toast on every mount because loadDrives
    // called .find() on the {success, data} wrapper.
    await renderDashboard();

    // Let the mount-time loads settle
    await waitFor(() => {
      expect(mockElectronAPI.drive.listWithStatus).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still loads the drive list when listWithStatus returns a raw array (legacy shape)', async () => {
    // Defensive fallback: extractDrivesWithStatus still tolerates a raw array
    // even though the migrated handler returns an envelope.
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([driveA, otherDrive]);
    mockElectronAPI.drive.switchTo.mockResolvedValue({
      success: true,
      data: { name: 'Other Drive' },
    });

    await renderDashboard();
    fireEvent.click(await screen.findByText('stub-switch-drive'));
    await confirmSwitch();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Successfully switched to "Other Drive"')
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
