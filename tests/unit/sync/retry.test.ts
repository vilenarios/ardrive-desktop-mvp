// @vitest-environment node
//
// SYNC-20: transient-gateway resilience. The live UAT
// (UAT-RUN-2-LIVE-2026-07-05, defect #1/#6) showed a transient turbo-gateway
// `Status: 404` HANGING setup ("Starting sync engine…") and freezing an
// approved upload at `pending` — no retry, no timeout, no graceful failure.
// These tests pin the two guarantees the fix relies on:
//   (a) a transient failure self-heals via bounded retry+backoff, and
//   (b) a persistent failure gives up within a bounded window (it never hangs),
//       and a hung attempt is capped by a per-attempt timeout.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  retryWithBackoff,
  withTimeout,
  isTransientGatewayError,
} from '../../../src/main/sync/retry';

const gateway404 = () =>
  new Error('Request to gateway has failed: (Status: 404) Not Found');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isTransientGatewayError', () => {
  it('treats gateway 404 / network blips as transient (retryable)', () => {
    expect(isTransientGatewayError(gateway404())).toBe(true);
    expect(isTransientGatewayError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransientGatewayError(new Error('socket hang up'))).toBe(true);
    expect(isTransientGatewayError(new Error('fetch failed'))).toBe(true);
    expect(isTransientGatewayError({ status: 503, message: 'x' })).toBe(true);
  });

  it('does NOT retry genuine, non-transient errors (fail fast)', () => {
    expect(isTransientGatewayError(new Error('Invalid drive name'))).toBe(false);
    expect(isTransientGatewayError(new Error('Wallet decryption failed'))).toBe(false);
    expect(isTransientGatewayError(null)).toBe(false);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'x')).resolves.toBe('ok');
  });

  it('rejects with a clear timeout error when the promise hangs', async () => {
    vi.useFakeTimers();
    const hang = new Promise(() => {}); // never settles
    const p = withTimeout(hang, 5000, 'gateway request');
    const assertion = expect(p).rejects.toThrow(/timed out after 5000ms waiting for gateway request/i);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('propagates the underlying rejection unchanged', async () => {
    await expect(withTimeout(Promise.reject(gateway404()), 1000)).rejects.toThrow(/Status: 404/);
  });
});

describe('retryWithBackoff', () => {
  it('(a) retries a transient 404 twice then SUCCEEDS (no hang)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw gateway404();
      return 'drives';
    });

    const p = retryWithBackoff(fn, { attempts: 4, initialDelayMs: 500, maxDelayMs: 2000 });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe('drives');
    expect(fn).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });

  it('(b) gives up after the attempt budget and rejects with the last error (bounded, no hang)', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw gateway404();
    });

    const p = retryWithBackoff(fn, { attempts: 3, initialDelayMs: 500, maxDelayMs: 2000 });
    // Attach the rejection handler synchronously so the timers run against a
    // promise that already has a catcher (no unhandled-rejection noise).
    const assertion = expect(p).rejects.toThrow(/Status: 404/);
    await vi.runAllTimersAsync();
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3); // exactly the budget — never unbounded
  });

  it('caps a HUNG attempt with the per-attempt timeout, then retries and fails', async () => {
    vi.useFakeTimers();
    const fn = vi.fn(() => new Promise(() => {})); // every attempt hangs forever

    const p = retryWithBackoff(fn, { attempts: 2, initialDelayMs: 500, timeoutMs: 1000 });
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.runAllTimersAsync();
    await assertion;

    // A hung call would trap us forever without the timeout; here it is bounded
    // to exactly `attempts` tries.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-transient error — fails fast on the first attempt', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Invalid drive name');
    });

    await expect(retryWithBackoff(fn, { attempts: 4 })).rejects.toThrow('Invalid drive name');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects a custom shouldRetry predicate', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('custom-retryable');
      return 'ok';
    });

    const p = retryWithBackoff(fn, {
      attempts: 3,
      initialDelayMs: 10,
      shouldRetry: (e) => e instanceof Error && e.message === 'custom-retryable',
    });
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the first try without waiting when there is no error', async () => {
    const fn = vi.fn(async () => 42);
    await expect(retryWithBackoff(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
