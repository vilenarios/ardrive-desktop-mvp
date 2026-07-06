// UX-15 (audit §2.5 / D-010): the beta syncs exactly one drive at a time —
// simultaneous multi-drive sync is post-beta. DriveSelector is the only
// surface that shows more than one of the user's drives together, and
// before this fix it gave no signal that the other rows weren't syncing:
// every row looked equally "connected", so a user could reasonably assume
// every mapped drive was being kept in sync in the background.
//
// These tests pin the honesty fix: the active drive is unambiguously
// labeled "Syncing" (trigger + dropdown row), every other mapped drive is
// unambiguously labeled "Not syncing", and the one-drive-at-a-time model is
// explained via the InfoButton pattern used elsewhere in this component.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DriveSelector } from '../../../src/renderer/components/DriveSelector';

const mockElectronAPI = {
  drive: {
    unlock: vi.fn(),
    setPersistence: vi.fn().mockResolvedValue({ success: true, data: true }),
  },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const activeDrive = {
  id: 'drive-active',
  name: 'Active Drive',
  privacy: 'public',
  rootFolderId: 'root-1',
  isLocked: false,
} as any;

const otherPublicDrive = {
  id: 'drive-other',
  name: 'Other Drive',
  privacy: 'public',
  rootFolderId: 'root-2',
  isLocked: false,
} as any;

const lockedPrivateDrive = {
  id: 'drive-locked',
  name: 'Locked Drive',
  privacy: 'private',
  rootFolderId: 'root-3',
  isLocked: true,
} as any;

const defaultProps = {
  currentDrive: activeDrive,
  drives: [activeDrive, otherPublicDrive, lockedPrivateDrive],
  isLoading: false,
  onDriveSelect: vi.fn(),
  onCreateDrive: vi.fn(),
  onAddExistingDrive: vi.fn(),
};

// The trigger button + dropdown option both render the current drive's
// name as text, so `getByText` is ambiguous once the dropdown is open.
// Each dropdown row has a distinct, descriptive aria-label (this fix) --
// use that as the unambiguous handle for "the row for this drive".
const getOptionRow = (driveNamePrefix: string) =>
  screen.getByRole('button', { name: new RegExp(`^${driveNamePrefix},`) });

describe('UX-15: truthful single-drive sync UI', () => {
  it('shows a "Syncing" indicator on the trigger for the active drive even before the dropdown opens', () => {
    render(<DriveSelector {...defaultProps} />);

    const trigger = screen.getByText('Active Drive').closest('button') as HTMLElement;
    expect(within(trigger).getByText('Syncing')).toBeInTheDocument();
  });

  it('marks only the active drive as "Syncing" in the dropdown; every other mapped drive is "Not syncing"', async () => {
    render(<DriveSelector {...defaultProps} />);

    // Open the dropdown.
    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    const activeRow = getOptionRow('Active Drive');
    const otherRow = getOptionRow('Other Drive');
    const lockedRow = getOptionRow('Locked Drive');

    expect(within(activeRow).getByText('Syncing')).toBeInTheDocument();
    expect(within(activeRow).queryByText('Not syncing')).not.toBeInTheDocument();

    expect(within(otherRow).getByText('Not syncing')).toBeInTheDocument();
    expect(within(otherRow).queryByText('Syncing')).not.toBeInTheDocument();

    expect(within(lockedRow).getByText('Not syncing')).toBeInTheDocument();
    expect(within(lockedRow).queryByText('Syncing')).not.toBeInTheDocument();

    // Exactly one row *inside the dropdown* claims to be syncing (the
    // trigger button also renders a "Syncing" badge for the active drive,
    // so this is scoped to the dropdown, not the whole document).
    const dropdown = document.querySelector('.drive-selector-dropdown') as HTMLElement;
    expect(within(dropdown).getAllByText('Syncing')).toHaveLength(1);
    expect(within(dropdown).getAllByText('Not syncing')).toHaveLength(2);
  });

  it('gives non-active drives an accessible name that truthfully explains switching, not just a bare label', async () => {
    render(<DriveSelector {...defaultProps} />);
    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    const activeRow = getOptionRow('Active Drive');
    const otherRow = getOptionRow('Other Drive');
    const lockedRow = getOptionRow('Locked Drive');

    expect(activeRow).toHaveAttribute('aria-label', expect.stringContaining('currently syncing'));
    expect(otherRow).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Select to sync this drive instead')
    );
    expect(otherRow).toHaveAttribute('aria-label', expect.stringContaining('only one drive syncs at a time'));
    // A locked private drive isn't a direct switch — clicking unlocks it first.
    expect(lockedRow).toHaveAttribute('aria-label', expect.stringContaining('Unlock to sync this drive instead'));
  });

  it('explains the one-drive-at-a-time model via a keyboard-reachable InfoButton in the dropdown', async () => {
    render(<DriveSelector {...defaultProps} />);
    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    const infoButton = screen.getByLabelText(
      'One drive syncs at a time in this beta; others stay connected. Simultaneous sync is coming.'
    );
    // Keyboard-reachable: a real <button>, not a hover-only affordance.
    expect(infoButton.tagName).toBe('BUTTON');

    fireEvent.click(infoButton);
    expect(
      screen.getByText('One drive syncs at a time in this beta; others stay connected. Simultaneous sync is coming.')
    ).toBeInTheDocument();
  });

  it('does not claim simultaneous sync anywhere in the dropdown', async () => {
    render(<DriveSelector {...defaultProps} />);
    fireEvent.click(screen.getByText('Active Drive'));
    await screen.findByText('Other Drive');

    const dropdownText = document.body.textContent || '';
    expect(dropdownText).not.toMatch(/all drives sync/i);
    expect(dropdownText).not.toMatch(/every drive syncs/i);
  });
});
