// @vitest-environment node
//
// PRIV-SIG-1 — the crux, proven against the REAL ardrive-core-js crypto (no
// mocks): a private drive's HKDF drive key depends on its signature scheme, so
// v1 and v2 derive DIFFERENT keys from the SAME (password, driveId, wallet).
// The desktop app used to hardcode v1, so v2 drives (and every drive it
// created) rejected the correct password. These tests lock in that:
//   1. v1 vs v2 derivation of the same inputs yields different key bytes;
//   2. DriveKeyManager.deriveKey forwards the requested type faithfully (its
//      key matches core-js's own derivation for that type and tags itself with
//      that signature type).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import Arweave from 'arweave';
import {
  deriveDriveKey,
  getDriveSignatureType,
  DriveSignatureType
} from 'ardrive-core-js';
// JWKInterface is no longer re-exported by ardrive-core-js; it now sources the
// type from @dha-team/arbundles (the same package its crypto entry points use).
import type { JWKInterface } from '@dha-team/arbundles';

// DriveKeyManager pulls in electron's `app`; redirect it (unused here).
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/ignored-user-data') }
}));

import { DriveKeyManager } from '../../../src/main/drive-key-manager';

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'correct horse battery staple';

let wallet: JWKInterface;

beforeAll(async () => {
  const arweave = Arweave.init({ host: 'arweave.net', protocol: 'https', port: 443 });
  wallet = (await arweave.wallets.generate()) as unknown as JWKInterface;
}, 60000);

describe('PRIV-SIG-1 v1 vs v2 drive-key derivation (real crypto)', () => {
  it('v1 and v2 derive DIFFERENT keys from the same (password, driveId, wallet)', async () => {
    const v1Key = await deriveDriveKey({
      dataEncryptionKey: PASSWORD,
      driveId: DRIVE_ID,
      walletPrivateKey: JSON.stringify(wallet),
      driveSignatureType: DriveSignatureType.v1
    });
    const v2Key = await deriveDriveKey({
      dataEncryptionKey: PASSWORD,
      driveId: DRIVE_ID,
      walletPrivateKey: JSON.stringify(wallet),
      driveSignatureType: DriveSignatureType.v2
    });

    expect(getDriveSignatureType(v1Key)).toBe(DriveSignatureType.v1);
    expect(getDriveSignatureType(v2Key)).toBe(DriveSignatureType.v2);
    // The whole bug in one assertion: same inputs, different keys.
    expect(v1Key.keyData.equals(v2Key.keyData)).toBe(false);
  });

  it('DriveKeyManager.deriveKey forwards the requested type — v1 key matches core-js v1, and differs from its v2 key', async () => {
    const manager = new DriveKeyManager();
    manager.setWallet(wallet);

    const mgrV1 = await manager.deriveKey(DRIVE_ID, PASSWORD, DriveSignatureType.v1);
    const mgrV2 = await manager.deriveKey(DRIVE_ID, PASSWORD, DriveSignatureType.v2);

    const refV1 = await deriveDriveKey({
      dataEncryptionKey: PASSWORD,
      driveId: DRIVE_ID,
      walletPrivateKey: JSON.stringify(wallet),
      driveSignatureType: DriveSignatureType.v1
    });
    const refV2 = await deriveDriveKey({
      dataEncryptionKey: PASSWORD,
      driveId: DRIVE_ID,
      walletPrivateKey: JSON.stringify(wallet),
      driveSignatureType: DriveSignatureType.v2
    });

    // Manager's derivation exactly matches core-js for the requested type.
    expect(mgrV1.keyData.equals(refV1.keyData)).toBe(true);
    expect(mgrV2.keyData.equals(refV2.keyData)).toBe(true);
    // And carries the right signature tag + differs across types.
    expect(getDriveSignatureType(mgrV1)).toBe(DriveSignatureType.v1);
    expect(getDriveSignatureType(mgrV2)).toBe(DriveSignatureType.v2);
    expect(mgrV1.keyData.equals(mgrV2.keyData)).toBe(false);
  });
});
