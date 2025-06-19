import React, { useState } from 'react';
import { Folder, Check } from 'lucide-react';

interface SyncManagerProps {
  onSyncFolderSelected: (folder: string) => void;
}

const SyncManager: React.FC<SyncManagerProps> = ({ onSyncFolderSelected }) => {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFolder = async () => {
    try {
      const folderPath = await window.electronAPI.dialog.selectFolder();
      if (folderPath) {
        setSelectedFolder(folderPath);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select folder');
    }
  };

  const handleContinue = () => {
    if (!selectedFolder) {
      setError('Please select a folder to sync');
      return;
    }
    onSyncFolderSelected(selectedFolder);
  };

  return (
    <div className="fade-in">
      <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ marginBottom: 'var(--space-6)', textAlign: 'center' }}>Choose Sync Folder</h2>

        <p style={{ 
          fontSize: '16px', 
          color: 'var(--gray-600)', 
          marginBottom: 'var(--space-6)',
          textAlign: 'center'
        }}>
          Select a folder on your computer to sync with ArDrive
        </p>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {/* Folder Selection */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          {selectedFolder ? (
            <div style={{
              padding: 'var(--space-4)',
              backgroundColor: 'var(--ardrive-primary-light)',
              border: '2px solid var(--ardrive-primary)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)'
            }}>
              <Check size={24} style={{ color: 'var(--ardrive-primary)', flexShrink: 0 }} />
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--gray-900)', marginBottom: 'var(--space-1)' }}>
                  Folder selected
                </div>
                <div style={{ 
                  fontSize: '13px', 
                  color: 'var(--gray-700)', 
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {selectedFolder}
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={handleSelectFolder}
              disabled={loading}
              style={{ 
                width: '100%',
                padding: 'var(--space-8)',
                backgroundColor: 'var(--gray-50)',
                borderRadius: 'var(--radius-lg)',
                border: '2px dashed var(--gray-300)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--space-3)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
                e.currentTarget.style.backgroundColor = 'var(--ardrive-primary-light)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--gray-300)';
                e.currentTarget.style.backgroundColor = 'var(--gray-50)';
              }}
            >
              <Folder size={48} style={{ color: 'var(--gray-400)' }} />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--gray-900)', marginBottom: 'var(--space-1)' }}>
                  Click to select folder
                </div>
                <div style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
                  Choose where to sync your drive files
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {selectedFolder && (
            <button
              className="button secondary"
              onClick={handleSelectFolder}
              disabled={loading}
            >
              Change Folder
            </button>
          )}
          
          <button
            className="button"
            onClick={handleContinue}
            disabled={!selectedFolder}
            style={{ flex: 1 }}
          >
            Continue
          </button>
        </div>

        {/* Minimal info text */}
        {selectedFolder && (
          <p style={{ 
            fontSize: '13px', 
            color: 'var(--gray-500)', 
            textAlign: 'center',
            marginTop: 'var(--space-4)',
            marginBottom: 0
          }}>
            Your files will sync to: {selectedFolder}/ArDrive
          </p>
        )}
      </div>
    </div>
  );
};

export default SyncManager;