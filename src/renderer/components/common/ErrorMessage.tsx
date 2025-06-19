import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorMessageProps {
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  supportLink?: boolean;
  variant?: 'error' | 'warning' | 'info';
  className?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title,
  description,
  action,
  supportLink = true,
  variant = 'error',
  className = ''
}) => {
  const handleSupportClick = () => {
    // In a real app, this would open support chat or email
    window.open('mailto:support@ardrive.io?subject=ArDrive Desktop Support', '_blank');
  };

  return (
    <div className={`error-message error-message--${variant} ${className}`}>
      <div className="error-icon">
        <AlertCircle size={24} />
      </div>
      
      <div className="error-content">
        <h3 className="error-title">{title}</h3>
        <p className="error-description">{description}</p>
        
        <div className="error-actions">
          {action && (
            <button 
              className="error-action-button"
              onClick={action.onClick}
            >
              <RefreshCw size={16} />
              {action.label}
            </button>
          )}
          
          {supportLink && (
            <button 
              className="support-link"
              onClick={handleSupportClick}
            >
              Contact support
            </button>
          )}
        </div>
      </div>

      <style>{`
        .error-message {
          display: flex;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          background: var(--red-50);
          border: 1px solid var(--red-200);
          margin: var(--space-4) 0;
        }

        .error-message--warning {
          background: var(--yellow-50);
          border-color: var(--yellow-200);
        }

        .error-message--warning .error-icon {
          color: var(--yellow-600);
        }

        .error-message--info {
          background: var(--blue-50);
          border-color: var(--blue-200);
        }

        .error-message--info .error-icon {
          color: var(--blue-600);
        }

        .error-icon {
          color: var(--red-600);
          flex-shrink: 0;
          margin-top: var(--space-1);
        }

        .error-content {
          flex: 1;
          min-width: 0;
        }

        .error-title {
          font-size: var(--text-base);
          font-weight: 600;
          color: var(--gray-900);
          margin: 0 0 var(--space-2) 0;
        }

        .error-description {
          font-size: var(--text-sm);
          color: var(--gray-700);
          margin: 0 0 var(--space-3) 0;
          line-height: 1.5;
        }

        .error-actions {
          display: flex;
          gap: var(--space-3);
          align-items: center;
        }

        .error-action-button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--ardrive-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .error-action-button:hover {
          background: var(--ardrive-primary-dark);
        }

        .error-action-button:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
        }

        .support-link {
          background: none;
          border: none;
          color: var(--gray-600);
          font-size: var(--text-sm);
          text-decoration: underline;
          cursor: pointer;
          padding: var(--space-1);
        }

        .support-link:hover {
          color: var(--gray-800);
        }

        .support-link:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
    </div>
  );
};