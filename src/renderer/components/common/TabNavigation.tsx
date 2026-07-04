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

// Styles live in src/renderer/styles/dashboard-tabs.css (DESIGN-4) — moved
// out of an inline <style> tag so the tab bar follows the same token-driven,
// file-organized convention as the rest of styles/*.css.
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
    </div>
  );
};
