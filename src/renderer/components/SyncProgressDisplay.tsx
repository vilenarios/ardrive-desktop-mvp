import React from 'react';
import { SyncProgress } from '../../types';
import {
  Loader,
  FolderOpen,
  FileText,
  CheckCircle,
  AlertCircle,
  Database,
  Download,
  X,
  RefreshCw
} from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

interface SyncProgressDisplayProps {
  progress: SyncProgress;
  onClose?: () => void;
  // UX-8: optional retry affordance shown alongside Dismiss in the error
  // state (reuses the pattern SYNC-20 established for setup failures).
  onRetry?: () => void;
}

export const SyncProgressDisplay: React.FC<SyncProgressDisplayProps> = ({ progress, onClose, onRetry }) => {
  // UX-8: a failed sync must never be an infinite, undismissable spinner.
  // Some callers historically rendered this modal without wiring onClose at
  // all (DriveAndSyncSetup did) — fall back to a no-op so the escape hatch
  // below (Escape key / backdrop-click / close button) always has something
  // safe to call even if a future caller forgets to pass onClose.
  const handleClose = React.useCallback(() => {
    onClose?.();
  }, [onClose]);

  // Treat either shape as a failure: renderer-side failure handlers set
  // phase: 'error' with a string message; main.ts's sync:manual catch block
  // emits the legacy { phase: 'complete', error: true } shorthand (message is
  // in `description`) — see src/types/index.ts SyncProgress.error.
  const isError = progress.phase === 'error' || !!progress.error;
  const errorMessage = typeof progress.error === 'string' ? progress.error : progress.description;

  // Log when component mounts
  React.useEffect(() => {
    console.log('🔴 [SYNC-MODAL] SyncProgressDisplay mounted with:', {
      phase: progress.phase,
      description: progress.description,
      isError,
      timestamp: new Date().toISOString()
    });

    return () => {
      console.log('🔴 [SYNC-MODAL] SyncProgressDisplay unmounted');
    };
  }, []);

  // Auto-close only on a genuine, error-free completion. A failed sync must
  // stay on screen (with its error clearly shown) until the user dismisses
  // it themselves — auto-hiding here would defeat the error state entirely.
  React.useEffect(() => {
    if (progress.phase === 'complete' && !progress.error && onClose) {
      console.log('🔴 [SYNC-MODAL] Phase complete, will close in 1.5s');
      // Give users time to see the completion message
      const timer = setTimeout(() => {
        console.log('🔴 [SYNC-MODAL] Calling onClose');
        onClose();
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [progress.phase, progress.error, onClose]);

  // A11Y-3-style shared modal behavior: Escape closes, focus is trapped
  // inside the panel, and focus returns to whatever triggered the sync on
  // close — regardless of which phase (in-progress or error) is showing.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(true, handleClose);

  // Don't render on a clean completion (metadata sync finished with no
  // error) — a failed "complete" (error-shorthand from sync:manual) falls
  // through to the error UI below instead of vanishing silently.
  if (progress.phase === 'complete' && !progress.error) {
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
      case 'error':
        return <AlertCircle size={24} />;
      default:
        return <Loader className="animate-spin" size={24} />;
    }
  };

  const getProgressColor = () => {
    // Use consistent color throughout the sync process
    if (isError) {
      return 'var(--danger)';
    }
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

  const progressPercentage = getProgressPercentage();

  return (
    <div className="sync-progress-modal" onClick={handleBackdropClick}>
      <div
        className="sync-progress-content"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-progress-modal-title"
        aria-describedby={isError ? 'sync-progress-modal-error' : undefined}
      >
        <div className="sync-progress-header">
          <div className="sync-progress-icon" style={{ color: getProgressColor() }}>
            {isError ? <AlertCircle size={24} /> : getIcon()}
          </div>
          <div className="sync-progress-title">
            <h3 id="sync-progress-modal-title">{isError ? 'Sync Failed' : 'Syncing Drive'}</h3>
            {!isError && (
              <div className="sync-progress-step">
                Step {getStepInfo().step} of {getStepInfo().total}
              </div>
            )}
          </div>
          {/* UX-8: escape hatch #1 — always available, in every phase, so a
              hung or failed sync can never trap the user behind this modal. */}
          <button
            type="button"
            className="sync-progress-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="sync-progress-body">
          {isError ? (
            <div className="error-message" id="sync-progress-modal-error" role="alert">
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          ) : (
            <>
              <p className="sync-progress-description">
                {getStepInfo().description}
              </p>

              {progress.currentItem && (
                <p className="sync-progress-current-item">
                  <Download size={14} />
                  <span>{progress.currentItem}</span>
                </p>
              )}

              <div
                className="sync-progress-bar-container"
                role="progressbar"
                aria-valuenow={Math.round(progressPercentage)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Sync progress"
              >
                <div
                  className="sync-progress-bar"
                  style={{
                    width: `${progressPercentage}%`,
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
            </>
          )}
        </div>

        {/* UX-8: escape hatch #2 — an explicit Dismiss (plus Retry, when the
            caller wired one) so a failed sync always has a clear way forward
            beyond the header close button and Escape/backdrop-click. */}
        {isError && (
          <div className="sync-progress-footer">
            {onRetry && (
              <button type="button" className="button small" onClick={onRetry}>
                <RefreshCw size={14} />
                Retry
              </button>
            )}
            <button type="button" className="button small outline" onClick={handleClose}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
};