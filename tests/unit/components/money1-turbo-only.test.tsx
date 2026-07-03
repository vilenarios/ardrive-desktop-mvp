// MONEY-1 (D-010 Turbo-only beta): the AR "payment method" was cosmetic —
// ardrive-core is hardwired to Turbo via factory turboSettings, so every
// upload labelled or recorded as "AR" actually charged Turbo Credits.
// These tests prove, against DB-shaped rows (sqlite integer booleans, null
// quotes — CLAUDE.md trap 6):
//   1. no AR payment choice renders anywhere in the queue, including for
//      rows that previously fell back to the 'ar' rail (unquoted /
//      insufficient-balance rows);
//   2. a row with a real quote the balance cannot cover is BLOCKED from
//      approval with a visible reason (and a top-up affordance);
//   3. Approve & Upload SKIPS insufficient rows with a visible skipped-count
//      reason while approving the rest;
//   4. free-tier rows are approvable with zero balance;
//   5. everything the queue submits is submitted as 'turbo'.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UploadApprovalQueueModern from '../../../src/renderer/components/UploadApprovalQueueModern';

const mockElectronAPI = {
  onUploadProgress: vi.fn(),
  removeUploadProgressListener: vi.fn(),
  uploads: { cancel: vi.fn() },
};
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const FILE_SIZE_5MB = 5 * 1024 * 1024;
const FILE_SIZE_50KB = 50 * 1024;

// Row shape as produced by sqlite3 → uploads:get-pending → IPC: BOOLEAN
// columns as 0/1 integers, missing quotes as null. Adversarial default:
// recommendedMethod 'ar' — exactly the rows the old code routed to the
// fictional AR rail.
const dbShapedRow = (overrides: Record<string, unknown> = {}) => ({
  id: `upload-${Math.random().toString(36).slice(2)}`,
  localPath: '/sync/folder/file.bin',
  fileName: 'file.bin',
  fileSize: FILE_SIZE_5MB,
  estimatedCost: FILE_SIZE_5MB / 1e12, // internal placeholder, never a price
  estimatedTurboCost: null,            // SQLite NULL (no quote)
  hasSufficientTurboBalance: 0,        // SQLite false -> integer 0
  recommendedMethod: 'ar',
  conflictType: 'none',
  status: 'awaiting_approval',
  operationType: 'upload',
  createdAt: new Date(),
  ...overrides,
});

const makeProps = () => ({
  onApproveUpload: vi.fn(),
  onRejectUpload: vi.fn(),
  onApproveAll: vi.fn().mockResolvedValue(undefined),
  onRejectAll: vi.fn(),
  onTopUpCredits: vi.fn(),
  walletInfo: { balance: '1.0000', turboBalance: '0.0000' },
});

describe('MONEY-1: no AR payment choice anywhere in the queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no payment-method selector for rows that previously fell back to AR', () => {
    const props = makeProps();
    render(
      <UploadApprovalQueueModern
        {...props}
        pendingUploads={[
          // unquoted paid row (old code: method 'ar')
          dbShapedRow({ fileName: 'unquoted.bin' }),
          // real quote, balance cannot cover (old code: method 'ar' + approve submitted 'ar')
          dbShapedRow({ fileName: 'poor.bin', estimatedTurboCost: 0.05 }),
          // free-tier row
          dbShapedRow({ fileName: 'small.bin', fileSize: FILE_SIZE_50KB }),
          // metadata-only op
          dbShapedRow({ fileName: 'renamed.bin', operationType: 'rename', previousPath: '/sync/folder/old.bin' }),
        ] as any}
      />
    );

    // The removed "Payment Method" advanced radio and its trigger
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText('Payment Method')).toBeNull();
    expect(screen.queryByText('AR Only')).toBeNull();
    expect(screen.queryByText('Turbo Only')).toBeNull();
    expect(screen.queryByText('Auto (Best price)')).toBeNull();
    expect(screen.queryByText('More Settings')).toBeNull();

    // The AR *wallet balance* is real wallet info, not a payment choice — it stays
    expect(screen.getByText('AR Balance')).toBeInTheDocument();
  });

  it('submits every approvable row as turbo — never ar (adversarial recommendedMethod)', async () => {
    const props = makeProps();
    const unquoted = dbShapedRow({ fileName: 'unquoted.bin' });
    const free = dbShapedRow({ fileName: 'small.bin', fileSize: FILE_SIZE_50KB });

    render(<UploadApprovalQueueModern {...props} pendingUploads={[unquoted, free] as any} />);

    fireEvent.click(screen.getByText(/Approve & Upload/));

    await waitFor(() => expect(props.onApproveUpload).toHaveBeenCalledTimes(2), { timeout: 3000 });

    expect(props.onApproveUpload).toHaveBeenCalledWith(unquoted.id, 'turbo', undefined);
    expect(props.onApproveUpload).toHaveBeenCalledWith(free.id, 'turbo', undefined);
    for (const call of props.onApproveUpload.mock.calls) {
      expect(call[1]).toBe('turbo');
    }
  });
});

