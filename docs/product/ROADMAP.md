# ArDrive Desktop — Roadmap

Working plan from the [2026-07-02 audit](./AUDIT-2026-07-02.md). Work items live in [BACKLOG.md](./BACKLOG.md); decisions in [DECISIONS.md](./DECISIONS.md). Phases 1–3 are sequential-ish; Phase 4 parallelizes. Per D-003: milestones are ordered quality gates with exit criteria — **no dates, no estimates**; we loop until each gate passes.

## Beta scope (D-010, confirmed)

**Public AND private drives · Turbo-only payments · one syncing drive at a time.**

Private drives are in (Phil, 2026-07-03) — their correctness work (PRIV-1..7) sits on the critical path. The AR-payment picker comes out (it was cosmetic; MONEY-1), and simultaneous multi-drive sync stays post-beta with truthful single-drive UI (UX-15). Upload cap is 2 GiB with streaming prerequisites (D-014); local deletes propagate as ArFS hides (D-011).

## Milestone 1 — "Safe to hand to a tester" (Phase 1) — ✅ CODE COMPLETE 2026-07-03

All 11 items done and merged (SEC-1/2/3/12, MONEY-1/3/4/5, UX-1/2 via full QA gates; INFRA-1 committed). Exit criteria met at verified-component level: every claim is backed by adversarially-gated behavioral tests (~230 suite); `git grep MOCK_AR_PRICE` clean. Caveat 1 (CI dispatch) DISCHARGED 2026-07-03: run 28665170914 fully green on clean windows-latest incl. tests + installer artifact. ONE remaining caveat: a live-Electron manual smoke UAT (import wallet → sync → approve) on a real display before tester handoff.

Nothing in the build lies to users or leaks secrets:

- SEC-1 key logging · SEC-2 env exposure · SEC-3 sync-survives-logout · SEC-12 export mask
- MONEY-1 remove cosmetic AR choice · MONEY-3 fake USD pricing · MONEY-4 fake Auto Top-Up · MONEY-5 no-op conflict modal
- UX-1 toasts actually render · UX-2 Settings folder picker
- INFRA-1 CI can install (lockfile + workflow committed)

Exit criteria: a tester can import a wallet and sync a drive with Turbo, and every visible control either works or doesn't exist. `git grep MOCK_AR_PRICE` returns nothing.

## Milestone 2 — "Sync you can trust" (Phase 2)

The engine's core promises hold, for public and private drives alike:

- SYNC-1 edits re-upload · SYNC-2 failed downloads marked failed · SYNC-3 crash recovery · SYNC-4 stop/start lifecycle · SYNC-7 folder/drive single source of truth
- SYNC-5 deletes propagate as ArFS hide (D-011, Dropbox-smooth) · SYNC-6 2 GiB upload cap, surfaced (D-014) · SYNC-10 streaming hashing (prereq for 2 GiB) · SYNC-9 offline visibility · SYNC-11 watcher hygiene · SYNC-13 eviction feedback loop
- PRIV-1 private download decryption · PRIV-2 trial-decrypt password verification · PRIV-3 private-create flow · PRIV-5 locked-drive sync states · PRIV-6 private move/rename/hide paths
- MONEY-2 cancel/retry safety · MONEY-6 approval semantics · MONEY-9 queue serialization · MONEY-10 upload-time revalidation

Exit criteria (UAT on real public AND private drives): create/edit/rename/move/delete files and folders; kill the app mid-transfer; go offline mid-sync; switch drives; lock/unlock a private drive — after each, DB state, disk state, and UI agree; deleted files show as hidden on ArFS; private files round-trip to plaintext; no money spent that the user didn't approve.

## Milestone 3 — "Feels finished" (Phase 3)

- UX-3 unified IPC envelope · UX-4 listener redesign · UX-5 real profile switching · UX-6 auto-login or no keychain storage (with SEC-4) · UX-7 fail-safe boot routing · UX-8 progress-modal error state · UX-10 copy-link fix · UX-15 truthful single-drive UI · UX-17 generated avatar + nickname (D-015)
- PRIV-4 drive-key persistence (fixed serialization + session restore + settings UI) · PRIV-7 unlock password validation
- SEC-5 no plaintext JWK temp files · MONEY-7 payment window hardening

Exit criteria: full manual UI walkthrough (every screen, every button) with zero silent failures; unlock-remember-restart round-trip works; envelope enforced by types.

