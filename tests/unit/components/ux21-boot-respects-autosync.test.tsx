// UX-21: "Enable Auto Sync" toggle is never persisted. The setup toggle
// (DriveAndSyncSetup) previously wrote nowhere, so every boot started sync
// unconditionally via App.initializeApp()'s closing `sync.start()` call —
// same fabricated-setting class as the already-fixed MONEY-4/MONEY-11.
//
// This drives App.tsx through the full existing-profile boot path (same
// technique as tests/unit/components/ux7-boot-error-routing.test.tsx:
// WalletSetup/DriveAndSyncSetup — and here Dashboard too — are stubbed so the
// test is only about initializeApp's own gating, not any child component's
// behavior) and proves:
//   - a profile whose persisted config has `autoSyncEnabled: false` reaches
//     the dashboard WITHOUT ever calling window.electronAPI.sync.start();
//   - a profile with `autoSyncEnabled: true` (or the field entirely absent —
//     the default-on case that must keep working for every profile that
//     existed before this preference did) reaches the dashboard AND calls
//     sync.start() exactly once.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

vi.mock('../../../src/renderer/components/WalletSetup', () => ({
  default: () => <div>stub-wallet-setup</div>,
}));
vi.mock('../../../src/renderer/components/DriveAndSyncSetup', () => ({
  default: () => <div>stub-drive-setup</div>,
}));
vi.mock('../../../src/renderer/components/Dashboard', () => ({
  default: () => <div>stub-dashboard</div>,
}));

const profile = { id: 'p1', name: 'P1', address: 'addr-1' };
const driveA = { id: 'drive-a', name: 'Drive A', privacy: 'public', rootFolderId: 'root-a', isLocked: false };
const primaryMapping = { id: 'mapping-a', driveId: 'drive-a', rootFolderId: 'root-a', driveName: 'Drive A', isActive: true };

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

describe('App boot respects the persisted Auto-Sync preference (UX-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.profiles.list.mockResolvedValue({ success: true, data: [profile] });
    mockElectronAPI.profile.getActive.mockResolvedValue({ success: true, data: profile });
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue({ success: true, data: true });
    mockElectronAPI.wallet.getInfo.mockResolvedValue({
      success: true,
      data: { address: 'addr-1', balance: '1.0', walletType: 'arweave' },
    });
    mockElectronAPI.arns.getProfile.mockResolvedValue({ success: true, data: null });
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ success: true, data: primaryMapping });
    mockElectronAPI.driveMappings.list.mockResolvedValue({ success: true, data: [primaryMapping] });
    mockElectronAPI.sync.getFolder.mockResolvedValue({ success: true, data: '/sync/DriveA' });
    mockElectronAPI.files.getUploads.mockResolvedValue({ success: true, data: [] });
    mockElectronAPI.sync.start.mockResolvedValue({ success: true, data: true });
  });

  it('autoSyncEnabled: false — reaches the dashboard but never calls sync.start()', async () => {
    mockElectronAPI.config.get.mockResolvedValue({
      success: true,
      data: { syncFolder: '/sync/DriveA', isFirstRun: false, autoSyncEnabled: false },
    });

    render(<App />);

    expect(await screen.findByText('stub-dashboard')).toBeInTheDocument();
    // Give any errant fire-and-forget start() call a chance to have fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockElectronAPI.sync.start).not.toHaveBeenCalled();
  });

  it('autoSyncEnabled: true — reaches the dashboard and calls sync.start()', async () => {
    mockElectronAPI.config.get.mockResolvedValue({
      success: true,
      data: { syncFolder: '/sync/DriveA', isFirstRun: false, autoSyncEnabled: true },
    });

    render(<App />);

    expect(await screen.findByText('stub-dashboard')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockElectronAPI.sync.start).toHaveBeenCalledTimes(1);
    });
  });

  it('autoSyncEnabled absent (legacy profile, pre-UX-21) — still defaults to auto-starting sync', async () => {
    mockElectronAPI.config.get.mockResolvedValue({
      success: true,
      data: { syncFolder: '/sync/DriveA', isFirstRun: false },
    });

    render(<App />);

    expect(await screen.findByText('stub-dashboard')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockElectronAPI.sync.start).toHaveBeenCalledTimes(1);
    });
  });
});
