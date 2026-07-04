import { useEffect, useRef, useCallback } from 'react';

/**
 * DESIGN-8 (A11Y-3, drives lane): shared modal accessibility behavior.
 *
 * Per docs/product/DESIGN-SYSTEM.md §6.4: "Esc closes; focus trap; return
 * focus on close." Before this hook, only PrivateDriveUnlockModal had any of
 * this (backdrop-click + autoFocus), and even there Escape was wired to a
 * single `<input>`'s onKeyDown, so it stopped working the moment focus moved
 * to the checkbox or the eye-toggle button. CreateDriveModal,
 * AddExistingDriveModal, and CreateManifestModal had none of it at all.
 *
 * Implemented once here and reused by all four drive modals instead of
 * duplicating the same escape/backdrop/focus-trap logic in every component.
 *
 * Usage:
 *   const { containerRef, handleBackdropClick } = useModalA11y(isOpen, onClose);
 *   <div className="drive-modal-overlay" onMouseDown={handleBackdropClick}>
 *     <div className="drive-modal-panel" ref={containerRef}>...</div>
 *   </div>
 *
 * For modals stacked on top of one another (e.g. CreateManifestModal's
 * folder picker + its confirmation step), call this once per layer and pass
 * `isOpen` as "this layer is the topmost one" — only one layer should be
 * `true` at a time so Escape/Tab-trapping isn't fought over between layers.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null // skip hidden elements (e.g. display:none branches)
  );
}

export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void
) {
  const containerRef = useRef<T>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-running the open/close effect on every
  // render (parents often pass an inline arrow function as onClose).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Remember whatever had focus before the modal opened (the "trigger"),
    // so it can be restored when the modal closes.
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the modal. Deferred one frame so it runs after the
    // panel has actually painted (and after any input's own `autoFocus`,
    // which — if present — is simply re-confirmed here, not fought with).
    const focusFrame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return; // autoFocus already landed inside
      const [first] = getFocusableElements(container);
      (first ?? container).focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;
        const focusable = getFocusableElements(container);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Capture phase so Escape/Tab are caught regardless of which descendant
    // currently has focus (the exact gap A11Y-3 flagged).
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);

      // Return focus to whatever opened the modal, if it's still around.
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) {
      onCloseRef.current();
    }
  }, []);

  return { containerRef, handleBackdropClick };
}
