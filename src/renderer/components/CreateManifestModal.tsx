import React, { useState, useEffect } from 'react';
import { X, FileJson, Folder, ChevronRight, ChevronDown, Loader2, AlertCircle, CheckCircle2, Copy, ExternalLink } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import '../styles/manifest-modal.css';

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
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [folderInfo, setFolderInfo] = useState<{ fileCount: number; estimatedCost: number } | null>(null);
  const [estimatingCost, setEstimatingCost] = useState(false);
  // UX-33: the manifest URL used to be dropped entirely after creation (a
  // fleeting toast + a console.log, nothing persistent — see the git-history
  // note in create-manifest-modal.test.tsx). Once set, the confirmation
  // layer switches from "confirm details" to a "site deployed" view that
  // keeps the link on screen with Copy/Open actions instead of closing.
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // A11Y-3: Escape closes, backdrop click closes, focus trapped, focus
  // returns to the trigger on close — same shared hook as the other 3 drive
  // modals. This modal renders as two stacked layers (folder picker, then a
  // confirmation step); only the topmost layer should own Escape/Tab-trap at
  // any given time, so each gets its own hook call keyed off the inverse of
  // `showConfirmation`.
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(
    !showConfirmation,
    onClose
  );
  // UX-33: once the manifest is deployed, this layer's Escape/backdrop-click
  // should close the whole modal (there's no folder selection left to "go
  // back" to) rather than reverting to the confirmation-details step.
  const { containerRef: confirmContainerRef, handleBackdropClick: handleConfirmBackdropClick } =
    useModalA11y<HTMLDivElement>(showConfirmation, () => (deployedUrl ? onClose() : setShowConfirmation(false)));

  useEffect(() => {
    console.log('CreateManifestModal mounted for drive:', driveId);
    loadFolders().catch(err => {
      console.error('Failed to load folders in useEffect:', err);
    });
  }, []);

  const loadFolders = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading folder tree for drive:', driveId);
      
      // UX-3: IpcResult envelope
      const folderTreeResult = await window.electronAPI.drive.getFolderTree(driveId);
      if (!folderTreeResult.success) {
        throw new Error(folderTreeResult.error || 'Failed to load folder tree.');
      }
      const folderTree = folderTreeResult.data;
      console.log('Received folder tree:', folderTree);

      if (!folderTree || folderTree.length === 0) {
        console.log('No folders found in the drive');
        setError('No folders found in this drive. Please create folders first.');
        setFolders([]);
        return;
      }
      
      // Check if we need to add the root folder
      const hasRootFolder = folderTree.some((f: FolderNode) => !f.parentId || f.parentId === '');
      const allFolders = [...folderTree];
      
      if (!hasRootFolder && folderTree.length > 0) {
        // All folders have a parent, so we need to add the root folder
        // We need to fetch the proper root folder ID from the backend
        console.log('No root folder found, need to get root folder info');
        
        // For now, we'll need to ensure the backend includes the root folder
        // The parentId these folders share IS the root folder ID we need
        const rootFolderId = folderTree[0].parentId;
        
        allFolders.unshift({
          id: rootFolderId,
          name: driveName || 'Root',
          parentId: '',
          path: '/'
        });
        
        console.log('Added root folder with ID:', rootFolderId);
      }
      
      setFolders(allFolders);
      
      // Debug log the folder structure
      console.log('Folder tree structure:', JSON.stringify(allFolders, null, 2));
      console.warn('MANIFEST DEBUG - Folders state set to:', allFolders);
      
      // Auto-select root folder if only one exists
      const rootFolders = allFolders.filter((f: FolderNode) => !f.parentId || f.parentId === '');
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

  const handleProceedToConfirmation = async () => {
    if (!selectedFolder) {
      setError('Please select a folder');
      return;
    }

    setEstimatingCost(true);
    setError(null);

    try {
      // Get folder information and estimate cost
      const selectedFolderNode = folders.find(f => f.id === selectedFolder);
      
      // Get actual file count from backend (UX-3: IpcResult envelope)
      const folderStatsResult = await window.electronAPI.drive.countFolderFiles(driveId, selectedFolder);
      if (!folderStatsResult.success) {
        throw new Error(folderStatsResult.error || 'Failed to estimate cost.');
      }

      setFolderInfo({
        fileCount: folderStatsResult.data.fileCount,
        estimatedCost: folderStatsResult.data.estimatedCost
      });
      setShowConfirmation(true);
    } catch (err: any) {
      console.error('Failed to estimate cost:', err);
      setError(err.message || 'Failed to estimate cost');
    } finally {
      setEstimatingCost(false);
    }
  };

  const handleConfirmCreate = async () => {
    setCreating(true);
    setError(null);

    try {
      const result = await window.electronAPI.drive.createManifest({
        driveId,
        folderId: selectedFolder,
        manifestName
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create manifest');
      }

      toast?.success(`Manifest created successfully! (${result.data.fileCount} files)`);

      // UX-33: surface the URL persistently instead of closing immediately —
      // onSuccess still hands it to the caller (OverviewTab copies it too),
      // but the modal itself now stays open on a "site deployed" view so the
      // user isn't relying on a fleeting toast to grab the link.
      setDeployedUrl(result.data.manifestUrl);
      onSuccess(result.data.manifestUrl);
    } catch (err: any) {
      console.error('Failed to create manifest:', err);
      setError(err.message || 'Failed to create manifest');
      toast?.error(err.message || 'Failed to create manifest');
    } finally {
      setCreating(false);
    }
  };

  // UX-33: same clipboard pattern as OverviewTab.tsx's copyToClipboard
  // (navigator.clipboard.writeText), scoped locally since this is the only
  // clipboard action in this component.
  const handleCopyManifestLink = async () => {
    if (!deployedUrl) return;
    try {
      await navigator.clipboard.writeText(deployedUrl);
      setLinkCopied(true);
      toast?.success('Site link copied to clipboard');
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy manifest URL:', err);
      toast?.error('Failed to copy link');
    }
  };

  const handleOpenManifestLink = async () => {
    if (!deployedUrl) return;
    try {
      await window.electronAPI.shell.openExternal(deployedUrl);
    } catch (err) {
      console.error('Failed to open manifest URL:', err);
      toast?.error('Failed to open link');
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
    const children = folders.filter((f: FolderNode) => {
      // Handle both empty string and undefined/null parentId for root folders
      if (parentId === '') {
        return !f.parentId || f.parentId === '';
      }
      return f.parentId === parentId;
    });
    
    // Debug log for first render
    if (level === 0) {
      console.log('Rendering folder tree, root children:', children);
    }
    
    return children.map((folder: FolderNode) => {
      const hasChildren = folders.some((f: FolderNode) => f.parentId === folder.id);
      const isExpanded = expandedFolders.has(folder.id);
      const isSelected = selectedFolder === folder.id;
      
      // Keyboard reachability: this row used to be a plain <div onClick>,
      // 100% mouse-only — a keyboard user had no way to select a folder in
      // this modal at all. Now a real tab stop with Enter/Space activation,
      // matching the click handler exactly. Hover feedback moved to CSS
      // (manifest-modal.css) so the same treatment applies on :focus-visible.
      const selectFolder = () => {
        setSelectedFolder(folder.id);
        if (hasChildren) toggleFolder(folder.id);
      };

      return (
        <div key={folder.id}>
          <div
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${folder.name}${hasChildren ? (isExpanded ? ', expanded' : ', collapsed') : ''}`}
            className={`manifest-folder-row ${isSelected ? 'is-selected' : ''}`}
            onClick={selectFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectFolder();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 12px',
              paddingLeft: `${12 + level * 20}px`,
              cursor: 'pointer',
              borderRadius: '4px',
              margin: '2px 0'
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
    <div
      style={{
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
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-manifest-modal-title"
        style={{
          background: 'var(--ardrive-surface)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <FileJson size={24} style={{ color: 'var(--ardrive-primary)' }} />
            <h2 id="create-manifest-modal-title" style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Create Arweave Manifest</h2>
          </div>
          <button
            className="manifest-close-button"
            onClick={onClose}
            aria-label="Close"
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
          {/* A11Y-4: bare <label>s with no id/htmlFor pairing anywhere in
              this component. This one labels a custom folder-tree widget
              rather than a single <input>, so it's wired via
              aria-labelledby on the tree container instead of a fake
              htmlFor. */}
          <label id="manifest-folder-label" style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontWeight: 500
          }}>
            Select Folder
          </label>
          <div
            role="group"
            aria-labelledby="manifest-folder-label"
            style={{
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-sm)',
              maxHeight: '300px',
              overflowY: 'auto',
              backgroundColor: 'var(--gray-50)'
            }}
          >
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
              <>
                {console.warn('MANIFEST DEBUG - Rendering folders:', folders)}
                {renderFolderTree()}
              </>
            )}
          </div>
        </div>

        {/* Manifest Name */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label htmlFor="manifest-name" style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontWeight: 500
          }}>
            Manifest Name
          </label>
          <input
            id="manifest-name"
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
            className="button outline"
            onClick={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            className="button primary"
            onClick={handleProceedToConfirmation}
            disabled={creating || !selectedFolder || loading || estimatingCost}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
            }}
          >
            {estimatingCost ? (
              <>
                <Loader2 size={16} className="spin" />
                Estimating...
              </>
            ) : (
              'Next'
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {showConfirmation && folderInfo && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001
          }}
          onClick={handleConfirmBackdropClick}
        >
          <div
            ref={confirmContainerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-manifest-modal-title"
            style={{
              background: 'var(--ardrive-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
              width: '90%',
              maxWidth: '500px',
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
                <CheckCircle2 size={24} style={{ color: 'var(--success-600)' }} />
                <h2 id="confirm-manifest-modal-title" style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                  {deployedUrl ? 'Site Deployed' : 'Confirm Manifest Creation'}
                </h2>
              </div>
            </div>

            {deployedUrl ? (
              <>
                {/* UX-33: honest framing — a manifest is always public (core-js's
                    uploadPublicManifest), regardless of the source drive's own
                    privacy, and the link is permanent once written to Arweave. */}
                <div style={{
                  backgroundColor: 'var(--success-50)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-4)',
                  border: '1px solid var(--success-200)',
                  fontSize: '14px',
                  color: 'var(--success-700)'
                }}>
                  Your site is live on Arweave — a permanent, public link. Anyone
                  who has it can browse the files in this folder, no ArDrive account needed.
                </div>

                <div style={{
                  backgroundColor: 'var(--gray-50)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-4)'
                }}>
                  <div style={{
                    fontSize: '14px',
                    color: 'var(--gray-600)',
                    marginBottom: 'var(--space-2)'
                  }}>
                    Site URL
                  </div>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      wordBreak: 'break-all',
                      color: 'var(--ardrive-primary)',
                      fontWeight: 600
                    }}
                  >
                    {deployedUrl}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Selected Folder Info */}
                <div style={{
                  backgroundColor: 'var(--gray-50)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-4)'
                }}>
                  <div style={{
                    fontSize: '14px',
                    color: 'var(--gray-600)',
                    marginBottom: 'var(--space-2)'
                  }}>
                    Selected Folder
                  </div>
                  <div style={{
                    fontWeight: '600',
                    fontSize: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)'
                  }}>
                    <Folder size={18} style={{ color: 'var(--gray-500)' }} />
                    {folders.find(f => f.id === selectedFolder)?.name || 'Unknown'}
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--gray-500)',
                    marginTop: 'var(--space-2)'
                  }}>
                    {folderInfo.fileCount} file paths will be included in the manifest
                  </div>
                </div>

                {/* Manifest Name */}
                <div style={{
                  backgroundColor: 'var(--gray-50)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-4)'
                }}>
                  <div style={{
                    fontSize: '14px',
                    color: 'var(--gray-600)',
                    marginBottom: 'var(--space-2)'
                  }}>
                    Manifest Name
                  </div>
                  <div style={{
                    fontWeight: '600',
                    fontSize: '16px'
                  }}>
                    {manifestName}
                  </div>
                </div>

                {/* Cost Estimate */}
                <div style={{
                  backgroundColor: 'var(--success-50)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-4)',
                  border: '1px solid var(--success-200)'
                }}>
                  <div style={{
                    fontSize: '14px',
                    color: 'var(--success-700)',
                    marginBottom: 'var(--space-2)',
                    fontWeight: '500'
                  }}>
                    Cost
                  </div>
                  <div style={{
                    fontWeight: '700',
                    fontSize: '20px',
                    color: 'var(--success-600)'
                  }}>
                    FREE
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--success-600)',
                    marginTop: 'var(--space-1)'
                  }}>
                    Using Turbo Credits (manifests are free)
                  </div>
                </div>
              </>
            )}

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
              {deployedUrl ? (
                <>
                  <button
                    className="button outline"
                    onClick={handleCopyManifestLink}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  >
                    {linkCopied ? (
                      <>
                        <CheckCircle2 size={16} />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy size={16} />
                        Copy Link
                      </>
                    )}
                  </button>
                  <button
                    className="button outline"
                    onClick={handleOpenManifestLink}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  >
                    <ExternalLink size={16} />
                    Open
                  </button>
                  <button
                    className="button primary"
                    onClick={onClose}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="button outline"
                    onClick={() => setShowConfirmation(false)}
                    disabled={creating}
                  >
                    Back
                  </button>
                  <button
                    className="button primary"
                    onClick={handleConfirmCreate}
                    disabled={creating}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)'
                    }}
                  >
                    {creating ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        Creating Manifest...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        Confirm & Create
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateManifestModal;