// UX-19: WelcomeBackScreen's loading-state derivation (`!initialDrives`)
// treated an empty-but-defined array the same as "confirmed, final data" —
// even though the real caller (App.tsx) always passes a defined array
// (its `drives` state defaults to `[]`, never `undefined`). That made an
// in-flight fetch and a genuine zero-drives account indistinguishable, so
// returning users briefly (or persistently) saw a false "No drives found"
// prompt. These tests exercise the real WelcomeBackScreen component (no
// mocking) against its backend calls.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import WelcomeBackScreen from '../../../src/renderer/components/WelcomeBackScreen';

const profile = { id: 'p1', name: 'P1', address: 'addr-1' };

const publicDrive = {
  id: 'drive-public',
  name: 'My Public Drive',
  privacy: 'public' as const,
  rootFolderId: 'root-2',
  dateCreated: Date.now(),
  size: 0,
  isLocked: false,
};

const mockElectronAPI = {
  drive: { listWithStatus: vi.fn(), list: vi.fn() },
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

const baseProps = {
  currentProfile: profile as any,
  onDriveSelected: vi.fn(),
  onCreateNewDrive: vi.fn(),
  onSkipSetup: vi.fn(),
};

describe('WelcomeBackScreen loading-vs-empty distinction (UX-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows drives immediately when a non-empty array is provided (no backend re-fetch needed)', async () => {
    render(<WelcomeBackScreen {...baseProps} initialDrives={[publicDrive] as any} />);

    expect(await screen.findByText(/Great news! You already have 1 Drive/)).toBeInTheDocument();
    expect(screen.queryByText('No drives found')).not.toBeInTheDocument();
    expect(mockElectronAPI.drive.listWithStatus).not.toHaveBeenCalled();
  });

  it('does not trust an empty-but-defined array: re-verifies, and shows real drives once the backend returns them', async () => {
    // Simulate the exact bug scenario: caller passes [] (not undefined) while
    // the real fetch is still resolving underneath.
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([publicDrive]);

    render(<WelcomeBackScreen {...baseProps} initialDrives={[] as any} />);

    // Must never show the false "no drives" state for this case.
    expect(screen.queryByText('No drives found')).not.toBeInTheDocument();

    // Backend confirms drives exist -> they eventually appear.
    expect(await screen.findByText(/Great news! You already have 1 Drive/)).toBeInTheDocument();
    expect(mockElectronAPI.drive.listWithStatus).toHaveBeenCalled();
  });

  it('shows the empty-state only after the backend confirms a genuinely zero-drive account', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([]);

    render(<WelcomeBackScreen {...baseProps} initialDrives={[] as any} />);

    await waitFor(() => {
      expect(screen.getByText('No drives found')).toBeInTheDocument();
    });
    expect(mockElectronAPI.drive.listWithStatus).toHaveBeenCalled();
  });

  it('shows the empty-state for a caller that never provides initialDrives at all (undefined)', async () => {
    mockElectronAPI.drive.listWithStatus.mockResolvedValue([]);

    render(<WelcomeBackScreen {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByText('No drives found')).toBeInTheDocument();
    });
  });
});
