import { DriveKey, deriveDriveKey, PrivateKeyData } from 'ardrive-core-js';

/**
 * Drive Key Manager
 * 
 * Manages private drive keys in memory for the current session.
 * Keys are derived from user passwords and cached until logout/profile switch.
 * 
 * Security features:
 * - Session-only storage (no persistent key storage)
 * - Automatic cleanup on profile switches
 * - Secure memory clearing
 * 
 * Design Decision: Drive keys are NOT persisted between sessions
 * Rationale:
 * - Security: Prevents key extraction from disk/memory dumps
 * - User control: Users must explicitly unlock drives each session
 * - Compliance: Follows security best practices for key management
 * 
 * Future considerations:
 * - Could add optional OS keychain integration for convenience
 * - Could implement session timeout for automatic key clearing
 * - Could add biometric unlock support where available
 */
export class DriveKeyManager {
  private drivesKeyCache: Map<string, DriveKey> = new Map(); // driveId -> DriveKey
  private walletJson: any = null;

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
   * Unlock a private drive by deriving its key from the password
   */
  async unlockDrive(driveId: string, password: string): Promise<boolean> {
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
      
      console.log(`[DRIVE-KEY-MANAGER] ✅ Drive ${driveId.slice(0, 8)}... unlocked for session`);
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
    
    if (wasUnlocked) {
      console.log(`[DRIVE-KEY-MANAGER] 🔒 Drive ${driveId.slice(0, 8)}... locked`);
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
    this.walletJson = null;
    
    if (driveCount > 0) {
      console.log(`[DRIVE-KEY-MANAGER] 🧹 Cleared ${driveCount} drive keys from memory`);
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

  /**
   * Future: Support for optional session persistence
   * This method would integrate with OS keychain services
   * Currently returns false as persistence is not implemented
   */
  async persistSession(driveId: string): Promise<boolean> {
    console.log('[DRIVE-KEY-MANAGER] Session persistence not implemented for security');
    // Future implementation would:
    // 1. Check user preferences for session persistence
    // 2. Use OS keychain API (keytar) to securely store encrypted key
    // 3. Set expiration time for automatic cleanup
    // 4. Require user authentication (password/biometric) on restore
    return false;
  }

  /**
   * Future: Restore persisted session
   * Currently returns false as persistence is not implemented
   */
  async restoreSession(driveId: string): Promise<boolean> {
    console.log('[DRIVE-KEY-MANAGER] Session restoration not implemented for security');
    // Future implementation would:
    // 1. Check OS keychain for stored session
    // 2. Verify session hasn't expired
    // 3. Require user authentication
    // 4. Restore key to memory cache
    return false;
  }
}

// Export singleton instance
export const driveKeyManager = new DriveKeyManager();