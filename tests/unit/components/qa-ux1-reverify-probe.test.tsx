// ============================================================================
// QA-GATE ARTIFACT (UX-1 re-verification, commit 698316f) — NOT PRODUCT CODE.
// DISCARD AFTER REVIEW.
// Re-runs the original FAIL-verdict probes against the fixed Dashboard with
// the REAL IPC handler shapes (drive:listWithStatus -> {success,data} envelope,
// drive:getMapped -> raw array), plus a {success:false} degradation probe.
// ============================================================================
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: (props: any) => (
    <div>
      <button onClick={() => props.onDriveSelect('other-drive-id')}>stub-switch-drive</button>
      <div>drives-count:{props.drives.length}</div>
    </div>
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
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: vi.fn() },
  writable: true,
});

describe('QA re-verify probe: Dashboard toasts with REAL IPC shapes (698316f)', () => {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };

  const defaultProps = {
    config: { syncFolder: '/sync' } as any,
    walletInfo: { address: 'addr', balance: '1.0', walletType: 'arweave' } as any,
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
    // REAL shapes
    mockElectronAPI.drive.getMapped.mockResolvedValue([driveA, otherDrive]);
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({
      success: true,
      data: [driveA, otherDrive],
    });
    mockElectronAPI.uploads.getPending.mockResolvedValue([]);
    mockElectronAPI.files.getDownloads.mockResolvedValue([]);
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({ queued: 0, active: 0, total: 0 });
    mockElectronAPI.profiles.list.mockResolvedValue([{ id: 'p1', name: 'P1', address: 'addr' }]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('PROBE 1 (was: false error toast on mount): mount is clean and drives populate', async () => {
    render(<Dashboard {...defaultProps} />);
    await screen.findByText('drives-count:2');
    await new Promise((r) => setTimeout(r, 50));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('PROBE 2 (was: creation toast unreachable): creation toast fires with real envelope', async () => {
    render(<Dashboard {...defaultProps} />);
    await screen.findByText('drives-count:2');

    fireEvent.click(screen.getByText('stub-create-drive'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Drive "New Drive" created successfully!');
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('PROBE 3: sync completion toast fires with real sync:manual shape', async () => {
    mockElectronAPI.sync.manual.mockResolvedValue({ success: true, message: 'Manual sync completed' });
    render(<Dashboard {...defaultProps} />);
    await screen.findByText('drives-count:2');

    fireEvent.click(screen.getByText('Sync'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Sync completed successfully!');
    });
  });

  it('PROBE 4 (was: switch unreachable): switch FAILURE toast fires with real shapes', async () => {
    mockElectronAPI.drive.switchTo.mockRejectedValue(new Error('switch blew up'));
    render(<Dashboard {...defaultProps} />);
    await screen.findByText('drives-count:2');

    fireEvent.click(screen.getByText('stub-switch-drive'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to switch to "Other Drive"')
      );
    });
    expect(mockElectronAPI.drive.switchTo).toHaveBeenCalledWith('other-drive-id');
  });

  it('PROBE 5 (new): listWithStatus {success:false} degrades gracefully — no crash, no false toast, drives still usable', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({
      success: false,
      error: 'network down',
    });
    mockElectronAPI.drive.switchTo.mockRejectedValue(new Error('boom'));

    render(<Dashboard {...defaultProps} />);
    // drives still populate from getMapped (status info degraded to defaults)
    await screen.findByText('drives-count:2');
    await new Promise((r) => setTimeout(r, 50));
    expect(toast.error).not.toHaveBeenCalled();

    // and the switch-failure toast is still reachable
    fireEvent.click(screen.getByText('stub-switch-drive'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to switch to "Other Drive"')
      );
    });
  });
});
