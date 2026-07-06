// FEAT-6: permanent version history modal. These tests prove the modal
//   - lists every recorded revision (newest-first) with View + Download actions,
//   - links each version through the CONFIGURED gateway (turbo-gateway.com),
//     never arweave.net,
//   - shows the honest single-version empty state ("Only one version so far"),
//   - is strictly read-only: viewing/downloading a version NEVER triggers an
//     upload (no funds can be spent from this window).
// Version fixtures use the shape the renderer actually receives over IPC:
// getFileVersions normalizes isLatest to a real boolean, and Date fields are
// serialized to ISO strings across the IPC boundary.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VersionHistory } from '../../../src/renderer/components/dashboard/VersionHistory';
import { invalidateGatewayHostCache } from '../../../src/renderer/utils/gateway';

const getVersions = vi.fn();
const openExternal = vi.fn().mockResolvedValue({ success: true, data: true });
const configGet = vi
  .fn()
  .mockResolvedValue({ success: true, data: { gatewayHost: 'turbo-gateway.com' } });

// Upload rails that must NEVER be reachable from the version-history window.
const uploadsApprove = vi.fn();
const queueDownload = vi.fn();
const redownloadAll = vi.fn();

const mockElectronAPI = {
  files: {
    getVersions,
    queueDownload,
    redownloadAll,
  },
  uploads: {
    approve: uploadsApprove,
    approveAll: vi.fn(),
  },
  shell: {
    openExternal,
  },
  config: {
    get: configGet,
  },
};

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

const version = (overrides: Record<string, unknown> = {}) => ({
  id: `v-${Math.random().toString(36).slice(2)}`,
  fileHash: 'hash',
  fileName: 'report.txt',
  filePath: '/sync/report.txt',
  relativePath: 'report.txt',
  fileSize: 2048,
  arweaveId: 'AR_TX_LATEST_00000000000000000000000000000',
  turboId: undefined,
  version: 3,
  parentVersion: undefined,
  changeType: 'update',
  uploadMethod: 'turbo',
  createdAt: new Date('2026-07-04T12:00:00Z').toISOString(),
  isLatest: true,
  ...overrides,
});

