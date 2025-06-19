import React, { useState, useRef } from 'react';
import { Wallet, Shield, ArrowRight, FileText, Key, Hexagon, Copy, CheckCircle } from 'lucide-react';
import { InfoButton } from './common/InfoButton';
import { PasswordForm } from './common/PasswordForm';
import { SeedPhraseDisplay } from './common/SeedPhraseDisplay';
import { AddressDisplay } from './common/AddressDisplay';
import { ClientInputValidator } from '../input-validator';

interface WalletSetupProps {
  onWalletImported: () => void;
}

const WalletSetup: React.FC<WalletSetupProps> = ({ onWalletImported }) => {
  const [step, setStep] = useState(1);
  const [walletAction, setWalletAction] = useState<'create' | 'import'>('create');
  const [importMethod, setImportMethod] = useState<'file' | 'seedphrase'>('file');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [walletPath, setWalletPath] = useState<string | null>(null);
  const [seedPhrase, setSeedPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [generatedSeedPhrase, setGeneratedSeedPhrase] = useState<string | null>(null);
  const [generatedAddress, setGeneratedAddress] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Confirmation state
  const [hasConfirmedSeedPhrase, setHasConfirmedSeedPhrase] = useState(false);

  // Reset all fields when switching between create/import
  React.useEffect(() => {
    setImportMethod('file');
    setWalletPath(null);
    setSeedPhrase('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
    setGeneratedSeedPhrase(null);
    setGeneratedAddress(null);
  }, [walletAction]);

  const handleSelectWallet = async () => {
    try {
      const selectedPath = await window.electronAPI.dialog.selectWallet();
      if (selectedPath) {
        setWalletPath(selectedPath);
        setError(null);
        setSuccess(`Selected wallet: ${selectedPath}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select wallet');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.json')) {
        setWalletPath(file.path);
        setError(null);
        setSuccess(`Selected wallet: ${file.name}`);
      } else {
        setError('Please drop a valid JSON wallet file');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleCopyPath = async () => {
    if (walletPath) {
      await navigator.clipboard.writeText(walletPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const validatePassword = (pwd: string): { isValid: boolean; error?: string } => {
    return ClientInputValidator.validatePassword(pwd);
  };
  
  const validateSeedPhrase = (phrase: string): { isValid: boolean; error?: string } => {
    return ClientInputValidator.validateSeedPhrase(phrase);
  };


  const handleCreateWallet = async () => {
    // Validate password using client-side validation
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.error!);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Generate wallet and seed phrase
      const result = await window.electronAPI.wallet.generate(password);
      
      setGeneratedSeedPhrase(result.seedPhrase);
      setGeneratedAddress(result.address);
      setSuccess('Wallet created successfully!');
      nextStep();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteWalletCreation = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Complete wallet creation
      await window.electronAPI.wallet.completeSetup();
      
      setSuccess('Wallet setup complete!');
      setTimeout(() => {
        onWalletImported();
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete wallet setup');
      setLoading(false);
    }
  };

  const handleImport = async () => {
    // Validate password using client-side validation
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.error!);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      if (importMethod === 'file') {
        if (!walletPath) {
          setError('Please select a wallet file');
          return;
        }
        
        // Import wallet from JWK file
        await window.electronAPI.wallet.importFromKeyfile(walletPath, password);
      } else {
        // Import wallet from seed phrase
        const seedValidation = validateSeedPhrase(seedPhrase);
        if (!seedValidation.isValid) {
          setError(seedValidation.error!);
          return;
        }
        
        await window.electronAPI.wallet.importFromSeedPhrase(seedPhrase.trim(), password);
      }
      
      setSuccess('Wallet imported successfully!');
      setTimeout(() => {
        onWalletImported();
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  };

  // Step navigation
  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  return (
    <div className="wallet-setup-container" style={{
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      {/* Background Pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        opacity: 0.03,
        backgroundImage: `
          repeating-linear-gradient(
            0deg,
            transparent,
            transparent 35px,
            rgba(227, 84, 35, 0.1) 35px,
            rgba(227, 84, 35, 0.1) 36px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 35px,
            rgba(227, 84, 35, 0.1) 35px,
            rgba(227, 84, 35, 0.1) 36px
          )
        `,
        pointerEvents: 'none'
      }} />
      
      <div className="wallet-setup-card" style={{
        position: 'relative',
        backgroundColor: 'white',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-10)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.08), 0 10px 20px rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        maxWidth: '520px',
        width: '100%',
        margin: 'var(--space-8)'
      }}>
        {/* Header with Logo */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <img 
            src="ArDrive-Logo-Wordmark-Dark.png" 
            alt="ArDrive" 
            style={{ height: '60px' }} 
          />
        </div>

        {error && (
          <div className="error-message" style={{ marginBottom: 'var(--space-4)' }}>
            {error}
          </div>
        )}

        {success && (
          <div className="success-message" style={{ marginBottom: 'var(--space-4)' }}>
            {success}
          </div>
        )}

        {/* Step 1: Choose Action */}
        {step === 1 && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-6)' }}>Welcome to ArDrive Desktop</h2>
            <p style={{ fontSize: '16px', color: 'var(--gray-600)', marginBottom: 'var(--space-8)', textAlign: 'center' }}>
              Store your files permanently on the decentralized web
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <button
                className="primary-action-button"
                onClick={() => {
                  setWalletAction('create');
                  setStep(2);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-6)',
                  backgroundColor: 'var(--ardrive-primary)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(227, 84, 35, 0.15)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(227, 84, 35, 0.25)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(227, 84, 35, 0.15)';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <Wallet size={24} />
                  <span style={{ fontSize: '18px', fontWeight: '600' }}>Create New Account</span>
                  <ArrowRight size={20} />
                </div>
                <p style={{ fontSize: '14px', opacity: 0.9, margin: 0 }}>
                  Generate a new Arweave wallet
                </p>
              </button>

              <button
                className="secondary-action-button"
                onClick={() => {
                  setWalletAction('import');
                  setStep(2);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'var(--space-6)',
                  backgroundColor: 'white',
                  color: 'var(--gray-800)',
                  border: '2px solid var(--gray-300)',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ardrive-primary)';
                  e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gray-300)';
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <FileText size={24} />
                  <span style={{ fontSize: '18px', fontWeight: '600' }}>Import Existing Account</span>
                  <ArrowRight size={20} />
                </div>
                <p style={{ fontSize: '14px', color: 'var(--gray-600)', margin: 0 }}>
                  Use your wallet file or recovery phrase
                </p>
              </button>
            </div>

            <div style={{
              marginTop: 'var(--space-8)',
              paddingTop: 'var(--space-6)',
              borderTop: '1px solid var(--gray-200)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: '13px', color: 'var(--gray-500)' }}>
                Need help? Check out our <a href="#" style={{ color: 'var(--ardrive-primary)', textDecoration: 'none' }}>getting started guide</a>
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Create Wallet - Set Password */}
        {step === 2 && walletAction === 'create' && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-3)' }}>Secure Your Account</h2>
            <p style={{ fontSize: '16px', color: 'var(--gray-600)', marginBottom: 'var(--space-6)' }}>
              Choose a strong password to encrypt your wallet
            </p>

            <PasswordForm
              password={password}
              confirmPassword={confirmPassword}
              onPasswordChange={setPassword}
              onConfirmPasswordChange={setConfirmPassword}
              passwordTooltip="This password encrypts your wallet file. You'll need it every time you sign in, and it will never leave your computer."
              showStrength={true}
              autoFocus={true}
            />

            <div style={{ 
              backgroundColor: 'var(--warning-50)', 
              padding: 'var(--space-4)', 
              borderRadius: 'var(--radius-md)',
              marginTop: 'var(--space-4)',
              border: '1px solid var(--warning-200)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <Shield size={20} style={{ color: 'var(--warning-600)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: 'var(--space-1)', color: 'var(--warning-900)' }}>
                    Important Security Notice
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--warning-800)', lineHeight: '1.5' }}>
                    There is no way to recover this password if you forget it. Make sure to store it somewhere safe.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
              <button
                className="button outline"
                onClick={prevStep}
                disabled={loading}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="button"
                onClick={handleCreateWallet}
                disabled={loading || !password || !confirmPassword || password !== confirmPassword || password.length < 8}
                style={{ flex: 2 }}
              >
                {loading ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Create Wallet - Show Seed Phrase */}
        {step === 3 && walletAction === 'create' && generatedSeedPhrase && (
          <div className="step-content" style={{ 
            animation: 'fadeIn 0.3s ease-in'
          }}>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Save Your Recovery Phrase</h2>
            <p style={{ fontSize: '15px', color: 'var(--gray-600)', marginBottom: 'var(--space-4)' }}>
              Write down these 12 words in order. You'll need them to recover your wallet.
            </p>

            {/* Address Display - moved up */}
            {generatedAddress && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <AddressDisplay address={generatedAddress} />
              </div>
            )}

            {/* Critical Warning */}
            <div style={{ 
              backgroundColor: 'var(--error-50)', 
              padding: 'var(--space-3)', 
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              border: '1px solid var(--error-200)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <Shield size={18} style={{ color: 'var(--error-600)', flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'var(--error-900)' }}>
                    Critical: Save This Phrase
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--error-800)', lineHeight: '1.4' }}>
                    This is the ONLY way to recover your wallet. If you lose this phrase, you lose access to your funds forever.
                  </p>
                </div>
              </div>
            </div>

            {/* Seed Phrase Display with reduced spacing */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <SeedPhraseDisplay 
                seedPhrase={generatedSeedPhrase} 
                showByDefault={false}
              />
            </div>

            {/* Confirmation Checkbox */}
            <div style={{ 
              backgroundColor: 'var(--gray-50)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-4)'
            }}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 'var(--space-2)', 
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                <input 
                  type="checkbox" 
                  checked={hasConfirmedSeedPhrase}
                  onChange={(e) => setHasConfirmedSeedPhrase(e.target.checked)}
                  style={{ 
                    width: '18px', 
                    height: '18px',
                    cursor: 'pointer'
                  }}
                />
                <span style={{ color: 'var(--gray-800)' }}>
                  I have written down or safely stored my recovery phrase
                </span>
              </label>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                className="button outline"
                onClick={() => {
                  prevStep();
                  setHasConfirmedSeedPhrase(false);
                }}
                disabled={loading}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="button"
                onClick={handleCompleteWalletCreation}
                disabled={loading || !hasConfirmedSeedPhrase}
                style={{ 
                  flex: 2,
                  opacity: hasConfirmedSeedPhrase ? 1 : 0.6,
                  cursor: hasConfirmedSeedPhrase ? 'pointer' : 'not-allowed'
                }}
                title={!hasConfirmedSeedPhrase ? 'Please confirm you have saved your recovery phrase' : ''}
              >
                {loading ? 'Setting up...' : 'Continue to Drive Setup'}
              </button>
            </div>
          </div>
        )}


        {/* Step 2: Import Wallet */}
        {step === 2 && walletAction === 'import' && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Import Your Account</h2>
            <p style={{ fontSize: '15px', color: 'var(--gray-600)', marginBottom: 'var(--space-4)' }}>
              Choose how you'd like to import your existing Arweave wallet
            </p>

            {/* Import Method Toggle */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              <button
                type="button"
                className={`button outline ${importMethod === 'file' ? 'active' : ''}`}
                onClick={() => setImportMethod('file')}
                style={{ 
                  flex: 1,
                  backgroundColor: importMethod === 'file' ? 'var(--ardrive-primary)' : 'transparent',
                  color: importMethod === 'file' ? 'white' : 'var(--gray-700)',
                  borderColor: importMethod === 'file' ? 'var(--ardrive-primary)' : 'var(--gray-300)'
                }}
              >
                <Key size={16} style={{ marginRight: 'var(--space-2)' }} />
                Wallet File
              </button>
              <button
                type="button"
                className={`button outline ${importMethod === 'seedphrase' ? 'active' : ''}`}
                onClick={() => setImportMethod('seedphrase')}
                style={{ 
                  flex: 1,
                  backgroundColor: importMethod === 'seedphrase' ? 'var(--ardrive-primary)' : 'transparent',
                  color: importMethod === 'seedphrase' ? 'white' : 'var(--gray-700)',
                  borderColor: importMethod === 'seedphrase' ? 'var(--ardrive-primary)' : 'var(--gray-300)'
                }}
              >
                <Hexagon size={16} style={{ marginRight: 'var(--space-2)' }} />
                Recovery Phrase
              </button>
            </div>

            {/* File Import */}
            {importMethod === 'file' && (
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ marginBottom: 'var(--space-2)' }}>
                  Select Wallet File
                  <span style={{ fontSize: '13px', color: 'var(--gray-500)', fontWeight: 'normal', marginLeft: 'var(--space-3)' }}>
                    Supports Arweave wallet JSON files only
                  </span>
                </label>
                <div style={{ 
                  border: `2px dashed ${isDragging ? 'var(--ardrive-primary)' : walletPath ? 'var(--ardrive-primary)' : 'var(--gray-300)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-5)',
                  textAlign: 'center',
                  backgroundColor: isDragging ? 'var(--ardrive-primary-light)' : walletPath ? 'var(--primary-50)' : 'var(--gray-50)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => !walletPath && handleSelectWallet()}
                >
                  {walletPath ? (
                    <>
                      <FileText size={28} style={{ color: 'var(--ardrive-primary)', marginBottom: 'var(--space-2)' }} />
                      <p style={{ fontWeight: '600', marginBottom: 'var(--space-1)', fontSize: '15px' }}>{walletPath.split(/[/\\]/).pop()}</p>
                      <p style={{ fontSize: '13px', color: 'var(--gray-500)', marginBottom: 'var(--space-3)' }}>
                        {walletPath}
                      </p>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                        <button
                          className="button small outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectWallet();
                          }}
                          style={{ fontSize: '13px' }}
                        >
                          Change File
                        </button>
                        <button
                          className="button small outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPath();
                          }}
                          style={{ fontSize: '13px' }}
                        >
                          {copiedPath ? (
                            <>
                              <CheckCircle size={14} style={{ marginRight: 'var(--space-1)' }} />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy size={14} style={{ marginRight: 'var(--space-1)' }} />
                              Copy Path
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <FileText size={28} style={{ color: isDragging ? 'var(--ardrive-primary)' : 'var(--gray-400)', marginBottom: 'var(--space-2)' }} />
                      <p style={{ color: 'var(--gray-600)', marginBottom: 'var(--space-2)', fontSize: '15px' }}>
                        {isDragging ? 'Drop your wallet file here' : 'Drop your wallet file here or'}
                      </p>
                      {!isDragging && (
                        <button
                          className="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectWallet();
                          }}
                          style={{ fontSize: '14px' }}
                        >
                          Browse Files
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Seed Phrase Import */}
            {importMethod === 'seedphrase' && (
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ marginBottom: 'var(--space-2)' }}>
                  Enter Recovery Phrase
                  <InfoButton 
                    tooltip="Enter your 12-word recovery phrase, separated by spaces"
                    />
                </label>
                <textarea
                  value={seedPhrase}
                  onChange={(e) => {
                    setSeedPhrase(e.target.value);
                    // Auto-expand based on content
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onFocus={(e) => {
                    // Ensure proper height on focus
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.max(80, e.target.scrollHeight) + 'px';
                  }}
                  placeholder="e.g. stove skate notice turtle crisp ..."
                  style={{ 
                    resize: 'none',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    minHeight: '80px',
                    transition: 'height 0.2s ease',
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--gray-50)',
                    border: `1px solid ${seedPhrase && !validateSeedPhrase(seedPhrase).isValid ? 'var(--danger-500)' : 'var(--gray-300)'}`,
                    borderRadius: 'var(--radius-md)'
                  }}
                />
                {seedPhrase && !validateSeedPhrase(seedPhrase).isValid && (
                  <div style={{ 
                    fontSize: '13px', 
                    color: 'var(--danger-600)', 
                    marginTop: 'var(--space-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}>
                    <Shield size={14} />
                    Your recovery phrase must contain exactly 12 words.
                  </div>
                )}
              </div>
            )}

            {/* Password Fields */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <PasswordForm
                password={password}
                confirmPassword={confirmPassword}
                onPasswordChange={setPassword}
                onConfirmPasswordChange={setConfirmPassword}
                passwordTooltip="Choose a password to encrypt your wallet on this device"
                showStrength={true}
                autoFocus={false}
              />
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <button
                className="button outline"
                onClick={prevStep}
                disabled={loading}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="button"
                onClick={handleImport}
                disabled={
                  loading || !password || !confirmPassword || password.length < 8 || password !== confirmPassword ||
                  (importMethod === 'file' ? !walletPath : !validateSeedPhrase(seedPhrase).isValid)
                }
                style={{ flex: 2 }}
              >
                {loading ? (
                  <>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTop: '2px solid white',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      marginRight: 'var(--space-2)'
                    }} />
                    Importing wallet...
                  </>
                ) : (
                  <>Import Wallet</>
                )}
              </button>
            </div>
          </div>
        )}

      </div>
      
      <style>{`
        .primary-action-button:focus,
        .secondary-action-button:focus {
          outline: 3px solid var(--ardrive-primary);
          outline-offset: 2px;
        }
        
        .primary-action-button:focus:not(:focus-visible),
        .secondary-action-button:focus:not(:focus-visible) {
          outline: none;
        }
        
        @keyframes subtle-pulse {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.05; }
        }
        
        .wallet-setup-container > div:first-child {
          animation: subtle-pulse 20s ease-in-out infinite;
        }
        
        @keyframes fadeIn {
          from { 
            opacity: 0; 
            transform: translateY(10px);
          }
          to { 
            opacity: 1; 
            transform: translateY(0);
          }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        textarea:focus {
          outline: 2px solid var(--ardrive-primary);
          outline-offset: -1px;
          border-color: var(--ardrive-primary);
        }
      `}</style>
    </div>
  );
};

export default WalletSetup;