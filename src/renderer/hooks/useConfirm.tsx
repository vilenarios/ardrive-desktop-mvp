import React, { useCallback, useRef, useState } from 'react';
import { ConfirmModal, ConfirmVariant } from '../components/common/ConfirmModal';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

/**
 * UX-21: promise-based replacement for `window.confirm()`.
 *
 * Usage mirrors the native API's call shape so call sites barely change:
 *   const { confirm, confirmDialog } = useConfirm();
 *   const ok = await confirm({ title: '...', message: '...' });
 *   if (!ok) return;
 *   ...
 *   return <div>{confirmDialog}...</div>
 *
 * `confirmDialog` must be rendered somewhere in the component's JSX tree
 * (it's the actual <ConfirmModal>) — `confirm()` only resolves once the
 * user clicks Confirm/Cancel, dismisses via Escape, or clicks the backdrop.
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setOptions(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  const confirmDialog = (
    <ConfirmModal
      isOpen={options !== null}
      title={options?.title ?? 'Please confirm'}
      message={options?.message ?? ''}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      variant={options?.variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}
