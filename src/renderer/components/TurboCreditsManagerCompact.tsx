import React from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';

interface TurboBalance {
  ar: string;
  winc: string;
}

interface CompactBalanceCardProps {
  balance: TurboBalance | null;
  fiatEstimate?: string | null;
  loading: boolean;
  onRefresh: () => void;
}

// Helper function to calculate storage from AR
const calculateStorageFromAR = (arAmount: number): string => {
  // Rough estimate: 1 AR ≈ 500 MB of storage with Turbo
  const mbPerAR = 500;
  const totalMB = arAmount * mbPerAR;
  
  if (totalMB < 1024) {
    return `${totalMB.toFixed(0)} MB`;
  } else {
    return `${(totalMB / 1024).toFixed(1)} GB`;
  }
};

// Example of improved compact balance section
const CompactBalanceCard: React.FC<CompactBalanceCardProps> = ({ balance, fiatEstimate, loading, onRefresh }) => {
  return (
    <div className="tcm-balance-card-compact">
      <div className="tcm-balance-main">
        <div className="tcm-balance-info">
          <div className="tcm-balance-label">Turbo Credits Balance</div>
          <div className="tcm-balance-value">
            <span className="tcm-balance-number">{balance?.ar || '0.0000'}</span>
            <span className="tcm-balance-unit">AR</span>
          </div>
        </div>
        
        <div className="tcm-balance-stats">
          <div className="tcm-stat">
            <span className="label">Winston:</span>
            <span className="value">{parseFloat(balance?.winc || '0').toLocaleString()}</span>
          </div>
          <div className="tcm-stat">
            <span className="label">Est. Storage:</span>
            <span className="value">{calculateStorageFromAR(parseFloat(balance?.ar || '0'))}</span>
          </div>
        </div>
        
        <button className="tcm-refresh-compact" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spinning' : ''} />
        </button>
      </div>
      
      {parseFloat(balance?.ar || '0') < 0.1 && (
        <div className="tcm-low-balance-alert">
          <AlertCircle size={14} />
          <span>Low balance - top up to ensure uninterrupted uploads</span>
        </div>
      )}
      
      <style>{`
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
          font-size: 12px;
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
        
        .tcm-refresh-compact .spinning {
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
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
        
        @media (max-width: 768px) {
          .tcm-balance-main {
            flex-direction: column;
            gap: var(--space-3);
            text-align: center;
          }
          
          .tcm-balance-stats {
            width: 100%;
            padding-left: 0;
            padding-top: var(--space-3);
            border-left: none;
            border-top: 1px solid var(--gray-200);
            justify-content: space-around;
          }
        }
      `}</style>
    </div>
  );
};

export default CompactBalanceCard;