import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, Key } from 'lucide-react';
import { DriveInfoWithStatus } from '../../types';
import { InfoButton } from './common/InfoButton';
import { useModalA11y } from '../hooks/useModalA11y';

interface PrivateDriveUnlockModalProps {
  drive: DriveInfoWithStatus;
  isOpen: boolean;
  // UX-3: onUnlock returns the SPECIFIC failure reason (wrong password vs.
  // network/gateway verification error) so the modal shows the real error
  // instead of always saying 'Invalid password'.
  // PRIV-4: persistKey carries the user's "remember this drive" choice.
  onUnlock: (password: string, persistKey: boolean) => Promise<{ success: boolean; error?: string }>;
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
  // PRIV-4: opt-in to remember this drive's key (encrypted) so it auto-unlocks
  // next launch. Defaults off — persistence is always an explicit choice.
  const [rememberDrive, setRememberDrive] = useState(false);

  const handleUnlock = async () => {
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await onUnlock(password, rememberDrive);
      if (result.success) {
        setPassword('');
        setRememberDrive(false);
        // Modal will be closed by parent component
      } else {
        // UX-3: show the specific reason from the unlock envelope; fall back to
        // the generic wrong-password message only when none was provided.
        setError(result.error || 'Invalid password. Please check your password and try again.');
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
    // A11Y-3: Escape used to be wired only here, on the password <input>'s
    // onKeyDown, so it stopped working the moment focus moved to the
    // checkbox or the eye-toggle button. useModalA11y now handles Escape
    // (and backdrop-click, focus-trap, and focus-return) for the whole
    // panel regardless of which element has focus.
  };

  // A11Y-3: shared modal a11y — Escape/backdrop-click close, focus trapped,
  // focus returns to the trigger (e.g. the locked drive's row) on close.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onCancel);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={handleBackdropClick}
    >
      <div
        className="modal-content has-accent-bar"
        style={{ maxWidth: '420px', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-drive-modal-title"
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
            <h2 id="unlock-drive-modal-title" style={{
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
          {/* POLISH-14: the emoji sequence has no text fallback if glyphs
              fail to render (observed as tofu boxes in some environments),
              and no explanation anywhere of what it's for. An accessible
              name + InfoButton fix both regardless of font/glyph support. */}
          <div
            role="img"
            aria-label="Drive visual fingerprint — should look identical every time you unlock this drive"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-1)',
              fontSize: '24px',
              marginBottom: 'var(--space-2)',
              lineHeight: 1,
              fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'
            }}
          >
            <span>{drive.emojiFingerprint || 'Fingerprint unavailable'}</span>
            <InfoButton tooltip="This emoji sequence is a visual fingerprint of your drive's encryption key. It should look identical every time you unlock this drive — if it changes, stop and don't enter your password." />
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

          {/* PRIV-4: Remember this drive (opt-in key persistence) */}
          <label
            htmlFor="remember-drive"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              marginBottom: error ? 'var(--space-4)' : 'var(--space-5)',
              cursor: loading ? 'not-allowed' : 'pointer',
              userSelect: 'none'
            }}
          >
            <input
              id="remember-drive"
              type="checkbox"
              checked={rememberDrive}
              disabled={loading}
              onChange={(e) => setRememberDrive(e.target.checked)}
              style={{ marginTop: '3px', cursor: loading ? 'not-allowed' : 'pointer' }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
              <span style={{ fontWeight: 500 }}>Remember this drive on this device</span>
              <span style={{ display: 'block', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                The drive key is stored encrypted so you won&apos;t need this password after signing in. Turn off anytime.
              </span>
            </span>
          </label>

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
