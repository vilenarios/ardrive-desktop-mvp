import React, { useState, useEffect, useCallback } from 'react';
import { RotateCcw, AlertTriangle, Shuffle, CheckCircle2, Upload, X, Sparkles, Zap, Lightbulb, Tag, FileText, Bookmark, Plus, Edit3, ChevronDown, ChevronRight, Wallet, Loader2, RefreshCw, Folder } from 'lucide-react';
import { PendingUpload, ConflictResolution } from '../../types';
import { CustomMetadata, MetadataTemplate, FileWithMetadata, MetadataEditContext } from '../../types/metadata';
import { isTurboFree, formatFileSize } from '../../utils/turbo-utils';
import { getMimeTypeFromExtension } from '../../utils/mime-utils';
import MetadataEditor from './MetadataEditor';
import MetadataTemplateManager from './MetadataTemplateManager';
import { ExpandableSection } from './common/ExpandableSection';
import { InfoButton } from './common/InfoButton';
import StatusPill, { UploadStatus } from './common/StatusPill';

interface UploadApprovalQueueProps {
  pendingUploads: PendingUpload[];
  onApproveUpload: (uploadId: string, uploadMethod?: 'ar' | 'turbo', metadata?: CustomMetadata) => void;
  onRejectUpload: (uploadId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onResolveConflict: (resolution: ConflictResolution) => void;
  onRefreshBalance?: () => void;
  onRefreshPendingUploads?: () => void;
  onRefreshUploads?: () => void; // Add this to refresh completed uploads list
  walletInfo?: {
    balance: string;
    turboBalance?: string;
    turboWinc?: string;
  };
}

const UploadApprovalQueue: React.FC<UploadApprovalQueueProps> = ({
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
  
  // Metadata state
  const [fileMetadata, setFileMetadata] = useState<Map<string, CustomMetadata>>(new Map());
  const [showMetadataEditor, setShowMetadataEditor] = useState<MetadataEditContext | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [metadataTemplates, setMetadataTemplates] = useState<MetadataTemplate[]>([]);
  const [selectedForBulkMetadata, setSelectedForBulkMetadata] = useState<Set<string>>(new Set());

  // Progressive disclosure state
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showFileDetails, setShowFileDetails] = useState(() => {
    // Persist user preference
    const saved = localStorage.getItem('uploadQueue.showFileDetails');
    return saved ? saved === 'true' : false;
  });
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  
  // Auto-approve mode (default: false for safety - users must explicitly approve uploads)
  const [autoApprove, setAutoApprove] = useState(() => {
    const saved = localStorage.getItem('uploadQueue.autoApprove');
    return saved ? saved === 'true' : false;
  });
  
  // Track uploading state for files
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, { progress: number; status: UploadStatus; error?: string }>>(new Map());
  
  // Track files that are actively being processed
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  
  // Track successfully uploaded files for auto-removal
  const [completedUploads, setCompletedUploads] = useState<Set<string>>(new Set());
  
  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  
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
      
      // Handle completion
      if (data.status === 'completed') {
        // Add to completed set
        setCompletedUploads(prev => new Set(prev).add(data.uploadId));
        
        // Success notification would go here
        const upload = pendingUploads.find(u => u.id === data.uploadId);
        if (upload) {
          console.log(`Uploaded ${upload.fileName}`, isTurboFree(upload.fileSize) ? 'Free upload via Turbo' : undefined);
        }
        
        // Clean up local state after a delay (upload already moved from pending to uploads queue)
        setTimeout(() => {
          // Note: Don't call onRejectUpload here - the upload has already been moved
          // from pendingUploads to uploads queue when it was approved
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
          
          // Refresh the pending uploads to reflect the current state
          // This will remove the upload from the UI since it's no longer in pending
          if (onRefreshPendingUploads) {
            onRefreshPendingUploads();
          }
          
          // Refresh the completed uploads list so it appears in Activity tab
          if (onRefreshUploads) {
            onRefreshUploads();
          }
        }, 2000); // Show success state for 2 seconds before removing
        
        // Refresh balance after successful upload
        if (onRefreshBalance) {
          onRefreshBalance();
        }
      } else if (data.status === 'failed') {
        // Error notification would go here
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
    
    // Register event listeners
    window.electronAPI.onUploadProgress(handleUploadProgress);
    
    // Cleanup
    return () => {
      window.electronAPI.removeUploadProgressListener();
    };
  }, [pendingUploads, onRejectUpload, onRefreshBalance]);

