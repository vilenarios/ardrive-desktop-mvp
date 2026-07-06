import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Key, Info, ExternalLink, Globe, ShieldCheck, Bell } from 'lucide-react';
import { AppConfig } from '../../types';
import { InfoButton } from './common/InfoButton';
import { useModalA11y } from '../hooks/useModalA11y';
// INFO-3/SYNC-19: mirrors src/main/gateway.ts's DEFAULT_GATEWAY_HOST — the
// main process (gateway.ts) is the single source of truth for gateway
// *resolution*; nothing here changes that logic. Renderer code can't import
// main-process modules, so this display/reset value comes from the renderer's
// own single source (src/renderer/utils/gateway.ts) rather than a second
// duplicated literal.
import { DEFAULT_GATEWAY_HOST, invalidateGatewayHostCache } from '../utils/gateway';

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

  // SEC-4: "remember me on this device" (OS keychain) consent. `null` = still
  // resolving whether a secure keychain is even available on this device.
  const [keychainAvailable, setKeychainAvailable] = useState<boolean | null>(null);
  const [rememberDevice, setRememberDevice] = useState<boolean>(config.rememberDevice === true);
  const [isSavingRemember, setIsSavingRemember] = useState(false);
  const [rememberError, setRememberError] = useState<string | null>(null);

  // UX-29: native desktop notifications opt-out. Mirrors the Remember Me
  // pattern above — seed from config, then re-resolve the authoritative value
  // from main on open (config.notificationsEnabled may be undefined/stale;
  // main's default is true).
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(config.notificationsEnabled !== false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  // Resolve the true keychain availability + persisted consent from the main
  // process whenever the modal opens (config.rememberDevice is only the seed).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const availRes = await window.electronAPI.security.isKeychainAvailable();
        const consentRes = await window.electronAPI.security.getKeychainConsent();
        if (cancelled) return;
        setKeychainAvailable(availRes.success ? availRes.data === true : false);
        if (consentRes.success) {
          setRememberDevice(consentRes.data === true);
        }
      } catch (error) {
        if (!cancelled) setKeychainAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Enabling persists the login to the OS keychain; disabling (or "Forget this
  // device") durably clears it. The main process is the source of truth for the
  // resulting state, so reflect exactly what it returns.
  const applyRememberConsent = async (next: boolean) => {
    setIsSavingRemember(true);
    setRememberError(null);
    try {
      const result = await window.electronAPI.security.setKeychainConsent(next);
      if (!result.success) {
        setRememberError(result.error || 'Could not update this setting. Please try again.');
        return;
      }
      setRememberDevice(result.data === true);
    } catch (error) {
      setRememberError('Could not update this setting. Please try again.');
    } finally {
      setIsSavingRemember(false);
    }
  };

  const handleToggleRemember = () => applyRememberConsent(!rememberDevice);
  const handleForgetDevice = () => applyRememberConsent(false);

  // UX-29: resolve the authoritative notifications preference from main
  // whenever the modal opens (config.notificationsEnabled is only the seed).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electronAPI.config.getNotificationsEnabled();
        if (cancelled) return;
        if (res.success) {
          setNotificationsEnabled(res.data === true);
        }
      } catch (error) {
        // Keep the seeded value on failure — non-critical setting.
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const handleToggleNotifications = async () => {
    const next = !notificationsEnabled;
    setIsSavingNotifications(true);
    setNotificationsError(null);
    try {
      const result = await window.electronAPI.config.setNotificationsEnabled(next);
      if (!result.success) {
        setNotificationsError(result.error || 'Could not update this setting. Please try again.');
        return;
      }
      setNotificationsEnabled(result.data === true);
    } catch (error) {
      setNotificationsError('Could not update this setting. Please try again.');
    } finally {
      setIsSavingNotifications(false);
    }
  };

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
      // SYNC-19: drop the cached renderer-side gateway host so link builders
      // elsewhere in the dashboard (Storage/Activity/Overview tabs,
      // FileLinkActions) pick up the new value on their next call instead of
      // continuing to use the pre-save (possibly default) host until restart.
      invalidateGatewayHostCache();
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

          {/* Remember Me / Keychain Section — SEC-4: keychain persistence of
              the login is opt-in per profile, with honest copy about what's
              stored and a way to clear it. */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <ShieldCheck size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <div className="settings-item-title-row">
                    <h3>Remember Me on This Device</h3>
                    <InfoButton tooltip="Remember me on this device">
                      <p>
                        When this is on, ArDrive saves your login for this profile in
                        this device&apos;s secure system keychain — the OS-protected store
                        used for saved credentials — so you don&apos;t have to type your
                        password every time you open the app.
                      </p>
                      <p>
                        What&apos;s stored stays on this device and is never uploaded
                        anywhere. It&apos;s removed automatically when you sign out, switch
                        profiles, delete this profile, or turn this setting off.
                      </p>
                    </InfoButton>
                  </div>
                  <p>Keep your login on this device so you don&apos;t have to retype your password</p>
                </div>
              </div>
              <div className="settings-item-content">
                {keychainAvailable === false ? (
                  <div
                    className="settings-field-note"
                    style={{ color: 'var(--text-secondary)', fontSize: '13px' }}
                  >
                    Not available on this device — your operating system&apos;s secure
                    keychain isn&apos;t accessible, so your login can&apos;t be securely
                    remembered here. You&apos;ll enter your password each time you open
                    ArDrive.
                  </div>
                ) : (
                  <>
                    <label
                      className="settings-toggle-label"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        cursor: (isSavingRemember || keychainAvailable === null) ? 'default' : 'pointer',
                        marginBottom: 'var(--space-2)'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={rememberDevice}
                        onChange={handleToggleRemember}
                        disabled={isSavingRemember || keychainAvailable === null}
                      />
                      <span>Remember my login on this device</span>
                    </label>
                    <p
                      style={{
                        color: rememberDevice ? 'var(--success-fg, var(--text-secondary))' : 'var(--text-secondary)',
                        fontSize: '13px',
                        margin: '0 0 var(--space-2) 0'
                      }}
                    >
                      {rememberDevice
                        ? 'Your login is remembered on this device.'
                        : "Your login isn't saved. You'll enter your password each time you open ArDrive."}
                    </p>
                    {rememberDevice && (
                      <button
                        className="settings-button-secondary"
                        onClick={handleForgetDevice}
                        disabled={isSavingRemember}
                      >
                        {isSavingRemember ? 'Working...' : 'Forget this device'}
                      </button>
                    )}
                    {rememberError && (
                      <div className="settings-field-error">{rememberError}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Notifications Section — UX-29: native OS notifications (sync
              complete/error, upload complete, approval needed) are opt-out and
              on by default. Reuses the Remember Me section's toggle pattern. */}
          <div className="settings-section">
            <div className="settings-item">
              <div className="settings-item-header">
                <Bell size={20} className="settings-icon" />
                <div className="settings-item-info">
                  <div className="settings-item-title-row">
                    <h3>Desktop Notifications</h3>
                    <InfoButton tooltip="Desktop notifications">
                      <p>
                        When this is on, ArDrive shows a native system notification
                        when a sync finishes, an upload completes, a sync error
                        happens, or files are waiting for your approval to upload.
                      </p>
                      <p>
                        Turning this off stops all of these notifications; you can
                        still see the same information inside the app.
                      </p>
                    </InfoButton>
                  </div>
                  <p>Get notified when syncs and uploads finish, or need your attention</p>
                </div>
              </div>
              <div className="settings-item-content">
                <label
                  className="settings-toggle-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    cursor: isSavingNotifications ? 'default' : 'pointer',
                    marginBottom: 'var(--space-2)'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={notificationsEnabled}
                    onChange={handleToggleNotifications}
                    disabled={isSavingNotifications}
                  />
                  <span>Show desktop notifications</span>
                </label>
                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    margin: '0 0 var(--space-2) 0'
                  }}
                >
                  {notificationsEnabled
                    ? 'Sync, upload, error, and approval notifications are on.'
                    : "You won't receive desktop notifications from ArDrive."}
                </p>
                {notificationsError && (
                  <div className="settings-field-error">{notificationsError}</div>
                )}
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