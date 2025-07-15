import React, { useState, useRef, useEffect } from 'react';
import { 
  User, 
  ChevronDown, 
  Settings, 
  LogOut, 
  Wallet,
  Copy,
  ExternalLink,
  Zap,
  Check,
  RefreshCw,
  Users,
  Plus,
  Edit,
  HelpCircle,
  X
} from 'lucide-react';
import { Profile } from '../../types';

interface UserMenuProps {
  currentProfile: Profile;
  walletBalance: string;
  turboBalance?: string;
  onShowSettings: () => void;
  onShowTurboManager: () => void;
  onShowWalletExport: () => void;
  onLogout: () => void;
  onSwitchProfile?: () => void;
  onAddProfile?: () => void;
  profileCount?: number;
}

const UserMenu: React.FC<UserMenuProps> = ({
  currentProfile,
  walletBalance,
  turboBalance,
  onShowSettings,
  onShowTurboManager,
  onShowWalletExport,
  onLogout,
  onSwitchProfile,
  onAddProfile,
  profileCount = 1
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isRefreshingAR, setIsRefreshingAR] = useState(false);
  const [isRefreshingTurbo, setIsRefreshingTurbo] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(currentProfile.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const formatBalance = (balance: string) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.0001) return '<0.0001';
    if (num < 1) return num.toFixed(4);
    if (num < 1000) return num.toFixed(2);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const handleRefreshARBalance = async () => {
    try {
      setIsRefreshingAR(true);
      console.log('Manually refreshing AR balance');
      await window.electronAPI.wallet.getInfo(true); // Force refresh
    } catch (err) {
      console.error('Failed to refresh AR balance:', err);
    } finally {
      setIsRefreshingAR(false);
    }
  };

  const handleRefreshTurboBalance = async () => {
    try {
      setIsRefreshingTurbo(true);
      console.log('Manually refreshing Turbo balance');
      await window.electronAPI.turbo.getStatus();
    } catch (err) {
      console.error('Failed to refresh Turbo balance:', err);
    } finally {
      setIsRefreshingTurbo(false);
    }
  };

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
    setIsOpen(false);
  };

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };

  const handleLogoutCancel = () => {
    setShowLogoutConfirm(false);
  };

  return (
    <div className="user-menu" ref={dropdownRef}>
      <button 
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="user-avatar">
          {currentProfile.avatarUrl ? (
            <img 
              src={currentProfile.avatarUrl} 
              alt={currentProfile.arnsName || currentProfile.name || 'User'}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const nextElement = e.currentTarget.nextSibling as HTMLElement;
                if (nextElement) {
                  nextElement.style.display = '';
                }
              }}
            />
          ) : null}
          <User size={16} style={currentProfile.avatarUrl ? { display: 'none' } : {}} />
        </div>
        <span className="user-name">
          {currentProfile.arnsName || currentProfile.name || `${currentProfile.address.slice(0, 4)}...${currentProfile.address.slice(-4)}`}
        </span>
        <ChevronDown size={16} className={`chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          {/* Profile Info */}
          <div className="menu-section">
            <div className="profile-info">
              <div className="profile-header">
                <div className="profile-avatar-container">
                  <div className="profile-avatar">
                    {currentProfile.avatarUrl ? (
                      <img 
                        src={currentProfile.avatarUrl} 
                        alt={currentProfile.arnsName || currentProfile.name || 'User'}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const nextElement = e.currentTarget.nextSibling as HTMLElement;
                          if (nextElement) {
                            nextElement.style.display = '';
                          }
                        }}
                      />
                    ) : null}
                    <User size={32} style={currentProfile.avatarUrl ? { display: 'none' } : {}} />
                  </div>
                  <button className="edit-profile-overlay" title="Edit Profile Picture (Coming Soon)">
                    <Edit size={12} />
                  </button>
                </div>
                <div className="profile-details">
                  {currentProfile.arnsName ? (
                    <div className="profile-primary-name">
                      {currentProfile.arnsName}
                    </div>
                  ) : (
                    <button 
                      className="arns-prompt"
                      onClick={() => {
                        window.open('https://arns.ar.io', '_blank');
                        setIsOpen(false);
                      }}
                      title="Get your ArNS name"
                    >
                      <Zap size={14} />
                      <span>Get your ArNS name</span>
                      <ExternalLink size={12} />
                    </button>
                  )}
                  <div className="profile-address">
                    <span>{currentProfile.address.slice(0, 6)}...{currentProfile.address.slice(-4)}</span>
                    <button 
                      className="copy-button"
                      onClick={handleCopyAddress}
                      title="Copy address"
                    >
                      {copiedAddress ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Balances */}
          <div className="menu-section">
            <div className="section-header">
              <span className="section-title">Balances</span>
            </div>
            <div className="balance-item">
              <div className="balance-label">
                <Wallet size={16} />
                <span>AR Balance</span>
                <div className="balance-tooltip">
                  <HelpCircle size={14} />
                  <div className="tooltip-content">Your Arweave token balance for permanent storage</div>
                </div>
              </div>
              <div className="balance-controls">
                <div className="balance-value">{formatBalance(walletBalance)} AR</div>
                <button
                  onClick={handleRefreshARBalance}
                  disabled={isRefreshingAR}
                  className="refresh-button"
                  title="Refresh AR balance"
                >
                  <RefreshCw size={14} className={isRefreshingAR ? 'spinning' : ''} />
                </button>
              </div>
            </div>
            
            {turboBalance && (
              <div className="balance-item">
                <div className="balance-label">
                  <Zap size={16} />
                  <span>Turbo Credits</span>
                  <div className="balance-tooltip">
                    <HelpCircle size={14} />
                    <div className="tooltip-content">Credits for fast, gasless uploads via Turbo</div>
                  </div>
                </div>
                <div className="balance-controls">
                  <div className="balance-value">{formatBalance(turboBalance)}</div>
                  <button
                    onClick={handleRefreshTurboBalance}
                    disabled={isRefreshingTurbo}
                    className="refresh-button"
                    title="Refresh Turbo balance"
                  >
                    <RefreshCw size={14} className={isRefreshingTurbo ? 'spinning' : ''} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Wallet Actions */}
          <div className="menu-section">
            <div className="section-header">
              <span className="section-title">Wallet Actions</span>
            </div>
            <button className="menu-item" onClick={() => {
              onShowTurboManager();
              setIsOpen(false);
            }}>
              <Zap size={16} />
              <span>Buy Turbo Credits</span>
            </button>
            
            <button className="menu-item wallet-export" onClick={() => {
              onShowWalletExport();
              setIsOpen(false);
            }}>
              <Wallet size={16} />
              <span>Export Wallet</span>
              <div className="export-tooltip">
                <HelpCircle size={14} />
                <div className="tooltip-content">Backup your wallet file or recovery phrase. Keep this safe.</div>
              </div>
            </button>
            
            <button className="menu-item" onClick={() => {
              window.open(`https://viewblock.io/arweave/address/${currentProfile.address}`, '_blank');
              setIsOpen(false);
            }}>
              <ExternalLink size={16} />
              <span>View on ViewBlock</span>
            </button>
          </div>


          {/* Settings & Logout */}
          <div className="menu-section final-section">
            <button className="menu-item" onClick={() => {
              onShowSettings();
              setIsOpen(false);
            }}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
            
            <button className="menu-item logout" onClick={handleLogoutClick}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="logout-modal-backdrop" onClick={handleLogoutCancel}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="logout-modal-header">
              <h3>Confirm Logout</h3>
              <button className="close-button" onClick={handleLogoutCancel}>
                <X size={20} />
              </button>
            </div>
            
            <div className="logout-modal-body">
              <p>Are you sure you want to logout?</p>
              <p className="logout-warning">
                You'll need to enter your password again to access your profile.
              </p>
            </div>
            
            <div className="logout-modal-footer">
              <button className="cancel-button" onClick={handleLogoutCancel}>
                Cancel
              </button>
              <button className="logout-confirm-button" onClick={handleLogoutConfirm}>
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* User Menu Styles */
        .user-menu {
          position: relative;
          font-family: var(--font-system);
        }

        .user-menu-trigger {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 200px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }

        .user-menu-trigger:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .user-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--gray-200);
          color: var(--gray-600);
          overflow: hidden;
          flex-shrink: 0;
        }

        .user-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .user-name {
          font-weight: 500;
          font-size: var(--text-sm);
          color: var(--gray-900);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }

        .chevron {
          color: var(--gray-500);
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }

        .chevron.rotated {
          transform: rotate(180deg);
        }

        .user-menu-dropdown {
          position: absolute;
          top: calc(100% + var(--space-2));
          right: 0;
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-xl);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          overflow: hidden;
          min-width: 320px;
          max-width: 400px;
        }

        /* Section Styles */
        .menu-section {
          padding: var(--space-4);
          border-bottom: 1px solid var(--gray-100);
        }

        .menu-section:last-child {
          border-bottom: none;
        }

        .final-section {
          border-top: 1px solid var(--gray-200);
          background: var(--gray-50);
        }

        .section-header {
          margin-bottom: var(--space-3);
        }

        .section-title {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          color: var(--gray-500);
          letter-spacing: 0.5px;
        }

        /* Profile Header */
        .profile-info {
          margin-bottom: var(--space-1);
        }

        .profile-header {
          display: flex;
          align-items: flex-start;
          gap: var(--space-4);
          margin-bottom: var(--space-4);
        }

        .profile-avatar-container {
          position: relative;
        }

        .profile-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--gray-200);
          color: var(--gray-600);
          overflow: hidden;
          flex-shrink: 0;
        }

        .profile-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .edit-profile-overlay {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 20px;
          height: 20px;
          background: var(--ardrive-primary);
          color: white;
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0.9;
          transition: opacity 0.2s ease;
        }

        .edit-profile-overlay:hover {
          opacity: 1;
        }

        .profile-details {
          flex: 1;
          min-width: 0;
        }

        .profile-primary-name {
          font-size: var(--text-lg);
          font-weight: 600;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .arns-prompt {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.05) 0%, rgba(220, 38, 38, 0.1) 100%);
          border: 1px solid rgba(220, 38, 38, 0.2);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--ardrive-primary);
          cursor: pointer;
          transition: all 0.2s ease;
          margin-bottom: var(--space-2);
          white-space: nowrap;
        }

        .arns-prompt:hover {
          background: linear-gradient(135deg, rgba(220, 38, 38, 0.1) 0%, rgba(220, 38, 38, 0.15) 100%);
          border-color: rgba(220, 38, 38, 0.3);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(220, 38, 38, 0.15);
        }

        .arns-prompt svg:first-child {
          color: var(--ardrive-primary);
        }

        .arns-prompt svg:last-child {
          opacity: 0.7;
          margin-left: auto;
        }

        .profile-address {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--gray-100);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          color: var(--gray-700);
          font-family: var(--font-mono);
          margin-top: var(--space-2);
        }

        .copy-button {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-1);
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--gray-500);
          border-radius: var(--radius-sm);
          transition: all 0.2s ease;
        }

        .copy-button:hover {
          background: var(--gray-200);
          color: var(--ardrive-primary);
        }

        /* Balance Styles */
        .balance-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--gray-100);
        }

        .balance-item:last-child {
          border-bottom: none;
        }

        .balance-label {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--gray-700);
          font-size: var(--text-sm);
          font-weight: 500;
        }

        .balance-controls {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .balance-value {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--gray-900);
          font-family: var(--font-mono);
        }

        .refresh-button {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-1);
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--gray-500);
          border-radius: var(--radius-sm);
          transition: all 0.2s ease;
        }

        .refresh-button:hover:not(:disabled) {
          background: var(--gray-100);
          color: var(--ardrive-primary);
        }

        .refresh-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .spinning {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* Tooltip Styles */
        .balance-tooltip,
        .export-tooltip {
          position: relative;
          display: flex;
          align-items: center;
          margin-left: var(--space-2);
        }

        .balance-tooltip:hover .tooltip-content,
        .export-tooltip:hover .tooltip-content {
          opacity: 1;
          visibility: visible;
          transform: translateY(-50%) translateX(-50%);
        }

        .tooltip-content {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateY(-60%) translateX(-50%);
          background: var(--gray-900);
          color: white;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          font-size: var(--text-xs);
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          transition: all 0.2s ease;
          z-index: 1001;
          pointer-events: none;
        }

        .tooltip-content::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 4px solid transparent;
          border-top-color: var(--gray-900);
        }

        /* Menu Item Styles */
        .menu-item {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          width: 100%;
          padding: var(--space-3) var(--space-4);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: var(--text-sm);
          color: var(--gray-700);
          text-align: left;
          margin-bottom: var(--space-1);
        }

        .menu-item:last-child {
          margin-bottom: 0;
        }

        .menu-item:hover {
          background: var(--gray-100);
          color: var(--gray-900);
        }

        .menu-item.wallet-export {
          position: relative;
        }

        .menu-item.logout {
          color: var(--ardrive-danger);
        }

        .menu-item.logout:hover {
          background: var(--danger-50);
          color: var(--ardrive-danger);
        }

        .menu-item svg {
          color: var(--gray-500);
          flex-shrink: 0;
        }

        .menu-item.logout svg {
          color: var(--ardrive-danger);
        }

        /* Modal Styles */
        .logout-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          backdrop-filter: blur(2px);
        }

        .logout-modal {
          background: white;
          border-radius: var(--radius-xl);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
          width: 90%;
          max-width: 400px;
          overflow: hidden;
        }

        .logout-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-6);
          border-bottom: 1px solid var(--gray-200);
        }

        .logout-modal-header h3 {
          margin: 0;
          font-size: var(--text-lg);
          font-weight: 600;
          color: var(--gray-900);
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
          background: var(--gray-100);
          color: var(--gray-700);
        }

        .logout-modal-body {
          padding: var(--space-6);
        }

        .logout-modal-body p {
          margin: 0 0 var(--space-3) 0;
          color: var(--gray-700);
          font-size: var(--text-sm);
        }

        .logout-warning {
          color: var(--gray-600);
          font-size: var(--text-xs);
        }

        .logout-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--space-3);
          padding: var(--space-6);
          border-top: 1px solid var(--gray-200);
          background: var(--gray-50);
        }

        .cancel-button {
          padding: var(--space-2) var(--space-4);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          color: var(--gray-700);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .cancel-button:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
        }

        .logout-confirm-button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          background: var(--ardrive-danger);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .logout-confirm-button:hover {
          background: var(--danger-700);
        }
      `}</style>
    </div>
  );
};

export default UserMenu;