import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, HardDrive, Lock, Globe } from 'lucide-react';
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

  const handleUnlockSuccess = async (password: string): Promise<boolean> => {
    if (!selectedLockedDrive) return false;

    try {
      // drive:unlock returns a {success, drive?/error?} envelope — reading it
      // as a boolean made {success:false} look like a successful unlock
      // (audit §5.3). PRIV-2: only a verified unlock selects the drive.
      const result = await window.electronAPI.drive.unlock(selectedLockedDrive.id, password);
      const unlocked = !!(result && (result as { success?: boolean }).success);
      if (unlocked) {
        onDriveSelect(selectedLockedDrive.id);
        setShowUnlockModal(false);
        setSelectedLockedDrive(null);
      }
      return unlocked;
    } catch (error) {
      console.error('Failed to unlock drive:', error);
      return false;
    }
  };

  const handleUnlockCancel = () => {
    setShowUnlockModal(false);
    setSelectedLockedDrive(null);
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
          <span className="drive-selector-button-name">
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
            return (
              <button
                key={drive.id}
                className={`drive-selector-option ${isActive ? 'is-active' : ''}`}
                onClick={() => handleDriveClick(drive)}
              >
                {isActive ? (
                  <Check size={16} className="drive-selector-option-check" />
                ) : (
                  <div className="drive-selector-option-check-spacer" />
                )}
                <HardDrive size={16} />
                <span className="drive-selector-option-name">
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
