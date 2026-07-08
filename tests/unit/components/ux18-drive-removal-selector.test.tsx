// UX-18: the "Remove drive" action on DriveSelector's per-drive row. The
// backend to remove a drive mapping has existed since day one
// (databaseManager.removeDriveMapping + the enveloped `drive-mappings:remove`
// IPC handler, main.ts:3193-3196) but no product UI ever called it — this
// pins the reachable, clearly-labeled action DriveSelector now exposes via
// `onRemoveDrive`. The confirm dialog + IPC/refresh wiring itself lives in
// Dashboard (see ux18-drive-removal.test.tsx) since Dashboard owns
// useConfirm/toast/the drives list.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DriveSelector } from '../../../src/renderer/components/DriveSelector';

const mockElectronAPI = {
  drive: {
    unlock: vi.fn(),
    setPersistence: vi.fn().mockResolvedValue({ success: true, data: true }),
  },
};
Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true });

const activeDrive = {
  id: 'drive-active',
  name: 'Active Drive',
  privacy: 'public',
  rootFolderId: 'root-1',
  isLocked: false,
} as any;

const otherDrive = {
  id: 'drive-other',
  name: 'Other Drive',
  privacy: 'public',
  rootFolderId: 'root-2',
  isLocked: false,
} as any;

const baseProps = {
  currentDrive: activeDrive,
  drives: [activeDrive, otherDrive],
  isLoading: false,
  onDriveSelect: vi.fn(),
  onCreateDrive: vi.fn(),
  onAddExistingDrive: vi.fn(),
};

describe('UX-18: DriveSelector remove action', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a clearly-labeled, keyboard-reachable remove button per drive row', async () => {
    render(<DriveSelector {...baseProps} onRemoveDrive={vi.fn()} />);

    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    const removeOther = screen.getByRole('button', { name: 'Remove "Other Drive" from this device' });
    expect(removeOther.tagName).toBe('BUTTON');
    const removeActive = screen.getByRole('button', { name: 'Remove "Active Drive" from this device' });
    expect(removeActive.tagName).toBe('BUTTON');
  });

  it("clicking remove calls onRemoveDrive with that drive's id and does NOT switch to it", async () => {
    const onRemoveDrive = vi.fn();
    render(<DriveSelector {...baseProps} onRemoveDrive={onRemoveDrive} />);

    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    fireEvent.click(screen.getByRole('button', { name: 'Remove "Other Drive" from this device' }));

    expect(onRemoveDrive).toHaveBeenCalledWith('drive-other');
    expect(baseProps.onDriveSelect).not.toHaveBeenCalled();
  });

  it('omits the remove action entirely when no onRemoveDrive handler is wired', async () => {
    render(<DriveSelector {...baseProps} />);
    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    expect(screen.queryByRole('button', { name: /Remove ".*" from this device/ })).not.toBeInTheDocument();
  });
});
