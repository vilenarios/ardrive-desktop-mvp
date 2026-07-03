// MONEY-6 fix iteration: the top-up staleness fix must fire IN PRODUCTION,
// not just component-level. QA traced two dead paths in the first attempt:
//   D1 — TurboCreditsManager's unmount cleanup calls the preload's global
//        removeAllListeners('wallet-info-updated'), killing App's listener
//        (the only runtime setWalletInfo) after the first manager close.
//   D2 — payment success emits only 'payment-completed'; nothing pulled
//        wallet.getInfo(true) afterward.
// The fix routes fresh info through the IPC RETURN VALUE on manager close
// (App.refreshWalletInfo -> Dashboard.onRefreshWalletInfo), bypassing the
// clobber-prone event channel (root fix = UX-4).
//
// These tests drive the REAL production chain — App (owns walletInfo state)
// -> real Dashboard (manager close handler) -> real TabNavigation -> real
// UploadApprovalQueueModern (row blocking on live turboWinc). Only heavy
// leaf components are stubbed, with probes wired to the props Dashboard
// hands them (dashboard-toasts pattern). Crucially, the mocked
// onWalletInfoUpdated NEVER invokes its callback — exactly the production
// reality after the first manager unmount — so any balance update the UI
// shows can only have arrived via the return-value path under test.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

