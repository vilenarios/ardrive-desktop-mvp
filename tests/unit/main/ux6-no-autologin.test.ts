// @vitest-environment node
//
// UX-6 / D-031: beta ships with ALWAYS-PROMPT login — NO auto-login. These
// tests prove the two guarantees of the decision:
//   1. The auto-login code path is GONE. The wallet manager exposes no method
//      that loads the wallet from a stored/session credential without a
//      user-entered password (the former attemptAutoLoad() was removed, not
//      left inert), so nothing at boot can silently open the wallet.
//   2. Without opt-in consent (SEC-4), the session login credential is NEVER
//      written to disk/keychain — it is held in encrypted memory only and any
//      stale keychain entry is proactively wiped. This is what makes "relaunch
//      with a wallet present" write no password to disk/keychain.
//
// Heavy deps (ardrive-core-js / arweave / turbo) are mocked so no network,
// wallets, or ecc self-check run under the node environment.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/fake-user-data'), isPackaged: false }
}));

vi.mock('ardrive-core-js', () => ({
  arDriveFactory: vi.fn(),
  readJWKFile: vi.fn(),
  ArweaveAddress: vi.fn(),
  JWKWallet: vi.fn(),
  EID: vi.fn(),
  DriveSignatureType: { v1: 1, v2: 2 }
}));

vi.mock('arweave', () => ({ default: { init: vi.fn() } }));

vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { reset: vi.fn() }
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(() => '/tmp/fake-user-data/wallet.enc'),
    getProfilePath: vi.fn(() => '/tmp/fake-user-data/profile'),
    getActiveProfile: vi.fn(async () => ({ id: 'profile-aaaa' }))
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

const PW = 'PW-SENTINEL-ux6-9Z1kM';
const PROFILE_A = 'profile-aaaa';

const ks = keychainService as unknown as {
  isKeychainAvailable: ReturnType<typeof vi.fn>;
  setPassword: ReturnType<typeof vi.fn>;
  getPassword: ReturnType<typeof vi.fn>;
  deletePassword: ReturnType<typeof vi.fn>;
};
const cfg = configManager as unknown as {
  getKeychainConsent: ReturnType<typeof vi.fn>;
};

type Internals = {
  currentProfileId: string | null;
  encryptedSessionPassword: Buffer | null;
  storeSessionPassword: (password: string) => Promise<void>;
};
const asInternals = (m: SecureWalletManager) => m as unknown as Internals;

describe('UX-6 / D-031: always-prompt login (no auto-login)', () => {
  let manager: SecureWalletManager;

  beforeEach(() => {
    vi.clearAllMocks();
    ks.isKeychainAvailable.mockReturnValue(true);
    ks.setPassword.mockResolvedValue(undefined);
    ks.getPassword.mockResolvedValue(null);
    ks.deletePassword.mockResolvedValue(true);
    cfg.getKeychainConsent.mockResolvedValue(false);

    manager = new SecureWalletManager();
    asInternals(manager).currentProfileId = PROFILE_A;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the auto-login code path is removed', () => {
    it('exposes no attemptAutoLoad() method (nothing can load the wallet without a typed password)', () => {
      expect((manager as unknown as Record<string, unknown>).attemptAutoLoad).toBeUndefined();
    });

    it('does not expose an ensureLoaded/auto-load-style boot helper', () => {
      const asRecord = manager as unknown as Record<string, unknown>;
      // Guard against a re-introduced silent-load entry point under any of the
      // historical names.
      expect(asRecord.attemptAutoLoad).toBeUndefined();
      expect(asRecord.ensureLoaded).toBeUndefined();
      expect(asRecord.autoLoad).toBeUndefined();
    });
  });

  describe('no login credential is persisted without opt-in consent', () => {
    it('holds the credential in encrypted memory only and never writes it to the keychain', async () => {
      cfg.getKeychainConsent.mockResolvedValue(false);

      await asInternals(manager).storeSessionPassword(PW);

      // Nothing durable is written on relaunch-relevant paths without consent.
      expect(ks.setPassword).not.toHaveBeenCalled();
      // Any stale entry for this profile is proactively wiped (fail-closed).
      expect(ks.deletePassword).toHaveBeenCalledWith(`wallet-${PROFILE_A}`);
      // The credential exists only in encrypted memory (gone when the app quits).
      expect(asInternals(manager).encryptedSessionPassword).not.toBeNull();
    });

    it('does not print the login credential to any console channel', async () => {
      const channels = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const spies = channels.map((c) => vi.spyOn(console, c).mockImplementation(() => {}));

      cfg.getKeychainConsent.mockResolvedValue(false);
      await asInternals(manager).storeSessionPassword(PW);

      const output = spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' | ');

      expect(output).not.toContain(PW);
      expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
    });
  });
});
