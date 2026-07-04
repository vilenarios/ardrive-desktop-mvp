// @vitest-environment node
//
// PRIV-4 — opt-in, encrypted-at-rest private drive key persistence.
//
// These tests exercise the REAL ardrive-core-js key classes and the REAL
// crypto-utils AES-256-GCM/scrypt encryption (no mocks for either), so the
// serialization round-trip and the "no plaintext key on disk" guarantee are
// proven end-to-end. Only electron's `app` is mocked (to redirect userData to a
// throwaway temp dir).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  VersionedDriveKey,
  EntityKey,
  DriveSignatureType,
  getDriveSignatureType,
  isVersionedDriveKey,
  driveEncrypt,
  driveDecrypt
} from 'ardrive-core-js';
import * as crypto from 'crypto';

// Per-test temp userData dir; app.getPath('userData') resolves here.
let userDataDir: string;
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataDir)
  }
}));

// Import AFTER the mock is registered.
import { DriveKeyManager } from '../../../src/main/drive-key-manager';

const DRIVE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_DRIVE_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_A = 'profile-a';
const PROFILE_B = 'profile-b';
const SESSION_PW = 'correct horse battery staple';

function makeFixtureKey(sigType: DriveSignatureType = DriveSignatureType.v2): VersionedDriveKey {
  return new VersionedDriveKey(crypto.randomBytes(32), sigType);
}

function keysFilePath(profileId: string): string {
  return path.join(userDataDir, 'profiles', profileId, 'drive-keys.enc');
}

