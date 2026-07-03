// @vitest-environment node
//
// SEC-1: creating a private drive must never emit key material to
// stdout/logs. ardrive-core-js ArFSResult.created[].key is an EntityKey
// whose toJSON()/toString() return the url-encoded RAW drive key, so
// logging the raw result (e.g. JSON.stringify(result)) leaks the key.
//
// These tests mock ardrive-core so no network calls or real wallets are
// involved, then spy on every console method during private drive creation
// and assert a sentinel key string never appears in ANY logged output.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inspect } from 'node:util';

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
  // Dynamically imported inside createPrivateDrive()
  PrivateDriveKeyData: {
    from: vi.fn(async () => ({ mocked: 'private-drive-key-data' }))
  }
}));

vi.mock('arweave', () => ({
  default: { init: vi.fn() }
}));

vi.mock('../../../src/main/turbo-manager', () => ({ turboManager: {} }));
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
  // PRIV-2 renamed unlockDrive -> unlockDriveUnverified (createPrivateDrive's
  // just-created-drive path); the trial-decrypt path uses deriveKey/cacheKey.
  driveKeyManager: { unlockDriveUnverified: vi.fn(async () => true) }
}));

import { SecureWalletManager } from '../../../src/main/wallet-manager-secure';
import { summarizeArFSResult } from '../../../src/main/utils/arfs-result-summary';

// The sentinel stands in for the url-encoded raw drive key. If this string
// (or its hex-encoded bytes) shows up in any console output, the key leaked.
const RAW_KEY_SENTINEL = 'RAW-DRIVE-KEY-SENTINEL-c9f3a1';
const RAW_KEY_SENTINEL_HEX = Buffer.from(RAW_KEY_SENTINEL, 'utf8').toString('hex');

/** Mimics ardrive-core-js EntityKey: toJSON/toString expose the raw key. */
class FakeEntityKey {
  readonly keyData = Buffer.from(RAW_KEY_SENTINEL, 'utf8');
  toJSON(): string {
    return RAW_KEY_SENTINEL;
  }
  toString(): string {
    return RAW_KEY_SENTINEL;
  }
}

const DRIVE_ID = 'a1b2c3d4-fake-drive-id';
const ROOT_FOLDER_ID = 'e5f6a7b8-fake-root-folder-id';
const DRIVE_META_TX = 'drive-metadata-tx-id';
const FOLDER_META_TX = 'folder-metadata-tx-id';

function makeId(value: string) {
  return { toString: () => value };
}

function makePrivateDriveArFSResult() {
  return {
    created: [
      {
        type: 'drive',
        entityId: makeId(DRIVE_ID),
        metadataTxId: makeId(DRIVE_META_TX),
        key: new FakeEntityKey()
      },
      {
        type: 'folder',
        entityId: makeId(ROOT_FOLDER_ID),
        metadataTxId: makeId(FOLDER_META_TX),
        key: new FakeEntityKey()
      }
    ],
    tips: [],
    fees: { [DRIVE_META_TX]: 12345 }
  };
}

const CONSOLE_METHODS = ['log', 'error', 'warn', 'info', 'debug'] as const;

type ConsoleSpy = ReturnType<typeof vi.spyOn>;

/**
 * Render every argument of every console call in all the ways it could end
 * up in a real log stream: String() (template/implicit), JSON.stringify
 * (which invokes toJSON — the exact leak vector), and util.inspect (how
 * Node's console prints objects, which exposes Buffer contents).
 */
function renderAllLoggedOutput(spies: ConsoleSpy[]): string {
  const rendered: string[] = [];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        rendered.push(String(arg));
        rendered.push(inspect(arg, { depth: null }));
        try {
          rendered.push(JSON.stringify(arg) ?? '');
        } catch {
          // circular structures can't stringify; other renderings still apply
        }
      }
    }
  }
  return rendered.join('\n');
}

