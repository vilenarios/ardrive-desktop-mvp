import React, { useState, useEffect } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, Profile } from '../types';
import WalletSetup from './components/WalletSetup';
import DriveAndSyncSetup from './components/DriveAndSyncSetup';
import SyncFolderSetup from './components/SyncFolderSetup';
import WelcomeBackScreen from './components/WelcomeBackScreen';
import Dashboard from './components/Dashboard';
import ToastContainer from './components/ToastContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useToast } from './hooks/useToast';

// Simple app states
type AppState = 'loading' | 'wallet-setup' | 'drive-setup' | 'sync-setup' | 'welcome-back' | 'dashboard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const { toasts, toast, removeToast } = useToast();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Load config
      const appConfig = await window.electronAPI.config.get();
      setConfig(appConfig);

      // Check if wallet exists
      const hasWallet = await window.electronAPI.wallet.hasStoredWallet();
      if (!hasWallet) {
        setAppState('wallet-setup');
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

      // Check if drive exists
      const driveList = await window.electronAPI.drive.list();
      if (!driveList || driveList.length === 0) {
        setAppState('drive-setup');
        return;
      }

      // Get the active drive based on drive mappings
      let activeDrive: DriveInfo | null = null;
      
      // Try to get the primary drive mapping
      const primaryMapping = await window.electronAPI.driveMappings.getPrimary();
      console.log('Primary drive mapping:', primaryMapping);
      console.log('Available drives:', driveList.map((d: DriveInfo) => ({ id: d.id, name: d.name })));
      
      // Also log all drive mappings to debug
      const allMappings = await window.electronAPI.driveMappings.list();
      console.log('All drive mappings:', allMappings);
      
      if (primaryMapping) {
        // Find the drive that matches the primary mapping
        activeDrive = driveList.find((d: DriveInfo) => d.id === primaryMapping.driveId) || null;
        console.log('Found matching drive:', activeDrive);
        
        if (!activeDrive) {
          console.error('Drive mapping points to driveId that does not exist in drive list!', {
            mappingDriveId: primaryMapping.driveId,
            mappingDriveName: primaryMapping.driveName,
            availableDriveIds: driveList.map((d: DriveInfo) => d.id)
          });
        }
      }
      
      // If no primary mapping or drive not found, fall back to first drive
      if (!activeDrive) {
        console.log('No active drive found, using first drive');
        activeDrive = driveList[0];
      }
      
      console.log('Setting active drive:', activeDrive);
      setDrive(activeDrive);

      // Check if sync folder is configured
      const syncFolder = await window.electronAPI.sync.getFolder();
      if (!syncFolder) {
        setAppState('drive-setup');
        return;
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
    // Listen for sync status updates
    window.electronAPI.onSyncStatusUpdate((status) => {
      setSyncStatus(status);
    });

    // Listen for upload updates
    window.electronAPI.onUploadProgress((upload) => {
      setUploads(prev => {
        const index = prev.findIndex(u => u.id === upload.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = upload;
          return updated;
        }
        return [...prev, upload];
      });
    });

    // Listen for drive updates
    window.electronAPI.onDriveUpdate(async () => {
      const drives = await window.electronAPI.drive.list();
      if (drives && drives.length > 0) {
        setDrive(drives[0]);
      }
    });
  };

  const handleWalletImported = async () => {
    // Wallet is imported, check if we need drive setup
    try {
      // Get wallet info and profile
      const [wallet, profile] = await Promise.all([
        window.electronAPI.wallet.getInfo(),
        window.electronAPI.profile.getActive()
      ]);
      
      if (wallet && profile) {
        setWalletInfo(wallet);
        
        // Fetch ArNS data for the profile
        try {
          const arnsProfile = await window.electronAPI.arns.getProfile(profile.address);
          console.log('ArNS profile data (wallet import):', arnsProfile);
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
      }
      
      const drives = await window.electronAPI.drive.list();
      if (!drives || drives.length === 0) {
        // No existing drives, go to drive setup
        setAppState('drive-setup');
      } else {
        // Has existing drives, show welcome back screen for drive selection
        setIsReturningUser(true);
        setAppState('welcome-back');
      }
    } catch (error) {
      console.error('Error checking drives:', error);
      toast.error('Failed to check existing drives');
      setAppState('drive-setup');
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
      setAppState('wallet-setup');
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
            onDriveSelected={handleDriveSelectedFromWelcomeBack}
            onCreateNewDrive={() => {
              setIsReturningUser(true);
              setAppState('drive-setup');
            }}
            onSkipSetup={handleSkipSetup}
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
        return (
          <Dashboard
            config={config!}
            walletInfo={walletInfo!}
            currentProfile={currentProfile!}
            drive={drive!}
            syncStatus={syncStatus}
            uploads={uploads}
            onLogout={handleLogout}
            onDriveDeleted={handleDriveDeleted}
          />
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