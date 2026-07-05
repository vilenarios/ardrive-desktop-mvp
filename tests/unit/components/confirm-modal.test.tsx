// UX-9 (UAT-1 held item 2): the in-app ConfirmModal that replaces native
// window.confirm(). These drive the component directly — role=dialog +
// aria-modal (the useModalA11y contract) and that Confirm/Cancel fire the
// right callback — plus the useConfirm() promise wrapper resolving true on
// confirm and false on cancel/Escape (the exact `const ok = await confirm()`
// call shape the migrated call sites depend on).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfirmModal } from '../../../src/renderer/components/common/ConfirmModal';
import { useConfirm } from '../../../src/renderer/hooks/useConfirm';

describe('ConfirmModal (UX-9 / UAT-1 held item 2)', () => {
  it('renders as an accessible dialog with the given title/message when open', () => {
    render(
      <ConfirmModal
        isOpen
        title={'Switch to "Work"?'}
        message="This will change your active drive and sync folder."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-modal-title');
    expect(screen.getByText('This will change your active drive and sync folder.')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmModal
        isOpen={false}
        title="Nope"
        message="hidden"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        isOpen
        title="t"
        message="m"
        confirmLabel="Switch"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires onCancel when the cancel button is clicked', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        isOpen
        title="t"
        message="m"
        cancelLabel="Not now"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('treats Escape as cancel (useModalA11y wiring)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal isOpen title="t" message="m" onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('useConfirm() promise API (UX-9)', () => {
  // A tiny harness so we can call confirm() and render {confirmDialog}.
  function Harness({ onResult }: { onResult: (v: boolean) => void }) {
    const { confirm, confirmDialog } = useConfirm();
    return (
      <div>
        <button onClick={async () => onResult(await confirm({ title: 'Go?', message: 'sure?' }))}>
          ask
        </button>
        {confirmDialog}
      </div>
    );
  }

  it('resolves true when the user confirms', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByText('ask'));
    // The dialog appears...
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // ...and closes after answering.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when the user cancels', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    fireEvent.click(screen.getByText('ask'));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('starts with no dialog rendered until confirm() is called', () => {
    const { result } = renderHook(() => useConfirm());
    // confirmDialog is a <ConfirmModal isOpen={false}/> -> renders null
    const { container } = render(<div>{result.current.confirmDialog}</div>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // calling confirm() returns a promise (doesn't throw)
    act(() => {
      void result.current.confirm({ message: 'x' });
    });
  });
});
