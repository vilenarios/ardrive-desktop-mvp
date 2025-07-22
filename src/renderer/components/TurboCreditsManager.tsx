import React, { useState, useEffect } from 'react';
import { 
  CreditCard, 
  Zap, 
  ArrowRight, 
  Info, 
  Settings,
  Gift,
  Share2,
  AlertCircle,
  TrendingUp,
  DollarSign,
  Shield,
  ChevronRight,
  Check,
  Users
} from 'lucide-react';
import { WalletInfo } from '../../types';
import { InfoButton } from './common/InfoButton';
import { ExpandableSection } from './common/ExpandableSection';
import { ClientInputValidator } from '../input-validator';
import TurboBalanceCard from './turbo/TurboBalanceCard';
import TurboPurchaseTab from './turbo/TurboPurchaseTab';
import TurboSettingsTab from './turbo/TurboSettingsTab';
import TurboAboutTab from './turbo/TurboAboutTab';
import TurboComingSoonTab from './turbo/TurboComingSoonTab';

interface TurboCreditsManagerProps {
  walletInfo: WalletInfo;
  onClose: () => void;
}

interface TurboBalance {
  winc: string;
  ar: string;
}

interface FiatEstimate {
  byteCount: number;
  amount: number;
  currency: string;
  winc: string;
}

interface AutoTopUpSettings {
  enabled: boolean;
  threshold: number; // AR amount
  amount: number; // USD amount to top up
  paymentMethod?: string;
}

