// UAT (manifest site-deploy verification, SYNC-18 follow-up): renderer-side
// half of the create-manifest contract. main.ts's `drive:create-manifest`
// handler (see tests/unit/main/create-manifest-handler.test.ts) returns a
// gateway-correct manifest link verbatim from core-js's uploadPublicManifest
// result. This file proves CreateManifestModal forwards that exact string to
// its `onSuccess` callback with NO further rewriting (no arweave.net
// substitution, no /raw/ path munging à la the SYNC-18 download-side bug —
// there is no equivalent post-processing on the create/upload side).
//
// UX-33: the modal used to close immediately on success, relying on a
// fleeting toast (and a stale OverviewTab.tsx comment claiming the URL was
// "already copied to clipboard") to get the link to the user — it wasn't,
// and there was no visible UI for the resulting link at all. Now the modal
// stays open on a "Site Deployed" view with the URL rendered plus working
// Copy Link/Open actions; the tests below cover both the URL pass-through
// contract and that deployed view.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CreateManifestModal from '../../../src/renderer/components/CreateManifestModal';

const GATEWAY_MANIFEST_URL = 'https://turbo-gateway.com/TX_MANIFEST_XYZ';
const GATEWAY_FILE_URL = 'https://turbo-gateway.com/TX_MANIFEST_XYZ/index.html';

const mockElectronAPI = {
  drive: {
    getFolderTree: vi.fn(),
    countFolderFiles: vi.fn(),
    createManifest: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
});

const singleRootFolderTree = [{ id: 'root-folder-1', name: 'Root', parentId: '', path: '/' }];

describe('CreateManifestModal — create-manifest link contract (SYNC-18 follow-up)', () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.drive.getFolderTree.mockResolvedValue({ success: true, data: singleRootFolderTree });
    mockElectronAPI.drive.countFolderFiles.mockResolvedValue({
      success: true,
      data: { fileCount: 3, estimatedCost: 0 },
    });
  });

  const renderModal = () =>
    render(
      <CreateManifestModal
        driveId="drive-1"
        driveName="My Drive"
        onClose={onClose}
        onSuccess={onSuccess}
        toast={toast}
      />
    );

  const proceedToConfirmationAndCreate = async () => {
    renderModal();

    // Single root folder auto-selects, enabling Next.
    await waitFor(() => expect(screen.getByText('Next')).not.toBeDisabled());
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => expect(mockElectronAPI.drive.countFolderFiles).toHaveBeenCalledWith('drive-1', 'root-folder-1'));
    await screen.findByText('Confirm & Create');

    fireEvent.click(screen.getByText('Confirm & Create'));
  };

  it('forwards the manifest URL from the IPC envelope to onSuccess UNCHANGED — still the configured gateway, never arweave.net', async () => {
    mockElectronAPI.drive.createManifest.mockResolvedValue({
      success: true,
      data: {
        manifestUrl: GATEWAY_MANIFEST_URL,
        fileUrls: [GATEWAY_FILE_URL],
        txId: 'TX_MANIFEST_XYZ',
        fileCount: 3,
        manifestName: 'DriveManifest.json',
      },
    });

    await proceedToConfirmationAndCreate();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // Load-bearing: the exact string round-trips with no rewriting.
    expect(onSuccess).toHaveBeenCalledWith(GATEWAY_MANIFEST_URL);
    expect(onSuccess.mock.calls[0][0]).not.toContain('arweave.net');
    expect(onSuccess.mock.calls[0][0].startsWith('https://turbo-gateway.com/')).toBe(true);

    expect(mockElectronAPI.drive.createManifest).toHaveBeenCalledWith({
      driveId: 'drive-1',
      folderId: 'root-folder-1',
      manifestName: 'DriveManifest.json',
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('3 files'));

    // UX-33: the modal no longer closes itself on success — it stays open on
    // the "Site Deployed" view so the link isn't only reachable via onSuccess.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('UX-33: shows a persistent "Site Deployed" view with the URL, a working Copy Link button, and an Open button — not just a toast', async () => {
    mockElectronAPI.drive.createManifest.mockResolvedValue({
      success: true,
      data: {
        manifestUrl: GATEWAY_MANIFEST_URL,
        fileUrls: [GATEWAY_FILE_URL],
        txId: 'TX_MANIFEST_XYZ',
        fileCount: 3,
        manifestName: 'DriveManifest.json',
      },
    });

    await proceedToConfirmationAndCreate();

    // The deployed view renders the exact URL as visible text in the modal,
    // not just as an argument passed to a callback.
    await screen.findByText('Site Deployed');
    expect(screen.getByText(GATEWAY_MANIFEST_URL)).toBeInTheDocument();

    // Copy Link actually copies the rendered URL to the clipboard and confirms via toast.
    const copyButton = screen.getByRole('button', { name: /copy link/i });
    fireEvent.click(copyButton);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GATEWAY_MANIFEST_URL));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('copied')));
    await screen.findByRole('button', { name: /copied!/i });

    // Open hands the exact URL to the shell — never a re-derived/hardcoded link.
    const openButton = screen.getByRole('button', { name: /^open$/i });
    fireEvent.click(openButton);
    await waitFor(() => expect(mockElectronAPI.shell.openExternal).toHaveBeenCalledWith(GATEWAY_MANIFEST_URL));

    // Modal stays open and dismissible (Escape) rather than being forced shut.
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not call onSuccess and surfaces the error when the handler envelope reports failure', async () => {
    mockElectronAPI.drive.createManifest.mockResolvedValue({
      success: false,
      error: 'Private drive is locked',
    });

    await proceedToConfirmationAndCreate();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Private drive is locked'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the user-edited manifest name through to the IPC call', async () => {
    mockElectronAPI.drive.createManifest.mockResolvedValue({
      success: true,
      data: {
        manifestUrl: GATEWAY_MANIFEST_URL,
        fileUrls: [],
        txId: 'TX_MANIFEST_XYZ',
        fileCount: 3,
        manifestName: 'MySite.json',
      },
    });

    renderModal();
    await waitFor(() => expect(screen.getByText('Next')).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText('Manifest Name'), { target: { value: 'MySite.json' } });
    fireEvent.click(screen.getByText('Next'));

    await screen.findByText('Confirm & Create');
    fireEvent.click(screen.getByText('Confirm & Create'));

    await waitFor(() =>
      expect(mockElectronAPI.drive.createManifest).toHaveBeenCalledWith(
        expect.objectContaining({ manifestName: 'MySite.json' })
      )
    );
  });
});
