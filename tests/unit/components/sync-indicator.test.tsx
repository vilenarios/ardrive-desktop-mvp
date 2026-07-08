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

  // SYNC-9: the degraded states must be visible in the chip.
  it('shows "Offline — sync paused" when health is offline (even while active with pending files)', () => {
    render(
      <SyncIndicator snapshot={{ isActive: true, pendingCount: 3, health: 'offline' }} />
    );
    expect(screen.getByText('Offline — sync paused')).toBeInTheDocument();
  });

  it('shows "Sync error" when health is error, not a benign "Paused"', () => {
    render(
      <SyncIndicator snapshot={{ isActive: false, pendingCount: 0, health: 'error' }} />
    );
    expect(screen.getByText('Sync error')).toBeInTheDocument();
    expect(screen.queryByText('Paused')).toBeNull();
  });

  it('flips to Offline from the navigator.onLine hint even when main-process health is healthy', () => {
    render(
      <SyncIndicator snapshot={{ isActive: true, pendingCount: 0, health: 'healthy', isOnline: false }} />
    );
    expect(screen.getByText('Offline — sync paused')).toBeInTheDocument();
  });

  it('surfaces the honest health detail as a hover tooltip on a degraded state', () => {
    render(
      <SyncIndicator
        snapshot={{
          isActive: false,
          pendingCount: 0,
          health: 'offline',
          healthMessage: "Offline — couldn't reach the gateway. Sync is paused."
        }}
      />
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'title',
      "Offline — couldn't reach the gateway. Sync is paused."
    );
  });

  it('carries the state-specific class so the degraded chip is styled distinctly', () => {
    const { rerender } = render(
      <SyncIndicator snapshot={{ isActive: true, pendingCount: 0, health: 'offline' }} />
    );
    expect(screen.getByRole('status')).toHaveClass('sync-indicator-offline');
    rerender(<SyncIndicator snapshot={{ isActive: false, pendingCount: 0, health: 'error' }} />);
    expect(screen.getByRole('status')).toHaveClass('sync-indicator-error');
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
