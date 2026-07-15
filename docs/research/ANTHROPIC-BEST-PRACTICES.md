# Anthropic Best Practices for Agentic / Multi-Agent Engineering Systems

Primary-source research to benchmark an in-house "agentic development loop" against Anthropic's current (2024–2026) published guidance. Every claim below is tied to a fetched primary source with its URL and publish date. Fetched 2026-07-14; all sources are Anthropic engineering/docs primary publications.

## Sources (primary, dated)

| # | Title | URL | Publish date |
|---|-------|-----|--------------|
| S1 | Building effective agents | https://www.anthropic.com/engineering/building-effective-agents | 2024-12-19 |
| S2 | How we built our multi-agent research system | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 |
| S3 | Writing effective tools for AI agents | https://www.anthropic.com/engineering/writing-tools-for-agents | 2025-09-11 |
| S4 | Effective context engineering for AI agents | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 2025-09-29 |
| S5 | Building agents with the Claude Agent SDK | https://claude.com/blog/building-agents-with-the-claude-agent-sdk (redirect from anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) | 2025-09-29 |
| S6 | Best practices for Claude Code | https://code.claude.com/docs/en/best-practices (redirect from anthropic.com/engineering/claude-code-best-practices) | Living doc (current as of fetch 2026-07-14) |
| S7 | Demystifying evals for AI agents | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-01-09 |
| S8 | Harness design for long-running application development | https://www.anthropic.com/engineering/harness-design-long-running-apps | 2026-03-24 |

---

## 1. Architecture & Orchestration

### Workflows vs. agents — the core taxonomy (S1, 2024-12-19)
- **Workflows**: "systems where LLMs and tools are orchestrated through predefined code paths." Offer predictability/consistency for well-defined tasks.
- **Agents**: "systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks." Better when flexibility and model-driven decision-making are needed at scale.
- Building block: an LLM augmented with retrieval, tools, and memory.

### The five workflow patterns + autonomous agents (S1)
1. **Prompt chaining** — decompose into fixed sequential steps; "ideal for situations where the task can be easily and cleanly decomposed into fixed subtasks."
2. **Routing** — classify input, direct to specialized handler; "works well for complex tasks where there are distinct categories that are better handled separately."
3. **Parallelization** — two forms: *sectioning* (independent subtasks run in parallel) and *voting* (same task run multiple times for multiple perspectives); "effective when the divided subtasks can be parallelized for speed, or when multiple perspectives are needed."
4. **Orchestrator-workers** — central LLM dynamically decomposes, delegates to workers, synthesizes; "well-suited for complex tasks where you can't predict the subtasks needed" (e.g., multi-file code changes).
5. **Evaluator-optimizer** — one LLM generates, another evaluates/gives feedback in a loop; "particularly effective when we have clear evaluation criteria, and when iterative refinement provides measurable value."
6. **Autonomous agents** — operate independently in a tool-use loop on environmental feedback; for "open-ended problems where it's difficult or impossible to predict the required number of steps." Carries "higher costs, and the potential for compounding errors."

### Orchestrator-worker at scale (S2, 2025-06-13)
- Lead agent (orchestrator) analyzes query, plans, spawns subagents (workers) exploring in parallel; subagents return filtered findings; lead synthesizes and decides whether to spawn more.
- Lead saves its plan to Memory to prevent loss if context exceeds 200,000 tokens.
- Spin up **3–5 subagents in parallel** (not serially); subagents use **3+ tools in parallel** — "cut research time by up to 90% for complex queries."
- Subagents output to filesystem/external systems, passing lightweight references back to avoid a "game of telephone" information-loss effect.

### The "agent loop" and "give Claude a computer" (S5, 2025-09-29)
- Four-phase loop: **gather context → take action → verify work → repeat** (iterate until done).
- Philosophy: give the agent "the same tools that programmers use every day" — file system, bash, execution — so it works like a human does.
- Execution hierarchy: **Tools** for frequent intended actions (most prominent in context); **Bash/scripts** for flexible general work; **code generation** for precise, composable, reusable operations; **file system as context** (grep/tail to extract from large files).
- Start with **agentic search** (transparent, accurate); add semantic search only if speed demands it.

