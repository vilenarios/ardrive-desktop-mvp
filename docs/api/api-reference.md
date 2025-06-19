# ArDrive Desktop API Documentation

This document details the IPC (Inter-Process Communication) API between the renderer and main processes in ArDrive Desktop.

## Table of Contents

- [Overview](#overview)
- [Authentication APIs](#authentication-apis)
- [Profile Management APIs](#profile-management-apis)
- [Wallet APIs](#wallet-apis)
- [Drive APIs](#drive-apis)
- [File Sync APIs](#file-sync-apis)
- [Upload APIs](#upload-apis)
- [Turbo APIs](#turbo-apis)
- [ArNS APIs](#arns-apis)
- [Configuration APIs](#configuration-apis)
- [Error Handling](#error-handling)

## Overview

ArDrive Desktop uses Electron's IPC mechanism for secure communication between the renderer (UI) and main (backend) processes. All sensitive operations are performed in the main process for security.

### API Conventions

- All APIs are asynchronous and return Promises
- Errors are thrown and should be caught by the caller
- Type safety is enforced via TypeScript
- Input validation occurs in the main process

### Basic Usage

```typescript
// In renderer process
const result = await window.api.wallet.getInfo();

// Type-safe with TypeScript
interface WalletInfo {
  address: string;
  balance: string;
  balanceAR: number;
  balanceUSD: number;
  nickname?: string;
  avatarUrl?: string;
  arnsName?: string;
  walletType: 'arweave' | 'ethereum';
}
```

## Authentication APIs

### Check Authentication Status

```typescript
const isAuthenticated = await window.api.auth.isAuthenticated();
// Returns: boolean
```

### Logout

```typescript
await window.api.auth.logout();
// Returns: void
// Clears session and returns to login screen
```

## Profile Management APIs

### List All Profiles

```typescript
const profiles = await window.api.profiles.list();
// Returns: Profile[]

interface Profile {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
  arnsName?: string;
  createdAt: Date;
  lastUsedAt: Date;
}
```

### Get Active Profile

```typescript
const activeProfile = await window.api.profiles.getActive();
// Returns: Profile | null
```

### Switch Profile

```typescript
const result = await window.api.profiles.switch(profileId: string, password: string);
// Returns: { success: boolean; profile?: Profile; error?: string }

// Example:
try {
  const result = await window.api.profiles.switch('profile-123', 'myPassword');
  if (result.success) {
    console.log('Switched to:', result.profile.name);
  }
} catch (error) {
  console.error('Switch failed:', error.message);
}
```

### Create Profile

```typescript
const profile = await window.api.profiles.create(
  name: string,
  address: string,
  walletData: string,
  password: string
);
// Returns: Profile

// Example:
const newProfile = await window.api.profiles.create(
  'Work Wallet',
  'BSV3n7BnrtwqL9cUdpVBJnQLpPr-SRpU0xGW5NfxFbE',
  walletJsonString,
  'strongPassword123'
);
```

### Update Profile

```typescript
await window.api.profiles.update(
  profileId: string,
  updates: { name?: string; avatarUrl?: string }
);
// Returns: void

// Example:
await window.api.profiles.update('profile-123', {
  name: 'Updated Name',
  avatarUrl: 'https://arweave.net/avatar-tx-id'
});
```

### Delete Profile

```typescript
await window.api.profiles.delete(profileId: string, password: string);
// Returns: void
// Requires password confirmation for security
```

## Wallet APIs

### Import Wallet from File

```typescript
const info = await window.api.wallet.import(
  walletPath: string,
  password: string
);
// Returns: WalletInfo

// Example:
const wallet = await window.api.wallet.import(
  '/Users/me/wallet.json',
  'myPassword'
);
```

### Import from Seed Phrase

```typescript
const info = await window.api.wallet.importFromSeedPhrase(
  seedPhrase: string,
  password: string
);
// Returns: WalletInfo

// Example:
const wallet = await window.api.wallet.importFromSeedPhrase(
  'word1 word2 word3 ... word12',
  'newPassword'
);
```

### Get Wallet Info

```typescript
const info = await window.api.wallet.getInfo();
// Returns: WalletInfo | null

interface WalletInfo {
  address: string;
  balance: string;        // Winston units
  balanceAR: number;      // AR tokens
  balanceUSD: number;     // USD value
  nickname?: string;      // Profile name
  avatarUrl?: string;     // Avatar URL
  arnsName?: string;      // ArNS name
  walletType: 'arweave' | 'ethereum';
}
```

### Check if Wallet Loaded

```typescript
const isLoaded = await window.api.wallet.isLoaded();
// Returns: boolean
```

### Load Wallet with Password

```typescript
const info = await window.api.wallet.loadWithPassword(password: string);
// Returns: WalletInfo
// Used for re-authentication after app restart
```

## Drive APIs

### List User Drives

```typescript
const drives = await window.api.drive.list();
// Returns: Drive[]

interface Drive {
  id: string;
  name: string;
  privacy: 'private' | 'public';
  rootFolderId: string;
  size: number;
  fileCount: number;
  lastUpdated: Date;
}
```

### Create New Drive

```typescript
const drive = await window.api.drive.create(
  name: string,
  privacy: 'private' | 'public'
);
// Returns: Drive

// Example:
const newDrive = await window.api.drive.create(
  'My Documents',
  'private'
);
```

### Select Active Drive

```typescript
await window.api.drive.select(driveId: string);
// Returns: void
// Sets the drive for file sync operations
```

### Get Selected Drive

```typescript
const drive = await window.api.drive.getSelected();
// Returns: Drive | null
```

## File Sync APIs

### Set Sync Folder

```typescript
const path = await window.api.sync.setFolder(
  driveId: string,
  folderPath?: string
);
// Returns: string (selected folder path)

// Example - with dialog:
const folder = await window.api.sync.setFolder(drive.id);

// Example - with specific path:
const folder = await window.api.sync.setFolder(
  drive.id,
  '/Users/me/Documents/ArDrive'
);
```

### Start Sync

```typescript
await window.api.sync.start(
  driveId: string,
  rootFolderId: string
);
// Returns: void

// Example:
await window.api.sync.start(drive.id, drive.rootFolderId);
```

### Stop Sync

```typescript
await window.api.sync.stop();
// Returns: void
```

### Get Sync Status

```typescript
const status = await window.api.sync.getStatus();
// Returns: SyncStatus

interface SyncStatus {
  isRunning: boolean;
  currentDriveId?: string;
  syncFolder?: string;
  uploadsInProgress: number;
  downloadsInProgress: number;
  lastSyncTime?: Date;
}
```

### Force Download All Files

```typescript
await window.api.sync.forceDownloadAll();
// Returns: void
// Downloads all files from current drive
```

## Upload APIs

### Get Pending Uploads

```typescript
const pending = await window.api.uploads.getPending();
// Returns: PendingUpload[]

interface PendingUpload {
  id: string;
  localPath: string;
  fileName: string;
  fileSize: number;
  fileHash: string;
  arCost: string;         // AR cost in Winston
  turboCost: string;      // Turbo cost in credits
  recommendedMethod: 'ar' | 'turbo';
  createdAt: Date;
}
```

### Approve Uploads

```typescript
await window.api.uploads.approve(
  uploadIds: string[],
  method: 'ar' | 'turbo'
);
// Returns: void

// Example:
await window.api.uploads.approve(
  ['upload-1', 'upload-2'],
  'turbo'
);
```

### Reject Uploads

```typescript
await window.api.uploads.reject(uploadIds: string[]);
// Returns: void
// Removes from pending queue
```

### Get Upload History

```typescript
const history = await window.api.uploads.getHistory(
  limit?: number,
  offset?: number
);
// Returns: Upload[]

interface Upload {
  id: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;       // 0-100
  uploadMethod: 'ar' | 'turbo';
  dataTxId?: string;      // Arweave transaction ID
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
```

## Turbo APIs

### Get Turbo Balance

```typescript
const balance = await window.api.turbo.getBalance();
// Returns: TurboBalance

interface TurboBalance {
  credits: string;        // Credit balance
  creditsFormatted: string; // Human-readable
  usdEquivalent: number;  // USD value
  winc: string;           // Winston credits
}
```

### Get Upload Costs

```typescript
const costs = await window.api.turbo.getUploadCosts(bytes: number);
// Returns: UploadCosts

interface UploadCosts {
  arCost: string;         // AR Winston cost
  arCostFormatted: string; // Human-readable AR
  turboCost: string;      // Turbo credit cost
  turboCostFormatted: string; // Human-readable
  recommendedMethod: 'ar' | 'turbo';
}

// Example:
const costs = await window.api.turbo.getUploadCosts(1024 * 1024); // 1MB
```

### Create Checkout Session

```typescript
const session = await window.api.turbo.createCheckoutSession(
  amount: number,
  currency: 'usd'
);
// Returns: CheckoutSession

interface CheckoutSession {
  url: string;            // Payment URL
  sessionId: string;      // Session ID
  amount: number;
  currency: string;
}

// Example:
const session = await window.api.turbo.createCheckoutSession(10, 'usd');
// Opens payment page in browser
```

### Top Up with Tokens

```typescript
const result = await window.api.turbo.topUpWithTokens(
  tokenAmount: number,
  tokenType: string,
  feeMultiplier?: number
);
// Returns: TopUpResult

interface TopUpResult {
  success: boolean;
  paymentId?: string;
  newBalance?: TurboBalance;
  error?: string;
}
```

## ArNS APIs

### Get Primary Name

```typescript
const arnsInfo = await window.api.arns.getPrimaryName(address: string);
// Returns: ArNSInfo | null

interface ArNSInfo {
  name: string;           // e.g., 'nickname'
  domain: string;         // e.g., 'nickname.ar'
  avatarUrl?: string;     // Avatar transaction URL
  bannerUrl?: string;     // Banner transaction URL
}

// Example:
const arns = await window.api.arns.getPrimaryName(wallet.address);
```

### Resolve ArNS Name

```typescript
const address = await window.api.arns.resolveName(name: string);
// Returns: string | null

// Example:
const address = await window.api.arns.resolveName('vilenarios');
```

## Configuration APIs

### Get App Version

```typescript
const version = await window.api.config.getVersion();
// Returns: string (e.g., '1.0.0')
```

### Get User Data Path

```typescript
const path = await window.api.config.getUserDataPath();
// Returns: string
// Platform-specific user data directory
```

### Open External Link

```typescript
await window.api.config.openExternal(url: string);
// Returns: void
// Opens URL in default browser
```

### Get Platform Info

```typescript
const platform = await window.api.config.getPlatform();
// Returns: PlatformInfo

interface PlatformInfo {
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  version: string;
}
```

## Error Handling

All API methods can throw errors. Handle them appropriately:

```typescript
try {
  const wallet = await window.api.wallet.import(path, password);
  // Success handling
} catch (error) {
  if (error.message.includes('Invalid password')) {
    // Handle invalid password
  } else if (error.message.includes('File not found')) {
    // Handle missing file
  } else {
    // Handle other errors
  }
}
```

### Common Error Types

1. **Authentication Errors**
   - Invalid password
   - Session expired
   - Profile not found

2. **Wallet Errors**
   - Invalid wallet file
   - Corrupted wallet
   - Insufficient balance

3. **Network Errors**
   - Connection timeout
   - API unavailable
   - Rate limiting

4. **File System Errors**
   - Permission denied
   - Disk full
   - File not found

5. **Validation Errors**
   - Invalid input
   - Missing required fields
   - Type mismatch

### Error Response Format

```typescript
interface APIError {
  code: string;           // Error code
  message: string;        // Human-readable message
  details?: any;          // Additional error details
}
```

## Best Practices

1. **Always handle errors**: Wrap API calls in try-catch
2. **Validate inputs**: Check data before sending
3. **Show loading states**: APIs are async
4. **Cache when appropriate**: Reduce API calls
5. **Use TypeScript**: Leverage type safety

## Example: Complete Flow

```typescript
// 1. Check if authenticated
const isAuth = await window.api.auth.isAuthenticated();

if (!isAuth) {
  // 2. Import wallet
  try {
    const wallet = await window.api.wallet.import(
      '/path/to/wallet.json',
      'password123'
    );
    
    // 3. Create profile
    const profile = await window.api.profiles.create(
      'My Profile',
      wallet.address,
      walletData,
      'password123'
    );
    
    // 4. Create drive
    const drive = await window.api.drive.create(
      'My Files',
      'private'
    );
    
    // 5. Set sync folder
    const folder = await window.api.sync.setFolder(drive.id);
    
    // 6. Start syncing
    await window.api.sync.start(drive.id, drive.rootFolderId);
    
  } catch (error) {
    console.error('Setup failed:', error);
  }
}
```

---

For more information, see the [Developer Guide](DEVELOPMENT.md) or join our [Discord](https://discord.gg/ardrive).