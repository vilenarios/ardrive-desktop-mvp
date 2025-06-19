import React from 'react';
import { CheckCircle2, Clock, XCircle, ClipboardList, HelpCircle, FileText, X, Copy, ExternalLink } from 'lucide-react';
import { FileUpload } from '../../types';
import FileLinkActions from './FileLinkActions';

interface FileMetadataModalProps {
  file: FileUpload;
  driveId?: string;
  driveName?: string;
  onClose: () => void;
  onCopySuccess?: (message: string) => void;
}

const FileMetadataModal: React.FC<FileMetadataModalProps> = ({
  file,
  driveId,
  driveName,
  onClose,
  onCopySuccess
}) => {
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopySuccess?.(`${label} copied to clipboard`);
    } catch (err) {
      console.error('Failed to copy:', err);
      onCopySuccess?.('Failed to copy to clipboard');
    }
  };

  const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => (
    <button
      className="copy-btn"
      onClick={() => copyToClipboard(text, label)}
      title={`Copy ${label}`}
    >
      <Copy size={12} />
    </button>
  );

  const IDRow: React.FC<{ label: string; value: string; copyLabel: string }> = ({ label, value, copyLabel }) => (
    <div className="id-row">
      <span className="id-label">{label}:</span>
      <div className="id-value-container">
        <code className="id-value">{value}</code>
        <CopyButton text={value} label={copyLabel} />
      </div>
    </div>
  );
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(new Date(date));
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'var(--ardrive-success)';
      case 'uploading': return 'var(--ardrive-warning)';
      case 'failed': return 'var(--ardrive-danger)';
      default: return 'var(--gray-500)';
    }
  };

  const getStatusIcon = (status: string) => {
    const iconProps = { size: 16, style: { color: getStatusColor(status) } };
    switch (status) {
      case 'completed': return <CheckCircle2 {...iconProps} />;
      case 'uploading': return <Clock {...iconProps} />;
      case 'failed': return <XCircle {...iconProps} />;
      case 'pending': return <ClipboardList {...iconProps} />;
      default: return <HelpCircle {...iconProps} />;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 'var(--space-4)'
    }}>
      <div className="file-metadata-modal">
        <div className="modal-header">
          <h2>File Details</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* File Header */}
        <div className="file-header">
          <div className="file-icon">
            <FileText size={32} />
          </div>
          <div className="file-info">
            <h3 className="file-name">{file.fileName}</h3>
          </div>
        </div>

        {/* Status Card */}
        <div className="status-card">
          <div className="status-header">
            <h4>Upload Status</h4>
            <div className="status-info">
              {getStatusIcon(file.status)}
              <span className="status-text" style={{ color: getStatusColor(file.status) }}>
                {file.status.charAt(0).toUpperCase() + file.status.slice(1)}
              </span>
              {file.uploadMethod && (
                <span className={`method-badge ${file.uploadMethod}`}>
                  {file.uploadMethod === 'turbo' ? '⚡ TURBO' : '🌐 AR'}
                </span>
              )}
            </div>
          </div>
          
          {file.progress > 0 && file.status === 'uploading' && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div className="text-sm text-gray-600">Progress: {file.progress}%</div>
              <div style={{ 
                width: '100%', 
                height: '6px', 
                backgroundColor: 'var(--gray-200)',
                borderRadius: '3px',
                overflow: 'hidden',
                marginTop: 'var(--space-1)'
              }}>
                <div style={{
                  width: `${file.progress}%`,
                  height: '100%',
                  backgroundColor: getStatusColor(file.status),
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>
          )}

          {file.error && (
            <div 
              className="text-sm" 
              style={{ 
                color: 'var(--ardrive-danger)', 
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2)',
                backgroundColor: 'var(--ardrive-danger-light)',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              <strong>Error:</strong> {file.error}
            </div>
          )}
        </div>

        {/* File System Info */}
        <div className="info-card">
          <h4>File System</h4>
          <div className="info-grid">
            <div className="info-item">
              <label>Local Path:</label>
              <code className="path-value">{file.localPath}</code>
            </div>
            <div className="info-item">
              <label>File Size:</label>
              <span>{formatFileSize(file.fileSize)}</span>
            </div>
          </div>
        </div>

        {/* Upload Details */}
        <div className="info-card">
          <h4>Upload Details</h4>
          <IDRow label="File ID" value={file.id} copyLabel="File ID" />
          <div className="info-grid">
            <div className="info-item">
              <label>Created:</label>
              <span>{formatDate(file.createdAt)}</span>
            </div>
            {file.completedAt && (
              <div className="info-item">
                <label>Completed:</label>
                <span>{formatDate(file.completedAt)}</span>
              </div>
            )}
            {file.uploadMethod && (
              <div className="info-item">
                <label>Method:</label>
                <span>{file.uploadMethod === 'turbo' ? 'Turbo Credits (Instant)' : 'AR Tokens (Standard)'}</span>
              </div>
            )}
          </div>
        </div>

        {/* ArDrive/Arweave Info */}
        {(file.fileId || file.dataTxId || file.metadataTxId || driveId) && (
          <div className="info-card">
            <h4>ArDrive & Arweave Identifiers</h4>
            
            {file.fileId && (
              <IDRow label="ArDrive File ID" value={file.fileId} copyLabel="File ID" />
            )}

            {driveId && (
              <IDRow label="Drive ID" value={driveId} copyLabel="Drive ID" />
            )}

            {file.dataTxId && (
              <IDRow label="Data Transaction" value={file.dataTxId} copyLabel="Data Transaction ID" />
            )}

            {file.metadataTxId && (
              <IDRow label="Metadata Transaction" value={file.metadataTxId} copyLabel="Metadata Transaction ID" />
            )}

            {/* Legacy transactionId support */}
            {file.transactionId && !file.dataTxId && (
              <IDRow label="Transaction ID" value={file.transactionId} copyLabel="Transaction ID" />
            )}
            
            {driveName && (
              <div className="info-item">
                <label>Drive Name:</label>
                <span>{driveName}</span>
              </div>
            )}
          </div>
        )}

        {/* Links & Actions */}
        <div className="info-card">
          <h4>External Links & Actions</h4>
          <FileLinkActions
            dataTxId={file.dataTxId || file.transactionId}
            metadataTxId={file.metadataTxId}
            fileId={file.fileId}
            fileName={file.fileName}
            driveId={driveId}
            onCopySuccess={onCopySuccess}
          />
        </div>

        {/* Close Button */}
        <div className="modal-footer">
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileMetadataModal;