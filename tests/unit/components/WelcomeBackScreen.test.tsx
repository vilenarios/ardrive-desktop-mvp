// UAT-1b (defect #2): belt-and-suspenders renderer-side clamp. Even with the
// wallet-manager-secure.ts unixTime normalization fix, formatDate() must
// never render an implausible year (e.g. "Apr 3, 58474") — it should fall
// back to an honest "Unknown date" instead.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WelcomeBackScreen from '../../../src/renderer/components/WelcomeBackScreen';
import { DriveInfo } from '../../../src/types';

const makeDrive = (overrides: Partial<DriveInfo> = {}): DriveInfo => ({
  id: `drive-${Math.random().toString(36).slice(2)}`,
  name: 'My Drive',
  privacy: 'public',
  rootFolderId: 'root-folder-id',
  dateCreated: Date.now(),
  size: 0,
  ...overrides,
});

const defaultProps = {
  onDriveSelected: () => {},
  onCreateNewDrive: () => {},
  onSkipSetup: () => {},
};

describe('WelcomeBackScreen date display (UAT-1b defect #2)', () => {
  it('renders a normal recent dateCreated as a real date', () => {
    // Noon UTC keeps the calendar date stable across any reasonable local
    // test-runner timezone (toLocaleDateString renders in local time).
    const targetMs = Date.UTC(2023, 5, 15, 12, 0, 0); // 2023-06-15 noon UTC
    render(
      <WelcomeBackScreen
        {...defaultProps}
        initialDrives={[makeDrive({ dateCreated: targetMs })]}
      />
    );

    expect(screen.getByText(/Created Jun 15, 2023/)).toBeInTheDocument();
  });

  it('clamps a wild-year timestamp (e.g. from an unnormalized seconds*1000 overflow) to "Unknown date"', () => {
    // Mirrors the exact live defect: a real ms-scale unixTime run through the
    // OLD blindly-seconds `unixTime * 1000` bug overflows to a garbage year.
    const alreadyMsUnixTime = Date.UTC(2023, 5, 15); // what a fixed upstream would produce
    const buggyDateCreated = alreadyMsUnixTime * 1000; // the pre-fix overflow this belt-and-suspenders clamp guards against

    render(
      <WelcomeBackScreen
        {...defaultProps}
        initialDrives={[makeDrive({ dateCreated: buggyDateCreated })]}
      />
    );

    expect(screen.getByText(/Created Unknown date/)).toBeInTheDocument();
    // The wild year must never reach the DOM
    expect(screen.queryByText(/58474/)).toBeNull();
  });

  it('clamps a year far in the past (before Arweave existed) to "Unknown date"', () => {
    const tooOld = Date.UTC(1999, 0, 1);
    render(
      <WelcomeBackScreen
        {...defaultProps}
        initialDrives={[makeDrive({ dateCreated: tooOld })]}
      />
    );

    expect(screen.getByText(/Created Unknown date/)).toBeInTheDocument();
  });

  it('clamps a truthy-but-epoch-era timestamp (year 1970, before the falsy-zero short-circuit) to "Unknown date"', () => {
    // dateCreated=1 is truthy (so the "Created ..." block still renders) but
    // resolves to 1970 — this exercises the year-plausibility clamp itself,
    // not the separate `!timestamp` guard for zero/falsy values.
    render(
      <WelcomeBackScreen
        {...defaultProps}
        initialDrives={[makeDrive({ dateCreated: 1 })]}
      />
    );

    expect(screen.getByText(/Created Unknown date/)).toBeInTheDocument();
  });
});
