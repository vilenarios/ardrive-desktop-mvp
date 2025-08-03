import React, { useEffect, useState, useRef } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, PendingUpload, ConflictResolution, Profile, SyncProgress } from '../../types';
import UploadApprovalQueueModern from './UploadApprovalQueueModern';
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
import { DriveSelector } from './DriveSelector';
import { CreateDriveModal } from './CreateDriveModal';
import { AddExistingDriveModal } from './AddExistingDriveModal';
import { 
  Pause, 
  RefreshCw, 
  Download, 
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
  HardDrive,
  FileJson
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
  onSyncProgressClear?: () => void;
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
  onSyncProgressClear,
  onRefreshUploads,
  toast
}) => {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [showTurboManager, setShowTurboManager] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileUpload | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);
  const downloadRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [downloadQueueStatus, setDownloadQueueStatus] = useState<{ queued: number; active: number; total: number } | null>(null);
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
  const [profileCount, setProfileCount] = useState(1);
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  const [showWalletExport, setShowWalletExport] = useState(false);
  const selectedDrive = drive;
  
  // Drive management state
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [isDrivesLoading, setIsDrivesLoading] = useState(true);
  const [isSwitchingDrive, setIsSwitchingDrive] = useState(false);
  const [showCreateDriveModal, setShowCreateDriveModal] = useState(false);
  const [showAddExistingDriveModal, setShowAddExistingDriveModal] = useState(false);
  
  // Removed permaweb cache - StorageTab will always load fresh data

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
    
    // Arweave manifest files
    if (fileName.toLowerCase().endsWith('.arweave-manifest.json')) {
      return <FileJson size={size} className="file-type-icon manifest" style={{ color: '#dc2626' }} />;
    }
    
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
      
      // Also fetch queue status
      const statusResult = await window.electronAPI.files.getQueueStatus();
      if (statusResult.success) {
        setDownloadQueueStatus(statusResult.data);
      }
      
      // Check if there are any active downloads (exclude stuck downloads)
      const now = Date.now();
      const hasActiveDownloads = downloadList.some((d: any) => {
        if (d.status !== 'downloading') return false;
        
        // Check if download is stuck (no progress update for more than 30 seconds)
        if (d.lastProgressUpdate) {
          const timeSinceUpdate = now - new Date(d.lastProgressUpdate).getTime();
          if (timeSinceUpdate > 30000) {
            console.warn(`Download ${d.fileName} appears stuck - no progress for ${Math.round(timeSinceUpdate / 1000)}s`);
            return false;
          }
        }
        
        return true;
      });
      
      // Manage refresh interval based on active downloads
      if (hasActiveDownloads) {
        if (!downloadRefreshIntervalRef.current) {
          // Only create new interval if one doesn't exist
          console.log('Starting download refresh interval - active downloads detected');
          
          // Clear any existing interval as a safety measure
          if (downloadRefreshIntervalRef.current) {
            clearInterval(downloadRefreshIntervalRef.current);
          }
          
          downloadRefreshIntervalRef.current = setInterval(() => {
            loadDownloads();
          }, 2000); // Refresh every 2 seconds
        }
        // If interval already exists, do nothing
      } else {
        // No active downloads - stop refreshing
        if (downloadRefreshIntervalRef.current) {
          console.log('Stopping download refresh interval - no active downloads');
          clearInterval(downloadRefreshIntervalRef.current);
          downloadRefreshIntervalRef.current = null;
        }
      }
    } catch (err) {
      console.error('Failed to load downloads:', err);
      
      // Clear interval on error to prevent runaway intervals
      if (downloadRefreshIntervalRef.current) {
        clearInterval(downloadRefreshIntervalRef.current);
        downloadRefreshIntervalRef.current = null;
      }
    }
  };

  const refreshDriveState = async () => {
    // Refresh drive info is handled by App.tsx through event listeners
    // Just trigger a refresh of pending uploads
    await loadPendingUploads();
    await loadDownloads();
  };

  useEffect(() => {
    loadPendingUploads();
    loadDownloads(); // Initial load will set up its own interval if needed
    
    const interval = setInterval(() => {
      refreshDriveState();
    }, 5000);
    
    // Cleanup function
    return () => {
      clearInterval(interval);
      // Clear download refresh interval if it exists
      if (downloadRefreshIntervalRef.current) {
        clearInterval(downloadRefreshIntervalRef.current);
        downloadRefreshIntervalRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run on mount/unmount
  
  useEffect(() => {
    // Listen for download progress updates
    const handleDownloadProgress = (progressData: {
      downloadId: string;
      fileName: string;
      progress: number;
      bytesDownloaded: number;
      totalBytes: number;
      speed: number;
      remainingTime: number;
    }) => {
      // Update the specific download in the list
      setDownloads(prevDownloads => 
        prevDownloads.map(download => 
          download.id === progressData.downloadId
            ? { ...download, progress: progressData.progress }
            : download
        )
      );
    };
    
    window.electronAPI.onDownloadProgress(handleDownloadProgress);

    return () => {
      // Remove download progress listener
      window.electronAPI.removeDownloadProgressListener();
    };
  }, []);

  // Removed file state change handler - StorageTab handles its own updates

  
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
    } else {
      // Switched away from download/activity tabs - stop refresh interval
      if (downloadRefreshIntervalRef.current) {
        console.log('Left download/activity tab - stopping refresh interval');
        clearInterval(downloadRefreshIntervalRef.current);
        downloadRefreshIntervalRef.current = null;
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

  // Load drives on mount
  useEffect(() => {
    const loadDrives = async () => {
      try {
        setIsDrivesLoading(true);
        const mappedDrives = await window.electronAPI.drive.getMapped();
        setDrives(mappedDrives);
      } catch (error) {
        console.error('Failed to load drives:', error);
        toast?.error('Failed to load drives');
      } finally {
        setIsDrivesLoading(false);
      }
    };

    loadDrives();
  }, []);

  // Profile management handlers
  const handleSwitchProfile = () => {
    setShowProfileSwitcher(true);
  };

  const handleAddProfile = () => {
    // Navigate to wallet setup for adding new profile
    window.location.reload(); // This will trigger the app's profile selection logic
  };

  // Drive switching handler
  const handleDriveSwitch = async (driveId: string) => {
    if (driveId === drive?.id || isSwitchingDrive) return;
    
    // Find the target drive for better confirmation message
    const targetDrive = drives.find(d => d.id === driveId);
    if (!targetDrive) {
      toast?.error('Drive not found');
      return;
    }
    
    // Always show confirmation for drive switching
    const confirmMessage = pendingUploads.length > 0 
      ? `Switch to "${targetDrive.name}"?\n\nYou have ${pendingUploads.length} pending uploads that will be cancelled.`
      : `Switch to "${targetDrive.name}"?\n\nThis will change your active drive and sync folder.`;
    
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;
    
    try {
      setIsSwitchingDrive(true);
      toast?.info(`Switching to "${targetDrive.name}"...`);
      
      // Switch the drive
      const result = await window.electronAPI.drive.switchTo(driveId);
      
      if (result.success) {
        toast?.success(`Successfully switched to "${result.driveInfo.name}"`);
        // Reload the app to reinitialize with the new drive
        setTimeout(() => {
          window.location.reload();
        }, 1000); // Brief delay to show success message
      } else {
        throw new Error('Failed to switch drive');
      }
    } catch (error) {
      console.error('Failed to switch drive:', error);
      toast?.error(`Failed to switch to "${targetDrive.name}". Please try again.`);
      setIsSwitchingDrive(false);
    }
  };

  // Create new drive handler
  const handleCreateDrive = () => {
    setShowCreateDriveModal(true);
  };

  // Add existing drive handler
  const handleAddExistingDrive = () => {
    setShowAddExistingDriveModal(true);
  };

  // Handle drive created
  const handleDriveCreated = async (newDrive: DriveInfo) => {
    try {
      // Refresh drives list
      const allDrives = await window.electronAPI.drive.getAll();
      setDrives(allDrives);
      
      toast?.success(`Drive "${newDrive.name}" created successfully!`);
      
      // The drive switching will reload the app, so no need to update state here
    } catch (error) {
      console.error('Failed to refresh drives after creation:', error);
    }
  };

  // Handle existing drive added
  const handleExistingDriveAdded = async (addedDrive: DriveInfo) => {
    try {
      // Refresh drives list
      const allDrives = await window.electronAPI.drive.getAll();
      setDrives(allDrives);
      
      toast?.success(`Drive "${addedDrive.name}" added successfully!`);
      
      // Optionally switch to the newly added drive
      const shouldSwitch = window.confirm(`Would you like to switch to "${addedDrive.name}" now?`);
      if (shouldSwitch) {
        await handleDriveSwitch(addedDrive.id);
      }
    } catch (error) {
      console.error('Failed to refresh drives after adding:', error);
    }
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

      {/* Create Drive Modal */}
      <CreateDriveModal
        isOpen={showCreateDriveModal}
        onClose={() => setShowCreateDriveModal(false)}
        onDriveCreated={handleDriveCreated}
        currentSyncFolder={config.syncFolder}
      />

      {/* Add Existing Drive Modal */}
      <AddExistingDriveModal
        isOpen={showAddExistingDriveModal}
        onClose={() => setShowAddExistingDriveModal(false)}
        onDriveAdded={handleExistingDriveAdded}
        currentSyncFolder={config.syncFolder}
        existingDriveIds={drives.map(d => d.id)}
      />

      {/* Unified Header */}
      <div style={{
        backgroundColor: 'white',
        borderBottom: '1px solid var(--gray-200)',
        padding: 'var(--space-4) var(--space-6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-6)'
      }}>
        {/* Left: Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: '200px' }}>
          <img 
            src="ArDrive-Logo-Wordmark-Dark.png" 
            alt="ArDrive" 
            style={{ height: '32px' }} 
          />
        </div>
        
        {/* Center: Drive Selector + Sync */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 'var(--space-3)',
          flex: 1,
          justifyContent: 'center'
        }}>
          <DriveSelector
            currentDrive={selectedDrive}
            drives={drives}
            isLoading={isDrivesLoading || isSwitchingDrive}
            onDriveSelect={handleDriveSwitch}
            onCreateDrive={handleCreateDrive}
            onAddExistingDrive={handleAddExistingDrive}
          />
          
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              backgroundColor: isSyncing ? 'var(--gray-100)' : 'var(--ardrive-primary)',
              color: isSyncing ? 'var(--gray-600)' : 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '500',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
        
        {/* Right: User Menu */}
        <div style={{ minWidth: '200px', display: 'flex', justifyContent: 'flex-end' }}>
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
              count: downloadQueueStatus?.total || downloads.filter(d => d.status === 'downloading' || d.status === 'queued' || d.status === 'paused' || d.status === 'failed').length || undefined
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
                  toast={toast}
                />
              </div>
            )}

            {dashboardTab === 'upload-queue' && (
              <div className="upload-queue-tab">
                {pendingUploads.length > 0 ? (
                  <UploadApprovalQueueModern
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
                  onSyncDrive={handleSync}
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
      {syncProgress && (
        <SyncProgressDisplay 
          progress={syncProgress}
          onClose={() => {
            // Clear sync progress when modal is closed
            // This will be called by the component when phase is 'complete'
            onSyncProgressClear?.();
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;