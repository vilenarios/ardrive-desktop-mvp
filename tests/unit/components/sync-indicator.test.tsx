// UX-28: the header sync indicator chip itself — proves it renders the
// honest label for each state and is wired up as an informational,
// non-interactive live region (aria-live="polite", no focusable/button
// semantics) rather than a modal or focus trap.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SyncIndicator } from '../../../src/renderer/components/SyncIndicator';

describe('SyncIndicator (UX-28)', () => {
  it('shows "Syncing N files…" while active with pending files', () => {
    render(<SyncIndicator snapshot={{ isActive: true, pendingCount: 4 }} />);
    expect(screen.getByText('Syncing 4 files…')).toBeInTheDocument();
  });

  it('singularizes "file" for exactly one pending file', () => {
    render(<SyncIndicator snapshot={{ isActive: true, pendingCount: 1 }} />);
    expect(screen.getByText('Syncing 1 file…')).toBeInTheDocument();
  });

  it('shows "Up to date" when active with nothing pending', () => {
    render(<SyncIndicator snapshot={{ isActive: true, pendingCount: 0 }} />);
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('shows "Paused" when the engine is not active', () => {
    render(<SyncIndicator snapshot={{ isActive: false, pendingCount: 3 }} />);
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('is an informational, non-interactive live region — aria-live="polite", no button/tabIndex', () => {
    render(<SyncIndicator snapshot={{ isActive: true, pendingCount: 2 }} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    // Never a button and never focusable — informational only, can't trap focus.
    expect(region.tagName).not.toBe('BUTTON');
    expect(region).not.toHaveAttribute('tabindex');
    expect(region.querySelector('button')).toBeNull();
  });
});
