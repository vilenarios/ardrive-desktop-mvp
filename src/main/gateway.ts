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
