import React from 'react';
import { Info, TrendingUp, DollarSign, Zap, Check } from 'lucide-react';
import { InfoButton } from '../common/InfoButton';

interface AutoTopUpSettings {
  enabled: boolean;
  threshold: number;
  amount: number;
  paymentMethod?: string;
}

interface TurboSettingsTabProps {
  autoTopUp: AutoTopUpSettings;
  setAutoTopUp: (settings: AutoTopUpSettings) => void;
  showAutoTopUpSaved: boolean;
  handleAutoTopUpSave: () => void;
}

const TurboSettingsTab: React.FC<TurboSettingsTabProps> = ({
  autoTopUp,
  setAutoTopUp,
  showAutoTopUpSaved,
  handleAutoTopUpSave
}) => {
  return (
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
                  Auto top-up will use your saved payment method. You&apos;ll receive an email notification for each automatic purchase.
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
  );
};

export default TurboSettingsTab;