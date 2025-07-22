import React from 'react';
import { Gift, Share2 } from 'lucide-react';

const TurboComingSoonTab: React.FC = () => {
  return (
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
            <p>
              Send credits to friends, family, and colleagues with a personalized message. 
              The perfect way to introduce someone to permanent storage on Arweave without the complexity.
            </p>
            <div className="tcm-coming-soon-badge">Coming Soon</div>
          </div>
        </div>

        <div className="tcm-feature-card tcm-coming-soon">
          <div className="tcm-feature-icon">
            <Share2 size={24} />
          </div>
          <div className="tcm-feature-content">
            <h4>Shared Credit Pools</h4>
            <p>
              Create team credit pools with spending limits, usage analytics, and role-based permissions. 
              Perfect for organizations, DAOs, and collaborative projects.
            </p>
            <div className="tcm-coming-soon-badge">Coming Soon</div>
          </div>
        </div>
        
        <div className="tcm-roadmap-note">
          <p>
            📧 Want to be notified when these features launch? Email us at{' '}
            <strong>support@ardrive.io</strong> to join our early access list!
          </p>
        </div>
      </div>
    </div>
  );
};

export default TurboComingSoonTab;