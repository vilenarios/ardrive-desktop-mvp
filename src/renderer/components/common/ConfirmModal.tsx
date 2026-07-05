import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

export type ConfirmVariant = 'default' | 'danger';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * UX-9: in-app replacement for `window.confirm()`. Same intent (a modal
 * yes/no prompt that blocks the calling flow until answered) but on-brand
 * and accessible — reuses the drive-modal-* styling (modal.css) and the
 * shared useModalA11y hook (Escape/backdrop/focus-trap/focus-return), so it
 * matches every other modal in the app instead of the OS chrome.
 *
 * Most callers won't render this directly — see `useConfirm()` in
 * `src/renderer/hooks/useConfirm.tsx`, which wraps this component with a
 * promise-based `confirm()` function that mirrors `window.confirm`'s call
 * shape (`const ok = await confirm(...)`).
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel
}) => {
  // A11Y: Escape closes (treated as cancel), backdrop click closes, focus is
  // trapped inside the panel, and focus returns to whatever triggered the
  // modal on close — same contract every other drive modal gets.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onCancel);

  if (!isOpen) return null;

  return (
    <div className="drive-modal-overlay" onClick={handleBackdropClick}>
      <div
        className="drive-modal-panel size-sm"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
      >
        <div className="drive-modal-header">
          <h2 className="drive-modal-title" id="confirm-modal-title">
            {variant === 'danger' && (
              <AlertTriangle size={20} style={{ color: 'var(--danger-fg)' }} />
            )}
            {title}
          </h2>
        </div>

        <p id="confirm-modal-message" className="confirm-modal-message">
          {message}
        </p>

        <div className="drive-modal-footer">
          <button className="button outline" onClick={onCancel} style={{ flex: 1 }}>
            {cancelLabel}
          </button>
          <button
            className={`button ${variant === 'danger' ? 'danger' : ''}`}
            onClick={onConfirm}
            style={{ flex: 1 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
