// UX-36: pure edge-detection for the "Turbo credits low" notification, kept
// out of sync-manager.ts so the anti-spam contract is unit-testable without
// booting the sync engine.
//
// The paid-product parity feature (OneDrive/Dropbox quota warnings) is a single
// actionable "top up to keep uploading" toast. The hard requirement is NO SPAM:
// it must fire exactly once when a needed upload's real cost first exceeds the
// real balance (ok -> low), and stay silent on every subsequent low evaluation
// until the balance recovers (low -> ok), which re-arms it. This reducer owns
// that transition; the caller (SyncManager.maybeNotifyLowTurboBalance) holds the
// `low` flag on the instance and shows the toast when `shouldNotify` is true.
//
// Honest-signal rule: `estimatedTurboCost === null/undefined` means the Turbo
// quote is UNAVAILABLE (Turbo not initialized / quote fetch failed) — that is
// NOT a low balance, so we never fire on it (a false "top up" prompt would be
// worse than silence). We never fabricate a balance or cost.

export interface LowBalanceEvaluation {
  /** Whether the caller should show the low-balance toast now (ok -> low edge). */
  shouldNotify: boolean;
  /** The next value of the caller's "currently low" flag. */
  low: boolean;
}

export function evaluateLowBalance(
  currentlyLow: boolean,
  estimatedTurboCost: number | null | undefined,
  hasSufficientTurboBalance: boolean
): LowBalanceEvaluation {
  // No real quote -> not a balance signal; leave the flag untouched.
  if (estimatedTurboCost === null || estimatedTurboCost === undefined) {
    return { shouldNotify: false, low: currentlyLow };
  }
  if (!hasSufficientTurboBalance) {
    // Fire only on the ok -> low edge; stay quiet while already low.
    return { shouldNotify: !currentlyLow, low: true };
  }
  // Balance covers the upload -> re-arm (low -> ok), never notify.
  return { shouldNotify: false, low: false };
}
