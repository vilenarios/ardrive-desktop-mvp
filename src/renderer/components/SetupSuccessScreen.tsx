import React, { useState, useEffect } from 'react';
import { CheckCircle, FolderOpen, Globe, Lock, Zap, ArrowRight, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { Profile } from '../../types';

// H-GW-1: mirrors src/main/gateway.ts's DEFAULT_GATEWAY_HOST and the same
// pattern Settings.tsx already uses (see its own DEFAULT_GATEWAY_HOST
// comment) — a renderer-side fallback only, used until config:get resolves.
// The main process (gateway.ts) remains the single source of truth.
const DEFAULT_GATEWAY_HOST = 'turbo-gateway.com';

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
  // H-GW-1: "View" used to hardcode arweave.net, which rate-limits (429s)
  // some users and violates the turbo-gateway.com read rail (D-012). Resolve
  // the same configured gateway host Settings.tsx reads/writes via
  // config:get, falling back to the same default if unset.
  const [gatewayHost, setGatewayHost] = useState(DEFAULT_GATEWAY_HOST);

  useEffect(() => {
    let cancelled = false;
    // Defensive `await` on an optional call (rather than `.then`/`.catch`
    // chained straight off it): several component suites render this screen
    // against a minimal electronAPI stub that doesn't implement config.get,
    // and `await undefined` resolves harmlessly instead of throwing.
    (async () => {
      try {
        const result = await window.electronAPI?.config?.get?.();
        if (!cancelled && result?.success && result.data?.gatewayHost?.trim()) {
          setGatewayHost(result.data.gatewayHost.trim());
        }
      } catch (err) {
        console.error('Failed to load gateway host, using default:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // TRUST-5: this row used to hardcode a Globe icon regardless of the actual
  // driveType passed in — a private drive's own confirmation screen showed
  // the public icon, exactly backwards for the one screen whose job is
  // letting the user trust what "private" means before they upload anything.
  // WelcomeBackScreen.tsx branches Lock/Globe off `drive.privacy`; mirror
  // that here off the `driveType` string this component actually receives.
  const isPrivateDrive = driveType.toLowerCase().includes('private');

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
    window.open(`https://${gatewayHost}/${txId}`, '_blank');
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
        {/* POLISH-3: a party-popper emoji in the largest, boldest text on
            the confirmation screen undercut the sleek/permanent tone this
            product is going for — the CheckCircle above already carries
            the "success" signal, so the emoji was purely redundant. */}
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          marginBottom: 'var(--space-6)',
          color: 'var(--text-primary)'
        }}>
          Your Drive Is Ready{currentProfile && (currentProfile.arnsName || currentProfile.name) ? `, ${currentProfile.arnsName || currentProfile.name}` : ''}!
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
                background: isPrivateDrive ? 'var(--warning-surface)' : 'var(--info-surface)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {isPrivateDrive ? (
                  <Lock size={18} style={{ color: 'var(--warning)' }} />
                ) : (
                  <Globe size={18} style={{ color: 'var(--info)' }} />
                )}
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
        {/* Permanence + public/private framing: this used to be a generic
            "your files will sync" line with no honest expectation-setting --
            the exact moment this product differs most from Dropbox (nothing
            you upload can be edited or deleted, and a public drive is
            visible to anyone) was never said anywhere in onboarding. */}
        <p style={{
          fontSize: '16px',
          color: 'var(--text-secondary)',
          lineHeight: '1.6',
          marginBottom: 'var(--space-6)'
        }}>
          Your files will now sync between your local folder and the Permaweb. Once uploaded, they&apos;re stored
          permanently and can&apos;t be edited or deleted, by you or anyone else. {isPrivateDrive
            ? 'This is a private drive: files are encrypted on your device before they ever reach the network.'
            : 'This is a public drive: anyone with the link can view these files, forever.'}{' '}
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
