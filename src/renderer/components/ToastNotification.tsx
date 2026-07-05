import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastNotificationProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const ToastNotification: React.FC<ToastNotificationProps> = ({ toast, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, toast.duration || 5000);

    return () => clearTimeout(timer);
  }, [toast]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(toast.id);
    }, 300);
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle size={20} />;
      case 'error':
        return <XCircle size={20} />;
      case 'warning':
        return <AlertCircle size={20} />;
      case 'info':
      default:
        return <Info size={20} />;
    }
  };

  const getTypeClass = () => {
    switch (toast.type) {
      case 'success':
        return 'toast-success';
      case 'error':
        return 'toast-error';
      case 'warning':
        return 'toast-warning';
      case 'info':
      default:
        return 'toast-info';
    }
  };

  // A11Y-1: toasts previously had no role/aria-live at all, so payment/copy/
  // error outcomes were silent to screen readers. Error toasts get an
  // assertive role="alert" (interrupts immediately); everything else is
  // role="status" (implicit aria-live="polite", matching ToastContainer's
  // own polite live region so the announcement isn't duplicated/contradicted).
  const role = toast.type === 'error' ? 'alert' : 'status';

  return (
    <div
      className={`toast-notification ${getTypeClass()} ${isExiting ? 'exiting' : ''}`}
      role={role}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="toast-icon">
        {getIcon()}
      </div>
      <div className="toast-content">
        <h4 className="toast-title">{toast.title}</h4>
        {toast.message && <p className="toast-message">{toast.message}</p>}
      </div>
      <button className="toast-close" onClick={handleClose} aria-label="Dismiss notification">
        <X size={16} />
      </button>

      <style>{`
        /* F7: base was a literal white fill; every toast always carries one
         * of the .toast-{success,error,warning,info} type classes below
         * which override it, but the fallback itself was still a raw
         * literal and would render wrong if that ever changed. */
        .toast-notification {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          box-shadow: var(--elevation-3);
          background: var(--surface-raised);
          border: 1px solid var(--gray-200);
          max-width: 400px;
          animation: slideIn var(--motion-moderate) var(--ease-out);
          transition: opacity var(--motion-moderate) var(--ease-standard),
                      transform var(--motion-moderate) var(--ease-standard);
        }

        .toast-notification.exiting {
          animation: slideOut var(--motion-moderate) var(--ease-in);
          opacity: 0;
          transform: translateX(100%);
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slideOut {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }

        .toast-icon {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .toast-success .toast-icon {
          color: var(--success);
        }

        .toast-error .toast-icon {
          color: var(--danger-fg);
        }

        .toast-warning .toast-icon {
          color: var(--warning);
        }

        .toast-info .toast-icon {
          color: var(--info-fg);
        }

        .toast-content {
          flex: 1;
          min-width: 0;
        }

        .toast-title {
          margin: 0 0 var(--space-1) 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .toast-message {
          margin: 0;
          font-size: 13px;
          color: var(--gray-600);
          line-height: 1.5;
        }

        .toast-close {
          flex-shrink: 0;
          background: none;
          border: none;
          padding: var(--space-1);
          cursor: pointer;
          color: var(--gray-500);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color var(--motion-base) var(--ease-standard),
                      background-color var(--motion-base) var(--ease-standard);
        }

        .toast-close:hover {
          background: var(--gray-100);
          color: var(--gray-700);
        }

        .toast-close:active {
          transform: scale(0.95);
        }

        .toast-close:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--focus-ring);
        }

        .toast-success {
          border-color: var(--success);
          background: var(--success-surface);
        }

        .toast-error {
          border-color: var(--danger);
          background: var(--danger-surface);
        }

        .toast-warning {
          border-color: var(--warning);
          background: var(--warning-surface);
        }

        .toast-info {
          border-color: var(--info);
          background: var(--info-surface);
        }
      `}</style>
    </div>
  );
};

export default ToastNotification;