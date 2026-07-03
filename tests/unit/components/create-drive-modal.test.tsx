// PRIV-3: private drive creation charged the user, then the modal read `.id`
// off the {success, data} envelope and reported failure — no mapping, no
// folder, money spent (audit §3.3). These tests pin the corrected envelope
// handling for BOTH handler shapes (private = envelope, public = raw drive;
// UX-3 later unifies them) and the mapping/active-drive flow on success.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CreateDriveModal } from '../../../src/renderer/components/CreateDriveModal';

const mockElectronAPI = {
  drive: {
    create: vi.fn(),
    createPrivate: vi.fn(),
    setActive: vi.fn(),
  },
  driveMappings: {
    add: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const createdDrive = {
  id: 'new-drive-id',
  name: 'Family Photos',
  privacy: 'private',
  rootFolderId: 'root-new',
};

describe('CreateDriveModal (PRIV-3 envelope + mapping flow)', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onDriveCreated: vi.fn(),
    currentSyncFolder: '/sync',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.driveMappings.add.mockResolvedValue(true);
    mockElectronAPI.drive.setActive.mockResolvedValue(true);
  });

  const fillPrivateForm = () => {
    fireEvent.change(
      screen.getByPlaceholderText('Enter drive name (e.g., Personal Files, Work Documents)'),
      { target: { value: 'Family Photos' } }
    );
    // Default privacy is 'private'
    fireEvent.change(screen.getByPlaceholderText('Enter a strong password'), {
      target: { value: 'testpassword123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Re-enter your password'), {
      target: { value: 'testpassword123' },
    });
  };

  it('private creation success: unwraps the envelope, adds mapping, sets active', async () => {
    // Real handler shape: drive:create-private returns {success, data}
    mockElectronAPI.drive.createPrivate.mockResolvedValue({
      success: true,
      data: createdDrive,
    });

    render(<CreateDriveModal {...defaultProps} />);
    fillPrivateForm();
    fireEvent.click(screen.getByText('Create Drive'));

    await waitFor(() => {
      expect(defaultProps.onDriveCreated).toHaveBeenCalledWith(createdDrive);
    });
    expect(mockElectronAPI.drive.createPrivate).toHaveBeenCalledWith(
      'Family Photos',
      'testpassword123'
    );
    // Mapping created with the drive's real id and a folder inside the sync dir
    expect(mockElectronAPI.driveMappings.add).toHaveBeenCalledWith(
      expect.objectContaining({
        driveId: 'new-drive-id',
        drivePrivacy: 'private',
        localFolderPath: '/sync/Family Photos',
        rootFolderId: 'root-new',
        isActive: true,
      })
    );
    expect(mockElectronAPI.drive.setActive).toHaveBeenCalledWith('new-drive-id');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('private creation failure: surfaces the handler error, no mapping, no close', async () => {
    mockElectronAPI.drive.createPrivate.mockResolvedValue({
      success: false,
      error: 'Insufficient Turbo balance for drive creation',
    });

    render(<CreateDriveModal {...defaultProps} />);
    fillPrivateForm();
    fireEvent.click(screen.getByText('Create Drive'));

    expect(
      await screen.findByText('Insufficient Turbo balance for drive creation')
    ).toBeInTheDocument();
    expect(defaultProps.onDriveCreated).not.toHaveBeenCalled();
    expect(mockElectronAPI.driveMappings.add).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('public creation still works with the raw drive shape', async () => {
    // Real handler shape: drive:create returns the drive object directly
    const publicDrive = { ...createdDrive, privacy: 'public', name: 'Open Data' };
    mockElectronAPI.drive.create.mockResolvedValue(publicDrive);

    render(<CreateDriveModal {...defaultProps} />);
    fireEvent.change(
      screen.getByPlaceholderText('Enter drive name (e.g., Personal Files, Work Documents)'),
      { target: { value: 'Open Data' } }
    );
    fireEvent.click(screen.getByText('Public'));
    fireEvent.click(screen.getByText('Create Drive'));

    await waitFor(() => {
      expect(defaultProps.onDriveCreated).toHaveBeenCalledWith(publicDrive);
    });
    expect(mockElectronAPI.drive.create).toHaveBeenCalledWith('Open Data', 'public');
    expect(mockElectronAPI.driveMappings.add).toHaveBeenCalledWith(
      expect.objectContaining({ driveId: 'new-drive-id', drivePrivacy: 'public' })
    );
  });

  it('a nullish result still reports failure without charging assumptions', async () => {
    mockElectronAPI.drive.createPrivate.mockResolvedValue(undefined);

    render(<CreateDriveModal {...defaultProps} />);
    fillPrivateForm();
    fireEvent.click(screen.getByText('Create Drive'));

    expect(
      await screen.findByText('Failed to create drive. Please try again.')
    ).toBeInTheDocument();
    expect(mockElectronAPI.driveMappings.add).not.toHaveBeenCalled();
  });
});