## Milestone 4 — "Sustainable to iterate" (Phase 4, parallel with 2–3)

- INFRA-2 tests resurrected · INFRA-3 CI gating · INFRA-4 auto-update · INFRA-5 telemetry · INFRA-7 DB migrations · INFRA-9 test-money strategy · INFRA-10 IPC reconciliation · INFRA-12 E2E/UI test harness (D-006 amendment)
- SEC-6 Electron upgrade · SEC-7 shell hardening

Exit criteria: green gated CI on every PR (unit + integration + UI smoke); a tester on build N gets offered N+1; a crash in the field produces a readable report.

## → Beta release

Ship via `build:testers` + GitHub Releases (unsigned, D-004) to Phil's Discord tester group (D-017) with a KNOWN-ISSUES list generated from `deferred` backlog items. **Released only on Phil's explicit final approval** (D-009).

---

## Design work stream (parallel, cross-cutting — D-023)

Runs alongside functional work, not after it. `designer` agent; source of truth = ardrive-web `ardrive_ui` + public site. Sequence: DESIGN-1 (extract the design system → DESIGN-SYSTEM.md) → DESIGN-2 (desktop token/theme foundation) → DESIGN-3..7 (per-surface restyle, parallel). Foundation (1/2) targeted for beta so the tester build looks like ArDrive; per-surface polish continues to GA. Verified through the loop with screenshot evidence (INFRA-12) + Phil's aesthetic sign-off.

## Post-beta tracks

**Track B — Wallet & payment evolution (D-013):** FEAT-1 Solana-default wallet onboarding with Turbo payments (open technical question: ArFS private-drive key derivation for non-Arweave wallets — likely upstream ardrive-core-js work). FEAT-2 "Advanced mode": Arweave wallet + AR tokens + self-bundled uploads (lite bundler). Ethereum stub deleted (INFRA-10).

**Track C — Sync depth (desktop) + CORE upstream (ardrive-core-js, D-018):** true multi-drive engine (SYNC-14), remote-change polling (SYNC-8, wants CORE-2), conflict detection + resolution, download hash verification (SYNC-12), full Wayfinder top-staked gateway routing (SYNC-15, D-012 — beta gets the no-single-gateway minimum; **metadata migration blocked on CORE-1** owner-scoped GQL), perf/indexing beyond the SYNC-10 baseline. Upstream: CORE-1 owner-scoped queries, CORE-2 incremental sync, CORE-3 ArFS snapshot consumption — the heavy core-js update wave Phil called out.

**Track D — GA hardening:** code signing + notarization, secure-logger adoption (SEC-8) + in-app sanitized problem reports (UX-16, D-017), shell confinement (SEC-9), keytar→safeStorage (SEC-10), rate limiting (SEC-11), seed-confirm realness (SEC-13), UX-9/11/12/13/14 polish batch, repo hygiene (INFRA-6/8/11), MONEY-8.

**Track E — Sibling-repo convergence (D-016):** extend this agentic product process to ardrive-web; shared ArFS interop test vectors (desktop ↔ web round-trips); shared patterns across ardrive-core-js / turbo-sdk / ar-io-sdk, which are modifiable when desktop needs upstream changes; feature-parity matrix.

## Open questions (need product input)

1. **Beta success metrics** — what defines a successful beta (e.g., N drives synced with zero data-integrity reports, upload success rate, crash-free sessions %)? Telemetry (INFRA-5) should be designed against these. *(Unanswered from the original list.)*
3. **Hide semantics in the UI** — when a user deletes locally and we hide on ArFS (D-011): should the Permaweb view show hidden files with an "unhide" affordance, and what copy communicates permanence best?
4. **Advanced-mode bundler scope** (FEAT-2) — is "lite bundler" per-file ANS-104 bundles signed by the user's wallet, or batch bundling with local receipts? Shapes turbo-sdk/arbundles reuse.

## Answered (moved to DECISIONS.md)

Gateway strategy → D-012 · Delete semantics → D-011 · Tester pool/feedback → D-017 · Ethereum → D-013 · Size ceiling → D-014 · ArNS/avatars → D-015 · Repo strategy → D-016 · Scope → D-010 · Owner-unknown discovery → D-019 (mirror ardrive-web's GQL) · Snapshot writing → D-019 (yes — create/view UI, FEAT-3). · Solana+private-drives derivation → D-020 (derive Arweave wallet from Solana wallet, ardrive-web pattern).
