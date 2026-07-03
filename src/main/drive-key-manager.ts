import { DriveKey, deriveDriveKey, PrivateKeyData } from 'ardrive-core-js';
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile } from './crypto-utils';
import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';

/**
 * Drive Key Manager
 * 
 * Manages private drive keys with optional secure persistence.
 * Keys are derived from user passwords and can be optionally persisted (encrypted).
 * 
 * Security features:
 * - Optional secure persistence with user consent
 * - Keys encrypted with session password when persisted
 * - Automatic cleanup on profile switches
 * - Secure memory clearing
 * - Per-drive persistence preferences
 * 
 * Persistence is opt-in per drive:
 * - Users explicitly choose to remember drive passwords
 * - Persisted keys are encrypted with session password
 * - Same security level as wallet storage
 */
export class DriveKeyManager {
  private drivesKeyCache: Map<string, DriveKey> = new Map(); // driveId -> DriveKey
  private persistedDriveIds: Set<string> = new Set(); // Track which drives should be persisted
  private walletJson: any = null;
  private currentProfileId: string | null = null;

  constructor() {
    console.log('[DRIVE-KEY-MANAGER] Initialized');
  }

  /**
   * Set the wallet JSON for key derivation
   */
  setWallet(walletJson: any): void {
    this.walletJson = walletJson;
  }

  /**
   * Set the current profile for storage paths
   */
  setProfile(profileId: string): void {
    this.currentProfileId = profileId;
  }

