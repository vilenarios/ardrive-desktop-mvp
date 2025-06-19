import React, { useState, useEffect } from 'react';
import { DriveInfo, AppConfig, SyncStatus } from '../../../types';
import { InfoButton } from '../common/InfoButton';
import { 
  Folder,
  FolderOpen,
  File,
  Image,
  Video,
  Music,
  FileText,
  Archive,
  Download,
  Search,
  Grid,
  List,
  Filter,
  ChevronRight,
  ChevronDown,
  Home,
  RefreshCw,
  Eye,
  ExternalLink,
  MoreHorizontal,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader,
  Wifi,
  WifiOff,
  Cloud
} from 'lucide-react';

interface StorageTabProps {
  drive: DriveInfo;
  config: AppConfig;
  syncStatus: SyncStatus | null;
  onDriveDeleted: () => void;
  onViewDriveDetails?: (drive: DriveInfo) => void;
}

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  modifiedAt: Date;
  isDownloaded: boolean;
  isUploaded: boolean;
  downloadProgress?: number;
  uploadProgress?: number;
  status: 'synced' | 'downloading' | 'uploading' | 'pending' | 'error';
  children?: FileItem[];
  path: string;
  parentId?: string;
}

interface SyncState {
  isActive: boolean;
  progress: number;
  currentFile?: string;
  totalFiles: number;
  syncedFiles: number;
  estimatedTimeRemaining?: string;
  error?: string;
}

