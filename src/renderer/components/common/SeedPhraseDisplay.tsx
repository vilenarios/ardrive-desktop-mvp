import React, { useState } from 'react';
import { Eye, EyeOff, Copy, CheckCircle } from 'lucide-react';

interface SeedPhraseDisplayProps {
  seedPhrase: string;
  showByDefault?: boolean;
  allowCopyWhenHidden?: boolean; // New prop to enable copy without reveal
}

export const SeedPhraseDisplay: React.FC<SeedPhraseDisplayProps> = ({ 
  seedPhrase, 
  showByDefault = false,
  allowCopyWhenHidden = false 
}) => {
  const [showSeedPhrase, setShowSeedPhrase] = useState(showByDefault);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(seedPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const words = seedPhrase.split(' ');

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ 
        backgroundColor: showSeedPhrase ? 'var(--gray-50)' : 'var(--gray-900)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        position: 'relative',
        overflow: 'hidden',
        maxHeight: '300px',
        overflowY: 'auto'
      }}>
        {!showSeedPhrase && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
            zIndex: 1
          }}>
            <Eye size={32} style={{ color: 'white', marginBottom: 'var(--space-3)' }} />
            <button
              className="button"
              onClick={() => setShowSeedPhrase(true)}
            >
              Reveal Recovery Phrase
            </button>
          </div>
        )}
        
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 'var(--space-2)',
          opacity: showSeedPhrase ? 1 : 0.1,
          transition: 'opacity 0.3s ease-in'
        }}>
          {words.map((word, index) => (
            <div
              key={index}
              style={{
                padding: 'var(--space-2)',
                backgroundColor: 'white',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--gray-300)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)'
              }}
            >
              <span style={{ 
                fontSize: '12px', 
                color: 'var(--gray-500)',
                fontWeight: '600',
                minWidth: '20px'
              }}>
                {index + 1}.
              </span>
              <span style={{ 
                fontFamily: 'monospace',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                {word}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Copy and Hide buttons */}
      {(showSeedPhrase || allowCopyWhenHidden) && (
        <div style={{
          position: 'absolute',
          top: 'var(--space-3)',
          right: 'var(--space-3)',
          display: 'flex',
          gap: 'var(--space-2)',
          zIndex: 2
        }}>
          {showSeedPhrase && (
            <button
              className="button outline"
              onClick={() => setShowSeedPhrase(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                backgroundColor: 'white',
                border: '1px solid var(--gray-300)'
              }}
              title="Hide recovery phrase"
            >
              <EyeOff size={16} />
              Hide
            </button>
          )}
          <button
            className="button outline"
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              backgroundColor: showSeedPhrase ? 'white' : 'rgba(255, 255, 255, 0.9)',
              border: '1px solid var(--gray-300)',
              color: showSeedPhrase ? 'var(--gray-700)' : 'var(--gray-800)'
            }}
            title="Copy recovery phrase to clipboard"
          >
            {copied ? (
              <>
                <CheckCircle size={16} />
                Copied!
              </>
            ) : (
              <>
                <Copy size={16} />
                Copy
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};