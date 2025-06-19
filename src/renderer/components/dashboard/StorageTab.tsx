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
  // ArDrive/Arweave properties
  ardriveUrl?: string;
  dataTxId?: string;
  metadataTxId?: string;
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
  const [filterType, setFilterType] = useState<'all' | 'files' | 'folders'>('all');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [fileData, setFileData] = useState<FileItem[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  const selectedDrive = drive;

  // Load drive metadata from Arweave permaweb
  const loadDriveMetadata = async () => {
    if (!drive) return;
    
    setIsLoading(true);
    try {
      // Fetch real data from permaweb
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(drive.id);
      console.log('Loaded permaweb files:', permawebFiles);
      
      // Build folder hierarchy from flat list
      const rootItems: FileItem[] = [];
      const itemMap = new Map<string, FileItem>();
      
      // First pass: create all items
      permawebFiles.forEach((item: any) => {
        const fileItem: FileItem = {
          id: item.id,
          name: item.name,
          type: item.type,
          size: item.size,
          modifiedAt: new Date(item.modifiedAt),
          isDownloaded: false,
          isUploaded: true,
          status: 'synced' as const,
          path: item.path || '/',
          parentId: item.parentId,
          children: item.type === 'folder' ? [] : undefined,
          // Add ArDrive sharing URL
          ardriveUrl: item.ardriveUrl,
          dataTxId: item.dataTxId,
          metadataTxId: item.metadataTxId
        };
        itemMap.set(item.id, fileItem);
      });
      
      // Second pass: build hierarchy
      itemMap.forEach((item) => {
        if (item.parentId && itemMap.has(item.parentId)) {
          const parent = itemMap.get(item.parentId);
          if (parent && parent.children) {
            parent.children.push(item);
          }
        } else if (!item.parentId || item.parentId === drive.rootFolderId) {
          // Root level items
          rootItems.push(item);
        }
      });
      
      setFileData(rootItems);
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
    
    // Simply reload the data from permaweb
    await loadDriveMetadata();
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
      {/* Permaweb Header */}
      <div style={{
        padding: 'var(--space-6)',
        borderBottom: '1px solid var(--gray-200)',
        backgroundColor: 'var(--gray-50)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{
              width: '48px',
              height: '48px',
              backgroundColor: 'var(--primary-100)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Cloud size={24} style={{ color: 'var(--ardrive-primary)' }} />
            </div>
            <div>
              <h2 style={{ 
                fontSize: '24px', 
                fontWeight: '600',
                marginBottom: '4px',
                color: 'var(--gray-900)'
              }}>
                Your Permaweb Storage
              </h2>
              <p style={{ 
                fontSize: '15px', 
                color: 'var(--gray-600)' 
              }}>
                Browse files permanently stored on Arweave
              </p>
            </div>
          </div>
          
          <button 
            className="button small outline"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh file list"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)'
            }}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Info Banner */}
        <div style={{
          backgroundColor: 'var(--info-50)',
          border: '1px solid var(--info-200)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          fontSize: '14px'
        }}>
          <ExternalLink size={16} style={{ color: 'var(--info-600)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ color: 'var(--gray-700)' }}>
              Files stored on the Permaweb are permanently accessible and cannot be deleted. 
              Each file has a unique transaction ID for sharing.
            </span>
            <InfoButton tooltip="The Permaweb is a permanent and decentralized web built on top of the Arweave network. Once uploaded, your files will be available forever." />
          </div>
        </div>
      </div>



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
                    <div className="col-actions">
                      <div className="item-actions">
                        <button 
                          className="action-button"
                          title="View on ArDrive"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (item.ardriveUrl) {
                              await window.electronAPI.shell.openExternal(item.ardriveUrl);
                            }
                          }}
                        >
                          <ExternalLink size={14} />
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {viewMode === 'grid' && item.type === 'file' && (
                  <div className="grid-overlay">
                    <button 
                      className="action-button"
                      title="View on ArDrive"
                      onClick={async (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (item.ardriveUrl) {
                          await window.electronAPI.shell.openExternal(item.ardriveUrl);
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        padding: '6px',
                        borderRadius: '4px',
                        border: '1px solid var(--gray-300)'
                      }}
                    >
                      <ExternalLink size={14} />
                    </button>
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
              <div style={{
                textAlign: 'center',
                padding: 'var(--space-8)',
                maxWidth: '500px',
                margin: '0 auto'
              }}>
                <div style={{
                  width: '100px',
                  height: '100px',
                  margin: '0 auto var(--space-6)',
                  backgroundColor: 'var(--primary-50)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Cloud size={48} style={{ color: 'var(--ardrive-primary)' }} />
                </div>
                <h3 style={{ 
                  fontSize: '24px', 
                  fontWeight: '600',
                  marginBottom: 'var(--space-3)',
                  color: 'var(--gray-900)'
                }}>
                  No files on the Permaweb yet
                </h3>
                <p style={{ 
                  fontSize: '16px', 
                  color: 'var(--gray-600)',
                  marginBottom: 'var(--space-6)',
                  lineHeight: '1.6'
                }}>
                  Add files to your sync folder and approve them for upload. 
                  {"Once uploaded to Arweave, they'll be permanently stored and accessible here."}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                  <button
                    className="button"
                    onClick={async () => {
                      if (config.syncFolder) {
                        await window.electronAPI.shell.openPath(config.syncFolder);
                      }
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <FolderOpen size={16} />
                    Open Sync Folder
                  </button>
                  <button
                    className="button outline"
                    onClick={() => {
                      window.open('https://www.arweave.org/technology#permaweb', '_blank');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    Learn About Permaweb
                    <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* Styles are handled by the parent Dashboard component */