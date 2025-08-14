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
      const success = await window.electronAPI.drive.unlock(selectedLockedDrive.id, password);
      if (success) {
        onDriveSelect(selectedLockedDrive.id);
        setShowUnlockModal(false);
        setSelectedLockedDrive(null);
      }
      return success;
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
            <button
              key={drive.id}
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