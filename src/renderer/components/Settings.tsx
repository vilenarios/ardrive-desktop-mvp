import React, { useState } from 'react';
import { X, FolderOpen, Key, Info, ExternalLink } from 'lucide-react';
import { AppConfig } from '../../types';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
  onShowWalletExport: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  config,
  onShowWalletExport
}) => {
  const [isChangingFolder, setIsChangingFolder] = useState(false);

  const handleChangeSyncFolder = async () => {
    try {
      setIsChangingFolder(true);
      const result = await window.electronAPI.dialog.selectFolder();

      if (result && result.filePath) {
        await window.electronAPI.sync.setFolder(result.filePath);
        // The config will be updated through the normal flow
      }
    } catch (error) {
      console.error('Failed to change sync folder:', error);
    } finally {
      setIsChangingFolder(false);
    }
  };

  const handleExportAccount = () => {
    onShowWalletExport();
    // Don't close Settings modal immediately - let WalletExport manage its own state
  };

  const handleViewLicenses = async () => {
    // Open licenses or about page
    await window.electronAPI.shell.openExternal('https://github.com/ardriveapp/ardrive-desktop-mvp');
  };

  if (!isOpen) return null;

  return (
    <div 
      className="settings-modal-backdrop" 
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="settings-close-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="settings-modal-body">
          {/* Sync Folder Section */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <FolderOpen size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <h3>Sync Folder</h3>
                  <p>Choose where your files are synced locally</p>
                </div>
              </div>
              <div className="settings-item-content">
                <div className="folder-path">
                  {config.syncFolder || 'No folder selected'}
                </div>
                <button 
                  className="settings-button"
                  onClick={handleChangeSyncFolder}
                  disabled={isChangingFolder}
                >
                  {isChangingFolder ? 'Changing...' : 'Change Folder'}
                </button>
              </div>
            </div>
          </div>

          {/* Account Export Section */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <Key size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <h3>Account Export</h3>
                  <p>Backup your wallet file or recovery phrase securely</p>
                </div>
              </div>
              <div className="settings-item-content">
                <button 
                  className="settings-button"
                  onClick={handleExportAccount}
                >
                  Export Account
                </button>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <Info size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <h3>About</h3>
                  <p>ArDrive Desktop MVP</p>
                </div>
              </div>
              <div className="settings-item-content">
                <button 
                  className="settings-button-secondary"
                  onClick={handleViewLicenses}
                >
                  <ExternalLink size={16} />
                  View on GitHub
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;