### Harness design for long-running work (S8, 2026-03-24)
- A harness is "a multi-agent structure with a **generator** and **evaluator** agent" that decomposes tasks and applies feedback loops across extended sessions.
- **Sprint contract pattern**: generator and evaluator negotiate what "done" looks like for a chunk of work *before any code is written*.
- **Decompose into tractable chunks** to prevent coherence loss over long tasks.
- **Reassess harness components with each model release**: "Every component in a harness encodes an assumption about what the model can't do on its own... those assumptions are worth stress testing." (Newer models, e.g. Opus 4.6, eliminated the need for context resets that older models required.)

---

## 2. Cost & Token Economics

### The headline multipliers (S2, 2025-06-13)
- Agents use **~4× more tokens** than chat interactions.
- Multi-agent systems use **~15× more tokens** than chats.
- Therefore multi-agent "require tasks where the value of the task is high enough to pay for the increased performance" — economic viability gate.

### What drives performance (and cost) (S2)
- On BrowseComp: **token usage alone explains 80% of performance variance**; token usage + tool calls + model choice explain **95%**.
- Multi-agent (Opus 4 lead + Sonnet 4 subagents) beat single-agent Opus 4 by **90.2%** on internal research eval.
- Query-complexity scaling rule embedded in prompts: simple fact-finding = 1 agent / 3–10 tool calls; comparisons = 2–4 subagents / 10–15 calls each; complex research = 10+ subagents with divided responsibilities. (Anti-pattern: spawning 50 subagents for a simple query.)

### Harness cost is real and must be justified (S8, 2026-03-24)
- Same task: solo agent = 20 min / **$9**; full harness = 6 hr / **$200** ("over 20× more expensive, but the difference in output quality was immediately apparent").
- Three-agent DAW build: 3 hr 50 min / **$124.70**.
- Principle: **baseline against single-agent attempts** — harness overhead is only justified by measurable quality improvement.

### Cost/latency framing (S1, S5)
- "Agentic systems often trade latency and cost for better task performance" (S1). Decide whether that tradeoff is worth it.
- LLM-as-judge verification "boosts performance but adds latency and cost" (S5).

---

## 3. Verification & Evaluation

### Give the agent a way to verify its own work (S6, living doc)
- "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal available, and you become the verification loop."
- A check is anything returning a pass/fail signal: test suite, build exit code, linter, a script diffing output against a fixture, or a browser screenshot vs. a design.
- Gating strength ladder: in-one-prompt → `/goal` condition re-checked every turn → **Stop hook** (deterministic gate; Claude Code overrides after 8 consecutive blocks) → **second opinion** via a verification subagent in fresh context.
- "Have Claude show evidence rather than asserting success" (test output, command + result, screenshot).

### Independent / adversarial review (S6, S8)
- Use a reviewer subagent in a **fresh context** that "sees only the diff and the criteria you give it, not the reasoning that produced the change" — the agent doing the work shouldn't grade it (S6).
- Self-evaluation bias is real: "When asked to evaluate work they've produced, agents tend to respond by confidently praising the work — even when… the quality is obviously mediocre" (S8). Fix: separate calibrated evaluator agent with hard per-criterion thresholds.
- Caution: a reviewer told to find gaps "will usually report some, even when the work is sound." Tell it to flag only correctness/requirement gaps, else over-engineering results (S6).

### Verification methods and tradeoffs (S5, 2025-09-29)
| Method | Mechanism | Tradeoff |
|--------|-----------|----------|
| Rules-based / linting | Formal feedback rules | Most robust; needs formal specs |
| Visual feedback | Screenshots/renders for UI | Great for visual work; single-viewport limit |
| LLM-as-judge | Separate model grades fuzzy criteria (tone, quality) | Boosts performance; adds latency + cost |

