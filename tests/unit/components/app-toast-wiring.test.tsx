// UX-1: App must pass its useToast `toast` down to Dashboard — the audited
// defect was that the prop was never passed, so every Dashboard toast?. call
// was a silent no-op. Dashboard is stubbed with probe buttons; the toast
// rendering path (useToast + ToastContainer) is REAL, so these tests fail if
// the prop is dropped again.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

// Stub Dashboard with probes wired to the props App hands it
vi.mock('../../../src/renderer/components/Dashboard', () => ({
  default: (props: any) => (
    <div>
      <button onClick={() => props.toast?.error('Wired toast probe')}>fire-probe-toast</button>
      <button onClick={() => props.onDriveDeleted()}>fire-drive-deleted</button>
      <div>{props.toast ? 'toast-prop-present' : 'toast-prop-missing'}</div>
    </div>
  ),
}));
// Screens reachable from the stub's actions
vi.mock('../../../src/renderer/components/DriveAndSyncSetup', () => ({
  default: () => <div>stub-drive-setup</div>,
}));

const profile = { id: 'p1', name: 'P1', address: 'addr-1' };
const driveA = {
  id: 'drive-a-id',
  name: 'Drive A',
  privacy: 'public',
  rootFolderId: 'root-a',
  isLocked: false,
};

const mockElectronAPI = {
  config: { get: vi.fn() },
  profiles: { list: vi.fn() },
  profile: { getActive: vi.fn() },
  wallet: { hasStoredWallet: vi.fn(), getInfo: vi.fn() },
  arns: { getProfile: vi.fn() },
  drive: { listWithStatus: vi.fn(), isUnlocked: vi.fn() },
  driveMappings: { getPrimary: vi.fn(), list: vi.fn() },
  sync: { getFolder: vi.fn(), start: vi.fn(), getStatus: vi.fn() },
  files: { getUploads: vi.fn() },
  onSyncStatusUpdate: vi.fn(),
  onSyncProgress: vi.fn(),
  onUploadProgress: vi.fn(),
  onDriveUpdate: vi.fn(),
  onWalletInfoUpdated: vi.fn(),
  removeWalletInfoUpdatedListener: vi.fn(),
  removeSyncProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('App -> Dashboard toast wiring (UX-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Boot straight to the dashboard state
    mockElectronAPI.config.get.mockResolvedValue({ syncFolder: '/sync' });
    mockElectronAPI.profiles.list.mockResolvedValue([profile]);
    mockElectronAPI.profile.getActive.mockResolvedValue(profile);
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue(true);
    mockElectronAPI.wallet.getInfo.mockResolvedValue({
      address: 'addr-1',
      balance: '1.0',
      walletType: 'arweave',
    });
    mockElectronAPI.arns.getProfile.mockResolvedValue(null);
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([driveA]);
    mockElectronAPI.drive.isUnlocked.mockResolvedValue(true);
    mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ driveId: driveA.id });
    mockElectronAPI.driveMappings.list.mockResolvedValue([]);
    mockElectronAPI.sync.getFolder.mockResolvedValue('/sync');
    mockElectronAPI.sync.start.mockResolvedValue(true);
    mockElectronAPI.files.getUploads.mockResolvedValue([]);
  });

  it('passes the toast prop to Dashboard and renders emitted toasts', async () => {
    render(<App />);

    // Boot reached the dashboard and the prop is present
    expect(await screen.findByText('toast-prop-present')).toBeInTheDocument();

    // A toast emitted through the prop becomes visible via the real ToastContainer
    fireEvent.click(screen.getByText('fire-probe-toast'));
    expect(await screen.findByText('Wired toast probe')).toBeInTheDocument();
  });

  it('shows a visible toast when the active drive is removed', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('fire-drive-deleted'));

    // Removal routes to drive setup AND announces itself
    expect(
      await screen.findByText('Drive removed — choose or create a new drive')
    ).toBeInTheDocument();
    expect(await screen.findByText('stub-drive-setup')).toBeInTheDocument();
  });
});
