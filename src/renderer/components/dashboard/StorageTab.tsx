import React, { useState, useEffect } from 'react';
import { DriveInfo, AppConfig, SyncStatus, FileUpload } from '../../../types';
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
  cachedData?: FileItem[];
  lastRefreshTime?: Date | null;
  cacheValid?: boolean;
  onCacheUpdate?: (data: FileItem[], time: Date | null, valid: boolean) => void;
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
  onViewDriveDetails,
  cachedData,
  lastRefreshTime,
  cacheValid,
  onCacheUpdate
}) => {
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'files' | 'folders'>('all');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [fileData, setFileData] = useState<FileItem[]>(cachedData || []);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [isNewDrive, setIsNewDrive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedItemDetails, setSelectedItemDetails] = useState<FileItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

  const selectedDrive = drive;

  // Load drive metadata from Arweave permaweb
  const loadDriveMetadata = async (isManualRefresh = false) => {
    if (!drive) {
      console.log('No drive selected, skipping metadata load');
      return;
    }
    
    console.log('Loading permaweb files for drive:', drive.name, drive.id, 'Manual refresh:', isManualRefresh);
    setIsLoading(true);
    setLoadError(null);
    setIsNewDrive(false);
    
    try {
      // Fetch real data from permaweb (force refresh if manual)
      const permawebFiles = await window.electronAPI.drive.getPermawebFiles(drive.id, isManualRefresh);
      console.log('Loaded permaweb files:', permawebFiles, 'Manual refresh:', isManualRefresh);
      
      // Check if drive is empty or newly created
      if (!permawebFiles || permawebFiles.length === 0) {
        setIsNewDrive(true);
      }
      
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
      console.log('Building hierarchy. Root folder ID:', drive.rootFolderId);
      itemMap.forEach((item) => {
        console.log(`Item ${item.name} - parentId: ${item.parentId}`);
        if (item.parentId && itemMap.has(item.parentId)) {
          const parent = itemMap.get(item.parentId);
          if (parent && parent.children) {
            parent.children.push(item);
          }
        } else if (!item.parentId || item.parentId === drive.rootFolderId || item.parentId === '') {
          // Root level items (no parent or parent is root folder)
          console.log(`Adding ${item.name} to root items`);
          rootItems.push(item);
        }
      });
      
      setFileData(rootItems);
      
      // Update cache in parent component
      if (onCacheUpdate) {
        const now = new Date();
        onCacheUpdate(rootItems, now, true);
        console.log('Permaweb cache updated at:', now.toLocaleTimeString());
      }
    } catch (error: any) {
      console.error('Failed to load drive metadata:', error);
      setFileData([]);
      
      // Check if this is a newly created drive that hasn't propagated yet
      if (error?.message?.includes('not found') || error?.message?.includes('Entity with Folder-Id')) {
        setIsNewDrive(true);
        setLoadError('Your drive is being created on Arweave. This may take a few moments. Please try refreshing in a minute.');
      } else {
        setLoadError('Failed to load drive contents. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh metadata
  const handleRefresh = async () => {
    if (!drive) return;
    
    console.log('Manual refresh requested, invalidating cache');
    
    // Invalidate cache in parent component
    if (onCacheUpdate && lastRefreshTime) {
      onCacheUpdate(fileData, lastRefreshTime, false);
    }
    
    // Reload the data from permaweb with manual refresh flag
    await loadDriveMetadata(true);
  };

  // Check if cache is still valid
  const isCacheValid = (): boolean => {
    if (!lastRefreshTime || !cacheValid) return false;
    const now = new Date();
    const elapsed = now.getTime() - lastRefreshTime.getTime();
    return elapsed < CACHE_DURATION;
  };

  // Load real file data from API or sync status
  useEffect(() => {
    if (!selectedDrive) return;

    // Initialize with cached data from parent if available
    if (cachedData && cachedData.length > 0 && fileData.length === 0) {
      console.log('Initializing with cached data from parent');
      setFileData(cachedData);
    }

    // Only load if we don't have any data at all (first load)
    // Don't auto-load just because cache expired - wait for manual refresh
    if (fileData.length === 0 && (!cachedData || cachedData.length === 0)) {
      console.log('No data available, loading drive metadata for first time');
      loadDriveMetadata(false);
    } else if (isCacheValid()) {
      console.log('Using cached permaweb data');
    } else {
      console.log('Cache expired but not auto-refreshing. User can click refresh.');
    }

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

  // Set up auto-refresh timer
  useEffect(() => {
    if (!cacheValid || !lastRefreshTime) return;
    
    // No longer auto-refresh when cache expires
    // User must click refresh button
    console.log('Cache auto-refresh disabled. User must manually refresh.');
  }, [cacheValid, lastRefreshTime]);

  // Listen for file upload completion events to update cache
  useEffect(() => {
    const handleUploadComplete = (uploadData: any) => {
      console.log('File upload completed, updating permaweb cache:', uploadData);
      
      // Add the new file to our cached data optimistically
      if (uploadData && uploadData.fileId) {
        const newFileItem: FileItem = {
          id: uploadData.fileId,
          name: uploadData.fileName,
          type: 'file',
          size: uploadData.fileSize,
          modifiedAt: new Date(),
          isDownloaded: true,
          isUploaded: true,
          status: 'pending' as const, // Show as pending until confirmed on Arweave
          path: uploadData.path || '/',
          parentId: uploadData.parentFolderId || '',
          ardriveUrl: `https://app.ardrive.io/#/file/${uploadData.fileId}/view`,
          dataTxId: uploadData.dataTxId,
          metadataTxId: uploadData.metadataTxId
        };
        
        // Add to appropriate location in hierarchy
        setFileData(prevData => {
          const newData = [...prevData];
          
          // If it has a parent, find the parent and add to its children
          if (uploadData.parentFolderId) {
            const addToParent = (items: FileItem[]): boolean => {
              for (const item of items) {
                if (item.id === uploadData.parentFolderId && item.children) {
                  item.children.push(newFileItem);
                  return true;
                }
                if (item.children && addToParent(item.children)) {
                  return true;
                }
              }
              return false;
            };
            
            if (!addToParent(newData)) {
              // Parent not found, add to root
              newData.push(newFileItem);
            }
          } else {
            // No parent, add to root
            newData.push(newFileItem);
          }
          
          return newData;
        });
      }
    };
    
    // Listen for upload completion to update UI
    const handleUploadProgress = async (progressData: { uploadId: string; progress: number; status: 'uploading' | 'completed' | 'failed'; error?: string }) => {
      if (progressData.status === 'completed') {
        console.log('File upload completed, fetching upload details for permaweb display');
        
        // Fetch the complete upload data to display in permaweb
        try {
          const uploads = await window.electronAPI.files.getUploads();
          const completedUpload = uploads.find((u: FileUpload) => u.id === progressData.uploadId);
          
          if (completedUpload && completedUpload.fileId) {
            console.log('Found completed upload:', completedUpload);
            handleUploadComplete({
              fileId: completedUpload.fileId,
              fileName: completedUpload.fileName,
              fileSize: completedUpload.fileSize,
              path: completedUpload.localPath,
              parentFolderId: '', // TODO: Get from path mapping
              dataTxId: completedUpload.dataTxId,
              metadataTxId: completedUpload.metadataTxId
            });
          }
        } catch (error) {
          console.error('Failed to fetch upload details:', error);
        }
      }
    };
    
    window.electronAPI.onUploadProgress(handleUploadProgress);
    
    return () => {
      // Note: The preload API doesn't expose a remove listener method
      // This would need to be added to properly clean up
    };
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  const getFileIcon = (item: FileItem) => {
    const iconStyle = { width: '16px', height: '16px', flexShrink: 0 };
    
    if (item.type === 'folder') {
      return expandedFolders.has(item.id) ? 
        <FolderOpen size={16} style={iconStyle} className="folder-icon open" /> : 
        <Folder size={16} style={iconStyle} className="folder-icon" />;
    }

    const ext = item.name.toLowerCase().split('.').pop();
    switch (ext) {
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
      case 'ico':
        return <Image size={16} style={iconStyle} className="file-icon image" />;
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
      case 'webm':
        return <Video size={16} style={iconStyle} className="file-icon video" />;
      case 'mp3':
      case 'wav':
      case 'flac':
      case 'ogg':
      case 'm4a':
        return <Music size={16} style={iconStyle} className="file-icon audio" />;
      case 'pdf':
      case 'doc':
      case 'docx':
      case 'ppt':
      case 'pptx':
      case 'xls':
      case 'xlsx':
      case 'txt':
      case 'md':
        return <FileText size={16} style={iconStyle} className="file-icon document" />;
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
        return <Archive size={16} style={iconStyle} className="file-icon archive" />;
      default:
        return <File size={16} style={iconStyle} className="file-icon default" />;
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
    try {
      // Ensure we have a valid date
      const dateObj = date instanceof Date ? date : new Date(date);
      
      // Check if date is valid
      if (isNaN(dateObj.getTime())) {
        return 'Unknown date';
      }
      
      const now = new Date();
      const diffMs = now.getTime() - dateObj.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      // Handle future dates or very recent past
      if (diffMs < 0) return 'Just now';
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7 && diffDays > 0) return `${diffDays} days ago`;
      
      // For older dates, show full date
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Date formatting error:', error);
      return 'Unknown date';
    }
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
            
            <button 
              className="button small outline"
              onClick={handleRefresh}
              disabled={isLoading}
              title={lastRefreshTime 
                ? `Last updated: ${lastRefreshTime.toLocaleTimeString()}${!isCacheValid() ? ' (stale)' : ''}` 
                : 'Refresh file list'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                marginLeft: 'var(--space-4)'
              }}
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
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
                <div className="col-actions"></div>
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
                      <div className="item-actions-container" style={{ justifyContent: 'flex-end' }}>
                        <button 
                          className="action-menu-trigger"
                          title="More actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Toggle dropdown menu using state
                            setOpenMenuId(openMenuId === item.id ? null : item.id);
                          }}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        
                        <div className="action-menu" style={{ display: openMenuId === item.id ? 'block' : 'none' }}>
                          {item.type === 'file' && item.dataTxId && (
                            <button 
                              className="action-menu-item"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await window.electronAPI.shell.openExternal(`https://arweave.net/${item.dataTxId}`);
                                // Hide menu
                                setOpenMenuId(null);
                              }}
                            >
                              <Eye size={14} />
                              View on Arweave
                            </button>
                          )}
                          {item.ardriveUrl && (
                            <button 
                              className="action-menu-item"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (item.ardriveUrl) {
                                  await window.electronAPI.shell.openExternal(item.ardriveUrl);
                                }
                                // Hide menu
                                setOpenMenuId(null);
                              }}
                            >
                              <ExternalLink size={14} />
                              View on ArDrive
                            </button>
                          )}
                          {item.type === 'folder' && (
                            <button 
                              className="action-menu-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Navigate into folder
                                handleItemDoubleClick(item);
                                // Hide menu
                                setOpenMenuId(null);
                              }}
                            >
                              <FolderOpen size={14} />
                              Open Folder
                            </button>
                          )}
                          <button 
                            className="action-menu-item"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemDetails(item);
                              // Hide menu
                              setOpenMenuId(null);
                            }}
                          >
                            <AlertCircle size={14} />
                            View Details
                          </button>
                          <button 
                            className="action-menu-item"
                            onClick={async (e) => {
                              e.stopPropagation();
                              // Copy share link to clipboard
                              const shareUrl = item.dataTxId 
                                ? `https://arweave.net/${item.dataTxId}`
                                : item.ardriveUrl || '';
                              if (shareUrl) {
                                await navigator.clipboard.writeText(shareUrl);
                                // Show toast notification
                                console.log('Share link copied to clipboard:', shareUrl);
                              }
                              // Hide menu
                              setOpenMenuId(null);
                            }}
                            disabled={!item.dataTxId && !item.ardriveUrl}
                          >
                            <ExternalLink size={14} />
                            Copy Share Link
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {viewMode === 'grid' && item.type === 'file' && (
                  <div className="grid-overlay">
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      display: 'flex',
                      gap: '4px'
                    }}>
                      {item.dataTxId && (
                        <button 
                          className="action-button"
                          title="Preview on Arweave"
                          onClick={async (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            await window.electronAPI.shell.openExternal(`https://arweave.net/${item.dataTxId}`);
                          }}
                          style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            padding: '6px',
                            borderRadius: '4px',
                            border: '1px solid var(--gray-300)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      {item.ardriveUrl && (
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
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            padding: '6px',
                            borderRadius: '4px',
                            border: '1px solid var(--gray-300)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <ExternalLink size={14} />
                        </button>
                      )}
                    </div>
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
                  backgroundColor: 'var(--ardrive-primary-50)',
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
                  {loadError ? 'Unable to load drive contents' : 
                   isNewDrive ? 'Your drive is being created' : 
                   currentPath.length > 0 ? `"${currentPath[currentPath.length - 1]}" folder is empty` :
                   'No files on the Permaweb yet'}
                </h3>
                <p style={{ 
                  fontSize: '16px', 
                  color: 'var(--gray-600)',
                  marginBottom: 'var(--space-6)',
                  lineHeight: '1.6'
                }}>
                  {loadError ? loadError :
                   isNewDrive ? 'Your new drive is being created on Arweave. This process may take a few moments. Please try refreshing in a minute.' :
                   currentPath.length > 0 ? 'This folder doesn\'t contain any files yet. Add files to your sync folder in the corresponding location to see them here.' :
                   "Add files to your sync folder and approve them for upload. Once uploaded to Arweave, they'll be permanently stored and accessible here."}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {(loadError || isNewDrive) && (
                    <button
                      className="button"
                      onClick={handleRefresh}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      <RefreshCw size={16} />
                      Refresh
                    </button>
                  )}
                  {currentPath.length > 0 && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        const newPath = currentPath.slice(0, -1);
                        setCurrentPath(newPath);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
                      Go Back
                    </button>
                  )}
                  {!loadError && !isNewDrive && (
                    <button
                      className="button"
                      onClick={async () => {
                        if (config.syncFolder) {
                          const folderPath = currentPath.length > 0 
                            ? `${config.syncFolder}/${currentPath.join('/')}`
                            : config.syncFolder;
                          await window.electronAPI.shell.openPath(folderPath);
                        }
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)'
                      }}
                    >
                      <FolderOpen size={16} />
                      {currentPath.length > 0 ? 'Open This Folder' : 'Open Sync Folder'}
                    </button>
                  )}
                  {currentPath.length === 0 && (
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
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* File Details Modal */}
      {selectedItemDetails && (
        <div className="modal-overlay" onClick={() => setSelectedItemDetails(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 'var(--space-2)',
                margin: 0,
                fontSize: '18px',
                fontWeight: '600'
              }}>
                {getFileIcon(selectedItemDetails)}
                {selectedItemDetails.name}
              </h3>
              <button 
                className="modal-close"
                onClick={() => setSelectedItemDetails(null)}
                title="Close"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <div className="details-grid">
                <div className="detail-row">
                  <span className="detail-label">File ID:</span>
                  <span className="detail-value monospace">{selectedItemDetails.id}</span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Type:</span>
                  <span className="detail-value">
                    {selectedItemDetails.type === 'file' ? 'File' : 'Folder'}
                    {selectedItemDetails.type === 'file' && selectedItemDetails.name.includes('.') && (
                      <span style={{ color: 'var(--gray-500)', marginLeft: 'var(--space-1)' }}>
                        (.{selectedItemDetails.name.split('.').pop()?.toUpperCase()})
                      </span>
                    )}
                  </span>
                </div>
                
                {selectedItemDetails.size && (
                  <div className="detail-row">
                    <span className="detail-label">Size:</span>
                    <span className="detail-value">
                      {formatFileSize(selectedItemDetails.size)}
                      <span style={{ color: 'var(--gray-500)', marginLeft: 'var(--space-2)' }}>
                        ({selectedItemDetails.size.toLocaleString()} bytes)
                      </span>
                    </span>
                  </div>
                )}
                
                <div className="detail-row">
                  <span className="detail-label">Last Modified:</span>
                  <span className="detail-value">
                    {selectedItemDetails.modifiedAt.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Path:</span>
                  <span className="detail-value monospace">{selectedItemDetails.path}</span>
                </div>
                
                {selectedItemDetails.parentId && (
                  <div className="detail-row">
                    <span className="detail-label">Parent ID:</span>
                    <span className="detail-value monospace">{selectedItemDetails.parentId}</span>
                  </div>
                )}
                
                {selectedItemDetails.dataTxId && (
                  <div className="detail-row">
                    <span className="detail-label">Data Transaction ID:</span>
                    <span className="detail-value monospace">
                      {selectedItemDetails.dataTxId}
                      <button 
                        className="copy-button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(selectedItemDetails.dataTxId!);
                          console.log('Data TX ID copied to clipboard');
                        }}
                        title="Copy to clipboard"
                      >
                        📋
                      </button>
                    </span>
                  </div>
                )}
                
                {selectedItemDetails.metadataTxId && (
                  <div className="detail-row">
                    <span className="detail-label">Metadata Transaction ID:</span>
                    <span className="detail-value monospace">
                      {selectedItemDetails.metadataTxId}
                      <button 
                        className="copy-button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(selectedItemDetails.metadataTxId!);
                          console.log('Metadata TX ID copied to clipboard');
                        }}
                        title="Copy to clipboard"
                      >
                        📋
                      </button>
                    </span>
                  </div>
                )}
                
                <div className="detail-row">
                  <span className="detail-label">Status:</span>
                  <span className="detail-value">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '500',
                      backgroundColor: selectedItemDetails.status === 'synced' ? 'var(--success-100)' : 'var(--gray-100)',
                      color: selectedItemDetails.status === 'synced' ? 'var(--success-700)' : 'var(--gray-700)'
                    }}>
                      {getStatusIcon(selectedItemDetails)}
                      {selectedItemDetails.status}
                    </span>
                  </span>
                </div>
              </div>
              
              <div className="modal-actions">
                {selectedItemDetails.dataTxId && (
                  <button 
                    className="button small"
                    onClick={async () => {
                      await window.electronAPI.shell.openExternal(`https://arweave.net/${selectedItemDetails.dataTxId}`);
                    }}
                  >
                    <ExternalLink size={14} />
                    View on Arweave
                  </button>
                )}
                
                {selectedItemDetails.ardriveUrl && (
                  <button 
                    className="button small secondary"
                    onClick={async () => {
                      await window.electronAPI.shell.openExternal(selectedItemDetails.ardriveUrl!);
                    }}
                  >
                    <ExternalLink size={14} />
                    View on ArDrive
                  </button>
                )}
                
                <button 
                  className="button small outline"
                  onClick={() => setSelectedItemDetails(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* Styles are handled by the parent Dashboard component */