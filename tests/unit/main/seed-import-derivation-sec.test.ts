// @vitest-environment node
//
// SEC / wallet-safety: seed-phrase import is a primary onboarding route that
// was never tested. Losing (or wrongly deriving) the wallet from a recovery
// phrase = losing everything, so this pins the derivation contract end-to-end
// against the REAL ardrive-core-js + arweave stack (NOT mocked):
//
//   1. GOLDEN: a known BIP-39 test mnemonic derives the EXACT expected Arweave
//      address, deterministically, through the real SecureWalletManager import
//      path — proving the derivation is correct and stable.
//   2. INVALID phrase → fails CLOSED with a clear error (no crash), persists
//      nothing, and never leaks the phrase to logs/errors.
//   3. 24-word phrase → also fails CLOSED with a clear error and no leak.
//      (ardrive-core-js derives Arweave wallets from 12-word phrases only;
//      a 24-word phrase cannot produce an Arweave wallet — see
//      node_modules/ardrive-core-js SeedPhrase, regex `{12}` — so import must
//      reject it safely rather than half-succeed.)
//
// Only the golden case runs the (deterministic but ~60s) RSA-4096 derivation;
// the fail-closed cases short-circuit at validation, before any key work.
//
// NEVER put a real seed phrase / wallet here. The golden mnemonic is the
// canonical, publicly-documented BIP-39 all-"abandon" test vector — a throwaway
// with no funds — and the invalid phrase is a non-wordlist sentinel string.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- Known throwaway test vectors (never real secrets) -----------------------
// Canonical BIP-39 test mnemonic (12 words). Publicly documented; holds no funds.
const GOLDEN_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Golden Arweave address for GOLDEN_MNEMONIC via ardrive-core-js RSA-4096
// derivation (human-crypto-keys → JWK → arweave ownerToAddress). Deterministic;
// verified out-of-band before pinning here.
const GOLDEN_ADDRESS = 'l55sI4sCbT9d9AV6WKz2DQpnW4Ld0EcBAZv-CMv_HAQ';

// 12 all-letter words that are NOT a valid BIP-39 mnemonic (bad checksum /
// off-wordlist). Distinctive so a "phrase must not leak" check is meaningful.
const INVALID_PHRASE =
  'sentinelzz sentinelyy sentinelxx sentinelww sentinelvv sentineluu ' +
  'sentineltt sentinelss sentinelrr sentinelqq sentinelpp sentineloo';

// A 24-word phrase. Regardless of its BIP-39 checksum, it is not an Arweave
// (12-word) recovery phrase, so import must reject it at the word-count guard
// (which fires before any mnemonic-checksum or key-derivation work).
const TWENTYFOUR_WORD =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

const PASSWORD = 'seed-import-test-pw-987654';

// --- Mock ONLY the persistence / side-effect surface. ardrive-core-js, arweave
//     and bip39 are intentionally REAL so the derivation is exercised. ---------
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data'), isPackaged: false },
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileByAddress: vi.fn(async () => null),
    createProfile: vi.fn(async (_name: string, _address: string) => ({ id: 'profile-1' })),
    setActiveProfile: vi.fn(),
    getActiveProfile: vi.fn(async () => null),
    getActiveProfileId: vi.fn(async () => null),
    getProfileStoragePath: vi.fn(() => '/mock/profiles/profile-1/wallet.enc'),
    getProfilePath: vi.fn(() => '/mock/profiles/profile-1'),
  },
}));
vi.mock('../../../src/main/config-manager', () => ({
  configManager: {
    setActiveProfile: vi.fn(),
    getGatewayHost: vi.fn(() => undefined),
    getGatewayFallbacks: vi.fn(() => undefined),
    getKeychainConsent: vi.fn(async () => false),
    setKeychainConsent: vi.fn(async () => undefined),
  },
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
    deletePassword: vi.fn(async () => true),
  },
}));
vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(async () => undefined),
  readEncryptedFile: vi.fn(async () => JSON.stringify({ type: 'arweave', metadata: {}, jwk: {} })),
  secureDeleteFile: vi.fn(async () => undefined),
  encryptData: vi.fn().mockResolvedValue({ iv: 'iv', data: 'cipher' }),
  decryptData: vi.fn().mockResolvedValue('pw'),
}));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: {
    setWallet: vi.fn(),
    setProfile: vi.fn(),
    restorePersistedKeys: vi.fn().mockResolvedValue(0),
    clearPersistedStorage: vi.fn().mockResolvedValue(undefined),
    clearAllKeys: vi.fn(),
  },
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { profileManager } from '../../../src/main/profile-manager';
import { writeEncryptedFile } from '../../../src/main/crypto-utils';

