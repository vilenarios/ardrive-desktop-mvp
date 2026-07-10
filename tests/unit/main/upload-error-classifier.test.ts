// @vitest-environment node
//
// MONEY-17: the sync engine used to detect an out-of-funds upload rejection with
// a brittle inline `error.message.includes('insufficient')` and, for a "free"
// file, printed a misleading "should be FREE... configuration issue" line. This
// centralizes the detection in ONE helper that (a) tolerates today's plain
// string errors and (b) is structured so a future typed code (HTTP 402 / a Turbo
// error code) short-circuits ahead of the string scan. These are direct unit
// proofs of that contract.
import { describe, it, expect } from 'vitest';
import {
  classifyUploadError,
  outOfFundsMessage,
  ClassifiedUploadError,
} from '../../../src/main/upload-error-classifier';

describe('classifyUploadError (MONEY-17 payment/quota detection)', () => {
  // --- current string-shaped errors (today's reality) ----------------------
  it('classifies the current ardrive-core "insufficient" throws as recoverable funds', () => {
    for (const msg of [
      'insufficient balance',
      'Insufficient Turbo Credits. Required: 0.5, Available: 0',
      'Error: insufficient funds for upload',
      'insufficient credit',
    ]) {
      const c = classifyUploadError(new Error(msg));
      expect(c.reason).toBe('insufficient_funds');
      expect(c.recoverable).toBe(true);
    }
  });

  it('classifies future free-quota / payment-required wording as recoverable funds', () => {
    for (const msg of [
      "You've exceeded your free quota",
      'Free tier limit reached',
      'payment required',
      'quota exceeded for this wallet',
      'out of credits',
    ]) {
      expect(classifyUploadError(new Error(msg)).reason).toBe('insufficient_funds');
    }
  });

  // --- forward-compat: structured codes short-circuit the string scan -------
  it('classifies a typed error CODE as funds even when the message says nothing', () => {
    const e: any = new Error('request rejected');
    e.code = 'INSUFFICIENT_BALANCE';
    expect(classifyUploadError(e).reason).toBe('insufficient_funds');
  });

  it('classifies an HTTP 402 (numeric status) as funds', () => {
    const e: any = new Error('Payment Required');
    e.status = 402;
    expect(classifyUploadError(e).reason).toBe('insufficient_funds');

    const e2: any = new Error('nope');
    e2.statusCode = 402;
    expect(classifyUploadError(e2).reason).toBe('insufficient_funds');
  });

  it('classifies a FREE_QUOTA_EXCEEDED error name as funds', () => {
    const e: any = new Error('quota gone');
    e.name = 'FREE_QUOTA_EXCEEDED';
    expect(classifyUploadError(e).reason).toBe('insufficient_funds');
  });

  // --- non-funds failures stay terminal ------------------------------------
  it('classifies network failures as network (NOT funds, NOT recoverable-by-topup)', () => {
    for (const msg of ['network error', 'ECONNRESET', 'fetch failed', 'request timed out']) {
      const c = classifyUploadError(new Error(msg));
      expect(c.reason).toBe('network');
      expect(c.recoverable).toBe(false);
    }
  });

  it('classifies anything else as a generic terminal error', () => {
    const c = classifyUploadError(new Error('File entity creation issue'));
    expect(c.reason).toBe('error');
    expect(c.recoverable).toBe(false);
  });

  it('does not false-positive on a filename that merely contains a digit string', () => {
    // A path/filename in the message must not be read as a funds rejection.
    const c = classifyUploadError(new Error('failed to read /home/u/402-report.pdf'));
    expect(c.reason).not.toBe('insufficient_funds');
  });

  it('handles non-Error thrown values without crashing', () => {
    expect(classifyUploadError('insufficient balance').reason).toBe('insufficient_funds');
    expect(classifyUploadError(undefined).reason).toBe('error');
    expect(classifyUploadError(null).reason).toBe('error');
  });
});

describe('outOfFundsMessage (honest + actionable copy)', () => {
  it('the free-tier message is honest and actionable — NOT the old "configuration issue" line', () => {
    const msg = outOfFundsMessage(true);
    expect(msg).toContain('free storage');
    expect(msg).toContain('Top up');
    expect(msg).toMatch(/10 MB/);
    expect(msg.toLowerCase()).not.toContain('configuration issue');
    expect(msg.toLowerCase()).not.toContain('should be free');
  });

  it('the paid message points at adding credits', () => {
    const msg = outOfFundsMessage(false);
    expect(msg).toContain('Turbo Credits');
    expect(msg).toContain('Top up');
    expect(msg.toLowerCase()).not.toContain('configuration issue');
  });
});

describe('ClassifiedUploadError', () => {
  it('carries its decided reason + recoverable flag out to the record writer', () => {
    const e = new ClassifiedUploadError('out of storage', 'insufficient_funds', true);
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe('insufficient_funds');
    expect(e.recoverable).toBe(true);
    expect(e.message).toBe('out of storage');
  });
});
