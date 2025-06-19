import React, { useState } from 'react';
import { RotateCcw, AlertTriangle, Shuffle, CheckCircle2, Upload, X, Sparkles, Zap, Lightbulb, Tag, FileText, Bookmark, Plus, Edit3, ChevronDown, ChevronRight } from 'lucide-react';
import { PendingUpload, ConflictResolution } from '../../types';
import { CustomMetadata, MetadataTemplate, FileWithMetadata, MetadataEditContext } from '../../types/metadata';
import { isTurboFree, formatFileSize } from '../../utils/turbo-utils';
import { getMimeTypeFromExtension } from '../../utils/mime-utils';
import MetadataEditor from './MetadataEditor';
import MetadataTemplateManager from './MetadataTemplateManager';
import { ExpandableSection } from './common/ExpandableSection';
import { InfoButton } from './common/InfoButton';

interface UploadApprovalQueueProps {
  pendingUploads: PendingUpload[];
  onApproveUpload: (uploadId: string, uploadMethod?: 'ar' | 'turbo', metadata?: CustomMetadata) => void;
  onRejectUpload: (uploadId: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onResolveConflict: (resolution: ConflictResolution) => void;
}

const UploadApprovalQueue: React.FC<UploadApprovalQueueProps> = ({
  pendingUploads,
  onApproveUpload,
  onRejectUpload,
  onApproveAll,
  onRejectAll,
  onResolveConflict
}) => {
  const [selectedUploads, setSelectedUploads] = useState<Set<string>>(new Set());
  const [showConflictResolution, setShowConflictResolution] = useState<string | null>(null);
  const [selectedMethods, setSelectedMethods] = useState<Map<string, 'ar' | 'turbo'>>(new Map());
  
  // Metadata state
  const [fileMetadata, setFileMetadata] = useState<Map<string, CustomMetadata>>(new Map());
  const [showMetadataEditor, setShowMetadataEditor] = useState<MetadataEditContext | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [metadataTemplates, setMetadataTemplates] = useState<MetadataTemplate[]>([]);
  const [selectedForBulkMetadata, setSelectedForBulkMetadata] = useState<Set<string>>(new Set());

  // Progressive disclosure state
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showFileDetails, setShowFileDetails] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const totalCost = pendingUploads.reduce((sum, upload) => sum + upload.estimatedCost, 0);
  const totalTurboCost = pendingUploads.reduce((sum, upload) => {
    // Don't count free files in the total
    if (isTurboFree(upload.fileSize)) return sum;
    return sum + (upload.estimatedTurboCost || 0);
  }, 0);
  const freeFileCount = pendingUploads.filter(u => isTurboFree(u.fileSize)).length;
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

  const getSelectedMethod = (uploadId: string, upload: PendingUpload): 'ar' | 'turbo' => {
    // If already selected, use that
    if (selectedMethods.has(uploadId)) {
      return selectedMethods.get(uploadId)!;
    }
    // Default to Turbo for free transactions (under 100KB)
    if (isTurboFree(upload.fileSize)) {
      return 'turbo';
    }
    // Otherwise use recommended method or fall back to AR
    return upload.recommendedMethod || 'ar';
  };

  const handleMethodChange = (uploadId: string, method: 'ar' | 'turbo') => {
    const newMethods = new Map(selectedMethods);
    newMethods.set(uploadId, method);
    setSelectedMethods(newMethods);
  };

