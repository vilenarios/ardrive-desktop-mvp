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
- **Milestone 3 — "Feels finished":** 🟡 substantially advanced (2026-07-04). The full **DESIGN-8 UI/UX sweep** delivered the "feels finished" surface polish, honesty (trust bugs removed), a11y baseline (modal focus-management, keyboard reach), and info-bubble coverage across every surface. Remaining M3 work: the envelope enforcement (UX-3) and a live-display UI walkthrough (UAT plan in flight).
- **Milestone 4 — "Sustainable to iterate":** 🟡 INFRA-2/7 done; CI-gating (INFRA-3) and test-money (INFRA-9) in progress.
- **Design foundation & polish:** ✅ DESIGN-1/2/3 (tokens/theme + onboarding) **and DESIGN-4/5/6/7 + the full DESIGN-8 sweep done** — every user-visible surface tokenized in light+dark, trust bugs removed, modal a11y + info-bubbles + the Gateway settings UI landed (483 tests). Residual design-system debt → DESIGN-9 (GA-track). Caveat: static-verified; live-display walkthrough pending (UAT).

**Rough completion (2026-07-05):** **all beta P0s are done.** The critical path is now: **(1)** the **D-026 ≥web sync** ship — core-js 4.1.0 (snapshot consumption + incremental + robustness) is merged upstream and the desktop pin lane has *proven it in-app* (a 752-entity drive lists in **3.7s** via snapshots; `listPrivateFolder` completes); pin merge + Phil's npm-publish finalize it. **(2)** the remaining **M2 P1 sync/privacy/money correctness** items (PRIV-8 ✅, UX-8 ✅, SYNC-24 ✅ done this session; MONEY-9/10, SYNC-9, PRIV-6, SEC-4, UX-15 in flight/queued). **(3)** the owner-gated items: **live-Electron UI walkthrough** (Gate 5), the **supervised paid-rails** pass, and brand sign-off. On-chain verification (Gate 4) is now broad: read/download (incl. **full recursive drive download** — 15/15 files, folders preserved, bytes valid), private v1+v2 unlock, hide→restore, gateway self-heal, and **live rename fileId-reuse** all proven; only two file-level metadata executions remain gated on gateway indexing timing (not logic).

---

## Gate 1 — Zero open P0 blockers

Every P0 in beta scope must be `done` and QA-gated. **Status 2026-07-05: all beta P0s are now done — zero open P0 blockers.**

