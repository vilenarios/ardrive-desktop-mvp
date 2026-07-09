// [DB-2 finding, MONEY-15] StorageTab's own DB-boundary defense is fragile.
//
// StorageTab.tsx:183 normalizes the `isHidden` flag it receives over IPC
// with a STRICT equality check: `isHidden: item.isHidden === true`. That is
// exactly the anti-pattern CLAUDE.md's known trap #6 warns about: SQLite
// BOOLEAN columns come back through node-sqlite3 as 0/1 integers, and
// `1 === true` is `false` in JS.
//
// Today this never misfires in production because main.ts pre-converts the
// value before it reaches the renderer (main.ts:1187 `item.isHidden === 1`
// for the cached-metadata path, main.ts:1373 `entity.isHidden === true` for
// the fresh-entities path) — see the companion database-manager.test.ts
// block "drive metadata cache — localFileExists/isHidden not normalized
// [DB-2 finding]", which proves database-manager.getDriveMetadata() itself
// does NOT normalize isHidden (it returns whatever sqlite handed back). If
// any future IPC path forwards a drive_metadata_cache row without main.ts's
// manual `=== 1` guard — plausible, since getDriveMetadata/getFilesByStatus
// provide no defense in depth — StorageTab silently treats an
// actually-hidden file as visible: no "Hidden" badge, no "Unhide on Arweave"
// action. A user could never discover or restore a hidden file through the
// UI in that scenario.
//
// This test proves the failure mode directly at the renderer boundary,
// independent of whether main.ts currently guards it: feed StorageTab a
// clean JS fixture (`isHidden: true`) and a DB-shaped fixture
// (`isHidden: 1`, the literal integer sqlite3 returns for that column) and
// show the clean one renders the Hidden badge while the DB-shaped one does
// not — the hallmark "clean fixture passes / DB-shaped fixture fails"
// pattern this whole hardening pass is about.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StorageTab } from '../../../src/renderer/components/dashboard/StorageTab';
import { DriveInfo, AppConfig } from '../../../src/types';

// The IPC-boundary shape of a permaweb-file item as StorageTab consumes it.
// `isHidden` is deliberately `unknown` so both the clean (boolean) and the
// DB-shaped (raw sqlite integer) fixtures below are assignable — this test
// exists precisely to feed the DB-shaped form through.
type PermawebFileItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  modifiedAt: number;
  isDownloaded: boolean;
  status: string;
  path: string;
  parentId: string;
  ardriveUrl: string;
  dataTxId: string;
  metadataTxId: string;
  isHidden: unknown;
};

const mockElectronAPI = {
  drive: {
    getPermawebFiles: vi.fn(async () => ({ success: true, data: [] as PermawebFileItem[] })),
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

// Shape of a single item as it would leave the IPC handler — everything a
// real permaweb-file item needs, varying only `isHidden`.
const permawebItem = (isHidden: unknown) => ({
  id: 'file-1',
  name: 'secret.txt',
  type: 'file',
  size: 100,
  modifiedAt: new Date('2026-07-01T00:00:00.000Z').getTime(),
  isDownloaded: true,
  status: 'synced',
  path: '/',
  parentId: '',
  ardriveUrl: 'https://app.ardrive.io/#/file/file-1/view',
  dataTxId: 'tx-1',
  metadataTxId: 'meta-tx-1',
  isHidden,
});

describe('StorageTab isHidden DB-shape coupling [DB-2 finding]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clean fixture (isHidden: true) renders the Hidden badge', async () => {
    mockElectronAPI.drive.getPermawebFiles.mockResolvedValue({
      success: true,
      data: [permawebItem(true)],
    });

    render(
      <StorageTab drive={drive} config={config} syncStatus={null} onDriveDeleted={() => {}} />
    );

    expect(await screen.findByText('secret.txt')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('BUG-RISK: DB-shaped fixture (isHidden: 1, the raw sqlite integer) does NOT render the Hidden badge', async () => {
    mockElectronAPI.drive.getPermawebFiles.mockResolvedValue({
      success: true,
      data: [permawebItem(1)],
    });

    render(
      <StorageTab drive={drive} config={config} syncStatus={null} onDriveDeleted={() => {}} />
    );

    expect(await screen.findByText('secret.txt')).toBeInTheDocument();
    // StorageTab.tsx:183 `item.isHidden === true` is false for the integer
    // 1, so the file — which IS hidden on Arweave — renders exactly like a
    // normal, visible file. This is the documented finding: StorageTab has
    // no defense in depth against the DB-shaped form of this field.
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
});
