// PRIV-2 (+ audit §5.3.6): DriveSelector read the drive:unlock envelope as a
// boolean — {success:false} is truthy, so a WRONG password selected the drive
// and closed the modal. These tests pin the corrected envelope handling.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DriveSelector } from '../../../src/renderer/components/DriveSelector';

// Stub the unlock modal with probes wired to the props DriveSelector hands it
vi.mock('../../../src/renderer/components/PrivateDriveUnlockModal', () => ({
  PrivateDriveUnlockModal: (props: any) =>
    props.isOpen ? (
      <div>
        <div>stub-unlock-modal-open</div>
        <button onClick={() => props.onUnlock('typed-password')}>stub-submit-password</button>
      </div>
    ) : null,
}));

const mockElectronAPI = {
  drive: {
    unlock: vi.fn(),
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
      expect(mockElectronAPI.drive.unlock).toHaveBeenCalledWith('drive-locked', 'typed-password');
    });
    // The pre-fix bug: {success:false} was truthy -> drive selected, modal closed
    expect(defaultProps.onDriveSelect).not.toHaveBeenCalled();
    expect(screen.getByText('stub-unlock-modal-open')).toBeInTheDocument();
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
});
