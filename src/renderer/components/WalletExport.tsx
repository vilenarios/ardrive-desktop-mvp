import React, { useState } from 'react';
import { 
  Download,
  Copy,
  Eye,
  EyeOff,
  AlertTriangle,
  Shield,
  Key,
  FileText,
  X,
  Check,
  AlertCircle
} from 'lucide-react';

interface WalletExportProps {
  walletAddress: string;
  onClose: () => void;
}

type ExportFormat = 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';

interface ExportOption {
  format: ExportFormat;
  title: string;
  description: string;
  icon: React.ReactNode;
  danger: boolean;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    format: 'jwk-encrypted',
    title: 'Encrypted Keyfile',
    description: 'Password-protected JSON file (Recommended)',
    icon: <Shield size={20} />,
    danger: false
  },
  {
    format: 'jwk-plain',
    title: 'Unencrypted Keyfile',
    description: 'Plain JSON file (Use with extreme caution)',
    icon: <FileText size={20} />,
    danger: true
  },
  {
    format: 'seed-phrase',
    title: 'Seed Phrase',
    description: 'Recovery phrase (Not available for all wallets)',
    icon: <Key size={20} />,
    danger: true
  },
  {
    format: 'private-key',
    title: 'Private Key',
    description: 'Raw private key (Extremely dangerous)',
    icon: <AlertTriangle size={20} />,
    danger: true
  }
];

