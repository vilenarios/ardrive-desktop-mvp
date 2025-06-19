import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface ExpandableSectionProps {
  title: string;
  summary?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'bordered' | 'subtle';
}

export const ExpandableSection: React.FC<ExpandableSectionProps> = ({
  title,
  summary,
  defaultExpanded = false,
  children,
  className = '',
  variant = 'default'
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`expandable-section expandable-section--${variant} ${className}`}>
      <button 
        className="section-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="section-content"
      >
        <div className="header-content">
          <span className="section-title">{title}</span>
          {summary && (
            <span className="section-summary">{summary}</span>
          )}
        </div>
        <ChevronDown 
          className={`chevron ${expanded ? 'expanded' : ''}`}
          size={16}
          aria-hidden="true"
        />
      </button>
      
      {expanded && (
        <div 
          className="section-content"
          id="section-content"
        >
          {children}
        </div>
      )}

      <style>{`
        .expandable-section {
          border-radius: var(--radius-md);
        }

        .expandable-section--bordered {
          border: 1px solid var(--gray-200);
        }

        .expandable-section--subtle {
          background: var(--gray-50);
        }

        .section-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) var(--space-4);
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          border-radius: var(--radius-md);
          transition: all 0.2s ease;
        }

        .expandable-section--bordered .section-header {
          border-radius: var(--radius-md) var(--radius-md) 0 0;
        }

        .section-header:hover {
          background: var(--gray-50);
        }

        .section-header:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
        }

        .header-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--space-1);
          flex: 1;
          min-width: 0;
        }

        .section-title {
          font-size: var(--text-base);
          font-weight: 500;
          color: var(--gray-900);
        }

        .section-summary {
          font-size: var(--text-sm);
          color: var(--gray-600);
        }

        .chevron {
          color: var(--gray-500);
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }

        .chevron.expanded {
          transform: rotate(180deg);
        }

        .section-content {
          padding: 0 var(--space-4) var(--space-4) var(--space-4);
          animation: slideDown 0.2s ease-out;
        }

        .expandable-section--bordered .section-content {
          border-top: 1px solid var(--gray-200);
          padding-top: var(--space-4);
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Responsive adjustments */
        @media (max-width: 640px) {
          .section-header {
            padding: var(--space-3);
          }

          .section-content {
            padding: 0 var(--space-3) var(--space-3) var(--space-3);
          }

          .expandable-section--bordered .section-content {
            padding-top: var(--space-3);
          }
        }
      `}</style>
    </div>
  );
};