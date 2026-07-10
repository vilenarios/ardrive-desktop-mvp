// MONEY-17: single, centralized classification of an upload rejection.
//
// The sync engine used to detect an out-of-funds rejection by a brittle inline
// string-match on "insufficient" (sync-manager.ts:3495) and, for a supposedly
// FREE file, printed a MISLEADING "should be FREE... may be a configuration
// issue" message. That was correct only under the old per-file free model
// (≤105 KiB = always free). Turbo's free tier is shifting to a CUMULATIVE quota
// (~10 MB/wallet+IP, then 10 MB/month after a $5 top-up), so a "free" small file
// CAN legitimately be rejected once the quota is spent — that is a normal
// out-of-funds condition, not a glitch.
//
// This module owns the detection so it lives in ONE place and is unit-testable
// without the sync engine. It is deliberately tolerant of TODAY's string-shaped
// errors (ardrive-core / turbo-sdk currently throw plain messages) while being
// structured so a FUTURE typed error code (an HTTP 402 / a Turbo error code)
// drops in cleanly and short-circuits ahead of the string scan.
//
// It never spends, never logs secrets — it only inspects an error's shape.

import { UploadErrorReason } from '../types';

export type { UploadErrorReason };

export interface UploadErrorClassification {
  reason: UploadErrorReason;
  /** True only for a funds/quota rejection — the caller may auto-resume it once funds arrive. */
  recoverable: boolean;
}

// Structured codes we recognize now, or expect Turbo/ardrive-core to expose
// later. Matched case-insensitively against error.code / .name / .status /
// .statusCode BEFORE any message scan, so a typed code is authoritative the
// moment upstream ships one (forward-compatible with the quota model).
const FUNDS_ERROR_CODES = new Set([
  '402',
  'payment_required',
  'paymentrequired',
  'insufficient_balance',
  'insufficientbalance',
  'insufficient_funds',
  'insufficientfunds',
  'free_quota_exceeded',
  'freequotaexceeded',
  'quota_exceeded',
  'quotaexceeded',
]);

// Substrings that identify a payment/quota rejection in a message string. Kept
// targeted (no over-broad token like "not enough" alone) so a filename or path
// embedded in the message can't false-positive.
const FUNDS_MESSAGE_PATTERNS = [
  'insufficient balance',
  'insufficient turbo',
  'insufficient credit',
  'insufficient fund',
  'insufficient', // covers the current ardrive-core/turbo "insufficient ..." throws
  'payment required',
  'free quota',
  'free tier',
  'free allowance',
  'out of credit',
  'quota exceeded',
  'quota exhausted',
  'exceeded your free',
];

const NETWORK_MESSAGE_PATTERNS = [
  'network',
  'econnrefused',
  'econnreset',
  'enotfound',
  'etimedout',
  'timed out',
  'timeout',
  'fetch failed',
  'socket hang up',
];

function readCodeLike(error: Record<string, unknown>, key: string): string | undefined {
  const v = error[key];
  if (typeof v === 'string' && v.length > 0) return v.toLowerCase();
  if (typeof v === 'number') return String(v);
  return undefined;
}

/**
 * Classify an unknown thrown value from a Turbo/ardrive-core upload. Structured
 * code first (future-proof), then a targeted message scan (today's reality).
 */
export function classifyUploadError(error: unknown): UploadErrorClassification {
  // 1) Structured code — authoritative if present.
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    for (const key of ['code', 'name', 'status', 'statusCode']) {
      const code = readCodeLike(e, key);
      if (code && FUNDS_ERROR_CODES.has(code)) {
        return { reason: 'insufficient_funds', recoverable: true };
      }
    }
  }

  // 2) Message scan — tolerate the current string-shaped errors.
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();

  if (FUNDS_MESSAGE_PATTERNS.some((p) => message.includes(p))) {
    return { reason: 'insufficient_funds', recoverable: true };
  }
  if (NETWORK_MESSAGE_PATTERNS.some((p) => message.includes(p))) {
    return { reason: 'network', recoverable: false };
  }
  return { reason: 'error', recoverable: false };
}

/**
 * Honest, actionable copy for an out-of-funds/quota rejection — replaces the old
 * "should be FREE... may be a configuration issue" line. For a free-tier file
 * it names the free quota and the $5/10 MB top-up; for a paid file it points at
 * adding credits. Both end on the same action so the top-up CTA reads true.
 */
export function outOfFundsMessage(isFreeTier: boolean): string {
  return isFreeTier
    ? "You've used your free storage. Top up $5 to get 10 MB free every month, or add credits to continue."
    : 'Not enough Turbo Credits to upload this file. Top up to keep uploading.';
}

/**
 * A thrown upload failure that carries its already-decided classification, so
 * the upload-record writer (SyncManager.uploadFile's catch) can persist the
 * recoverable `insufficient_funds` reason without re-deriving it from the
 * (already user-facing) message string.
 */
export class ClassifiedUploadError extends Error {
  readonly reason: UploadErrorReason;
  readonly recoverable: boolean;
  constructor(message: string, reason: UploadErrorReason, recoverable: boolean) {
    super(message);
    this.name = 'ClassifiedUploadError';
    this.reason = reason;
    this.recoverable = recoverable;
  }
}
