/**
 * SYNC-19 — single renderer-side source of the configured Arweave gateway
 * host, finishing what SYNC-17 started.
 *
 * SYNC-17 made the *main* process resolve the gateway host (env var >
 * persisted config > default, see src/main/gateway.ts) because arweave.net
 * rate-limits (429s) some users. But the renderer's own "View on Arweave" /
 * raw-file / transaction links still hardcoded arweave.net directly, so those
 * buttons kept pointing straight at the host the rest of the app was built to
 * avoid. This module is the renderer-side equivalent of gateway.ts.
 *
 * Renderer code can't import src/main/gateway.ts (main-process only, and it
 * reads env vars / configManager directly), so this mirrors its resolution
 * by reading the same persisted value via the existing `config:get` IPC
 * call (already used by Settings.tsx and SetupSuccessScreen.tsx) and falls
 * back to the same DEFAULT_GATEWAY_HOST when config is missing, unset, or
 * unreachable.
 *
 * The resolved host is cached in-memory for the life of the renderer process
 * so link builders and click handlers across the dashboard don't each re-hit
 * IPC — call getGatewayHost() freely; only the first caller pays the
 * round-trip, everyone else gets the cached value.
 */

export const DEFAULT_GATEWAY_HOST = 'turbo-gateway.com';

let cachedHost: string | undefined;
let pendingRequest: Promise<string> | undefined;

/**
 * Resolve the configured Arweave gateway host (config:get's `gatewayHost`,
 * trimmed; falls back to DEFAULT_GATEWAY_HOST if unset/blank/unreachable).
 * Safe to call from anywhere in the renderer, including outside React
 * components — repeated calls share one in-flight IPC request and, after
 * that resolves, one cached value.
 */
export function getGatewayHost(): Promise<string> {
  if (cachedHost) {
    return Promise.resolve(cachedHost);
  }
  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
    try {
      const result = await window.electronAPI?.config?.get?.();
      const configured = result?.success ? result.data?.gatewayHost?.trim() : undefined;
      cachedHost = configured && configured.length > 0 ? configured : DEFAULT_GATEWAY_HOST;
    } catch (err) {
      console.error('Failed to load gateway host, using default:', err);
      cachedHost = DEFAULT_GATEWAY_HOST;
    } finally {
      pendingRequest = undefined;
    }
    return cachedHost;
  })();

  return pendingRequest;
}

/**
 * Drop the cached host so the next getGatewayHost() call re-reads config.
 * Settings.tsx calls this right after a successful config:set-gateway save
 * so a user who changes the gateway mid-session doesn't keep seeing links
 * built from the stale (or default) host until they restart the app.
 */
export function invalidateGatewayHostCache(): void {
  cachedHost = undefined;
  pendingRequest = undefined;
}
