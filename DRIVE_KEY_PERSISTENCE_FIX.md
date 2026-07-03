# Fix for Private Drive Auto-Unlock Issue

> **SUPERSEDED (2026-07-02)** — superseded first by SELECTIVE_DRIVE_PERSISTENCE_PLAN.md, then by the audit: the implementation attempted from these plans is broken (see docs/product/AUDIT-2026-07-02.md §3.4). Do not implement from this doc. Current work items: **PRIV-4** in docs/product/BACKLOG.md.

## Problem
When users with private drives log out and return to the app, they must re-unlock their private drives even after entering their session password. This happens because drive keys are not persisted between sessions, unlike wallet keys.

## Solution Design

### 1. Modify DriveKeyManager to Support Persistence

Update `src/main/drive-key-manager.ts`:

```typescript
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile } from './crypto-utils';
import * as path from 'path';
import { app } from 'electron';

export class DriveKeyManager {
  private drivesKeyCache: Map<string, DriveKey> = new Map();
  private walletJson: any = null;
  private currentProfileId: string | null = null;

  // Get path for storing encrypted drive keys
  private getDriveKeysStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No profile ID set');
    }
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'profiles', this.currentProfileId, 'drive-keys.enc');
  }

  // Set the current profile for storage
  setProfile(profileId: string): void {
    this.currentProfileId = profileId;
  }

  // Save drive keys securely (encrypted with session password)
  async saveDriveKeys(sessionPassword: string): Promise<void> {
    if (this.drivesKeyCache.size === 0) return;
    
    // Convert Map to serializable format
    const keysData = {};
    for (const [driveId, driveKey] of this.drivesKeyCache.entries()) {
      // Store the key data (this needs to be serializable)
      keysData[driveId] = driveKey;
    }
    
    // Encrypt and save
    await writeEncryptedFile(
      this.getDriveKeysStoragePath(),
      JSON.stringify(keysData),
      sessionPassword
    );
    
    console.log(`[DRIVE-KEY-MANAGER] Saved ${this.drivesKeyCache.size} drive keys securely`);
  }

  // Load drive keys from encrypted storage
  async loadDriveKeys(sessionPassword: string): Promise<boolean> {
    try {
      const storagePath = this.getDriveKeysStoragePath();
      
      // Check if file exists
      try {
        await fs.access(storagePath);
      } catch {
        // No saved keys
        return false;
      }
      
      // Decrypt and load
      const encryptedData = await readEncryptedFile(storagePath, sessionPassword);
      const keysData = JSON.parse(encryptedData);
      
      // Restore to cache
      this.drivesKeyCache.clear();
      for (const [driveId, keyData] of Object.entries(keysData)) {
        this.drivesKeyCache.set(driveId, keyData as DriveKey);
      }
      
      console.log(`[DRIVE-KEY-MANAGER] Loaded ${this.drivesKeyCache.size} drive keys`);
      return true;
    } catch (error) {
      console.error('[DRIVE-KEY-MANAGER] Failed to load drive keys:', error);
      return false;
    }
  }

  // Clear all keys and remove from storage
  async clearAllKeysAndStorage(): Promise<void> {
    this.clearAllKeys();
    
    if (this.currentProfileId) {
      try {
        await secureDeleteFile(this.getDriveKeysStoragePath());
      } catch {
        // File might not exist
      }
    }
  }

  // Modified unlock method - also saves keys
  async unlockDrive(driveId: string, password: string, sessionPassword?: string): Promise<boolean> {
    try {
      // ... existing unlock logic ...
      
      // After successful unlock, save if we have session password
      if (sessionPassword) {
        await this.saveDriveKeys(sessionPassword);
      }
      
      return true;
    } catch (error) {
      console.error(`[DRIVE-KEY-MANAGER] Failed to unlock drive:`, error);
      return false;
    }
  }
}
```

### 2. Update Main Process Handlers

In `src/main/main.ts`, modify the drive unlock handler:

```typescript
ipcMain.handle('drive:unlock', safeIpcHandler(async (_, driveId: string, password: string) => {
  // Get session password from wallet manager
  const sessionPassword = this.walletManager.getSessionPassword();
  
  // Unlock and save
  const success = await driveKeyManager.unlockDrive(driveId, password, sessionPassword);
  
  if (success) {
    // Update database or other state as needed
  }
  
  return success;
}));
```

### 3. Load Drive Keys on Session Restore

In `src/main/main.ts`, when loading wallet:

```typescript
ipcMain.handle('wallet:ensure-loaded', safeIpcHandler(async () => {
  const loaded = await this.walletManager.ensureWalletLoaded();
  
  if (loaded) {
    // Also load drive keys
    const sessionPassword = this.walletManager.getSessionPassword();
    if (sessionPassword) {
      driveKeyManager.setProfile(profileManager.getActiveProfile().id);
      await driveKeyManager.loadDriveKeys(sessionPassword);
    }
  }
  
  return loaded;
}));
```

### 4. Clear on Logout

```typescript
ipcMain.handle('wallet:logout', safeIpcHandler(async () => {
  await this.walletManager.logout();
  await driveKeyManager.clearAllKeysAndStorage();
  // ... rest of logout logic
}));
```

## Benefits
1. **Consistent UX** - Drive keys persist like wallet keys
2. **Secure** - Keys encrypted with session password
3. **Automatic** - No manual unlock needed after session restore
4. **Profile-specific** - Each profile has its own drive keys

## Implementation Steps
1. Update DriveKeyManager with persistence methods
2. Modify IPC handlers to use session password
3. Load drive keys when wallet is loaded
4. Clear drive keys on logout
5. Test with private drives

## Testing
1. Create a private drive
2. Unlock it with password
3. Log out
4. Log back in with session password
5. Verify drive is automatically unlocked
6. Verify can access private drive files without re-entering drive password