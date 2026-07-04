import React, { useState, useRef } from 'react';
import { Wallet, Shield, ArrowRight, FileText, Key, Hexagon, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { InfoButton } from './common/InfoButton';
import { PasswordForm } from './common/PasswordForm';
import { SeedPhraseDisplay } from './common/SeedPhraseDisplay';
import { AddressDisplay } from './common/AddressDisplay';
import { ClientInputValidator } from '../input-validator';
import { useTheme } from '../contexts/ThemeContext';

interface WalletSetupProps {
  onWalletImported: () => void;
}

const WalletSetup: React.FC<WalletSetupProps> = ({ onWalletImported }) => {
  const { theme } = useTheme();
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
      
      <div className="wallet-setup-card">
        {/* Header with Logo */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          {/* Wordmark asset naming is text-color-based, not theme-based: "Dark"
              = dark text (for the light/--surface-raised card), "Light" =
              light text (for the dark card). Swap on the resolved theme so
              the wordmark stays legible on --surface-raised in both. */}
          <img
            src={theme === 'dark' ? 'ArDrive-Logo-Wordmark-Light.png' : 'ArDrive-Logo-Wordmark-Dark.png'}
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
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-8)', textAlign: 'center' }}>
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
              borderTop: '1px solid var(--border)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                Need help? Check out our <a href="#" style={{ color: 'var(--brand)', textDecoration: 'none' }}>getting started guide</a>
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Create Account - Set Password */}
        {step === 2 && walletAction === 'create' && (
          <div className="step-content">
            <h2 style={{ marginBottom: 'var(--space-3)' }}>Secure Your Account</h2>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
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
              backgroundColor: 'var(--warning-surface)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              marginTop: 'var(--space-4)',
              border: '1px solid var(--warning)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <Shield size={20} style={{ color: 'var(--warning-fg)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: 'var(--space-1)', color: 'var(--warning-fg)' }}>
                    Important Security Notice
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--warning-fg)', lineHeight: '1.5' }}>
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
                      border: '2px solid var(--spinner-track-on-brand)',
                      borderTop: '2px solid var(--text-on-brand)',
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
                color: 'var(--text-secondary)',
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
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Write down these 12 words in order. You&apos;ll need them to recover your account.
            </p>

            {/* Address Display - moved up */}
            {generatedAddress && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <AddressDisplay address={generatedAddress} />
              </div>
            )}

            {/* Critical Warning */}
            <div style={{
              backgroundColor: 'var(--danger-surface)',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              border: '1px solid var(--danger)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                <Shield size={18} style={{ color: 'var(--danger-fg)', flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '2px', color: 'var(--danger-fg)' }}>
                    Critical: Save This Phrase
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--danger-fg)', lineHeight: '1.4' }}>
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
              backgroundColor: 'var(--surface-inset)',
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
                  className="seed-confirm-checkbox"
                  checked={hasConfirmedSeedPhrase}
                  onChange={(e) => setHasConfirmedSeedPhrase(e.target.checked)}
                />
                <span style={{ color: 'var(--text-primary)' }}>
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
            <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Choose how you&apos;d like to import your existing Arweave wallet
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
                  <span style={{ fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: 'normal', marginLeft: 'var(--space-3)' }}>
                    Arweave wallet (.json) files only
                  </span>
                </label>
                <div
                  className={`wallet-dropzone${isDragging ? ' is-dragging' : ''}${walletPath ? ' has-file' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => !walletPath && handleSelectWallet()}
                >
                  {walletPath ? (
                    <>
                      <FileText size={28} className="wallet-dropzone-icon" style={{ marginBottom: 'var(--space-2)' }} />
                      <p style={{ fontWeight: '600', marginBottom: 'var(--space-1)', fontSize: '15px' }}>{walletPath.split(/[/\\]/).pop()}</p>
                      <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
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
                      <FileText size={28} className="wallet-dropzone-icon" style={{ marginBottom: 'var(--space-2)' }} />
                      <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-2)', fontSize: '15px' }}>
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
                    className="seed-privacy-toggle"
                    onClick={() => setShowSeedPhraseText(!showSeedPhraseText)}
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
                    className={
                      'seed-phrase-textarea' +
                      (showSeedPhraseText ? ' revealed' : '') +
                      (seedPhrase && !validateSeedPhrase(seedPhrase).isValid ? ' invalid' : '')
                    }
                  />
                </div>

                {seedPhrase && !validateSeedPhrase(seedPhrase).isValid && (
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--danger-fg)',
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
                  color: 'var(--text-tertiary)',
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
              backgroundColor: 'var(--warning-surface)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              marginTop: 'var(--space-4)',
              border: '1px solid var(--warning)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <Shield size={20} style={{ color: 'var(--warning-fg)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: 'var(--space-1)', color: 'var(--warning-fg)' }}>
                    Important Security Notice
                  </h4>
                  <p style={{ fontSize: '13px', color: 'var(--warning-fg)', lineHeight: '1.5' }}>
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
                      border: '2px solid var(--spinner-track-on-brand)',
                      borderTop: '2px solid var(--text-on-brand)',
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
      `}</style>
    </div>
  );
};

export default WalletSetup;