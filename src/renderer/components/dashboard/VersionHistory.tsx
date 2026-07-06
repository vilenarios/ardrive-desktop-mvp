import React, { useEffect, useState, useCallback } from 'react';
import {
  History,
  Eye,
  Download,
  Link as LinkIcon,
  Lock,
  AlertCircle,
  Loader2,
  Check,
} from 'lucide-react';
import type { FileVersion } from '../../../types';
import { useModalA11y } from '../../hooks/useModalA11y';
import { getGatewayHost } from '../../utils/gateway';
import '../../styles/version-history.css';

interface VersionHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  /** Display name of the file whose history is shown. */
  fileName: string;
  /**
   * Absolute local path used to key file_versions rows. Null when it can't be
   * reconstructed (e.g. no sync folder configured) — the modal then shows an
   * honest "can't locate this file" state instead of guessing.
   */
  filePath: string | null;
  /**
   * Private drives store encrypted bytes on-chain. A plain gateway fetch would
   * return ciphertext, so per-version view/download is gated honestly here
   * until the decrypt path is wired for the history view.
   */
  isPrivateDrive: boolean;
}

const CHANGE_TYPE_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  rename: 'Renamed',
  move: 'Moved',
};

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The on-chain data transaction id for a version, if one was recorded. */
function versionTxId(version: FileVersion): string | undefined {
  return version.arweaveId || version.turboId || undefined;
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({
  isOpen,
  onClose,
  fileName,
  filePath,
  isPrivateDrive,
}) => {
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onClose);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!filePath) {
      setVersions([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI?.files?.getVersions?.(filePath);
      if (!result) {
        throw new Error('Version history is unavailable in this build.');
      }
      if (!result.success) {
        throw new Error(result.error || 'Failed to load version history.');
      }
      const list = (result.data || []).slice().sort((a, b) => b.version - a.version);
      setVersions(list);
    } catch (err) {
      console.error('[VersionHistory] Failed to load versions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load version history.');
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (isOpen) {
      void loadVersions();
    } else {
      // Reset transient state so a reopened modal never flashes stale rows.
      setVersions([]);
      setError(null);
      setCopiedId(null);
    }
  }, [isOpen, loadVersions]);

  const openVersion = useCallback(async (txId: string) => {
    const host = await getGatewayHost();
    await window.electronAPI.shell.openExternal(`https://${host}/${txId}`);
  }, []);

  const copyLink = useCallback(async (version: FileVersion, txId: string) => {
    const host = await getGatewayHost();
    try {
      await navigator.clipboard.writeText(`https://${host}/${txId}`);
      setCopiedId(version.id);
      window.setTimeout(() => setCopiedId((current) => (current === version.id ? null : current)), 1500);
    } catch (err) {
      console.error('[VersionHistory] Failed to copy link:', err);
    }
  }, []);

  if (!isOpen) return null;

  const hasVersions = versions.length > 0;
  const singleVersion = versions.length === 1;

  return (
    <div className="drive-modal-overlay" onMouseDown={handleBackdropClick}>
      <div
        className="drive-modal-panel size-lg version-history-panel"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
      >
        <div className="drive-modal-header">
          <h3 id="version-history-title" className="drive-modal-title">
            <History size={20} />
            Version history
          </h3>
          <button
            className="drive-modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close version history"
          >
            &times;
          </button>
        </div>

        <p className="version-history-subtitle">
          <span className="version-history-filename" title={fileName}>{fileName}</span>
          <span className="version-history-permanence">
            Every version is preserved on Arweave permanently — nothing expires.
          </span>
        </p>

        {isPrivateDrive && (
          <div className="modal-banner is-neutral version-history-private-note">
            <Lock size={16} />
            <span>
              This file is on a private drive. Its versions are stored encrypted on Arweave, so
              viewing or downloading a specific past version needs your drive key — not available
              in this window yet. Your history is still preserved.
            </span>
          </div>
        )}

        <div className="modal-body version-history-body">
          {isLoading && (
            <div className="version-history-status" role="status">
              <Loader2 size={18} className="version-history-spin" />
              <span>Loading version history…</span>
            </div>
          )}

          {!isLoading && error && (
            <div className="modal-banner is-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && !error && !filePath && (
            <div className="version-history-empty">
              <AlertCircle size={22} />
              <p className="version-history-empty-title">Can&apos;t locate this file locally</p>
              <p className="version-history-empty-desc">
                Version history is tracked per synced file. Set up this drive&apos;s sync folder to
                see its version history.
              </p>
            </div>
          )}

          {!isLoading && !error && filePath && !hasVersions && (
            <div className="version-history-empty">
              <History size={22} />
              <p className="version-history-empty-title">No versions recorded yet</p>
              <p className="version-history-empty-desc">
                Once this file is uploaded and later edited, every revision will appear here —
                preserved on Arweave forever.
              </p>
            </div>
          )}

          {!isLoading && !error && hasVersions && (
            <>
              {singleVersion && (
                <p className="version-history-single-note">
                  Only one version so far. Every future change to this file is preserved
                  permanently on Arweave.
                </p>
              )}
              <ol className="version-history-list">
                {versions.map((version) => {
                  const txId = versionTxId(version);
                  const canRetrieve = !!txId && !isPrivateDrive;
                  const disabledReason = isPrivateDrive
                    ? 'Private drive — decryption not available in this window yet'
                    : !txId
                      ? 'No on-chain transaction recorded for this version yet'
                      : undefined;
                  return (
                    <li key={version.id} className="version-history-item">
                      <div className="version-history-item-main">
                        <div className="version-history-badges">
                          <span className="version-history-version-badge">v{version.version}</span>
                          {version.isLatest && (
                            <span className="version-history-latest-badge">Latest</span>
                          )}
                          <span className="version-history-change-badge">
                            {CHANGE_TYPE_LABEL[version.changeType] || version.changeType}
                          </span>
                        </div>
                        <div className="version-history-meta">
                          <span>{formatTimestamp(version.createdAt)}</span>
                          <span className="version-history-dot" aria-hidden="true">·</span>
                          <span>{formatBytes(version.fileSize)}</span>
                        </div>
                        {txId && (
                          <div className="version-history-tx" title={txId}>
                            tx {txId.slice(0, 8)}…{txId.slice(-6)}
                          </div>
                        )}
                      </div>
                      <div className="version-history-actions">
                        <button
                          type="button"
                          className="version-history-action"
                          disabled={!canRetrieve}
                          title={disabledReason || 'View this version on Arweave'}
                          aria-label={`View version ${version.version} on Arweave`}
                          onClick={() => txId && openVersion(txId)}
                        >
                          <Eye size={14} />
                          View
                        </button>
                        <button
                          type="button"
                          className="version-history-action"
                          disabled={!canRetrieve}
                          title={
                            disabledReason ||
                            'Download a copy of this exact version from Arweave — your local file is not changed'
                          }
                          aria-label={`Download a copy of version ${version.version}`}
                          onClick={() => txId && openVersion(txId)}
                        >
                          <Download size={14} />
                          Download a copy
                        </button>
                        <button
                          type="button"
                          className="version-history-action is-icon"
                          disabled={!txId}
                          title={txId ? "Copy this version's permanent link" : disabledReason}
                          aria-label={`Copy permanent link to version ${version.version}`}
                          onClick={() => txId && copyLink(version, txId)}
                        >
                          {copiedId === version.id ? <Check size={14} /> : <LinkIcon size={14} />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="version-history-restore-note">
                &ldquo;Download a copy&rdquo; retrieves that version&apos;s exact bytes from Arweave.
                It never overwrites your current local file and never re-uploads, so it can&apos;t
                cost anything.
              </p>
            </>
          )}
        </div>

        <div className="drive-modal-footer">
          <button type="button" className="button outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistory;
