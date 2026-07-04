// PRIV-2 (+ audit §5.3.6): DriveSelector read the drive:unlock envelope as a
// boolean — {success:false} is truthy, so a WRONG password selected the drive
// and closed the modal. These tests pin the corrected envelope handling.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DriveSelector } from '../../../src/renderer/components/DriveSelector';

// Stub the unlock modal with probes wired to the props DriveSelector hands it.
// PRIV-4: onUnlock now takes (password, persistKey); the stub exposes both a
// "remember" and a "no-remember" submit so the forwarding can be asserted.
vi.mock('../../../src/renderer/components/PrivateDriveUnlockModal', () => ({
  PrivateDriveUnlockModal: (props: any) =>
    props.isOpen ? (
      <div>
        <div>stub-unlock-modal-open</div>
        <button onClick={() => props.onUnlock('typed-password', false)}>stub-submit-password</button>
        <button onClick={() => props.onUnlock('typed-password', true)}>stub-submit-remember</button>
      </div>
    ) : null,
}));

const mockElectronAPI = {
  drive: {
    unlock: vi.fn(),
    setPersistence: vi.fn().mockResolvedValue({ success: true, data: true }),
  },
  onDriveUpdate: vi.fn(),
  removeDriveUpdateListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const publicDrive = {
  id: 'drive-public',
  name: 'Public Drive',
  privacy: 'public',
  rootFolderId: 'root-1',
  isLocked: false,
} as any;

const lockedDrive = {
  id: 'drive-locked',
  name: 'Locked Drive',
  privacy: 'private',
  rootFolderId: 'root-2',
  isLocked: true,
} as any;

describe('DriveSelector unlock envelope handling (PRIV-2)', () => {
  const defaultProps = {
    currentDrive: publicDrive,
    drives: [publicDrive, lockedDrive],
    isLoading: false,
    onDriveSelect: vi.fn(),
    onCreateDrive: vi.fn(),
    onAddExistingDrive: vi.fn(),
  };

  const openUnlockModal = async () => {
    // Open the selector dropdown, then click the locked drive
    fireEvent.click(screen.getByText('Public Drive'));
    fireEvent.click(await screen.findByText('Locked Drive'));
    expect(await screen.findByText('stub-unlock-modal-open')).toBeInTheDocument();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT select the drive when unlock returns success:false', async () => {
    mockElectronAPI.drive.unlock.mockResolvedValue({
      success: false,
      error: 'Invalid password. Please check your password and try again.',
    });

    render(<DriveSelector {...defaultProps} />);
    await openUnlockModal();

    fireEvent.click(screen.getByText('stub-submit-password'));

    await waitFor(() => {
      expect(mockElectronAPI.drive.unlock).toHaveBeenCalledWith('drive-locked', 'typed-password', false);
    });
    // The pre-fix bug: {success:false} was truthy -> drive selected, modal closed
    expect(defaultProps.onDriveSelect).not.toHaveBeenCalled();
    expect(screen.getByText('stub-unlock-modal-open')).toBeInTheDocument();
  });

  it('forwards the persistKey ("remember") choice through drive.unlock (PRIV-4)', async () => {
    mockElectronAPI.drive.unlock.mockResolvedValue({ success: true });

    render(<DriveSelector {...defaultProps} />);
    await openUnlockModal();

    fireEvent.click(screen.getByText('stub-submit-remember'));

    await waitFor(() => {
      expect(mockElectronAPI.drive.unlock).toHaveBeenCalledWith('drive-locked', 'typed-password', true);
    });
  });

  it('selects the drive and closes the modal when unlock succeeds', async () => {
    mockElectronAPI.drive.unlock.mockResolvedValue({
      success: true,
      drive: { ...lockedDrive, name: 'Decrypted Name', isLocked: false },
    });

    render(<DriveSelector {...defaultProps} />);
    await openUnlockModal();

    fireEvent.click(screen.getByText('stub-submit-password'));

    await waitFor(() => {
      expect(defaultProps.onDriveSelect).toHaveBeenCalledWith('drive-locked');
    });
    expect(screen.queryByText('stub-unlock-modal-open')).not.toBeInTheDocument();
  });

  // PRIV-4 settings UI (plan step 6): per-drive Remember/Forget toggle.
  it('shows a Remember toggle for unlocked private drives and calls setPersistence', async () => {
    const unlockedPrivate = {
      id: 'drive-unlocked',
      name: 'Unlocked Private',
      privacy: 'private',
      rootFolderId: 'root-3',
      isLocked: false,
      isRemembered: false,
    } as any;

    render(
      <DriveSelector {...defaultProps} drives={[publicDrive, unlockedPrivate]} />
    );

    // Open the dropdown.
    fireEvent.click(screen.getByText('Public Drive'));
    const toggle = await screen.findByText('Remember this drive');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockElectronAPI.drive.setPersistence).toHaveBeenCalledWith('drive-unlocked', true);
    });
    // Optimistic UI flips to the "remembered" affordance.
    expect(await screen.findByText('Remembered · Forget')).toBeInTheDocument();
  });

  it('shows "Remembered · Forget" for an already-remembered drive and forgets it', async () => {
    const rememberedPrivate = {
      id: 'drive-remembered',
      name: 'Remembered Private',
      privacy: 'private',
      rootFolderId: 'root-4',
      isLocked: false,
      isRemembered: true,
    } as any;

    render(
      <DriveSelector {...defaultProps} drives={[publicDrive, rememberedPrivate]} />
    );

    fireEvent.click(screen.getByText('Public Drive'));
    const forget = await screen.findByText('Remembered · Forget');
    fireEvent.click(forget);

    await waitFor(() => {
      expect(mockElectronAPI.drive.setPersistence).toHaveBeenCalledWith('drive-remembered', false);
    });
    expect(await screen.findByText('Remember this drive')).toBeInTheDocument();
  });
});
