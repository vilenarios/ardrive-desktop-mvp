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
  Check
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
}

const UserMenu: React.FC<UserMenuProps> = ({
  currentProfile,
  walletBalance,
  turboBalance,
  onShowSettings,
  onShowTurboManager,
  onShowWalletExport,
  onLogout
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
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

  return (
    <div className="user-menu" ref={dropdownRef}>
      <button 
        className="user-menu-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="user-avatar">
          <User size={16} />
        </div>
        <span className="user-name">
          {currentProfile.name || `${currentProfile.address.slice(0, 4)}...${currentProfile.address.slice(-4)}`}
        </span>
        <ChevronDown size={16} className={`chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown">
          {/* Profile Info */}
          <div className="menu-section">
            <div className="profile-info">
              <div className="profile-header">
                <div className="profile-avatar">
                  <User size={20} />
                </div>
                <div className="profile-details">
                  <div className="profile-name">
                    {currentProfile.name || 'Arweave User'}
                  </div>
                  {currentProfile.arnsName && (
                    <div className="profile-arns">
                      {currentProfile.arnsName}
                    </div>
                  )}
                </div>
              </div>
              
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

          {/* Balances */}
          <div className="menu-section">
            <div className="balance-item">
              <div className="balance-label">
                <Wallet size={16} />
                <span>AR Balance</span>
              </div>
              <div className="balance-value">{formatBalance(walletBalance)} AR</div>
            </div>
            
            {turboBalance && (
              <div className="balance-item">
                <div className="balance-label">
                  <Zap size={16} />
                  <span>Turbo Credits</span>
                </div>
                <div className="balance-value">{formatBalance(turboBalance)}</div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="menu-section">
            <button className="menu-item" onClick={() => {
              window.open(`https://viewblock.io/arweave/address/${currentProfile.address}`, '_blank');
              setIsOpen(false);
            }}>
              <ExternalLink size={16} />
              <span>View on ViewBlock</span>
            </button>
            
            <button className="menu-item" onClick={() => {
              onShowTurboManager();
              setIsOpen(false);
            }}>
              <Zap size={16} />
              <span>Manage Turbo Credits</span>
            </button>
            
            <button className="menu-item" onClick={() => {
              onShowWalletExport();
              setIsOpen(false);
            }}>
              <Wallet size={16} />
              <span>Export Wallet</span>
            </button>
          </div>

          {/* Settings & Logout */}
          <div className="menu-section">
            <button className="menu-item" onClick={() => {
              onShowSettings();
              setIsOpen(false);
            }}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
            
            <button className="menu-item logout" onClick={() => {
              onLogout();
              setIsOpen(false);
            }}>
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserMenu;