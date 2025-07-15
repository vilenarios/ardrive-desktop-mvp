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
  RefreshCw,
  Shield,
  ChevronRight,
  Check,
  Users
} from 'lucide-react';
import { WalletInfo } from '../../types';
import { InfoButton } from './common/InfoButton';
import { ExpandableSection } from './common/ExpandableSection';
import { ClientInputValidator } from '../input-validator';

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

  // Calculate storage amount for AR amount
  const calculateStorageFromAR = (arAmount: number): string => {
    if (!fiatEstimate) return '~ GB';
    
    // Convert winston cost to AR cost for 1 GB
    const arCostPer1GB = parseFloat(fiatEstimate.winc) / 1e12;
    const totalGB = arAmount / arCostPer1GB;
    
    return formatStorageAmount(totalGB);
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

  // Quick buy options with dynamic storage calculations
  const quickBuyOptions = [
    { amount: 5, label: '$5', description: calculateStorageAmount(5) },
    { amount: 10, label: '$10', description: calculateStorageAmount(10) },
    { amount: 25, label: '$25', description: calculateStorageAmount(25) },
    { amount: 50, label: '$50', description: calculateStorageAmount(50) },
  ];

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

      {/* Compact Balance Card */}
      <div className="tcm-balance-card-compact">
        <div className="tcm-balance-main">
          <div className="tcm-balance-info">
            <div className="tcm-balance-label">Turbo Credits Balance</div>
            <div className="tcm-balance-value">
              <span className="tcm-balance-number">{balance ? balance.ar : '0.0000'}</span>
              <span className="tcm-balance-unit">AR</span>
            </div>
          </div>
          
          <div className="tcm-balance-stats">
            <div className="tcm-stat">
              <span className="label">Winston</span>
              <span className="value">{balance ? parseFloat(balance.winc).toLocaleString() : '0'}</span>
            </div>
            {fiatEstimate && balance && (
              <div className="tcm-stat">
                <span className="label">Est. Storage</span>
                <span className="value">{calculateStorageFromAR(parseFloat(balance.ar))}</span>
              </div>
            )}
          </div>
          
          <div className="tcm-balance-actions">
            <button className="tcm-refresh-compact" onClick={loadTurboBalance} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>
        
        {balance && parseFloat(balance.ar) < 0.1 && (
          <div className="tcm-low-balance-alert">
            <AlertCircle size={14} />
            <span>Low balance - top up to ensure uninterrupted uploads</span>
          </div>
        )}
      </div>

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
          <div className="tcm-purchase-tab">
            {/* Quick Buy Section */}
            <div className="tcm-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <h3>Quick Buy</h3>
                <InfoButton tooltip="Pre-calculated amounts for different storage needs. Choose based on how much you plan to upload." />
              </div>
              <div className="tcm-quick-buy-grid">
                {quickBuyOptions.map((option) => (
                  <button
                    key={option.amount}
                    className="tcm-quick-buy-option"
                    data-amount={option.amount}
                    onClick={() => handleFiatTopUp(option.amount)}
                    disabled={loading}
                  >
                    <div className="tcm-quick-buy-amount">{option.label}</div>
                    <div className="tcm-quick-buy-desc">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Amount Section */}
            <div className="tcm-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <h3>Custom Amount</h3>
                <InfoButton tooltip="Enter any amount in your preferred currency. You'll be redirected to a secure Stripe checkout page." />
              </div>
              <div className="tcm-custom-amount">
                <div className="tcm-input-group">
                  <div className="tcm-currency-select">
                    <select
                      value={topUpCurrency}
                      onChange={(e) => setTopUpCurrency(e.target.value)}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    className="tcm-amount-input"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    placeholder="Enter amount"
                    min="1"
                    step="0.01"
                  />
                  <button
                    className="tcm-purchase-btn"
                    onClick={() => handleFiatTopUp()}
                    disabled={loading}
                  >
                    {loading ? 'Processing...' : 'Purchase'}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="tcm-payment-info">
                  <Shield size={14} />
                  <span>Secure payment powered by Stripe</span>
                </div>
              </div>
            </div>

            {/* Convert AR Section */}
            <div className="tcm-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <h3>Convert AR to Credits</h3>
                <InfoButton tooltip="Convert your existing AR tokens to Turbo Credits. There's a conversion fee and it takes a few minutes to process." />
              </div>
              <div className="tcm-convert-section">
                <div className="tcm-convert-balance">
                  <span>Available AR Balance:</span>
                  <strong>{walletInfo.balance} AR</strong>
                </div>
                
                {/* Conversion Info Warning */}
                <div className="tcm-convert-warning">
                  <AlertCircle size={16} />
                  <div>
                    <strong>~23% conversion fee applies</strong>
                    <span className="tcm-warning-details">Processing takes 5-15 minutes • Credits are non-transferrable</span>
                  </div>
                </div>

                <div className="tcm-input-group">
                  <input
                    type="number"
                    className="tcm-amount-input"
                    value={tokenAmount}
                    onChange={(e) => setTokenAmount(e.target.value)}
                    placeholder="Amount to convert"
                    min="0.0001"
                    step="0.0001"
                  />
                  <span className="tcm-input-suffix">AR</span>
                  <button
                    className="tcm-convert-btn"
                    onClick={handleTokenTopUp}
                    disabled={loading}
                  >
                    Convert to Credits
                  </button>
                </div>
                
                {/* Conversion Calculator */}
                {tokenAmount && parseFloat(tokenAmount) > 0 && (
                  <div className="tcm-conversion-estimate">
                    <div className="tcm-estimate-row">
                      <span>AR Amount:</span>
                      <span>{parseFloat(tokenAmount).toFixed(4)} AR</span>
                    </div>
                    <div className="tcm-estimate-row">
                      <span>Est. Conversion Fee (~23%):</span>
                      <span>-{(parseFloat(tokenAmount) * 0.23).toFixed(4)} AR</span>
                    </div>
                    <div className="tcm-estimate-row tcm-estimate-total">
                      <span><strong>Est. Credits Received:</strong></span>
                      <span><strong>~{(parseFloat(tokenAmount) * 0.77).toFixed(4)} AR</strong></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tcm-settings-tab">
            {/* Auto Top-Up Section */}
            <div className="tcm-section">
              <div className="tcm-section-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <h3>Automatic Top-Up</h3>
                  <InfoButton tooltip="Automatically purchase more credits when your balance gets low. Requires setting up a payment method." />
                </div>
                <div className="tcm-beta-badge">Beta</div>
              </div>
              
              <div className="tcm-auto-topup-card">
                <div className="tcm-setting-row">
                  <div className="tcm-setting-info">
                    <label>Enable Auto Top-Up</label>
                    <p>Automatically purchase credits when balance is low</p>
                  </div>
                  <label className="tcm-toggle">
                    <input
                      type="checkbox"
                      checked={autoTopUp.enabled}
                      onChange={(e) => setAutoTopUp({ ...autoTopUp, enabled: e.target.checked })}
                    />
                    <span className="tcm-toggle-slider"></span>
                  </label>
                </div>

                {autoTopUp.enabled && (
                  <>
                    <div className="tcm-setting-row">
                      <div className="tcm-setting-info">
                        <label>Low Balance Threshold</label>
                        <p>Top up when balance falls below this amount</p>
                      </div>
                      <div className="tcm-setting-input">
                        <input
                          type="number"
                          value={autoTopUp.threshold}
                          onChange={(e) => setAutoTopUp({ ...autoTopUp, threshold: parseFloat(e.target.value) })}
                          min="0.01"
                          step="0.01"
                        />
                        <span>AR</span>
                      </div>
                    </div>

                    <div className="tcm-setting-row">
                      <div className="tcm-setting-info">
                        <label>Top-Up Amount</label>
                        <p>Amount to purchase when triggered</p>
                      </div>
                      <div className="tcm-setting-input">
                        <span>$</span>
                        <input
                          type="number"
                          value={autoTopUp.amount}
                          onChange={(e) => setAutoTopUp({ ...autoTopUp, amount: parseFloat(e.target.value) })}
                          min="5"
                          step="5"
                        />
                        <span>USD</span>
                      </div>
                    </div>

                    <div className="tcm-auto-topup-actions">
                      <button 
                        className="tcm-save-btn"
                        onClick={handleAutoTopUpSave}
                      >
                        Save Settings
                      </button>
                      {showAutoTopUpSaved && (
                        <span className="tcm-saved-indicator">
                          <Check size={16} />
                          Saved!
                        </span>
                      )}
                    </div>

                    <div className="tcm-auto-topup-info">
                      <Info size={14} />
                      <span>
                        Auto top-up will use your saved payment method. You'll receive an email notification for each automatic purchase.
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Usage Stats */}
            <div className="tcm-section">
              <h3>Usage Statistics</h3>
              <div className="tcm-stats-grid">
                <div className="tcm-stat-card">
                  <TrendingUp size={20} className="tcm-stat-icon" />
                  <div className="tcm-stat-value">0</div>
                  <div className="tcm-stat-label">Files Uploaded</div>
                </div>
                <div className="tcm-stat-card">
                  <DollarSign size={20} className="tcm-stat-icon" />
                  <div className="tcm-stat-value">0 AR</div>
                  <div className="tcm-stat-label">Credits Used</div>
                </div>
                <div className="tcm-stat-card">
                  <Zap size={20} className="tcm-stat-icon" />
                  <div className="tcm-stat-value">0 GB</div>
                  <div className="tcm-stat-label">Data Stored</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'coming-soon' && (
          <div className="tcm-coming-soon-tab">
            <div className="tcm-section">
              <div className="tcm-section-header">
                <h3>Exciting Features Coming Soon</h3>
                <div className="tcm-beta-badge">Roadmap</div>
              </div>
              
              <div className="tcm-feature-card tcm-coming-soon">
                <div className="tcm-feature-icon">
                  <Gift size={24} />
                </div>
                <div className="tcm-feature-content">
                  <h4>Gift Turbo Credits</h4>
                  <p>Send credits to friends, family, and colleagues with a personalized message. The perfect way to introduce someone to permanent storage on Arweave without the complexity.</p>
                  <div className="tcm-coming-soon-badge">Coming Soon</div>
                </div>
              </div>

              <div className="tcm-feature-card tcm-coming-soon">
                <div className="tcm-feature-icon">
                  <Share2 size={24} />
                </div>
                <div className="tcm-feature-content">
                  <h4>Shared Credit Pools</h4>
                  <p>Create team credit pools with spending limits, usage analytics, and role-based permissions. Perfect for organizations, DAOs, and collaborative projects.</p>
                  <div className="tcm-coming-soon-badge">Coming Soon</div>
                </div>
              </div>
              
              <div className="tcm-roadmap-note">
                <p>📧 Want to be notified when these features launch? Email us at <strong>support@ardrive.io</strong> to join our early access list!</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="tcm-about-tab">
            {/* Hero Section */}
            <div className="tcm-section">
              <div className="tcm-about-hero">
                <div className="tcm-about-hero-content">
                  <h2>Why Turbo Credits?</h2>
                  <p className="tcm-about-subtitle">The easiest way to store files permanently on Arweave with instant uploads, predictable pricing, and enterprise-grade reliability.</p>
                </div>
                <div className="tcm-turbo-badge">Recommended</div>
              </div>
            </div>
            
            {/* Key Benefits */}
            <div className="tcm-section">
              <ExpandableSection 
                title="Key Benefits" 
                summary="Learn why Turbo Credits offer the best file storage experience"
                variant="bordered"
                defaultExpanded={true}
              >
                <div className="tcm-benefits-grid">
                <div className="tcm-benefit-card tcm-benefit-primary">
                  <div className="tcm-benefit-icon">
                    <Zap size={24} />
                  </div>
                  <h4>Lightning Fast</h4>
                  <p>Upload files and see them instantly on Arweave. No more waiting 10-60 minutes for blockchain confirmation. Your files are accessible immediately while still getting permanent storage.</p>
                </div>
                
                <div className="tcm-benefit-card">
                  <div className="tcm-benefit-icon">
                    <DollarSign size={24} />
                  </div>
                  <h4>Transparent Pricing</h4>
                  <p>Pay in your local currency with credit cards. Bulk purchasing provides better rates than individual AR transactions, plus you avoid crypto volatility and gas fees.</p>
                </div>
                
                <div className="tcm-benefit-card">
                  <div className="tcm-benefit-icon">
                    <Gift size={24} />
                  </div>
                  <h4>Free Tier Included</h4>
                  <p>Files under 100KB are completely free. This covers most documents, photos, and metadata - perfect for getting started without any upfront costs.</p>
                </div>
                
                <div className="tcm-benefit-card">
                  <div className="tcm-benefit-icon">
                    <Shield size={24} />
                  </div>
                  <h4>Same Permanence Guarantee</h4>
                  <p>Your data gets identical permanence as traditional Arweave uploads. 200+ years of storage with redundancy across thousands of nodes worldwide.</p>
                </div>
                
                <div className="tcm-benefit-card">
                  <div className="tcm-benefit-icon">
                    <TrendingUp size={24} />
                  </div>
                  <h4>Economies of Scale</h4>
                  <p>Turbo pools uploads from thousands of users to get better Arweave rates. You benefit from enterprise-level pricing without enterprise-level complexity.</p>
                </div>
                
                <div className="tcm-benefit-card">
                  <div className="tcm-benefit-icon">
                    <Users size={24} />
                  </div>
                  <h4>Enterprise Ready</h4>
                  <p>Built-in compliance features, audit trails, and team management. Scale from personal use to enterprise deployments with the same simple interface.</p>
                </div>
              </div>
              </ExpandableSection>
            </div>

            {/* Detailed Comparison */}
            <div className="tcm-section">
              <ExpandableSection 
                title="Turbo vs Traditional Arweave" 
                summary="Compare upload methods and choose what's best for you"
                variant="bordered"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  <InfoButton tooltip="Turbo Credits offer instant uploads and easier payments, while traditional AR tokens provide direct blockchain interaction." />
                </div>
              <div className="tcm-comparison-table">
                <div className="tcm-comparison-header">
                  <div>Feature</div>
                  <div>Traditional AR Tokens</div>
                  <div>Turbo Credits</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Upload Speed</div>
                  <div>⏳ 10-60 minutes</div>
                  <div>⚡ Instant</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Payment Options</div>
                  <div>🪙 AR tokens only</div>
                  <div>💳 Credit card + AR tokens</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Small Files (&lt; 100KB)</div>
                  <div>💰 Costs AR</div>
                  <div>🆓 Completely free</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Price Volatility</div>
                  <div>📈 Fluctuates with AR price</div>
                  <div>📊 Fixed fiat pricing</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Bulk Discounts</div>
                  <div>❌ Pay per transaction</div>
                  <div>✅ Economies of scale</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Setup Complexity</div>
                  <div>🔧 Manage AR wallet</div>
                  <div>🎯 Just works</div>
                </div>
                
                <div className="tcm-comparison-row">
                  <div>Data Permanence</div>
                  <div>✅ 200+ years</div>
                  <div>✅ 200+ years</div>
                </div>
              </div>
              </ExpandableSection>
            </div>
            
            {/* Economic Benefits */}
            <div className="tcm-section">
              <div className="tcm-economics-card">
                <h3>💡 Smart Economics</h3>
                <div className="tcm-economics-content">
                  <div className="tcm-economics-point">
                    <strong>Bulk Purchasing Power:</strong> Turbo aggregates demand from thousands of users to negotiate better Arweave storage rates, passing savings directly to you.
                  </div>
                  <div className="tcm-economics-point">
                    <strong>Reduced Transaction Costs:</strong> Instead of paying Arweave network fees for each upload, you pay once when purchasing credits.
                  </div>
                  <div className="tcm-economics-point">
                    <strong>Predictable Budgeting:</strong> Lock in storage costs in your local currency without worrying about AR token price swings.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .turbo-credits-manager {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--gray-50);
        }

        /* Header */
        .tcm-header {
          background: white;
          border-bottom: 1px solid var(--gray-200);
          padding: var(--space-5) var(--space-6);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .tcm-header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .tcm-header-title {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .tcm-header-title h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .tcm-header-icon {
          color: var(--ardrive-warning);
        }

        .tcm-close-btn {
          padding: var(--space-2) var(--space-4);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius);
          color: var(--gray-700);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tcm-close-btn:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
        }

        /* Compact Balance Card */
        .tcm-balance-card-compact {
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin: var(--space-4) var(--space-6);
        }
        
        .tcm-balance-main {
          display: flex;
          align-items: center;
          gap: var(--space-6);
        }
        
        .tcm-balance-info {
          flex: 0 0 auto;
        }
        
        .tcm-balance-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--gray-500);
          letter-spacing: 0.5px;
          margin-bottom: var(--space-1);
        }
        
        .tcm-balance-value {
          display: flex;
          align-items: baseline;
          gap: var(--space-2);
        }
        
        .tcm-balance-number {
          font-size: 28px;
          font-weight: 700;
          color: var(--gray-900);
          line-height: 1;
        }
        
        .tcm-balance-unit {
          font-size: 14px;
          font-weight: 500;
          color: var(--gray-600);
        }
        
        .tcm-balance-stats {
          flex: 1;
          display: flex;
          gap: var(--space-6);
          padding-left: var(--space-6);
          border-left: 1px solid var(--gray-200);
        }
        
        .tcm-stat {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }
        
        .tcm-stat .label {
          font-size: 11px;
          font-weight: 500;
          text-transform: uppercase;
          color: var(--gray-500);
          letter-spacing: 0.5px;
        }
        
        .tcm-stat .value {
          font-size: 14px;
          font-weight: 600;
          color: var(--gray-900);
        }
        
        .tcm-balance-actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }
        
        .tcm-refresh-compact {
          width: 32px;
          height: 32px;
          background: var(--gray-100);
          border: 1px solid var(--gray-200);
          border-radius: var(--radius);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
          color: var(--gray-600);
        }
        
        .tcm-refresh-compact:hover {
          background: var(--gray-200);
          color: var(--gray-700);
        }
        
        .tcm-refresh-compact:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .tcm-refresh-compact svg.spinning {
          animation: spin 1s linear infinite;
        }
        
        .tcm-low-balance-alert {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-3);
          padding: var(--space-2) var(--space-3);
          background: var(--warning-50);
          border-radius: var(--radius);
          font-size: 13px;
          color: var(--warning-700);
        }

        /* Tabs */
        .tcm-tabs {
          display: flex;
          gap: var(--space-2);
          padding: 0 var(--space-6);
          margin-bottom: var(--space-4);
        }

        .tcm-tab {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius);
          color: var(--gray-700);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tcm-tab:hover {
          background: var(--gray-50);
          border-color: var(--gray-400);
        }

        .tcm-tab.active {
          background: var(--ardrive-primary);
          color: white;
          border-color: var(--ardrive-primary);
        }

        .tcm-tab svg {
          width: 16px;
          height: 16px;
        }

        /* Content */
        .tcm-content {
          flex: 1;
          padding: 0 var(--space-6) var(--space-6);
          overflow-y: auto;
        }

        /* Messages */
        .tcm-error-message,
        .tcm-success-message {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3);
          margin: 0 var(--space-6) var(--space-4);
          border-radius: var(--radius);
          font-size: 14px;
        }

        .tcm-error-message {
          background: var(--danger-50);
          color: var(--danger-700);
          border: 1px solid var(--danger-200);
        }

        .tcm-success-message {
          background: var(--success-50);
          color: var(--success-700);
          border: 1px solid var(--success-200);
        }

        /* Sections */
        .tcm-section {
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg);
          padding: var(--space-5);
          margin-bottom: var(--space-4);
        }

        .tcm-section h3 {
          margin: 0 0 var(--space-4) 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .tcm-section-header {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }

        .tcm-section-header h3 {
          margin: 0;
        }

        .tcm-beta-badge {
          padding: var(--space-1) var(--space-2);
          background: var(--info-100);
          color: var(--info-700);
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        /* Quick Buy Grid */
        .tcm-quick-buy-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--space-3);
        }

        .tcm-quick-buy-option {
          padding: var(--space-4);
          background: white;
          border: 2px solid var(--gray-200);
          border-radius: var(--radius-md);
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .tcm-quick-buy-option:hover {
          background: var(--ardrive-primary-light);
          border-color: var(--ardrive-primary);
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
        }
        
        /* Highlight most popular option */
        .tcm-quick-buy-option[data-amount="25"]::before {
          content: "Most Popular";
          position: absolute;
          top: -10px;
          right: 10px;
          background: var(--ardrive-primary);
          color: white;
          font-size: 10px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;
          text-transform: uppercase;
        }

        .tcm-quick-buy-option:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .tcm-quick-buy-amount {
          font-size: 24px;
          font-weight: 700;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
        }

        .tcm-quick-buy-desc {
          font-size: 12px;
          color: var(--gray-600);
        }

        /* Custom Amount */
        .tcm-custom-amount {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .tcm-input-group {
          display: flex;
          gap: var(--space-2);
          align-items: center;
        }

        .tcm-currency-select select {
          padding: var(--space-3);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .tcm-amount-input {
          flex: 1;
          padding: var(--space-3);
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: var(--radius);
          font-size: 16px;
          font-weight: 500;
        }

        .tcm-amount-input:focus {
          outline: none;
          border-color: var(--ardrive-primary);
          box-shadow: 0 0 0 3px var(--ardrive-primary-light);
        }

        .tcm-input-suffix {
          font-size: 14px;
          font-weight: 500;
          color: var(--gray-600);
        }

        .tcm-purchase-btn {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-5);
          background: var(--ardrive-primary);
          color: white;
          border: none;
          border-radius: var(--radius);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tcm-purchase-btn:hover {
          background: var(--ardrive-primary-hover);
          transform: translateY(-1px);
          box-shadow: var(--shadow-md);
        }

        .tcm-purchase-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .tcm-payment-info {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: 12px;
          color: var(--gray-600);
        }

        .tcm-payment-info svg {
          color: var(--success-600);
        }

        /* Convert Section */
        .tcm-convert-section {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .tcm-convert-balance {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-3);
          background: var(--gray-50);
          border-radius: var(--radius);
          font-size: 14px;
        }

        .tcm-convert-btn {
          padding: var(--space-3) var(--space-4);
          background: var(--gray-700);
          color: white;
          border: none;
          border-radius: var(--radius);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tcm-convert-btn:hover {
          background: var(--gray-800);
        }

        .tcm-convert-info {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: 12px;
          color: var(--gray-600);
        }

        /* Settings Tab */
        .tcm-auto-topup-card {
          background: var(--gray-50);
          border-radius: var(--radius-md);
          padding: var(--space-4);
        }

        .tcm-setting-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--gray-200);
        }

        .tcm-setting-row:last-child {
          border-bottom: none;
        }

        .tcm-setting-info {
          flex: 1;
        }

        .tcm-setting-info label {
          display: block;
          font-weight: 500;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
        }

        .tcm-setting-info p {
          margin: 0;
          font-size: 13px;
          color: var(--gray-600);
        }

        .tcm-setting-input {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        .tcm-setting-input input {
          width: 80px;
          padding: var(--space-2);
          border: 1px solid var(--gray-300);
          border-radius: var(--radius-sm);
          text-align: right;
          font-size: 14px;
        }

        .tcm-setting-input span {
          font-size: 14px;
          color: var(--gray-600);
        }

        /* Toggle Switch */
        .tcm-toggle {
          position: relative;
          display: inline-block;
          width: 48px;
          height: 24px;
        }

        .tcm-toggle input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .tcm-toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--gray-300);
          transition: .4s;
          border-radius: 24px;
        }

        .tcm-toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }

        .tcm-toggle input:checked + .tcm-toggle-slider {
          background-color: var(--ardrive-primary);
        }

        .tcm-toggle input:checked + .tcm-toggle-slider:before {
          transform: translateX(24px);
        }

        .tcm-auto-topup-actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-top: var(--space-4);
          padding-top: var(--space-4);
          border-top: 1px solid var(--gray-200);
        }

        .tcm-save-btn {
          padding: var(--space-2) var(--space-4);
          background: var(--ardrive-primary);
          color: white;
          border: none;
          border-radius: var(--radius);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tcm-save-btn:hover {
          background: var(--ardrive-primary-hover);
        }

        .tcm-saved-indicator {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          color: var(--success-600);
          font-size: 14px;
          font-weight: 500;
        }

        .tcm-auto-topup-info {
          display: flex;
          align-items: flex-start;
          gap: var(--space-2);
          margin-top: var(--space-3);
          padding: var(--space-3);
          background: var(--info-50);
          border-radius: var(--radius);
          font-size: 13px;
          color: var(--info-700);
        }

        .tcm-auto-topup-info svg {
          flex-shrink: 0;
          margin-top: 2px;
        }

        /* Stats Grid */
        .tcm-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: var(--space-3);
        }

        .tcm-stat-card {
          padding: var(--space-4);
          background: var(--gray-50);
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-md);
          text-align: center;
        }

        .tcm-stat-icon {
          color: var(--ardrive-primary);
          margin-bottom: var(--space-2);
        }

        .tcm-stat-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--gray-900);
          margin-bottom: var(--space-1);
        }

        .tcm-stat-label {
          font-size: 12px;
          color: var(--gray-600);
          font-weight: 500;
        }

        /* Feature Cards */
        .tcm-feature-card {
          display: flex;
          gap: var(--space-4);
          padding: var(--space-4);
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-3);
          transition: all 0.2s ease;
        }

        .tcm-feature-card.tcm-coming-soon {
          opacity: 0.7;
          background: var(--gray-50);
        }

        .tcm-feature-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          background: var(--gray-100);
          border-radius: var(--radius-md);
          flex-shrink: 0;
        }

        .tcm-feature-card.tcm-coming-soon .tcm-feature-icon {
          background: var(--gray-200);
          color: var(--gray-500);
        }

        .tcm-feature-content {
          flex: 1;
        }

        .tcm-feature-content h4 {
          margin: 0 0 var(--space-1) 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .tcm-feature-content p {
          margin: 0;
          font-size: 14px;
          color: var(--gray-600);
          line-height: 1.5;
        }

        .tcm-coming-soon-badge {
          display: inline-block;
          margin-top: var(--space-2);
          padding: var(--space-1) var(--space-3);
          background: var(--gray-200);
          color: var(--gray-700);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
        }

        /* Info Card */
        .tcm-info-card {
          background: var(--gray-50);
          border-radius: var(--radius-md);
          padding: var(--space-4);
        }

        .tcm-info-item {
          display: flex;
          gap: var(--space-3);
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--gray-200);
        }

        .tcm-info-item:last-child {
          border-bottom: none;
        }

        .tcm-info-item svg {
          color: var(--ardrive-primary);
          flex-shrink: 0;
        }

        .tcm-info-item strong {
          display: block;
          margin-bottom: var(--space-1);
          color: var(--gray-900);
        }

        .tcm-info-item p {
          margin: 0;
          font-size: 13px;
          color: var(--gray-600);
        }

        /* Convert Warning Styles */
        .tcm-convert-warning {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3);
          background: var(--warning-50);
          border: 1px solid var(--warning-200);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-4);
          color: var(--warning-800);
          font-size: 13px;
        }

        .tcm-convert-warning svg {
          color: var(--warning-600);
          flex-shrink: 0;
        }
        
        .tcm-convert-warning strong {
          display: block;
          font-weight: 600;
          margin-bottom: 2px;
        }
        
        .tcm-warning-details {
          display: block;
          font-size: 12px;
          color: var(--warning-700);
        }

        .tcm-conversion-estimate {
          margin-top: var(--space-3);
          padding: var(--space-3);
          background: var(--gray-50);
          border-radius: var(--radius-md);
          border: 1px solid var(--gray-200);
        }

        .tcm-estimate-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--space-1) 0;
          font-size: 14px;
        }

        .tcm-estimate-total {
          border-top: 1px solid var(--gray-300);
          margin-top: var(--space-2);
          padding-top: var(--space-2);
          color: var(--gray-900);
        }

        /* Turbo Benefits Styles */
        .tcm-turbo-badge {
          padding: var(--space-1) var(--space-3);
          background: var(--success-100);
          color: var(--success-700);
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .tcm-benefits-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: var(--space-4);
          margin-bottom: var(--space-6);
        }

        .tcm-benefit-card {
          padding: var(--space-4);
          background: white;
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-md);
          text-align: center;
          transition: all 0.2s ease;
        }

        .tcm-benefit-card.tcm-benefit-primary {
          background: linear-gradient(135deg, var(--ardrive-primary) 0%, var(--ardrive-primary-hover) 100%);
          color: white;
          border-color: var(--ardrive-primary);
        }

        .tcm-benefit-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-lg);
        }

        .tcm-benefit-card.tcm-benefit-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 25px rgba(0, 123, 255, 0.3);
        }

        .tcm-benefit-icon {
          width: 48px;
          height: 48px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-3);
          color: var(--ardrive-primary);
        }

        .tcm-benefit-card.tcm-benefit-primary .tcm-benefit-icon {
          background: rgba(255, 255, 255, 0.2);
          color: white;
        }

        .tcm-benefit-card h4 {
          margin: 0 0 var(--space-2) 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .tcm-benefit-card.tcm-benefit-primary h4 {
          color: white;
        }

        .tcm-benefit-card p {
          margin: 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--gray-600);
        }

        .tcm-benefit-card.tcm-benefit-primary p {
          color: rgba(255, 255, 255, 0.9);
        }

        /* Comparison Table Styles */
        .tcm-comparison-section {
          margin-top: var(--space-6);
          padding-top: var(--space-6);
          border-top: 1px solid var(--gray-200);
        }

        .tcm-comparison-section h4 {
          margin: 0 0 var(--space-4) 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .tcm-comparison-table {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 1px;
          background: var(--gray-200);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        .tcm-comparison-header {
          display: contents;
        }

        .tcm-comparison-header > div {
          padding: var(--space-3);
          background: var(--gray-100);
          font-weight: 600;
          font-size: 14px;
          color: var(--gray-900);
          text-align: center;
        }

        .tcm-comparison-header > div:first-child {
          text-align: left;
        }

        .tcm-comparison-row {
          display: contents;
        }

        .tcm-comparison-row > div {
          padding: var(--space-3);
          background: white;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tcm-comparison-row > div:first-child {
          font-weight: 500;
          color: var(--gray-900);
          justify-content: flex-start;
        }

        .tcm-comparison-row > div:last-child {
          color: var(--success-700);
          font-weight: 500;
        }

        /* About Tab Styles */
        .tcm-about-hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: var(--space-6);
          background: linear-gradient(135deg, var(--ardrive-primary-light) 0%, var(--gray-50) 100%);
          border-radius: var(--radius-lg);
          border: 1px solid var(--ardrive-primary);
          margin-bottom: var(--space-6);
        }

        .tcm-about-hero-content h2 {
          font-size: 24px;
          font-weight: 700;
          margin-bottom: var(--space-2);
          color: var(--gray-900);
        }

        .tcm-about-subtitle {
          font-size: 16px;
          line-height: 1.6;
          color: var(--gray-700);
          margin: 0;
          max-width: 500px;
        }

        .tcm-economics-card {
          background: linear-gradient(135deg, #f8faff 0%, #e8f4ff 100%);
          border: 1px solid var(--info-200);
          border-radius: var(--radius-lg);
          padding: var(--space-6);
          margin-top: var(--space-6);
        }

        .tcm-economics-card h3 {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: var(--space-4);
          color: var(--gray-900);
        }

        .tcm-economics-content {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .tcm-economics-point {
          font-size: 14px;
          line-height: 1.6;
          color: var(--gray-700);
        }

        .tcm-economics-point strong {
          color: var(--gray-900);
          font-weight: 600;
        }

        /* Coming Soon Tab Styles */
        .tcm-roadmap-note {
          background: var(--gray-50);
          border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg);
          padding: var(--space-4);
          margin-top: var(--space-6);
          text-align: center;
        }

        .tcm-roadmap-note p {
          margin: 0;
          font-size: 14px;
          line-height: 1.6;
          color: var(--gray-700);
        }

        .tcm-roadmap-note strong {
          color: var(--ardrive-primary);
          font-weight: 600;
        }

        /* Enhanced Comparison Table */
        .tcm-comparison-table {
          margin-top: var(--space-4);
        }

        .tcm-comparison-header {
          font-weight: 600;
          background: var(--gray-100);
        }

        .tcm-comparison-header div:first-child {
          color: var(--gray-900);
        }

        .tcm-comparison-row div:nth-child(2) {
          color: var(--gray-600);
        }

        .tcm-comparison-row div:nth-child(3) {
          color: var(--success-700);
          font-weight: 500;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default TurboCreditsManager;