import React from 'react';
import ToastNotification, { Toast } from './ToastNotification';

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastNotification
          key={toast.id}
          toast={toast}
          onClose={onClose}
        />
      ))}

      <style>{`
        .toast-container {
          position: fixed;
          top: var(--space-6);
          right: var(--space-6);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          pointer-events: none;
        }

        .toast-container > * {
          pointer-events: auto;
        }
      `}</style>
    </div>
  );
};

export default ToastContainer;