  const handleApproveUpload = (uploadId: string) => {
    const upload = pendingUploads.find(u => u.id === uploadId);
    if (upload) {
      const method = getSelectedMethod(uploadId, upload);
      const metadata = fileMetadata.get(uploadId);
      onApproveUpload(uploadId, method, metadata);
    }
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

  const getConflictIcon = (conflictType?: string) => {
    const iconProps = { size: 16, style: { color: getConflictColor(conflictType) } };
    switch (conflictType) {
      case 'duplicate': return <RotateCcw {...iconProps} />;
      case 'filename_conflict': return <AlertTriangle {...iconProps} />;
      case 'content_conflict': return <Shuffle {...iconProps} />;
      default: return <CheckCircle2 {...iconProps} />;
    }
  };

  const getConflictColor = (conflictType?: string) => {
    switch (conflictType) {
      case 'duplicate': return 'var(--ardrive-warning)';
      case 'filename_conflict': return 'var(--ardrive-danger)';
      case 'content_conflict': return 'var(--ardrive-danger)';
      default: return 'var(--ardrive-secondary)';
    }
  };

  if (pendingUploads.length === 0) {
    return (
      <div className="card">
        <h2>Upload Queue</h2>
        <div className="empty-state">
          <div className="empty-state-icon">
            <Upload size={48} className="empty-icon" />
          </div>
          <div className="empty-state-title">No uploads pending</div>
          <div className="empty-state-description">
            Files added to your sync folder will appear here for review before upload.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h2>Upload Queue</h2>
          <span style={{ 
            background: 'var(--ardrive-primary-light)', 
            color: 'var(--ardrive-primary)', 
            padding: '2px 8px', 
            borderRadius: '12px', 
            fontSize: '12px', 
            fontWeight: '600' 
          }}>
            {pendingUploads.length}
          </span>
          <InfoButton tooltip="Review and approve files before upload. Add metadata or choose upload method." />
        </div>
        <div className="text-sm text-gray-600">
          Cost: <span className="font-semibold">{formatArCost(totalCost)}</span>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3)',
        backgroundColor: 'var(--gray-50)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--gray-200)'
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="button primary small" onClick={onApproveAll}>
            <CheckCircle2 size={14} />
            Approve All
          </button>
          <button className="button secondary small" onClick={onRejectAll}>
            <X size={14} />
            Reject All
          </button>
        </div>
        
        <button 
          className="button outline small"
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          {showAdvancedOptions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced Options
        </button>
      </div>

      {/* Notifications and Warnings */}
      {freeFileCount > 0 && (
        <div style={{
          padding: 'var(--space-3)',
          backgroundColor: 'var(--success-50)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--success-200)',
          marginBottom: 'var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)'
        }}>
          <Zap size={20} style={{ color: 'var(--success-600)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: '600', color: 'var(--success-900)' }}>
              {freeFileCount} {freeFileCount === 1 ? 'file is' : 'files are'} free with Turbo!
            </div>
            <div style={{ fontSize: '14px', color: 'var(--success-700)' }}>
              Files under 100KB upload instantly at no cost when using Turbo.
            </div>
          </div>
        </div>
      )}

      {conflictCount > 0 && (
        <div style={{ 
          backgroundColor: '#fef2f2', 
          border: '1px solid var(--ardrive-danger)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          padding: 'var(--space-3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AlertTriangle size={20} style={{ color: 'var(--ardrive-danger)' }} />
            <div>
              <div className="font-semibold" style={{ color: 'var(--ardrive-danger)' }}>
                {conflictCount} conflicts need review
              </div>
              <div className="text-sm text-gray-600">
                Review conflicted files before uploading to avoid data loss or unnecessary costs.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advanced Options - Progressive Disclosure */}
      {showAdvancedOptions && (
        <ExpandableSection 
          title="Metadata & Upload Options" 
          summary="Add metadata, manage templates, and configure upload settings"
          variant="bordered"
          defaultExpanded={true}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Tag size={16} color="var(--gray-600)" />
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--gray-700)' }}>
                  Metadata Tools
                </span>
                <InfoButton tooltip="Add custom metadata to files to improve searchability and organization" />
              </div>
              {selectedForBulkMetadata.size > 0 && (
                <span style={{ fontSize: '13px', color: 'var(--blue-600)' }}>
                  {selectedForBulkMetadata.size} files selected for bulk editing
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className="button secondary small"
                onClick={() => setShowTemplateManager(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <Bookmark size={14} />
                Templates
              </button>
              {selectedForBulkMetadata.size > 0 && (
                <>
                  <button
                    className="button small"
                    onClick={handleBulkMetadataEdit}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                  >
                    <Edit3 size={14} />
                    Edit {selectedForBulkMetadata.size} Files
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => setSelectedForBulkMetadata(new Set())}
                  >
                    Clear Selection
                  </button>
                </>
              )}
            </div>
          </div>
        </ExpandableSection>
      )}

      {/* File List Summary */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-3)',
        paddingBottom: 'var(--space-2)',
        borderBottom: '1px solid var(--gray-200)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Files to Upload</h3>
          <InfoButton tooltip="Review each file individually or use bulk actions above" />
        </div>
        <button 
          className="button outline small"
          onClick={() => setShowFileDetails(!showFileDetails)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          {showFileDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {showFileDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      <div className="upload-list" style={{ marginBottom: 'var(--space-4)' }}>
        {pendingUploads.map((upload) => {
          const isExpanded = expandedFiles.has(upload.id);
          
          return (
            <div key={upload.id} className="upload-item" style={{
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              overflow: 'hidden'
            }}>
              {/* File Header - Always Visible */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--space-3)',
                backgroundColor: upload.conflictType !== 'none' ? 'var(--orange-50)' : 'white'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
                  {showAdvancedOptions && (
                    <input
                      type="checkbox"
                      checked={selectedForBulkMetadata.has(upload.id)}
                      onChange={() => toggleBulkMetadataSelection(upload.id)}
                      style={{ marginRight: 'var(--space-2)' }}
                    />
                  )}
                  
                  <span style={{ color: getConflictColor(upload.conflictType) }}>
                    {getConflictIcon(upload.conflictType)}
                  </span>
                  
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '500', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {upload.fileName}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                      {formatFileSize(upload.fileSize)}
                      {upload.conflictType !== 'none' && (
                        <span style={{ color: 'var(--ardrive-danger)', marginLeft: 'var(--space-2)' }}>
                          • {upload.conflictDetails}
                        </span>
                      )}
                      {hasMetadata(upload.id) && (
                        <span style={{ color: 'var(--blue-600)', marginLeft: 'var(--space-2)' }}>
                          • Has metadata
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick method indicator */}
                  <div style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                    {getSelectedMethod(upload.id, upload) === 'turbo' ? (
                      <span style={{ color: 'var(--success-600)' }}>
                        <Zap size={12} style={{ display: 'inline', marginRight: '2px' }} />
                        Turbo
                      </span>
                    ) : (
                      <span>AR</span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {(showFileDetails || upload.conflictType !== 'none') && (
                    <button
                      className="button outline small"
                      onClick={() => {
                        const newExpanded = new Set(expandedFiles);
                        if (isExpanded) {
                          newExpanded.delete(upload.id);
                        } else {
                          newExpanded.add(upload.id);
                        }
                        setExpandedFiles(newExpanded);
                      }}
                      style={{ padding: 'var(--space-1)', minWidth: 'auto' }}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  )}
                  
                  <button
                    className="button primary small"
                    onClick={() => handleApproveUpload(upload.id)}
                  >
                    <CheckCircle2 size={14} />
                    Approve
                  </button>
                  
                  <button
                    className="button secondary small"
                    onClick={() => onRejectUpload(upload.id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded Details - Progressive Disclosure */}
              {(isExpanded || upload.conflictType !== 'none') && (
                <div style={{
                  padding: 'var(--space-3)',
                  borderTop: '1px solid var(--gray-200)',
                  backgroundColor: 'var(--gray-50)'
                }}>
                  {/* Upload Method Selection */}
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: 'var(--space-2)', color: 'var(--gray-700)' }}>
                      Upload Method:
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`method-${upload.id}`}
                          checked={getSelectedMethod(upload.id, upload) === 'ar'}
                          onChange={() => handleMethodChange(upload.id, 'ar')}
                        />
                        <span style={{ fontSize: '13px' }}>AR ({formatArCost(upload.estimatedCost)})</span>
                      </label>
                      {upload.estimatedTurboCost !== undefined && (
                        <label style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 'var(--space-1)', 
                          cursor: upload.hasSufficientTurboBalance !== false ? 'pointer' : 'not-allowed',
                          opacity: upload.hasSufficientTurboBalance !== false ? 1 : 0.7
                        }}>
                          <input
                            type="radio"
                            name={`method-${upload.id}`}
                            checked={getSelectedMethod(upload.id, upload) === 'turbo'}
                            onChange={() => handleMethodChange(upload.id, 'turbo')}
                            disabled={upload.hasSufficientTurboBalance === false}
                          />
                          <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                            <Zap size={12} />
                            Turbo {isTurboFree(upload.fileSize) ? '(Free)' : `(${formatFileSize(upload.estimatedTurboCost || 0)} Credits)`}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Metadata section */}
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--gray-700)' }}>
                        Metadata:
                      </div>
                      <button
                        className="button outline small"
                        onClick={() => handleOpenMetadataEditor([upload.id], 'single')}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
                      >
                        <Tag size={12} />
                        {hasMetadata(upload.id) ? 'Edit' : 'Add'}
                      </button>
                    </div>
                    
                    {hasMetadata(upload.id) ? (
                      <div style={{
                        padding: 'var(--space-2)',
                        backgroundColor: 'var(--blue-50)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                        color: 'var(--blue-700)'
                      }}>
                        {getMetadataPreview(upload.id)}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--gray-500)', fontStyle: 'italic' }}>
                        No custom metadata added
                      </div>
                    )}
                  </div>

                  {/* Conflict resolution */}
                  {upload.conflictType !== 'none' && (
                    <div style={{
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--orange-50)',
                      border: '1px solid var(--orange-200)',
                      borderRadius: 'var(--radius-sm)'
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--orange-800)', marginBottom: 'var(--space-2)' }}>
                        Conflict Resolution Required:
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--orange-700)', marginBottom: 'var(--space-2)' }}>
                        {upload.conflictDetails}
                      </div>
                      <button
                        className="button secondary small"
                        onClick={() => setShowConflictResolution(upload.id)}
                      >
                        Resolve Conflict
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sync-controls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1 }}>
          <div className="text-sm text-gray-600">
            <div>Total: {pendingUploads.length} files</div>
            <div>AR Cost: {formatArCost(totalCost)}</div>
            <div style={{ color: 'var(--ardrive-primary)' }}>
              Turbo Cost: {totalTurboCost > 0 ? `${totalTurboCost.toFixed(6)} Credits` : freeFileCount > 0 ? `FREE (${freeFileCount} files under 100KB)` : '0 Credits'}
            </div>
          </div>
          {conflictCount > 0 && (
            <div className="text-sm" style={{ color: 'var(--ardrive-danger)' }}>
              {conflictCount} conflicts
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button 
            className="button secondary"
            onClick={onRejectAll}
          >
            Reject All
          </button>
          <button 
            className="button"
            onClick={onApproveAll}
            disabled={conflictCount > 0}
          >
{conflictCount > 0 ? 'Resolve Conflicts First' : 'Upload All'}
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