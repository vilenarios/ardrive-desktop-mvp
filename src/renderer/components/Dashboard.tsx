import React, { useEffect, useState } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, PendingUpload, ConflictResolution, Profile } from '../../types';
import UploadApprovalQueue from './UploadApprovalQueue';
import TurboCreditsManager from './TurboCreditsManager';
import FileMetadataModal from './FileMetadataModal';
import UserMenu from './UserMenu';
import WalletExport from './WalletExport';
import StoredFilesBrowser from './StoredFilesBrowser';
import ProfileSwitcher from './ProfileSwitcher';
import { SecurityStatus } from './SecurityStatus';
import { TabNavigation } from './common/TabNavigation';
import { OverviewTab } from './dashboard/OverviewTab';
import { ActivityTab } from './dashboard/ActivityTab';
import { StorageTab } from './dashboard/StorageTab';
import { DownloadQueueTab } from './dashboard/DownloadQueueTab';
import { 
  Play, 
  Pause, 
  RefreshCw, 
  Download, 
  Wallet, 
  Settings, 
  FolderOpen,
  Cloud,
  Activity,
  FileText,
  Upload,
  LogOut,
  Zap,
  Image,
  Video,
  Music,
  File,
  FileCode,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  Archive,
  BookOpen,
  HardDrive,
  FileType,
  Search,
  Filter,
  Key,
  Shield,
  Trash2,
  Moon,
  Sun
} from 'lucide-react';

