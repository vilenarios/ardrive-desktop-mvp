# Selective Private Drive Key Persistence - Implementation Plan

> **SUPERSEDED (2026-07-02)** — the partial implementation of this plan (steps 1-4) has a fatal serialization bug and steps 5-7 were never built (see docs/product/AUDIT-2026-07-02.md §3.4). The design remains the reference for Track A, but work is tracked as **PRIV-4** in docs/product/BACKLOG.md. Do not resume from this doc's checklist.

## Overview
Allow users to optionally persist private drive keys (encrypted) so they don't need to re-enter drive passwords every session. Users can choose per-drive whether to enable persistence via a checkbox during unlock.

## Key Principles
1. **User Control** - Explicit opt-in per drive
2. **Security** - Drive keys encrypted with session password (same as wallet)
3. **Clarity** - Clear UI messaging about what's being saved
4. **Flexibility** - Can enable/disable persistence per drive

## What Gets Stored
- **Drive KEY** (derived from password) - NOT the password itself
- **Persistence preference** - Whether user opted to persist this drive
- **Encrypted storage** - Keys encrypted using session password

## Implementation Components

### 1. Database Schema Changes

Add to `database-manager.ts`:

```sql
CREATE TABLE IF NOT EXISTS drive_key_preferences (
  drive_id TEXT PRIMARY KEY,
  persist_key BOOLEAN DEFAULT FALSE,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### 2. Drive Key Manager Updates

`src/main/drive-key-manager.ts`:

```typescript
import { writeEncryptedFile, readEncryptedFile, secureDeleteFile } from './crypto-utils';
import * as path from 'path';
import * as fs from 'fs/promises';
import { app } from 'electron';

export class DriveKeyManager {
  private drivesKeyCache: Map<string, DriveKey> = new Map();
  private persistedDriveIds: Set<string> = new Set(); // Track which drives should be persisted
  private walletJson: any = null;
  private currentProfileId: string | null = null;

  // Get storage path for encrypted drive keys
  private getDriveKeysStoragePath(): string {
    if (!this.currentProfileId) {
      throw new Error('No profile ID set');
    }
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'profiles', this.currentProfileId, 'drive-keys.enc');
  }

  // Set current profile
  setProfile(profileId: string): void {
    this.currentProfileId = profileId;
  }

  // Unlock drive with optional persistence
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

      console.log(`[DRIVE-KEY-MANAGER] Unlocking drive ${driveId.slice(0, 8)}... (persist: ${persistKey})`);

      // Derive drive key
      const driveKey = await deriveDriveKey(
        password,
        driveId,
        JSON.stringify(this.walletJson)
      );

      // Cache the key
      this.drivesKeyCache.set(driveId, driveKey);
      
      // Track persistence preference
      if (persistKey) {
        this.persistedDriveIds.add(driveId);
        
        // Save immediately if we have session password
        if (sessionPassword) {
          await this.savePersistedKeys(sessionPassword);
        }
      } else {
        this.persistedDriveIds.delete(driveId);
        // Remove from persistent storage if it was there
        if (sessionPassword) {
          await this.savePersistedKeys(sessionPassword);
        }
      }
      
      console.log(`[DRIVE-KEY-MANAGER] ✅ Drive unlocked (persisted: ${persistKey})`);
      return true;
    } catch (error) {
      console.error(`[DRIVE-KEY-MANAGER] ❌ Failed to unlock drive:`, error);
      return false;
    }
  }

  // Save only the keys that user opted to persist
  async savePersistedKeys(sessionPassword: string): Promise<void> {
    if (!this.currentProfileId) return;

    const keysToSave: Record<string, any> = {};
    
    // Only save keys that are marked for persistence
    for (const driveId of this.persistedDriveIds) {
      const key = this.drivesKeyCache.get(driveId);
      if (key) {
        // Store the key data in a serializable format
        keysToSave[driveId] = {
          keyData: (key as any).keyData || key,
          persistedAt: Date.now()
        };
      }
    }

    if (Object.keys(keysToSave).length === 0) {
      // No keys to persist, delete the file if it exists
      try {
        await secureDeleteFile(this.getDriveKeysStoragePath());
      } catch {
        // File might not exist
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

  // Load persisted keys on session restore
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
        const keyData = (keyInfo as any).keyData;
        // Reconstruct the DriveKey object
        this.drivesKeyCache.set(driveId, keyData);
        this.persistedDriveIds.add(driveId);
        loadedCount++;
      }
      
      console.log(`[DRIVE-KEY-MANAGER] Loaded ${loadedCount} persisted drive keys`);
      return loadedCount;
    } catch (error) {
      console.error('[DRIVE-KEY-MANAGER] Failed to load persisted keys:', error);
      return 0;
    }
  }

  // Update persistence preference for a drive
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
    if (sessionPassword) {
      await this.savePersistedKeys(sessionPassword);
    }
  }

  // Check if a drive's key is set to persist
  isPersisted(driveId: string): boolean {
    return this.persistedDriveIds.has(driveId);
  }

  // Clear all keys and storage
  async clearAllKeysAndStorage(): Promise<void> {
    this.drivesKeyCache.clear();
    this.persistedDriveIds.clear();
    this.walletJson = null;

    if (this.currentProfileId) {
      try {
        await secureDeleteFile(this.getDriveKeysStoragePath());
      } catch {
        // File might not exist
      }
    }
    
    console.log('[DRIVE-KEY-MANAGER] Cleared all keys and storage');
  }
}
```

### 3. UI Changes - Unlock Modal

Update `src/renderer/components/PrivateDriveUnlockModal.tsx`:

```typescript
interface PrivateDriveUnlockModalProps {
  drive: DriveInfoWithStatus;
  isOpen: boolean;
  onUnlock: (password: string, persistKey: boolean) => Promise<boolean>;
  onCancel: () => void;
}

