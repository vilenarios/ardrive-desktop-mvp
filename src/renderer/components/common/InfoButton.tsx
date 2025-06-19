import React, { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoButtonProps {
  tooltip: string;
  helpUrl?: string;
  children?: React.ReactNode;
  className?: string;
}

export const InfoButton: React.FC<InfoButtonProps> = ({
  tooltip,
  helpUrl,
  children,
  className = ''
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current && 
        buttonRef.current && 
        !tooltipRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible]);

  return (
    <div className={`info-button-container ${className}`}>
      <button 
        ref={buttonRef}
        className="info-button" 
        aria-label={tooltip}
        onClick={() => setIsVisible(!isVisible)}
        type="button"
      >
        <HelpCircle size={16} />
      </button>
      
      {isVisible && (
        <div 
          ref={tooltipRef}
          className="info-tooltip"
          role="tooltip"
        >
          <div className="tooltip-content">
            {children || <p>{tooltip}</p>}
            {helpUrl && (
              <a 
                href={helpUrl} 
                className="learn-more"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more →
              </a>
            )}
          </div>
        </div>
      )}

      <style>{`
        .info-button-container {
          position: relative;
          display: inline-block;
        }

        .info-button {
          background: none;
          border: none;
          padding: var(--space-1);
          cursor: pointer;
          color: var(--gray-500);
          border-radius: var(--radius-sm);
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .info-button:hover {
          color: var(--gray-700);
          background: var(--gray-100);
        }

        .info-button:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: 2px;
        }

        .info-tooltip {
          position: absolute;
          top: calc(100% + var(--space-2));
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          min-width: 200px;
          max-width: 300px;
        }

        .tooltip-content {
          background: var(--gray-900);
          color: white;
          padding: var(--space-3);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          font-size: var(--text-sm);
          line-height: 1.4;
        }

        .tooltip-content::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-bottom: 4px solid var(--gray-900);
        }

        .tooltip-content p {
          margin: 0 0 var(--space-2) 0;
        }

        .tooltip-content p:last-child {
          margin-bottom: 0;
        }

        .learn-more {
          color: var(--ardrive-primary-light);
          text-decoration: none;
          font-weight: 500;
          display: inline-block;
          margin-top: var(--space-2);
        }

        .learn-more:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};