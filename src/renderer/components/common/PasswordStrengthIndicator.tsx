import React from 'react';

interface PasswordStrengthIndicatorProps {
  password: string;
}

type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

const getPasswordStrength = (password: string): { level: StrengthLevel; score: number; feedback: string } => {
  if (!password) {
    return { level: 'weak', score: 0, feedback: 'Enter a password' };
  }

  let score = 0;
  const feedback: string[] = [];

  // Length check
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  // Character variety checks
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  // Common patterns to avoid
  if (/(.)\1{2,}/.test(password)) {
    score -= 1; // Repeated characters
    feedback.push('Avoid repeated characters');
  }
  if (/^[0-9]+$/.test(password)) {
    score -= 1; // Only numbers
    feedback.push('Use more than just numbers');
  }
  if (/^[a-zA-Z]+$/.test(password)) {
    score -= 1; // Only letters
    feedback.push('Add numbers or symbols');
  }

  // Determine strength level
  let level: StrengthLevel;
  let strengthFeedback: string;
  
  if (score <= 2) {
    level = 'weak';
    strengthFeedback = feedback.length > 0 ? feedback[0] : 'Too weak - add more characters';
  } else if (score <= 4) {
    level = 'fair';
    strengthFeedback = 'Fair - consider adding more variety';
  } else if (score <= 6) {
    level = 'good';
    strengthFeedback = 'Good password';
  } else {
    level = 'strong';
    strengthFeedback = 'Strong password!';
  }

  return { level, score: Math.min(score, 7), feedback: strengthFeedback };
};

export const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({ password }) => {
  const { level, score, feedback } = getPasswordStrength(password);

  // Fill colors (bar) use the plain status hue; text uses the deepened
  // `-fg` variant per DESIGN-SYSTEM.md §1.5 (status hues are fills/icons
  // only — text needs the accessible `-fg` pairing).
  const fillColors = {
    weak: 'var(--danger)',
    fair: 'var(--warning)',
    good: 'var(--info)',
    strong: 'var(--success)'
  };
  const textColors = {
    weak: 'var(--danger-fg)',
    fair: 'var(--warning-fg)',
    good: 'var(--info-fg)',
    strong: 'var(--success-fg)'
  };

  const maxScore = 7;
  const percentage = (score / maxScore) * 100;

  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <div style={{
        height: '4px',
        backgroundColor: 'var(--surface-inset)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 'var(--space-1)'
      }}>
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            backgroundColor: fillColors[level],
            transition: `width var(--motion-slow) var(--ease-standard), background-color var(--motion-slow) var(--ease-standard)`,
            borderRadius: 'var(--radius-sm)'
          }}
        />
      </div>
      <p style={{
        fontSize: '12px',
        color: textColors[level],
        fontWeight: '500'
      }}>
        {feedback}
      </p>
    </div>
  );
};