// ---- child component stubs (Dashboard's heavy leaves; queue + tabs stay REAL)
vi.mock('../../../src/renderer/components/TurboCreditsManager', () => ({
  default: (props: any) => (
    <div>
      <div>stub-turbo-manager</div>
      <button onClick={props.onClose}>stub-close-turbo-manager</button>
    </div>
  ),
}));
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: () => null,
}));
vi.mock('../../../src/renderer/components/CreateDriveModal', () => ({
  CreateDriveModal: () => null,
}));
vi.mock('../../../src/renderer/components/AddExistingDriveModal', () => ({
  AddExistingDriveModal: () => null,
}));
vi.mock('../../../src/renderer/components/FileMetadataModal', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/UserMenu', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/WalletExport', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/ProfileSwitcher', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/Settings', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/SyncProgressDisplay', () => ({
  SyncProgressDisplay: () => null,
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

// ---- fixtures -----------------------------------------------------------
const profile = { id: 'p1', name: 'P1', address: 'addr-1' };
const driveA = {
  id: 'drive-a-id',
  name: 'Drive A',
  privacy: 'public',
  rootFolderId: 'root-a',
  isLocked: false,
};

// Pre-top-up: 0.02 Credits (2e10 winc) — cannot cover the 0.5-Credit quote
const staleWalletInfo = {
  address: 'addr-1',
  balance: '1.0',
  walletType: 'arweave',
  turboBalance: '0.02',
  turboWinc: '20000000000',
};
// Post-top-up (returned only by getInfo(true)): 1.0 Credit (1e12 winc)
const freshWalletInfo = {
  ...staleWalletInfo,
  turboBalance: '1.0',
  turboWinc: '1000000000000',
};

const FILE_SIZE_5MB = 5 * 1024 * 1024;
// DB-shaped row as it crosses IPC from uploads:getPending (CLAUDE.md trap 6):
// integer booleans, explicit nulls, string date — NOT clean JS shapes.
const blockedRow = {
  id: 'upload-1',
  driveId: 'drive-a-id',
  localPath: '/sync/Drive A/big-file.bin',
  fileName: 'big-file.bin',
  fileSize: FILE_SIZE_5MB,
  mimeType: 'application/octet-stream',
  estimatedCost: FILE_SIZE_5MB / 1e12,
  estimatedTurboCost: 0.5, // real quote: 0.5 Credits = 5e11 winc
  hasSufficientTurboBalance: 0, // sqlite integer boolean
  recommendedMethod: null,
  conflictType: 'none',
  conflictDetails: null,
  status: 'awaiting_approval',
  operationType: 'upload',
  createdAt: '2026-07-03T10:00:00.000Z',
};

// ---- electronAPI mock ----------------------------------------------------
const mockElectronAPI = {
  config: { get: vi.fn() },
  profiles: { list: vi.fn() },
  profile: { getActive: vi.fn() },
  wallet: { hasStoredWallet: vi.fn(), getInfo: vi.fn() },
  arns: { getProfile: vi.fn() },
  drive: {
    listWithStatus: vi.fn(),
    isUnlocked: vi.fn(),
    getMapped: vi.fn(),
    switchTo: vi.fn(),
  },
  driveMappings: { getPrimary: vi.fn(), list: vi.fn() },
  sync: { getFolder: vi.fn(), start: vi.fn(), manual: vi.fn() },
  files: { getUploads: vi.fn(), getDownloads: vi.fn(), getQueueStatus: vi.fn() },
  uploads: {
    getPending: vi.fn(),
    approve: vi.fn(),
    approveAll: vi.fn(),
    reject: vi.fn(),
    rejectAll: vi.fn(),
    cancel: vi.fn(),
  },
  shell: { openPath: vi.fn() },
  onSyncStatusUpdate: vi.fn(),
  onSyncProgress: vi.fn(),
  onUploadProgress: vi.fn(),
  onDriveUpdate: vi.fn(),
  // Never invokes its callback — the event channel is dead in production
  // after the first manager unmount (UX-4); the fix must not depend on it.
  onWalletInfoUpdated: vi.fn(),
  removeWalletInfoUpdatedListener: vi.fn(),
  removeSyncProgressListener: vi.fn(),
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
  removeUploadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('MONEY-6: top-up refresh reaches blocked queue rows in the production chain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Boot straight to the dashboard (app-toast-wiring recipe)
    mockElectronAPI.config.get.mockResolvedValue({ syncFolder: '/sync' });
    mockElectronAPI.profiles.list.mockResolvedValue([profile]);
    mockElectronAPI.profile.getActive.mockResolvedValue(profile);
    mockElectronAPI.wallet.hasStoredWallet.mockResolvedValue(true);
    // Un-forced getInfo (boot) returns the stale balance; only a FORCED
    // refresh sees the post-top-up balance.
    mockElectronAPI.wallet.getInfo.mockImplementation(async (forceRefresh?: boolean) =>
      forceRefresh ? freshWalletInfo : staleWalletInfo
    );
    mockElectronAPI.arns.getProfile.mockResolvedValue(null);
    // Real handler shape: {success, data} envelope (main.ts drive:listWithStatus)
    mockElectronAPI.drive.listWithStatus.mockResolvedValue({ success: true, data: [driveA] });
    mockElectronAPI.drive.isUnlocked.mockResolvedValue(true);
    mockElectronAPI.drive.getMapped.mockResolvedValue([driveA]);
    mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ driveId: driveA.id });
    mockElectronAPI.driveMappings.list.mockResolvedValue([]);
    mockElectronAPI.sync.getFolder.mockResolvedValue('/sync');
    mockElectronAPI.sync.start.mockResolvedValue(true);
    mockElectronAPI.files.getUploads.mockResolvedValue([]);
    mockElectronAPI.files.getDownloads.mockResolvedValue([]);
    mockElectronAPI.files.getQueueStatus.mockResolvedValue({
      success: true,
      data: { queued: 0, active: 0, total: 0 },
    });
    mockElectronAPI.uploads.getPending.mockResolvedValue([blockedRow]);
  });

  /** Boot App to the dashboard and open the real Upload Queue tab. */
  const bootToUploadQueue = async () => {
    render(<App />);
    // Real TabNavigation renders once boot lands on the dashboard
    fireEvent.click(await screen.findByText('Upload Queue'));
    // The real queue shows the DB-shaped pending row
    expect(await screen.findByText('big-file.bin')).toBeInTheDocument();
  };

  it('unblocks a balance-blocked row after the Turbo manager closes — via IPC return value, with the event channel dead', async () => {
    await bootToUploadQueue();

    // Stale App-level balance (0.02 Credits) cannot cover the 0.5-Credit quote
    expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();

    // Drive the row's REAL top-up affordance -> Dashboard opens the manager
    fireEvent.click(screen.getByText('top up Turbo Credits'));
    expect(await screen.findByText('stub-turbo-manager')).toBeInTheDocument();

    // No forced refresh has happened yet (boot only used un-forced getInfo)
    expect(mockElectronAPI.wallet.getInfo).not.toHaveBeenCalledWith(true);

    // Close the manager — Dashboard's close handler must PULL fresh info
    fireEvent.click(screen.getByText('stub-close-turbo-manager'));

    await waitFor(() => {
      expect(mockElectronAPI.wallet.getInfo).toHaveBeenCalledWith(true);
    });

    // Back on the queue: the refreshed winc covers the quote — the row
    // unblocks with NO wallet-info-updated event and NO re-quote
    expect(await screen.findByText('big-file.bin')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/Insufficient balance/)).toBeNull();
    });
    expect(screen.getAllByText('0.5000 Credits').length).toBeGreaterThan(0);
  });

  it('keeps the dashboard alive and the row blocked when the forced refresh fails', async () => {
    await bootToUploadQueue();
    fireEvent.click(screen.getByText('top up Turbo Credits'));
    await screen.findByText('stub-turbo-manager');

    mockElectronAPI.wallet.getInfo.mockImplementation(async (forceRefresh?: boolean) => {
      if (forceRefresh) throw new Error('gateway unreachable');
      return staleWalletInfo;
    });

    fireEvent.click(screen.getByText('stub-close-turbo-manager'));

    await waitFor(() => {
      expect(mockElectronAPI.wallet.getInfo).toHaveBeenCalledWith(true);
    });
    // Manager closed back to the queue; row honestly stays blocked; no crash
    expect(await screen.findByText('big-file.bin')).toBeInTheDocument();
    expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
  });

  it('does not clear walletInfo (unmounting the dashboard) when the forced refresh returns null', async () => {
    await bootToUploadQueue();
    fireEvent.click(screen.getByText('top up Turbo Credits'));
    await screen.findByText('stub-turbo-manager');

    // wallet:get-info returns null when no wallet info is available
    mockElectronAPI.wallet.getInfo.mockImplementation(async (forceRefresh?: boolean) =>
      forceRefresh ? null : staleWalletInfo
    );

    fireEvent.click(screen.getByText('stub-close-turbo-manager'));

    await waitFor(() => {
      expect(mockElectronAPI.wallet.getInfo).toHaveBeenCalledWith(true);
    });
    // App must NOT setWalletInfo(null) — that would tear down the dashboard
    // (App only renders it while walletInfo is set)
    expect(await screen.findByText('big-file.bin')).toBeInTheDocument();
    expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
  });
});
