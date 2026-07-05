import React, { useState, useEffect } from 'react';
import { AppConfig, DriveInfo, DriveInfoWithStatus, WalletInfo, SyncStatus, FileUpload, Profile, SyncProgress } from '../types';
import WalletSetup from './components/WalletSetup';
import DriveAndSyncSetup from './components/DriveAndSyncSetup';
import SyncFolderSetup from './components/SyncFolderSetup';
import WelcomeBackScreen from './components/WelcomeBackScreen';
import ProfileManagement from './components/ProfileManagement';
import Dashboard from './components/Dashboard';
import { PrivateDriveUnlockModal } from './components/PrivateDriveUnlockModal';
import ToastContainer from './components/ToastContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useToast } from './hooks/useToast';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Simple app states
// UX-7: 'boot-error' is a fail-safe landing spot for an EXISTING profile whose
// boot sequence failed (thrown exception or a failed drive fetch) — distinct
// from 'wallet-setup'/'drive-setup', which are reserved for a confirmed brand
// new account / a confirmed-empty (successful fetch, zero drives) result.
type AppState = 'loading' | 'profile-management' | 'wallet-setup' | 'drive-setup' | 'sync-setup' | 'welcome-back' | 'dashboard' | 'boot-error';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [drives, setDrives] = useState<DriveInfoWithStatus[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [selectedPrivateDrive, setSelectedPrivateDrive] = useState<DriveInfo | null>(null);
  const [showPrivateDriveUnlock, setShowPrivateDriveUnlock] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const { toasts, toast, removeToast } = useToast();

  useEffect(() => {
    initializeApp();
    
    // Listen for wallet info updates from main process
    const handleWalletInfoUpdate = (newWalletInfo: WalletInfo) => {
      console.log('Received wallet info update:', newWalletInfo);
      setWalletInfo(newWalletInfo);
    };
    
    window.electronAPI.onWalletInfoUpdated(handleWalletInfoUpdate);
    
    return () => {
      window.electronAPI.removeWalletInfoUpdatedListener();
      window.electronAPI.removeSyncProgressListener();
    };
  }, []);

  // MONEY-6: pull-based wallet refresh using the IPC RETURN VALUE, not the
  // wallet-info-updated event. The event path is dead after the first
  // TurboCreditsManager unmount (its cleanup calls the preload's global
  // removeAllListeners('wallet-info-updated'), killing this component's
  // listener for the session — UX-4 owns the root fix). Dashboard calls this
  // when the Turbo manager closes so blocked queue rows see the post-top-up
  // balance.
  const refreshWalletInfo = async () => {
    try {
      const freshWalletInfoResult = await window.electronAPI.wallet.getInfo(true);
      // Guard: never clear walletInfo on a null/failed fetch — App only
      // renders the dashboard while walletInfo is set.
      if (freshWalletInfoResult.success && freshWalletInfoResult.data) {
        setWalletInfo(freshWalletInfoResult.data);
      }
    } catch (error) {
      console.error('Failed to refresh wallet info:', error);
    }
  };

  const initializeApp = async () => {
    console.log('🔴 [RENDERER] initializeApp called at:', new Date().toISOString());
    // UX-7: once we've confirmed this is an existing profile with a stored
    // wallet (below), a failure anywhere past that point — a thrown
    // exception or a failed drive fetch — is a boot problem, not evidence of
    // a fresh/empty account. Route those to the fail-safe error+retry screen
    // instead of wallet-setup/create-drive, which must stay reserved for a
    // genuinely-new profile or a confirmed-empty (successful fetch, zero
    // drives) result. An offline existing user must never see
    // "Create New Account".
    let existingProfileConfirmed = false;
    try {
      // Load config (UX-3: IpcResult envelope)
      const appConfigResult = await window.electronAPI.config.get();
      if (appConfigResult.success) {
        setConfig(appConfigResult.data);
      }

      // Check if we have any profiles first (UX-3: unwrap envelope)
      const profilesResult = await window.electronAPI.profiles.list();
      const profiles = profilesResult.success ? profilesResult.data : [];
      if (!profiles || profiles.length === 0) {
        setAppState('wallet-setup');
        return;
      }

      // Check if there's an active profile with a loaded wallet (UX-3: unwrap
      // envelope — the result wrapper is always truthy, so a raw `!result`
      // guard would be silently wrong).
      const activeProfileResult = await window.electronAPI.profile.getActive();
      const activeProfile = activeProfileResult.success ? activeProfileResult.data : null;
      const hasWalletResult = await window.electronAPI.wallet.hasStoredWallet();
      const hasWallet = hasWalletResult.success && hasWalletResult.data;

      if (!activeProfile || !hasWallet) {
        setAppState('profile-management');
        return;
      }

      existingProfileConfirmed = true;

      // Load wallet info and profile (UX-3: unwrap envelopes)
      const [walletResult, profileResult] = await Promise.all([
        window.electronAPI.wallet.getInfo(),
        window.electronAPI.profile.getActive()
      ]);
      const wallet = walletResult.success ? walletResult.data : null;
      const profile = profileResult.success ? profileResult.data : null;

      if (!wallet || !profile) {
        // An existing profile's wallet failed to load — not a reason to
        // offer account creation. Surface it as a retryable boot failure.
        setBootError('Could not load your wallet. Check your connection and try again.');
        setAppState('boot-error');
        return;
      }

      setWalletInfo(wallet);
      
      // Fetch ArNS data for the profile
      try {
        const arnsResult = await window.electronAPI.arns.getProfile(profile.address);
        const arnsProfile = arnsResult.success ? arnsResult.data : null;
        console.log('ArNS profile data:', arnsProfile);
        if (arnsProfile) {
          const enrichedProfile = {
            ...profile,
            arnsName: arnsProfile.name ?? undefined,
            avatarUrl: arnsProfile.avatar ?? undefined  // Fixed: was avatarUrl, should be avatar
          };
          setCurrentProfile(enrichedProfile);
        } else {
          setCurrentProfile(profile);
        }
      } catch (error) {
        console.error('Failed to fetch ArNS profile:', error);
        setCurrentProfile(profile);
      }

      // Check if drive exists
      const driveListResult = await window.electronAPI.drive.listWithStatus();
      console.log('[initializeApp] Raw drive list result:', driveListResult);

      // Extract drives from result. UX-7: distinguish a fetch FAILURE
      // (envelope success:false, or no result at all) from a confirmed-empty
      // successful fetch — only the latter may route to drive creation. A
      // network/gateway error must never be silently treated as "0 drives".
      let driveList: DriveInfoWithStatus[] = [];
      let driveFetchFailed = false;
      if (!driveListResult) {
        driveFetchFailed = true;
      } else if (driveListResult.success === false) {
        driveFetchFailed = true;
      } else if (driveListResult.success && driveListResult.data) {
        driveList = driveListResult.data;
      } else if (Array.isArray(driveListResult)) {
        driveList = driveListResult;
      }
      console.log('[initializeApp] Extracted drive list:', driveList, 'failed:', driveFetchFailed);

      if (driveFetchFailed) {
        setBootError('Could not load your drives. Check your connection and try again.');
        setAppState('boot-error');
        return;
      }

      // UX-19: populate drive state here so every downstream branch (welcome-back
      // for a locked primary private drive, welcome-back for all-private drives,
      // and the eventual dashboard) has the real drive list. Previously only
      // handleWalletImported() called setDrives(), so a returning user routed to
      // 'welcome-back' from this function saw `drives` still stuck at its
      // initial [] — a false "No drives found" state.
      setDrives(driveList);

      if (!driveList || driveList.length === 0) {
        // Confirmed empty: the fetch succeeded and there are genuinely no
        // drives yet. Only now is routing into drive creation correct.
        setAppState('drive-setup');
        return;
      }

      // Get the active drive based on drive mappings
      let activeDrive: DriveInfo | null = null;
      
      // Try to get the primary drive mapping (UX-3: unwrap the IpcResult envelope)
      const primaryMappingResult = await window.electronAPI.driveMappings.getPrimary();
      if (!primaryMappingResult.success) {
        throw new Error(primaryMappingResult.error || 'Failed to load primary drive mapping');
      }
      const primaryMapping = primaryMappingResult.data;
      console.log('Primary drive mapping:', primaryMapping);

      // Also log all drive mappings to debug
      const allMappingsResult = await window.electronAPI.driveMappings.list();
      const allMappings = allMappingsResult.success ? allMappingsResult.data : [];
      console.log('All drive mappings:', allMappings);
      
      if (primaryMapping) {
        // Find the drive that matches the primary mapping (can be public or unlocked private)
        activeDrive = driveList.find((d: DriveInfoWithStatus) => d.id === primaryMapping.driveId) || null;
        console.log('Found matching drive:', activeDrive);
        
        // Check if it's a locked private drive
        if (activeDrive && activeDrive.privacy === 'private') {
          const isUnlockedResult = await window.electronAPI.drive.isUnlocked(activeDrive.id);
          const isUnlocked = isUnlockedResult.success && isUnlockedResult.data;
          if (!isUnlocked) {
            console.log('Primary drive is private and locked, showing welcome back screen');
            setIsReturningUser(true);
            setAppState('welcome-back');
            return;
          }
        }
      }
      
      // If no primary mapping or drive not found, try to find a suitable drive
      if (!activeDrive) {
        // First try to find an unlocked drive (public or unlocked private)
        const publicDrives = driveList.filter((d: DriveInfoWithStatus) => d.privacy === 'public');
        
        if (publicDrives.length > 0) {
          console.log('No active drive found, using first public drive');
          activeDrive = publicDrives[0];
        } else {
          // All drives are private - show welcome back screen
          console.log('Only private drives available, showing welcome back screen');
          setIsReturningUser(true);
          setAppState('welcome-back');
          return;
        }
      }
      
      console.log('Setting active drive:', activeDrive);
      setDrive(activeDrive);

      // Check if sync folder is configured (UX-3: unwrap the IpcResult envelope;
      // the wrapper object is always truthy, so read `.data` before the guard)
      const syncFolderResult = await window.electronAPI.sync.getFolder();
      if (!syncFolderResult.success) {
        throw new Error(syncFolderResult.error || 'Failed to read sync folder');
      }
      const syncFolder = syncFolderResult.data;
      if (!syncFolder) {
        setAppState('drive-setup');
        return;
      }

      // Load uploads data
      try {
        const uploadResult = await window.electronAPI.files.getUploads();
        const uploadData = uploadResult.success ? uploadResult.data : [];
        console.log('Loaded uploads data:', uploadData);
        setUploads(uploadData || []);
      } catch (error) {
        console.error('Failed to load uploads:', error);
        setUploads([]);
      }

      // All setup complete, go to dashboard
      setAppState('dashboard');
      
      // Start monitoring sync status
      startSyncMonitoring();
      
      // Start the sync process
      console.log('Starting sync after initialization...');
      try {
        await window.electronAPI.sync.start();
        console.log('Sync started successfully');
      } catch (syncError) {
        console.error('Failed to start sync:', syncError);
        // Don't show error - sync might already be running
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
      // UX-7: only a brand-new/unconfirmed profile may fall back to
      // wallet-setup. Once we know an existing profile+wallet were already
      // set up, any boot exception (offline, transient fetch failure, etc.)
      // must land on the fail-safe error+retry screen instead — never on
      // "Create New Account".
      if (existingProfileConfirmed) {
        setBootError(error instanceof Error ? error.message : 'Failed to load your account. Check your connection and try again.');
        setAppState('boot-error');
      } else {
        toast.error('Failed to initialize app');
        setAppState('wallet-setup');
      }
    }
  };

  const startSyncMonitoring = () => {
    console.log('🔴 [RENDERER] startSyncMonitoring called at:', new Date().toISOString());
    
    // Listen for sync status updates
    window.electronAPI.onSyncStatusUpdate((status) => {
      setSyncStatus(status);
    });

    // Listen for sync progress updates
    window.electronAPI.onSyncProgress((progress) => {
      console.log('🔴 [RENDERER] Received sync progress:', {
        phase: progress.phase,
        description: progress.description,
        timestamp: new Date().toISOString(),
        currentSyncProgress: syncProgress
      });
      // Only set progress if it's not a duplicate complete phase
      if (progress.phase === 'complete') {
        // Set progress briefly to show completion, then clear
        setSyncProgress(progress);
        setTimeout(() => setSyncProgress(null), 2000);
      } else {
        setSyncProgress(progress);
      }
    });

    // Listen for upload updates
    window.electronAPI.onUploadProgress(async (progressData) => {
      console.log('Upload progress update:', progressData);
      
      // Update existing upload in state
      setUploads(prev => {
        const index = prev.findIndex(u => u.id === progressData.uploadId);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: progressData.status, progress: progressData.progress };
          return updated;
        }
        return prev;
      });
      
      // If upload completed, refresh the full list to get all metadata
      if (progressData.status === 'completed') {
        console.log('Upload completed, refreshing upload list');
        try {
          const uploadResult = await window.electronAPI.files.getUploads();
          const uploadData = uploadResult.success ? uploadResult.data : [];
          console.log('Refreshed uploads after completion:', uploadData?.length || 0);
          setUploads(uploadData || []);
        } catch (error) {
          console.error('Failed to refresh uploads after completion:', error);
        }
      }
    });

    // Listen for drive updates
    window.electronAPI.onDriveUpdate(async () => {
      const drivesResult = await window.electronAPI.drive.listWithStatus();

      // Extract drives from result (UX-3: IpcResult envelope)
      let drivesList: DriveInfoWithStatus[] = [];
      if (drivesResult && drivesResult.success && drivesResult.data) {
        drivesList = drivesResult.data;
      }
      
      if (drivesList && drivesList.length > 0) {
        setDrive(drivesList[0]);
        setDrives(drivesList);
      }
      
      // Also refresh uploads when drive updates (includes after file uploads)
      try {
        const uploadResult = await window.electronAPI.files.getUploads();
        const uploadData = uploadResult.success ? uploadResult.data : [];
        console.log('Refreshed uploads after drive update:', uploadData?.length || 0);
        setUploads(uploadData || []);
      } catch (error) {
        console.error('Failed to refresh uploads after drive update:', error);
      }
    });
  };

  const handleWalletImported = async () => {
    // Navigate immediately to improve perceived performance
    setIsReturningUser(true);
    setAppState('welcome-back');
    
    // Load critical data (drives) and basic profile in parallel
    try {
      const [walletResult, profileResult, driveListResult] = await Promise.all([
        window.electronAPI.wallet.getInfo(),
        window.electronAPI.profile.getActive(),
        window.electronAPI.drive.listWithStatus()
      ]);
      // UX-3: unwrap the wallet/profile envelopes.
      const wallet = walletResult.success ? walletResult.data : null;
      const profile = profileResult.success ? profileResult.data : null;

      console.log('[handleWalletImported] Raw drive list result:', driveListResult);

      // SYNC-20 / UX-7: a transient gateway failure must NEVER be mistaken for
      // "0 drives". The drive-list IPC now retries transient 404s in the main
      // process, but if it STILL fails we must route to the retryable
      // boot-error screen — not silently drop an existing (multi-drive) wallet
      // into create-drive. Track whether the fetch actually SUCCEEDED (empty
      // list is a valid success) vs. failed.
      let driveList: DriveInfoWithStatus[] = [];
      let driveFetchSucceeded = false;
      if (driveListResult && driveListResult.success) {
        driveFetchSucceeded = true;
        if (driveListResult.data) {
          driveList = driveListResult.data;
        }
      } else {
        console.error('[handleWalletImported] Failed to list drives:', driveListResult?.error);
      }

      // If the status fetch didn't yield drives, try the base drive.list()
      // fallback (no lock status; downstream treats a missing isLocked as
      // unlocked). A success here — even empty — confirms the fetch worked.
      if (!driveFetchSucceeded || driveList.length === 0) {
        try {
          console.log('[handleWalletImported] Trying fallback to regular drive.list()');
          const fallbackDrives = await window.electronAPI.drive.list();
          console.log('[handleWalletImported] Fallback drives:', fallbackDrives);
          if (fallbackDrives && fallbackDrives.success) {
            driveFetchSucceeded = true;
            if (fallbackDrives.data) {
              driveList = fallbackDrives.data as DriveInfoWithStatus[];
            }
          } else {
            console.error('[handleWalletImported] Fallback failed:', fallbackDrives?.error);
          }
        } catch (fallbackError) {
          console.error('[handleWalletImported] Fallback also failed:', fallbackError);
        }
      }

      console.log('[handleWalletImported] Final drive list:', driveList, 'fetchSucceeded:', driveFetchSucceeded);
      console.log('[handleWalletImported] Drive count:', driveList.length);

      if (wallet) {
        setWalletInfo(wallet);
      }

      if (profile) {
        // Set basic profile immediately
        setCurrentProfile(profile);

        // Load ArNS data in background (non-blocking)
        loadArnsProfileInBackground(profile);
      }

      // SYNC-20: fetch FAILED (transient gateway, still failing after main-process
      // retries) — land on the retryable boot-error screen instead of trapping
      // the user or masquerading as a new/empty account.
      if (!driveFetchSucceeded) {
        console.error('[handleWalletImported] Drive fetch failed — routing to boot-error');
        setBootError("Couldn't reach the Arweave gateway. Check your connection or try a different gateway in Settings, then retry.");
        setAppState('boot-error');
        return;
      }

      // Pass ALL drives to the component - let it handle filtering
      setDrives(driveList);

      // Confirmed empty (fetch succeeded, genuinely no drives) → create a drive.
      if (driveList.length === 0) {
        console.log('[handleWalletImported] No drives found, navigating to drive-setup');
        setAppState('drive-setup');
      } else {
        console.log('[handleWalletImported] Found drives, staying on welcome-back screen');
      }
    } catch (error) {
      console.error('[handleWalletImported] Error during initial load:', error);
      // SYNC-20: an unexpected throw here (e.g. wallet/profile IPC) must also
      // land somewhere recoverable rather than leaving the welcome-back screen
      // stuck loading with no way out.
      setBootError("Couldn't load your account. Check your connection and try again.");
      setAppState('boot-error');
    }
  };
  
  const loadArnsProfileInBackground = async (profile: Profile) => {
    try {
      const arnsResult = await window.electronAPI.arns.getProfile(profile.address);
      const arnsProfile = arnsResult.success ? arnsResult.data : null;
      console.log('ArNS profile data loaded:', arnsProfile);
      if (arnsProfile) {
        const enrichedProfile = {
          ...profile,
          arnsName: arnsProfile.name ?? undefined,
          avatarUrl: arnsProfile.avatar ?? undefined
        };
        setCurrentProfile(enrichedProfile);
      }
    } catch (error) {
      console.error('Failed to fetch ArNS profile:', error);
      // Silent failure - ArNS data is non-critical
    }
  };

  const handleDriveSelectedFromWelcomeBack = async (selectedDrive: DriveInfo) => {
    console.log('Drive selected from welcome back screen:', selectedDrive);
    try {
      // Check if this is a private drive that needs to be unlocked
      if (selectedDrive.privacy === 'private') {
        console.log('Private drive selected, checking if it needs unlock');
        
        // Check if the drive is already unlocked
        const isUnlockedResult = await window.electronAPI.drive.isUnlocked(selectedDrive.id);
        const isUnlocked = isUnlockedResult.success && isUnlockedResult.data;
        console.log('Drive unlock status:', isUnlocked);

        if (!isUnlocked) {
          console.log('Private drive is locked, showing unlock modal');
          // Store the selected drive and show unlock modal
          setSelectedPrivateDrive(selectedDrive);
          setShowPrivateDriveUnlock(true);
          return; // Don't proceed until unlocked
        }
      }
      
      // Select the drive and set it up for syncing
      const selectResult = await window.electronAPI.drive.select(selectedDrive.id);
      if (!selectResult.success) {
        throw new Error(selectResult.error || 'Failed to select drive');
      }
      setDrive(selectedDrive);
      
      // Check if a drive mapping exists for this drive (UX-3: unwrap envelope)
      const driveMappingsResult = await window.electronAPI.driveMappings.list();
      if (!driveMappingsResult.success) {
        throw new Error(driveMappingsResult.error || 'Failed to load drive mappings');
      }
      const driveMappings = driveMappingsResult.data;
      console.log('Current drive mappings before selection:', driveMappings);
      const existingMapping = driveMappings.find((m: any) => m.driveId === selectedDrive.id);
      console.log('Found existing mapping for selected drive:', existingMapping);
      
      if (!existingMapping) {
        // No mapping exists, need to set up sync folder
        console.log('No mapping exists for drive, going to sync setup');
        setAppState('sync-setup');
      } else {
        // Ensure this mapping is marked as active
        if (!existingMapping.isActive) {
          console.log('Marking mapping as active for drive:', selectedDrive.name);
          // Mark all other mappings as inactive first
          for (const mapping of driveMappings) {
            if (mapping.id !== existingMapping.id && mapping.isActive) {
              console.log('Deactivating mapping:', mapping);
              await window.electronAPI.driveMappings.update(mapping.id, { isActive: false });
            }
          }
          // Mark selected mapping as active
          await window.electronAPI.driveMappings.update(existingMapping.id, { isActive: true });
          console.log('Updated mapping to active:', existingMapping.id);
        }
        
        // Everything is configured, go to dashboard
        console.log('Reinitializing app with selected drive');
        await initializeApp();
      }
    } catch (error) {
      console.error('Error selecting drive:', error);
      toast.error('Failed to select drive');
    }
  };

  const handleSkipSetup = async () => {
    // Skip setup and go directly to dashboard
    // Mark first run as complete so we don't show onboarding again
    try {
      await window.electronAPI.config.markFirstRunComplete();
      await initializeApp();
    } catch (error) {
      console.error('Error skipping setup:', error);
      toast.error('Failed to skip setup');
    }
  };

  const handleDriveSetupComplete = async () => {
    // Drive setup complete, go to dashboard
    await initializeApp();
  };

  // UX-7: retry from the fail-safe boot-error screen — re-run the same boot
  // sequence rather than routing anywhere destructive.
  const handleRetryBoot = async () => {
    setBootError(null);
    setAppState('loading');
    await initializeApp();
  };

  const handleLogout = async () => {
    try {
      await window.electronAPI.wallet.logout();
      setWalletInfo(null);
      setCurrentProfile(null);
      setDrive(null);
      setSyncStatus(null);
      setUploads([]);
      
      // Check if we have multiple profiles to show profile management (UX-3: unwrap)
      const profilesResult = await window.electronAPI.profiles.list();
      const profiles = profilesResult.success ? profilesResult.data : [];
      if (profiles && profiles.length > 0) {
        setAppState('profile-management');
      } else {
        setAppState('wallet-setup');
      }
    } catch (error) {
      console.error('Failed to logout:', error);
      toast.error('Failed to logout');
    }
  };

  const handleDriveDeleted = async () => {
    // Drive was deleted, need to set up a new one
    toast.info('Drive removed — choose or create a new drive');
    setDrive(null);
    setAppState('drive-setup');
  };

  const handleProfileSelected = async (profile: Profile, password: string) => {
    try {
      // Profile is already switched via the ProfileManagement component
      // Just need to load the app state
      await initializeApp();
    } catch (error) {
      console.error('Failed to initialize app after profile selection:', error);
      toast.error('Failed to load profile');
    }
  };

  const handleCreateNewProfile = () => {
    setAppState('wallet-setup');
  };

  const handlePrivateDriveUnlock = async (password: string, persistKey: boolean): Promise<{ success: boolean; error?: string }> => {
    if (!selectedPrivateDrive) return { success: false, error: 'No drive selected.' };

    try {
      console.log('Attempting to unlock private drive:', selectedPrivateDrive.name);
      // PRIV-4: forward the "remember this drive" choice so the key is persisted (encrypted).
      const result = await window.electronAPI.drive.unlock(selectedPrivateDrive.id, password, persistKey);

      if (result && result.success) {
        console.log('Private drive unlocked successfully');

        // Update the drive with decrypted info if provided (envelope `data`)
        let updatedDrive: DriveInfoWithStatus = selectedPrivateDrive as DriveInfoWithStatus;
        if (result.data) {
          console.log('Drive decrypted - actual name:', result.data.name);
          // Merge the decrypted info with existing DriveInfoWithStatus properties
          updatedDrive = {
            ...selectedPrivateDrive,
            ...result.data,
            isLocked: false, // Drive is now unlocked
            emojiFingerprint: (selectedPrivateDrive as DriveInfoWithStatus).emojiFingerprint
          };
          
          // Update the drives list with the decrypted drive info
          setDrives(prevDrives => 
            prevDrives.map(d => d.id === updatedDrive.id ? (updatedDrive as DriveInfoWithStatus) : d)
          );
          
          // Update the selected drive with decrypted info
          setSelectedPrivateDrive(updatedDrive);
        }
        
        setShowPrivateDriveUnlock(false);
        
        // Continue to sync folder setup directly (skip redundant unlock check)
        const selectResult = await window.electronAPI.drive.select(updatedDrive.id);
        if (!selectResult.success) {
          throw new Error(selectResult.error || 'Failed to select drive');
        }
        setDrive(updatedDrive);
        
        // Check if a drive mapping exists for this drive (UX-3: unwrap envelope)
        const driveMappingsResult = await window.electronAPI.driveMappings.list();
        if (!driveMappingsResult.success) {
          throw new Error(driveMappingsResult.error || 'Failed to load drive mappings');
        }
        const driveMappings = driveMappingsResult.data;
        const existingMapping = driveMappings.find((m: any) => m.driveId === updatedDrive.id);
        
        if (!existingMapping) {
          // No mapping exists, need to set up sync folder
          console.log('No mapping exists for drive, going to sync setup');
          setAppState('sync-setup');
        } else {
          // Ensure this mapping is marked as active
          if (!existingMapping.isActive) {
            // Mark all other mappings as inactive first
            for (const mapping of driveMappings) {
              if (mapping.id !== existingMapping.id && mapping.isActive) {
                await window.electronAPI.driveMappings.update(mapping.id, { isActive: false });
              }
            }
            // Mark selected mapping as active
            await window.electronAPI.driveMappings.update(existingMapping.id, { isActive: true });
          }
          
          // Everything is configured, go to dashboard
          console.log('Drive already configured, going to dashboard with drive:', updatedDrive.name);
          // Don't call initializeApp as it might load a different drive
          // Just set the necessary state and go to dashboard
          setAppState('dashboard');
          
          // Start monitoring sync status
          startSyncMonitoring();
          
          // Start the actual sync process for the private drive
          console.log('Starting sync for private drive...');
          try {
            await window.electronAPI.sync.start();
            console.log('Sync started successfully for private drive');
          } catch (syncError) {
            console.error('Failed to start sync for private drive:', syncError);
          }
        }
        
        return { success: true };
      } else {
        // UX-3: surface the SPECIFIC unlock error (wrong password vs.
        // network/gateway verification failure) so the modal can show it
        // instead of a hardcoded 'Invalid password'.
        const error = result && !result.success ? result.error : undefined;
        console.error('Failed to unlock drive:', error);
        return { success: false, error };
      }
    } catch (error) {
      console.error('Error unlocking drive:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unlock drive. Please try again.',
      };
    }
  };

  // Render based on app state
  const renderContent = () => {
    switch (appState) {
      case 'loading':
        return (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100vh',
            flexDirection: 'column',
            gap: 'var(--space-4)'
          }}>
            <div style={{ 
              width: '48px', 
              height: '48px', 
              border: '4px solid var(--gray-200)',
              borderTop: '4px solid var(--ardrive-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <p style={{ color: 'var(--gray-600)' }}>Loading ArDrive...</p>
          </div>
        );

      case 'boot-error':
        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            padding: 'var(--space-4)',
            textAlign: 'center'
          }}>
            <AlertTriangle size={48} color="var(--gray-600)" />
            <p style={{ color: 'var(--gray-900)', fontWeight: 600, maxWidth: '360px' }}>
              We couldn&apos;t load your account
            </p>
            <p style={{ color: 'var(--gray-600)', maxWidth: '360px' }}>
              {bootError || 'Check your connection and try again.'}
            </p>
            <button
              onClick={handleRetryBoot}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                background: 'var(--ardrive-primary)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </div>
        );

      case 'profile-management':
        return (
          <ProfileManagement 
            onProfileSelected={handleProfileSelected}
            onCreateNewProfile={handleCreateNewProfile}
          />
        );

      case 'wallet-setup':
        return <WalletSetup onWalletImported={handleWalletImported} />;

      case 'drive-setup':
        return (
          <DriveAndSyncSetup 
            currentProfile={currentProfile}
            onSetupComplete={handleDriveSetupComplete}
            isReturningUser={isReturningUser}
            onBack={isReturningUser ? () => setAppState('welcome-back') : undefined}
          />
        );

      case 'welcome-back':
        return (
          <WelcomeBackScreen
            currentProfile={currentProfile}
            initialDrives={drives}
            onDriveSelected={handleDriveSelectedFromWelcomeBack}
            onCreateNewDrive={() => {
              setIsReturningUser(true);
              setAppState('drive-setup');
            }}
            onSkipSetup={handleSkipSetup}
            onBack={() => {
              // Go back to profile selection if multiple profiles exist (UX-3: unwrap)
              window.electronAPI.profiles.list().then(profilesResult => {
                const profiles = profilesResult.success ? profilesResult.data : [];
                if (profiles && profiles.length > 1) {
                  setAppState('profile-management');
                } else {
                  setAppState('wallet-setup');
                }
              });
            }}
            onProfileLoaded={(profile) => {
              console.log('Profile fully loaded in welcome back:', profile);
            }}
          />
        );

      case 'sync-setup':
        return drive ? (
          <SyncFolderSetup 
            drive={drive} 
            onSetupComplete={handleDriveSetupComplete}
            onBack={() => setAppState('welcome-back')}
            onSkipSetup={handleSkipSetup}
          />
        ) : (
          <DriveAndSyncSetup onSetupComplete={handleDriveSetupComplete} />
        );

      case 'dashboard':
        return walletInfo && currentProfile && drive ? (
          <Dashboard
            config={config!}
            walletInfo={walletInfo}
            currentProfile={currentProfile}
            drive={drive}
            syncStatus={syncStatus}
            syncProgress={syncProgress}
            uploads={uploads}
            toast={toast}
            onLogout={handleLogout}
            onDriveDeleted={handleDriveDeleted}
            onSyncProgressClear={() => setSyncProgress(null)}
            onRefreshWalletInfo={refreshWalletInfo}
            onRefreshUploads={async () => {
              try {
                const uploadResult = await window.electronAPI.files.getUploads();
                const uploadData = uploadResult.success ? uploadResult.data : [];
                console.log('Refreshed uploads data:', uploadData);
                setUploads(uploadData || []);
              } catch (error) {
                console.error('Failed to refresh uploads:', error);
              }
            }}
          />
        ) : (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100vh',
            flexDirection: 'column',
            gap: 'var(--space-4)'
          }}>
            <div style={{ 
              width: '48px', 
              height: '48px', 
              border: '4px solid var(--gray-200)',
              borderTop: '4px solid var(--ardrive-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <p style={{ color: 'var(--gray-600)' }}>Loading...</p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <ErrorBoundary>
      <div className="app-container">
        {renderContent()}
        <ToastContainer toasts={toasts} onClose={removeToast} />
        
        {/* Private Drive Unlock Modal */}
        {selectedPrivateDrive && (
          <PrivateDriveUnlockModal
            drive={selectedPrivateDrive as DriveInfoWithStatus}
            isOpen={showPrivateDriveUnlock}
            onUnlock={handlePrivateDriveUnlock}
            onCancel={() => {
              setShowPrivateDriveUnlock(false);
              setSelectedPrivateDrive(null);
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;