const threeVersions = [
  version({ version: 3, isLatest: true, changeType: 'update', arweaveId: 'TX_V3_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  version({ version: 2, isLatest: false, changeType: 'update', arweaveId: undefined, turboId: 'TX_V2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
  version({ version: 1, isLatest: false, changeType: 'create', arweaveId: 'TX_V1_cccccccccccccccccccccccccccccccccc' }),
];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  fileName: 'report.txt',
  filePath: '/sync/report.txt',
  isPrivateDrive: false,
};

describe('VersionHistory (FEAT-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateGatewayHostCache();
    configGet.mockResolvedValue({ success: true, data: { gatewayHost: 'turbo-gateway.com' } });
    openExternal.mockResolvedValue({ success: true, data: true });
  });

  it('lists every recorded version, newest-first, with View + Download actions', async () => {
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    render(<VersionHistory {...baseProps} />);

    // All three revisions rendered.
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);

    // Newest-first: v3 before v2 before v1.
    expect(within(items[0]).getByText('v3')).toBeInTheDocument();
    expect(within(items[1]).getByText('v2')).toBeInTheDocument();
    expect(within(items[2]).getByText('v1')).toBeInTheDocument();

    // Latest badge only on the newest.
    expect(within(items[0]).getByText('Latest')).toBeInTheDocument();
    expect(within(items[1]).queryByText('Latest')).not.toBeInTheDocument();

    // View + Download actions available on the latest (which has a tx id).
    expect(within(items[0]).getByRole('button', { name: /view version 3/i })).toBeEnabled();
    expect(within(items[0]).getByRole('button', { name: /download a copy of version 3/i })).toBeEnabled();

    // The DB is queried with the file's absolute path.
    expect(getVersions).toHaveBeenCalledWith('/sync/report.txt');
  });

  it('View/Download link through the CONFIGURED gateway (turbo-gateway.com), never arweave.net', async () => {
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    render(<VersionHistory {...baseProps} />);

    const items = await screen.findAllByRole('listitem');

    fireEvent.click(within(items[0]).getByRole('button', { name: /view version 3/i }));
    await waitFor(() => expect(openExternal).toHaveBeenCalled());

    const openedUrl = openExternal.mock.calls[0][0] as string;
    expect(openedUrl).toBe('https://turbo-gateway.com/TX_V3_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(openedUrl).not.toContain('arweave.net');

    // The Turbo-rail version (v2) links via its turboId.
    fireEvent.click(within(items[1]).getByRole('button', { name: /download a copy of version 2/i }));
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2));
    expect(openExternal.mock.calls[1][0]).toBe('https://turbo-gateway.com/TX_V2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('shows the honest single-version empty state', async () => {
    getVersions.mockResolvedValue({ success: true, data: [version({ version: 1, isLatest: true, changeType: 'create' })] });
    render(<VersionHistory {...baseProps} />);

    expect(await screen.findByText(/only one version so far/i)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows an honest empty state (not an error) when a file has no recorded versions', async () => {
    getVersions.mockResolvedValue({ success: true, data: [] });
    render(<VersionHistory {...baseProps} />);

    expect(await screen.findByText(/no versions recorded yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('is read-only: viewing or downloading a version NEVER triggers an upload', async () => {
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    render(<VersionHistory {...baseProps} />);

    const items = await screen.findAllByRole('listitem');

    fireEvent.click(within(items[0]).getByRole('button', { name: /view version 3/i }));
    fireEvent.click(within(items[0]).getByRole('button', { name: /download a copy of version 3/i }));
    fireEvent.click(within(items[2]).getByRole('button', { name: /download a copy of version 1/i }));

    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(3));

    // No spend-capable IPC is ever reachable from this window.
    expect(uploadsApprove).not.toHaveBeenCalled();
    expect(queueDownload).not.toHaveBeenCalled();
    expect(redownloadAll).not.toHaveBeenCalled();
  });

  it('degrades honestly: a version with no on-chain tx id has disabled View/Download', async () => {
    getVersions.mockResolvedValue({
      success: true,
      data: [
        version({ version: 2, isLatest: true, arweaveId: 'TX_OK_dddddddddddddddddddddddddddddddddd', turboId: undefined }),
        version({ version: 1, isLatest: false, arweaveId: undefined, turboId: undefined, changeType: 'create' }),
      ],
    });
    render(<VersionHistory {...baseProps} />);

    const items = await screen.findAllByRole('listitem');
    // v1 has no tx id → its actions are disabled (never faked).
    expect(within(items[1]).getByRole('button', { name: /view version 1/i })).toBeDisabled();
    expect(within(items[1]).getByRole('button', { name: /download a copy of version 1/i })).toBeDisabled();
  });

  it('gates private-drive versions behind the drive key (no plaintext gateway fetch)', async () => {
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    render(<VersionHistory {...baseProps} isPrivateDrive={true} />);

    const items = await screen.findAllByRole('listitem');
    // Even with a tx id, a private-drive version is not offered as a raw
    // gateway fetch (that would return ciphertext).
    expect(within(items[0]).getByRole('button', { name: /view version 3/i })).toBeDisabled();
    expect(screen.getByText(/private drive/i)).toBeInTheDocument();
  });

  it('D2: copy-link is gated exactly like View/Download — enabled on public, disabled on private', async () => {
    // Public drive with a tx id: copy the permanent link is offered.
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    const { unmount } = render(<VersionHistory {...baseProps} />);
    let items = await screen.findAllByRole('listitem');
    expect(
      within(items[0]).getByRole('button', { name: /copy permanent link to version 3/i })
    ).toBeEnabled();
    unmount();

    // Private drive: the gateway URL would resolve to ciphertext, so a
    // "permanent link" must NOT be copyable — gated the same as View/Download,
    // not left enabled while View/Download are honestly disabled.
    getVersions.mockResolvedValue({ success: true, data: threeVersions });
    render(<VersionHistory {...baseProps} isPrivateDrive={true} />);
    items = await screen.findAllByRole('listitem');
    expect(
      within(items[0]).getByRole('button', { name: /copy permanent link to version 3/i })
    ).toBeDisabled();
  });
});
