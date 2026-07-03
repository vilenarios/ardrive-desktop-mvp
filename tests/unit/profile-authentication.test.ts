// @vitest-environment node
//
// Main-process suite: runs under node (not jsdom). Under jsdom the transitive
// ardrive-core-js / @ardrive/turbo-sdk -> @keplr-wallet/crypto -> bitcoinjs-lib
// import chain fails its ecc self-check at collection time ("ecc library invalid").
import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { SecureWalletManager } from '../../src/main/wallet-manager-secure';
import { profileManager } from '../../src/main/profile-manager';
import { configManager } from '../../src/main/config-manager';
import { databaseManager } from '../../src/main/database-manager';
import { turboManager } from '../../src/main/turbo-manager';
import * as fs from 'fs/promises';
import { keychainService } from '../../src/main/keychain-service';
import { readJWKFile, arDriveFactory } from 'ardrive-core-js';
import {
  writeEncryptedFile,
  readEncryptedFile,
  secureDeleteFile,
  encryptData,
  decryptData,
} from '../../src/main/crypto-utils';

// All collaborators are mocked with factories (never automocked) so that heavy
// native modules (sqlite3 via database-manager, keytar via keychain-service)
// are never loaded in the test process.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    getName: vi.fn(() => 'ardrive-desktop-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    isPackaged: false,
  },
}));

vi.mock('../../src/main/profile-manager', () => ({
  profileManager: {
    getActiveProfile: vi.fn().mockResolvedValue(null),
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
    getProfileStoragePath: vi.fn(
      (profileId: string, fileName: string) => `/mock/user-data/${profileId}/${fileName}`
    ),
  },
}));