- [x] **PRIV-4** (Phase 3) — drive-key persistence — **done** 2026-07-04: opt-in per drive, encrypted at rest (scrypt + AES-256-GCM, session-password), **no plaintext key on disk**; session restore wired. (Superseded the parked WIP.)
- [x] **UX-3** (Phase 3) — unified IPC envelope (D-005) — **done** 2026-07-05: all 97 main.ts handlers return the `IpcResult` envelope, type-enforced at the preload boundary; zero raw/`safeIpcHandler` handlers remain; boolean/void trap hand-audited across call sites. Clears the SEC-2/SEC-4 raw-shape debt.
- [x] **INFRA-3** (Phase 4) — CI quality gate — **done** 2026-07-05: a required `quality` job (typecheck src + tests, lint, `vitest --run`) gates the build matrix; the old continue-on-error test step is gone. *One open decision (not a blocker): add Linux packaging to the matrix vs. drop Linux from beta docs.*
- [x] **CORE-4** (Track C) — hide/unhide — **done**: shipped in core-js **4.1.0** (PR #274, merged to `master`); the desktop pins 4.1.0 via git-ref (D-026 pin lane). Fully satisfied for beta.

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
- [x] **SYNC-24** — File+Folder OperationDetector coverage + the money/history fixes — **done** 2026-07-05: 40 detector tests; F1 (move-re-uploading-as-copy) + F2 (folder-identity) fixed, F3 documented limitation. *New findings filed: SYNC-26 (edit→new-fileId, P1), SYNC-27 (copy semantics, P2).*
- [ ] **SYNC-6** — 2 GiB upload cap surfaced (D-014) · **SYNC-10** — streaming hashing (prereq for 2 GiB) · **SYNC-9** — offline visibility · **SYNC-11** — watcher hygiene · **SYNC-16** — (see BACKLOG) · **SYNC-26** — edit→revision fileId threading.
- [x] **PRIV-8** — fail-closed privacy — **done** 2026-07-05: unresolved drive privacy throws before any ArFS call/spend; also closed 4 move/rename paths that leaked private→public unchecked. · [x] **PRIV-7** — unlock password validation — **done**. · [ ] **PRIV-6** — private move/rename/hide paths (route through the encrypted ArFS methods; PRIV-8 currently blocks them safely).
- [ ] **MONEY-9** — upload-queue serialization (in progress) · **MONEY-10** — upload-time cost revalidation · ~~**MONEY-7** payment-window hardening~~ **done** · *(also done this session: MONEY-13 AR-balance NaN-during-429)*.
- [ ] **UX finish batch:** UX-4 listener redesign · UX-5 real profile switching · UX-6 auto-login/no-keychain (w/ SEC-4) · ~~UX-7 fail-safe boot routing~~ **done** · ~~UX-8 progress-modal error state~~ **done** · ~~UX-10 copy-link~~ **done** · UX-15 truthful single-drive UI · UX-18. *(Also done: UX-19 returning-user drives, UX-20 orphaned-wallets, PRIV-7 unlock password validation, SYNC-17/18 gateway.)*
- [x] **SEC-5** — no plaintext JWK temp files — **done** (in-memory `JWKWallet`, no tmpdir).

## Gate 4 — Real-world verification (✅ largely done, 2026-07-04 — via turbo-gateway.com)

Previously all **mock-verified** and blocked. Executed 2026-07-04 against Phil's capped, disposable test wallet (referenced by path/env only; never production funds; spend hard-capped). Run on **turbo-gateway.com** (arweave.net rate-limits this environment). This was the gate most likely to surface surprises — it surfaced the owner-scoped-GQL issue, fixed upstream in ardrive-core-js (CORE-1, PR #271).

- [x] Test wallet provisioned + funded (Phil's "most complicated" wallet — public + private drives, snapshots, hidden/pinned/licensed files).
- [x] **Hide → verify** round-trip: local delete propagates as an ArFS hide and the file reads as hidden from a fresh owner-scoped fetch — **and reverses** (unhide restores), run non-destructively on real data.
- [x] **Private drive** round-trip: create/unlock → private crypto round-trips to correct plaintext via the derived drive key; wrong password fails closed.
- [x] **Payment approval:** a real Turbo upload spent only after explicit approval; free-tier (<100 KiB) stayed free; one capped >free-tier paid upload proved the payment path (~0.0012 credits, one-shot, Phil-authorized).
- [x] **Upload integrity:** public upload → download → SHA-256 identical.
- [x] **LIVE end-to-end through the running app UI** (2026-07-05, UAT-RUN-2-LIVE + follow-ups): real wallet authenticated, 18 drives listed live (0 console errors); free-tier upload → download → **SHA-256 byte-exact** (data tx `_rAAJ0…`); gateway-404 **self-heal proven live** (real 404 → SYNC-20 retry → recovered); **private drives v1 AND v2 unlock live** after the PRIV-SIG-1 fix, wrong-password fails closed.
- [x] **PRIV-SIG-1 (P0, found by this live pass):** app hardcoded v1 drive-signature derivation → v2 private drives rejected the correct password, and app-created private drives could never be re-unlocked (data-loss class). Fixed (per-drive v1/v2 detection) + live-proven on the owner's real v2 drives + create→re-unlock round-trip.
- [ ] *Remaining (owner-gated):* real **paid** rails — Turbo top-up (Stripe), AR→Credits conversion, and a >free-tier paid upload through the live UI (guards verified; the charge needs the owner). Two environmental test-only caveats documented (WSL `/mnt/c` drops file-watch events; fresh-drive gateway indexing ~10–18 min on this box) — neither affects real users on native FS / normal networks.

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
