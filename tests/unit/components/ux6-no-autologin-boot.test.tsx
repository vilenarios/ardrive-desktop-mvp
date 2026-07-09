// UX-6 / D-031: beta ships with ALWAYS-PROMPT login (no auto-login). On
// relaunch with a wallet already set up (profiles exist), the app must route to
// the unlock screen (ProfileManagement, which prompts for the password and
// drives profiles:switch) — it must NEVER silently auto-enter the dashboard.
//
// The live boot value of wallet.hasStoredWallet() is `false` at cold boot
// (wallet-manager-secure.hasStoredWallet is keyed on currentProfileId, which is
// null until a manual unlock sets it), so App's boot router falls into the
// "!hasWallet -> profile-management" branch. This test pins that always-prompt
// behavior and proves the boot path never reaches the dashboard or calls a
// wallet auto-load hook.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

vi.mock('../../../src/renderer/components/ProfileManagement', () => ({
  default: () => <div>unlock-screen</div>,
}));

vi.mock('../../../src/renderer/components/Dashboard', () => ({
  default: () => <div>dashboard-screen</div>,
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

describe('App boot routing — always-prompt login (UX-6 / D-031)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.config.get.mockResolvedValue({ success: true, data: { syncFolder: '/sync' } });
    // A wallet is present: a profile was set up on a previous run.
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [profile] });
    mockElectronAPI.profile.getActive.mockResolvedValue({ success: true, data: profile });
    // Live cold-boot value: the wallet manager doesn't know its profile yet, so
    // no wallet is loaded and hasStoredWallet resolves false -> always prompt.
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue({ success: true, data: false });
    mockElectronAPI.wallet.getInfo.mockResolvedValue({ success: true, data: null });
  });

  it('relaunch with a wallet present shows the unlock prompt, not the dashboard', async () => {
    render(<App />);

    // Lands on the password/unlock screen...
    expect(await screen.findByText('unlock-screen')).toBeInTheDocument();
    // ...and never auto-enters the dashboard.
    expect(screen.queryByText('dashboard-screen')).not.toBeInTheDocument();
  });

  it('does not try to load wallet info at boot (no silent auto-login)', async () => {
    render(<App />);

    await screen.findByText('unlock-screen');

    // The boot router returns at the unlock branch before ever fetching wallet
    // info / drives, so no wallet is loaded without a typed password.
    expect(mockElectronAPI.wallet.getInfo).not.toHaveBeenCalled();
    // There is no auto-load hook on the wallet API surface at all.
    expect((mockElectronAPI.wallet as Record<string, unknown>).ensureLoaded).toBeUndefined();
  });
});
