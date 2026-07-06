import React, { useEffect, useState, useRef } from 'react';
import { AppConfig, DriveInfo, DriveInfoWithStatus, WalletInfo, SyncStatus, FileUpload, PendingUpload, Profile, SyncProgress } from '../../types';
import { IpcResult } from '../../types/ipc';
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
import { useConfirm } from '../hooks/useConfirm';
import {
  Pause,
  RefreshCw,
  Download,
  FolderOpen,
  Cloud,
  Clock,
  Upload,
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
  onSyncProgressClear?: () => void;
  onRefreshUploads?: () => Promise<void>;
  // MONEY-6: pulls fresh walletInfo via the IPC return value (the
  // wallet-info-updated event channel is clobber-prone until UX-4)
  onRefreshWalletInfo?: () => Promise<void>;
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
  onRefreshWalletInfo,
  toast
}) => {
  // UX-9: in-app confirm modal replacing native window.confirm(). `confirm`
  // returns a Promise<boolean>; `confirmDialog` is rendered near the bottom of
  // this component's JSX.
  const { confirm, confirmDialog } = useConfirm();
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
  const [drives, setDrives] = useState<DriveInfoWithStatus[]>([]);
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
      const result = await window.electronAPI.uploads.getPending();
      if (result.success) {
        setPendingUploads(result.data);
      } else {
        console.error('Failed to load pending uploads:', result.error);
      }
    } catch (err) {
      console.error('Failed to load pending uploads:', err);
    }
  };

  const loadDownloads = async () => {
    try {
      const downloadResult = await window.electronAPI.files.getDownloads();
      const downloadList = downloadResult.success ? downloadResult.data : [];
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
        const profilesResult = await window.electronAPI.profiles.list();
        const profiles = profilesResult.success ? profilesResult.data : [];
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
        const mappedDrives = extractMappedDrives(await window.electronAPI.drive.getMapped());
        // Get drives with status info for private drive support
        const drivesWithStatus = extractDrivesWithStatus(await window.electronAPI.drive.listWithStatus());
        
        // Merge mapped drives with status info
        const mergedDrives = mappedDrives.map((mappedDrive: any) => {
          const driveWithStatus = drivesWithStatus.find((d: DriveInfoWithStatus) => d.id === mappedDrive.id);
          return {
            ...mappedDrive,
            isLocked: driveWithStatus?.isLocked ?? false,
            emojiFingerprint: driveWithStatus?.emojiFingerprint
          };
        });
        
        setDrives(mergedDrives);
      } catch (error) {
        console.error('Failed to load drives:', error);
        toast?.error('Failed to load drives');
      } finally {
        setIsDrivesLoading(false);
      }
    };

    loadDrives();
  }, []);

  // UX-3: both drive:listWithStatus and drive:getMapped now return the
  // IpcResult envelope. Unwrap to the data array; on a failed envelope (or any
  // legacy raw shape) fall back to [] so a fetch error never surfaces as a
  // .find()/.map() TypeError or a false "Failed to load drives" toast (UX-1).
  const extractDrivesWithStatus = (
    result: IpcResult<DriveInfoWithStatus[]> | unknown
  ): DriveInfoWithStatus[] => {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    const wrapped = result as { success?: boolean; data?: DriveInfoWithStatus[] };
    if (wrapped.success && Array.isArray(wrapped.data)) return wrapped.data;
    return [];
  };

  const extractMappedDrives = (result: IpcResult<DriveInfo[]> | unknown): DriveInfo[] => {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    const wrapped = result as { success?: boolean; data?: DriveInfo[] };
    if (wrapped.success && Array.isArray(wrapped.data)) return wrapped.data;
    return [];
  };

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
    
    // Always show confirmation for drive switching (UX-9: in-app modal, not
    // the native OS confirm dialog).
    // UX-15: only one drive syncs at a time in this beta (D-010) — spell out
    // exactly what that means at the one moment the user commits to it:
    // the current drive stops syncing, the target one starts.
    const switchExplanation = drive?.name
      ? `"${drive.name}" will stop syncing and "${targetDrive.name}" will become the drive that syncs. Only one drive syncs at a time in this beta — "${drive.name}" stays connected but won't sync until you switch back.`
      : `"${targetDrive.name}" will become the drive that syncs. Only one drive syncs at a time in this beta.`;
    const confirmMessage = pendingUploads.length > 0
      ? `You have ${pendingUploads.length} pending upload${pendingUploads.length === 1 ? '' : 's'} that will be cancelled. ${switchExplanation}`
      : switchExplanation;

    const confirmed = await confirm({
      title: `Switch to "${targetDrive.name}"?`,
      message: confirmMessage,
      confirmLabel: 'Switch',
      variant: pendingUploads.length > 0 ? 'danger' : 'default'
    });
    if (!confirmed) return;
    
    try {
      setIsSwitchingDrive(true);
      toast?.info(`Switching to "${targetDrive.name}"...`);
      
      // Switch the drive
      const result = await window.electronAPI.drive.switchTo(driveId);

      if (result.success) {
        toast?.success(`Successfully switched to "${result.data.name}"`);
        // Reload the app to reinitialize with the new drive
        setTimeout(() => {
          window.location.reload();
        }, 1000); // Brief delay to show success message
      } else {
        throw new Error(result.error || 'Failed to switch drive');
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
      // Refresh drives list with status info
      const mappedDrives = extractMappedDrives(await window.electronAPI.drive.getMapped());
      const drivesWithStatus = extractDrivesWithStatus(await window.electronAPI.drive.listWithStatus());
      
      // Merge mapped drives with status info
      const mergedDrives = mappedDrives.map((mappedDrive: any) => {
        const driveWithStatus = drivesWithStatus.find((d: DriveInfoWithStatus) => d.id === mappedDrive.id);
        return {
          ...mappedDrive,
          isLocked: driveWithStatus?.isLocked ?? false,
          emojiFingerprint: driveWithStatus?.emojiFingerprint
        };
      });
      
      setDrives(mergedDrives);
      
      toast?.success(`Drive "${newDrive.name}" created successfully!`);
      
      // The drive switching will reload the app, so no need to update state here
    } catch (error) {
      console.error('Failed to refresh drives after creation:', error);
    }
  };

  // Handle existing drive added
  const handleExistingDriveAdded = async (addedDrive: DriveInfo) => {
    try {
      // Refresh drives list with status info
      const mappedDrives = extractMappedDrives(await window.electronAPI.drive.getMapped());
      const drivesWithStatus = extractDrivesWithStatus(await window.electronAPI.drive.listWithStatus());
      
      // Merge mapped drives with status info
      const mergedDrives = mappedDrives.map((mappedDrive: any) => {
        const driveWithStatus = drivesWithStatus.find((d: DriveInfoWithStatus) => d.id === mappedDrive.id);
        return {
          ...mappedDrive,
          isLocked: driveWithStatus?.isLocked ?? false,
          emojiFingerprint: driveWithStatus?.emojiFingerprint
        };
      });
      
      setDrives(mergedDrives);
      
      toast?.success(`Drive "${addedDrive.name}" added successfully!`);
      
      // Optionally switch to the newly added drive (UX-9: in-app modal)
      const shouldSwitch = await confirm({
        title: 'Switch drives?',
        message: `Would you like to switch to "${addedDrive.name}" now?`,
        confirmLabel: 'Switch now',
        cancelLabel: 'Not now'
      });
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

  // Turbo-only (D-010): 'turbo' is the only upload method the queue submits
  const handleApproveUpload = async (uploadId: string, uploadMethod?: 'turbo', metadata?: any) => {
    try {
      // TODO: Handle metadata parameter when API supports it
      // UX-3: the envelope resolves {success:false} instead of throwing, so the
      // catch below no longer fires on a handler error — check success here.
      const result = await window.electronAPI.uploads.approve(uploadId, uploadMethod);
      if (!result.success) {
        console.error('Failed to approve upload:', result.error);
      }
      // Don't reload pending uploads immediately - let upload progress events handle state updates
      // The file should remain visible with progress indicators until completion
    } catch (err) {
      console.error('Failed to approve upload:', err);
    }
  };

  const handleRejectUpload = async (uploadId: string) => {
    try {
      // UX-3: envelope resolves {success:false} instead of throwing.
      const result = await window.electronAPI.uploads.reject(uploadId);
      if (!result.success) {
        console.error('Failed to reject upload:', result.error);
        return;
      }
      await loadPendingUploads();
    } catch (err) {
      console.error('Failed to reject upload:', err);
    }
  };

  const handleApproveAll = async () => {
    try {
      const result = await window.electronAPI.uploads.approveAll();

      // UX-3: envelope resolves {success:false} instead of throwing — surface
      // the failure the same way the old catch did, then unwrap the summary.
      if (!result.success) {
        toast?.error(`Failed to approve uploads: ${result.error}`);
        return;
      }

      const { approvedCount, totalCount, errors } = result.data;
      // Handle the new response format (UX-9: surface via toast, not window.alert)
      if (errors && errors.length > 0) {
        const errorMessage = `Only ${approvedCount} of ${totalCount} files were approved. ${errors.join(' ')}`;
        toast?.error(errorMessage);
      } else if (approvedCount > 0) {
        console.log(`Successfully approved ${approvedCount} uploads`);
      }

      // Don't reload pending uploads immediately - let upload progress events handle state updates
      // The files should remain visible with progress indicators until completion
    } catch (err) {
      console.error('Failed to approve all uploads:', err);
      toast?.error(`Failed to approve uploads: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRejectAll = async () => {
    try {
      // UX-3: envelope resolves {success:false} instead of throwing.
      const result = await window.electronAPI.uploads.rejectAll();
      if (!result.success) {
        console.error('Failed to reject all uploads:', result.error);
        return;
      }
      await loadPendingUploads();
    } catch (err) {
      console.error('Failed to reject all uploads:', err);
    }
  };

  const handleRefreshBalance = async () => {
    try {
      // Force refresh wallet info to get updated balance. Prefer the
      // return-value refresh (MONEY-6): a bare getInfo(true) relies on the
      // wallet-info-updated event to update App's state, and that listener
      // is dead after the first Turbo manager unmount (UX-4).
      if (onRefreshWalletInfo) {
        await onRefreshWalletInfo();
      } else {
        await window.electronAPI.wallet.getInfo(true);
      }
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
        onClose={() => {
          setShowTurboManager(false);
          // MONEY-6: refresh App's walletInfo by IPC return value on manager
          // close — the wallet-info-updated event listener in App is dead
          // after the first manager unmount (preload removeAllListeners
          // clobber, UX-4), so without this pull the queue's blocked rows
          // keep gating on the pre-top-up balance until restart.
          onRefreshWalletInfo?.();
        }}
        onWalletRefresh={onRefreshWalletInfo}
      />
    );
  }

  // Show File Metadata Modal if a file is selected
  if (selectedFile) {
    return (
      <div className="fade-in">
        {copyMessage && (
          <div className="copy-toast" role="status" aria-live="polite">
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
        <div className="copy-toast" role="status" aria-live="polite">
          {copyMessage}
        </div>
      )}

      {/* Create Drive Modal */}
      <CreateDriveModal
        isOpen={showCreateDriveModal}
        onClose={() => setShowCreateDriveModal(false)}
        onDriveCreated={handleDriveCreated}
        hasExistingDrives={drives.length > 0}
        currentSyncFolder={(() => {
          // Extract base sync folder from current drive's folder
          // If current folder is C:\ARDRIVE\My Public Drive, we want C:\ARDRIVE
          if (config.syncFolder && selectedDrive?.name) {
            const driveName = selectedDrive.name;
            const currentPath = config.syncFolder;
            
            // Check if current path ends with the drive name
            if (currentPath.endsWith(driveName)) {
              // Remove the drive name part to get base folder
              const separator = currentPath.includes('\\') ? '\\' : '/';
              const parts = currentPath.split(separator);
              if (parts[parts.length - 1] === driveName) {
                parts.pop(); // Remove drive name
                return parts.join(separator);
              }
            }
          }
          // Fallback to current sync folder if we can't determine base
          return config.syncFolder;
        })()}
      />

      {/* Add Existing Drive Modal */}
      <AddExistingDriveModal
        isOpen={showAddExistingDriveModal}
        onClose={() => setShowAddExistingDriveModal(false)}
        onDriveAdded={handleExistingDriveAdded}
        currentSyncFolder={(() => {
          // Extract base sync folder from current drive's folder
          // If current folder is C:\ARDRIVE\My Public Drive, we want C:\ARDRIVE
          if (config.syncFolder && selectedDrive?.name) {
            const driveName = selectedDrive.name;
            const currentPath = config.syncFolder;
            
            // Check if current path ends with the drive name
            if (currentPath.endsWith(driveName)) {
              // Remove the drive name part to get base folder
              const separator = currentPath.includes('\\') ? '\\' : '/';
              const parts = currentPath.split(separator);
              if (parts[parts.length - 1] === driveName) {
                parts.pop(); // Remove drive name
                return parts.join(separator);
              }
            }
          }
          // Fallback to current sync folder if we can't determine base
          return config.syncFolder;
        })()}
        existingDriveIds={drives.map(d => d.id)}
      />

      {/* Unified Header */}
      <div className="dashboard-header">
        {/* Left: Logo — dark-art wordmark on light theme, light-art on dark;
            CSS toggles which <img> is shown (no JS/theme-context read). */}
        <div className="dashboard-header-brand">
          <img
            src="ArDrive-Logo-Wordmark-Dark.png"
            alt="ArDrive"
            className="dashboard-header-logo dashboard-header-logo-onlight"
          />
          <img
            src="ArDrive-Logo-Wordmark-Light.png"
            alt="ArDrive"
            className="dashboard-header-logo dashboard-header-logo-ondark"
          />
        </div>

        {/* Center: Drive Selector + Sync */}
        <div className="dashboard-header-center">
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
            className="button"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>

        {/* Right: User Menu */}
        <div className="dashboard-header-actions">
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
        <div className="empty-drive-state">
          <Cloud size={64} className="empty-drive-state-icon" />
          <h2 className="empty-drive-state-title">Welcome to ArDrive!</h2>
          <p className="empty-drive-state-description">
            Let&apos;s get you started with permanent file storage on Arweave.
            First, you&apos;ll need to create or select a drive.
          </p>
          <div className="empty-drive-state-note">
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
              <div
                className="overview-tab-wrapper"
                id="overview-panel"
                role="tabpanel"
                aria-labelledby="overview-tab"
              >
                <OverviewTab
                  drive={drive}
                  config={config}
                  toast={toast}
                />
              </div>
            )}

            {dashboardTab === 'upload-queue' && (
              <div
                className="upload-queue-tab"
                id="upload-queue-panel"
                role="tabpanel"
                aria-labelledby="upload-queue-tab"
              >
                {pendingUploads.length > 0 ? (
                  <UploadApprovalQueueModern
                    pendingUploads={pendingUploads}
                    onApproveUpload={handleApproveUpload}
                    onRejectUpload={handleRejectUpload}
                    onApproveAll={handleApproveAll}
                    onRejectAll={handleRejectAll}
                    onRefreshBalance={handleRefreshBalance}
                    onRefreshPendingUploads={loadPendingUploads}
                    onRefreshUploads={onRefreshUploads}
                    onTopUpCredits={() => setShowTurboManager(true)}
                    walletInfo={walletInfo}
                  />
                ) : (
                  <div className="empty-queue">
                    <div className="empty-queue-icon">
                      <Upload size={40} />
                    </div>
                    <h3>No Pending Uploads</h3>
                    <p>
                      Files you add to your sync folder will appear here for approval before uploading to Arweave.
                    </p>
                    <button
                      className="button"
                      onClick={async () => {
                        if (config.syncFolder) {
                          await window.electronAPI.shell.openPath(config.syncFolder);
                        }
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
              <div
                className="download-queue-tab-wrapper"
                id="download-queue-panel"
                role="tabpanel"
                aria-labelledby="download-queue-tab"
              >
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
              <div
                className="activity-tab-wrapper"
                id="activity-panel"
                role="tabpanel"
                aria-labelledby="activity-tab"
              >
                <ActivityTab
                  uploads={uploads}
                  downloads={downloads}
                  pendingUploads={pendingUploads}
                  config={config}
                  toast={toast}
                  drive={drive}
                  onViewFile={(file) => setSelectedFile(file)}
                />
              </div>
            )}

            {dashboardTab === 'permaweb' && (
              <div
                className="storage-tab-wrapper"
                id="permaweb-panel"
                role="tabpanel"
                aria-labelledby="permaweb-tab"
              >
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
        <div className="sync-status-widget">
          <div className="sync-status-widget-header">
            <div className={`sync-status-widget-status ${syncStatus.isActive ? 'is-active' : 'is-paused'}`}>
              {syncStatus.isActive ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span className="sync-status-widget-status-label">Syncing</span>
                </>
              ) : (
                <>
                  <Pause size={16} />
                  <span className="sync-status-widget-status-label">Sync Paused</span>
                </>
              )}
            </div>
          </div>

          {/* Progress info */}
          <div className="sync-status-widget-body">
            {syncStatus.currentFile ? (
              <div className="sync-status-widget-current-file">
                <Upload size={12} />
                <span className="sync-status-widget-filename">
                  {syncStatus.currentFile}
                </span>
              </div>
            ) : (
              syncStatus.isActive && (
                <div className="sync-status-widget-current-file">
                  Watching for changes...
                </div>
              )
            )}

            <div className="sync-status-widget-footer">
              <span>{syncStatus.uploadedFiles} uploaded</span>
              {syncStatus.failedFiles > 0 && (
                <span className="sync-status-widget-failed">
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

      {/* Sync Progress Modal.
          UX-8: onClose now also covers the user manually dismissing a failed
          sync (header close button, Escape, backdrop-click, or the footer
          Dismiss button) — not just the auto-close-on-complete case the
          comment below originally described. onRetry re-runs the same
          manual-sync handler the "Sync Now" button uses. */}
      {syncProgress && (
        <SyncProgressDisplay
          progress={syncProgress}
          onClose={() => {
            // Clear sync progress when the modal is closed, whether that
            // close was automatic (phase 'complete') or user-initiated.
            onSyncProgressClear?.();
          }}
          onRetry={handleSync}
        />
      )}

      {/* UX-9: in-app confirmation modal (replaces native window.confirm) */}
      {confirmDialog}
    </div>
  );
};

export default Dashboard;