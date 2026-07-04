# ArDrive Desktop — Beta-Exit Checklist

The single gate that answers **"are we ready to hand the beta to real testers?"** Derived from [ROADMAP.md](./ROADMAP.md) milestone exit criteria and [BACKLOG.md](./BACKLOG.md) item status; decisions referenced as `D-###` from [DECISIONS.md](./DECISIONS.md).

Per **D-003**, this is a *quality gate, not a date* — we loop until every box is checked. Per **D-009**, the beta ships **only on Phil's explicit final approval**; a fully-checked list is a recommendation to ship, not an authorization.

## What "beta" means here
- **Audience:** Phil's Discord tester group (**D-017**), not the public.
- **Distribution:** unsigned installers via `npm run build:testers` + GitHub Releases (**D-004**); code signing/notarization is GA, not beta (Track D).
- **Scope (D-010):** public **and** private drives · Turbo-only payments · one syncing drive at a time. Simultaneous multi-drive is post-beta with truthful single-drive UI (UX-15).
- **Definition of the product promise:** every visible control either works or doesn't exist; nothing lies to the user or leaks secrets; no money moves without explicit approval; files round-trip without corruption or silent loss.

---

## Readiness snapshot (update as items land)

Beta scope = Phases 1–4 + the design foundation. Tracks A–E are explicitly **post-beta** and become the KNOWN-ISSUES list, not blockers.

- **Milestone 1 — "Safe to hand to a tester":** ✅ code-complete (all 11 items merged + gated). One caveat open: live-Electron smoke UAT on a real display (see Gate 5).
- **Milestone 2 — "Sync you can trust":** 🟡 in progress. Core paths done (SYNC-1/2/3/4/5/7, PRIV-1/2/3/5, MONEY-2/6, INFRA-12, DESIGN foundation); **remaining below**.
- **Milestone 3 — "Feels finished":** 🔴 not started as a block (all Phase-3 items `todo`).
- **Milestone 4 — "Sustainable to iterate":** 🟡 INFRA-2/7 done; CI-gating (INFRA-3) and test-money (INFRA-9) in progress.
- **Design foundation:** ✅ DESIGN-1/2/3 done (token/theme layer + onboarding restyle + polish); per-surface DESIGN-4..7 continue to GA.

**Rough completion:** ~31 of ~61 beta-scoped items verified-done. The critical path is now **4 open P0s + the Milestone-2/3 P1 correctness & finish work**, and — the single biggest risk — **all real-money on-chain verification is blocked on the test wallet (INFRA-9).**

---

## Gate 1 — Zero open P0 blockers

Every P0 in beta scope must be `done` and QA-gated. Currently open:

- [ ] **PRIV-4** (Phase 3) — drive-key persistence: fixed serialization + session restore + settings UI. *(Parked WIP on `wip/drive-key-persistence`.)*
- [ ] **UX-3** (Phase 3) — unified IPC envelope (D-005) enforced across handlers. *Unblocks the SEC-2/SEC-4 raw-shape debt.*
- [ ] **INFRA-3** (Phase 4) — CI gates PRs (unit + integration + smoke) — *in progress.*
- [ ] **CORE-4** (Track C, blocks nothing now) — hide/unhide upstream PR #270 merged to core-js `master`; desktop consumes a pinned commit today, so this is *functionally satisfied for beta* — downgrade to "nice-to-have upstream merge" unless Phil wants the pin off a fork before shipping.

> All other P0s (SEC-1/2/3, MONEY-1/2/3/4, SYNC-1/2/3/4/5/7, PRIV-1/2/3, UX-1/2, INFRA-1/2) are `done` + gated.

## Gate 2 — Milestone exit criteria demonstrably met

Each milestone's ROADMAP exit criteria must be exercised, not just coded:

- [ ] **M1 exit:** a tester imports a wallet and syncs a drive with Turbo; every visible control works or is absent; `git grep MOCK_AR_PRICE` clean. *(Code-verified; needs the real-display smoke UAT in Gate 5.)*
- [ ] **M2 exit (real public AND private drives):** create/edit/rename/move/delete files & folders; kill the app mid-transfer; go offline mid-sync; switch drives; lock/unlock a private drive — after each, DB + disk + UI agree; deletes show hidden on ArFS; private files round-trip to plaintext; no unapproved spend.
- [ ] **M3 exit:** full manual UI walkthrough, every screen/button, zero silent failures; unlock-remember-restart round-trips; envelope enforced by types.
- [ ] **M4 exit:** green gated CI on every PR; build N testers get offered N+1; a field crash produces a readable report.

## Gate 3 — Sync / privacy / money correctness (M2 & M3 P1s)