describe('MONEY-1: insufficient-balance approval semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks approval of a quoted row the balance cannot cover, with a visible reason', () => {
    const props = makeProps();
    const poor = dbShapedRow({ fileName: 'poor.bin', estimatedTurboCost: 0.05 });

    render(<UploadApprovalQueueModern {...props} pendingUploads={[poor] as any} />);

    // Visible reason on the row: the real quote stays visible (row + banner
    // total), plus the block reason
    expect(screen.getAllByText('0.0500 Credits').length).toBe(2);
    expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();

    // The approve button is disabled and says why
    const button = screen.getByRole('button', { name: /Insufficient Turbo Credits/ });
    expect(button).toBeDisabled();

    // Clicking it submits nothing
    fireEvent.click(button);
    expect(props.onApproveAll).not.toHaveBeenCalled();
    expect(props.onApproveUpload).not.toHaveBeenCalled();
  });

  it('offers a top-up affordance on the blocked row that opens the Turbo manager', () => {
    const props = makeProps();
    render(
      <UploadApprovalQueueModern
        {...props}
        pendingUploads={[dbShapedRow({ fileName: 'poor.bin', estimatedTurboCost: 0.05 })] as any}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /top up Turbo Credits/i }));
    expect(props.onTopUpCredits).toHaveBeenCalledTimes(1);
  });

  it('renders the block reason as plain text when no top-up hook is provided', () => {
    const { onTopUpCredits: _omitted, ...props } = makeProps();
    render(
      <UploadApprovalQueueModern
        {...(props as any)}
        pendingUploads={[dbShapedRow({ fileName: 'poor.bin', estimatedTurboCost: 0.05 })] as any}
      />
    );

    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /top up Turbo Credits/i })).toBeNull();
  });

  it('approve-all skips insufficient rows with a visible skipped-count reason and approves the rest', async () => {
    const props = makeProps();
    const poor = dbShapedRow({ fileName: 'poor.bin', estimatedTurboCost: 0.05 });
    const free = dbShapedRow({ fileName: 'small.bin', fileSize: FILE_SIZE_50KB });
    const unquoted = dbShapedRow({ fileName: 'unquoted.bin' });

    render(<UploadApprovalQueueModern {...props} pendingUploads={[poor, free, unquoted] as any} />);

    fireEvent.click(screen.getByText(/Approve & Upload/));

    await waitFor(() => expect(props.onApproveUpload).toHaveBeenCalledTimes(2), { timeout: 3000 });

    // The blocked row was never submitted — by any path
    expect(props.onApproveUpload).not.toHaveBeenCalledWith(poor.id, expect.anything(), expect.anything());

    // Visible skipped-count reason
    expect(screen.getByText(/1 file skipped — insufficient Turbo Credits/)).toBeInTheDocument();
  });

  it('free-tier row is approvable with zero Turbo balance', async () => {
    const props = makeProps(); // turboBalance '0.0000'
    const free = dbShapedRow({ fileName: 'small.bin', fileSize: FILE_SIZE_50KB });

    render(<UploadApprovalQueueModern {...props} pendingUploads={[free] as any} />);

    const button = screen.getByRole('button', { name: /Approve & Upload/ });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => expect(props.onApproveUpload).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(props.onApproveUpload).toHaveBeenCalledWith(free.id, 'turbo', undefined);
    expect(props.onApproveAll).toHaveBeenCalledTimes(1);

    // Nothing was skipped, so no skipped-count reason
    expect(screen.queryByText(/skipped — insufficient Turbo Credits/)).toBeNull();
  });
});
