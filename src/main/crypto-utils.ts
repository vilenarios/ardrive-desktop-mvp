import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Secure cryptographic utilities using Node.js native crypto module
 * Implements best practices for wallet encryption and key management
 */

// Constants for encryption
const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const SCRYPT_N = 16384; // CPU/memory cost parameter (2^14)
const SCRYPT_R = 8; // Block size parameter
const SCRYPT_P = 1; // Parallelization parameter

export interface EncryptedData {
  encrypted: string; // Base64 encoded encrypted data
  salt: string; // Base64 encoded salt
  iv: string; // Base64 encoded initialization vector
  tag: string; // Base64 encoded authentication tag
  algorithm: string; // Algorithm used (for future compatibility)
  scryptParams: {
    N: number;
    r: number;
    p: number;
  };
}

/**
 * Derives a key from a password using scrypt
 */
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 128 * 1024 * 1024 // 128MB
    }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Encrypts data using AES-256-GCM with scrypt key derivation
 */
export async function encryptData(data: string, password: string): Promise<EncryptedData> {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from password
  const key = await deriveKey(password, salt);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt data
  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ]);
  
  // Get authentication tag
  const tag = cipher.getAuthTag();
  
  // Clear sensitive data from memory
  key.fill(0);
  
  return {
    encrypted: encrypted.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    algorithm: ALGORITHM,
    scryptParams: {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P
    }
  };
}

/**
 * Decrypts data encrypted with encryptData
 */
export async function decryptData(encryptedData: EncryptedData, password: string): Promise<string> {
  // Decode from base64
  const encrypted = Buffer.from(encryptedData.encrypted, 'base64');
  const salt = Buffer.from(encryptedData.salt, 'base64');
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const tag = Buffer.from(encryptedData.tag, 'base64');
  
  // Derive key from password
  const key = await deriveKey(password, salt);
  
  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  try {
    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    // Clear sensitive data from memory
    key.fill(0);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // Clear sensitive data from memory
    key.fill(0);
    
    // Authentication failed - data may have been tampered with
    throw new Error('Failed to decrypt data - invalid password or corrupted data');
  }
}

/**
 * Securely writes encrypted data to a file
 */
export async function writeEncryptedFile(filePath: string, data: string, password: string): Promise<void> {
  console.log('[CRYPTO-DEBUG] writeEncryptedFile called');
  console.log('[CRYPTO-DEBUG] Data length:', data.length);
  
  // Ensure the directory exists
  const dir = path.dirname(filePath);
  console.log('[CRYPTO-DEBUG] Creating directory structure');
  
  try {
    await fs.mkdir(dir, { recursive: true });
    console.log('[CRYPTO-DEBUG] Directory created successfully');
  } catch (dirError: any) {
    console.error('[CRYPTO-DEBUG] Failed to create directory:', dirError);
    throw new Error(`Failed to create directory ${dir}: ${dirError.message}`);
  }
  
  console.log('[CRYPTO-DEBUG] Encrypting data...');
  const encryptedData = await encryptData(data, password);
  console.log('[CRYPTO-DEBUG] Data encrypted successfully');
  
  // Write to a temporary file first to ensure atomicity
  const tempPath = filePath + '.tmp';
  const fileContent = JSON.stringify(encryptedData, null, 2);
  console.log('[CRYPTO-DEBUG] Writing to temporary file');
  console.log('[CRYPTO-DEBUG] File content length:', fileContent.length);
  
  try {
    // Write to temp file
    await fs.writeFile(tempPath, fileContent, { encoding: 'utf8' });
    console.log('[CRYPTO-DEBUG] Temp file written successfully');
    
    // Force sync to disk (important on Windows/WSL)
    const fileHandle = await fs.open(tempPath, 'r+');
    await fileHandle.sync();
    await fileHandle.close();
    console.log('[CRYPTO-DEBUG] Temp file synced to disk');
    
    // Atomically rename temp file to final path
    await fs.rename(tempPath, filePath);
    console.log('[CRYPTO-DEBUG] File renamed to final path successfully');
    
    // Verify final file exists
    try {
      await fs.access(filePath);
      console.log('[CRYPTO-DEBUG] Final file verified to exist');
    } catch (verifyError) {
      console.error('[CRYPTO-DEBUG] Final file verification failed:', verifyError);
      throw new Error('File was not created successfully');
    }
    
  } catch (error: any) {
    console.error('[CRYPTO-DEBUG] Error during file write:', error);
    // Clean up temp file on error
    await fs.unlink(tempPath).catch(() => {});
    throw new Error(`Failed to write encrypted file: ${error.message}`);
  }
}

/**
 * Securely reads and decrypts data from a file
 */
export async function readEncryptedFile(filePath: string, password: string): Promise<string> {
  const fileContent = await fs.readFile(filePath, 'utf8');
  const encryptedData: EncryptedData = JSON.parse(fileContent);
  return await decryptData(encryptedData, password);
}

/**
 * Securely deletes a file by overwriting it before deletion
 */
export async function secureDeleteFile(filePath: string): Promise<void> {
  try {
    // Get file size
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    
    // Overwrite with random data multiple times
    for (let i = 0; i < 3; i++) {
      const randomData = crypto.randomBytes(fileSize);
      await fs.writeFile(filePath, randomData);
    }
    
    // Finally delete the file
    await fs.unlink(filePath);
  } catch (error) {
    // If file doesn't exist, that's fine
    if ((error as any).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Generates a cryptographically secure random string
 */
export function generateSecureRandom(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hashes data using SHA-256
 */
export function hashData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}