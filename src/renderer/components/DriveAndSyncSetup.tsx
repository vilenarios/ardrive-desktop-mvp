import React, { useState, useEffect } from 'react';
import { Cloud, FolderOpen, HardDrive, Info, Globe, Zap, X, HelpCircle, CheckCircle, Trash2, AlertCircle } from 'lucide-react';
import { ClientInputValidator } from '../input-validator';
import { InfoButton } from './common/InfoButton';

interface DriveAndSyncSetupProps {
  onSetupComplete: () => void;
}

const DriveAndSyncSetup: React.FC<DriveAndSyncSetupProps> = ({ onSetupComplete }) => {
  const [driveName, setDriveName] = useState('My Files');
  const [syncFolder, setSyncFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupProgress, setSetupProgress] = useState<string>('');
  const [driveNameError, setDriveNameError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [enableAutoSync, setEnableAutoSync] = useState(true);

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

  const handleClearFolder = () => {
    setSyncFolder('');
  };

  // Real-time drive name validation
  const validateDriveNameRealtime = (name: string) => {
    // Check length
    if (name.length > 32) {
      setDriveNameError('Drive name must be under 32 characters');
      return false;
    }
    
    // Check for valid characters (letters, numbers, spaces, dashes, underscores)
    const validPattern = /^[a-zA-Z0-9\s\-_]*$/;
    if (!validPattern.test(name)) {
      setDriveNameError('Drive name can only contain letters, numbers, spaces, dashes, and underscores');
      return false;
    }
    
    // Check if not empty
    if (name.trim().length === 0) {
      setDriveNameError('Drive name cannot be empty');
      return false;
    }
    
    setDriveNameError(null);
    return true;
  };

  const handleDriveNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    // Allow typing but validate
    if (newName.length <= 32) {
      setDriveName(newName);
    }
    if (newName) {
      validateDriveNameRealtime(newName);
    } else {
      setDriveNameError(null);
    }
  };

  const handleProceedToSummary = () => {
    // Final validation before showing summary
    const driveNameValidation = ClientInputValidator.validateDriveName(driveName);
    if (!driveNameValidation.isValid) {
      setDriveNameError(driveNameValidation.error!);
      return;
    }
    
    const folderValidation = ClientInputValidator.validateFilePath(syncFolder);
    if (!folderValidation.isValid) {
      setError(folderValidation.error!);
      return;
    }
    
    setShowSummary(true);
  };

  const handleSetup = async () => {

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
      
      // Start sync if enabled
      if (enableAutoSync) {
        setSetupProgress('Starting sync...');
        await window.electronAPI.sync.start();
      }
      
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
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <HardDrive size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-3)' }} />
          <h2 style={{ marginBottom: 'var(--space-2)', fontSize: '28px' }}>
            {showSummary ? 'Review Your Setup' : 'Let\'s Set Up Your Storage'}
          </h2>
          <p className="text-gray-600" style={{ fontSize: '16px', lineHeight: '1.5' }}>
            {showSummary ? 'Please review your configuration before completing setup' : 'Create your first drive and choose a folder to sync'}
          </p>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Setup Summary */}
        {showSummary ? (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{
              backgroundColor: 'var(--gray-50)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-5)',
              border: '1px solid var(--gray-200)'
            }}>
              <h3 style={{ 
                fontSize: '16px', 
                fontWeight: '600', 
                marginBottom: 'var(--space-4)',
                color: 'var(--gray-900)'
              }}>
                Setup Summary
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <Cloud size={20} style={{ color: 'var(--ardrive-primary)', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>Drive Name</p>
                    <p style={{ fontSize: '15px', color: 'var(--gray-700)' }}>{driveName}</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <FolderOpen size={20} style={{ color: 'var(--ardrive-primary)', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>Sync Folder</p>
                    <p style={{ fontSize: '15px', color: 'var(--gray-700)', wordBreak: 'break-all' }}>{syncFolder}</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <Globe size={20} style={{ color: 'var(--ardrive-primary)', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>Drive Type</p>
                    <p style={{ fontSize: '15px', color: 'var(--gray-700)' }}>Public Drive</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <Zap size={20} style={{ color: 'var(--success-600)', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>Auto-Sync</p>
                    <p style={{ fontSize: '15px', color: 'var(--gray-700)' }}>{enableAutoSync ? 'Enabled' : 'Disabled'}</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <>
          {/* Drive Setup */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              marginBottom: 'var(--space-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
            }}>
              <Cloud size={20} />
              Name Your Drive
            </h3>
            
            {/* Drive Name */}
            <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
              <label>Drive Name</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={driveName}
                  onChange={handleDriveNameChange}
                  placeholder="e.g., Personal Files, Work Documents"
                  maxLength={32}
                  style={{ 
                    fontSize: '16px',
                    borderColor: driveNameError ? 'var(--error)' : undefined,
                    paddingRight: '60px'
                  }}
                />
                <span style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '13px',
                  color: driveName.length > 28 ? 'var(--error-600)' : 'var(--gray-500)'
                }}>
                  {driveName.length}/32
                </span>
              </div>
              {driveNameError && (
                <p style={{ 
                  fontSize: '13px', 
                  color: 'var(--error)', 
                  marginTop: 'var(--space-1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)'
                }}>
                  <AlertCircle size={14} />
                  {driveNameError}
                </p>
              )}
            </div>

            {/* Drive Type Info - Enhanced Warning */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              backgroundColor: 'var(--warning-50)',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              border: '1px solid var(--warning-200)'
            }}>
              <Globe size={16} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--warning-600)' }} />
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--gray-800)' }}>
                  🌐 This is a public drive. Your files will be permanently visible on the Arweave permaweb.
                </span>
                <InfoButton 
                  tooltip="Arweave is a decentralized permanent storage network. Once uploaded, files cannot be deleted and are publicly accessible by anyone."
                />
              </div>
            </div>
          </div>

          {/* Sync Folder Setup */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              marginBottom: 'var(--space-3)',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <FolderOpen size={32} style={{ color: 'var(--ardrive-primary)' }} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: '4px' }}>Selected folder:</p>
                    <p style={{ fontWeight: '600', wordBreak: 'break-all', fontSize: '15px' }}>{syncFolder}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    className="button small outline"
                    onClick={handleSelectFolder}
                  >
                    Change Folder
                  </button>
                  <button
                    className="button small outline"
                    onClick={handleClearFolder}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 'var(--space-1)',
                      borderColor: 'var(--error-500)',
                      color: 'var(--error-500)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--error-50)';
                      e.currentTarget.style.borderColor = 'var(--error-600)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--error-500)';
                    }}
                  >
                    <Trash2 size={14} />
                    Clear
                  </button>
                </div>
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

        {/* Auto-sync toggle */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--space-2)', 
            cursor: 'pointer',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--gray-200)'
          }}>
            <input 
              type="checkbox" 
              checked={enableAutoSync}
              onChange={(e) => setEnableAutoSync(e.target.checked)}
              style={{ 
                width: '18px', 
                height: '18px',
                cursor: 'pointer'
              }}
            />
            <span style={{ fontSize: '15px', fontWeight: '500' }}>
              Start syncing automatically after setup
            </span>
            <InfoButton 
              tooltip="When enabled, ArDrive will begin monitoring your folder and syncing files immediately after setup. You can always start or stop sync later from the dashboard."
            />
          </label>
        </div>

        </>
        )}

        {/* Action Button and Progress */}
        <div>
          {showSummary ? (
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                className="button outline large"
                onClick={() => setShowSummary(false)}
                disabled={loading}
                style={{ flex: 1, fontSize: '16px', padding: 'var(--space-4)' }}
              >
                Back
              </button>
              <button
                className="button large"
                onClick={handleSetup}
                disabled={loading}
                style={{ flex: 2, fontSize: '16px', padding: 'var(--space-4)' }}
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
            </div>
          ) : (
            <button
              className="button large"
              onClick={handleProceedToSummary}
              disabled={!driveName.trim() || !syncFolder || !!driveNameError || driveName.length > 32}
              style={{ 
                width: '100%', 
                fontSize: '16px', 
                padding: 'var(--space-4)',
                opacity: (!driveName.trim() || !syncFolder || !!driveNameError) ? 0.6 : 1,
                cursor: (!driveName.trim() || !syncFolder || !!driveNameError) ? 'not-allowed' : 'pointer'
              }}
            >
              Continue to Review
            </button>
          )}
          
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