export const StorageTab: React.FC<StorageTabProps> = ({
  drive,
  config,
  syncStatus,
  onDriveDeleted,
  onViewDriveDetails
}) => {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'files' | 'folders' | 'downloaded' | 'pending'>('all');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [fileData, setFileData] = useState<FileItem[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  const selectedDrive = drive;

  // Load drive metadata from cache
  const loadDriveMetadata = async () => {
    if (!drive) return;
    
    setIsLoading(true);
    try {
      const metadata = await window.electronAPI.drive.getMetadata(drive.id);
      setFileData(metadata);
    } catch (error) {
      console.error('Failed to load drive metadata:', error);
      setFileData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh metadata
  const handleRefresh = async () => {
    if (!drive) return;
    
    setIsLoading(true);
    try {
      await window.electronAPI.drive.refreshMetadata(drive.id);
      await loadDriveMetadata();
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
    }
  };

  // Load real file data from API or sync status
  useEffect(() => {
    if (!selectedDrive) return;

    // Load metadata from cache
    loadDriveMetadata();

    // Set real sync state based on syncStatus prop
    if (syncStatus?.isActive) {
      const progress = syncStatus.totalFiles > 0 
        ? Math.round((syncStatus.uploadedFiles / syncStatus.totalFiles) * 100)
        : 0;
      
      setSyncState({
        isActive: true,
        progress,
        currentFile: syncStatus.currentFile || '',
        totalFiles: syncStatus.totalFiles || 0,
        syncedFiles: syncStatus.uploadedFiles || 0,
        estimatedTimeRemaining: undefined // Not available in current SyncStatus
      });
    } else {
      setSyncState({
        isActive: false,
        progress: 100,
        totalFiles: syncStatus?.totalFiles || 0,
        syncedFiles: syncStatus?.uploadedFiles || 0
      });
    }
  }, [selectedDrive, syncStatus]);

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'folder') {
      return expandedFolders.has(item.id) ? 
        <FolderOpen size={16} className="folder-icon open" /> : 
        <Folder size={16} className="folder-icon" />;
    }

    const ext = item.name.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return <Image size={16} className="file-icon image" />;
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
        return <Video size={16} className="file-icon video" />;
      case 'mp3':
      case 'wav':
      case 'flac':
        return <Music size={16} className="file-icon audio" />;
      case 'pdf':
      case 'doc':
      case 'docx':
      case 'pptx':
        return <FileText size={16} className="file-icon document" />;
      case 'zip':
      case 'rar':
      case '7z':
        return <Archive size={16} className="file-icon archive" />;
      default:
        return <File size={16} className="file-icon default" />;
    }
  };

  const getStatusIcon = (item: FileItem) => {
    switch (item.status) {
      case 'synced':
        return <div title="Synced"><CheckCircle size={14} className="status-icon synced" /></div>;
      case 'downloading':
        return <div title="Downloading"><Download size={14} className="status-icon downloading animate-pulse" /></div>;
      case 'uploading':
        return <div title="Uploading"><Cloud size={14} className="status-icon uploading animate-pulse" /></div>;
      case 'pending':
        return <div title="Pending sync"><Clock size={14} className="status-icon pending" /></div>;
      case 'error':
        return <div title="Sync error"><AlertCircle size={14} className="status-icon error" /></div>;
      default:
        return null;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString();
  };

  const getCurrentFiles = (): FileItem[] => {
    let currentFiles = fileData;
    
    // Navigate to current path
    for (const pathSegment of currentPath) {
      const folder = currentFiles.find(f => f.name === pathSegment && f.type === 'folder');
      if (folder?.children) {
        currentFiles = folder.children;
      }
    }

    // Apply search filter
    if (searchQuery) {
      currentFiles = currentFiles.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply type filter
    switch (filterType) {
      case 'files':
        currentFiles = currentFiles.filter(item => item.type === 'file');
        break;
      case 'folders':
        currentFiles = currentFiles.filter(item => item.type === 'folder');
        break;
      case 'downloaded':
        currentFiles = currentFiles.filter(item => item.isDownloaded);
        break;
      case 'pending':
        currentFiles = currentFiles.filter(item => !item.isDownloaded);
        break;
    }

    return currentFiles.sort((a, b) => {
      // Folders first, then files
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };

  const handleItemDoubleClick = (item: FileItem) => {
    if (item.type === 'folder') {
      setCurrentPath([...currentPath, item.name]);
      setExpandedFolders(prev => new Set([...prev, item.id]));
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    setCurrentPath(currentPath.slice(0, index));
  };

  const handleDownloadSelected = () => {
    console.log('Download selected items:', selectedItems);
    // Implementation would handle actual downloads
  };

  if (!selectedDrive) {
    return (
      <div className="storage-tab">
        <div className="empty-state">
          <Cloud size={48} style={{ opacity: 0.5, marginBottom: 'var(--space-4)' }} />
          <h3>No Drive Selected</h3>
          <p>Select a drive to explore its files and folders.</p>
        </div>
      </div>
    );
  }

  const currentFiles = getCurrentFiles();

  return (
    <div className="storage-tab">
      {/* Drive Header */}
      <div className="drive-header">
        <div className="drive-title">
          <Cloud size={24} className="drive-icon" />
          <div>
            <h2>{selectedDrive.name} - Online Contents</h2>
            <div className="drive-status">
              {syncState?.isActive ? (
                <div className="sync-status active">
                  <Loader size={14} className="animate-spin" />
                  <span>Syncing... {syncState.progress}% complete</span>
                  {syncState.estimatedTimeRemaining && (
                    <span className="eta">• {syncState.estimatedTimeRemaining} remaining</span>
                  )}
                </div>
              ) : (
                <div className="sync-status complete">
                  <CheckCircle size={14} />
                  <span>
                    {syncState?.syncedFiles || 0} files synced
                    {syncState?.totalFiles && syncState.syncedFiles !== syncState.totalFiles && 
                      ` of ${syncState.totalFiles}`
                    }
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
        
        <button 
          className="refresh-button"
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh file list"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>


      {/* Sync Progress Bar (shown when syncing) */}
      {syncState?.isActive && (
        <div className="sync-progress-bar">
          <div className="progress-info">
            <span>Syncing {syncState.currentFile}</span>
            <span>{syncState.syncedFiles} / {syncState.totalFiles} files</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${syncState.progress}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* File Explorer Controls */}
      <div className="explorer-controls">
        <div className="breadcrumb">
          <button 
            className="breadcrumb-item"
            onClick={() => setCurrentPath([])}
          >
            <Home size={16} />
            Root
          </button>
          {currentPath.map((segment, index) => (
            <React.Fragment key={index}>
              <ChevronRight size={14} className="breadcrumb-separator" />
              <button 
                className="breadcrumb-item"
                onClick={() => handleBreadcrumbClick(index + 1)}
              >
                {segment}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="controls-row">
          <div className="search-filter-group">
            <div className="search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search files and folders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <select 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value as any)}
              className="filter-select"
            >
              <option value="all">All Items</option>
              <option value="files">Files Only</option>
              <option value="folders">Folders Only</option>
              <option value="downloaded">Downloaded</option>
              <option value="pending">Pending Download</option>
            </select>
          </div>

          <div className="view-actions">
            <div className="view-toggle">
              <button 
                className={`view-button ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <List size={16} />
              </button>
              <button 
                className={`view-button ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grid view"
              >
                <Grid size={16} />
              </button>
            </div>

            {selectedItems.length > 0 && (
              <button 
                className="download-button"
                onClick={handleDownloadSelected}
              >
                <Download size={16} />
                Download Selected ({selectedItems.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File List */}
      <div className={`file-explorer ${viewMode}`}>
        {currentFiles.length > 0 ? (
          <div className="file-list">
            {viewMode === 'list' && (
              <div className="list-header">
                <div className="col-name">Name</div>
                <div className="col-size">Size</div>
                <div className="col-modified">Modified</div>
                <div className="col-status">Status</div>
                <div className="col-actions">Actions</div>
              </div>
            )}
            
            {currentFiles.map((item) => (
              <div 
                key={item.id}
                className={`file-item ${selectedItems.includes(item.id) ? 'selected' : ''}`}
                onDoubleClick={() => handleItemDoubleClick(item)}
              >
                <div className="item-main">
                  <div className="item-icon">
                    {getFileIcon(item)}
                  </div>
                  <div className="item-info">
                    <div className="item-name">{item.name}</div>
                    {viewMode === 'grid' && (
                      <div className="item-details">
                        {item.size && <span>{formatFileSize(item.size)}</span>}
                        <span>{formatDate(item.modifiedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {viewMode === 'list' && (
                  <>
                    <div className="col-size">
                      {item.size ? formatFileSize(item.size) : '—'}
                    </div>
                    <div className="col-modified">
                      {formatDate(item.modifiedAt)}
                    </div>
                    <div className="col-status">
                      <div className="status-display">
                        {getStatusIcon(item)}
                        {(item.downloadProgress || item.uploadProgress) && (
                          <div className="mini-progress">
                            <div 
                              className="mini-progress-fill"
                              style={{ width: `${item.downloadProgress || item.uploadProgress}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-actions">
                      <div className="item-actions">
                        {!item.isDownloaded && (
                          <button 
                            className="action-button"
                            title="Download"
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log('Download', item.name);
                            }}
                          >
                            <Download size={14} />
                          </button>
                        )}
                        <button 
                          className="action-button"
                          title="View details"
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('View details', item.name);
                          }}
                        >
                          <Eye size={14} />
                        </button>
                        <button 
                          className="action-button"
                          title="More actions"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {viewMode === 'grid' && (
                  <div className="grid-overlay">
                    <div className="status-indicator">
                      {getStatusIcon(item)}
                    </div>
                    {!item.isDownloaded && (
                      <button 
                        className="download-overlay"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Download', item.name);
                        }}
                      >
                        <Download size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-folder">
            {searchQuery || filterType !== 'all' ? (
              <>
                <Search size={48} style={{ opacity: 0.5 }} />
                <h3>No items match your search</h3>
                <p>Try adjusting your search terms or filters</p>
              </>
            ) : (
              <>
                <Folder size={48} style={{ opacity: 0.5 }} />
                <h3>This folder is empty</h3>
                <p>Files you upload will appear here once synced</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* Styles are handled by the parent Dashboard component */