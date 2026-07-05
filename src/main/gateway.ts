import { configManager } from './config-manager';

/**
 * SYNC-17 — single source of truth for the Arweave gateway host.
 *
 * The app previously hardcoded `arweave.net` in ~12 places (Arweave.init hosts,
 * GraphQL/data fetch URLs, avatar URLs). arweave.net rate-limits (429s) some
 * environments perpetually, which degraded/broke wallet ops, balance reads and
 * downloads for those users. Per D-012 the gateway now defaults to
 * turbo-gateway.com and is user-overridable.
 *
 * Resolution order (highest priority first):
 *   1. ARDRIVE_GATEWAY_HOST env var  (dev / emergency override, no restart of config needed)
 *   2. the persisted global config setting (`gatewayHost`, set via config:set-gateway)
 *   3. DEFAULT_GATEWAY_HOST (turbo-gateway.com)
 *
 * This module deliberately imports NOTHING from arweave / ardrive-core-js so it
 * stays importable from any test environment (the core-js/turbo-sdk import chain
 * fails its ecc self-check under jsdom). Call sites keep their own `Arweave.init`
 * and simply feed it `getGatewayConfig(...)`.
 */

export const DEFAULT_GATEWAY_HOST = 'turbo-gateway.com';
export const GATEWAY_PROTOCOL = 'https';
export const GATEWAY_PORT = 443;

/**
 * SYNC-23 — ordered DATA-fetch fallback gateways, tried after the primary
 * ({@link getGatewayHost}) when a by-txid data fetch persistently fails.
 *
 * Order rationale (measured live 2026-07-05, D-012 gateway work):
 *   - turbo-gateway.com is the primary but intermittently 404-STORMS data that
 *     IS retrievable (every tx checked was fetchable by-id on retry — gateway
 *     serving-flakiness, not missing data).
 *   - perma.online serves this owner's DATA perfectly (10/10), so it is the
 *     first fallback for by-txid data fetches.
 *   - arweave.net is kept LAST as a final resort because it perpetually 429s
 *     the primary tester's environment (the reason SYNC-17 moved off it).
 *
 * IMPORTANT: this list is for DATA fetches ONLY. Do NOT reuse it to fail over
 * GraphQL / ArFS-metadata queries — perma.online does NOT index this owner's
 * ArFS metadata (returns EMPTY for owner-scoped entity queries), so failing a
 * metadata query over to it returns a WRONG (empty) answer. See
 * `src/main/sync/gateway-failover.ts` for the per-request-type reasoning.
 */
export const DEFAULT_GATEWAY_FALLBACKS = ['perma.online', 'arweave.net'];

/**
 * The resolved gateway host (env > config > default). Never empty.
 */
export function getGatewayHost(): string {
  const envHost = process.env.ARDRIVE_GATEWAY_HOST?.trim();
  if (envHost) {
    return envHost;
  }

  const configured = configManager.getGatewayHost();
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  return DEFAULT_GATEWAY_HOST;
}

export interface ArweaveGatewayConfig {
  host: string;
  port: number;
  protocol: string;
}

/**
 * Build an `Arweave.init` config object pointed at the resolved gateway.
 * Extra per-call options (timeout, logging, ...) are merged on top so each
 * existing call site preserves its own behavior — only the host changes.
 */
export function getGatewayConfig<T extends object = Record<string, never>>(
  overrides?: T
): ArweaveGatewayConfig & T {
  return {
    host: getGatewayHost(),
    port: GATEWAY_PORT,
    protocol: GATEWAY_PROTOCOL,
    ...(overrides ?? ({} as T))
  } as ArweaveGatewayConfig & T;
}

/**
 * `https://<gateway-host>` — for building GraphQL / data / avatar URLs.
 */
export function getGatewayUrl(): string {
  return `${GATEWAY_PROTOCOL}://${getGatewayHost()}`;
}

/**
 * SYNC-23 — the ORDERED gateway list for DATA-fetch failover: the resolved
 * primary ({@link getGatewayHost}) first, then the fallbacks (persisted config
 * `gatewayFallbacks` if set, else {@link DEFAULT_GATEWAY_FALLBACKS}). Empty /
 * whitespace entries are dropped and duplicates are de-duped while preserving
 * order, so the primary is never retried twice and a user who sets their
 * primary to a value already in the fallback list gets a sane, non-repeating
 * order. Never empty (always at least the primary).
 *
 * This is the source of truth for `fetchDataWithFailover` (data fetches only).
 * Metadata/GraphQL callers must NOT use this list to fail over — see the module
 * header of `src/main/sync/gateway-failover.ts`.
 */
export function getGatewayHosts(): string[] {
  const primary = getGatewayHost();

  const configuredFallbacks = configManager.getGatewayFallbacks();
  const fallbacks =
    configuredFallbacks && configuredFallbacks.length > 0
      ? configuredFallbacks
      : DEFAULT_GATEWAY_FALLBACKS;

  const ordered = [primary, ...fallbacks]
    .map((h) => (typeof h === 'string' ? h.trim() : ''))
    .filter((h) => h.length > 0);

  // De-dupe, preserving first-seen order (primary wins).
  return Array.from(new Set(ordered));
}
