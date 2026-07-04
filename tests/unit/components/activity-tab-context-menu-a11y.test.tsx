// A11Y-2 (DESIGN-8): the "..." context-menu trigger used to only mount in the
// DOM when a JS `hoveredItem` state matched the row — i.e. it never existed
// for a keyboard-only user, so "Open / Copy Link / View Details / View
// Online" were unreachable without a mouse. Fixed by always mounting the
// trigger button and moving visibility to CSS (:hover/:focus-within), per
// DESIGN-SYSTEM.md §5A ("state changes are CSS, never a mouse-enter/leave
// handler").
//
// These tests deliberately never simulate a hover (no fireEvent.mouseOver) —
// the whole point is that the trigger must be reachable without one.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActivityTab } from '../../../src/renderer/components/dashboard/ActivityTab';
import { FileUpload, AppConfig, DriveInfo } from '../../../src/types';

const mockElectronAPI = {
  shell: {
    openFile: vi.fn(),
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  files: {
    queueDownload: vi.fn(),
    cancelDownload: vi.fn(),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const drive: DriveInfo = {
  id: 'drive-1',
  name: 'Test Drive',
  privacy: 'public',
  rootFolderId: 'root-1',
  dateCreated: Date.now(),
  size: 0,
};

const config: AppConfig = {
  isFirstRun: false,
  syncFolder: '/sync',
};

function makeUpload(overrides: Partial<FileUpload>): FileUpload {
  return {
    id: 'upload-1',
    driveId: 'drive-1',
    localPath: '/sync/file.txt',
    fileName: 'file.txt',
    fileSize: 1234,
    status: 'completed',
    progress: 100,
    createdAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

describe('ActivityTab — context-menu trigger is keyboard-reachable (A11Y-2)', () => {
  it('renders the "..." trigger as a real, focusable button with no hover simulated', () => {
    const upload = makeUpload({ fileName: 'no-hover-needed.txt' });

    render(
      <ActivityTab
        uploads={[upload]}
        downloads={[]}
        pendingUploads={[]}
        config={config}
        drive={drive}
        onViewFile={vi.fn()}
      />
    );

    const item = screen.getByText('no-hover-needed.txt').closest('.unified-activity-item') as HTMLElement;
    expect(item).toBeTruthy();

    // No fireEvent.mouseOver anywhere in this test — a keyboard-only user
    // never fires a mouse event at all, so the button must already be a real,
    // always-mounted element the moment the row renders.
    const trigger = within(item).getByRole('button', { name: 'More actions' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the dropdown via a click (equivalent to Enter/Space on a focused button) with no prior hover', () => {
    const upload = makeUpload({
      fileName: 'keyboard-open.txt',
      dataTxId: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABC12',
    });

    render(
      <ActivityTab
        uploads={[upload]}
        downloads={[]}
        pendingUploads={[]}
        config={config}
        drive={drive}
        onViewFile={vi.fn()}
      />
    );

    const item = screen.getByText('keyboard-open.txt').closest('.unified-activity-item') as HTMLElement;
    const trigger = within(item).getByRole('button', { name: 'More actions' });

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(item).getByText('Open')).toBeInTheDocument();
    expect(within(item).getByText('View Details')).toBeInTheDocument();
    expect(within(item).getByText('Copy Link')).toBeInTheDocument();
    expect(within(item).getByText('View Online')).toBeInTheDocument();
  });
});