interface DashboardProps {
  config: AppConfig;
  walletInfo: WalletInfo;
  currentProfile: Profile;
  drive: DriveInfo;
  syncStatus: SyncStatus | null;
  uploads: FileUpload[];
  onLogout: () => void;
  onDriveDeleted: () => void;
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
  uploads,
  onLogout,
  onDriveDeleted
}) => {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [showTurboManager, setShowTurboManager] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileUpload | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [downloadRefreshInterval, setDownloadRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'uploads' | 'downloads' | 'stored'>('uploads');
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'upload-queue' | 'download-queue' | 'permaweb'>('overview');
  const [showSettings, setShowSettings] = useState(false);
  const [showAllUploads, setShowAllUploads] = useState(false);
  const [showAllDownloads, setShowAllDownloads] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all');
  const [showDriveMenu, setShowDriveMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [profileCount, setProfileCount] = useState(1);
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  
  // Handler to fix type mismatch
  const handleStatusFilterChange = (filter: string) => {
    setStatusFilter(filter as 'all' | 'completed' | 'pending' | 'failed');
  };
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
  
  // Load downloads when switching to download queue tab
  useEffect(() => {
    if (dashboardTab === 'download-queue') {
      console.log('Switched to download queue tab, loading downloads...');
      loadDownloads();
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

  const handleStopSync = async () => {
    try {
      console.log('Dashboard: Stopping sync...');
      const result = await window.electronAPI.sync.stop();
      console.log('Dashboard: Stop sync result:', result);
      
      if (result.success) {
        console.log('Dashboard: Sync stopped successfully');
      } else {
        console.error('Dashboard: Failed to stop sync:', result.error);
        alert(`Failed to stop sync: ${result.error || 'Unknown error'}`);
      }
      
      await refreshDriveState();
    } catch (err) {
      console.error('Dashboard: Error stopping sync:', err);
      alert(`Error stopping sync: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleStartSync = async () => {
    try {
      console.log('Dashboard: Starting sync...');
      const result = await window.electronAPI.sync.start();
      console.log('Dashboard: Start sync result:', result);
      
      if (result.success) {
        console.log('Dashboard: Sync started successfully');
      } else {
        console.error('Dashboard: Failed to start sync:', result.error);
        alert(`Failed to start sync: ${result.error || 'Unknown error'}`);
      }
      
      await refreshDriveState();
    } catch (err) {
      console.error('Dashboard: Error starting sync:', err);
      alert(`Error starting sync: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

  const handleRedownloadFiles = async () => {
    try {
      setIsRefreshing(true);
      console.log('Checking for new files from ArDrive...');
      const result = await window.electronAPI.files.redownloadAll();
      if (result.success) {
        console.log('File check completed successfully');
        await loadDownloads();
        await refreshDriveState();
        // Switch to download queue tab to show results
        setDashboardTab('download-queue');
      } else {
        console.error('File check failed:', result.error);
        alert(`Failed to check for new files: ${result.error}`);
      }
    } catch (err) {
      console.error('Failed to check for new files:', err);
      alert('Failed to check for new files. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Stored files download handlers
  const handleDownloadFile = async (fileId: string) => {
    try {
      console.log('Downloading file:', fileId);
      // TODO: Implement individual file download
      // await window.electronAPI.files.downloadStored(fileId);
      alert('Individual file download will be implemented');
    } catch (err) {
      console.error('Failed to download file:', err);
    }
  };

  const handleDownloadSelected = async (fileIds: string[]) => {
    try {
      console.log('Downloading selected files:', fileIds);
      // TODO: Implement bulk file download
      // await window.electronAPI.files.downloadStoredBulk(fileIds);
      alert(`Bulk download of ${fileIds.length} files will be implemented`);
    } catch (err) {
      console.error('Failed to download selected files:', err);
    }
  };

  const handleDownloadAll = async () => {
    try {
      console.log('Downloading all stored files');
      // TODO: Implement download all functionality
      // await window.electronAPI.files.downloadAllStored();
      alert('Download all stored files will be implemented');
    } catch (err) {
      console.error('Failed to download all files:', err);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'green';
      case 'uploading': return 'yellow';
      case 'failed': return 'red';
      default: return 'gray';
    }
  };

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

      {/* Quick Settings Panel */}
      {showSettings && (
        <div className="quick-settings">
          <div className="settings-card">
            <h3>Quick Settings</h3>
            
            <div className="setting-row">
              <div className="setting-info">
                <Cloud size={16} />
                <div>
                  <label>Current Drive</label>
                  <span>{selectedDrive?.name || 'None selected'}</span>
                </div>
              </div>
              {/* Change Drive button removed for single drive */}
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <FolderOpen size={16} />
                <div>
                  <label>Sync Folder</label>
                  <span>{config.syncFolder ? config.syncFolder.split(/[/\\]/).pop() : 'None selected'}</span>
                </div>
              </div>
              {/* Change Folder button removed for single drive */}
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <Shield size={16} />
                <div>
                  <label>Security</label>
                  <SecurityStatus />
                </div>
              </div>
            </div>
            
            {/* Multi-drive sync removed for single drive */}
            
            <div className="setting-row">
              <div className="setting-info">
                {isDarkMode ? <Moon size={16} /> : <Sun size={16} />}
                <div>
                  <label>Dark Mode</label>
                  <span>{isDarkMode ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
              <button 
                className="button small outline" 
                onClick={() => {
                  setIsDarkMode(!isDarkMode);
                  // In a real implementation, this would update a global theme context
                  alert('Dark mode toggle coming soon!');
                }}
              >
                {isDarkMode ? 'Light' : 'Dark'}
              </button>
            </div>
            
            <div className="setting-row">
              <div className="setting-info">
                <Key size={16} />
                <div>
                  <label>Wallet Export</label>
                  <span>Backup your wallet securely</span>
                </div>
              </div>
              <button className="button small outline" onClick={() => setShowWalletExport(true)}>
                Export
              </button>
            </div>
          </div>
        </div>
      )}


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
            Let's get you started with permanent file storage on Arweave. 
            First, you'll need to create or select a drive.
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
            marginBottom: 'var(--space-4)'
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
                {(syncStatus?.isActive || isRefreshing) && (
                  <div style={{ 
                    fontSize: '13px',
                    color: 'var(--gray-600)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}>
                    {isRefreshing ? (
                      <>
                        <Download size={12} className="animate-spin" style={{ color: 'var(--primary-600)' }} />
                        <span>Checking for new files...</span>
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
            {/* Upload Monitor Toggle */}
            {syncStatus?.isActive ? (
              <button
                className="button small"
                onClick={handleStopSync}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  backgroundColor: 'var(--error-50)',
                  color: 'var(--error-700)',
                  border: '1px solid var(--error-200)'
                }}
              >
                <Pause size={14} />
                Stop Monitoring
              </button>
            ) : (
              <button
                className="button small"
                onClick={handleStartSync}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  backgroundColor: 'var(--success-50)',
                  color: 'var(--success-700)',
                  border: '1px solid var(--success-200)'
                }}
              >
                <Upload size={14} />
                <span style={{ paddingRight: '2px' }}>↑</span>
                Start Upload Monitor
              </button>
            )}
            
            {/* Check for Updates Button */}
            <button
              className="button small"
              onClick={handleRedownloadFiles}
              disabled={isRefreshing || syncStatus?.isActive}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                backgroundColor: isRefreshing ? 'var(--gray-100)' : 'var(--primary-50)',
                color: isRefreshing ? 'var(--gray-600)' : 'var(--primary-700)',
                border: `1px solid ${isRefreshing ? 'var(--gray-200)' : 'var(--primary-200)'}`,
                opacity: syncStatus?.isActive ? 0.5 : 1,
                cursor: syncStatus?.isActive ? 'not-allowed' : 'pointer'
              }}
              title={syncStatus?.isActive ? 'Stop upload monitoring first' : ''}
            >
              <Download size={14} className={isRefreshing ? 'animate-spin' : ''} />
              <span style={{ paddingRight: '2px' }}>↓</span>
              {isRefreshing ? 'Checking...' : 'Check for Updates'}
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
                <Settings size={16} />
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
              icon: <Activity size={16} />
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
              id: 'permaweb',
              label: 'Permaweb',
              icon: <Cloud size={16} />
            }
          ]}
          activeTab={dashboardTab}
          onTabChange={(tabId) => setDashboardTab(tabId as 'overview' | 'upload-queue' | 'download-queue' | 'permaweb')}
          className="dashboard-tabs"
        />

        {/* Tab Content */}
        <div className="tab-content">
          {dashboardTab === 'overview' && (
            <OverviewTab
              walletInfo={walletInfo}
              syncStatus={syncStatus}
              drive={drive}
              config={config}
            />
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
                  walletInfo={walletInfo}
                />
              ) : (
                <div className="empty-queue" style={{
                  textAlign: 'center',
                  padding: 'var(--space-12) var(--space-8)',
                  color: 'var(--gray-600)'
                }}>
                  <div style={{
                    width: '80px',
                    height: '80px',
                    margin: '0 auto var(--space-6)',
                    backgroundColor: 'var(--primary-50)',
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
            <DownloadQueueTab
              downloads={downloads}
              onRefresh={loadDownloads}
              onOpenFolder={async (filePath) => {
                // Pass the file path to the shell API, which will extract the directory
                await window.electronAPI.shell.openPath(filePath);
              }}
            />
          )}

          {dashboardTab === 'permaweb' && (
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
          )}
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
            
            {/* Quick sync toggle */}
            <button
              onClick={syncStatus.isActive ? handleStopSync : handleStartSync}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--gray-300)',
                backgroundColor: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                e.currentTarget.style.borderColor = 'var(--gray-400)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.borderColor = 'var(--gray-300)';
              }}
            >
              {syncStatus.isActive ? (
                <>
                  <Pause size={12} />
                  Pause
                </>
              ) : (
                <>
                  <Play size={12} />
                  Resume
                </>
              )}
            </button>
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
    </div>
  );
};

export default Dashboard;