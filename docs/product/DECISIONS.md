# Decision Log

Append-only log of product/engineering decisions. Reference IDs (D-###) in commits and docs. To reverse a decision, add a new entry superseding the old one — don't edit history.

Status: `PROVISIONAL` = adopted by default, awaiting explicit confirmation from Phil · `CONFIRMED` · `SUPERSEDED (by D-###)`.

---

## D-001 · Beta scope: public drives, Turbo-only, single syncing drive · PROVISIONAL · 2026-07-02

The first beta ships only what verifiably works: public drives, Turbo Credits payments, one syncing drive at a time. Private drives (PRIV-0 flag), the AR payment option, and simultaneous multi-drive sync are feature-flagged/removed from UI and become post-beta Tracks A/B/C.

**Why:** the audit found each excluded area has correctness holes (ciphertext downloads, cosmetic payment choice, facade multi-sync) that would take 2-3+ months to fix together; the included spine is ~4-6 weeks to credible.
**Reverses cheaply:** flip PRIV-0's flag / reprioritize Track A or B items into the beta phases.

## D-002 · Backlog lives in docs/product/BACKLOG.md (markdown in repo) · PROVISIONAL · 2026-07-02

Markdown with stable item IDs is the source of truth; status updates happen in the same PR as the fix. Mirror to GitHub Issues later if/when the team grows (revisit at Track E).

**Why:** versioned with code, diff-reviewable, directly readable/writable by agents without external tooling.

## D-003 · Pacing: quality-first, no hard release date · PROVISIONAL · 2026-07-02

Work the roadmap milestones in order; the beta ships when Milestones 1-4 exit criteria pass, not on a calendar date.

## D-004 · Beta distribution: private testers, unsigned builds · PROVISIONAL · 2026-07-02

Beta = unsigned builds via `build:testers` + GitHub Releases to a private group. Code signing, notarization, and public distribution are Track D (GA). Auto-update (INFRA-4) is still in beta scope so testers receive fixes.

## D-005 · One IPC response envelope: `{success, data?, error?}` · PROVISIONAL · 2026-07-02

All 91 ipcMain handlers return the same envelope (extend `safeIpcHandler` everywhere); preload types regenerated; renderer call sites swept (UX-3).

**Why:** the raw-vs-wrapped roulette caused three independent user-facing bugs (private-create "failure" after payment, wrong-password unlock "success", drive-list refresh TypeError).

## D-006 · Vitest is the only test runner · PROVISIONAL · 2026-07-02

`jest.config.js` and jest-only deps are deleted; the four orphaned suites migrate into `tests/` (INFRA-2). CI gates on `vitest --run`.

## D-007 · Deletes don't propagate in beta — disclose, don't pretend · PROVISIONAL · 2026-07-02

Local deletions are surfaced truthfully in the UI ("removed locally — still stored on Arweave"). ArFS hide/delete propagation is Track C (SYNC-5). Pending product answer on long-term semantics (ROADMAP open question 2).

## D-008 · Preload events return unsubscribe functions · PROVISIONAL · 2026-07-02

Replace `removeAllListeners`-based cleanup with per-subscription unsubscribe closures (UX-4). No component may remove listeners it didn't register.
