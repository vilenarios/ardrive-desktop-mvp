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
    </div>
  );
};