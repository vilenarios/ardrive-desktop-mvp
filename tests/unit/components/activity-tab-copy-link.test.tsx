// UX-10: "Copy Link" (and "View Online") in ActivityTab's context menu used
// to prefer the ArFS fileId (a UUID) over the dataTxId (the actual Arweave
// transaction id) when building a raw-gateway URL. fileId is not a
// gateway-resolvable path, so the copied link was dead. These tests drive
// the real context-menu flow (hover -> open menu -> click action) against
// the corrected dataTxId-only link construction.
//
// Note: uses fireEvent (not userEvent) for hover/click. userEvent's realistic
// pointer-tracking computes "leaving" the hovered item via
// document.elementFromPoint, which jsdom doesn't implement (always resolves
// to <body>), spuriously firing mouseleave on the hovered item and
// collapsing the menu before the click lands. fireEvent dispatches the exact
// requested event with no such side effect.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityTab } from '../../../src/renderer/components/dashboard/ActivityTab';
import { FileUpload, AppConfig, DriveInfo } from '../../../src/types';

const mockElectronAPI = {
  shell: {
    openFile: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  files: {
    queueDownload: vi.fn(),
    cancelDownload: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
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

function makeUpload(overrides: Partial<FileUpload>): FileUpload {
  return {
    id: 'upload-1',
    driveId: 'drive-1',
    localPath: '/sync/file.txt',
    fileName: 'file.txt',
    fileSize: 1234,
    status: 'completed',
    progress: 100,
    createdAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

// Opens the "..." context menu for the activity item whose filename is
// `fileName`, returning the item element (scoped queries use it).
function openContextMenu(fileName: string): HTMLElement {
  const item = screen.getByText(fileName).closest('.unified-activity-item') as HTMLElement;
  expect(item).toBeTruthy();

  fireEvent.mouseOver(item);

  const trigger = item.querySelector('.context-menu-button') as HTMLElement;
  expect(trigger).toBeTruthy();
  fireEvent.click(trigger);

  return item;
}

describe('ActivityTab — Copy Link builds resolvable raw-gateway URLs (UX-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('copies a dataTxId-shaped resolvable link for a file WITH a dataTxId', async () => {
    const upload = makeUpload({
      id: 'upload-with-tx',
      fileName: 'with-tx.txt',
      dataTxId: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABC12',
      fileId: '11111111-1111-1111-1111-111111111111',
    });

    render(
      <ActivityTab
        uploads={[upload]}
        downloads={[]}
        pendingUploads={[]}
        config={config}
        drive={drive}
        onViewFile={vi.fn()}
      />
    );

    const item = openContextMenu('with-tx.txt');

    const copyLinkButton = within(item).getByText('Copy Link');
    fireEvent.click(copyLinkButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `https://arweave.net/${upload.dataTxId}`
      );
    });

    // Must never be built from the ArFS fileId (a UUID) — that's the UX-10 bug.
    const copiedUrl = (navigator.clipboard.writeText as any).mock.calls[0][0];
    expect(copiedUrl).not.toContain(upload.fileId);
  });

  it('offers no raw-gateway link for a file WITHOUT a dataTxId', async () => {
    const upload = makeUpload({
      id: 'upload-no-tx',
      fileName: 'no-tx.txt',
      dataTxId: undefined,
      fileId: '22222222-2222-2222-2222-222222222222',
      status: 'uploading',
      progress: 40,
    });

    render(
      <ActivityTab
        uploads={[upload]}
        downloads={[]}
        pendingUploads={[]}
        config={config}
        drive={drive}
        onViewFile={vi.fn()}
      />
    );

    const item = openContextMenu('no-tx.txt');

    // The menu did open (sanity check the query below isn't a false negative)...
    expect(within(item).getByText('View Details')).toBeInTheDocument();
    // ...but no dead-link actions are offered for a file with no dataTxId.
    expect(within(item).queryByText('Copy Link')).not.toBeInTheDocument();
    expect(within(item).queryByText('View Online')).not.toBeInTheDocument();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
});