  /**
   * Get storage path for encrypted drive keys
   */
  private getDriveKeysStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No profile ID set');
    }
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'profiles', this.currentProfileId, 'drive-keys.enc');
  }

  /**
   * Unlock a private drive by deriving its key from the password
   * @param driveId - The drive ID to unlock
   * @param password - The drive password
   * @param persistKey - Whether to persist the key (encrypted)
   * @param sessionPassword - Session password for encryption (required if persistKey is true)
   */
  async unlockDrive(
    driveId: string, 
    password: string,
    persistKey: boolean = false,
    sessionPassword?: string
  ): Promise<boolean> {
    try {
      if (!this.walletJson) {
        throw new Error('Wallet not loaded');
      }

      console.log(`[DRIVE-KEY-MANAGER] Attempting to unlock drive ${driveId.slice(0, 8)}...`);

      // Derive drive key using ardrive-core-js
      const driveKey = await deriveDriveKey(
        password,
        driveId,
        JSON.stringify(this.walletJson)
      );

      // Cache the key for this session
      this.drivesKeyCache.set(driveId, driveKey);
      
      // Handle persistence preference
      if (persistKey) {
        this.persistedDriveIds.add(driveId);
        // Save immediately if we have session password
        if (sessionPassword) {
          await this.savePersistedKeys(sessionPassword);
        }
      } else {
        this.persistedDriveIds.delete(driveId);
        // Update storage to remove this key if it was persisted before
        if (sessionPassword) {
          await this.savePersistedKeys(sessionPassword);
        }
      }
      
      console.log(`[DRIVE-KEY-MANAGER] ✅ Drive ${driveId.slice(0, 8)}... unlocked (persisted: ${persistKey})`); 
      return true;
    } catch (error) {
      console.error(`[DRIVE-KEY-MANAGER] ❌ Failed to unlock drive ${driveId.slice(0, 8)}:`, error);
      return false;
    }
  }

  /**
   * Lock a specific drive (remove from cache)
   */
  lockDrive(driveId: string): void {
    const wasUnlocked = this.drivesKeyCache.has(driveId);
    this.drivesKeyCache.delete(driveId);
    // Don't remove from persistedDriveIds - user preference remains
    
    if (wasUnlocked) {
      console.log(`[DRIVE-KEY-MANAGER] 🔒 Drive ${driveId.slice(0, 8)}... locked`);
    }
  }

  /**
   * Save persisted keys to encrypted storage
   */
  async savePersistedKeys(sessionPassword: string): Promise<void> {
    if (!this.currentProfileId) return;

    const keysToSave: Record<string, any> = {};
    
    // Only save keys that are marked for persistence
    for (const driveId of this.persistedDriveIds) {
      const key = this.drivesKeyCache.get(driveId);
      if (key) {
        // Store the key in a serializable format
        // DriveKey contains a CryptoKey which needs special handling
        keysToSave[driveId] = {
          keyData: Buffer.from(key as any).toString('base64'),
          persistedAt: Date.now()
        };
      }
    }

    if (Object.keys(keysToSave).length === 0) {
      // No keys to persist, delete the file if it exists
      try {
        await secureDeleteFile(this.getDriveKeysStoragePath());
      } catch {
        // File might not exist, that's ok
      }
      return;
    }

    // Encrypt and save
    await writeEncryptedFile(
      this.getDriveKeysStoragePath(),
      JSON.stringify(keysToSave),
      sessionPassword
    );
    
    console.log(`[DRIVE-KEY-MANAGER] Saved ${Object.keys(keysToSave).length} persisted drive keys`);
  }

  /**
   * Load persisted keys from encrypted storage
   */
  async loadPersistedKeys(sessionPassword: string): Promise<number> {
    if (!this.currentProfileId) return 0;

    try {
      const storagePath = this.getDriveKeysStoragePath();
      
      // Check if file exists
      try {
        await fs.access(storagePath);
      } catch {
        console.log('[DRIVE-KEY-MANAGER] No persisted keys found');
        return 0;
      }

      // Decrypt and load
      const encryptedData = await readEncryptedFile(storagePath, sessionPassword);
      const keysData = JSON.parse(encryptedData);
      
      // Restore to cache
      let loadedCount = 0;
      for (const [driveId, keyInfo] of Object.entries(keysData)) {
        try {
          // Reconstruct the DriveKey from stored data
          const keyData = Buffer.from((keyInfo as any).keyData, 'base64');
          this.drivesKeyCache.set(driveId, keyData as any);
          this.persistedDriveIds.add(driveId);
          loadedCount++;
        } catch (error) {
          console.error(`[DRIVE-KEY-MANAGER] Failed to restore key for drive ${driveId.slice(0, 8)}:`, error);
        }
      }
      
      console.log(`[DRIVE-KEY-MANAGER] Loaded ${loadedCount} persisted drive keys`);
      return loadedCount;
    } catch (error) {
      console.error('[DRIVE-KEY-MANAGER] Failed to load persisted keys:', error);
      return 0;
    }
  }

  /**
   * Check if a drive's key is set to persist
   */
  isPersisted(driveId: string): boolean {
    return this.persistedDriveIds.has(driveId);
  }

  /**
   * Update persistence preference for a drive
   */
  async updatePersistencePreference(
    driveId: string,
    persist: boolean,
    sessionPassword?: string
  ): Promise<void> {
    if (persist) {
      this.persistedDriveIds.add(driveId);
    } else {
      this.persistedDriveIds.delete(driveId);
    }

    // Update stored keys if we have session password
    if (sessionPassword && this.currentProfileId) {
      await this.savePersistedKeys(sessionPassword);
    }
  }

  /**
   * Check if a drive is currently unlocked
   */
  isUnlocked(driveId: string): boolean {
    return this.drivesKeyCache.has(driveId);
  }

  /**
   * Get the drive key for a specific drive (if unlocked)
   */
  getDriveKey(driveId: string): DriveKey | undefined {
    const key = this.drivesKeyCache.get(driveId);
    if (key) {
      console.log(`[DRIVE-KEY-MANAGER] Providing drive key for ${driveId.slice(0, 8)}...`);
      // Log key type for debugging
      console.log(`[DRIVE-KEY-MANAGER] Key type: ${key.constructor.name}, has keyData: ${!!(key as any).keyData}`);
    } else {
      console.log(`[DRIVE-KEY-MANAGER] No drive key found for ${driveId.slice(0, 8)}...`);
    }
    return key;
  }

  /**
   * Get PrivateKeyData object for use with ardrive-core-js operations
   * This includes all currently unlocked drive keys
   */
  async getPrivateKeyData(): Promise<PrivateKeyData> {
    // Convert Map to array format expected by PrivateKeyData
    const driveKeys: DriveKey[] = Array.from(this.drivesKeyCache.values());

    console.log(`[DRIVE-KEY-MANAGER] Providing PrivateKeyData for ${driveKeys.length} unlocked drives`);
    
    // PrivateKeyData constructor expects an object with driveKeys array
    return new PrivateKeyData({ driveKeys });
  }

  /**
   * Get list of currently unlocked drive IDs
   */
  getUnlockedDriveIds(): string[] {
    return Array.from(this.drivesKeyCache.keys());
  }

  /**
   * Clear all cached keys (used on logout/profile switch)
   */
  clearAllKeys(): void {
    const driveCount = this.drivesKeyCache.size;
    
    // Clear the cache
    this.drivesKeyCache.clear();
    this.persistedDriveIds.clear();
    this.walletJson = null;
    this.currentProfileId = null;
    
    if (driveCount > 0) {
      console.log(`[DRIVE-KEY-MANAGER] 🧹 Cleared ${driveCount} drive keys from memory`);
    }
  }

  /**
   * Clear all keys and remove encrypted storage
   */
  async clearAllKeysAndStorage(): Promise<void> {
    this.clearAllKeys();

    if (this.currentProfileId) {
      try {
        await secureDeleteFile(this.getDriveKeysStoragePath());
        console.log('[DRIVE-KEY-MANAGER] Deleted persisted keys file');
      } catch {
        // File might not exist
      }
    }
  }

  /**
   * Get summary of unlocked drives for debugging
   */
  getStatus(): { unlockedDrives: number; driveIds: string[] } {
    const driveIds = Array.from(this.drivesKeyCache.keys()).map(id => `${id.slice(0, 8)}...`);
    
    return {
      unlockedDrives: this.drivesKeyCache.size,
      driveIds
    };
  }

}

// Export singleton instance
export const driveKeyManager = new DriveKeyManager();