  // Calculate file categories for upload cost breakdown
  const getUploadCostBreakdown = () => {
    let freeFiles = 0;
    let turboFiles = 0;
    let arFiles = 0;
    let totalTurboCredits = 0;
    let totalArCost = 0;
    
    pendingUploads.forEach(upload => {
      if (upload.conflictType !== 'none') return; // Skip conflicted files
      
      if (isTurboFree(upload.fileSize)) {
        // Files < 100KB are always free via Turbo
        freeFiles++;
      } else if (upload.hasSufficientTurboBalance !== false && upload.estimatedTurboCost !== undefined) {
        // Files >= 100KB with sufficient Turbo balance
        turboFiles++;
        totalTurboCredits += upload.estimatedTurboCost || 0;
      } else {
        // Files that will use AR (no Turbo credits available)
        arFiles++;
        totalArCost += upload.estimatedCost;
      }
    });
    
    return {
      freeFiles,
      turboFiles,
      arFiles,
      totalTurboCredits,
      totalArCost
    };
  };
  
  const breakdown = getUploadCostBreakdown();
  const totalCost = breakdown.totalArCost;
  const totalTurboCost = breakdown.totalTurboCredits;
  const freeFileCount = breakdown.freeFiles;
  const conflictCount = pendingUploads.filter(u => u.conflictType !== 'none').length;

  // Remove local formatFileSize since we import it from turbo-utils

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
      // Add to processing set
      setProcessingFiles(prev => new Set(prev).add(uploadId));
      
      // Set initial uploading state
      setUploadingFiles(prev => {
        const newMap = new Map(prev);
        newMap.set(uploadId, { progress: 0, status: 'uploading' });
        return newMap;
      });
      
