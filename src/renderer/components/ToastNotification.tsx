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

  return (
    <div className={`toast-notification ${getTypeClass()} ${isExiting ? 'exiting' : ''}`}>
      <div className="toast-icon">
        {getIcon()}
      </div>
      <div className="toast-content">
        <h4 className="toast-title">{toast.title}</h4>
        {toast.message && <p className="toast-message">{toast.message}</p>}
      </div>
      <button className="toast-close" onClick={handleClose}>
        <X size={16} />
      </button>

      <style>{`
        .toast-notification {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          background: white;
          border: 1px solid var(--gray-200);
          max-width: 400px;
          animation: slideIn 0.3s ease-out;
          transition: all 0.3s ease-out;
        }

        .toast-notification.exiting {
          animation: slideOut 0.3s ease-out;
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
          color: var(--success-600);
        }

        .toast-error .toast-icon {
          color: var(--danger-600);
        }

        .toast-warning .toast-icon {
          color: var(--warning-600);
        }

        .toast-info .toast-icon {
          color: var(--info-600);
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
          transition: all 0.2s ease;
        }

        .toast-close:hover {
          background: var(--gray-100);
          color: var(--gray-700);
        }

        .toast-success {
          border-color: var(--success-200);
          background: var(--success-50);
        }

        .toast-error {
          border-color: var(--danger-200);
          background: var(--danger-50);
        }

        .toast-warning {
          border-color: var(--warning-200);
          background: var(--warning-50);
        }

        .toast-info {
          border-color: var(--info-200);
          background: var(--info-50);
        }
      `}</style>
    </div>
  );
};

export default ToastNotification;