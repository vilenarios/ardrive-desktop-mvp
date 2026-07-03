// @vitest-environment node
//
// MONEY-2: retry admission control. The audited double-charge race was
// uploads:retry resetting ANY row to pending — including in-flight uploads.
import { describe, it, expect } from 'vitest';
import { isRetryAllowed } from '../../../src/main/utils/upload-retry-guard';

describe('isRetryAllowed (MONEY-2)', () => {
  it('allows retrying a terminally failed upload', () => {
    const result = isRetryAllowed({
      dbStatus: 'failed',
      queueStatus: undefined,
      cancellationPending: false,
      hasChargeEvidence: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('refuses an unknown upload', () => {
    const result = isRetryAllowed({
      dbStatus: undefined,
      queueStatus: undefined,
      cancellationPending: false,
      hasChargeEvidence: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not found/i);
  });

  it.each(['pending', 'uploading', 'completed'])(
    'refuses when the DB row is %s (not a terminal failure)',
    (status) => {
      const result = isRetryAllowed({
        dbStatus: status,
        queueStatus: undefined,
        cancellationPending: false,
        hasChargeEvidence: false,
      });
      expect(result.allowed).toBe(false);
    }
  );

  it('refuses when the queue still has the upload in flight, whatever the DB says', () => {
    // Stale DB row says failed, but the queue is actively uploading — this is
    // the exact double-charge scenario from audit §1.2
    const result = isRetryAllowed({
      dbStatus: 'failed',
      queueStatus: 'uploading',
      cancellationPending: false,
      hasChargeEvidence: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/twice/);
  });

  it('refuses when the upload is still queued', () => {
    const result = isRetryAllowed({
      dbStatus: 'failed',
      queueStatus: 'pending',
      cancellationPending: false,
      hasChargeEvidence: false,
    });
    expect(result.allowed).toBe(false);
  });

  it('refuses a failed row carrying charge evidence (cancelled-but-completed truth record)', () => {
    // qa-gate FAIL reason 1: this exact record passed admission and got
    // re-queued into the paid pipeline — a deterministic double charge
    const result = isRetryAllowed({
      dbStatus: 'failed',
      queueStatus: undefined,
      cancellationPending: false,
      hasChargeEvidence: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/stored and charged/);
  });

  it('refuses while a cancellation is still resolving', () => {
    const result = isRetryAllowed({
      dbStatus: 'failed',
      queueStatus: undefined,
      cancellationPending: true,
      hasChargeEvidence: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/cancellation/i);
  });
});
