# Launch-Readiness Audit — Feature Coverage & Gaps (2026-07-05)

Grounded in the actual IPC surface (`preload.ts`) cross-referenced with the UAT evidence (`docs/product/UAT-*.md`). Answers two questions: what EXISTING features we never tested, and what MISSING features are essential for launch. Prioritized by launch-criticality. This is a *view* for planning; item-level status lives in BACKLOG.md.

## A. Existing features we shipped but never verified

| Feature (IPC) | Status | Priority |
|---|---|---|
| **Turbo top-up via card/Stripe** (`turbo:create-checkout-session`, `payment:open-window`) | Guards tested; the actual charge never run (owner-gated) | **P0 — revenue path** |
| **AR → Turbo Credits conversion** (`turbo:top-up-with-tokens`) | Never run live | **P0 — funding path** |
| **Seed-phrase import** (`wallet:import-from-seed-phrase`) | VERIFIED + TESTED 2026-07-06 (branch feat/wallet-safety) — golden test drives the REAL ardrive-core derivation: a known 12-word BIP-39 test mnemonic derives the EXACT expected Arweave address (`l55sI4s…`), deterministically, through the production import path. Invalid phrase → fails closed (`Invalid seed phrase`), 24-word phrase → fails closed (`…exactly 12 words`); neither leaks the phrase to logs/errors, neither persists anything. NOTE: ardrive-core-js derives Arweave wallets from 12-word phrases ONLY — a 24-word phrase can never produce an Arweave wallet, so the "12 or 24 words" onboarding copy (DESIGN-8) is aspirational; 24-word import fails closed safely. | **P0 — primary onboarding route** |
| **Profile switch / create / delete** (`profiles:switch|delete|update`) | Untested live AND known-buggy (UX-5: stale post-switch renderer, add-profile reload loop) | **P1 — beta feature, already flagged** |
| **Wallet export / backup** (`wallet:export`, `WalletExport.tsx`) | VERIFIED + TESTED 2026-07-06 (branch feat/wallet-safety) — export REQUIRES the correct password (wrong password returns `{success:false}` with no `data`); the secret is returned IN-MEMORY only (the export payload the renderer shows behind SEC-12's reveal gate) and escapes nowhere else: no temp file under `os.tmpdir()`, and no key material in any console channel or the audit log (which records only a redacted address + export type). SEC-5/SEC-12 pattern holds. | **P0 — self-custody safety** |
| **Private-drive CREATION round-trip** (create → upload → download → decrypt) | Unlock + PRIV-SIG-1 tested; full create-cycle not end-to-end | **P1** |
| **Cost-estimate accuracy** (`turbo:get-upload-costs`, `get-fiat-estimate`) | Shown pre-approval; never reconciled against an actual charge | **P1 — trust (numbers must be right)** |
| **Rename/move/copy + edit→revision LIVE execution** | Detection + fileId-reuse proven; on-chain execution env-blocked (SYNC-26 fixed in code, not live) | **P1 — needs a real-machine pass** |
| **ArNS resolution** (`arns:get-profile`) | Untested | P2 |
| **Ethereum import** (`wallet:import-ethereum-from-file`) | Likely dead (INFRA-10 removed the ETH stub) — verify + remove if so | P2 — dead-code risk |

## B. Missing features essential for launch

### Launch-critical — verify/build before ANY launch
1. **Wallet-backup enforcement in new-wallet onboarding.** ✅ VERIFIED 2026-07-06 (branch feat/wallet-safety) — backup IS mandatory. The `wallet:create-new` flow (a) generates the account IN MEMORY ONLY (`generateNewWallet`, UX-20) and defers all persistence to `completeGeneratedWalletSetup`, so nothing is committed and the dashboard is unreachable until confirmation; (b) SHOWS the recovery phrase (revealable) + address with honest, unambiguous copy ("This is the ONLY way to recover your account. If you lose this phrase, you lose access to your files forever."); (c) BLOCKS the finalize button (`disabled` until the "I have written down…" checkbox is checked), and the finalize handler now also hard-returns unless confirmed (defense-in-depth against a future refactor). No bypass found. Covered by `tests/unit/components/wallet-backup-gate-sec.test.tsx` + `tests/unit/main/wallet-create-defer-persist-ux20.test.ts`. **No longer a launch blocker.**
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
1. ~~**Wallet backup on new-wallet onboarding**~~ ✅ RESOLVED/VERIFIED 2026-07-06 (feat/wallet-safety) — backup is mandatory (deferred persistence + disabled-until-confirmed finalize + handler guard); seed-import derivation and export no-leak also verified/tested. Wallet-safety essentials are launch-ready. See rows above.
2. **Paid rails untested** (revenue + funding — owner-gated, must happen).
3. **Profile switching buggy + untested** (UX-5) — if multi-profile ships in beta.
