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
  onCreateDrive?: () => void;
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
  profileCount = 1,
  onCreateDrive
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
                </div>
                <div className="profile-details">
                  {currentProfile.arnsName ? (
                    <div className="profile-primary-name">
                      {currentProfile.arnsName}
                    </div>
                  ) : (
                    <button 
                      className="arns-prompt"
                      onClick={async () => {
                        await window.electronAPI.shell.openExternal('https://arns.ar.io');
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

          {/* Account Actions */}
          <div className="menu-section">
            <div className="section-header">
              <span className="section-title">Account Actions</span>
            </div>
            <button className="menu-item" onClick={() => {
              onShowTurboManager();
              setIsOpen(false);
            }}>
              <Zap size={16} />
              <span>Buy Turbo Credits</span>
            </button>
            
            
            <button className="menu-item" onClick={async () => {
              await window.electronAPI.shell.openExternal(`https://viewblock.io/arweave/address/${currentProfile.address}`);
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
                You&apos;ll need to enter your password again to access your profile.
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

    </div>
  );
};

export default UserMenu;