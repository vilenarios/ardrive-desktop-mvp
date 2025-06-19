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
    <div className={`tab-navigation ${className}`}>
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

      <style>{`
        .tab-navigation {
          border-bottom: 1px solid var(--gray-200);
          margin-bottom: var(--space-6);
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
          padding: var(--space-3) var(--space-4);
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--gray-600);
          transition: all 0.2s ease;
          white-space: nowrap;
          position: relative;
        }

        .tab-button:hover {
          color: var(--gray-800);
          background: var(--gray-50);
        }

        .tab-button:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }

        .tab-button.active {
          color: var(--ardrive-primary);
          border-bottom-color: var(--ardrive-primary);
        }

        .tab-button.active:hover {
          background: var(--ardrive-primary-light);
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
          color: var(--gray-700);
          font-size: var(--text-xs);
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        }

        .tab-button.active .tab-count {
          background: var(--ardrive-primary);
          color: white;
        }

        .tab-badge {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-left: var(--space-2);
        }

        .tab-badge.attention {
          background: var(--warning-500);
        }

        .tab-badge.error {
          background: var(--danger-500);
        }

        .tab-badge.success {
          background: var(--success-500);
        }

        /* Mobile responsive */
        @media (max-width: 640px) {
          .tab-button {
            padding: var(--space-2) var(--space-3);
            font-size: var(--text-xs);
          }

          .tab-icon {
            font-size: 14px;
          }
        }
      `}</style>
    </div>
  );
};