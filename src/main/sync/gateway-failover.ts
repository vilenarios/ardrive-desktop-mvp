// SYNC-23: app-side ORDERED gateway failover for the APP-CONTROLLED fetch
// paths. Owner's ask: "our app should handle 404s anyway and gracefully
// continue if possible" + "try perma.online as a fallback."
//
// ─────────────────────────────────────────────────────────────────────────────
// 🚨 THE CENTRAL NUANCE — failover MUST be per-request-type (proven live
//    2026-07-05, D-012 gateway work):
//
//   DATA fetches (by-txid) → SAFE to fail over.
//     turbo-gateway.com intermittently 404-storms data that IS available (every
//     tx checked was retrievable by-id on retry — gateway serving-flakiness,
//     not missing data). perma.online serves this owner's data perfectly
//     (10/10). So an ordered failover primary → perma.online → arweave.net,
//     with a per-gateway retry, is the whole win. Any failure of gateway N ⇒
//     try gateway N+1; a 404 here means "this gateway is flaking", not "gone".
//     → use runWithGatewayFailover / fetchTxDataWithFailover.
//
//   GraphQL / ArFS-metadata queries → do NOT blindly fail over.
//     An owner-scoped ArFS entity query can return EMPTY for two very different
//     reasons that we CANNOT tell apart:
//       (1) the real answer is "no matching entities", OR
//       (2) the queried gateway simply doesn't index this owner's ArFS metadata
//           (measured live: perma.online returns 0 drives for this owner's
//           entity queries even though its DATA serving is perfect).
//     Trusting an alternate gateway's empty/404 answer would therefore be
//     silently WORSE than retrying the primary. So for metadata:
//       - retry the PRIMARY robustly (self-heals a transient blip), and
//       - fail over to an alternate ONLY when the primary is HARD-UNREACHABLE
//         (network error / 5xx) — a state where the primary gave us NO answer
//         at all, so an alternate cannot be "more wrong",
//       - NEVER fail over on an empty or 404 result (could be the real answer).
//     → use queryMetadataWithResilience.
//
// This module builds on SYNC-17 (`../gateway`: the configurable, ORDERED
// gateway list) and SYNC-20 (`./retry`: retryWithBackoff / withTimeout /
// isTransientGatewayError) — it does not reinvent retry/backoff.
//
// SCOPE: app-controlled fetch paths only. ardrive-core-js's internal
// GatewayAPI (used for private-drive data + core metadata) is a SEPARATE item
// (the core-js GatewayAPI failover) and is out of scope here.

import { GATEWAY_PROTOCOL, getGatewayHosts } from '../gateway';
import {
  retryWithBackoff,
  isTransientGatewayError,
  RetryOptions,
} from './retry';

