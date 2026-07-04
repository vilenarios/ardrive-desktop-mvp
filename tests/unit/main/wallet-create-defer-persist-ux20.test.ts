// @vitest-environment node
//
// UX-20: the Create-Account flow must NOT persist a wallet/profile until the
// user confirms they've saved their recovery phrase.
//
// The audited bug: `generateNewWallet` (Step 2 "Create Account") fully created
// AND persisted the profile + encrypted wallet immediately, and `completeSetup`
// (Step 3 confirmation) was a no-op stub. So a user who went Back from the
// recovery-phrase step and retried silently spawned a SECOND orphaned
// profile+wallet with a DIFFERENT seed phrase.
//
// The fix: `generateNewWallet` only PREPARES the account in memory (generate
// seed + derive address); `completeGeneratedWalletSetup` is the real persist
// step, run only on confirmation. These tests drive the manager directly (heavy
// deps mocked, no network / real wallets) and assert:
//   1. happy path — prepare persists NOTHING; confirming persists exactly ONE
//      profile whose stored seed equals the recovery phrase that was shown.
//   2. back-nav — preparing twice (Back + retry) persists NOTHING; confirming
//      leaves exactly ONE profile with the LAST-shown seed (no orphan, no
//      divergent seed).
//
// bip39 is intentionally NOT mocked so each generateNewWallet() yields a real,
// distinct 12-word mnemonic — that difference is what makes the divergent-seed
// assertion meaningful.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { FAKE_JWK } = vi.hoisted(() => {
  const FAKE_JWK = {
    kty: 'RSA',
    e: 'AQAB',
    n: 'fake-public-modulus-n',
    d: 'fake-private-exponent-d',
    p: 'fake-p',
    q: 'fake-q',
    dp: 'fake-dp',
    dq: 'fake-dq',
    qi: 'fake-qi',
  };
  return { FAKE_JWK };
});

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data'), isPackaged: false },
}));

// Deterministic wallet derivation stand-in (see core-js jwk_wallet.js /
// wallet_dao.js). generateJWKWallet is deterministic for a given mnemonic in
// production; the fake just returns a fixed JWK, which is all the manager needs.
vi.mock('ardrive-core-js', () => {
  class FakeJWKWallet {
    constructor(public jwk: any) {}
    getPrivateKey() {
      return this.jwk;
    }
    getPublicKey() {
      return Promise.resolve(this.jwk?.n);
    }
    async getAddress() {
      return 'FAKEADDRESS1234567890';
    }
    async sign() {
      return new Uint8Array();
    }
  }
  class FakeWalletDAO {
    constructor(_arweave?: unknown) {}
    async generateJWKWallet() {
      return new FakeJWKWallet(FAKE_JWK);
    }
  }
  class FakeSeedPhrase {
    constructor(public phrase: string) {}
    toString() {
      return this.phrase;
    }
  }
  return {
    arDriveFactory: vi.fn(() => ({})),
    ArDrive: class {},
    JWKWallet: FakeJWKWallet,
    ArweaveAddress: vi.fn(),
    EID: vi.fn((id: string) => ({ entityId: id })),
    WalletDAO: FakeWalletDAO,
    SeedPhrase: FakeSeedPhrase,
  };
});

vi.mock('arweave', () => ({
  default: {
    init: vi.fn(() => ({
      wallets: {
        ownerToAddress: vi.fn(async () => 'FAKEADDRESS1234567890'),
        getBalance: vi.fn(async () => '1000000000000'),
      },
      ar: { winstonToAr: vi.fn(() => '1.0') },
    })),
  },
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileByAddress: vi.fn(async () => null),
    createProfile: vi.fn(async () => ({ id: 'profile-1' })),
    setActiveProfile: vi.fn(),
    getActiveProfile: vi.fn(async () => null),
    getActiveProfileId: vi.fn(async () => null),
    getProfileStoragePath: vi.fn(() => '/mock/profiles/profile-1/wallet.enc'),
    getProfilePath: vi.fn(() => '/mock/profiles/profile-1'),
  },
}));
vi.mock('../../../src/main/config-manager', () => ({
  configManager: { setActiveProfile: vi.fn(), getGatewayHost: vi.fn() },
}));
vi.mock('../../../src/main/database-manager', () => ({
  databaseManager: { setActiveProfile: vi.fn(), close: vi.fn() },
}));
vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { initialize: vi.fn(), reset: vi.fn(), isInitialized: vi.fn(() => false) },
}));
vi.mock('../../../src/main/keychain-service', () => ({
  keychainService: {
    isKeychainAvailable: vi.fn(() => true),
    setPassword: vi.fn(async () => undefined),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(),
  },
}));
vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(async () => undefined),
  readEncryptedFile: vi.fn(async () => JSON.stringify({ type: 'arweave', metadata: {}, jwk: FAKE_JWK })),
  secureDeleteFile: vi.fn(async () => undefined),
  encryptData: vi.fn().mockResolvedValue({ iv: 'iv', data: 'cipher' }),
  decryptData: vi.fn().mockResolvedValue('pw'),
}));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: { setWallet: vi.fn(), clearAllKeys: vi.fn() },
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { profileManager } from '../../../src/main/profile-manager';
import { configManager } from '../../../src/main/config-manager';
import { databaseManager } from '../../../src/main/database-manager';
import { writeEncryptedFile } from '../../../src/main/crypto-utils';

