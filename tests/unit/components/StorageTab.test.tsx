// UAT-1b (defect #5): every icon-only button in StorageTab must carry an
// aria-label (not just a hover-only `title`) so screen-reader/keyboard users
// get the same name sighted users get from the tooltip.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StorageTab } from '../../../src/renderer/components/dashboard/StorageTab';
import { DriveInfo, AppConfig } from '../../../src/types';

const mockElectronAPI = {
  drive: {
    getPermawebFiles: vi.fn(async () => ({ success: true, data: [] })),
  },
  onSyncComplete: vi.fn(),
  onUploadProgress: vi.fn(),
  onFileStateChanged: vi.fn(),
  onDriveUpdate: vi.fn(),
  onDriveMetadataUpdated: vi.fn(),
  removeFileStateChangedListener: vi.fn(),
  removeDriveUpdateListener: vi.fn(),
  removeDriveMetadataUpdatedListener: vi.fn(),
  removeAllListeners: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const drive: DriveInfo = {
  id: 'drive-1',
  name: 'Test Drive',
  privacy: 'public',
  rootFolderId: 'root-folder',
  dateCreated: Date.now(),
  size: 0,
};

const config = { syncFolder: '/sync/folder' } as AppConfig;

describe('StorageTab icon-only button labels (UAT-1b defect #5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.drive.getPermawebFiles.mockResolvedValue({ success: true, data: [] });
  });

  it('every icon-only button (List view, Grid view, Refresh) has an aria-label', async () => {
    render(
      <StorageTab
        drive={drive}
        config={config}
        syncStatus={null}
        onDriveDeleted={() => {}}
      />
    );

    // Wait for the initial metadata load effect to settle
    await screen.findByPlaceholderText('Search files and folders...');

    expect(screen.getByTitle('List view')).toHaveAttribute('aria-label', 'List view');
    expect(screen.getByTitle('Grid view')).toHaveAttribute('aria-label', 'Grid view');

    // Refresh: has visible text too, but must still carry a matching
    // aria-label for consistency with every other icon-bearing control.
    const refreshButton = screen.getByTitle('Refresh file list');
    expect(refreshButton).toHaveAttribute('aria-label', 'Refresh file list');
  });

  it('no button in the toolbar relies on title as its only accessible name', async () => {
    render(
      <StorageTab
        drive={drive}
        config={config}
        syncStatus={null}
        onDriveDeleted={() => {}}
      />
    );

    await screen.findByPlaceholderText('Search files and folders...');

    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      const hasAriaLabel = button.hasAttribute('aria-label');
      const hasVisibleText = (button.textContent || '').trim().length > 0;
      // Every button must be nameable via aria-label OR real visible text —
      // never left with only a `title` attribute as its sole identifier.
      expect(hasAriaLabel || hasVisibleText).toBe(true);
    }
  });
});
