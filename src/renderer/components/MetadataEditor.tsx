import React, { useState, useEffect } from 'react';
import { 
  X, 
  Save, 
  Plus, 
  Minus, 
  Tag, 
  FileText, 
  Folder, 
  Calendar,
  Hash,
  Type,
  Bookmark,
  Copy,
  Check,
  AlertCircle,
  Info
} from 'lucide-react';
import { CustomMetadata, MetadataTemplate, FileWithMetadata, MetadataValidationError, MetadataEditContext } from '../../types/metadata';
import { InfoButton } from './common/InfoButton';
import { ExpandableSection } from './common/ExpandableSection';

interface MetadataEditorProps {
  context: MetadataEditContext;
  onSave: (metadata: CustomMetadata, applyToAll?: boolean) => void;
  onCancel: () => void;
  onSaveAsTemplate: (template: Omit<MetadataTemplate, 'id' | 'createdAt' | 'useCount'>) => void;
  templates: MetadataTemplate[];
  onLoadTemplate: (template: MetadataTemplate) => void;
}

const COMMON_CATEGORIES = [
  'Document',
  'Image', 
  'Video',
  'Audio',
  'Archive',
  'Code',
  'Presentation',
  'Spreadsheet',
  'Other'
];

const COMMON_CONTENT_TYPES = [
  'Personal',
  'Work',
  'Project',
  'Backup',
  'Media',
  'Document',
  'Reference',
  'Archive'
];

