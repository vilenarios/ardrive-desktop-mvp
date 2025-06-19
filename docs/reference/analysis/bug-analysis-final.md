# Password Bug Root Cause Analysis

## Bug Description
User creates a profile with a password, logs out (or switches profiles), and then cannot log back in with the same password - getting "Invalid password" error.

## Root Cause
After extensive analysis, the bug is most likely caused by a **file system synchronization issue** where the encrypted wallet file is not fully written to disk before the user logs out or switches profiles.

## Evidence
1. The encryption/decryption logic works perfectly in isolation
2. The profile paths are correctly managed
3. The password is passed without transformation
4. The file writes are properly awaited in the code

## The Issue
On Windows/WSL2 systems, `fs.writeFile()` may return before the data is actually flushed to disk. If the user logs out or the app closes immediately after profile creation, the encrypted wallet file may be:
- Partially written
- Not written at all
- Written but not synced to disk

When the user tries to log back in, the decryption fails because the file is corrupted or incomplete.

## The Fix

### Option 1: Ensure File Sync (Recommended)
Update `crypto-utils.ts` to ensure files are properly synced to disk:

```typescript
export async function writeEncryptedFile(filePath: string, data: string, password: string): Promise<void> {
  // Ensure the directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  
  const encryptedData = await encryptData(data, password);
  
  // Write to a temporary file first
  const tempPath = filePath + '.tmp';
  const fileContent = JSON.stringify(encryptedData, null, 2);
  
  // Write to temp file
  await fs.writeFile(tempPath, fileContent, { encoding: 'utf8' });
  
  // Force sync to disk
  const fileHandle = await fs.open(tempPath, 'r+');
  await fileHandle.sync();
  await fileHandle.close();
  
  // Atomically rename to final path
  await fs.rename(tempPath, filePath);
}
```

### Option 2: Add Delay After Profile Creation
Add a small delay or loading state after profile creation to ensure file operations complete:

```typescript
// In wallet-manager-secure.ts after writeEncryptedFile
await writeEncryptedFile(this.getWalletStoragePath(), walletData, password);

// Ensure file is written
await new Promise(resolve => setTimeout(resolve, 100));
```

### Option 3: Verify File After Writing
Add verification that the file can be read back:

```typescript
// After writing
await writeEncryptedFile(this.getWalletStoragePath(), walletData, password);

// Verify it can be decrypted
try {
  await readEncryptedFile(this.getWalletStoragePath(), password);
} catch (error) {
  throw new Error('Failed to verify wallet encryption');
}
```

## Additional Fixes

### 1. Fix Path Inconsistency
In `wallet-export-manager.ts`, fix the path construction:

```typescript
// Change from:
const walletPath = path.join(profileDir, 'wallet.enc');

// To:
const walletPath = profileManager.getProfileStoragePath(profileId, 'wallet.enc');
```

### 2. Better Error Messages
Provide more specific error messages to help diagnose issues:

```typescript
// In loadWallet()
catch (error) {
  if (error.message.includes('ENOENT')) {
    throw new Error('Wallet file not found');
  } else if (error.message.includes('invalid password')) {
    throw new Error('Invalid password');
  } else {
    throw new Error(`Failed to load wallet: ${error.message}`);
  }
}
```

## Testing
To verify the fix:
1. Create a new profile with a password
2. Immediately log out (within 1-2 seconds)
3. Try to log back in with the same password
4. Should work without "Invalid password" error