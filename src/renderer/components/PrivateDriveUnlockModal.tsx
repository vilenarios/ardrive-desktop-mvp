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
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="modal-content has-accent-bar"
        style={{ maxWidth: '420px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-5)',
            borderBottom: '1px solid var(--border)',
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
              background: 'var(--brand-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Lock size={20} style={{ color: 'var(--brand)' }} />
          </div>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              Unlock Private Drive
            </h2>
            <p style={{
              margin: 0,
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginTop: '4px'
            }}>
              Enter your password to access this drive
            </p>
          </div>
        </div>

        {/* Drive Info */}
        <div style={{
          padding: 'var(--space-5)',
          borderBottom: '1px solid var(--border-subtle)',
          textAlign: 'center',
          background: 'var(--surface-inset)'
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
            fontWeight: 500,
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-1)'
          }}>
            {drive.name || 'Private Drive'}
          </div>
          <div style={{
            fontSize: '13px',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)'
          }}>
            {drive.id.slice(0, 8)}...{drive.id.slice(-4)}
          </div>
        </div>

        {/* Password Input */}
        <div style={{ padding: 'var(--space-5)' }}>
          <div className="form-group">
            <label htmlFor="password" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Key size={16} />
              Drive Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className={error ? 'is-invalid' : ''}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Enter your drive password"
                autoFocus
                disabled={loading}
                style={{ paddingRight: '48px' }}
              />
              <button
                type="button"
                className="password-toggle-eye"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Security Note */}
          <div className="modal-banner is-neutral" style={{ marginBottom: error ? 'var(--space-4)' : 'var(--space-5)' }}>
            <span><strong>Security:</strong> Your password is kept in memory for this session only and will be cleared when you logout.</span>
          </div>

          {/* Error Message */}
          {error && (
            <div className="modal-banner is-error" style={{ marginBottom: 'var(--space-6)' }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="drive-modal-footer" style={{ marginTop: 'var(--space-4)' }}>
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