### Eval-driven development (S2, S7)
- **Start small, immediately**: ~20 queries (S2) / **20–50 tasks drawn from real failures** (S7) — don't wait for hundreds. Early on "changes tend to have dramatic impacts" (prompt tweaks moved success 30%→80%).
- **Unambiguous specs**: "A good task is one where two domain experts would independently reach the same pass/fail verdict" (S7). Document a reference solution proving each task is solvable.
- **Grade end-state / outcome, not the process/trajectory**: "agents regularly find valid approaches that eval designers didn't anticipate" (S7); focus on "whether it achieved the correct final state" (S2). Use discrete checkpoints for complex workflows.
- **Grader types**: code-based (fast, cheap, objective, reproducible, but brittle) + LLM-as-judge (flexible, scalable, but non-deterministic, needs human calibration; give it an "Unknown" option and structured per-dimension rubrics) + human eval (gold standard, expensive; essential to calibrate model graders). Combine types.
- **Metrics to track**: accuracy/pass rates (pass@k, pass^k), tool-call patterns, turns, token usage, latency (TTFT, tokens/sec, total), cost per task, error rates (S7).
- **Read transcripts regularly** — "You won't know if your graders are working well unless you read the transcripts"; failures should "seem fair" (S7). Watch for eval saturation (100% pass = no signal).
- Concrete illustration of grader bugs mattering: Opus 4.5 on CORE-Bench went 42% → 95% *after fixing grading issues* (rigid grading penalizing "96.12" vs "96.124991…") (S7). SWE-bench Verified moved 40% → >80% in a year (S7).

### Tool evaluation loop (S3, 2025-09-11)
- Build realistic eval tasks that "require multiple tool calls — potentially dozens," pair prompts with verifiable outcomes, run programmatically via a simple agentic loop, collect accuracy/runtime/tool-call-count/token/error metrics.
- **Let agents improve tools**: paste eval transcripts into Claude Code; "agents are your helpful partners in spotting issues." Use a **held-out test set** to prevent overfitting. Tool-description refinement yielded a **40% decrease in task completion time** (S2).

---

## 4. Context Engineering & Tool Design

### Context is a finite, precious resource (S4, 2025-09-29)
- Goal: "finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome."
- **Context rot**: "As the number of tokens in the context window increases, the model's ability to accurately recall information… decreases." LLMs have a finite "attention budget"; every token depletes it (n² pairwise relationships in transformers).
- **System prompt at "the right altitude"**: neither brittle hardcoded if-else logic nor vague high-level guidance — "specific enough to guide behavior… yet flexible enough." Organize with sections / XML tags / Markdown headers.
- **Just-in-time retrieval**: keep lightweight identifiers (file paths, queries, links); load data at runtime instead of pre-loading everything (Claude Code queries large DBs with head/tail rather than loading full objects).
- **Compaction**: summarize a near-full context and reinitialize; "maximize recall first… then iterate to improve precision." Safe low-touch version = tool-result clearing.
- **Structured note-taking / external memory**: agent writes notes to persistent memory outside context, pulled back later (Claude playing Pokémon tracked state across 1,000s of steps). Memory tool available on the Claude Developer Platform.
- **Sub-agent architectures for context**: subagents explore with "tens of thousands of tokens or more, but return only a condensed, distilled summary… (often 1,000–2,000 tokens)" — clean separation of concerns.

### Effective tool design (S3, 2025-09-11)
- **Consolidate**: build tools that do multi-step work under the hood (`schedule_event`, `search_logs`) rather than thin wrappers around each API endpoint.
- **Namespace** tools with common prefixes (`asana_search`, `jira_search`) to reduce selection confusion.
- **Return high-signal context**: semantic names over technical IDs (`name` not `uuid`); offer a `response_format` enum (`"concise"` vs `"detailed"`).
- **Token efficiency**: pagination + range selection + filtering + truncation with sensible defaults; Claude Code truncates responses at **25,000 tokens** by default. Concise vs detailed example: 72 vs 206 tokens (~⅓).
- **Prompt-engineer tool descriptions**: "Even small refinements to tool descriptions can yield dramatic improvements"; unambiguous parameter names (`user_id` not `user`); make implicit context explicit. Give tool specs as much attention as the main prompt.
- **Fewer, better tools**: "More tools don't always lead to better outcomes." Target a few high-impact workflows; avoid unnecessary `list_*` tools that waste context. Corroborated by S4: "If a human engineer can't definitively say which tool should be used… an AI agent can't be expected to do better."

