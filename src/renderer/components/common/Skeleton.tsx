import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  animation?: 'pulse' | 'wave';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '20px',
  borderRadius,
  className = '',
  variant = 'rectangular',
  animation = 'pulse'
}) => {
  const getBorderRadius = () => {
    if (borderRadius) return borderRadius;
    if (variant === 'circular') return '50%';
    if (variant === 'text') return '4px';
    return '8px';
  };

  const animationClass = animation === 'wave' ? 'skeleton-wave' : 'skeleton-pulse';

  return (
    <>
      <div
        className={`skeleton ${animationClass} ${className}`}
        style={{
          width,
          height,
          borderRadius: getBorderRadius(),
          backgroundColor: 'var(--gray-200)',
          position: 'relative',
          overflow: 'hidden'
        }}
      />
      <style>{`
        .skeleton {
          display: inline-block;
          position: relative;
          overflow: hidden;
        }

        .skeleton-pulse {
          animation: skeleton-pulse 1.5s ease-in-out infinite;
        }

        @keyframes skeleton-pulse {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
          100% {
            opacity: 1;
          }
        }

        .skeleton-wave::after {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.4),
            transparent
          );
          animation: skeleton-wave 1.5s ease-in-out infinite;
        }

        @keyframes skeleton-wave {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </>
  );
};

interface SkeletonGroupProps {
  count?: number;
  gap?: string;
  direction?: 'row' | 'column';
  children?: React.ReactNode;
}

export const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  count = 1,
  gap = 'var(--space-3)',
  direction = 'column',
  children
}) => {
  if (children) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: direction,
          gap
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: direction,
        gap
      }}
    >
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
};