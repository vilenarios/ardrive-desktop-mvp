// @vitest-environment node
//
// UX-36: the "Turbo credits low" notification's hard requirement is NO SPAM —
// it must fire exactly once when a needed upload's real cost first exceeds the
// real balance, and NOT re-fire on every subsequent queued file / poll while
// still low, until the balance recovers and drops again. evaluateLowBalance is
// the pure edge-detector SyncManager.maybeNotifyLowTurboBalance drives, so
// simulating a stream of evaluations here is a direct behavioral proof of the
// anti-spam contract without booting the sync engine.
import { describe, it, expect } from 'vitest';
import { evaluateLowBalance } from '../../../src/main/turbo-balance-alert';

// Helper: feed a sequence of (turboCost, hasSufficient) evaluations through the
// reducer exactly the way SyncManager holds the flag on its instance, and
// return how many times it asked to notify.
function runSequence(steps: Array<{ cost: number | null | undefined; sufficient: boolean }>): {
  notifyCount: number;
  finalLow: boolean;
} {
  let low = false;
  let notifyCount = 0;
  for (const step of steps) {
    const result = evaluateLowBalance(low, step.cost, step.sufficient);
    low = result.low;
    if (result.shouldNotify) notifyCount++;
  }
  return { notifyCount, finalLow: low };
}

describe('evaluateLowBalance (UX-36 low-Turbo-credits anti-spam)', () => {
  it('fires once on the ok -> low edge', () => {
    const r = evaluateLowBalance(false, 0.5, false);
    expect(r).toEqual({ shouldNotify: true, low: true });
  });

  it('does NOT re-fire while already low (the anti-spam guarantee)', () => {
    // Ten cost-bearing files queued back-to-back, all with insufficient balance:
    // exactly ONE toast, not ten.
    const { notifyCount, finalLow } = runSequence(
      Array.from({ length: 10 }, () => ({ cost: 0.5, sufficient: false }))
    );
    expect(notifyCount).toBe(1);
    expect(finalLow).toBe(true);
  });

  it('re-arms on recovery (low -> ok) and fires again on the next shortfall', () => {
    const { notifyCount, finalLow } = runSequence([
      { cost: 0.5, sufficient: false }, // ok -> low : fire #1
      { cost: 0.5, sufficient: false }, // still low : quiet
      { cost: 0.5, sufficient: true },  // low -> ok : re-arm, quiet
      { cost: 0.5, sufficient: true },  // ok       : quiet
      { cost: 0.5, sufficient: false }, // ok -> low : fire #2
      { cost: 0.5, sufficient: false }, // still low : quiet
    ]);
    expect(notifyCount).toBe(2);
    expect(finalLow).toBe(true);
  });

  it('never fires when the balance is always sufficient', () => {
    const { notifyCount, finalLow } = runSequence(
      Array.from({ length: 5 }, () => ({ cost: 0.1, sufficient: true }))
    );
    expect(notifyCount).toBe(0);
    expect(finalLow).toBe(false);
  });

  it('treats an unavailable quote (null cost) as NOT a low-balance signal', () => {
    // Turbo not initialized / quote fetch failed reports hasSufficient=false with
    // a null cost — this must never be mistaken for "low balance" (no false
    // "top up" prompt), and must leave the flag untouched.
    expect(evaluateLowBalance(false, null, false)).toEqual({ shouldNotify: false, low: false });
    expect(evaluateLowBalance(true, undefined, false)).toEqual({ shouldNotify: false, low: true });
  });

  it('an unavailable quote in the middle of a low streak does not reset the flag', () => {
    const { notifyCount } = runSequence([
      { cost: 0.5, sufficient: false }, // fire #1, low
      { cost: null, sufficient: false },  // unavailable: no change, stays low
      { cost: 0.5, sufficient: false }, // still low : quiet (no double-fire)
    ]);
    expect(notifyCount).toBe(1);
  });
});
