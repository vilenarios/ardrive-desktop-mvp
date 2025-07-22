import React, { useMemo } from 'react';
import { 
  Download,
  CheckCircle,
  Clock,
  FolderOpen,
  RefreshCw,
  Loader,
  XCircle,
  Pause,
  Play
} from 'lucide-react';

interface FileDownload {
  id: string;
  fileName: string;
  localPath: string;
  fileSize: number;
  fileId: string;
  dataTxId?: string;
  metadataTxId?: string;
  status: 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
  error?: string;
  downloadedAt: Date;
  completedAt?: Date;
}

interface DownloadQueueTabProps {
  downloads: FileDownload[];
  onOpenFolder: (path: string) => void;
  onRetryDownload?: (downloadId: string) => void;
  onPauseDownload?: (downloadId: string) => void;
  onResumeDownload?: (downloadId: string) => void;
}

export const DownloadQueueTab: React.FC<DownloadQueueTabProps> = ({
  downloads,
  onOpenFolder,
  onRetryDownload,
  onPauseDownload,
  onResumeDownload
}) => {

  // Filter to only show active downloads (queue items)
  const activeDownloads = useMemo(() => {
    return downloads
      .filter(download => {
        // Only show active downloads (downloading, paused, or failed that can be retried)
        return download.status === 'downloading' || download.status === 'paused' || download.status === 'failed';
      })
      .sort((a, b) => {
        // Sort by date (newest first)
        return new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime();
      });
  }, [downloads]);

  // Stats for active downloads only (queue items)
  const downloadStats = useMemo(() => {
    const stats = {
      active: 0,
      failed: 0,
      paused: 0,
      totalSize: 0
    };

    downloads.forEach(download => {
      // Only count active downloads (queue items)
      if (download.status === 'downloading' || download.status === 'failed' || download.status === 'paused') {
        if (download.status === 'downloading') stats.active++;
        else if (download.status === 'failed') stats.failed++;
        else if (download.status === 'paused') stats.paused++;
        
        stats.totalSize += download.fileSize;
      }
    });

    return stats;
  }, [downloads]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'downloading':
        return <Loader size={16} className="animate-spin" style={{ color: 'var(--ardrive-primary-600)' }} />;
      case 'completed':
        return <CheckCircle size={16} style={{ color: 'var(--success-600)' }} />;
      case 'failed':
        return <XCircle size={16} style={{ color: 'var(--error-600)' }} />;
      case 'paused':
        return <Pause size={16} style={{ color: 'var(--warning-600)' }} />;
      default:
        return <Clock size={16} style={{ color: 'var(--gray-500)' }} />;
    }
  };

  if (downloads.length === 0) {
    return (
      <div className="download-queue-tab">
        <div className="empty-queue" style={{
          textAlign: 'center',
          padding: 'var(--space-12) var(--space-8)',
          color: 'var(--gray-600)'
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            margin: '0 auto var(--space-6)',
            backgroundColor: 'var(--success-50)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Download size={40} style={{ color: 'var(--success-600)' }} />
          </div>
          <h3 style={{ 
            fontSize: '20px', 
            fontWeight: '600', 
            marginBottom: 'var(--space-3)',
            color: 'var(--gray-900)'
          }}>
            No Downloads Yet
          </h3>
          <p style={{ 
            fontSize: '15px', 
            marginBottom: 'var(--space-6)',
            maxWidth: '400px',
            margin: '0 auto'
          }}>
            Active downloads will appear here. Completed downloads can be found in the Activity tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="download-queue-tab">
      {/* Header with stats */}
      <div style={{
        padding: 'var(--space-6)',
        borderBottom: '1px solid var(--gray-200)',
        backgroundColor: 'var(--gray-50)'
      }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0, marginBottom: 'var(--space-4)' }}>Download Queue</h2>
        </div>

        {/* Stats */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-6)',
          fontSize: '14px',
          color: 'var(--gray-600)'
        }}>
          {downloadStats.active > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Loader size={14} className="animate-spin" style={{ color: 'var(--ardrive-primary-600)' }} />
              <span>{downloadStats.active} downloading</span>
            </div>
          )}
          {downloadStats.failed > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <XCircle size={14} style={{ color: 'var(--error-600)' }} />
              <span>{downloadStats.failed} failed</span>
            </div>
          )}
          {downloadStats.paused > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Pause size={14} style={{ color: 'var(--warning-600)' }} />
              <span>{downloadStats.paused} paused</span>
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            {formatFileSize(downloadStats.totalSize)} total
          </div>
        </div>
      </div>


      {/* Download list */}
      <div style={{
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 400px)'
      }}>
        {activeDownloads.length === 0 ? (
          <div style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--gray-500)'
          }}>
            No active downloads in queue
          </div>
        ) : (
          <div style={{ padding: 'var(--space-4)' }}>
            {activeDownloads.map((download) => (
              <div
                key={download.id}
                style={{
                  padding: 'var(--space-4)',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 'var(--space-3)',
                  backgroundColor: 'white',
                  transition: 'box-shadow 0.2s',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)'
                }}>
                  {/* Status icon */}
                  <div style={{ flexShrink: 0 }}>
                    {getStatusIcon(download.status)}
                  </div>

                  {/* File info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: '500',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {download.fileName}
                    </div>
                    <div style={{
                      fontSize: '13px',
                      color: 'var(--gray-600)',
                      display: 'flex',
                      gap: 'var(--space-3)'
                    }}>
                      <span>{formatFileSize(download.fileSize)}</span>
                      <span>•</span>
                      <span>{formatDate(download.downloadedAt)}</span>
                      {download.status === 'downloading' && (
                        <>
                          <span>•</span>
                          <span>{download.progress}%</span>
                        </>
                      )}
                    </div>
                    {download.error && (
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--error-600)',
                        marginTop: '4px'
                      }}>
                        {download.error}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    flexShrink: 0
                  }}>
                    {download.status === 'completed' && (
                      <button
                        className="button small outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          // For cross-platform compatibility, just pass the full file path
                          // The main process will handle extracting the directory properly
                          console.log('Opening folder for file:', download.localPath);
                          onOpenFolder(download.localPath);
                        }}
                        title="Open containing folder"
                      >
                        <FolderOpen size={14} />
                      </button>
                    )}
                    {download.status === 'failed' && onRetryDownload && (
                      <button
                        className="button small outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRetryDownload(download.id);
                        }}
                        title="Retry download"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    {download.status === 'downloading' && onPauseDownload && (
                      <button
                        className="button small outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPauseDownload(download.id);
                        }}
                        title="Pause download"
                      >
                        <Pause size={14} />
                      </button>
                    )}
                    {download.status === 'paused' && onResumeDownload && (
                      <button
                        className="button small outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResumeDownload(download.id);
                        }}
                        title="Resume download"
                      >
                        <Play size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar for active downloads */}
                {download.status === 'downloading' && (
                  <div style={{
                    marginTop: 'var(--space-3)',
                    height: '4px',
                    backgroundColor: 'var(--gray-200)',
                    borderRadius: '2px',
                    overflow: 'hidden'
                  }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${download.progress}%`,
                        backgroundColor: 'var(--ardrive-primary-600)',
                        transition: 'width 0.3s ease'
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};