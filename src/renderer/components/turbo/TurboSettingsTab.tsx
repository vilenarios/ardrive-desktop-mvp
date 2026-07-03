import React from 'react';
import { TrendingUp, DollarSign, Zap } from 'lucide-react';

const TurboSettingsTab: React.FC = () => {
  return (
    <div className="tcm-settings-tab">
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