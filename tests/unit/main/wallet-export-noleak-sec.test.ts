// @vitest-environment node
//
// SEC / wallet-safety (SEC-5 pattern): wallet export must (a) REQUIRE the
// correct password before revealing any key material, and (b) return the secret
// IN MEMORY ONLY — never staging it in a temp file and never writing it to a
// log/console channel. The secret is legitimately in the RETURNED value (that
// is the export payload the renderer shows behind a reveal gate); the invariant
// here is that it escapes to nowhere ELSE.
//
// These tests drive the real WalletExportManager with a fake wallet manager and
// sentinel secrets — no real key material is ever touched. A sentinel that
// appears in ANY console call OR ANY fs write (path or contents) means a leak.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';

// --- Sentinels standing in for the wallet's secrets --------------------------
const SENTINEL_SEED =
  'sentinelalpha sentinelbravo sentinelcharlie sentineldelta sentinelecho sentinelfoxtrot ' +
  'sentinelgolf sentinelhotel sentinelindia sentineljuliett sentinelkilo sentinellima';
const SENTINEL_JWK_D = 'SENTINEL-JWK-PRIVATE-EXPONENT-d33f00ba9c';
const SENTINEL_JWK_N = 'SENTINEL-JWK-PUBLIC-MODULUS-n';
const SENTINEL_ADDRESS = 'SENTINELADDRESSl55sI4sCbT9d9AV6WKz2DQpnW4Ld0Ec';
const CORRECT_PW = 'correct-horse-battery-staple';
const WRONG_PW = 'wrong-password-000000';
const PROFILE_ID = 'profile-1';

const WALLET_BLOB = JSON.stringify({
  type: 'arweave',
  metadata: { createdFrom: 'seed', seedPhrase: SENTINEL_SEED, createdAt: 'now' },
  jwk: { kty: 'RSA', e: 'AQAB', n: SENTINEL_JWK_N, d: SENTINEL_JWK_D },
});

// Don't pull in the real SecureWalletManager (ardrive-core import chain); we
// pass our own fake into the export manager anyway.
vi.mock('../../../src/main/wallet-manager-secure', () => ({ SecureWalletManager: class {} }));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user-data'), isPackaged: false },
  dialog: {},
  clipboard: { clear: vi.fn() },
}));

vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: {
    getProfileStoragePath: vi.fn(() => '/mock/profiles/profile-1/wallet.enc'),
  },
}));

vi.mock('../../../src/main/crypto-utils', () => ({
  // Only used by the encrypted-JWK path (not under test here); return a blob
  // that deliberately contains NO sentinel so a leak can't be faked as "safe".
  encryptData: vi.fn(async () => ({ iv: 'iv', data: 'ciphertext-no-secret' })),
  decryptData: vi.fn(async () => 'pw'),
}));

// fs/promises fully mocked: reads succeed; appendFile/mkdir/writeFile are spies.
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('encrypted-wallet-blob-on-disk'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

import { WalletExportManager } from '../../../src/main/wallet-export-manager';

// Fake wallet manager exposing exactly the two methods the export manager calls.
function makeFakeWalletManager() {
  return {
    // Password gate: only the correct password decrypts to the wallet blob.
    decryptWallet: vi.fn(async (_data: string, password: string) =>
      password === CORRECT_PW ? WALLET_BLOB : null
    ),
    getAddressFromJWK: vi.fn(async () => SENTINEL_ADDRESS),
  } as any;
}

type Write = { target: string; data: string };

function collectFileWrites(): Write[] {
  const writes: Write[] = [];
  for (const call of vi.mocked(fsp.writeFile).mock.calls) {
    writes.push({ target: String(call[0]), data: call[1] == null ? '' : String(call[1]) });
  }
  for (const call of vi.mocked(fsp.appendFile).mock.calls) {
    writes.push({ target: String(call[0]), data: call[1] == null ? '' : String(call[1]) });
  }
  return writes;
}

const SENTINELS = [SENTINEL_SEED, SENTINEL_JWK_D, SENTINEL_JWK_N, 'sentinelalpha', 'sentinellima'];

// The single leak detector used by both the assertions and the teeth test.
function leakProblems(writes: Write[], logs: string): string[] {
  const problems: string[] = [];
  const tmp = path.resolve(os.tmpdir());
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
    for (const s of SENTINELS) {
      if (w.target.includes(s) || w.data.includes(s)) {
        problems.push(`secret material written to a file: ${w.target}`);
      }
    }
  }
  for (const s of SENTINELS) {
    if (logs.includes(s)) {
      problems.push(`secret material written to a log/console channel`);
    }
  }
  return problems;
}

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

describe('Wallet export — password required + no plaintext leak (wallet-safety)', () => {
  let manager: WalletExportManager;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    manager = new WalletExportManager(makeFakeWalletManager());
  });

  afterEach(() => {
    consoleSpies.forEach((s) => s.mockRestore());
  });

  it('WRONG password: refuses to export, returns no data, and leaks nothing', async () => {
    const result = await manager.exportWallet(
      { format: 'seed-phrase', password: WRONG_PW },
      PROFILE_ID
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid password/i);
    expect(result.data).toBeUndefined();

    expect(leakProblems(collectFileWrites(), loggedOutput())).toEqual([]);
  });

  it('CORRECT password, seed-phrase export: returns the phrase in-memory only, leaking it nowhere else', async () => {
    const result = await manager.exportWallet(
      { format: 'seed-phrase', password: CORRECT_PW },
      PROFILE_ID
    );

    // Success: the returned payload IS the secret (shown behind a reveal gate).
    expect(result.success).toBe(true);
    expect(result.data).toBe(SENTINEL_SEED);

    // ...but it escaped to no file and no log/console channel.
    expect(leakProblems(collectFileWrites(), loggedOutput())).toEqual([]);
  });

  it('CORRECT password, private-key export: returns the raw key in-memory only, leaking it nowhere else', async () => {
    const result = await manager.exportWallet(
      { format: 'private-key', password: CORRECT_PW },
      PROFILE_ID
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe(SENTINEL_JWK_D);

    expect(leakProblems(collectFileWrites(), loggedOutput())).toEqual([]);
  });

  it('the audit log is still written, but with a redacted address and no key material', async () => {
    await manager.exportWallet({ format: 'seed-phrase', password: CORRECT_PW }, PROFILE_ID);

    // An audit entry was appended (accountability) ...
    expect(vi.mocked(fsp.appendFile)).toHaveBeenCalledTimes(1);
    const auditLine = String(vi.mocked(fsp.appendFile).mock.calls[0][1]);
    // ... it records the export happened and its type ...
    expect(auditLine).toContain('seed-phrase');
    // ... but never the seed phrase or the private key.
    expect(auditLine).not.toContain(SENTINEL_SEED);
    expect(auditLine).not.toContain(SENTINEL_JWK_D);
  });

  it('teeth: the leak detector actually flags a tmpdir write and a logged secret', () => {
    const badWrite: Write = {
      target: path.join(os.tmpdir(), 'export-tmp.json'),
      data: SENTINEL_SEED,
    };
    const problems = leakProblems([badWrite], `some log line ${SENTINEL_JWK_D}`);
    expect(problems.some((p) => p.includes('os.tmpdir()'))).toBe(true);
    expect(problems.some((p) => p.includes('written to a file'))).toBe(true);
    expect(problems.some((p) => p.includes('log/console channel'))).toBe(true);
  });
});
