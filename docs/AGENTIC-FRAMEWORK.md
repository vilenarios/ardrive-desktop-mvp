# The Agentic Development Framework

A **portable, product-agnostic** playbook for building and maintaining software with a coordinated fleet of AI agents — resilient, cost-controlled, and scalable across products. Distilled from running a live multi-agent loop on a real production codebase (ArDrive Desktop, mid-2026).

**Two layers.** This document is the *framework* (principles). Each product binds it with a thin instance doc that supplies the specifics — IDs, file paths, test commands, credentials, decisions. For ArDrive that binding is [`product/PROCESS.md`](./product/PROCESS.md). **To start a new product: copy this file, write a one-page binding, done.**

> Design tenet (Anthropic, *Building Effective Agents*): **start with the simplest thing that works; add orchestration only when it measurably improves outcomes.** Most tasks are a single agent with good tools and a tight loop — not a swarm. Reach for the fleet when the work is genuinely decomposable, adversarial verification pays off, or one context can't hold the scope.

---

## 1. The core model — roles + one loop

Three functional roles. They are *roles*, not necessarily three different agents — on a small task the coordinator plays all three inline; the split exists so that **no one certifies their own work.**

| Role | Who | Owns | Must never |
|---|---|---|---|
| **Coordinator (PM)** | The main session | Selecting work, dispatching, merge decisions, keeping the ledger + decisions current, escalation | Implement *and* verify the same item (no self-review) |
| **Implementer** | A subagent, one item per invocation | Code + tests on an isolated branch/worktree; honest self-report (CHANGED / VERIFIED / NOT-VERIFIED / RISKS / BRANCH) | Self-certify done; touch the mainline; exceed the item's scope; spend real money |
| **Verifier (QA gate)** | An *independent* subagent | Adversarial check against acceptance criteria + full regression gates; PASS / PASS(static) / FAIL with evidence | Fix product code; pass on vibes; verify work it helped design |

*(Add specialized roles as a product needs them — e.g. a **Designer** for visual work, a **Researcher** for read-only investigation. Same contract: scoped deliverable, independent verification, no self-certification.)*

**The loop, per unit of work:**
1. **Coordinator selects** the next item by dependency/priority order and writes the dispatch: the goal, the acceptance criteria, relevant prior decisions, and known coupling with other in-flight work.
2. **Implementer** works it on an isolated branch, implements + tests, self-verifies, reports honestly (including what it could *not* verify).
3. **Verifier** independently checks that branch criteria-by-criteria, runs the full gates, exercises the behavior where drivable, and hunts regressions in the blast radius. Verdict with evidence.
4. **On FAIL** → the *same* implementer (continue its context) gets the fail-reasons for a fix iteration → re-gate. **N consecutive fails (default 3)** → coordinator stops and reassesses (wrong approach? split it? escalate?).
5. **On PASS** → coordinator reviews the diff, updates the ledger, merges, and **confirms the mainline is still green** (see §6). Files any verifier findings as new work.

---

## 2. Verification bar — "Definition of Done"

An item is done only when **all** hold (scale the depth to risk, never skip the categories):
1. Every acceptance criterion **met and evidenced** — never "should work."
2. Static gates green: typecheck (incl. test files), lint (no new errors), **full** test suite, build.
3. **≥1 behavioral test** asserting the fixed behavior (exceptions: pure-doc items, or explicitly-blocked test infra — say so in the note).
4. Conforms to recorded decisions; the work ledger is updated **in the same change**.
5. Independent verifier PASS. `PASS(static)` is acceptable only where the environment genuinely can't drive the flow — list the unexercised criteria for the next manual pass.

**The regression floor rises as you go.** The full suite runs at every gate; any regression *anywhere* fails the gate regardless of the item under review. Every merged item grows the suite, so quality ratchets up, never down.

---

## 3. Orchestration patterns — pick the shape that fits

Map the work to a shape; don't default to "spawn agents." (These mirror Anthropic's agent/workflow taxonomy — §9.)

