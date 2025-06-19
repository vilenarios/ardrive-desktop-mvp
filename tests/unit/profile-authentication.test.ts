import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { SecureWalletManager } from '../../src/main/wallet-manager-secure';
import { profileManager } from '../../src/main/profile-manager';
import { configManager } from '../../src/main/config-manager';
import { databaseManager } from '../../src/main/database-manager';
import { writeEncryptedFile, readEncryptedFile } from '../../src/main/crypto-utils';

// Mock dependencies
vi.mock('../../src/main/profile-manager');
vi.mock('../../src/main/config-manager');
vi.mock('../../src/main/database-manager');
vi.mock('../../src/main/crypto-utils');
vi.mock('../../src/main/turbo-manager');

describe('Profile Authentication Flow', () => {
  let walletManager: SecureWalletManager;
  let mockProfileManager: any;
  let mockConfigManager: any;
  let mockDatabaseManager: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Create fresh wallet manager instance
    walletManager = new SecureWalletManager();
    
    // Setup mock managers
    mockProfileManager = vi.mocked(profileManager);
    mockConfigManager = vi.mocked(configManager);
    mockDatabaseManager = vi.mocked(databaseManager);
    
    // Setup default mock behaviors
    mockProfileManager.setActiveProfile = vi.fn().mockResolvedValue(undefined);
    mockConfigManager.setActiveProfile = vi.fn().mockResolvedValue(undefined);
    mockDatabaseManager.setActiveProfile = vi.fn().mockResolvedValue(undefined);
    
    // Mock crypto functions
    (writeEncryptedFile as MockedFunction<any>).mockResolvedValue(undefined);
    (readEncryptedFile as MockedFunction<any>).mockResolvedValue('{"test": "wallet"}');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('switchProfile', () => {
    it('should successfully switch profile with valid password', async () => {
      // Arrange
      const profileId = 'test-profile-id';
      const password = 'test-password';
      
      // Setup wallet manager with existing profile
      (walletManager as any).currentProfileId = 'old-profile';
      
      // Mock successful wallet loading
      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(true);

      // Act
      const result = await walletManager.switchProfile(profileId, password);

      // Assert
      expect(result).toBe(true);
      expect(mockProfileManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(mockConfigManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(mockDatabaseManager.setActiveProfile).toHaveBeenCalledWith(profileId);
    });

    it('should restore previous state on wallet loading failure', async () => {
      // Arrange
      const profileId = 'test-profile-id';
      const password = 'wrong-password';
      const originalProfileId = 'original-profile';
      
      // Setup wallet manager with existing state
      (walletManager as any).currentProfileId = originalProfileId;
      (walletManager as any).arDrive = { original: 'arDrive' };
      (walletManager as any).wallet = { original: 'wallet' };
      (walletManager as any).sessionPassword = 'original-password';
      
      // Mock failed wallet loading
      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(false);

      // Act
      const result = await walletManager.switchProfile(profileId, password);

      // Assert
      expect(result).toBe(false);
      expect((walletManager as any).currentProfileId).toBe(originalProfileId);
      expect((walletManager as any).arDrive).toEqual({ original: 'arDrive' });
      expect((walletManager as any).wallet).toEqual({ original: 'wallet' });
      expect((walletManager as any).sessionPassword).toBe('original-password');
    });

    it('should handle profile switch without password', async () => {
      // Arrange
      const profileId = 'test-profile-id';

      // Act
      const result = await walletManager.switchProfile(profileId);

      // Assert
      expect(result).toBe(false);
      expect(mockProfileManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(mockConfigManager.setActiveProfile).toHaveBeenCalledWith(profileId);
      expect(mockDatabaseManager.setActiveProfile).toHaveBeenCalledWith(profileId);
    });

    it('should handle manager update failures gracefully', async () => {
      // Arrange
      const profileId = 'test-profile-id';
      const password = 'test-password';
      
      // Mock successful wallet loading but failed manager update
      vi.spyOn(walletManager, 'loadWallet').mockResolvedValue(true);
      mockProfileManager.setActiveProfile.mockRejectedValue(new Error('Manager update failed'));

      // Act
      const result = await walletManager.switchProfile(profileId, password);

      // Assert
      expect(result).toBe(false);
    });

    it('should restore state on any inner exception', async () => {
      // Arrange
      const profileId = 'test-profile-id';
      const password = 'test-password';
      const originalProfileId = 'original-profile';
      
      // Setup original state
      (walletManager as any).currentProfileId = originalProfileId;
      (walletManager as any).arDrive = { original: 'arDrive' };
      
      // Mock exception during profile switch
      vi.spyOn(walletManager, 'loadWallet').mockRejectedValue(new Error('Unexpected error'));

      // Act
      const result = await walletManager.switchProfile(profileId, password);

      // Assert
      expect(result).toBe(false);
      expect((walletManager as any).currentProfileId).toBe(originalProfileId);
      expect((walletManager as any).arDrive).toEqual({ original: 'arDrive' });
    });
  });

  describe('Memory Security', () => {
    it('should securely clear password from memory', () => {
      // Arrange
      (walletManager as any).sessionPassword = 'sensitive-password';
      
      // Act
      (walletManager as any).clearInMemoryWallet();
      
      // Assert
      expect((walletManager as any).sessionPassword).toBeNull();
    });

    it('should clear all wallet data from memory', () => {
      // Arrange
      (walletManager as any).arDrive = { test: 'arDrive' };
      (walletManager as any).wallet = { test: 'wallet' };
      (walletManager as any).walletJson = { test: 'walletJson' };
      (walletManager as any).sessionPassword = 'test-password';
      
      // Act
      (walletManager as any).clearInMemoryWallet();
      
      // Assert
      expect((walletManager as any).arDrive).toBeNull();
      expect((walletManager as any).wallet).toBeNull();
      expect((walletManager as any).walletJson).toBeNull();
      expect((walletManager as any).sessionPassword).toBeNull();
    });
  });

  describe('Wallet Loading', () => {
    it('should successfully load wallet with correct password', async () => {
      // Arrange
      const password = 'correct-password';
      const profileId = 'test-profile';
      (walletManager as any).currentProfileId = profileId;
      
      // Mock file system operations
      const fs = await import('fs/promises');
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      
      // Mock wallet data
      const walletData = '{"kty":"RSA","n":"test"}';
      (readEncryptedFile as MockedFunction<any>).mockResolvedValue(walletData);
      
      // Mock temp file operations
      vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
      
      // Mock ArDrive Core
      const mockReadJWKFile = vi.fn().mockReturnValue({ test: 'wallet' });
      vi.doMock('ardrive-core-js', () => ({
        readJWKFile: mockReadJWKFile,
        arDriveFactory: vi.fn().mockReturnValue({ test: 'arDrive' })
      }));

      // Act
      const result = await walletManager.loadWallet(password);

      // Assert
      expect(result).toBe(true);
      expect(readEncryptedFile).toHaveBeenCalledWith(
        expect.stringContaining('wallet.enc'),
        password
      );
    });

    it('should fail to load wallet with incorrect password', async () => {
      // Arrange
      const password = 'wrong-password';
      const profileId = 'test-profile';
      (walletManager as any).currentProfileId = profileId;
      
      // Mock file system operations
      const fs = await import('fs/promises');
      vi.spyOn(fs, 'access').mockResolvedValue(undefined);
      
      // Mock decryption failure
      (readEncryptedFile as MockedFunction<any>).mockRejectedValue(
        new Error('invalid password')
      );

      // Act & Assert
      await expect(walletManager.loadWallet(password)).rejects.toThrow('Invalid password');
    });

    it('should return false when wallet file does not exist', async () => {
      // Arrange
      const password = 'test-password';
      const profileId = 'test-profile';
      (walletManager as any).currentProfileId = profileId;
      
      // Mock file system operations
      const fs = await import('fs/promises');
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('File not found'));

      // Act
      const result = await walletManager.loadWallet(password);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Logout Security', () => {
    it('should preserve wallet file during logout', async () => {
      // Arrange
      (walletManager as any).currentProfileId = 'test-profile';
      (walletManager as any).sessionPassword = 'test-password';
      
      // Act
      await walletManager.logout();
      
      // Assert
      expect((walletManager as any).sessionPassword).toBeNull();
      // Verify no file deletion operations were called
      expect(vi.mocked(require('../../src/main/crypto-utils').secureDeleteFile)).not.toHaveBeenCalled();
    });

    it('should completely remove wallet file during clearStoredWallet', async () => {
      // Arrange
      const profileId = 'test-profile';
      (walletManager as any).currentProfileId = profileId;
      
      // Mock secure delete
      const { secureDeleteFile } = await import('../../src/main/crypto-utils');
      vi.mocked(secureDeleteFile).mockResolvedValue(undefined);
      
      // Act
      await walletManager.clearStoredWallet();
      
      // Assert
      expect(secureDeleteFile).toHaveBeenCalledWith(
        expect.stringContaining('wallet.enc')
      );
    });
  });
});