import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, HardDrive, Lock, Globe, Star } from 'lucide-react';
import { DriveInfo, DriveInfoWithStatus } from '../../types';
import { PrivateDriveUnlockModal } from './PrivateDriveUnlockModal';

interface DriveSelectorProps {
  currentDrive: DriveInfo | null;
  drives: DriveInfoWithStatus[];
  isLoading: boolean;
  onDriveSelect: (driveId: string) => void;
  onCreateDrive: () => void;
  onAddExistingDrive: () => void;
}

export const DriveSelector: React.FC<DriveSelectorProps> = ({
  currentDrive,
  drives,
  isLoading,
  onDriveSelect,
  onCreateDrive,
  onAddExistingDrive
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [selectedLockedDrive, setSelectedLockedDrive] = useState<DriveInfoWithStatus | null>(null);
  // PRIV-4: optimistic per-drive "remembered" state for the settings toggle,
  // seeded from drive.isRemembered and updated as the user toggles.
  const [persistenceOverride, setPersistenceOverride] = useState<Record<string, boolean>>({});
  const [persistenceBusy, setPersistenceBusy] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleDriveClick = (drive: DriveInfoWithStatus) => {
    if (drive.id === currentDrive?.id) {
      setIsOpen(false);
      return;
    }

    // If it's a locked private drive, show unlock modal
    if (drive.privacy === 'private' && drive.isLocked) {
      setSelectedLockedDrive(drive);
      setShowUnlockModal(true);
      setIsOpen(false);
      return;
    }

    // Otherwise, select the drive normally
    onDriveSelect(drive.id);
    setIsOpen(false);
  };

  const handleUnlockSuccess = async (
    password: string,
    persistKey: boolean
  ): Promise<{ success: boolean; error?: string }> => {
    if (!selectedLockedDrive) return { success: false, error: 'No drive selected.' };

    try {
      // drive:unlock returns the IpcResult envelope (UX-3). Reading it as a
      // boolean made {success:false} look like a successful unlock (audit §5.3).
      // PRIV-2: only a verified unlock selects the drive; on failure the
      // envelope's `error` (wrong password vs. network) reaches the modal.
      // PRIV-4: persistKey forwards the "remember this drive" choice.
      const result = await window.electronAPI.drive.unlock(selectedLockedDrive.id, password, persistKey);
      if (result.success) {
        onDriveSelect(selectedLockedDrive.id);
        setShowUnlockModal(false);
        setSelectedLockedDrive(null);
        return { success: true };
      }
      return { success: false, error: result.error };
    } catch (error) {
      console.error('Failed to unlock drive:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unlock drive. Please try again.',
      };
    }
  };

  const handleUnlockCancel = () => {
    setShowUnlockModal(false);
    setSelectedLockedDrive(null);
  };

  const isDriveRemembered = (drive: DriveInfoWithStatus): boolean =>
    persistenceOverride[drive.id] ?? drive.isRemembered ?? false;

  // PRIV-4 settings toggle: opt an unlocked private drive in/out of persistence.
  const handleTogglePersistence = async (
    drive: DriveInfoWithStatus,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (persistenceBusy[drive.id]) return;

    const next = !isDriveRemembered(drive);
    setPersistenceBusy(prev => ({ ...prev, [drive.id]: true }));
    try {
      const result = await window.electronAPI.drive.setPersistence(drive.id, next);
      // Only reflect the change if main confirms it (needs unlocked drive +
      // session password); otherwise leave the prior state.
      if (result.success && result.data === true) {
        setPersistenceOverride(prev => ({ ...prev, [drive.id]: next }));
      }
    } catch (error) {
      console.error('Failed to update drive persistence:', error);
    } finally {
      setPersistenceBusy(prev => ({ ...prev, [drive.id]: false }));
    }
  };

  return (
    <div className="drive-selector" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        className="drive-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-2) var(--space-3)',
          backgroundColor: 'white',
          border: '1px solid var(--gray-300)',
          borderRadius: 'var(--radius-md)',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--gray-900)',
          transition: 'all 0.2s ease',
          minWidth: '200px',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HardDrive size={16} />
          <span>{isLoading ? 'Loading...' : (currentDrive?.name || 'Select Drive')}</span>
        </div>
        <ChevronDown 
          size={16} 
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        />
      </button>

      {isOpen && !isLoading && (
        <div
          className="drive-selector-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 'var(--space-1)',
            backgroundColor: 'white',
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            maxHeight: '300px',
            overflowY: 'auto',
            minWidth: '200px'
          }}
        >
          {drives.map((drive) => (
            <div key={drive.id}>
            <button
              className="drive-option"
              onClick={() => handleDriveClick(drive)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                width: '100%',
                padding: 'var(--space-3)',
                backgroundColor: currentDrive?.id === drive.id ? 'var(--ardrive-primary-50)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: 'var(--gray-900)',
                transition: 'background-color 0.2s ease',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                if (currentDrive?.id !== drive.id) {
                  e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentDrive?.id !== drive.id) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {currentDrive?.id === drive.id && (
                <Check size={16} style={{ color: 'var(--ardrive-primary)' }} />
              )}
              {currentDrive?.id !== drive.id && (
                <div style={{ width: '16px' }} />
              )}
              <HardDrive size={16} />
              <span style={{ flex: 1 }}>
                {drive.name}
                {drive.privacy === 'private' && drive.isLocked && drive.emojiFingerprint && (
                  <span style={{ marginLeft: '8px', fontSize: '12px' }}>
                    {drive.emojiFingerprint}
                  </span>
                )}
              </span>
              {drive.privacy === 'private' ? (
                <Lock size={14} style={{ opacity: drive.isLocked ? 0.8 : 0.6, color: drive.isLocked ? 'var(--warning-600)' : 'var(--gray-500)' }} />
              ) : (
                <Globe size={14} style={{ opacity: 0.6 }} />
              )}
            </button>

            {/* PRIV-4: remember/forget this drive (only for unlocked private drives) */}
            {drive.privacy === 'private' && !drive.isLocked && (
              <button
                className="drive-remember-toggle"
                onClick={(e) => handleTogglePersistence(drive, e)}
                disabled={!!persistenceBusy[drive.id]}
                title={isDriveRemembered(drive)
                  ? 'This drive auto-unlocks on this device. Click to forget.'
                  : 'Remember this drive so it auto-unlocks on this device.'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  width: '100%',
                  padding: '6px var(--space-3) 8px',
                  paddingLeft: '40px',
                  background: 'transparent',
                  border: 'none',
                  cursor: persistenceBusy[drive.id] ? 'wait' : 'pointer',
                  fontSize: '12px',
                  color: isDriveRemembered(drive) ? 'var(--ardrive-primary)' : 'var(--gray-500)',
                  textAlign: 'left'
                }}
              >
                <Star
                  size={12}
                  style={{ fill: isDriveRemembered(drive) ? 'var(--ardrive-primary)' : 'none' }}
                />
                <span>{isDriveRemembered(drive) ? 'Remembered · Forget' : 'Remember this drive'}</span>
              </button>
            )}
            </div>
          ))}
          
          <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: '4px', paddingTop: '4px' }}>
            <button
              className="add-existing-drive-option"
              onClick={() => {
                setIsOpen(false);
                onAddExistingDrive();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: 'var(--ardrive-primary)',
                transition: 'background-color 0.2s ease',
                textAlign: 'left',
                fontWeight: 500
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-50)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Plus size={16} />
              <span>Add Existing Drive</span>
            </button>
            
            <button
              className="create-drive-option"
              onClick={() => {
                setIsOpen(false);
                onCreateDrive();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                color: 'var(--ardrive-primary)',
                transition: 'background-color 0.2s ease',
                textAlign: 'left',
                fontWeight: 500
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--gray-50)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <Plus size={16} />
              <span>Create New Drive</span>
            </button>
          </div>
        </div>
      )}

      {/* Private Drive Unlock Modal */}
      {selectedLockedDrive && (
        <PrivateDriveUnlockModal
          drive={selectedLockedDrive}
          isOpen={showUnlockModal}
          onUnlock={handleUnlockSuccess}
          onCancel={handleUnlockCancel}
        />
      )}
    </div>
  );
};