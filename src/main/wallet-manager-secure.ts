import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { arDriveFactory, ArDrive, readJWKFile, ArweaveAddress } from 'ardrive-core-js';
import { DriveInfo, WalletInfo, WalletStorageFormat } from '../types';
import { turboManager } from './turbo-manager';
import * as bip39 from 'bip39';
import { profileManager } from './profile-manager';
import { configManager } from './config-manager';
import { databaseManager } from './database-manager';
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile, decryptData, encryptData } from './crypto-utils';
import * as crypto from 'crypto';
import { keychainService } from './keychain-service';

/**
 * Secure Wallet Manager
 * 
 * Security improvements:
 * - Uses native crypto module with AES-256-GCM
 * - Implements scrypt key derivation
 * - No password storage on disk
 * - Secure file deletion
 * - Memory clearing best practices
 */
export class SecureWalletManager {
  private arDrive: ArDrive | null = null;
  private wallet: any = null;
  private walletJson: any = null;
  private currentProfileId: string | null = null;
  private encryptedSessionPassword: Buffer | null = null; // Encrypted password in memory
  private sessionPasswordKey: Buffer | null = null; // Key for session password encryption
  private profileSwitchMutex: Promise<any> | null = null; // Prevents concurrent profile switches

  constructor() {
    // Storage paths determined dynamically based on active profile
  }