### CLAUDE.md / persistent project context conventions (S6)
- Special file read at the start of every conversation; include bash commands Claude can't guess, code-style rules differing from defaults, testing instructions, repo etiquette, project-specific architecture decisions, env quirks, and non-obvious gotchas.
- **Exclude** anything Claude can infer from code, standard conventions, frequently-changing info, long tutorials, file-by-file descriptions, self-evident practices.
- "Keep it concise… Bloated CLAUDE.md files cause Claude to ignore your actual instructions." Test rule: for each line ask "Would removing this cause Claude to make mistakes?"; if Claude keeps violating a rule, the file is probably too long. Treat it like code (review, prune, check into git).
- For sometimes-relevant knowledge use **skills** (loaded on demand), not CLAUDE.md.

---

## 5. Safety, Guardrails & Reliability

### Guardrails and sandboxing (S1, S6)
- Agents need "extensive testing in sandboxed environments, along with the appropriate guardrails" (S1).
- **Permissions**: default to prompting for system-modifying actions; reduce interruptions via auto mode (classifier blocks scope escalation / unknown infra / hostile-content-driven actions), permission allowlists (`--allowedTools`), or OS-level sandboxing. Restrict tools especially for unattended/batch runs (S6).
- **Hooks** are deterministic guarantees ("actions that must happen every time with zero exceptions") vs. advisory CLAUDE.md instructions (S6).

### Production reliability & failure modes of stateful agents (S2, S8)
- **Errors compound**: agents are stateful across many tool calls; "minor changes cascade into large behavioral changes"; "minor system failures can be catastrophic." Prefer **resume-from-checkpoint over restart** (S2).
- **Emergent behavior**: "Small changes to the lead agent can unpredictably change how subagents behave" — understand interaction patterns, not just individual agents (S2).
- **Non-determinism**: add full production tracing to debug; monitor decision/interaction patterns (S2).
- **Deployment**: agents are "highly stateful webs of prompts, tools, and execution logic"; use rainbow deployments to shift traffic gradually (S2).
- **Synchronous bottleneck**: synchronous subagent execution blocks on the slowest subagent and prevents mid-flight steering (S2).
- **Coherence loss / context anxiety** on long tasks: models "begin wrapping up work prematurely as they approach what they believe is their context limit"; mitigate with context resets + structured handoff artifacts, or a stronger model (S8).

### Transparency (S1)
- "Prioritize transparency by explicitly showing the agent's planning steps." Carefully craft the agent-computer interface (ACI) via thorough tool documentation and testing.

---

## 6. When NOT to Use Agents / Multi-Agent

### Start simple — the central thesis (S1, 2024-12-19)
- "The most successful implementations weren't using complex frameworks… they were building with simple, composable patterns."
- "Start with simple prompts, optimize them with comprehensive evaluation, and add multi-step agentic systems only when simpler solutions fall short."
- "For many applications… optimizing single LLM calls with retrieval and in-context examples is usually enough."
- Framework caution: frameworks "create extra layers of abstraction that can obscure the underlying prompts and responses, making them harder to debug" and tempt unnecessary complexity.

