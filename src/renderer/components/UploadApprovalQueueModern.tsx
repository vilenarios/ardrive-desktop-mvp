import React, { useState, useEffect, useCallback } from 'react';
import { 
  RotateCcw, AlertTriangle, CheckCircle2, Upload, X, Zap, 
  ChevronDown, ChevronRight, Wallet, Loader2, RefreshCw, 
  Folder, FileText, Edit3, Move, Eye, EyeOff, Trash2,
  Info, DollarSign, CreditCard, ArrowRight
} from 'lucide-react';
import { PendingUpload, ConflictResolution } from '../../types';
import { CustomMetadata, MetadataTemplate, FileWithMetadata, MetadataEditContext } from '../../types/metadata';
import { isTurboFree, formatFileSize } from '../utils/turbo-utils';
import { getMimeTypeFromExtension } from '../utils/mime-utils';
import { getArPriceInUSD, formatArToUSD, formatTurboCreditsToUSD } from '../utils/ar-price-utils';
import MetadataEditor from './MetadataEditor';
import MetadataTemplateManager from './MetadataTemplateManager';
import { InfoButton } from './common/InfoButton';
import StatusPill, { UploadStatus } from './common/StatusPill';

interface UploadApprovalQueueModernProps {
  pendingUploads: PendingUpload[];
  onApproveUpload: (uploadId: string, uploadMethod?: 'ar' | 'turbo', metadata?: CustomMetadata) => void;
  onRejectUpload: (uploadId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onResolveConflict: (resolution: ConflictResolution) => void;
  onRefreshBalance?: () => void;
  onRefreshPendingUploads?: () => void;
  onRefreshUploads?: () => void;
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
  onResolveConflict,
  onRefreshPendingUploads,
  onRefreshUploads,
  onRefreshBalance,
  walletInfo
}) => {
  const [selectedUploads, setSelectedUploads] = useState<Set<string>>(new Set());
  const [showConflictResolution, setShowConflictResolution] = useState<string | null>(null);
  const [arPriceUSD, setArPriceUSD] = useState<number>(0);
  const [loadingPrice, setLoadingPrice] = useState(true);
  
  // Metadata state
  const [fileMetadata, setFileMetadata] = useState<Map<string, CustomMetadata>>(new Map());
  const [showMetadataEditor, setShowMetadataEditor] = useState<MetadataEditContext | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [metadataTemplates, setMetadataTemplates] = useState<MetadataTemplate[]>([]);
  
  // Progressive disclosure state
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'auto' | 'ar' | 'turbo'>('auto');
  
  // Track uploading state for files
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, { progress: number; status: UploadStatus; error?: string }>>(new Map());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [completedUploads, setCompletedUploads] = useState<Set<string>>(new Set());

  // Fetch AR price on mount
  useEffect(() => {
    const fetchArPrice = async () => {
      try {
        setLoadingPrice(true);
        const price = await getArPriceInUSD();
        setArPriceUSD(price);
      } catch (error) {
        console.error('Failed to fetch AR price:', error);
        setArPriceUSD(6.50); // Fallback price
      } finally {
        setLoadingPrice(false);
      }
    };
    
    fetchArPrice();
    // Refresh price every 5 minutes
    const interval = setInterval(fetchArPrice, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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

  // Calculate upload cost breakdown
  const getUploadCostBreakdown = () => {
    let freeFiles = 0;
    let turboFiles = 0;
    let arFiles = 0;
    let totalTurboCredits = 0;
    let totalArCost = 0;
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
      } else if (upload.hasSufficientTurboBalance !== false && upload.estimatedTurboCost !== undefined) {
        turboFiles++;
        totalTurboCredits += upload.estimatedTurboCost || 0;
      } else {
        arFiles++;
        totalArCost += upload.estimatedCost;
      }
    });
    
    return {
      freeFiles,
      turboFiles,
      arFiles,
      totalTurboCredits,
      totalArCost,
      metadataOnlyOps
    };
  };
  
  const breakdown = getUploadCostBreakdown();
  const totalCostUSD = formatArToUSD(breakdown.totalArCost, arPriceUSD);
  const totalTurboCostUSD = formatTurboCreditsToUSD(breakdown.totalTurboCredits, arPriceUSD);
  const conflictCount = pendingUploads.filter(u => u.conflictType !== 'none').length;

  const formatArCost = (ar: number | null | undefined): string => {
    if (ar == null) return 'N/A';
    if (ar === 0) return '0.000000 AR';
    return `${ar.toFixed(6)} AR`;
  };

  const formatTurboCost = (credits: number | null | undefined, fileSize: number): string => {
    if (credits == null) return 'N/A';
    if (isTurboFree(fileSize)) return 'FREE';
    if (credits === 0) return '0 Credits';
    return `${credits.toFixed(6)} Credits`;
  };

  const handleApproveUpload = async (uploadId: string) => {
    const upload = pendingUploads.find(u => u.id === uploadId);
    if (upload && !processingFiles.has(uploadId)) {
      setProcessingFiles(prev => new Set(prev).add(uploadId));
      
      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.set(uploadId, { progress: 0, status: 'uploading' });
        return newMap;
      });
      
      try {
        const uploadMethod = getFileUploadMethod(upload);
        const method = uploadMethod.method === 'ar' ? 'ar' : 'turbo';
        const metadata = fileMetadata.get(uploadId);
        
        await onApproveUpload(uploadId, method, metadata);
        
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
  
  const getFileUploadMethod = (upload: PendingUpload): { method: 'turbo-free' | 'turbo' | 'ar'; cost: string } => {
    if (isTurboFree(upload.fileSize)) {
      return { method: 'turbo-free', cost: 'Free' };
    } else if (upload.hasSufficientTurboBalance !== false && upload.estimatedTurboCost !== undefined) {
      return { method: 'turbo', cost: `${upload.estimatedTurboCost.toFixed(4)} Credits` };
    } else {
      return { method: 'ar', cost: formatArCost(upload.estimatedCost) };
    }
  };

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
        return `Hide file from view`;
      case 'unhide':
        return `Show hidden file`;
      case 'delete':
        return `Delete from permaweb`;
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
                  {!loadingPrice && (
                    <span style={{ 
                      color: 'var(--gray-500)', 
                      fontSize: '12px',
                      marginLeft: '4px'
                    }}>
                      ({formatArToUSD(parseFloat(walletInfo?.balance || '0'), arPriceUSD)})
                    </span>
                  )}
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
                  {!loadingPrice && walletInfo?.turboBalance && (
                    <span style={{ 
                      color: 'var(--gray-500)', 
                      fontSize: '12px',
                      marginLeft: '4px'
                    }}>
                      ({formatTurboCreditsToUSD(parseFloat(walletInfo.turboBalance), arPriceUSD)})
                    </span>
                  )}
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
              ) : (
                <>
                  {!loadingPrice && (
                    <span>
                      {formatArToUSD(breakdown.totalArCost + breakdown.totalTurboCredits, arPriceUSD)}
                    </span>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--gray-500)', marginTop: '2px' }}>
                    {breakdown.arFiles > 0 && `${formatArCost(breakdown.totalArCost)} AR`}
                    {breakdown.arFiles > 0 && breakdown.turboFiles > 0 && ' + '}
                    {breakdown.turboFiles > 0 && `${breakdown.totalTurboCredits.toFixed(4)} Credits`}
                  </div>
                </>
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
                ) : (
                  <div>
                    <div style={{ fontWeight: '500' }}>{uploadMethod.cost}</div>
                    {!loadingPrice && (
                      <div style={{ fontSize: '11px', color: 'var(--gray-500)' }}>
                        {uploadMethod.method === 'turbo' 
                          ? formatTurboCreditsToUSD(upload.estimatedTurboCost || 0, arPriceUSD)
                          : formatArToUSD(upload.estimatedCost, arPriceUSD)
                        }
                      </div>
                    )}
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
                
                {uploadStatus !== 'uploading' && uploadStatus !== 'uploaded' && upload.conflictType !== 'none' && (
                  <button
                    onClick={() => setShowConflictResolution(upload.id)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: 'var(--warning-600)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Resolve
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

      {/* Advanced Options */}
      {showAdvancedOptions && (
        <div style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          border: '1px solid var(--gray-200)'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: 'var(--space-2)' }}>
            Payment Method
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="payment" 
                value="auto"
                checked={selectedPaymentMethod === 'auto'}
                onChange={() => setSelectedPaymentMethod('auto')}
              />
              <span style={{ fontSize: '13px' }}>Auto (Best price)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="payment" 
                value="turbo"
                checked={selectedPaymentMethod === 'turbo'}
                onChange={() => setSelectedPaymentMethod('turbo')}
              />
              <span style={{ fontSize: '13px' }}>Turbo Only</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input 
                type="radio" 
                name="payment" 
                value="ar"
                checked={selectedPaymentMethod === 'ar'}
                onChange={() => setSelectedPaymentMethod('ar')}
              />
              <span style={{ fontSize: '13px' }}>AR Only</span>
            </label>
          </div>
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
          
          <button
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            style={{
              background: 'none',
              border: 'none',
              padding: '6px 8px',
              cursor: 'pointer',
              color: 'var(--gray-500)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-100)';
              e.currentTarget.style.color = 'var(--gray-700)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--gray-500)';
            }}
          >
            <ChevronRight size={14} style={{ 
              transform: showAdvancedOptions ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s ease' 
            }} />
            More Settings
          </button>
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
                const uploadsToProcess = pendingUploads.filter(u => u.conflictType === 'none');
                
                if (uploadsToProcess.length === 0) {
                  console.warn('No files to upload', 'All files have conflicts that need to be resolved');
                  return;
                }
                
                console.log(`Starting upload of ${uploadsToProcess.length} ${uploadsToProcess.length === 1 ? 'file' : 'files'}`);
                
                await onApproveAll();
                
                for (const upload of uploadsToProcess) {
                  if (!processingFiles.has(upload.id)) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    handleApproveUpload(upload.id);
                  }
                }
              } catch (error) {
                console.error('Failed to approve all uploads:', error);
              }
            }}
            disabled={conflictCount > 0 && conflictCount === pendingUploads.length}
            style={{ 
              padding: '10px 24px',
              backgroundColor: conflictCount > 0 && conflictCount === pendingUploads.length 
                ? 'var(--gray-300)' 
                : 'var(--ardrive-primary)',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '500',
              cursor: conflictCount > 0 && conflictCount === pendingUploads.length 
                ? 'not-allowed' 
                : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              opacity: conflictCount > 0 && conflictCount === pendingUploads.length ? 0.7 : 1
            }}
            onMouseEnter={(e) => {
              if (!(conflictCount > 0 && conflictCount === pendingUploads.length)) {
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(220, 38, 38, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (!(conflictCount > 0 && conflictCount === pendingUploads.length)) {
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            {conflictCount > 0 && conflictCount === pendingUploads.length ? (
              'Resolve conflicts first'
            ) : (
              <>
                Approve & Upload
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Conflict Resolution Modal */}
      {showConflictResolution && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: '500px', margin: 'var(--space-4)' }}>
            <h3 style={{ marginBottom: 'var(--space-4)' }}>Resolve Conflict</h3>
            {(() => {
              const upload = pendingUploads.find(u => u.id === showConflictResolution);
              if (!upload) return null;
              
              return (
                <div>
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="font-semibold">{upload.fileName}</div>
                    <div className="text-sm text-gray-600">{upload.conflictDetails}</div>
                  </div>
                  
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="text-sm font-semibold" style={{ marginBottom: 'var(--space-2)' }}>
                      Choose an action:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <button 
                        className="button secondary"
                        onClick={() => {
                          onResolveConflict({ uploadId: upload.id, resolution: 'keep_local' });
                          setShowConflictResolution(null);
                        }}
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      >
                        <Upload size={16} style={{ marginRight: 'var(--space-1)' }} />
                        Keep Local (upload this version) - {formatArCost(upload.estimatedCost)}
                        {!loadingPrice && (
                          <span style={{ marginLeft: '4px', color: 'var(--gray-600)' }}>
                            ({formatArToUSD(upload.estimatedCost, arPriceUSD)})
                          </span>
                        )}
                      </button>
                      <button 
                        className="button secondary"
                        onClick={() => {
                          onResolveConflict({ uploadId: upload.id, resolution: 'use_remote' });
                          setShowConflictResolution(null);
                        }}
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      >
                        ⬇️ Use Remote (download remote version) - Free
                      </button>
                      <button 
                        className="button secondary"
                        onClick={() => {
                          onResolveConflict({ uploadId: upload.id, resolution: 'keep_both' });
                          setShowConflictResolution(null);
                        }}
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      >
                        📁 Keep Both (rename local file) - {formatArCost(upload.estimatedCost)}
                        {!loadingPrice && (
                          <span style={{ marginLeft: '4px', color: 'var(--gray-600)' }}>
                            ({formatArToUSD(upload.estimatedCost, arPriceUSD)})
                          </span>
                        )}
                      </button>
                      <button 
                        className="button secondary"
                        onClick={() => {
                          onResolveConflict({ uploadId: upload.id, resolution: 'skip' });
                          setShowConflictResolution(null);
                        }}
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                      >
                        ⏭️ Skip (don&apos;t sync this file) - Free
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                    <button 
                      className="button secondary"
                      onClick={() => setShowConflictResolution(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default UploadApprovalQueueModern;