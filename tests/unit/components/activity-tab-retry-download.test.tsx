// UX-9 (UAT-1 held item 3): Activity "Retry Download" used to call
// window.location.reload() — rebooting the whole renderer to retry one file.
// These tests drive the real flow (open a failed download's details modal ->
// click Retry / Remove) and assert it now goes through the per-item download
// IPC (files.queueDownload / files.cancelDownload) and NEVER reloads the page.
//
// Uses fireEvent (not userEvent) — see activity-tab-copy-link.test.tsx for why
// userEvent's pointer tracking misbehaves under jsdom for this component.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityTab } from '../../../src/renderer/components/dashboard/ActivityTab';
import { AppConfig, DriveInfo } from '../../../src/types';

const reloadSpy = vi.fn();

const mockElectronAPI = {
  shell: {
    openFile: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  files: {
    queueDownload: vi.fn().mockResolvedValue({ success: true }),
    cancelDownload: vi.fn().mockResolvedValue({ success: true }),
  },
  config: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// jsdom cannot navigate; make reload a spy so we can prove it is NOT called.
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadSpy },
  writable: true,
});

const drive: DriveInfo = {
  id: 'drive-1',
  name: 'Test Drive',
  privacy: 'public',
  rootFolderId: 'root-1',
  dateCreated: Date.now(),
  size: 0,
};

const config: AppConfig = {
  isFirstRun: false,
  syncFolder: '/sync',
};

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

function makeFailedDownload() {
  return {
    id: 'dl-1',
    fileName: 'broken.txt',
    localPath: '/sync/broken.txt',
    fileSize: 1234,
    fileId: 'file-abc-123',
    status: 'failed' as const,
    progress: 0,
    error: 'network error',
    downloadedAt: new Date(),
    driveId: 'drive-1',
  };
}

function renderTab() {
  return render(
    <ActivityTab
      uploads={[]}
      downloads={[makeFailedDownload()]}
      pendingUploads={[]}
      config={config}
      drive={drive}
      onViewFile={vi.fn()}
      toast={toast}
    />
  );
}

// Clicking a failed download row opens its details modal, which exposes the
// Retry Download / Remove from Queue buttons.
function openFailedDownloadDetails() {
  const row = screen.getByText('broken.txt').closest('.unified-activity-item') as HTMLElement;
  expect(row).toBeTruthy();
  fireEvent.click(row);
}

describe('ActivityTab Retry Download (UX-9 / UAT-1 held item 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.files.queueDownload.mockResolvedValue({ success: true });
    mockElectronAPI.files.cancelDownload.mockResolvedValue({ success: true });
  });

  it('re-queues THAT item via files.queueDownload and does NOT reload the page', async () => {
    renderTab();
    openFailedDownloadDetails();

    fireEvent.click(await screen.findByRole('button', { name: /Retry Download/i }));

    await waitFor(() => {
      expect(mockElectronAPI.files.queueDownload).toHaveBeenCalledWith('file-abc-123', 100);
    });
    // The load-bearing assertion for UX-9: no full-renderer reboot.
    expect(reloadSpy).not.toHaveBeenCalled();
    // A user-facing affordance replaced the reload.
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('broken.txt'));
  });

  it('removes THAT item via files.cancelDownload and does NOT reload the page', async () => {
    renderTab();
    openFailedDownloadDetails();

    fireEvent.click(await screen.findByRole('button', { name: /Remove from Queue/i }));

    await waitFor(() => {
      expect(mockElectronAPI.files.cancelDownload).toHaveBeenCalledWith('file-abc-123');
    });
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('broken.txt'));
  });

  it('surfaces an error toast (no reload) when the retry IPC resolves {success:false}', async () => {
    mockElectronAPI.files.queueDownload.mockResolvedValue({ success: false, error: 'boom' });
    renderTab();
    openFailedDownloadDetails();

    fireEvent.click(await screen.findByRole('button', { name: /Retry Download/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('broken.txt'));
    });
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
