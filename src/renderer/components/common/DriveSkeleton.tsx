import React from 'react';
import { Skeleton, SkeletonGroup } from './Skeleton';

export const DriveSkeleton: React.FC = () => {
  return (
    <div style={{
      padding: 'var(--space-4)',
      border: '2px solid var(--gray-200)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'white',
      display: 'block',
      width: '100%'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Drive Icon Skeleton */}
        <Skeleton width="24px" height="24px" borderRadius="4px" />
        
        {/* Drive Info */}
        <div style={{ flex: 1 }}>
          {/* Drive Name */}
          <div style={{ marginBottom: 'var(--space-2)' }}>
            <Skeleton width="180px" height="20px" />
          </div>
          
          {/* Drive Metadata */}
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <Skeleton width="120px" height="16px" />
            <Skeleton width="80px" height="16px" />
          </div>
        </div>
        
        {/* Chevron Icon */}
        <Skeleton width="20px" height="20px" borderRadius="4px" />
      </div>
    </div>
  );
};

interface DriveListSkeletonProps {
  count?: number;
}

export const DriveListSkeleton: React.FC<DriveListSkeletonProps> = ({ count = 2 }) => {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <h3 style={{ 
        fontSize: '16px', 
        fontWeight: '600', 
        marginBottom: 'var(--space-4)',
        color: 'var(--gray-700)'
      }}>
        Choose a drive to sync:
      </h3>
      
      <SkeletonGroup gap="var(--space-3)">
        {Array.from({ length: count }).map((_, index) => (
          <DriveSkeleton key={index} />
        ))}
        
        {/* Create New Drive Skeleton */}
        <div style={{
          padding: 'var(--space-4)',
          border: '2px dashed var(--gray-300)',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          opacity: 0.6
        }}>
          <Skeleton width="24px" height="24px" borderRadius="4px" />
          <div>
            <Skeleton width="140px" height="20px" />
            <div style={{ marginTop: '4px' }}>
              <Skeleton width="180px" height="16px" />
            </div>
          </div>
        </div>
      </SkeletonGroup>
    </div>
  );
};