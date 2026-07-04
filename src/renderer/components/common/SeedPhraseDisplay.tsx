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
        backgroundColor: 'var(--surface-sunken)',
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
            backgroundColor: 'var(--overlay)',
            backdropFilter: 'blur(4px)',
            zIndex: 1
          }}>
            <Eye size={32} style={{ color: 'var(--text-on-brand)', marginBottom: 'var(--space-3)' }} />
            <button
              className="button"
              onClick={() => setShowSeedPhrase(true)}
            >
              Reveal Recovery Phrase
            </button>
          </div>
        )}

        {/* TRUST-4: this grid used to always render the real words and just
            dim them to opacity 0.1 — the plaintext stayed in the DOM (and
            in the accessibility tree) the entire time, readable via a
            screen reader or any DOM inspector regardless of "hidden" state.
            Mirror the recovery-phrase *import* textarea (which genuinely
            masks via -webkit-text-security): swap the rendered word text
            itself for a masked placeholder while hidden, and aria-hide the
            whole grid so assistive tech gets nothing until it's revealed. */}
        <div
          aria-hidden={!showSeedPhrase}
          data-testid="seed-phrase-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-2)'
          }}
        >
          {words.map((word, index) => (
            <div
              key={index}
              style={{
                padding: 'var(--space-2)',
                backgroundColor: 'var(--surface-raised)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-strong)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)'
              }}
            >
              <span style={{
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                fontWeight: '600',
                minWidth: '20px'
              }}>
                {index + 1}.
              </span>
              <span style={{
                fontFamily: 'monospace',
                fontSize: '14px',
                fontWeight: '500',
                color: 'var(--text-primary)',
                letterSpacing: showSeedPhrase ? 'normal' : '1px'
              }}>
                {showSeedPhrase ? word : '••••••'}
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
              className="button outline seed-action-button"
              onClick={() => setShowSeedPhrase(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
              title="Hide recovery phrase"
            >
              <EyeOff size={16} />
              Hide
            </button>
          )}
          <button
            className="button outline seed-action-button"
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)'
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

      {/* COPY-14: allowCopyWhenHidden lets a user copy the phrase to the OS
          clipboard without ever revealing it on screen — a nice privacy
          feature, but clipboard managers/history can retain it afterward.
          Say so. */}
      {copied && (
        <p style={{
          marginTop: 'var(--space-2)',
          fontSize: '12px',
          color: 'var(--text-tertiary)',
          textAlign: 'right'
        }}>
          Copied — remember to clear your clipboard history after pasting somewhere safe.
        </p>
      )}
    </div>
  );
};