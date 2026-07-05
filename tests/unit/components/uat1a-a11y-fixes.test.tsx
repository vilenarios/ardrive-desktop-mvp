// UAT-1a: behavioral tests for the safe/mechanical accessibility fixes from
// the first UAT pass (docs/product/UAT-RUN-2026-07-04.md — A11Y-1/2/6/7).
// Each test drives real component output (not just a static grep) to prove
// the fix actually renders the expected ARIA wiring.
//
// The keyboard-inoperable-click-target fix (A11Y-5, ActivityTab rows /
// WalletSetup dropzone) is covered separately in
// uat1a-activity-row-keyboard.test.tsx, since this file's Dashboard test
// needs ActivityTab mocked out and the two goals would otherwise fight over
// the same module mock.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CreateDriveModal } from '../../../src/renderer/components/CreateDriveModal';
import ToastContainer from '../../../src/renderer/components/ToastContainer';
import { SyncProgressDisplay } from '../../../src/renderer/components/SyncProgressDisplay';
import Dashboard from '../../../src/renderer/components/Dashboard';

// ---- child stubs for the Dashboard tab-panel test --------------------------
// Only the heavy tab bodies are stubbed; TabNavigation and the tab-content
// wrapper divs (where the id/role="tabpanel"/aria-labelledby fix lives) are
// Dashboard's own real markup and are NOT mocked here.
vi.mock('../../../src/renderer/components/DriveSelector', () => ({
  DriveSelector: () => null,
}));
// CreateDriveModal / SyncProgressDisplay are NOT mocked here — Dashboard only
// mounts them behind `showCreateDriveModal`/`syncProgress` state that stays
// false/null in this test, so the real modules import fine without needing
// electronAPI shims, and the direct-import tests above/below still exercise
// their real (unmocked) implementations.
vi.mock('../../../src/renderer/components/AddExistingDriveModal', () => ({
  AddExistingDriveModal: () => null,
}));
vi.mock('../../../src/renderer/components/UploadApprovalQueueModern', () => ({
  default: () => null,
}));
vi.mock('../../../src/renderer/components/TurboCreditsManager', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/FileMetadataModal', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/UserMenu', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/WalletExport', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/ProfileSwitcher', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/Settings', () => ({ default: () => null }));
vi.mock('../../../src/renderer/components/dashboard/OverviewTab', () => ({
  OverviewTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/ActivityTab', () => ({
  ActivityTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/StorageTab', () => ({
  StorageTab: () => null,
}));
vi.mock('../../../src/renderer/components/dashboard/DownloadQueueTab', () => ({
  DownloadQueueTab: () => null,
}));

const mockElectronAPI = {
  drive: {
    getMapped: vi.fn().mockResolvedValue({ success: true, data: [] }),
    listWithStatus: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn(),
    createPrivate: vi.fn(),
    setActive: vi.fn(),
  },
  driveMappings: {
    add: vi.fn(),
  },
  uploads: {
    getPending: vi.fn().mockResolvedValue([]),
  },
  files: {
    getDownloads: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getQueueStatus: vi.fn().mockResolvedValue({ success: true, data: { queued: 0, active: 0, total: 0 } }),
  },
  profiles: {
    list: vi.fn().mockResolvedValue([]),
  },
  onDownloadProgress: vi.fn(),
  removeDownloadProgressListener: vi.fn(),
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('UAT-1a: modal exposes role=dialog + aria-modal (A11Y-2)', () => {
  it('CreateDriveModal panel is a real dialog labelled by its own title', () => {
    render(
      <CreateDriveModal
        isOpen={true}
        onClose={vi.fn()}
        onDriveCreated={vi.fn()}
        currentSyncFolder="/sync"
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // aria-labelledby must resolve to a REAL element (not a dangling id),
    // and that element must be the visible title.
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(labelledById).toBeTruthy();
    const titleEl = document.getElementById(labelledById!);
    expect(titleEl).not.toBeNull();
    expect(titleEl).toHaveTextContent('Create New Drive');
  });
});

describe('UAT-1a: toasts are announced to screen readers (A11Y-1)', () => {
  it('ToastContainer is a polite live region, and an error toast is role=alert', () => {
    const toasts = [
      { id: '1', type: 'success' as const, title: 'Saved' },
      { id: '2', type: 'error' as const, title: 'Upload failed', message: 'Insufficient balance' },
    ];

    render(<ToastContainer toasts={toasts} onClose={vi.fn()} />);

    // Container-level live region (covers the common "info/success/warning" case)
    const container = document.querySelector('.toast-container')!;
    expect(container).toHaveAttribute('role', 'status');
    expect(container).toHaveAttribute('aria-live', 'polite');

    // The success toast is polite (role=status); the error toast interrupts
    // assertively instead.
    const successToast = screen.getByText('Saved').closest('.toast-notification')!;
    expect(successToast).toHaveAttribute('role', 'status');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Upload failed');
    expect(alert).toHaveAttribute('aria-live', 'assertive');

    // The close button on each toast is no longer icon-only with zero label.
    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss notification' });
    expect(dismissButtons).toHaveLength(2);
  });
});

describe('UAT-1a: progress bars expose role=progressbar + aria-valuenow (A11Y-7)', () => {
  it('SyncProgressDisplay exposes both the overall dialog and an inner progressbar', () => {
    render(
      <SyncProgressDisplay
        progress={{
          phase: 'files',
          description: 'Preparing file downloads',
        } as any}
      />
    );

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(progressbar.getAttribute('aria-valuenow')).not.toBeNull();

    // Bonus: the sync-progress overlay is also a labelled dialog (A11Y-2).
    const dialog = screen.getByRole('dialog');
    const labelledById = dialog.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledById!)).toHaveTextContent('Syncing Drive');
  });
});

describe('UAT-1a: tab aria-controls resolves to a real role=tabpanel (A11Y-6)', () => {
  it("Dashboard's Overview tab button aria-controls points at a real, matching tabpanel", async () => {
    const drive = {
      id: 'drive-a',
      name: 'Drive A',
      privacy: 'public',
      rootFolderId: 'root-a',
    };

    render(
      <Dashboard
        config={{ syncFolder: '/sync' } as any}
        walletInfo={{ address: 'addr', balance: '1.0', walletType: 'arweave' } as any}
        currentProfile={{ id: 'p1', name: 'P1', address: 'addr' } as any}
        drive={drive as any}
        syncStatus={null}
        syncProgress={null}
        uploads={[]}
        onLogout={vi.fn()}
        onDriveDeleted={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockElectronAPI.drive.getMapped).toHaveBeenCalled();
    });

    const overviewTabButton = await screen.findByRole('tab', { name: /Overview/i });
    const controlsId = overviewTabButton.getAttribute('aria-controls');
    expect(controlsId).toBe('overview-panel');

    const panel = document.getElementById(controlsId!);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    // The panel must point back at the SAME tab button by id — not a
    // dangling/mismatched reference.
    expect(panel!.getAttribute('aria-labelledby')).toBe(overviewTabButton.id);
    expect(overviewTabButton.id).toBe('overview-tab');
  });
});

describe('UAT-1a: drive-name length cap matches the backend validator (H-COPY-2)', () => {
  it('accepts a name over the old 32-char cap, up to the validator\'s 100-char limit', () => {
    render(
      <CreateDriveModal
        isOpen={true}
        onClose={vi.fn()}
        onDriveCreated={vi.fn()}
        currentSyncFolder="/sync"
      />
    );

    const input = screen.getByPlaceholderText('Enter drive name (e.g., Personal Files, Work Documents)');
    // 50 characters — previously rejected/truncated at 32, now well within
    // input-validator.ts's MAX_DRIVE_NAME_LENGTH (100).
    const fiftyCharName = 'A'.repeat(50);
    fireEvent.change(input, { target: { value: fiftyCharName } });

    expect(input).toHaveValue(fiftyCharName);
    expect(screen.queryByText(/must be under/i)).not.toBeInTheDocument();
    expect(screen.getByText('50/100 characters')).toBeInTheDocument();
  });
});
