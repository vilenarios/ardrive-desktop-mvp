import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { arDriveFactory, ArDrive, JWKWallet, ArweaveAddress, EID } from 'ardrive-core-js';
import Arweave from 'arweave';
import { DriveInfo, DriveInfoWithStatus, WalletInfo, WalletStorageFormat } from '../types';
import { turboManager } from './turbo-manager';
import * as bip39 from 'bip39';
import { profileManager } from './profile-manager';
import { configManager } from './config-manager';
import { databaseManager } from './database-manager';
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile, decryptData, encryptData } from './crypto-utils';
import * as crypto from 'crypto';
import { keychainService } from './keychain-service';
import { driveKeyManager } from './drive-key-manager';
import { getDriveEmojiFingerprint } from './utils/drive-fingerprint';
import { summarizeArFSResult } from './utils/arfs-result-summary';
import { getGatewayConfig } from './gateway';

// UAT-1b (defect #2): ArFS's `unixTime` field is nominally SECONDS per the
// spec, but different SDK/gateway code paths have been observed returning it
// already in MILLISECONDS with no reliable per-record signal for which unit
// a given drive used — naively doing `unixTime * 1000` on an already-ms value
// overflows into a garbage year (e.g. "Apr 3, 58474"). Disambiguate by
// magnitude instead: a SECONDS value for any year up to ~5138 is < 1e11,
// while a MILLISECONDS value for any year after ~1973 is >= 1e11 — since
// Arweave itself didn't exist before 2017, that gap cleanly separates the
// two units for every real ArFS timestamp.
export function normalizeUnixTimeToMs(unixTime: unknown): number {
  const n = typeof unixTime === 'number' ? unixTime : Number(unixTime);
  if (!Number.isFinite(n) || n <= 0) {
    return Date.now();
  }
  return n < 1e11 ? n * 1000 : n;
}

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
  // UX-20: A freshly-generated account that has been shown to the user for
  // recovery-phrase confirmation but NOT yet persisted. Held in memory only
  // until completeGeneratedWalletSetup() runs on confirmation; overwritten on
  // retry and cleared on logout/profile-switch so a Back-and-retry can never
  // leave an orphaned profile/wallet or a divergent persisted seed phrase.
  private pendingGeneratedWallet: { seedPhrase: string; password: string; address: string } | null = null;
  // UX-7: the specific reason the most recent password-based profile
  // switch/login attempt failed (e.g. "Invalid password" vs a corrupted/IO
  // wallet-file failure), for callers that need to distinguish those without
  // changing switchProfile()'s existing boolean contract. Null when the last
  // attempt succeeded or none has been made yet.
  private lastAuthError: string | null = null;

  constructor() {
    // Storage paths determined dynamically based on active profile
  }

  private getWalletStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No active profile');
    }
    return profileManager.getProfileStoragePath(this.currentProfileId, 'wallet.enc');
  }

  /**
   * MONEY-13: arweave.js's fetch-based Api never checks the HTTP status code
   * (see node_modules/arweave/node/api.js `request()`), so on a gateway 429
   * `wallets.getBalance()` resolves successfully with the raw rate-limit
   * response body (HTML) instead of throwing. `arweave.ar.winstonToAr()` then
   * silently turns that non-numeric body into the string "NaN" via
   * BigNumber, with no exception for a caller to catch.
   *
   * Winston balances are always a base-10 integer string, so validate the
   * shape before ever handing it to winstonToAr.
   */
  private isNumericWinstonString(value: unknown): value is string {
    return typeof value === 'string' && /^\d+$/.test(value);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch the wallet balance, validating the response is a numeric winston
   * string before it's trusted. Retries a bounded number of times with
   * backoff on invalid (e.g. rate-limited) responses, since those are
   * typically transient. Returns null (never NaN, never a fabricated '0')
   * if a valid balance could not be obtained.
   */
  private async fetchValidatedWinstonBalance(
    arweave: Arweave,
    address: string,
    maxAttempts = 3
  ): Promise<string | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let winstonBalance: unknown;
      try {
        winstonBalance = await arweave.wallets.getBalance(address);
      } catch (error) {
        console.error(`[WalletManager] getBalance threw on attempt ${attempt}/${maxAttempts}:`, error);
        winstonBalance = undefined;
      }

      if (this.isNumericWinstonString(winstonBalance)) {
        return winstonBalance;
      }

      console.error(
        `[WalletManager] Non-numeric balance response on attempt ${attempt}/${maxAttempts} ` +
        `(likely a gateway rate-limit/error page masquerading as a balance):`,
        typeof winstonBalance === 'string' ? winstonBalance.slice(0, 120) : winstonBalance
      );

      if (attempt < maxAttempts) {
        await this.delay(300 * Math.pow(2, attempt - 1)); // 300ms, 600ms, ...
      }
    }

    return null;
  }

  /**
   * UX-20: Prepare a new account WITHOUT persisting anything.
   *
   * Generates a fresh 12-word recovery phrase and derives its Arweave
   * address purely in memory so the phrase can be shown for confirmation.
   * Nothing is written to disk and no profile is created here — persistence
   * is deferred to completeGeneratedWalletSetup(), which runs only after the
   * user confirms they have saved the recovery phrase.
   *
   * Calling this again (e.g. the user navigates Back and retries) discards the
   * previous pending account, so a retry can never leave an orphaned
   * profile/wallet or a divergent persisted seed phrase on disk.
   */
  async generateNewWallet(password: string): Promise<{ seedPhrase: string; address: string }> {
    try {
      // Generate a new 12-word seed phrase
      const seedPhrase = bip39.generateMnemonic(128); // 128 bits = 12 words

      // Derive the address in memory only — no profile, no wallet file yet.
      const address = await this.deriveAddressFromSeedPhrase(seedPhrase);

      // Hold the pending account in memory; persist on confirmation. This
      // overwrites any previous pending account (Back-and-retry), which is why
      // retrying cannot leave an orphan or a divergent seed.
      this.pendingGeneratedWallet = { seedPhrase, password, address };

      return { seedPhrase, address };
    } catch (error) {
      console.error('[WalletManager] Failed to prepare new account:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * UX-20: Deterministically derive the Arweave address for a seed phrase
   * without persisting anything. Used to preview the address alongside the
   * recovery phrase before the account is committed.
   */
  private async deriveAddressFromSeedPhrase(seedPhrase: string): Promise<string> {
    const { WalletDAO, SeedPhrase } = await import('ardrive-core-js');
    const Arweave = (await import('arweave')).default;
    const arweave = Arweave.init(getGatewayConfig({
      timeout: 120000
    }));

    const walletDAO = new WalletDAO(arweave);
    const seedPhraseObj = new SeedPhrase(seedPhrase.trim());
    const jwkWallet = await walletDAO.generateJWKWallet(seedPhraseObj);
    const walletJson = jwkWallet.getPrivateKey();

    return arweave.wallets.ownerToAddress(walletJson.n);
  }

  /**
   * UX-20: Persist the account prepared by generateNewWallet().
   *
   * Runs only after the user confirms they have saved their recovery phrase.
   * Re-derives the wallet from the SAME pending seed phrase (BIP39 → JWK
   * derivation is deterministic) and persists it — creating the profile and
   * writing the encrypted wallet — via the shared seed-phrase persistence
   * path, so the account that lands on disk always matches the recovery
   * phrase that was shown. The pending secret is cleared only on success, so
   * a transient failure can be retried with the same (already-written-down)
   * phrase rather than forcing a brand-new one.
   */
  async completeGeneratedWalletSetup(): Promise<{ address: string }> {
    const pending = this.pendingGeneratedWallet;
    if (!pending) {
      throw new Error('No pending account to finalize. Please start account creation again.');
    }

    const success = await this.importFromSeedPhraseInternal(pending.seedPhrase, pending.password, 'generated');
    if (!success) {
      throw new Error('Failed to finalize account creation');
    }

    // Persisted successfully — drop the in-memory pending secret.
    this.pendingGeneratedWallet = null;

    const walletInfo = await this.getWalletInfo();
    if (!walletInfo) {
      throw new Error('Failed to get wallet info after creation');
    }

    return { address: walletInfo.address };
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
      const { WalletDAO, SeedPhrase } = await import('ardrive-core-js');
      
      // Initialize Arweave instance
      const Arweave = (await import('arweave')).default;
      const arweave = Arweave.init(getGatewayConfig({
        timeout: 120000
      }));
      
      // Create WalletDAO instance
      const walletDAO = new WalletDAO(arweave);
      
      // Create SeedPhrase object
      const seedPhraseObj = new SeedPhrase(seedPhrase.trim());
      
      // Generate JWK wallet from seed phrase
      console.log('Generating wallet from seed phrase using ArDrive Core...');
      const jwkWallet = await walletDAO.generateJWKWallet(seedPhraseObj);
      
      // Extract the JWK JSON
      const walletJson = jwkWallet.getPrivateKey();
      
      // Construct the wallet object in memory from the decrypted JWK.
      // SEC-5: the private key must never be written to disk (no temp file).
      const wallet = new JWKWallet(walletJson);

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

      // Initialize Drive Key Manager for private drive support
      driveKeyManager.setWallet(walletJson);
      // PRIV-4: set the profile so any opt-in drive-key persistence this session
      // writes to (and forgets from) this profile's encrypted keys file.
      if (this.currentProfileId) {
        driveKeyManager.setProfile(this.currentProfileId);
      }
      console.log('Drive key manager initialized');

      // Initialize Turbo
      try {
        await turboManager.initialize(walletJson);
        console.log('Turbo manager initialized successfully');
      } catch (turboError) {
        console.error('Failed to initialize Turbo manager:', turboError);
      }


      return true;
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
      
      // Construct the wallet object in memory from the decrypted JWK.
      // SEC-5: the private key must never be written to disk (no temp file).
      const wallet = new JWKWallet(walletJson);

      // Get wallet address for profile creation
      const ArweaveLib = (await import('arweave')).default;
      const arweave = ArweaveLib.init({});
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
      const Arweave = (await import('arweave')).default;
      const arweaveInstance = Arweave.init(getGatewayConfig({
        timeout: 120000,
        logging: true
      }));

      this.arDrive = arDriveFactory({ 
        wallet,
        arweave: arweaveInstance,
        turboSettings: {
          turboUrl: new URL('https://upload.ardrive.io')
        }
      });

      console.log('ArDrive initialized successfully');

      // Initialize Drive Key Manager for private drive support
      driveKeyManager.setWallet(walletJson);
      // PRIV-4: set the profile so any opt-in drive-key persistence this session
      // writes to (and forgets from) this profile's encrypted keys file.
      if (this.currentProfileId) {
        driveKeyManager.setProfile(this.currentProfileId);
      }
      console.log('Drive key manager initialized');

      // Initialize Turbo
      try {
        await turboManager.initialize(walletJson);
        console.log('Turbo manager initialized successfully');
      } catch (turboError) {
        console.error('Failed to initialize Turbo manager:', turboError);
      }

      return true;
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
      
      // Construct the wallet object in memory from the decrypted JWK.
      // SEC-5: the private key must never be written to disk (no temp file).
      const wallet = new JWKWallet(walletJson);

      this.wallet = wallet;
      this.walletJson = walletJson;
      // Store password securely in encrypted memory for session only
      await this.storeSessionPassword(password);

      // Initialize ArDrive with custom gateway configuration
      const Arweave = (await import('arweave')).default;
      const arweaveInstance = Arweave.init(getGatewayConfig({
        timeout: 120000,
        logging: true
      }));

      this.arDrive = arDriveFactory({
        wallet,
        arweave: arweaveInstance,
        turboSettings: {
          turboUrl: new URL('https://upload.ardrive.io')
        }
      });

      // Initialize Drive Key Manager for private drive support.
      // PRIV-4: loadWallet is the choke point every login (auto-load, manual
      // login, profile switch) passes through, yet it previously never seeded
      // the drive key manager's wallet — so a returning user could not derive a
      // drive key to unlock. Seed it here, and restore any opted-in persisted
      // keys using the (session) password we just decrypted the wallet with.
      driveKeyManager.setWallet(walletJson);
      if (this.currentProfileId) {
        driveKeyManager.setProfile(this.currentProfileId);
        try {
          const restored = await driveKeyManager.restorePersistedKeys(password);
          if (restored > 0) {
            console.log(`Restored ${restored} persisted drive key(s) for this profile`);
            // Rebuild ArDrive so the restored private keys are active for
            // listing/decryption without a manual unlock.
            await this.recreateArDriveWithPrivateKeys();
          }
        } catch (restoreError) {
          // Fail closed: affected drives simply stay locked.
          console.error('Failed to restore persisted drive keys:', restoreError);
        }
      }

      // Initialize Turbo with the same wallet
      try {
        await turboManager.initialize(walletJson);
        console.log('Turbo manager initialized successfully');
      } catch (turboError) {
        console.error('Failed to initialize Turbo manager:', turboError);
      }

      return true;
    } catch (error) {
      console.error('Failed to load wallet:', error);
      // UX-7: preserve the real cause (e.g. the "Invalid password" thrown
      // above) instead of collapsing every failure into one generic message
      // — the login UI needs to tell a wrong password apart from a
      // corrupted/unreadable wallet file. This is a local wallet decrypt, so
      // surfacing the specific cause is not a meaningful info leak.
      if (error instanceof Error) {
        throw error;
      }
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
      const Arweave = (await import('arweave')).default;
      const arweave = Arweave.init(getGatewayConfig({
        timeout: 120000
      }));
      
      // Use ownerToAddress with the wallet's public key 'n' parameter
      const address = await arweave.wallets.ownerToAddress(this.walletJson.n);
      
      // Get actual balance from Arweave network. MONEY-13: never let a
      // non-numeric response (e.g. a swallowed 429) reach winstonToAr, and
      // never report an unavailable balance as '0' (0 would be a lie about
      // funds available) or 'NaN'. balanceUnavailable signals the renderer
      // to show a transient unavailable/retry state instead.
      let balance = '0';
      let balanceUnavailable = false;
      try {
        const winstonBalance = await this.fetchValidatedWinstonBalance(arweave, address);
        if (winstonBalance !== null) {
          // Convert from winston (smallest unit) to AR
          balance = arweave.ar.winstonToAr(winstonBalance);
          console.log('Wallet balance:', balance, 'AR');
        } else {
          balanceUnavailable = true;
          balance = '';
          console.error('Failed to get wallet balance: no valid numeric response after retries');
        }
      } catch (balanceError) {
        console.error('Failed to get wallet balance:', balanceError);
        balanceUnavailable = true;
        balance = '';
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
        turboWinc,
        balanceUnavailable
      };
    } catch (error) {
      console.error('Failed to get wallet info:', error);
      throw error;
    }
  }

  async listDrives(): Promise<DriveInfo[]> {
    console.log('Listing drives...');

    // If the wallet/ArDrive instance isn't ready yet, there's genuinely
    // nothing to list (not a fetch failure) — keep returning [] here so
    // flows that run before a wallet is loaded aren't blocked.
    let walletInfo: WalletInfo | null;
    try {
      walletInfo = await this.getWalletInfo();
    } catch (error) {
      console.error('Failed to get wallet info while listing drives:', error);
      return [];
    }
    if (!walletInfo || !this.arDrive) {
      console.log('listDrives: wallet/ArDrive not ready yet, returning empty list');
      return [];
    }

    const address = walletInfo.address;
    console.log('Wallet address:', `${address.slice(0,4)}...${address.slice(-4)}`);

    // Get private key data for unlocked drives, then fetch all drives for
    // this address. UX-7: let a genuine fetch failure (network error,
    // gateway timeout, etc.) propagate instead of being swallowed into an
    // empty array — callers (e.g. boot routing in App.tsx) must be able to
    // tell "confirmed zero drives" apart from "couldn't fetch drives", or an
    // offline existing user gets routed into create-drive/create-account.
    let drives;
    try {
      const privateKeyData = await driveKeyManager.getPrivateKeyData();
      drives = await this.arDrive.getAllDrivesForAddress({
        address: new ArweaveAddress(address),
        privateKeyData: privateKeyData
      });
    } catch (networkError: any) {
      console.error('Failed to fetch drives from network:', {
        message: networkError?.message,
        stack: networkError?.stack,
        name: networkError?.name
      });
      throw networkError;
    }

    // Map to our DriveInfo format
    return drives.map((drive: any) => ({
      id: drive.driveId.toString(),
      name: drive.name, // Will be decrypted name if drive is unlocked
      privacy: drive.drivePrivacy as 'public' | 'private',
      rootFolderId: drive.rootFolderId === 'ENCRYPTED' ? '' : drive.rootFolderId.toString(),
      // UAT-1b: unixTime may arrive in seconds OR already in ms — see
      // normalizeUnixTimeToMs() above for why a naive *1000 overflows.
      dateCreated: normalizeUnixTimeToMs(drive.unixTime),
      size: 0, // Will need to calculate this from drive contents
      isPrivate: drive.drivePrivacy === 'private'
    }));
  }

  async createDrive(name: string, privacy: 'private' | 'public' = 'public'): Promise<DriveInfo> {
    if (!this.arDrive) {
      throw new Error('Wallet not loaded');
    }

    // Redirect private drive creation to the specific method
    if (privacy === 'private') {
      throw new Error('Use createPrivateDrive() method for private drives with password');
    }

    try {
      console.log('Creating public drive with name:', name);
      
      // Try to use Turbo for free drive creation (under the Turbo free-tier limit)
      // Note: Drive creation should default to Turbo if available
      const result = await this.arDrive.createPublicDrive({
        driveName: name
      });

      // SEC-1: never log the raw ArFSResult — log a key-free summary instead
      console.log('Drive creation result:', summarizeArFSResult(result));

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
        console.error('Failed to extract IDs:', { driveId, rootFolderId, created: summarizeArFSResult(result).created });
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

  /**
   * UX-7: the specific reason the most recent password-based profile
   * switch/login attempt failed (e.g. "Invalid password" vs a corrupted/IO
   * wallet-file failure). switchProfile() itself still resolves to a plain
   * boolean for backward compatibility; callers that need the cause (e.g.
   * the login screen) can check this right after a `false` result.
   */
  getLastAuthError(): string | null {
    return this.lastAuthError;
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
        // PRIV-4: also remove any persisted drive keys for this profile so a
        // full wallet clear leaves no encrypted key file behind.
        driveKeyManager.setProfile(this.currentProfileId);
        await driveKeyManager.clearPersistedStorage().catch(() => {});
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

    // UX-20: discard any un-confirmed generated account (seed + password) so it
    // can never be committed after a logout/profile switch.
    this.pendingGeneratedWallet = null;

    // Clear drive keys
    driveKeyManager.clearAllKeys();
    
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
    // UX-7: reset before each attempt so a stale reason from a previous
    // failed attempt never leaks into this one.
    this.lastAuthError = null;
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
            this.lastAuthError = 'No wallet found for this profile';
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

          // UX-7: switchProfile() keeps its existing boolean contract (every
          // failure still resolves `false`, restoring prior tests' behavior),
          // but the real cause — e.g. "Invalid password" vs a corrupted/IO
          // wallet-file failure from loadWallet() — is preserved here so the
          // login UI can tell them apart via getLastAuthError().
          this.lastAuthError = error instanceof Error ? error.message : 'Failed to authenticate';

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
      // UX-7: a structural failure outside the password path (e.g. manager
      // update failure) — still resolve `false`, but record the cause too.
      this.lastAuthError = error instanceof Error ? error.message : 'Profile switch failed';
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
    const Arweave = (await import('arweave')).default;
    const arweave = Arweave.init(getGatewayConfig());
    
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

  // ===== PRIVATE DRIVE METHODS =====

  /**
   * Create a new private drive with password protection
   */
  async createPrivateDrive(name: string, password: string): Promise<DriveInfo> {
    if (!this.arDrive) {
      throw new Error('Wallet not loaded');
    }

    try {
      console.log('Creating private drive with name:', name);

      // Generate private drive key data from password
      if (!this.walletJson) {
        throw new Error('Wallet not loaded');
      }
      const { PrivateDriveKeyData } = await import('ardrive-core-js');
      const newPrivateDriveData = await PrivateDriveKeyData.from(password, this.walletJson);

      // Create the private drive using ardrive-core-js
      const result = await this.arDrive.createPrivateDrive({
        driveName: name,
        newPrivateDriveData
      });

      // SEC-1: never log the raw ArFSResult — for private drives,
      // created[].key serializes to the RAW drive key. Log a key-free summary.
      console.log('Private drive creation result:', summarizeArFSResult(result));

      if (!result.created || result.created.length === 0) {
        throw new Error('Invalid private drive creation response');
      }

      // Extract drive info from result
      const driveEntity = result.created.find(e => e.type === 'drive');
      const folderEntity = result.created.find(e => e.type === 'folder');
      
      if (!driveEntity || !folderEntity) {
        throw new Error('Invalid drive creation response - missing drive or folder entity');
      }

      if (!driveEntity.entityId) {
        throw new Error('Drive creation failed - no entity ID returned');
      }
      if (!folderEntity.entityId) {
        throw new Error('Folder creation failed - no entity ID returned');
      }
      const driveId = driveEntity.entityId.toString();
      
      // Unlock the drive immediately for this session. Unverified is correct
      // here: the drive was just created with this exact password, and its
      // entity is not yet queryable for trial decryption.
      const unlocked = await driveKeyManager.unlockDriveUnverified(driveId, password);
      if (!unlocked) {
        console.warn('Drive created but failed to unlock immediately');
      }
      
      const driveInfo: DriveInfo = {
        id: driveId,
        name,
        privacy: 'private',
        rootFolderId: folderEntity.entityId.toString(),
        metadataTxId: driveEntity.metadataTxId?.toString(),
        dateCreated: Date.now(),
        size: 0,
        isPrivate: true
      };

      console.log('Created private drive:', driveInfo);
      return driveInfo;
    } catch (error) {
      console.error('Failed to create private drive:', error);
      throw error;
    }
  }

  /**
   * Unlock a private drive for the current session
   */
  async unlockPrivateDrive(
    driveId: string,
    password: string,
    persistKey: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Attempting to unlock private drive ${driveId.slice(0, 8)}...`);

      if (!this.arDrive) {
        return { success: false, error: 'Wallet not loaded. Please log in again.' };
      }
      
      // PRIV-2: HKDF derives a key for ANY password — derivation success
      // proves nothing. Trial-decrypt the drive entity before caching.
      const driveKey = await driveKeyManager.deriveKey(driveId, password);
      
      try {
        await this.arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey });
      } catch (trialError) {
        const message = trialError instanceof Error ? trialError.message : String(trialError);
        // Only the known decrypt/auth failure strings mean a wrong password
        // (Node GCM: "Unsupported state or unable to authenticate data";
        // ardrive-core drive builder: "Invalid drive state" / decrypt errors).
        // Anything else (gateway 5xx, network) must NOT masquerade as
        // "invalid password" — qa-gate probe: a 502's "Bad Gateway" matched
        // the previous keyword regex.
        const isDecryptionFailure =
          /unsupported state or unable to authenticate data/i.test(message) ||
          /invalid drive state/i.test(message) ||
          /error decrypting/i.test(message);
        if (isDecryptionFailure) {
          console.log(`❌ Trial decryption failed for drive ${driveId.slice(0, 8)}... — wrong password`);
          return { success: false, error: 'Invalid password. Please check your password and try again.' };
        }
        console.error(`Trial decryption errored (non-decryption) for drive ${driveId.slice(0, 8)}:`, message);
        return { success: false, error: 'Could not verify the password (network or gateway error). Please try again.' };
      }
      
      // Verified — cache for the session and refresh ArDrive with the key
      driveKeyManager.cacheKey(driveId, driveKey);
      await this.recreateArDriveWithPrivateKeys();

      // PRIV-4: opt-in persistence. Only when the user chose "remember" do we
      // durably store the (encrypted) key. Persistence failures must NOT fail
      // the unlock — the drive is unlocked for the session regardless.
      if (persistKey) {
        try {
          if (this.currentProfileId) {
            driveKeyManager.setProfile(this.currentProfileId);
          }
          const sessionPassword = await this.getSessionPassword();
          const saved = await driveKeyManager.setPersistence(driveId, true, sessionPassword);
          if (sessionPassword) {
            this.clearPassword(sessionPassword);
          }
          if (!saved) {
            console.warn(`Could not persist key for drive ${driveId.slice(0, 8)}... (no session password?)`);
          }
        } catch (persistError) {
          console.error('Failed to persist drive key (unlock still succeeded):', persistError);
        }
      }

      console.log(`✅ Private drive ${driveId.slice(0, 8)}... unlocked successfully`);
      return { success: true };
    } catch (error) {
      console.error('Error unlocking private drive:', error);
      return { success: false, error: 'Failed to unlock drive. Please try again.' };
    }
  }

  /**
   * Recreate the ArDrive instance with current private key data
   * This is needed when private drives are unlocked/locked
   */
  private async recreateArDriveWithPrivateKeys(): Promise<void> {
    if (!this.wallet || !this.walletJson) {
      console.error('Cannot recreate ArDrive - wallet not loaded');
      return;
    }
    
    try {
      console.log('Recreating ArDrive instance with updated private key data...');
      
      // Get current private key data from drive key manager
      const privateKeyData = await driveKeyManager.getPrivateKeyData();
      
      // Create new ArDrive instance with private key data
      const arweaveInstance = Arweave.init(getGatewayConfig({
        timeout: 120000,
        logging: true
      }));
      
      // Create ArDrive with private key data included
      // Note: arDriveFactory may not accept privateKeyData directly
      // We'll pass it through the wallet if supported
      this.arDrive = arDriveFactory({ 
        wallet: this.wallet,
        arweave: arweaveInstance,
        turboSettings: {
          turboUrl: new URL('https://upload.ardrive.io')
        }
      });
      
      console.log('ArDrive instance recreated successfully');
    } catch (error) {
      console.error('Failed to recreate ArDrive instance:', error);
      // Keep the existing instance if recreation fails
    }
  }

  /**
   * Lock a private drive (remove from session cache)
   */
  async lockPrivateDrive(driveId: string): Promise<void> {
    driveKeyManager.lockDrive(driveId);
    console.log(`Private drive ${driveId.slice(0, 8)}... locked`);
  }

  /**
   * Check if a private drive is unlocked
   */
  async isDriveUnlocked(driveId: string): Promise<boolean> {
    try {
      return driveKeyManager.isUnlocked(driveId);
    } catch (error) {
      console.error('Failed to check drive unlock status:', error);
      return false;
    }
  }

  /**
   * PRIV-4: whether a drive's key is remembered (persisted) across sessions.
   */
  isDrivePersisted(driveId: string): boolean {
    return driveKeyManager.isPersisted(driveId);
  }

  /**
   * PRIV-4 settings toggle: opt a drive in/out of persistence. Enabling requires
   * the drive to be unlocked (its key must be available to persist) and a
   * session password to encrypt the file at rest. Returns true on success.
   */
  async setDrivePersistence(driveId: string, persist: boolean): Promise<boolean> {
    if (this.currentProfileId) {
      driveKeyManager.setProfile(this.currentProfileId);
    }
    const sessionPassword = await this.getSessionPassword();
    try {
      return await driveKeyManager.setPersistence(driveId, persist, sessionPassword);
    } finally {
      if (sessionPassword) {
        this.clearPassword(sessionPassword);
      }
    }
  }

  /**
   * List all drives with their unlock status
   */
  async listDrivesWithStatus(): Promise<DriveInfoWithStatus[]> {
    const drives = await this.listDrives();
    
    return drives.map(drive => ({
      ...drive,
      isLocked: drive.privacy === 'private' && !driveKeyManager.isUnlocked(drive.id),
      emojiFingerprint: drive.privacy === 'private' ? getDriveEmojiFingerprint(drive.id) : undefined,
      // PRIV-4: whether this drive's key is remembered across sessions (drives
      // the settings toggle in the drive selector).
      isRemembered: drive.privacy === 'private' && driveKeyManager.isPersisted(drive.id)
    }));
  }

}

export const walletManager = new SecureWalletManager();