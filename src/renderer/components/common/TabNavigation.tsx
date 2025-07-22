import React from 'react';

interface Tab {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  badge?: 'attention' | 'error' | 'success';
}

interface TabNavigationProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className = ''
}) => {
  return (
    <div className={`tab-navigation-wrapper ${className}`}>
      <div className="tab-navigation">
        <div className="tab-list" role="tablist">
          {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tab.id}-panel`}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon && <span className="tab-icon">{tab.icon}</span>}
            <span className="tab-label">{tab.label}</span>
            {tab.count !== undefined && (
              <span className="tab-count">{tab.count}</span>
            )}
            {tab.badge && (
              <span className={`tab-badge ${tab.badge}`}></span>
            )}
          </button>
        ))}
        </div>
      </div>
      
      <style>{`
        .tab-navigation-wrapper {
          display: flex;
          justify-content: center;
          margin-bottom: var(--space-6);
          background: var(--gray-50);
        }

        .tab-navigation {
          background: var(--ardrive-surface);
          border: 1px solid var(--ardrive-border);
          border-radius: var(--radius-lg);
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .tab-list {
          display: flex;
          gap: 0;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .tab-list::-webkit-scrollbar {
          display: none;
        }

        .tab-button {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-4) var(--space-5);
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          border-radius: var(--radius-md) var(--radius-md) 0 0;
          cursor: pointer;
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--ardrive-text-secondary);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          white-space: nowrap;
          position: relative;
          margin-bottom: -1px;
          min-height: 48px;
        }

        .tab-button:hover:not(.active) {
          color: var(--ardrive-text-primary);
          background: var(--gray-50);
          border-bottom-color: var(--ardrive-border-hover);
        }

        .tab-button:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
          z-index: 10;
        }

        .tab-button.active {
          color: var(--ardrive-primary);
          background: white;
          border-bottom-color: var(--ardrive-primary);
          z-index: 5;
        }

        .tab-button.active:hover {
          background: var(--ardrive-surface);
          color: var(--ardrive-primary-700);
        }

        .tab-icon {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tab-label {
          flex: 1;
        }

        .tab-count {
          background: var(--gray-200);
          color: var(--ardrive-text-secondary);
          font-size: var(--text-xs);
          font-weight: 600;
          padding: 3px 7px;
          border-radius: 12px;
          min-width: 20px;
          text-align: center;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .tab-button:hover:not(.active) .tab-count {
          background: var(--gray-300);
          color: var(--ardrive-text-primary);
        }

        .tab-button.active .tab-count {
          background: var(--ardrive-primary);
          color: white;
          box-shadow: 0 2px 4px rgba(220, 38, 38, 0.3);
        }

        .tab-badge {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-left: var(--space-2);
          border: 2px solid var(--ardrive-surface);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .tab-badge.attention {
          background: var(--warning-500);
        }

        .tab-badge.error {
          background: var(--ardrive-primary);
        }

        .tab-badge.success {
          background: var(--success-500);
        }

        /* Enhanced hover effects for icons */
        .tab-icon {
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .tab-button:hover .tab-icon {
          transform: translateY(-1px);
        }

        .tab-button.active .tab-icon {
          transform: scale(1.05);
        }

        /* Mobile responsive */
        @media (max-width: 768px) {
          .tab-list {
            padding: 0 var(--space-2);
          }

          .tab-button {
            padding: var(--space-3) var(--space-4);
            font-size: var(--text-xs);
            min-height: 44px;
          }

          .tab-icon {
            font-size: 14px;
          }

          .tab-count {
            padding: 2px 5px;
            min-width: 16px;
            font-size: 10px;
          }
        }

        @media (max-width: 480px) {
          .tab-button {
            padding: var(--space-2) var(--space-3);
          }

          .tab-label {
            display: none;
          }

          .tab-button .tab-icon {
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
};