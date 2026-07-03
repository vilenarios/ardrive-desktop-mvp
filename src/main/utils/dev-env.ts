/**
 * Gated access to development-only environment variables (SEC-2).
 *
 * The `system:get-env` IPC channel exists solely so the renderer can auto-fill
 * onboarding forms during development (ARDRIVE_DEV_WALLET_PATH,
 * ARDRIVE_DEV_PASSWORD, ...). Those values are secrets-adjacent, so they must
 * never be readable in a packaged build, and never unless dev mode is
 * explicitly enabled via ARDRIVE_DEV_MODE=true.
 */

const ALLOWED_DEV_ENV_KEYS = [
  'ARDRIVE_DEV_MODE',
  'ARDRIVE_DEV_WALLET_PATH',
  'ARDRIVE_DEV_PASSWORD',
  'ARDRIVE_DEV_SYNC_FOLDER',
] as const;

export interface DevEnvOptions {
  /** electron `app.isPackaged` — true for any installed/production build. */
  isPackaged: boolean;
  /** The process environment to read from (injected for testability). */
  env: NodeJS.ProcessEnv;
}

/**
 * Returns the value of a development-only environment variable, or undefined
 * when any gate fails. Fails closed:
 *  - packaged builds expose nothing, ever;
 *  - ARDRIVE_DEV_MODE must be exactly 'true';
 *  - only the fixed allowlist of ARDRIVE_DEV_* keys is readable.
 */
export function readDevEnv(key: string, options: DevEnvOptions): string | undefined {
  if (options.isPackaged) {
    return undefined;
  }
  if (options.env.ARDRIVE_DEV_MODE !== 'true') {
    return undefined;
  }
  if (!(ALLOWED_DEV_ENV_KEYS as readonly string[]).includes(key)) {
    return undefined;
  }
  return options.env[key];
}
