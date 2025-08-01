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
  Play,
  Cloud
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
  onSyncDrive?: () => void;
}

export const DownloadQueueTab: React.FC<DownloadQueueTabProps> = ({
  downloads,
  onOpenFolder,
  onRetryDownload,
  onPauseDownload,
  onResumeDownload,
  onSyncDrive
}) => {
  const [queueStatus, setQueueStatus] = React.useState<{ queued: number; active: number; total: number } | null>(null);
  const [queuedDownloads, setQueuedDownloads] = React.useState<any[]>([]);

  // Fetch queue status and queued downloads periodically
  React.useEffect(() => {
    const fetchQueueData = async () => {
      try {
        // Fetch queue status
        const statusResult = await window.electronAPI.files.getQueueStatus();
        if (statusResult.success) {
          setQueueStatus(statusResult.data);
        }
        
        // Fetch queued downloads (show up to 30)
        const queuedResult = await window.electronAPI.files.getQueuedDownloads(30);
        if (queuedResult.success) {
          setQueuedDownloads(queuedResult.data);
        }
      } catch (error) {
        console.error('Failed to fetch queue data:', error);
      }
    };

    fetchQueueData();
    const interval = setInterval(fetchQueueData, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, []);

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
      case 'queued':
        return <Clock size={16} style={{ color: 'var(--gray-500)' }} />;
      default:
        return <Clock size={16} style={{ color: 'var(--gray-500)' }} />;
    }
  };

  // Combine active downloads and queued downloads
  const allDownloads = useMemo(() => {
    return [...activeDownloads, ...queuedDownloads];
  }, [activeDownloads, queuedDownloads]);
  
  // Show empty state when there are no downloads at all
  if (allDownloads.length === 0) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 var(--space-6) 0' }}>Download Queue</h2>
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-8) var(--space-4)',
          color: 'var(--gray-500)'
        }}>
          <Download size={40} style={{ 
            color: 'var(--gray-400)', 
            marginBottom: 'var(--space-4)' 
          }} />
          <p style={{ 
            fontSize: '16px', 
            color: 'var(--gray-600)',
            marginBottom: 'var(--space-2)'
          }}>
            No Pending Downloads
          </p>
          <p style={{ 
            fontSize: '14px',
            color: 'var(--gray-500)',
            maxWidth: '400px',
            margin: '0 auto',
            marginBottom: 'var(--space-6)'
          }}>
            Files being downloaded from Arweave will show up here
          </p>
          {onSyncDrive && (
            <button
              className="button primary"
              onClick={onSyncDrive}
              style={{
                marginTop: 'var(--space-2)'
              }}
            >
              Check for new files to download
            </button>
          )}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>Download Queue</h2>
          {queueStatus && (
            <div style={{ 
              fontSize: '14px', 
              color: 'var(--gray-600)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
            }}>
              {queueStatus.total > 0 ? (
                <>
                  <Loader size={14} className={queueStatus.active > 0 ? 'animate-spin' : ''} />
                  <span>{queueStatus.active} downloading, {queueStatus.queued} queued</span>
                </>
              ) : (
                <span>Queue empty</span>
              )}
            </div>
          )}
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
        {allDownloads.length === 0 ? (
          <div style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--gray-500)'
          }}>
            No downloads in queue
          </div>
        ) : (
          <div style={{ padding: 'var(--space-4)' }}>
            {allDownloads.map((download, index) => {
              // Check if we need to show a separator before queued items
              const showQueueSeparator = index === activeDownloads.length && activeDownloads.length > 0 && queuedDownloads.length > 0;
              
              return (
                <React.Fragment key={download.id}>
                  {showQueueSeparator && (
                    <div style={{
                      margin: 'var(--space-4) 0',
                      padding: 'var(--space-2) 0',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: 'var(--gray-600)',
                      borderTop: '1px solid var(--gray-200)',
                      paddingTop: 'var(--space-4)'
                    }}>
                      Queued Downloads {queueStatus && queueStatus.queued > 30 && `(showing first 30 of ${queueStatus.queued})`}
                    </div>
                  )}
                  <div
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
                      {download.status === 'queued' && download.queuePosition && (
                        <>
                          <span>•</span>
                          <span>Position #{download.queuePosition} in queue</span>
                        </>
                      )}
                      {download.status !== 'queued' && download.downloadedAt && (
                        <>
                          <span>•</span>
                          <span>{formatDate(download.downloadedAt)}</span>
                        </>
                      )}
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
                    {(download.status === 'downloading' || download.status === 'paused' || download.status === 'queued') && (
                      <button
                        className="button small outline"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await window.electronAPI.files.cancelDownload(download.fileId);
                        }}
                        title={download.status === 'queued' ? "Remove from queue" : "Make cloud-only (cancel download)"}
                      >
                        <Cloud size={14} />
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
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};