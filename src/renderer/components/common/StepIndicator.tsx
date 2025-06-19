import React from 'react';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  variant?: 'create' | 'import';
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ 
  currentStep, 
  totalSteps,
  variant 
}) => {
  // Don't show on first step
  if (currentStep <= 1) return null;

  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      gap: 'var(--space-2)',
      marginBottom: 'var(--space-6)'
    }}>
      {steps.map((stepNum) => (
        <React.Fragment key={stepNum}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: currentStep >= stepNum ? 'var(--ardrive-primary)' : 'var(--gray-300)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '14px',
            transition: 'all 0.3s ease'
          }}>
            {currentStep > stepNum ? '✓' : stepNum}
          </div>
          {stepNum < totalSteps && (
            <div style={{
              width: '40px',
              height: '2px',
              backgroundColor: currentStep > stepNum ? 'var(--ardrive-primary)' : 'var(--gray-300)',
              transition: 'all 0.3s ease'
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};