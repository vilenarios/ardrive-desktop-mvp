import {
  DriveKey,
  deriveDriveKey,
  PrivateKeyData,
  EntityKey,
  VersionedDriveKey,
  getDriveSignatureType,
  DriveSignatureType
} from 'ardrive-core-js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile } from './crypto-utils';

/**
 * Drive Key Manager
 *
 * Manages private drive keys in memory for the current session, with OPT-IN,
 * encrypted-at-rest persistence per drive (PRIV-4).
 *
 * Security model:
 * - Session cache: derived keys live in memory and are cleared on logout /
 *   profile switch (clearAllKeys).
 * - Persistence (opt-in per drive): when the user chooses "remember" at unlock,
 *   the drive's key is serialized (base64 of its raw key bytes) and written to
 *   `profiles/{profileId}/drive-keys.enc`, ENCRYPTED with the session password
 *   via crypto-utils (scrypt N=16384 + AES-256-GCM — the same primitive that
 *   protects wallet.enc). The plaintext key bytes NEVER touch disk and are never
 *   logged. Each profile has its own file, so persistence is profile-isolated;
 *   deleting a profile removes its directory (and therefore this file).
 *
 * The encrypted file is the single source of truth for "which drives are
 * remembered" — there is no separate DB preference table (PRIV-4: the previously
 * write-only drive_key_preferences design was dropped in favour of the file the
 * keys already live in, so the two can never drift).
 */

/**
 * On-disk (pre-encryption) shape for one persisted drive key. `keyData` is the
 * base64 of the raw key bytes; `driveSignatureType` preserves a
 * VersionedDriveKey's signature version so the key is reconstructed faithfully.
 */
interface PersistedKeyRecord {
  keyData: string;
  driveSignatureType?: number;
  persistedAt: number;
}

export class DriveKeyManager {
  private drivesKeyCache: Map<string, DriveKey> = new Map(); // driveId -> DriveKey
  // Drives the user opted to persist. Source of truth for isPersisted(); mirrors
  // the contents of the encrypted keys file for the active profile.
  private persistedDriveIds: Set<string> = new Set();
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
   * Set the active profile. Determines where persisted keys are stored/loaded
   * and isolates persistence per profile. Must be set before any persist/restore
   * operation.
   */
  setProfile(profileId: string): void {
    this.currentProfileId = profileId;
  }

