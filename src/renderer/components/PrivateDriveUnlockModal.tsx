import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, Key } from 'lucide-react';
import { DriveInfoWithStatus } from '../../types';

interface PrivateDriveUnlockModalProps {
  drive: DriveInfoWithStatus;
  isOpen: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  onCancel: () => void;
}

export const PrivateDriveUnlockModal: React.FC<PrivateDriveUnlockModalProps> = ({
  drive,
  isOpen,
  onUnlock,
  onCancel
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    if (!password.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const success = await onUnlock(password);
      if (success) {
        setPassword('');
        // Modal will be closed by parent component
      } else {
        setError('Invalid password. Please check your password and try again.');
        // Focus back on password input for retry
        setTimeout(() => {
          const input = document.getElementById('password') as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 100);
      }
    } catch (err) {
      setError('Failed to unlock drive. Please try again.');
      console.error('Unlock error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && password.trim() && !loading) {
      handleUnlock();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay" 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div 
        className="modal-content" 
        style={{
          backgroundColor: 'white',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          maxWidth: '420px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div 
          style={{
            padding: 'var(--space-5)',
            borderBottom: '1px solid var(--gray-200)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)'
          }}
        >
          <div 
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'var(--ardrive-primary-100)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Lock size={20} style={{ color: 'var(--ardrive-primary)' }} />
          </div>
          <div>
            <h2 style={{ 
              margin: 0, 
              fontSize: '18px', 
              fontWeight: '600',
              color: 'var(--gray-900)'
            }}>
              Unlock Private Drive
            </h2>
            <p style={{ 
              margin: 0, 
              fontSize: '14px', 
              color: 'var(--gray-600)',
              marginTop: '4px'
            }}>
              Enter your password to access this drive
            </p>
          </div>
        </div>
        
        {/* Drive Info */}
        <div style={{ 
          padding: 'var(--space-5)',
          borderBottom: '1px solid var(--gray-100)',
          textAlign: 'center',
          backgroundColor: 'var(--gray-50)'
        }}>
          <div style={{ 
            fontSize: '24px', 
            marginBottom: 'var(--space-2)',
            lineHeight: 1
          }}>
            {drive.emojiFingerprint}
          </div>
          <div style={{ 
            fontSize: '16px', 
            fontWeight: '500',
            color: 'var(--gray-900)',
            marginBottom: 'var(--space-1)'
          }}>
            {drive.name || 'Private Drive'}
          </div>
          <div style={{ 
            fontSize: '13px',
            color: 'var(--gray-500)',
            fontFamily: 'monospace'
          }}>
            {drive.id.slice(0, 8)}...{drive.id.slice(-4)}
          </div>
        </div>
        
        {/* Password Input */}
        <div style={{ padding: 'var(--space-5)' }}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label 
              htmlFor="password"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--gray-700)',
                marginBottom: 'var(--space-2)'
              }}
            >
              <Key size={16} />
              Drive Password
            </label>
            <div 
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Enter your drive password"
                autoFocus
                disabled={loading}
                style={{
                  width: '100%',
                  padding: 'var(--space-3)',
                  paddingRight: '48px',
                  border: `1px solid ${error ? 'var(--error-300)' : 'var(--gray-300)'}`,
                  borderRadius: 'var(--radius-md)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                  backgroundColor: loading ? 'var(--gray-50)' : 'white'
                }}
                onFocus={(e) => {
                  if (!error) {
                    e.target.style.borderColor = 'var(--ardrive-primary)';
                  }
                }}
                onBlur={(e) => {
                  if (!error) {
                    e.target.style.borderColor = 'var(--gray-300)';
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  color: 'var(--gray-500)',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    e.currentTarget.style.backgroundColor = 'var(--gray-100)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          {/* Security Note */}
          <div style={{
            padding: 'var(--space-3)',
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-md)',
            marginBottom: error ? 'var(--space-4)' : 'var(--space-5)',
            fontSize: '13px',
            color: 'var(--gray-600)',
            lineHeight: '1.5',
            border: '1px solid var(--gray-200)'
          }}>
            <strong>Security:</strong> Your password is kept in memory for this session only and will be cleared when you logout.
          </div>
          
          {/* Error Message */}
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-3)',
              backgroundColor: 'var(--error-50)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-6)',
              fontSize: '14px',
              color: 'var(--error-700)'
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {error}
            </div>
          )}
          
          {/* Action Buttons */}
          <div style={{
            display: 'flex',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)'
          }}>
            <button 
              className="button outline"
              onClick={onCancel}
              disabled={loading}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button 
              className={`button ${loading ? 'loading' : ''}`}
              onClick={handleUnlock}
              disabled={!password.trim() || loading}
              style={{ flex: 2 }}
            >
              {loading ? 'Unlocking...' : 'Unlock Drive'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};