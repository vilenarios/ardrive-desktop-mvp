import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCcw, AlertTriangle, CheckCircle2, Upload, X, Zap,
  ChevronDown, Wallet, Loader2, RefreshCw,
  Folder, FileText, Edit3, Move, Eye, EyeOff, Trash2,
  Info, DollarSign, CreditCard, ArrowRight
} from 'lucide-react';
import { PendingUpload } from '../../types';
import { CustomMetadata, MetadataTemplate, FileWithMetadata, MetadataEditContext } from '../../types/metadata';
import { isTurboFree, formatFileSize } from '../utils/turbo-utils';
import { getMimeTypeFromExtension } from '../utils/mime-utils';
import MetadataEditor from './MetadataEditor';
import MetadataTemplateManager from './MetadataTemplateManager';
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
  const [selectedUploads, setSelectedUploads] = useState<Set<string>>(new Set());

  // Metadata state
  const [fileMetadata, setFileMetadata] = useState<Map<string, CustomMetadata>>(new Map());
  const [showMetadataEditor, setShowMetadataEditor] = useState<MetadataEditContext | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [metadataTemplates, setMetadataTemplates] = useState<MetadataTemplate[]>([]);
  
  // Visible reason after Approve & Upload skips rows the Turbo balance
  // cannot cover (MONEY-1)
  const [balanceSkippedCount, setBalanceSkippedCount] = useState(0);

  // Track uploading state for files
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, { progress: number; status: UploadStatus; error?: string }>>(new Map());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [completedUploads, setCompletedUploads] = useState<Set<string>>(new Set());

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
        setCompletedUploads(prev => new Set(prev).add(data.uploadId));
        
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
          setCompletedUploads(prev => {
            const newSet = new Set(prev);
            newSet.delete(data.uploadId);
            return newSet;
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

  const getOperationDescription = (upload: PendingUpload): string => {
    switch (upload.operationType) {
      case 'move':
        return `Move: ${upload.previousPath || 'unknown'} → ${upload.localPath}`;
      case 'rename': {
        const oldName = upload.previousPath?.split('/').pop() || 'unknown';
        const newName = upload.fileName;
        return `Rename: ${oldName} → ${newName}`;
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
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-8) var(--space-4)',
          color: 'var(--gray-500)'
        }}>
          <Upload size={40} style={{ 
            color: 'var(--gray-400)', 
            marginBottom: 'var(--space-4)' 
          }} />
          <p style={{ 
            fontSize: '16px', 
            color: 'var(--gray-600)',
            marginBottom: 'var(--space-2)'
          }}>
            No files in queue
          </p>
          <p style={{ 
            fontSize: '14px',
            color: 'var(--gray-500)',
            maxWidth: '400px',
            margin: '0 auto'
          }}>
            Files added to your sync folder will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Unified Cost Banner */}
      <div style={{
        backgroundColor: 'var(--gray-50)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
        border: '1px solid var(--gray-200)'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 'var(--space-4)',
          alignItems: 'center'
        }}>
          {/* Balances Section */}
          <div style={{
            display: 'flex',
            gap: 'var(--space-4)',
            alignItems: 'center'
          }}>
            {/* AR Balance */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Wallet size={16} style={{ color: 'var(--gray-500)' }} />
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>AR Balance</div>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>
                  {walletInfo ? parseFloat(walletInfo.balance).toFixed(4) : '0.0000'} AR
                </div>
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '30px', backgroundColor: 'var(--gray-300)' }} />

            {/* Turbo Balance */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Zap size={16} style={{ color: 'var(--info-600)' }} />
              <div>
                <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>Turbo Credits</div>
                <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--info-700)' }}>
                  {walletInfo?.turboBalance || '0.0000'} Credits
                </div>
              </div>
            </div>
          </div>

          {/* Total Cost Section */}
          <div style={{
            textAlign: 'right',
            paddingLeft: 'var(--space-3)',
            borderLeft: '1px solid var(--gray-300)'
          }}>
            <div style={{ fontSize: '12px', color: 'var(--gray-500)', marginBottom: '2px' }}>
              Total Upload Cost
            </div>
            <div style={{ fontWeight: '600', fontSize: '16px' }}>
              {breakdown.freeFiles === pendingUploads.length ? (
                <span style={{ color: 'var(--success-600)' }}>FREE</span>
              ) : breakdown.turboFiles > 0 ? (
                <>
                  <span>{breakdown.totalTurboCredits.toFixed(4)} Credits</span>
                  {breakdown.unquotedFiles > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>
                      + {breakdown.unquotedFiles} {breakdown.unquotedFiles === 1 ? 'file' : 'files'}: estimate unavailable
                    </div>
                  )}
                </>
              ) : (
                <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--gray-500)' }}>
                  Estimate unavailable
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefreshBalance}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'none',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            color: 'var(--gray-400)',
            borderRadius: 'var(--radius-sm)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-100)';
            e.currentTarget.style.color = 'var(--gray-600)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--gray-400)';
          }}
          title="Refresh balances"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Queue Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: 'var(--space-3)' 
      }}>
        <h2 style={{ margin: 0 }}>
          Upload Queue ({pendingUploads.length})
        </h2>
      </div>

      {/* Conflict warning */}
      {conflictCount > 0 && conflictCount === pendingUploads.length && (
        <div style={{ 
          backgroundColor: 'var(--warning-50)', 
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-3)',
          padding: 'var(--space-3)',
          fontSize: '14px',
          color: 'var(--warning-700)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AlertTriangle size={16} />
            <span>All files have conflicts that need to be resolved</span>
          </div>
        </div>
      )}

      {/* File List */}
      <div style={{ 
        borderTop: '1px solid var(--gray-200)',
        borderBottom: '1px solid var(--gray-200)',
        marginBottom: 'var(--space-4)'
      }}>
        {pendingUploads.map((upload) => {
          const uploadStatus = getUploadStatus(upload);
          const isUploading = uploadStatus === 'uploading' || uploadStatus === 'uploaded';
          const OperationIcon = OPERATION_ICONS[upload.operationType || 'upload'];
          const uploadMethod = getFileUploadMethod(upload);
          
          return (
            <div 
              key={upload.id}
              className={`
                ${uploadStatus === 'uploading' ? 'upload-item--uploading' : ''}
                ${uploadStatus === 'uploaded' ? 'upload-item--uploaded' : ''}
              `.trim()}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr auto 120px auto',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: '12px 16px',
                borderBottom: '1px solid var(--gray-100)',
                backgroundColor: upload.conflictType !== 'none' ? 'var(--warning-50)' : 'transparent',
                transition: 'all 0.3s ease',
                position: 'relative'
              }}
            >
              {/* Operation Icon */}
              <OperationIcon 
                size={16} 
                style={{ 
                  color: upload.operationType && upload.operationType !== 'upload' 
                    ? 'var(--info-600)' 
                    : 'var(--gray-500)' 
                }} 
              />
              
              {/* File Info */}
              <div style={{ minWidth: 0 }}>
                <div style={{ 
                  fontSize: '14px',
                  fontWeight: '500',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {getOperationDescription(upload)}
                </div>
                {upload.conflictType !== 'none' && (
                  <div style={{ 
                    fontSize: '12px', 
                    color: 'var(--ardrive-danger)', 
                    marginTop: '2px' 
                  }}>
                    {upload.conflictDetails}
                  </div>
                )}
              </div>

              {/* Size & Type */}
              <div style={{ 
                fontSize: '13px',
                color: 'var(--gray-500)',
                textAlign: 'right'
              }}>
                {upload.mimeType === 'folder' || upload.fileSize === 0 
                  ? 'Folder' 
                  : formatFileSize(upload.fileSize)
                }
              </div>

              {/* Cost */}
              <div style={{ 
                fontSize: '13px',
                textAlign: 'right'
              }}>
                {uploadMethod.method === 'turbo-free' ? (
                  <span style={{ color: 'var(--success-600)', fontWeight: '500' }}>FREE</span>
                ) : uploadMethod.hasQuote ? (
                  <div>
                    <div style={{ fontWeight: '500' }}>{uploadMethod.cost}</div>
                    {uploadMethod.insufficientBalance && (
                      <div style={{ fontSize: '11px', color: 'var(--warning-600)' }}>
                        Insufficient balance
                        {onTopUpCredits && (
                          <>
                            {' — '}
                            <button
                              onClick={onTopUpCredits}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '11px',
                                color: 'var(--ardrive-primary)',
                                textDecoration: 'underline',
                                cursor: 'pointer'
                              }}
                            >
                              top up Turbo Credits
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--gray-500)' }}>
                    {uploadMethod.cost}
                  </div>
                )}
              </div>

              {/* Status & Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <StatusPill 
                  status={uploadStatus} 
                  progress={getUploadProgress(upload.id)}
                />
                
                {uploadStatus === 'uploading' && (
                  <button
                    onClick={() => handleCancelUpload(upload.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--warning-600)',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--warning-50)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <X size={16} />
                  </button>
                )}
                
                {uploadStatus === 'failed' && (
                  <button
                    onClick={() => handleRetryUpload(upload.id)}
                    title="Retry upload"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--ardrive-primary)',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-50)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <RefreshCw size={16} />
                  </button>
                )}
                
                {uploadStatus !== 'uploading' && uploadStatus !== 'uploaded' && upload.conflictType === 'none' && (
                  <button
                    onClick={() => onRejectUpload(upload.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--gray-400)',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-100)';
                      e.currentTarget.style.color = 'var(--gray-600)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--gray-400)';
                    }}
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
          Turbo balance cannot cover are never submitted — say so visibly */}
      {balanceSkippedCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3)',
          backgroundColor: 'var(--warning-50)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          fontSize: '14px',
          color: 'var(--warning-700)'
        }}>
          <AlertTriangle size={16} />
          <span>
            {balanceSkippedCount} {balanceSkippedCount === 1 ? 'file' : 'files'} skipped — insufficient Turbo Credits.
          </span>
          {onTopUpCredits && (
            <button
              onClick={onTopUpCredits}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: '14px',
                color: 'var(--ardrive-primary)',
                textDecoration: 'underline',
                cursor: 'pointer'
              }}
            >
              Top up Turbo Credits
            </button>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 'var(--space-2)'
      }}>
        {/* Left side */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {Array.from(uploadingFiles.values()).some(state => state.status === 'failed') && (
            <button 
              onClick={handleRetryAllFailed}
              style={{
                padding: '6px 12px',
                border: '1px solid var(--ardrive-primary)',
                backgroundColor: 'white',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--ardrive-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary)';
                e.currentTarget.style.color = 'white';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.color = 'var(--ardrive-primary)';
              }}
            >
              <RefreshCw size={14} />
              Retry Failed
            </button>
          )}
        </div>
        
        {/* Right side */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button 
            onClick={onRejectAll}
            style={{
              padding: '8px 16px',
              border: 'none',
              backgroundColor: 'transparent',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--gray-600)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-100)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Clear All
          </button>
          
          <button
            className="interactive-hover"
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
            style={{
              padding: '10px 24px',
              backgroundColor: approveAllDisabled
                ? 'var(--gray-300)'
                : 'var(--ardrive-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '500',
              cursor: approveAllDisabled
                ? 'not-allowed'
                : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              opacity: approveAllDisabled ? 0.7 : 1
            }}
            onMouseEnter={(e) => {
              if (!approveAllDisabled) {
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (!approveAllDisabled) {
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
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