Must be `done`-or-explicit-known-issue before shipping (a deferred one moves to KNOWN-ISSUES with a documented workaround):

- [x] **SYNC-13** — download-eviction feedback loop — **done** (Opus gate PASS, 2026-07-03).
- [ ] **SYNC-6** — 2 GiB upload cap surfaced (D-014) · **SYNC-10** — streaming hashing (prereq for 2 GiB) · **SYNC-9** — offline visibility · **SYNC-11** — watcher hygiene · **SYNC-16** — (see BACKLOG).
- [ ] **PRIV-6** — private move/rename/hide paths · **PRIV-7** — unlock password validation · **PRIV-8** — fail-closed privacy.
- [ ] **MONEY-9** — upload-queue serialization (in progress) · **MONEY-10** — upload-time cost revalidation · **MONEY-7** — payment-window hardening.
- [ ] **UX finish batch:** UX-4 listener redesign · UX-5 real profile switching · UX-6 auto-login/no-keychain (w/ SEC-4) · UX-7 fail-safe boot routing · UX-8 progress-modal error state · UX-10 copy-link · UX-15 truthful single-drive UI · UX-18.
- [ ] **SEC-5** — no plaintext JWK temp files.

## Gate 4 — Real-world verification (⚠️ blocked on the test wallet — INFRA-9)

Everything above is currently **mock-verified**. These need real on-chain execution with a funded, disposable test wallet (**never** production funds; **D-** budget rules). This is the gate most likely to surface surprises.

- [ ] Test wallet provisioned + funded with a small AR/Turbo budget (INFRA-9). *(Phil's task — the one thing only he can set up.)*
- [ ] **Hide → verify** round-trip: local delete propagates as an ArFS hide and the file reads as hidden from a fresh fetch (the one untested link in the hide chain).
- [ ] **Private drive** round-trip: create → upload → download decrypts to correct plaintext; wrong password fails closed.
- [ ] **Payment approval:** a real Turbo upload spends only after explicit approval; the approved amount matches the charge; free-tier (<100KB) stays free.
- [ ] **Upload integrity:** a >free-tier file uploads, downloads, and hashes identically.

## Gate 5 — Release mechanics & known-issues

- [ ] **Live-Electron smoke UAT** on a real display: import wallet → sync → approve upload → see it on the Permaweb (M1's last caveat; INFRA-12 harness provides automated screenshot evidence, but a human eyes-on pass is the sign-off).
- [ ] `npm run build:testers` produces working installers on the target OSes; a clean-machine install launches and onboards.
- [ ] **KNOWN-ISSUES.md** generated from `deferred` backlog items (multi-drive engine, remote-change polling, conflict resolution, Solana onboarding, GA hardening) so testers know what's intentionally absent.
- [ ] CI green end-to-end on the release commit (INFRA-3 gating live).
- [ ] Auto-update (INFRA-4) wired **or** the manual-update path documented for testers.
- [ ] Crash/telemetry (INFRA-5) capturing field reports **or** an explicit decision to ship beta without it.

## Gate 6 — Human sign-off (D-009)

- [ ] Phil reviews this checklist and the KNOWN-ISSUES list.
- [ ] Phil gives explicit final approval to tag + release.
- [ ] Version bump + tag + `build:testers` publish (**Phil's action** — releases/tags/version bumps are never automated).

---

## Out of scope for beta (→ KNOWN-ISSUES)

These are deliberately deferred (Tracks A–E) and must be **communicated**, not fixed, before beta:

- Simultaneous multi-drive sync (SYNC-14) — single-drive only, UI tells the truth (UX-15).
- Remote-change polling / two-way remote sync (SYNC-8), conflict detection/resolution, download hash verification (SYNC-12).
- Full Wayfinder top-staked gateway routing (SYNC-15) — beta gets the no-single-gateway minimum (D-012).
- Solana-default onboarding + advanced AR-token mode (FEAT-1/2, Track B).
- ArFS snapshot create/view (FEAT-3) and the core-js update wave (CORE-1/2/3).
- GA hardening: code signing/notarization, Electron upgrade (SEC-6), shell confinement (SEC-7/9), secure-logger (SEC-8), keytar→safeStorage (SEC-10), rate limiting (SEC-11), UX polish batch (UX-9/11/12/13/14), repo hygiene (INFRA-6/8/11).

## Maintenance
Update the checkboxes as items reach `done` in BACKLOG. This doc is a *view* over the backlog for release decisions — the backlog stays the source of truth for item-level status. Open product questions that gate the beta (beta success metrics, hide-in-UI semantics — ROADMAP "Open questions") should be resolved before Gate 6.