const MetadataEditor: React.FC<MetadataEditorProps> = ({
  context,
  onSave,
  onCancel,
  onSaveAsTemplate,
  templates,
  onLoadTemplate
}) => {
  const [metadata, setMetadata] = useState<CustomMetadata>(() => {
    // Initialize with common metadata if bulk editing
    if (context.mode === 'bulk') {
      return {
        title: '',
        description: '',
        keywords: [],
        category: '',
        contentType: '',
        projectName: '',
        customFields: {}
      };
    } else {
      // Single file - use existing metadata
      const file = context.files[0];
      return { ...file.metadata };
    }
  });

  const [customFieldKey, setCustomFieldKey] = useState('');
  const [customFieldValue, setCustomFieldValue] = useState('');
  const [errors, setErrors] = useState<MetadataValidationError[]>([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [applyToAll, setApplyToAll] = useState(context.mode === 'bulk');

  useEffect(() => {
    // Auto-populate system metadata for single files
    if (context.mode === 'single' && context.files.length > 0) {
      const file = context.files[0];
      setMetadata(prev => ({
        ...prev,
        fileSize: file.size,
        mimeType: file.mimeType,
        originalFileName: file.fileName,
        uploadDate: new Date().toISOString()
      }));
    }
  }, [context]);

  const validateMetadata = (): MetadataValidationError[] => {
    const newErrors: MetadataValidationError[] = [];
    
    // Validate title length
    if (metadata.title && metadata.title.length > 100) {
      newErrors.push({ field: 'title', message: 'Title must be 100 characters or less' });
    }
    
    // Validate description length
    if (metadata.description && metadata.description.length > 500) {
      newErrors.push({ field: 'description', message: 'Description must be 500 characters or less' });
    }
    
    // Validate keywords
    if (metadata.keywords && metadata.keywords.length > 10) {
      newErrors.push({ field: 'keywords', message: 'Maximum 10 keywords allowed' });
    }
    
    // Validate custom fields
    if (metadata.customFields) {
      Object.entries(metadata.customFields).forEach(([key, value]) => {
        if (key.length > 50) {
          newErrors.push({ field: 'customFields', message: `Custom field key "${key}" is too long (max 50 characters)` });
        }
        if (value.length > 200) {
          newErrors.push({ field: 'customFields', message: `Custom field value for "${key}" is too long (max 200 characters)` });
        }
      });
    }
    
    return newErrors;
  };

  const handleSave = () => {
    const validationErrors = validateMetadata();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setErrors([]);
    onSave(metadata, applyToAll);
  };

  const handleAddKeyword = (keyword: string) => {
    if (!keyword.trim() || !metadata.keywords) return;
    
    const trimmedKeyword = keyword.trim().toLowerCase();
    if (!metadata.keywords.includes(trimmedKeyword)) {
      setMetadata(prev => ({
        ...prev,
        keywords: [...(prev.keywords || []), trimmedKeyword]
      }));
    }
  };

  const handleRemoveKeyword = (index: number) => {
    setMetadata(prev => ({
      ...prev,
      keywords: prev.keywords?.filter((_, i) => i !== index) || []
    }));
  };

  const handleAddCustomField = () => {
    if (!customFieldKey.trim() || !customFieldValue.trim()) return;
    
    setMetadata(prev => ({
      ...prev,
      customFields: {
        ...prev.customFields,
        [customFieldKey.trim()]: customFieldValue.trim()
      }
    }));
    
    setCustomFieldKey('');
    setCustomFieldValue('');
  };

  const handleRemoveCustomField = (key: string) => {
    setMetadata(prev => {
      const newCustomFields = { ...prev.customFields };
      delete newCustomFields[key];
      return {
        ...prev,
        customFields: newCustomFields
      };
    });
  };

  const handleSaveAsTemplate = () => {
    if (!templateName.trim()) return;
    
    onSaveAsTemplate({
      name: templateName.trim(),
      description: templateDescription.trim() || undefined,
      metadata: {
        title: metadata.title,
        description: metadata.description,
        keywords: metadata.keywords,
        category: metadata.category,
        contentType: metadata.contentType,
        projectName: metadata.projectName,
        customFields: metadata.customFields
      },
      lastUsed: new Date()
    });
    
    setShowTemplateForm(false);
    setTemplateName('');
    setTemplateDescription('');
  };

  const handleLoadTemplate = (template: MetadataTemplate) => {
    setMetadata(prev => ({
      ...prev,
      ...template.metadata
    }));
    onLoadTemplate(template);
  };

  const getFileDisplayText = () => {
    if (context.mode === 'bulk') {
      return `${context.files.length} files`;
    }
    return context.files[0]?.fileName || 'Unknown file';
  };

  return (
    <div className="metadata-editor-backdrop" onClick={onCancel}>
      <div className="metadata-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="metadata-editor-header">
          <div className="header-info">
            <FileText size={20} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <h2>Edit Metadata</h2>
                <InfoButton tooltip="Add custom metadata to improve file searchability, organization, and provide context for future reference." />
              </div>
              <p>{getFileDisplayText()}</p>
            </div>
          </div>
          <button className="close-button" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>

        <div className="metadata-editor-content">
          {/* Templates Section */}
          {templates.length > 0 && (
            <div className="templates-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <h3>Quick Templates</h3>
                <InfoButton tooltip="Apply pre-saved metadata templates to quickly fill in common information patterns." />
              </div>
              <div className="template-list">
                {templates.slice(0, 4).map(template => (
                  <button
                    key={template.id}
                    className="template-button"
                    onClick={() => handleLoadTemplate(template)}
                    title={template.description}
                  >
                    <Bookmark size={14} />
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Basic Information */}
          <div className="metadata-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <h3><Type size={16} /> Basic Information</h3>
              <InfoButton tooltip="Core metadata fields that provide essential context about your files." />
            </div>
            
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <label>Title</label>
                <InfoButton tooltip="A descriptive name for your file that's more searchable than the filename." />
              </div>
              <input
                type="text"
                value={metadata.title || ''}
                onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
                placeholder={context.mode === 'single' ? context.files[0]?.fileName : 'Enter title for files...'}
                maxLength={100}
              />
              <span className="char-count">{(metadata.title || '').length}/100</span>
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={metadata.description || ''}
                onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Describe the content and purpose of these files..."
                rows={3}
                maxLength={500}
              />
              <span className="char-count">{(metadata.description || '').length}/500</span>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <label>Keywords/Tags</label>
                <InfoButton tooltip="Add relevant keywords to make your files easier to search and discover. Press Enter to add each keyword." />
              </div>
              <div className="keywords-input">
                <input
                  type="text"
                  placeholder="Add keyword and press Enter"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddKeyword(e.currentTarget.value);
                      e.currentTarget.value = '';
                    }
                  }}
                />
              </div>
              <div className="keywords-list">
                {metadata.keywords?.map((keyword, index) => (
                  <span key={index} className="keyword-tag">
                    <Tag size={12} />
                    {keyword}
                    <button onClick={() => handleRemoveKeyword(index)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Categorization */}
          <div className="metadata-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <h3><Folder size={16} /> Categorization</h3>
              <InfoButton tooltip="Organize files into categories and assign them to projects for better management." />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>Category</label>
                <select
                  value={metadata.category || ''}
                  onChange={(e) => setMetadata(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="">Select category...</option>
                  {COMMON_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Content Type</label>
                <select
                  value={metadata.contentType || ''}
                  onChange={(e) => setMetadata(prev => ({ ...prev, contentType: e.target.value }))}
                >
                  <option value="">Select type...</option>
                  {COMMON_CONTENT_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Project Name</label>
              <input
                type="text"
                value={metadata.projectName || ''}
                onChange={(e) => setMetadata(prev => ({ ...prev, projectName: e.target.value }))}
                placeholder="Associate with a project..."
              />
            </div>
          </div>

          {/* Custom Fields */}
          <div className="metadata-section">
            <ExpandableSection 
              title="Custom Fields" 
              summary="Add specialized metadata fields for your specific needs"
              variant="bordered"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <h3><Hash size={16} /> Custom Fields</h3>
                <InfoButton tooltip="Create custom key-value pairs for specialized metadata that doesn't fit standard fields." />
              </div>
            
            <div className="custom-fields-input">
              <div className="form-row">
                <input
                  type="text"
                  value={customFieldKey}
                  onChange={(e) => setCustomFieldKey(e.target.value)}
                  placeholder="Field name..."
                  maxLength={50}
                />
                <input
                  type="text"
                  value={customFieldValue}
                  onChange={(e) => setCustomFieldValue(e.target.value)}
                  placeholder="Field value..."
                  maxLength={200}
                />
                <button
                  onClick={handleAddCustomField}
                  disabled={!customFieldKey.trim() || !customFieldValue.trim()}
                  className="add-field-button"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>

            {metadata.customFields && Object.entries(metadata.customFields).length > 0 && (
              <div className="custom-fields-list">
                {Object.entries(metadata.customFields).map(([key, value]) => (
                  <div key={key} className="custom-field-item">
                    <span className="field-key">{key}:</span>
                    <span className="field-value">{value}</span>
                    <button
                      onClick={() => handleRemoveCustomField(key)}
                      className="remove-field-button"
                    >
                      <Minus size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </ExpandableSection>
          </div>

          {/* System Information (Read-only) */}
          {context.mode === 'single' && (
            <div className="metadata-section">
              <ExpandableSection 
                title="System Information" 
                summary="Technical details about the file (read-only)"
                variant="subtle"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <h3><Info size={16} /> System Information</h3>
                  <InfoButton tooltip="Technical metadata automatically detected from the file." />
                </div>
              <div className="system-info">
                <div className="info-item">
                  <span>File Size:</span>
                  <span>{metadata.fileSize ? `${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB` : 'Unknown'}</span>
                </div>
                <div className="info-item">
                  <span>MIME Type:</span>
                  <span>{metadata.mimeType || 'Unknown'}</span>
                </div>
                <div className="info-item">
                  <span>Original Name:</span>
                  <span>{metadata.originalFileName || 'Unknown'}</span>
                </div>
              </div>
              </ExpandableSection>
            </div>
          )}

          {/* Validation Errors */}
          {errors.length > 0 && (
            <div className="validation-errors">
              <AlertCircle size={16} />
              <div>
                <h4>Please fix the following errors:</h4>
                <ul>
                  {errors.map((error, index) => (
                    <li key={index}>{error.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="metadata-editor-footer">
          <div className="footer-left">
            {context.mode === 'bulk' && (
              <label className="apply-to-all">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                />
                Apply to all {context.files.length} files
              </label>
            )}
          </div>

          <div className="footer-actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
              <button
                className="save-template-button"
                onClick={() => setShowTemplateForm(!showTemplateForm)}
              >
                <Bookmark size={16} />
                Save as Template
              </button>
              <InfoButton tooltip="Save this metadata configuration as a reusable template for future files." />
            </div>
            
            <button className="cancel-button" onClick={onCancel}>
              Cancel
            </button>
            
            <button
              className="save-button"
              onClick={handleSave}
              disabled={errors.length > 0}
            >
              <Save size={16} />
              Apply Metadata
            </button>
          </div>
        </div>

        {/* Save Template Form */}
        {showTemplateForm && (
          <div className="template-form-overlay">
            <div className="template-form">
              <h3>Save as Template</h3>
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input
                  type="text"
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder="Describe when to use this template..."
                />
              </div>
              <div className="template-form-actions">
                <button onClick={() => setShowTemplateForm(false)}>Cancel</button>
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={!templateName.trim()}
                  className="save-button"
                >
                  Save Template
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          .metadata-editor-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            backdrop-filter: blur(2px);
          }

          .metadata-editor-modal {
            background: white;
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-2xl);
            width: 90%;
            max-width: 700px;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .metadata-editor-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-6);
            border-bottom: 1px solid var(--gray-200);
            background: var(--gray-50);
          }

          .header-info {
            display: flex;
            align-items: center;
            gap: var(--space-3);
          }

          .header-info h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--gray-900);
          }

          .header-info p {
            margin: 0;
            font-size: 13px;
            color: var(--gray-600);
          }

          .close-button {
            background: none;
            border: none;
            padding: var(--space-2);
            cursor: pointer;
            color: var(--gray-500);
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .close-button:hover {
            background: var(--gray-200);
            color: var(--gray-700);
          }

          .metadata-editor-content {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-6);
          }

          .templates-section {
            margin-bottom: var(--space-6);
            padding-bottom: var(--space-4);
            border-bottom: 1px solid var(--gray-200);
          }

          .templates-section h3 {
            margin: 0 0 var(--space-3) 0;
            font-size: 14px;
            color: var(--gray-700);
          }

          .template-list {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
          }

          .template-button {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: var(--blue-50);
            border: 1px solid var(--blue-200);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 13px;
            color: var(--blue-700);
            transition: all 0.2s ease;
          }

          .template-button:hover {
            background: var(--blue-100);
            border-color: var(--blue-300);
          }

          .metadata-section {
            margin-bottom: var(--space-6);
          }

          .metadata-section h3 {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin: 0 0 var(--space-4) 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--gray-800);
          }

          .form-group {
            margin-bottom: var(--space-4);
            position: relative;
          }

          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-3);
          }

          .form-group label {
            display: block;
            margin-bottom: var(--space-2);
            font-weight: 500;
            font-size: 14px;
            color: var(--gray-700);
          }

          .form-group input,
          .form-group textarea,
          .form-group select {
            width: 100%;
            padding: var(--space-3);
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            font-size: 14px;
            transition: all 0.2s ease;
          }

          .form-group input:focus,
          .form-group textarea:focus,
          .form-group select:focus {
            outline: none;
            border-color: var(--ardrive-primary);
            box-shadow: 0 0 0 3px rgba(71, 134, 255, 0.1);
          }

          .char-count {
            position: absolute;
            right: var(--space-2);
            bottom: -20px;
            font-size: 11px;
            color: var(--gray-500);
          }

          .keywords-input {
            margin-bottom: var(--space-3);
          }

          .keywords-list {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
          }

          .keyword-tag {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1) var(--space-2);
            background: var(--blue-100);
            color: var(--blue-800);
            border-radius: var(--radius-sm);
            font-size: 12px;
          }

          .keyword-tag button {
            background: none;
            border: none;
            cursor: pointer;
            color: var(--blue-600);
            padding: 0;
            display: flex;
            align-items: center;
          }

          .custom-fields-input {
            margin-bottom: var(--space-3);
          }

          .custom-fields-input .form-row {
            grid-template-columns: 1fr 1fr auto;
            align-items: end;
          }

          .add-field-button {
            padding: var(--space-3);
            background: var(--ardrive-primary);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .add-field-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .add-field-button:not(:disabled):hover {
            background: var(--ardrive-primary-dark);
          }

          .custom-fields-list {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
          }

          .custom-field-item {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: var(--gray-50);
            border-radius: var(--radius-md);
          }

          .field-key {
            font-weight: 500;
            color: var(--gray-700);
          }

          .field-value {
            flex: 1;
            color: var(--gray-600);
          }

          .remove-field-button {
            background: none;
            border: none;
            cursor: pointer;
            color: var(--red-500);
            padding: var(--space-1);
            border-radius: var(--radius-sm);
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .remove-field-button:hover {
            background: var(--red-50);
          }

          .system-info {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
          }

          .info-item {
            display: flex;
            justify-content: space-between;
            padding: var(--space-2) var(--space-3);
            background: var(--gray-50);
            border-radius: var(--radius-md);
            font-size: 13px;
          }

          .info-item span:first-child {
            font-weight: 500;
            color: var(--gray-700);
          }

          .info-item span:last-child {
            color: var(--gray-600);
          }

          .validation-errors {
            display: flex;
            gap: var(--space-3);
            padding: var(--space-4);
            background: var(--red-50);
            border: 1px solid var(--red-200);
            border-radius: var(--radius-md);
            color: var(--red-700);
          }

          .validation-errors h4 {
            margin: 0 0 var(--space-2) 0;
            font-size: 14px;
          }

          .validation-errors ul {
            margin: 0;
            padding-left: var(--space-4);
          }

          .validation-errors li {
            font-size: 13px;
            margin-bottom: var(--space-1);
          }

          .metadata-editor-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-6);
            border-top: 1px solid var(--gray-200);
            background: var(--gray-50);
          }

          .footer-left {
            flex: 1;
          }

          .apply-to-all {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 14px;
            color: var(--gray-700);
            cursor: pointer;
          }

          .footer-actions {
            display: flex;
            gap: var(--space-3);
            align-items: center;
          }

          .save-template-button {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: white;
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            color: var(--gray-700);
            transition: all 0.2s ease;
          }

          .save-template-button:hover {
            background: var(--gray-50);
            border-color: var(--gray-400);
          }

          .cancel-button {
            padding: var(--space-2) var(--space-4);
            background: white;
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            color: var(--gray-700);
            transition: all 0.2s ease;
          }

          .cancel-button:hover {
            background: var(--gray-50);
            border-color: var(--gray-400);
          }

          .save-button {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-4);
            background: var(--ardrive-primary);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
          }

          .save-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .save-button:not(:disabled):hover {
            background: var(--ardrive-primary-dark);
          }

          .template-form-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 3000;
          }

          .template-form {
            background: white;
            border-radius: var(--radius-lg);
            padding: var(--space-6);
            width: 90%;
            max-width: 400px;
            box-shadow: var(--shadow-lg);
          }

          .template-form h3 {
            margin: 0 0 var(--space-4) 0;
            font-size: 16px;
            color: var(--gray-900);
          }

          .template-form-actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--space-3);
            margin-top: var(--space-4);
          }

          .template-form-actions button {
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
          }

          .template-form-actions button:first-child {
            background: white;
            border: 1px solid var(--gray-300);
            color: var(--gray-700);
          }

          .template-form-actions button:first-child:hover {
            background: var(--gray-50);
          }
        `}</style>
      </div>
    </div>
  );
};

export default MetadataEditor;