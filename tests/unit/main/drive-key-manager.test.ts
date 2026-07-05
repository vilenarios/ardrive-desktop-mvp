// @vitest-environment node
//
// PRIV-2: key derivation is pure HKDF and succeeds for any password, so the
// manager now separates deriveKey (no caching) from cacheKey (verified keys
// only). unlockDriveUnverified exists solely for just-created drives.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DriveKeyManager } from '../../../src/main/drive-key-manager';
import { deriveDriveKey, DriveSignatureType } from 'ardrive-core-js';

const { mockDriveKey } = vi.hoisted(() => ({
  mockDriveKey: { keyData: Buffer.from('mock-key-material'), toString: () => 'mock-key' },
}));

vi.mock('ardrive-core-js', () => ({
  deriveDriveKey: vi.fn(async () => mockDriveKey),
  DriveSignatureType: { v1: 1, v2: 2 },
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
    const key = await manager.deriveKey(DRIVE_ID, 'any-password', DriveSignatureType.v2);

    expect(key).toBe(mockDriveKey);
    // Derivation alone must NOT unlock the drive
    expect(manager.isUnlocked(DRIVE_ID)).toBe(false);
    expect(manager.getDriveKey(DRIVE_ID)).toBeUndefined();
  });

  // PRIV-SIG-1: deriveKey must forward the caller-detected signature type to
  // core-js using the OBJECT/params overload (never the legacy 3-arg form that
  // silently defaults to v1). This is the crux of the v2-drive lockout fix.
  it('deriveKey forwards the detected signature type via the params overload', async () => {
    await manager.deriveKey(DRIVE_ID, 'pw', DriveSignatureType.v1);
    expect(deriveDriveKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ driveId: DRIVE_ID, driveSignatureType: DriveSignatureType.v1 })
    );

    await manager.deriveKey(DRIVE_ID, 'pw', DriveSignatureType.v2);
    expect(deriveDriveKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ driveId: DRIVE_ID, driveSignatureType: DriveSignatureType.v2 })
    );

    // Never the legacy positional (v1-hardcoding) overload.
    for (const call of vi.mocked(deriveDriveKey).mock.calls) {
      expect(typeof call[0]).toBe('object');
    }
  });

  it('deriveKey threads v1 encryptedSignatureData through to core-js', async () => {
    const encryptedSignatureData = { cipherIV: 'iv', encryptedData: Buffer.from('sig') };
    await manager.deriveKey(DRIVE_ID, 'pw', DriveSignatureType.v1, encryptedSignatureData);
    expect(deriveDriveKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ driveSignatureType: DriveSignatureType.v1, encryptedSignatureData })
    );
  });

  it('deriveKey fails when no wallet is loaded', async () => {
    const fresh = new DriveKeyManager();

    await expect(fresh.deriveKey(DRIVE_ID, 'pw', DriveSignatureType.v2)).rejects.toThrow(
      'Wallet not loaded'
    );
  });

  it('cacheKey unlocks the drive for the session', () => {
    manager.cacheKey(DRIVE_ID, mockDriveKey as any);

    expect(manager.isUnlocked(DRIVE_ID)).toBe(true);
    expect(manager.getDriveKey(DRIVE_ID)).toBe(mockDriveKey);
    expect(manager.getUnlockedDriveIds()).toEqual([DRIVE_ID]);
  });

  it('unlockDriveUnverified derives with the given type and caches (just-created drives)', async () => {
    const ok = await manager.unlockDriveUnverified(DRIVE_ID, 'creation-password', DriveSignatureType.v2);

    expect(ok).toBe(true);
    expect(manager.isUnlocked(DRIVE_ID)).toBe(true);
    expect(deriveDriveKey).toHaveBeenLastCalledWith(
      expect.objectContaining({ driveSignatureType: DriveSignatureType.v2 })
    );
  });

  it('unlockDriveUnverified reports failure without caching when derivation throws', async () => {
    vi.mocked(deriveDriveKey).mockRejectedValue(new Error('derivation blew up'));

    const ok = await manager.unlockDriveUnverified(DRIVE_ID, 'pw', DriveSignatureType.v2);

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
