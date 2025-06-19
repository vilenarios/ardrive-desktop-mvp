import React, { useState } from 'react';
import { Cloud, FolderOpen, HardDrive, Info, Globe, Zap } from 'lucide-react';
import { ClientInputValidator } from '../input-validator';

interface DriveAndSyncSetupProps {
  onSetupComplete: () => void;
}

const DriveAndSyncSetup: React.FC<DriveAndSyncSetupProps> = ({ onSetupComplete }) => {
  const [driveName, setDriveName] = useState('My Files');
  const [syncFolder, setSyncFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupProgress, setSetupProgress] = useState<string>('');

  const handleSelectFolder = async () => {
    try {
      const selectedFolder = await window.electronAPI.dialog.selectFolder();
      if (selectedFolder) {
        setSyncFolder(selectedFolder);
        setError(null);
      }
    } catch (err) {
      setError('Failed to select folder');
    }
  };

  const handleSetup = async () => {
    // Validate drive name using client-side validation
    const driveNameValidation = ClientInputValidator.validateDriveName(driveName);
    if (!driveNameValidation.isValid) {
      setError(driveNameValidation.error!);
      return;
    }
    
    // Validate sync folder
    const folderValidation = ClientInputValidator.validateFilePath(syncFolder);
    if (!folderValidation.isValid) {
      setError(folderValidation.error!);
      return;
    }

    setLoading(true);
    setError(null);
    setSetupProgress('');

    try {
      // Check wallet is loaded first
      setSetupProgress('Checking wallet...');
      const walletInfo = await window.electronAPI.wallet.getInfo();
      if (!walletInfo) {
        throw new Error('Wallet not loaded. Please ensure your wallet is properly imported.');
      }

      // Create drive
      setSetupProgress('Creating your drive on Arweave (free with Turbo!)...');
      const drive = await window.electronAPI.drive.create(driveName.trim(), 'public');
      
      if (!drive || !drive.id) {
        throw new Error('Failed to create drive. Please try again.');
      }
      
      // Set sync folder
      setSetupProgress('Configuring sync folder...');
      await window.electronAPI.sync.setFolder(syncFolder);
      
      // Start sync
      setSetupProgress('Starting sync...');
      await window.electronAPI.sync.start();
      
      // Mark first run as complete
      await window.electronAPI.config.markFirstRunComplete();
      
      setSetupProgress('Setup complete! 🎉');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      onSetupComplete();
    } catch (err) {
      console.error('Setup error:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
      setSetupProgress('');
      setLoading(false);
    }
  };

  return (
    <div className="drive-setup-container" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      background: 'var(--gray-50)'
    }}>
      <div className="drive-setup-card" style={{
        width: '100%',
        maxWidth: '600px',
        padding: 'var(--space-8)',
        background: 'white',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <HardDrive size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-4)' }} />
          <h2 style={{ marginBottom: 'var(--space-3)', fontSize: '28px' }}>
            Let's Set Up Your Storage
          </h2>
          <p className="text-gray-600" style={{ fontSize: '16px', lineHeight: '1.6' }}>
            Create your first drive and choose a folder to sync
          </p>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Drive Setup */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <Cloud size={20} />
            Name Your Drive
          </h3>
          
          {/* Drive Name */}
          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Drive Name</label>
            <input
              type="text"
              value={driveName}
              onChange={(e) => setDriveName(e.target.value)}
              placeholder="e.g., Personal Files, Work Documents"
              style={{ fontSize: '16px' }}
            />
          </div>

          {/* Drive Type Info */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            color: 'var(--gray-700)'
          }}>
            <Globe size={16} />
            <span>Public Drive - Files are visible to everyone on Arweave</span>
          </div>
        </div>

        {/* Sync Folder Setup */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <FolderOpen size={20} />
            Choose Sync Folder
          </h3>
          
          <div style={{ 
            padding: 'var(--space-4)', 
            border: '2px dashed var(--gray-300)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
            backgroundColor: syncFolder ? 'var(--primary-50)' : 'var(--gray-50)',
            borderColor: syncFolder ? 'var(--ardrive-primary)' : 'var(--gray-300)'
          }}>
            {syncFolder ? (
              <>
                <FolderOpen size={32} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-2)' }} />
                <p style={{ fontWeight: '600', marginBottom: 'var(--space-2)' }}>{syncFolder}</p>
                <button
                  className="button small outline"
                  onClick={handleSelectFolder}
                >
                  Change Folder
                </button>
              </>
            ) : (
              <>
                <FolderOpen size={32} style={{ color: 'var(--gray-400)', marginBottom: 'var(--space-2)' }} />
                <p style={{ color: 'var(--gray-600)', marginBottom: 'var(--space-3)' }}>
                  Select a folder to sync with ArDrive
                </p>
                <button
                  className="button"
                  onClick={handleSelectFolder}
                >
                  Choose Folder
                </button>
              </>
            )}
          </div>
        </div>

        {/* Free with Turbo notification */}
        <div style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--success-50)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--success-200)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)'
        }}>
          <Zap size={20} style={{ color: 'var(--success-600)', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <p style={{ fontWeight: '600', color: 'var(--success-900)', marginBottom: 'var(--space-1)' }}>
              Free with Turbo!
            </p>
            <p style={{ fontSize: '14px', color: 'var(--success-700)' }}>
              Creating drives and folders is free thanks to Turbo. Transactions under 100KB cost no credits.
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-6)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--space-3)'
        }}>
          <Info size={20} style={{ color: 'var(--ardrive-primary)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '14px', color: 'var(--gray-700)' }}>
            <p style={{ marginBottom: 'var(--space-2)' }}>
              <strong>What is Arweave?</strong>
            </p>
            <p style={{ lineHeight: '1.6' }}>
              Arweave is a decentralized storage network that stores data permanently. 
              Unlike traditional cloud storage with monthly fees, you pay once to store forever. 
              Your files are replicated across hundreds of nodes worldwide.
            </p>
          </div>
        </div>

        {/* Action Button and Progress */}
        <div>
          <button
            className="button large"
            onClick={handleSetup}
            disabled={loading || !driveName.trim() || !syncFolder}
            style={{ width: '100%', fontSize: '16px', padding: 'var(--space-4)', marginBottom: loading ? 'var(--space-3)' : 0 }}
          >
            {loading ? (
              <>
                <div style={{ 
                  width: '16px', 
                  height: '16px', 
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTop: '2px solid white',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginRight: 'var(--space-2)'
                }} />
                Setting up...
              </>
            ) : (
              'Complete Setup'
            )}
          </button>
          
          {/* Progress indicator */}
          {loading && setupProgress && (
            <div style={{
              textAlign: 'center',
              fontSize: '14px',
              color: 'var(--gray-600)',
              opacity: 1,
              transition: 'opacity 0.3s ease-in'
            }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}>
                {setupProgress.includes('complete') ? (
                  <span style={{ fontSize: '16px' }}>✓</span>
                ) : (
                  <div style={{
                    width: '12px',
                    height: '12px',
                    border: '2px solid var(--gray-300)',
                    borderTop: '2px solid var(--ardrive-primary)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                )}
                {setupProgress}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriveAndSyncSetup;