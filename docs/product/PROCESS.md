# Agentic Development Process

Three roles, one loop. This doc is the contract between them.

## Roles

| Role | Who | Owns | Must not |
|---|---|---|---|
| **PM / Coordinator** | The main Claude Code session | Picking work by ROADMAP phase order, dispatching, merge decisions, BACKLOG/DECISIONS upkeep, escalation to Phil | Implement and verify the same item itself (no self-review) |
| **Implementer** | `implementer` agent (`.claude/agents/implementer.md`) | One backlog item per invocation: code + tests on an isolated branch, honest self-report | Self-certify done; touch main; spend funds; exceed item scope |
| **QA Gate** | `qa-gate` agent (`.claude/agents/qa-gate.md`) | Adversarial verification against acceptance criteria + full regression gates; PASS/FAIL verdict with evidence | Fix product code; pass on vibes; verify work it helped design |
| **Designer** | `designer` agent (`.claude/agents/designer.md`) | Visual/styling for DESIGN-track items — token-driven, light/dark, matches ardrive_ui + public site | Change behavior/logic/IPC; self-certify; push |

**Phil** is the release authority and product-decision owner. Defaults below say what reaches him and what doesn't.

## The loop (per backlog item)

1. **PM selects** the next item by phase order (dependencies first — e.g. UX-3 before items that assume the envelope). PM writes the dispatch: item ID, relevant DECISIONS, known coupling with other in-flight items.
2. **Implementer** works it on an isolated branch/worktree (`fix/<ITEM-ID>-slug`), sets the item `in-progress`, implements + tests, self-verifies, reports (CHANGED / VERIFIED / NOT-VERIFIED / RISKS / BRANCH).
3. **QA Gate** independently verifies that branch: criteria-by-criteria check, full gates (typecheck, lint, full test suite, build), behavior exercised where drivable, regression hunt in the blast radius. Verdict: PASS / PASS(static) / FAIL.
4. **On FAIL**: PM sends the verdict's FAIL-REASONS back to the *same* implementer (continue its context) for a fix iteration → re-gate. Three consecutive FAILs = PM stops, reassesses the item (wrong approach? split it? escalate?).
5. **On PASS**: PM reviews the diff summary, flips the item to `done` (with commit ref + one-line note) in the same branch, and queues the branch for merge.
6. **Merge**: Phil merges (default — see Safety). After merge, PM confirms main is green and files any QA FINDINGS as new backlog items.

## Parallelism rules

- Independent items (different subsystems, no shared files) MAY run as parallel implementers in separate worktrees. PM checks file overlap before dispatching; overlapping items are serialized.
- QA verification of item A may run while implementer works item B.
- Never two implementers on the same file family (e.g. two items both editing main.ts handler regions) — main.ts is a 3k-line merge-conflict magnet; serialize anything touching it.

## Definition of Done (every item)

1. All acceptance criteria met and evidenced (not "should work").
2. `typecheck` + `lint` (no new errors) + **full** `vitest --run` + `build` green.
3. ≥1 behavioral test asserting the fixed behavior (exceptions: pure doc items; anything blocked by INFRA-2 must say so in the BACKLOG note).
4. Conforms to DECISIONS.md; BACKLOG updated in the same branch.
5. QA Gate PASS. `PASS (static)` is acceptable only where the environment genuinely can't drive the flow — the unexercised criteria get listed in the BACKLOG note and swept by the next manual UAT session.

## Safety rails (system-wide)

