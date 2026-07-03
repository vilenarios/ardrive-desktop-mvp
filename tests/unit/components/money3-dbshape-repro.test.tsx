// MONEY-3 regression test (adopted from the qa-gate repro that failed the
// first iteration). Feeds the component PRODUCTION-SHAPED rows, i.e. what
// actually comes back from sqlite3 through uploads:get-pending: BOOLEAN
// columns as 0/1 numbers, NULL estimatedTurboCost as null (NOT the clean
// `false`/`undefined` shapes unit tests naturally reach for). Guards against
// `0 !== false` / `null !== undefined` truthiness bugs re-classifying
// no-quote paid files as 0-credit Turbo uploads. Rows are also normalized at
// the DB boundary now (database-manager.getPendingUploads), but the renderer
// must stay robust to raw transport shapes regardless.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Exactly the row shape produced by database-manager.getPendingUploads()
// (raw `SELECT *` spread: sqlite3 returns INTEGER for BOOLEAN, null for NULL)
const dbShapedUpload = (overrides: Record<string, unknown> = {}) => ({
  id: `upload-${Math.random().toString(36).slice(2)}`,
  localPath: '/sync/folder/big-file.bin',
  fileName: 'big-file.bin',
  fileSize: FILE_SIZE_5MB,
  estimatedCost: FILE_SIZE_5MB / 1e12,
  estimatedTurboCost: null,          // SQLite NULL (no quote)
  hasSufficientTurboBalance: 0,      // SQLite false -> integer 0
  recommendedMethod: 'ar',
  conflictType: 'none',
  status: 'awaiting_approval',
  operationType: 'upload',
  createdAt: new Date(),
  ...overrides,
});

const props = {
  onApproveUpload: vi.fn(),
  onRejectUpload: vi.fn(),
  onApproveAll: vi.fn(),
  onRejectAll: vi.fn(),
  onResolveConflict: vi.fn(),
  walletInfo: { balance: '1.0000', turboBalance: '0.5000' },
};

describe('QA gate probe: MONEY-3 with production (DB-roundtripped) data shapes', () => {
  it('no-quote paid file: banner must NOT display a credits figure (e.g. 0.0000 Credits)', () => {
    const { container } = render(
      <UploadApprovalQueueModern {...props} pendingUploads={[dbShapedUpload()] as any} />
    );

    // The paid file has no quote — a "0.0000 Credits" total is a fabricated quote
    expect(container.textContent).not.toContain('0.0000 Credits');
    // The banner should say the estimate is unavailable (as it does for
    // boolean-shaped rows in the implementer's tests)
    expect(screen.getAllByText(/estimate unavailable/i).length).toBeGreaterThanOrEqual(1);
  });

  it('mixed queue: banner total must disclose the unavailable files, not silently omit them', () => {
    const { container } = render(
      <UploadApprovalQueueModern
        {...props}
        pendingUploads={[
          dbShapedUpload({ fileName: 'quoted.bin', estimatedTurboCost: 0.01, hasSufficientTurboBalance: 1 }),
          dbShapedUpload({ fileName: 'unquoted.bin' }),
        ] as any}
      />
    );

    // Real quote may render...
    expect(container.textContent).toContain('0.0100 Credits');
    // ...but the no-quote file must be disclosed in the banner
    expect(screen.getByText(/\+ 1 file: estimate unavailable/i)).toBeInTheDocument();
  });
});
