// @vitest-environment node
//
// MONEY-13: arweave.js's fetch-based Api never checks the HTTP status code
// (node_modules/arweave/node/api.js `request()` resolves `response.data`
// regardless of `res.status`), so on a gateway 429 `wallets.getBalance()`
// resolves successfully with the raw rate-limit response body (HTML)
// instead of throwing. `arweave.ar.winstonToAr()` then silently turns that
// non-numeric body into the string "NaN" via BigNumber, with no exception
// for the existing try/catch to catch — so the app rendered "NaN AR".
//
// These tests mock ardrive-core-js/arweave/turbo-manager so no network
// calls or real wallets are involved, then drive
// SecureWalletManager.getWalletInfo() through: (a) a persistent
// non-numeric/429-shaped response, (b) a transient one that recovers on
// retry, (c) a hard network failure, and (d) the normal numeric path -
// asserting the returned balance is NEVER the string 'NaN' and NEVER a
// fabricated '0' when unavailable.
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
  PrivateDriveKeyData: { from: vi.fn(async () => ({ mocked: 'private-drive-key-data' })) }
}));

// Mutable holder so each test can point the mocked Arweave.init() at a
// differently-behaving fake instance without re-mocking the module.
const arweaveMockState = vi.hoisted(() => ({ instance: null as any }));

vi.mock('arweave', () => ({
  default: {
    init: vi.fn(() => arweaveMockState.instance)
  }
}));

vi.mock('../../../src/main/turbo-manager', () => ({
  turboManager: { isInitialized: vi.fn(() => false) }
}));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: { getProfileStoragePath: vi.fn(() => '/tmp/fake-user-data/wallet.enc') }
}));
vi.mock('../../../src/main/config-manager', () => ({ configManager: {} }));
vi.mock('../../../src/main/database-manager', () => ({ databaseManager: {} }));
vi.mock('../../../src/main/keychain-service', () => ({ keychainService: {} }));
vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(),
  readEncryptedFile: vi.fn(),
  secureDeleteFile: vi.fn(),
  decryptData: vi.fn(),
  encryptData: vi.fn()
}));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: { unlockDriveUnverified: vi.fn(async () => true), getPrivateKeyData: vi.fn(async () => ({})) }
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';

const FAKE_ADDRESS = 'fake-wallet-address-abc123';
// What a real gateway 429 page looks like landing in response.data - the
// exact shape arweave.js's api.js hands back with no status check.
const RATE_LIMIT_BODY = '<html><head><title>429 Too Many Requests</title></head><body>rate limited</body></html>';

/** Mimics arweave.js's Ar.winstonToAr: numeric winston -> AR string, anything
 *  non-numeric -> the literal string 'NaN' (BigNumber(NaN).toFixed()). */
function fakeWinstonToAr(winstonString: string): string {
  if (!/^\d+$/.test(winstonString)) {
    return 'NaN';
  }
  const ar = Number(winstonString) / 1e12;
  return ar.toFixed(12);
}

function makeFakeArweave(getBalanceMock: ReturnType<typeof vi.fn>) {
  return {
    wallets: {
      ownerToAddress: vi.fn(async () => FAKE_ADDRESS),
      getBalance: getBalanceMock
    },
    ar: {
      winstonToAr: vi.fn(fakeWinstonToAr)
    }
  };
}

describe('SecureWalletManager.getWalletInfo — MONEY-13 NaN balance guard', () => {
  let manager: SecureWalletManager;

  beforeEach(() => {
    manager = new SecureWalletManager();
    const internals = manager as unknown as { wallet: unknown; walletJson: unknown; delay: (ms: number) => Promise<void> };
    internals.wallet = { fake: 'jwk' };
    internals.walletJson = { kty: 'RSA', n: 'fake-modulus' };
    // Skip real backoff waits (300ms/600ms) so the retry tests run instantly.
    internals.delay = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    arweaveMockState.instance = null;
  });

  it('never returns "NaN" or a fabricated "0" when the gateway persistently returns a 429 body', async () => {
    const getBalanceMock = vi.fn(async () => RATE_LIMIT_BODY);
    arweaveMockState.instance = makeFakeArweave(getBalanceMock);

    const info = await manager.getWalletInfo();

    expect(info).not.toBeNull();
    expect(info!.balance).not.toBe('NaN');
    expect(info!.balance).not.toBe('0');
    expect(info!.balanceUnavailable).toBe(true);
    // Bounded retries: it must have actually retried, and stopped (not spun forever).
    expect(getBalanceMock).toHaveBeenCalledTimes(3);
    // winstonToAr must never have been handed the non-numeric body.
    expect(arweaveMockState.instance.ar.winstonToAr).not.toHaveBeenCalled();
  });

  it('recovers on retry: a transient 429 followed by a valid response yields the correct AR figure, never NaN', async () => {
    const getBalanceMock = vi
      .fn()
      .mockResolvedValueOnce(RATE_LIMIT_BODY) // attempt 1: rate-limited
      .mockResolvedValueOnce('1000000000000'); // attempt 2: recovers, 1 AR
    arweaveMockState.instance = makeFakeArweave(getBalanceMock);

    const info = await manager.getWalletInfo();

    expect(info).not.toBeNull();
    expect(info!.balance).not.toBe('NaN');
    expect(info!.balanceUnavailable).toBeFalsy();
    expect(parseFloat(info!.balance)).toBeCloseTo(1, 6);
    expect(getBalanceMock).toHaveBeenCalledTimes(2);
  });

  it('never returns "NaN" or a fabricated "0" when getBalance throws outright (network error)', async () => {
    const getBalanceMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    arweaveMockState.instance = makeFakeArweave(getBalanceMock);

    const info = await manager.getWalletInfo();

    expect(info).not.toBeNull();
    expect(info!.balance).not.toBe('NaN');
    expect(info!.balance).not.toBe('0');
    expect(info!.balanceUnavailable).toBe(true);
  });

  it('still returns the correct AR figure on the normal numeric path (no retries needed)', async () => {
    const getBalanceMock = vi.fn(async () => '500000000000'); // 0.5 AR
    arweaveMockState.instance = makeFakeArweave(getBalanceMock);

    const info = await manager.getWalletInfo();

    expect(info).not.toBeNull();
    expect(info!.balanceUnavailable).toBeFalsy();
    expect(parseFloat(info!.balance)).toBeCloseTo(0.5, 6);
    expect(info!.balance).not.toBe('NaN');
    expect(getBalanceMock).toHaveBeenCalledTimes(1);
  });

  it('fixture sanity: the old code path (no numeric guard) DOES turn a 429 body into the string "NaN" (proves the bug is real)', () => {
    // This is exactly what unguarded `arweave.ar.winstonToAr(rateLimitBody)`
    // produced before this fix - the literal string "NaN" reaching the UI.
    expect(fakeWinstonToAr(RATE_LIMIT_BODY)).toBe('NaN');
  });
});
