import React, { useState, useRef } from 'react';
import { Wallet, Shield, ArrowRight, FileText, Key, Hexagon, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';
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
  const [showSeedPhraseText, setShowSeedPhraseText] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Confirmation state
  const [hasConfirmedSeedPhrase, setHasConfirmedSeedPhrase] = useState(false);

  // Dev mode auto-fill for faster testing
  React.useEffect(() => {
    const checkDevMode = async () => {
      const isDevMode = await window.electronAPI.system.getEnv('ARDRIVE_DEV_MODE');
      const devWalletPath = await window.electronAPI.system.getEnv('ARDRIVE_DEV_WALLET_PATH');
      const devPassword = await window.electronAPI.system.getEnv('ARDRIVE_DEV_PASSWORD');
      
      if (isDevMode === 'true' && walletAction === 'import' && step === 2) {
        if (devWalletPath) {
          setWalletPath(devWalletPath);
          setImportMethod('file');
        }
        if (devPassword) {
          setPassword(devPassword);
          setConfirmPassword(devPassword);
        }
      }
    };
    
    checkDevMode();
  }, [walletAction, step]);

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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select wallet file');
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
      nextStep();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
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
      
      // Navigate immediately - no need for success message
      onWalletImported();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete account setup');
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
        
        // Import account from JWK file
        await window.electronAPI.wallet.importFromKeyfile(walletPath, password);
      } else {
        // Import account from recovery phrase
        const seedValidation = validateSeedPhrase(seedPhrase);
        if (!seedValidation.isValid) {
          setError(seedValidation.error!);
          return;
        }
        
        await window.electronAPI.wallet.importFromSeedPhrase(seedPhrase.trim(), password);
      }
      
      // Navigate immediately - no need for success message
      onWalletImported();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import account');
    } finally {
      setLoading(false);
    }
  };

  // Step navigation
  const nextStep = () => setStep(step + 1);
  const prevStep = () => setStep(step - 1);

  return (
    <div style={{
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      {/* Background - Permahills */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 1,
        pointerEvents: 'none',
        backgroundImage: 'url(permahills_background.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}>
      </div>
      
      <div className="wallet-setup-card" style={{
        position: 'relative',
        backgroundColor: 'white',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-10)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.08), 0 10px 20px rgba(0, 0, 0, 0.05)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        maxWidth: '520px',
        width: '100%',
        margin: 'var(--space-8)',
        zIndex: 2
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

        {/* Step 1: Choose Action */}
        {step === 1 && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-6)' }}>Welcome to ArDrive Desktop</h2>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--gray-600)', marginBottom: 'var(--space-8)', textAlign: 'center' }}>
              Store your files permanently on the decentralized web
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <button
                className="button large"
                onClick={() => {
                  setWalletAction('create');
                  setStep(2);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  width: '100%'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Wallet size={20} />
                  <span>Create New Account</span>
                  <ArrowRight size={16} />
                </div>
                <span style={{ fontSize: 'var(--text-xs)', opacity: 0.9 }}>
                  Get started with a new account
                </span>
              </button>

              <button
                className="button outline large"
                onClick={() => {
                  setWalletAction('import');
                  setStep(2);
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  width: '100%'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <FileText size={20} />
                  <span>Import Existing Account</span>
                  <ArrowRight size={16} />
                </div>
                <span style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>
                  Use your wallet file or recovery phrase
                </span>
              </button>
            </div>

            <div style={{
              marginTop: 'var(--space-8)',
              paddingTop: 'var(--space-6)',
              borderTop: '1px solid var(--gray-200)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>
                Need help? Check out our <a href="#" style={{ color: 'var(--ardrive-primary)', textDecoration: 'none' }}>getting started guide</a>
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Create Account - Set Password */}
        {step === 2 && walletAction === 'create' && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-3)' }}>Secure Your Account</h2>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--gray-600)', marginBottom: 'var(--space-6)' }}>
              Choose a strong password to encrypt your account
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
                {loading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTop: '2px solid white',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }} />
                    <span>Creating your account...</span>
                  </div>
                ) : (
                  'Create Account'
                )}
              </button>
            </div>
            
            {loading && (
              <div style={{ 
                marginTop: 'var(--space-3)', 
                textAlign: 'center',
                fontSize: '13px',
                color: 'var(--gray-600)',
                animation: 'fadeIn 0.5s ease-in'
              }}>
                This may take a moment while we generate your secure wallet...
              </div>
            )}
          </div>
        )}

        {/* Step 3: Create Account - Show Recovery Phrase */}
        {step === 3 && walletAction === 'create' && generatedSeedPhrase && (
          <div className="step-content" style={{ 
            animation: 'fadeIn 0.3s ease-in'
          }}>
            <h2 style={{ marginBottom: 'var(--space-2)' }}>Save Your Recovery Phrase</h2>
            <p style={{ fontSize: '15px', color: 'var(--gray-600)', marginBottom: 'var(--space-4)' }}>
              Write down these 12 words in order. You'll need them to recover your account.
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
                    This is the ONLY way to recover your account. If you lose this phrase, you lose access to your files forever.
                  </p>
                </div>
              </div>
            </div>

            {/* Seed Phrase Display with reduced spacing */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <SeedPhraseDisplay 
                seedPhrase={generatedSeedPhrase} 
                showByDefault={false}
                allowCopyWhenHidden={true}
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


        {/* Step 2: Import Account */}
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
                className={importMethod === 'file' ? 'button' : 'button outline'}
                onClick={() => setImportMethod('file')}
                style={{ flex: 1 }}
              >
                <Key size={16} />
                Wallet File
              </button>
              <button
                type="button"
                className={importMethod === 'seedphrase' ? 'button' : 'button outline'}
                onClick={() => setImportMethod('seedphrase')}
                style={{ flex: 1 }}
              >
                <Hexagon size={16} />
                Recovery Phrase
              </button>
            </div>

            {/* File Import */}
            {importMethod === 'file' && (
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ marginBottom: 'var(--space-2)' }}>
                  Select Wallet File
                  <span style={{ fontSize: '13px', color: 'var(--gray-500)', fontWeight: 'normal', marginLeft: 'var(--space-3)' }}>
                    Arweave wallet (.json) files only
                  </span>
                </label>
                <div style={{ 
                  border: `2px dashed ${isDragging ? 'var(--ardrive-primary)' : walletPath ? 'var(--ardrive-primary)' : 'var(--gray-300)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-5)',
                  textAlign: 'center',
                  backgroundColor: isDragging ? 'var(--ardrive-primary-100)' : walletPath ? 'var(--ardrive-primary-50)' : 'var(--gray-50)',
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
                        >
                          Change File
                        </button>
                        <button
                          className="button small outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyPath();
                          }}
                        >
                          {copiedPath ? (
                            <>
                              <CheckCircle size={14} />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy size={14} />
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
                <label style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  Enter Recovery Phrase
                  <InfoButton 
                    tooltip="Enter your 12-word recovery phrase, separated by spaces"
                  />
                </label>
                
                {/* Enhanced Seed Phrase Input */}
                <div style={{ position: 'relative' }}>
                  {/* Privacy Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowSeedPhraseText(!showSeedPhraseText)}
                    style={{
                      position: 'absolute',
                      top: 'var(--space-3)',
                      right: 'var(--space-3)',
                      padding: 'var(--space-2)',
                      backgroundColor: 'white',
                      border: '1px solid var(--gray-300)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      fontSize: '13px',
                      color: 'var(--gray-600)',
                      zIndex: 1,
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--gray-50)';
                      e.currentTarget.style.borderColor = 'var(--gray-400)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'white';
                      e.currentTarget.style.borderColor = 'var(--gray-300)';
                    }}
                  >
                    {showSeedPhraseText ? (
                      <>
                        <EyeOff size={16} />
                        Hide
                      </>
                    ) : (
                      <>
                        <Eye size={16} />
                        Show
                      </>
                    )}
                  </button>

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
                      e.target.style.height = Math.max(120, e.target.scrollHeight) + 'px';
                    }}
                    placeholder="Enter your 12-word recovery phrase separated by spaces"
                    style={{ 
                      resize: 'none',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '16px',
                      lineHeight: '1.8',
                      minHeight: '120px',
                      transition: 'all 0.2s ease',
                      padding: 'var(--space-4)',
                      paddingRight: '100px', // Space for the privacy toggle
                      backgroundColor: 'white',
                      border: `2px solid ${seedPhrase && !validateSeedPhrase(seedPhrase).isValid ? 'var(--danger-400)' : 'var(--gray-300)'}`,
                      borderRadius: 'var(--radius-md)',
                      // @ts-ignore - WebKit specific property
                      WebkitTextSecurity: showSeedPhraseText ? 'none' : 'disc',
                      color: showSeedPhraseText ? 'var(--gray-900)' : 'var(--gray-600)'
                    }}
                    onMouseEnter={(e) => {
                      if (!seedPhrase || validateSeedPhrase(seedPhrase).isValid) {
                        e.currentTarget.style.borderColor = 'var(--gray-400)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!seedPhrase || validateSeedPhrase(seedPhrase).isValid) {
                        e.currentTarget.style.borderColor = 'var(--gray-300)';
                      }
                    }}
                  />
                </div>

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
                    Your recovery phrase must contain exactly 12 words
                  </div>
                )}

                {/* Help text */}
                <div style={{
                  marginTop: 'var(--space-2)',
                  fontSize: '13px',
                  color: 'var(--gray-500)',
                  lineHeight: '1.5'
                }}>
                  Your recovery phrase is case-sensitive and should be entered exactly as it was provided to you.
                </div>
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

            {/* Security Warning - Same as Create Account */}
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