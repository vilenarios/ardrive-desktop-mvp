// UX-5: profile switching must fully refresh the renderer. Before the fix,
// after profiles.switch() succeeded in the main process the renderer kept the
// PREVIOUS profile's wallet/drives/dashboard state (§4.8), and "Add Profile"
// was window.location.reload() which bounced straight back to the same
// dashboard (§5.5). These App-level tests stub the heavy Dashboard/WalletSetup
// so we can drive App's own switch/add handlers and assert what App forwards
// for the NEW profile — proving no stale data survives and add-profile routes
// to onboarding instead of reloading.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

// Dashboard stub: renders the profile-scoped props App hands it, plus buttons
// wired to the new UX-5 callbacks so tests can trigger a switch / add-profile.
vi.mock('../../../src/renderer/components/Dashboard', () => ({
  default: (props: any) => (
    <div>
      <div>dashboard-screen</div>
      <div>profile:{props.currentProfile?.name}</div>
      <div>drive:{props.drive?.name}</div>
      <div>balance:{props.walletInfo?.balance}</div>
      <button onClick={() => props.onProfileSwitched?.()}>trigger-switch</button>
      <button onClick={() => props.onAddProfile?.()}>trigger-add</button>
    </div>
  ),
}));

// WalletSetup stub so the add-profile route is detectable.
vi.mock('../../../src/renderer/components/WalletSetup', () => ({
  default: () => <div>wallet-setup-screen</div>,
}));

const profileA = { id: 'a', name: 'Alice', address: 'addr-alice' };
const profileB = { id: 'b', name: 'Bob', address: 'addr-bob' };
const driveA = { id: 'drive-a', name: 'Alice Drive', privacy: 'public', rootFolderId: 'r-a', isLocked: false };
const driveB = { id: 'drive-b', name: 'Bob Drive', privacy: 'public', rootFolderId: 'r-b', isLocked: false };

const mockElectronAPI = {
  config: { get: vi.fn() },
  profiles: { list: vi.fn(), switch: vi.fn() },
  profile: { getActive: vi.fn() },
  wallet: { hasStoredWallet: vi.fn(), getInfo: vi.fn() },
  arns: { getProfile: vi.fn() },
  drive: { listWithStatus: vi.fn(), isUnlocked: vi.fn() },
  driveMappings: { getPrimary: vi.fn(), list: vi.fn() },
  sync: { getFolder: vi.fn(), start: vi.fn(), stop: vi.fn() },
  files: { getUploads: vi.fn() },
  // UX-4: every on* returns a scoped disposer. Return a fresh spy per call so
  // the test can assert the disposer from a specific registration is invoked.
  onSyncStatusUpdate: vi.fn(() => vi.fn()),
  onSyncProgress: vi.fn(() => vi.fn()),
  onUploadProgress: vi.fn(() => vi.fn()),
  onDriveUpdate: vi.fn(() => vi.fn()),
  onWalletInfoUpdated: vi.fn(() => vi.fn()),
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

// jsdom cannot navigate; guarantee reload is a spy so we can assert it is NOT
// called (the add-profile reload loop must be gone).
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: vi.fn() },
  writable: true,
});

/** Point every boot-time mock at the given profile's data. */
const useProfile = (profile: typeof profileA, drive: typeof driveA, balance: string) => {
  mockElectronAPI.profile.getActive.mockResolvedValue({ success: true, data: profile });
  mockElectronAPI.wallet.getInfo.mockResolvedValue({
    success: true,
    data: { address: profile.address, balance, walletType: 'arweave' },
  });
  mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [drive] });
  mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ success: true, data: { driveId: drive.id } });
  mockElectronAPI.driveMappings.list.mockResolvedValue({
    success: true,
    data: [{ id: 'm-' + profile.id, driveId: drive.id, isActive: true }],
  });
};

describe('App profile switch — full renderer refresh (UX-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.config.get.mockResolvedValue({ success: true, data: { syncFolder: '/sync' } });
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [profileA, profileB] });
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.arns.getProfile.mockResolvedValue({ success: true, data: null });
    mockElectronAPI.sync.getFolder.mockResolvedValue({ success: true, data: '/sync' });
    mockElectronAPI.sync.start.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.sync.stop.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.files.getUploads.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.drive.isUnlocked.mockResolvedValue({ success: true, data: true });
    // Default: booted as Alice.
    useProfile(profileA, driveA, '1.0');
  });

  it('replaces ALL profile-scoped state with the new profile — no stale data', async () => {
    render(<App />);

    // Booted as Alice.
    expect(await screen.findByText('dashboard-screen')).toBeInTheDocument();
    expect(screen.getByText('profile:Alice')).toBeInTheDocument();
    expect(screen.getByText('drive:Alice Drive')).toBeInTheDocument();
    expect(screen.getByText('balance:1.0')).toBeInTheDocument();

    // Main process has switched to Bob; flip the backend, then fire the switch.
    useProfile(profileB, driveB, '5.0');
    // UX-4: capture the disposer returned by the boot-time onDriveUpdate
    // registration; the switch must invoke it (tearing down the old profile's
    // listener) via scoped removal, not removeAllListeners.
    const bootDriveUpdateDisposer = mockElectronAPI.onDriveUpdate.mock.results[0].value;
    fireEvent.click(screen.getByText('trigger-switch'));

    // Renderer now reflects ONLY Bob.
    expect(await screen.findByText('profile:Bob')).toBeInTheDocument();
    expect(screen.getByText('drive:Bob Drive')).toBeInTheDocument();
    expect(screen.getByText('balance:5.0')).toBeInTheDocument();

    // Alice's data is gone — no cross-profile leak in the renderer.
    expect(screen.queryByText('profile:Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('drive:Alice Drive')).not.toBeInTheDocument();
    expect(screen.queryByText('balance:1.0')).not.toBeInTheDocument();

    // Old listeners were torn down as part of the switch (no leftover listeners
    // pointing at the old profile's state) — via the boot registration's OWN
    // scoped disposer, not a channel-wide removeAllListeners.
    await waitFor(() => {
      expect(bootDriveUpdateDisposer).toHaveBeenCalled();
    });
  });

  it('add-profile routes to onboarding and stops sync — no window reload loop', async () => {
    render(<App />);
    expect(await screen.findByText('dashboard-screen')).toBeInTheDocument();

    fireEvent.click(screen.getByText('trigger-add'));

    // Lands on new-profile onboarding, not back on the dashboard.
    expect(await screen.findByText('wallet-setup-screen')).toBeInTheDocument();
    expect(screen.queryByText('dashboard-screen')).not.toBeInTheDocument();

    // The current profile's sync was stopped before onboarding the new profile.
    await waitFor(() => {
      expect(mockElectronAPI.sync.stop).toHaveBeenCalled();
    });

    // Crucially, it did NOT reload the window (the old add-profile behaviour).
    expect((window.location.reload as any)).not.toHaveBeenCalled();
  });
});
