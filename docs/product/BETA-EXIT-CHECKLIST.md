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
- **Milestone 4 — "Sustainable to iterate":** 🟡 INFRA-2/3/7 done (INFRA-3 CI quality gate now green + gating — 2026-07-09); test-money (INFRA-9) in progress.
- **Design foundation & polish:** ✅ DESIGN-1/2/3 (tokens/theme + onboarding) **and DESIGN-4/5/6/7 + the full DESIGN-8 sweep done** — every user-visible surface tokenized in light+dark, trust bugs removed, modal a11y + info-bubbles + the Gateway settings UI landed (483 tests). Residual design-system debt → DESIGN-9 (GA-track). Caveat: static-verified; live-display walkthrough pending (UAT).

**Rough completion (2026-07-08): the beta is FUNCTIONALLY COMPLETE.** All beta P0s are done and the entire M2/M3 sync/privacy/money/UX P1 batch is merged + gated (test suite **561 → ~880**, all green). D-026 (≥web sync) shipped — core-js 4.1.0 pinned; snapshot cold-start (752-entity drive 146s→**3.7s**) *and* incremental warm-resync both landing, adversarially verified safe. Delivered this session: SYNC-6/9/24/26/28, PRIV-6/8, MONEY-10, UX-4/5/8/15/18/28, FEAT-6 version history, wallet-safety, manifest deploy, full-drive download, plus FEAT-8 multi-token top-up (desktop shipped, console PR #14). **What remains is NOT autonomous engineering — it's three owner things:** (1) a handful of **decisions** (Linux packaging vs drop; publish 4.1.0 to npm; the pending core-js 4.2.0 pin bump once #275/CORE-7/8/9 merges upstream); (2) **one supervised session** (needs real funds / a display — paid rails, PRIV-6 live private move, FEAT-8 live crypto payment, live-Electron smoke UAT); (3) **final sign-off (D-009)**. On-chain verification (Gate 4) is broad: read/download incl. full recursive drive download (15/15, folders, bytes valid), private v1+v2 unlock, hide→restore, gateway self-heal, live rename fileId-reuse — all proven; only spend-gated write executions remain for the supervised pass.

**Update 2026-07-09 — consumer-parity + login + CI landings (still owner-gated, NOT a ship claim).** The always-prompt-login decision is now settled: **D-031 CONFIRMED (owner-approved)** and built as **UX-6** (`done`) — auto-login removed, always-prompt for beta (so it is no longer a Gate 6 open decision). Consumer-parity polish landed to OneDrive/Dropbox level: **UX-36** (state-reflecting tray icons + actionable notifications + once-per-transition low-Turbo-balance nudge + download-complete), **UX-35** (real branded app + tray icon set, packaging config fixed), **UX-21/UX-22** (auto-sync toggle persists + boot respects it, first-class pause/resume), **SYNC-16** (failed sync status now persists). **INFRA-3** is done — CI now genuinely gates (typecheck:tests green, the continue-on-error test step removed). None of this changes the ship gate: the supervised money/display session and Phil's D-009 sign-off still stand.

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
- [x] **SYNC-6** — file-size cap surfaced — **done** 2026-07-08: oversized files no longer silently skipped (was falsely enforcing 500 MiB vs the documented 100 MiB — now one `MAX_SYNC_FILE_SIZE_BYTES` constant, notification + failed record on both routes). · [x] **SYNC-9** — offline visibility — **done** 2026-07-08: visible degraded/offline sync state (health signal → indicator + notification + auto-resume), no silent "continuing anyway". · *Remainders → KNOWN-ISSUES / post-beta: **SYNC-10** streaming-hash to raise the cap to 2 GiB (post-beta), **SYNC-11** watcher-hygiene over-suppression (P2, money-safe), **SYNC-16**, **SYNC-27** copy semantics (P2).*
- [x] **PRIV-8** — fail-closed privacy — **done** 2026-07-05. · [x] **PRIV-7** — unlock password validation — **done**. · [x] **PRIV-6** — private move/rename via the encrypted ArFS path — **done (impl + unit-tested, qa-gated)** 2026-07-08; routes positively-private through core-js `*Private*` methods with the drive key, unresolved/locked still fail closed, result whitelisted (no key leak). ⏳ *Needs one supervised on-chain private move/rename to be fully verified (Gate 4 supervised list).*
- [x] **MONEY-10** — upload-time size/cost re-validation — **done** 2026-07-08 (qa-gated, TOCTOU closed: wrapped size == approved size at both wrap sites; no bytes upload at an unapproved size/cost). · ~~**MONEY-7**~~ done · MONEY-13 done. · *MONEY-9 upload-queue serialization: not run this session — verify status (likely already-serial via the approval queue; confirm or schedule).*
- [x] **UX finish batch — done:** ~~UX-4 listener redesign~~ · ~~UX-5 real profile switching~~ · ~~UX-7~~ · ~~UX-8~~ · ~~UX-10~~ · ~~UX-15 truthful single-drive~~ · ~~UX-18 drive-removal UI~~ · ~~UX-28 global sync indicator~~ · ~~UX-9 in-app confirms~~. *(Also: UX-19/20, SYNC-17/18, UX-33 manifest URL.)* · [x] **UX-6 auto-login** — **RESOLVED 2026-07-09** (D-031 CONFIRMED, owner-approved): beta ships **always-prompt login, no auto-login** (safer for a self-custody wallet). Built as UX-6 (`done`) in the REMOVE direction — the dead/circular auto-login path deleted and the "Remember Me on This Device" control withheld for beta (`REMEMBER_ME_ENABLED = false`); SEC-4's opt-in keychain infra stays intact for a post-beta opt-in. No longer a Gate 6 open decision.
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
