// @vitest-environment node
//
// SEC-5: the decrypted JWK must never be written to a temp file on disk.
// The audited bug: importWallet / importFromSeedPhrase / loadWallet each wrote
// the plaintext JWK JSON to a file under os.tmpdir() purely to satisfy
// ardrive-core-js's readJWKFile(path), then secure-deleted it in a finally.
// The fix constructs the wallet in memory via `new JWKWallet(jwk)`, so the
// private key never touches disk at all.
//
// These tests drive all three flows end to end (heavy managers mocked, no
// network / real wallets) while recording every fs write. They assert that no
// write targets os.tmpdir() and that no write ever contains the private-key
// material. A teeth test proves the detector actually flags a tmpdir write.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';

// A sentinel standing in for the private exponent of the JWK. If this string
// shows up in ANY file write (path or contents), key material hit disk.
const { FAKE_JWK, JWK_SENTINEL } = vi.hoisted(() => {
  const JWK_SENTINEL = 'SEC5-JWK-PRIVATE-SENTINEL-d33f00ba9c';
  const FAKE_JWK = {
    kty: 'RSA',
    e: 'AQAB',
    n: 'fake-public-modulus-n',
    d: JWK_SENTINEL,
    p: 'fake-p',
    q: 'fake-q',
    dp: 'fake-dp',
    dq: 'fake-dq',
    qi: 'fake-qi',
  };
  return { FAKE_JWK, JWK_SENTINEL };
});

// Canonical BIP-39 test mnemonic — bip39 is NOT mocked, so it must validate.
const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data'), isPackaged: false },
}));

// Classes live inside the factory (which is hoisted) so they can be referenced
// from the mock; only FAKE_JWK (vi.hoisted) crosses in. The fake JWKWallet just
// stores the jwk and returns it from getPrivateKey() — the exact in-memory
// construction our fix relies on (see core-js jwk_wallet.js).
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
      wallets: { ownerToAddress: vi.fn(async () => 'FAKEADDRESS1234567890') },
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
    isKeychainAvailable: vi.fn(() => true),
    setPassword: vi.fn(async () => undefined),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(),
  },
}));
vi.mock('../../../src/main/crypto-utils', () => ({
  writeEncryptedFile: vi.fn(async () => undefined),
  // loadWallet reads the encrypted wallet blob from here (never from tmpdir).
  readEncryptedFile: vi.fn(async () =>
    JSON.stringify({
      type: 'arweave',
      metadata: { createdFrom: 'jwk', createdAt: 'now' },
      jwk: FAKE_JWK,
    })
  ),
  secureDeleteFile: vi.fn(async () => undefined),
  encryptData: vi.fn().mockResolvedValue({ iv: 'iv', data: 'cipher' }),
  decryptData: vi.fn().mockResolvedValue('pw'),
}));
vi.mock('../../../src/main/drive-key-manager', () => ({
  driveKeyManager: { setWallet: vi.fn(), clearAllKeys: vi.fn() },
}));

// fs/promises fully mocked: reads succeed, and writeFile is the spy under test.
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(JSON.stringify(FAKE_JWK)),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { arDriveFactory } from 'ardrive-core-js';
import { secureDeleteFile } from '../../../src/main/crypto-utils';

type Write = { target: string; data: string };

let consoleSpies: ReturnType<typeof vi.spyOn>[];

// The audited code wrote the JWK via fs/promises.writeFile; that module is
// fully mocked here, so its recorded calls are the exact disk-staging surface.
function collectFileWrites(): Write[] {
  const writes: Write[] = [];
  for (const call of vi.mocked(fsp.writeFile).mock.calls) {
    writes.push({ target: String(call[0]), data: call[1] == null ? '' : String(call[1]) });
  }
  return writes;
}

