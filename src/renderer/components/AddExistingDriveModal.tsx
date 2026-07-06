import React, { useState, useEffect } from 'react';
import { X, HardDrive, Globe, Lock, AlertCircle, FolderOpen, CheckCircle } from 'lucide-react';
import { DriveInfo } from '../../types';
import { InfoButton } from './common/InfoButton';
import { useModalA11y } from '../hooks/useModalA11y';

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

  // A11Y-3: Escape closes, backdrop click closes, focus trapped, focus
  // returns to the trigger on close — shared with the other 3 drive modals.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      loadAvailableDrives();
    }
  }, [isOpen]);

  const loadAvailableDrives = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Get all drives from the wallet (UX-3: IpcResult envelope)
      const allDrivesResult = await window.electronAPI.drive.getAll();
      if (!allDrivesResult.success) {
        throw new Error(allDrivesResult.error || 'Failed to load your drives.');
      }

      // Filter out drives that are already mapped
      const unmappedDrives = allDrivesResult.data.filter(
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

      // Add the drive mapping via IPC (UX-3: unwrap the envelope)
      const addMappingResult = await window.electronAPI.driveMappings.add(driveMapping);
      if (!addMappingResult.success) {
        throw new Error(addMappingResult.error || 'Failed to add the drive');
      }

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
    <div className="drive-modal-overlay" onClick={handleBackdropClick}>
      <div
        className="drive-modal-panel size-lg"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-existing-drive-modal-title"
      >
        {/* Header */}
        <div className="drive-modal-header">
          <h2 className="drive-modal-title" id="add-existing-drive-modal-title">
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
            {/* A <div>, not a <p>: InfoButton renders a <div> root, and a
                <div> isn't valid phrasing content inside a <p>. */}
            <div style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-4)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-1)'
            }}>
              {/* UX-15: adding a drive maps it, but the mapping starts inactive
                  (isActive: false below) — only the app's one active drive
                  actually syncs (D-010). Saying "will be synced" here was
                  simply false for any drive beyond the first. */}
              <span>
                Select a drive to add to this device. A local subfolder will be created for it
                in your current sync location. Only one drive syncs at a time in this beta, so
                this drive stays connected but won&apos;t sync unless you switch to it.
              </span>
              {/* INFO-8 / COPY-6: what a drive actually is, and that the local
                  folder mirrors it bidirectionally, was explained nowhere. */}
              <InfoButton tooltip="A drive is your own permanent storage space on Arweave — like a top-level folder that lives on the network forever. This local folder is just a mirror of it: files sync both ways, so a local delete or a remote change can propagate to the other side. In this beta, that mirroring only happens for whichever one drive is currently active." />
            </div>

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
            {/* UX-15: "Will be synced to" overstated it — the mapping is
                created inactive, so nothing syncs here until this drive is
                made the active one. "Local folder" is what's actually and
                unconditionally true the moment this action completes. */}
            {selectedDrive && currentSyncFolder && (
              <div className="modal-banner is-neutral" style={{ marginBottom: 'var(--space-4)' }}>
                <FolderOpen size={16} />
                <span>Local folder: <strong>{currentSyncFolder}/{selectedDrive.name}</strong></span>
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
