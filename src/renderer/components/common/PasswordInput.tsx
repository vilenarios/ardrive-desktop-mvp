import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { InfoButton } from './InfoButton';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  showStrength?: boolean;
  tooltip?: string;
  error?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Enter password',
  autoFocus = false,
  showStrength = false,
  tooltip,
  error
}) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="form-group">
      <label>
        {label}
        {tooltip && <InfoButton tooltip={tooltip} />}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          style={{
            paddingRight: '48px',
            borderColor: error ? 'var(--error)' : undefined
          }}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          style={{
            position: 'absolute',
            right: 'var(--space-3)',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 'var(--space-2)',
            color: 'var(--gray-600)'
          }}
        >
          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {showStrength && value && <PasswordStrengthIndicator password={value} />}
      {error && (
        <p style={{ fontSize: '13px', color: 'var(--error)', marginTop: 'var(--space-2)' }}>
          {error}
        </p>
      )}
    </div>
  );
};