// UX-7: initializeApp() used to have two ways to wrongly route an existing,
// already-set-up profile into account/drive creation instead of a fail-safe
// error+retry screen:
//   1. Any thrown boot exception (after we already know a profile+wallet
//      exist) fell into the catch-all, which unconditionally routed to
//      'wallet-setup' ("Create New Account").
//   2. drive:listWithStatus returning a fetch-failure envelope
//      ({success:false}) was extracted as an empty drive list indistinguishable
//      from a confirmed-empty result, routing into 'drive-setup' (create a
//      drive) for an offline/network-flaky existing user.
// These tests drive App.tsx directly (WalletSetup/DriveAndSyncSetup are
// stubbed) and assert: a fetch failure or boot exception for an existing
// profile lands on the new fail-safe 'boot-error' screen with a Retry
// control, never on the create-account/create-drive screens; a genuinely
// new user and a confirmed-empty drive list are unaffected.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

vi.mock('../../../src/renderer/components/WalletSetup', () => ({
  default: () => <div>stub-wallet-setup</div>,
}));
vi.mock('../../../src/renderer/components/DriveAndSyncSetup', () => ({
  default: () => <div>stub-drive-setup</div>,
}));

const profile = { id: 'p1', name: 'P1', address: 'addr-1' };

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

describe('App boot routing fail-safe (UX-7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // UX-3: config/profiles/profile/wallet handlers now return the IpcResult envelope.
    mockElectronAPI.config.get.mockResolvedValue({ success: true, data: { syncFolder: '/sync' } });
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [profile] });
    mockElectronAPI.profile.getActive.mockResolvedValue({ success: true, data: profile });
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.wallet.getInfo.mockResolvedValue({
      success: true,
      data: {
        address: 'addr-1',
        balance: '1.0',
        walletType: 'arweave',
      },
    });
    mockElectronAPI.arns.getProfile.mockResolvedValue(null);
    mockElectronAPI.driveMappings.list.mockResolvedValue([]);
  });

  it('an existing profile whose drive fetch fails (envelope success:false) sees Retry, never create-account/create-drive', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({
      success: false,
      error: 'Network error: gateway unreachable',
    });

    render(<App />);

    expect(await screen.findByText(/couldn.t load your account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('stub-wallet-setup')).not.toBeInTheDocument();
    expect(screen.queryByText('stub-drive-setup')).not.toBeInTheDocument();
  });

  it('an existing profile whose drive fetch throws (rejected promise) sees Retry, never create-account/create-drive', async () => {
    mockElectronAPI.drive.listWithStatus.mockRejectedValue(new Error('offline'));

    render(<App />);

    expect(await screen.findByText(/couldn.t load your account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText('stub-wallet-setup')).not.toBeInTheDocument();
    expect(screen.queryByText('stub-drive-setup')).not.toBeInTheDocument();
  });

  it('an existing profile hitting an unrelated boot exception (e.g. drive mappings lookup) sees Retry, not create-account', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([
      { id: 'd1', name: 'Drive', privacy: 'public', rootFolderId: 'r1', isLocked: false },
    ]);
    mockElectronAPI.driveMappings.getPrimary.mockRejectedValue(new Error('db locked'));

    render(<App />);

    expect(await screen.findByText(/couldn.t load your account/i)).toBeInTheDocument();
    expect(screen.queryByText('stub-wallet-setup')).not.toBeInTheDocument();
  });

  it('Retry re-runs the boot sequence', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: false, error: 'offline' });

    render(<App />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();

    const callsBeforeRetry = mockElectronAPI.drive.listWithStatus.mock.calls.length;

    // Retry succeeds this time with a confirmed-empty result.
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [] });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('stub-drive-setup')).toBeInTheDocument();
    expect(mockElectronAPI.drive.listWithStatus.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
  });

  it('a confirmed-empty drive list (successful fetch, zero drives) still routes to drive-setup', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [] });

    render(<App />);

    expect(await screen.findByText('stub-drive-setup')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load your account/i)).not.toBeInTheDocument();
  });

  it('a genuinely new user (no profiles) still routes to wallet-setup, not boot-error', async () => {
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [] });

    render(<App />);

    expect(await screen.findByText('stub-wallet-setup')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load your account/i)).not.toBeInTheDocument();
  });
});
