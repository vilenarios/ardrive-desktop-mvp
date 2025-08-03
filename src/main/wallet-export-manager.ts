import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { app, dialog, clipboard } from 'electron';
import { encryptData, decryptData, EncryptedData } from './crypto-utils';
import { SecureWalletManager } from './wallet-manager-secure';
import { profileManager } from './profile-manager';
// JWK type - ardrive-core-js doesn't export this type
interface JWKInterface {
  kty: string;
  n: string;
  e: string;
  d?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
}
import * as bip39 from 'bip39';

export interface WalletExportOptions {
  format: 'jwk-encrypted' | 'jwk-plain' | 'seed-phrase' | 'private-key';
  password: string;
  newPassword?: string; // For encrypted exports
}

export interface ExportResult {
  success: boolean;
  data?: string;
  error?: string;
  warning?: string;
}

interface ExportAuditLog {
  timestamp: Date;
  profileId: string;
  walletAddress: string;
  exportType: string;
  success: boolean;
  errorMessage?: string;
}

export class WalletExportManager {
  private walletManager: SecureWalletManager;
  private exportAttempts: Map<string, number> = new Map();
  private readonly MAX_EXPORT_ATTEMPTS = 3;
  private readonly ATTEMPT_RESET_TIME = 15 * 60 * 1000; // 15 minutes