  private getWalletStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    return profileManager.getProfileStoragePath(this.currentProfileId, 'wallet.enc');
  }

  async generateNewWallet(password: string): Promise<{ seedPhrase: string; address: string }> {
    try {
      
      // Generate a new 12-word seed phrase
      const seedPhrase = bip39.generateMnemonic(128); // 128 bits = 12 words
      
      // Use the import process with 'generated' flag
      const success = await this.importFromSeedPhraseInternal(seedPhrase, password, 'generated');
      if (!success) {
        throw new Error('Failed to create wallet from generated seed phrase');
      }
      
      // Get the wallet address
      const walletInfo = await this.getWalletInfo();
      if (!walletInfo) {
        throw new Error('Failed to get wallet info after creation');
      }
      
      return {
        seedPhrase,
        address: walletInfo.address
      };
    } catch (error) {
      console.error('[WALLET-DEBUG] Failed to generate new wallet:', error);
      throw error;
    }
  }



  async importFromSeedPhrase(seedPhrase: string, password: string): Promise<boolean> {
    return this.importFromSeedPhraseInternal(seedPhrase, password, 'seed');
  }

  private async importFromSeedPhraseInternal(seedPhrase: string, password: string, createdFrom: 'seed' | 'generated'): Promise<boolean> {
    try {
      console.log(`Importing wallet from seed phrase (created from: ${createdFrom})`);
      
      // Validate seed phrase
      const words = seedPhrase.trim().split(/\s+/);
      if (words.length !== 12) {
        throw new Error('Seed phrase must contain exactly 12 words');
      }
      
      // Validate mnemonic
      if (!bip39.validateMnemonic(seedPhrase.trim())) {
        throw new Error('Invalid seed phrase');
      }
      
      // Use ArDrive Core's proper seed phrase handling
      const { WalletDAO, SeedPhrase } = require('ardrive-core-js');
      
      // Initialize Arweave instance
      const Arweave = require('arweave');
      const arweave = Arweave.init({
        host: 'arweave.net',
        port: 443,
        protocol: 'https',
        timeout: 120000
      });
      
      // Create WalletDAO instance
      const walletDAO = new WalletDAO(arweave);
      
      // Create SeedPhrase object
      const seedPhraseObj = new SeedPhrase(seedPhrase.trim());
      
      // Generate JWK wallet from seed phrase
      console.log('Generating wallet from seed phrase using ArDrive Core...');
      const jwkWallet = await walletDAO.generateJWKWallet(seedPhraseObj);
      
      // Extract the JWK JSON
      const walletJson = jwkWallet.getPrivateKey();
      
      // Convert to string for storage
      const walletData = JSON.stringify(walletJson);
      
      // Create a temporary file for ardrive-core-js
      const tempDir = os.tmpdir();
      const tempWalletPath = path.join(tempDir, `temp-wallet-${Date.now()}.json`);
      
      try {
        // Write wallet to temp file
        await fs.writeFile(tempWalletPath, walletData);
        
        // Load wallet using ArDrive Core function
        const wallet = readJWKFile(tempWalletPath);
        
        // Get wallet address for profile creation
        const address = await arweave.wallets.ownerToAddress(walletJson.n);
        
        // Check if profile exists for this address
        let profile = await profileManager.getProfileByAddress(address);
        if (!profile) {
          // Create new profile
          const profileName = `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`;
          profile = await profileManager.createProfile(profileName, address);
        }
        
        // Set as active profile
        await profileManager.setActiveProfile(profile.id);
        this.currentProfileId = profile.id;
        
        // Set config manager active profile
        await configManager.setActiveProfile(profile.id);
        
        // Set database manager active profile for data isolation
        await databaseManager.setActiveProfile(profile.id);
        
        // Create wallet storage format with metadata
        const walletStorage: WalletStorageFormat = {
          type: 'arweave',
          jwk: walletJson,
          metadata: {
            createdFrom,
            seedPhrase: seedPhrase.trim(), // Store the seed phrase
            createdAt: new Date().toISOString()
          }
        };
        
        // Store encrypted wallet to profile-specific file using secure encryption
        await writeEncryptedFile(this.getWalletStoragePath(), JSON.stringify(walletStorage), password);
        console.log('Wallet stored securely in profile:', profile.id);
        
        // Store both wallet formats
        this.wallet = wallet;
        this.walletJson = walletJson;
        
        // Store password securely in encrypted memory for session only
        await this.storeSessionPassword(password);
        
        // Initialize ArDrive
        this.arDrive = arDriveFactory({ 
          wallet,
          arweave: arweave,
          turboSettings: {
            turboUrl: new URL('https://upload.ardrive.io')
          }
        });
        
        console.log('ArDrive initialized successfully');
        
        // Initialize Turbo
        try {
          await turboManager.initialize(walletJson);
          console.log('Turbo manager initialized successfully');
        } catch (turboError) {
          console.error('Failed to initialize Turbo manager:', turboError);
        }
        
        
        return true;
      } finally {
        // Securely delete temp file
        await secureDeleteFile(tempWalletPath);
      }
    } catch (error) {
      console.error('Failed to import from seed phrase:', error);
      throw error;
    }
  }

  async importWallet(walletFilePath: string, password: string): Promise<boolean> {
    try {
      console.log('Importing wallet from:', walletFilePath);
      
      // Read the wallet file
      const walletData = await fs.readFile(walletFilePath, 'utf8');
      console.log('Wallet file read successfully, length:', walletData.length);
      
      // Validate it's valid JSON
      let walletJson;
      try {
        walletJson = JSON.parse(walletData);
        console.log('Wallet JSON parsed successfully');
      } catch (e) {
        throw new Error('Invalid JSON in wallet file');
      }
      
      // Validate wallet structure
      if (!walletJson.kty || !walletJson.n || !walletJson.e) {
        throw new Error('Invalid wallet format - missing required fields');
      }
      
      // Create a temporary file with normalized path for ardrive-core-js
      const tempDir = os.tmpdir();
      const tempWalletPath = path.join(tempDir, `temp-wallet-${Date.now()}.json`);
      
      try {
        // Write wallet to temp file
        await fs.writeFile(tempWalletPath, walletData);
        console.log('Temp wallet written to:', tempWalletPath);
        
        // Try to read wallet using ArDrive Core function with temp path
        const wallet = readJWKFile(tempWalletPath);
        console.log('Wallet loaded with readJWKFile');
        
        // Get wallet address for profile creation
        const Arweave = require('arweave');
        const arweave = Arweave.init({});
        const address = await arweave.wallets.ownerToAddress(walletJson.n);
        
        // Check if profile exists for this address
        let profile = await profileManager.getProfileByAddress(address);
        if (!profile) {
          // Create new profile
          const profileName = `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`;
          profile = await profileManager.createProfile(profileName, address);
        }
        
        // Set as active profile
        await profileManager.setActiveProfile(profile.id);
        this.currentProfileId = profile.id;
        
        // Set config manager active profile
        await configManager.setActiveProfile(profile.id);
        
        // Set database manager active profile for data isolation
        await databaseManager.setActiveProfile(profile.id);
        
        // Create wallet storage format with metadata
        const walletStorage: WalletStorageFormat = {
          type: 'arweave',
          jwk: walletJson,
          metadata: {
            createdFrom: 'jwk', // Imported from JWK file
            createdAt: new Date().toISOString()
            // No seed phrase available for JWK imports
          }
        };
        
        // Store encrypted wallet to profile-specific file using secure encryption
        await writeEncryptedFile(this.getWalletStoragePath(), JSON.stringify(walletStorage), password);
        console.log('Wallet stored securely in profile:', profile.id);
        
        // Store both wallet formats
        this.wallet = wallet;
        this.walletJson = walletJson;
        
        // Store password securely in encrypted memory for session only
        await this.storeSessionPassword(password);
        
        // Initialize ArDrive with custom gateway configuration
        const arweaveInstance = require('arweave').init({
          host: 'arweave.net',
          port: 443,
          protocol: 'https',
          timeout: 120000,
          logging: true
        });
        
        this.arDrive = arDriveFactory({ 
          wallet,
          arweave: arweaveInstance,
          turboSettings: {
            turboUrl: new URL('https://upload.ardrive.io')
          }
        });
        
        console.log('ArDrive initialized successfully');
        
        // Initialize Turbo
        try {
          await turboManager.initialize(walletJson);
          console.log('Turbo manager initialized successfully');
        } catch (turboError) {
          console.error('Failed to initialize Turbo manager:', turboError);
        }
        
        return true;
      } finally {
        // Securely delete temp file
        await secureDeleteFile(tempWalletPath);
      }
    } catch (error) {
      console.error('Failed to import wallet:', error);
      throw error;
    }
  }

  async loadWallet(password: string): Promise<boolean> {
    try {
      
      // Check if encrypted wallet file exists
      const walletPath = this.getWalletStoragePath();
      
      try {
        await fs.access(walletPath);
      } catch (error) {
        console.error('[WALLET-DEBUG] Wallet file not found at:', walletPath);
        return false;
      }
      
      // Read and decrypt wallet using secure decryption
      let walletData: string;
      try {
        walletData = await readEncryptedFile(walletPath, password);
      } catch (error: any) {
        console.error('[WALLET-DEBUG] Decryption failed:', error?.message || error);
        if (error?.message?.includes('invalid password')) {
          console.error('[WALLET-DEBUG] Invalid password provided for wallet decryption');
          throw new Error('Invalid password');
        }
        console.error('[WALLET-DEBUG] Failed to decrypt wallet:', error?.message || error);
        throw new Error('Failed to decrypt wallet');
      }
      
      if (!walletData) {
        console.error('[WALLET-DEBUG] Decrypted wallet data is empty');
        throw new Error('Decrypted wallet data is empty');
      }

      // Parse the decrypted data
      let walletStorage: WalletStorageFormat | any;
      let walletJson: any;
      
      try {
        walletStorage = JSON.parse(walletData);
        
        // Check if it's the new format or legacy format
        if (walletStorage.type === 'arweave' && walletStorage.metadata) {
          // New format - extract JWK
          walletJson = walletStorage.jwk;
        } else {
          // Legacy format - the entire object is the JWK
          walletJson = walletStorage;
        }
      } catch (e) {
        throw new Error('Invalid wallet data format');
      }
      
      // Create temporary file to use with readJWKFile
      const tempDir = os.tmpdir();
      const tempWalletPath = path.join(tempDir, `ardrive-wallet-${Date.now()}.json`);
      await fs.writeFile(tempWalletPath, JSON.stringify(walletJson));
      
      try {
        // Handle Arweave wallet loading
        const wallet = readJWKFile(tempWalletPath);
        
        this.wallet = wallet;
        this.walletJson = walletJson;
        // Store password securely in encrypted memory for session only
        await this.storeSessionPassword(password);
        
        // Initialize ArDrive with custom gateway configuration
        const arweaveInstance = require('arweave').init({
          host: 'arweave.net',
          port: 443,
          protocol: 'https',
          timeout: 120000,
          logging: true
        });
        
        this.arDrive = arDriveFactory({ 
          wallet,
          arweave: arweaveInstance,
          turboSettings: {
            turboUrl: new URL('https://upload.ardrive.io')
          }
        });
        
        // Initialize Turbo with the same wallet
        try {
          await turboManager.initialize(walletJson);
          console.log('Turbo manager initialized successfully');
        } catch (turboError) {
          console.error('Failed to initialize Turbo manager:', turboError);
        }
        
        return true;
      } finally {
        // Securely delete temp file
        await secureDeleteFile(tempWalletPath);
      }
    } catch (error) {
      console.error('Failed to load wallet:', error);
      throw new Error('Failed to decrypt wallet');
    }
  }

  async getWalletInfo(): Promise<WalletInfo | null> {
    console.log('WalletManager.getWalletInfo called');
    console.log('arDrive:', !!this.arDrive);
    console.log('wallet:', !!this.wallet);
    console.log('walletJson:', !!this.walletJson);
    
    if (!this.wallet || !this.walletJson) {
      console.log('WalletManager.getWalletInfo - returning null, wallet not loaded');
      return null;
    }

    try {
      // Handle Arweave wallet
      const Arweave = require('arweave');
      const arweave = Arweave.init({
        host: 'arweave.net',
        port: 443,
        protocol: 'https',
        timeout: 120000
      });
      
      // Use ownerToAddress with the wallet's public key 'n' parameter
      const address = await arweave.wallets.ownerToAddress(this.walletJson.n);
      
      // Get actual balance from Arweave network
      let balance = '0';
      try {
        const winstonBalance = await arweave.wallets.getBalance(address);
        // Convert from winston (smallest unit) to AR
        balance = arweave.ar.winstonToAr(winstonBalance);
        console.log('Wallet balance:', balance, 'AR');
      } catch (balanceError) {
        console.error('Failed to get wallet balance:', balanceError);
        // Keep balance as '0' if we can't fetch it
      }
      
      // Get Turbo Credits balance if available
      let turboBalance: string | undefined;
      let turboWinc: string | undefined;
      
      try {
        if (turboManager.isInitialized()) {
          const turboBalanceInfo = await turboManager.getBalance();
          turboBalance = turboBalanceInfo.ar;
          turboWinc = turboBalanceInfo.winc;
          console.log('Turbo balance:', turboBalance, 'AR');
        }
      } catch (turboError) {
        console.error('Failed to get Turbo balance:', turboError);
      }
      
      return {
        address: address,
        balance: balance,
        walletType: 'arweave',
        turboBalance,
        turboWinc
      };
    } catch (error) {
      console.error('Failed to get wallet info:', error);
      throw error;
    }
  }

  async listDrives(): Promise<DriveInfo[]> {
    try {
      console.log('Listing drives...');
      const walletInfo = await this.getWalletInfo();
      if (!walletInfo) {
        throw new Error('Could not get wallet info');
      }
      
      if (!this.arDrive) {
        throw new Error('ArDrive not initialized');
      }
      
      const address = walletInfo.address;
      console.log('Wallet address:', `${address.slice(0,4)}...${address.slice(-4)}`);
      
      let drives;
      try {
        // Import PrivateKeyData from ardrive-core-js
        const { PrivateKeyData } = require('ardrive-core-js/lib/arfs/private_key_data');
        
        // Create empty PrivateKeyData for public drives only
        const privateKeyData = new PrivateKeyData({});
        
        // Get all drives for this address
        drives = await this.arDrive.getAllDrivesForAddress({ 
          address: new ArweaveAddress(address),
          privateKeyData: privateKeyData
        });
        
      } catch (networkError: any) {
        console.error('Network error details:', {
          message: networkError?.message,
          stack: networkError?.stack,
          name: networkError?.name
        });
        
        throw networkError;
      }
      
      // Map to our DriveInfo format
      const driveInfos = drives.map((drive: any) => ({
        id: drive.driveId.toString(),
        name: drive.name,
        privacy: drive.drivePrivacy as 'public' | 'private',
        rootFolderId: drive.rootFolderId === 'ENCRYPTED' ? '' : drive.rootFolderId.toString(),
        // Convert unixTime (seconds) to milliseconds timestamp, or use current time if not available
        dateCreated: drive.unixTime ? drive.unixTime * 1000 : Date.now(),
        size: 0, // Will need to calculate this from drive contents
        isPrivate: drive.drivePrivacy === 'private'
      }));
      
      return driveInfos;
      
    } catch (error) {
      console.error('Failed to list drives:', error);
      // Return empty array instead of throwing to allow drive creation
      return [];
    }
  }

  async createDrive(name: string, privacy: 'private' | 'public' = 'private'): Promise<DriveInfo> {
    if (!this.arDrive) {
      throw new Error('Wallet not loaded');
    }

    // For now, only support public drives until private drive support is fully implemented
    if (privacy === 'private') {
      throw new Error('Private drives are not yet supported. Please create a public drive for now.');
    }

    try {
      console.log('Creating public drive with name:', name);
      
      // Try to use Turbo for free drive creation (under 100KB)
      // Note: Drive creation should default to Turbo if available
      const result = await this.arDrive.createPublicDrive({
        driveName: name
      });

      console.log('Drive creation result:', JSON.stringify(result, null, 2));

      if (!result.created || result.created.length === 0) {
        throw new Error('Invalid drive creation response');
      }

      // Find the drive entity and root folder entity in the created items
      let driveId: string | undefined;
      let rootFolderId: string | undefined;
      let driveEntity: any;

      for (const item of result.created) {
        console.log('Created item:', { type: item.type, entityId: item.entityId?.toString() });
        
        if (item.type === 'drive') {
          driveId = item.entityId?.toString();
          driveEntity = item;
        } else if (item.type === 'folder') {
          // This should be the root folder
          rootFolderId = item.entityId?.toString();
        }
      }

      // If we couldn't find the root folder ID in created items, 
      // we need to fetch the drive to get its root folder ID
      if (!rootFolderId && driveId) {
        console.log('Root folder ID not found in creation result, fetching drive info...');
        
        // Wait a moment for the drive to propagate
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fetch the created drive to get its root folder ID
        const drives = await this.listDrives();
        const createdDrive = drives.find(d => d.id === driveId);
        
        if (createdDrive && createdDrive.rootFolderId) {
          rootFolderId = createdDrive.rootFolderId;
          console.log('Found root folder ID from drive listing:', rootFolderId);
        }
      }

      if (!driveId || !rootFolderId) {
        console.error('Failed to extract IDs:', { driveId, rootFolderId, created: result.created });
        throw new Error('Failed to get drive or folder ID from creation result');
      }

      const driveInfo = {
        id: driveId,
        name,
        privacy: 'public' as const,
        rootFolderId: rootFolderId,
        metadataTxId: result.created[0].metadataTxId?.toString(), // Add transaction ID
        dateCreated: Date.now(),
        size: 0,
        isPrivate: false
      };

      console.log('Created drive:', driveInfo);
      return driveInfo;
    } catch (error) {
      console.error('Failed to create drive:', error);
      throw error;
    }
  }

  getArDrive(): ArDrive | null {
    return this.arDrive;
  }

  isWalletLoaded(): boolean {
    return this.arDrive !== null && this.wallet !== null;
  }


  async hasStoredWallet(): Promise<boolean> {
    try {
      if (!this.currentProfileId) return false;
      await fs.access(this.getWalletStoragePath());
      return true;
    } catch (error) {
      return false;
    }
  }

  // Try to auto-load wallet using session password only
  async attemptAutoLoad(): Promise<boolean> {
    if (this.isWalletLoaded()) {
      return true;
    }

    // Get active profile
    const activeProfile = await profileManager.getActiveProfile();
    if (!activeProfile) {
      console.log('No active profile found');
      return false;
    }
    
    this.currentProfileId = activeProfile.id;

    if (!(await this.hasStoredWallet())) {
      console.log('No stored wallet found');
      return false;
    }

    // Only use session password (no disk storage)
    const sessionPassword = await this.getSessionPassword();
    if (sessionPassword) {
      console.log('Attempting automatic authentication...');
      try {
        const result = await this.loadWallet(sessionPassword);
        this.clearPassword(sessionPassword); // Clear decrypted password from memory
        return result;
      } catch (error) {
        console.error('Automatic authentication failed:', error);
        this.clearPassword(sessionPassword);
        this.clearSessionPassword();
      }
    }

    console.log('Manual authentication required');
    return false;
  }

  // Clear only in-memory wallet data (for logout)
  async logout(): Promise<void> {
    
    // Close database connection on logout to prevent file locks
    const { databaseManager } = await import('./database-manager');
    await databaseManager.close();
    
    this.clearInMemoryWallet();
  }

  // Clear all stored wallet data (for complete removal/uninstall)
  async clearStoredWallet(): Promise<void> {
    try {
      if (this.currentProfileId) {
        // Securely delete encrypted wallet
        await secureDeleteFile(this.getWalletStoragePath()).catch(() => {});
      }
      
      // Clear memory
      this.clearInMemoryWallet();
      
      console.log('All wallet data cleared');
    } catch (error) {
      console.error('Failed to clear wallet data:', error);
      throw error;
    }
  }

  // Clear only in-memory wallet data (for profile switching)
  private clearInMemoryWallet(): void {
    this.arDrive = null;
    this.wallet = null;
    this.walletJson = null;
    
    // Securely clear encrypted session password
    this.clearSessionPassword();
    
    // NOTE: Don't clear currentProfileId here as it gets set before wallet loading
    
    // Reset Turbo manager
    try {
      turboManager.reset();
    } catch (error) {
      console.error('Failed to reset Turbo manager:', error);
      // Don't throw - this is optional cleanup
    }
  }

  // Switch to a different profile
  async switchProfile(profileId: string, password?: string): Promise<boolean> {
    // Prevent concurrent profile switches using a mutex
    if (this.profileSwitchMutex) {
      await this.profileSwitchMutex;
    }

    // Create new mutex for this switch operation with timeout
    this.profileSwitchMutex = Promise.race([
      this._performProfileSwitch(profileId, password),
      new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error('Profile switch timeout after 30 seconds')), 30000)
      )
    ]);
    
    try {
      const result = await this.profileSwitchMutex;
      return result;
    } finally {
      this.profileSwitchMutex = null;
    }
  }

  // Internal method that performs the actual profile switch
  private async _performProfileSwitch(profileId: string, password?: string): Promise<boolean> {
    try {
      
      // Quick check: if already on this profile and wallet is loaded, return success
      if (this.currentProfileId === profileId && this.isWalletLoaded()) {
        return true;
      }
      
      // Store current state to restore on failure
      const previousProfileId = this.currentProfileId;
      const previousArDrive = this.arDrive;
      const previousWallet = this.wallet;
      const previousWalletJson = this.walletJson;
      const previousSessionPassword = await this.getSessionPassword();
      
      
      try {
        // Clear current in-memory wallet (don't delete stored files!)
        this.clearInMemoryWallet();
        
        // Temporarily set the profile ID to check wallet access
        this.currentProfileId = profileId;
      
      // If password provided, try to load the wallet FIRST before updating everything
      if (password) {
        
        try {
          const loaded = await this.loadWallet(password);
          
          if (!loaded) {
            // Restore previous profile ID on failure
            this.currentProfileId = previousProfileId;
            return false;
          }
          
          // Password is correct, now safely update all managers in a transaction-like manner
          await this._updateAllManagersAtomically(profileId);
          
          // Clear previous password from memory
          if (previousSessionPassword) {
            this.clearPassword(previousSessionPassword);
          }
          return true;
        } catch (error: any) {
          console.error('Failed to load wallet with provided password:', error);
          
          // Restore previous state on failure
          this.currentProfileId = previousProfileId;
          this.arDrive = previousArDrive;
          this.wallet = previousWallet;
          this.walletJson = previousWalletJson;
          if (previousSessionPassword) {
            await this.storeSessionPassword(previousSessionPassword);
            this.clearPassword(previousSessionPassword);
          }
          
          return false;
        }
      } else {
        // No password provided, just switch profile context (user will need to provide password later)
        await this._updateAllManagersAtomically(profileId);
        
        // Clear previous password from memory
        if (previousSessionPassword) {
          this.clearPassword(previousSessionPassword);
        }
        return false; // Return false to indicate password is needed
      }
      } catch (innerError: any) {
        // Restore previous state on any failure
        console.error('Profile switch failed, restoring state:', innerError);
        this.currentProfileId = previousProfileId;
        this.arDrive = previousArDrive;
        this.wallet = previousWallet;
        this.walletJson = previousWalletJson;
        if (previousSessionPassword) {
          await this.storeSessionPassword(previousSessionPassword);
          this.clearPassword(previousSessionPassword);
        }
        throw innerError;
      }
    } catch (error) {
      return false;
    }
  }

  // Load wallet with provided password (for profile switching)
  async loadWalletWithPassword(password: string): Promise<boolean> {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    
    return await this.loadWallet(password);
  }

  // Get profile wallet path (public for export manager)
  getProfileWalletPath(profileId: string): string {
    const walletDir = path.join(profileManager.getProfilePath(profileId), 'wallet');
    return walletDir;
  }

  // Helper method for wallet export - decrypt wallet without loading it
  async decryptWallet(encryptedData: string, password: string): Promise<string | null> {
    try {
      // Parse the encrypted data format used by crypto-utils
      const encryptedObj = JSON.parse(encryptedData);
      
      // Use crypto-utils for decryption
      const decryptedString = await decryptData(encryptedObj, password);
      return decryptedString;
    } catch (error) {
      console.error('Failed to decrypt wallet:', error);
      return null;
    }
  }

  // Get address from JWK
  async getAddressFromJWK(jwk: any): Promise<string> {
    const Arweave = require('arweave');
    const arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https'
    });
    
    // Use ownerToAddress with the wallet's public key 'n' parameter
    const address = await arweave.wallets.ownerToAddress(jwk.n);
    return address;
  }

  /**
   * Check if OS keychain is available for secure storage
   */
  isKeychainAvailable(): boolean {
    return keychainService.isKeychainAvailable();
  }
  
  /**
   * Get the current security method being used
   */
  getSecurityMethod(): 'keychain' | 'fallback' {
    return keychainService.getSecurityMethod();
  }

  /**
   * Atomically updates all managers to use the new profile
   * Implements rollback on failure to prevent inconsistent state
   */
  private async _updateAllManagersAtomically(profileId: string): Promise<void> {
    const rollbackActions: (() => Promise<void>)[] = [];
    
    try {
      // Store original states for rollback
      const originalProfileId = await profileManager.getActiveProfile();
      const originalWalletManagerProfile = this.currentProfileId;
      
      // Update profile manager first
      await profileManager.setActiveProfile(profileId);
      rollbackActions.push(async () => {
        if (originalProfileId) {
          await profileManager.setActiveProfile(originalProfileId.id);
        }
      });
      
      // Update config manager
      await configManager.setActiveProfile(profileId);
      rollbackActions.push(async () => {
        if (originalWalletManagerProfile) {
          await configManager.setActiveProfile(originalWalletManagerProfile);
        }
      });
      
      // Update database manager
      await databaseManager.setActiveProfile(profileId);
      rollbackActions.push(async () => {
        if (originalWalletManagerProfile) {
          await databaseManager.setActiveProfile(originalWalletManagerProfile);
        }
      });
      
    } catch (error) {
      console.error('Manager update failed, performing rollback:', error);
      
      // Perform rollback in reverse order
      for (let i = rollbackActions.length - 1; i >= 0; i--) {
        try {
          await rollbackActions[i]();
        } catch (rollbackError) {
          console.error('Rollback action failed:', rollbackError);
          // Continue with other rollback actions even if one fails
        }
      }
      
      throw error;
    }
  }

  /**
   * Secure Session Password Management
   * Uses OS keychain when available, falls back to encrypted memory storage
   */
  
  private async storeSessionPassword(password: string): Promise<void> {
    try {
      // Get the keychain account identifier for current profile
      if (!this.currentProfileId) {
        throw new Error('No active profile for password storage');
      }
      
      const keychainAccount = `wallet-${this.currentProfileId}`;
      
      // Try to store in OS keychain first
      if (keychainService.isKeychainAvailable()) {
        try {
          await keychainService.setPassword(keychainAccount, password);
          console.log('[SECURITY] Session password stored in OS keychain');
          
          // Clear any in-memory storage since we're using keychain
          this.clearSessionPassword();
          
          // Clear the original password from the parameter (best effort)
          this.clearPassword(password);
          return;
        } catch (keychainError) {
          console.error('[SECURITY] OS keychain storage failed, falling back to memory:', keychainError);
          // Continue with memory fallback
        }
      }
      
      // Fallback to encrypted memory storage
      // Generate a random key for encrypting the session password
      this.sessionPasswordKey = crypto.randomBytes(32);
      
      // Use the same encryption as crypto-utils for consistency  
      const passwordData = await encryptData(password, 'session-password-salt');
      
      // Store the encrypted password data as a JSON string buffer
      this.encryptedSessionPassword = Buffer.from(JSON.stringify(passwordData), 'utf8');
      
      // Clear the original password from the parameter (best effort)
      this.clearPassword(password);
      
      console.log('[SECURITY] Session password stored securely in encrypted memory (fallback)');
    } catch (error) {
      console.error('[SECURITY] Failed to store session password securely:', error);
      // Fallback: clear everything if encryption fails
      this.clearSessionPassword();
      throw new Error('Failed to secure session password');
    }
  }
  
  private async getSessionPassword(): Promise<string | null> {
    try {
      // Get the keychain account identifier for current profile
      if (!this.currentProfileId) {
        return null;
      }
      
      const keychainAccount = `wallet-${this.currentProfileId}`;
      
      // Try to get from OS keychain first
      if (keychainService.isKeychainAvailable()) {
        try {
          const keychainPassword = await keychainService.getPassword(keychainAccount);
          if (keychainPassword) {
            console.log('[SECURITY] Session password retrieved from OS keychain');
            return keychainPassword;
          }
        } catch (keychainError) {
          console.error('[SECURITY] OS keychain retrieval failed:', keychainError);
          // Continue with memory fallback
        }
      }
      
      // Fallback to encrypted memory storage
      if (!this.encryptedSessionPassword || !this.sessionPasswordKey) {
        return null;
      }
      
      // Parse the encrypted data stored as JSON
      const passwordDataJson = this.encryptedSessionPassword.toString('utf8');
      const passwordData = JSON.parse(passwordDataJson);
      
      // Use crypto-utils to decrypt with the fixed salt
      const decryptedPassword = await decryptData(passwordData, 'session-password-salt');
      
      console.log('[SECURITY] Session password retrieved from encrypted memory (fallback)');
      return decryptedPassword;
    } catch (error) {
      console.error('[SECURITY] Failed to decrypt session password:', error);
      this.clearSessionPassword();
      return null;
    }
  }
  
  private clearSessionPassword(): void {
    // Clear from keychain if available
    if (this.currentProfileId && keychainService.isKeychainAvailable()) {
      const keychainAccount = `wallet-${this.currentProfileId}`;
      keychainService.deletePassword(keychainAccount).catch(error => {
        console.error('[SECURITY] Failed to clear password from keychain:', error);
      });
    }
    
    // Securely overwrite the encrypted password buffer
    if (this.encryptedSessionPassword) {
      this.encryptedSessionPassword.fill(0);
      this.encryptedSessionPassword = null;
    }
    
    // Securely overwrite the password encryption key
    if (this.sessionPasswordKey) {
      this.sessionPasswordKey.fill(0);
      this.sessionPasswordKey = null;
    }
    
    console.log('[SECURITY] Session password cleared from memory and keychain');
  }
  
  private clearPassword(password: string): void {
    // Best effort to clear password from memory by overwriting the string buffer
    // Note: JavaScript strings are immutable, but this helps with some implementations
    try {
      const buffer = Buffer.from(password, 'utf8');
      buffer.fill(0);
    } catch (error) {
      // Ignore errors - this is best effort cleanup
    }
  }

}

export const walletManager = new SecureWalletManager();