vi.mock('../../src/main/config-manager', () => ({
  configManager: {
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/main/database-manager', () => ({
  databaseManager: {
    setActiveProfile: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/main/turbo-manager', () => ({
  turboManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  },
}));

vi.mock('../../src/main/keychain-service', () => ({
  keychainService: {
    // Force the encrypted-in-memory fallback path so tests never touch a real
    // OS keychain.
    isKeychainAvailable: vi.fn(() => false),
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue(null),
    deletePassword: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn().mockResolvedValue(undefined),
  readEncryptedFile: vi.fn().mockResolvedValue('{"test": "wallet"}'),
  secureDeleteFile: vi.fn().mockResolvedValue(undefined),
  encryptData: vi.fn().mockResolvedValue({ iv: 'mock-iv', data: 'mock-cipher' }),
  decryptData: vi.fn().mockResolvedValue('decrypted-password'),
}));

vi.mock('ardrive-core-js', () => ({
  arDriveFactory: vi.fn(() => ({ mocked: 'arDrive' })),
  readJWKFile: vi.fn(() => ({ kty: 'RSA', n: 'test' })),
  ArweaveAddress: vi.fn((addr: string) => ({ address: addr })),
  deriveDriveKey: vi.fn(),
  EID: vi.fn((id: string) => ({ entityId: id })),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('Profile Authentication Flow', () => {
  let walletManager: SecureWalletManager;

  beforeEach(() => {
    vi.clearAllMocks();
    walletManager = new SecureWalletManager();

    // afterEach uses vi.restoreAllMocks(), which resets the factory-provided
    // implementations too, so re-establish the default behaviors here.
    vi.mocked(profileManager.getActiveProfile).mockResolvedValue(null as any);
    vi.mocked(profileManager.setActiveProfile).mockResolvedValue(undefined);
    vi.mocked(profileManager.getProfileStoragePath).mockImplementation(
      (profileId: string, fileName: string) => `/mock/user-data/${profileId}/${fileName}`
    );
    vi.mocked(configManager.setActiveProfile).mockResolvedValue(undefined);
    vi.mocked(databaseManager.setActiveProfile).mockResolvedValue(undefined);
    vi.mocked(databaseManager.close).mockResolvedValue(undefined);
    vi.mocked(turboManager.initialize).mockResolvedValue(undefined);

    (writeEncryptedFile as MockedFunction<any>).mockResolvedValue(undefined);
    (readEncryptedFile as MockedFunction<any>).mockResolvedValue('{"test": "wallet"}');
    (secureDeleteFile as MockedFunction<any>).mockResolvedValue(undefined);
    (encryptData as MockedFunction<any>).mockResolvedValue({ iv: 'mock-iv', data: 'mock-cipher' });
    (decryptData as MockedFunction<any>).mockResolvedValue('decrypted-password');

    vi.mocked(keychainService.isKeychainAvailable).mockReturnValue(false);
    vi.mocked(keychainService.getPassword).mockResolvedValue(null);
    vi.mocked(keychainService.setPassword).mockResolvedValue(undefined);
    vi.mocked(keychainService.deletePassword).mockResolvedValue(undefined as any);

    vi.mocked(readJWKFile).mockReturnValue({ kty: 'RSA', n: 'test' } as any);
    vi.mocked(arDriveFactory).mockReturnValue({ mocked: 'arDrive' } as any);

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('switchProfile', () => {
    it('should successfully switch profile with valid password', async () => {
      const profileId = 'test-profile-id';
      const password = 'test-password';

      (walletManager as any).currentProfileId = 'old-profile';
      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(true);

      const result = await walletManager.switchProfile(profileId, password);

      expect(result).toBe(true);
      expect(profileManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(configManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(databaseManager.setActiveProfile).toHaveBeenCalledWith(profileId);
    });

    it('should not switch the active profile when the password is wrong', async () => {
      const profileId = 'test-profile-id';
      const originalProfileId = 'original-profile';

      (walletManager as any).currentProfileId = originalProfileId;

      // Wrong password -> loadWallet reports failure
      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(false);

      const result = await walletManager.switchProfile(profileId, 'wrong-password');

      expect(result).toBe(false);
      // The previous profile stays active...
      expect((walletManager as any).currentProfileId).toBe(originalProfileId);
      // ...and none of the managers were re-pointed at the new profile.
      expect(profileManager.setActiveProfile).not.toHaveBeenCalled();
      expect(configManager.setActiveProfile).not.toHaveBeenCalled();
      expect(databaseManager.setActiveProfile).not.toHaveBeenCalled();
    });

    it('should switch profile context without password but report password required', async () => {
      const profileId = 'test-profile-id';

      const result = await walletManager.switchProfile(profileId);

      // false = switched context, but a password is still needed to unlock
      expect(result).toBe(false);
      expect(profileManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(configManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(databaseManager.setActiveProfile).toHaveBeenCalledWith(profileId);
    });

    it('should handle manager update failures gracefully', async () => {
      const profileId = 'test-profile-id';
      const password = 'test-password';

      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(true);
      vi.mocked(profileManager.setActiveProfile).mockRejectedValue(
        new Error('Manager update failed')
      );

      const result = await walletManager.switchProfile(profileId, password);

      expect(result).toBe(false);
    });

    it('should restore previous state when wallet loading throws', async () => {
      const profileId = 'test-profile-id';
      const password = 'test-password';
      const originalProfileId = 'original-profile';

      (walletManager as any).currentProfileId = originalProfileId;
      (walletManager as any).arDrive = { original: 'arDrive' };
      (walletManager as any).wallet = { original: 'wallet' };
      (walletManager as any).walletJson = { original: 'walletJson' };

      vi.spyOn(walletManager, 'loadWallet').mockRejectedValue(new Error('Unexpected error'));

      const result = await walletManager.switchProfile(profileId, password);

      expect(result).toBe(false);
      expect((walletManager as any).currentProfileId).toBe(originalProfileId);
      expect((walletManager as any).arDrive).toEqual({ original: 'arDrive' });
      expect((walletManager as any).wallet).toEqual({ original: 'wallet' });
      expect((walletManager as any).walletJson).toEqual({ original: 'walletJson' });
    });
  });

  describe('Memory Security', () => {
    it('should clear the encrypted session password from memory', () => {
      (walletManager as any).encryptedSessionPassword = Buffer.from('encrypted-password');
      (walletManager as any).sessionPasswordKey = Buffer.from('session-key-material');

      (walletManager as any).clearInMemoryWallet();

      expect((walletManager as any).encryptedSessionPassword).toBeNull();
      expect((walletManager as any).sessionPasswordKey).toBeNull();
    });

    it('should clear all wallet data from memory and reset Turbo', () => {
      (walletManager as any).arDrive = { test: 'arDrive' };
      (walletManager as any).wallet = { test: 'wallet' };
      (walletManager as any).walletJson = { test: 'walletJson' };

      (walletManager as any).clearInMemoryWallet();

      expect((walletManager as any).arDrive).toBeNull();
      expect((walletManager as any).wallet).toBeNull();
      expect((walletManager as any).walletJson).toBeNull();
      expect(turboManager.reset).toHaveBeenCalled();
    });
  });

  describe('Wallet Loading', () => {
    it('should successfully load wallet with correct password', async () => {
      const password = 'correct-password';
      (walletManager as any).currentProfileId = 'test-profile';

      // Encrypted wallet file exists and decrypts to a JWK
      vi.mocked(fs.access).mockResolvedValue(undefined);
      (readEncryptedFile as MockedFunction<any>).mockResolvedValue('{"kty":"RSA","n":"test"}');

      const result = await walletManager.loadWallet(password);

      expect(result).toBe(true);
      expect(readEncryptedFile).toHaveBeenCalledWith(
        expect.stringContaining('wallet.enc'),
        password
      );
      expect(walletManager.isWalletLoaded()).toBe(true);
      // Turbo is initialized with the same wallet
      expect(turboManager.initialize).toHaveBeenCalledWith({ kty: 'RSA', n: 'test' });
    });

    it('should fail to load wallet with incorrect password', async () => {
      (walletManager as any).currentProfileId = 'test-profile';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      // Decryption failure due to wrong password
      (readEncryptedFile as MockedFunction<any>).mockRejectedValue(
        new Error('invalid password')
      );

      // loadWallet wraps every internal failure into a single user-facing error
      await expect(walletManager.loadWallet('wrong-password')).rejects.toThrow(
        'Failed to decrypt wallet'
      );
      expect(walletManager.isWalletLoaded()).toBe(false);
    });

    it('should return false when wallet file does not exist', async () => {
      (walletManager as any).currentProfileId = 'test-profile';

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));

      const result = await walletManager.loadWallet('test-password');

      expect(result).toBe(false);
      expect(readEncryptedFile).not.toHaveBeenCalled();
    });
  });

  describe('Logout Security', () => {
    it('should preserve the wallet file during logout', async () => {
      (walletManager as any).currentProfileId = 'test-profile';

      await walletManager.logout();

      // Logout clears memory + closes the DB, but never deletes wallet.enc
      expect(secureDeleteFile).not.toHaveBeenCalled();
      expect(databaseManager.close).toHaveBeenCalled();
      expect(walletManager.isWalletLoaded()).toBe(false);
    });

    it('should completely remove wallet file during clearStoredWallet', async () => {
      (walletManager as any).currentProfileId = 'test-profile';

      await walletManager.clearStoredWallet();

      expect(secureDeleteFile).toHaveBeenCalledWith(
        expect.stringContaining('wallet.enc')
      );
    });
  });
});
