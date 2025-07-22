import React from 'react';
import { CheckCircle2, AlertTriangle, X, Loader, Check } from 'lucide-react';

export type UploadStatus = 'ready' | 'uploading' | 'uploaded' | 'failed' | 'conflict';

interface StatusPillProps {
  status: UploadStatus;
  progress?: number; // For uploading state
}

const StatusPill: React.FC<StatusPillProps> = ({ status, progress = 0 }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'ready':
        return {
          label: 'Ready',
          color: 'var(--success-600)',
          backgroundColor: 'var(--success-50)',
          borderColor: 'var(--success-200)',
          icon: <CheckCircle2 size={14} />
        };
      
      case 'uploading':
        return {
          label: progress > 0 ? `${Math.round(progress)}%` : 'Uploading...',
          color: 'var(--ardrive-primary)',
          backgroundColor: 'var(--ardrive-primary-50)',
          borderColor: 'var(--gray-200)',
          icon: <Loader size={14} className="status-spinner" />
        };
      
      case 'uploaded':
        return {
          label: 'Uploaded',
          color: 'var(--success-700)',
          backgroundColor: 'var(--success-100)',
          borderColor: 'var(--success-300)',
          icon: <Check size={14} />
        };
      
      case 'failed':
        return {
          label: 'Failed',
          color: 'var(--error-600)',
          backgroundColor: 'var(--error-50)',
          borderColor: 'var(--error-200)',
          icon: <X size={14} />
        };
      
      case 'conflict':
        return {
          label: 'Conflict',
          color: 'var(--warning-700)',
          backgroundColor: 'var(--warning-50)',
          borderColor: 'var(--warning-200)',
          icon: <AlertTriangle size={14} />
        };
      
      default:
        return {
          label: 'Unknown',
          color: 'var(--gray-600)',
          backgroundColor: 'var(--gray-50)',
          borderColor: 'var(--gray-200)',
          icon: <AlertTriangle size={14} />
        };
    }
  };

  const config = getStatusConfig();

  return (
    <span 
      className={`status-pill status-pill--${status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '500',
        color: config.color,
        backgroundColor: config.backgroundColor,
        border: `1px solid ${config.borderColor}`,
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Progress bar for uploading state */}
      {status === 'uploading' && progress > 0 && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            backgroundColor: config.color,
            opacity: 0.1,
            transition: 'width 0.3s ease'
          }}
        />
      )}
      
      {/* Icon with animation */}
      <span style={{ 
        display: 'flex', 
        alignItems: 'center',
        position: 'relative',
        zIndex: 1
      }}>
        {config.icon}
      </span>
      
      {/* Label */}
      <span style={{ position: 'relative', zIndex: 1 }}>
        {config.label}
      </span>
    </span>
  );
};

export default StatusPill;

// Add these styles to your global CSS file
export const statusPillStyles = `
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.8);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes successPulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
    }
  }

  .status-spinner {
    animation: spin 1s linear infinite;
  }

  .status-pill {
    animation: fadeIn 0.3s ease-out;
  }

  .status-pill--uploaded {
    animation: fadeIn 0.3s ease-out, successPulse 0.5s ease-out 0.3s;
  }
`;