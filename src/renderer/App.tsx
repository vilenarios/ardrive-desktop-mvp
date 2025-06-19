import React, { useState, useEffect } from 'react';
import { AppConfig, DriveInfo, WalletInfo, SyncStatus, FileUpload, Profile } from '../types';
import WalletSetup from './components/WalletSetup';
import DriveAndSyncSetup from './components/DriveAndSyncSetup';
import SyncFolderSetup from './components/SyncFolderSetup';
import Dashboard from './components/Dashboard';
import ToastContainer from './components/ToastContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useToast } from './hooks/useToast';

// Simple app states
type AppState = 'loading' | 'wallet-setup' | 'drive-setup' | 'sync-setup' | 'dashboard';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('loading');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [drive, setDrive] = useState<DriveInfo | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
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
      setCurrentProfile(profile);

      // Check if drive exists
      const driveList = await window.electronAPI.drive.list();
      if (!driveList || driveList.length === 0) {
        setAppState('drive-setup');
        return;
      }

      // Get the first (and only) drive
      const activeDrive = driveList[0];
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
      const drives = await window.electronAPI.drive.list();
      if (!drives || drives.length === 0) {
        // No existing drives, go to drive setup
        setAppState('drive-setup');
      } else {
        // Has existing drives, check if sync folder is configured
        const config = await window.electronAPI.config.get();
        if (!config.syncFolder) {
          // Has drives but no sync folder, need to set up sync
          // For now, select the first drive and go to sync setup
          await window.electronAPI.drive.select(drives[0].id);
          setDrive(drives[0]);
          setAppState('sync-setup'); // Show sync folder setup for existing drive
        } else {
          // Has drives and sync folder, go to dashboard
          await initializeApp();
        }
      }
    } catch (error) {
      console.error('Error checking drives:', error);
      toast.error('Failed to check existing drives');
      setAppState('drive-setup');
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
        return <DriveAndSyncSetup onSetupComplete={handleDriveSetupComplete} />;

      case 'sync-setup':
        return drive ? (
          <SyncFolderSetup drive={drive} onSetupComplete={handleDriveSetupComplete} />
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