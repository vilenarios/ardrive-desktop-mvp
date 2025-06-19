import React, { useState, useEffect } from 'react';
import { 
  Bookmark, 
  Plus, 
  Edit3, 
  Trash2, 
  Copy, 
  Search,
  Calendar,
  Hash,
  X,
  Check
} from 'lucide-react';
import { MetadataTemplate } from '../../types/metadata';

interface MetadataTemplateManagerProps {
  templates: MetadataTemplate[];
  onCreateTemplate: (template: Omit<MetadataTemplate, 'id' | 'createdAt' | 'useCount'>) => void;
  onUpdateTemplate: (id: string, updates: Partial<MetadataTemplate>) => void;
  onDeleteTemplate: (id: string) => void;
  onLoadTemplate: (template: MetadataTemplate) => void;
  onClose: () => void;
}

const MetadataTemplateManager: React.FC<MetadataTemplateManagerProps> = ({
  templates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onLoadTemplate,
  onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<MetadataTemplate | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');

  const filteredTemplates = templates.filter(template =>
    template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    template.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateTemplate = () => {
    if (!newTemplateName.trim()) return;

    onCreateTemplate({
      name: newTemplateName.trim(),
      description: newTemplateDescription.trim() || undefined,
      metadata: {},
      lastUsed: new Date()
    });

    setNewTemplateName('');
    setNewTemplateDescription('');
    setShowCreateForm(false);
  };

  const handleEditTemplate = (template: MetadataTemplate) => {
    setEditingTemplate({ ...template });
  };

  const handleSaveEdit = () => {
    if (!editingTemplate) return;

    onUpdateTemplate(editingTemplate.id, {
      name: editingTemplate.name,
      description: editingTemplate.description
    });

    setEditingTemplate(null);
  };

  const handleCancelEdit = () => {
    setEditingTemplate(null);
  };

  const handleDuplicateTemplate = (template: MetadataTemplate) => {
    onCreateTemplate({
      name: `${template.name} (Copy)`,
      description: template.description,
      metadata: { ...template.metadata },
      lastUsed: new Date()
    });
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(date));
  };

  const getMetadataPreview = (template: MetadataTemplate) => {
    const metadata = template.metadata;
    const items = [];
    
    if (metadata.category) items.push(`Category: ${metadata.category}`);
    if (metadata.contentType) items.push(`Type: ${metadata.contentType}`);
    if (metadata.projectName) items.push(`Project: ${metadata.projectName}`);
    if (metadata.keywords?.length) items.push(`${metadata.keywords.length} keywords`);
    if (metadata.customFields && Object.keys(metadata.customFields).length > 0) {
      items.push(`${Object.keys(metadata.customFields).length} custom fields`);
    }
    
    return items.slice(0, 3).join(' • ') || 'No metadata configured';
  };

  return (
    <div className="template-manager-backdrop" onClick={onClose}>
      <div className="template-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="template-manager-header">
          <div className="header-info">
            <Bookmark size={20} />
            <div>
              <h2>Metadata Templates</h2>
              <p>Create and manage reusable metadata patterns</p>
            </div>
          </div>
          <button className="close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="template-manager-content">
          {/* Search and Create */}
          <div className="template-controls">
            <div className="search-container">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            <button
              className="create-template-button"
              onClick={() => setShowCreateForm(true)}
            >
              <Plus size={16} />
              New Template
            </button>
          </div>

          {/* Create Template Form */}
          {showCreateForm && (
            <div className="create-template-form">
              <h3>Create New Template</h3>
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <input
                  type="text"
                  value={newTemplateDescription}
                  onChange={(e) => setNewTemplateDescription(e.target.value)}
                  placeholder="Describe when to use this template..."
                />
              </div>
              <div className="form-actions">
                <button onClick={() => setShowCreateForm(false)}>Cancel</button>
                <button
                  onClick={handleCreateTemplate}
                  disabled={!newTemplateName.trim()}
                  className="primary-button"
                >
                  Create Template
                </button>
              </div>
            </div>
          )}

          {/* Templates List */}
          <div className="templates-list">
            {filteredTemplates.length === 0 ? (
              <div className="empty-state">
                <Bookmark size={48} className="empty-icon" />
                <h3>{searchQuery ? 'No matching templates' : 'No templates yet'}</h3>
                <p>
                  {searchQuery 
                    ? 'Try adjusting your search query' 
                    : 'Create your first template to save time when adding metadata to files'
                  }
                </p>
              </div>
            ) : (
              filteredTemplates.map(template => (
                <div key={template.id} className="template-item">
                  {editingTemplate?.id === template.id ? (
                    /* Edit Mode */
                    <div className="template-edit-form">
                      <div className="edit-inputs">
                        <input
                          type="text"
                          value={editingTemplate.name}
                          onChange={(e) => setEditingTemplate(prev => 
                            prev ? { ...prev, name: e.target.value } : null
                          )}
                          className="edit-name-input"
                        />
                        <input
                          type="text"
                          value={editingTemplate.description || ''}
                          onChange={(e) => setEditingTemplate(prev => 
                            prev ? { ...prev, description: e.target.value } : null
                          )}
                          placeholder="Description (optional)"
                          className="edit-description-input"
                        />
                      </div>
                      <div className="edit-actions">
                        <button onClick={handleCancelEdit} className="cancel-edit-button">
                          <X size={14} />
                        </button>
                        <button onClick={handleSaveEdit} className="save-edit-button">
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View Mode */
                    <>
                      <div className="template-content">
                        <div className="template-header">
                          <h3>{template.name}</h3>
                          <div className="template-stats">
                            <span className="use-count">Used {template.useCount} times</span>
                            {template.lastUsed && (
                              <span className="last-used">
                                <Calendar size={12} />
                                {formatDate(template.lastUsed)}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {template.description && (
                          <p className="template-description">{template.description}</p>
                        )}
                        
                        <div className="template-preview">
                          <Hash size={12} />
                          <span>{getMetadataPreview(template)}</span>
                        </div>
                      </div>

                      <div className="template-actions">
                        <button
                          onClick={() => onLoadTemplate(template)}
                          className="load-template-button"
                          title="Use this template"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDuplicateTemplate(template)}
                          className="duplicate-template-button"
                          title="Duplicate template"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => handleEditTemplate(template)}
                          className="edit-template-button"
                          title="Edit template"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          onClick={() => onDeleteTemplate(template.id)}
                          className="delete-template-button"
                          title="Delete template"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="template-manager-footer">
          <div className="footer-info">
            <span>{templates.length} template{templates.length !== 1 ? 's' : ''} total</span>
          </div>
          <button className="close-footer-button" onClick={onClose}>
            Close
          </button>
        </div>

        <style>{`
          .template-manager-backdrop {
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

          .template-manager-modal {
            background: white;
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-2xl);
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .template-manager-header {
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

          .template-manager-content {
            flex: 1;
            overflow-y: auto;
            padding: var(--space-6);
          }

          .template-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: var(--space-6);
            gap: var(--space-4);
          }

          .search-container {
            position: relative;
            flex: 1;
            max-width: 300px;
          }

          .search-container svg {
            position: absolute;
            left: var(--space-3);
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray-400);
          }

          .search-input {
            width: 100%;
            padding: var(--space-3) var(--space-3) var(--space-3) var(--space-10);
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            font-size: 14px;
          }

          .search-input:focus {
            outline: none;
            border-color: var(--ardrive-primary);
            box-shadow: 0 0 0 3px rgba(71, 134, 255, 0.1);
          }

          .create-template-button {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-3) var(--space-4);
            background: var(--ardrive-primary);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
          }

          .create-template-button:hover {
            background: var(--ardrive-primary-dark);
          }

          .create-template-form {
            background: var(--blue-50);
            border: 1px solid var(--blue-200);
            border-radius: var(--radius-lg);
            padding: var(--space-6);
            margin-bottom: var(--space-6);
          }

          .create-template-form h3 {
            margin: 0 0 var(--space-4) 0;
            font-size: 16px;
            color: var(--gray-900);
          }

          .form-group {
            margin-bottom: var(--space-4);
          }

          .form-group label {
            display: block;
            margin-bottom: var(--space-2);
            font-weight: 500;
            font-size: 14px;
            color: var(--gray-700);
          }

          .form-group input {
            width: 100%;
            padding: var(--space-3);
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            font-size: 14px;
          }

          .form-group input:focus {
            outline: none;
            border-color: var(--ardrive-primary);
            box-shadow: 0 0 0 3px rgba(71, 134, 255, 0.1);
          }

          .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--space-3);
          }

          .form-actions button {
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s ease;
          }

          .form-actions button:first-child {
            background: white;
            border: 1px solid var(--gray-300);
            color: var(--gray-700);
          }

          .form-actions button:first-child:hover {
            background: var(--gray-50);
          }

          .primary-button {
            background: var(--ardrive-primary) !important;
            color: white !important;
            border: none !important;
          }

          .primary-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .primary-button:not(:disabled):hover {
            background: var(--ardrive-primary-dark) !important;
          }

          .templates-list {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
          }

          .empty-state {
            text-align: center;
            padding: var(--space-8);
            color: var(--gray-600);
          }

          .empty-icon {
            margin-bottom: var(--space-4);
            color: var(--gray-400);
          }

          .empty-state h3 {
            margin-bottom: var(--space-3);
            color: var(--gray-700);
          }

          .empty-state p {
            margin: 0;
            line-height: 1.5;
          }

          .template-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-4);
            border: 1px solid var(--gray-200);
            border-radius: var(--radius-lg);
            transition: all 0.2s ease;
          }

          .template-item:hover {
            border-color: var(--gray-300);
            box-shadow: var(--shadow-sm);
          }

          .template-content {
            flex: 1;
            min-width: 0;
          }

          .template-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-2);
          }

          .template-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--gray-900);
          }

          .template-stats {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            font-size: 12px;
            color: var(--gray-500);
          }

          .use-count {
            background: var(--gray-100);
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius-sm);
          }

          .last-used {
            display: flex;
            align-items: center;
            gap: var(--space-1);
          }

          .template-description {
            margin: 0 0 var(--space-3) 0;
            font-size: 14px;
            color: var(--gray-600);
            line-height: 1.4;
          }

          .template-preview {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 13px;
            color: var(--gray-500);
          }

          .template-actions {
            display: flex;
            gap: var(--space-2);
            margin-left: var(--space-4);
          }

          .load-template-button {
            padding: var(--space-2) var(--space-3);
            background: var(--ardrive-primary);
            color: white;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
          }

          .load-template-button:hover {
            background: var(--ardrive-primary-dark);
          }

          .duplicate-template-button,
          .edit-template-button,
          .delete-template-button {
            padding: var(--space-2);
            background: white;
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .duplicate-template-button:hover,
          .edit-template-button:hover {
            background: var(--gray-50);
            border-color: var(--gray-400);
          }

          .delete-template-button {
            color: var(--red-600);
            border-color: var(--red-200);
          }

          .delete-template-button:hover {
            background: var(--red-50);
            border-color: var(--red-300);
          }

          .template-edit-form {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            flex: 1;
          }

          .edit-inputs {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            flex: 1;
          }

          .edit-name-input,
          .edit-description-input {
            padding: var(--space-2) var(--space-3);
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            font-size: 14px;
          }

          .edit-name-input {
            font-weight: 600;
          }

          .edit-actions {
            display: flex;
            gap: var(--space-2);
          }

          .cancel-edit-button,
          .save-edit-button {
            padding: var(--space-2);
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .cancel-edit-button {
            background: white;
            color: var(--gray-600);
          }

          .cancel-edit-button:hover {
            background: var(--gray-50);
          }

          .save-edit-button {
            background: var(--green-600);
            color: white;
            border-color: var(--green-600);
          }

          .save-edit-button:hover {
            background: var(--green-700);
          }

          .template-manager-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: var(--space-6);
            border-top: 1px solid var(--gray-200);
            background: var(--gray-50);
          }

          .footer-info {
            font-size: 14px;
            color: var(--gray-600);
          }

          .close-footer-button {
            padding: var(--space-2) var(--space-4);
            background: white;
            border: 1px solid var(--gray-300);
            border-radius: var(--radius-md);
            cursor: pointer;
            font-size: 14px;
            color: var(--gray-700);
            transition: all 0.2s ease;
          }

          .close-footer-button:hover {
            background: var(--gray-50);
            border-color: var(--gray-400);
          }
        `}</style>
      </div>
    </div>
  );
};

export default MetadataTemplateManager;