export const PrivateDriveUnlockModal: React.FC<PrivateDriveUnlockModalProps> = ({
  drive,
  isOpen,
  onUnlock,
  onCancel
}) => {
  const [password, setPassword] = useState('');
  const [persistKey, setPersistKey] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    try {
      setIsUnlocking(true);
      setError(null);
      
      const success = await onUnlock(password, persistKey);
      
      if (success) {
        setPassword('');
        setPersistKey(false);
      } else {
        setError('Incorrect password. Please try again.');
      }
    } catch (err) {
      setError('Failed to unlock drive');
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <Modal isOpen={isOpen}>
      {/* ... existing modal content ... */}
      
      {/* Add checkbox for persistence */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        marginTop: 'var(--space-4)',
        marginBottom: 'var(--space-4)'
      }}>
        <input
          type="checkbox"
          id="persist-key"
          checked={persistKey}
          onChange={(e) => setPersistKey(e.target.checked)}
          style={{
            marginTop: '4px',
            cursor: 'pointer'
          }}
        />
        <label 
          htmlFor="persist-key"
          style={{
            fontSize: '14px',
            color: 'var(--gray-700)',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div>Remember this drive password</div>
          <div style={{
            fontSize: '12px',
            color: 'var(--gray-500)',
            marginTop: '4px'
          }}>
            Your drive password will be securely stored on this device. 
            You won't need to enter it again after logging in.
          </div>
        </label>
      </div>

      {/* ... existing buttons ... */}
    </Modal>
  );
};
```

### 4. IPC Handler Updates

In `src/main/main.ts`:

```typescript
// Modified unlock handler
ipcMain.handle('drive:unlock', safeIpcHandler(async (_, driveId: string, password: string, persistKey?: boolean) => {
  // Get session password for encryption if user wants to persist
  let sessionPassword: string | undefined;
  if (persistKey) {
    sessionPassword = await this.walletManager.getSessionPassword();
    if (!sessionPassword) {
      console.warn('Cannot persist drive key without session password');
      persistKey = false;
    }
  }

  // Unlock with persistence option
  const success = await driveKeyManager.unlockDrive(
    driveId, 
    password, 
    persistKey || false,
    sessionPassword
  );

  if (success && persistKey) {
    // Store preference in database
    await databaseManager.setDriveKeyPersistence(driveId, true);
  }

  return success;
}));

// Load persisted keys on wallet load
ipcMain.handle('wallet:ensure-loaded', safeIpcHandler(async () => {
  const loaded = await this.walletManager.ensureWalletLoaded();
  
  if (loaded) {
    // Get session password
    const sessionPassword = await this.walletManager.getSessionPassword();
    if (sessionPassword) {
      // Set profile and load persisted drive keys
      const profile = profileManager.getActiveProfile();
      if (profile) {
        driveKeyManager.setProfile(profile.id);
        const loadedCount = await driveKeyManager.loadPersistedKeys(sessionPassword);
        console.log(`Restored ${loadedCount} persisted drive keys`);
      }
    }
  }
  
  return loaded;
}));

// Check persistence status
ipcMain.handle('drive:isPersisted', safeIpcHandler(async (_, driveId: string) => {
  return driveKeyManager.isPersisted(driveId);
}));

// Update persistence preference
ipcMain.handle('drive:setPersistence', safeIpcHandler(async (_, driveId: string, persist: boolean) => {
  const sessionPassword = await this.walletManager.getSessionPassword();
  
  await driveKeyManager.updatePersistencePreference(driveId, persist, sessionPassword);
  await databaseManager.setDriveKeyPersistence(driveId, persist);
  
  return true;
}));
```

### 5. App.tsx Session Restore

Update `src/renderer/App.tsx` to handle auto-unlocked drives:

```typescript
// In the session restore logic
if (activeDrive && activeDrive.privacy === 'private') {
  const isUnlocked = await window.electronAPI.drive.isUnlocked(activeDrive.id);
  if (!isUnlocked) {
    console.log('Primary drive is private and locked');
    
    // Check if it was persisted and should be auto-unlocked
    const isPersisted = await window.electronAPI.drive.isPersisted(activeDrive.id);
    if (isPersisted) {
      console.log('Drive key was persisted, should be auto-unlocked');
      // Key should already be loaded, just proceed
      // The drive should now be unlocked from the loaded keys
    } else {
      // User must manually unlock
      console.log('Drive key not persisted, user must unlock');
      setIsReturningUser(true);
      setAppState('welcome-back');
      return;
    }
  }
}
```

### 6. Settings/Management UI

Add a section in drive settings to manage persistence:

```typescript
// In a drive settings component
const DriveSecuritySettings = ({ drive }) => {
  const [isPersisted, setIsPersisted] = useState(false);
  
  useEffect(() => {
    loadPersistenceStatus();
  }, [drive.id]);
  
  const loadPersistenceStatus = async () => {
    const status = await window.electronAPI.drive.isPersisted(drive.id);
    setIsPersisted(status);
  };
  
  const handleTogglePersistence = async () => {
    const newValue = !isPersisted;
    await window.electronAPI.drive.setPersistence(drive.id, newValue);
    setIsPersisted(newValue);
    
    if (!newValue) {
      toast.info('Drive password will be required on next login');
    } else {
      toast.success('Drive password will be remembered');
    }
  };
  
  return (
    <div>
      <h3>Security Settings</h3>
      <label>
        <input
          type="checkbox"
          checked={isPersisted}
          onChange={handleTogglePersistence}
        />
        Remember drive password on this device
      </label>
      <p>
        When enabled, you won't need to enter the drive password 
        after logging in with your session password.
      </p>
    </div>
  );
};
```

## User Experience Flow

### First Time Unlock:
1. User selects locked private drive
2. Unlock modal appears with password field
3. **NEW**: Checkbox appears: "Remember this drive password"
4. User enters password and optionally checks the box
5. Drive unlocks and preference is saved

### Returning User (Key Persisted):
1. User logs in with session password
2. Persisted drive keys are automatically loaded
3. User goes directly to dashboard with drive unlocked
4. No need to enter drive password

### Returning User (Key NOT Persisted):
1. User logs in with session password
2. Drive shows as locked
3. User must unlock with drive password
4. Can choose to persist it this time

### Managing Persistence:
1. User can go to drive settings
2. Toggle "Remember drive password" on/off
3. Changes take effect immediately
4. Turning off removes stored key

## Security Considerations

1. **Encryption**: Drive keys encrypted with session password (same as wallet)
2. **Opt-in**: Users must explicitly choose to persist
3. **Clear messaging**: UI explains what's being stored
4. **Profile isolation**: Each profile has separate key storage
5. **Secure deletion**: Keys securely wiped on logout/disable
6. **No password storage**: Only derived keys are stored, not passwords

## Benefits

1. **User Control**: Choose security vs. convenience per drive
2. **Flexibility**: Can change preference anytime
3. **Consistency**: Similar to "Remember me" patterns
4. **Security**: Same encryption as wallet storage
5. **UX**: Smooth experience for users who opt in

## Implementation Steps

1. Update DriveKeyManager with persistence methods
2. Add database schema for preferences
3. Update PrivateDriveUnlockModal with checkbox
4. Modify IPC handlers for persistence
5. Update session restore logic
6. Add settings UI for managing persistence
7. Test thoroughly with multiple scenarios

## Testing Checklist

- [ ] Unlock drive with persistence enabled
- [ ] Logout and login - verify auto-unlock
- [ ] Unlock drive without persistence
- [ ] Logout and login - verify manual unlock required
- [ ] Toggle persistence in settings
- [ ] Multiple drives with different persistence settings
- [ ] Profile switching clears keys correctly
- [ ] Secure deletion of keys when disabled