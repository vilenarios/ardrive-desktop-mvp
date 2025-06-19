import React, { useState, useEffect } from 'react';
import { 
  Archive, 
  Download, 
  Folder, 
  File, 
  Search, 
  Grid, 
  List,
  CheckSquare,
  Square,
  FolderOpen,
  Calendar,
  HardDrive,
  Filter
} from 'lucide-react';

interface StoredFile {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  lastModified: Date;
  path: string;
  transactionId?: string;
  isLocal: boolean; // Whether file is already downloaded locally
  children?: StoredFile[]; // For folders
}

interface StoredFilesBrowserProps {
  searchQuery: string;
  onDownloadFile: (fileId: string) => void;
  onDownloadSelected: (fileIds: string[]) => void;
  onDownloadAll: () => void;
}

const StoredFilesBrowser: React.FC<StoredFilesBrowserProps> = ({
  searchQuery,
  onDownloadFile,
  onDownloadSelected,
  onDownloadAll
}) => {
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [currentPath, setCurrentPath] = useState('/');
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    loadStoredFiles();
  }, []);

  const loadStoredFiles = async () => {
    setLoading(true);
    try {
      // TODO: Implement API call to get stored files from drive metadata
      // For now, show empty state until real implementation
      
      // Check if we have electronAPI available to fetch real stored files
      if (window.electronAPI && window.electronAPI.files) {
        try {
          // Try to get real stored files from the backend
          // This would typically be an API call to list files from the current drive
          // const realFiles = await window.electronAPI.files.getStoredFiles();
          // setStoredFiles(realFiles);
          
          // For now, just show empty state since we don't have this API yet
          setStoredFiles([]);
        } catch (apiError) {
          console.log('Stored files API not yet implemented:', apiError);
          setStoredFiles([]);
        }
      } else {
        // No API available, show empty state
        setStoredFiles([]);
      }
    } catch (error) {
      console.error('Failed to load stored files:', error);
      setStoredFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const toggleFileSelection = (fileId: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const selectAll = () => {
    const allFileIds = storedFiles
      .filter(file => file.type === 'file')
      .map(file => file.id);
    setSelectedFiles(new Set(allFileIds));
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
  };

  const filteredFiles = storedFiles.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    let comparison = 0;
    
    // Folders first
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    
    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'date':
        comparison = a.lastModified.getTime() - b.lastModified.getTime();
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  if (loading) {
    return (
      <div className="stored-files-loading">
        <div className="loading-spinner" />
        <p>Loading your stored files...</p>
      </div>
    );
  }

  return (
    <div className="stored-files-browser">
      {/* Header with stats and controls */}
      <div className="stored-files-header">
        <div className="storage-stats">
          <HardDrive size={16} />
          <span>{storedFiles.length} items permanently stored</span>
        </div>
        
        <div className="view-controls">
          <div className="sort-controls">
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'size')}
              className="sort-select"
            >
              <option value="name">Name</option>
              <option value="date">Date</option>
              <option value="size">Size</option>
            </select>
            <button 
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="sort-order-btn"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          
          <div className="view-mode-toggle">
            <button 
              className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              <List size={16} />
            </button>
            <button 
              className={`view-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              <Grid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Selection toolbar */}
      {selectedFiles.size > 0 && (
        <div className="selection-toolbar">
          <div className="selection-info">
            <span>{selectedFiles.size} files selected</span>
          </div>
          <div className="selection-actions">
            <button 
              onClick={() => onDownloadSelected(Array.from(selectedFiles))}
              className="download-selected-btn"
            >
              <Download size={14} />
              Download Selected
            </button>
            <button onClick={clearSelection} className="clear-selection-btn">
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Bulk actions */}
      <div className="bulk-actions">
        <button onClick={selectAll} className="select-all-btn">
          <CheckSquare size={14} />
          Select All Files
        </button>
        <button onClick={onDownloadAll} className="download-all-btn">
          <Download size={14} />
          Download All
        </button>
      </div>

      {/* File list */}
      {sortedFiles.length === 0 ? (
        <div className="empty-state">
          <Archive size={48} className="empty-icon" />
          <h3>{searchQuery ? 'No matching files' : 'No files stored yet'}</h3>
          <p>
            {searchQuery 
              ? 'Try adjusting your search query' 
              : 'Upload files using the sync folder to see them stored permanently on Arweave. Files will appear here once they\'re uploaded and confirmed on the blockchain.'
            }
          </p>
          {!searchQuery && (
            <div className="empty-state-hint">
              <p><strong>How to add files:</strong></p>
              <ol>
                <li>Make sure sync is enabled</li>
                <li>Add files to your sync folder</li>
                <li>Files will automatically upload to Arweave</li>
                <li>Once confirmed, they'll appear in this view</li>
              </ol>
            </div>
          )}
        </div>
      ) : (
        <div className={`files-container ${viewMode}`}>
          {sortedFiles.map((file) => (
            <div 
              key={file.id} 
              className={`file-item ${selectedFiles.has(file.id) ? 'selected' : ''}`}
            >
              <div className="file-item-content">
                <div className="file-selection">
                  {file.type === 'file' && (
                    <button 
                      onClick={() => toggleFileSelection(file.id)}
                      className="selection-checkbox"
                    >
                      {selectedFiles.has(file.id) ? 
                        <CheckSquare size={16} /> : 
                        <Square size={16} />
                      }
                    </button>
                  )}
                </div>
                
                <div className="file-icon">
                  {file.type === 'folder' ? (
                    <Folder size={20} color="#4A90E2" />
                  ) : (
                    <File size={20} color="#6B7280" />
                  )}
                </div>
                
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    {file.size && <span>{formatFileSize(file.size)}</span>}
                    <span>{formatDate(file.lastModified)}</span>
                    {file.isLocal && <span className="local-indicator">📱 Local</span>}
                  </div>
                </div>
                
                <div className="file-actions">
                  {file.type === 'file' && (
                    <button 
                      onClick={() => onDownloadFile(file.id)}
                      className="download-btn"
                      disabled={file.isLocal}
                      title={file.isLocal ? 'Already downloaded' : 'Download file'}
                    >
                      <Download size={16} />
                    </button>
                  )}
                  {file.type === 'folder' && (
                    <button className="open-folder-btn">
                      <FolderOpen size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .stored-files-browser {
          padding: var(--space-4);
          height: 100%;
          overflow-y: auto;
        }

        .stored-files-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: var(--space-8);
          color: var(--gray-600);
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--gray-200);
          border-top-color: var(--ardrive-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: var(--space-4);
        }

        .stored-files-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-4);
          padding-bottom: var(--space-3);
          border-bottom: 1px solid var(--gray-200);
        }

        .storage-stats {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--gray-600);
          font-size: 14px;
        }

        .view-controls {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .sort-controls {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .sort-select {
          padding: var(--space-1) var(--space-2);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          font-size: 13px;
        }

        .sort-order-btn {
          padding: var(--space-1) var(--space-2);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          background: white;
          cursor: pointer;
          font-size: 14px;
        }

        .view-mode-toggle {
          display: flex;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        .view-btn {
          padding: var(--space-2);
          border: none;
          background: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .view-btn.active {
          background: var(--ardrive-primary);
          color: white;
        }

        .selection-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-3);
          background: var(--blue-50);
          border: 1px solid var(--blue-200);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-4);
        }

        .selection-info {
          font-size: 14px;
          color: var(--blue-700);
        }

        .selection-actions {
          display: flex;
          gap: var(--space-2);
        }

        .download-selected-btn {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--ardrive-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 13px;
        }

        .clear-selection-btn {
          padding: var(--space-2) var(--space-3);
          background: transparent;
          color: var(--blue-700);
          border: 1px solid var(--blue-300);
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 13px;
        }

        .bulk-actions {
          display: flex;
          gap: var(--space-2);
          margin-bottom: var(--space-4);
        }

        .select-all-btn, .download-all-btn {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          background: white;
          cursor: pointer;
          font-size: 13px;
        }

        .download-all-btn {
          background: var(--ardrive-primary);
          color: white;
          border-color: var(--ardrive-primary);
        }

        .files-container.list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .files-container.grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--space-3);
        }

        .file-item {
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-md);
          padding: var(--space-3);
          transition: all 0.2s ease;
          cursor: pointer;
        }

        .file-item:hover {
          border-color: var(--gray-300);
          background: var(--gray-50);
        }

        .file-item.selected {
          border-color: var(--ardrive-primary);
          background: var(--blue-50);
        }

        .file-item-content {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .file-selection {
          width: 20px;
        }

        .selection-checkbox {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .file-icon {
          flex-shrink: 0;
        }

        .file-info {
          flex: 1;
          min-width: 0;
        }

        .file-name {
          font-weight: 500;
          margin-bottom: var(--space-1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-meta {
          display: flex;
          gap: var(--space-2);
          font-size: 12px;
          color: var(--gray-600);
        }

        .local-indicator {
          color: var(--green-600);
        }

        .file-actions {
          display: flex;
          gap: var(--space-1);
        }

        .download-btn, .open-folder-btn {
          padding: var(--space-2);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-sm);
          background: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .download-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .download-btn:not(:disabled):hover {
          background: var(--ardrive-primary);
          color: white;
          border-color: var(--ardrive-primary);
        }

        .empty-state {
          text-align: center;
          padding: var(--space-8);
          color: var(--gray-600);
          max-width: 500px;
          margin: 0 auto;
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
          margin-bottom: var(--space-4);
          line-height: 1.5;
        }

        .empty-state-hint {
          background: var(--gray-50);
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-top: var(--space-6);
          text-align: left;
        }

        .empty-state-hint p {
          margin: 0 0 var(--space-3) 0;
          font-weight: 600;
          color: var(--gray-700);
        }

        .empty-state-hint ol {
          margin: 0;
          padding-left: var(--space-4);
          color: var(--gray-600);
        }

        .empty-state-hint li {
          margin-bottom: var(--space-2);
          line-height: 1.4;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default StoredFilesBrowser;