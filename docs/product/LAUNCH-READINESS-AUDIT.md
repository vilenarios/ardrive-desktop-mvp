# Launch-Readiness Audit — Feature Coverage & Gaps (2026-07-05)

Grounded in the actual IPC surface (`preload.ts`) cross-referenced with the UAT evidence (`docs/product/UAT-*.md`). Answers two questions: what EXISTING features we never tested, and what MISSING features are essential for launch. Prioritized by launch-criticality. This is a *view* for planning; item-level status lives in BACKLOG.md.

## A. Existing features we shipped but never verified

| Feature (IPC) | Status | Priority |
|---|---|---|
| **Turbo top-up via card/Stripe** (`turbo:create-checkout-session`, `payment:open-window`) | Guards tested; the actual charge never run (owner-gated) | **P0 — revenue path** |
| **AR → Turbo Credits conversion** (`turbo:top-up-with-tokens`) | Never run live | **P0 — funding path** |
| **Seed-phrase import** (`wallet:import-from-seed-phrase`) | Untested — only JSON import (dev auto-fill) was exercised | **P0 — primary onboarding route** |
| **Profile switch / create / delete** (`profiles:switch|delete|update`) | Untested live AND known-buggy (UX-5: stale post-switch renderer, add-profile reload loop) | **P1 — beta feature, already flagged** |
| **Wallet export / backup** (`wallet:export`, `WalletExport.tsx`) | Component exists; never tested — and it's the user's ONLY recovery path | **P0 — self-custody safety** |
| **Private-drive CREATION round-trip** (create → upload → download → decrypt) | Unlock + PRIV-SIG-1 tested; full create-cycle not end-to-end | **P1** |
| **Cost-estimate accuracy** (`turbo:get-upload-costs`, `get-fiat-estimate`) | Shown pre-approval; never reconciled against an actual charge | **P1 — trust (numbers must be right)** |
| **Rename/move/copy + edit→revision LIVE execution** | Detection + fileId-reuse proven; on-chain execution env-blocked (SYNC-26 fixed in code, not live) | **P1 — needs a real-machine pass** |
| **ArNS resolution** (`arns:get-profile`) | Untested | P2 |
| **Ethereum import** (`wallet:import-ethereum-from-file`) | Likely dead (INFRA-10 removed the ETH stub) — verify + remove if so | P2 — dead-code risk |

## B. Missing features essential for launch

### Launch-critical — verify/build before ANY launch
1. **Wallet-backup enforcement in new-wallet onboarding.** Export EXISTS, but for a self-custody wallet the `wallet:create-new` flow must FORCE or hard-prompt a seed backup ("we cannot recover this — write it down"). If it doesn't, users *will* lose everything with no recourse. **Verify the create-new path; if backup isn't mandatory, that's a launch blocker.**
2. **Paid rails complete + tested** — top-up + AR→Credits + the "you need credits to upload" new-user funnel. This is both revenue and the thing that makes a fresh account usable.

### GA-essential — deferrable for the closed tester beta, blocker for public launch
3. **Auto-update** (INFRA-4) — MISSING. Fine for a manual-update closed beta; a public launch can't ship security fixes to users who won't manually update.
4. **Crash / error reporting** (INFRA-5) — MISSING. No field-crash visibility. Need it (or an explicit decision) before public.
5. **Resumable / robust large uploads** — MISSING. A failed 90 MB upload restarts from 0 — wasted money on a paid-permanence product. Assess chunked-resume (SYNC-20 covers gateway-transient retry, not resume).

### High-value — not blockers, strong for the launch story
6. **ArNS name assignment** — today ArNS is read-only (`get-profile`); you can't give a drive or a deployed site a `yourname.ar` name. Pairs directly with manifest deploy (a raw txid URL isn't shareable). Big value-add.
7. **Drag-and-drop upload** — MISSING; modern-app expectation.
8. **File search** — MISSING; needed once a drive is large.
9. **Conflict resolution** — deferred (KNOWN-ISSUES); last-write + honesty is OK for beta, needed eventually.
10. **Files-on-demand / selective sync** (FEAT-7, captured) — for large drives.

## Top 3 risks to surface
1. **Wallet backup on new-wallet onboarding** (self-custody safety — potential launch blocker). VERIFY FIRST.
2. **Paid rails untested** (revenue + funding — owner-gated, must happen).
3. **Profile switching buggy + untested** (UX-5) — if multi-profile ships in beta.