      try {
        // Determine method based on MVP logic
        const uploadMethod = getFileUploadMethod(upload);
        const method = uploadMethod.method === 'ar' ? 'ar' : 'turbo';
        const metadata = fileMetadata.get(uploadId);
        
        // Start the upload
        await onApproveUpload(uploadId, method, metadata);
        
        // For instant uploads (Turbo free), simulate quick progress
        if (isTurboFree(upload.fileSize)) {
          // Simulate instant upload progress for free files
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
            }, progress * 10); // Very fast progress for free uploads
          }
        }
      } catch (error) {
        // Handle error
        setUploadingFiles(prev => {
          const newMap = new Map(prev);
          newMap.set(uploadId, { 
            progress: 0, 
            status: 'failed', 
            error: error instanceof Error ? error.message : 'Upload failed' 
          });
          return newMap;
        });
        
        // Remove from processing
        setProcessingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(uploadId);
          return newSet;
        });
        
        console.error(`Failed to upload ${upload.fileName}`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
  };
  
  // Retry failed upload
  const handleRetryUpload = (uploadId: string) => {
    // Clear error state
    setUploadingFiles(prev => {
      const newMap = new Map(prev);
      newMap.delete(uploadId);
      return newMap;
    });
    
    // Retry the upload
    handleApproveUpload(uploadId);
  };
  
  // Cancel upload
  const handleCancelUpload = async (uploadId: string) => {
    try {
      await window.electronAPI.uploads.cancel(uploadId);
      
      // Remove from tracking
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
  
  // Retry all failed uploads
  const handleRetryAllFailed = () => {
    const failedUploads = Array.from(uploadingFiles.entries())
      .filter(([_, state]) => state.status === 'failed')
      .map(([id]) => id);
    
    failedUploads.forEach(uploadId => {
      handleRetryUpload(uploadId);
    });
  };

  // Metadata functions
  const handleOpenMetadataEditor = (uploadIds: string[], mode: 'single' | 'bulk' = 'single') => {
    const files: FileWithMetadata[] = uploadIds.map(id => {
      const upload = pendingUploads.find(u => u.id === id);
      if (!upload) throw new Error(`Upload not found: ${id}`);
      
      const detectedMimeType = upload.mimeType || getMimeTypeFromExtension(upload.fileName);
      
      return {
        fileId: id,
        fileName: upload.fileName,
        filePath: upload.localPath,
        size: upload.fileSize,
        mimeType: detectedMimeType,
        metadata: fileMetadata.get(id) || {
          fileSize: upload.fileSize,
          originalFileName: upload.fileName,
          mimeType: detectedMimeType,
          uploadDate: new Date().toISOString()
        },
        hasCustomMetadata: fileMetadata.has(id)
      };
    });

    setShowMetadataEditor({
      mode,
      fileIds: uploadIds,
      files
    });
  };

  const handleSaveMetadata = (metadata: CustomMetadata, applyToAll: boolean = false) => {
    if (!showMetadataEditor) return;

    const newFileMetadata = new Map(fileMetadata);
    
    if (applyToAll || showMetadataEditor.mode === 'bulk') {
      // Apply to all files in the context
      showMetadataEditor.fileIds.forEach(fileId => {
        newFileMetadata.set(fileId, { ...metadata });
      });
    } else {
      // Apply to single file
      const fileId = showMetadataEditor.fileIds[0];
      newFileMetadata.set(fileId, { ...metadata });
    }
    
    setFileMetadata(newFileMetadata);
    setShowMetadataEditor(null);
  };

  const handleCreateTemplate = (template: Omit<MetadataTemplate, 'id' | 'createdAt' | 'useCount'>) => {
    const newTemplate: MetadataTemplate = {
      ...template,
      id: Date.now().toString(),
      createdAt: new Date(),
      useCount: 0
    };
    setMetadataTemplates(prev => [...prev, newTemplate]);
  };

  const handleUpdateTemplate = (id: string, updates: Partial<MetadataTemplate>) => {
    setMetadataTemplates(prev => 
      prev.map(template => 
        template.id === id ? { ...template, ...updates } : template
      )
    );
  };

  const handleDeleteTemplate = (id: string) => {
    setMetadataTemplates(prev => prev.filter(template => template.id !== id));
  };

  const handleLoadTemplate = (template: MetadataTemplate) => {
    // Update use count
    handleUpdateTemplate(template.id, { 
      useCount: template.useCount + 1,
      lastUsed: new Date()
    });
  };

  const toggleBulkMetadataSelection = (uploadId: string) => {
    const newSelected = new Set(selectedForBulkMetadata);
    if (newSelected.has(uploadId)) {
      newSelected.delete(uploadId);
    } else {
      newSelected.add(uploadId);
    }
    setSelectedForBulkMetadata(newSelected);
  };

  const handleBulkMetadataEdit = () => {
    if (selectedForBulkMetadata.size === 0) return;
    handleOpenMetadataEditor(Array.from(selectedForBulkMetadata), 'bulk');
  };

  const hasMetadata = (uploadId: string): boolean => {
    return fileMetadata.has(uploadId);
  };

  const getMetadataPreview = (uploadId: string): string => {
    const metadata = fileMetadata.get(uploadId);
    if (!metadata) return '';
    
    const items = [];
    if (metadata.title) items.push(metadata.title);
    if (metadata.category) items.push(metadata.category);
    if (metadata.keywords?.length) items.push(`${metadata.keywords.length} tags`);
    
    return items.slice(0, 2).join(' • ') || 'Custom metadata added';
  };

  const getUploadStatus = (upload: PendingUpload): UploadStatus => {
    // Check if we're tracking this file's upload state
    const uploadState = uploadingFiles.get(upload.id);
    if (uploadState) {
      return uploadState.status;
    }
    
    // Handle conflict states first
    if (upload.conflictType && upload.conflictType !== 'none') {
      return 'conflict';
    }
    
    // Check actual upload status
    switch (upload.status) {
      case 'approved':
        return 'ready';
      case 'rejected':
        return 'failed'; // Using failed state for rejected files
      case 'awaiting_approval':
        // If auto-approve is on, show as ready, otherwise keep as awaiting
        return autoApprove ? 'ready' : 'ready'; // Still show as ready for visual consistency
      default:
        return 'ready';
    }
  };
  
  const getUploadProgress = (uploadId: string): number => {
    const uploadState = uploadingFiles.get(uploadId);
    return uploadState?.progress || 0;
  };
  
  // Determine the actual upload method for a file based on MVP logic
  const getFileUploadMethod = (upload: PendingUpload): { method: 'turbo-free' | 'turbo' | 'ar'; cost: string } => {
    if (isTurboFree(upload.fileSize)) {
      return { method: 'turbo-free', cost: 'Free' };
    } else if (upload.hasSufficientTurboBalance !== false && upload.estimatedTurboCost !== undefined) {
      return { method: 'turbo', cost: `${upload.estimatedTurboCost.toFixed(4)} Credits` };
    } else {
      return { method: 'ar', cost: formatArCost(upload.estimatedCost) };
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the entire card
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    // Get dropped files
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // In a real implementation, this would add files to the sync folder
      // For now, we'll just show a toast or console log
      console.log('Files dropped:', files.map(f => f.name));
      // You could call: window.electronAPI.files.addToSyncFolder(files)
    }
  };

  return (
    <div 
      className={`card ${isDragging ? 'drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: 'relative',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(var(--ardrive-primary-rgb), 0.05)',
          border: '2px dashed var(--ardrive-primary)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          pointerEvents: 'none'
        }}>
          <Upload size={48} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-3)' }} />
          <p style={{ fontSize: '16px', fontWeight: '500', color: 'var(--ardrive-primary)' }}>
            Drop files here to add to queue
          </p>
          <p style={{ fontSize: '14px', color: 'var(--gray-600)', marginTop: 'var(--space-1)' }}>
            Files will be added to your sync folder
          </p>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2 style={{ margin: 0 }}>Upload Queue ({pendingUploads.length})</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span style={{ fontSize: '13px', color: 'var(--gray-600)', fontWeight: '500' }}>Est. Cost:</span>
          {breakdown.freeFiles > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--success-600)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>✅</span>
              <span>{breakdown.freeFiles} {breakdown.freeFiles === 1 ? 'file' : 'files'} free via Turbo</span>
            </div>
          )}
          {breakdown.turboFiles > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--info-600)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>🌀</span>
              <span>{breakdown.turboFiles} {breakdown.turboFiles === 1 ? 'file' : 'files'} using Turbo Credits ({breakdown.totalTurboCredits.toFixed(4)})</span>
            </div>
          )}
          {breakdown.arFiles > 0 && (
            <div style={{ fontSize: '12px', color: 'var(--gray-700)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>🧱</span>
              <span>{breakdown.arFiles} {breakdown.arFiles === 1 ? 'file' : 'files'} using AR ({formatArCost(breakdown.totalArCost)})</span>
            </div>
          )}
        </div>
      </div>

      {/* Only show conflict warnings if ALL files have conflicts */}
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

      {/* Balance Display - Only show when user has paid files */}
      {walletInfo && pendingUploads.length > 0 && conflictCount < pendingUploads.length && (breakdown.turboFiles > 0 || breakdown.arFiles > 0) && (
        <div style={{
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          fontSize: '12px'
        }}>
          <div style={{ 
            color: 'var(--gray-600)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              AR Balance: <strong>{parseFloat(walletInfo.balance).toFixed(6)}</strong>
              <InfoButton 
                tooltip="Used for on-chain (L1) uploads. Required if Turbo credits are unavailable. Files under 100KB upload instantly and for free via Turbo." 
              />
            </span>
            {walletInfo.turboBalance && (
              <>
                <span style={{ color: 'var(--gray-400)' }}>•</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  Turbo Balance: <strong>{walletInfo.turboBalance}</strong>
                  <InfoButton 
                    tooltip="Used for fast Layer 2 uploads. Files under 100KB upload free." 
                  />
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* File list separator line */}
      <div style={{
        height: '1px',
        backgroundColor: 'var(--gray-200)',
        marginBottom: 'var(--space-3)'
      }} />

      <div className="upload-list" style={{ marginBottom: 'var(--space-4)' }}>
        {pendingUploads.map((upload) => {
          const isExpanded = showFileDetails && expandedFiles.has(upload.id);
          const uploadStatus = getUploadStatus(upload);
          const isUploading = uploadStatus === 'uploading' || uploadStatus === 'uploaded';
          
          return (
            <React.Fragment key={upload.id}>
              <div 
                className={`
                  ${getUploadStatus(upload) === 'uploading' ? 'upload-item--uploading' : ''}
                  ${getUploadStatus(upload) === 'uploaded' ? 'upload-item--uploaded' : ''}
                `.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--gray-100)',
                  backgroundColor: upload.conflictType !== 'none' ? 'var(--warning-50)' : 'transparent',
                  transition: 'all 0.3s ease',
                  position: 'relative',
                  cursor: showFileDetails && !isUploading ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (showFileDetails && !isUploading && upload.conflictType === 'none') {
                    e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (showFileDetails && !isUploading && upload.conflictType === 'none') {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}>
              {/* File/Folder icon */}
              {upload.mimeType === 'folder' || upload.fileSize === 0 ? (
                <Folder size={16} style={{ color: 'var(--gray-500)', marginRight: 'var(--space-3)' }} />
              ) : (
                <FileText size={16} style={{ color: 'var(--gray-500)', marginRight: 'var(--space-3)' }} />
              )}
              
              {/* File info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 'var(--space-3)',
                  fontSize: '14px'
                }}>
                  <span 
                    className={uploadStatus === 'uploading' ? 'uploading-filename' : ''}
                    style={{ 
                      fontWeight: '500',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: '0 1 auto'
                    }}
                  >
                    {upload.fileName}
                  </span>
                  <span style={{ 
                    fontSize: '13px',
                    color: 'var(--gray-500)',
                    flexShrink: 0
                  }}>
                    {upload.mimeType === 'folder' || upload.fileSize === 0 ? 'Folder' : formatFileSize(upload.fileSize)}
                  </span>
                  
                  {/* Upload method tag */}
                  {upload.conflictType === 'none' && (
                    (() => {
                      const uploadMethod = getFileUploadMethod(upload);
                      return (
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontWeight: '500',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          ...(uploadMethod.method === 'turbo-free' ? {
                            backgroundColor: 'transparent',
                            color: 'var(--gray-600)',
                            border: 'none'
                          } : uploadMethod.method === 'turbo' ? {
                            backgroundColor: 'var(--info-50)',
                            color: 'var(--info-700)',
                            border: '1px solid var(--info-200)'
                          } : {
                            backgroundColor: 'var(--gray-50)',
                            color: 'var(--gray-700)',
                            border: '1px solid var(--gray-200)'
                          })
                        }}>
                          {uploadMethod.method === 'turbo-free' && (
                            <span 
                              title="Uploaded via Turbo (Free under 100KB)"
                              style={{ cursor: 'help', fontSize: '14px' }}
                            >
                              ⚡
                            </span>
                          )}
                          {uploadMethod.method === 'turbo' && (
                            <>
                              <span>🌀</span>
                              <span>Turbo ({uploadMethod.cost})</span>
                            </>
                          )}
                          {uploadMethod.method === 'ar' && (
                            <>
                              <span>🧱</span>
                              <span>AR ({uploadMethod.cost})</span>
                            </>
                          )}
                        </span>
                      );
                    })()
                  )}
                </div>
                
                {/* Show conflict details inline if present */}
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
              
              {/* Status pill */}
              <div style={{ marginRight: 'var(--space-3)' }}>
                <StatusPill 
                  status={getUploadStatus(upload)} 
                  progress={getUploadProgress(upload.id)}
                />
              </div>
              
              {/* Action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {/* Cancel button for uploading files */}
                {uploadStatus === 'uploading' && (
                  <button
                    onClick={() => handleCancelUpload(upload.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      color: 'var(--warning-600)',
                      fontSize: '12px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--warning-50)';
                      e.currentTarget.style.color = 'var(--warning-700)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--warning-600)';
                    }}
                  >
                    <X size={14} />
                    Cancel
                  </button>
                )}
                
                {/* Retry button for failed files */}
                {uploadStatus === 'failed' && (
                  <button
                    onClick={() => handleRetryUpload(upload.id)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--ardrive-primary)',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      color: 'var(--ardrive-primary)',
                      fontSize: '12px',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--ardrive-primary)';
                      e.currentTarget.style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--ardrive-primary)';
                    }}
                  >
                    <RefreshCw size={14} />
                    Retry
                  </button>
                )}
                
                {/* Expand button - only show when details mode is on */}
                {showFileDetails && upload.conflictType === 'none' && uploadStatus !== 'uploading' && uploadStatus !== 'uploaded' && (
                  <button
                    onClick={() => {
                      const newExpanded = new Set(expandedFiles);
                      if (isExpanded) {
                        newExpanded.delete(upload.id);
                      } else {
                        newExpanded.add(upload.id);
                      }
                      setExpandedFiles(newExpanded);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px',
                      cursor: 'pointer',
                      color: 'var(--gray-400)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
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
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                )}
                
                {/* Remove button - hide for uploading/uploaded files */}
                {uploadStatus !== 'uploading' && uploadStatus !== 'uploaded' && (
                  <button
                    onClick={() => onRejectUpload(upload.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 'var(--space-2)',
                      cursor: 'pointer',
                      color: 'var(--gray-400)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
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
                    aria-label="Remove file"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            </div>
            
            {/* Expandable Details Section */}
            {(isExpanded || upload.conflictType !== 'none') && (
              <div 
                className="upload-details-expanded"
                style={{
                  padding: '12px 16px 12px 48px',
                  backgroundColor: 'var(--gray-50)',
                  borderBottom: '1px solid var(--gray-100)',
                  fontSize: '13px',
                  color: 'var(--gray-600)'
                }}>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', alignItems: 'start' }}>
                  {/* File size */}
                  <span style={{ fontWeight: '500' }}>File size:</span>
                  <span>{formatFileSize(upload.fileSize)}</span>
                  
                  {/* Upload method */}
                  <span style={{ fontWeight: '500' }}>Upload method:</span>
                  <div>
                    {(() => {
                      const uploadMethod = getFileUploadMethod(upload);
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {uploadMethod.method === 'turbo-free' && (
                            <>
                              <span title="Free upload via Turbo" style={{ cursor: 'help' }}>⚡</span>
                              <span>Free upload via Turbo</span>
                            </>
                          )}
                          {uploadMethod.method === 'turbo' && (
                            <>
                              <span>🌀</span>
                              <span>Turbo ({uploadMethod.cost}) - Fast upload using your Turbo Credits</span>
                            </>
                          )}
                          {uploadMethod.method === 'ar' && (
                            <>
                              <span>🧱</span>
                              <span>AR ({uploadMethod.cost}) - On-chain upload using AR tokens</span>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  
                  {/* File path */}
                  <span style={{ fontWeight: '500' }}>Path:</span>
                  <span style={{ 
                    fontFamily: 'monospace', 
                    fontSize: '12px',
                    wordBreak: 'break-all' 
                  }}>
                    {upload.localPath}
                  </span>
                  
                  {/* Metadata */}
                  {hasMetadata(upload.id) && (
                    <>
                      <span style={{ fontWeight: '500' }}>Metadata:</span>
                      <span>{getMetadataPreview(upload.id)}</span>
                    </>
                  )}
                </div>
                
                {/* Add metadata button */}
                {!hasMetadata(upload.id) && showAdvancedOptions && (
                  <div style={{ marginTop: '12px' }}>
                    <button
                      onClick={() => handleOpenMetadataEditor([upload.id], 'single')}
                      style={{
                        padding: '4px 12px',
                        border: '1px solid var(--gray-300)',
                        backgroundColor: 'white',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Tag size={12} />
                      Add metadata
                    </button>
                  </div>
                )}
                
                {/* Conflict Resolution */}
                {upload.conflictType !== 'none' && (
                  <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--warning-50)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--warning-200)'
                  }}>
                    <div style={{ 
                      fontWeight: '500', 
                      color: 'var(--warning-700)',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <AlertTriangle size={14} />
                      Conflict Resolution Required
                    </div>
                    <div style={{ marginBottom: '12px', color: 'var(--warning-600)' }}>
                      {upload.conflictDetails}
                    </div>
                    <button
                      onClick={() => setShowConflictResolution(upload.id)}
                      style={{
                        padding: '6px 16px',
                        backgroundColor: 'var(--warning-600)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer'
                      }}
                    >
                      Resolve Conflict
                    </button>
                  </div>
                )}
              </div>
            )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Show Details Toggle */}
      <div style={{ 
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-3)' 
      }}>
        <button 
          onClick={() => {
            const newValue = !showFileDetails;
            setShowFileDetails(newValue);
            localStorage.setItem('uploadQueue.showFileDetails', String(newValue));
          }}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px 8px',
            cursor: 'pointer',
            color: 'var(--gray-600)',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: 'var(--radius-sm)',
            transition: 'background-color 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--gray-100)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {showFileDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {showFileDetails ? 'Hide' : 'Show'} details
        </button>
        
        {/* Cost summary shown inline when details are hidden */}
        {!showFileDetails && (
          <div style={{ 
            fontSize: '13px', 
            color: 'var(--gray-600)' 
          }}>
            <span>Total: {pendingUploads.length} {pendingUploads.length === 1 ? 'file' : 'files'}</span>
            {freeFileCount === pendingUploads.length && (
              <span style={{ color: 'var(--success-600)', marginLeft: 'var(--space-3)' }}>• Free upload</span>
            )}
          </div>
        )}
      </div>

      {/* Cost Summary - Streamlined version */}
      {showFileDetails && (
        <div style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          fontSize: '13px',
          color: 'var(--gray-600)',
          border: '1px solid var(--gray-200)'
        }}>
          {/* Simple message when all files are free */}
          {freeFileCount === pendingUploads.length ? (
            <div style={{ textAlign: 'center', color: 'var(--success-600)', fontWeight: '500' }}>
              Free upload
            </div>
          ) : (
            /* Detailed breakdown only when there are costs */
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-3) var(--space-4)', alignItems: 'center' }}>
              <span>Total:</span>
              <span style={{ fontWeight: '500', color: 'var(--gray-800)' }}>{pendingUploads.length} {pendingUploads.length === 1 ? 'file' : 'files'}</span>
              
              <span>AR Cost:</span>
              <span style={{ fontWeight: '500', color: 'var(--gray-800)' }}>{formatArCost(totalCost)}</span>
              
              {(totalTurboCost > 0 || freeFileCount > 0) && (
                <>
                  <span>Turbo:</span>
                  <span style={{ 
                    fontWeight: '500', 
                    color: freeFileCount > 0 ? 'var(--success-600)' : 'var(--gray-800)' 
                  }}>
                    {freeFileCount > 0 ? 
                      `Free (${freeFileCount} ${freeFileCount === 1 ? 'file' : 'files'} under 100KB)` : 
                      `${totalTurboCost.toFixed(6)} Credits`
                    }
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Advanced Options Link - More subtle placement */}
      <div style={{ 
        textAlign: 'center',
        marginTop: 'var(--space-2)',
        marginBottom: 'var(--space-3)'
      }}>
        <button
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px 8px',
            cursor: 'pointer',
            color: 'var(--gray-500)',
            fontSize: '12px',
            transition: 'color 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--gray-700)';
            e.currentTarget.style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--gray-500)';
            e.currentTarget.style.textDecoration = 'none';
          }}
        >
          Advanced options
        </button>
      </div>

      {/* Advanced Options Panel */}
      {showAdvancedOptions && (
        <div style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--gray-50)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          border: '1px solid var(--gray-200)'
        }}>
          <h4 style={{ 
            fontSize: '14px', 
            fontWeight: '600', 
            marginBottom: 'var(--space-3)',
            color: 'var(--gray-700)'
          }}>
            Advanced Options
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Auto-approve Mode */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              cursor: 'pointer',
              fontSize: '13px'
            }}>
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAutoApprove(checked);
                  localStorage.setItem('uploadQueue.autoApprove', String(checked));
                }}
              />
              <span>Auto-approve uploads</span>
              <InfoButton tooltip="Automatically start uploading files without manual approval (use with caution)" />
            </label>
            
            {/* Metadata Tools */}
            <div style={{ paddingLeft: '24px', opacity: 0.7 }}>
              <p style={{ fontSize: '12px', color: 'var(--gray-600)', marginBottom: '8px' }}>
                Metadata tools available when viewing file details
              </p>
              <button
                onClick={() => setShowTemplateManager(true)}
                style={{
                  padding: '4px 12px',
                  border: '1px solid var(--gray-300)',
                  backgroundColor: 'white',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Bookmark size={12} />
                Manage templates
              </button>
            </div>
            
            {/* Future options placeholder */}
            <div style={{ 
              paddingTop: 'var(--space-2)', 
              borderTop: '1px solid var(--gray-200)' 
            }}>
              <p style={{
                fontSize: '12px',
                color: 'var(--gray-500)',
                fontStyle: 'italic'
              }}>
                More options coming soon: batch processing, encryption, custom rules...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons bar */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--gray-200)',
        marginTop: 'var(--space-4)'
      }}>
        {/* Left side - Retry all button */}
        <div>
          {Array.from(uploadingFiles.values()).some(state => state.status === 'failed') && (
            <button 
              onClick={handleRetryAllFailed}
              style={{
                padding: '8px 16px',
                border: '1px solid var(--ardrive-primary)',
                backgroundColor: 'white',
                borderRadius: 'var(--radius-md)',
                fontSize: '14px',
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
              <RefreshCw size={16} />
              Retry All Failed
            </button>
          )}
        </div>
        
        {/* Right side - Clear all and Approve buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button 
            onClick={onRejectAll}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--gray-300)',
              backgroundColor: 'white',
              borderRadius: 'var(--radius-md)',
              fontSize: '14px',
              fontWeight: '500',
              color: 'var(--gray-700)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-50)';
              e.currentTarget.style.borderColor = 'var(--gray-400)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'white';
              e.currentTarget.style.borderColor = 'var(--gray-300)';
            }}
          >
            Clear all
          </button>
        
        <button 
          className="interactive-hover"
          onClick={async () => {
            try {
              // Get all non-conflicted uploads
              const uploadsToProcess = pendingUploads.filter(u => u.conflictType === 'none');
              
              if (uploadsToProcess.length === 0) {
                console.warn('No files to upload', 'All files have conflicts that need to be resolved');
                return;
              }
              
              // Log upload start
              console.log(`Starting upload of ${uploadsToProcess.length} ${uploadsToProcess.length === 1 ? 'file' : 'files'}`);
              
              // Call the approve all handler which will handle balance checking
              await onApproveAll();
              
              // Process each upload
              for (const upload of uploadsToProcess) {
                if (!processingFiles.has(upload.id)) {
                  // Small delay between uploads to avoid overwhelming the system
                  await new Promise(resolve => setTimeout(resolve, 100));
                  handleApproveUpload(upload.id);
                }
              }
            } catch (error) {
              console.error('Failed to approve all uploads:', error);
              console.error('Failed to start uploads', error instanceof Error ? error.message : 'Unknown error');
            }
          }}
          disabled={conflictCount > 0 && conflictCount === pendingUploads.length}
          style={{ 
            padding: '10px 24px',
            backgroundColor: conflictCount > 0 && conflictCount === pendingUploads.length ? 'var(--gray-300)' : 'var(--ardrive-primary)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: '14px',
            fontWeight: '500',
            cursor: conflictCount > 0 && conflictCount === pendingUploads.length ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: conflictCount > 0 && conflictCount === pendingUploads.length ? 0.7 : 1
          }}
          onMouseEnter={(e) => {
            if (!(conflictCount > 0 && conflictCount === pendingUploads.length)) {
              e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-hover)';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
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
          {conflictCount > 0 && conflictCount === pendingUploads.length ? 
            'Resolve conflicts first' : 
            autoApprove ? 'Start upload' : 'Approve & Upload'
          }
          </button>
        </div>
      </div>

      {/* Metadata Editor Modal */}
      {showMetadataEditor && (
        <MetadataEditor
          context={showMetadataEditor}
          onSave={handleSaveMetadata}
          onCancel={() => setShowMetadataEditor(null)}
          onSaveAsTemplate={handleCreateTemplate}
          templates={metadataTemplates}
          onLoadTemplate={handleLoadTemplate}
        />
      )}

      {/* Template Manager Modal */}
      {showTemplateManager && (
        <MetadataTemplateManager
          templates={metadataTemplates}
          onCreateTemplate={handleCreateTemplate}
          onUpdateTemplate={handleUpdateTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onLoadTemplate={handleLoadTemplate}
          onClose={() => setShowTemplateManager(false)}
        />
      )}

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

export default UploadApprovalQueue;