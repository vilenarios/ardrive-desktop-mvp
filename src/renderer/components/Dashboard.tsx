import React, { useEffect, useState } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, PendingUpload, ConflictResolution, Profile, SyncProgress } from '../../types';
import UploadApprovalQueue from './UploadApprovalQueue';
import TurboCreditsManager from './TurboCreditsManager';
import FileMetadataModal from './FileMetadataModal';
import UserMenu from './UserMenu';
import WalletExport from './WalletExport';
import ProfileSwitcher from './ProfileSwitcher';
import { TabNavigation } from './common/TabNavigation';
import { OverviewTab } from './dashboard/OverviewTab';
import { ActivityTab } from './dashboard/ActivityTab';
import { StorageTab } from './dashboard/StorageTab';
import { DownloadQueueTab } from './dashboard/DownloadQueueTab';
import { SyncProgressDisplay } from './SyncProgressDisplay';
import Settings from './Settings';
import { 
  Pause, 
  RefreshCw, 
  Download, 
  Settings as SettingsIcon,
  FolderOpen,
  Cloud,
  Clock,
  FileText,
  Upload,
  File,
  FileCode,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  Archive,
  BookOpen,
  HardDrive
} from 'lucide-react';

interface DashboardProps {
  config: AppConfig;
  walletInfo: WalletInfo;
  currentProfile: Profile;
  drive: DriveInfo;
  syncStatus: SyncStatus | null;
  syncProgress: SyncProgress | null;
  uploads: FileUpload[];
  onLogout: () => void;
  onDriveDeleted: () => void;
  onRefreshUploads?: () => Promise<void>;
  toast?: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const Dashboard: React.FC<DashboardProps> = ({
  config,
  walletInfo,
  currentProfile,
  drive,
  syncStatus,
  syncProgress,
  uploads,
  onLogout,
  onDriveDeleted,
  onRefreshUploads,
  toast
}) => {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [showTurboManager, setShowTurboManager] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileUpload | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [downloadRefreshInterval, setDownloadRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<{
    uploadsFound: number;
    downloadsFound: number;
    errors: string[];
  } | null>(null);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'upload-queue' | 'download-queue' | 'activity' | 'permaweb'>('overview');
  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [showDriveMenu, setShowDriveMenu] = useState(false);
  const [profileCount, setProfileCount] = useState(1);
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  const [showWalletExport, setShowWalletExport] = useState(false);
  const selectedDrive = drive;
  
  // Permaweb cache state - lifted to Dashboard to persist across tab switches
  const [permawebCache, setPermawebCache] = useState<any[]>([]);
  const [permawebCacheTime, setPermawebCacheTime] = useState<Date | null>(null);
  const [permawebCacheValid, setPermawebCacheValid] = useState(false);

  // Filter uploads based on search and status
  const filteredUploads = uploads.filter(upload => {
    const matchesSearch = searchQuery === '' || 
      upload.fileName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'completed' && upload.status === 'completed') ||
      (statusFilter === 'pending' && upload.status === 'pending') ||
      (statusFilter === 'failed' && upload.status === 'failed');
    
    return matchesSearch && matchesStatus;
  });

  // Filter downloads similarly
  const filteredDownloads = downloads.filter(download => {
    const matchesSearch = searchQuery === '' || 
      download.fileName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'completed' && download.status === 'completed') ||
      (statusFilter === 'pending' && download.status === 'downloading') ||
      (statusFilter === 'failed' && download.status === 'failed');
    
    return matchesSearch && matchesStatus;
  });

  // File type icon mapping
  const getFileTypeIcon = (fileName: string, size: number = 16) => {
    const extension = fileName.toLowerCase().split('.').pop() || '';
    
    // Image files
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif'].includes(extension)) {
      return <FileImage size={size} className="file-type-icon image" />;
    }
    
