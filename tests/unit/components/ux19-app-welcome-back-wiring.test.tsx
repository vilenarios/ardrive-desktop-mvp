// UX-19: App.tsx's initializeApp() routed a returning user to 'welcome-back'
// (locked primary private drive, or all-private drives) without ever calling
// setDrives(driveList) — so WelcomeBackScreen received the stale initial `[]`
// instead of the real drive list, producing a false "No drives found" prompt.
// WelcomeBackScreen is stubbed here so we can assert exactly what App.tsx
// forwards as `initialDrives` (its own loading/empty behavior is covered
// separately in ux19-welcome-back-drives.test.tsx against the real component).
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../../../src/renderer/App';

vi.mock('../../../src/renderer/components/WelcomeBackScreen', () => ({
  default: (props: any) => (
    <div>
      <div>welcome-back-screen</div>
      <div>drive-count:{(props.initialDrives ?? []).length}</div>
      {(props.initialDrives ?? []).map((d: any) => (
        <div key={d.id}>drive:{d.name}</div>
      ))}
    </div>
  ),
}));

const profile = { id: 'p1', name: 'P1', address: 'addr-1' };

const lockedPrivateDrive = {
  id: 'drive-private-locked',
  name: 'My Private Drive',
  privacy: 'private' as const,
  rootFolderId: 'root-1',
  dateCreated: Date.now(),
  size: 0,
  isLocked: true,
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

describe('App -> WelcomeBackScreen drive-list wiring (UX-19)', () => {
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
    mockElectronAPI.arns.getProfile.mockResolvedValue({ success: true, data: null }); // UX-3: arns:get-profile is now enveloped
    // UX-3: drive-mappings:list returns the IpcResult envelope
    mockElectronAPI.driveMappings.list.mockResolvedValue({ success: true, data: [] });
  });

  it('a returning user with a locked private primary drive sees that drive, not a false empty-state', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([lockedPrivateDrive]);
    mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ success: true, data: { driveId: lockedPrivateDrive.id } });
    mockElectronAPI.drive.isUnlocked.mockResolvedValue({ success: true, data: false }); // locked

    render(<App />);

    expect(await screen.findByText('welcome-back-screen')).toBeInTheDocument();
    // Real drive reached the screen — this was the false "No drives found" bug.
    expect(await screen.findByText('drive-count:1')).toBeInTheDocument();
    expect(await screen.findByText(`drive:${lockedPrivateDrive.name}`)).toBeInTheDocument();
  });

  it('a returning user where every drive is private sees all of them, not a false empty-state', async () => {
    const secondPrivateDrive = { ...lockedPrivateDrive, id: 'drive-private-2', name: 'Second Private Drive' };
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([lockedPrivateDrive, secondPrivateDrive]);
    // No primary mapping -> falls into the "only private drives available" branch
    mockElectronAPI.driveMappings.getPrimary.mockResolvedValue({ success: true, data: null });
    mockElectronAPI.drive.isUnlocked.mockResolvedValue({ success: true, data: false });

    render(<App />);

    expect(await screen.findByText('welcome-back-screen')).toBeInTheDocument();
    expect(await screen.findByText('drive-count:2')).toBeInTheDocument();
    expect(await screen.findByText(`drive:${lockedPrivateDrive.name}`)).toBeInTheDocument();
    expect(await screen.findByText(`drive:${secondPrivateDrive.name}`)).toBeInTheDocument();
  });
});