- **Money**: the loop spends nothing beyond the sanctioned test-money protocol (see "On-chain test-money protocol" below). Default is free-tier: uploads under the free-tier size cost 0 credits (use <100 KiB — the app's own limit); on-chain agents gate on size + a zero-balance wallet + a per-upload balance-delta (NOT on `getUploadCosts`, which returns base price) and assert an unchanged balance. Paid (≥105 KiB) uploads are individually capped and balance-checked. Releases/tags/version bumps and any spend outside this protocol still stop for Phil.
- **Secrets**: no key material/passwords/seeds in code, logs, tests, fixtures, or reports. QA greps for this every gate.
- **Git**: agents never push or merge. Branch-per-item; PM keeps main green; merges are Phil's (default). Phil can delegate ("auto-merge QA-passed P2s") — record that as a DECISIONS entry when given.
- **Regression floor**: the full test suite runs at every gate; any regression anywhere fails the gate regardless of the item under review. Every merged P0/P1 grows the suite, so the floor rises as we go.
- **Post-merge full suite is mandatory whenever any CODE commit landed on main after the gated branch's base** (docs-only deltas may skip it). A branch's gate proves the branch, not the combination — semantic conflicts auto-merge textually and break behaviorally (proven 2026-07-03: SYNC-3 + INFRA-7 both green individually, red combined). If red: hotfix branch immediately, priority over all lanes; the merger's session owns the reconciliation.
- **User data**: no agent touches real profile data under `userData/`. UAT uses disposable test profiles.

## Model tiering (cost discipline — Fable 5 drained the budget 2026-07-03; default Opus 4.8)

The PM picks each dispatch's model by the item's risk and difficulty, not one-size-fits-all. Intelligence where it protects money/data; economy everywhere else. Never undercut a task that needs depth.
- **Opus 4.8** — ALL qa-gates (a dumb gate is worse than none: false confidence), and any implementer on money / security / data-integrity / sync-correctness (the P0 spine).
- **Sonnet 5** — default implementer tier: well-scoped fixes, test writing for defined behavior, moderate-risk items. CI/config gates.
- **Haiku 4.5** — mechanical only: dead-code deletion, doc/asset moves, run-a-known-command-and-report. (Most such work the PM does inline — no agent at all.)
Override per dispatch (`model:` on Agent/SendMessage) beats the role-file default. When unsure, go one tier up.

## Multi-session coordination

- **BACKLOG.md is the claim ledger.** Any session (PM-driven or a parallel session Phil runs) claims an item by committing its status flip to `in-progress`. Before dispatching, the PM checks item status and recent `git log` for claims. Never double-claim.
- **File-overlap rule extends across sessions**: an item whose files overlap a claimed item waits (main.ts remains the biggest serialization point).
- **Direct instructions from Phil to any agent win** over that agent's standing rails; the agent notes the instruction in its report and the PM reconciles the record afterward. Route follow-ups on *finished* items through the PM to keep one writer per checkout.
- **Orphaned verdicts route to the PM.** If a QA gate (or implementer) finishes and its requesting session is unreachable, its report lands with the main conversation; the PM adjudicates, makes any required records, and closes the item out. A QA PASS conditioned on an unrecorded decision is not merge-ready until the PM records that decision (this happened on UX-1 — the gate was right to insist).

## Overnight autonomous loop & operational patterns (2026-07-04)

When Phil authorizes continuous unattended operation ("run the loop all night"), the PM runs the same three-role loop **event-driven**: each background agent's completion notification re-invokes the PM, which gates/merges/dispatches and immediately refills the pipeline, so ≥1 agent is always in flight and the loop self-sustains until morning. Keep a **task tracker** (TaskCreate) of in-flight lanes + the queue so state survives PM context-compaction. Morning deliverable to Phil: what merged, on-chain verification results, design screenshots awaiting sign-off, and anything needing a decision.

**Worktree node_modules (critical trap).** After the core-js 4.0.0 bump, the primary checkout's `node_modules` is 3.0.3 (peer sessions on pre-bump branches still use it) and it sits on a stale branch; `main` lives in the `wt-main` worktree with its own real 4.0.0 `node_modules`. A fresh `git worktree add` has NO node_modules. **Every new lane worktree must symlink `node_modules → wt-main/node_modules` before dispatch**, else builds fail spuriously against the 4.x ArFS/hide API (this caused SYNC-13's phantom build failure). Never `npm install` in a lane worktree — it would corrupt the shared tree. Per-lane setup: `git worktree add <path> -b fix/<ID>-slug main` → `ln -s <wt-main>/node_modules <path>/node_modules` → verify core-js prints 4.0.0. Merge + post-merge suite run in `wt-main`.

**Overnight gate tiering (refines Model tiering).** Opus gates stay mandatory for money / security / data-integrity / sync-correctness / privacy / core-js items — a false-PASS there costs real money or data. Pure renderer/UX/copy/docs items, where a false-PASS can neither spend funds nor corrupt data, may take a **Sonnet** gate to keep the always-on loop economical. Still an independent adversarial agent (never PM self-review) — just right-sized.

**On-chain test-money protocol (INFRA-9).** Real Arweave/Turbo verification uses the designated disposable "ikry" wallet (path + password in gitignored `.env`: `ARDRIVE_DEV_WALLET_PATH` / `ARDRIVE_DEV_PASSWORD`). Rules: reference by path/address only, never read key/password into logs, commits, or reports; **Turbo free tier = files < 105 KiB (107520 bytes) cost 0 credits** — the core matrix runs free; mint fresh wallets (`arweave.wallets.generate()`) for new-user flows (unfunded wallets still get free-tier uploads); disposable temp userData dir, never real profiles; never in CI. Spend guards on any on-chain agent: only upload files under the free-tier size — **use <100 KiB** to match the app's own `CostCalculator.TURBO_FREE_SIZE_LIMIT` (100·1024), conservative vs the ~105 KiB real limit — from a **zero-balance wallet**, and assert an unchanged balance via a **per-upload balance-delta** at the end. **Do NOT gate on turbo-sdk `getUploadCosts`**: it returns the BASE price, not the free-tier price (the <100 KiB subsidy is applied server-side), so an "abort if cost != 0" rule wrongly aborts every upload (learned 2026-07-04). Gate on size + balance-delta instead. Paid (≥105 KiB) uploads are a separate, explicitly-capped step (hard cap, before/after balance check). On-chain agents run **foreground** (see stall trap).

