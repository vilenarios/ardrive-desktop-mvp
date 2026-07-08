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
import { TURBO_FREE_SIZE_LIMIT } from '../../utils/turbo-utils';
import TurboComingSoonTab from './turbo/TurboComingSoonTab';

interface TurboCreditsManagerProps {
  walletInfo: WalletInfo;
  onClose: () => void;
  // MONEY-6: return-value-based wallet refresh supplied by App via Dashboard;
  // called on payment completion so App's walletInfo updates even though its
  // wallet-info-updated event listener may already be dead (UX-4 clobber).
  onWalletRefresh?: () => void | Promise<void>;
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

const TurboCreditsManager: React.FC<TurboCreditsManagerProps> = ({ walletInfo, onClose, onWalletRefresh }) => {
  const [balance, setBalance] = useState<TurboBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<string>('10');
  const [topUpCurrency, setTopUpCurrency] = useState<string>('USD');
  const [tokenAmount, setTokenAmount] = useState<string>('0.001');
  const [fiatEstimate, setFiatEstimate] = useState<FiatEstimate | null>(null);
  const [activeTab, setActiveTab] = useState<'purchase' | 'settings' | 'coming-soon' | 'about'>('purchase');

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
    
    // Listen for wallet info updates (e.g., after returning from payment).
    // UX-4: 'wallet-info-updated' is shared with App — capture the scoped
    // disposer so this component's cleanup removes ONLY its own handler and no
    // longer clobbers App's listener for the session.
    const disposeWalletInfo = window.electronAPI.onWalletInfoUpdated((updatedWalletInfo) => {
      console.log('Wallet info updated, refreshing Turbo balance...');
      setSuccessMessage('Payment successful! Your Turbo Credits balance has been updated.');
      setTimeout(() => setSuccessMessage(null), 5000);
      loadTurboBalance();
    });

    // Listen for payment completion
    const disposePaymentCompleted = window.electronAPI.payment.onPaymentCompleted(() => {
      console.log('Payment completed, refreshing balance...');
      setSuccessMessage('Payment successful! Your Turbo Credits balance is being updated...');
      setTimeout(() => setSuccessMessage(null), 5000);

      // MONEY-6: also push the fresh balance up to App by return value —
      // App's wallet-info-updated listener cannot be relied on (UX-4).
      onWalletRefresh?.();

      // Refresh balance after a short delay
      setTimeout(() => {
        loadTurboBalance();
      }, 2000);
    });

    // MONEY-7: listen for the user closing the payment window without
    // completing checkout — exactly one of completed/cancelled ever fires.
    const disposePaymentCancelled = window.electronAPI.payment.onPaymentCancelled(() => {
      console.log('Payment window closed without completing.');
      setError(null);
      setSuccessMessage('Payment window closed. No charge was made.');
      setTimeout(() => setSuccessMessage(null), 5000);
    });

    // Cleanup listeners on unmount (UX-4: scoped disposers, no removeAll*).
    return () => {
      disposeWalletInfo?.();
      disposePaymentCompleted?.();
      disposePaymentCancelled?.();
    };
  }, []);

  const loadTurboBalance = async () => {
    try {
      setLoading(true);
      // UX-3: getBalance resolves an IpcResult; a business failure no longer
      // throws, so surface it explicitly (MONEY-13: never show a broken value).
      const result = await window.electronAPI.turbo.getBalance();
      if (!result.success) {
        console.error('Failed to load Turbo balance:', result.error);
        setError('Failed to load Turbo Credits balance');
        return;
      }
      setBalance(result.data);
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
      const result = await window.electronAPI.turbo.getFiatEstimate(1024 * 1024 * 1024, 'usd');
      if (result.success) {
        setFiatEstimate(result.data);
      }
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

      // UX-3: createCheckoutSession resolves an IpcResult; a failed session no
      // longer throws, so surface it explicitly before opening the window.
      const sessionResult = await window.electronAPI.turbo.createCheckoutSession(finalAmount, topUpCurrency);
      if (!sessionResult.success) {
        throw new Error(sessionResult.error || 'Failed to create checkout session');
      }
      const session = sessionResult.data;

      if (session.url) {
        // Open payment in modal window (MONEY-7: returns an envelope)
        const openResult = await window.electronAPI.payment.openWindow(session.url);
        if (openResult.success === false) {
          throw new Error(openResult.error || 'Failed to open payment window');
        }
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

      // UX-3: topUpWithTokens resolves an IpcResult; a failed conversion no
      // longer throws, so surface it (this spends AR — the user must be told).
      const result = await window.electronAPI.turbo.topUpWithTokens(amount);
      if (!result.success) {
        throw new Error(result.error || 'Failed to top up with tokens');
      }
      console.log('Token top-up result:', result.data);

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
              tooltip={`Turbo Credits provide instant uploads and better user experience. Files up to ${TURBO_FREE_SIZE_LIMIT / 1024} KiB are free!`}
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
          <TurboSettingsTab />
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