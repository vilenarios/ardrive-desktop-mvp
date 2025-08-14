import React, { useState } from 'react';
import { Link, Target, FileText, Copy, Search, ExternalLink, HardDrive, Globe } from 'lucide-react';
import { generateFileLinks, generateShareableFileLink, generateExplorerLinks } from '../../utils/link-generator';

interface FileLinkActionsProps {
  dataTxId?: string;
  metadataTxId?: string;
  fileId?: string;
  fileName: string;
  driveId?: string;
  fileKey?: string;
  onCopySuccess?: (message: string) => void;
}

const FileLinkActions: React.FC<FileLinkActionsProps> = ({
  dataTxId,
  metadataTxId,
  fileId,
  fileName,
  driveId,
  fileKey,
  onCopySuccess
}) => {
  const [expanded, setExpanded] = useState(false);
  
  const links = generateFileLinks(dataTxId, metadataTxId, fileId, driveId, fileKey);
  const explorerLinks = dataTxId ? generateExplorerLinks(dataTxId) : null;

  const copyToClipboard = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopySuccess?.(message);
    } catch (err) {
      console.error('Failed to copy:', err);
      onCopySuccess?.('Failed to copy to clipboard');
    }
  };

  const openInBrowser = async (url: string) => {
    try {
      await window.electronAPI.shell.openExternal(url);
    } catch (err) {
      console.error('Failed to open URL:', err);
    }
  };

  if (!dataTxId && !metadataTxId && !fileId) {
    return null; // No links available
  }

  return (
    <div className="file-link-actions">
      <button 
        className="button secondary small"
        onClick={() => setExpanded(!expanded)}
        style={{ fontSize: '11px', padding: '4px 8px' }}
      >
        <Link size={12} style={{ marginRight: '4px' }} />
        {expanded ? 'Hide Links' : 'Show Links'}
      </button>

      {expanded && (
        <div style={{ 
          marginTop: 'var(--space-2)', 
          padding: 'var(--space-2)', 
          backgroundColor: 'var(--gray-50)', 
          borderRadius: 'var(--radius-sm)',
          fontSize: '11px'
        }}>
          
          {/* ArDrive App Links */}
          {(fileId || driveId) && (
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <div className="font-semibold" style={{ marginBottom: 'var(--space-1)', color: 'var(--ardrive-primary)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Target size={12} /> ArDrive App
              </div>
              
              {fileId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
                  <button
                    className="button secondary small"
                    onClick={() => openInBrowser(links.fileViewUrl!)}
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                  >
                    <FileText size={10} style={{ marginRight: '2px' }} /> View File
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => copyToClipboard(
                      generateShareableFileLink(fileId, fileName, fileKey),
                      'File sharing link copied!'
                    )}
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                  >
                    <Copy size={10} style={{ marginRight: '2px' }} /> Copy Share Link
                  </button>
                </div>
              )}
              
              {driveId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <button
                    className="button secondary small"
                    onClick={() => openInBrowser(links.driveViewUrl!)}
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                  >
                    <HardDrive size={10} style={{ marginRight: '2px' }} /> View Drive
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => copyToClipboard(links.driveViewUrl!, 'Drive link copied!')}
                    style={{ fontSize: '10px', padding: '2px 6px' }}
                  >
                    <Copy size={10} style={{ marginRight: '2px' }} /> Copy Drive Link
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Direct Arweave Access */}
          {dataTxId && (
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <div className="font-semibold" style={{ marginBottom: 'var(--space-1)', color: 'var(--ardrive-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Globe size={12} /> Direct Access
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
                <button
                  className="button secondary small"
                  onClick={() => openInBrowser(links.rawFileUrl!)}
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                >
                  📁 Open File
                </button>
                <button
                  className="button secondary small"
                  onClick={() => copyToClipboard(links.rawFileUrl!, 'Direct file URL copied!')}
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                >
                  <Copy size={10} style={{ marginRight: '2px' }} /> Copy URL
                </button>
              </div>
            </div>
          )}

          {/* Transaction Details */}
          {(dataTxId || metadataTxId) && (
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <div className="font-semibold" style={{ marginBottom: 'var(--space-1)', color: 'var(--gray-600)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <Search size={12} /> Blockchain
              </div>
              
              {dataTxId && (
                <div style={{ marginBottom: 'var(--space-1)' }}>
                  <div className="text-gray-500" style={{ fontSize: '10px' }}>Data Transaction:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <code 
                      style={{ 
                        fontSize: '9px', 
                        cursor: 'pointer',
                        backgroundColor: 'var(--gray-100)',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      onClick={() => copyToClipboard(dataTxId, 'Data transaction ID copied!')}
                      title={`Click to copy: ${dataTxId}`}
                    >
                      {dataTxId}
                    </code>
                    <button
                      className="button secondary small"
                      onClick={() => openInBrowser(links.dataTransactionUrl!)}
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                    >
                      <Search size={10} style={{ marginRight: '2px' }} /> Explorer
                    </button>
                  </div>
                </div>
              )}
              
              {metadataTxId && (
                <div>
                  <div className="text-gray-500" style={{ fontSize: '10px' }}>Metadata Transaction:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <code 
                      style={{ 
                        fontSize: '9px', 
                        cursor: 'pointer',
                        backgroundColor: 'var(--gray-100)',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      onClick={() => copyToClipboard(metadataTxId, 'Metadata transaction ID copied!')}
                      title={`Click to copy: ${metadataTxId}`}
                    >
                      {metadataTxId}
                    </code>
                    <button
                      className="button secondary small"
                      onClick={() => openInBrowser(links.metadataTransactionUrl!)}
                      style={{ fontSize: '10px', padding: '2px 6px' }}
                    >
                      <Search size={10} style={{ marginRight: '2px' }} /> Explorer
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Alternative Explorers */}
          {explorerLinks && (
            <div>
              <div className="font-semibold" style={{ marginBottom: 'var(--space-1)', color: 'var(--gray-600)' }}>
                🌍 Other Explorers
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                <button
                  className="button secondary small"
                  onClick={() => openInBrowser(explorerLinks.viewblock)}
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                >
                  ViewBlock
                </button>
                <button
                  className="button secondary small"
                  onClick={() => openInBrowser(explorerLinks.arscan)}
                  style={{ fontSize: '10px', padding: '2px 6px' }}
                >
                  ArScan
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FileLinkActions;