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
  
  const colors = {
    weak: '#dc2626',
    fair: '#f59e0b',
    good: '#3b82f6',
    strong: '#10b981'
  };

  const maxScore = 7;
  const percentage = (score / maxScore) * 100;

  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <div style={{
        height: '4px',
        backgroundColor: 'var(--gray-200)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 'var(--space-1)'
      }}>
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            backgroundColor: colors[level],
            transition: 'all 0.3s ease',
            borderRadius: 'var(--radius-sm)'
          }}
        />
      </div>
      <p style={{
        fontSize: '12px',
        color: colors[level],
        fontWeight: '500'
      }}>
        {feedback}
      </p>
    </div>
  );
};