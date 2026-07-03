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
});
