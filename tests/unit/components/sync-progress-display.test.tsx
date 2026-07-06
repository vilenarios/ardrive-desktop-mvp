// UX-8: the sync-progress modal used to have no error state and no escape
// hatch — a failed sync left an infinite, undismissable spinner (it only
// ever auto-closed itself on a clean `phase: 'complete'`). These tests drive
// the component directly and assert:
//   1. an in-progress sync still renders its spinner/progress UI as before;
//   2. a failed sync (either the renderer-side `phase: 'error'` shape, or
//      the legacy `{ phase: 'complete', error: true }` shorthand main.ts's
//      sync:manual handler already emits) renders the error message instead
//      of spinning forever, and is dismissible via a Dismiss button, the
//      header close button, Escape, and backdrop-click (the useModalA11y
//      contract also used by ConfirmModal/PrivateDriveUnlockModal/etc);
//   3. a failed sync never silently disappears (no auto-close timer) unless
//      the user dismisses it themselves;
//   4. Retry is offered (and wired) only when the caller provides onRetry.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SyncProgressDisplay } from '../../../src/renderer/components/SyncProgressDisplay';
import { SyncProgress } from '../../../src/types';

describe('SyncProgressDisplay (UX-8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the in-progress spinner UI for a normal, non-error phase', () => {
    const progress: SyncProgress = {
      phase: 'metadata',
      description: 'Loading drive metadata'
    };
    render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Syncing Drive')).toBeInTheDocument();
    // No perpetual-spinner-with-no-way-out: a close button must exist even
    // while a normal sync is still in progress.
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    // No error banner while things are healthy.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the honest error message instead of a perpetual spinner (phase: "error")', () => {
    const progress: SyncProgress = {
      phase: 'error',
      description: 'ignored-when-error-string-present',
      error: "Couldn't reach the Arweave gateway. Check your connection and try again."
    };
    render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} />);

    expect(screen.getByText('Sync Failed')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't reach the Arweave gateway. Check your connection and try again."
    );
    // No spinner/progress bar in the error state.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders the error for the legacy { phase: "complete", error: true } shorthand instead of vanishing', () => {
    // This is exactly what main.ts's sync:manual catch block emits today —
    // the modal used to unconditionally return null on phase 'complete',
    // silently swallowing this failure with no trace beyond a toast.
    const progress: SyncProgress = {
      phase: 'complete',
      description: 'Sync failed: Network request failed',
      error: true
    };
    const { container } = render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} />);

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText('Sync Failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sync failed: Network request failed');
  });

  it('does NOT render (returns null) on a genuine, error-free completion', () => {
    const progress: SyncProgress = { phase: 'complete', description: 'All done' };
    const { container } = render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('never auto-closes an error state (no perpetual spinner, but no silent vanish either)', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    vi.advanceTimersByTime(5000);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('is dismissible via the header close button', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is dismissible via the footer Dismiss button in the error state', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is dismissible via Escape (useModalA11y contract)', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is dismissible via backdrop click', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    const { container } = render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    const backdrop = container.querySelector('.sync-progress-modal') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the panel does not dismiss (only the backdrop itself does)', () => {
    const onClose = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={onClose} />);

    fireEvent.click(screen.getByRole('alert'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers no Retry button when the caller does not pass onRetry', () => {
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('offers a working Retry button when the caller passes onRetry', () => {
    const onRetry = vi.fn();
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} onClose={vi.fn()} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a caller omits onClose entirely (defensive no-op fallback)', () => {
    const progress: SyncProgress = { phase: 'error', description: 'x', error: 'Something failed' };
    render(<SyncProgressDisplay progress={progress} />);
    expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Close' }))).not.toThrow();
  });
});
