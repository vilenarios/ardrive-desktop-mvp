import React, { useState, useEffect } from 'react';
import { X, FileJson, Folder, ChevronRight, ChevronDown, Loader2, AlertCircle } from 'lucide-react';

interface CreateManifestModalProps {
  driveId: string;
  driveName: string;
  onClose: () => void;
  onSuccess: (manifestUrl: string) => void;
  toast?: {
    success: (message: string) => void;
    error: (message: string) => void;
  };
}

interface FolderNode {
  id: string;
  name: string;
  parentId: string;
  path: string;
}

const CreateManifestModal: React.FC<CreateManifestModalProps> = ({
  driveId,
  driveName,
  onClose,
  onSuccess,
  toast
}) => {
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [manifestName, setManifestName] = useState('DriveManifest.json');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading folder tree for drive:', driveId);
      
      const folderTree = await window.electronAPI.drive.getFolderTree(driveId);
      console.log('Received folder tree:', folderTree);
      
      if (!folderTree || folderTree.length === 0) {
        console.log('No folders found in the drive');
        setError('No folders found in this drive. Please create folders first.');
        setFolders([]);
        return;
      }
      
      setFolders(folderTree);
      
      // Auto-select root folder if only one exists
      const rootFolders = folderTree.filter((f: FolderNode) => !f.parentId);
      console.log('Root folders:', rootFolders);
      
      if (rootFolders.length === 1) {
        setSelectedFolder(rootFolders[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load folders:', err);
      setError(err.message || 'Failed to load folder structure');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateManifest = async () => {
    if (!selectedFolder) {
      setError('Please select a folder');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const result = await window.electronAPI.drive.createManifest({
        driveId,
        folderId: selectedFolder,
        manifestName
      });

      toast?.success(`Manifest created successfully! (${result.fileCount} files)`);
      
      // Copy URL to clipboard
      await navigator.clipboard.writeText(result.manifestUrl);
      
      onSuccess(result.manifestUrl);
      onClose();
    } catch (err: any) {
      console.error('Failed to create manifest:', err);
      setError(err.message || 'Failed to create manifest');
      toast?.error(err.message || 'Failed to create manifest');
    } finally {
      setCreating(false);
    }
  };

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const renderFolderTree = (parentId: string = '', level: number = 0) => {
    const children = folders.filter((f: FolderNode) => f.parentId === parentId);
    
    return children.map((folder: FolderNode) => {
      const hasChildren = folders.some((f: FolderNode) => f.parentId === folder.id);
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolder === folder.id;
      
      return (
        <div key={folder.id}>
          <div
            onClick={() => {
              setSelectedFolder(folder.id);
              if (hasChildren) toggleFolder(folder.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              paddingLeft: `${12 + level * 20}px`,
              cursor: 'pointer',
              backgroundColor: isSelected ? 'var(--ardrive-primary-50)' : 'transparent',
              borderRadius: '4px',
              margin: '2px 0'
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = 'var(--gray-100)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            {hasChildren && (
              isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
            )}
            <Folder 
              size={16} 
              style={{ 
                marginLeft: hasChildren ? '4px' : '20px',
                marginRight: '8px',
                color: isSelected ? 'var(--ardrive-primary)' : 'var(--gray-500)'
              }} 
            />
            <span style={{ 
              flex: 1,
              color: isSelected ? 'var(--ardrive-primary)' : 'inherit'
            }}>
              {folder.name}
            </span>
          </div>
          {hasChildren && isExpanded && renderFolderTree(folder.id, level + 1)}
        </div>
      );
    });
  };

  return (
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
      <div style={{
        background: 'var(--ardrive-surface)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        width: '90%',
        maxWidth: '600px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <FileJson size={24} style={{ color: 'var(--ardrive-primary)' }} />
            <h2>Create Arweave Manifest</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Info */}
        <div style={{
          backgroundColor: 'var(--gray-100)',
          padding: 'var(--space-3)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--space-4)',
          fontSize: '14px',
          color: 'var(--gray-600)'
        }}>
          A manifest creates a single URL to access all files in a folder. 
          Files are not re-uploaded. If a manifest with the same name exists, 
          it will be replaced with a new version.
        </div>

        {/* Folder Selection */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: 'var(--space-2)',
            fontWeight: 500
          }}>
            Select Folder
          </label>
          <div style={{
            border: '1px solid var(--gray-200)',
            borderRadius: 'var(--radius-sm)',
            maxHeight: '300px',
            overflowY: 'auto',
            backgroundColor: 'var(--gray-50)'
          }}>
            {loading ? (
              <div style={{ 
                padding: 'var(--space-4)', 
                textAlign: 'center',
                color: 'var(--gray-600)'
              }}>
                <Loader2 size={20} className="spin" style={{ marginBottom: '8px' }} />
                <div>Loading folders...</div>
              </div>
            ) : error ? (
              <div style={{ 
                padding: 'var(--space-4)', 
                textAlign: 'center',
                color: 'var(--red-600)'
              }}>
                <AlertCircle size={20} style={{ marginBottom: '8px' }} />
                <div>{error}</div>
              </div>
            ) : folders.length === 0 ? (
              <div style={{ 
                padding: 'var(--space-4)', 
                textAlign: 'center',
                color: 'var(--gray-600)'
              }}>
                No folders found in drive
              </div>
            ) : (
              renderFolderTree()
            )}
          </div>
        </div>

        {/* Manifest Name */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: 'var(--space-2)',
            fontWeight: 500
          }}>
            Manifest Name
          </label>
          <input
            type="text"
            value={manifestName}
            onChange={(e) => setManifestName(e.target.value)}
            placeholder="DriveManifest.json"
            style={{
              width: '100%',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            backgroundColor: 'var(--red-50)',
            color: 'var(--red-600)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 'var(--space-4)',
            fontSize: '14px'
          }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          justifyContent: 'flex-end'
        }}>
          <button
            className="button secondary"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            className="button primary"
            onClick={handleCreateManifest}
            disabled={creating || !selectedFolder || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
            }}
          >
            {creating ? (
              <>
                <Loader2 size={16} className="spin" />
                Creating...
              </>
            ) : (
              <>
                <FileJson size={16} />
                Create Manifest
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateManifestModal;