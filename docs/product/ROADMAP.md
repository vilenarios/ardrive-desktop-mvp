# ArDrive Desktop — Roadmap

Working plan from the [2026-07-02 audit](./AUDIT-2026-07-02.md). Work items live in [BACKLOG.md](./BACKLOG.md); decisions in [DECISIONS.md](./DECISIONS.md). Estimates assume one focused developer + agent support; phases 1–3 are sequential-ish, Phase 4 parallelizes.

## Beta scope (decision D-001, provisional)

**Public drives · Turbo-only payments · one syncing drive at a time.**

Rationale: that is the spine that verifiably works today. Private drives (ciphertext downloads, no password verification), real AR payment routing, and true multi-drive sync are each multi-week correctness projects — they become post-beta tracks rather than beta blockers. The UI must be *truthful* about the reduced scope (feature flags + honest copy), not silently broken.

## Milestone 1 — "Safe to hand to a tester" (Phase 1, ~1 week)

Nothing in the build lies to users or leaks secrets. All P0/Phase-1 items:

- SEC-1 key logging · SEC-2 env exposure · SEC-3 sync-survives-logout · SEC-12 export mask
- MONEY-1 remove cosmetic AR choice · MONEY-3 fake USD pricing · MONEY-4 fake Auto Top-Up · MONEY-5 no-op conflict modal
- PRIV-0 private-drives feature flag
- UX-1 toasts actually render · UX-2 Settings folder picker
- INFRA-1 CI can install (lockfile + workflow committed)

Exit criteria: a tester can import a wallet, sync a public drive with Turbo, and every visible control either works or doesn't exist. `git grep MOCK_AR_PRICE` returns nothing.

## Milestone 2 — "Sync you can trust" (Phase 2, ~2 weeks)

The engine's core promises hold:

- SYNC-1 edits re-upload · SYNC-2 failed downloads marked failed · SYNC-3 crash recovery · SYNC-4 stop/start lifecycle · SYNC-7 folder/drive single source of truth
- SYNC-5 truthful deletes · SYNC-6 size limit surfaced · SYNC-9 offline visibility · SYNC-11 watcher hygiene · SYNC-13 eviction feedback loop
- MONEY-2 cancel/retry safety · MONEY-6 approval semantics · MONEY-9 queue serialization · MONEY-10 upload-time revalidation

Exit criteria (UAT script, run on a real drive): create/edit/rename/move/delete files and folders; kill the app mid-transfer; go offline mid-sync; switch drives — after each, DB state, disk state, and UI agree, and no money was spent that the user didn't approve.

## Milestone 3 — "Feels finished" (Phase 3, ~1 week)

- UX-3 unified IPC envelope (kills three known bugs at the root) · UX-4 listener redesign · UX-5 real profile switching · UX-6 auto-login or no keychain storage (with SEC-4) · UX-7 fail-safe boot routing · UX-8 progress-modal error state · UX-10 copy-link fix · UX-15 truthful single-drive UI
- SEC-5 no plaintext JWK temp files · MONEY-7 payment window hardening

Exit criteria: full manual UI walkthrough (every screen, every button) with zero silent failures; response-envelope typecheck enforced.

## Milestone 4 — "Sustainable to iterate" (Phase 4, ~1 week, parallel with 2–3)

- INFRA-2 tests resurrected · INFRA-3 CI gating · INFRA-4 auto-update · INFRA-5 telemetry · INFRA-7 DB migrations · INFRA-9 test-money strategy · INFRA-10 IPC reconciliation
- SEC-6 Electron upgrade · SEC-7 shell hardening

Exit criteria: green gated CI on every PR; a tester on build N gets offered N+1; a crash in the field produces a report we can read.

## → Beta release (target: all four milestones)

Ship via `build:testers` + GitHub Releases (unsigned, per D-004) to a private tester group with a KNOWN-ISSUES list generated from `deferred` backlog items.

---

## Post-beta tracks

**Track A — Private drives** (PRIV-1..7): download decryption, trial-decrypt password verification, create-flow fix, key persistence (fixed serialization + session restore + settings UI), locked-drive sync states, private move/rename. Ship behind the PRIV-0 flag flip when the round-trip UAT passes.

**Track B — Real AR payments**: per-upload planner selection (requires ardrive-core factory changes or dual factory instances), true AR cost quotes incl. community tip, AR balance gating, method honored end-to-end.

**Track C — Sync depth**: true multi-drive engine (SYNC-14), remote-change polling (SYNC-8), conflict detection + resolution (with the modal MONEY-5 removed until then), download hash verification (SYNC-12), streaming hash/indexed lookups (SYNC-10), gateway failover / Wayfinder integration (repo already vendors Wayfinder docs — scope TBD, see Open Questions).

**Track D — GA hardening**: code signing + notarization, secure-logger adoption (SEC-8), shell confinement (SEC-9), keytar→safeStorage (SEC-10), rate limiting (SEC-11), seed-confirm realness (SEC-13), UX-9/11/12/13/14 polish batch, repo hygiene (INFRA-6/8/11), MONEY-8.

**Track E — ArDrive Web convergence**: extend this agentic product process to the ardrive-web sibling repo; shared ArFS interop test vectors (files created by desktop must round-trip in web and vice versa); shared backlog conventions and cross-repo feature parity matrix.

## Open questions (need product input)

1. **Wayfinder/ar.io gateways** — vendored docs suggest planned integration; is gateway failover via Wayfinder the intended Track C design, or is `arweave.net` acceptable for GA?
2. **Delete semantics** — is ArFS *hide* the desired long-term behavior for local deletes (Track C), and how should the UI message permanence?
3. **Tester pool** — who and how many for the beta; what's the feedback channel (GitHub issues? Discord?); do we need an in-app "report a problem" that bundles logs (depends on SEC-8)?
4. **Success metrics** — what defines a successful beta (e.g., N drives synced with zero data-integrity reports, upload success rate, crash-free sessions %)? Telemetry (INFRA-5) should be designed against these.
5. **Ethereum wallet support** — stub exists (`wallet:import-ethereum-from-file` TODO); on the roadmap or delete?
6. **File size ceiling** — keep 100MB (docs) or 500MB (code) for beta? Cost implications for testers.
7. **ArNS/avatar features** — present and working; any beta-scope changes needed?
8. **ardrive-web timing** — when Track E starts, monorepo vs. sibling-repo conventions.
