// SYNC-20: setup must SURVIVE a transient gateway 404 — never hang on
// "Starting sync engine…", and never re-create the drive when the user retries.
//
// Live UAT (UAT-RUN-2-LIVE-2026-07-05, defect #1/#6): after a drive was created,
// a `Request to gateway has failed: (Status: 404)` at sync-start left the wizard
// stuck on "Starting sync engine…" (loading forever, no error, no way out).
//
// These tests assert the graceful-fail contract at the component boundary:
//   (b) a persistent sync-start failure lands in an ERROR-with-retry state
//       (honest gateway copy + "Try Again") — NOT a permanent loading state.
//   (a) retrying self-heals AND is idempotent — the drive is created exactly
//       once (no duplicate on-chain write / spend), even though setup ran twice.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DriveAndSyncSetup from '../../../src/renderer/components/DriveAndSyncSetup';

const createdDrive = {
  id: 'drive-123',
  name: 'My Files',
  privacy: 'public' as const,
  rootFolderId: 'root-123',
  metadataTxId: 'tx-123',
  dateCreated: 0,
  size: 0,
};

const gateway404 = 'Request to gateway has failed: (Status: 404) Not Found';

let api: any;

const buildApi = () => ({
  system: {
    // Dev-mode auto-fill of the sync folder so the test doesn't have to drive
    // the native folder picker.
    getEnv: vi.fn(async (key: string) => {
      if (key === 'ARDRIVE_DEV_MODE') return { success: true, data: 'true' };
      if (key === 'ARDRIVE_DEV_SYNC_FOLDER') return { success: true, data: 'C:\\ARDRIVE' };
      return { success: true, data: undefined };
    }),
  },
  wallet: {
    getInfo: vi.fn(async () => ({ success: true, data: { address: 'addr-1' } })),
  },
  drive: {
    create: vi.fn(async () => ({ success: true, data: createdDrive })),
  },
  sync: {
    setFolder: vi.fn(async () => ({ success: true, data: true })),
    start: vi.fn(async () => ({ success: true, data: true })),
  },
  driveMappings: {
    add: vi.fn(async () => ({ success: true, data: true })),
  },
  config: {
    markFirstRunComplete: vi.fn(async () => ({ success: true, data: true })),
    get: vi.fn(async () => ({ success: true, data: {} })),
  },
  dialog: {
    selectFolder: vi.fn(async () => ({ success: true, data: 'C:\\ARDRIVE' })),
  },
  onSyncProgress: vi.fn(),
  removeSyncProgressListener: vi.fn(),
});

const reachSummaryAndComplete = async () => {
  // Wait for the dev-mode useEffect to auto-fill the sync folder (enables the
  // Continue button), then advance to the summary and start setup.
  const continueBtn = await screen.findByRole('button', { name: /continue to review/i });
  await waitFor(() => expect(continueBtn).not.toBeDisabled());
  fireEvent.click(continueBtn);
  fireEvent.click(await screen.findByRole('button', { name: /complete setup/i }));
};

describe('SYNC-20 · DriveAndSyncSetup survives transient gateway 404s', () => {
  beforeEach(() => {
    api = buildApi();
    Object.defineProperty(window, 'electronAPI', { value: api, writable: true });
  });

  it('(b) a persistent sync-start 404 lands in an error-with-retry state, NOT a permanent loading state', async () => {
    api.sync.start.mockResolvedValue({ success: false, error: gateway404 });

    render(<DriveAndSyncSetup onSetupComplete={vi.fn()} isReturningUser={false} />);
    await reachSummaryAndComplete();

    // Honest, actionable gateway copy — not the raw "(Status: 404)".
    expect(await screen.findByText(/couldn't reach the arweave gateway/i)).toBeInTheDocument();
    // A concrete way forward.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    // Crucially: NOT stuck on the loading label.
    expect(screen.queryByText(/setting up\.\.\./i)).not.toBeInTheDocument();

    // The drive was created once; a failed start must not have re-created it.
    expect(api.drive.create).toHaveBeenCalledTimes(1);
  });

  it('(a) retrying after a transient failure SUCCEEDS and does NOT re-create the drive (idempotent, no double-spend)', async () => {
    // Fail the first start, succeed the second — the transient 404 self-heals.
    api.sync.start
      .mockResolvedValueOnce({ success: false, error: gateway404 })
      .mockResolvedValueOnce({ success: true, data: true });

    render(<DriveAndSyncSetup onSetupComplete={vi.fn()} isReturningUser={false} />);
    await reachSummaryAndComplete();

    const retryBtn = await screen.findByRole('button', { name: /try again/i });
    fireEvent.click(retryBtn);

    // Setup completed: the success screen appears.
    expect(await screen.findByText(/your drive is ready/i)).toBeInTheDocument();

    // Idempotency guarantees — the permanent/costly writes ran exactly once
    // across BOTH attempts; only the retryable tail (sync.start) ran twice.
    expect(api.drive.create).toHaveBeenCalledTimes(1);
    expect(api.driveMappings.add).toHaveBeenCalledTimes(1);
    expect(api.sync.start).toHaveBeenCalledTimes(2);
  });
});
