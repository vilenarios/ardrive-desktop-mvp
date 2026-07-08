import React, { useState, useEffect, useRef } from 'react';
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

// FEAT-8: on-chain (SOL/ETH/AR) top-ups purchased on the ar.io Console have
// confirmation latency — the balance may not be credited by the time the user
// returns to the app. A single refresh-on-focus can fire too early and never
// re-fire. Instead, when the user returns we run a BOUNDED, self-terminating
// poll: re-check the balance a handful of times and stop the instant credits
// land (or after the cap, gently). Bounded work only — never an open loop.
const CRYPTO_BALANCE_POLL_INTERVAL_MS = 14000; // ~14s between balance checks
const CRYPTO_BALANCE_POLL_MAX_ATTEMPTS = 8; // ~8 checks (~2 min) then stop, gently

/**
 * True when `fetchedWinc` is strictly greater than `baselineWinc` (credits
 * landed). winc is an integer winston string; compare as BigInt for precision,
 * falling back to float for any unexpectedly non-integer value.
 */
const wincIncreased = (fetchedWinc: string, baselineWinc: string): boolean => {
  try {
    return BigInt(fetchedWinc) > BigInt(baselineWinc);
  } catch {
    const fetched = parseFloat(fetchedWinc);
    const baseline = parseFloat(baselineWinc);
    return Number.isFinite(fetched) && Number.isFinite(baseline) && fetched > baseline;
  }
};

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
  // FEAT-8: dedicated status region for the crypto-top-up return poll, kept
  // separate from `successMessage`/`error` (owned by the fiat + AR flows) so the
  // poll's honest, tone-aware copy never collides with those. `info` = neutral
  // (checking / no-credits-yet), `success` = credits actually landed.
  const [pollStatus, setPollStatus] = useState<{ tone: 'info' | 'success'; text: string } | null>(null);

  // FEAT-8: set when the user opens the ar.io Console crypto top-up in their
  // browser, so the window-focus handler only starts the balance poll when they
  // return from a top-up they actually initiated (a normal focus with no pending
  // top-up does nothing).
  const cryptoTopUpInitiatedRef = useRef(false);
  // FEAT-8: the Turbo balance (winc) at the moment a crypto top-up was
  // INITIATED — the "before" number the poll compares against to detect credits
  // landing. Null when the balance wasn't loaded yet at initiation time.
  const baselineWincRef = useRef<string | null>(null);
  // FEAT-8: poll lifecycle. `pollTimerRef` holds the pending setTimeout so it can
  // be cleared (success / cap / unmount / manual refresh); `pollRunningRef`
  // guards against stacking a second poll if the user re-focuses mid-poll;
  // `pollAttemptsRef` bounds the poll. `isMountedRef` blocks any setState from an
  // in-flight fetch that resolves after unmount.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRunningRef = useRef(false);
  const pollAttemptsRef = useRef(0);
  const isMountedRef = useRef(true);

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

  // FEAT-8: crypto top-up happens in the external ar.io Console (the browser),
  // so no payment-completed IPC ever fires here. When the user returns and the
  // app regains focus AFTER they initiated a crypto top-up, start a BOUNDED poll
  // (on-chain confirmation latency means a single refresh can fire before the
  // credits land and never re-fire). Gated on cryptoTopUpInitiatedRef so
  // ordinary focus changes don't touch the balance, and on pollRunningRef (inside
  // startBalancePoll) so re-focusing mid-poll never stacks a second poll.
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!cryptoTopUpInitiatedRef.current) return;
      cryptoTopUpInitiatedRef.current = false;
      console.log('Returned from ar.io Console — polling for new Turbo credits');
      startBalancePoll();
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);

  // FEAT-8: track mount status and guarantee the poll timer is cleared on
  // unmount — no leaked timer, no post-unmount setState.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopBalancePoll();
    };
  }, []);

  // Returns the freshly-fetched balance (or null on failure) so callers such as
  // the FEAT-8 crypto-top-up poll can compare it to a baseline without reading
  // stale React state. Guarded by isMountedRef so a fetch that resolves after
  // unmount never calls setState.
  const loadTurboBalance = async (): Promise<TurboBalance | null> => {
    try {
      setLoading(true);
      // UX-3: getBalance resolves an IpcResult; a business failure no longer
      // throws, so surface it explicitly (MONEY-13: never show a broken value).
      const result = await window.electronAPI.turbo.getBalance();
      if (!isMountedRef.current) return null;
      if (!result.success) {
        console.error('Failed to load Turbo balance:', result.error);
        setError('Failed to load Turbo Credits balance');
        return null;
      }
      setBalance(result.data);
      return result.data;
    } catch (err) {
      console.error('Failed to load Turbo balance:', err);
      if (isMountedRef.current) setError('Failed to load Turbo Credits balance');
      return null;
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  // FEAT-8: stop the crypto-top-up return poll and reset its lifecycle state.
  // Idempotent — safe to call on success, cap exhaustion, manual refresh and
  // unmount. Clears the pending timer so nothing fires after we stop.
  const stopBalancePoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollRunningRef.current = false;
    pollAttemptsRef.current = 0;
  };

  // FEAT-8: bounded, self-terminating balance poll started when the user returns
  // from an initiated crypto top-up. Re-checks the Turbo balance up to
  // CRYPTO_BALANCE_POLL_MAX_ATTEMPTS times (~14s apart) and STOPS the instant the
  // balance rises past the captured baseline (credits landed). Uses a recursive
  // setTimeout so a slow fetch can never overlap the next one. Never starts a
  // second poll while one is running (no stacked timers / no fetch spam).
  const startBalancePoll = () => {
    if (pollRunningRef.current) return; // guard: never stack a second poll
    pollRunningRef.current = true;
    pollAttemptsRef.current = 0;
    setError(null);
    setPollStatus({ tone: 'info', text: 'Checking for new credits from your ar.io Console top-up…' });

    const runAttempt = async () => {
      pollAttemptsRef.current += 1;
      const fetched = await loadTurboBalance();
      // Unmounted (or poll stopped) mid-fetch — bail without touching state/timers.
      if (!isMountedRef.current || !pollRunningRef.current) return;

      const baseline = baselineWincRef.current;
      const creditsLanded =
        fetched !== null && baseline !== null && wincIncreased(fetched.winc, baseline);

      if (creditsLanded) {
        stopBalancePoll();
        setPollStatus({ tone: 'success', text: 'Credits added! Your balance is up to date.' });
        setTimeout(() => { if (isMountedRef.current) setPollStatus(null); }, 6000);
        return;
      }

      if (pollAttemptsRef.current >= CRYPTO_BALANCE_POLL_MAX_ATTEMPTS) {
        stopBalancePoll();
        // Honest, gentle timeout copy — NOT an error, and it never implies the
        // top-up failed (it may simply still be confirming on-chain).
        setPollStatus({
          tone: 'info',
          text:
            'No new credits detected yet — if you completed your top-up, it may still be ' +
            'confirming. Click Refresh to check again.',
        });
        return;
      }

      // Schedule the next check (recursive setTimeout → never overlaps a fetch).
      pollTimerRef.current = setTimeout(runAttempt, CRYPTO_BALANCE_POLL_INTERVAL_MS);
    };

    // First check fires immediately on return, before the interval kicks in.
    runAttempt();
  };

  // FEAT-8: manual "Refresh balance" affordance — cancels any running poll and
  // forces an immediate fetch, so the button always reflects "check right now".
  const handleManualRefresh = () => {
    stopBalancePoll();
    return loadTurboBalance();
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

  // FEAT-8: Top up with crypto via the ar.io Console deep-link. The desktop app
  // has NO browser-wallet integration, so we NEVER handle a private key here —
  // we only pass the wallet's PUBLIC Arweave address as the credit destination.
  // The user pays on console.ar.io with their own Solana/Ethereum/Arweave
  // browser wallet; Turbo then credits this Arweave wallet.
  const handleCryptoTopUp = async () => {
    const address = walletInfo?.address?.trim();
    // Guard: never open a broken URL without a destination address (the button
    // is also disabled in this state — this is defence in depth).
    if (!address) {
      setError('Wallet address unavailable — cannot start a crypto top-up.');
      return;
    }

    setError(null);

    // CONTRACT (fixed — the console side reads exactly this):
    //   https://console.ar.io/topup?destinationAddress=<arweaveAddress>&source=ardrive-desktop
    // Only the PUBLIC Arweave address is ever placed in the URL — never a key.
    const url =
      'https://console.ar.io/topup?destinationAddress=' +
      encodeURIComponent(address) +
      '&source=ardrive-desktop';

    // Capture the "before" balance and remember we started a top-up, so the
    // window-focus handler can poll for the balance to rise past this baseline
    // (credits landing) when the user returns from the browser.
    baselineWincRef.current = balance?.winc ?? null;
    cryptoTopUpInitiatedRef.current = true;

    // D-005: shell:open-external resolves the IpcResult envelope.
    const result = await window.electronAPI.shell.openExternal(url);
    if (result && result.success === false) {
      cryptoTopUpInitiatedRef.current = false;
      baselineWincRef.current = null;
      setError(result.error || 'Failed to open ar.io Console in your browser');
      return;
    }

    setSuccessMessage(
      'Opened ar.io Console in your browser. Complete your top-up there, then ' +
        'return — your balance will refresh automatically.'
    );
    setTimeout(() => setSuccessMessage(null), 8000);
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
        onRefresh={handleManualRefresh}
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

      {/* FEAT-8: crypto-top-up poll status. Informational only — announced
          politely so it never interrupts. Neutral (info) while checking or when
          no credits have landed yet; positive (success) only when the balance
          actually rose. */}
      {pollStatus && (
        <div
          className={pollStatus.tone === 'success' ? 'tcm-success-message' : 'tcm-info-message'}
          role="status"
          aria-live="polite"
        >
          {pollStatus.tone === 'success' ? <Check size={16} /> : <Info size={16} />}
          {pollStatus.text}
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
            walletAddress={walletInfo.address}
            handleCryptoTopUp={handleCryptoTopUp}
            onRefreshBalance={handleManualRefresh}
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