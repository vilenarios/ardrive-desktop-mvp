// SYNC-20: transient-gateway resilience.
//
// Live UAT (UAT-RUN-2-LIVE-2026-07-05, defect #1/#6) showed a transient
// gateway `Status: 404` — a just-created drive/tx not yet indexed by
// turbo-gateway, or a momentary gateway blip — HANGING or hard-failing the
// setup wizard ("Starting sync engine…") and freezing an approved upload at
// `pending`, with no retry, no timeout, no graceful failure.
//
// These helpers bound every gateway-dependent read so a transient failure
// self-heals (bounded retry with exponential backoff) and — if it doesn't —
// fails within a known time window (per-attempt timeout) instead of stalling
// forever. They are READ-only concerns: only wrap idempotent fetches
// (drive-list, drive-metadata) with them, never on-chain writes.

// Node's setTimeout returns a Timeout with .unref(); the DOM's returns a number.
// Narrow structurally (no `any`) so a watchdog timer never keeps the event loop
// alive on its own.
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Reject if `promise` has not settled within `ms`. On timeout the underlying
 * work is NOT cancelled (JS can't cancel a promise) — the caller simply stops
 * awaiting it, so a hung gateway request can never trap the flow indefinitely.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  if (!(ms > 0)) {
    // A non-positive timeout means "no timeout".
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms waiting for ${label}`));
    }, ms);
    // Don't keep the Node event loop alive just for this watchdog.
    unrefTimer(timer);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface RetryOptions {
  /** Total attempts (initial try + retries). Default 4. */
  attempts?: number;
  /** Delay before the FIRST retry, in ms. Doubles each retry. Default 500. */
  initialDelayMs?: number;
  /** Upper bound for the backoff delay, in ms. Default 2000. */
  maxDelayMs?: number;
  /** Per-attempt timeout, in ms. 0/undefined disables the timeout. */
  timeoutMs?: number;
  /** Human label used in timeout/backoff messages. */
  label?: string;
  /**
   * Decide whether a given error is worth retrying. Defaults to
   * {@link isTransientGatewayError} so genuine, non-transient failures
   * (validation, "wrong password", etc.) fail fast instead of wasting retries.
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Observability hook, invoked before each backoff wait. */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

const DEFAULTS = {
  attempts: 4,
  initialDelayMs: 500,
  maxDelayMs: 2000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    unrefTimer(setTimeout(resolve, ms));
  });
}

/**
 * Heuristic: is this the kind of transient gateway/network failure that a
 * retry can plausibly recover from? Covers the observed
 * "Request to gateway has failed: (Status: 404) Not Found" (a just-created
 * entity not yet indexed) plus the usual transient network signals. A genuine
 * malformed-request / auth / validation error returns false so it fails fast.
 */
export function isTransientGatewayError(error: unknown): boolean {
  if (!error) return false;
  const errObj = (typeof error === 'object' ? error : {}) as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
      ? error.message
      : typeof errObj.message === 'string'
      ? errObj.message
      : String(error);
  const haystack = message.toLowerCase();

  // Status codes commonly returned transiently by a gateway that hasn't yet
  // indexed a fresh tx, or is momentarily overloaded.
  const status = errObj.status ?? errObj.statusCode;
  if (status === 404 || status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  return (
    haystack.includes('request to gateway has failed') ||
    haystack.includes('status: 404') ||
    haystack.includes('status 404') ||
    haystack.includes('not found') ||
    haystack.includes('timed out') ||
    haystack.includes('timeout') ||
    haystack.includes('etimedout') ||
    haystack.includes('econnreset') ||
    haystack.includes('econnrefused') ||
    haystack.includes('enotfound') ||
    haystack.includes('eai_again') ||
    haystack.includes('socket hang up') ||
    haystack.includes('network') ||
    haystack.includes('fetch failed') ||
    haystack.includes('failed to fetch') ||
    haystack.includes('gateway') ||
    haystack.includes('502') ||
    haystack.includes('503') ||
    haystack.includes('504')
  );
}

/**
 * SYNC-9: is this error specifically a NETWORK-DOWN / gateway-unreachable
 * failure — i.e. "we couldn't reach the network at all" — as opposed to a
 * gateway that answered with something unhelpful (404, an index gap) or a
 * local/validation error?
 *
 * This is the authoritative "offline" signal: when a metadata read fails with
 * one of these AFTER SYNC-20 retries (and SYNC-23 failover) are exhausted, the
 * app is effectively offline and should say so — sync paused, auto-retry on
 * reconnect — rather than fall back to a fake-healthy state. Deliberately
 * NARROWER than {@link isTransientGatewayError}: a bare "404 / not found" is an
 * ANSWER, not an unreachable network, so it does NOT read as offline here.
 */
export function isNetworkDownError(error: unknown): boolean {
  if (!error) return false;
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === 'string'
      ? ((error as { message?: string }).message as string)
      : String(error);
  const haystack = message.toLowerCase();

  return (
    haystack.includes('enotfound') ||
    haystack.includes('eai_again') ||
    haystack.includes('econnrefused') ||
    haystack.includes('econnreset') ||
    haystack.includes('etimedout') ||
    haystack.includes('enetunreach') ||
    haystack.includes('ehostunreach') ||
    haystack.includes('epipe') ||
    haystack.includes('socket hang up') ||
    haystack.includes('getaddrinfo') ||
    haystack.includes('network') ||
    haystack.includes('offline') ||
    haystack.includes('fetch failed') ||
    haystack.includes('failed to fetch') ||
    haystack.includes('timed out') ||
    haystack.includes('timeout')
  );
}

/**
 * Run `fn` with bounded retries and exponential backoff, each attempt guarded
 * by an optional per-attempt timeout. Resolves with the first success; if every
 * attempt fails (or an error isn't retryable) the LAST error is re-thrown, so
 * callers always settle within a known window instead of hanging.
 *
 * `fn` MUST be idempotent/side-effect-free w.r.t. spending or on-chain writes —
 * it is invoked up to `attempts` times.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULTS.attempts);
  const initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const timeoutMs = options.timeoutMs ?? 0;
  const label = options.label ?? 'gateway request';
  const shouldRetry = options.shouldRetry ?? isTransientGatewayError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const work = fn(attempt);
      return await (timeoutMs > 0 ? withTimeout(work, timeoutMs, label) : work);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= attempts;
      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.({ attempt, error, delayMs });
      console.warn(
        `[retry] ${label} attempt ${attempt}/${attempts} failed (${
          error instanceof Error ? error.message : String(error)
        }); retrying in ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  // Unreachable in practice (the loop either returns or throws), but keeps the
  // type checker happy and preserves the original failure if it is ever hit.
  throw lastError;
}
