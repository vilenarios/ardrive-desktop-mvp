import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, Upload, X, Zap,
  Wallet, RefreshCw,
  Edit3, Move, Eye, EyeOff, Trash2,
  ArrowRight
} from 'lucide-react';
import { PendingUpload } from '../../types';
import { CustomMetadata } from '../../types/metadata';
import { isTurboFree, formatFileSize } from '../utils/turbo-utils';
import { TURBO_FREE_SIZE_LIMIT } from '../../utils/turbo-utils';
import { InfoButton } from './common/InfoButton';
import StatusPill, { UploadStatus } from './common/StatusPill';

interface UploadApprovalQueueModernProps {
  pendingUploads: PendingUpload[];
  // Uploads execute via Turbo only (D-010) — 'turbo' is the only method the
  // queue ever submits. The parameter survives so the IPC argument stays
  // explicit and assertable.
  onApproveUpload: (uploadId: string, uploadMethod?: 'turbo', metadata?: CustomMetadata) => void;
  onRejectUpload: (uploadId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onRefreshBalance?: () => void;
  onRefreshPendingUploads?: () => void;
  onRefreshUploads?: () => void;
  // Opens the Turbo Credits manager (top-up). Optional: without it the
  // insufficient-balance reason renders as plain text.
  onTopUpCredits?: () => void;
  walletInfo?: {
    balance: string;
    turboBalance?: string;
    turboWinc?: string;
  };
}

// Operation type icons mapping
const OPERATION_ICONS = {
  upload: Upload,
  move: Move,
  rename: Edit3,
  hide: EyeOff,
  unhide: Eye,
  delete: Trash2
};

const UploadApprovalQueueModern: React.FC<UploadApprovalQueueModernProps> = ({
  pendingUploads,
  onApproveUpload,
  onRejectUpload,
  onApproveAll,
  onRejectAll,
  onRefreshPendingUploads,
  onRefreshUploads,
  onRefreshBalance,
  onTopUpCredits,
  walletInfo
}) => {
  // Metadata state (populated by MetadataEditor/MetadataTemplateManager
  // elsewhere in the flow; kept here for the approve-upload call below)
  const [fileMetadata] = useState<Map<string, CustomMetadata>>(new Map());

  // Visible reason after Approve & Upload skips rows the Turbo balance
  // cannot cover (MONEY-1)
  const [balanceSkippedCount, setBalanceSkippedCount] = useState(0);

  // Track uploading state for files
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, { progress: number; status: UploadStatus; error?: string }>>(new Map());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());

