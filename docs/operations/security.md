# Security Guide

This document details the security implementation in ArDrive Desktop, including encryption methods, profile isolation, and best practices for users and developers.

## Table of Contents

- [Overview](#overview)
- [Encryption Implementation](#encryption-implementation)
- [Profile Isolation](#profile-isolation)
- [Password Management](#password-management)
- [Secure File Operations](#secure-file-operations)
- [Electron Security](#electron-security)
- [Security Best Practices](#security-best-practices)
- [Threat Model](#threat-model)
- [Incident Response](#incident-response)

## Overview

ArDrive Desktop implements bank-level security to protect users' private keys and ensure complete isolation between multiple user profiles. Our security architecture is built on industry-standard cryptographic primitives and follows security best practices.

**Latest Update**: Following a comprehensive security audit, we've completely rebuilt our encryption layer using Node.js native crypto module, eliminating all third-party crypto dependencies for maximum security.

### Key Security Features

- **AES-256-GCM** authenticated encryption
- **Scrypt** key derivation with high cost parameters
- **No password storage** on disk
- **Complete profile isolation**
- **Secure file deletion** with multi-pass overwriting
- **Memory clearing** for sensitive data
- **Electron security** best practices

## Encryption Implementation

### Algorithm Details

ArDrive Desktop uses the following cryptographic configuration:

```typescript
// Encryption Parameters
Algorithm: AES-256-GCM (Authenticated Encryption)
Key Size: 256 bits
IV Size: 128 bits
Tag Size: 128 bits
Salt Size: 256 bits

// Key Derivation Parameters
Function: Scrypt
N: 16384 (2^14) - CPU/memory cost
r: 8 - Block size
p: 1 - Parallelization
Memory: 128MB maximum
Derived Key Size: 256 bits
```

### Encryption Process

1. **Password Input**: User provides a password (minimum 8 characters)
2. **Salt Generation**: 256-bit cryptographically secure random salt
3. **Key Derivation**: Scrypt derives a 256-bit key from password + salt
4. **IV Generation**: 128-bit random initialization vector
5. **Encryption**: AES-256-GCM encrypts the wallet data
6. **Authentication**: GCM mode provides authentication tag
7. **Storage**: Encrypted data + salt + IV + tag stored in JSON format

### Decryption Process

1. **Load Encrypted Data**: Read JSON from profile storage
2. **Extract Components**: Parse salt, IV, tag, and ciphertext
3. **Key Derivation**: Derive key using password + stored salt
4. **Decrypt & Verify**: AES-256-GCM decrypts and verifies authentication
5. **Error Handling**: Fail safely if authentication fails (tampering detected)

### Implementation Details

#### Key Derivation Function
```typescript
// Scrypt with high-security parameters
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,     // 16384 (2^14) - CPU/memory cost
      r: SCRYPT_R,     // 8 - Block size
      p: SCRYPT_P,     // 1 - Parallelization
      maxmem: 134217728 // 128MB max memory
    }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}
```

#### Encryption Function
```typescript
// AES-256-GCM authenticated encryption
export async function encryptData(data: string, password: string): Promise<EncryptedData> {
  const salt = crypto.randomBytes(SALT_LENGTH);  // 32 bytes
  const iv = crypto.randomBytes(IV_LENGTH);      // 16 bytes
  const key = await deriveKey(password, salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ]);
  
  const tag = cipher.getAuthTag();  // 16 bytes authentication tag
  key.fill(0); // Clear key from memory immediately
  
  return {
    encrypted: encrypted.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    algorithm: ALGORITHM,
    scryptParams: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  };
}
```

#### Decryption Function
```typescript
// Decryption with authentication verification
export async function decryptData(encryptedData: EncryptedData, password: string): Promise<string> {
  const salt = Buffer.from(encryptedData.salt, 'base64');
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const tag = Buffer.from(encryptedData.tag, 'base64');
  const encrypted = Buffer.from(encryptedData.encrypted, 'base64');
  
  const key = await deriveKey(password, salt);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    key.fill(0); // Clear key from memory
    return decrypted.toString('utf8');
  } catch (error) {
    key.fill(0); // Clear key even on error
    throw new Error('Failed to decrypt: Invalid password or corrupted data');
  }
}
```

## Profile Isolation

### Directory Structure

Each profile is completely isolated with its own directory:

```
userData/
├── profiles/
│   ├── {profile-id-1}/
│   │   ├── wallet.enc       # Encrypted wallet (AES-256-GCM)
│   │   └── config.json      # Profile-specific settings
│   ├── {profile-id-2}/
│   │   ├── wallet.enc       # Different user's encrypted wallet
│   │   └── config.json      # Separate configuration
│   └── profiles.json        # Profile metadata (non-sensitive)
├── ardrive.db              # Shared database (to be isolated)
└── config.json             # Global app settings
```

### Profile Metadata

The `profiles.json` file contains only non-sensitive information:

```json
{
  "profiles": [
    {
      "id": "unique-profile-id",
      "name": "Work Wallet",
      "address": "1seRanklLU_1VTGkEk7P0xAwMJfA7owA1JHW5KyZKlY",
      "createdAt": "2024-01-15T10:30:00Z",
      "lastUsedAt": "2024-01-20T15:45:00Z",
      "avatarUrl": "https://arweave.net/...",
      "arnsName": "ardrive-user"
    }
  ],
  "activeProfileId": "unique-profile-id"
}
```

### Isolation Guarantees

1. **Wallet Isolation**: Each profile's wallet is encrypted with its own password
2. **Configuration Isolation**: Settings are stored per-profile
3. **No Cross-Profile Access**: Profiles cannot access each other's data
4. **Secure Switching**: Password required to switch profiles
5. **Memory Clearing**: Previous profile data cleared from memory

## Password Management

### No Password Storage Policy

ArDrive Desktop **never stores passwords on disk**. This is a critical security feature:

- ✅ Passwords only exist in memory during active sessions
- ✅ Users must re-enter password when switching profiles
- ✅ No "remember me" functionality that could be exploited
- ✅ Protection against local privilege escalation attacks

### Password Requirements

- Minimum 8 characters
- No maximum length restriction
- All Unicode characters supported
- Strength indicator in UI
- Clear visual feedback

### Session Management

```typescript
// Password lifecycle
1. User enters password → Stored in memory
2. Password used to decrypt wallet → Key derived
3. Session active → Password in memory
4. Profile switch/logout → Password cleared
5. App restart → Password required again
```

## Secure File Operations

### Temporary File Handling

When working with wallet files, temporary files are created and securely deleted:

```typescript
export async function secureDeleteFile(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    
    // Overwrite with random data 3 times
    for (let i = 0; i < 3; i++) {
      const randomData = crypto.randomBytes(fileSize);
      await fs.writeFile(filePath, randomData);
    }
    
    // Finally delete the file
    await fs.unlink(filePath);
  } catch (error) {
    // Handle gracefully
  }
}
```

### Benefits

- **3-Pass Overwrite**: Makes recovery difficult even with forensic tools
- **Random Data**: Prevents pattern analysis
- **Guaranteed Deletion**: File removed after overwriting

## Electron Security

### Configuration

```javascript
// main.ts - BrowserWindow configuration
webPreferences: {
  nodeIntegration: false,      // Prevent renderer access to Node.js
  contextIsolation: true,      // Isolate preload scripts
  webSecurity: true,           // Enforce same-origin policy
  preload: preloadScript       // Controlled API exposure
}
```

### IPC Security

All IPC communication follows these principles:

1. **Validate All Inputs**: Never trust renderer process data
2. **Minimal API Surface**: Only expose necessary functions
3. **Type Safety**: TypeScript interfaces for all IPC calls
4. **Error Boundaries**: Graceful failure handling

### Content Security Policy

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https://arweave.net;">
```

## Security Best Practices

### For Users

1. **Password Selection**
   - Use unique passwords for each profile
   - Consider using a password manager
   - Enable 2FA on your email (wallet recovery)

2. **System Security**
   - Keep OS and ArDrive Desktop updated
   - Use full-disk encryption (BitLocker/FileVault)
   - Don't use ArDrive on shared/public computers

3. **Wallet Security**
   - Never share wallet files or seed phrases
   - Store backups in secure, encrypted locations
   - Verify app signatures before installation

### For Developers

1. **Code Security**
   ```typescript
   // Always clear sensitive data
   password = null;
   walletData.fill(0);
   
   // Use constant-time comparison
   crypto.timingSafeEqual(buffer1, buffer2);
   
   // Validate all inputs
   if (!isValidWalletFormat(wallet)) throw new Error();
   ```

2. **Dependency Security**
   - Regular `npm audit` checks
   - Automated dependency updates
   - Security-focused code reviews

3. **Build Security**
   - Code signing for releases
   - Reproducible builds
   - SBOM (Software Bill of Materials)

## Threat Model

### Threats Addressed

| Threat | Mitigation |
|--------|------------|
| Local attacker with file access | Encrypted wallets with strong KDF |
| Memory scraping | Sensitive data clearing |
| Profile crossover | Complete isolation |
| Tampering with encrypted data | Authenticated encryption (GCM) |
| Weak passwords | Minimum requirements + scrypt |
| Electron vulnerabilities | Security best practices |

### Known Limitations

1. **Physical Access**: Cannot protect against attackers with admin/root access
2. **Memory Dumps**: OS-level memory dumps may contain sensitive data
3. **Malware**: Cannot protect against system-level keyloggers or screen capture
4. **Shared Database**: SQLite database not yet per-profile (planned for v2.0)
5. **Electron Limitations**: Subject to Electron framework security constraints
6. **Network Security**: TLS/SSL for all Arweave communications, but no additional transport encryption

## Incident Response

### Reporting Security Issues

**DO NOT** create public GitHub issues for security vulnerabilities.

Instead:
1. Email: security@ardrive.io
2. Use PGP encryption (key available on website)
3. Include detailed steps to reproduce
4. Allow 90 days for patching before disclosure

### Security Updates

- Critical updates released immediately
- Regular security audits scheduled
- Automated security scanning in CI/CD
- Transparent disclosure policy

## Future Enhancements

### Planned Security Features

1. **Hardware Wallet Support** (Q2 2024)
   - Ledger integration for Arweave wallets
   - Trezor support following Ledger
   - No private keys stored on computer
   - Transaction signing on device

2. **Per-Profile Databases** (v2.0)
   - Separate SQLite database per profile
   - Optional database encryption
   - Secure inter-profile data migration

3. **Advanced Authentication** (Q3 2024)
   - Biometric support (Touch ID/Windows Hello)
   - Optional TOTP 2FA for profile access
   - Security key (FIDO2) support

4. **Security Audit** (Q1 2024)
   - Professional third-party audit scheduled
   - Public disclosure of findings
   - Transparent fix timeline

5. **Additional Enhancements**
   - Secure enclave integration (macOS)
   - TPM support (Windows)
   - Memory encryption for sensitive data
   - Automated security testing in CI/CD

## Security Checklist for Users

### Initial Setup
- [ ] Use a strong, unique password for each profile (12+ characters)
- [ ] Enable full-disk encryption on your device
- [ ] Keep your operating system updated
- [ ] Install ArDrive Desktop from official sources only

### Daily Use
- [ ] Lock your computer when away
- [ ] Don't use ArDrive on shared/public computers
- [ ] Verify transaction details before approval
- [ ] Keep backup of wallet files in secure location

### Maintenance
- [ ] Update ArDrive Desktop when prompted
- [ ] Review active profiles periodically
- [ ] Change passwords if device compromised
- [ ] Monitor wallet balances regularly

## Conclusion

ArDrive Desktop implements defense-in-depth security with multiple layers of protection. Our security architecture has been designed from the ground up to protect users' private keys while maintaining usability. While no system is perfectly secure, our implementation follows industry best practices and provides bank-level protection for users' digital assets.

### Security Commitment

We are committed to:
- Transparent security practices
- Regular security updates
- Responsible disclosure
- Community-driven improvements

For questions, concerns, or to report security issues, please contact security@ardrive.io.