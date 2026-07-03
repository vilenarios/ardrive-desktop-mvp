// @vitest-environment node
//
// PRIV-2: key derivation is pure HKDF and succeeds for any password, so the
// manager now separates deriveKey (no caching) from cacheKey (verified keys
// only). unlockDriveUnverified exists solely for just-created drives.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DriveKeyManager } from '../../../src/main/drive-key-manager';
import { deriveDriveKey } from 'ardrive-core-js';

const { mockDriveKey } = vi.hoisted(() => ({
  mockDriveKey: { keyData: Buffer.from('mock-key-material'), toString: () => 'mock-key' },
}));

vi.mock('ardrive-core-js', () => ({
  deriveDriveKey: vi.fn(async () => mockDriveKey),
  PrivateKeyData: vi.fn(function (this: any, args: any) {
    this.driveKeys = args?.driveKeys ?? [];
  }),
}));

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';

describe('DriveKeyManager (PRIV-2 derive/cache split)', () => {
  let manager: DriveKeyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deriveDriveKey).mockResolvedValue(mockDriveKey as any);
    manager = new DriveKeyManager();
    manager.setWallet({ kty: 'RSA', n: 'test' });
  });

  it('deriveKey returns a key but caches nothing', async () => {
    const key = await manager.deriveKey(DRIVE_ID, 'any-password');

    expect(key).toBe(mockDriveKey);
    // Derivation alone must NOT unlock the drive
    expect(manager.isUnlocked(DRIVE_ID)).toBe(false);
    expect(manager.getDriveKey(DRIVE_ID)).toBeUndefined();
  });

  it('deriveKey fails when no wallet is loaded', async () => {
    const fresh = new DriveKeyManager();

    await expect(fresh.deriveKey(DRIVE_ID, 'pw')).rejects.toThrow('Wallet not loaded');
  });

  it('cacheKey unlocks the drive for the session', () => {
    manager.cacheKey(DRIVE_ID, mockDriveKey as any);

    expect(manager.isUnlocked(DRIVE_ID)).toBe(true);
    expect(manager.getDriveKey(DRIVE_ID)).toBe(mockDriveKey);
    expect(manager.getUnlockedDriveIds()).toEqual([DRIVE_ID]);
  });

  it('unlockDriveUnverified derives and caches (for just-created drives only)', async () => {
    const ok = await manager.unlockDriveUnverified(DRIVE_ID, 'creation-password');

    expect(ok).toBe(true);
    expect(manager.isUnlocked(DRIVE_ID)).toBe(true);
  });

  it('unlockDriveUnverified reports failure without caching when derivation throws', async () => {
    vi.mocked(deriveDriveKey).mockRejectedValue(new Error('derivation blew up'));

    const ok = await manager.unlockDriveUnverified(DRIVE_ID, 'pw');

    expect(ok).toBe(false);
    expect(manager.isUnlocked(DRIVE_ID)).toBe(false);
  });

  it('clearAllKeys locks everything', async () => {
    manager.cacheKey(DRIVE_ID, mockDriveKey as any);
    manager.clearAllKeys();

    expect(manager.isUnlocked(DRIVE_ID)).toBe(false);
    expect(manager.getUnlockedDriveIds()).toEqual([]);
  });
});
