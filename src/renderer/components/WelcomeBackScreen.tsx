import React, { useState, useEffect } from 'react';
import { HardDrive, Plus, FolderOpen, Calendar, Database, ArrowRight, ChevronRight, SkipForward, ArrowLeft, User } from 'lucide-react';
import { DriveInfo, Profile } from '../../types';

interface WelcomeBackScreenProps {
  currentProfile?: Profile | null;
  onDriveSelected: (drive: DriveInfo) => void;
  onCreateNewDrive: () => void;
  onSkipSetup: () => void;
  onBack?: () => void;
}

const WelcomeBackScreen: React.FC<WelcomeBackScreenProps> = ({ 
  currentProfile,
  onDriveSelected, 
  onCreateNewDrive, 
  onSkipSetup,
  onBack 
}) => {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDrives();
  }, []);

  const loadDrives = async () => {
    try {
      setLoading(true);
      const driveList = await window.electronAPI.drive.list();
      console.log('Loaded drives in WelcomeBackScreen:', driveList);
      
      // Filter out private drives since they're not supported yet
      const publicDrives = (driveList || []).filter((drive: DriveInfo) => 
        drive.privacy === 'public' && !drive.isPrivate
      );
      console.log('Filtered to public drives only:', publicDrives);
      
      setDrives(publicDrives);
      
      // Pre-select the most recent drive if there's only one
      if (publicDrives.length === 1) {
        setSelectedDriveId(publicDrives[0].id);
      }
    } catch (err) {
      console.error('Failed to load drives:', err);
      setError('Failed to load your drives');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleContinue = () => {
    const selectedDrive = drives.find(d => d.id === selectedDriveId);
    console.log('Selected drive ID:', selectedDriveId);
    console.log('Selected drive object:', selectedDrive);
    if (selectedDrive) {
      onDriveSelected(selectedDrive);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--gray-50)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            border: '4px solid var(--gray-200)',
            borderTop: '4px solid var(--ardrive-primary)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto var(--space-4)'
          }} />
          <p style={{ color: 'var(--gray-600)' }}>Loading your drives...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      background: 'var(--gray-50)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '720px',
        padding: 'var(--space-8)',
        background: 'white',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
                    
          {/* User Avatar */}
          {currentProfile && (
            <div style={{ 
              width: '64px', 
              height: '64px', 
              margin: '0 auto var(--space-4)', 
              background: 'var(--gray-100)', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              position: 'relative', 
              overflow: 'hidden',
              border: '3px solid var(--gray-200)'
            }}>
              {currentProfile.avatarUrl ? (
                <img 
                  src={currentProfile.avatarUrl} 
                  alt={currentProfile.arnsName || currentProfile.name || 'User'}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    position: 'absolute',
                    top: 0,
                    left: 0
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const nextElement = e.currentTarget.nextSibling as HTMLElement;
                    if (nextElement) {
                      nextElement.style.display = '';
                    }
                  }}
                />
              ) : null}
              <User size={32} style={currentProfile.avatarUrl ? { display: 'none' } : { color: 'var(--gray-600)' }} />
            </div>
          )}
          
          <h2 style={{ marginBottom: 'var(--space-3)', fontSize: '32px', fontWeight: '600' }}>
            Welcome Back{currentProfile && (currentProfile.arnsName || currentProfile.name) ? `, ${currentProfile.arnsName || currentProfile.name}` : ''}!
          </h2>
          <p style={{ fontSize: '18px', color: 'var(--gray-600)', lineHeight: '1.6' }}>
            {drives.length > 0 
              ? `Great news! You already have ${drives.length} public Drive${drives.length !== 1 ? 's' : ''} ready to sync.`
              : 'You have existing Drives, but they are private. Private drives are not supported yet.'
            }
          </p>
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Drives List */}
        {drives.length > 0 && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h3 style={{ 
              fontSize: '16px', 
              fontWeight: '600', 
              marginBottom: 'var(--space-4)',
              color: 'var(--gray-700)'
            }}>
              Choose a drive to sync:
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {drives.map((drive) => (
              <label
                key={drive.id}
                style={{
                  display: 'block',
                  padding: 'var(--space-4)',
                  border: `2px solid ${selectedDriveId === drive.id ? 'var(--ardrive-primary)' : 'var(--gray-200)'}`,
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: selectedDriveId === drive.id ? 'var(--primary-50)' : 'white',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  if (selectedDriveId !== drive.id) {
                    e.currentTarget.style.borderColor = 'var(--gray-300)';
                    e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedDriveId !== drive.id) {
                    e.currentTarget.style.borderColor = 'var(--gray-200)';
                    e.currentTarget.style.backgroundColor = 'white';
                  }
                }}
              >
                <input
                  type="radio"
                  name="drive"
                  value={drive.id}
                  checked={selectedDriveId === drive.id}
                  onChange={() => setSelectedDriveId(drive.id)}
                  style={{ display: 'none' }}
                />
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <HardDrive size={24} style={{ 
                    color: selectedDriveId === drive.id ? 'var(--ardrive-primary)' : 'var(--gray-500)',
                    flexShrink: 0
                  }} />
                  
                  <div style={{ flex: 1 }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)'
                    }}>
                      <h4 style={{ 
                        fontSize: '16px', 
                        fontWeight: '600',
                        color: 'var(--gray-900)'
                      }}>
                        {drive.name}
                      </h4>
                      {(drive.isPrivate || drive.privacy === 'private') && (
                        <span style={{
                          fontSize: '12px',
                          padding: '2px 8px',
                          backgroundColor: 'var(--gray-100)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--gray-600)'
                        }}>
                          Private
                        </span>
                      )}
                    </div>
                    
                    <div style={{ 
                      display: 'flex', 
                      gap: 'var(--space-4)',
                      fontSize: '14px',
                      color: 'var(--gray-600)'
                    }}>
                      {drive.dateCreated && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <Calendar size={14} />
                          Created {formatDate(drive.dateCreated)}
                        </div>
                      )}
                      {drive.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <Database size={14} />
                          {formatFileSize(drive.size)}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedDriveId === drive.id && (
                    <ChevronRight size={20} style={{ color: 'var(--ardrive-primary)' }} />
                  )}
                </div>
              </label>
            ))}

            {/* Create New Drive Option */}
            <button
              onClick={onCreateNewDrive}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                border: '2px dashed var(--gray-300)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'white',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                width: '100%',
                textAlign: 'left'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
                e.currentTarget.style.backgroundColor = 'var(--primary-50)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--gray-300)';
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              <Plus size={24} style={{ color: 'var(--ardrive-primary)' }} />
              <div>
                <h4 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600',
                  color: 'var(--gray-900)',
                  marginBottom: '4px'
                }}>
                  Create New Drive
                </h4>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
                  Start fresh with a new Drive
                </p>
              </div>
            </button>
          </div>
        </div>
        )}

        {/* Action Buttons */}
        <div style={{ 
          display: 'flex', 
          gap: 'var(--space-3)',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {onBack && (
              <button
                className="button outline"
                onClick={onBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)'
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}
            
            <button
              className="button outline"
              onClick={onSkipSetup}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              <SkipForward size={16} />
              Skip Setup
            </button>
          </div>

          {drives.length > 0 && (
            <button
              className="button large"
              onClick={handleContinue}
              disabled={!selectedDriveId}
              style={{
                fontSize: '16px',
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                opacity: !selectedDriveId ? 0.6 : 1,
                cursor: !selectedDriveId ? 'not-allowed' : 'pointer'
              }}
            >
              Continue with Selected Drive
              <ArrowRight size={18} />
            </button>
          )}
          
          {drives.length === 0 && (
            <button
              className="button large"
              onClick={onCreateNewDrive}
              style={{
                fontSize: '16px',
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              Create New Public Drive
              <ArrowRight size={18} />
            </button>
          )}
        </div>

        {/* Help text */}
        <p style={{
          marginTop: 'var(--space-4)',
          fontSize: '13px',
          color: 'var(--gray-500)',
          textAlign: 'center'
        }}>
          You can add more drives or change your selection later from the dashboard.
        </p>
      </div>
    </div>
  );
};

export default WelcomeBackScreen;