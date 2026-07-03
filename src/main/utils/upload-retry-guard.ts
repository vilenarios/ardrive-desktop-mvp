/**
 * Retry admission control for uploads (MONEY-2).
 *
 * The audited double-charge race: `uploads:retry` reset ANY row to pending —
 * including rows still uploading — so one file could be paid for twice.
 * Extracted as a pure function so the rule is unit-testable without Electron.
 */
export interface RetryGuardInput {
  /** Status of the upload row in the database, if the row exists. */
  dbStatus: string | undefined;
  /** Status of the in-memory queue entry, if one exists. */
  queueStatus: string | undefined;
  /** True when an in-flight cancellation for this id has not resolved yet. */
  cancellationPending: boolean;
  /**
   * True when the row carries on-chain charge evidence (dataTxId/fileId).
   * The cancelled-but-completed flow records a terminal 'failed' row WITH
   * tx ids — that file is already stored and charged; retrying it would pay
   * a second time (qa-gate FAIL reason 1).
   */
  hasChargeEvidence: boolean;
}

export interface RetryGuardResult {
  allowed: boolean;
  reason?: string;
}

export function isRetryAllowed(input: RetryGuardInput): RetryGuardResult {
  if (input.dbStatus === undefined) {
    return { allowed: false, reason: 'Upload not found' };
  }

  if (input.cancellationPending) {
    return {
      allowed: false,
      reason: 'A cancellation for this upload is still resolving — wait for its final state',
    };
  }

  // The queue is the live truth: anything queued or actively uploading must
  // never be re-queued, whatever the (possibly stale) DB row says.
  if (input.queueStatus === 'uploading' || input.queueStatus === 'pending') {
    return {
      allowed: false,
      reason: `Upload is still ${input.queueStatus === 'uploading' ? 'in flight' : 'queued'} — retrying now could pay for the same file twice`,
    };
  }

  // Only terminal failures are retryable.
  if (input.dbStatus !== 'failed') {
    return {
      allowed: false,
      reason: `Only failed uploads can be retried (status: ${input.dbStatus})`,
    };
  }

  // A failed row carrying tx ids is the cancelled-but-completed truth record:
  // the file IS on Arweave and WAS charged. Retrying pays again.
  if (input.hasChargeEvidence) {
    return {
      allowed: false,
      reason: 'Upload already completed on Arweave (stored and charged) — retrying would pay for the same file again',
    };
  }

  return { allowed: true };
}
