// @vitest-environment node
//
// SEC-4: OS-keychain storage of the session login credential must be OPT-IN and
// have a correct lifecycle. These tests prove:
//   - the keychain WRITE is gated on per-profile consent (no consent -> not
//     written; the credential is held in encrypted memory only),
//   - lifecycle clears (logout, profile switch, consent revocation, profile
//     delete) actually DELETE the keychain entry,
//   - per-profile isolation holds (accounts are profile-scoped),
//   - the credential never leaks into console output.
//
// All heavy deps (ardrive-core-js / arweave / turbo) are mocked so no network,
// wallets, or ecc self-check run under the node environment.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/fake-user-data'),
    isPackaged: false
  }
}));

vi.mock('ardrive-core-js', () => ({
  arDriveFactory: vi.fn(),
  readJWKFile: vi.fn(),
  ArweaveAddress: vi.fn(),
  JWKWallet: vi.fn(),
  EID: vi.fn(),
  DriveSignatureType: { v1: 1, v2: 2 }
}));

vi.mock('arweave', () => ({
  default: { init: vi.fn() }
}));

vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { reset: vi.fn() }
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(() => '/tmp/fake-user-data/wallet.enc'),
    getProfilePath: vi.fn(() => '/tmp/fake-user-data/profile')
  }
}));

vi.mock('../../../src/main/config-manager', () => ({
  configManager: {
    getKeychainConsent: vi.fn(async () => false),
    setKeychainConsent: vi.fn(async () => {}),
    setActiveProfile: vi.fn(async () => {})
  }
}));

vi.mock('../../../src/main/database-manager', () => ({
  databaseManager: {
    close: vi.fn(async () => {}),
    setActiveProfile: vi.fn(async () => {})
  }
}));

vi.mock('../../../src/main/keychain-service', () => ({
  keychainService: {
    isKeychainAvailable: vi.fn(() => true),
    getSecurityMethod: vi.fn(() => 'keychain'),
    setPassword: vi.fn(async () => {}),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(async () => true)
  }
}));

vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(),
  readEncryptedFile: vi.fn(),
  secureDeleteFile: vi.fn(),
  decryptData: vi.fn(async () => 'decrypted'),
  // Never echo the plaintext back — the buffer must not carry the sentinel.
  encryptData: vi.fn(async () => ({ iv: 'xx', ciphertext: 'redacted' }))
}));

vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: {
    setWallet: vi.fn(),
    setProfile: vi.fn(),
    clearAllKeys: vi.fn(),
    clearPersistedStorage: vi.fn(async () => {})
  }
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { keychainService } from '../../../src/main/keychain-service';
import { configManager } from '../../../src/main/config-manager';

// Distinctive stand-in for the real login credential. If this ever appears in
// console output OR in a keychain call it shouldn't be in, the gate/clear leaked.
const PW = 'PW-SENTINEL-sec4-7Q2xR';
const PROFILE_A = 'profile-aaaa';
const PROFILE_B = 'profile-bbbb';

const ks = keychainService as unknown as {
  isKeychainAvailable: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  getPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
};
const cfg = configManager as unknown as {
  getKeychainConsent: ReturnType<typeof vi.fn>;
  setKeychainConsent: ReturnType<typeof vi.fn>;
};

/** Reach a private method / field without widening the public surface. */
type Internals = {
  currentProfileId: string | null;
  encryptedSessionPassword: Buffer | null;
  storeSessionPassword: (password: string) => Promise<void>;
  clearSessionPassword: () => void;
};
const asInternals = (m: SecureWalletManager) => m as unknown as Internals;

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

