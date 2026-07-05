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
    setProfile: vi.fn(),
    lockDrive: vi.fn(),
    getUnlockedDriveIds: vi.fn(() => []),
    // PRIV-4
    setPersistence: vi.fn().mockResolvedValue(true),
    isPersisted: vi.fn(() => false),
    restorePersistedKeys: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('ardrive-core-js', () => ({
  arDriveFactory: vi.fn(() => ({})),
  readJWKFile: vi.fn(),
  ArweaveAddress: vi.fn((addr: string) => ({ address: addr })),
  EID: vi.fn((id: string) => ({ entityId: id })),
  DriveSignatureType: { v1: 1, v2: 2 },
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
  let mockGetDriveSignatureInfo: ReturnType<typeof vi.fn>;
  let recreateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    walletManager = new SecureWalletManager();

    mockGetPrivateDrive = vi.fn();
    // PRIV-SIG-1: unlock now detects the on-chain signature type first. Default
    // the mock to a v2 drive; individual tests override as needed.
    mockGetDriveSignatureInfo = vi.fn().mockResolvedValue({ driveSignatureType: 2 });
    (walletManager as any).arDrive = {
      getPrivateDrive: mockGetPrivateDrive,
      getDriveSignatureInfo: mockGetDriveSignatureInfo,
    };
    (walletManager as any).wallet = { fake: 'wallet' };
    (walletManager as any).walletJson = { kty: 'RSA', n: 'test' };
    // Owner address resolution is a local hash; stub it so no real arweave loads.
    vi.spyOn(walletManager as any, 'getAddressFromJWK').mockResolvedValue('owner-address');

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

  // PRIV-4: opt-in persistence plumbing through unlockPrivateDrive.
  it('persists the key when persistKey=true (opt-in)', async () => {
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });
    (walletManager as any).currentProfileId = 'profile-a';
    vi.spyOn(walletManager as any, 'getSessionPassword').mockResolvedValue('session-pw');

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password', true);

    expect(result.success).toBe(true);
    expect(driveKeyManager.setPersistence).toHaveBeenCalledWith(DRIVE_ID, true, 'session-pw');
  });

  it('does NOT persist the key when persistKey is omitted (opt-out is the default)', async () => {
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });
    (walletManager as any).currentProfileId = 'profile-a';

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    expect(driveKeyManager.setPersistence).not.toHaveBeenCalled();
  });

  it('unlock still succeeds even if persisting the key fails', async () => {
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });
    (walletManager as any).currentProfileId = 'profile-a';
    vi.spyOn(walletManager as any, 'getSessionPassword').mockResolvedValue('session-pw');
    vi.mocked(driveKeyManager.setPersistence).mockRejectedValueOnce(new Error('disk full'));

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password', true);

    expect(result.success).toBe(true);
    expect(driveKeyManager.cacheKey).toHaveBeenCalled();
  });

  // ===== PRIV-SIG-1: per-drive v1/v2 signature-type detection on unlock =====
  // The audited bug: derivation hardcoded v1, so v2 drives rejected the CORRECT
  // password. Unlock must detect the on-chain type and derive with it.

  it('detects a v1 drive and derives the key with the v1 signature type', async () => {
    mockGetDriveSignatureInfo.mockResolvedValue({ driveSignatureType: 1 });
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    expect(mockGetDriveSignatureInfo).toHaveBeenCalledWith(
      expect.objectContaining({ driveId: { entityId: DRIVE_ID } })
    );
    // Derived with the DETECTED v1 type — not a hardcoded default.
    expect(driveKeyManager.deriveKey).toHaveBeenCalledWith(DRIVE_ID, 'correct-password', 1, undefined);
  });

  it('detects a v2 drive and derives the key with the v2 signature type (the lockout fix)', async () => {
    mockGetDriveSignatureInfo.mockResolvedValue({ driveSignatureType: 2 });
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    expect(driveKeyManager.deriveKey).toHaveBeenCalledWith(DRIVE_ID, 'correct-password', 2, undefined);
    expect(driveKeyManager.cacheKey).toHaveBeenCalledWith(DRIVE_ID, mockDriveKey);
  });

  it("threads a v1 drive's encryptedSignatureData into derivation", async () => {
    const encryptedSignatureData = { cipherIV: 'iv', encryptedData: Buffer.from('sig') };
    mockGetDriveSignatureInfo.mockResolvedValue({ driveSignatureType: 1, encryptedSignatureData });
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    expect(driveKeyManager.deriveKey).toHaveBeenCalledWith(
      DRIVE_ID,
      'correct-password',
      1,
      encryptedSignatureData
    );
  });

  it('retries a transient 404 from getDriveSignatureInfo (SYNC-20) then unlocks', async () => {
    mockGetDriveSignatureInfo
      .mockRejectedValueOnce(new Error('Request to gateway has failed: (Status: 404) Not Found'))
      .mockResolvedValueOnce({ driveSignatureType: 2 });
    mockGetPrivateDrive.mockResolvedValue({ name: 'Secret Drive' });

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(true);
    expect(mockGetDriveSignatureInfo).toHaveBeenCalledTimes(2);
    expect(driveKeyManager.deriveKey).toHaveBeenCalledWith(DRIVE_ID, 'correct-password', 2, undefined);
  }, 15000);

  it('reports a persistent signature-detection failure as an honest, distinct error — never wrong-password, never a cached key', async () => {
    // A non-transient gateway failure (e.g. the drive txs aren't retrievable):
    // must NOT masquerade as "Invalid password", and must NOT derive/cache a
    // guessed-type key (data-safety: no wrong key ever reaches the cache/disk).
    mockGetDriveSignatureInfo.mockRejectedValue(new Error('Drive is public'));

    const result = await walletManager.unlockPrivateDrive(DRIVE_ID, 'correct-password');

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/Invalid password/);
    expect(result.error).toMatch(/Could not verify the drive type/);
    expect(driveKeyManager.deriveKey).not.toHaveBeenCalled();
    expect(driveKeyManager.cacheKey).not.toHaveBeenCalled();
  });
});
