import React from 'react';
import { ArrowRight, AlertCircle, Shield, ExternalLink, Zap, RefreshCw } from 'lucide-react';
import { InfoButton } from '../common/InfoButton';

interface TurboPurchaseTabProps {
  walletBalance: string;
  topUpAmount: string;
  setTopUpAmount: (amount: string) => void;
  topUpCurrency: string;
  setTopUpCurrency: (currency: string) => void;
  tokenAmount: string;
  setTokenAmount: (amount: string) => void;
  loading: boolean;
  calculateStorageAmount: (dollarAmount: number) => string;
  handleFiatTopUp: (amount?: number) => void;
  handleTokenTopUp: () => void;
  // FEAT-8: crypto top-up via ar.io Console deep-link. walletAddress is the
  // PUBLIC Arweave address used as the credit destination (never a key). The
  // crypto button is disabled when it is empty/unavailable.
  walletAddress?: string;
  handleCryptoTopUp: () => void;
  onRefreshBalance: () => void;
}

const TurboPurchaseTab: React.FC<TurboPurchaseTabProps> = ({
  walletBalance,
  topUpAmount,
  setTopUpAmount,
  topUpCurrency,
  setTopUpCurrency,
  tokenAmount,
  setTokenAmount,
  loading,
  calculateStorageAmount,
  handleFiatTopUp,
  handleTokenTopUp,
  walletAddress,
  handleCryptoTopUp,
  onRefreshBalance
}) => {
  // FEAT-8: guard — no destination address means we cannot build a valid
  // deep-link, so disable the crypto top-up rather than open a broken URL.
  const hasWalletAddress = !!walletAddress && walletAddress.trim().length > 0;

  const quickBuyOptions = [
    { amount: 5, label: '$5', description: calculateStorageAmount(5) },
    { amount: 10, label: '$10', description: calculateStorageAmount(10) },
    { amount: 25, label: '$25', description: calculateStorageAmount(25) },
    { amount: 50, label: '$50', description: calculateStorageAmount(50) },
  ];

  return (
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
                aria-label="Currency"
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

      {/* Crypto Top-up Section (FEAT-8) — a DIFFERENT payment rail from the
          card checkout above: the user pays on ar.io Console with their own
          browser wallet. The desktop app never handles a private key. */}
      <div className="tcm-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <h3>Top up with crypto</h3>
          <InfoButton tooltip="A separate payment rail from the card checkout above. Pay from a Solana, Ethereum, or Arweave browser wallet on ar.io Console — no card needed. Credits are added to your ArDrive (Arweave) wallet." />
        </div>
        <div className="tcm-crypto-section">
          <p className="tcm-crypto-copy">
            Pay with your Solana, Ethereum, or Arweave wallet via ar.io Console
            (opens in your browser). Credits are added to your ArDrive account —
            we never see your keys.
          </p>

          <button
            type="button"
            className="tcm-crypto-btn"
            onClick={handleCryptoTopUp}
            disabled={!hasWalletAddress}
            aria-label="Top up with crypto on ar.io Console (opens in your browser)"
            title={hasWalletAddress ? 'Opens ar.io Console in your browser' : 'Wallet address unavailable'}
          >
            <Zap size={16} aria-hidden="true" />
            <span>Top up with crypto (Solana / Ethereum / Arweave)</span>
            <ExternalLink size={16} aria-hidden="true" />
          </button>

          {!hasWalletAddress && (
            <div className="tcm-crypto-unavailable" role="status">
              <AlertCircle size={14} />
              <span>Wallet address unavailable — reopen Turbo Credits once your wallet has loaded.</span>
            </div>
          )}

          <button
            type="button"
            className="tcm-crypto-refresh"
            onClick={onRefreshBalance}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} aria-hidden="true" />
            <span>Refresh balance</span>
          </button>

          <div className="tcm-payment-info">
            <Shield size={14} />
            <span>Opens ar.io Console in your browser — your keys never leave your wallet.</span>
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
            {/* MONEY-13: walletBalance can be '' (fetch unavailable, e.g. a
                gateway 429) or a stale non-numeric value - never render "NaN" */}
            <strong>
              {walletBalance === '' || isNaN(parseFloat(walletBalance)) ? 'Unavailable' : `${walletBalance} AR`}
            </strong>
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
  );
};

export default TurboPurchaseTab;