// @vitest-environment node
//
// SEC-2: the `system:get-env` IPC channel must expose dev-only environment
// variables ONLY in unpackaged builds with ARDRIVE_DEV_MODE=true. These tests
// cover readDevEnv, the entire decision logic of that handler.
import { describe, it, expect } from 'vitest';
import { readDevEnv } from '../../../src/main/utils/dev-env';

const devEnv: NodeJS.ProcessEnv = {
  ARDRIVE_DEV_MODE: 'true',
  ARDRIVE_DEV_WALLET_PATH: 'C:/wallets/test-wallet.json',
  ARDRIVE_DEV_PASSWORD: 'super-secret-dev-password',
  ARDRIVE_DEV_SYNC_FOLDER: 'C:/ARDRIVE',
  PATH: '/usr/bin',
  HOME: '/home/user',
};

describe('readDevEnv (SEC-2 gate)', () => {
  describe('packaged builds', () => {
    it.each([
      'ARDRIVE_DEV_MODE',
      'ARDRIVE_DEV_WALLET_PATH',
      'ARDRIVE_DEV_PASSWORD',
      'ARDRIVE_DEV_SYNC_FOLDER',
    ])('never exposes %s, even with dev mode enabled', (key) => {
      expect(readDevEnv(key, { isPackaged: true, env: devEnv })).toBeUndefined();
    });
  });

  describe('unpackaged without dev mode', () => {
    it('exposes nothing when ARDRIVE_DEV_MODE is unset', () => {
      const env = { ...devEnv };
      delete env.ARDRIVE_DEV_MODE;

      expect(readDevEnv('ARDRIVE_DEV_PASSWORD', { isPackaged: false, env })).toBeUndefined();
      expect(readDevEnv('ARDRIVE_DEV_WALLET_PATH', { isPackaged: false, env })).toBeUndefined();
    });

    it.each(['false', 'TRUE', '1', 'yes', ''])(
      'exposes nothing when ARDRIVE_DEV_MODE is %j (must be exactly "true")',
      (mode) => {
        const env = { ...devEnv, ARDRIVE_DEV_MODE: mode };

        expect(readDevEnv('ARDRIVE_DEV_PASSWORD', { isPackaged: false, env })).toBeUndefined();
      }
    );
  });

  describe('unpackaged with dev mode enabled', () => {
    const options = { isPackaged: false, env: devEnv };

    it('returns the allowlisted dev values', () => {
      expect(readDevEnv('ARDRIVE_DEV_MODE', options)).toBe('true');
      expect(readDevEnv('ARDRIVE_DEV_WALLET_PATH', options)).toBe('C:/wallets/test-wallet.json');
      expect(readDevEnv('ARDRIVE_DEV_PASSWORD', options)).toBe('super-secret-dev-password');
      expect(readDevEnv('ARDRIVE_DEV_SYNC_FOLDER', options)).toBe('C:/ARDRIVE');
    });

    it('returns undefined for an allowlisted key that is not set', () => {
      const env: NodeJS.ProcessEnv = { ARDRIVE_DEV_MODE: 'true' };

      expect(readDevEnv('ARDRIVE_DEV_PASSWORD', { isPackaged: false, env })).toBeUndefined();
    });

    it.each(['PATH', 'HOME', 'NODE_ENV', 'ARDRIVE_SOMETHING_ELSE', ''])(
      'refuses non-allowlisted key %j even in dev mode',
      (key) => {
        expect(readDevEnv(key, options)).toBeUndefined();
      }
    );
  });
});
