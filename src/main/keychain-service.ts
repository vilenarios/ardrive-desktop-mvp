import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { profileManager } from './profile-manager';
import { encryptData, decryptData } from './crypto-utils';

// Service name for keychain storage
const SERVICE_NAME = 'ArDrive Desktop';
const FALLBACK_FILE = 'keychain-fallback.enc';

// Track keychain availability
let keychainAvailable = false;
let keytar: any = null;

// Try to load keytar dynamically
try {
  keytar = require('keytar');
  keychainAvailable = true;
  console.log('Keychain service: keytar loaded successfully');
} catch (error) {
  console.log('Keychain service: keytar not available, using encrypted file fallback');
}

export interface KeychainItem {
  service: string;
  account: string;
  password: string;
}

export class KeychainService {
  private static instance: KeychainService;
  private fallbackKey: Buffer | null = null;
  
  private constructor() {
    // Generate a machine-specific key for fallback encryption
    this.initializeFallbackKey();
  }
  
  static getInstance(): KeychainService {
    if (!KeychainService.instance) {
      KeychainService.instance = new KeychainService();
    }
    return KeychainService.instance;
  }
  
  /**
   * Check if OS keychain is available
   */
  isKeychainAvailable(): boolean {
    return keychainAvailable && keytar !== null;
  }
  
  /**
   * Get the current security method being used
   */
  getSecurityMethod(): 'keychain' | 'fallback' {
    return this.isKeychainAvailable() ? 'keychain' : 'fallback';
  }
  
  /**
   * Store a password in the OS keychain or fallback storage
   */
  async setPassword(account: string, password: string): Promise<void> {
    try {
      if (this.isKeychainAvailable()) {
        // Use OS keychain
        await keytar.setPassword(SERVICE_NAME, account, password);
        console.log(`Keychain service: Stored password for ${account} in OS keychain`);
      } else {
        // Use encrypted file fallback
        await this.setPasswordFallback(account, password);
        console.log(`Keychain service: Stored password for ${account} in encrypted fallback`);
      }
    } catch (error) {
      console.error('Keychain service: Failed to store password:', error);
      // If keychain fails, try fallback
      if (this.isKeychainAvailable()) {
        console.log('Keychain service: Falling back to encrypted file storage');
        await this.setPasswordFallback(account, password);
      } else {
        throw error;
      }
    }
  }
  
  /**
   * Retrieve a password from the OS keychain or fallback storage
   */
  async getPassword(account: string): Promise<string | null> {
    try {
      if (this.isKeychainAvailable()) {
        // Try OS keychain first
        const password = await keytar.getPassword(SERVICE_NAME, account);
        if (password) {
          console.log(`Keychain service: Retrieved password for ${account} from OS keychain`);
          return password;
        }
      }
      
      // Try fallback (also handles migration from fallback to keychain)
      const fallbackPassword = await this.getPasswordFallback(account);
      if (fallbackPassword && this.isKeychainAvailable()) {
        // Migrate to keychain if available
        try {
          await keytar.setPassword(SERVICE_NAME, account, fallbackPassword);
          console.log(`Keychain service: Migrated ${account} from fallback to OS keychain`);
          // Remove from fallback after successful migration
          await this.deletePasswordFallback(account);
        } catch (migrationError) {
          console.error('Keychain service: Migration failed, keeping fallback:', migrationError);
        }
      }
      
      return fallbackPassword;
    } catch (error) {
      console.error('Keychain service: Failed to retrieve password:', error);
      return null;
    }
  }
  
  /**
   * Delete a password from storage
   */
  async deletePassword(account: string): Promise<boolean> {
    let deleted = false;
    
    try {
      // Delete from keychain if available
      if (this.isKeychainAvailable()) {
        deleted = await keytar.deletePassword(SERVICE_NAME, account);
        if (deleted) {
          console.log(`Keychain service: Deleted password for ${account} from OS keychain`);
        }
      }
      
      // Also delete from fallback
      const fallbackDeleted = await this.deletePasswordFallback(account);
      deleted = deleted || fallbackDeleted;
      
      return deleted;
    } catch (error) {
      console.error('Keychain service: Failed to delete password:', error);
      return false;
    }
  }
  
