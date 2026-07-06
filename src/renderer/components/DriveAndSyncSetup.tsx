import React, { useState, useEffect, useRef } from 'react';
import { Cloud, FolderOpen, HardDrive, Info, Globe, Zap, X, HelpCircle, CheckCircle, Trash2, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { ClientInputValidator } from '../input-validator';
import { InfoButton } from './common/InfoButton';
import SetupSuccessScreen from './SetupSuccessScreen';
import { SyncProgressDisplay } from './SyncProgressDisplay';
import { Profile, SyncProgress, DriveInfo } from '../../types';

// SYNC-20: translate a raw gateway/network failure into honest, actionable
// copy. A transient turbo-gateway 404 (fresh drive not yet indexed) or a
// connectivity blip should tell the user what to do — not surface a cryptic
// "Request to gateway has failed: (Status: 404)".
const GATEWAY_ERROR_COPY =
  "Couldn't reach the Arweave gateway. Check your connection or try a different gateway in Settings, then try again.";
export const isGatewaySetupError = (message: string): boolean => {
  const m = message.toLowerCase();
  return (
    m.includes('gateway') ||
    m.includes('status: 404') ||
    m.includes('status 404') ||
    m.includes('not found') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('network') ||
    m.includes('fetch failed') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('enotfound')
  );
};
const toFriendlySetupError = (message: string): string =>
  isGatewaySetupError(message) ? GATEWAY_ERROR_COPY : message;

interface DriveAndSyncSetupProps {
  currentProfile?: Profile | null;
  onSetupComplete: () => void;
  isReturningUser?: boolean;
  onBack?: () => void;
}

const DriveAndSyncSetup: React.FC<DriveAndSyncSetupProps> = ({ currentProfile, onSetupComplete, isReturningUser = false, onBack }) => {
  const [driveName, setDriveName] = useState(isReturningUser ? '' : 'My Files');
  const [syncFolder, setSyncFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupProgress, setSetupProgress] = useState<string>('');
  const [driveNameError, setDriveNameError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [enableAutoSync, setEnableAutoSync] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [createdDriveInfo, setCreatedDriveInfo] = useState<{
    driveName: string;
    localFolder: string;
    driveId?: string;
    rootFolderId?: string;
    driveTxId?: string;
  } | null>(null);

  // SYNC-20 idempotency: drive-create is a permanent, potentially-costly ArFS
  // write and driveMappings.add is a DB insert — neither may run twice. If setup
  // fails at the retryable tail (sync-start on a transient 404), we remember what
  // was already provisioned so "Try Again" only re-runs the tail, never re-creates
  // the drive or re-adds the mapping.
  const provisionedRef = useRef<{ drive: DriveInfo; driveFolderPath: string } | null>(null);

  // Dev mode auto-fill for faster testing
  useEffect(() => {
    const checkDevMode = async () => {
      const isDevModeResult = await window.electronAPI.system.getEnv('ARDRIVE_DEV_MODE');
      const devSyncFolderResult = await window.electronAPI.system.getEnv('ARDRIVE_DEV_SYNC_FOLDER');
      const isDevMode = isDevModeResult.success ? isDevModeResult.data : undefined;
      const devSyncFolder = devSyncFolderResult.success ? devSyncFolderResult.data : undefined;

      if (isDevMode === 'true' && devSyncFolder && !syncFolder) {
        setSyncFolder(devSyncFolder);
      }
    };
    
    checkDevMode();
  }, []);

  // Listen for sync progress during setup
  useEffect(() => {
    const handleSyncProgress = (progress: SyncProgress) => {
      console.log('Setup received sync progress:', progress);
      setSyncProgress(progress);
      
      // Also update the simple progress text for fallback
      setSetupProgress(progress.description);
      
      // Hide sync progress modal when complete. UX-8: never auto-hide an
      // error completion — it must stay up (dismissible) until the user
      // reads it and acts, not vanish silently after 2s.
      if (progress.phase === 'complete' && !progress.error) {
        setTimeout(() => {
          setSyncProgress(null);
        }, 2000); // Show complete state for 2 seconds
      }
    };

    window.electronAPI.onSyncProgress(handleSyncProgress);
    
    return () => {
      window.electronAPI.removeSyncProgressListener();
    };
  }, []);

  const handleSelectFolder = async () => {
    try {
      const result = await window.electronAPI.dialog.selectFolder();
      const selectedFolder = result.success ? result.data : null;
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
  // H-COPY-2: this cap must match input-validator.ts's MAX_DRIVE_NAME_LENGTH
  // (100) — the UI previously hardcoded 32, silently truncating well below
  // what the backend validator (and ArFS itself) actually allows.
  const validateDriveNameRealtime = (name: string) => {
    // Check length
    if (name.length > 100) {
      setDriveNameError('Drive name must be under 100 characters');
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
    if (newName.length <= 100) {
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
    // UX-8: clear any stale error left on the sync-progress modal by a prior
    // failed attempt so Retry starts from a clean slate.
    setSyncProgress(null);

    try {
      // Check wallet is loaded first
      setSetupProgress('Checking wallet...');
      const walletInfoResult = await window.electronAPI.wallet.getInfo();
      const walletInfo = walletInfoResult.success ? walletInfoResult.data : null;
      if (!walletInfo) {
        throw new Error('Wallet not loaded. Please ensure your wallet is properly imported.');
      }

      // Deterministic local folder path (same on every retry).
      const driveFolderName = driveName.trim();
      const pathSeparator = syncFolder.includes('\\') ? '\\' : '/';
      const driveFolderPath = `${syncFolder}${syncFolder.endsWith(pathSeparator) ? '' : pathSeparator}${driveFolderName}`;

      // SYNC-20 idempotency: reuse a drive already provisioned by a PRIOR attempt
      // instead of creating a second one. drive.create is a permanent ArFS write
      // (and can cost) and driveMappings.add is a DB insert — both run at most once.
      let drive = provisionedRef.current?.drive ?? null;

      if (!drive) {
        // Create drive (UX-3: IpcResult envelope)
        setSetupProgress('Creating your drive on Arweave...');
        const createResult = await window.electronAPI.drive.create(driveFolderName, 'public');

        if (!createResult.success) {
          throw new Error(createResult.error || 'Failed to create drive. Please try again.');
        }

        drive = createResult.data ?? null;
        if (!drive || !drive.id) {
          throw new Error('Failed to create drive. Please try again.');
        }

        // Create local folder inside selected sync directory.
        // The sync.setFolder should handle creating the subfolder.
        // UX-3: handler resolves { success:false } on error rather than throwing.
        setSetupProgress('Creating local folder...');
        const setFolderResult = await window.electronAPI.sync.setFolder(driveFolderPath);
        if (!setFolderResult.success) {
          throw new Error(setFolderResult.error || 'Failed to set up the sync folder');
        }

        // Save drive metadata and config
        setSetupProgress('Saving configuration...');

        // Create drive mapping using the drive data from ardrive-core-js
        const driveMapping = {
          id: drive.id, // Use the drive ID as the mapping ID for simplicity
          driveId: drive.id,
          driveName: drive.name,
          drivePrivacy: drive.privacy,
          localFolderPath: driveFolderPath,
          rootFolderId: drive.rootFolderId,
          isActive: true,
          syncSettings: {
            syncDirection: 'bidirectional' as const,
            uploadPriority: 0
          }
        };

        // Add the drive mapping via IPC (UX-3: unwrap the envelope)
        const addMappingResult = await window.electronAPI.driveMappings.add(driveMapping);
        if (!addMappingResult.success) {
          throw new Error(addMappingResult.error || 'Failed to save the drive mapping');
        }

        // Provisioning is done and irreversible — remember it so a later failure
        // (e.g. a transient gateway 404 at sync-start) can be retried WITHOUT
        // re-creating the drive or re-adding the mapping.
        provisionedRef.current = { drive, driveFolderPath };
      } else {
        // Retry after provisioning already succeeded: just make sure the sync
        // folder still points at the right place (setFolder is idempotent).
        console.log('[DriveAndSyncSetup] Reusing provisioned drive on retry:', drive.id);
        await window.electronAPI.sync.setFolder(driveFolderPath);
      }

      // Initialize sync engine — the retryable tail. sync:start is now bounded in
      // the main process (retry + timeout), so it always settles instead of
      // hanging on "Starting sync engine…".
      if (enableAutoSync) {
        setSetupProgress('Starting sync engine...');
        const startResult = await window.electronAPI.sync.start();
        if (!startResult.success) {
          throw new Error(startResult.error || 'Failed to start the sync engine');
        }
      } else {
        setSetupProgress('Sync engine ready (manual start required)...');
      }

      // Mark first run as complete
      await window.electronAPI.config.markFirstRunComplete();

      // Store created drive info for success screen
      setCreatedDriveInfo({
        driveName: driveFolderName,
        localFolder: driveFolderPath,
        driveId: drive.id,
        rootFolderId: drive.rootFolderId,
        driveTxId: drive.metadataTxId // Transaction ID from drive creation
      });

      setSetupProgress('Setup complete! 🎉');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Show success screen instead of calling onSetupComplete
      setShowSuccess(true);
      setLoading(false);
    } catch (err) {
      // SYNC-20: setup must FAIL GRACEFULLY, never hang. Surface honest,
      // actionable copy for gateway/connectivity failures; the render path shows
      // a "Try Again" affordance (idempotent — see provisionedRef above).
      console.error('Setup error:', err);
      const rawMessage = err instanceof Error ? err.message : 'Setup failed';
      const friendlyMessage = toFriendlySetupError(rawMessage);
      setError(friendlyMessage);
      setSetupProgress('');
      setLoading(false);
      // UX-8: sync:start (e.g. inside the "Starting sync engine…" step) never
      // emits a compensating progress event on failure, so the sync-progress
      // modal below was left frozen on its last phase forever — no error, no
      // way to dismiss it, completely hiding the "Try Again" banner above.
      // Only step in if that modal was actually showing (i.e. a sync-progress
      // event had already arrived); transition the SAME modal to its error
      // state instead of leaving stale progress in place.
      setSyncProgress(prev => (prev ? { phase: 'error', description: friendlyMessage, error: friendlyMessage } : null));
    }
  };

  // Show success screen if setup is complete
  if (showSuccess && createdDriveInfo) {
    return (
      <SetupSuccessScreen
        currentProfile={currentProfile}
        driveName={createdDriveInfo.driveName}
        driveType="Public Drive"
        localSyncFolder={createdDriveInfo.localFolder}
        autoSyncEnabled={enableAutoSync}
        driveId={createdDriveInfo.driveId}
        rootFolderId={createdDriveInfo.rootFolderId}
        driveTxId={createdDriveInfo.driveTxId}
        onOpenDashboard={onSetupComplete}
      />
    );
  }

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
        background: 'var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <HardDrive size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-3)' }} />
          <h2 style={{ marginBottom: 'var(--space-2)', fontSize: '28px' }}>
            {showSummary ? 'Review Your Setup' : (isReturningUser ? 'Create a New Drive' : 'Let\'s Set Up Your Storage')}
          </h2>
          <p className="text-gray-600" style={{ fontSize: '16px', lineHeight: '1.5' }}>
            {showSummary ? 
              'Please review your configuration before completing setup' : 
              (isReturningUser ? 
                'Set up a new ArDrive and choose a local folder to sync. Your existing drives will remain available.' :
                'Create your first drive and choose a folder to sync'
              )
            }
          </p>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
            {/* SYNC-20: after a setup attempt failed (e.g. transient gateway 404),
                give the user an explicit, idempotent way forward so they are never
                trapped on a stuck wizard step. Only shown once setup was attempted
                (on the summary step) and not while a retry is in flight. */}
            {showSummary && !loading && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
                <button
                  className="button small"
                  onClick={handleSetup}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                >
                  <RefreshCw size={14} />
                  Try Again
                </button>
                {isReturningUser && onBack && (
                  <button className="button small outline" onClick={onBack}>
                    Back to Existing Drives
                  </button>
                )}
              </div>
            )}
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
            
            {/* Reassurance text */}
            <p style={{
              marginTop: 'var(--space-4)',
              fontSize: '14px',
              color: 'var(--gray-500)',
              textAlign: 'center'
            }}>
              You can update these settings later.
            </p>

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
                  maxLength={100}
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
                  color: driveName.length > 90 ? 'var(--error-600)' : 'var(--gray-500)'
                }}>
                  {driveName.length}/100
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
                  This is a public drive. Your files will be permanently visible on the Arweave permaweb.
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
            backgroundColor: syncFolder ? 'var(--ardrive-primary-50)' : 'var(--gray-50)',
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
              {isReturningUser && onBack && (
                <button
                  className="button outline"
                  onClick={onBack}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: '16px',
                    padding: '12px 20px'
                  }}
                >
                  <ArrowLeft size={18} />
                  Back to Existing Drives
                </button>
              )}
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
                      border: '2px solid var(--spinner-track-on-brand)',
                      borderTop: '2px solid var(--text-on-brand)',
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
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              {isReturningUser && onBack && (
                <button
                  className="button outline"
                  onClick={onBack}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: '16px',
                    padding: '12px 20px'
                  }}
                >
                  <ArrowLeft size={18} />
                  Back to Existing Drives
                </button>
              )}
              <button
                className="button large"
                onClick={handleProceedToSummary}
                disabled={!driveName.trim() || !syncFolder || !!driveNameError || driveName.length > 100}
                style={{ 
                  flex: 1,
                  fontSize: '16px', 
                  padding: 'var(--space-4)',
                  opacity: (!driveName.trim() || !syncFolder || !!driveNameError) ? 0.6 : 1,
                  cursor: (!driveName.trim() || !syncFolder || !!driveNameError) ? 'not-allowed' : 'pointer'
                }}
              >
                Continue to Review
              </button>
            </div>
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
      
      {/* Sync Progress Modal during initial setup.
          UX-8: this used to render with no onClose at all — a sync:start
          failure left it frozen on its last phase with zero way to dismiss
          it. Now it always has a close/dismiss path, and Retry re-runs the
          same idempotent handleSetup the inline "Try Again" banner uses. */}
      {syncProgress && syncProgress.phase !== 'complete' && (
        <SyncProgressDisplay
          progress={syncProgress}
          onClose={() => setSyncProgress(null)}
          onRetry={handleSetup}
        />
      )}
    </div>
  );
};

export default DriveAndSyncSetup;