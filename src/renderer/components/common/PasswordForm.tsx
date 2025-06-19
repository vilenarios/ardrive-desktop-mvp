import React from 'react';
import { PasswordInput } from './PasswordInput';

interface PasswordFormProps {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  passwordTooltip?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
}

export const PasswordForm: React.FC<PasswordFormProps> = ({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  passwordTooltip,
  showStrength = true,
  autoFocus = false
}) => {
  const passwordsMatch = password === confirmPassword;
  const confirmError = confirmPassword && !passwordsMatch ? 'Passwords do not match' : undefined;

  return (
    <>
      <PasswordInput
        label="Password"
        value={password}
        onChange={onPasswordChange}
        placeholder="Enter password"
        autoFocus={autoFocus}
        showStrength={showStrength}
        tooltip={passwordTooltip}
      />
      
      <PasswordInput
        label="Confirm Password"
        value={confirmPassword}
        onChange={onConfirmPasswordChange}
        placeholder="Re-enter password"
        error={confirmError}
      />
    </>
  );
};