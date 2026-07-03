// UX-2: Settings "Change Folder" was a silent no-op — dialog:select-folder
// resolves to a path STRING (or null), but the handler read `.filePath` off
// it. These tests drive the corrected flow against the real IPC shapes.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Settings from '../../../src/renderer/components/Settings';

const mockElectronAPI = {
  dialog: {
    selectFolder: vi.fn(),
  },
  sync: {
    setFolder: vi.fn(),
    start: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('Settings — Change Folder (UX-2)', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    config: { syncFolder: '/old/sync/folder' } as any,
    onShowWalletExport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.sync.setFolder.mockResolvedValue(true);
    mockElectronAPI.sync.start.mockResolvedValue(true);
  });

  it('persists the selected folder and re-targets sync', async () => {
    // Real handler shape: dialog:select-folder resolves to a string path
    mockElectronAPI.dialog.selectFolder.mockResolvedValue('/new/sync/folder');

    render(<Settings {...defaultProps} />);
    expect(screen.getByText('/old/sync/folder')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Change Folder'));

    await waitFor(() => {
      expect(mockElectronAPI.sync.setFolder).toHaveBeenCalledWith('/new/sync/folder');
      expect(mockElectronAPI.sync.start).toHaveBeenCalled();
    });

    // The displayed folder reflects the change
    expect(await screen.findByText('/new/sync/folder')).toBeInTheDocument();
    expect(screen.queryByText('/old/sync/folder')).not.toBeInTheDocument();
  });

  it('does nothing when the dialog is cancelled', async () => {
    mockElectronAPI.dialog.selectFolder.mockResolvedValue(null);

    render(<Settings {...defaultProps} />);
    fireEvent.click(screen.getByText('Change Folder'));

    await waitFor(() => {
      expect(mockElectronAPI.dialog.selectFolder).toHaveBeenCalled();
    });
    expect(mockElectronAPI.sync.setFolder).not.toHaveBeenCalled();
    expect(mockElectronAPI.sync.start).not.toHaveBeenCalled();
    expect(screen.getByText('/old/sync/folder')).toBeInTheDocument();
  });

  it('shows an error and keeps the old folder when persisting fails', async () => {
    mockElectronAPI.dialog.selectFolder.mockResolvedValue('/new/sync/folder');
    mockElectronAPI.sync.setFolder.mockRejectedValue(new Error('mkdir failed'));

    render(<Settings {...defaultProps} />);
    fireEvent.click(screen.getByText('Change Folder'));

    expect(
      await screen.findByText('Failed to change sync folder. Please try again.')
    ).toBeInTheDocument();
    expect(screen.getByText('/old/sync/folder')).toBeInTheDocument();
    expect(mockElectronAPI.sync.start).not.toHaveBeenCalled();
  });

  it('reports when the folder changed but sync could not restart', async () => {
    mockElectronAPI.dialog.selectFolder.mockResolvedValue('/new/sync/folder');
    mockElectronAPI.sync.start.mockRejectedValue(new Error('drive not accessible'));

    render(<Settings {...defaultProps} />);
    fireEvent.click(screen.getByText('Change Folder'));

    // Folder persisted and shown...
    expect(await screen.findByText('/new/sync/folder')).toBeInTheDocument();
    // ...with an honest partial-failure message
    expect(
      await screen.findByText(
        'Folder changed, but sync could not restart automatically. Use Sync to retry.'
      )
    ).toBeInTheDocument();
  });
});
