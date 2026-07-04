import React, { useState } from 'react';
import { X, HardDrive, Globe, Lock, AlertCircle, Eye, EyeOff, ShieldAlert } from 'lucide-react';

interface CreateDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDriveCreated: (drive: any) => void;
  currentSyncFolder?: string;
}

export const CreateDriveModal: React.FC<CreateDriveModalProps> = ({
  isOpen,
  onClose,
  onDriveCreated,
  currentSyncFolder
}) => {
  const [driveName, setDriveName] = useState('');
  const [drivePrivacy, setDrivePrivacy] = useState<'public' | 'private'>('private');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveNameError, setDriveNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!isOpen) return null;

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

    // Clear error if valid
    setDriveNameError(null);
    return true;
  };

  const handleDriveNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    if (newName.length <= 32) {
      setDriveName(newName);
      validateDriveNameRealtime(newName);
    }
  };

  const validatePassword = (): boolean => {
    if (drivePrivacy === 'private') {
      if (!password) {
        setPasswordError('Password is required for private drives');
        return false;
      }
      if (password.length < 8) {
        setPasswordError('Password must be at least 8 characters');
        return false;
      }
      if (password !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return false;
      }
    }
    setPasswordError(null);
    return true;
  };

  const handleCreateDrive = async () => {
    if (!driveName.trim()) {
      setDriveNameError('Please enter a drive name');
      return;
    }

    if (!validateDriveNameRealtime(driveName)) {
      return;
    }

    if (!validatePassword()) {
      return;
    }

    if (!currentSyncFolder) {
      setError('No sync folder configured. Please set up a sync folder first.');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      // Create the drive.
      // UX-3: both drive:create and drive:create-private now return the same
      // IpcResult envelope. PRIV-3 root cause was that the private path used
      // {success,data} while the public path returned the raw drive, so the old
      // code read `.id` off the wrapper and every private creation reported
      // failure AFTER the user had already paid on-chain. Now the shapes agree
      // and the compiler enforces the `.success`/`.data` unwrap.
      const result = drivePrivacy === 'private'
        ? await window.electronAPI.drive.createPrivate(driveName.trim(), password)
        : await window.electronAPI.drive.create(driveName.trim(), drivePrivacy);

      // Defensive against a nullish result (IPC bridge failure): never assume
      // a charge succeeded — treat anything but an explicit success as failure.
      if (!result || !result.success) {
        const errorMessage = result && !result.success ? result.error : undefined;
        throw new Error(errorMessage || 'Failed to create drive. Please try again.');
      }

      const drive = result.data;
      if (!drive || !drive.id) {
        throw new Error('Failed to create drive. Please try again.');
      }

      // Create local folder inside existing sync directory
      const driveFolderName = driveName.trim();
      const pathSeparator = currentSyncFolder.includes('\\') ? '\\' : '/';
      const driveFolderPath = `${currentSyncFolder}${currentSyncFolder.endsWith(pathSeparator) ? '' : pathSeparator}${driveFolderName}`;

      // Create the drive mapping
      const driveMapping = {
        // qa-gate finding: without an id the PRIMARY KEY is NULL and every
        // later updateDriveMapping/removeDriveMapping silently no-ops
        // (Settings folder change, rename). Same convention as
        // DriveAndSyncSetup: drive id doubles as the mapping id.
        id: drive.id,
        driveId: drive.id,
        driveName: drive.name,
        drivePrivacy: drive.privacy || drivePrivacy,
        localFolderPath: driveFolderPath,
        rootFolderId: drive.rootFolderId,
        isActive: true,
        syncSettings: {
          syncDirection: 'bidirectional' as const,
          maxFileSize: 100 * 1024 * 1024, // 100MB default
          uploadPriority: 0
        }
      };

      // Add the drive mapping via IPC (UX-3: unwrap the envelope)
      const addMappingResult = await window.electronAPI.driveMappings.add(driveMapping);
      if (!addMappingResult.success) {
        throw new Error(addMappingResult.error || 'Failed to save the drive mapping');
      }

      // Set as active drive
      const setActiveResult = await window.electronAPI.drive.setActive(drive.id);
      if (!setActiveResult.success) {
        throw new Error(setActiveResult.error || 'Failed to set the new drive as active.');
      }

      // TODO: In the future, support different sync folders per drive
      // For now, all drives use subfolders in the main sync folder

      // Notify parent and close
      onDriveCreated(drive);
      onClose();
    } catch (err) {
      console.error('Failed to create drive:', err);
      setError(err instanceof Error ? err.message : 'Failed to create drive');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="drive-modal-overlay">
      <div className="drive-modal-panel size-md">
        {/* Header */}
        <div className="drive-modal-header">
          <h2 className="drive-modal-title">
            <HardDrive size={24} />
            Create New Drive
          </h2>
          <button
            className="drive-modal-close"
            onClick={onClose}
            disabled={isCreating}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="modal-banner is-error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Drive Name Input */}
        <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
          <label>Drive Name</label>
          <input
            type="text"
            className={driveNameError ? 'is-invalid' : ''}
            value={driveName}
            onChange={handleDriveNameChange}
            placeholder="Enter drive name (e.g., Personal Files, Work Documents)"
          />
          <small style={driveNameError ? { color: 'var(--danger-fg)' } : undefined}>
            {driveNameError || `${driveName.length}/32 characters`}
          </small>
        </div>

        {/* Drive Privacy Selection */}
        <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
          <label>Drive Privacy</label>

          <div className="drive-privacy-options">
            <button
              className={`drive-privacy-option ${drivePrivacy === 'private' ? 'is-selected' : ''}`}
              onClick={() => {
                setDrivePrivacy('private');
                setPasswordError(null);
              }}
              disabled={isCreating}
            >
              <Lock size={20} />
              <div className="drive-privacy-option-title">Private</div>
              <div className="drive-privacy-option-desc">End-to-end encrypted</div>
            </button>

            <button
              className={`drive-privacy-option ${drivePrivacy === 'public' ? 'is-selected' : ''}`}
              onClick={() => {
                setDrivePrivacy('public');
                setPassword('');
                setConfirmPassword('');
                setPasswordError(null);
              }}
              disabled={isCreating}
            >
              <Globe size={20} />
              <div className="drive-privacy-option-title">Public</div>
              <div className="drive-privacy-option-desc">Anyone can view</div>
            </button>
          </div>
        </div>

        {/* Password Fields for Private Drives */}
        {drivePrivacy === 'private' && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            {/* Important Security Notice */}
            <div className="security-warning">
              <ShieldAlert size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Important: This password is permanent</strong>
                Your drive password cannot be changed or recovered. If you forget this password,
                you will permanently lose access to all files in this drive. Please store it safely.
              </div>
            </div>

            {/* Password Input */}
            <div className="form-group">
              <label>Drive Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={passwordError ? 'is-invalid' : ''}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Enter a strong password"
                  disabled={isCreating}
                  style={{ paddingRight: '48px' }}
                />
                <button
                  type="button"
                  className="password-toggle-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isCreating}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm Password Input */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className={passwordError ? 'is-invalid' : ''}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Re-enter your password"
                  disabled={isCreating}
                  style={{ paddingRight: '48px' }}
                />
                <button
                  type="button"
                  className="password-toggle-eye"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isCreating}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <small style={{ color: 'var(--danger-fg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AlertCircle size={14} />
                  {passwordError}
                </small>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="drive-modal-footer">
          <button
            className="button outline"
            onClick={onClose}
            disabled={isCreating}
            style={{ flex: 1 }}
          >
            Cancel
          </button>
          <button
            className={`button ${isCreating ? 'loading' : ''}`}
            onClick={handleCreateDrive}
            disabled={isCreating || !driveName.trim() || !!driveNameError || (drivePrivacy === 'private' && (!password || !confirmPassword))}
            style={{ flex: 2 }}
          >
            {isCreating ? 'Creating...' : 'Create Drive'}
          </button>
        </div>
      </div>
    </div>
  );
};