const TurboCreditsManager: React.FC<TurboCreditsManagerProps> = ({ walletInfo, onClose }) => {
  const [balance, setBalance] = useState<TurboBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<string>('10');
  const [topUpCurrency, setTopUpCurrency] = useState<string>('USD');
  const [tokenAmount, setTokenAmount] = useState<string>('0.001');
  const [fiatEstimate, setFiatEstimate] = useState<FiatEstimate | null>(null);
  const [activeTab, setActiveTab] = useState<'purchase' | 'settings' | 'coming-soon' | 'about'>('purchase');
  const [autoTopUp, setAutoTopUp] = useState<AutoTopUpSettings>({
    enabled: false,
    threshold: 0.1,
    amount: 10
  });
  const [showAutoTopUpSaved, setShowAutoTopUpSaved] = useState(false);

  // Calculate storage amount for dollar amount
  const calculateStorageAmount = (dollarAmount: number): string => {
    if (!fiatEstimate) return '~ GB storage';
    
    // fiatEstimate.amount is the cost in USD for 1 GB
    const gbPerDollar = 1 / fiatEstimate.amount;
    const totalGB = dollarAmount * gbPerDollar;
    
    return formatStorageAmount(totalGB) + ' storage';
  };


  // Format storage amount nicely
  const formatStorageAmount = (totalGB: number): string => {
    if (totalGB >= 1000) {
      return `~${(totalGB / 1000).toFixed(1)} TB`;
    } else if (totalGB >= 1) {
      return `~${Math.round(totalGB)} GB`;
    } else {
      return `~${Math.round(totalGB * 1000)} MB`;
    }
  };


  useEffect(() => {
    // Force refresh wallet balance when opening Turbo manager
    const refreshBalances = async () => {
      console.log('TurboCreditsManager: Force refreshing wallet balance');
      await window.electronAPI.wallet.getInfo(true); // Force refresh
      await loadTurboBalance();
      loadFiatEstimate();
    };
    
    refreshBalances();
    
    // Listen for wallet info updates (e.g., after returning from payment)
    window.electronAPI.onWalletInfoUpdated((updatedWalletInfo) => {
      console.log('Wallet info updated, refreshing Turbo balance...');
      setSuccessMessage('Payment successful! Your Turbo Credits balance has been updated.');
      setTimeout(() => setSuccessMessage(null), 5000);
      loadTurboBalance();
    });
    
    // Listen for payment completion
    window.electronAPI.payment.onPaymentCompleted(() => {
      console.log('Payment completed, refreshing balance...');
      setSuccessMessage('Payment successful! Your Turbo Credits balance is being updated...');
      setTimeout(() => setSuccessMessage(null), 5000);
      
      // Refresh balance after a short delay
      setTimeout(() => {
        loadTurboBalance();
      }, 2000);
    });
    
    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeWalletInfoUpdatedListener();
      window.electronAPI.payment.removePaymentCompletedListener();
    };
  }, []);

  const loadTurboBalance = async () => {
    try {
      setLoading(true);
      const turboBalance = await window.electronAPI.turbo.getBalance();
      setBalance(turboBalance);
    } catch (err) {
      console.error('Failed to load Turbo balance:', err);
      setError('Failed to load Turbo Credits balance');
    } finally {
      setLoading(false);
    }
  };

  const loadFiatEstimate = async () => {
    try {
      // Get estimate for 1 GB upload
      const estimate = await window.electronAPI.turbo.getFiatEstimate(1024 * 1024 * 1024, 'usd');
      setFiatEstimate(estimate);
    } catch (err) {
      console.error('Failed to load fiat estimate:', err);
    }
  };

  const handleFiatTopUp = async (amount?: number) => {
    try {
      setLoading(true);
      setError(null);
      
      const finalAmount = amount || parseFloat(topUpAmount);
      
      // Validate amount using client-side validation
      const amountValidation = ClientInputValidator.validateTurboAmount(finalAmount);
      if (!amountValidation.isValid) {
        throw new Error(amountValidation.error!);
      }

      const session = await window.electronAPI.turbo.createCheckoutSession(finalAmount, topUpCurrency);
      
      if (session.url) {
        // Open payment in modal window
        await window.electronAPI.payment.openWindow(session.url);
        setSuccessMessage('Payment window opened. Complete your payment and the window will close automatically.');
        setError(null);
      } else {
        throw new Error('No checkout URL received from payment provider');
      }
    } catch (err) {
      console.error('Failed to create checkout session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create checkout session');
    } finally {
      setLoading(false);
    }
  };

  const handleTokenTopUp = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const amount = parseFloat(tokenAmount);
      
      // Validate token amount using client-side validation
      const tokenValidation = ClientInputValidator.validateTurboAmount(amount);
      if (!tokenValidation.isValid) {
        throw new Error(tokenValidation.error!);
      }

      const result = await window.electronAPI.turbo.topUpWithTokens(amount);
      console.log('Token top-up result:', result);
      
      // Refresh balance after successful top-up
      await loadTurboBalance();
      setSuccessMessage('Successfully converted AR to Turbo Credits!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Failed to top up with tokens:', err);
      setError(err instanceof Error ? err.message : 'Failed to top up with tokens');
    } finally {
      setLoading(false);
    }
  };

  const handleAutoTopUpSave = () => {
    // TODO: Save to config
    console.log('Auto top-up settings:', autoTopUp);
    setShowAutoTopUpSaved(true);
    setTimeout(() => setShowAutoTopUpSaved(false), 3000);
  };

  const formatCreditsUsage = (winc: string) => {
    const ar = parseFloat(winc) / 1e12;
    if (ar < 0.000001) return '< 0.000001 AR';
    return `${ar.toFixed(6)} AR`;
  };

  return (
    <div className="turbo-credits-manager fade-in">
      {/* Header */}
      <div className="tcm-header">
        <div className="tcm-header-content">
          <div className="tcm-header-title">
            <Zap size={24} className="tcm-header-icon" />
            <h1>Turbo Credits</h1>
            <InfoButton 
              tooltip="Turbo Credits provide instant uploads and better user experience. Files under 100KB are free!" 
              helpUrl="https://docs.ardrive.io/docs/turbo/what-is-turbo.html"
            />
          </div>
          <button className="tcm-close-btn" onClick={onClose}>
            ← Back to Dashboard
          </button>
        </div>
      </div>

      {/* Balance Card */}
      <TurboBalanceCard 
        balance={balance}
        loading={loading}
        fiatEstimate={fiatEstimate}
        onRefresh={loadTurboBalance}
      />

      {/* Tabs */}
      <div className="tcm-tabs">
        <button 
          className={`tcm-tab ${activeTab === 'purchase' ? 'active' : ''}`}
          onClick={() => setActiveTab('purchase')}
        >
          <CreditCard size={16} />
          Purchase
        </button>
        <button 
          className={`tcm-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={16} />
          Settings
        </button>
        <button 
          className={`tcm-tab ${activeTab === 'coming-soon' ? 'active' : ''}`}
          onClick={() => setActiveTab('coming-soon')}
        >
          <Gift size={16} />
          Coming Soon
        </button>
        <button 
          className={`tcm-tab ${activeTab === 'about' ? 'active' : ''}`}
          onClick={() => setActiveTab('about')}
        >
          <Info size={16} />
          About Turbo
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="tcm-error-message">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      
      {successMessage && (
        <div className="tcm-success-message">
          <Check size={16} />
          {successMessage}
        </div>
      )}

      {/* Tab Content */}
      <div className="tcm-content">
        {activeTab === 'purchase' && (
          <TurboPurchaseTab
            walletBalance={walletInfo.balance}
            topUpAmount={topUpAmount}
            setTopUpAmount={setTopUpAmount}
            topUpCurrency={topUpCurrency}
            setTopUpCurrency={setTopUpCurrency}
            tokenAmount={tokenAmount}
            setTokenAmount={setTokenAmount}
            loading={loading}
            calculateStorageAmount={calculateStorageAmount}
            handleFiatTopUp={handleFiatTopUp}
            handleTokenTopUp={handleTokenTopUp}
          />
        )}

        {activeTab === 'settings' && (
          <TurboSettingsTab
            autoTopUp={autoTopUp}
            setAutoTopUp={setAutoTopUp}
            showAutoTopUpSaved={showAutoTopUpSaved}
            handleAutoTopUpSave={handleAutoTopUpSave}
          />
        )}

        {activeTab === 'coming-soon' && (
          <TurboComingSoonTab />
        )}

        {activeTab === 'about' && (
          <TurboAboutTab />
        )}
      </div>
    </div>
  );
};

export default TurboCreditsManager;