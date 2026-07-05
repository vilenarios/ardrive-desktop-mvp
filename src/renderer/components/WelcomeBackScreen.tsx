import React, { useState, useEffect } from 'react';
import { HardDrive, Plus, FolderOpen, Calendar, Database, ArrowRight, ChevronRight, SkipForward, ArrowLeft, User, Lock, Globe } from 'lucide-react';
import { DriveInfo, DriveInfoWithStatus, Profile } from '../../types';
import { ProfileSkeleton } from './common/ProfileSkeleton';
import { DriveListSkeleton } from './common/DriveSkeleton';
import { InfoButton } from './common/InfoButton';

// A11Y-1: `display: 'none'` on the radio inputs below removed them from both
// the tab order and the accessibility tree entirely — a keyboard-only user
// could never reach or select a drive on this screen (the .drive-select-card
// :focus-within rule in modal.css proves keyboard support was intended, just
// never reachable). This is the standard visually-hidden recipe: invisible
// on screen, but still focusable/tabbable and readable by assistive tech.
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

interface WelcomeBackScreenProps {
  currentProfile?: Profile | null;
  initialDrives?: DriveInfo[];
  onDriveSelected: (drive: DriveInfo) => void;
  onCreateNewDrive: () => void;
  onSkipSetup: () => void;
  onBack?: () => void;
  onProfileLoaded?: (profile: Profile) => void;
}

