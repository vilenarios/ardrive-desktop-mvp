import React, { useState, useEffect } from 'react';
import { FileUpload, PendingUpload, AppConfig, DriveInfo } from '../../../types';
import { 
  Upload, 
  Download, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  XCircle,
  Loader,
  File,
  Image,
  Video,
  Music,
  FileText,
  Archive,
  ExternalLink,
  Eye
} from 'lucide-react';

interface ActivityTabProps {
  uploads: FileUpload[];
  downloads: any[];
  pendingUploads: PendingUpload[];
  config: AppConfig;
  drive: DriveInfo;
  onViewFile: (file: FileUpload) => void;
}

interface DownloadActivity {
  id: string;
  fileName: string;
  fileSize: number;
  status: 'completed' | 'downloading' | 'failed' | 'pending';
  progress?: number;
  downloadedAt: Date;
  completedAt?: Date;
  error?: string;
}

export const ActivityTab: React.FC<ActivityTabProps> = ({
  uploads,
  downloads,
  pendingUploads,
  config,
  drive,
  onViewFile
}) => {
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [showAllDownloads, setShowAllDownloads] = useState(false);

  // Use the single drive
  const selectedDrive = drive;

  // Filter uploads to current drive only
  const currentDriveUploads = uploads.filter(upload => 
    upload.driveId === drive?.id
  );


  const getFileIcon = (fileName: string) => {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return <Image size={16} className="file-icon" />;
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
        return <Video size={16} className="file-icon" />;
      case 'mp3':
      case 'wav':
      case 'flac':
        return <Music size={16} className="file-icon" />;
      case 'pdf':
      case 'doc':
      case 'docx':
      case 'pptx':
        return <FileText size={16} className="file-icon" />;
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
        return <Archive size={16} className="file-icon" />;
      default:
        return <File size={16} className="file-icon" />;
    }
  };

  const getUploadStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} className="status-icon success" />;
      case 'uploading':
      case 'pending':
        return <Clock size={16} className="status-icon pending" />;
      case 'failed':
        return <XCircle size={16} className="status-icon error" />;
      default:
        return <Clock size={16} className="status-icon neutral" />;
    }
  };

  const getDownloadStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} className="status-icon success" />;
      case 'downloading':
        return <Loader size={16} className="status-icon pending animate-spin" />;
      case 'pending':
        return <Clock size={16} className="status-icon pending" />;
      case 'failed':
        return <XCircle size={16} className="status-icon error" />;
      default:
        return <Clock size={16} className="status-icon neutral" />;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
  };

  // Get recent uploads (last 30 days, limited to 5 for preview)
  const recentUploads = currentDriveUploads
    .filter(upload => {
      const uploadDate = new Date(upload.completedAt || upload.createdAt);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return uploadDate >= thirtyDaysAgo;
    })
    .sort((a, b) => {
      const dateA = new Date(a.completedAt || a.createdAt);
      const dateB = new Date(b.completedAt || b.createdAt);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, showAllUploads ? undefined : 5);

  // Filter downloads for the current drive
  const currentDriveDownloads = downloads.filter(download => download.driveId === drive?.id);

  // Get recent downloads (last 30 days, limited to 5 for preview)
  const recentDownloads = currentDriveDownloads
    .filter(download => {
      if (!download.downloadedAt) return false;
      const downloadDate = new Date(download.downloadedAt);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return downloadDate >= thirtyDaysAgo;
    })
    .sort((a, b) => {
      const dateA = new Date(a.downloadedAt || 0);
      const dateB = new Date(b.downloadedAt || 0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(0, showAllDownloads ? undefined : 5);

  if (!selectedDrive) {
    return (
      <div className="activity-tab">
        <div className="empty-state">
          <Upload size={48} style={{ opacity: 0.5, marginBottom: 'var(--space-4)' }} />
          <h3>No Drive Selected</h3>
          <p>Select a drive to view its upload and download activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-tab">
      <div className="activity-header">
        <h2>Activity for "{selectedDrive.name}"</h2>
        <p>Recent upload and download activity for this drive</p>
      </div>

      <div className="activity-columns">
        {/* Upload Activity Column */}
        <div className="activity-column upload-column">
          <div className="column-header">
            <div className="column-title">
              <Upload size={20} className="column-icon upload" />
              <h3>Upload Activity</h3>
            </div>
            <span className="activity-subtitle">Last 30 days</span>
          </div>

          <div className="activity-list">
            {recentUploads.length > 0 ? (
              <>
                {recentUploads.map((upload, index) => (
                  <div key={upload.id || index} className="activity-item">
                    <div className="item-icon">
                      {getFileIcon(upload.fileName)}
                    </div>
                    <div className="item-details">
                      <div className="item-name">{upload.fileName}</div>
                      <div className="item-meta">
                        <span className="file-size">
                          {upload.fileSize ? formatFileSize(upload.fileSize) : 'Unknown size'}
                        </span>
                        <span className="separator">•</span>
                        <span className="time-ago">
                          {formatTimeAgo(new Date(upload.completedAt || upload.createdAt))}
                        </span>
                      </div>
                    </div>
                    <div className="item-status">
                      {getUploadStatusIcon(upload.status)}
                    </div>
                    <div className="item-actions">
                      <button 
                        className="action-button"
                        onClick={() => onViewFile(upload)}
                        title="View details"
                      >
                        <Eye size={14} />
                      </button>
                      {upload.transactionId && (
                        <button 
                          className="action-button"
                          onClick={() => window.open(`https://viewblock.io/arweave/tx/${upload.transactionId}`, '_blank')}
                          title="View on Arweave"
                        >
                          <ExternalLink size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {currentDriveUploads.length > 5 && (
                  <button 
                    className="show-all-button"
                    onClick={() => setShowAllUploads(!showAllUploads)}
                  >
                    {showAllUploads ? 'Show Less' : `Show All Uploads (${currentDriveUploads.length})`}
                  </button>
                )}
              </>
            ) : (
              <div className="empty-activity">
                <Upload size={32} className="empty-icon" />
                <p>No recent uploads</p>
                <span>Files you upload will appear here</span>
              </div>
            )}
          </div>
        </div>

        {/* Download Activity Column */}
        <div className="activity-column download-column">
          <div className="column-header">
            <div className="column-title">
              <Download size={20} className="column-icon download" />
              <h3>Download Activity</h3>
            </div>
            <span className="activity-subtitle">Last 30 days</span>
          </div>

          <div className="activity-list">
            {recentDownloads.length > 0 ? (
              <>
                {recentDownloads.map((download) => (
                  <div key={download.id} className="activity-item">
                    <div className="item-icon">
                      {getFileIcon(download.fileName)}
                    </div>
                    <div className="item-details">
                      <div className="item-name">{download.fileName}</div>
                      <div className="item-meta">
                        <span className="file-size">{formatFileSize(download.fileSize)}</span>
                        <span className="separator">•</span>
                        <span className="time-ago">{formatTimeAgo(download.downloadedAt)}</span>
                        {download.progress && download.status === 'downloading' && (
                          <>
                            <span className="separator">•</span>
                            <span className="progress">{download.progress}%</span>
                          </>
                        )}
                      </div>
                      {download.status === 'downloading' && download.progress && (
                        <div className="progress-bar">
                          <div 
                            className="progress-fill"
                            style={{ width: `${download.progress}%` }}
                          ></div>
                        </div>
                      )}
                      {download.error && (
                        <div className="error-message">{download.error}</div>
                      )}
                    </div>
                    <div className="item-status">
                      {getDownloadStatusIcon(download.status)}
                    </div>
                  </div>
                ))}
                
                {currentDriveDownloads.length > 5 && (
                  <button 
                    className="show-all-button"
                    onClick={() => setShowAllDownloads(!showAllDownloads)}
                  >
                    {showAllDownloads ? 'Show Less' : `Show All Downloads (${currentDriveDownloads.length})`}
                  </button>
                )}
              </>
            ) : (
              <div className="empty-activity">
                <Download size={32} className="empty-icon" />
                <p>No recent downloads</p>
                <span>Files you download will appear here</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* Styles are handled by the parent Dashboard component */