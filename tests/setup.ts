import { beforeAll, vi } from 'vitest';

// Mock electron modules
beforeAll(() => {
  // Mock electron
  vi.mock('electron', () => ({
    app: {
      getPath: vi.fn(() => '/mock/app/path'),
      getName: vi.fn(() => 'test-app'),
      getVersion: vi.fn(() => '1.0.0'),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    BrowserWindow: vi.fn(),
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
  }));

  // Mock Node.js modules
  vi.mock('fs/promises', () => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    open: vi.fn(() => ({
      sync: vi.fn(),
      close: vi.fn(),
    })),
    rename: vi.fn(),
  }));

  vi.mock('path', () => ({
    join: vi.fn((...args) => args.join('/')),
    dirname: vi.fn((p) => p.split('/').slice(0, -1).join('/')),
    basename: vi.fn((p) => p.split('/').pop()),
    extname: vi.fn((p) => {
      const parts = p.split('.');
      return parts.length > 1 ? `.${parts.pop()}` : '';
    }),
  }));

  vi.mock('os', () => ({
    tmpdir: vi.fn(() => '/tmp'),
    hostname: vi.fn(() => 'test-host'),
    platform: vi.fn(() => 'test-platform'),
    arch: vi.fn(() => 'test-arch'),
  }));

  vi.mock('crypto', () => ({
    randomBytes: vi.fn(() => Buffer.from('random-bytes')),
    scrypt: vi.fn((password, salt, keylen, options, callback) => {
      callback(null, Buffer.from('derived-key'));
    }),
    createCipheriv: vi.fn(() => ({
      update: vi.fn(() => Buffer.from('encrypted')),
      final: vi.fn(() => Buffer.from('final')),
      getAuthTag: vi.fn(() => Buffer.from('auth-tag')),
    })),
    createDecipheriv: vi.fn(() => ({
      setAuthTag: vi.fn(),
      update: vi.fn(() => Buffer.from('decrypted')),
      final: vi.fn(() => Buffer.from('final')),
    })),
  }));

  // Mock ardrive-core-js
  vi.mock('ardrive-core-js', () => ({
    arDriveFactory: vi.fn(() => ({
      getAllDrivesForAddress: vi.fn().mockResolvedValue([]),
      createPublicDrive: vi.fn().mockResolvedValue({
        created: [
          { entityId: 'drive-id' },
          { entityId: 'folder-id' }
        ]
      }),
    })),
    readJWKFile: vi.fn(() => ({ test: 'wallet' })),
    ArweaveAddress: vi.fn((addr) => ({ address: addr })),
    WalletDAO: vi.fn(() => ({
      generateJWKWallet: vi.fn().mockResolvedValue({
        getPrivateKey: vi.fn(() => ({ kty: 'RSA', n: 'test' }))
      })
    })),
    SeedPhrase: vi.fn((phrase) => ({ phrase })),
  }));

  // Mock bip39
  vi.mock('bip39', () => ({
    generateMnemonic: vi.fn(() => 'test mnemonic phrase with twelve words here for testing purposes'),
    validateMnemonic: vi.fn(() => true),
  }));

  // Mock crypto-js
  vi.mock('crypto-js', () => ({
    AES: {
      encrypt: vi.fn(() => ({ toString: () => 'encrypted-data' })),
      decrypt: vi.fn(() => ({ toString: () => 'decrypted-data' })),
    },
    SHA256: vi.fn(() => ({ toString: () => 'hashed-data' })),
    enc: {
      Utf8: 'utf8',
    },
  }));

  // Mock window object for React tests
  Object.defineProperty(window, 'electronAPI', {
    value: {
      wallet: {
        import: vi.fn(),
        createNew: vi.fn(),
        importFromSeedPhrase: vi.fn(),
        getInfo: vi.fn(),
        ensureLoaded: vi.fn(),
        clearStored: vi.fn(),
        export: vi.fn(),
      },
      profiles: {
        list: vi.fn(),
        getActive: vi.fn(),
        switch: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      config: {
        get: vi.fn(),
        update: vi.fn(),
      },
      dialog: {
        selectWallet: vi.fn(),
        selectFolder: vi.fn(),
      },
    },
    writable: true,
  });
});