- **Inline (no subagent).** Mechanical or tiny work — doc edits, a one-line fix, run-a-command-and-read. The coordinator just does it. *Most work is here.* A subagent has real overhead (a fresh context, a full suite re-read); only pay it when the isolation or parallelism is worth it.
- **Single implementer → verifier.** The default for a real change. One isolated lane, one adversarial gate.
- **Parallel fan-out (sectioning).** Independent items in separate worktrees at once — different subsystems, no shared files. The coordinator checks file overlap first and **serializes anything touching a shared high-fanout file** (the mainline entrypoint, the shared API surface). Wall-clock scales; the merge is where the risk concentrates (§6).
- **Analysis-first fan-out.** For a fuzzy problem, dispatch several **read-only** analysts in parallel across dimensions (integration, change-history, forensics, empirical build) → each writes a findings doc → coordinator synthesizes → *then* decides the fix. **Analyze before concluding.** (This is how a "why is X broken?" question becomes an evidence-backed plan instead of a guess.)
- **Adversarial verify / voting.** For high-stakes findings, spawn independent verifiers prompted to *refute*; accept only on majority survival. Kills plausible-but-wrong conclusions.
- **Reproduce-before-concluding.** For a bug report, **reproduce it empirically** (drive the real tool, hit the real endpoints) before naming a cause. A live repro beats any amount of code-reading theory, and it protects you from "fixing" the wrong thing.

**Choosing:** simplest shape that covers the risk. Wide/uncertain solution space → analysis-first or voting. Decomposable coverage → fan-out. A single well-specified change → single implementer. Trivial → inline.

---

## 4. Cost & model economics

Multi-agent loops are **token-heavy** — Anthropic measured agents at ~4× a chat and multi-agent systems at ~15× (§9). A high-assurance loop (implementer + adversarial gate + full-suite re-reads, multiplied by parallel lanes on one budget) can drain a spend limit fast. This is real; budget it deliberately.

- **Right-size the model per dispatch, not one-size-fits-all.** Top-tier model for anything touching money / security / data-integrity / correctness — *and for every verifier* (a dumb gate is worse than none: false confidence). Mid-tier for well-scoped moderate-risk implementation and test-writing. Cheapest/inline for mechanical work.
- **Lean by default.** The coordinator does small/doc/mechanical items inline (no implement→verify cycle). Reserve the full adversarial loop for genuinely risky change.
- **Scale verification depth to risk.** Don't rebuild fixtures and mutation-test a cosmetic cleanup.
- **Targeted runs while iterating; one full suite at the gate.** Consider trusting a green CI run over re-running everything locally.
- **Fewer concurrent lanes when budget-bound** — parallelism multiplies burn against one shared budget.
- **Scale to the ask.** "Quick check" → a couple of agents, single-vote. "Be exhaustive / audit this" → larger pool, multi-vote verify, synthesis pass.

---

## 5. Safety rails (product-agnostic categories)

Every product instance fills these in with specifics; the categories are universal.
- **Money / irreversible actions.** The loop spends nothing beyond a sanctioned, capped protocol. Anything that costs real money, publishes, releases, tags, or deletes something the loop didn't create **stops for the human**. Prefer a free tier / dry-run / disposable resource for verification.
- **Secrets.** No key material, passwords, or tokens in code, logs, tests, fixtures, or reports — reference by path/handle only. The verifier greps for leaks every gate.
- **Version control.** Agents never push or merge to shared branches. Branch-per-item; the coordinator keeps the mainline green; merges follow the human's delegation setting. A live repo the loop mutates has **one authoritative checkout** — pin it explicitly (see §7).
- **Real user data.** No agent touches real user/production data. Verification uses disposable fixtures.
- **The human is the release + product-decision authority.** The loop proposes; the human disposes on anything outward-facing or strategic.

---

## 6. Resilience — the non-obvious rules that keep a fleet from lying to you

These are the hard-won ones. Each was learned by getting burned.

