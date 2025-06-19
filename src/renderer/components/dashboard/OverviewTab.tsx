import React from 'react';
import { WalletInfo, SyncStatus, DriveInfo, AppConfig } from '../../../types';
import { 
  HardDrive, 
  Activity, 
  Copy,
  CheckCircle,
  Lock,
  Globe
} from 'lucide-react';

interface OverviewTabProps {
  walletInfo: WalletInfo;
  syncStatus: SyncStatus | null;
  drive: DriveInfo;
  config: AppConfig;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  walletInfo,
  syncStatus,
  drive,
  config
}) => {
  const selectedDrive = drive;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  if (!selectedDrive) {
    return (
      <div className="overview-tab">
        <div className="empty-state">
          <HardDrive size={48} style={{ marginBottom: 'var(--space-4)', opacity: 0.5 }} />
          <h3>No Drive Selected</h3>
          <p>Select a drive to view its information.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-tab">
      {/* Drive Information Card */}
      <div className="summary-card">
        <div className="card-header">
          <div className="header-left">
            {selectedDrive.privacy === 'private' ? <Lock size={20} /> : <Globe size={20} />}
            <h3>Drive Information</h3>
          </div>
        </div>

        <div className="drive-metadata">
          <div className="metadata-row">
            <span className="metadata-label">Drive Name</span>
            <span className="metadata-value">{selectedDrive.name}</span>
          </div>

          <div className="metadata-row">
            <span className="metadata-label">Privacy</span>
            <span className="metadata-value">
              {selectedDrive.privacy === 'private' ? '🔒 Private' : '🌐 Public'}
            </span>
          </div>

          <div className="metadata-row">
            <span className="metadata-label">Drive ID</span>
            <div className="metadata-value drive-id">
              <span>{selectedDrive.id}</span>
              <button 
                className="icon-button"
                onClick={() => copyToClipboard(selectedDrive.id)}
                title="Copy Drive ID"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Sync Status Card */}
      <div className="summary-card">
        <div className="card-header">
          <div className="header-left">
            <Activity size={20} />
            <h3>Sync Status</h3>
          </div>
        </div>

        <div className="sync-status-simple">
          {syncStatus ? (
            <>
              <div className="sync-status-row">
                <span className="status-label">Status</span>
                <span className={`status-value ${syncStatus.isActive ? 'active' : 'idle'}`}>
                  {syncStatus.isActive ? (
                    <>
                      <Activity size={16} className="animate-pulse" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      Idle
                    </>
                  )}
                </span>
              </div>

              {syncStatus.totalFiles > 0 && (
                <>
                  <div className="sync-status-row">
                    <span className="status-label">Files Uploaded</span>
                    <span className="status-value">
                      {syncStatus.uploadedFiles} / {syncStatus.totalFiles}
                    </span>
                  </div>

                  {syncStatus.failedFiles > 0 && (
                    <div className="sync-status-row">
                      <span className="status-label">Failed Files</span>
                      <span className="status-value error">
                        {syncStatus.failedFiles}
                      </span>
                    </div>
                  )}

                  {syncStatus.currentFile && (
                    <div className="sync-status-row">
                      <span className="status-label">Current File</span>
                      <span className="status-value current-file">
                        {syncStatus.currentFile}
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="no-sync-data">
              <p>No sync information available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};