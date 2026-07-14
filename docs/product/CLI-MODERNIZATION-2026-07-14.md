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

## Discord reply (draft — triage, not a version promise)
> That hostname isn't on the CLI's upload path by default — uploads go to `upload.ardrive.io` (with `--turbo`) or your configured `--gateway`, and reads/GraphQL go to whatever gateway you've set. If you're seeing `turbo-gateway.com` specifically, do you have `--gateway https://turbo-gateway.com` or `ARWEAVE_GATEWAY` set? Both `turbo-gateway.com` and `upload.ardrive.io` are healthy right now, so it looks transient or config-related. Can you share: your exact command, `echo $ARWEAVE_GATEWAY`, whether you used `--turbo`, the file size, and whether the same upload succeeds with `--gateway https://arweave.net`? That'll pin it down fast.