- **Post-merge full-suite is mandatory** whenever any *code* commit landed on the mainline after a gated branch's base. A branch's gate proves the branch, **not the combination** — two changes green individually can auto-merge textually and break behaviorally. If red: hotfix immediately, priority over all lanes.
- **A timed-out or unfinished suite is NOT a pass.** If the full run hits a tool timeout or spews errors, do not fall back to "the targeted files passed" and merge — that's how a shared-component regression ships. Re-run with a long explicit timeout and **confirm you see the real `N passed` summary line**; run it when parallel lanes are idle (CPU contention breeds flakes that mask real failures). For any change to a shared/high-fanout surface, a clean *full* pass is mandatory before merge.
- **Defend against a missing dependency at the boundary.** Optional runtime hooks/APIs a component consumes should degrade (`?.`), not crash, when absent — the exact gap a unit test's mock exposes and a full suite catches.
- **Subagents self-extend and burn budget.** Left loose, an agent will run for hours, stage releases, edit governance docs, and take on unrequested work. **Every brief gets a hard-scoped deliverable + an explicit stop condition** ("STOP when done; do not self-continue, stage branches/releases, or take adjacent work without a new instruction"). To halt a runaway, a **stand-down message** to the agent works; a task-kill often does not (it reports "completed" while the agent keeps going). **Resume a stalled agent via message** (its context survives) rather than re-dispatching from scratch.
- **Pin the worktree in every brief.** Agents default their working directory to whatever checkout is lying around — often a stale one. State the exact path. A live multi-checkout repo needs one named authoritative worktree; isolated lanes branch from it and share its installed dependencies (symlink, never reinstall per-lane).
- **DB-shaped fixtures for DB-derived tests.** If production data crosses a boundary in a raw shape (integer booleans, nulls), tests must use that shape — clean-object fixtures pass while production breaks.
- **Verify the agent's claim, don't trust the report.** On any risky lane, the coordinator independently checks the critical invariant (the migration is lossless, the guard actually denies, the icon actually renders) before merging. Reports are evidence, not proof.

---

## 7. Multi-session coordination & state

- **The work ledger is the source of truth and the claim ledger.** Any session claims an item by committing its status flip; before dispatching, check status + recent history for claims. Never double-claim. State lives in the ledger so any session (or a post-compaction coordinator) resumes cold.
- **Keep a live task tracker** of in-flight lanes + the queue, so orchestration state survives the coordinator's own context compaction.
- **Direct human instruction to an agent wins** over that agent's standing rails; the agent notes it and the coordinator reconciles the record after. Route follow-ups on *finished* items through the coordinator (one writer per checkout).
- **Orphaned verdicts route to the coordinator** — a gate whose requesting session is gone lands with the main conversation to adjudicate and close out.

---

## 8. Cross-repo & cross-product work

When a change spans repositories (an app + its upstream library):
- **Know each repo's real base branch** — the PR target isn't always the default branch (a repo's `HEAD` can point at a branch that trails the release line). Confirm the base against an existing PR before branching, or the PR lands `CONFLICTING`.
- **Upstream fixes ride the same 100%-verified bar** as local ones: upstream tests → PR → pinned consumption → downstream verification green.
- **Publishing/versioning is a cascade, gated on the human's credential step.** e.g. publish the library → bump the consumer's pin → verify → repeat downstream. The loop preps every step and stops at the credentialed publish.
- **Interop/contract tests** guard a shared format across consumers — a change to the shared surface must pass the cross-consumer vector, not just unit tests.

---

## 9. Alignment with Anthropic's published guidance — honest scorecard

Benchmarked against 8 primary Anthropic sources (2024–2026): *Building Effective Agents* (S1), *Multi-Agent Research System* (S2), *Writing Tools for Agents* (S3), *Effective Context Engineering* (S4), *Building Agents with the Claude Agent SDK* (S5), *Claude Code Best Practices* (S6), *Demystifying Evals* (S7), *Harness Design for Long-Running Apps* (S8). Full extraction + citations: [`research/ANTHROPIC-BEST-PRACTICES.md`](./research/ANTHROPIC-BEST-PRACTICES.md).

**How the pattern names map** (Anthropic → this framework): parallelization/*sectioning* → §3 fan-out; parallelization/*voting* → §3 adversarial verify; *orchestrator-workers* → §1 coordinator→implementer; *evaluator-optimizer* → the FAIL→fix→re-gate loop (§1.4); the *gather→act→verify→repeat* agent loop (S5) → §1; the generator/evaluator *harness* + "sprint contract" (S8) → §1 + the acceptance-criteria dispatch.

### Scorecard

| Anthropic principle | Us | Evidence / gap |
|---|---|---|
| **Start simple; add agents only when they help** (S1 — *their #1 most-violated*) | **Strong** | §3 inline-first; "most work is inline"; simplest shape that covers the risk |
| **Don't let the producer grade itself; fresh-context evaluator** (S6/S8 — *their #2 most-violated, the "trust-then-verify gap"*) | **Strong** | §1 no self-review; §6 verify-the-claim; adversarial gates are institutional, not optional |
| **Give the agent a runnable check; show evidence not assertion** (S6) | **Strong** | §2 DoD (typecheck/lint/full-suite/build); reports must carry evidence |
| **Grade end-state, not trajectory** (S2/S7) | **Strong** | gates check the merged behavior + regression floor, not how the agent got there |
| **Respect token economics (~15× multi-agent); scale effort to complexity** (S2) | **Strong** | §4 — and we *lived* the 15× (a Fable-5 fan-out drained a monthly budget); right-size model per dispatch |
| **Plan for stateful failure: checkpoint/resume over restart** (S2/S8) | **Strong** | §6 resume-stalled-agent-via-message; §7 the ledger as durable, resumable state |
| **Guardrails, sandboxing, human-in-loop, transparent planning** (S1/S6) | **Strong** | §5 safety rails; §7 escalation; human owns spend/release |
| **Re-audit harness assumptions each model release** (S8) | **Partial** | we upgrade models but don't systematically re-test which rails a newer model made unnecessary |
| **Baseline the harness against a single agent** (S2/S8) | **Partial** | we choose orchestration by judgment (§3), not by measuring harness-vs-solo cost/quality |
| **Context engineering as first-class** (JIT retrieval, compaction, distilled subagent returns) (S4) | **Partial** | we do it in practice (ledger, task tracker, agents return ~summaries) but haven't codified it |
| **Track token usage as a first-order metric** (S2 — explains ~80% of perf variance) | **Gap** | we're cost-*aware* but don't systematically record tokens/cost per lane |
| **Eval-driven from day one: 20–50 real-failure tasks, unambiguous pass/fail, read transcripts** (S7/S2) | **Gap** | **our biggest gap** — see below |
| **Few, consolidated, well-described custom tools** (S3) | **N/A** | we use Claude Code's built-in tools; not building a custom tool surface |

### The one real gap worth closing: eval-driven operation

We rigorously verify **output** — does the code work — via the product's own test suite + adversarial gates. We do **not** yet have an eval harness that measures the **loop itself**: a small set of real past-failure tasks with unambiguous pass/fail that would tell us when the *agentic process* is degrading, plus systematic transcript review and grader calibration (S7). Today we read transcripts ad-hoc and catch process failures by getting burned (then writing a §6 rule). Anthropic's guidance is to make that a discipline, not an accident.

**Concrete upgrades (in priority order):**
1. **Stand up a small agent-eval set (~10–20 tasks) drawn from our own failure history** — e.g. a money-path TOCTOU, a DB-shape-fixture trap, a timed-out-suite false-pass, a subagent scope-creep. Each with a two-experts-agree pass/fail. Run it when the model or the process changes, to catch regressions in the *loop*. (S7)
2. **Record tokens/cost per lane** (the data already exists per task) so orchestration decisions are measured, not just felt — and so we can baseline a fan-out against a single agent. (S2)
3. **Codify context engineering** as an explicit § n (it's currently implicit): JIT retrieval, compaction-with-recall-first, distilled subagent returns, the ledger as external memory. (S4)
4. **A per-model-release rail audit**: when the coordinator/agent model changes, re-test which §6 rails a stronger model made unnecessary — don't carry assumptions forward blindly. (S8)

### Net

The framework is a concrete, battle-tested implementation of the orchestrator-worker + evaluator-optimizer patterns Anthropic recommends, and it is **strong exactly where Anthropic says teams most often fail** — starting simple and refusing to let the producer grade itself. It even *adds* value beyond the general guidance: §6 is a catalog of live-fleet operational failure modes (semantic merge conflicts, timed-out-suite false-pass, subagent self-extension) more specific than the published material. Where it trails is the **measurement layer** — formal evals, token accounting, and single-agent baselining — which is the natural next investment as this scales to more products.

---

## 10. Bootstrapping this framework on a new product

1. **Write the one-page binding** (the product's `PROCESS.md`): its work-ledger location, branch/worktree layout + authoritative checkout, test/lint/build commands, the money/secret specifics, the release authority, and any product-specific decisions.
2. **Stand up the verification floor first** — a working test suite + a gated CI that actually fails on regressions. Everything else leans on this.
3. **Seed the ledger** with acceptance-criteria'd items.
4. **Define the agent roles** for the stack (implementer, verifier, plus any specialists).
5. **Run the loop** — start with single-implementer lanes; add fan-out once the floor is trustworthy.

The framework is the constant. The binding is the only thing that changes per product.
