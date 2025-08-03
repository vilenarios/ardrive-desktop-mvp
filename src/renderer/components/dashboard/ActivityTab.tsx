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
  Eye,
  Activity,
  FileCode,
  FileSpreadsheet,
  Presentation,
  FileType2,
  Bookmark,
  Database,
  Braces,
  FileJson,
  Settings,
  Zap,
  Monitor,
  Smartphone,
  Package,
  Globe,
  Palette,
  Camera,
  Film,
  Headphones,
  BookOpen,
  ScrollText,
  Binary,
  HardDrive,
  MoreHorizontal,
  FolderOpen,
  Share,
  Copy,
  RefreshCw,
  X
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
  driveId?: string;
}

interface ActivityTabProps {
  uploads: FileUpload[];
  downloads: FileDownload[];
  pendingUploads: PendingUpload[];
  config: AppConfig;
  drive: DriveInfo;
  onViewFile: (file: FileUpload) => void;
}


export const ActivityTab: React.FC<ActivityTabProps> = ({
  uploads,
  downloads,
  pendingUploads,
  config,
  drive,
  onViewFile
}) => {
  const [showingItems, setShowingItems] = useState(15); // Show 15 items initially, load more on scroll
  const [searchQuery, setSearchQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'uploads' | 'downloads'>('all');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState<string | null>(null);
  const [selectedActivityDetails, setSelectedActivityDetails] = useState<ActivityItem | null>(null);

  // Use the single drive
  const selectedDrive = drive;


  // Unified activity item interface
  interface ActivityItem {
    id: string;
    type: 'upload' | 'download';
    fileName: string;
    fileSize: number;
    timestamp: Date;
    status: 'completed' | 'pending' | 'failed' | 'uploading' | 'downloading';
    progress?: number;
    error?: string;
    originalItem: FileUpload | FileDownload;
  }

  const getFileIcon = (fileName: string) => {
    const ext = fileName.toLowerCase().split('.').pop();
    const iconSize = 12; // Compact view: 12px icons
    
    switch (ext) {
      // Images
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
      case 'bmp':
      case 'tiff':
      case 'ico':
        return <Image size={iconSize} className="file-icon image" style={{ color: '#10b981' }} />;
      
      // RAW Image formats
      case 'raw':
      case 'cr2':
      case 'nef':
      case 'arw':
      case 'dng':
        return <Camera size={iconSize} className="file-icon camera" style={{ color: '#059669' }} />;
      
      // Videos
      case 'mp4':
      case 'mov':
      case 'avi':
      case 'mkv':
      case 'webm':
      case 'flv':
      case 'wmv':
      case 'm4v':
      case '3gp':
        return <Video size={iconSize} className="file-icon video" style={{ color: '#dc2626' }} />;
      
      // Professional video
      case 'prores':
      case 'dnxhd':
      case 'avchd':
        return <Film size={iconSize} className="file-icon film" style={{ color: '#991b1b' }} />;
      
      // Audio
      case 'mp3':
      case 'wav':
      case 'flac':
      case 'aac':
      case 'ogg':
      case 'm4a':
      case 'wma':
      case 'opus':
        return <Music size={iconSize} className="file-icon audio" style={{ color: '#7c3aed' }} />;
      
      // Professional audio
      case 'aiff':
      case 'au':
      case 'pcm':
        return <Headphones size={iconSize} className="file-icon headphones" style={{ color: '#5b21b6' }} />;
      
      // Documents
      case 'pdf':
        return <FileText size={iconSize} className="file-icon pdf" style={{ color: '#dc2626' }} />;
      case 'doc':
      case 'docx':
      case 'odt':
      case 'rtf':
        return <BookOpen size={iconSize} className="file-icon document" style={{ color: '#2563eb' }} />;
      case 'txt':
      case 'md':
      case 'readme':
        return <ScrollText size={iconSize} className="file-icon text" style={{ color: '#6b7280' }} />;
      
      // Presentations
      case 'ppt':
      case 'pptx':
      case 'odp':
      case 'key':
        return <Presentation size={iconSize} className="file-icon presentation" style={{ color: '#ea580c' }} />;
      
      // Spreadsheets
      case 'xls':
      case 'xlsx':
      case 'ods':
      case 'csv':
      case 'numbers':
        return <FileSpreadsheet size={iconSize} className="file-icon spreadsheet" style={{ color: '#16a34a' }} />;
      
      // Code files
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return <FileCode size={iconSize} className="file-icon javascript" style={{ color: '#f59e0b' }} />;
      case 'html':
      case 'htm':
      case 'xml':
        return <Globe size={iconSize} className="file-icon web" style={{ color: '#ea580c' }} />;
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        return <Palette size={iconSize} className="file-icon css" style={{ color: '#3b82f6' }} />;
      case 'json':
      case 'yaml':
      case 'yml':
        return <FileJson size={iconSize} className="file-icon json" style={{ color: '#10b981' }} />;
      case 'py':
      case 'pyc':
      case 'pyo':
        return <FileCode size={iconSize} className="file-icon python" style={{ color: '#3776ab' }} />;
      case 'java':
      case 'class':
      case 'jar':
        return <FileCode size={iconSize} className="file-icon java" style={{ color: '#ed8936' }} />;
      case 'php':
        return <FileCode size={iconSize} className="file-icon php" style={{ color: '#777bb4' }} />;
      case 'rb':
      case 'gem':
        return <FileCode size={iconSize} className="file-icon ruby" style={{ color: '#cc342d' }} />;
      case 'go':
        return <FileCode size={iconSize} className="file-icon go" style={{ color: '#00add8' }} />;
      case 'rs':
        return <FileCode size={iconSize} className="file-icon rust" style={{ color: '#ce422b' }} />;
      case 'swift':
        return <FileCode size={iconSize} className="file-icon swift" style={{ color: '#fa7343' }} />;
      case 'kt':
      case 'kts':
        return <FileCode size={iconSize} className="file-icon kotlin" style={{ color: '#7f52ff' }} />;
      case 'c':
      case 'h':
        return <FileCode size={iconSize} className="file-icon c" style={{ color: '#555555' }} />;
      case 'cpp':
      case 'cc':
      case 'cxx':
      case 'hpp':
        return <FileCode size={iconSize} className="file-icon cpp" style={{ color: '#00599c' }} />;
      case 'cs':
        return <FileCode size={iconSize} className="file-icon csharp" style={{ color: '#239120' }} />;
      case 'sh':
      case 'bash':
      case 'zsh':
      case 'fish':
        return <Monitor size={iconSize} className="file-icon shell" style={{ color: '#4ade80' }} />;
      case 'bat':
      case 'cmd':
      case 'ps1':
        return <Monitor size={iconSize} className="file-icon windows" style={{ color: '#0078d4' }} />;
      
      // Configuration files
      case 'config':
      case 'conf':
      case 'ini':
      case 'cfg':
        return <Settings size={iconSize} className="file-icon config" style={{ color: '#6b7280' }} />;
      case 'env':
      case 'environment':
        return <Zap size={iconSize} className="file-icon env" style={{ color: '#eab308' }} />;
      
      // Database files
      case 'sql':
      case 'db':
      case 'sqlite':
      case 'sqlite3':
        return <Database size={iconSize} className="file-icon database" style={{ color: '#3b82f6' }} />;
      
      // Archives
      case 'zip':
      case 'rar':
      case '7z':
      case 'tar':
      case 'gz':
      case 'bz2':
      case 'xz':
      case 'lz':
        return <Archive size={iconSize} className="file-icon archive" style={{ color: '#8b5cf6' }} />;
      
      // Executables and packages
      case 'exe':
      case 'msi':
      case 'deb':
      case 'rpm':
      case 'pkg':
      case 'dmg':
      case 'app':
        return <Package size={iconSize} className="file-icon package" style={{ color: '#ef4444' }} />;
      
      // Mobile app files
      case 'apk':
      case 'ipa':
      case 'aab':
        return <Smartphone size={iconSize} className="file-icon mobile" style={{ color: '#06b6d4' }} />;
      
      // Binary and system files
      case 'bin':
      case 'dat':
      case 'tmp':
      case 'cache':
        return <Binary size={iconSize} className="file-icon binary" style={{ color: '#64748b' }} />;
      case 'iso':
      case 'img':
      case 'vhd':
      case 'vmdk':
        return <HardDrive size={iconSize} className="file-icon disk" style={{ color: '#374151' }} />;
      
      // Fonts
      case 'ttf':
      case 'otf':
      case 'woff':
      case 'woff2':
      case 'eot':
        return <FileType2 size={iconSize} className="file-icon font" style={{ color: '#78716c' }} />;
      
      // Bookmarks
      case 'url':
      case 'webloc':
        return <Bookmark size={iconSize} className="file-icon bookmark" style={{ color: '#f59e0b' }} />;
      
      // Design files (Figma, Sketch, etc.)
      case 'fig':
      case 'sketch':
      case 'xd':
      case 'ai':
      case 'psd':
      case 'indd':
        return <Palette size={iconSize} className="file-icon design" style={{ color: '#ec4899' }} />;
      
      // Default fallback
      default:
        return <File size={iconSize} className="file-icon default" style={{ color: '#9ca3af' }} />;
    }
  };

  const getActivityTypeIcon = (type: 'upload' | 'download') => {
    switch (type) {
      case 'upload':
        return <Upload size={10} className="activity-type-icon" />;
      case 'download':
        return <Download size={10} className="activity-type-icon" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={12} className="status-icon success" />;
      case 'uploading':
      case 'downloading':
        return <Loader size={12} className="status-icon pending animate-spin" />;
      case 'pending':
        return <Clock size={12} className="status-icon pending" />;
      case 'failed':
        return <XCircle size={12} className="status-icon error" />;
      default:
        return <Clock size={12} className="status-icon neutral" />;
    }
  };

  // Context menu action handlers
  const handleOpenFile = async (activity: ActivityItem) => {
    if (activity.type === 'upload') {
      onViewFile(activity.originalItem as FileUpload);
    } else if (activity.type === 'download') {
      const download = activity.originalItem as FileDownload;
      if (download.localPath) {
        try {
          await window.electronAPI.shell.openFile(download.localPath);
        } catch (error) {
          console.error('Failed to open file:', error);
          // Fallback to opening the containing folder
          try {
            await window.electronAPI.shell.openPath(download.localPath);
          } catch (fallbackError) {
            console.error('Failed to open containing folder:', fallbackError);
          }
        }
      }
    }
    setContextMenuOpen(null);
  };

  const handleShareFile = async (activity: ActivityItem) => {
    const item = activity.originalItem as FileUpload | FileDownload;
    let shareUrl = '';
    
    if (activity.type === 'upload') {
      const upload = item as FileUpload;
      if (upload.fileId) {
        shareUrl = `https://arweave.net/${upload.fileId}`;
      } else if (upload.dataTxId) {
        shareUrl = `https://arweave.net/${upload.dataTxId}`;
      }
    } else {
      const download = item as FileDownload;
      if (download.fileId) {
        shareUrl = `https://arweave.net/${download.fileId}`;
      } else if (download.dataTxId) {
        shareUrl = `https://arweave.net/${download.dataTxId}`;
      }
    }
    
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        // TODO: Add toast notification for copied link
        console.log('Share URL copied to clipboard:', shareUrl);
      } catch (error) {
        console.error('Failed to copy share URL:', error);
      }
    }
    setContextMenuOpen(null);
  };

  const handleViewOnline = async (activity: ActivityItem) => {
    const item = activity.originalItem as FileUpload | FileDownload;
    let viewUrl = '';
    
    if (activity.type === 'upload') {
      const upload = item as FileUpload;
      if (upload.dataTxId) {
        viewUrl = `https://arweave.net/${upload.dataTxId}`;
      } else if (upload.fileId) {
        viewUrl = `https://arweave.net/${upload.fileId}`;
      }
    } else {
      const download = item as FileDownload;
      if (download.dataTxId) {
        viewUrl = `https://arweave.net/${download.dataTxId}`;
      } else if (download.fileId) {
        viewUrl = `https://arweave.net/${download.fileId}`;
      }
    }
    
    if (viewUrl) {
      try {
        await window.electronAPI.shell.openExternal(viewUrl);
      } catch (error) {
        console.error('Failed to open URL:', error);
      }
    }
    setContextMenuOpen(null);
  };

  // Combine uploads and downloads into unified activity stream
  const createUnifiedActivityStream = (): ActivityItem[] => {
    const activities: ActivityItem[] = [];

    // Add uploads (filter to current drive)
    const currentDriveUploads = uploads.filter(upload => upload.driveId === drive?.id);
    currentDriveUploads.forEach(upload => {
      // Only log if size is 0 or missing (for debugging)
      if (!upload.fileSize || upload.fileSize === 0) {
        console.warn(`⚠️ Upload missing size: ${upload.fileName}`);
      }
      activities.push({
        id: upload.id,
        type: 'upload',
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        timestamp: new Date(upload.completedAt || upload.createdAt),
        status: upload.status as any,
        progress: upload.progress,
        error: upload.error,
        originalItem: upload
      });
    });

    // Add downloads (filter to current drive)
    const currentDriveDownloads = downloads.filter(download => download.driveId === drive?.id);
    currentDriveDownloads.forEach(download => {
      // Only log if size is 0 or missing (for debugging)
      if (!download.fileSize || download.fileSize === 0) {
        console.warn(`⚠️ Download missing size: ${download.fileName}`);
      }
      activities.push({
        id: download.id,
        type: 'download',
        fileName: download.fileName,
        fileSize: download.fileSize,
        timestamp: new Date(download.completedAt || download.downloadedAt),
        status: download.status as any,
        progress: download.progress,
        error: download.error,
        originalItem: download
      });
    });

    // Sort by timestamp (newest first)
    return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  };

  const formatFileSize = (bytes: number | undefined | null): string => {
    if (!bytes || bytes === 0) return '0 Bytes';
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

  // Get filtered and paginated activity items
  const allActivities = createUnifiedActivityStream();
  
  // Apply search filter
  const searchFiltered = searchQuery ? 
    allActivities.filter(activity => 
      activity.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    ) : allActivities;

  // Apply activity type filter
  const typeFiltered = activityFilter === 'all' ? 
    searchFiltered : 
    searchFiltered.filter(activity => 
      activityFilter === 'uploads' ? activity.type === 'upload' : activity.type === 'download'
    );

  // Get last 30 days of activity
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentActivities = typeFiltered.filter(activity => activity.timestamp >= thirtyDaysAgo);

  // Paginate results
  const displayedActivities = recentActivities.slice(0, showingItems);
  const hasMore = recentActivities.length > showingItems;

  // Handle item clicks
  const handleActivityClick = async (activity: ActivityItem) => {
    // Don't trigger if context menu is open
    if (contextMenuOpen === activity.id) return;
    
    if (activity.type === 'upload') {
      onViewFile(activity.originalItem as FileUpload);
    } else if (activity.type === 'download') {
      const download = activity.originalItem as FileDownload;
      
      // Handle failed downloads differently
      if (download.status === 'failed') {
        // Show details modal for failed downloads
        setSelectedActivityDetails(activity);
        return;
      }
      
      // Open file directly for successful downloads
      if (download.localPath && download.status === 'completed') {
        try {
          await window.electronAPI.shell.openFile(download.localPath);
        } catch (error) {
          console.error('Failed to open file:', error);
          // Fallback to opening the containing folder
          try {
            await window.electronAPI.shell.openPath(download.localPath);
          } catch (fallbackError) {
            console.error('Failed to open containing folder:', fallbackError);
          }
        }
      }
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuOpen(null);
    };

    if (contextMenuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenuOpen]);

  if (!selectedDrive) {
    return (
      <div className="activity-tab">
        <div className="empty-state">
          <Activity size={48} style={{ opacity: 0.5, marginBottom: 'var(--space-4)' }} />
          <h3>No Drive Selected</h3>
          <p>Select a drive to view its activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-tab">
      {/* Header */}
      <div className="activity-header">
        <h2>Activity for &quot;{selectedDrive.name}&quot;</h2>
        <p>Recent upload and download activity for this drive</p>
      </div>

      {/* Filters */}
      <div className="activity-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search activity..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value as any)}
            className="filter-select"
          >
            <option value="all">All Activity</option>
            <option value="uploads">Uploads Only</option>
            <option value="downloads">Downloads Only</option>
          </select>
        </div>

        <div className="activity-summary">
          <span>
            Showing {displayedActivities.length} of {recentActivities.length} activities from last 30 days
          </span>
        </div>
      </div>

      {/* Unified Activity Stream */}
      <div className="unified-activity-stream">
        {displayedActivities.length > 0 ? (
          <>
            <div className="activity-list">
              {displayedActivities.map((activity) => (
                <div 
                  key={activity.id} 
                  className="unified-activity-item"
                  onMouseEnter={() => setHoveredItem(activity.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                  onClick={() => handleActivityClick(activity)}
                  onDoubleClick={() => {
                    if (activity.type === 'download' && activity.status === 'completed') {
                      handleActivityClick(activity);
                    }
                  }}
                  style={{ userSelect: 'none' }}
                >
                  {/* Activity Type Badge */}
                  <div className={`activity-type-badge ${activity.type}`}>
                    {getActivityTypeIcon(activity.type)}
                  </div>

                  {/* File Icon */}
                  <div className="file-icon-container">
                    {getFileIcon(activity.fileName)}
                  </div>

                  {/* Activity Details */}
                  <div className="activity-details">
                    <div 
                      className="activity-description activity-filename"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActivityClick(activity);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {activity.fileName}
                      {/* Show folder location for uploads */}
                      {activity.type === 'upload' && activity.status === 'completed' && (
                        <div className="activity-location" style={{
                          fontSize: '12px',
                          color: 'var(--gray-600)',
                          marginTop: '2px'
                        }}>
                          uploaded to{' '}
                          <button
                            className="folder-link"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const upload = activity.originalItem as FileUpload;
                              if (upload.localPath && config.syncFolder) {
                                // Get the folder path from the file path
                                const separator = upload.localPath.includes('\\') ? '\\' : '/';
                                const lastSeparatorIndex = upload.localPath.lastIndexOf(separator);
                                const folderPath = lastSeparatorIndex > -1 ? upload.localPath.substring(0, lastSeparatorIndex) : upload.localPath;
                                try {
                                  await window.electronAPI.shell.openPath(folderPath);
                                } catch (error) {
                                  console.error('Failed to open folder:', error);
                                }
                              }
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: 'var(--ardrive-primary-600)',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              fontSize: 'inherit',
                              fontFamily: 'inherit'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--ardrive-primary-700)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--ardrive-primary-600)';
                            }}
                          >
                            {(() => {
                              const upload = activity.originalItem as FileUpload;
                              if (upload.localPath && config.syncFolder) {
                                // Extract relative folder path
                                const fullPath = upload.localPath;
                                const separator = fullPath.includes('\\') ? '\\' : '/';
                                const lastSeparatorIndex = fullPath.lastIndexOf(separator);
                                const folderPath = lastSeparatorIndex > -1 ? fullPath.substring(0, lastSeparatorIndex) : fullPath;
                                
                                // Get relative path from sync folder
                                let relativePath = folderPath.replace(config.syncFolder, '');
                                // Remove leading separator
                                if (relativePath.startsWith(separator)) {
                                  relativePath = relativePath.substring(1);
                                }
                                
                                // Convert to forward slashes for display and get just the folder name
                                const displayPath = relativePath.replace(/\\/g, '/');
                                const folderName = displayPath ? displayPath.split('/').pop() || displayPath : 'root';
                                
                                return folderName;
                              }
                              return 'folder';
                            })()}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="activity-meta">
                      <span>{formatFileSize(activity.fileSize)}</span>
                      <span>•</span>
                      <span>{formatTimeAgo(activity.timestamp)}</span>
                      {activity.progress && activity.status !== 'completed' && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'var(--info-600)', fontWeight: '500' }}>
                            {activity.progress}%
                          </span>
                        </>
                      )}
                    </div>
                    
                    {/* Progress bar for active operations */}
                    {activity.status === 'uploading' || activity.status === 'downloading' ? (
                      <div className="activity-progress">
                        <div className="progress-bar">
                          <div 
                            className={`progress-fill ${activity.type}`}
                            style={{
                              width: `${activity.progress || 0}%`
                            }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {/* Error message */}
                    {activity.error && (
                      <div className="error-message">
                        {activity.error}
                      </div>
                    )}
                  </div>


                  {/* Context Menu - appears on hover */}
                  {hoveredItem === activity.id && (
                    <div className="context-menu-trigger">
                      <button
                        className="context-menu-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenuOpen(contextMenuOpen === activity.id ? null : activity.id);
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>

                      {/* Context Menu Dropdown */}
                      {contextMenuOpen === activity.id && (
                        <div className="context-menu-dropdown">
                          <button
                            className="context-menu-item"
                            onClick={() => handleOpenFile(activity)}
                          >
                            {activity.type === 'upload' ? <Eye size={14} /> : <FolderOpen size={14} />}
                            Open
                          </button>
                          
                          <button
                            className="context-menu-item"
                            onClick={() => handleShareFile(activity)}
                          >
                            <Copy size={14} />
                            Copy Link
                          </button>
                          
                          <button
                            className="context-menu-item"
                            onClick={() => {
                              setSelectedActivityDetails(activity);
                              setContextMenuOpen(null);
                            }}
                          >
                            <AlertCircle size={14} />
                            View Details
                          </button>
                          
                          <button
                            className="context-menu-item"
                            onClick={() => handleViewOnline(activity)}
                          >
                            <ExternalLink size={14} />
                            View Online
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="load-more-container">
                <button
                  className="load-more-button"
                  onClick={() => setShowingItems(prev => prev + 15)}
                >
                  Load More ({recentActivities.length - showingItems} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-activity">
            <Activity size={48} style={{ opacity: 0.5, marginBottom: 'var(--space-4)' }} />
            <h3>
              {searchQuery || activityFilter !== 'all' ? 'No matching activity' : 'No recent activity'}
            </h3>
            <p>
              {searchQuery || activityFilter !== 'all' 
                ? 'Try adjusting your search or filter'
                : 'Upload or download files to see activity here'
              }
            </p>
          </div>
        )}
      </div>

      {/* Activity Details Modal */}
      {selectedActivityDetails && (
        <div className="modal-overlay" onClick={() => setSelectedActivityDetails(null)}>
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
                {getFileIcon(selectedActivityDetails.fileName)}
                {selectedActivityDetails.fileName}
              </h3>
              <button 
                className="modal-close"
                onClick={() => setSelectedActivityDetails(null)}
                title="Close"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <div className="details-grid">
                <div className="detail-row">
                  <span className="detail-label">Activity Type:</span>
                  <span className="detail-value">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '500',
                      backgroundColor: selectedActivityDetails.type === 'upload' ? 'var(--success-100)' : 'var(--info-100)',
                      color: selectedActivityDetails.type === 'upload' ? 'var(--success-700)' : 'var(--info-700)'
                    }}>
                      {getActivityTypeIcon(selectedActivityDetails.type)}
                      {selectedActivityDetails.type === 'upload' ? 'Upload' : 'Download'}
                    </span>
                  </span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">File Size:</span>
                  <span className="detail-value">
                    {formatFileSize(selectedActivityDetails.fileSize)}
                    {selectedActivityDetails.fileSize && selectedActivityDetails.fileSize > 0 && (
                      <span style={{ color: 'var(--gray-500)', marginLeft: 'var(--space-2)' }}>
                        ({selectedActivityDetails.fileSize.toLocaleString()} bytes)
                      </span>
                    )}
                  </span>
                </div>
                
                <div className="detail-row">
                  <span className="detail-label">Timestamp:</span>
                  <span className="detail-value">
                    {selectedActivityDetails.timestamp.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long', 
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
                
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
                      backgroundColor: selectedActivityDetails.status === 'completed' ? 'var(--success-100)' : 
                                       selectedActivityDetails.status === 'failed' ? 'var(--danger-100)' : 'var(--gray-100)',
                      color: selectedActivityDetails.status === 'completed' ? 'var(--success-700)' : 
                             selectedActivityDetails.status === 'failed' ? 'var(--danger-700)' : 'var(--gray-700)'
                    }}>
                      {getStatusIcon(selectedActivityDetails.status)}
                      {selectedActivityDetails.status}
                    </span>
                  </span>
                </div>
                
                {selectedActivityDetails.progress !== undefined && selectedActivityDetails.status !== 'completed' && (
                  <div className="detail-row">
                    <span className="detail-label">Progress:</span>
                    <span className="detail-value">
                      {selectedActivityDetails.progress}%
                      <div style={{
                        width: '100px',
                        height: '6px',
                        backgroundColor: 'var(--gray-200)',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        marginLeft: 'var(--space-2)'
                      }}>
                        <div style={{
                          width: `${selectedActivityDetails.progress}%`,
                          height: '100%',
                          backgroundColor: selectedActivityDetails.type === 'upload' ? 'var(--success-500)' : 'var(--info-500)',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </span>
                  </div>
                )}
                
                {selectedActivityDetails.error && (
                  <div className="detail-row">
                    <span className="detail-label">Error:</span>
                    <span className="detail-value" style={{ color: 'var(--danger-600)' }}>
                      {selectedActivityDetails.error}
                    </span>
                  </div>
                )}
                
                {/* Upload-specific details */}
                {selectedActivityDetails.type === 'upload' && (
                  <>
                    {(selectedActivityDetails.originalItem as FileUpload).id && (
                      <div className="detail-row">
                        <span className="detail-label">Upload ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).id}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).fileId && (
                      <div className="detail-row">
                        <span className="detail-label">File ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).fileId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileUpload).fileId!);
                              console.log('File ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).dataTxId && (
                      <div className="detail-row">
                        <span className="detail-label">Data Transaction ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).dataTxId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileUpload).dataTxId!);
                              console.log('Data TX ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).metadataTxId && (
                      <div className="detail-row">
                        <span className="detail-label">Metadata Transaction ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).metadataTxId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileUpload).metadataTxId!);
                              console.log('Metadata TX ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).localPath && (
                      <div className="detail-row">
                        <span className="detail-label">Local Path:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).localPath}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).driveId && (
                      <div className="detail-row">
                        <span className="detail-label">Drive ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileUpload).driveId}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileUpload).uploadMethod && (
                      <div className="detail-row">
                        <span className="detail-label">Upload Method:</span>
                        <span className="detail-value">
                          {(selectedActivityDetails.originalItem as FileUpload).uploadMethod}
                        </span>
                      </div>
                    )}
                    
                    {/* Parent Folder ID - not available in upload records yet */}
                  </>
                )}
                
                {/* Download-specific details */}
                {selectedActivityDetails.type === 'download' && (
                  <>
                    
                    {(selectedActivityDetails.originalItem as FileDownload).fileId && (
                      <div className="detail-row">
                        <span className="detail-label">File ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileDownload).fileId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileDownload).fileId!);
                              console.log('File ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).dataTxId && (
                      <div className="detail-row">
                        <span className="detail-label">Data Transaction ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileDownload).dataTxId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileDownload).dataTxId!);
                              console.log('Data TX ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).metadataTxId && (
                      <div className="detail-row">
                        <span className="detail-label">Metadata Transaction ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileDownload).metadataTxId}
                          <button 
                            className="copy-button"
                            onClick={async () => {
                              await navigator.clipboard.writeText((selectedActivityDetails.originalItem as FileDownload).metadataTxId!);
                              console.log('Metadata TX ID copied to clipboard');
                            }}
                            title="Copy to clipboard"
                          >
                            📋
                          </button>
                        </span>
                      </div>
                    )}
                    
                    {/* Parent Folder ID - not available in download records yet */}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).localPath && (
                      <div className="detail-row">
                        <span className="detail-label">Local Path:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileDownload).localPath}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).driveId && (
                      <div className="detail-row">
                        <span className="detail-label">Drive ID:</span>
                        <span className="detail-value monospace">
                          {(selectedActivityDetails.originalItem as FileDownload).driveId}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).downloadedAt && (
                      <div className="detail-row">
                        <span className="detail-label">Download Started:</span>
                        <span className="detail-value">
                          {(selectedActivityDetails.originalItem as FileDownload).downloadedAt.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    )}
                    
                    {(selectedActivityDetails.originalItem as FileDownload).completedAt && (
                      <div className="detail-row">
                        <span className="detail-label">Download Completed:</span>
                        <span className="detail-value">
                          {(selectedActivityDetails.originalItem as FileDownload).completedAt!.toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
              
              <div className="modal-actions">
                {selectedActivityDetails.type === 'upload' && (selectedActivityDetails.originalItem as FileUpload).dataTxId && (
                  <button 
                    className="button small"
                    onClick={async () => {
                      await window.electronAPI.shell.openExternal(`https://arweave.net/${(selectedActivityDetails.originalItem as FileUpload).dataTxId}`);
                    }}
                  >
                    <ExternalLink size={14} />
                    View on Arweave
                  </button>
                )}
                
                {selectedActivityDetails.type === 'download' && (selectedActivityDetails.originalItem as FileDownload).dataTxId && (
                  <button 
                    className="button small"
                    onClick={async () => {
                      await window.electronAPI.shell.openExternal(`https://arweave.net/${(selectedActivityDetails.originalItem as FileDownload).dataTxId}`);
                    }}
                  >
                    <ExternalLink size={14} />
                    View on Arweave
                  </button>
                )}
                
                {selectedActivityDetails.type === 'download' && (selectedActivityDetails.originalItem as FileDownload).status === 'failed' && (
                  <>
                    <button 
                      className="button small primary"
                      onClick={async () => {
                        const download = selectedActivityDetails.originalItem as FileDownload;
                        if (download.fileId) {
                          // Queue for re-download
                          await window.electronAPI.files.queueDownload(download.fileId, 100);
                          setSelectedActivityDetails(null);
                          // Refresh the activity list
                          window.location.reload();
                        }
                      }}
                    >
                      <RefreshCw size={14} />
                      Retry Download
                    </button>
                    <button 
                      className="button small outline"
                      onClick={async () => {
                        const download = selectedActivityDetails.originalItem as FileDownload;
                        if (download.fileId) {
                          // Cancel/remove this download
                          await window.electronAPI.files.cancelDownload(download.fileId);
                          setSelectedActivityDetails(null);
                          // Refresh the activity list
                          window.location.reload();
                        }
                      }}
                    >
                      <X size={14} />
                      Remove from Queue
                    </button>
                  </>
                )}
                
                {selectedActivityDetails.type === 'download' && (selectedActivityDetails.originalItem as FileDownload).localPath && (selectedActivityDetails.originalItem as FileDownload).status === 'completed' && (
                  <>
                    <button 
                      className="button small secondary"
                      onClick={async () => {
                        try {
                          await window.electronAPI.shell.openFile((selectedActivityDetails.originalItem as FileDownload).localPath);
                        } catch (error) {
                          console.error('Failed to open file:', error);
                          // Fallback to opening the containing folder
                          try {
                            await window.electronAPI.shell.openPath((selectedActivityDetails.originalItem as FileDownload).localPath);
                          } catch (fallbackError) {
                            console.error('Failed to open containing folder:', fallbackError);
                          }
                        }
                      }}
                    >
                      <FolderOpen size={14} />
                      Open File
                    </button>
                    <button 
                      className="button small outline"
                      onClick={async () => {
                        await window.electronAPI.shell.openPath((selectedActivityDetails.originalItem as FileDownload).localPath);
                      }}
                    >
                      <FolderOpen size={14} />
                      Show in Folder
                    </button>
                  </>
                )}
                
                <button 
                  className="button small outline"
                  onClick={() => setSelectedActivityDetails(null)}
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