describe('SecureWalletManager.createPrivateDrive — SEC-1 key logging', () => {
  let spies: ConsoleSpy[];
  let manager: SecureWalletManager;
  let createPrivateDriveMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spies = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );

    createPrivateDriveMock = vi.fn(async () => makePrivateDriveArFSResult());
    manager = new SecureWalletManager();
    // Inject the mocked ArDrive client and wallet directly — the wallet
    // import/decryption flow is not under test here.
    const internals = manager as unknown as { arDrive: unknown; walletJson: unknown };
    internals.arDrive = { createPrivateDrive: createPrivateDriveMock };
    internals.walletJson = { kty: 'RSA', n: 'fake-modulus' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never emits the raw drive key to any console output', async () => {
    const driveInfo = await manager.createPrivateDrive('My Private Drive', 'test-password-1');

    // Sanity: the flow ran end-to-end and console.log was actually exercised
    expect(createPrivateDriveMock).toHaveBeenCalledTimes(1);
    expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);

    const output = renderAllLoggedOutput(spies);
    expect(output).not.toContain(RAW_KEY_SENTINEL);
    // Also catch raw key bytes surfacing via util.inspect'ed Buffers
    expect(output.toLowerCase().replace(/\s+/g, '')).not.toContain(RAW_KEY_SENTINEL_HEX);

    // The drive is still created correctly
    expect(driveInfo.id).toBe(DRIVE_ID);
    expect(driveInfo.rootFolderId).toBe(ROOT_FOLDER_ID);
    expect(driveInfo.isPrivate).toBe(true);
  });

  it('still logs a useful key-free creation summary (ids and tx ids)', async () => {
    await manager.createPrivateDrive('My Private Drive', 'test-password-1');

    const output = renderAllLoggedOutput(spies);
    expect(output).toContain(DRIVE_ID);
    expect(output).toContain(ROOT_FOLDER_ID);
    expect(output).toContain(DRIVE_META_TX);
  });

  it('fixture sanity: stringifying the raw ArFSResult DOES leak the key (the old bug)', () => {
    // Proves these tests have teeth: an implementation that logs
    // JSON.stringify(result) or the raw result object would leak the
    // sentinel and fail the assertions above.
    const rawResult = makePrivateDriveArFSResult();
    expect(JSON.stringify(rawResult)).toContain(RAW_KEY_SENTINEL);
    expect(
      inspect(rawResult, { depth: null }).toLowerCase().replace(/\s+/g, '')
    ).toContain(RAW_KEY_SENTINEL_HEX);
  });
});

describe('summarizeArFSResult', () => {
  it('whitelists ids/tx ids and drops key material', () => {
    const summary = summarizeArFSResult(makePrivateDriveArFSResult());

    expect(summary.created).toEqual([
      {
        type: 'drive',
        entityId: DRIVE_ID,
        metadataTxId: DRIVE_META_TX,
        dataTxId: undefined,
        bundledIn: undefined
      },
      {
        type: 'folder',
        entityId: ROOT_FOLDER_ID,
        metadataTxId: FOLDER_META_TX,
        dataTxId: undefined,
        bundledIn: undefined
      }
    ]);
    expect(summary.tipCount).toBe(0);
    expect(summary.feeTxIds).toEqual([DRIVE_META_TX]);

    const rendered =
      JSON.stringify(summary) + inspect(summary, { depth: null });
    expect(rendered).not.toContain(RAW_KEY_SENTINEL);
    expect(rendered).not.toContain('keyData');
  });

  it('is safe on malformed input (never throws in a logging path)', () => {
    expect(summarizeArFSResult(undefined)).toEqual({ created: [], tipCount: 0, feeTxIds: [] });
    expect(summarizeArFSResult(null)).toEqual({ created: [], tipCount: 0, feeTxIds: [] });
    expect(summarizeArFSResult('nonsense')).toEqual({ created: [], tipCount: 0, feeTxIds: [] });
    expect(summarizeArFSResult({ created: [null, 42, { type: 7 }] }).created).toEqual([
      { type: undefined, entityId: undefined, metadataTxId: undefined, dataTxId: undefined, bundledIn: undefined }
    ]);
  });
});
