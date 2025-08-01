import React from 'react';
import { SyncProgress } from '../../types';
import { 
  Loader, 
  FolderOpen, 
  FileText, 
  CheckCircle, 
  AlertCircle,
  Database,
  Download
} from 'lucide-react';

interface SyncProgressDisplayProps {
  progress: SyncProgress;
  onClose?: () => void;
}

export const SyncProgressDisplay: React.FC<SyncProgressDisplayProps> = ({ progress, onClose }) => {
  // Log when component mounts
  React.useEffect(() => {
    console.log('🔴 [SYNC-MODAL] SyncProgressDisplay mounted with:', {
      phase: progress.phase,
      description: progress.description,
      timestamp: new Date().toISOString()
    });
    
    return () => {
      console.log('🔴 [SYNC-MODAL] SyncProgressDisplay unmounted');
    };
  }, []);
  
  // Auto-close when metadata sync is complete
  React.useEffect(() => {
    if (progress.phase === 'complete' && onClose) {
      console.log('🔴 [SYNC-MODAL] Phase complete, will close in 1.5s');
      // Give users time to see the completion message
      const timer = setTimeout(() => {
        console.log('🔴 [SYNC-MODAL] Calling onClose');
        onClose();
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [progress.phase, onClose]);

  // Don't render if phase is complete (metadata sync finished)
  if (progress.phase === 'complete') {
    return null;
  }
  const getIcon = () => {
    switch (progress.phase) {
      case 'starting':
        return <Loader className="animate-spin" size={24} />;
      case 'metadata':
        return <Database className="animate-pulse" size={24} />;
      case 'folders':
        return <FolderOpen className="animate-pulse" size={24} />;
      case 'files':
        return <FileText className="animate-pulse" size={24} />;
      case 'verification':
        return <AlertCircle className="animate-pulse" size={24} />;
      case 'complete':
        return <CheckCircle size={24} />;
      default:
        return <Loader className="animate-spin" size={24} />;
    }
  };

  const getProgressColor = () => {
    // Use consistent color throughout the sync process
    if (progress.phase === 'complete') {
      return 'var(--ardrive-secondary)';
    }
    return 'var(--ardrive-primary)';
  };

  const getStepInfo = () => {
    const steps = [
      { phase: 'starting', step: 1, total: 3, description: 'Initializing sync' },
      { phase: 'metadata', step: 2, total: 3, description: 'Loading drive metadata' },
      { phase: 'folders', step: 3, total: 3, description: 'Creating folder structure' },
      { phase: 'files', step: 3, total: 3, description: 'Preparing file downloads' },
      { phase: 'verification', step: 3, total: 3, description: 'Verifying sync state' },
      { phase: 'complete', step: 3, total: 3, description: 'Metadata sync complete' }
    ];
    
    return steps.find(s => s.phase === progress.phase) || steps[0];
  };

  const getProgressPercentage = () => {
    const stepInfo = getStepInfo();
    return (stepInfo.step / stepInfo.total) * 100;
  };

  return (
    <div className="sync-progress-modal">
      <div className="sync-progress-content">
        <div className="sync-progress-header">
          <div className="sync-progress-icon" style={{ color: getProgressColor() }}>
            {getIcon()}
          </div>
          <div className="sync-progress-title">
            <h3>Syncing Drive</h3>
            <div className="sync-progress-step">
              Step {getStepInfo().step} of {getStepInfo().total}
            </div>
          </div>
        </div>

        <div className="sync-progress-body">
          <p className="sync-progress-description">
            {getStepInfo().description}
          </p>
          
          {progress.currentItem && (
            <p className="sync-progress-current-item">
              <Download size={14} />
              <span>{progress.currentItem}</span>
            </p>
          )}

          <div className="sync-progress-bar-container">
            <div 
              className="sync-progress-bar"
              style={{ 
                width: `${getProgressPercentage()}%`,
                backgroundColor: getProgressColor(),
                transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                borderRadius: '4px'
              }}
            />
          </div>

          {progress.itemsProcessed !== undefined && (
            <div className="sync-progress-stats">
              <span>Items processed: {progress.itemsProcessed}</span>
              {progress.estimatedRemaining !== undefined && (
                <span>Remaining: ~{progress.estimatedRemaining}</span>
              )}
            </div>
          )}
        </div>

        {/* Auto-close handles completion - no manual close button needed */}
      </div>
    </div>
  );
};