  /**
   * Absolute path to this profile's encrypted drive-keys file.
   */
  private getDriveKeysStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No profile ID set for drive key persistence');
    }
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'profiles', this.currentProfileId, 'drive-keys.enc');
  }

  /**
   * Derive a drive key from a password WITHOUT caching it.
   *
   * PRIV-2: HKDF derivation succeeds for ANY password — a derived key proves
   * nothing. Callers handling user-supplied passwords must trial-decrypt
   * something real (e.g. the drive entity) before caching via cacheKey().
   */
  async deriveKey(driveId: string, password: string): Promise<DriveKey> {
    if (!this.walletJson) {
      throw new Error('Wallet not loaded');
    }
    return deriveDriveKey(password, driveId, JSON.stringify(this.walletJson));
  }

  /**
   * Cache a VERIFIED drive key for the session. Only call after the key has
   * been proven by trial decryption (or for a drive this session just
   * created, where the password is known-correct).
   */
  cacheKey(driveId: string, driveKey: DriveKey): void {
    this.drivesKeyCache.set(driveId, driveKey);
    console.log(`[DRIVE-KEY-MANAGER] ✅ Drive ${driveId.slice(0, 8)}... unlocked for session`);
  }

  /**
   * Derive + cache WITHOUT verification. Only safe when the password is
   * known-correct — i.e. for a drive this session just created with that
   * same password. User-supplied unlocks go through
   * SecureWalletManager.unlockPrivateDrive (trial decryption, PRIV-2).
   */
  async unlockDriveUnverified(driveId: string, password: string): Promise<boolean> {
    try {
      const driveKey = await this.deriveKey(driveId, password);
      this.cacheKey(driveId, driveKey);
      return true;
    } catch (error) {
      console.error(`[DRIVE-KEY-MANAGER] ❌ Failed to unlock drive ${driveId.slice(0, 8)}:`, error);
      return false;
    }
  }

  /**
   * Lock a specific drive (remove from the session cache). This does NOT change
   * the persistence preference — a remembered drive stays remembered and will be
   * restored on next login. Use setPersistence(driveId, false) to forget it.
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

  // ===== PERSISTENCE (PRIV-4) =====

  /**
   * Serialize a live drive key to its on-disk (pre-encryption) record.
   * Stores only the raw key bytes (base64) and the signature version — never
   * the password. §3.4 fix: the parked WIP did `Buffer.from(key)` which throws
   * on an EntityKey; the correct form is `key.keyData.toString('base64')`.
   */
  private serializeKey(key: DriveKey): PersistedKeyRecord {
    return {
      keyData: key.keyData.toString('base64'),
      driveSignatureType: getDriveSignatureType(key),
      persistedAt: Date.now()
    };
  }

  /**
   * Reconstruct a drive key from its stored record. §3.4/§3.5 fix: rebuild an
   * EntityKey/VersionedDriveKey from the bytes so downstream `key.keyData`
   * decryption works (the WIP cached a raw Buffer, leaving keyData undefined).
   * A recorded signature type reconstructs a VersionedDriveKey (matching what
   * deriveDriveKey emits); its absence falls back to a plain EntityKey.
   */
  private deserializeKey(record: PersistedKeyRecord): DriveKey {
    const buffer = Buffer.from(record.keyData, 'base64');
    if (record.driveSignatureType !== undefined && record.driveSignatureType !== null) {
      return new VersionedDriveKey(buffer, record.driveSignatureType as DriveSignatureType);
    }
    return new EntityKey(buffer);
  }

  /**
   * Whether a drive's key is set to persist across sessions.
   */
  isPersisted(driveId: string): boolean {
    return this.persistedDriveIds.has(driveId);
  }

  /**
   * List of drives currently marked to persist.
   */
  getPersistedDriveIds(): string[] {
    return Array.from(this.persistedDriveIds);
  }

  /**
   * Opt a drive in (persist=true) or out (persist=false) of persistence and
   * rewrite the encrypted keys file accordingly. Opting in requires the drive to
   * be unlocked in the session (its key must be available to persist).
   * `sessionPassword` encrypts the file at rest.
   *
   * Returns true on success; false if the drive can't be persisted (not unlocked)
   * or no session password is available.
   */
  async setPersistence(driveId: string, persist: boolean, sessionPassword: string | null): Promise<boolean> {
    if (persist) {
      if (!this.drivesKeyCache.has(driveId)) {
        console.warn(`[DRIVE-KEY-MANAGER] Cannot persist locked drive ${driveId.slice(0, 8)}...`);
        return false;
      }
      this.persistedDriveIds.add(driveId);
    } else {
      this.persistedDriveIds.delete(driveId);
    }

    if (!sessionPassword) {
      // Roll back the in-memory change we can't durably record.
      if (persist) {
        this.persistedDriveIds.delete(driveId);
      }
      console.warn('[DRIVE-KEY-MANAGER] No session password — persistence preference not saved');
      return false;
    }

    await this.savePersistedKeys(sessionPassword);
    return true;
  }

  /**
   * Encrypt and write the currently-opted-in drive keys to disk. If none remain,
   * the file is securely deleted. Encrypted at rest via crypto-utils.
   */
  async savePersistedKeys(sessionPassword: string): Promise<void> {
    if (!this.currentProfileId) return;

    const keysToSave: Record<string, PersistedKeyRecord> = {};
    for (const driveId of this.persistedDriveIds) {
      const key = this.drivesKeyCache.get(driveId);
      if (key) {
        keysToSave[driveId] = this.serializeKey(key);
      }
    }

    const storagePath = this.getDriveKeysStoragePath();

    if (Object.keys(keysToSave).length === 0) {
      // Nothing to persist — remove the file so no stale ciphertext lingers.
      await secureDeleteFile(storagePath).catch(() => {});
      console.log('[DRIVE-KEY-MANAGER] No persisted keys remain; storage removed');
      return;
    }

    await writeEncryptedFile(storagePath, JSON.stringify(keysToSave), sessionPassword);
    console.log(`[DRIVE-KEY-MANAGER] Saved ${Object.keys(keysToSave).length} persisted drive key(s) (encrypted)`);
  }

  /**
   * Decrypt and restore opted-in drive keys into the session cache. Called on
   * login with the session password (plan step 5). Returns the number restored.
   * Failures (missing file, wrong password, corrupt data) fail closed → 0 keys,
   * so affected drives stay locked and require a manual unlock.
   */
  async restorePersistedKeys(sessionPassword: string): Promise<number> {
    if (!this.currentProfileId) return 0;

    const storagePath = this.getDriveKeysStoragePath();
    try {
      await fs.access(storagePath);
    } catch {
      // No persisted keys for this profile.
      return 0;
    }

    try {
      const decrypted = await readEncryptedFile(storagePath, sessionPassword);
      const records = JSON.parse(decrypted) as Record<string, PersistedKeyRecord>;

      let restored = 0;
      for (const [driveId, record] of Object.entries(records)) {
        try {
          const key = this.deserializeKey(record);
          this.drivesKeyCache.set(driveId, key);
          this.persistedDriveIds.add(driveId);
          restored++;
        } catch (error) {
          console.error(`[DRIVE-KEY-MANAGER] Failed to restore key for drive ${driveId.slice(0, 8)}:`, error);
        }
      }

      console.log(`[DRIVE-KEY-MANAGER] Restored ${restored} persisted drive key(s)`);
      return restored;
    } catch (error) {
      console.error('[DRIVE-KEY-MANAGER] Failed to restore persisted keys (fail-closed):', error);
      return 0;
    }
  }

  /**
   * Securely delete this profile's persisted keys file (used when the wallet is
   * being fully cleared). Profile DELETION already removes the whole directory;
   * this covers the "clear stored wallet" path so no encrypted key file lingers.
   */
  async clearPersistedStorage(): Promise<void> {
    if (!this.currentProfileId) return;
    try {
      await secureDeleteFile(this.getDriveKeysStoragePath());
      console.log('[DRIVE-KEY-MANAGER] Removed persisted drive keys file');
    } catch {
      // File may not exist — nothing to remove.
    }
    this.persistedDriveIds.clear();
  }

  /**
   * Clear all cached keys and in-memory persistence state (used on logout /
   * profile switch). The encrypted keys FILE is left intact so the SAME profile
   * auto-unlocks on next login; only in-memory material is dropped.
   */
  clearAllKeys(): void {
    const driveCount = this.drivesKeyCache.size;

    this.drivesKeyCache.clear();
    this.persistedDriveIds.clear();
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
}

// Export singleton instance
export const driveKeyManager = new DriveKeyManager();
