import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, User, Plus, Check, LogOut, Settings, Lock, X } from 'lucide-react';
import { Profile } from '../../types';

interface ProfileSwitcherProps {
  currentProfile: Profile | null;
  onProfileSwitch: (profileId: string) => void;
  onAddProfile: () => void;
  onManageProfiles: () => void;
}

const ProfileSwitcher: React.FC<ProfileSwitcherProps> = ({
  currentProfile,
  onProfileSwitch,
  onAddProfile,
  onManageProfiles
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    loadProfiles();
    
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reload profiles when currentProfile changes to ensure fresh data
  useEffect(() => {
    if (currentProfile) {
      loadProfiles();
    }
  }, [currentProfile?.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const profileList = await window.electronAPI.profiles.list();
      if (isMountedRef.current) {
        setProfiles(profileList);
      }
    } catch (error) {
      console.error('Failed to load profiles:', error);
    }
  }, []);

  const handleProfileSwitch = async (profileId: string) => {
    if (profileId === currentProfile?.id) {
      setIsOpen(false);
      return;
    }

    setSelectedProfileId(profileId);
    setShowPasswordPrompt(true);
    setIsOpen(false);
  };

  const handlePasswordSubmit = async () => {
    if (!selectedProfileId || !password) return;
    
    setPasswordError(null);
    setLoading(true);
    
    try {
      // Attempt to switch profile with password
      const success = await window.electronAPI.profiles.switch(selectedProfileId, password);
      
      if (!success) {
        setPasswordError('Invalid password');
        setLoading(false);
        return;
      }
      
      // Successfully switched - notify parent and close modal
      setShowPasswordPrompt(false);
      setPassword('');
      setPasswordError(null);
      setSelectedProfileId(null);
      setLoading(false);
      
      // Notify parent component of successful switch
      onProfileSwitch(selectedProfileId);
    } catch (error) {
      setPasswordError('Failed to unlock profile');
      setLoading(false);
    }
  };

  const closePasswordPrompt = () => {
    setShowPasswordPrompt(false);
    setPassword('');
    setPasswordError(null);
    setSelectedProfileId(null);
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  return (
    <div className="profile-switcher" ref={dropdownRef}>
      <button
        className="profile-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
      >
        <div className="profile-info">
          {currentProfile?.avatarUrl ? (
            <img 
              src={currentProfile.avatarUrl} 
              alt="Profile" 
              className="profile-avatar"
            />
          ) : (
            <div className="profile-avatar-placeholder">
              <User size={16} />
            </div>
          )}
          <div className="profile-details">
            <div className="profile-name">
              {currentProfile ? currentProfile.name : 'Loading...'}
            </div>
            {currentProfile && (
              <div className="profile-address">
                {currentProfile.arnsName || formatAddress(currentProfile.address)}
              </div>
            )}
          </div>
        </div>
        <ChevronDown 
          size={16} 
          className={`chevron ${isOpen ? 'open' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="profile-dropdown">
          <div className="dropdown-section">
            <div className="dropdown-header">Switch Profile</div>
            {profiles && profiles.length > 0 ? profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-option ${profile.id === currentProfile?.id ? 'active' : ''}`}
                onClick={() => handleProfileSwitch(profile.id)}
                disabled={loading}
              >
                <div className="option-content">
                  {profile.avatarUrl ? (
                    <img 
                      src={profile.avatarUrl} 
                      alt={profile.name} 
                      className="option-avatar"
                    />
                  ) : (
                    <div className="option-avatar-placeholder">
                      <User size={14} />
                    </div>
                  )}
                  <div className="option-details">
                    <div className="option-name">{profile.name}</div>
                    <div className="option-address">
                      {profile.arnsName || formatAddress(profile.address)}
                    </div>
                  </div>
                </div>
                {profile.id === currentProfile?.id && (
                  <Check size={16} className="check-icon" />
                )}
              </button>
            )) : (
              <div style={{ padding: 'var(--space-3)', textAlign: 'center', color: 'var(--gray-500)', fontSize: '13px' }}>
                No profiles available
              </div>
            )}
          </div>

          <div className="dropdown-divider" />

          <div className="dropdown-section">
            <button
              className="dropdown-action"
              onClick={() => {
                setIsOpen(false);
                onAddProfile();
              }}
            >
              <Plus size={16} />
              <span>Add Profile</span>
            </button>
            <button
              className="dropdown-action"
              onClick={() => {
                setIsOpen(false);
                onManageProfiles();
              }}
            >
              <Settings size={16} />
              <span>Manage Profiles</span>
            </button>
          </div>
        </div>
      )}

      {/* Password Prompt Modal */}
      {showPasswordPrompt && (
        <div className="password-modal-backdrop" onClick={closePasswordPrompt}>
          <div className="password-modal" onClick={(e) => e.stopPropagation()}>
            <div className="password-modal-header">
              <h3>Switch Profile</h3>
              <button className="close-button" onClick={closePasswordPrompt}>
                <X size={20} />
              </button>
            </div>
            
            <div className="password-modal-body">
              {selectedProfileId && profiles && (
                <div className="switching-to-profile">
                  {profiles.find(p => p.id === selectedProfileId)?.avatarUrl ? (
                    <img 
                      src={profiles.find(p => p.id === selectedProfileId)?.avatarUrl} 
                      alt="Profile" 
                      className="switching-avatar"
                    />
                  ) : (
                    <div className="switching-avatar-placeholder">
                      <User size={20} />
                    </div>
                  )}
                  <div>
                    <div className="switching-name">
                      {profiles.find(p => p.id === selectedProfileId)?.name}
                    </div>
                    <div className="switching-address">
                      {profiles.find(p => p.id === selectedProfileId)?.arnsName || 
                       formatAddress(profiles.find(p => p.id === selectedProfileId)?.address || '')}
                    </div>
                  </div>
                </div>
              )}
              
              <p className="password-prompt-text">
                Enter your password to unlock this profile
              </p>
              
              {passwordError && (
                <div className="password-error">
                  {passwordError}
                </div>
              )}
              
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                placeholder="Enter password"
                className="password-input"
                autoFocus
              />
            </div>
            
            <div className="password-modal-footer">
              <button className="cancel-button" onClick={closePasswordPrompt}>
                Cancel
              </button>
              <button 
                className="unlock-button" 
                onClick={handlePasswordSubmit}
                disabled={!password || loading}
              >
                {loading ? (
                  <span className="loading-text">Unlocking...</span>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>Unlock</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .profile-switcher {
          position: relative;
        }

        .profile-trigger {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: transparent;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 200px;
        }

        .profile-trigger:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
        }

        .profile-trigger:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .profile-info {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex: 1;
          text-align: left;
        }

        .profile-avatar,
        .profile-avatar-placeholder {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .profile-avatar {
          object-fit: cover;
        }

        .profile-avatar-placeholder {
          background: var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gray-600);
        }

        .profile-details {
          flex: 1;
          min-width: 0;
        }

        .profile-name {
          font-weight: 500;
          font-size: 14px;
          color: var(--gray-900);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .profile-address {
          font-size: 12px;
          color: var(--gray-600);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chevron {
          color: var(--gray-500);
          transition: transform 0.2s ease;
        }

        .chevron.open {
          transform: rotate(180deg);
        }

        .profile-dropdown {
          position: absolute;
          top: calc(100% + var(--space-2));
          left: 0;
          right: 0;
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          z-index: 1000;
          overflow: hidden;
          min-width: 280px;
        }

        .dropdown-section {
          padding: var(--space-2);
        }

        .dropdown-header {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--gray-500);
          padding: var(--space-2) var(--space-3);
          letter-spacing: 0.5px;
        }

        .profile-option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: var(--space-3);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .profile-option:hover {
          background: var(--gray-50);
        }

        .profile-option.active {
          background: var(--ardrive-primary-100);
        }

        .profile-option:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .option-content {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex: 1;
          text-align: left;
        }

        .option-avatar,
        .option-avatar-placeholder {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .option-avatar {
          object-fit: cover;
        }

        .option-avatar-placeholder {
          background: var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gray-600);
        }

        .option-details {
          flex: 1;
          min-width: 0;
        }

        .option-name {
          font-weight: 500;
          font-size: 13px;
          color: var(--gray-900);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .option-address {
          font-size: 11px;
          color: var(--gray-600);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .check-icon {
          color: var(--ardrive-primary);
          flex-shrink: 0;
        }

        .dropdown-divider {
          height: 1px;
          background: var(--gray-200);
          margin: var(--space-2) 0;
        }

        .dropdown-action {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          padding: var(--space-3);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background 0.2s ease;
          font-size: 13px;
          color: var(--gray-700);
        }

        .dropdown-action:hover {
          background: var(--gray-50);
          color: var(--gray-900);
        }

        .dropdown-action svg {
          color: var(--gray-500);
        }

        /* Password Modal Styles */
        .password-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          backdrop-filter: blur(2px);
        }

        .password-modal {
          background: white;
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-2xl);
          width: 90%;
          max-width: 400px;
          overflow: hidden;
        }

        .password-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-6);
          border-bottom: 1px solid var(--gray-200);
        }

        .password-modal-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .close-button {
          background: none;
          border: none;
          padding: var(--space-2);
          cursor: pointer;
          color: var(--gray-500);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .close-button:hover {
          background: var(--gray-100);
          color: var(--gray-700);
        }

        .password-modal-body {
          padding: var(--space-6);
        }

        .switching-to-profile {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4);
          background: var(--gray-50);
          border-radius: var(--radius-lg);
          margin-bottom: var(--space-5);
        }

        .switching-avatar,
        .switching-avatar-placeholder {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .switching-avatar {
          object-fit: cover;
        }

        .switching-avatar-placeholder {
          background: var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--gray-600);
        }

        .switching-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
        }

        .switching-address {
          font-size: 12px;
          color: var(--gray-600);
        }

        .password-prompt-text {
          margin: 0 0 var(--space-4) 0;
          color: var(--gray-600);
          font-size: 14px;
        }

        .password-error {
          background: var(--red-50);
          color: var(--red-700);
          padding: var(--space-3);
          border-radius: var(--radius-md);
          font-size: 13px;
          margin-bottom: var(--space-4);
          border: 1px solid var(--red-200);
        }

        .password-input {
          width: 100%;
          padding: var(--space-3) var(--space-4);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          font-size: 14px;
          transition: all 0.2s ease;
        }

        .password-input:focus {
          outline: none;
          border-color: var(--ardrive-primary);
          box-shadow: 0 0 0 3px rgba(71, 134, 255, 0.1);
        }

        .password-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3);
          padding: var(--space-6);
          border-top: 1px solid var(--gray-200);
          background: var(--gray-50);
        }

        .cancel-button {
          padding: var(--space-2) var(--space-4);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          font-size: 14px;
          color: var(--gray-700);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .cancel-button:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
        }

        .unlock-button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          background: var(--ardrive-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .unlock-button:hover:not(:disabled) {
          background: var(--ardrive-primary-dark);
        }

        .unlock-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .loading-text {
          display: inline-block;
        }
      `}</style>
    </div>
  );
};

export default ProfileSwitcher;