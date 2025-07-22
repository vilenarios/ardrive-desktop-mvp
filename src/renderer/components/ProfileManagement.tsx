import React, { useState, useEffect } from 'react';
import { User, Plus, LogIn, Trash2, Settings, Eye, EyeOff, ArrowLeft, Check, AlertTriangle } from 'lucide-react';
import { Profile } from '../../types';

interface ProfileManagementProps {
  onProfileSelected: (profile: Profile, password: string) => void;
  onCreateNewProfile: () => void;
  onBack?: () => void;
}

const ProfileManagement: React.FC<ProfileManagementProps> = ({ 
  onProfileSelected, 
  onCreateNewProfile,
  onBack 
}) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const profileList = await window.electronAPI.profiles.list();
      console.log('Loaded profiles in ProfileManagement:', profileList);
      setProfiles(profileList || []);
    } catch (err) {
      console.error('Failed to load profiles:', err);
      setError('Failed to load your profiles');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileLogin = async (profile: Profile) => {
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    try {
      setAuthenticating(true);
      setError(null);
      
      // Switch to the profile with the provided password
      const success = await window.electronAPI.profiles.switch(profile.id, password);
      
      if (success) {
        onProfileSelected(profile, password);
      } else {
        setError('Invalid password. Please try again.');
      }
    } catch (err) {
      console.error('Failed to authenticate profile:', err);
      setError('Authentication failed. Please check your password.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await window.electronAPI.profiles.delete(profileId);
      await loadProfiles();
      setDeleteConfirm(null);
      
      // Check if this was the last profile and redirect to wallet setup
      const updatedProfiles = await window.electronAPI.profiles.list();
      if (!updatedProfiles || updatedProfiles.length === 0) {
        onCreateNewProfile();
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
      setError('Failed to delete profile');
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const closePasswordInput = () => {
    setShowPasswordInput(null);
    setPassword('');
    setShowPassword(false);
    setError(null);
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
          <p style={{ color: 'var(--gray-600)' }}>Loading profiles...</p>
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
      background: 'var(--gray-50)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Background - Permahills */}
      <img 
        src="permahills_background.jpg"
        alt=""
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.3,
          pointerEvents: 'none',
          zIndex: -1
        }}
        onError={(e) => {
          console.log('Background image failed to load:', e);
          e.currentTarget.style.display = 'none';
        }}
        onLoad={() => console.log('Background image loaded successfully')}
      />

      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '600px',
        padding: 'var(--space-8)',
        background: 'white',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <User size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-4)' }} />
          <h2 style={{ marginBottom: 'var(--space-3)', fontSize: '32px', fontWeight: '600' }}>
            Select Profile
          </h2>
          <p style={{ fontSize: '18px', color: 'var(--gray-600)', lineHeight: '1.6' }}>
            {profiles.length > 0 
              ? `Choose from your ${profiles.length} saved profile${profiles.length !== 1 ? 's' : ''}`
              : 'No profiles found. Create your first profile to get started.'
            }
          </p>
        </div>

        {error && (
          <div style={{
            padding: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
            backgroundColor: 'var(--error-50)',
            border: '1px solid var(--error-200)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--error-700)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)'
          }}>
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* Profiles List */}
        {profiles.length > 0 && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {profiles.map((profile) => (
                <div key={profile.id}>
                  {/* Profile Card */}
                  <div style={{
                    padding: 'var(--space-4)',
                    border: '2px solid var(--gray-200)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'white',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      {/* Avatar */}
                      <div style={{ 
                        width: '48px', 
                        height: '48px', 
                        background: 'var(--gray-100)', 
                        borderRadius: '50%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        position: 'relative', 
                        overflow: 'hidden',
                        border: '2px solid var(--gray-200)',
                        flexShrink: 0
                      }}>
                        {profile.avatarUrl ? (
                          <img 
                            src={profile.avatarUrl} 
                            alt={profile.arnsName || profile.name || 'User'}
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
                        <User size={24} style={profile.avatarUrl ? { display: 'none' } : { color: 'var(--gray-600)' }} />
                      </div>
                      
                      {/* Profile Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between',
                          marginBottom: 'var(--space-1)'
                        }}>
                          <h4 style={{ 
                            fontSize: '16px', 
                            fontWeight: '600',
                            color: 'var(--gray-900)',
                            margin: 0
                          }}>
                            {profile.arnsName || profile.name || 'Arweave User'}
                          </h4>
                        </div>
                        
                        <div style={{ 
                          fontSize: '14px',
                          color: 'var(--gray-600)',
                          marginBottom: 'var(--space-2)'
                        }}>
                          {profile.address.slice(0, 4)}...{profile.address.slice(-4)}
                        </div>
                        
                        <div style={{ 
                          fontSize: '12px',
                          color: 'var(--gray-500)'
                        }}>
                          Last used: {formatDate(profile.lastUsedAt)}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        <button
                          className="button outline small"
                          onClick={() => {
                            if (deleteConfirm === profile.id) {
                              handleDeleteProfile(profile.id);
                            } else {
                              setDeleteConfirm(profile.id);
                              setTimeout(() => setDeleteConfirm(null), 3000);
                            }
                          }}
                          style={{
                            backgroundColor: deleteConfirm === profile.id ? 'var(--error-500)' : undefined,
                            color: deleteConfirm === profile.id ? 'white' : undefined,
                            borderColor: deleteConfirm === profile.id ? 'var(--error-500)' : undefined
                          }}
                        >
                          <Trash2 size={14} />
                          {deleteConfirm === profile.id ? 'Confirm' : ''}
                        </button>
                        
                        <button
                          className="button"
                          onClick={() => {
                            setShowPasswordInput(profile.id);
                            setSelectedProfileId(profile.id);
                            setError(null);
                          }}
                          disabled={authenticating}
                        >
                          <LogIn size={16} />
                          {authenticating && selectedProfileId === profile.id ? 'Signing in...' : 'Sign In'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Password Input */}
                  {showPasswordInput === profile.id && (
                    <div style={{
                      marginTop: 'var(--space-3)',
                      padding: 'var(--space-4)',
                      backgroundColor: 'var(--gray-50)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--gray-200)'
                    }}>
                      <div style={{ marginBottom: 'var(--space-3)' }}>
                        <label style={{ 
                          display: 'block', 
                          marginBottom: 'var(--space-2)', 
                          fontSize: '14px', 
                          fontWeight: '600',
                          color: 'var(--gray-700)'
                        }}>
                          Password for {profile.arnsName || profile.name}
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleProfileLogin(profile);
                              } else if (e.key === 'Escape') {
                                closePasswordInput();
                              }
                            }}
                            placeholder="Enter your password"
                            autoFocus
                            style={{
                              width: '100%',
                              padding: '12px',
                              paddingRight: '44px',
                              border: '2px solid var(--gray-200)',
                              borderRadius: 'var(--radius-md)',
                              fontSize: '16px'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{
                              position: 'absolute',
                              right: '12px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              background: 'none',
                              border: 'none',
                              color: 'var(--gray-500)',
                              cursor: 'pointer',
                              padding: '4px'
                            }}
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
                        <button
                          className="button outline small"
                          onClick={closePasswordInput}
                          disabled={authenticating}
                        >
                          Cancel
                        </button>
                        <button
                          className="button small"
                          onClick={() => handleProfileLogin(profile)}
                          disabled={!password.trim() || authenticating}
                        >
                          {authenticating ? (
                            <>
                              <div style={{ 
                                width: '14px', 
                                height: '14px', 
                                border: '2px solid transparent',
                                borderTop: '2px solid currentColor',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                marginRight: 'var(--space-1)'
                              }} />
                              Signing in...
                            </>
                          ) : (
                            <>
                              <Check size={14} />
                              Sign In
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add New Profile */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <button
            onClick={onCreateNewProfile}
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
              e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-50)';
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
                Add New Profile
              </h4>
              <p style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
                Import an account or create a new one
              </p>
            </div>
          </button>
        </div>

        {/* Footer Actions */}
        {onBack && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-start'
          }}>
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
          </div>
        )}

        {/* Help text */}
        <p style={{
          marginTop: 'var(--space-4)',
          fontSize: '13px',
          color: 'var(--gray-500)',
          textAlign: 'center'
        }}>
          Your account data is encrypted and stored locally on this device.
        </p>
      </div>
    </div>
  );
};

export default ProfileManagement;