### When multi-agent does NOT pay off (S2, 2025-06-13)
- **Most coding tasks** (fewer truly parallelizable components).
- Domains where **all agents must share identical context**.
- Tasks with **many agent dependencies / real-time coordination** needs (current systems don't support subagent-to-subagent coordination well).
- **Low-value work** where the ~15× token burn isn't economically justified.

### Skip the ceremony when the task is small (S6)
- Plan mode "adds overhead… If you could describe the diff in one sentence, skip the plan." Small/clear fixes (typo, log line, rename) — do directly.

---

## 7. The Development Loop (Claude Code workflows) (S6)

### Explore → Plan → Code → Commit
1. **Explore** (plan mode): read files, answer questions, make no changes. Tell it explicitly not to code yet.
2. **Plan**: ask for a detailed implementation plan (name files, interfaces, session flow); edit the plan before proceeding.
3. **Implement**: switch out of plan mode; code while verifying against the plan; write + run tests, fix failures.
4. **Commit**: descriptive message + PR.

### Test-driven / Writer-Reviewer variants
- TDD: write tests first, commit them, then write code to pass them without modifying the tests, iterating until green.
- **Writer/Reviewer** across two sessions: a fresh context reviews the writer's code (unbiased toward code it just wrote). Or one Claude writes tests, another writes code to pass them.

### Context management in the loop
- `/clear` between unrelated tasks; after **two failed corrections**, `/clear` and rewrite a better prompt ("A clean session with a better prompt almost always outperforms a long session with accumulated corrections").
- Delegate research to **subagents** ("context is your fundamental constraint") so exploration doesn't pollute the main context.
- Use `/compact <instructions>`, checkpoints (`/rewind`), and named resumable sessions.
- **Course-correct early and often**; provide **specific context** (scope the task, point to sources, reference existing patterns, describe the symptom).

### Headless / CI / fan-out
- `claude -p "prompt"` for non-interactive CI/pre-commit/scripts; `--output-format json|stream-json` for programmatic parsing.
- **Fan-out** across many files: generate a task list, loop `claude -p` per item with scoped `--allowedTools`; test on 2–3 first, then run at scale.

### Named failure patterns (S6)
- **Kitchen-sink session** (unrelated tasks pile up) → `/clear`.
- **Correcting over and over** (context polluted with failed approaches) → `/clear` + better prompt.
- **Over-specified CLAUDE.md** (rules lost in noise) → ruthlessly prune / convert to hooks.
- **Trust-then-verify gap** (plausible code, unhandled edge cases) → always provide verification; "If you can't verify it, don't ship it."
- **Infinite exploration** (unscoped "investigate" reads hundreds of files) → scope narrowly or use subagents.

---

## Synthesized Anthropic Best-Practices Checklist

### A. Architecture / Orchestration
- [ ] Start with the **simplest** thing that works (single LLM call + retrieval/examples); add agentic complexity only when simpler solutions demonstrably fall short. (S1)
- [ ] Prefer **workflows** (predefined code paths) for well-defined tasks; reserve **autonomous agents** for open-ended, unpredictable-step problems in trusted environments. (S1)
- [ ] Match the pattern to the task: prompt chaining / routing / parallelization (sectioning+voting) / orchestrator-workers / evaluator-optimizer. (S1)
- [ ] Structure the agent as an explicit loop: **gather context → act → verify → repeat**. (S5)
- [ ] For orchestrator-worker: give the lead a plan it persists; spawn workers in parallel (3–5); have workers return distilled summaries + write detail to files/refs, not raw dumps. (S2, S4)
- [ ] Avoid framework abstraction that obscures prompts/responses; keep patterns composable and debuggable. (S1)

### B. Cost / Economics
- [ ] Budget for the multipliers: agents ~4×, multi-agent ~15× tokens vs chat. (S2)
- [ ] Only go multi-agent / full-harness when task value justifies the cost; **baseline against a single agent** and require measurable quality gain (harness can be 20×+ cost). (S2, S8)
- [ ] **Scale effort to query complexity** with explicit rules in the prompt; don't over-provision subagents/tool calls for simple tasks. (S2)
- [ ] Track token usage as a first-order metric — it explains ~80% of performance variance. (S2)

### C. Verification / Eval
- [ ] Give the agent a **check it can run** (tests, build, lint, fixture diff, screenshot) so the loop closes without a human. (S6)
- [ ] Have a **separate/fresh-context evaluator** grade the work; never let the producer be the sole grader (self-praise bias). (S6, S8)
- [ ] Grade **end-state/outcome**, not the exact trajectory/tool sequence. (S2, S7)
- [ ] Build evals **early and small** (20–50 real-failure tasks); specs unambiguous enough that two experts agree on pass/fail; keep a **held-out set**. (S2, S3, S7)
- [ ] Combine grader types (code-based + LLM-judge with structured rubric + "Unknown" option + human calibration). (S7)
- [ ] **Read transcripts regularly**; verify failures "seem fair"; watch for eval saturation and grader loopholes. (S7)
- [ ] Require the agent to **show evidence** (command + output/screenshot), not assert success. (S6)

### D. Context / Tools
- [ ] Curate the **smallest set of high-signal tokens**; treat context as a finite attention budget; expect context rot as it fills. (S4)
- [ ] Write the system prompt at "the right altitude" — concrete heuristics, not brittle if-else nor vague abstractions. (S4)
- [ ] Prefer **just-in-time retrieval** (identifiers loaded on demand) over pre-loading everything. (S4)
- [ ] Manage long horizons with **compaction (recall-first), external memory/notes, and subagents** that return 1–2k-token summaries. (S2, S4, S5)
- [ ] Design **few, consolidated, namespaced** tools that return semantic (not raw-ID) high-signal output with pagination/filtering/truncation defaults. (S3)
- [ ] Prompt-engineer tool descriptions and let agents help refine them against an eval. (S3, S2)
- [ ] Keep **CLAUDE.md concise** (only what prevents mistakes); push situational knowledge to skills; deterministic musts to hooks. (S6)
- [ ] `/clear` between unrelated tasks; after 2 failed corrections restart with a better prompt. (S6)

### E. Safety / Guardrails
- [ ] Test agents in **sandboxed environments** with guardrails before trusting autonomy. (S1)
- [ ] Scope **permissions/tool allowlists**, especially for unattended/batch/CI runs; use sandboxing or an auto-mode classifier. (S6)
- [ ] Use **deterministic hooks** for actions that must always happen. (S6)
- [ ] Plan for **compounding errors**: checkpoint + resume rather than restart; add tracing/observability for non-deterministic runs; deploy gradually (rainbow). (S2)
- [ ] Watch for **coherence loss / context anxiety** on long tasks; use resets + structured handoffs; **re-audit harness assumptions each model release**. (S8)
- [ ] Make the agent's **planning steps transparent**. (S1)

### F. When NOT to use agents
- [ ] Don't build an agent when a single optimized LLM call + retrieval suffices. (S1)
- [ ] Don't go multi-agent for coding-style tasks, shared-context tasks, tightly-coupled coordination, or low-value work. (S2)
- [ ] Skip planning ceremony for one-sentence-diff changes. (S6)

---

## The 6–8 Highest-Signal Principles Anthropic Emphasizes

1. **Start simple; add complexity only when it measurably helps.** The single most repeated and (in practice) most-violated principle — teams reach for multi-agent/framework machinery before proving a simpler pipeline is insufficient. (S1, S8)
2. **Give the agent a way to verify its own work, and don't let the producer grade itself.** Close the loop with a runnable check + a fresh-context/separate evaluator; agents skew to self-praise. (S6, S8, S5)
3. **Context is the fundamental constraint — engineer for the smallest high-signal token set.** Just-in-time retrieval, compaction, external memory, subagents that return distilled summaries. (S4, S6)
4. **Be eval-driven from day one** with small realistic task sets, unambiguous pass/fail, outcome (not trajectory) grading, and regular transcript reading. (S7, S2)
5. **Respect the token economics** — ~4× (agent) / ~15× (multi-agent) — and only pay it for high-value, parallelizable work; baseline every harness against a single agent. (S2, S8)
6. **Design few, consolidated, well-described tools** returning semantic high-signal output; tool descriptions deserve prompt-engineering attention. (S3, S4)
7. **Plan for stateful failure**: errors compound, so checkpoint/resume, trace, and deploy gradually rather than assuming clean runs. (S2, S8)
8. **Scale effort to task complexity** and keep CLAUDE.md/system prompts at the right altitude — concrete but not brittle, concise not bloated. (S2, S4, S6)

**Most-often-violated in practice:** #1 (start simple / justify complexity), closely followed by #2 (independent verification — the "trust-then-verify gap" that Claude Code best practices calls out by name). (S1, S6)
