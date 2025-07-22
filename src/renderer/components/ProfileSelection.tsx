import React, { useState, useEffect } from 'react';
import { Profile } from '../../types';
import { User, Plus, ArrowRight, Clock, Wallet, Lock, X, Trash2, AlertCircle } from 'lucide-react';

interface ProfileSelectionProps {
  onProfileSelected: (profileId: string) => void;
  onCreateProfile: () => void;
}

const ProfileSelection: React.FC<ProfileSelectionProps> = ({
  onProfileSelected,
  onCreateProfile
}) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [password, setPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadProfiles();
    // Check for remembered session
    const rememberedSession = sessionStorage.getItem('rememberedProfileId');
    if (rememberedSession) {
      setSelectedProfileId(rememberedSession);
      setRememberMe(true);
    }
  }, []);

  const loadProfiles = async () => {
    try {
      const profileList = await window.electronAPI.profiles.list();
      setProfiles(profileList.sort((a: any, b: any) => 
        new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      ));
    } catch (error) {
      console.error('Failed to load profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSelect = (profileId: string) => {
    setSelectedProfileId(profileId);
  };

  const handleContinue = () => {
    if (selectedProfileId) {
      setShowPasswordPrompt(true);
    }
  };

  const handlePasswordSubmit = async () => {
    if (!selectedProfileId || !password) return;
    
    setPasswordError(null);
    
    try {
      // Attempt to switch profile with password
      const success = await window.electronAPI.profiles.switch(selectedProfileId, password);
      
      if (!success) {
        setPasswordError('Invalid password');
        return;
      }
      
      // Save session if remember me is checked
      if (rememberMe) {
        sessionStorage.setItem('rememberedProfileId', selectedProfileId);
      } else {
        sessionStorage.removeItem('rememberedProfileId');
      }
      
      onProfileSelected(selectedProfileId);
    } catch (error) {
      setPasswordError('Failed to unlock profile');
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleDeleteClick = (e: React.MouseEvent, profile: Profile) => {
    e.stopPropagation();
    setProfileToDelete(profile);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!profileToDelete) return;
    
    setIsDeleting(true);
    try {
      await window.electronAPI.profiles.delete(profileToDelete.id);
      
      // Reload profiles
      await loadProfiles();
      
      // Clear selection if deleted profile was selected
      if (selectedProfileId === profileToDelete.id) {
        setSelectedProfileId(null);
        sessionStorage.removeItem('rememberedProfileId');
      }
      
      setShowDeleteConfirm(false);
      setProfileToDelete(null);
    } catch (error) {
      console.error('Failed to delete profile:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
    setProfileToDelete(null);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return `${Math.floor(days / 30)} months ago`;
  };

  if (loading) {
    return (
      <div className="profile-selection-container">
        <div className="profile-selection-card">
          <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
            <div className="loading-spinner" />
            <p style={{ marginTop: 'var(--space-4)', color: 'var(--gray-600)' }}>
              Loading profiles...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-selection-container">
      <div className="profile-selection-card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <img 
            src="ArDrive-Logo-Wordmark-Dark.png" 
            alt="ArDrive" 
            style={{ height: '60px', marginBottom: 'var(--space-6)' }} 
          />
          <h2 style={{ marginBottom: 'var(--space-3)' }}>Welcome Back</h2>
          <p className="text-gray-600" style={{ fontSize: '16px' }}>
            Select a profile to continue or create a new one
          </p>
        </div>

        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="profile-grid">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-card ${selectedProfileId === profile.id ? 'selected' : ''}`}
                onClick={() => handleProfileSelect(profile.id)}
              >
                <div className="profile-card-header">
                  {profile.avatarUrl ? (
                    <img 
                      src={profile.avatarUrl} 
                      alt={profile.name} 
                      className="profile-card-avatar"
                    />
                  ) : (
                    <div className="profile-card-avatar-placeholder">
                      <User size={24} />
                    </div>
                  )}
                  <div className="profile-card-info">
                    <h3>{profile.name}</h3>
                    <p className="profile-card-address">
                      {profile.arnsName || formatAddress(profile.address)}
                    </p>
                  </div>
                  {selectedProfileId === profile.id && (
                    <div className="profile-card-check">✓</div>
                  )}
                  <button
                    className="profile-delete-button"
                    onClick={(e) => handleDeleteClick(e, profile)}
                    title="Delete profile"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="profile-card-footer">
                  <Clock size={12} />
                  <span>Last used {formatDate(profile.lastUsedAt)}</span>
                </div>
              </button>
            ))}

            <button
              className="profile-card new-profile"
              onClick={onCreateProfile}
            >
              <div className="new-profile-content">
                <div className="new-profile-icon">
                  <Plus size={24} />
                </div>
                <h3>Add New Profile</h3>
                <p>Import a different wallet</p>
              </div>
            </button>
          </div>
        </div>

        {selectedProfileId && (
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
                <span style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
                  Remember me on this device
                </span>
              </label>
            </div>
            <button
              className="button large"
              onClick={handleContinue}
              style={{ width: '100%' }}
            >
              Continue <ArrowRight size={16} style={{ marginLeft: 'var(--space-2)' }} />
            </button>
          </div>
        )}
      </div>

      {/* Password Prompt Modal */}
      {showPasswordPrompt && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>Unlock Profile</h3>
              <button
                className="icon-button"
                onClick={() => {
                  setShowPasswordPrompt(false);
                  setPassword('');
                  setPasswordError(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <p style={{ marginBottom: 'var(--space-4)', color: 'var(--gray-600)' }}>
                Enter your password to unlock this profile
              </p>
              
              {passwordError && (
                <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
                  {passwordError}
                </div>
              )}
              
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                  placeholder="Enter your password"
                  autoFocus
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button
                className="button outline"
                onClick={() => {
                  setShowPasswordPrompt(false);
                  setPassword('');
                  setPasswordError(null);
                }}
              >
                Cancel
              </button>
              <button
                className="button"
                onClick={handlePasswordSubmit}
                disabled={!password}
              >
                <Lock size={16} style={{ marginRight: 'var(--space-2)' }} />
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && profileToDelete && (
        <div className="modal-backdrop" onClick={handleCancelDelete}>
          <div className="modal-content delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Profile</h3>
              <button className="close-button" onClick={handleCancelDelete}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="warning-icon">
                <AlertCircle size={48} />
              </div>
              
              <div style={{ 
                backgroundColor: 'var(--error-50)', 
                padding: 'var(--space-4)', 
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
                border: '1px solid var(--error-200)'
              }}>
                <p className="delete-warning" style={{ 
                  color: 'var(--error-900)', 
                  fontWeight: '600',
                  fontSize: '16px',
                  marginBottom: 0
                }}>
                  ⚠️ This will permanently delete your profile
                </p>
              </div>
              
              <div className="profile-to-delete">
                {profileToDelete.avatarUrl ? (
                  <img 
                    src={profileToDelete.avatarUrl} 
                    alt={profileToDelete.name} 
                    className="delete-avatar"
                  />
                ) : (
                  <div className="delete-avatar-placeholder">
                    <User size={20} />
                  </div>
                )}
                <div>
                  <div className="delete-name">{profileToDelete.name}</div>
                  <div className="delete-address">
                    {profileToDelete.arnsName || formatAddress(profileToDelete.address)}
                  </div>
                </div>
              </div>
              
              <div className="delete-consequences" style={{
                backgroundColor: 'var(--gray-50)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                marginTop: 'var(--space-4)'
              }}>
                <p style={{ 
                  fontWeight: '700', 
                  color: 'var(--error-700)',
                  marginBottom: 'var(--space-3)',
                  fontSize: '15px'
                }}>
                  🚨 THIS ACTION CANNOT BE UNDONE!
                </p>
                <p style={{ marginBottom: 'var(--space-3)', fontWeight: '600' }}>
                  What will be deleted:
                </p>
                <ul style={{ marginBottom: 'var(--space-3)' }}>
                  <li>✗ Your encrypted wallet file on this device</li>
                  <li>✗ All saved sync folders and drive settings</li>
                  <li>✗ Your profile preferences and history</li>
                  <li>✗ Any locally cached data</li>
                </ul>
                <div style={{
                  backgroundColor: 'var(--warning-50)',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--warning-200)',
                  marginTop: 'var(--space-3)'
                }}>
                  <p style={{ 
                    fontSize: '14px', 
                    color: 'var(--warning-900)',
                    fontWeight: '500',
                    marginBottom: 0
                  }}>
                    <strong>Important:</strong> Make sure you have your 12-word recovery phrase saved before deleting. Without it, you will lose access to this wallet forever.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="button outline" onClick={handleCancelDelete}>
                Cancel
              </button>
              <button 
                className="delete-button danger" 
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <span className="loading-text">Deleting...</span>
                ) : (
                  <>
                    <Trash2 size={16} />
                    <span>Delete Profile</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .profile-selection-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-8);
        }

        .profile-selection-card {
          background: white;
          border-radius: var(--radius-xl);
          padding: var(--space-10);
          box-shadow: var(--shadow-xl);
          max-width: 600px;
          width: 100%;
        }

        .loading-spinner {
          width: 48px;
          height: 48px;
          border: 3px solid var(--gray-200);
          border-top-color: var(--ardrive-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }

        .profile-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: var(--space-4);
        }

        .profile-card {
          background: white;
          border: 2px solid var(--gray-200);
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
        }

        .profile-card:hover {
          border-color: var(--gray-300);
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .profile-card.selected {
          border-color: var(--ardrive-primary);
          background: var(--ardrive-primary-100);
        }

        .profile-card-header {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
          position: relative;
        }

        .profile-card-avatar,
        .profile-card-avatar-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .profile-card-avatar {
          object-fit: cover;
        }

        .profile-card-avatar-placeholder {
          background: var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gray-600);
        }

        .profile-card-info {
          flex: 1;
          min-width: 0;
        }

        .profile-card-info h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 var(--space-1) 0;
          color: var(--gray-900);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .profile-card-address {
          font-size: 13px;
          color: var(--gray-600);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .profile-card-check {
          position: absolute;
          top: 0;
          right: 0;
          width: 24px;
          height: 24px;
          background: var(--ardrive-primary);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          z-index: 2;
        }

        .profile-card-footer {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: 12px;
          color: var(--gray-500);
          padding-top: var(--space-3);
          border-top: 1px solid var(--gray-100);
        }

        .new-profile {
          border-style: dashed;
          background: var(--gray-50);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 140px;
        }

        .new-profile:hover {
          background: white;
          border-color: var(--ardrive-primary);
        }

        .new-profile-content {
          text-align: center;
        }

        .new-profile-icon {
          width: 48px;
          height: 48px;
          background: var(--gray-200);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-3);
          color: var(--gray-600);
        }

        .new-profile:hover .new-profile-icon {
          background: var(--ardrive-primary-100);
          color: var(--ardrive-primary);
        }

        .new-profile h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 var(--space-1) 0;
          color: var(--gray-900);
        }

        .new-profile p {
          font-size: 13px;
          color: var(--gray-600);
          margin: 0;
        }

        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-2xl);
          width: 90%;
          max-width: 600px;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-6);
          border-bottom: 1px solid var(--gray-200);
        }

        .modal-header h3 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
        }

        .modal-body {
          padding: var(--space-6);
        }

        .modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3);
          padding: var(--space-6);
          border-top: 1px solid var(--gray-200);
        }

        .icon-button {
          background: none;
          border: none;
          padding: var(--space-2);
          cursor: pointer;
          color: var(--gray-600);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .icon-button:hover {
          background: var(--gray-100);
          color: var(--gray-900);
        }

        /* Delete Button Styles */
        .profile-delete-button {
          position: absolute;
          top: var(--space-2);
          right: calc(var(--space-2) + 28px);
          background: none;
          border: none;
          padding: var(--space-2);
          cursor: pointer;
          color: var(--gray-400);
          border-radius: var(--radius-sm);
          opacity: 0;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }

        .profile-card:hover .profile-delete-button {
          opacity: 1;
        }

        .profile-delete-button:hover {
          background: var(--danger-50);
          color: var(--danger-600);
        }

        /* Delete Modal Styles */
        .delete-modal {
          max-width: 480px;
        }

        .warning-icon {
          text-align: center;
          color: var(--warning-600);
          margin-bottom: var(--space-4);
        }

        .delete-warning {
          text-align: center;
          font-size: 16px;
          color: var(--gray-700);
          margin-bottom: var(--space-5);
        }

        .profile-to-delete {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4);
          background: var(--gray-50);
          border-radius: var(--radius-lg);
          margin-bottom: var(--space-5);
        }

        .delete-avatar,
        .delete-avatar-placeholder {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .delete-avatar {
          object-fit: cover;
        }

        .delete-avatar-placeholder {
          background: var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gray-600);
        }

        .delete-name {
          font-weight: 600;
          font-size: 16px;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
        }

        .delete-address {
          font-size: 13px;
          color: var(--gray-600);
        }

        .delete-consequences {
          background: var(--danger-50);
          border: 1px solid var(--danger-200);
          border-radius: var(--radius-md);
          padding: var(--space-4);
          margin-bottom: var(--space-2);
        }

        .delete-consequences p {
          margin: 0 0 var(--space-2) 0;
          color: var(--danger-700);
          font-size: 14px;
        }

        .delete-consequences ul {
          margin: 0;
          padding-left: var(--space-5);
          color: var(--danger-600);
          font-size: 13px;
        }

        .delete-consequences li {
          margin-bottom: var(--space-1);
        }

        .delete-button.danger {
          background: var(--danger-600);
          color: white;
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .delete-button.danger:hover:not(:disabled) {
          background: var(--danger-700);
        }

        .delete-button.danger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .close-button {
          background: none;
          border: none;
          padding: var(--space-2);
          cursor: pointer;
          color: var(--gray-600);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .close-button:hover {
          background: var(--gray-100);
          color: var(--gray-900);
        }
      `}</style>
    </div>
  );
};

export default ProfileSelection;