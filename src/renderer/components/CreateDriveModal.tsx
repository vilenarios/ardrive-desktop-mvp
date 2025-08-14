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

      // Create the drive
      const drive = drivePrivacy === 'private' 
        ? await window.electronAPI.drive.createPrivate(driveName.trim(), password)
        : await window.electronAPI.drive.create(driveName.trim(), drivePrivacy);
      
      if (!drive || !drive.id) {
        throw new Error('Failed to create drive. Please try again.');
      }

      // Create local folder inside existing sync directory
      const driveFolderName = driveName.trim();
      const pathSeparator = currentSyncFolder.includes('\\') ? '\\' : '/';
      const driveFolderPath = `${currentSyncFolder}${currentSyncFolder.endsWith(pathSeparator) ? '' : pathSeparator}${driveFolderName}`;

      // Create the drive mapping
      const driveMapping = {
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
      
      // Add the drive mapping via IPC
      await window.electronAPI.driveMappings.add(driveMapping);

      // Set as active drive
      await window.electronAPI.drive.setActive(drive.id);

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
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-6)'
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <HardDrive size={24} />
            Create New Drive
          </h2>
          <button
            onClick={onClose}
            disabled={isCreating}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 'var(--space-1)',
              color: 'var(--gray-600)',
              transition: 'color 0.2s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--gray-900)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--gray-600)'}
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--error-50)',
            border: '1px solid var(--error-200)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-2)'
          }}>
            <AlertCircle size={20} style={{ color: 'var(--error-600)', flexShrink: 0 }} />
            <span style={{ fontSize: '14px', color: 'var(--error-700)' }}>{error}</span>
          </div>
        )}

        {/* Drive Name Input */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '500',
            marginBottom: 'var(--space-2)',
            color: 'var(--gray-700)'
          }}>
            Drive Name
          </label>
          <input
            type="text"
            value={driveName}
            onChange={handleDriveNameChange}
            placeholder="Enter drive name (e.g., Personal Files, Work Documents)"
            style={{
              width: '100%',
              padding: 'var(--space-3)',
              border: `1px solid ${driveNameError ? 'var(--error-500)' : 'var(--gray-300)'}`,
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              transition: 'border-color 0.2s ease'
            }}
            onFocus={(e) => {
              if (!driveNameError) {
                e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
              }
            }}
            onBlur={(e) => {
              if (!driveNameError) {
                e.currentTarget.style.borderColor = 'var(--gray-300)';
              }
            }}
          />
          <div style={{
            marginTop: 'var(--space-1)',
            minHeight: '20px'
          }}>
            {driveNameError ? (
              <span style={{ fontSize: '12px', color: 'var(--error-600)' }}>{driveNameError}</span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
                {driveName.length}/32 characters
              </span>
            )}
          </div>
        </div>

        {/* Drive Privacy Selection */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <label style={{
            display: 'block',
            fontSize: '14px',
            fontWeight: '500',
            marginBottom: 'var(--space-3)',
            color: 'var(--gray-700)'
          }}>
            Drive Privacy
          </label>
          
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              onClick={() => {
                setDrivePrivacy('private');
                setPasswordError(null);
              }}
              disabled={isCreating}
              style={{
                flex: 1,
                padding: 'var(--space-4)',
                border: `2px solid ${drivePrivacy === 'private' ? 'var(--ardrive-primary)' : 'var(--gray-300)'}`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: drivePrivacy === 'private' ? 'var(--ardrive-primary-50)' : 'white',
                cursor: isCreating ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Lock size={20} style={{ margin: '0 auto var(--space-2)' }} />
              <div style={{ fontWeight: '500', marginBottom: 'var(--space-1)' }}>Private</div>
              <div style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                End-to-end encrypted
              </div>
            </button>

            <button
              onClick={() => {
                setDrivePrivacy('public');
                setPassword('');
                setConfirmPassword('');
                setPasswordError(null);
              }}
              disabled={isCreating}
              style={{
                flex: 1,
                padding: 'var(--space-4)',
                border: `2px solid ${drivePrivacy === 'public' ? 'var(--ardrive-primary)' : 'var(--gray-300)'}`,
                borderRadius: 'var(--radius-md)',
                backgroundColor: drivePrivacy === 'public' ? 'var(--ardrive-primary-50)' : 'white',
                cursor: isCreating ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Globe size={20} style={{ margin: '0 auto var(--space-2)' }} />
              <div style={{ fontWeight: '500', marginBottom: 'var(--space-1)' }}>Public</div>
              <div style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                Anyone can view
              </div>
            </button>
          </div>
        </div>

        {/* Password Fields for Private Drives */}
        {drivePrivacy === 'private' && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            {/* Important Security Notice */}
            <div style={{
              padding: 'var(--space-4)',
              backgroundColor: 'var(--warning-50)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)',
              border: '1px solid var(--warning-200)'
            }}>
              <div style={{
                display: 'flex',
                gap: 'var(--space-3)',
                alignItems: 'flex-start'
              }}>
                <ShieldAlert size={20} style={{ color: 'var(--warning-600)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{
                    fontWeight: '600',
                    fontSize: '14px',
                    color: 'var(--warning-800)',
                    marginBottom: 'var(--space-1)'
                  }}>
                    Important: This password is permanent
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--warning-700)',
                    lineHeight: '1.4'
                  }}>
                    Your drive password cannot be changed or recovered. If you forget this password, 
                    you will permanently lose access to all files in this drive. Please store it safely.
                  </div>
                </div>
              </div>
            </div>

            {/* Password Input */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: 'var(--space-2)',
                color: 'var(--gray-700)'
              }}>
                Drive Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Enter a strong password"
                  disabled={isCreating}
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    paddingRight: '48px',
                    border: `1px solid ${passwordError ? 'var(--error-300)' : 'var(--gray-300)'}`,
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                  onFocus={(e) => {
                    if (!passwordError) {
                      e.target.style.borderColor = 'var(--ardrive-primary)';
                    }
                  }}
                  onBlur={(e) => {
                    if (!passwordError) {
                      e.target.style.borderColor = 'var(--gray-300)';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isCreating}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: isCreating ? 'not-allowed' : 'pointer',
                    color: 'var(--gray-500)',
                    padding: '4px',
                    borderRadius: '4px'
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm Password Input */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: 'var(--space-2)',
                color: 'var(--gray-700)'
              }}>
                Confirm Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Re-enter your password"
                  disabled={isCreating}
                  style={{
                    width: '100%',
                    padding: 'var(--space-3)',
                    paddingRight: '48px',
                    border: `1px solid ${passwordError ? 'var(--error-300)' : 'var(--gray-300)'}`,
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                  onFocus={(e) => {
                    if (!passwordError) {
                      e.target.style.borderColor = 'var(--ardrive-primary)';
                    }
                  }}
                  onBlur={(e) => {
                    if (!passwordError) {
                      e.target.style.borderColor = 'var(--gray-300)';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isCreating}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: isCreating ? 'not-allowed' : 'pointer',
                    color: 'var(--gray-500)',
                    padding: '4px',
                    borderRadius: '4px'
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-2)',
                  fontSize: '13px',
                  color: 'var(--error-600)'
                }}>
                  <AlertCircle size={14} />
                  {passwordError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-4)'
        }}>
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