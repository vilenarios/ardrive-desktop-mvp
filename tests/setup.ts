// Global Vitest setup (runs once per test file).
//
// Deliberately minimal (INFRA-2): module mocks (electron, fs/promises,
// ardrive-core-js, ...) are owned by each suite via its own vi.mock calls.
// Do NOT register global vi.mock factories here — vitest hoists them into
// every suite, silently replacing modules (e.g. a `path` mock without
// `resolve`, a `crypto` mock without `createHash`) and masking real behavior.
import { vi } from 'vitest';

// Default window.electronAPI stub for jsdom (renderer/component) suites.
// Suites assert against their own mocks by redefining window.electronAPI.
// Main-process suites run with `// @vitest-environment node` and have no window.
if (typeof window !== 'undefined') {
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
}