let consoleSpies: ReturnType<typeof vi.spyOn>[];

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

describe('Seed-phrase import derivation + fail-closed (wallet-safety)', () => {
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

  it(
    'GOLDEN: a known 12-word mnemonic derives the exact expected Arweave address',
    async () => {
      const ok = await manager.importFromSeedPhrase(GOLDEN_MNEMONIC, PASSWORD);
      expect(ok).toBe(true);

      // The address handed to profile creation is derived from the mnemonic;
      // it must match the pinned golden address exactly (derivation correct).
      expect(vi.mocked(profileManager.createProfile)).toHaveBeenCalledTimes(1);
      const [, derivedAddress] = vi.mocked(profileManager.createProfile).mock.calls[0];
      expect(derivedAddress).toBe(GOLDEN_ADDRESS);

      // The encrypted wallet persisted stores the SAME phrase it was imported
      // from (so a future export/recover round-trips), tagged as seed-imported.
      const payload = JSON.parse(String(vi.mocked(writeEncryptedFile).mock.calls[0][1]));
      expect(payload.metadata.seedPhrase).toBe(GOLDEN_MNEMONIC.trim());
      expect(payload.metadata.createdFrom).toBe('seed');
      expect(payload.jwk).toBeTruthy();

      // The private exponent / phrase must not have been logged to the console.
      const logs = loggedOutput();
      expect(logs).not.toContain(GOLDEN_MNEMONIC);
      expect(logs).not.toContain(payload.jwk.d);
    },
    180_000 // real RSA-4096 derivation is deterministic but slow
  );

  it('INVALID phrase fails closed with a clear error, persists nothing, and never leaks the phrase', async () => {
    await expect(manager.importFromSeedPhrase(INVALID_PHRASE, PASSWORD)).rejects.toThrow(
      /invalid seed phrase/i
    );

    // Nothing was persisted or activated.
    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();

    // The phrase itself never appears in any console channel.
    expect(loggedOutput()).not.toContain('sentinelzz');
    expect(loggedOutput()).not.toContain('sentineloo');
  });

  it('captures the invalid-phrase error message WITHOUT the phrase in it', async () => {
    let message = '';
    try {
      await manager.importFromSeedPhrase(INVALID_PHRASE, PASSWORD);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/invalid seed phrase/i);
    // The error surfaced to the UI must not embed the secret phrase.
    expect(message).not.toContain('sentinelzz');
    expect(message).not.toContain('sentineloo');
  });

  it('24-word phrase fails closed with a clear error, persists nothing, and never leaks the phrase', async () => {
    let message = '';
    try {
      await manager.importFromSeedPhrase(TWENTYFOUR_WORD, PASSWORD);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    // Clear, honest failure — points at the 12-word Arweave requirement, not a
    // crash or a silent half-import.
    expect(message).toMatch(/12 words/i);

    expect(vi.mocked(profileManager.createProfile)).not.toHaveBeenCalled();
    expect(vi.mocked(writeEncryptedFile)).not.toHaveBeenCalled();

    // The full phrase must not leak into the error or logs. ("art" is the only
    // non-"abandon" word, and is a real word, so assert the whole 24-word
    // string is absent rather than a single token.)
    expect(message).not.toContain(TWENTYFOUR_WORD);
    expect(loggedOutput()).not.toContain(TWENTYFOUR_WORD);
  });
});
