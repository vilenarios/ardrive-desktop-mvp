# ArDrive CLI Modernization — Analysis Synthesis + Plan

**2026-07-14 · triggered by a Discord "turbo-gateway.com timeout on CLI upload" report + "is the CLI on the latest core-js?"**

Four parallel read-only analyses (full detail in `research/01..04-*.md`). This synthesizes them, answers the Discord question with evidence, and lays out the sequenced plan. **All four lanes converge with no contradictions.**

## TL;DR
1. **The CLI is stale:** `ardrive-cli@4.0.0` pins `ardrive-core-js@4.0.0` (Feb 2026); none of our 4.1.0 (snapshot/incremental/CORE-5/6) or 4.2.0 (page-size) work reached it.
2. **The Discord timeout is NOT a version bug** — it's a **user gateway-config issue**. `turbo-gateway.com` is not on the CLI upload path by default (zero references in CLI/core-js/turbo-sdk); it only gets there if the user set `--gateway`/`ARWEAVE_GATEWAY` to it. A core-js bump would not fix it.
3. **The real blocker to "bring the CLI up to speed" is DISTRIBUTION, not code:** our newer core-js is **not published to npm** (npm `latest` = 4.0.0). The API delta 4.0.0→4.1.0 is **0 breaking / 0 needs-change** (empirically confirmed: bump compiles + builds clean, no new test regressions). So once core-js 4.1.0 is published, the CLI bump is nearly mechanical.
4. **A real robustness bug surfaced** (independent of all the above): core-js `GatewayAPI` has **no client-side HTTP timeout** (+8 retries ~127s backoff + a 60s-per-429 loop that doesn't count against retries) — a slow gateway presents as a long *hang* rather than a clean error. This is the closest thing to a genuine "fix" for the class of symptom the Discord user hit. Tracked as a core-js candidate.

## Lane findings

### 01 · Integration & API delta
- **Version story:** `ardrive-core-js@4.0.0` = the real npm-published `latest` (git tag `v4.0.0`). core-js `master` (`0e0c1a5`, self-declares 4.1.0) is **git-only, unpublished**; the "4.2.0" page-size work is 3 further commits on the **still-open** PR #275. Highest npm version = 4.0.0.
- **Coupling:** the CLI consumes **72 core-js symbols** (70 via the public barrel, **2 via deep `lib/…` internal paths** — `turboProdUrl`, `ArFSTagSettings`).
- **Delta 4.0.0 → 4.1.0: 72 SAFE, 0 needs-change, 0 breaking** (exports diff purely additive; changed interfaces only gained optional fields; `defaultGatewayHost`/`turboProdUrl` unchanged).
- **Biggest risk = distribution, not API:** consuming unpublished core-js forces a git-SHA install that must run core-js's `prepare` build hook to produce `lib/`; the 2 deep `lib/` imports make a correct build mandatory.

### 02 · Change cycle & release/CI
- **Model:** `PE-####` branches → `master` (or via `dev`); releases = manual version bump + CHANGELOG + tag `vX.Y.Z` + GitHub Release; **npm publish is fully manual (`yarn npm publish`), no automation.** CLI version has tracked core-js 1:1.
- **CI cannot catch an upgrade regression:** `yarn ci` = build (tsc) + 10 mocha files that only cover arg-parsing/utils — **never call ArFS create/upload/download**. Only a *type/API* break fails CI; a behavioral core-js regression passes green. `bats_test/` (needs a wallet) never runs in CI; CI is also ~25-30% flaky from a live-`arweave.net` unit test.
- **Precedent:** past core-js bumps were a **one-line dep bump + lockfile + CHANGELOG**, no src changes.
- ⚠️ **Security aside:** `test_wallet.json` (a committed **real JWK**) sits in the repo root, offline-test-only per the agent — worth a follow-up review (rotate/remove/confirm it holds nothing).

### 03 · Upload/gateway forensics (the "don't jump to conclusions" lane)
- An upload does **3 GraphQL reads against the configured gateway BEFORE any bytes** (drive resolution, privacy assert, conflict-resolution folder listing), then `/price`+`/balance`+`/tx`+`/chunk` (default) or `payment.ardrive.io`+`upload.ardrive.io` (`--turbo`).
- CLI default gateway = **`ardrive.net`** (overrides core-js's `arweave.net`). **`turbo-gateway.com` is on the path only via `--gateway`/`ARWEAVE_GATEWAY`.**
- **A core-js bump would not fix the timeout** (upload transport is version-invariant; our changes are read-path). Only marginal help: 4.2's page-size *could* slightly ease the pre-upload conflict-resolution GraphQL on a **large destination folder**.
- **Robustness bug:** `GatewayAPI` axios has **no timeout** + 8 retries + a 60s/429 loop → slow gateway = long hang.
- **Top-2 causes:** (1) user pointed their gateway at turbo-gateway.com and its GraphQL/chunk is slow/statement-timing-out; (2) transient turbo-gateway.com load on the same path.

### 04 · Build health & bump probe (empirical)
- **Baseline (4.0.0, unmodified):** typecheck/lint/build **PASS**; tests 84 pass / 3 fail — all 3 are network-flaky (`arweave.net` 429 / IPFS timeout), no core-logic failure.
- **Bump 4.0.0 → 4.1.0 (core-js properly built in): ZERO real breakages** — typecheck PASS, build PASS, no new regressions; all imports resolve. Categorized: trivial 0 / moderate 0 / structural 0.
- Only **operational** items: (a) unpublished 4.1.0 + a bare git-dep skips `prepare` → 54 *phantom* "cannot find module" errors that vanish once core-js's `lib/` is built; (b) new heavy transitive deps (Solana web3.js, Keplr) add peer-warning noise.

## The plan (sequenced; gates not dates)

**Step 0 — Publish core-js 4.1.0 to npm (OWNER-GATED, the unlock).** Master is already 4.1.0 (`0e0c1a5`), compiles clean, tarball structure correct, Phil is an npm owner. **Runbook** (clean checkout): `yarn install` → `yarn build` (tsc→`lib/`, verified clean) → **`yarn build:web`** (→`dist/web/`; the `prepare` hook does NOT build this, and `files` ships it — don't skip or browser consumers get a stale bundle) → `npm pack --dry-run` (confirm BOTH `lib/` and `dist/web/`) → `npm publish` (Phil's OTP) → tag `v4.1.0`.

**Step 1 — Desktop pin cleanup (I drive, after publish).** Swap `ardrive-core-js` from the git-SHA to `4.1.0` — a functional no-op (same commit) that de-uglifies the dependency. Verified lane (full suite).

**Step 2 — CLI bump to 4.1.0 (I drive, after publish).** Per precedent + the 0-breaking analysis: one-line dep bump + `yarn.lock` regen + CHANGELOG, on a `PE-`/feature branch. **Verification burden is ours** (CLI CI can't catch behavioral regressions) — so I drive a real upload/download smoke on a test drive (free-tier / dry-run, no funds) before it ships. Release + npm publish stays owner-gated.

**Step 3 — Fast-follow 4.2.0.** Once PR #275 merges → publish core-js 4.2.0 → repeat Steps 1-2 for the page-size/tunable improvements.

**Independent of the CLI: core-js `GatewayAPI` client-timeout fix** — add a bounded per-request timeout so a slow gateway fails cleanly instead of hanging ~127s. This is the real mitigation for the Discord symptom class and helps desktop + CLI + web alike. Tracked as a core-js candidate (authorized repo).

---

## UPDATE 2026-07-14 — VERIFIED root cause (supersedes the triage guesses above)

After the user clarified *"with no gateway flag it hasn't worked for some time,"* we **reproduced the hang** and instrumented the real CLI (axios interceptors, per-request timing). Full evidence: [research/05-CLI-HANG-ROOTCAUSE.md](./research/05-CLI-HANG-ROOTCAUSE.md). The "hang" is **three separable causes** — and it is a genuine client-side bug, **not** user misconfiguration and **not** a specific-gateway outage (individual endpoints on every gateway respond in <0.5s):

- **A — WSL2 `/mnt/c` startup tax (~70s; a TEST-ENV artifact, not the user's bug).** `require('ardrive-core-js')` alone took 73s over the 9p mount (36k `.js` files, eager-loaded). On a native FS this is ~1–3s. This is why *our* first repro "hung on every gateway" — it was startup before any HTTP. Not the user's production issue.
- **B — THE production bug: arweave.net 429 → infinite loop.** core-js `GatewayAPI.retryRequestUntilMaxRetries` paused **60s per HTTP 429 without incrementing any counter** → looped forever on a gateway that rate-limits every request (arweave.net now does, for CLI traffic). This is the "hasn't worked for some time."
- **C — slow ar.io data-tx fetches.** `GET /{txid}` 302-redirects to a per-tx sandbox subdomain serving in 12–24s+, and there was **no axios timeout** → multi-entity drives accumulate minutes.
- **NOT the ClickHouse `TOO_MANY_ROWS` row cap** — every query core-js *actually* sends returned 200 + valid data in <0.5s. (An earlier hand-crafted broad query tripped the cap; core-js's own scoped queries don't. Corrected.)

### The fix: two-part, scoped apart

**1. Robustness (stop the hang) — shipped in core-js PR #278 (`439df56`), verified + e2e-tested, owner-gated merge.**
   - **Bounded 429 retries** (cause B): a *separate* `rateLimitRetries` counter (default 5, configurable) — a persistent 429 now fails with a clear `"Gateway is rate limiting… try a different --gateway or wait and retry"` instead of hanging. The error-retry budget stays independent, so **transient-throttle tolerance is preserved (no regression)** — our desktop app + on-chain test harness that deliberately wait out arweave.net 429s still work.
   - **Bounded request timeout** (cause C): axios `timeout` so a slow data fetch fails cleanly.
   - TOO_MANY_ROWS fail-fast kept as harmless defense-in-depth.
   - **E2E proof** (real local 429 server, real axios/timers): persistent-429 → clean failure in **806ms** (was infinite); 429×2→200 control → **succeeds in 444ms** (no regression). Full core-js suite +5 tests, no regressions.

**2. Functionality (make it actually *work*) — OPEN item, needs Phil's product decision (see below).** #278 converts the hang into a fast clean error, but a user pointed at a rate-limiting gateway still can't upload. Restoring that is a gateway-strategy change.

### OPEN — Gateway strategy decision (CLI-2 / a CORE item)
The real "make it work again" fix, needing a product call:
- **The v4.0.0 default-gateway flip** (`arweave.net → ardrive.net`, an ar.io gateway) was deliberate — but ar.io gateways serve GraphQL fast yet data-tx slowly, and arweave.net now 429s CLI traffic. Neither default is clearly good. **Decision needed: what should the CLI default to?**
- **Gateway fail-over on persistent 429/slow** — core-js `GatewayAPI` is single-gateway; desktop got fail-over at a higher layer (SYNC-23). Adding fail-over *in* core-js would help CLI + desktop + web. Bigger change; recommend as its own core-js item.
- **Lazy-load CLI commands** (startup, cause A) — low priority; helps even on native FS.

Recommendation: merge #278 (robustness) now; take the gateway-strategy decision as a separate tracked item.

## Discord reply (UPDATED — it's a known client bug we're fixing, not their config)
> Thanks for the detail — you're right, and it's on us, not your setup. It's a known client-side bug in the CLI's gateway layer: when a gateway rate-limits (HTTP 429), the CLI paused 60s and retried **without ever giving up**, so it hangs indefinitely instead of erroring — and arweave.net has been rate-limiting CLI traffic, which is why "no `--gateway` flag" stopped working. We've got a fix up in `ardrive-core-js` (bounds the retries + adds a request timeout, so it fails fast with a clear message instead of hanging) landing in the next release. **Immediate workaround:** try `--gateway https://turbo-gateway.com` (or another ar.io gateway) — GraphQL there is fast; large drives may still be slow on data fetches, which the same fix addresses. If you can share your exact command + drive size, I'll confirm it matches what we fixed.