describe('SEC-4 keychain consent + lifecycle', () => {
  let manager: SecureWalletManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults; individual tests override.
    ks.isKeychainAvailable.mockReturnValue(true);
    ks.setPassword.mockResolvedValue(undefined);
    ks.getPassword.mockResolvedValue(null);
    ks.deletePassword.mockResolvedValue(true);
    cfg.getKeychainConsent.mockResolvedValue(false);
    cfg.setKeychainConsent.mockResolvedValue(undefined);

    manager = new SecureWalletManager();
    asInternals(manager).currentProfileId = PROFILE_A;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('consent gates the keychain write', () => {
    it('does NOT write to the keychain without consent (holds credential in memory)', async () => {
      cfg.getKeychainConsent.mockResolvedValue(false);

      await asInternals(manager).storeSessionPassword(PW);

      // The whole point: silent persistence is gone.
      expect(ks.setPassword).not.toHaveBeenCalled();
      // Defensive: any stale keychain entry for this profile is proactively wiped.
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);
      // Credential lives in encrypted memory only.
      expect(asInternals(manager).encryptedSessionPassword).not.toBeNull();
    });

    it('writes the credential to the keychain WHEN consent is granted', async () => {
      cfg.getKeychainConsent.mockResolvedValue(true);

      await asInternals(manager).storeSessionPassword(PW);

      expect(ks.setPassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`, PW);
      // Persisted durably -> the in-memory copy is dropped WITHOUT deleting the
      // keychain entry we just wrote.
      expect(ks.deletePassword).not.toHaveBeenCalled();
      expect(asInternals(manager).encryptedSessionPassword).toBeNull();
    });

    it('never persists to the keychain when no secure keychain is available (even with consent)', async () => {
      cfg.getKeychainConsent.mockResolvedValue(true);
      ks.isKeychainAvailable.mockReturnValue(false);

      await asInternals(manager).storeSessionPassword(PW);

      expect(ks.setPassword).not.toHaveBeenCalled();
      expect(ks.deletePassword).not.toHaveBeenCalled();
      expect(asInternals(manager).encryptedSessionPassword).not.toBeNull();
    });
  });

  describe('lifecycle clears the stored credential', () => {
    it('clear-on-logout deletes the keychain entry for the active profile', async () => {
      await manager.logout();
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);
      expect(asInternals(manager).encryptedSessionPassword).toBeNull();
    });

    it('the lifecycle clear (used on profile switch) deletes the keychain entry', async () => {
      // clearSessionPassword() is the routine clearInMemoryWallet() runs on every
      // profile switch (with currentProfileId still the OUTGOING profile).
      asInternals(manager).clearSessionPassword();
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);
    });

    it('consent revocation persists opt-out AND durably clears the keychain', async () => {
      // Simulate a currently-remembered credential retrievable from the keychain.
      ks.getPassword.mockResolvedValue(PW);
      cfg.getKeychainConsent.mockResolvedValue(false); // effective state after revoke

      const result = await manager.setKeychainConsent(false);

      expect(result).toBe(false);
      expect(cfg.setKeychainConsent).toHaveBeenCalledWith(false);
      // The remembered credential is wiped from the keychain for this profile.
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);
      // ...and it is NOT re-written to the keychain.
      expect(ks.setPassword).not.toHaveBeenCalled();
    });

    it('enabling consent promotes the in-session credential to the keychain', async () => {
      ks.getPassword.mockResolvedValue(PW); // live session credential
      cfg.getKeychainConsent.mockResolvedValue(true); // effective state after enable

      const result = await manager.setKeychainConsent(true);

      expect(result).toBe(true);
      expect(cfg.setKeychainConsent).toHaveBeenCalledWith(true);
      expect(ks.setPassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`, PW);
    });

    it('enabling consent throws (and stores nothing) when no secure keychain exists', async () => {
      ks.isKeychainAvailable.mockReturnValue(false);

      await expect(manager.setKeychainConsent(true)).rejects.toThrow(/keychain is not available/i);
      expect(cfg.setKeychainConsent).not.toHaveBeenCalled();
      expect(ks.setPassword).not.toHaveBeenCalled();
    });

    it('forgetDeviceForProfile deletes the keychain entry for a specific profile', async () => {
      await manager.forgetDeviceForProfile(PROFILE_B);
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_B}`);
    });
  });

  describe('per-profile isolation', () => {
    it('keychain accounts are profile-scoped so one profile cannot read another', async () => {
      // Clear on the OUTGOING profile A...
      asInternals(manager).clearSessionPassword();
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);

      // ...then store for profile B with consent.
      asInternals(manager).currentProfileId = PROFILE_B;
      cfg.getKeychainConsent.mockResolvedValue(true);
      await asInternals(manager).storeSessionPassword(PW);

      expect(ks.setPassword).toHaveBeenCalledWith(`wallet-${PROFILE_B}`, PW);
      // A's entry was cleared, never re-read for B.
      expect(ks.setPassword).not.toHaveBeenCalledWith(`wallet-${PROFILE_A}`, expect.anything());
      expect(ks.deletePassword).not.toHaveBeenCalledWith(`wallet-${PROFILE_B}`);
    });
  });

  describe('no credential leaks to logs', () => {
    it('does not print the credential to any console channel (consent on or off)', async () => {
      const spies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

      cfg.getKeychainConsent.mockResolvedValue(false);
      await asInternals(manager).storeSessionPassword(PW);
      cfg.getKeychainConsent.mockResolvedValue(true);
      await asInternals(manager).storeSessionPassword(PW);
      asInternals(manager).clearSessionPassword();

      const output = spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' | ');

      expect(output).not.toContain(PW);
      // Sanity: logging actually happened, so the assertion is meaningful.
      expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    });
  });
});
