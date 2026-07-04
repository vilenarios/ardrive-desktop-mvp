// MONEY-3: the upload approval queue must never display fabricated pricing.
// - No USD figures (the old ones were derived from a hardcoded mock rate of
//   $6.50/AR in ar-price-utils.ts, now deleted).
// - When no real Turbo quote exists, the queue renders an explicit
//   "Estimate unavailable" state — not the internal 1-winston/byte AR
//   placeholder, and not a synthetic Turbo number.
// - Real Turbo quotes (Credits) still render.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import UploadApprovalQueueModern from '../../../src/renderer/components/UploadApprovalQueueModern';
import { PendingUpload } from '../../../src/types';

// Mock the window.electronAPI surface the component touches
const mockElectronAPI = {
  onUploadProgress: vi.fn(),
  removeUploadProgressListener: vi.fn(),
  uploads: {
    cancel: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const FILE_SIZE_5MB = 5 * 1024 * 1024;

const makeUpload = (overrides: Partial<PendingUpload> = {}): PendingUpload => ({
  id: `upload-${Math.random().toString(36).slice(2)}`,
  localPath: '/sync/folder/photo.jpg',
  fileName: 'photo.jpg',
  fileSize: FILE_SIZE_5MB,
  mimeType: 'image/jpeg',
  // Internal placeholder (1 winston/byte) — must never be rendered as a price
  estimatedCost: FILE_SIZE_5MB / 1e12,
  conflictType: 'none',
  status: 'awaiting_approval',
  operationType: 'upload',
  createdAt: new Date(),
  ...overrides,
});

const defaultProps = {
  onApproveUpload: vi.fn(),
  onRejectUpload: vi.fn(),
  onApproveAll: vi.fn(),
  onRejectAll: vi.fn(),
  onResolveConflict: vi.fn(),
  walletInfo: {
    balance: '1.2345',
    turboBalance: '0.5000',
  },
};

const renderQueue = (pendingUploads: PendingUpload[]) =>
  render(<UploadApprovalQueueModern {...defaultProps} pendingUploads={pendingUploads} />);

describe('UploadApprovalQueueModern cost display (MONEY-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an explicit unavailable state when there is no real Turbo quote', () => {
    const { container } = renderQueue([
      makeUpload({
        estimatedTurboCost: undefined, // Turbo quote unavailable
        hasSufficientTurboBalance: false,
      }),
    ]);

    // Both the total banner and the file row say so explicitly
    expect(screen.getAllByText('Estimate unavailable').length).toBe(2);

    // The internal 1-winston/byte AR placeholder must not leak into the UI
    // as a price (5 MiB -> "0.000005" AR)
    expect(container.textContent).not.toMatch(/0\.000005/);
    // Nor the old synthetic ×1.1 Turbo fallback
    expect(container.textContent).not.toMatch(/0\.0000058/);
  });

  it('never renders USD anywhere (mock exchange rate removed)', () => {
    const scenarios: PendingUpload[][] = [
      // unavailable quote
      [makeUpload({ estimatedTurboCost: undefined, hasSufficientTurboBalance: false })],
      // real quote
      [makeUpload({ estimatedTurboCost: 0.0123, hasSufficientTurboBalance: true })],
      // real quote, insufficient balance
      [makeUpload({ estimatedTurboCost: 0.0123, hasSufficientTurboBalance: false })],
      // free file
      [makeUpload({ fileSize: 50 * 1024, estimatedCost: (50 * 1024) / 1e12 })],
    ];

    for (const pendingUploads of scenarios) {
      const { container, unmount } = renderQueue(pendingUploads);
      expect(container.textContent).not.toContain('$');
      unmount();
    }
  });

  it('renders a real Turbo quote in Credits (row and total)', () => {
    renderQueue([
      makeUpload({
        estimatedTurboCost: 0.0123,
        hasSufficientTurboBalance: true,
      }),
    ]);

    // Row cost + banner total both show the real quote
    expect(screen.getAllByText('0.0123 Credits').length).toBe(2);
    expect(screen.queryByText(/estimate unavailable/i)).toBeNull();
  });

  it('shows the real quote WITH an insufficient-balance indication (real info stays visible)', () => {
    const { container } = renderQueue([
      makeUpload({
        estimatedTurboCost: 0.0123, // real quote from the payment service
        hasSufficientTurboBalance: false, // ...but the balance cannot cover it
      }),
    ]);

    // Row shows the real quote; banner total includes it (the cost IS known)
    expect(screen.getAllByText('0.0123 Credits').length).toBe(2);
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
    // "Estimate unavailable" is reserved for genuinely absent quotes
    expect(screen.queryByText('Estimate unavailable')).toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('treats the DB-shaped insufficient flag (integer 0) the same as false', () => {
    renderQueue([
      makeUpload({
        estimatedTurboCost: 0.0123,
        hasSufficientTurboBalance: 0 as unknown as boolean, // raw sqlite shape
      }),
    ]);

    expect(screen.getAllByText('0.0123 Credits').length).toBe(2);
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('shows FREE for files within the Turbo free tier', () => {
    renderQueue([
      makeUpload({
        fileSize: 50 * 1024,
        estimatedCost: (50 * 1024) / 1e12,
      }),
    ]);

    // Banner total + file row
    expect(screen.getAllByText('FREE').length).toBe(2);
  });

  it('mixed queue: totals only the real quotes and counts unavailable files honestly', () => {
    const { container } = renderQueue([
      makeUpload({
        fileName: 'quoted.bin',
        estimatedTurboCost: 0.01,
        hasSufficientTurboBalance: true,
      }),
      makeUpload({
        fileName: 'unquoted.bin',
        estimatedTurboCost: undefined,
        hasSufficientTurboBalance: false,
      }),
    ]);

    // Banner total + quoted file's row: real credits, twice
    expect(screen.getAllByText('0.0100 Credits').length).toBe(2);
    // ...plus an explicit unavailable count for the rest (no summed fake total)
    expect(screen.getByText(/^\+ 1 file: estimate unavailable$/i)).toBeInTheDocument();
    // Row for the unquoted file
    expect(screen.getByText('Estimate unavailable')).toBeInTheDocument();
    expect(container.textContent).not.toContain('$');
  });

  it('renders wallet balances as raw AR/Credits with no converted USD figure', () => {
    const { container } = renderQueue([
      makeUpload({ estimatedTurboCost: 0.0123, hasSufficientTurboBalance: true }),
    ]);

    expect(screen.getByText('AR Balance')).toBeInTheDocument();
    expect(screen.getByText(/^1\.2345 AR$/)).toBeInTheDocument();
    expect(screen.getByText(/^0\.5000 Credits$/)).toBeInTheDocument();
    // The old UI appended "(...$...)" conversions derived from the mock rate
    expect(container.textContent).not.toContain('$');
  });

  it('shows metadata-only operations (move/rename) as Free, not a fabricated cost', () => {
    renderQueue([
      makeUpload({
        operationType: 'rename',
        previousPath: '/sync/folder/old-name.jpg',
        // sync-manager stamps metadata ops with a nominal 0.000001 — the UI
        // must not present that as a price
        estimatedCost: 0.000001,
        estimatedTurboCost: 0.000001,
        hasSufficientTurboBalance: true,
      }),
    ]);

    // Banner FREE (all ops free) + row FREE
    expect(screen.getAllByText(/^FREE$/i).length).toBe(2);
    expect(screen.queryByText(/0\.0000 Credits/)).toBeNull();
  });

  // MONEY-13: wallet-manager-secure.getWalletInfo() reports an unavailable
  // AR balance (e.g. a gateway 429) as '' — the approval queue must show
  // an explicit unavailable state, never "NaN AR".
  it('shows an explicit unavailable state instead of "NaN AR" when the balance fetch failed', () => {
    render(
      <UploadApprovalQueueModern
        {...defaultProps}
        walletInfo={{ balance: '', turboBalance: '0.5000' }}
        pendingUploads={[makeUpload({ estimatedTurboCost: 0.0123, hasSufficientTurboBalance: true })]}
      />
    );

    expect(screen.getByText('AR Balance')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('fixture sanity: an un-guarded NaN-shaped balance string would render "NaN AR" (proves the guard has teeth)', () => {
    // Simulates the pre-fix behavior: winstonToAr() on a non-numeric body
    // produced the literal string 'NaN', which parseFloat().toFixed(4)
    // faithfully reproduces as 'NaN'.
    expect(parseFloat('NaN').toFixed(4)).toBe('NaN');
  });
});

describe('Delete -> ArFS hide honesty (SYNC-5 / D-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels a delete-driven hide op as hidden-not-erased (permanent storage cannot delete)', () => {
    const { container } = renderQueue([
      makeUpload({
        fileName: 'secret.txt',
        operationType: 'hide',
        previousPath: '/sync/folder/secret.txt',
        estimatedCost: 0,
        estimatedTurboCost: 0,
        hasSufficientTurboBalance: true,
        metadata: { isHidden: true },
      }),
    ]);

    // Honest permanence: the op says it is HIDDEN on Arweave, not erased.
    expect(screen.getByText(/hide on Arweave \(can't be erased\)/i)).toBeInTheDocument();
    // The old dishonest wording must be gone.
    expect(container.textContent).not.toMatch(/Delete from permaweb/i);
    expect(container.textContent).not.toMatch(/Hide file from view/i);
    // A hide is free (metadata-only) — no fabricated price.
    expect(screen.getAllByText(/^FREE$/i).length).toBeGreaterThanOrEqual(1);
  });

  it('labels an unhide op as a restore-to-view action', () => {
    renderQueue([
      makeUpload({
        fileName: 'secret.txt',
        operationType: 'unhide',
        estimatedCost: 0,
        estimatedTurboCost: 0,
        hasSufficientTurboBalance: true,
        metadata: { isHidden: false },
      }),
    ]);

    expect(screen.getByText(/Unhide on Arweave — restore to view/i)).toBeInTheDocument();
  });
});

describe('Batch approval semantics (MONEY-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Approve & Upload calls approve-all exactly once — no per-file follow-up', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    renderQueue([
      makeUpload({ estimatedTurboCost: 0.001, hasSufficientTurboBalance: true }),
      makeUpload({ estimatedTurboCost: 0.002, hasSufficientTurboBalance: true }),
      makeUpload({ estimatedTurboCost: 0.003, hasSufficientTurboBalance: true }),
    ]);

    fireEvent.click(screen.getByText('Approve & Upload'));

    await waitFor(() => {
      expect(defaultProps.onApproveAll).toHaveBeenCalledTimes(1);
    });
    // The audited bug: a follow-up loop re-approved every file individually
    // after approve-all — one approval action must mean one approval per file
    expect(defaultProps.onApproveUpload).not.toHaveBeenCalled();
  });

  it('balance-blocked rows stay skipped with a visible reason after batch approval', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    renderQueue([
      makeUpload({ estimatedTurboCost: 0.001, hasSufficientTurboBalance: true }),
      makeUpload({
        fileName: 'too-expensive.bin',
        estimatedTurboCost: 9.9,
        hasSufficientTurboBalance: false,
      }),
    ]);

    fireEvent.click(screen.getByText('Approve & Upload'));

    await waitFor(() => {
      expect(defaultProps.onApproveAll).toHaveBeenCalledTimes(1);
    });
    // The blocked row was never individually pushed through (the old loop
    // did exactly that, bypassing the batch's balance gating)
    expect(defaultProps.onApproveUpload).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/1 file skipped — insufficient Turbo Credits/)
    ).toBeInTheDocument();
  });
});

describe('Live balance staleness (MONEY-6 re-homed scope)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a top-up reflected in walletInfo unblocks rows without a re-quote', () => {
    // Stored flag says insufficient (DB-shaped 0), but the LIVE balance
    // now covers the quote (user topped up and refreshed)
    const row = makeUpload({
      estimatedTurboCost: 0.01,
      hasSufficientTurboBalance: 0 as any,
    });

    render(
      <UploadApprovalQueueModern
        {...defaultProps}
        walletInfo={{ balance: '1.0', turboBalance: '0.02', turboWinc: '20000000000' }}
        pendingUploads={[row]}
      />
    );

    expect(screen.queryByText('Insufficient balance')).toBeNull();
  });

  it('a drained live balance blocks rows even when the stored flag says sufficient', () => {
    const row = makeUpload({
      estimatedTurboCost: 0.01,
      hasSufficientTurboBalance: 1 as any, // stale: quoted when balance was healthy
    });

    render(
      <UploadApprovalQueueModern
        {...defaultProps}
        walletInfo={{ balance: '1.0', turboBalance: '0.000001', turboWinc: '1000' }}
        pendingUploads={[row]}
      />
    );

    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('falls back to the stored flag when no live balance is available', () => {
    const row = makeUpload({
      estimatedTurboCost: 0.01,
      hasSufficientTurboBalance: 0 as any,
    });

    render(
      <UploadApprovalQueueModern
        {...defaultProps}
        walletInfo={{ balance: '1.0' }}
        pendingUploads={[row]}
      />
    );

    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('a later all-sufficient batch click clears the stale skipped banner', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const blocked = makeUpload({
      fileName: 'expensive.bin',
      estimatedTurboCost: 9.9,
      hasSufficientTurboBalance: 0 as any,
    });
    const fine = makeUpload({ estimatedTurboCost: 0.001, hasSufficientTurboBalance: 1 as any });

    const { rerender } = render(
      <UploadApprovalQueueModern {...defaultProps} pendingUploads={[blocked, fine]} />
    );
    fireEvent.click(screen.getByText('Approve & Upload'));
    expect(
      await screen.findByText(/1 file skipped — insufficient Turbo Credits/)
    ).toBeInTheDocument();

    // The blocked row is gone (e.g. topped up + re-queued); a new batch click
    // must clear the stale banner (qa-gate probe B, inverted)
    rerender(
      <UploadApprovalQueueModern {...defaultProps} pendingUploads={[fine]} />
    );
    fireEvent.click(screen.getByText('Approve & Upload'));

    await waitFor(() => {
      expect(screen.queryByText(/skipped — insufficient Turbo Credits/)).toBeNull();
    });
  });
});
