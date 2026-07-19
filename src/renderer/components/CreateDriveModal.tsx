import React, { useState } from 'react';
import { X, HardDrive, Globe, Lock, AlertCircle, Eye, EyeOff, ShieldAlert, Zap } from 'lucide-react';
import { InfoButton } from './common/InfoButton';
import { useModalA11y } from '../hooks/useModalA11y';

interface CreateDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDriveCreated: (drive: any) => void;
  currentSyncFolder?: string;
  // UX-15: only one drive syncs at a time in this beta (D-010), and this
  // modal makes the new drive active immediately on creation. When the user
  // already has other drives, that silently stops whichever one was syncing
  // before — say so, rather than let the "will sync" promise below read as
  // additive.
  hasExistingDrives?: boolean;
}

export const CreateDriveModal: React.FC<CreateDriveModalProps> = ({
  isOpen,
  onClose,
  onDriveCreated,
  currentSyncFolder,
  hasExistingDrives
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

  // A11Y-3: Escape closes, backdrop click closes, focus is trapped inside the
  // panel, and focus returns to whatever triggered the modal on close.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

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

    // Clear error if valid
    setDriveNameError(null);
    return true;
  };

  const handleDriveNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    if (newName.length <= 100) {
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
          maxFileSize: 2 * 1024 * 1024 * 1024, // 2 GiB default (D-014; matches MAX_SYNC_FILE_SIZE_BYTES)
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
    <div className="drive-modal-overlay" onClick={handleBackdropClick}>
      <div
        className="drive-modal-panel size-md"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-drive-modal-title"
      >
        {/* Header */}
        <div className="drive-modal-header">
          <h2 className="drive-modal-title" id="create-drive-modal-title">
            <HardDrive size={24} />
            Create New Drive
            {/* INFO-8: "what is a drive" had no explanation reachable from
                the one screen that creates one. */}
            <InfoButton tooltip="A drive is your own permanent storage space on Arweave — like a top-level folder that lives on the network forever. This local folder is just a mirror of it; you can move or delete the folder without affecting the drive." />
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
          <label htmlFor="create-drive-name">Drive Name</label>
          <input
            id="create-drive-name"
            type="text"
            className={driveNameError ? 'is-invalid' : ''}
            value={driveName}
            onChange={handleDriveNameChange}
            placeholder="Enter drive name (e.g., Personal Files, Work Documents)"
          />
          {/* POLISH-15: warn as the char limit approaches, matching the
              near-limit treatment DriveAndSyncSetup already applies to its
              own drive-name field. H-COPY-2: limit raised from 32 to 100 to
              match input-validator.ts's MAX_DRIVE_NAME_LENGTH; warning
              threshold scaled proportionally (was 28/32, now 90/100). */}
          <small
            style={{
              color: driveNameError
                ? 'var(--danger-fg)'
                : driveName.length > 90
                  ? 'var(--warning-fg)'
                  : undefined
            }}
          >
            {driveNameError || `${driveName.length}/100 characters`}
          </small>
        </div>

        {/* Drive Privacy Selection */}
        <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
          <label id="create-drive-privacy-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            Drive Privacy
          </label>

          <div className="drive-privacy-options" role="group" aria-labelledby="create-drive-privacy-label">
            <div className="drive-privacy-option-wrap">
              <button
                type="button"
                className={`drive-privacy-option ${drivePrivacy === 'private' ? 'is-selected' : ''}`}
                onClick={() => {
                  setDrivePrivacy('private');
                  setPasswordError(null);
                }}
                disabled={isCreating}
                aria-pressed={drivePrivacy === 'private'}
              >
                <Lock size={20} />
                <div className="drive-privacy-option-title">Private</div>
                <div className="drive-privacy-option-desc">End-to-end encrypted, forever</div>
              </button>
              <InfoButton
                className="drive-privacy-option-info"
                tooltip="Files are encrypted with your password before they ever leave your device. ArDrive never sees or stores this password — if you forget it, no one can recover access to this drive."
              />
            </div>

            <div className="drive-privacy-option-wrap">
              <button
                type="button"
                className={`drive-privacy-option ${drivePrivacy === 'public' ? 'is-selected' : ''}`}
                onClick={() => {
                  setDrivePrivacy('public');
                  setPassword('');
                  setConfirmPassword('');
                  setPasswordError(null);
                }}
                disabled={isCreating}
                aria-pressed={drivePrivacy === 'public'}
              >
                <Globe size={20} />
                <div className="drive-privacy-option-title">Public</div>
                <div className="drive-privacy-option-desc">Anyone can view, forever</div>
              </button>
              <InfoButton
                className="drive-privacy-option-info"
                tooltip="Anyone with the link can view these files, forever, once uploaded. Don't use a public drive for anything sensitive."
              />
            </div>
          </div>
          {/* COPY-1/COPY-2: neither privacy option said anything about
              permanence, and nothing disclosed that the choice is locked in
              after creation. COPY-6: sync direction was hardcoded and never
              surfaced anywhere in the UI. */}
          <p className="drive-privacy-permanence-note">
            Once uploaded to Arweave, files in this drive can&apos;t be edited or deleted — by
            you or anyone else. This privacy choice can&apos;t be changed after the drive is
            created. Files will sync both ways between this drive and your local folder.
            {hasExistingDrives && (
              // UX-15: true consequence of "isActive: true" + drive:setActive
              // in handleCreateDrive below — this new drive becomes the one
              // drive that syncs, and whatever was syncing before stops.
              ' Only one drive syncs at a time in this beta, so this new drive will'
              + ' become the one that syncs — your other drives stay connected but pause.'
            )}
          </p>
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
              <label htmlFor="create-drive-password">Drive Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="create-drive-password"
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
              <label htmlFor="create-drive-confirm-password">Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="create-drive-confirm-password"
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

        {/* COPY-3: drive creation showed zero cost/balance information —
            unlike CreateManifestModal / the rename-drive flow, which both
            disclose "FREE with Turbo Credits" upfront. Drive + root-folder
            records are tiny (well under the Turbo free-tier threshold), so
            this is always free in this app — Turbo is the only upload path
            wired up for drive creation, there's no AR-direct fallback. */}
        <div className="modal-banner is-neutral">
          <Zap size={16} />
          <span>
            Creating a drive doesn&apos;t cost any AR — the drive and folder records are
            tiny, so they&apos;re covered automatically by Turbo Credits at no charge.
          </span>
        </div>

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