// The single detector used by BOTH the real assertions and the teeth test.
function tmpdirOrKeyProblems(writes: Write[]): string[] {
  const tmp = path.resolve(os.tmpdir());
  const problems: string[] = [];
  for (const w of writes) {
    let resolved: string;
    try {
      resolved = path.resolve(w.target);
    } catch {
      resolved = w.target;
    }
    if (resolved === tmp || resolved.startsWith(tmp + path.sep)) {
      problems.push(`file written under os.tmpdir(): ${w.target}`);
    }
    if (w.target.includes(JWK_SENTINEL) || w.data.includes(JWK_SENTINEL)) {
      problems.push('wallet private-key material written to a file');
    }
  }
  return problems;
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

describe('SEC-5 — no decrypted JWK is written to os.tmpdir()', () => {
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

  it('importWallet (JWK import) builds the wallet in memory, writing nothing to tmpdir', async () => {
    const ok = await manager.importWallet('/some/where/wallet.json', 'password-123456');

    expect(ok).toBe(true);
    // Reached and passed the in-memory construction with the real key.
    const factoryArg = vi.mocked(arDriveFactory).mock.calls[0][0] as any;
    expect(factoryArg.wallet.getPrivateKey().d).toBe(JWK_SENTINEL);

    expect(tmpdirOrKeyProblems(collectFileWrites())).toEqual([]);
    expect(loggedOutput()).not.toContain(JWK_SENTINEL);
  });

  it('importFromSeedPhrase builds the wallet in memory, writing nothing to tmpdir', async () => {
    const ok = await manager.importFromSeedPhrase(VALID_MNEMONIC, 'password-123456');

    expect(ok).toBe(true);
    const factoryArg = vi.mocked(arDriveFactory).mock.calls[0][0] as any;
    expect(factoryArg.wallet.getPrivateKey().d).toBe(JWK_SENTINEL);

    expect(tmpdirOrKeyProblems(collectFileWrites())).toEqual([]);
    expect(loggedOutput()).not.toContain(JWK_SENTINEL);
  });

  it('loadWallet (login) builds the wallet in memory, writing nothing to tmpdir', async () => {
    // login runs against an already-active profile.
    (manager as any).currentProfileId = 'profile-1';

    const ok = await manager.loadWallet('password-123456');

    expect(ok).toBe(true);
    const factoryArg = vi.mocked(arDriveFactory).mock.calls[0][0] as any;
    expect(factoryArg.wallet.getPrivateKey().d).toBe(JWK_SENTINEL);

    expect(tmpdirOrKeyProblems(collectFileWrites())).toEqual([]);
    expect(loggedOutput()).not.toContain(JWK_SENTINEL);
  });

  it('none of the three flows call fs.writeFile at all (no disk staging of the key)', async () => {
    await manager.importWallet('/some/where/wallet.json', 'password-123456');
    await manager.importFromSeedPhrase(VALID_MNEMONIC, 'password-123456');
    (manager as any).currentProfileId = 'profile-1';
    await manager.loadWallet('password-123456');

    // The only persistence in these flows goes through the (mocked)
    // encrypted-wallet writer; raw fs.writeFile is never touched...
    expect(vi.mocked(fsp.writeFile)).not.toHaveBeenCalled();
    // ...and with no temp file staged, the temp-file secure-delete that the
    // audited `finally` performed never runs either.
    expect(vi.mocked(secureDeleteFile)).not.toHaveBeenCalled();
  });

  it('teeth: the detector flags a tmpdir write of key material (the old behavior)', () => {
    // Reproduces exactly what the audited code did: write the JWK JSON to a
    // temp-wallet file under os.tmpdir(). The detector MUST catch it.
    const oldBehaviorWrite: Write = {
      target: path.join(os.tmpdir(), `temp-wallet-${Date.now()}.json`),
      data: JSON.stringify(FAKE_JWK),
    };
    const problems = tmpdirOrKeyProblems([oldBehaviorWrite]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('os.tmpdir()'))).toBe(true);
    expect(problems.some((p) => p.includes('private-key material'))).toBe(true);
  });
});