    // Video files
    if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v', '3gp', 'ogv'].includes(extension)) {
      return <FileVideo size={size} className="file-type-icon video" />;
    }
    
    // Audio files
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff'].includes(extension)) {
      return <FileAudio size={size} className="file-type-icon audio" />;
    }
    
    // Code files
    if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yaml', 'yml', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'dart', 'vue', 'svelte', 'sh', 'bat', 'ps1', 'sql', 'r', 'scala', 'clj', 'hs', 'elm', 'fs', 'ml', 'pl', 'lua', 'nim', 'cr', 'ex', 'exs'].includes(extension)) {
      return <FileCode size={size} className="file-type-icon code" />;
    }
    
    // Spreadsheet files
    if (['xlsx', 'xls', 'csv', 'ods', 'numbers'].includes(extension)) {
      return <FileSpreadsheet size={size} className="file-type-icon spreadsheet" />;
    }
    
    // Archive files
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso', 'img'].includes(extension)) {
      return <Archive size={size} className="file-type-icon archive" />;
    }
    
    // Document files
    if (['pdf'].includes(extension)) {
      return <FileText size={size} className="file-type-icon pdf" />;
    }
    
    if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(extension)) {
      return <BookOpen size={size} className="file-type-icon document" />;
    }
    
    // Text files
    if (['txt', 'md', 'rst', 'tex', 'log'].includes(extension)) {
      return <FileText size={size} className="file-type-icon text" />;
    }
    
    // Default file icon
    return <File size={size} className="file-type-icon default" />;
  };

  const copyToClipboard = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(message);
      setTimeout(() => setCopyMessage(null), 3000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setCopyMessage('Failed to copy to clipboard');
      setTimeout(() => setCopyMessage(null), 3000);
    }
  };

  const loadPendingUploads = async () => {
    try {
      const pending = await window.electronAPI.uploads.getPending();
      setPendingUploads(pending);
    } catch (err) {
      console.error('Failed to load pending uploads:', err);
    }
  };

  const loadDownloads = async () => {
    try {
      const downloadList = await window.electronAPI.files.getDownloads();
      setDownloads(downloadList);
      
      // Check if there are any active downloads
      const hasActiveDownloads = downloadList.some((d: any) => d.status === 'downloading');
      
      // Manage refresh interval based on active downloads
      if (hasActiveDownloads && !downloadRefreshInterval) {
        // Start refreshing every 2 seconds when downloads are active
        console.log('Starting download refresh interval - active downloads detected');
        const interval = setInterval(() => {
          loadDownloads();
        }, 2000); // Faster refresh during active downloads
        setDownloadRefreshInterval(interval);
      } else if (!hasActiveDownloads && downloadRefreshInterval) {
        // Stop refreshing when no downloads are active
        console.log('Stopping download refresh interval - no active downloads');
        clearInterval(downloadRefreshInterval);
        setDownloadRefreshInterval(null);
      }
    } catch (err) {
      console.error('Failed to load downloads:', err);
    }
  };

  const refreshDriveState = async () => {
    // Refresh drive info is handled by App.tsx through event listeners
    // Just trigger a refresh of pending uploads
    await loadPendingUploads();
    // Downloads manage their own refresh based on active status
  };

  useEffect(() => {
    loadPendingUploads();
    loadDownloads(); // Initial load will set up its own interval if needed
    
    const interval = setInterval(() => {
      refreshDriveState();
    }, 5000);

    return () => {
      clearInterval(interval);
      // Clean up download refresh interval if it exists
      if (downloadRefreshInterval) {
        clearInterval(downloadRefreshInterval);
      }
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showDriveMenu) {
        setShowDriveMenu(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showDriveMenu]);
  
  // Load downloads when switching to download queue tab or activity tab
  useEffect(() => {
    if (dashboardTab === 'download-queue') {
      console.log('Switched to download queue tab, loading downloads...');
      loadDownloads();
    } else if (dashboardTab === 'activity') {
      console.log('Switched to activity tab, loading activity data...');
      loadDownloads();
      // Refresh uploads data if handler is provided
      if (onRefreshUploads) {
        onRefreshUploads();
      }
    }
  }, [dashboardTab]);

  // Load profile count for profile management
  useEffect(() => {
    const loadProfileCount = async () => {
      try {
        const profiles = await window.electronAPI.profiles.list();
        setProfileCount(profiles.length);
      } catch (error) {
        console.error('Failed to load profile count:', error);
      }
    };
    
    loadProfileCount();
  }, [currentProfile]);

  // Profile management handlers
  const handleSwitchProfile = () => {
    setShowProfileSwitcher(true);
  };

  const handleAddProfile = () => {
    // Navigate to wallet setup for adding new profile
    window.location.reload(); // This will trigger the app's profile selection logic
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setSyncResults(null);
      
      // Use the new unified manual sync method
      console.log('Starting manual sync...');
      const syncResult = await window.electronAPI.sync.manual();
      
      // Process results
      setSyncResults({
        uploadsFound: 0, // Upload scanning happens in background
        downloadsFound: 0, // Downloads are handled by sync process
        errors: syncResult.success ? [] : [syncResult.error || 'Sync failed']
      });
      
      // Refresh data after sync
      await loadPendingUploads();
      await loadDownloads();
      if (onRefreshUploads) {
        await onRefreshUploads();
      }
      
      // Show results
      if (syncResult.success) {
        toast?.success('Sync completed successfully!');
      } else {
        toast?.error(`Sync failed: ${syncResult.error}`);
      }
      
    } catch (err) {
      console.error('Sync failed:', err);
      toast?.error('Sync failed. Please try again.');
      setSyncResults({
        uploadsFound: 0,
        downloadsFound: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error']
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleApproveUpload = async (uploadId: string, uploadMethod?: 'ar' | 'turbo', metadata?: any) => {
    try {
      // TODO: Handle metadata parameter when API supports it
      await window.electronAPI.uploads.approve(uploadId, uploadMethod);
      // Don't reload pending uploads immediately - let upload progress events handle state updates
      // The file should remain visible with progress indicators until completion
    } catch (err) {
      console.error('Failed to approve upload:', err);
    }
  };

  const handleRejectUpload = async (uploadId: string) => {
    try {
      await window.electronAPI.uploads.reject(uploadId);
      await loadPendingUploads();
    } catch (err) {
      console.error('Failed to reject upload:', err);
    }
  };

  const handleApproveAll = async () => {
    try {
      const result = await window.electronAPI.uploads.approveAll();
      
      // Handle the new response format
      if (result.errors && result.errors.length > 0) {
        // Show error message to user
        const errorMessage = `Only ${result.approvedCount} of ${result.totalCount} files were approved.\n\nErrors:\n${result.errors.join('\n')}`;
        alert(errorMessage); // TODO: Replace with proper toast notification
      } else if (result.approvedCount > 0) {
        console.log(`Successfully approved ${result.approvedCount} uploads`);
      }
      
      // Don't reload pending uploads immediately - let upload progress events handle state updates
      // The files should remain visible with progress indicators until completion
    } catch (err) {
      console.error('Failed to approve all uploads:', err);
      alert(`Failed to approve uploads: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRejectAll = async () => {
    try {
      await window.electronAPI.uploads.rejectAll();
      await loadPendingUploads();
    } catch (err) {
      console.error('Failed to reject all uploads:', err);
    }
  };

  const handleResolveConflict = async (resolution: ConflictResolution) => {
    console.log('Conflict resolution:', resolution);
  };

  const handleRefreshBalance = async () => {
    try {
      // Force refresh wallet info to get updated balance
      await window.electronAPI.wallet.getInfo(true);
    } catch (err) {
      console.error('Failed to refresh wallet balance:', err);
    }
  };


  // Stored files download handlers
  // Show Turbo Credits Manager if requested
  if (showTurboManager) {
    return (
      <TurboCreditsManager 
        walletInfo={walletInfo}
        onClose={() => setShowTurboManager(false)}
      />
    );
  }

  // Show File Metadata Modal if a file is selected
  if (selectedFile) {
    return (
      <div className="fade-in">
        {copyMessage && (
          <div className="copy-toast">
            {copyMessage}
          </div>
        )}
        
        <FileMetadataModal
          file={selectedFile}
          driveId={drive?.id}
          driveName={selectedDrive?.name}
          onClose={() => setSelectedFile(null)}
          onCopySuccess={(message) => {
            setCopyMessage(message);
            setTimeout(() => setCopyMessage(null), 3000);
          }}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-container fade-in">
      {/* Copy Message */}
      {copyMessage && (
        <div className="copy-toast">
          {copyMessage}
        </div>
      )}

      {/* Top Navigation Bar */}
      <div className="top-navbar">
        <div className="navbar-brand">
          <img 
            src="ArDrive-Logo-Wordmark-Dark.png" 
            alt="ArDrive" 
            style={{ height: '28px' }} 
          />
          <span style={{
            marginLeft: 'var(--space-4)',
            paddingLeft: 'var(--space-4)',
            borderLeft: '1px solid var(--gray-300)',
            fontSize: '14px',
            color: 'var(--gray-600)',
            fontStyle: 'italic'
          }}>
            Your files, permanent and secure
          </span>
        </div>
        
        <div className="navbar-actions">
          {/* Unified User Menu */}
          <UserMenu
            currentProfile={currentProfile}
            walletBalance={walletInfo.balance}
            turboBalance={walletInfo.turboBalance}
            onShowSettings={() => setShowSettings(!showSettings)}
            onShowTurboManager={() => setShowTurboManager(true)}
            onShowWalletExport={() => setShowWalletExport(true)}
            onLogout={onLogout}
            onSwitchProfile={handleSwitchProfile}
            onAddProfile={handleAddProfile}
            profileCount={profileCount}
          />
        </div>
      </div>

      {/* Settings Modal */}
      <Settings 
        isOpen={showSettings && !showWalletExport}
        onClose={() => setShowSettings(false)}
        config={config}
        onShowWalletExport={() => {
          setShowWalletExport(true);
          setShowSettings(false);
        }}
      />


      {/* Empty State - No Drive */}
      {!selectedDrive ? (
        <div className="empty-drive-state" style={{
          textAlign: 'center',
          padding: 'var(--space-12) var(--space-8)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-lg)',
          margin: 'var(--space-8) var(--space-8) var(--space-6)'
        }}>
          <Cloud size={64} style={{ color: 'var(--gray-400)', marginBottom: 'var(--space-4)' }} />
          <h2 style={{ marginBottom: 'var(--space-3)', fontSize: '24px' }}>Welcome to ArDrive!</h2>
          <p style={{ 
            fontSize: '16px', 
            color: 'var(--gray-600)', 
            marginBottom: 'var(--space-6)',
            maxWidth: '500px',
            margin: '0 auto var(--space-6)'
          }}>
            Let&apos;s get you started with permanent file storage on Arweave. 
            First, you&apos;ll need to create or select a drive.
          </p>
          <div style={{ 
            padding: 'var(--space-4) var(--space-8)', 
            backgroundColor: 'var(--gray-100)', 
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            color: 'var(--gray-600)'
          }}>
            No drive configured. Please restart the application.
          </div>
        </div>
      ) : null}

      {/* Main Content - Tabbed Dashboard */}
      {selectedDrive && (
        <div className="dashboard-content">
          {/* Unified Drive Identity Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-5) var(--space-6)',
            backgroundColor: 'white',
            borderBottom: '2px solid var(--gray-100)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-lg)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              {/* Drive Icon */}
              <FolderOpen size={24} style={{ color: 'var(--gray-600)' }} />
              
              {/* Drive Info */}
              <div>
                <div style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  marginBottom: '4px'
                }}>
                  <h2 style={{ 
                    fontSize: '18px', 
                    fontWeight: '600',
                    margin: 0,
                    color: 'var(--gray-900)'
                  }}>
                    {drive?.name || 'My Drive'}
                  </h2>
                  {drive?.privacy === 'public' && (
                    <span style={{
                      fontSize: '12px',
                      padding: '2px 8px',
                      backgroundColor: 'var(--warning-100)',
                      color: 'var(--warning-700)',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: '500'
                    }}>
                      Public
                    </span>
                  )}
                </div>
                
                {/* Dynamic Status - Only show when something is happening */}
                {(syncStatus?.isActive || isSyncing) && (
                  <div style={{ 
                    fontSize: '13px',
                    color: 'var(--gray-600)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}>
                    {isSyncing ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" style={{ color: 'var(--ardrive-primary-600)' }} />
                        <span>Syncing... Checking for updates</span>
                      </>
                    ) : syncStatus?.isActive ? (
                      <>
                        <Upload size={12} className="animate-pulse" style={{ color: 'var(--success-600)' }} />
                        <span>
                          Monitoring for uploads
                          {syncStatus.currentFile && ` • Uploading ${syncStatus.currentFile}`}
                        </span>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            
            {/* Drive Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {/* Sync Button */}
            <button
              className="button small"
              onClick={handleSync}
              disabled={isSyncing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                backgroundColor: isSyncing ? 'var(--gray-100)' : 'var(--ardrive-primary-50)',
                color: isSyncing ? 'var(--gray-600)' : 'var(--ardrive-primary-700)',
                border: `1px solid ${isSyncing ? 'var(--gray-200)' : 'var(--ardrive-primary-200)'}`
              }}
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              {isSyncing ? 'Syncing...' : 'Sync'}
            </button>
            
            {/* Drive Options Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                className="button small outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDriveMenu(!showDriveMenu);
                }}
                style={{
                  padding: 'var(--space-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)'
                }}
              >
                <SettingsIcon size={16} />
              </button>
              
              {showDriveMenu && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 4px)',
                  backgroundColor: 'white',
                  border: '1px solid var(--gray-200)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: '200px',
                  zIndex: 1000,
                  overflow: 'hidden'
                }}>
                  <button
                    onClick={() => {
                      setShowDriveMenu(false);
                      // TODO: Implement rename
                      alert('Rename drive feature coming soon');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-3) var(--space-4)',
                      width: '100%',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      textAlign: 'left',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FileText size={16} />
                    Rename Drive
                  </button>
                  
                  <button
                    onClick={async () => {
                      setShowDriveMenu(false);
                      if (config.syncFolder) {
                        await window.electronAPI.shell.openPath(config.syncFolder);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-3) var(--space-4)',
                      width: '100%',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      textAlign: 'left',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--gray-50)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <FolderOpen size={16} />
                    Open Local Folder
                  </button>
                  
                  <div style={{ 
                    height: '1px', 
                    backgroundColor: 'var(--gray-200)',
                    margin: 'var(--space-1) 0'
                  }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dashboard Tab Navigation */}
        <TabNavigation
          tabs={[
            {
              id: 'overview',
              label: 'Overview',
              icon: <HardDrive size={16} />
            },
            {
              id: 'upload-queue',
              label: 'Upload Queue',
              icon: <Upload size={16} />,
              count: pendingUploads.length > 0 ? pendingUploads.length : undefined,
              badge: pendingUploads.length > 0 ? 'attention' : undefined
            },
            {
              id: 'download-queue',
              label: 'Download Queue',
              icon: <Download size={16} />,
              count: downloads.filter(d => d.status === 'downloading').length || undefined
            },
            {
              id: 'activity',
              label: 'Activity',
              icon: <Clock size={16} />
            },
            {
              id: 'permaweb',
              label: 'Permaweb',
              icon: <Cloud size={16} />
            }
          ]}
          activeTab={dashboardTab}
          onTabChange={(tabId) => setDashboardTab(tabId as 'overview' | 'upload-queue' | 'download-queue' | 'activity' | 'permaweb')}
          className="dashboard-tabs"
        />

        {/* Tab Content */}
        <div className="tab-content">
          <div className="tab-content-inner">
            {dashboardTab === 'overview' && (
              <div className="overview-tab-wrapper">
                <OverviewTab
                  drive={drive}
                  config={config}
                />
              </div>
            )}

            {dashboardTab === 'upload-queue' && (
              <div className="upload-queue-tab">
                {pendingUploads.length > 0 ? (
                  <UploadApprovalQueue
                    pendingUploads={pendingUploads}
                    onApproveUpload={handleApproveUpload}
                    onRejectUpload={handleRejectUpload}
                    onApproveAll={handleApproveAll}
                    onRejectAll={handleRejectAll}
                    onResolveConflict={handleResolveConflict}
                    onRefreshBalance={handleRefreshBalance}
                    onRefreshPendingUploads={loadPendingUploads}
                    onRefreshUploads={onRefreshUploads}
                    walletInfo={walletInfo}
                  />
                ) : (
                  <div className="empty-queue">
                    <div style={{
                      width: '80px',
                      height: '80px',
                      margin: '0 auto var(--space-6)',
                      backgroundColor: 'var(--ardrive-primary-50)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Upload size={40} style={{ color: 'var(--ardrive-primary)' }} />
                    </div>
                    <h3 style={{ 
                      fontSize: '20px', 
                      fontWeight: '600', 
                      marginBottom: 'var(--space-3)',
                      color: 'var(--gray-900)'
                    }}>
                      No Pending Uploads
                    </h3>
                    <p style={{ 
                      fontSize: '15px', 
                      marginBottom: 'var(--space-6)',
                      maxWidth: '400px',
                      margin: '0 auto var(--space-6)'
                    }}>
                      Files you add to your sync folder will appear here for approval before uploading to Arweave.
                    </p>
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
                  </div>
                )}
              </div>
            )}

            {dashboardTab === 'download-queue' && (
              <div className="download-queue-tab-wrapper">
                <DownloadQueueTab
                  downloads={downloads}
                  onOpenFolder={async (filePath) => {
                    // Pass the file path to the shell API, which will extract the directory
                    await window.electronAPI.shell.openPath(filePath);
                  }}
                />
              </div>
            )}

            {dashboardTab === 'activity' && (
              <div className="activity-tab-wrapper">
                <ActivityTab
                  uploads={uploads}
                  downloads={downloads}
                  pendingUploads={pendingUploads}
                  config={config}
                  drive={drive}
                  onViewFile={(file) => setSelectedFile(file)}
                />
              </div>
            )}

            {dashboardTab === 'permaweb' && (
              <div className="storage-tab-wrapper">
                <StorageTab
                  drive={drive}
                  config={config}
                  syncStatus={syncStatus}
                  onDriveDeleted={onDriveDeleted}
                  onViewDriveDetails={(drive) => {
                    console.log('View drive details:', drive);
                  }}
                  cachedData={permawebCache}
                  lastRefreshTime={permawebCacheTime}
                  cacheValid={permawebCacheValid}
                  onCacheUpdate={(data, time, valid) => {
                    setPermawebCache(data);
                    setPermawebCacheTime(time);
                    setPermawebCacheValid(valid);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Wallet Export Modal */}
      {showWalletExport && (
        <WalletExport
          walletAddress={walletInfo.address}
          onClose={() => setShowWalletExport(false)}
        />
      )}

      {/* Floating Sync Status Widget */}
      {syncStatus && (
        <div style={{
          position: 'fixed',
          bottom: 'var(--space-6)',
          right: 'var(--space-6)',
          backgroundColor: 'white',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: 'var(--space-4)',
          minWidth: '280px',
          zIndex: 1000,
          border: '1px solid var(--gray-200)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {syncStatus.isActive ? (
                <>
                  <RefreshCw size={16} style={{ 
                    color: 'var(--success-600)',
                    animation: 'spin 2s linear infinite'
                  }} />
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>Syncing</span>
                </>
              ) : (
                <>
                  <Pause size={16} style={{ color: 'var(--gray-500)' }} />
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>Sync Paused</span>
                </>
              )}
            </div>
            
          </div>
          
          {/* Progress info */}
          <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>
            {syncStatus.currentFile ? (
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <Upload size={12} />
                  <span style={{ 
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {syncStatus.currentFile}
                  </span>
                </div>
              </div>
            ) : (
              syncStatus.isActive && (
                <div style={{ marginBottom: 'var(--space-2)' }}>
                  Watching for changes...
                </div>
              )
            )}
            
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--gray-100)'
            }}>
              <span>{syncStatus.uploadedFiles} uploaded</span>
              {syncStatus.failedFiles > 0 && (
                <span style={{ color: 'var(--error-600)' }}>
                  {syncStatus.failedFiles} failed
                </span>
              )}
              <span>{syncStatus.totalFiles - syncStatus.uploadedFiles - syncStatus.failedFiles} pending</span>
            </div>
          </div>
        </div>
      )}

      {/* Profile Switcher Modal */}
      {showProfileSwitcher && (
        <ProfileSwitcher
          currentProfile={currentProfile}
          onProfileSwitch={(profileId) => {
            setShowProfileSwitcher(false);
            // The profile switch will trigger app reload via main process
          }}
          onAddProfile={() => {
            setShowProfileSwitcher(false);
            handleAddProfile();
          }}
          onManageProfiles={() => {
            setShowProfileSwitcher(false);
            // Could open a profile management screen in the future
          }}
        />
      )}

      {/* Sync Progress Modal */}
      {syncProgress && syncProgress.phase !== 'complete' && (
        <SyncProgressDisplay 
          progress={syncProgress}
        />
      )}
    </div>
  );
};

export default Dashboard;