const WalletExport: React.FC<WalletExportProps> = ({ walletAddress, onClose }) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showExportData, setShowExportData] = useState(false);
  const [exportData, setExportData] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string>('');
  const [warning, setWarning] = useState<string>('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [showFinalWarning, setShowFinalWarning] = useState(false);

  const handleExport = async () => {
    if (!selectedFormat || !password) {
      setError('Please select an export format and enter your password');
      return;
    }

    // Validate new password for encrypted export
    if (selectedFormat === 'jwk-encrypted' && newPassword) {
      if (newPassword !== confirmNewPassword) {
        setError('New passwords do not match');
        return;
      }
      if (newPassword.length < 8) {
        setError('New password must be at least 8 characters');
        return;
      }
    }

    // Show final warning for dangerous exports
    if (selectedFormat !== 'jwk-encrypted' && !showFinalWarning) {
      setShowFinalWarning(true);
      return;
    }

    setIsExporting(true);
    setError('');
    setWarning('');

    try {
      const result = await window.electronAPI.wallet.export({
        format: selectedFormat,
        password,
        newPassword: selectedFormat === 'jwk-encrypted' ? (newPassword || password) : undefined
      });

      if (result.success) {
        setExportData(result.data || '');
        setWarning(result.warning || '');
        setShowExportData(true);
        setShowFinalWarning(false);
      } else {
        setError(result.error || 'Export failed');
        if (result.warning) {
          setWarning(result.warning);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportData);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
      
      // Clear clipboard after 30 seconds for security
      setTimeout(() => {
        navigator.clipboard.writeText('');
      }, 30000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    let filename = `ardrive-wallet-${walletAddress.slice(0, 8)}`;
    if (selectedFormat === 'jwk-encrypted') {
      filename += '-encrypted.json';
    } else if (selectedFormat === 'jwk-plain') {
      filename += '.json';
    } else if (selectedFormat === 'seed-phrase') {
      filename += '-seed.txt';
    } else if (selectedFormat === 'private-key') {
      filename += '-private-key.txt';
    }
    
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setSelectedFormat(null);
    setPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setShowPassword(false);
    setShowExportData(false);
    setExportData('');
    setError('');
    setWarning('');
    setShowFinalWarning(false);
  };

  return (
    <div className="wallet-export-modal fade-in">
      <div className="modal-overlay" onClick={onClose} />
      
      <div className="modal-content">
        <div className="modal-header">
          <h2>Export Wallet</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {!showExportData ? (
          <>
            {/* Export Format Selection */}
            {!selectedFormat && (
              <div className="export-options">
                <h3>Select Export Format</h3>
                <div className="options-grid">
                  {EXPORT_OPTIONS.map((option) => (
                    <button
                      key={option.format}
                      className={`export-option ${option.danger ? 'danger' : ''}`}
                      onClick={() => setSelectedFormat(option.format)}
                    >
                      <div className="option-icon">{option.icon}</div>
                      <div className="option-content">
                        <h4>{option.title}</h4>
                        <p>{option.description}</p>
                      </div>
                      {option.danger && (
                        <div className="danger-badge">
                          <AlertTriangle size={12} />
                          Risk
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Password Entry */}
            {selectedFormat && !showFinalWarning && (
              <div className="password-section">
                <button className="back-link" onClick={resetForm}>
                  ← Back to formats
                </button>
                
                <h3>Enter Password</h3>
                
                {/* Current Password */}
                <div className="form-group">
                  <label>Current Password</label>
                  <div className="password-input">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your wallet password"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* New Password for Encrypted Export */}
                {selectedFormat === 'jwk-encrypted' && (
                  <>
                    <div className="form-group">
                      <label>New Password (Optional)</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Leave blank to use current password"
                      />
                      <small>Set a different password for the exported file</small>
                    </div>
                    
                    {newPassword && (
                      <div className="form-group">
                        <label>Confirm New Password</label>
                        <input
                          type="password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="Confirm new password"
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Security Warning */}
                {selectedFormat !== 'jwk-encrypted' && (
                  <div className="security-warning">
                    <AlertTriangle size={16} />
                    <div>
                      <strong>Security Warning:</strong> This export format is not encrypted. 
                      Anyone with access to the exported data can access your wallet.
                    </div>
                  </div>
                )}

                {error && (
                  <div className="error-message">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}

                <div className="form-actions">
                  <button className="button outline" onClick={resetForm}>
                    Cancel
                  </button>
                  <button
                    className="button"
                    onClick={handleExport}
                    disabled={!password || isExporting}
                  >
                    {isExporting ? 'Exporting...' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            {/* Final Warning for Dangerous Exports */}
            {showFinalWarning && (
              <div className="final-warning">
                <div className="warning-icon">
                  <AlertTriangle size={48} />
                </div>
                
                <h3>Critical Security Warning</h3>
                
                <div className="warning-content">
                  <p>You are about to export sensitive wallet data in an unencrypted format.</p>
                  
                  <ul>
                    <li>Anyone with this data can access your wallet and all funds</li>
                    <li>Never share this data with anyone</li>
                    <li>Store it in a secure, encrypted location</li>
                    <li>Consider using encrypted export instead</li>
                  </ul>
                  
                  <p className="warning-emphasis">
                    Are you absolutely sure you want to continue?
                  </p>
                </div>

                <div className="form-actions">
                  <button className="button" onClick={() => setShowFinalWarning(false)}>
                    Go Back
                  </button>
                  <button
                    className="button danger"
                    onClick={handleExport}
                    disabled={isExporting}
                  >
                    {isExporting ? 'Exporting...' : 'I Understand the Risks - Export'}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Export Result */
          <div className="export-result">
            <div className="result-header">
              <Check size={24} className="success-icon" />
              <h3>Export Successful</h3>
            </div>

            {warning && (
              <div className="export-warning">
                <AlertTriangle size={16} />
                <div>{warning}</div>
              </div>
            )}

            <div className="export-data">
              <div className="data-container">
                {selectedFormat === 'seed-phrase' ? (
                  <div className="seed-phrase">
                    {showExportData ? (
                      <div className="phrase-words">
                        {exportData.split(' ').map((word, index) => (
                          <span key={index} className="seed-word">
                            <span className="word-index">{index + 1}</span>
                            <span className="word-text">{word}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="masked-data">
                        <p>••••• ••••• ••••• •••••</p>
                        <button
                          className="button small outline"
                          onClick={() => setShowExportData(true)}
                        >
                          <Eye size={14} />
                          Reveal Seed Phrase
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="export-text">
                    {selectedFormat === 'private-key' && !showExportData
                      ? '•'.repeat(64)
                      : exportData}
                  </pre>
                )}
              </div>

              <div className="export-actions">
                <button className="button outline" onClick={handleCopy}>
                  {copySuccess ? (
                    <>
                      <Check size={16} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy
                    </>
                  )}
                </button>
                
                {selectedFormat !== 'seed-phrase' && (
                  <button className="button" onClick={handleDownload}>
                    <Download size={16} />
                    Download
                  </button>
                )}
              </div>
            </div>

            <div className="form-actions">
              <button className="button" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletExport;