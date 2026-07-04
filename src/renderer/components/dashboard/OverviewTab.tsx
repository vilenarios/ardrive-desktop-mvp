import React, { useState, useEffect } from 'react';
import { DriveInfo, AppConfig } from '../../../types';
import { 
  HardDrive, 
  Copy,
  Lock,
  Globe,
  FolderOpen,
  Cloud,
  Zap,
  FileDown,
  ExternalLink,
  FileJson,
  Edit,
  AlertCircle,
  CreditCard
} from 'lucide-react';
import CreateManifestModal from '../CreateManifestModal';
import { ARDRIVE_OPERATION_SIZES, isArDriveOperationFree } from '../../../utils/turbo-utils';

interface OverviewTabProps {
  drive: DriveInfo;
  config: AppConfig;
  toast?: {
    success: (message: string) => void;
    error: (message: string) => void;
  };
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  drive,
  config,
  toast
}) => {
  const selectedDrive = drive;
  const [driveStats, setDriveStats] = useState<{
    fileCount: number;
    folderCount: number;
    totalSize: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showManifestModal, setShowManifestModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newDriveName, setNewDriveName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showRenameCostConfirm, setShowRenameCostConfirm] = useState(false);
  const [walletBalances, setWalletBalances] = useState<{ ar: number; turbo: number | null }>({ ar: 0, turbo: null });

  useEffect(() => {
    if (selectedDrive) {
      loadDriveStats();
      loadWalletBalances();
    }
  }, [selectedDrive?.id]);

  const loadDriveStats = async () => {
    try {
      setLoading(true);
      
      // Get real data from permaweb (use cache for instant loading)
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(selectedDrive.id, false);
      
      const files = permawebFiles.filter((item: any) => item.type === 'file');
      const folders = permawebFiles.filter((item: any) => item.type === 'folder');
      
      // Only log issues
      const filesWithoutSize = files.filter((file: any) => !file.size || file.size === 0);
      if (filesWithoutSize.length > 0) {
        console.warn(`⚠️ ${filesWithoutSize.length}/${files.length} files missing size in permaweb data`);
      }
      
      const stats = {
        fileCount: files.length,
        folderCount: folders.length,
        totalSize: files.reduce((total: number, file: any) => {
          const fileSize = file.size || 0;
          return total + fileSize;
        }, 0)
      };
      
      console.log('📈 Drive stats from permaweb:', stats);
      setDriveStats(stats);
    } catch (error) {
      console.error('Failed to load drive stats:', error);
      // Fallback to empty stats
      setDriveStats({
        fileCount: 0,
        folderCount: 0,
        totalSize: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const loadWalletBalances = async () => {
    try {
      const wallet = await window.electronAPI.wallet.getInfo();
      let turboBalance = null;
      
      try {
        const turbo = await window.electronAPI.turbo.getBalance();
        if (turbo && turbo.winc) {
          // Convert Winston Credits to AR equivalent for display
          turboBalance = parseFloat(turbo.winc) / 1e12;
        }
      } catch (err) {
        console.log('Turbo not initialized or error getting balance');
      }
      
      setWalletBalances({
        ar: parseFloat(wallet.balance) || 0,
        turbo: turboBalance
      });
    } catch (error) {
      console.error('Failed to load wallet balances:', error);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatContains = (folderCount: number, fileCount: number) => {
    const parts = [];
    if (folderCount > 0) {
      parts.push(`${folderCount} folder${folderCount !== 1 ? 's' : ''}`);
    }
    if (fileCount > 0) {
      parts.push(`${fileCount} file${fileCount !== 1 ? 's' : ''}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'Empty';
  };

  const exportDriveMetadata = async () => {
    try {
      console.log('Starting drive metadata export for drive:', selectedDrive.id);
      
      // Get the permaweb files data
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(selectedDrive.id, true);
      console.log('Retrieved permaweb files:', permawebFiles);
      
      if (!permawebFiles || permawebFiles.length === 0) {
        alert('No files found to export');
        return;
      }

      // Convert the data to CSV format
      const csvHeaders = [
        'File Id',
        'File Name', 
        'Parent Folder ID',
        'Parent Folder Name',
        'Data Transaction ID',
        'Metadata Transaction ID',
        'File Size',
        'Date Created',
        'Last Modified',
        'Direct Download Link',
        'Status'
      ];

      const csvRows = permawebFiles
        .filter((item: any) => item.type === 'file') // Only export files, not folders
        .map((file: any) => {
          // Format dates to match the example CSV format
          const formatDate = (dateStr: string) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            return date.toISOString().replace('T', ' ').replace('Z', '.000');
          };

          return [
            file.id || '',
            file.name || '',
            file.parentId || '',
            file.parentName || selectedDrive?.name || '', // Use drive name as fallback
            file.dataTxId || '',
            file.metadataTxId || '',
            file.size || 0,
            formatDate(file.createdAt || file.modifiedAt),
            formatDate(file.modifiedAt),
            file.dataTxId ? `https://arweave.net/${file.dataTxId}` : '',
            'confirmed' // Default status - could be enhanced based on actual status
          ];
        });

      // Generate CSV content
      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map((row: (string | number)[]) => 
          row.map((field: string | number) => 
            // Escape fields that contain commas, quotes, or newlines
            typeof field === 'string' && (field.includes(',') || field.includes('"') || field.includes('\n'))
              ? `"${field.replace(/"/g, '""')}"` 
              : field
          ).join(',')
        )
      ].join('\n');

      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/:/g, '_')
        .replace('T', ' ')
        .replace('Z', '')
        .replace(/\./g, '_');
      
      const filename = `Export from ${selectedDrive?.id || 'Drive'} ${timestamp}.csv`;

      // Create and download the file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        console.log(`CSV export completed: ${filename}`);
        // Could add a toast notification here
      } else {
        throw new Error('CSV download not supported');
      }
      
    } catch (error) {
      console.error('Failed to export drive metadata:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleRenameClick = () => {
    if (!newDriveName.trim()) {
      setRenameError('Drive name cannot be empty');
      return;
    }

    if (newDriveName === selectedDrive.name) {
      setShowRenameModal(false);
      return;
    }

    // Show cost confirmation
    setShowRenameCostConfirm(true);
  };

  const handleRenameDrive = async () => {
    setIsRenaming(true);
    setRenameError(null);

    try {
      // Call the real ArDrive API to rename the drive
      const result = await window.electronAPI.drive.rename(selectedDrive.id, newDriveName.trim());
      
      // Show success with payment method info
      const paymentMethod = result.usedTurbo ? ' (Free with Turbo!)' : ' (Paid with AR)';
      toast?.success(`Drive renamed to "${newDriveName}"${paymentMethod}`);
      setShowRenameModal(false);
      setShowRenameCostConfirm(false);
      
      // The parent Dashboard component should refresh drives list
      // This will trigger a re-render with the updated drive name
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Failed to rename drive');
      toast?.error(error instanceof Error ? error.message : 'Failed to rename drive');
    } finally {
      setIsRenaming(false);
    }
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
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '600', margin: 0, marginBottom: 'var(--space-2)' }}>
          Dashboard Overview
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '16px', margin: 0 }}>
          Welcome to your drive! Here&apos;s what&apos;s happening with your permanent storage.
        </p>
      </div>


      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-6)',
        marginBottom: 'var(--space-6)'
      }}>
        {/* Drive Information */}
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

            {selectedDrive.dateCreated && (
              <div className="metadata-row">
                <span className="metadata-label">Created</span>
                <span className="metadata-value">{formatDate(new Date(selectedDrive.dateCreated))}</span>
              </div>
            )}

            <div className="metadata-row">
              <span className="metadata-label">Size</span>
              <span className="metadata-value">
                {loading ? '...' : formatFileSize(driveStats?.totalSize || 0)}
              </span>
            </div>

            <div className="metadata-row">
              <span className="metadata-label">Contains</span>
              <span className="metadata-value">
                {loading ? '...' : formatContains(driveStats?.folderCount || 0, driveStats?.fileCount || 0)}
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

        {/* Quick Actions */}
        <div className="summary-card">
          <div className="card-header">
            <div className="header-left">
              <Zap size={20} />
              <h3>Quick Actions</h3>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <button 
              className="button large"
              onClick={async () => {
                if (config.syncFolder) {
                  await window.electronAPI.shell.openPath(config.syncFolder);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <FolderOpen size={16} />
              Open Sync Folder
            </button>

            <button 
              className="button outline large"
              onClick={() => {
                setNewDriveName(selectedDrive.name);
                setRenameError(null);
                setShowRenameModal(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <Edit size={16} />
              Rename Drive
            </button>

            <button 
              className="button outline large"
              onClick={() => {
                // Open drive in ArDrive web app
                const encodedName = encodeURIComponent(selectedDrive.name);
                const driveUrl = `https://app.ardrive.io/#/drives/${selectedDrive.id}?name=${encodedName}`;
                window.electronAPI.shell.openExternal(driveUrl);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <ExternalLink size={16} />
              View Drive Online
            </button>

            <button 
              className="button outline large"
              onClick={exportDriveMetadata}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <FileDown size={16} />
              Export Metadata
            </button>

            <button 
              className="button outline large"
              onClick={() => setShowManifestModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                justifyContent: 'center'
              }}
            >
              <FileJson size={16} />
              Create Manifest
            </button>
          </div>
        </div>
      </div>

      {showManifestModal && (
        <CreateManifestModal
          driveId={selectedDrive.id}
          driveName={selectedDrive.name}
          onClose={() => setShowManifestModal(false)}
          onSuccess={(manifestUrl) => {
            // Refresh the permaweb files to show the new manifest
            console.log('Manifest created successfully:', manifestUrl);
            // The URL is already copied to clipboard by CreateManifestModal
          }}
          toast={toast}
        />
      )}

      {/* Rename Drive Modal */}
      {showRenameModal && (
        <div className="modal-overlay">
          <div className="modal-content overview-modal-panel">
            <h2 className="overview-modal-title">
              Rename Drive
            </h2>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label className="overview-modal-label">
                Drive Name
              </label>
              <input
                type="text"
                value={newDriveName}
                onChange={(e) => {
                  setNewDriveName(e.target.value);
                  setRenameError(null);
                }}
                className={`overview-modal-input${renameError ? ' has-error' : ''}`}
                disabled={isRenaming}
                autoFocus
              />
              {renameError && (
                <p className="overview-modal-error">
                  {renameError}
                </p>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: 'var(--space-3)',
              justifyContent: 'flex-end'
            }}>
              <button
                className="button outline"
                onClick={() => setShowRenameModal(false)}
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                className="button"
                onClick={handleRenameClick}
                disabled={isRenaming || !newDriveName.trim()}
              >
                {isRenaming ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Cost Confirmation Modal */}
      {showRenameCostConfirm && (
        <div className="modal-overlay">
          <div className="modal-content overview-modal-panel overview-modal-panel-wide">
            <h2 className="overview-modal-title">
              Confirm Drive Rename
            </h2>

            <div className="overview-rename-summary">
              <p style={{ margin: 0, color: 'var(--text-primary)' }}>
                Renaming <strong>&quot;{selectedDrive.name}&quot;</strong> to <strong>&quot;{newDriveName}&quot;</strong>
              </p>
            </div>

            {/* Cost Information */}
            <div className="overview-cost-card">
              <h3 className="overview-cost-card-title">
                <CreditCard size={18} />
                Transaction Cost
              </h3>

              {isArDriveOperationFree('RENAME_DRIVE') ? (
                <div className="overview-cost-free-banner">
                  <div className="overview-cost-free-banner-heading">
                    <Zap size={16} />
                    FREE with Turbo Credits
                  </div>
                  <p className="overview-cost-free-banner-copy">
                    This operation is under 100KB and qualifies for free upload via Turbo.
                  </p>
                </div>
              ) : null}

              <div className="overview-cost-rows">
                <div className="overview-cost-row">
                  <span className="overview-cost-row-label">AR Token Cost:</span>
                  <span className="overview-cost-row-value">~0.000001 AR</span>
                </div>

                <div className="overview-cost-row">
                  <span className="overview-cost-row-label">Your AR Balance:</span>
                  <span
                    className="overview-cost-row-value"
                    style={{ color: walletBalances.ar < 0.000001 ? 'var(--danger)' : 'var(--success)' }}
                  >
                    {walletBalances.ar.toFixed(6)} AR
                  </span>
                </div>

                {walletBalances.turbo !== null && (
                  <div className="overview-cost-row">
                    <span className="overview-cost-row-label">Turbo Balance:</span>
                    <span className="overview-cost-row-value" style={{ color: 'var(--success)' }}>
                      {walletBalances.turbo.toFixed(6)} Credits
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Warning if insufficient balance */}
            {walletBalances.ar < 0.000001 && !isArDriveOperationFree('RENAME_DRIVE') && (
              <div className="overview-cost-warning">
                <AlertCircle size={16} style={{ color: 'var(--danger)', marginTop: '2px', flexShrink: 0 }} />
                <p style={{ margin: 0 }}>
                  Insufficient AR balance. You need at least 0.000001 AR to rename the drive.
                </p>
              </div>
            )}

            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                className="button secondary"
                onClick={() => setShowRenameCostConfirm(false)}
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                className="button primary"
                onClick={handleRenameDrive}
                disabled={isRenaming || (walletBalances.ar < 0.000001 && !isArDriveOperationFree('RENAME_DRIVE'))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {isRenaming ? (
                  <>
                    <div className="spinner" style={{ width: '16px', height: '16px' }} />
                    Renaming...
                  </>
                ) : (
                  <>
                    <Edit size={16} />
                    Confirm Rename
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};