**Subagent background-stall recovery.** A subagent that parks a long command in the background and ends its turn kills that job with the turn and reports nothing useful (happened to the on-chain harness 2026-07-04). Recovery: the agent's context survives — `SendMessage` its agentId demanding a foreground re-run + full report; don't re-dispatch from scratch. Prevention: agents run heavy/long commands foreground with explicit timeouts (already in the role files).

**core-js changes are Phil-authorized (standing, 2026-07-04).** Like the CORE-4 hide chain, the loop may fix `ardrive-core-js` (sibling repo `/mnt/c/source/ardrive-core-js`) without waking Phil — gated to the same 100%-verified bar: core-js tests → PR to master → git-pin consumption → desktop verification GREEN. Expected first need: owner-scoped GraphQL (CORE-1 / D-019) — ArFS queries return empty without the owner address (mirror the ardrive-web pattern).

**Upstream (core-js / CLI) interop gate (CORE track, per D-027).** Any core-js change that touches the drive-**listing** path (CORE-3b snapshot wiring, CORE-1 owner queries, CORE-2 incremental) must pass the **interop vector** before QA-PASS or a desktop bump — it cannot merge on unit tests alone. On a real drive: `canonical(new-listing)` vs the **golden full-replay baseline** (`docs/product/interop-harness/`), read-only via ArDrive-CLI wired to the core-js build under test (turbo-gateway, no wallet/spend). **PASS = new-listing ⊇ golden (SUPERSET, zero removals) AND fewer GraphQL requests** — every addition must be a verified real on-chain entity the gateway GQL index has dropped (`transactions(ids:[tx])`→0 edges but `GET /<tx>`→200 valid metadata); a byte-identical PASS is expected where the index is complete. The full-replay fallback must stay byte-identical (zero regression). **Provenance:** confirm the CLI resolves the intended build (symlink realpath + a build-only export symbol) — the 4.x builds self-report `4.0.0` like the npm pin. The desktop **dep bump is its own gated step** (re-runs the full desktop suite + interop against the bumped build).

## Design sub-loop (DESIGN-track items, per D-023)

Same implement→verify loop, adapted: the **designer** agent restyles a surface (token-driven, no behavior change) → **qa-gate** verifies the mechanical bar (typecheck/lint/build, no logic regression, zero raw color literals outside the theme layer, WCAG-AA contrast, light+dark both render) → **Phil signs off the aesthetic** from screenshots (the INFRA-12 Playwright harness renders each surface light+dark and is the design-review evidence tool). QA verifies "correct + on-system"; Phil decides "beautiful." Lane rule: a DESIGN item and a functional item on the same component file serialize.

## Escalation to Phil (PM must stop and ask)

- Anything that changes or contradicts a D-### decision, or needs a new product decision (ROADMAP open questions).
- Real-funds spend; release/tag/publish actions; deleting anything not created by the loop.
- An item whose correct fix reveals materially larger scope than the backlog entry (PM proposes a split first).
- Three-FAIL items (with PM's reassessment attached).

## Cadence & sessions

A working session = PM loops items continuously within the current phase until: the phase's items are exhausted, an escalation triggers, or Phil interrupts. PM ends each session with: items completed (IDs + verdicts), items in flight, next up, escalations pending. BACKLOG.md is always the resumable state — any new session can pick up from it cold.

## Bootstrap order (before the first real loop)

1. ~~**Baseline commit**~~ ✅ 2026-07-02 — Phil's WIP parked on `wip/drive-key-persistence` (c8a1469); docs + agent setup committed to main (da5d3d9); repo/docs reorganized (root cleaned, docs/ indexed).
2. ~~**INFRA-1** (lockfile + workflow committed)~~ ✅ committed locally (6299771); acceptance (clean-runner dispatch) verifies on first push.
3. ~~**INFRA-2** (test suite resurrected)~~ ✅ 2026-07-03 — merged (ea419f9) after the loop's first full cycle: implement → QA FAIL (1 defect) → fix iteration → QA PASS (static). 110 tests + 1 visible skip, green.
4. **Phase 1 in BACKLOG order.** ← **current**
