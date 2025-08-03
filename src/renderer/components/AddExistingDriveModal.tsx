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
        maxWidth: '600px',
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
            Add Existing Drive
          </h2>
          <button
            onClick={onClose}
            disabled={isAdding}
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

        {/* Loading State */}
        {isLoading && (
          <div style={{
            textAlign: 'center',
            padding: 'var(--space-8)'
          }}>
            <div className="spinner" style={{ margin: '0 auto var(--space-4)' }} />
            <p style={{ color: 'var(--gray-600)' }}>Loading your drives...</p>
          </div>
        )}

        {/* Drive List */}
        {!isLoading && availableDrives.length > 0 && (
          <>
            <p style={{
              fontSize: '14px',
              color: 'var(--gray-600)',
              marginBottom: 'var(--space-4)'
            }}>
              Select a drive to add to this device. It will be synced to a subfolder in your current sync location.
            </p>

            <div style={{
              marginBottom: 'var(--space-6)',
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)'
            }}>
              {availableDrives.map((drive) => (
                <button
                  key={drive.id}
                  onClick={() => setSelectedDrive(drive)}
                  disabled={isAdding}
                  style={{
                    width: '100%',
                    padding: 'var(--space-4)',
                    border: 'none',
                    borderBottom: '1px solid var(--gray-100)',
                    backgroundColor: selectedDrive?.id === drive.id ? 'var(--ardrive-primary-50)' : 'white',
                    cursor: isAdding ? 'not-allowed' : 'pointer',
                    transition: 'background-color 0.2s ease',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)'
                  }}
                  onMouseEnter={(e) => {
                    if (!isAdding && selectedDrive?.id !== drive.id) {
                      e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedDrive?.id !== drive.id) {
                      e.currentTarget.style.backgroundColor = 'white';
                    }
                  }}
                >
                  {selectedDrive?.id === drive.id && (
                    <CheckCircle size={20} style={{ color: 'var(--ardrive-primary)' }} />
                  )}
                  {selectedDrive?.id !== drive.id && (
                    <div style={{ width: '20px' }} />
                  )}
                  
                  <HardDrive size={20} style={{ color: 'var(--gray-600)' }} />
                  
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontWeight: '500',
                      fontSize: '15px',
                      marginBottom: '2px'
                    }}>
                      {drive.name}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--gray-500)'
                    }}>
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
                    <Lock size={16} style={{ color: 'var(--gray-400)' }} />
                  ) : (
                    <Globe size={16} style={{ color: 'var(--gray-400)' }} />
                  )}
                </button>
              ))}
            </div>

            {/* Selected Drive Info */}
            {selectedDrive && currentSyncFolder && (
              <div style={{
                padding: 'var(--space-3)',
                backgroundColor: 'var(--gray-50)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
                fontSize: '13px',
                color: 'var(--gray-700)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <FolderOpen size={16} />
                  <span>Will be synced to: <strong>{currentSyncFolder}/{selectedDrive.name}</strong></span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Action Buttons */}
        {!isLoading && availableDrives.length > 0 && (
          <div style={{
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'flex-end'
          }}>
            <button
              onClick={onClose}
              disabled={isAdding}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                border: '1px solid var(--gray-300)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'white',
                cursor: isAdding ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--gray-700)',
                transition: 'all 0.2s ease'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddDrive}
              disabled={isAdding || !selectedDrive}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                backgroundColor: isAdding || !selectedDrive
                  ? 'var(--gray-300)' 
                  : 'var(--ardrive-primary)',
                color: 'white',
                cursor: isAdding || !selectedDrive ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'all 0.2s ease'
              }}
            >
              {isAdding ? 'Adding...' : 'Add Drive'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};