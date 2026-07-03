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