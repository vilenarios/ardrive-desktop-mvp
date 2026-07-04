import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, HardDrive, Lock, Globe, Star } from 'lucide-react';
import { DriveInfo, DriveInfoWithStatus } from '../../types';
import { PrivateDriveUnlockModal } from './PrivateDriveUnlockModal';
import { InfoButton } from './common/InfoButton';

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
    <div className="drive-selector" ref={dropdownRef}>
      <button
        className="drive-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
      >
        <span className="drive-selector-button-label">
          <HardDrive size={16} />
          {/* POLISH-11: names still truncate at very long lengths even
              after widening the button/dropdown — a native title gives a
              full-name fallback on hover without needing another
              InfoButton (this is overflow help, not a concept to explain). */}
          <span className="drive-selector-button-name" title={currentDrive?.name || undefined}>
            {isLoading ? 'Loading...' : (currentDrive?.name || 'Select Drive')}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`drive-selector-chevron ${isOpen ? 'is-open' : ''}`}
        />
      </button>

      {isOpen && !isLoading && (
        <div className="drive-selector-dropdown">
          {drives.map((drive) => {
            const isActive = currentDrive?.id === drive.id;
            const remembered = isDriveRemembered(drive);
            return (
              <React.Fragment key={drive.id}>
                <button
                  className={`drive-selector-option ${isActive ? 'is-active' : ''}`}
                  onClick={() => handleDriveClick(drive)}
                >
                  {isActive ? (
                    <Check size={16} className="drive-selector-option-check" />
                  ) : (
                    <div className="drive-selector-option-check-spacer" />
                  )}
                  <HardDrive size={16} />
                  <span className="drive-selector-option-name" title={drive.name}>
                    {drive.name}
                    {drive.privacy === 'private' && drive.isLocked && drive.emojiFingerprint && (
                      <span className="drive-selector-option-fingerprint">
                        {drive.emojiFingerprint}
                      </span>
                    )}
                  </span>
                  {drive.privacy === 'private' ? (
                    <Lock
                      size={14}
                      className={`drive-selector-lock-icon ${drive.isLocked ? 'is-locked' : ''}`}
                    />
                  ) : (
                    <Globe size={14} className="drive-selector-globe-icon" />
                  )}
                </button>

                {/* PRIV-4: remember/forget this drive (only for unlocked private drives).
                    INFO-2: this used to explain itself only via a native
                    title= (hover-only, no keyboard/touch access). Reuses the
                    same InfoButton pattern — and the same good copy — as
                    PrivateDriveUnlockModal's "remember this drive" checkbox. */}
                {drive.privacy === 'private' && !drive.isLocked && (
                  <div className="drive-selector-remember-row">
                    <button
                      className={`drive-selector-remember-toggle ${remembered ? 'is-remembered' : ''}`}
                      onClick={(e) => handleTogglePersistence(drive, e)}
                      disabled={!!persistenceBusy[drive.id]}
                    >
                      <Star size={12} className="drive-selector-remember-star" />
                      <span>{remembered ? 'Remembered · Forget' : 'Remember this drive'}</span>
                    </button>
                    <InfoButton tooltip="Your drive's decryption key is stored encrypted on this device, so you won't be asked for this password again here. Turn off anytime." />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          <div className="drive-selector-divider">
            <button
              className="drive-selector-action"
              onClick={() => {
                setIsOpen(false);
                onAddExistingDrive();
              }}
            >
              <Plus size={16} />
              <span>Add Existing Drive</span>
            </button>

            <button
              className="drive-selector-action"
              onClick={() => {
                setIsOpen(false);
                onCreateDrive();
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
