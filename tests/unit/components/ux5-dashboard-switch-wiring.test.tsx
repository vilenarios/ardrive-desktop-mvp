// UX-5: the profile-switch action must actually run through the header. This
// renders the REAL Dashboard with the REAL UserMenu and REAL ProfileSwitcher
// (only the heavy tabs/modals are stubbed) and drives the full chain:
// UserMenu "Switch Profile" -> ProfileSwitcher -> profiles.switch() ->
// Dashboard's onProfileSwitch handler -> onProfileSwitched (App's refresh).
// It also proves "Add Profile" reaches Dashboard's onAddProfile prop instead of
// reloading the window (the old add-profile reload loop).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- heavy child stubs (UserMenu + ProfileSwitcher are intentionally REAL) --
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: () => null,
}));
vi.mock('../../../src/renderer/components/CreateDriveModal', () => ({ CreateDriveModal: () => null }));
vi.mock('../../../src/renderer/components/AddExistingDriveModal', () => ({ AddExistingDriveModal: () => null }));
vi.mock('../../../src/renderer/components/UploadApprovalQueueModern', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/TurboCreditsManager', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/FileMetadataModal', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/WalletExport', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/Settings', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/SyncProgressDisplay', () => ({ SyncProgressDisplay: () => null }));
vi.mock('../../../src/renderer/components/common/TabNavigation', () => ({ TabNavigation: () => null }));
vi.mock('../../../src/renderer/components/dashboard/OverviewTab', () => ({ OverviewTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/ActivityTab', () => ({ ActivityTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/StorageTab', () => ({ StorageTab: () => null }));
vi.mock('../../../src/renderer/components/dashboard/DownloadQueueTab', () => ({ DownloadQueueTab: () => null }));

// ---- electronAPI mock -------------------------------------------------------
const driveA = { id: 'drive-a', name: 'Alice Drive', privacy: 'public', rootFolderId: 'root-a', isLocked: false };
const profileA = { id: 'a', name: 'Alice', address: 'addr-alice-0000000000' };
const profileB = { id: 'b', name: 'Bob', address: 'addr-bob-1111111111' };

const mockElectronAPI = {
  drive: { getMapped: vi.fn(), listWithStatus: vi.fn(), switchTo: vi.fn() },
  uploads: { getPending: vi.fn() },
  files: { getDownloads: vi.fn(), getQueueStatus: vi.fn() },
  sync: { manual: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  wallet: { getInfo: vi.fn() },
  turbo: { getStatus: vi.fn() },
  profiles: { list: vi.fn(), switch: vi.fn() },
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: vi.fn() },
  writable: true,
});

describe('Dashboard profile-switch wiring (UX-5)', () => {
  const onProfileSwitched = vi.fn();
  const onAddProfile = vi.fn();

  const defaultProps = {
    config: { syncFolder: '/sync' } as any,
    walletInfo: { address: 'addr-alice-0000000000', balance: '1.0', walletType: 'arweave', turboBalance: '0.5' } as any,
    currentProfile: profileA as any,
    drive: driveA as any,
    syncStatus: null,
    syncProgress: null,
    uploads: [] as any[],
    onLogout: vi.fn(),
    onDriveDeleted: vi.fn(),
    onProfileSwitched,
    onAddProfile,
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.drive.getMapped.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.uploads.getPending.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.files.getDownloads.mockResolvedValue([]);
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({ queued: 0, active: 0, total: 0 });
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [profileA, profileB] });
    mockElectronAPI.wallet.getInfo.mockResolvedValue({ success: true, data: defaultProps.walletInfo });
  });

  const renderDashboard = async () => {
    render(<Dashboard {...defaultProps} />);
    await waitFor(() => expect(mockElectronAPI.drive.getMapped).toHaveBeenCalled());
  };

  // Open the ProfileSwitcher via the header UserMenu's "Switch Profile" item.
  const openProfileSwitcherViaUserMenu = async () => {
    fireEvent.click(document.querySelector('.user-menu-trigger') as HTMLElement);
    fireEvent.click(await screen.findByText(/Switch Profile/));
    // ProfileSwitcher's own trigger now exists.
    await waitFor(() => expect(document.querySelector('.profile-trigger')).not.toBeNull());
  };

  it('UserMenu "Switch Profile" -> ProfileSwitcher -> profiles.switch + onProfileSwitched', async () => {
    mockElectronAPI.profiles.switch.mockResolvedValue({ success: true, data: true });

    await renderDashboard();
    await openProfileSwitcherViaUserMenu();

    // Open the switcher dropdown and pick Bob.
    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement);
    fireEvent.click(await screen.findByText('Bob'));

    // Password prompt -> submit.
    fireEvent.change(await screen.findByPlaceholderText('Enter password'), { target: { value: 'bob-pw' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => {
      expect(mockElectronAPI.profiles.switch).toHaveBeenCalledWith('b', 'bob-pw');
    });
    // The successful switch triggers App's full-refresh callback.
    await waitFor(() => {
      expect(onProfileSwitched).toHaveBeenCalled();
    });
  });

  it('a wrong password does NOT trigger the renderer refresh', async () => {
    // switchProfile returns a pinned boolean; data:false === wrong password.
    mockElectronAPI.profiles.switch.mockResolvedValue({ success: true, data: false });

    await renderDashboard();
    await openProfileSwitcherViaUserMenu();

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement);
    fireEvent.click(await screen.findByText('Bob'));
    fireEvent.change(await screen.findByPlaceholderText('Enter password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Invalid password')).toBeInTheDocument());
    expect(onProfileSwitched).not.toHaveBeenCalled();
  });

  it('"Add Profile" reaches onAddProfile without reloading the window', async () => {
    await renderDashboard();
    await openProfileSwitcherViaUserMenu();

    fireEvent.click(document.querySelector('.profile-trigger') as HTMLElement);
    fireEvent.click(await screen.findByText('Add Profile'));

    await waitFor(() => expect(onAddProfile).toHaveBeenCalled());
    expect((window.location.reload as any)).not.toHaveBeenCalled();
  });
});
