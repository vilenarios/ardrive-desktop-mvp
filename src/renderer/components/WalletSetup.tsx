import React, { useState, useRef } from 'react';
import { Wallet, Shield, AlertTriangle, ArrowRight, FileText, FileJson, KeyRound, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { InfoButton } from './common/InfoButton';
import { PasswordForm } from './common/PasswordForm';
import { SeedPhraseDisplay } from './common/SeedPhraseDisplay';
import { AddressDisplay } from './common/AddressDisplay';
import { ClientInputValidator } from '../input-validator';
import { useTheme } from '../contexts/ThemeContext';

interface WalletSetupProps {
  onWalletImported: () => void;
}

// COPY-11: Create and Import used to show two different explanations of what
// this password does/doesn't cover ("never leaves your computer" only
// appeared on the Create flow) — a non-crypto user reading both would
// reasonably wonder if they behave differently. One shared string for both.
const PASSWORD_TOOLTIP =
  "This password encrypts your wallet file. You'll need it every time you sign in, and it will never leave your computer.";

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
  // TRUST-3: the "must contain exactly 12 words" error used to render on
  // literally every keystroke (red border from the first character typed).
  // Only surface the inline error once the user has actually left the field
  // or attempted to submit — while typing, show a neutral word count instead.
  const [seedPhraseTouched, setSeedPhraseTouched] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Confirmation state
  const [hasConfirmedSeedPhrase, setHasConfirmedSeedPhrase] = useState(false);

  // Dev mode auto-fill for faster testing
  React.useEffect(() => {
    const checkDevMode = async () => {
      const isDevModeResult = await window.electronAPI.system.getEnv('ARDRIVE_DEV_MODE');
      const devWalletPathResult = await window.electronAPI.system.getEnv('ARDRIVE_DEV_WALLET_PATH');
      const devPasswordResult = await window.electronAPI.system.getEnv('ARDRIVE_DEV_PASSWORD');
      const isDevMode = isDevModeResult.success ? isDevModeResult.data : undefined;
      const devWalletPath = devWalletPathResult.success ? devWalletPathResult.data : undefined;
      const devPassword = devPasswordResult.success ? devPasswordResult.data : undefined;

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
    setSeedPhraseTouched(false);
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
    setGeneratedSeedPhrase(null);
    setGeneratedAddress(null);
  }, [walletAction]);

  const handleSelectWallet = async () => {
    try {
      const result = await window.electronAPI.dialog.selectWallet();
      const selectedPath = result.success ? result.data : null;
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
      
      // Generate wallet and seed phrase (UX-3: unwrap envelope — business
      // errors now resolve as {success:false}, they no longer reject, so this
      // must branch on .success rather than relying on the catch block).
      const result = await window.electronAPI.wallet.generate(password);
      if (!result.success) {
        throw new Error(result.error || 'Failed to create account');
      }

      setGeneratedSeedPhrase(result.data.seedPhrase);
      setGeneratedAddress(result.data.address);
      nextStep();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteWalletCreation = async () => {
    // SEC (wallet-safety): the backup step is MANDATORY. Persistence of the
    // account (and thus reaching the dashboard) must never happen until the
    // user has explicitly confirmed they saved their recovery phrase. The
    // submit button below is already disabled until `hasConfirmedSeedPhrase`,
    // but this guard makes the invariant hold at the handler level too, so a
    // future refactor that changes the button can't silently reopen a bypass.
    if (!hasConfirmedSeedPhrase) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // UX-20: persistence (profile + encrypted wallet) actually happens here,
      // now that the user has confirmed they saved their recovery phrase.
      // UX-3: IpcResult envelope — branch on .success (business failures
      // resolve, they don't reject).
      const result = await window.electronAPI.wallet.completeSetup();
      if (!result.success) {
        throw new Error(result.error || 'Failed to complete account setup');
      }

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
        
        // Import account from JWK file (UX-3: unwrap envelope — a failed
        // import now resolves as {success:false} instead of rejecting, so we
        // must re-throw to keep the error visible to the user).
        const importResult = await window.electronAPI.wallet.importFromKeyfile(walletPath, password);
        if (!importResult.success) {
          throw new Error(importResult.error || 'Failed to import account');
        }
      } else {
        // Import account from recovery phrase
        const seedValidation = validateSeedPhrase(seedPhrase);
        if (!seedValidation.isValid) {
          setSeedPhraseTouched(true); // surface the inline field error too, on submit
          setError(seedValidation.error!);
          return;
        }

        const importResult = await window.electronAPI.wallet.importFromSeedPhrase(seedPhrase.trim(), password);
        if (!importResult.success) {
          throw new Error(importResult.error || 'Failed to import account');
        }
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
            <h1 style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
              Welcome to ArDrive Desktop
              <InfoButton tooltip="Your ArDrive account is powered by a cryptographic wallet, not a company login. There's no 'forgot password' email reset. Your wallet plus your recovery phrase together are your account." />
            </h1>
            {/* A <div>, not a <p>: InfoButton renders a block-level wrapper,
                and a <div> inside a <p> gets implicitly (and invisibly)
                closed by the HTML parser -- this row needs the same visual
                treatment as body text without that structural trap. */}
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-8)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
              Store your files permanently on the decentralized web
              <InfoButton tooltip="Once uploaded to Arweave, files can't be edited or deleted by you or anyone else, including ArDrive. That's the point: your files outlive any single company or server." />
            </div>

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
                Need help? Check out our{' '}
                <a
                  href="https://docs.ardrive.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--brand)', textDecoration: 'none' }}
                >
                  getting started guide
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Create Account - Set Password */}
        {step === 2 && walletAction === 'create' && (
          <div className="step-content">
            <h1 style={{ marginBottom: 'var(--space-3)' }}>Secure Your Account</h1>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
              Choose a strong password to encrypt your account
            </p>

            <PasswordForm
              password={password}
              confirmPassword={confirmPassword}
              onPasswordChange={setPassword}
              onConfirmPasswordChange={setConfirmPassword}
              passwordTooltip={PASSWORD_TOOLTIP}
              showStrength={true}
              // POLISH-1: autoFocus used to land the very first thing a new
              // user sees on a solid red outline (--focus-ring shares the
              // danger hue) before they've typed anything or made a mistake.
              autoFocus={false}
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
                    If you forget this password, your recovery phrase (shown next) can restore access with a new
                    password — but there&apos;s no way to reset just the password itself. Keep both safe.
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
            <h1 style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}>
              Save Your Recovery Phrase
              <InfoButton tooltip="A recovery phrase (sometimes called a seed phrase) is a list of 12 words that can restore full access to your wallet. Anyone who has it can access your files. Never share it or type it into a website." />
            </h1>
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
                {/* POLISH-5: was the same Shield glyph used by the milder
                    "Important Security Notice" advisory boxes elsewhere on
                    this screen — AlertTriangle distinguishes "irreversible,
                    critical" from "important, advisory" at a glance. */}
                <AlertTriangle size={18} style={{ color: 'var(--danger-fg)', flexShrink: 0, marginTop: '1px' }} />
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
            <h1 style={{ marginBottom: 'var(--space-2)' }}>Import Your Account</h1>
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
                <FileJson size={16} />
                Wallet File
              </button>
              <button
                type="button"
                className={importMethod === 'seedphrase' ? 'button' : 'button outline'}
                onClick={() => setImportMethod('seedphrase')}
                style={{ flex: 1 }}
              >
                <KeyRound size={16} />
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
                  role="button"
                  tabIndex={0}
                  aria-label={walletPath ? `Selected wallet file: ${walletPath.split(/[/\\]/).pop()}` : 'Browse for a wallet file, or drag and drop one here'}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !walletPath) {
                      e.preventDefault();
                      handleSelectWallet();
                    }
                  }}
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
            {importMethod === 'seedphrase' && (() => {
              // TRUST-3: two bugs lived here. (1) The inline error hardcoded
              // "exactly 12 words" while it rendered on every keystroke, so
              // the single most sensitive field in the app was red for ~95%
              // of normal typing. Fix: reuse the validator's own message
              // instead of a hand-written string, and only show it once the
              // field has been left (blur) or submit was attempted --
              // otherwise show a neutral word count.
              // UX-34: the copy and ClientInputValidator.validateSeedPhrase
              // (input-validator.ts) used to also accept/advertise 24 words,
              // but ardrive-core-js's SeedPhrase only ever derives an Arweave
              // wallet from a 12-word BIP-39 phrase (see wallet-manager-secure.ts
              // and node_modules/ardrive-core-js SeedPhrase, regex `{12}`) — a
              // 24-word phrase always failed closed at derivation with "...
              // exactly 12 words", even though this screen said it would work.
              // Both the copy and the validator now expect 12 words only, so
              // the UI never invites input it will then reject.
              const seedValidation = validateSeedPhrase(seedPhrase);
              const seedWordCount = seedPhrase.trim() ? seedPhrase.trim().split(/\s+/).length : 0;
              const showSeedError = seedPhraseTouched && seedPhrase.length > 0 && !seedValidation.isValid;

              return (
              <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="recovery-phrase-input" style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  Enter Recovery Phrase
                  <InfoButton
                    tooltip="A recovery phrase (also called a seed phrase) is 12 words that fully control your wallet. Keep it secret. ArDrive will never ask you for it outside this screen."
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
                    id="recovery-phrase-input"
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
                    onBlur={() => setSeedPhraseTouched(true)}
                    placeholder="Enter your 12-word recovery phrase, separated by spaces"
                    aria-invalid={showSeedError}
                    className={
                      'seed-phrase-textarea' +
                      (showSeedPhraseText ? ' revealed' : '') +
                      (showSeedError ? ' invalid' : '')
                    }
                  />
                </div>

                {showSeedError ? (
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--danger-fg)',
                    marginTop: 'var(--space-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)'
                  }}>
                    <Shield size={14} />
                    {seedValidation.error}
                  </div>
                ) : seedPhrase.length > 0 && (
                  <div style={{
                    fontSize: '13px',
                    color: 'var(--text-tertiary)',
                    marginTop: 'var(--space-2)'
                  }}>
                    {seedWordCount} word{seedWordCount === 1 ? '' : 's'} entered (12 expected)
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
              );
            })()}

            {/* Password Fields */}
            <div style={{ marginTop: 'var(--space-4)' }}>
              <PasswordForm
                password={password}
                confirmPassword={confirmPassword}
                onPasswordChange={setPassword}
                onConfirmPasswordChange={setConfirmPassword}
                passwordTooltip={PASSWORD_TOOLTIP}
                showStrength={true}
                autoFocus={false}
              />
            </div>

            {/* Security Warning */}
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
                    If you forget this password, you can restore access anytime using your wallet file or recovery
                    phrase to set a new one — but there&apos;s no way to reset just the password itself. Keep them safe.
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

            {/* POLISH-10: Create Account had this reassurance during its
                (similarly crypto-derivation-bound) loading state; Import had
                none, despite the button already showing a spinner. */}
            {loading && (
              <div style={{
                marginTop: 'var(--space-3)',
                textAlign: 'center',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                animation: 'fadeIn 0.5s ease-in'
              }}>
                This may take a moment while we import and encrypt your wallet...
              </div>
            )}
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