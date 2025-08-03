import React, { useState, useEffect } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, Profile, SyncProgress } from '../types';
import WalletSetup from './components/WalletSetup';
import DriveAndSyncSetup from './components/DriveAndSyncSetup';
import SyncFolderSetup from './components/SyncFolderSetup';
import WelcomeBackScreen from './components/WelcomeBackScreen';
import ProfileManagement from './components/ProfileManagement';
import Dashboard from './components/Dashboard';
import ToastContainer from './components/ToastContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useToast } from './hooks/useToast';

// Simple app states
type AppState = 'loading' | 'profile-management' | 'wallet-setup' | 'drive-setup' | 'sync-setup' | 'welcome-back' | 'dashboard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
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

  const initializeApp = async () => {
    console.log('🔴 [RENDERER] initializeApp called at:', new Date().toISOString());
    try {
      // Load config
      const appConfig = await window.electronAPI.config.get();
      setConfig(appConfig);

      // Check if we have any profiles first
      const profiles = await window.electronAPI.profiles.list();
      if (!profiles || profiles.length === 0) {
        setAppState('wallet-setup');
        return;
      }

      // Check if there's an active profile with a loaded wallet
      const activeProfile = await window.electronAPI.profile.getActive();
      const hasWallet = await window.electronAPI.wallet.hasStoredWallet();
      
      if (!activeProfile || !hasWallet) {
        setAppState('profile-management');
        return;
      }

      // Load wallet info and profile
      const [wallet, profile] = await Promise.all([
        window.electronAPI.wallet.getInfo(),
        window.electronAPI.profile.getActive()
      ]);

      if (!wallet || !profile) {
        setAppState('wallet-setup');
        return;
      }

      setWalletInfo(wallet);
      
      // Fetch ArNS data for the profile
      try {
        const arnsProfile = await window.electronAPI.arns.getProfile(profile.address);
        console.log('ArNS profile data:', arnsProfile);
        if (arnsProfile) {
          const enrichedProfile = {
            ...profile,
            arnsName: arnsProfile.name,
            avatarUrl: arnsProfile.avatar  // Fixed: was avatarUrl, should be avatar
          };
          setCurrentProfile(enrichedProfile);
        } else {
          setCurrentProfile(profile);
        }
      } catch (error) {
        console.error('Failed to fetch ArNS profile:', error);
        setCurrentProfile(profile);
      }

      // Check if drive exists (only public drives are supported)
      const driveList = await window.electronAPI.drive.list();
      const publicDrives = (driveList || []).filter((drive: DriveInfo) => 
        drive.privacy === 'public' && !drive.isPrivate
      );
      
      if (!publicDrives || publicDrives.length === 0) {
        // Check if user has any drives at all (including private ones)
        if (driveList && driveList.length > 0) {
          // User has drives, but they're all private - show welcome back screen
          setIsReturningUser(true);
          setAppState('welcome-back');
        } else {
          // No drives at all - go to drive setup
          setAppState('drive-setup');
        }
        return;
      }

      // Get the active drive based on drive mappings
      let activeDrive: DriveInfo | null = null;
      
      // Try to get the primary drive mapping
      const primaryMapping = await window.electronAPI.driveMappings.getPrimary();
      console.log('Primary drive mapping:', primaryMapping);
      console.log('Available public drives:', publicDrives.map((d: DriveInfo) => ({ id: d.id, name: d.name })));
      
      // Also log all drive mappings to debug
      const allMappings = await window.electronAPI.driveMappings.list();
      console.log('All drive mappings:', allMappings);
      
      if (primaryMapping) {
        // Find the drive that matches the primary mapping (must be public)
        activeDrive = publicDrives.find((d: DriveInfo) => d.id === primaryMapping.driveId) || null;
        console.log('Found matching drive:', activeDrive);
        
        if (!activeDrive) {
          console.error('Drive mapping points to driveId that does not exist in public drive list!', {
            mappingDriveId: primaryMapping.driveId,
            mappingDriveName: primaryMapping.driveName,
            availablePublicDriveIds: publicDrives.map((d: DriveInfo) => d.id)
          });
        }
      }
      
      // If no primary mapping or drive not found, fall back to first public drive
      if (!activeDrive) {
        console.log('No active drive found, using first public drive');
        activeDrive = publicDrives[0];
      }
      
      console.log('Setting active drive:', activeDrive);
      setDrive(activeDrive);

      // Check if sync folder is configured
      const syncFolder = await window.electronAPI.sync.getFolder();
      if (!syncFolder) {
        setAppState('drive-setup');
        return;
      }

      // Load uploads data
      try {
        const uploadData = await window.electronAPI.files.getUploads();
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
    } catch (error) {
      console.error('Failed to initialize app:', error);
      toast.error('Failed to initialize app');
      setAppState('wallet-setup');
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
          const uploadData = await window.electronAPI.files.getUploads();
          console.log('Refreshed uploads after completion:', uploadData?.length || 0);
          setUploads(uploadData || []);
        } catch (error) {
          console.error('Failed to refresh uploads after completion:', error);
        }
      }
    });

    // Listen for drive updates
    window.electronAPI.onDriveUpdate(async () => {
      const drives = await window.electronAPI.drive.list();
      if (drives && drives.length > 0) {
        setDrive(drives[0]);
      }
      
      // Also refresh uploads when drive updates (includes after file uploads)
      try {
        const uploadData = await window.electronAPI.files.getUploads();
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
      const [wallet, profile, driveList] = await Promise.all([
        window.electronAPI.wallet.getInfo(),
        window.electronAPI.profile.getActive(),
        window.electronAPI.drive.list()
      ]);
      
      if (wallet) {
        setWalletInfo(wallet);
      }
      
      if (profile) {
        // Set basic profile immediately
        setCurrentProfile(profile);
        
        // Load ArNS data in background (non-blocking)
        loadArnsProfileInBackground(profile);
      }
      
      // Pass ALL drives to the component - let it handle filtering
      setDrives(driveList || []);
      
      // If no drives at all, navigate to drive setup
      if (!driveList || driveList.length === 0) {
        setAppState('drive-setup');
      }
    } catch (error) {
      console.error('Error during initial load:', error);
      toast.error('Failed to load data');
      // Stay on welcome back screen - it will show an error state
    }
  };
  
  const loadArnsProfileInBackground = async (profile: Profile) => {
    try {
      const arnsProfile = await window.electronAPI.arns.getProfile(profile.address);
      console.log('ArNS profile data loaded:', arnsProfile);
      if (arnsProfile) {
        const enrichedProfile = {
          ...profile,
          arnsName: arnsProfile.name,
          avatarUrl: arnsProfile.avatar
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
      // Select the drive and set it up for syncing
      await window.electronAPI.drive.select(selectedDrive.id);
      setDrive(selectedDrive);
      
      // Check if a drive mapping exists for this drive
      const driveMappings = await window.electronAPI.driveMappings.list();
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

  const handleLogout = async () => {
    try {
      await window.electronAPI.wallet.logout();
      setWalletInfo(null);
      setCurrentProfile(null);
      setDrive(null);
      setSyncStatus(null);
      setUploads([]);
      
      // Check if we have multiple profiles to show profile management
      const profiles = await window.electronAPI.profiles.list();
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
              // Go back to profile selection if multiple profiles exist
              window.electronAPI.profiles.list().then(profiles => {
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
            onLogout={handleLogout}
            onDriveDeleted={handleDriveDeleted}
            onSyncProgressClear={() => setSyncProgress(null)}
            onRefreshUploads={async () => {
              try {
                const uploadData = await window.electronAPI.files.getUploads();
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
      </div>
    </ErrorBoundary>
  );
};

export default App;