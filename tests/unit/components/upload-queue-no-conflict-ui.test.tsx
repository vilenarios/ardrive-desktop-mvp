// MONEY-5: the conflict-resolution modal was a no-op — every choice
// (keep_local / use_remote / keep_both / skip) was console.logged and
// discarded (audit §1.6), while upstream conflict detection is hardcoded
// 'none' (sync-manager). Decision: ship neither half until both exist.
// These tests prove the approval queue offers NO discarded conflict choices,
// even against adversarial data that claims a conflict.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import UploadApprovalQueueModern from '../../../src/renderer/components/UploadApprovalQueueModern';

vi.mock('../../../src/renderer/components/MetadataEditor', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/MetadataTemplateManager', () => ({ default: () => null }));

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

const basePendingUpload = {
  id: 'upload-1',
  localPath: '/sync/file.txt',
  fileName: 'file.txt',
  fileSize: 1024,
  estimatedCost: 0,
  estimatedTurboCost: 0,
  recommendedMethod: 'turbo' as const,
  hasSufficientTurboBalance: true,
  status: 'awaiting_approval' as const,
  createdAt: new Date(),
};

describe('UploadApprovalQueueModern — no discarded conflict choices (MONEY-5)', () => {
  const defaultProps = {
    onApproveUpload: vi.fn(),
    onRejectUpload: vi.fn(),
    onApproveAll: vi.fn(),
    onRejectAll: vi.fn(),
    walletInfo: { balance: '1.0', turboBalance: '0.5', turboWinc: '500000000000' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers no Resolve action even for an upload that claims a conflict', () => {
    // Adversarial fixture: pretend upstream produced a conflict
    const conflictedUpload = {
      ...basePendingUpload,
      conflictType: 'name_conflict',
      conflictDetails: 'A file with this name already exists remotely',
    } as any;

    render(
      <UploadApprovalQueueModern {...defaultProps} pendingUploads={[conflictedUpload]} />
    );

    expect(screen.queryByText('Resolve')).not.toBeInTheDocument();
    expect(screen.queryByText('Resolve Conflict')).not.toBeInTheDocument();
    // None of the old discarded choices exist anywhere
    expect(screen.queryByText(/Keep Local/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Use Remote/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep Both/)).not.toBeInTheDocument();
  });

  it('still offers the real approve flow for a normal upload', () => {
    const upload = { ...basePendingUpload, conflictType: 'none' } as any;

    render(<UploadApprovalQueueModern {...defaultProps} pendingUploads={[upload]} />);

    expect(screen.getByText('file.txt')).toBeInTheDocument();
    expect(screen.getByText(/Approve & Upload/)).toBeInTheDocument();
  });
});
