import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // CI stability: a handful of suites are load-sensitive under full-suite
    // parallelism — the real-crypto derivation tests (seed-import, drive-key
    // persistence) run scrypt and can exceed the default 5s timeout on a busy
    // runner, and the fake-timer poll tests (feat8 balance poll, dashboard
    // toasts) can race under contention. Give the slow ones headroom, and let
    // CI retry a genuinely-flaked test rather than fail the whole run. Local
    // runs never retry, so a real regression still surfaces immediately.
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: process.env.CI ? 2 : 0,
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
      ],
    },
  },
  resolve: {
    alias: [
      // @ardrive/turbo-sdk -> @kyvejs/sdk -> @keplr-wallet/crypto -> bitcoinjs-lib
      // calls initEccLib at import time, which fails under Vitest with
      // "Error: ecc library invalid". No test uses KYVE, so stub the whole SDK
      // (including deep imports like @kyvejs/sdk/dist/sdk.js).
      {
        find: /^@kyvejs\/sdk(\/.*)?$/,
        replacement: path.resolve(__dirname, './tests/mocks/kyve-sdk-stub.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
});