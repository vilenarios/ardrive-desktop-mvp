import React, { useState } from 'react';
import { X, FolderOpen, Key, Info, ExternalLink, Globe } from 'lucide-react';
import { AppConfig } from '../../types';
import { InfoButton } from './common/InfoButton';
import { useModalA11y } from '../hooks/useModalA11y';

// INFO-3: mirrors src/main/gateway.ts's DEFAULT_GATEWAY_HOST. This is a
// renderer-side display/reset value only — the main process (gateway.ts) is
// the single source of truth for gateway resolution; nothing here changes
// that logic. Renderer code can't import main-process modules, so the
// literal is intentionally duplicated as a UI-only constant.
const DEFAULT_GATEWAY_HOST = 'turbo-gateway.com';

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
  const [currentFolder, setCurrentFolder] = useState<string | null>(config.syncFolder ?? null);
  const [folderError, setFolderError] = useState<string | null>(null);

  // INFO-3: gateway host field. Mirrors the sync-folder pattern above —
  // local state seeded from `config`, updated in place after a successful
  // IPC round-trip (Settings stays mounted across open/close, so this only
  // re-seeds on a fresh mount, same as currentFolder).
  const [gatewayHost, setGatewayHost] = useState(config.gatewayHost?.trim() ?? '');
  const [isSavingGateway, setIsSavingGateway] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewaySaved, setGatewaySaved] = useState(false);

  const handleChangeSyncFolder = async () => {
    try {
      setIsChangingFolder(true);
      setFolderError(null);

      // dialog:select-folder resolves to an IpcResult wrapping the selected path
      // string, or null on cancel
      const selectFolderResult = await window.electronAPI.dialog.selectFolder();
      const selectedPath = selectFolderResult.success ? selectFolderResult.data : null;
      if (!selectedPath) {
        return; // user cancelled
      }

      // updateActiveMapping: Settings is changing the folder of the drive
      // being synced, so the active mapping must follow (onboarding doesn't).
      // UX-3: the handler now RESOLVES { success:false } on error instead of
      // throwing, so branch on the envelope explicitly.
      const setFolderResult = await window.electronAPI.sync.setFolder(selectedPath, { updateActiveMapping: true });
      if (!setFolderResult.success) {
        throw new Error(setFolderResult.error || 'Failed to change sync folder');
      }
      setCurrentFolder(selectedPath);

      // Re-target the running sync at the new folder (startSync re-targets
      // when the configured folder differs from the watched one).
      const restartResult = await window.electronAPI.sync.start();
      if (!restartResult.success) {
        console.error('Folder changed but sync restart failed:', restartResult.error);
        setFolderError('Folder changed, but sync could not restart automatically. Use Sync to retry.');
      }
    } catch (error) {
      console.error('Failed to change sync folder:', error);
      setFolderError('Failed to change sync folder. Please try again.');
    } finally {
      setIsChangingFolder(false);
    }
  };

  // INFO-3: config:set-gateway (main.ts) + config.setGateway (preload.ts)
  // already exist and already validate + persist via
  // InputValidator.validateGatewayHost — this wires the missing UI up to
  // that existing path rather than adding a new IPC handler.
  const saveGateway = async (hostToSave: string) => {
    const trimmed = hostToSave.trim();
    if (!trimmed) {
      setGatewayError("Enter a gateway host, or use Reset to Default.");
      return;
    }
    try {
      setIsSavingGateway(true);
      setGatewayError(null);
      setGatewaySaved(false);
      const result = await window.electronAPI.config.setGateway(trimmed);
      if (!result.success) {
        // InputValidator rejects protocols/paths/ports/slashes/whitespace -
        // surface its message rather than a generic one so the user knows
        // what to fix.
        setGatewayError(result.error || "That doesn't look like a valid gateway host.");
        return;
      }
      setGatewayHost(trimmed);
      setGatewaySaved(true);
      setTimeout(() => setGatewaySaved(false), 2500);
    } catch (error) {
      console.error('Failed to save gateway host:', error);
      setGatewayError('Failed to save gateway host. Please try again.');
    } finally {
      setIsSavingGateway(false);
    }
  };

  const handleSaveGateway = () => saveGateway(gatewayHost);
  const handleResetGateway = () => saveGateway(DEFAULT_GATEWAY_HOST);

  const handleExportAccount = () => {
    onShowWalletExport();
    // Don't close Settings modal immediately - let WalletExport manage its own state
  };

  const handleViewLicenses = async () => {
    // Open licenses or about page
    await window.electronAPI.shell.openExternal('https://github.com/ardriveapp/ardrive-desktop-mvp');
  };

  // A11Y-2: Settings had no Escape/focus-trap and no role="dialog" — reuse
  // the shared hook used by the drive modals. Must be called before the
  // `if (!isOpen) return null` below (hooks can't be conditional).
  const { containerRef, handleBackdropClick } = useModalA11y<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      className="settings-modal-backdrop"
      onClick={handleBackdropClick}
    >
      <div
        className="settings-modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="settings-modal-header">
          <h2 id="settings-modal-title">Settings</h2>
          <button className="settings-close-button" onClick={onClose} aria-label="Close">
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
                  {currentFolder || 'No folder selected'}
                </div>
                {folderError && (
                  <div className="folder-error" style={{ color: 'var(--danger-fg)', fontSize: '13px', marginBottom: 'var(--space-2)' }}>
                    {folderError}
                  </div>
                )}
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

          {/* Gateway Section — INFO-3: the backend (src/main/gateway.ts,
              config:set-gateway IPC) was fully wired by SYNC-17 but shipped
              with no UI; this is that missing control. */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <Globe size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <div className="settings-item-title-row">
                    <h3>Gateway</h3>
                    <InfoButton tooltip="Gateway — the server ArDrive uses to reach the Arweave network. Default: turbo-gateway.com. Change this only if uploads or downloads are failing (for example, if arweave.net is rate-limiting you)." />
                  </div>
                  <p>The server ArDrive uses to reach the Arweave network</p>
                </div>
              </div>
              <div className="settings-item-content settings-gateway-content">
                <label htmlFor="settings-gateway-input" className="settings-input-label">
                  Gateway host
                </label>
                <input
                  id="settings-gateway-input"
                  type="text"
                  className={`settings-input${gatewayError ? ' invalid' : ''}`}
                  value={gatewayHost}
                  onChange={(e) => {
                    setGatewayHost(e.target.value);
                    setGatewayError(null);
                    setGatewaySaved(false);
                  }}
                  placeholder={DEFAULT_GATEWAY_HOST}
                  disabled={isSavingGateway}
                  spellCheck={false}
                  autoComplete="off"
                />
                {gatewayError && (
                  <div className="settings-field-error">{gatewayError}</div>
                )}
                {gatewaySaved && !gatewayError && (
                  <div className="settings-field-success">Gateway saved.</div>
                )}
                <div className="settings-gateway-actions">
                  <button
                    className="settings-button"
                    onClick={handleSaveGateway}
                    disabled={isSavingGateway}
                  >
                    {isSavingGateway ? 'Saving...' : 'Save Gateway'}
                  </button>
                  <button
                    className="settings-button-secondary"
                    onClick={handleResetGateway}
                    disabled={isSavingGateway || gatewayHost.trim() === DEFAULT_GATEWAY_HOST}
                  >
                    Reset to Default
                  </button>
                </div>
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