/** Build `https://<host>` from a bare host. */
function gatewayUrlFor(host: string): string {
  return `${GATEWAY_PROTOCOL}://${host}`;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A user-cancelled (aborted) request must NEVER trigger failover — the user
 * asked to stop, so we propagate immediately instead of hammering every
 * gateway. Mirrors StreamingDownloader.isAbortError.
 */
function isAbortError(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return !!e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
}

/** Read the numeric HTTP status off common error shapes (axios / fetch-wrap). */
function statusOf(error: unknown): number | undefined {
  const e = (typeof error === 'object' && error ? error : {}) as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const raw = e.status ?? e.statusCode ?? e.response?.status;
  return typeof raw === 'number' ? raw : undefined;
}

export interface FailoverOptions {
  /**
   * Ordered gateway hosts to try. Defaults to {@link getGatewayHosts} (the
   * SYNC-17/SYNC-23 configured list: primary + fallbacks). Injectable for tests.
   */
  hosts?: string[];
  /** Retry options for the per-gateway {@link retryWithBackoff} loop. */
  retry?: RetryOptions;
  /** Human label used in logs / retry messages. */
  label?: string;
  /** Observability hook fired right before switching to the next gateway. */
  onGatewaySwitch?: (info: { from: string; to: string; error: unknown }) => void;
}

/**
 * DATA-fetch ordered failover. Tries each gateway in order; each gateway gets
 * its OWN bounded retry+backoff (SYNC-20 `retryWithBackoff`) so a momentary
 * blip self-heals before we abandon that gateway. On PERSISTENT failure of a
 * gateway we move to the next one — regardless of whether the failure looked
 * "transient", because for DATA the whole point is that the same tx that
 * 404-storms on one gateway is served fine by another (perma.online).
 *
 * If EVERY gateway fails, the LAST error is re-thrown, so the caller settles
 * within a bounded window (no hang). A user-cancel (abort) short-circuits the
 * whole thing immediately — no failover, no retries.
 *
 * `attempt` MUST be idempotent / side-effect-free w.r.t. spending or on-chain
 * writes — it is invoked up to (gateways × per-gateway attempts) times.
 */
export async function runWithGatewayFailover<T>(
  attempt: (gatewayUrl: string, gatewayHost: string) => Promise<T>,
  options: FailoverOptions = {}
): Promise<T> {
  const hosts =
    options.hosts && options.hosts.length > 0 ? options.hosts : getGatewayHosts();
  const label = options.label ?? 'gateway data fetch';

  if (hosts.length === 0) {
    throw new Error(`${label}: no gateways configured`);
  }

  let lastError: unknown;

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const gatewayUrl = gatewayUrlFor(host);
    try {
      // Per-gateway bounded retry+backoff. Defaults are modest (2 tries) because
      // we have MULTIPLE gateways to fall through to — we don't want to burn the
      // whole time budget hammering a single flaking gateway before moving on.
      return await retryWithBackoff(() => attempt(gatewayUrl, host), {
        attempts: 2,
        initialDelayMs: 400,
        maxDelayMs: 2000,
        ...options.retry,
        label: `${label} @ ${host}`,
      });
    } catch (error) {
      // Respect user cancellation — never fail over an aborted request.
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      const nextHost = hosts[i + 1];
      if (nextHost) {
        options.onGatewaySwitch?.({ from: host, to: nextHost, error });
        console.warn(
          `[gateway-failover] ${label}: "${host}" failed (${errMessage(
            error
          )}); failing over to "${nextHost}"`
        );
      } else {
        console.warn(
          `[gateway-failover] ${label}: last gateway "${host}" failed (${errMessage(
            error
          )}); giving up`
        );
      }
    }
  }

  // Every gateway failed — surface the last honest error (bounded, no hang).
  throw lastError instanceof Error
    ? lastError
    : new Error(`${label}: all gateways failed (${errMessage(lastError)})`);
}

/**
 * Fetch a transaction's raw DATA by txid with ordered gateway failover. Returns
 * the bytes plus which gateway actually served them. Uses global `fetch` by
 * default (Node 18+ / Electron); injectable for tests.
 *
 * READ-only: this never spends and is safe to retry across gateways.
 */
