import React from 'react';
import { Skeleton } from './Skeleton';

export const ProfileSkeleton: React.FC = () => {
  return (
    <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
      {/* Avatar Skeleton */}
      <div style={{ 
        width: '64px', 
        height: '64px', 
        margin: '0 auto var(--space-4)',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '50%',
        border: '3px solid var(--gray-200)'
      }}>
        <Skeleton variant="circular" width="100%" height="100%" />
      </div>
      
      {/* Name Skeleton */}
      <div style={{ 
        marginBottom: 'var(--space-3)', 
        display: 'flex', 
        justifyContent: 'center' 
      }}>
        <Skeleton width="250px" height="32px" borderRadius="6px" />
      </div>
      
      {/* Description Skeleton */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        gap: 'var(--space-2)' 
      }}>
        <Skeleton width="350px" height="20px" borderRadius="4px" />
        <Skeleton width="280px" height="20px" borderRadius="4px" />
      </div>
    </div>
  );
};