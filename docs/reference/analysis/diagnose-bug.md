# Password Bug Diagnosis

## Bug Description
User creates a profile, sets a password, logs out, and then the password is invalid when logging back in.

## Key Findings

### 1. Encryption/Decryption Works Fine
- The crypto-utils module correctly encrypts and decrypts data
- All special characters and edge cases work correctly
- The scrypt key derivation is functioning properly

### 2. Path Inconsistency Found
- `getWalletStoragePath()` returns: `profiles/{profileId}/wallet.enc`
- `getProfileWalletPath()` returns: `profiles/{profileId}/wallet` (a directory)
- Export manager looks for wallet at wrong path: `profiles/{profileId}/wallet/wallet.enc`

### 3. Profile Flow Analysis
1. **Import Wallet**:
   - Creates/finds profile
   - Sets `this.currentProfileId = profile.id`
   - Encrypts wallet to `profiles/{profileId}/wallet.enc`
   - Stores password in `this.sessionPassword`

2. **Logout** (implied by "logs out"):
   - `clearInMemoryWallet()` is called
   - Sets `this.sessionPassword = null`
   - Sets `this.currentProfileId = null` (indirectly)

3. **Login** (switch back to profile):
   - `switchProfile(profileId, password)` is called
   - Temporarily sets `this.currentProfileId = profileId`
   - Tries to decrypt from `profiles/{profileId}/wallet.enc`

## Potential Root Causes

### 1. File System Race Condition
The wallet file might not be fully written to disk before the user logs out.

### 2. Profile ID Generation Issue
The profile ID uses `crypto.lib.WordArray.random(16).toString()` which might have issues.

### 3. Directory Creation Issue
The profile directory is created, but there might be a permission issue.

### 4. State Management Issue
The profile state might not be properly persisted between sessions.

## Most Likely Cause

Based on the analysis, the most likely issue is that **the wallet file is not being properly flushed to disk** before the user logs out. This could happen if:

1. The user logs out immediately after creating the profile
2. The file write operation hasn't completed
3. The electron app closes before the write is complete

## Recommended Fix

1. Ensure all file writes are properly awaited
2. Add a file sync operation after writing the encrypted wallet
3. Add proper error handling to catch write failures
4. Consider adding a small delay or confirmation after profile creation