  constructor(walletManager: SecureWalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Exports wallet in the specified format after password verification
   */
  async exportWallet(options: WalletExportOptions, profileId: string): Promise<ExportResult> {
    try {
      // Rate limiting check
      if (!this.checkRateLimit(profileId)) {
        return {
          success: false,
          error: 'Too many export attempts. Please wait 15 minutes and try again.'
        };
      }

      // Verify password first
      const isValidPassword = await this.verifyPassword(options.password, profileId);
      if (!isValidPassword) {
        this.recordFailedAttempt(profileId);
        await this.logExportAttempt(profileId, '', options.format, false, 'Invalid password');
        return {
          success: false,
          error: 'Invalid password. Please try again.'
        };
      }

      // Reset rate limit on successful password
      this.resetAttempts(profileId);

      // Get wallet data
      const walletData = await this.getWalletData(profileId, options.password);
      if (!walletData) {
        return {
          success: false,
          error: 'Failed to load wallet data.'
        };
      }

      // Export based on format
      let result: ExportResult;
      switch (options.format) {
        case 'jwk-encrypted':
          result = await this.exportEncryptedJWK(walletData.jwk, options.newPassword || options.password);
          break;
        case 'jwk-plain':
          result = await this.exportPlainJWK(walletData.jwk);
          break;
        case 'seed-phrase':
          result = await this.exportSeedPhrase(walletData.seedPhrase);
          break;
        case 'private-key':
          result = await this.exportPrivateKey(walletData.jwk);
          break;
        default:
          result = {
            success: false,
            error: 'Invalid export format.'
          };
      }

      // Log the export attempt
      await this.logExportAttempt(
        profileId,
        walletData.address,
        options.format,
        result.success,
        result.error
      );

      return result;
    } catch (error) {
      console.error('Wallet export error:', error);
      return {
        success: false,
        error: 'An unexpected error occurred during export.'
      };
    }
  }

  /**
   * Verifies the password for the given profile
   */
  private async verifyPassword(password: string, profileId: string): Promise<boolean> {
    try {
      // Load the wallet with the provided password
      const walletPath = profileManager.getProfileStoragePath(profileId, 'wallet.enc');
      
      const exists = await fs.access(walletPath).then(() => true).catch(() => false);
      if (!exists) return false;

      const encryptedData = await fs.readFile(walletPath, 'utf8');
      const decrypted = await this.walletManager.decryptWallet(encryptedData, password);
      
      return !!decrypted;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  }

  /**
   * Gets wallet data including JWK and seed phrase if available
   */
  private async getWalletData(profileId: string, password: string): Promise<{
    jwk: JWKInterface;
    address: string;
    seedPhrase?: string;
  } | null> {
    try {
      const walletPath = profileManager.getProfileStoragePath(profileId, 'wallet.enc');
      
      const encryptedData = await fs.readFile(walletPath, 'utf8');
      const decrypted = await this.walletManager.decryptWallet(encryptedData, password);
      
      if (!decrypted) return null;

      // Parse the decrypted data
      let walletData: any;
      let jwk: JWKInterface;
      let seedPhrase: string | undefined;
      
      try {
        walletData = JSON.parse(decrypted);
        
        // Check if it's the new format or legacy format
        if (walletData.type === 'arweave' && walletData.metadata) {
          // New format - extract JWK and seed phrase
          jwk = walletData.jwk;
          seedPhrase = walletData.metadata.seedPhrase;
          console.log('Wallet export: New format detected, has seed phrase:', !!seedPhrase);
        } else {
          // Legacy format - the entire object is the JWK
          jwk = walletData;
          seedPhrase = undefined;
          console.log('Wallet export: Legacy format detected, no seed phrase available');
        }
      } catch (e) {
        console.error('Failed to parse wallet data:', e);
        return null;
      }
      
      // Get address
      const address = await this.walletManager.getAddressFromJWK(jwk);
      
      return {
        jwk,
        address,
        seedPhrase
      };
    } catch (error) {
      console.error('Failed to get wallet data:', error);
      return null;
    }
  }

  /**
   * Exports wallet as encrypted JWK file
   */
  private async exportEncryptedJWK(jwk: JWKInterface, password: string): Promise<ExportResult> {
    try {
      const jwkString = JSON.stringify(jwk, null, 2);
      const encrypted = await encryptData(jwkString, password);
      
      const exportData = {
        version: '1.0',
        type: 'ardrive-wallet-encrypted',
        encrypted,
        exportedAt: new Date().toISOString()
      };

      return {
        success: true,
        data: JSON.stringify(exportData, null, 2),
        warning: 'This file contains your encrypted wallet. Keep it safe and remember your password.'
      };
    } catch (error) {
      console.error('Failed to export encrypted JWK:', error);
      return {
        success: false,
        error: 'Failed to encrypt wallet data.'
      };
    }
  }

  /**
   * Exports wallet as plain JWK file (DANGEROUS)
   */
  private async exportPlainJWK(jwk: JWKInterface): Promise<ExportResult> {
    return {
      success: true,
      data: JSON.stringify(jwk, null, 2),
      warning: 'WARNING: This file contains your UNENCRYPTED private key. Anyone with this file can access your wallet and funds. Store it securely and never share it.'
    };
  }

  /**
   * Exports seed phrase (if available)
   */
  private async exportSeedPhrase(seedPhrase?: string): Promise<ExportResult> {
    if (!seedPhrase) {
      return {
        success: false,
        error: 'Seed phrase not available for this wallet.',
        warning: 'This wallet was imported from a JWK file or created before seed phrase storage was implemented. Only wallets created from seed phrases can export their seed phrase.'
      };
    }

    return {
      success: true,
      data: seedPhrase,
      warning: 'WARNING: This seed phrase can restore your entire wallet. Write it down securely and never share it with anyone. Anyone with this phrase can access your funds.'
    };
  }

  /**
   * Exports raw private key (VERY DANGEROUS)
   */
  private async exportPrivateKey(jwk: JWKInterface): Promise<ExportResult> {
    try {
      // Extract the private key component
      const privateKey = jwk.d;
      if (!privateKey) {
        return {
          success: false,
          error: 'Private key not found in wallet.'
        };
      }

      return {
        success: true,
        data: privateKey,
        warning: 'EXTREME WARNING: This is your RAW PRIVATE KEY. It provides complete access to your wallet. Never share it. Store it with extreme security. Consider using encrypted export instead.'
      };
    } catch (error) {
      console.error('Failed to export private key:', error);
      return {
        success: false,
        error: 'Failed to extract private key.'
      };
    }
  }

  /**
   * Rate limiting logic
   */
  private checkRateLimit(profileId: string): boolean {
    const attempts = this.exportAttempts.get(profileId) || 0;
    return attempts < this.MAX_EXPORT_ATTEMPTS;
  }

  private recordFailedAttempt(profileId: string): void {
    const attempts = this.exportAttempts.get(profileId) || 0;
    this.exportAttempts.set(profileId, attempts + 1);

    // Reset after timeout
    setTimeout(() => {
      this.resetAttempts(profileId);
    }, this.ATTEMPT_RESET_TIME);
  }

  private resetAttempts(profileId: string): void {
    this.exportAttempts.delete(profileId);
  }

  /**
   * Audit logging
   */
  private async logExportAttempt(
    profileId: string,
    walletAddress: string,
    exportType: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      const logEntry: ExportAuditLog = {
        timestamp: new Date(),
        profileId,
        walletAddress,
        exportType,
        success,
        errorMessage
      };

      // Log to file
      const logDir = path.join(app.getPath('userData'), 'logs');
      await fs.mkdir(logDir, { recursive: true });
      
      const logFile = path.join(logDir, 'wallet-exports.log');
      const logLine = JSON.stringify(logEntry) + '\n';
      
      await fs.appendFile(logFile, logLine, 'utf8');
      
      // Log to console with redacted address
      const redactedEntry = {
        ...logEntry,
        walletAddress: `${walletAddress.slice(0,4)}...${walletAddress.slice(-4)}`
      };
      console.log('Wallet export audit:', redactedEntry);
    } catch (error) {
      console.error('Failed to log export attempt:', error);
    }
  }

  /**
   * Clears clipboard after a delay (for security)
   */
  static clearClipboardAfterDelay(delayMs: number = 30000): void {
    setTimeout(() => {
      clipboard.clear();
      console.log('Clipboard cleared for security');
    }, delayMs);
  }
}

// Singleton instance
let walletExportManager: WalletExportManager | null = null;

export function initializeWalletExportManager(walletManager: SecureWalletManager): WalletExportManager {
  if (!walletExportManager) {
    walletExportManager = new WalletExportManager(walletManager);
  }
  return walletExportManager;
}

export function getWalletExportManager(): WalletExportManager {
  if (!walletExportManager) {
    throw new Error('WalletExportManager not initialized');
  }
  return walletExportManager;
}