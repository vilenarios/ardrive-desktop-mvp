// CORE-10: bridges the persisted GraphQL page size (config-manager,
// device/app-level global config, like `gatewayHost`) into ardrive-core-js's
// process-global default (`setGqlPageSize`/`getGqlPageSize`, added in core-js
// 4.2.0 / PR #275). Every paged GraphQL walk in core-js (transaction listing
// `first:`, incremental-sync `batchSize`, snapshot listing) reads
// `getGqlPageSize()` at call time, so applying the configured value once at
// app init — and again whenever the user changes it via
// `config:set-gql-page-size` — is sufficient; no per-call plumbing needed.
//
// Some GraphQL gateways (e.g. Goldsky) reject `first:` values as large as the
// ar.io default of 1000, which would otherwise silently truncate/fail a
// user's listing or sync. This module is the desktop's opt-out for that case.
//
// Guard rail: core-js's setGqlPageSize THROWS RangeError for a non-integer or
// out-of-[1, 1000] value. A corrupt/hand-edited config.json (or a future bad
// migration) must never crash startup, so this validates/clamps BEFORE
// calling core-js and falls back to DEFAULT_GQL_PAGE_SIZE on anything
// invalid — logging instead of throwing.
import { setGqlPageSize as applyCoreGqlPageSize } from 'ardrive-core-js';
import { configManager } from './config-manager';

/** The ar.io gateway max, and core-js's own built-in default. */
export const DEFAULT_GQL_PAGE_SIZE = 1000;
export const MIN_GQL_PAGE_SIZE = 1;
export const MAX_GQL_PAGE_SIZE = 1000;

function isValidGqlPageSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_GQL_PAGE_SIZE &&
    value <= MAX_GQL_PAGE_SIZE
  );
}

/**
 * Validates/clamps `value` and applies it to core-js's process-global GraphQL
 * page size. Never throws — an invalid value (wrong type, non-integer, out of
 * [1, 1000], or even a thrown RangeError from core-js itself) falls back to
 * DEFAULT_GQL_PAGE_SIZE instead of propagating. Returns the value actually
 * applied, so callers (the IPC handler) can report what took effect.
 */
export function applyGqlPageSize(value: unknown): number {
  let resolved = DEFAULT_GQL_PAGE_SIZE;

  if (isValidGqlPageSize(value)) {
    resolved = value;
  } else if (value !== undefined) {
    // undefined just means "unset" (fresh install / never configured) — not
    // worth a warning. Anything else is a genuinely bad stored value.
    console.warn(
      `[CORE-10] Ignoring invalid configured GraphQL page size (${JSON.stringify(value)}); falling back to ${DEFAULT_GQL_PAGE_SIZE}.`
    );
  }

  try {
    applyCoreGqlPageSize(resolved);
  } catch (error) {
    console.error('[CORE-10] ardrive-core-js rejected the GraphQL page size; falling back to default:', error);
    resolved = DEFAULT_GQL_PAGE_SIZE;
    try {
      applyCoreGqlPageSize(resolved);
    } catch (fallbackError) {
      // core-js's own built-in default is already DEFAULT_GQL_PAGE_SIZE, so
      // this should be unreachable — but never let a setter failure escape.
      console.error('[CORE-10] ardrive-core-js rejected even the default GraphQL page size:', fallbackError);
    }
  }

  return resolved;
}

/**
 * Applies the currently-persisted configured GraphQL page size (or the
 * default, if unset) to ardrive-core-js. Call once at app init, and again
 * after a successful `config:set-gql-page-size`. Reading the configured value
 * is itself wrapped in try/catch — this must never throw and block the rest
 * of app initialization (IPC handler registration happens right after this
 * call in main.ts), even if config-manager is unavailable for some reason.
 */
export function applyConfiguredGqlPageSize(): number {
  let configured: unknown;
  try {
    configured = configManager.getConfiguredGqlPageSize();
  } catch (error) {
    console.error('[CORE-10] Failed to read the configured GraphQL page size; falling back to default:', error);
    configured = undefined;
  }
  return applyGqlPageSize(configured);
}
