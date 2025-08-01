import React, { useState } from 'react';
import { FolderOpen, HardDrive, Info, CheckCircle, Calendar, Database, ArrowLeft, SkipForward } from 'lucide-react';
import { ClientInputValidator } from '../input-validator';
import { DriveInfo } from '../../types';

interface SyncFolderSetupProps {
  drive: DriveInfo;
  onSetupComplete: () => void;
  onBack?: () => void;
  onSkipSetup?: () => void;
}

const SyncFolderSetup: React.FC<SyncFolderSetupProps> = ({ drive, onSetupComplete, onBack, onSkipSetup }) => {
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
      // Create local folder inside selected sync directory
      const driveFolderName = drive.name;
      // Use platform-appropriate path separator
      const pathSeparator = syncFolder.includes('\\') ? '\\' : '/';
      const driveFolderPath = `${syncFolder}${syncFolder.endsWith(pathSeparator) ? '' : pathSeparator}${driveFolderName}`;
      
      setSetupProgress('Creating local folder...');
      // The sync.setFolder should handle creating the subfolder
      await window.electronAPI.sync.setFolder(driveFolderPath);
      
      // Save drive metadata and config
      setSetupProgress('Saving configuration...');
      
      // Create drive mapping using the existing drive data
      const driveMapping = {
        id: drive.id, // Use the drive ID as the mapping ID for simplicity
        driveId: drive.id,
        driveName: drive.name,
        drivePrivacy: (drive.isPrivate || drive.privacy === 'private') ? 'private' : 'public',
        localFolderPath: driveFolderPath,
        rootFolderId: drive.rootFolderId,
        isActive: true,
        syncSettings: {
          syncDirection: 'bidirectional' as const,
          uploadPriority: 0
        }
      };
      
      // Add the drive mapping via IPC
      await window.electronAPI.driveMappings.add(driveMapping);
      
      // Mark first run as complete
      await window.electronAPI.config.markFirstRunComplete();
      
      // Go to dashboard immediately - sync will start in background
      onSetupComplete();
      
      // Start sync in background after navigating to dashboard
      setTimeout(async () => {
        try {
          await window.electronAPI.sync.start();
        } catch (err) {
          console.error('Failed to start sync:', err);
        }
      }, 100);
      
    } catch (err) {
      console.error('Setup error:', err);
      setError(err instanceof Error ? err.message : 'Setup failed');
      setSetupProgress('');
      setLoading(false);
    }
  };

  return (
    <div className="sync-setup-container" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      background: 'var(--gray-50)'
    }}>
      <div className="sync-setup-card" style={{
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
            Set Up Sync Folder
          </h2>
          <p className="text-gray-600" style={{ fontSize: '16px', lineHeight: '1.6' }}>
            Choose where to sync your ArDrive files locally
          </p>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Selected Drive Info - Enhanced */}
        <div style={{
          padding: 'var(--space-5)',
          backgroundColor: 'var(--ardrive-primary-50)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--ardrive-primary)',
          marginBottom: 'var(--space-6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <HardDrive size={24} style={{ color: 'var(--ardrive-primary)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <h3 style={{ fontWeight: '600', color: 'var(--gray-900)', fontSize: '18px', marginBottom: '4px' }}>
                {drive.name}
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
                {(drive.isPrivate || drive.privacy === 'private') ? 'Private Drive' : 'Public Drive'}
              </p>
            </div>
          </div>
          
          <div style={{ 
            display: 'flex', 
            gap: 'var(--space-4)',
            fontSize: '13px',
            color: 'var(--gray-600)',
            paddingLeft: 'calc(24px + var(--space-3))'
          }}>
            {drive.dateCreated && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Calendar size={14} />
                Created {new Date(drive.dateCreated).toLocaleDateString()}
              </div>
            )}
            {drive.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Database size={14} />
                {formatFileSize(drive.size)}
              </div>
            )}
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
            backgroundColor: syncFolder ? 'var(--ardrive-primary-50)' : 'var(--gray-50)',
            borderColor: syncFolder ? 'var(--ardrive-primary)' : 'var(--gray-300)'
          }}>
            {syncFolder ? (
              <>
                <FolderOpen size={32} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-2)' }} />
                <p style={{ fontWeight: '600', marginBottom: 'var(--space-2)', wordBreak: 'break-all' }}>
                  {syncFolder}
                </p>
                <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: 'var(--space-3)' }}>
                  A folder named &ldquo;{drive.name}&rdquo; will be created here
                </p>
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
                  Select a folder to sync with your ArDrive
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
              <strong>How syncing works</strong>
            </p>
            <p style={{ lineHeight: '1.6' }}>
              Files in your sync folder will be automatically uploaded to your ArDrive. 
              New files from ArDrive will be downloaded to this folder. 
              Your files remain permanently stored on Arweave even if deleted locally.
            </p>
          </div>
        </div>

        {/* Action Buttons and Progress */}
        <div>
          <div style={{ 
            display: 'flex', 
            gap: 'var(--space-3)',
            marginBottom: loading ? 'var(--space-3)' : 0
          }}>
            {(onBack || onSkipSetup) && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {onBack && (
                  <button
                    className="button outline"
                    onClick={onBack}
                    disabled={loading}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                )}
                {onSkipSetup && (
                  <button
                    className="button outline"
                    onClick={onSkipSetup}
                    disabled={loading}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <SkipForward size={16} />
                    Skip Setup
                  </button>
                )}
              </div>
            )}
            
            <button
              className="button large"
              onClick={handleSetup}
              disabled={loading || !syncFolder}
              style={{ 
                flex: 1,
                fontSize: '16px', 
                padding: 'var(--space-4)',
                opacity: (!syncFolder || loading) ? 0.6 : 1,
                cursor: (!syncFolder || loading) ? 'not-allowed' : 'pointer'
              }}
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
                'Start Syncing'
              )}
            </button>
          </div>
          
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

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default SyncFolderSetup;