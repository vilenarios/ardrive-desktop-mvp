import React from 'react';
import {
  Zap, DollarSign, Gift, Shield, TrendingUp,
  Clock, Coins, CreditCard, Equal, Check, X, Wrench, Target, Lightbulb
} from 'lucide-react';
import { ExpandableSection } from '../common/ExpandableSection';
import { InfoButton } from '../common/InfoButton';

const TurboAboutTab: React.FC = () => {
  return (
    <div className="tcm-about-tab">
      {/* Hero Section */}
      <div className="tcm-section">
        <div className="tcm-about-hero">
          <div className="tcm-about-hero-content">
            <h2>Why Turbo Credits?</h2>
            <p className="tcm-about-subtitle">
              The easiest way to store files permanently on Arweave with instant uploads
              and predictable, pay-as-you-go pricing.
            </p>
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
            <div className="tcm-benefit-card">
              <div className="tcm-benefit-icon">
                <Zap size={24} />
              </div>
              <h4>Lightning Fast</h4>
              <p>
                Upload files and see them instantly on Arweave. No more waiting 10-60 minutes 
                for blockchain confirmation. Your files are accessible immediately while still 
                getting permanent storage.
              </p>
            </div>
            
            <div className="tcm-benefit-card">
              <div className="tcm-benefit-icon">
                <DollarSign size={24} />
              </div>
              <h4>Transparent Pricing</h4>
              <p>
                Pay in your local currency with credit cards. Bulk purchasing provides better 
                rates than individual AR transactions, plus you avoid crypto volatility and gas fees.
              </p>
            </div>
            
            <div className="tcm-benefit-card">
              <div className="tcm-benefit-icon">
                <Gift size={24} />
              </div>
              <h4>Free Tier Included</h4>
              <p>
                Files under 100KB are completely free. This covers most documents, photos, 
                and metadata - perfect for getting started without any upfront costs.
              </p>
            </div>
            
            <div className="tcm-benefit-card">
              <div className="tcm-benefit-icon">
                <Shield size={24} />
              </div>
              <h4>Same Permanence Guarantee</h4>
              <p>
                Your data gets identical permanence as traditional Arweave uploads. 200+ years 
                of storage with redundancy across thousands of nodes worldwide.
              </p>
            </div>
            
            <div className="tcm-benefit-card">
              <div className="tcm-benefit-icon">
                <TrendingUp size={24} />
              </div>
              <h4>Economies of Scale</h4>
              <p>
                Turbo pools uploads from thousands of users to get better Arweave rates.
                You benefit from enterprise-level pricing without enterprise-level complexity.
              </p>
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
              <div><Clock size={14} /> 10-60 minutes</div>
              <div><Zap size={14} /> Instant</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Payment Options</div>
              <div><Coins size={14} /> AR tokens only</div>
              <div><CreditCard size={14} /> Credit card + AR tokens</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Small Files (&lt; 100KB)</div>
              <div><DollarSign size={14} /> Costs AR</div>
              <div><Gift size={14} /> Completely free</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Price Volatility</div>
              <div><TrendingUp size={14} /> Fluctuates with AR price</div>
              <div><Equal size={14} /> Fixed fiat pricing</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Bulk Discounts</div>
              <div><X size={14} /> Pay per transaction</div>
              <div><Check size={14} /> Economies of scale</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Setup Complexity</div>
              <div><Wrench size={14} /> Manage AR wallet</div>
              <div><Target size={14} /> Just works</div>
            </div>

            <div className="tcm-comparison-row">
              <div>Data Permanence</div>
              <div><Check size={14} /> 200+ years</div>
              <div><Check size={14} /> 200+ years</div>
            </div>
          </div>
        </ExpandableSection>
      </div>

      {/* Economic Benefits */}
      <div className="tcm-section">
        <div className="tcm-economics-card">
          <h3><Lightbulb size={18} /> Smart Economics</h3>
          <div className="tcm-economics-content">
            <div className="tcm-economics-point">
              <strong>Bulk Purchasing Power:</strong> Turbo aggregates demand from thousands 
              of users to negotiate better Arweave storage rates, passing savings directly to you.
            </div>
            <div className="tcm-economics-point">
              <strong>Reduced Transaction Costs:</strong> Instead of paying Arweave network 
              fees for each upload, you pay once when purchasing credits.
            </div>
            <div className="tcm-economics-point">
              <strong>Predictable Budgeting:</strong> Lock in storage costs in your local 
              currency without worrying about AR token price swings.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TurboAboutTab;