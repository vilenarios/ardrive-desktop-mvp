import React, { useState } from 'react';
import { DriveInfo } from '../../types';
import { Cloud, Plus, FolderOpen, Lock, Globe, ArrowRight, Zap } from 'lucide-react';
import { isArDriveOperationFree } from '../../utils/turbo-utils';

interface DriveManagerProps {
  drives: DriveInfo[];
  onDriveSelected: (drive: DriveInfo) => void;
  onDriveCreated: () => void;
  onCancel?: () => void; // Optional cancel/back functionality
  selectedDriveId?: string; // Current selected drive ID to highlight
}

const DriveManager: React.FC<DriveManagerProps> = ({ 
  drives, 
  onDriveSelected, 
  onDriveCreated,
  onCancel,
  selectedDriveId
}) => {
  const [newDriveName, setNewDriveName] = useState('');
  const [driveType, setDriveType] = useState<'private' | 'public'>('public');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSelectDrive = async (drive: DriveInfo) => {
    try {
      setLoading(true);
      setError(null);
      
      // The backend now returns drive info instead of just setting it
      const selectedDrive = await window.electronAPI.drive.select(drive.id);
      
      setSuccess('Drive selected successfully!');
      setTimeout(() => {
        onDriveSelected(selectedDrive || drive);
      }, 1000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select drive');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDrive = async () => {
    if (!newDriveName.trim()) {
      setError('Please enter a drive name');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      await window.electronAPI.drive.create(newDriveName.trim(), driveType);
      
      setNewDriveName('');
      setSuccess('Drive created successfully!');
      setTimeout(() => {
        onDriveCreated();
      }, 1000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create drive');
    } finally {
      setLoading(false);
    }
  };

  const isFirstTimeUser = drives.length === 0;

  return (
    <div className="fade-in" style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: 'var(--space-6)'
    }}>
      <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Cloud size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-4)' }} />
          <h2 style={{ marginBottom: 'var(--space-3)' }}>
            {isFirstTimeUser ? 'Create Your Drive' : 'Your Drive'}
          </h2>
          <p className="text-gray-600" style={{ fontSize: '16px', lineHeight: '1.6' }}>
            {isFirstTimeUser 
              ? 'A drive is your personal space on Arweave. All your files will be organized in this drive.'
              : 'You can replace your current drive with a new one. This will not delete files from Arweave.'}
          </p>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {success && (
          <div className="success-message">
            {success}
          </div>
        )}

        {!isFirstTimeUser && (
          <>
            {/* Back button for existing users */}
            {onCancel && (
              <button 
                className="button outline small" 
                onClick={onCancel}
                style={{ marginBottom: 'var(--space-4)' }}
              >
                ← Back to Dashboard
              </button>
            )}
            
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <h3 style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <FolderOpen size={20} />
                Your Drives
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {drives.map((drive) => {
                  const isCurrentlySelected = drive.id === selectedDriveId;
                  return (
                    <div 
                      key={drive.id} 
                      className="drive-item"
                      style={{
                        border: isCurrentlySelected ? '2px solid var(--ardrive-primary)' : '2px solid var(--gray-300)',
                        backgroundColor: isCurrentlySelected ? 'var(--ardrive-primary-100)' : 'white',
                        borderRadius: 'var(--radius-lg)',
                        padding: 'var(--space-5)',
                        transition: 'all 0.2s ease',
                        cursor: 'pointer'
                      }}
                      onClick={() => !loading && handleSelectDrive(drive)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            backgroundColor: drive.privacy === 'public' ? 'var(--ardrive-secondary-light)' : 'var(--gray-200)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {drive.privacy === 'public' ? <Globe size={20} /> : <Lock size={20} />}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600', fontSize: '16px', marginBottom: 'var(--space-1)' }}>
                              {drive.name}
                              {isCurrentlySelected && (
                                <span style={{ 
                                  color: 'var(--ardrive-primary)', 
                                  fontSize: '12px',
                                  fontWeight: '400',
                                  marginLeft: 'var(--space-2)' 
                                }}>
                                  (Current)
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>
                              {drive.privacy === 'public' ? 'Public' : 'Private'} Drive • {drive.id.slice(0, 8)}...
                            </div>
                          </div>
                        </div>
                        <ArrowRight size={20} style={{ color: 'var(--gray-400)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div style={{ 
              borderTop: '1px solid var(--gray-200)', 
              paddingTop: 'var(--space-6)',
              marginTop: 'var(--space-6)'
            }}>
              <h3 style={{ 
            marginBottom: 'var(--space-4)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 'var(--space-2)' 
          }}>
            <Plus size={20} />
            Create New Drive
          </h3>

          {/* Free with Turbo notification */}
          <div style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--success-50)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--success-200)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)'
          }}>
            <Zap size={20} style={{ color: 'var(--success-600)', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ fontWeight: '600', color: 'var(--success-900)', marginBottom: 'var(--space-1)' }}>
                Free with Turbo!
              </p>
              <p style={{ fontSize: '14px', color: 'var(--success-700)' }}>
                Creating drives is free thanks to Turbo. Drive metadata is under 100KB and costs no credits.
              </p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Drive Type</label>
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <button
                type="button"
                className={`button outline ${driveType === 'private' ? 'active' : ''}`}
                onClick={() => setDriveType('private')}
                disabled={true}
                style={{ 
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  backgroundColor: 'transparent',
                  color: 'var(--gray-400)',
                  borderColor: 'var(--gray-300)',
                  opacity: 0.5,
                  cursor: 'not-allowed'
                }}
                title="Private drives coming soon"
              >
                <Lock size={16} />
                Private (Soon)
              </button>
              <button
                type="button"
                className={`button outline ${driveType === 'public' ? 'active' : ''}`}
                onClick={() => setDriveType('public')}
                disabled={loading}
                style={{ 
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  backgroundColor: driveType === 'public' ? 'var(--ardrive-primary)' : 'transparent',
                  color: driveType === 'public' ? 'white' : 'var(--gray-700)',
                  borderColor: driveType === 'public' ? 'var(--ardrive-primary)' : 'var(--gray-300)'
                }}
              >
                <Globe size={16} />
                Public
              </button>
            </div>
            <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: 'var(--space-4)' }}>
              {driveType === 'private' 
                ? 'Encrypted drives keep your files private and secure.' 
                : 'Public drives are visible to everyone and cannot be encrypted.'}
            </p>
          </div>
          
          <div className="form-group">
            <label>Drive Name</label>
            <input
              type="text"
              value={newDriveName}
              onChange={(e) => setNewDriveName(e.target.value)}
              placeholder={isFirstTimeUser ? "e.g., My Documents, Work Files, Photos" : "Enter a name for your new drive"}
              disabled={loading}
              style={{ fontSize: '16px' }}
            />
          </div>
          
          <button
            className="button large"
            onClick={handleCreateDrive}
            disabled={loading || !newDriveName.trim()}
            style={{ width: '100%' }}
          >
            {loading ? (
              <>
                <div style={{ 
                  width: '16px', 
                  height: '16px', 
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTop: '2px solid white',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginRight: 'var(--space-2)'
                }} />
                Creating Drive...
              </>
            ) : (
              <>
                <Plus size={18} style={{ marginRight: 'var(--space-2)' }} />
                Create Drive
              </>
            )}
          </button>
            </div>
          </>
        )}

        {/* Info Box */}
        <div style={{ 
          marginTop: 'var(--space-6)', 
          padding: 'var(--space-4)',
          backgroundColor: 'var(--gray-50)', 
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--gray-200)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
            <Globe size={16} style={{ color: 'var(--ardrive-primary)', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: 'var(--space-1)' }}>
                Public Drives Only (MVP)
              </h4>
              <p style={{ fontSize: '13px', color: 'var(--gray-600)', lineHeight: '1.5' }}>
                This version supports public drives only. Files will be permanently stored on Arweave 
                and publicly accessible. Private drives coming soon!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriveManager;