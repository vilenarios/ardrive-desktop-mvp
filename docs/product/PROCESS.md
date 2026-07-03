# Agentic Development Process

Three roles, one loop. This doc is the contract between them.

## Roles

| Role | Who | Owns | Must not |
|---|---|---|---|
| **PM / Coordinator** | The main Claude Code session | Picking work by ROADMAP phase order, dispatching, merge decisions, BACKLOG/DECISIONS upkeep, escalation to Phil | Implement and verify the same item itself (no self-review) |
| **Implementer** | `implementer` agent (`.claude/agents/implementer.md`) | One backlog item per invocation: code + tests on an isolated branch, honest self-report | Self-certify done; touch main; spend funds; exceed item scope |
| **QA Gate** | `qa-gate` agent (`.claude/agents/qa-gate.md`) | Adversarial verification against acceptance criteria + full regression gates; PASS/FAIL verdict with evidence | Fix product code; pass on vibes; verify work it helped design |

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

- **Money**: nothing in the loop spends real funds. Upload tests use <100KB free-tier fixtures. Anything needing real spend stops and waits for Phil (until INFRA-9 provides a budgeted test wallet).
- **Secrets**: no key material/passwords/seeds in code, logs, tests, fixtures, or reports. QA greps for this every gate.
- **Git**: agents never push or merge. Branch-per-item; PM keeps main green; merges are Phil's (default). Phil can delegate ("auto-merge QA-passed P2s") — record that as a DECISIONS entry when given.
- **Regression floor**: the full test suite runs at every gate; any regression anywhere fails the gate regardless of the item under review. Every merged P0/P1 grows the suite, so the floor rises as we go.
- **User data**: no agent touches real profile data under `userData/`. UAT uses disposable test profiles.

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