  // Setup upload progress event listeners
  useEffect(() => {
    const handleUploadProgress = (data: { uploadId: string; progress: number; status: 'uploading' | 'completed' | 'failed'; error?: string }) => {
      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.set(data.uploadId, {
          progress: data.progress,
          status: data.status as UploadStatus,
          error: data.error
        });
        return newMap;
      });

      if (data.status === 'completed') {
        const upload = pendingUploads.find(u => u.id === data.uploadId);
        if (upload) {
          console.log(`Uploaded ${upload.fileName}`, isTurboFree(upload.fileSize) ? 'Free upload via Turbo' : undefined);
        }

        setTimeout(() => {
          setUploadingFiles(prev => {
            const newMap = new Map(prev);
            newMap.delete(data.uploadId);
            return newMap;
          });

          if (onRefreshPendingUploads) {
            onRefreshPendingUploads();
          }

          if (onRefreshUploads) {
            onRefreshUploads();
          }
        }, 2000);

        if (onRefreshBalance) {
          onRefreshBalance();
        }
      } else if (data.status === 'failed') {
        const upload = pendingUploads.find(u => u.id === data.uploadId);
        if (upload) {
          console.error(`Failed to upload ${upload.fileName}`, data.error || 'Unknown error');
        }
        setProcessingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(data.uploadId);
          return newSet;
        });
      }
    };

    window.electronAPI.onUploadProgress(handleUploadProgress);

    return () => {
      window.electronAPI.removeUploadProgressListener();
    };
  }, [pendingUploads, onRejectUpload, onRefreshBalance]);

  // Calculate upload cost breakdown. Everything is paid via Turbo (D-010) —
  // files either have a real Turbo quote, are free-tier, or have no quote
  // ("estimate unavailable"). There is no AR cost to total.
  const getUploadCostBreakdown = () => {
    let freeFiles = 0;
    let turboFiles = 0;
    let unquotedFiles = 0;
    let totalTurboCredits = 0;
    let metadataOnlyOps = 0;

    pendingUploads.forEach(upload => {
      if (upload.conflictType !== 'none') return;

      // Check if this is a metadata-only operation
      if (upload.operationType && ['move', 'rename', 'hide', 'unhide', 'delete'].includes(upload.operationType)) {
        metadataOnlyOps++;
        // Metadata ops are typically very small (<1KB) so they're free with Turbo
        freeFiles++;
      } else if (isTurboFree(upload.fileSize)) {
        freeFiles++;
      } else if (upload.estimatedTurboCost != null) {
        // Real Turbo quote (whether or not the balance covers it) — the cost
        // itself is known. NOTE: rows arrive DB-shaped over IPC (booleans as
        // 0/1, missing quotes as null), so only `!= null` is a safe test here.
        turboFiles++;
        totalTurboCredits += upload.estimatedTurboCost;
      } else {
        // Genuinely no quote — cost unknown, disclosed as unavailable
        unquotedFiles++;
      }
    });

    return {
      freeFiles,
      turboFiles,
      unquotedFiles,
      totalTurboCredits,
      metadataOnlyOps
    };
  };

  const breakdown = getUploadCostBreakdown();
  const conflictCount = pendingUploads.filter(u => u.conflictType !== 'none').length;

  const handleApproveUpload = async (uploadId: string) => {
    const upload = pendingUploads.find(u => u.id === uploadId);
    if (upload && !processingFiles.has(uploadId)) {
      if (isBlockedForBalance(upload)) {
        // Blocked (MONEY-1): the quote is real and the balance cannot cover
        // it. The row shows "Insufficient balance — top up Turbo Credits";
        // nothing is submitted.
        return;
      }

      setProcessingFiles(prev => new Set(prev).add(uploadId));

      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.set(uploadId, { progress: 0, status: 'uploading' });
        return newMap;
      });

      try {
        const metadata = fileMetadata.get(uploadId);

        // Uploads execute via Turbo only (D-010) — always submit 'turbo'
        await onApproveUpload(uploadId, 'turbo', metadata);

        if (isTurboFree(upload.fileSize)) {
          for (let progress = 0; progress <= 100; progress += 20) {
            setTimeout(() => {
              setUploadingFiles(prev => {
                const newMap = new Map(prev);
                const current = newMap.get(uploadId);
                if (current && current.status === 'uploading') {
                  newMap.set(uploadId, { ...current, progress });
                }
                return newMap;
              });
            }, progress * 10);
          }
        }
      } catch (error) {
        setUploadingFiles(prev => {
          const newMap = new Map(prev);
          newMap.set(uploadId, {
            progress: 0,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed'
          });
          return newMap;
        });

        setProcessingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(uploadId);
          return newSet;
        });

        console.error(`Failed to upload ${upload.fileName}`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  };

  const handleRetryUpload = (uploadId: string) => {
    setUploadingFiles(prev => {
      const newMap = new Map(prev);
      newMap.delete(uploadId);
      return newMap;
    });

    handleApproveUpload(uploadId);
  };

  const handleCancelUpload = async (uploadId: string) => {
    try {
      await window.electronAPI.uploads.cancel(uploadId);

      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.delete(uploadId);
        return newMap;
      });

      setProcessingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(uploadId);
        return newSet;
      });

      const upload = pendingUploads.find(u => u.id === uploadId);
      if (upload) {
        console.log(`Cancelled upload of ${upload.fileName}`);
      }
    } catch (error) {
      console.error('Failed to cancel upload:', error);
    }
  };

  const handleRetryAllFailed = () => {
    const failedUploads = Array.from(uploadingFiles.entries())
      .filter(([_, state]) => state.status === 'failed')
      .map(([id]) => id);

    failedUploads.forEach(uploadId => {
      handleRetryUpload(uploadId);
    });
  };

  const getUploadStatus = (upload: PendingUpload): UploadStatus => {
    const uploadState = uploadingFiles.get(upload.id);
    if (uploadState) {
      return uploadState.status;
    }

    if (upload.conflictType && upload.conflictType !== 'none') {
      return 'conflict';
    }

    switch (upload.status) {
      case 'approved':
        return 'ready';
      case 'rejected':
        return 'failed';
      case 'awaiting_approval':
        return 'ready';
      default:
        return 'ready';
    }
  };

  const getUploadProgress = (uploadId: string): number => {
    const uploadState = uploadingFiles.get(uploadId);
    return uploadState?.progress || 0;
  };

  // Every upload is a Turbo upload (D-010 Turbo-only) — there is no AR
  // payment method. A row is either free-tier, quoted (with or without the
  // balance to cover it), or unquoted ("estimate unavailable").
  const getFileUploadMethod = (
    upload: PendingUpload
  ): { method: 'turbo-free' | 'turbo'; cost: string; hasQuote: boolean; insufficientBalance?: boolean } => {
    if (upload.operationType && ['move', 'rename', 'hide', 'unhide', 'delete'].includes(upload.operationType)) {
      // Metadata-only operations are tiny (<1KB) and free with Turbo
      return { method: 'turbo-free', cost: 'Free', hasQuote: true };
    }
    if (isTurboFree(upload.fileSize)) {
      return { method: 'turbo-free', cost: 'Free', hasQuote: true };
    } else if (upload.estimatedTurboCost != null) {
      // Real Turbo quote from the payment service — always shown. If the
      // balance can't cover it, say so rather than hiding the real number.
      // MONEY-6 staleness fix: prefer the LIVE balance (the walletInfo prop
      // refreshes on top-up) over the flag stored at queue time — topping up
      // must unblock rows without waiting for a re-quote. Falls back to the
      // stored flag when no live balance is available.
      // (Truthy check: rows arrive DB-shaped over IPC with booleans as 0/1.)
      const liveWinc = walletInfo?.turboWinc != null ? parseFloat(walletInfo.turboWinc) : NaN;
      const costWinc = upload.estimatedTurboCost * 1e12;
      const sufficient = !Number.isNaN(liveWinc)
        ? liveWinc >= costWinc
        : !!upload.hasSufficientTurboBalance;
      if (sufficient) {
        return { method: 'turbo', cost: `${upload.estimatedTurboCost.toFixed(4)} Credits`, hasQuote: true };
      }
      // Known cost the balance cannot cover — approval of this row is
      // blocked until the user tops up (MONEY-1).
      return {
        method: 'turbo',
        cost: `${upload.estimatedTurboCost.toFixed(4)} Credits`,
        hasQuote: true,
        insufficientBalance: true
      };
    } else {
      // No real quote (Turbo unavailable). The internal AR figure is a
      // placeholder, not network pricing — never display it as a price
      // (MONEY-3).
      return { method: 'turbo', cost: 'Estimate unavailable', hasQuote: false };
    }
  };

  // MONEY-1 approval semantics: a row whose real Turbo quote exceeds the
  // available balance cannot be approved — it is skipped with a visible
  // reason instead of being silently rerouted to a payment rail that does
  // not exist. Free-tier and unquoted rows stay approvable.
  const isBlockedForBalance = (upload: PendingUpload): boolean =>
    !!getFileUploadMethod(upload).insufficientBalance;

  const approvableUploads = pendingUploads.filter(
    u => u.conflictType === 'none' && !isBlockedForBalance(u)
  );
  const blockedForBalanceCount = pendingUploads.filter(
    u => u.conflictType === 'none' && isBlockedForBalance(u)
  ).length;
  const approveAllDisabled = approvableUploads.length === 0;

  const getOperationDescription = (upload: PendingUpload): React.ReactNode => {
    switch (upload.operationType) {
      case 'move': {
        const from = upload.previousPath || 'unknown';
        return (
          <span className="file-operation-desc">
            <span className="old-name">{from}</span>
            <ArrowRight className="arrow" size={12} />
            <span className="new-name">{upload.localPath}</span>
          </span>
        );
      }
      case 'rename': {
        const oldName = upload.previousPath?.split('/').pop() || 'unknown';
        return (
          <span className="file-operation-desc">
            <span className="old-name">{oldName}</span>
            <ArrowRight className="arrow" size={12} />
            <span className="new-name">{upload.fileName}</span>
          </span>
        );
      }
      case 'hide':
      case 'delete':
        // D-011: honest permanence. A local delete hides the item on Arweave —
        // it is NOT erased (permanent storage cannot delete). Unhide reverses it.
        return `Removed locally — hide on Arweave (can't be erased): ${upload.fileName}`;
      case 'unhide':
        return `Unhide on Arweave — restore to view: ${upload.fileName}`;
      default:
        return upload.fileName;
    }
  };

  if (pendingUploads.length === 0) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 var(--space-6) 0' }}>Upload Queue</h2>
        <div className="upload-queue-empty">
          <Upload size={40} className="upload-queue-empty-icon" />
          <p className="upload-queue-empty-title">No files in queue</p>
          <p className="upload-queue-empty-subtitle">
            Files added to your sync folder will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Unified Cost Banner */}
      <div className="upload-queue-cost-banner">
        {/* Balances Section */}
        <div className="balance-section">
          {/* AR Balance */}
          <div className="balance-item">
            <Wallet size={16} className="balance-icon" />
            <div>
              <div className="balance-label">AR Balance</div>
              <div className="balance-value">
                {/* MONEY-13: balance can be '' (fetch unavailable, e.g. a
                    gateway 429) - never let that reach parseFloat and render "NaN" */}
                {!walletInfo
                  ? '0.0000 AR'
                  : (walletInfo.balance === '' || isNaN(parseFloat(walletInfo.balance)))
                    ? 'Unavailable'
                    : `${parseFloat(walletInfo.balance).toFixed(4)} AR`}
              </div>
            </div>
          </div>

          <div className="balance-divider" />

          {/* Turbo Balance */}
          <div className="balance-item">
            <Zap size={16} className="balance-icon balance-icon--turbo" />
            <div>
              <div className="balance-label">
                Turbo Credits
                <InfoButton tooltip={`Turbo Credits are prepaid, instant-upload credits you buy with a card — no crypto wallet required. Files up to ${TURBO_FREE_SIZE_LIMIT / 1024} KiB upload free; every other file is quoted here in Credits before you approve it. Uploads in this app always go through Turbo, never a direct AR-token payment.`} />
              </div>
              <div className="balance-value balance-value--turbo">
                {walletInfo?.turboBalance || '0.0000'} Credits
              </div>
            </div>
          </div>
        </div>

        {/* Total Cost Section */}
        <div className="total-cost-section">
          <div className="total-cost-label-row">
            <span className="total-cost-label">Total Upload Cost</span>
            <InfoButton tooltip="This total is in Turbo Credits — the only way this app pays for uploads. If a file's cost shows as unavailable, Turbo's pricing service didn't respond in time; approving it still uploads the file, and the real cost is confirmed at upload time." />
          </div>
          <div className="total-cost-value">
            {breakdown.freeFiles === pendingUploads.length ? (
              <span className="total-cost-value--free">FREE</span>
            ) : breakdown.turboFiles > 0 ? (
              <>
                <span>{breakdown.totalTurboCredits.toFixed(4)} Credits</span>
                {breakdown.unquotedFiles > 0 && (
                  <div className="total-cost-unquoted-note">
                    + {breakdown.unquotedFiles} {breakdown.unquotedFiles === 1 ? 'file' : 'files'}: estimate unavailable
                  </div>
                )}
              </>
            ) : (
              <span className="total-cost-value--unavailable">
                Estimate unavailable
              </span>
            )}
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefreshBalance}
          className="refresh-button"
          title="Refresh balances"
          aria-label="Refresh balances"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Queue Header */}
      <div className="upload-queue-title-row">
        <h2>Upload Queue ({pendingUploads.length})</h2>
      </div>

      {/* Conflict warning */}
      {conflictCount > 0 && conflictCount === pendingUploads.length && (
        <div className="upload-queue-conflict-warning">
          <AlertTriangle size={16} />
          <span>All files have conflicts that need to be resolved</span>
        </div>
      )}

      {/* Column headers (RESTYLE-3): the one screen where a user compares
          cost vs. size needs labeled columns, matching StorageTab's
          Name/Size/Modified convention. */}
      <div className="upload-queue-header-row">
        <span />
        <span>File</span>
        <span className="col-right">Size</span>
        <span className="col-right">Cost</span>
        <span>Status</span>
      </div>

      {/* File List */}
      <div className="upload-queue-file-list">
        {pendingUploads.map((upload) => {
          const uploadStatus = getUploadStatus(upload);
          const OperationIcon = OPERATION_ICONS[upload.operationType || 'upload'];
          const uploadMethod = getFileUploadMethod(upload);
          const hasConflict = upload.conflictType !== 'none';

          return (
            <div
              key={upload.id}
              className={[
                'upload-queue-file-item',
                hasConflict ? 'has-conflict' : '',
                uploadStatus === 'uploading' ? 'upload-item--uploading' : '',
                uploadStatus === 'uploaded' ? 'upload-item--uploaded' : ''
              ].filter(Boolean).join(' ')}
            >
              {/* Operation Icon */}
              <OperationIcon
                size={16}
                className={`file-operation-icon ${upload.operationType && upload.operationType !== 'upload' ? 'file-operation-icon--active' : ''}`}
              />

              {/* File Info */}
              <div className="file-info">
                <div className="file-info-name">
                  {getOperationDescription(upload)}
                </div>
                {hasConflict && (
                  <div className="file-conflict-detail">
                    {upload.conflictDetails}
                  </div>
                )}
              </div>

              {/* Size + Cost — grouped so the mobile breakpoint can stack
                  them together while the desktop grid keeps them as their
                  own aligned columns (display:contents, see CSS) */}
              <div className="file-meta">
                <div className="file-size">
                  {upload.mimeType === 'folder' || upload.fileSize === 0
                    ? 'Folder'
                    : formatFileSize(upload.fileSize)
                  }
                </div>

                <div className="file-cost">
                  {uploadMethod.method === 'turbo-free' ? (
                    <span className="cost-free">FREE</span>
                  ) : uploadMethod.hasQuote ? (
                    <div>
                      <div className="cost-value">{uploadMethod.cost}</div>
                      {uploadMethod.insufficientBalance && (
                        <div className="cost-insufficient">
                          Insufficient balance
                          {onTopUpCredits && (
                            <>
                              {' — '}
                              <button
                                onClick={onTopUpCredits}
                                className="cost-topup-link"
                              >
                                top up Turbo Credits
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="cost-unavailable">
                      {uploadMethod.cost}
                    </div>
                  )}
                </div>
              </div>

              {/* Status & Actions */}
              <div className="file-actions">
                <StatusPill
                  status={uploadStatus}
                  progress={getUploadProgress(upload.id)}
                />

                {uploadStatus === 'uploading' && (
                  <button
                    onClick={() => handleCancelUpload(upload.id)}
                    className="file-action-btn file-action-btn--cancel"
                    title="Cancel upload"
                    aria-label="Cancel upload"
                  >
                    <X size={16} />
                  </button>
                )}

                {uploadStatus === 'failed' && (
                  <button
                    onClick={() => handleRetryUpload(upload.id)}
                    title="Retry upload"
                    aria-label="Retry upload"
                    className="file-action-btn file-action-btn--retry"
                  >
                    <RefreshCw size={16} />
                  </button>
                )}

                {uploadStatus !== 'uploading' && uploadStatus !== 'uploaded' && upload.conflictType === 'none' && (
                  <button
                    onClick={() => onRejectUpload(upload.id)}
                    className="file-action-btn file-action-btn--reject"
                    title="Remove from queue"
                    aria-label="Remove from queue"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Skipped-for-balance notice (MONEY-1): rows with a real quote the
          Turbo balance cannot cover are never submitted — say so visibly.
          RESTYLE-4: kept on one hue (warning) instead of mixing an amber
          message with a brand-red link — the link is underlined, not
          recolored, to read as one coordinated notice. */}
      {balanceSkippedCount > 0 && (
        <div className="upload-queue-skipped-notice">
          <AlertTriangle size={16} />
          <span>
            {balanceSkippedCount} {balanceSkippedCount === 1 ? 'file' : 'files'} skipped — insufficient Turbo Credits.
          </span>
          {onTopUpCredits && (
            <button
              onClick={onTopUpCredits}
              className="skipped-notice-topup-link"
            >
              Top up Turbo Credits
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="upload-queue-actions">
        {/* Left side */}
        <div className="left-actions">
          {Array.from(uploadingFiles.values()).some(state => state.status === 'failed') && (
            <button
              onClick={handleRetryAllFailed}
              className="retry-failed-btn"
            >
              <RefreshCw size={14} />
              Retry Failed
            </button>
          )}
        </div>

        {/* Right side */}
        <div className="right-actions">
          <button
            onClick={onRejectAll}
            className="clear-all-btn"
          >
            Clear All
          </button>

          <button
            className="approve-all-btn"
            onClick={async () => {
              try {
                // Rows with a real quote the balance cannot cover are
                // SKIPPED with a visible reason (MONEY-1) — never submitted.
                // Set unconditionally so a later all-sufficient click clears
                // a stale banner (qa-gate finding).
                setBalanceSkippedCount(blockedForBalanceCount);

                const uploadsToProcess = approvableUploads;

                if (uploadsToProcess.length === 0) {
                  console.warn('No files to upload', 'All files are blocked by conflicts or insufficient Turbo Credits');
                  return;
                }

                console.log(`Starting upload of ${uploadsToProcess.length} ${uploadsToProcess.length === 1 ? 'file' : 'files'}`);

                // MONEY-6: one approval action → one approval per file.
                // uploads:approve-all approves every eligible row with
                // consistent running-balance gating; the old per-file
                // follow-up loop re-approved rows approve-all had already
                // handled and pushed through rows it had deliberately
                // skipped for balance. (Per-file custom metadata was never
                // actually delivered through that loop — UX-14.)
                await onApproveAll();
              } catch (error) {
                console.error('Failed to approve all uploads:', error);
              }
            }}
            disabled={approveAllDisabled}
          >
            {approveAllDisabled ? (
              conflictCount === pendingUploads.length
                ? 'Resolve conflicts first'
                : 'Insufficient Turbo Credits'
            ) : (
              <>
                Approve & Upload
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
};

export default UploadApprovalQueueModern;
