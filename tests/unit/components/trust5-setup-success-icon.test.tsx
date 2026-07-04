// TRUST-5 (DESIGN-8): SetupSuccessScreen's "Drive Type" row used to hardcode
// a Globe (public) icon regardless of the actual driveType prop -- a private
// drive's own confirmation screen showed the public icon, exactly backwards
// for the one screen whose job is letting the user trust what "private"
// means before they upload anything. WelcomeBackScreen already branches
// Lock/Globe correctly off `drive.privacy`; this suite pins the same
// contract here, branching off the `driveType` string this component
// actually receives, plus the honest permanence/public-vs-private copy on
// the same screen.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetupSuccessScreen from '../../../src/renderer/components/SetupSuccessScreen';

const baseProps = {
  driveName: 'My Files',
  localSyncFolder: '/home/user/ArDrive',
  autoSyncEnabled: true,
  onOpenDashboard: () => {},
};

describe('SetupSuccessScreen privacy icon + copy (TRUST-5)', () => {
  it('shows a Lock icon (not Globe) and private-drive copy for a private drive', () => {
    const { container } = render(<SetupSuccessScreen {...baseProps} driveType="Private Drive" />);

    expect(screen.getByText('Private Drive')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-lock')).not.toBeNull();
    expect(
      screen.getByText(/this is a private drive: files are encrypted on your device/i)
    ).toBeInTheDocument();
  });

  it('shows a Globe icon and public-drive copy for a public drive', () => {
    const { container } = render(<SetupSuccessScreen {...baseProps} driveType="Public Drive" />);

    expect(screen.getByText('Public Drive')).toBeInTheDocument();
    expect(
      screen.getByText(/this is a public drive: anyone with the link can view these files, forever/i)
    ).toBeInTheDocument();
    // No Lock icon should render anywhere on a public drive's summary.
    expect(container.querySelector('svg.lucide-lock')).toBeNull();
  });

  it('states permanence honestly regardless of drive type', () => {
    render(<SetupSuccessScreen {...baseProps} driveType="Public Drive" />);
    expect(
      screen.getByText(/can.t be edited or deleted, by you or anyone else/i)
    ).toBeInTheDocument();
  });

  it('does not render the party-popper emoji in the confirmation heading (POLISH-3)', () => {
    render(<SetupSuccessScreen {...baseProps} driveType="Public Drive" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain('🎉');
  });
});