  /**
   * Find all stored credentials
   */
  async findCredentials(): Promise<KeychainItem[]> {
    const items: KeychainItem[] = [];
    
    try {
      // Get from keychain if available
      if (this.isKeychainAvailable()) {
        const keychainItems = await keytar.findCredentials(SERVICE_NAME);
        items.push(...keychainItems.map((item: any) => ({
          service: SERVICE_NAME,
          account: item.account,
          password: item.password
        })));
      }
      
      // Also get from fallback
      const fallbackItems = await this.findCredentialsFallback();
      
      // Merge, preferring keychain items
      const accountsInKeychain = new Set(items.map(item => item.account));
      for (const fallbackItem of fallbackItems) {
        if (!accountsInKeychain.has(fallbackItem.account)) {
          items.push(fallbackItem);
        }
      }
      
      return items;
    } catch (error) {
      console.error('Keychain service: Failed to find credentials:', error);
      return [];
    }
  }
  
  // Fallback implementation using encrypted file storage
  
  private async initializeFallbackKey(): Promise<void> {
    try {
      // Use machine ID and app path to generate a unique key
      const machineId = app.getPath('userData');
      const keyMaterial = `${SERVICE_NAME}-${machineId}-${process.platform}`;
      this.fallbackKey = crypto.createHash('sha256').update(keyMaterial).digest();
    } catch (error) {
      console.error('Keychain service: Failed to initialize fallback key:', error);
      // Use a basic fallback
      this.fallbackKey = crypto.createHash('sha256').update(SERVICE_NAME).digest();
    }
  }
  
  private getFallbackPath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, FALLBACK_FILE);
  }
  
  private async loadFallbackData(): Promise<Record<string, string>> {
    try {
      const fallbackPath = this.getFallbackPath();
      const encryptedData = await fs.readFile(fallbackPath, 'utf8');
      
      if (!this.fallbackKey) {
        throw new Error('Fallback key not initialized');
      }
      
      // Use simple encryption for fallback (not as secure as main wallet encryption)
      const decrypted = await decryptData(
        JSON.parse(encryptedData),
        this.fallbackKey.toString('hex')
      );
      
      return JSON.parse(decrypted);
    } catch (error) {
      // File doesn't exist or is corrupted, return empty
      return {};
    }
  }
  
  private async saveFallbackData(data: Record<string, string>): Promise<void> {
    try {
      const fallbackPath = this.getFallbackPath();
      
      if (!this.fallbackKey) {
        throw new Error('Fallback key not initialized');
      }
      
      const encrypted = await encryptData(
        JSON.stringify(data),
        this.fallbackKey.toString('hex')
      );
      
      await fs.writeFile(fallbackPath, JSON.stringify(encrypted), 'utf8');
    } catch (error) {
      console.error('Keychain service: Failed to save fallback data:', error);
      throw error;
    }
  }
  
  private async setPasswordFallback(account: string, password: string): Promise<void> {
    const data = await this.loadFallbackData();
    data[account] = password;
    await this.saveFallbackData(data);
  }
  
  private async getPasswordFallback(account: string): Promise<string | null> {
    const data = await this.loadFallbackData();
    return data[account] || null;
  }
  
  private async deletePasswordFallback(account: string): Promise<boolean> {
    const data = await this.loadFallbackData();
    if (account in data) {
      delete data[account];
      await this.saveFallbackData(data);
      return true;
    }
    return false;
  }
  
  private async findCredentialsFallback(): Promise<KeychainItem[]> {
    const data = await this.loadFallbackData();
    return Object.entries(data).map(([account, password]) => ({
      service: SERVICE_NAME,
      account,
      password
    }));
  }
  
  /**
   * Clear all stored credentials (for logout/reset)
   */
  async clearAll(): Promise<void> {
    try {
      // Clear from keychain
      if (this.isKeychainAvailable()) {
        const items = await keytar.findCredentials(SERVICE_NAME);
        for (const item of items) {
          await keytar.deletePassword(SERVICE_NAME, item.account);
        }
      }
      
      // Clear fallback
      const fallbackPath = this.getFallbackPath();
      await fs.unlink(fallbackPath).catch(() => {}); // Ignore if doesn't exist
      
      console.log('Keychain service: Cleared all stored credentials');
    } catch (error) {
      console.error('Keychain service: Failed to clear credentials:', error);
    }
  }
}

// Export singleton instance
export const keychainService = KeychainService.getInstance();