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
      background: 'var(--gray-50)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '600px',
        padding: 'var(--space-8)',
        background: 'white',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        textAlign: 'center'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '80px',
          height: '80px',
          margin: '0 auto var(--space-6)',
          background: 'var(--success-100)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <CheckCircle size={48} style={{ color: 'var(--success-600)' }} />
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          marginBottom: 'var(--space-6)',
          color: 'var(--gray-900)'
        }}>
          🎉 Your Drive Is Ready{currentProfile && (currentProfile.arnsName || currentProfile.name) ? `, ${currentProfile.arnsName || currentProfile.name}` : ''}!
        </h1>

        {/* Summary Box */}
        <div style={{
          background: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-5)',
          marginBottom: 'var(--space-6)',
          textAlign: 'left'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: 'var(--space-4)',
            color: 'var(--gray-900)'
          }}>
            Setup Summary
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Drive Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--ardrive-primary-100)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Globe size={18} style={{ color: 'var(--ardrive-primary)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: '2px' }}>Drive Name</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--gray-900)' }}>{driveName}</p>
              </div>
            </div>

            {/* Drive Type */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--warning-100)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Globe size={18} style={{ color: 'var(--warning-600)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: '2px' }}>Drive Type</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--gray-900)' }}>{driveType}</p>
              </div>
            </div>

            {/* Local Folder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{
                width: '32px',
                height: '32px',
                background: 'var(--ardrive-primary-100)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <FolderOpen size={18} style={{ color: 'var(--ardrive-primary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: '2px' }}>Local Sync Folder</p>
                <p style={{ 
                  fontSize: '15px', 
                  fontWeight: '600', 
                  color: 'var(--gray-900)',
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
                background: autoSyncEnabled ? 'var(--success-100)' : 'var(--gray-100)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Zap size={18} style={{ color: autoSyncEnabled ? 'var(--success-600)' : 'var(--gray-500)' }} />
              </div>
              <div>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginBottom: '2px' }}>Auto-Sync</p>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--gray-900)' }}>
                  {autoSyncEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Details Toggle */}
        {(driveId || rootFolderId || driveTxId) && (
          <button
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            style={{
              marginTop: 'var(--space-4)',
              background: 'none',
              border: 'none',
              color: 'var(--gray-600)',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-100)';
              e.currentTarget.style.color = 'var(--gray-800)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-600)';
            }}
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
            backgroundColor: 'var(--gray-50)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--gray-200)',
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
                  <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '4px' }}>Drive ID</p>
                  <p style={{ 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '13px', 
                    color: 'var(--gray-800)',
                    wordBreak: 'break-all'
                  }}>
                    {driveId}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(driveId, 'driveId')}
                  style={{
                    padding: 'var(--space-2)',
                    background: 'white',
                    border: '1px solid var(--gray-300)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    fontSize: '12px',
                    color: copiedField === 'driveId' ? 'var(--success-600)' : 'var(--gray-600)',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    if (copiedField !== 'driveId') {
                      e.currentTarget.style.borderColor = 'var(--gray-400)';
                      e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--gray-300)';
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
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
                  <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '4px' }}>Root Folder ID</p>
                  <p style={{ 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '13px', 
                    color: 'var(--gray-800)',
                    wordBreak: 'break-all'
                  }}>
                    {rootFolderId}
                  </p>
                </div>
                <button
                  onClick={() => handleCopy(rootFolderId, 'rootFolderId')}
                  style={{
                    padding: 'var(--space-2)',
                    background: 'white',
                    border: '1px solid var(--gray-300)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    fontSize: '12px',
                    color: copiedField === 'rootFolderId' ? 'var(--success-600)' : 'var(--gray-600)',
                    transition: 'all 0.2s ease',
                    flexShrink: 0
                  }}
                  onMouseEnter={(e) => {
                    if (copiedField !== 'rootFolderId') {
                      e.currentTarget.style.borderColor = 'var(--gray-400)';
                      e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--gray-300)';
                    e.currentTarget.style.backgroundColor = 'white';
                  }}
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
                  <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '4px' }}>Drive Transaction ID</p>
                  <p style={{ 
                    fontFamily: 'var(--font-mono)', 
                    fontSize: '13px', 
                    color: 'var(--gray-800)',
                    wordBreak: 'break-all'
                  }}>
                    {driveTxId}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <button
                    onClick={() => handleCopy(driveTxId, 'driveTxId')}
                    style={{
                      padding: 'var(--space-2)',
                      background: 'white',
                      border: '1px solid var(--gray-300)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      fontSize: '12px',
                      color: copiedField === 'driveTxId' ? 'var(--success-600)' : 'var(--gray-600)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (copiedField !== 'driveTxId') {
                        e.currentTarget.style.borderColor = 'var(--gray-400)';
                        e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--gray-300)';
                      e.currentTarget.style.backgroundColor = 'white';
                    }}
                  >
                    <Copy size={14} />
                    {copiedField === 'driveTxId' ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => openTransaction(driveTxId)}
                    style={{
                      padding: 'var(--space-2)',
                      background: 'white',
                      border: '1px solid var(--gray-300)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      fontSize: '12px',
                      color: 'var(--ardrive-primary)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
                      e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-50)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--gray-300)';
                      e.currentTarget.style.backgroundColor = 'white';
                    }}
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
          color: 'var(--gray-600)',
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