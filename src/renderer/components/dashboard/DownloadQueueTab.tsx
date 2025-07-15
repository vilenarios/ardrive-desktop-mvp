import React, { useState, useMemo } from 'react';
import { 
  Download,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  Filter,
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
  onRefresh: () => void;
  onOpenFolder: (path: string) => void;
  onRetryDownload?: (downloadId: string) => void;
  onPauseDownload?: (downloadId: string) => void;
  onResumeDownload?: (downloadId: string) => void;
}

export const DownloadQueueTab: React.FC<DownloadQueueTabProps> = ({
  downloads,
  onRefresh,
  onOpenFolder,
  onRetryDownload,
  onPauseDownload,
  onResumeDownload
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'downloading' | 'completed' | 'failed'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter and sort downloads
  const filteredDownloads = useMemo(() => {
    let filtered = downloads.filter(download => {
      // Search filter
      if (searchQuery && !download.fileName.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      
      // Status filter
      if (statusFilter !== 'all' && download.status !== statusFilter) {
        return false;
      }
      
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.fileName.localeCompare(b.fileName);
        case 'size':
          return b.fileSize - a.fileSize;
        case 'date':
        default:
          return new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime();
      }
    });

    return filtered;
  }, [downloads, searchQuery, statusFilter, sortBy]);

  // Group downloads by status
  const downloadStats = useMemo(() => {
    const stats = {
      active: 0,
      completed: 0,
      failed: 0,
      totalSize: 0,
      downloadedSize: 0
    };

    downloads.forEach(download => {
      if (download.status === 'downloading') stats.active++;
      else if (download.status === 'completed') stats.completed++;
      else if (download.status === 'failed') stats.failed++;
      
      stats.totalSize += download.fileSize;
      if (download.status === 'completed') {
        stats.downloadedSize += download.fileSize;
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
        return <Loader size={16} className="animate-spin" style={{ color: 'var(--primary-600)' }} />;
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
            Files downloaded from your ArDrive to your local folder will appear here.
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
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-4)'
        }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>Download History</h2>
          </div>
          <button
            className="button small outline"
            onClick={async () => {
              setIsRefreshing(true);
              await onRefresh();
              // Add a small delay to make the refresh more visible
              setTimeout(() => setIsRefreshing(false), 500);
            }}
            disabled={isRefreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              opacity: isRefreshing ? 0.7 : 1
            }}
            title="Manually refresh download list"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
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
              <Loader size={14} className="animate-spin" style={{ color: 'var(--primary-600)' }} />
              <span>{downloadStats.active} downloading</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <CheckCircle size={14} style={{ color: 'var(--success-600)' }} />
            <span>{downloadStats.completed} completed</span>
          </div>
          {downloadStats.failed > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <XCircle size={14} style={{ color: 'var(--error-600)' }} />
              <span>{downloadStats.failed} failed</span>
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}>
            {formatFileSize(downloadStats.downloadedSize)} of {formatFileSize(downloadStats.totalSize)}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        gap: 'var(--space-4)',
        alignItems: 'center',
        borderBottom: '1px solid var(--gray-200)'
      }}>
        {/* Search */}
        <div style={{
          position: 'relative',
          flex: 1,
          maxWidth: '300px'
        }}>
          <Search size={16} style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--gray-500)'
          }} />
          <input
            type="text"
            placeholder="Search downloads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              border: '1px solid var(--gray-300)',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--gray-300)',
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            backgroundColor: 'white'
          }}
        >
          <option value="all">All Downloads</option>
          <option value="downloading">Downloading</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--gray-300)',
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            backgroundColor: 'white'
          }}
        >
          <option value="date">Sort by Date</option>
          <option value="name">Sort by Name</option>
          <option value="size">Sort by Size</option>
        </select>
      </div>

      {/* Download list */}
      <div style={{
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 400px)'
      }}>
        {filteredDownloads.length === 0 ? (
          <div style={{
            padding: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--gray-500)'
          }}>
            No downloads match your filters
          </div>
        ) : (
          <div style={{ padding: 'var(--space-4)' }}>
            {filteredDownloads.map((download) => (
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
                        backgroundColor: 'var(--primary-600)',
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