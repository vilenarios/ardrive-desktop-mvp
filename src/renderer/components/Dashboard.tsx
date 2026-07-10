import React, { useEffect, useState, useRef } from 'react';
import { AppConfig, DriveInfo, DriveInfoWithStatus, WalletInfo, SyncStatus, FileUpload, PendingUpload, Profile, SyncProgress, DriveSyncMapping } from '../../types';
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
import { SyncIndicator } from './SyncIndicator';
import Settings from './Settings';
import { DriveSelector } from './DriveSelector';
import { CreateDriveModal } from './CreateDriveModal';
import { AddExistingDriveModal } from './AddExistingDriveModal';
import { useConfirm } from '../hooks/useConfirm';
import {
  Pause,
  Play,
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
  // UX-5: App fully reloads its profile-scoped state (wallet/drives/dashboard)
  // for the newly-active profile after a switch, and routes "Add Profile" to
  // new-profile onboarding without a window reload.
  onProfileSwitched?: () => void;
  onAddProfile?: () => void;
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
  onProfileSwitched,
  onAddProfile,
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
  // UX-28: live upload-side sync state for the persistent header indicator —
  // the same window.electronAPI.sync.getStatus() call UX-30's tray polls
  // (SyncManager.getStatus()), so the header chip and the tray tooltip are
  // reading the exact same source of truth. null until the first successful
  // fetch resolves so the header never flashes a fabricated "Paused" before
  // the real state is known.
  const [uploadSyncStatus, setUploadSyncStatus] = useState<SyncStatus | null>(null);
  // SYNC-9: renderer-side navigator.onLine hint for the header sync indicator.
  // A hint only — the main process's gateway-unreachable health is
  // authoritative — but it flips the chip to "Offline" the instant the OS
  // reports the link is down, and triggers an immediate status re-poll when it
  // comes back so recovery shows up without waiting for the next poll tick.
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  // UX-22: in-flight guard for the pause/resume control below, so a slow
  // sync:pause/sync:resume round trip can't be double-clicked into a race.
  const [isTogglingSync, setIsTogglingSync] = useState(false);
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

  // UX-28: combined snapshot for the persistent header sync indicator —
  // upload-pending count (totalFiles - uploadedFiles, the same math the UX-30
  // tray uses) PLUS the download queue's live total (queued + active, the
  // same count the Download Queue tab badge already shows). Summing both
  // means the chip stays honest during an initial/background drive download,
  // not just while uploading. null until uploadSyncStatus's first fetch
  // resolves, so the header never renders a guessed state.
  const syncIndicatorSnapshot = uploadSyncStatus
    ? {
        isActive: uploadSyncStatus.isActive,
        pendingCount:
          Math.max(0, uploadSyncStatus.totalFiles - uploadSyncStatus.uploadedFiles) +
          (downloadQueueStatus?.total ?? 0),
        // SYNC-9: the authoritative degraded/offline health from
        // SyncManager.getStatus() — makes a broken/offline sync visible in the
        // persistent header chip instead of the app looking "Up to date".
        health: uploadSyncStatus.health,
        healthMessage: uploadSyncStatus.healthMessage,
        // SYNC-9 renderer-side HINT: flip to "Offline" instantly when the OS
        // reports the link is down, before the next status poll confirms it.
        isOnline
      }
    : null;

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

  // UX-28: same call the tray (UX-30) polls for its ambient status center
  // (SyncManager.getStatus() via the 'sync:status' IPC handler) — reused
  // here, renderer-side, so the header indicator never invents its own
  // sync-tracking logic. Deliberately swallows failures: a stale/missing
  // header chip is a cosmetic gap, never worth surfacing as a toast/error.
  const loadSyncIndicatorStatus = async () => {
    try {
      const statusResult = await window.electronAPI.sync.getStatus();
      if (statusResult.success && statusResult.data) {
        setUploadSyncStatus(statusResult.data);
      }
    } catch (err) {
      console.error('Failed to load sync status for header indicator:', err);
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

      // UX-28: rides the same cadence as the download-queue poll below (5s
      // baseline via refreshDriveState, 2s while downloads are active) so the
      // header indicator's "N files" count stays live without a separate
      // polling loop.
      loadSyncIndicatorStatus();

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

  // UX-28: event-driven refresh for the header sync indicator — a fresh
  // onSyncProgress event (bubbled down from App.tsx as the syncProgress prop)
  // means the sync engine just reported something new, so re-poll the live
  // status immediately instead of waiting for the next 5s/2s poll tick.
  useEffect(() => {
    if (syncProgress) {
      loadSyncIndicatorStatus();
    }
  }, [syncProgress]);

  // SYNC-9: reflect OS connectivity changes in the header indicator. Going
  // offline flips the chip to "Offline — sync paused" instantly (hint); coming
  // back online re-polls the real sync-health immediately, so the main
  // process's auto-resume (once it reconnects) shows up promptly rather than on
  // the next 5s tick.
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      loadSyncIndicatorStatus();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
    
    // UX-4: dispose ONLY this handler on cleanup (scoped removal, no removeAll*).
    const dispose = window.electronAPI.onDownloadProgress(handleDownloadProgress);

    return () => {
      dispose?.();
    };
  }, []);

  // UX-36: actionable-notification navigation. When the user clicks the
  // approval-needed toast, the main process brings the window forward and asks
  // us to show the upload queue; the low-Turbo-credits toast asks us to open the
  // top-up flow. Scoped disposer (UX-4) so we never clobber a co-subscriber.
  useEffect(() => {
    const dispose = window.electronAPI.onNavigate?.((target) => {
      if (target === 'upload-queue') {
        setDashboardTab('upload-queue');
      } else if (target === 'top-up') {
        setShowTurboManager(true);
      }
    });
    return () => {
      dispose?.();
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
    // UX-5: hand off to App, which stops the current profile's sync and routes
    // to new-profile onboarding. The old body was window.location.reload(),
    // which re-ran initializeApp against the still-active profile and bounced
    // straight back to this dashboard — the add-profile reload loop.
    onAddProfile?.();
  };

  // Drive switching handler
  // UX-18: `skipConfirm` lets handleRemoveDrive hand off to another mapped
  // drive right after the user already confirmed removing the active one —
  // without this, they'd hit a second "Switch to X?" dialog for a switch
  // they didn't explicitly ask for.
  const handleDriveSwitch = async (driveId: string, skipConfirm = false) => {
    if (driveId === drive?.id || isSwitchingDrive) return;

    // Find the target drive for better confirmation message
    const targetDrive = drives.find(d => d.id === driveId);
    if (!targetDrive) {
      toast?.error('Drive not found');
      return;
    }

    if (!skipConfirm) {
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
    }

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

  // UX-18: remove a drive's LOCAL mapping/sync association from this device.
  // This is not a data-deletion path — the drive and every file on it stay on
  // Arweave permanently; only the local sync-folder link this device holds
  // is deleted (`databaseManager.removeDriveMapping`, a DELETE against
  // `drive_mappings`, main.ts's `drive-mappings:remove` handler).
  const handleRemoveDrive = async (driveId: string) => {
    const targetDrive = drives.find(d => d.id === driveId);
    if (!targetDrive) {
      toast?.error('Drive not found');
      return;
    }

    const isActiveDrive = drive?.id === driveId;

    // Honest, permanence-safe copy (UX-18): never let this read as "delete my
    // files". Arweave data is permanent regardless of what happens here.
    const pendingWarning = isActiveDrive && pendingUploads.length > 0
      ? `You have ${pendingUploads.length} pending upload${pendingUploads.length === 1 ? '' : 's'} for this drive that will be cancelled. `
      : '';
    const removalExplanation = isActiveDrive
      ? `This stops syncing "${targetDrive.name}" on this device and removes its local folder mapping.`
      : `This removes "${targetDrive.name}"'s local folder mapping from this device.`;
    const permanenceNote = `It does NOT delete the drive or any files from Arweave — permaweb data is permanent, so everything you've uploaded stays exactly where it is. You can add this drive back on this device at any time.`;

    const confirmed = await confirm({
      title: `Remove "${targetDrive.name}" from this device?`,
      message: `${pendingWarning}${removalExplanation} ${permanenceNote}`,
      confirmLabel: 'Remove drive',
      cancelLabel: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      // SYNC: if we're removing the drive currently being synced, stop the
      // watcher FIRST so it never outlives the mapping row it's watching for
      // (D-010: only one drive syncs at a time, so "active" == "syncing").
      // A no-op if nothing is running; safe to call even when a subsequent
      // handleDriveSwitch below re-points/restarts it for another drive.
      if (isActiveDrive) {
        const stopResult = await window.electronAPI.sync.stop();
        if (!stopResult.success) {
          console.error('Failed to stop sync before removing drive:', stopResult.error);
        }
      }

      // Resolve the drive's mapping id — `drives` is keyed by ArFS driveId,
      // but `driveMappings.remove` takes the mapping row's own id.
      const mappingsResult = await window.electronAPI.driveMappings.list();
      const mappings: DriveSyncMapping[] = mappingsResult.success ? mappingsResult.data : [];
      const mappingToRemove = mappings.find(m => m.driveId === driveId);
      if (!mappingToRemove) {
        toast?.error('Drive mapping not found');
        return;
      }

      // The existing drive-mappings:remove IPC (D-005 envelope) — the ONLY
      // change here is finally calling it from a product UI.
      const removeResult = await window.electronAPI.driveMappings.remove(mappingToRemove.id);
      if (!removeResult.success) {
        throw new Error(removeResult.error || 'Failed to remove drive');
      }

      // Refresh the drives list with status info (same merge used everywhere
      // else in this component).
      const mappedDrives = extractMappedDrives(await window.electronAPI.drive.getMapped());
      const drivesWithStatus = extractDrivesWithStatus(await window.electronAPI.drive.listWithStatus());
      const mergedDrives = mappedDrives.map((mappedDrive: any) => {
        const driveWithStatus = drivesWithStatus.find((d: DriveInfoWithStatus) => d.id === mappedDrive.id);
        return {
          ...mappedDrive,
          isLocked: driveWithStatus?.isLocked ?? false,
          emojiFingerprint: driveWithStatus?.emojiFingerprint
        };
      });
      setDrives(mergedDrives);

      if (isActiveDrive) {
        if (mergedDrives.length > 0) {
          // Hand off to another mapped drive instead of leaving the
          // dashboard pointed at a mapping that no longer exists. Already
          // confirmed above — skip handleDriveSwitch's own confirm.
          toast?.success(`"${targetDrive.name}" removed from this device. Your files remain on Arweave.`);
          await handleDriveSwitch(mergedDrives[0].id, true);
        } else {
          // Edge case: last/only drive removed — land in drive setup rather
          // than a dashboard with no drive. onDriveDeleted (App.tsx) already
          // shows its own "choose or create a new drive" toast.
          onDriveDeleted();
        }
      } else {
        toast?.success(`"${targetDrive.name}" removed from this device. Your files remain on Arweave.`);
      }
    } catch (error) {
      console.error('Failed to remove drive:', error);
      toast?.error(error instanceof Error ? error.message : 'Failed to remove drive');
    }
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

  // UX-21/UX-22: first-class pause/resume for the continuous sync engine.
  // Reuses the exact SyncManager.stopSync()/startSync() path the UX-30 tray's
  // pause/resume menu item already calls (sync:pause/sync:resume in main.ts
  // just wrap those, plus persisting the choice) — no new sync engine here.
  // Reads/reflects `uploadSyncStatus.isActive`, the same live
  // sync.getStatus() polled state the header indicator already uses, so this
  // button and that indicator can never disagree.
  const handleToggleSync = async () => {
    if (!uploadSyncStatus || isTogglingSync) {
      return;
    }
    const wasActive = uploadSyncStatus.isActive;
    setIsTogglingSync(true);
    try {
      const result = wasActive
        ? await window.electronAPI.sync.pause()
        : await window.electronAPI.sync.resume();
      if (!result.success) {
        toast?.error(`Failed to ${wasActive ? 'pause' : 'resume'} sync: ${result.error}`);
      } else {
        toast?.success(wasActive ? 'Sync paused' : 'Sync resumed');
      }
    } catch (err) {
      console.error('Failed to toggle sync:', err);
      toast?.error('Failed to toggle sync. Please try again.');
    } finally {
      // Re-poll immediately so the button/indicator reflect the new state
      // without waiting for the next 5s background poll.
      await loadSyncIndicatorStatus();
      setIsTogglingSync(false);
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
          // close. This deterministic pull complements App's wallet-info-updated
          // listener (UX-4 made the event clobber-safe: the Turbo manager's
          // cleanup now removes only its own handler), so the queue's blocked
          // rows immediately see the post-top-up balance without a restart.
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
            onRemoveDrive={handleRemoveDrive}
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

          {/* UX-22: pause/resume continuous sync. Disabled until the first
              sync.getStatus() poll resolves (uploadSyncStatus is null) so it
              can't fire against an unknown state. */}
          <button
            className="button"
            onClick={handleToggleSync}
            disabled={!uploadSyncStatus || isTogglingSync}
            title={uploadSyncStatus?.isActive ? 'Pause continuous sync' : 'Resume continuous sync'}
          >
            {uploadSyncStatus?.isActive ? <Pause size={16} /> : <Play size={16} />}
            {uploadSyncStatus?.isActive ? 'Pause' : 'Resume'}
          </button>

          {/* UX-28: persistent global sync indicator — lives in the header
              (outside the per-tab content below) so overall progress is
              visible from every tab, not just the Download Queue tab's badge. */}
          {syncIndicatorSnapshot && <SyncIndicator snapshot={syncIndicatorSnapshot} />}
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
          onProfileSwitch={() => {
            setShowProfileSwitcher(false);
            // UX-5: the main process has switched the active profile (old sync
            // stopped, wallet/keys/DB cleared). Tell App to fully reload the
            // renderer for the new profile so no stale data from the old one
            // remains. (Previously this was a no-op with a comment claiming the
            // main process reloads the app — it does not.)
            onProfileSwitched?.();
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