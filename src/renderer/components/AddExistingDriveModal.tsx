import React, { useState, useEffect } from 'react';
import { X, HardDrive, Globe, Lock, AlertCircle, FolderOpen, CheckCircle } from 'lucide-react';
import { DriveInfo } from '../../types';

interface AddExistingDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDriveAdded: (drive: DriveInfo) => void;
  currentSyncFolder?: string;
  existingDriveIds: string[]; // Drive IDs that are already mapped
}

export const AddExistingDriveModal: React.FC<AddExistingDriveModalProps> = ({
  isOpen,
  onClose,
  onDriveAdded,
  currentSyncFolder,
  existingDriveIds = []
}) => {
  const [availableDrives, setAvailableDrives] = useState<DriveInfo[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<DriveInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadAvailableDrives();
    }
  }, [isOpen]);

  const loadAvailableDrives = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Get all drives from the wallet
      const allDrives = await window.electronAPI.drive.getAll();

      // Filter out drives that are already mapped
      const unmappedDrives = allDrives.filter(
        (drive: DriveInfo) => !existingDriveIds.includes(drive.id)
      );

      setAvailableDrives(unmappedDrives);

      if (unmappedDrives.length === 0) {
        setError('All your drives are already added to this device.');
      }
    } catch (err) {
      console.error('Failed to load drives:', err);
      setError('Failed to load your drives. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddDrive = async () => {
    if (!selectedDrive || !currentSyncFolder) return;

    try {
      setIsAdding(true);
      setError(null);

      // Create local folder inside existing sync directory
      const driveFolderName = selectedDrive.name;
      const pathSeparator = currentSyncFolder.includes('\\') ? '\\' : '/';
      const driveFolderPath = `${currentSyncFolder}${currentSyncFolder.endsWith(pathSeparator) ? '' : pathSeparator}${driveFolderName}`;

      // Create the drive mapping
      const driveMapping = {
        // qa-gate finding (PRIV-3): id must be set or the mapping row's
        // PRIMARY KEY is NULL and updates/removals silently no-op.
        id: selectedDrive.id,
        driveId: selectedDrive.id,
        driveName: selectedDrive.name,
        drivePrivacy: selectedDrive.privacy || 'private',
        localFolderPath: driveFolderPath,
        rootFolderId: selectedDrive.rootFolderId,
        isActive: false, // Not active by default when adding additional drives
        syncSettings: {
          syncDirection: 'bidirectional' as const,
          maxFileSize: 100 * 1024 * 1024, // 100MB default
          uploadPriority: 0
        }
      };

      // Add the drive mapping via IPC
      await window.electronAPI.driveMappings.add(driveMapping);

      // Notify parent and close
      onDriveAdded(selectedDrive);
      onClose();
    } catch (err) {
      console.error('Failed to add drive:', err);
      setError(err instanceof Error ? err.message : 'Failed to add drive');
    } finally {
      setIsAdding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="drive-modal-overlay">
      <div className="drive-modal-panel size-lg">
        {/* Header */}
        <div className="drive-modal-header">
          <h2 className="drive-modal-title">
            <HardDrive size={24} />
            Add Existing Drive
          </h2>
          <button
            className="drive-modal-close"
            onClick={onClose}
            disabled={isAdding}
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

        {/* Loading State */}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
            <div className="loading-spinner" style={{ margin: '0 auto var(--space-4)' }} />
            <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-4)' }}>Loading your drives...</p>
          </div>
        )}

        {/* Drive List */}
        {!isLoading && availableDrives.length > 0 && (
          <>
            <p style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-4)'
            }}>
              Select a drive to add to this device. It will be synced to a subfolder in your current sync location.
            </p>

            <div className="drive-list">
              {availableDrives.map((drive) => (
                <button
                  key={drive.id}
                  className={`drive-list-item ${selectedDrive?.id === drive.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedDrive(drive)}
                  disabled={isAdding}
                >
                  {selectedDrive?.id === drive.id ? (
                    <CheckCircle size={20} className="drive-list-item-check" />
                  ) : (
                    <div style={{ width: '20px', flexShrink: 0 }} />
                  )}

                  <HardDrive size={20} className="drive-list-item-icon" />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="drive-list-item-name">{drive.name}</div>
                    <div className="drive-list-item-meta">
                      Created {(() => {
                        try {
                          if (!drive.dateCreated || drive.dateCreated <= 0) return 'Unknown date';
                          const date = new Date(drive.dateCreated);
                          return isNaN(date.getTime()) ? 'Invalid date' : date.toLocaleDateString();
                        } catch {
                          return 'Invalid date';
                        }
                      })()}
                    </div>
                  </div>

                  {drive.privacy === 'private' ? (
                    <Lock size={16} className="drive-list-item-privacy-icon" />
                  ) : (
                    <Globe size={16} className="drive-list-item-privacy-icon" />
                  )}
                </button>
              ))}
            </div>

            {/* Selected Drive Info */}
            {selectedDrive && currentSyncFolder && (
              <div className="modal-banner is-neutral" style={{ marginBottom: 'var(--space-4)' }}>
                <FolderOpen size={16} />
                <span>Will be synced to: <strong>{currentSyncFolder}/{selectedDrive.name}</strong></span>
              </div>
            )}
          </>
        )}

        {/* Action Buttons */}
        {!isLoading && availableDrives.length > 0 && (
          <div className="drive-modal-footer">
            <button
              className="button outline"
              onClick={onClose}
              disabled={isAdding}
            >
              Cancel
            </button>
            <button
              className={`button ${isAdding ? 'loading' : ''}`}
              onClick={handleAddDrive}
              disabled={isAdding || !selectedDrive}
            >
              {isAdding ? 'Adding...' : 'Add Drive'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