const WelcomeBackScreen: React.FC<WelcomeBackScreenProps> = ({
  currentProfile,
  initialDrives,
  onDriveSelected,
  onCreateNewDrive,
  onSkipSetup,
  onBack,
  onProfileLoaded
}) => {
  const [drives, setDrives] = useState<DriveInfoWithStatus[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  // UX-19: `initialDrives` is never actually `undefined` from the real caller
  // (App.tsx's `drives` state defaults to `[]`), so `!initialDrives` alone
  // never distinguishes "still loading" from "confirmed zero drives" — an
  // empty-but-defined array was being trusted as final data. Treat an empty
  // array the same as "not loaded yet" until verified below.
  const [drivesLoading, setDrivesLoading] = useState(!initialDrives || initialDrives.length === 0);
  const [profileLoading, setProfileLoading] = useState(!currentProfile);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialDrives || initialDrives.length === 0) {
      // No drives provided yet, or an empty list that hasn't been confirmed
      // via a real fetch — verify with the backend before treating it as a
      // genuine zero-drives account (UX-19).
      loadDrives();
    } else {
      // Use the initial drives (show ALL drives, not just public)
      setDrives(initialDrives as DriveInfoWithStatus[]);
      setDrivesLoading(false);

      // Pre-select if there's only one drive
      if (initialDrives.length === 1) {
        setSelectedDriveId(initialDrives[0].id);
      }
    }
  }, [initialDrives]);

  const loadDrives = async () => {
    try {
      setDrivesLoading(true);

      let driveList: DriveInfoWithStatus[] = [];

      // Try to use listWithStatus for emoji fingerprints
      try {
        const result = await window.electronAPI.drive.listWithStatus();
        console.log('Loaded drives with status in WelcomeBackScreen:', result);

        // Handle wrapped response from IPC handler
        if (result && result.success && result.data) {
          driveList = result.data;
        } else if (Array.isArray(result)) {
          // Direct array response
          driveList = result;
        }
      } catch (statusErr) {
        // Fallback to regular list if listWithStatus is not available
        console.log('listWithStatus not available, falling back to regular list');
        try {
          const regularResult = await window.electronAPI.drive.list();
          if (regularResult && regularResult.success && regularResult.data) {
            driveList = regularResult.data as DriveInfoWithStatus[];
          } else if (Array.isArray(regularResult)) {
            driveList = regularResult as DriveInfoWithStatus[];
          }
        } catch (fallbackErr) {
          console.error('Fallback also failed:', fallbackErr);
        }
      }

      // Show ALL drives (both public and private)
      setDrives(driveList || []);

      // Pre-select the most recent drive if there's only one
      if (driveList.length === 1) {
        setSelectedDriveId(driveList[0].id);
      }
    } catch (err) {
      console.error('Failed to load drives:', err);
      setError('Failed to load your drives');
    } finally {
      setDrivesLoading(false);
    }
  };

  // UAT-1b (defect #2): belt-and-suspenders for the wallet-manager-secure.ts
  // unixTime normalization fix — even a correctly-normalized ms value could
  // still be implausible (e.g. a future upstream regression), so clamp any
  // year outside a sane Arweave-era window to an honest "Unknown date"
  // instead of rendering a wild year like "Apr 3, 58474". 2018 is just after
  // Arweave's mainnet genesis (June 2018); a couple years of headroom past
  // "now" absorbs clock skew without hiding genuinely recent dates.
  const MIN_PLAUSIBLE_YEAR = 2018;
  const MAX_PLAUSIBLE_YEAR_SLACK = 2;

  const formatDate = (timestamp: number) => {
    try {
      if (!timestamp || timestamp <= 0) {
        return 'Unknown date';
      }
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      const year = date.getFullYear();
      const maxPlausibleYear = new Date().getFullYear() + MAX_PLAUSIBLE_YEAR_SLACK;
      if (year < MIN_PLAUSIBLE_YEAR || year > maxPlausibleYear) {
        return 'Unknown date';
      }
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (error) {
      console.error('Date formatting error:', error, 'timestamp:', timestamp);
      return 'Invalid date';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleContinue = () => {
    const selectedDrive = drives.find(d => d.id === selectedDriveId);
    console.log('Selected drive ID:', selectedDriveId);
    console.log('Selected drive object:', selectedDrive);
    if (selectedDrive) {
      onDriveSelected(selectedDrive);
    }
  };

  // Effect to handle profile updates
  useEffect(() => {
    if (currentProfile && profileLoading) {
      setProfileLoading(false);
      if (onProfileLoaded) {
        onProfileLoaded(currentProfile);
      }
    }
  }, [currentProfile, profileLoading, onProfileLoaded]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-6)',
      background: 'var(--surface)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '720px',
        padding: 'var(--space-8)',
        background: 'var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-3)'
      }}>
        {/* Header with Progressive Loading */}
        {profileLoading ? (
          <ProfileSkeleton />
        ) : (
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>

            {/* User Avatar */}
            {currentProfile && (
              <div style={{
                width: '64px',
                height: '64px',
                margin: '0 auto var(--space-4)',
                background: 'var(--surface-inset)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                border: '3px solid var(--border)',
                animation: 'fadeIn 0.5s ease-in'
              }}>
                {currentProfile.avatarUrl ? (
                  <img
                    src={currentProfile.avatarUrl}
                    alt={currentProfile.arnsName || currentProfile.name || 'User'}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      position: 'absolute',
                      top: 0,
                      left: 0
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const nextElement = e.currentTarget.nextSibling as HTMLElement;
                      if (nextElement) {
                        nextElement.style.display = '';
                      }
                    }}
                  />
                ) : null}
                <User size={32} style={currentProfile.avatarUrl ? { display: 'none' } : { color: 'var(--icon-mid)' }} />
              </div>
            )}

            {/* A11Y-5: onboarding had no <h1> anywhere — screen readers using
                heading navigation never landed on a top-level heading in
                this flow at all. This is the sole primary heading visible
                when this screen is mounted, so it's the correct <h1>. */}
            <h1 style={{ marginBottom: 'var(--space-3)', fontSize: '32px', fontWeight: '600', animation: 'fadeIn 0.5s ease-in', color: 'var(--text-primary)' }}>
              Welcome Back{currentProfile && (currentProfile.arnsName || currentProfile.name) ? `, ${currentProfile.arnsName || currentProfile.name}` : ''}!
            </h1>
            <p style={{ fontSize: '18px', color: 'var(--text-secondary)', lineHeight: '1.6', animation: 'fadeIn 0.5s ease-in' }}>
              {drivesLoading
                ? 'Loading your drives...'
                : drives.length > 0
                  ? `Great news! You already have ${drives.length} Drive${drives.length !== 1 ? 's' : ''} ready to sync.`
                  : 'No drives found. Create a new drive to get started.'
              }
            </p>
          </div>
        )}

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Drives List with Progressive Loading */}
        {drivesLoading ? (
          <DriveListSkeleton count={2} />
        ) : drives.length > 0 ? (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              marginBottom: 'var(--space-4)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
            }}>
              Choose a drive to sync:
              <InfoButton tooltip="Public drives are visible to anyone with the link, forever. Don't use one for anything sensitive. Private drives are encrypted with your password before they ever leave your device; ArDrive never sees or stores it." />
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {drives.map((drive) => (
              <label
                key={drive.id}
                className={`drive-select-card ${selectedDriveId === drive.id ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="drive"
                  value={drive.id}
                  checked={selectedDriveId === drive.id}
                  onChange={() => setSelectedDriveId(drive.id)}
                  style={visuallyHiddenStyle}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  {drive.privacy === 'private' ? (
                    <Lock size={24} style={{
                      color: selectedDriveId === drive.id ? 'var(--brand)' : 'var(--icon-mid)',
                      flexShrink: 0
                    }} />
                  ) : (
                    <Globe size={24} style={{
                      color: selectedDriveId === drive.id ? 'var(--brand)' : 'var(--icon-mid)',
                      flexShrink: 0
                    }} />
                  )}

                  <div style={{ flex: 1 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)'
                    }}>
                      <h4 style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)'
                      }}>
                        {drive.name}
                        {drive.privacy === 'private' && drive.emojiFingerprint && (
                          // POLISH-14 + coverage-table "Drive fingerprint" row:
                          // the emoji sequence had no explanation anywhere and
                          // no text fallback if the glyphs render as tofu boxes
                          // (observed in this repo's own Linux screenshot
                          // environment). Add both in one pass.
                          <span
                            title="Drive fingerprint. Should look identical every time you unlock this drive."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '14px',
                              opacity: 0.8
                            }}
                          >
                            {drive.emojiFingerprint}
                            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-tertiary)' }}>
                              (fingerprint)
                            </span>
                            <InfoButton tooltip="This emoji sequence is a visual fingerprint of your drive's encryption key. It should look identical every time you unlock this drive. If it changes, stop and don't enter your password." />
                          </span>
                        )}
                      </h4>
                      <span style={{
                        fontSize: 'var(--text-caption)',
                        fontWeight: 600,
                        padding: '2px 10px',
                        backgroundColor: drive.privacy === 'private' ? 'var(--warning-surface)' : 'var(--info-surface)',
                        borderRadius: 'var(--radius-pill)',
                        color: drive.privacy === 'private' ? 'var(--warning-fg)' : 'var(--info-fg)'
                      }}>
                        {drive.privacy === 'private' ? 'Private' : 'Public'}
                      </span>
                    </div>

                    <div style={{
                      display: 'flex',
                      gap: 'var(--space-4)',
                      fontSize: '14px',
                      color: 'var(--text-secondary)'
                    }}>
                      {drive.dateCreated && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <Calendar size={14} />
                          Created {formatDate(drive.dateCreated)}
                        </div>
                      )}
                      {drive.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <Database size={14} />
                          {formatFileSize(drive.size)}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedDriveId === drive.id && (
                    <ChevronRight size={20} style={{ color: 'var(--brand)' }} />
                  )}
                </div>
              </label>
            ))}

            {/* Create New Drive Option */}
            <button onClick={onCreateNewDrive} className="drive-create-option">
              <Plus size={24} />
              <div>
                <div className="drive-create-option-title">Create New Drive</div>
                <div className="drive-create-option-desc">Start fresh with a new Drive</div>
              </div>
            </button>
          </div>
        </div>
        ) : (
          // Show "No drives" state with Create New Drive option
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{
              textAlign: 'center',
              padding: 'var(--space-6)',
              backgroundColor: 'var(--surface-inset)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)'
            }}>
              <HardDrive size={48} style={{ color: 'var(--icon-low)', marginBottom: 'var(--space-3)' }} />
              <h3 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: 'var(--space-2)',
                color: 'var(--text-secondary)'
              }}>
                No drives found
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                Create your first drive to start syncing files
              </p>
            </div>

            {/* Create New Drive Option */}
            <button onClick={onCreateNewDrive} className="drive-create-option">
              <Plus size={24} />
              <div>
                <div className="drive-create-option-title">Create New Drive</div>
                <div className="drive-create-option-desc">Start fresh with a new Drive</div>
              </div>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {onBack && (
              <button
                className="button outline"
                onClick={onBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)'
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}

            <button
              className="button outline"
              onClick={onSkipSetup}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              <SkipForward size={16} />
              Skip Setup
            </button>
          </div>

          {drives.length > 0 && (
            <button
              className="button large"
              onClick={handleContinue}
              disabled={!selectedDriveId || drivesLoading}
              style={{
                fontSize: '16px',
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              Continue with Selected Drive
              <ArrowRight size={18} />
            </button>
          )}

          {drives.length === 0 && (
            <button
              className="button large"
              onClick={onCreateNewDrive}
              style={{
                fontSize: '16px',
                padding: '12px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              Create New Public Drive
              <ArrowRight size={18} />
            </button>
          )}
        </div>

        {/* COPY-13: "Skip Setup" didn't say what it skips to — a returning
            user couldn't tell if skipping meant an empty dashboard, no
            drive configured, etc. This line answers that directly for
            either choice (skip or continue). */}
        <p style={{
          marginTop: 'var(--space-4)',
          fontSize: '13px',
          color: 'var(--text-tertiary)',
          textAlign: 'center'
        }}>
          Skip for now and land on your dashboard — you can add or switch drives anytime from there.
        </p>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default WelcomeBackScreen;
