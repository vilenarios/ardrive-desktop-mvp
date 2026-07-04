// A11Y-1 (DESIGN-8): the drive-selection radios were hidden with
// `display: 'none'`, which removes an element from both the tab order and
// the accessibility tree -- a keyboard-only user could never reach or
// select a drive on the returning-user screen (the .drive-select-card
// :focus-within CSS rule proves keyboard support was intended, just never
// reachable). Fixed via the standard visually-hidden recipe (off-screen via
// position/clip, not display:none), so the input stays focusable. This
// suite also exercises the private-drive fingerprint InfoButton added in
// the same pass, to confirm it renders without warnings/errors.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WelcomeBackScreen from '../../../src/renderer/components/WelcomeBackScreen';
import { DriveInfoWithStatus } from '../../../src/types';

const privateDrive: DriveInfoWithStatus = {
  id: 'drive-private',
  name: 'My Private Drive',
  privacy: 'private',
  rootFolderId: 'root-1',
  dateCreated: Date.now(),
  size: 0,
  isLocked: false,
  emojiFingerprint: '🦊🌲🔑',
};

const publicDrive: DriveInfoWithStatus = {
  id: 'drive-public',
  name: 'My Public Drive',
  privacy: 'public',
  rootFolderId: 'root-2',
  dateCreated: Date.now(),
  size: 0,
  isLocked: false,
};

describe('WelcomeBackScreen drive radios are keyboard-reachable (A11Y-1)', () => {
  it('does not hide the radio inputs with display:none', () => {
    render(
      <WelcomeBackScreen
        currentProfile={{ id: 'p1', name: 'P1', address: 'addr-1' } as any}
        initialDrives={[privateDrive, publicDrive] as any}
        onDriveSelected={vi.fn()}
        onCreateNewDrive={vi.fn()}
        onSkipSetup={vi.fn()}
      />
    );

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveStyle({ display: 'none' });
    }
  });

  it('lets a keyboard user focus a drive radio directly (no display:none blocking it)', () => {
    render(
      <WelcomeBackScreen
        currentProfile={{ id: 'p1', name: 'P1', address: 'addr-1' } as any}
        initialDrives={[privateDrive, publicDrive] as any}
        onDriveSelected={vi.fn()}
        onCreateNewDrive={vi.fn()}
        onSkipSetup={vi.fn()}
      />
    );

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    radios[0].focus();
    expect(document.activeElement).toBe(radios[0]);
  });

  it('renders the private-drive fingerprint with a text fallback and an InfoButton explaining it', () => {
    render(
      <WelcomeBackScreen
        currentProfile={{ id: 'p1', name: 'P1', address: 'addr-1' } as any}
        initialDrives={[privateDrive, publicDrive] as any}
        onDriveSelected={vi.fn()}
        onCreateNewDrive={vi.fn()}
        onSkipSetup={vi.fn()}
      />
    );

    expect(screen.getByText('🦊🌲🔑')).toBeInTheDocument();
    expect(screen.getByText('(fingerprint)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /visual fingerprint of your drive's encryption key/i })
    ).toBeInTheDocument();
  });

  it('explains public vs. private drives via an InfoButton on the drive-list heading', () => {
    render(
      <WelcomeBackScreen
        currentProfile={{ id: 'p1', name: 'P1', address: 'addr-1' } as any}
        initialDrives={[privateDrive, publicDrive] as any}
        onDriveSelected={vi.fn()}
        onCreateNewDrive={vi.fn()}
        onSkipSetup={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /public drives are visible to anyone with the link/i })
    ).toBeInTheDocument();
  });
});
