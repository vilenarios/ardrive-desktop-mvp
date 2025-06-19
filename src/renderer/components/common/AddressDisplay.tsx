import React, { useState } from 'react';
import { Copy, CheckCircle } from 'lucide-react';

interface AddressDisplayProps {
  address: string;
  label?: string;
}

export const AddressDisplay: React.FC<AddressDisplayProps> = ({ 
  address, 
  label = 'Your Arweave Address (public):' 
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ 
      backgroundColor: 'var(--gray-50)', 
      padding: 'var(--space-3)', 
      borderRadius: 'var(--radius-md)',
      position: 'relative'
    }}>
      <p style={{ 
        fontSize: '13px', 
        color: 'var(--gray-600)', 
        marginBottom: 'var(--space-2)',
        fontWeight: '500'
      }}>
        {label}
      </p>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)'
      }}>
        <p style={{ 
          fontFamily: 'monospace', 
          fontSize: '13px', 
          wordBreak: 'break-all',
          color: 'var(--gray-800)',
          flex: 1,
          margin: 0
        }}>
          {address}
        </p>
        <button
          className="button outline small"
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: '12px'
          }}
        >
          {copied ? (
            <>
              <CheckCircle size={14} />
              Copied!
            </>
          ) : (
            <>
              <Copy size={14} />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
};