export async function fetchTxDataWithFailover(
  txId: string,
  options: FailoverOptions & {
    fetchImpl?: typeof fetch;
  } = {}
): Promise<{ buffer: Buffer; gatewayHost: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  return runWithGatewayFailover(
    async (gatewayUrl, gatewayHost) => {
      const response = await doFetch(`${gatewayUrl}/${txId}`);
      if (!response.ok) {
        // Carry the status so retry/isTransientGatewayError can classify it.
        throw Object.assign(
          new Error(`HTTP ${response.status}: ${response.statusText}`),
          { status: response.status }
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, gatewayHost };
    },
    { label: `data fetch ${txId}`, ...options }
  );
}

/**
 * Is this error "HARD-unreachable" — i.e. the gateway gave us NO usable answer
 * at all (a network-level failure or a 5xx)? Only these justify failing a
 * METADATA query over to an alternate gateway.
 *
 * A 404 is deliberately NOT hard-unreachable: it is an ANSWER ("not here"),
 * and for owner-scoped metadata an empty/absent answer might be the real one
 * OR an index gap — we must never trust an alternate over it. An empty 2xx body
 * likewise never reaches here (it's a successful return, not an error).
 */
export function isHardUnreachable(error: unknown): boolean {
  if (isAbortError(error)) return false;

  const status = statusOf(error);
  if (typeof status === 'number') {
    // Explicit HTTP status wins: 5xx = server gave no answer (fail over ok);
    // anything else (incl. 404) = an answer, do NOT fail over.
    return status >= 500 && status <= 599;
  }

  // No HTTP status ⇒ a transport/DNS/socket failure. Reuse SYNC-20's transient
  // classifier but EXCLUDE the 404/"not found" family, which for metadata is a
  // real (possibly index-gapped) answer, not an unreachable gateway.
  const message = errMessage(error).toLowerCase();
  if (message.includes('404') || message.includes('not found')) {
    return false;
  }
  return isTransientGatewayError(error);
}

export interface MetadataResilienceOptions {
  hosts?: string[];
  retry?: RetryOptions;
  label?: string;
}

/**
 * CONSERVATIVE metadata/GraphQL resilience (see module header for WHY this is
 * different from data failover):
 *
 *   1. Retry the PRIMARY gateway robustly (SYNC-20 backoff) so a transient blip
 *      self-heals. A NON-empty answer, an EMPTY answer, and a 404 all count as
 *      "the primary answered" — we return / re-throw them WITHOUT failing over,
 *      because an alternate's answer could be silently wrong (index gap).
 *   2. ONLY if the primary is HARD-UNREACHABLE (network error / 5xx — it gave us
 *      no answer at all) do we try the alternate gateways in order, again with
 *      bounded retry, and again only continuing to the next on hard-unreachable.
 *   3. If an alternate returns an actual answer (even empty/404), we surface it
 *      rather than trusting a further alternate.
 *
 * `runQuery` should THROW an error carrying `status` (or a network error) on a
 * transport/HTTP failure, and RESOLVE (even with an empty result) otherwise.
 */
export async function queryMetadataWithResilience<T>(
  runQuery: (gatewayUrl: string, gatewayHost: string) => Promise<T>,
  options: MetadataResilienceOptions = {}
): Promise<T> {
  const hosts =
    options.hosts && options.hosts.length > 0 ? options.hosts : getGatewayHosts();
  const label = options.label ?? 'graphql metadata query';

  if (hosts.length === 0) {
    throw new Error(`${label}: no gateways configured`);
  }

  const [primary, ...alternates] = hosts;

  // 1. Robust retry on the PRIMARY. An empty result resolves normally here and
  //    is returned as-is — we NEVER fail over on it.
  try {
    return await retryWithBackoff(
      () => runQuery(gatewayUrlFor(primary), primary),
      {
        attempts: 4,
        initialDelayMs: 500,
        maxDelayMs: 2000,
        ...options.retry,
        label: `${label} @ ${primary}`,
      }
    );
  } catch (primaryError) {
    // 2. Only a HARD-UNREACHABLE primary justifies looking at an alternate.
    //    A 404 / empty answer never reaches this branch as a failover reason.
    if (!isHardUnreachable(primaryError)) {
      throw primaryError;
    }

    let lastError: unknown = primaryError;
    for (const host of alternates) {
      console.warn(
        `[gateway-failover] ${label}: primary "${primary}" HARD-UNREACHABLE (${errMessage(
          primaryError
        )}); trying alternate "${host}" (metadata: alternate answer is only trusted, not preferred)`
      );
      try {
        return await retryWithBackoff(() => runQuery(gatewayUrlFor(host), host), {
          attempts: 2,
          initialDelayMs: 400,
          maxDelayMs: 2000,
          ...options.retry,
          label: `${label} @ ${host}`,
        });
      } catch (altError) {
        lastError = altError;
        // If the alternate actually ANSWERED (404/empty ⇒ not hard-unreachable),
        // trust it and surface it — do not keep probing further alternates.
        if (!isHardUnreachable(altError)) {
          throw altError;
        }
        // else: this alternate is also unreachable — try the next one.
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`${label}: all gateways unreachable (${errMessage(lastError)})`);
  }
}
