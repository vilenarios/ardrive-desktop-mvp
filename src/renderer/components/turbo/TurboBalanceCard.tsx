import React from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { InfoButton } from '../common/InfoButton';

interface TurboBalanceCardProps {
  balance: {
    winc: string;
    ar: string;
  } | null;
  loading: boolean;
  fiatEstimate?: {
    byteCount: number;
    amount: number;
    currency: string;
    winc: string;
  } | null;
  onRefresh: () => void;
}

const TurboBalanceCard: React.FC<TurboBalanceCardProps> = ({ 
  balance, 
  loading, 
  fiatEstimate, 
  onRefresh 
}) => {
  const calculateStorageFromAR = (arAmount: number): string => {
    if (!fiatEstimate) return '~ GB';
    
    const arCostPer1GB = parseFloat(fiatEstimate.winc) / 1e12;
    const totalGB = arAmount / arCostPer1GB;
    
    if (totalGB >= 1000) {
      return `~${(totalGB / 1000).toFixed(1)} TB`;
    } else if (totalGB >= 1) {
      return `~${Math.round(totalGB)} GB`;
    } else {
      return `~${Math.round(totalGB * 1000)} MB`;
    }
  };

  return (
    <div className="tcm-balance-card-compact">
      <div className="tcm-balance-main">
        <div className="tcm-balance-info">
          <div className="tcm-balance-label-row">
            <span className="tcm-balance-label">Turbo Credits Balance</span>
            <InfoButton tooltip="Turbo Credits are prepaid, instant-upload credits you buy with a card — no crypto wallet required. They're a separate balance from AR tokens in your wallet, just priced on the same scale." />
          </div>
          <div className="tcm-balance-value">
            <span className="tcm-balance-number">{balance ? balance.ar : '0.0000'}</span>
            {/* TRUST-6: this is the Credits balance, not the AR wallet balance
                (turbo-manager.ts converts winc -> an "AR-equivalent" figure for
                display) — labeling it "AR" conflated the two currencies the
                app elsewhere insists are distinct (see UserMenu's AR balance). */}
            <span className="tcm-balance-unit">Credits</span>
          </div>
        </div>

        <div className="tcm-balance-stats">
          <div className="tcm-stat">
            <span className="tcm-stat-label-row">
              <span className="label">Winston</span>
              <InfoButton tooltip="Winston is the smallest unit of AR — like a satoshi for Bitcoin. 1 AR = 10^12 Winston. Turbo Credits are priced on this same scale." />
            </span>
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
          <button className="tcm-refresh-compact" onClick={onRefresh} disabled={loading} aria-label="Refresh Turbo Credits balance">
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
  );
};

export default TurboBalanceCard;