import React, { useState } from 'react';
import { CheckCircle, FolderOpen, Globe, Zap, ArrowRight, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { Profile } from '../../types';

interface SetupSuccessScreenProps {
  currentProfile?: Profile | null;
  driveName: string;
  driveType: string;
  localSyncFolder: string;
  autoSyncEnabled: boolean;
  driveId?: string;
  rootFolderId?: string;
  driveTxId?: string;
  onOpenDashboard: () => void;
}

const SetupSuccessScreen: React.FC<SetupSuccessScreenProps> = ({
  currentProfile,
  driveName,
  driveType,
  localSyncFolder,
  autoSyncEnabled,
  driveId,
  rootFolderId,
  driveTxId,
  onOpenDashboard
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const openTransaction = (txId: string) => {
    window.open(`https://arweave.net/${txId}`, '_blank');
  };

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
        maxWidth: '600px',
        padding: 'var(--space-8)',
        background: 'var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-3)',
        textAlign: 'center'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '80px',
          height: '80px',
          margin: '0 auto var(--space-6)',
          background: 'var(--success-surface)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <CheckCircle size={48} style={{ color: 'var(--success)' }} />
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          marginBottom: 'var(--space-6)',
          color: 'var(--text-primary)'
        }}>
          🎉 Your Drive Is Ready{currentProfile && (currentProfile.arnsName || currentProfile.name) ? `, ${currentProfile.arnsName || currentProfile.name}` : ''}!
        </h1>

        {/* Summary Box */}
        <div style={{
          background: 'var(--surface-inset)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          marginBottom: 'var(--space-6)',
          textAlign: 'left'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: 'var(--space-4)',
            color: 'var(--text-primary)'
          }}>
            Setup Summary
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Drive Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--brand-surface)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Globe size={18} style={{ color: 'var(--brand)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Drive Name</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>{driveName}</p>
              </div>
            </div>

            {/* Drive Type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--warning-surface)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Globe size={18} style={{ color: 'var(--warning)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Drive Type</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>{driveType}</p>
              </div>
            </div>

            {/* Local Folder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--brand-surface)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FolderOpen size={18} style={{ color: 'var(--brand)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Local Sync Folder</p>
                <p style={{
                  fontSize: '15px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  wordBreak: 'break-all'
                }}>
                  {localSyncFolder}
                </p>
              </div>
            </div>

            {/* Auto-Sync Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: autoSyncEnabled ? 'var(--success-surface)' : 'var(--surface-inset)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Zap size={18} style={{ color: autoSyncEnabled ? 'var(--success)' : 'var(--icon-mid)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '2px' }}>Auto-Sync</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {autoSyncEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Details Toggle */}
        {(driveId || rootFolderId || driveTxId) && (
          <button
            className="modal-toggle-button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            style={{ marginTop: 'var(--space-4)' }}
          >
            {showTechnicalDetails ? (
              <>
                <ChevronUp size={16} />
                Hide Technical Details
              </>
            ) : (
              <>
                <ChevronDown size={16} />
                Show Technical Details
              </>
            )}
          </button>
        )}

        {/* Technical Details Section */}
        {showTechnicalDetails && (
          <div style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-4)',
            backgroundColor: 'var(--surface-inset)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            fontSize: '14px'
          }}>
            {driveId && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-3)',
                gap: 'var(--space-2)'
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Drive ID</p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    wordBreak: 'break-all'
                  }}>
                    {driveId}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(driveId, 'driveId')}
                  className={`modal-copy-button ${copiedField === 'driveId' ? 'is-copied' : ''}`}
                >
                  <Copy size={14} />
                  {copiedField === 'driveId' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}

            {rootFolderId && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-3)',
                gap: 'var(--space-2)'
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Root Folder ID</p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    wordBreak: 'break-all'
                  }}>
                    {rootFolderId}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(rootFolderId, 'rootFolderId')}
                  className={`modal-copy-button ${copiedField === 'rootFolderId' ? 'is-copied' : ''}`}
                >
                  <Copy size={14} />
                  {copiedField === 'rootFolderId' ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}

            {driveTxId && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-2)'
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Drive Transaction ID</p>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    wordBreak: 'break-all'
                  }}>
                    {driveTxId}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <button
                    onClick={() => handleCopy(driveTxId, 'driveTxId')}
                    className={`modal-copy-button ${copiedField === 'driveTxId' ? 'is-copied' : ''}`}
                  >
                    <Copy size={14} />
                    {copiedField === 'driveTxId' ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => openTransaction(driveTxId)}
                    className="modal-copy-button is-link"
                  >
                    <ExternalLink size={14} />
                    View
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reassurance Copy */}
        <p style={{
          fontSize: '16px',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
          marginBottom: 'var(--space-6)'
        }}>
          Your files will now sync between your local folder and the Permaweb.
          You can manage uploads, view files, and monitor sync status in the dashboard.
        </p>

        {/* CTA Button */}
        <button
          className="button large"
          onClick={onOpenDashboard}
          style={{
            width: '100%',
            fontSize: '16px',
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-2)'
          }}
        >
          Open Dashboard
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
};

export default SetupSuccessScreen;