describe('DriveKeyManager persistence (PRIV-4)', () => {
  beforeEach(() => {
    userDataDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'priv4-'));
  });

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('(a) serialize -> deserialize round-trip yields a key that decrypts real ArFS ciphertext', async () => {
    const fixture = makeFixtureKey(DriveSignatureType.v2);
    // Encrypt a payload with the ORIGINAL key using ardrive-core's own routine.
    const plaintext = Buffer.from('private drive listing payload');
    const encrypted = await driveEncrypt(fixture, plaintext);

    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture);
    expect(await manager.setPersistence(DRIVE_ID, true, SESSION_PW)).toBe(true);

    // Simulate a full app restart: brand new manager, no in-memory keys.
    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    const restoredCount = await restarted.restorePersistedKeys(SESSION_PW);
    expect(restoredCount).toBe(1);

    const restored = restarted.getDriveKey(DRIVE_ID)!;
    expect(restored).toBeDefined();
    // Byte-identical key material.
    expect(restored.keyData.equals(fixture.keyData)).toBe(true);
    // VersionedDriveKey signature type preserved.
    expect(isVersionedDriveKey(restored)).toBe(true);
    expect(getDriveSignatureType(restored)).toBe(DriveSignatureType.v2);

    // The restored key actually decrypts what the original encrypted.
    const decrypted = await driveDecrypt(encrypted.cipherIV, restored, encrypted.data);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('(a2) round-trip preserves a v1 signature type', async () => {
    const fixture = makeFixtureKey(DriveSignatureType.v1);
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture);
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);

    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    await restarted.restorePersistedKeys(SESSION_PW);
    const restored = restarted.getDriveKey(DRIVE_ID)!;

    expect(restored.keyData.equals(fixture.keyData)).toBe(true);
    expect(getDriveSignatureType(restored)).toBe(DriveSignatureType.v1);
  });

  it('(b) with "remember": key is persisted (encrypted) and auto-unlocks after re-init', async () => {
    const fixture = makeFixtureKey();
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture);
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);

    // File exists on disk.
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(true);

    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    expect(restarted.isUnlocked(DRIVE_ID)).toBe(false); // fresh, nothing loaded yet
    await restarted.restorePersistedKeys(SESSION_PW);
    expect(restarted.isUnlocked(DRIVE_ID)).toBe(true);   // auto-unlocked
    expect(restarted.isPersisted(DRIVE_ID)).toBe(true);
  });

  it('(c) without "remember": nothing persisted, drive is locked after re-init', async () => {
    const fixture = makeFixtureKey();
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture); // unlocked for the session, but NOT remembered
    expect(manager.isPersisted(DRIVE_ID)).toBe(false);

    // No keys file was written.
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(false);

    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    const restored = await restarted.restorePersistedKeys(SESSION_PW);
    expect(restored).toBe(0);
    expect(restarted.isUnlocked(DRIVE_ID)).toBe(false);  // locked -> password required
  });

  it('(d1) logout/switch clears in-memory keys but the persisted file survives (same profile re-unlocks)', async () => {
    const fixture = makeFixtureKey();
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture);
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);

    // Simulate logout/profile-switch.
    manager.clearAllKeys();
    expect(manager.isUnlocked(DRIVE_ID)).toBe(false);       // in-memory gone
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(true); // file survives

    // Same profile logs back in.
    const relogin = new DriveKeyManager();
    relogin.setProfile(PROFILE_A);
    expect(await relogin.restorePersistedKeys(SESSION_PW)).toBe(1);
    expect(relogin.isUnlocked(DRIVE_ID)).toBe(true);
  });

  it('(d2) "forget" removes a single drive key from persistence', async () => {
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, makeFixtureKey());
    manager.cacheKey(OTHER_DRIVE_ID, makeFixtureKey());
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);
    await manager.setPersistence(OTHER_DRIVE_ID, true, SESSION_PW);

    // Forget just one.
    expect(await manager.setPersistence(DRIVE_ID, false, SESSION_PW)).toBe(true);
    expect(manager.isPersisted(DRIVE_ID)).toBe(false);
    expect(manager.isPersisted(OTHER_DRIVE_ID)).toBe(true);

    // After re-init only the still-remembered drive restores.
    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    expect(await restarted.restorePersistedKeys(SESSION_PW)).toBe(1);
    expect(restarted.isUnlocked(DRIVE_ID)).toBe(false);
    expect(restarted.isUnlocked(OTHER_DRIVE_ID)).toBe(true);
  });

  it('(d3) forgetting the last remembered drive deletes the keys file', async () => {
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, makeFixtureKey());
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(true);

    await manager.setPersistence(DRIVE_ID, false, SESSION_PW);
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(false);
  });

  it('(d4) clearPersistedStorage (wallet clear) removes the file', async () => {
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, makeFixtureKey());
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(true);

    await manager.clearPersistedStorage();
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(false);
    expect(manager.isPersisted(DRIVE_ID)).toBe(false);
  });

  it('(d5) persistence is per-profile: profile B cannot restore profile A keys', async () => {
    const managerA = new DriveKeyManager();
    managerA.setProfile(PROFILE_A);
    managerA.cacheKey(DRIVE_ID, makeFixtureKey());
    await managerA.setPersistence(DRIVE_ID, true, SESSION_PW);

    const managerB = new DriveKeyManager();
    managerB.setProfile(PROFILE_B);
    expect(await managerB.restorePersistedKeys(SESSION_PW)).toBe(0);
    expect(managerB.isUnlocked(DRIVE_ID)).toBe(false);
  });

  it('cannot persist a locked (non-unlocked) drive', async () => {
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    // Never cached -> not unlocked.
    expect(await manager.setPersistence(DRIVE_ID, true, SESSION_PW)).toBe(false);
    expect(manager.isPersisted(DRIVE_ID)).toBe(false);
    expect(fsSync.existsSync(keysFilePath(PROFILE_A))).toBe(false);
  });

  it('wrong session password fails closed on restore (drive stays locked)', async () => {
    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, makeFixtureKey());
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);

    const restarted = new DriveKeyManager();
    restarted.setProfile(PROFILE_A);
    expect(await restarted.restorePersistedKeys('wrong-password')).toBe(0);
    expect(restarted.isUnlocked(DRIVE_ID)).toBe(false);
  });

  it('SECURITY: no plaintext key material is written to disk', async () => {
    const fixture = makeFixtureKey();
    const keyBase64 = fixture.keyData.toString('base64');
    const keyHex = fixture.keyData.toString('hex');

    const manager = new DriveKeyManager();
    manager.setProfile(PROFILE_A);
    manager.cacheKey(DRIVE_ID, fixture);
    await manager.setPersistence(DRIVE_ID, true, SESSION_PW);

    const raw = fsSync.readFileSync(keysFilePath(PROFILE_A));
    const asUtf8 = raw.toString('utf8');

    // The on-disk file is the AES-256-GCM envelope, not the plaintext record.
    expect(asUtf8).toContain('"encrypted"');
    expect(asUtf8).toContain('"tag"');
    // None of the key material (base64/hex) nor the plaintext field name leaks.
    expect(asUtf8).not.toContain(keyBase64);
    expect(asUtf8).not.toContain('keyData');
    expect(asUtf8).not.toContain('driveSignatureType');
    // And the raw key bytes never appear anywhere in the file.
    expect(raw.includes(fixture.keyData)).toBe(false);
    expect(asUtf8).not.toContain(keyHex);
  });
});