const PASSWORD = 'UX20-secret-pw-987654';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

// Pull the seed phrase actually written to the encrypted wallet file. This is
// the seed the persisted account will recover from — the invariant under test.
function persistedSeedPhrases(): string[] {
  return vi.mocked(writeEncryptedFile).mock.calls.map((call) => {
    const payload = JSON.parse(String(call[1]));
    return payload?.metadata?.seedPhrase;
  });
}

function loggedOutput(): string {
  return consoleSpies
    .flatMap((s) => s.mock.calls)
    .flatMap((call) => call as unknown[])
    .map((arg) => {
      try {
        return typeof arg === 'string' ? arg : JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join('\n');
}

describe('UX-20 — Create-Account defers persistence to recovery-phrase confirmation', () => {
  let manager: SecureWalletManager;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    manager = new SecureWalletManager();
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
  });

  it('happy path: prepare persists nothing; confirming yields exactly one profile whose stored seed matches the shown phrase', async () => {
    const prepared = await manager.generateNewWallet(PASSWORD);

    // A real 12-word recovery phrase + address were produced to show the user...
    expect(prepared.seedPhrase.trim().split(/\s+/)).toHaveLength(12);
    expect(prepared.address).toBeTruthy();

    // ...but NOTHING was persisted or activated at this point.
    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(profileManager.setActiveProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(configManager.setActiveProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(databaseManager.setActiveProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();

    // Confirmation is where persistence actually happens.
    const done = await manager.completeGeneratedWalletSetup();
    expect(done.address).toBeTruthy();

    // Exactly one profile, one encrypted-wallet write.
    expect(vi.mocked(profileManager.createProfile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeEncryptedFile)).toHaveBeenCalledTimes(1);

    // The persisted wallet recovers from EXACTLY the phrase we showed.
    expect(persistedSeedPhrases()).toEqual([prepared.seedPhrase.trim()]);

    // No secret material leaked to the console anywhere in the flow.
    const logs = loggedOutput();
    expect(logs).not.toContain(prepared.seedPhrase);
    expect(logs).not.toContain(PASSWORD);
  });

  it('back-nav + retry: preparing twice persists nothing; confirming leaves one profile with the last-shown seed (no orphan, no divergent seed)', async () => {
    // Step 2 → shows phrase A.
    const first = await manager.generateNewWallet(PASSWORD);
    // User clicks Back, then Create Account again → shows phrase B (real bip39,
    // so genuinely different).
    const second = await manager.generateNewWallet(PASSWORD);

    expect(first.seedPhrase).not.toBe(second.seedPhrase);

    // Neither prepare persisted anything — no orphan from phrase A.
    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();

    // User confirms on Step 3 (which is showing phrase B).
    await manager.completeGeneratedWalletSetup();

    // Exactly ONE profile — not two.
    expect(vi.mocked(profileManager.createProfile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeEncryptedFile)).toHaveBeenCalledTimes(1);

    // The single persisted account recovers from phrase B (the one shown at
    // confirmation) — the abandoned phrase A was never written anywhere.
    const persisted = persistedSeedPhrases();
    expect(persisted).toEqual([second.seedPhrase.trim()]);
    expect(persisted).not.toContain(first.seedPhrase.trim());
  });

  it('confirming with no prepared account is a no-op that never persists', async () => {
    await expect(manager.completeGeneratedWalletSetup()).rejects.toThrow(/no pending account/i);
    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();
  });

  it('logout discards an un-confirmed prepared account so it can never be committed later', async () => {
    await manager.generateNewWallet(PASSWORD);

    // Logout clears in-memory state (including the pending account).
    await manager.logout();

    await expect(manager.completeGeneratedWalletSetup()).rejects.toThrow(/no pending account/i);
    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();
  });
});
