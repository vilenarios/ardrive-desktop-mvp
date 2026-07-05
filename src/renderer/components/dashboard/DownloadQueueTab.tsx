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
  Cloud,
  Search
} from 'lucide-react';
import { InfoButton } from '../common/InfoButton';

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

type StatusFilter = 'all' | 'downloading' | 'paused' | 'failed' | 'queued';

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
  // RESTYLE-5: Activity/Storage both have search+filter; this tab had
  // neither. Local-only state — filters what's already loaded, no new IPC.
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

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

  const matchesFilters = React.useCallback((download: any) => {
    if (statusFilter !== 'all' && download.status !== statusFilter) return false;
    if (searchQuery.trim() && !download.fileName?.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    return true;
  }, [searchQuery, statusFilter]);

  // Filter to only show active downloads (queue items)
  const activeDownloads = useMemo(() => {
    return downloads
      .filter(download => {
        // Only show active downloads (downloading, paused, or failed that can be retried)
        return download.status === 'downloading' || download.status === 'paused' || download.status === 'failed';
      })
      .filter(matchesFilters)
      .sort((a, b) => {
        // Sort by date (newest first)
        return new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime();
      });
  }, [downloads, matchesFilters]);

  const filteredQueuedDownloads = useMemo(
    () => queuedDownloads.filter(matchesFilters),
    [queuedDownloads, matchesFilters]
  );

  // Stats for active downloads only (queue items) — unaffected by the
  // search/filter above, so the header always reflects the true queue.
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
        return <Loader size={16} className="animate-spin download-status-icon download-status-icon--active" />;
      case 'completed':
        return <CheckCircle size={16} className="download-status-icon download-status-icon--success" />;
      case 'failed':
        return <XCircle size={16} className="download-status-icon download-status-icon--danger" />;
      case 'paused':
        return <Pause size={16} className="download-status-icon download-status-icon--warning" />;
      case 'queued':
        return <Clock size={16} className="download-status-icon download-status-icon--muted" />;
      default:
        return <Clock size={16} className="download-status-icon download-status-icon--muted" />;
    }
  };

  // Combine active downloads and queued downloads
  const allDownloads = useMemo(() => {
    return [...activeDownloads, ...filteredQueuedDownloads];
  }, [activeDownloads, filteredQueuedDownloads]);

  const hasAnyDownloads = downloads.length > 0 || queuedDownloads.length > 0;
  const hasActiveFilters = statusFilter !== 'all' || searchQuery.trim().length > 0;

  // Show empty state when there are no downloads at all (not filtered out)
  if (!hasAnyDownloads) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 var(--space-6) 0' }}>Download Queue</h2>
        <div className="download-queue-empty">
          <Download size={40} className="download-queue-empty-icon" />
          <p className="download-queue-empty-title">No Pending Downloads</p>
          <p className="download-queue-empty-subtitle">
            Files being downloaded from Arweave will show up here
          </p>
          {onSyncDrive && (
            <button
              className="button primary"
              onClick={onSyncDrive}
              style={{ marginTop: 'var(--space-2)' }}
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
      <div className="download-queue-header">
        <div className="download-queue-header-top">
          <span className="download-queue-title-row">
            <h2>Download Queue</h2>
            <InfoButton tooltip="The cloud icon makes a file cloud-only: it stays stored permanently on Arweave but is removed from this device to free up space. You can re-download it anytime." />
          </span>
          {queueStatus && (
            <div className="download-queue-status">
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
        <div className="download-queue-stats">
          {downloadStats.active > 0 && (
            <div className="download-queue-stat">
              <Loader size={14} className="animate-spin download-queue-stat-icon download-queue-stat-icon--active" />
              <span>{downloadStats.active} downloading</span>
            </div>
          )}
          {downloadStats.failed > 0 && (
            <div className="download-queue-stat">
              <XCircle size={14} className="download-queue-stat-icon download-queue-stat-icon--danger" />
              <span>{downloadStats.failed} failed</span>
            </div>
          )}
          {downloadStats.paused > 0 && (
            <div className="download-queue-stat">
              <Pause size={14} className="download-queue-stat-icon download-queue-stat-icon--warning" />
              <span>{downloadStats.paused} paused</span>
            </div>
          )}
          <div className="download-queue-total-size">
            {formatFileSize(downloadStats.totalSize)} total
          </div>
        </div>

        {/* Search + filter (RESTYLE-5) */}
        <div className="download-queue-filters">
          <div className="download-search-wrap">
            <Search size={14} className="download-search-icon" />
            <input
              type="text"
              className="download-search-input"
              placeholder="Search downloads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search downloads by file name"
            />
          </div>
          <select
            className="download-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter downloads by status"
          >
            <option value="all">All statuses</option>
            <option value="downloading">Downloading</option>
            <option value="paused">Paused</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
          </select>
        </div>
      </div>

      {/* Download list */}
      <div className="download-queue-list">
        {allDownloads.length === 0 ? (
          <div className="download-queue-no-results">
            {hasActiveFilters ? 'No downloads match your search' : 'No downloads in queue'}
          </div>
        ) : (
          <div className="download-queue-list-inner">
            {allDownloads.map((download, index) => {
              // Check if we need to show a separator before queued items
              const showQueueSeparator = index === activeDownloads.length && activeDownloads.length > 0 && filteredQueuedDownloads.length > 0;

              return (
                <React.Fragment key={download.id}>
                  {showQueueSeparator && (
                    <div className="download-queue-separator">
                      Queued Downloads {queueStatus && queueStatus.queued > 30 && `(showing first 30 of ${queueStatus.queued})`}
                    </div>
                  )}
                  <div className="download-card">
                    <div className="download-card-main">
                      {/* Status icon */}
                      <div className="download-status-icon-wrap">
                        {getStatusIcon(download.status)}
                      </div>

                      {/* File info */}
                      <div className="download-info">
                        <div className="download-filename">
                          {download.fileName}
                        </div>
                        <div className="download-meta">
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
                              <span>{download.progress}% downloaded</span>
                            </>
                          )}
                        </div>
                        {download.error && (
                          <div className="download-error">
                            {download.error}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="download-actions">
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
                            aria-label="Open containing folder"
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
                            aria-label="Retry download"
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
                            aria-label="Pause download"
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
                            aria-label="Resume download"
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
                            title={download.status === 'queued' ? 'Remove from queue' : 'Make cloud-only (cancel download)'}
                            aria-label={download.status === 'queued' ? 'Remove from queue' : 'Make cloud-only (cancel download)'}
                          >
                            <Cloud size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress bar for active downloads */}
                    {download.status === 'downloading' && (
                      <div
                        className="download-progress-track"
                        role="progressbar"
                        aria-valuenow={download.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Download progress for ${download.fileName}`}
                      >
                        <div
                          className="download-progress-fill"
                          style={{ width: `${download.progress}%` }}
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
