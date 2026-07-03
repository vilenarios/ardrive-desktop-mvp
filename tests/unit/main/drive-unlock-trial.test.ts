// @vitest-environment node
//
// PRIV-2: SecureWalletManager.unlockPrivateDrive must verify the password by
// trial-decrypting the drive entity before caching the derived key. The
// audited bug: HKDF succeeds for any password, so wrong passwords "unlocked"
// drives and cached garbage keys.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { driveKeyManager } from '../../../src/main/drive-key-manager';

// Factory mocks so no native module (sqlite3/keytar) ever loads — same
// pattern as profile-authentication.test.ts.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data'), isPackaged: false },
}));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getActiveProfile: vi.fn().mockResolvedValue(null),
    getActiveProfileId: vi.fn().mockResolvedValue(null),
    setActiveProfile: vi.fn(),
    getProfileStoragePath: vi.fn(() => '/mock/wallet.enc'),
  },
}));
vi.mock('../../../src/main/config-manager', () => ({
  configManager: { setActiveProfile: vi.fn() },
}));
vi.mock('../../../src/main/database-manager', () => ({
  databaseManager: { setActiveProfile: vi.fn(), close: vi.fn() },
}));
vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { initialize: vi.fn(), reset: vi.fn() },
}));
vi.mock('../../../src/main/keychain-service', () => ({
  keychainService: {
    isKeychainAvailable: vi.fn(() => false),
    setPassword: vi.fn(),
    getPassword: vi.fn().mockResolvedValue(null),
    deletePassword: vi.fn(),
  },
}));
vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(),
  readEncryptedFile: vi.fn(),
  secureDeleteFile: vi.fn(),
  encryptData: vi.fn().mockResolvedValue({ iv: 'iv', data: 'cipher' }),
  decryptData: vi.fn().mockResolvedValue('pw'),
}));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: {
    deriveKey: vi.fn(),
    cacheKey: vi.fn(),
    unlockDriveUnverified: vi.fn(),
    isUnlocked: vi.fn(() => false),
    getDriveKey: vi.fn(),
    getPrivateKeyData: vi.fn(),
    clearAllKeys: vi.fn(),
    setWallet: vi.fn(),
    lockDrive: vi.fn(),
    getUnlockedDriveIds: vi.fn(() => []),
  },
}));
vi.mock('ardrive-core-js', () => ({
  arDriveFactory: vi.fn(() => ({})),
  readJWKFile: vi.fn(),
  ArweaveAddress: vi.fn(),
  EID: vi.fn((id: string) => ({ entityId: id })),
}));
vi.mock('fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
}));

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const mockDriveKey = { keyData: Buffer.from('derived') };

describe('unlockPrivateDrive trial decryption (PRIV-2)', () => {
  let walletManager: SecureWalletManager;
  let mockGetPrivateDrive: ReturnType<typeof vi.fn>;
  let recreateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    walletManager = new SecureWalletManager();

    mockGetPrivateDrive = vi.fn();
    (walletManager as any).arDrive = { getPrivateDrive: mockGetPrivateDrive };
    (walletManager as any).wallet = { fake: 'wallet' };
    (walletManager as any).walletJson = { kty: 'RSA', n: 'test' };

    vi.mocked(driveKeyManager.deriveKey).mockResolvedValue(mockDriveKey as any);
    recreateSpy = vi
      .spyOn(walletManager as any, 'recreateArDriveWithPrivateKeys')
      .mockResolvedValue(undefined);
  });

  it('rejects a wrong password and caches nothing', async () => {
    // The REAL error Node's GCM throws on a wrong key, propagated raw by
    // ardrive-core-js (qa-gate captured it empirically)
    mockGetPrivateDrive.mockRejectedValue(
      new Error('Unsupported state or unable to authenticate data')
    );

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'wrong-password');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid password/);
    expect(driveKeyManager.cacheKey).not.toHaveBeenCalled();
    expect(recreateSpy).not.toHaveBeenCalled();
  });

  it('unlocks with the correct password and caches the verified key', async () => {
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    // The trial decrypted the actual drive entity with the derived key
    expect(mockGetPrivateDrive).toHaveBeenCalledWith(
      expect.objectContaining({ driveKey: mockDriveKey })
    );
    expect(driveKeyManager.cacheKey).toHaveBeenCalledWith(DRIVE_ID, mockDriveKey);
    expect(recreateSpy).toHaveBeenCalled();
  });

  it('does not report a network failure as an invalid password', async () => {
    mockGetPrivateDrive.mockRejectedValue(new Error('connect ETIMEDOUT 1.2.3.4:443'));

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/Invalid password/);
    expect(result.error).toMatch(/Could not verify/);
    expect(driveKeyManager.cacheKey).not.toHaveBeenCalled();
  });

  it('does not report a gateway 502 as an invalid password', async () => {
    // Real gateway error string (contains "Bad Gateway", which the first
    // keyword-based classifier wrongly matched as a password failure)
    mockGetPrivateDrive.mockRejectedValue(
      new Error('Request to gateway has failed: (Status: 502) Bad Gateway')
    );

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/Invalid password/);
    expect(result.error).toMatch(/Could not verify/);
    expect(driveKeyManager.cacheKey).not.toHaveBeenCalled();
  });

  it('fails closed when the wallet is not loaded', async () => {
    (walletManager as any).arDrive = null;

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'any');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Wallet not loaded/);
    expect(driveKeyManager.deriveKey).not.toHaveBeenCalled();
    expect(driveKeyManager.cacheKey).not.toHaveBeenCalled();
  });
});
