# ardrive-cli — Change Cycle & Release Analysis

**Repo:** `/mnt/c/source/ardrive-cli` · **Branch:** `master` · **Version:** `4.0.0`
**Analysis date:** 2026-07-14 · Read-only; no deps installed, nothing modified/pushed.
**Upstream:** `github.com/ardriveapp/ardrive-cli` · **npm:** `ardrive-cli` (published, `latest = 4.0.0`)

---

## 1. Branch & Release Model

### Branch topology (from `git branch -a`)
- **`master`** — the release branch. Tip is `481fe57 Merge pull request #376 from ardriveapp/dev`, tagged `v4.0.0`.
- **`dev`** — integration branch. **Currently in sync with master, NOT ahead**: `git rev-list --left-right --count origin/master...origin/dev` → `1  0` (the single master-only commit is the dev→master merge commit itself; dev has 0 commits master lacks). This is the *opposite* of the ardrive-core-js situation where dev leads master.
- **`staging`** — stale/abandoned: **2111 commits behind** master, 0 ahead. Ignore it.
- Many `PE-####-*` feature branches (Jira-style ticket branches). Work happens here, then PR.

### How work flows (observed from merge history)
Two patterns both in active use:
1. **Feature branch → `master` directly via PR** (used for point releases): e.g. `PE-8597-...` → PR #373 → master (v3.1.0); `update-core-js-and-release` → PR #372 → master (v3.0.5); `PE-8635-...` → PR #370 → master (v3.0.4).
2. **Feature branch → `dev` → `master` via PR** (used for v4.0.0): `PE-8969_arweave_dot_net` → dev → PR #376 → master.

There is **no rigid gitflow**; core-js point-bumps have historically gone straight to master on a short-lived branch. The version bump + CHANGELOG entry live *in that same branch/PR* as the dep bump.

### Versioning & tagging
- **SemVer**, tags `vX.Y.Z` (a few very old tags lack the `v` prefix, e.g. `1.18.0`). Latest: `v4.0.0`.
- CLI version tracks **ardrive-core-js version 1:1** in recent history: CLI 3.0.4↔core 3.0.4, 3.0.5↔3.0.5, 3.1.0↔3.1.0, 4.0.0↔4.0.0. The CHANGELOG entries are literally "Updated to ardrive-core-js@X".
- Version bump is **manual**: edit `package.json` `"version"` + add a `CHANGELOG.md` section. **No `npm version` / `release:*` scripts** exist in this repo (those live in the *desktop* repo, not here).
- The git tag appears to be created **manually** (or via GitHub "Create release"); no workflow creates tags.

### npm publish story
- **Published to npm as `ardrive-cli`** (confirmed via `npm view`): `latest = 4.0.0`, 82 versions, `bin: ardrive`, deps: 7. `dist-tags`: `latest: 4.0.0`, `alpha: 3.0.2-alpha.1`.
- **Publish is 100% MANUAL.** There is **no npm-publish automation** anywhere: `grep` for `npm publish` / `NPM_TOKEN` / `npmjs` across `.github/` and `package.json` → nothing. v4.0.0 was "published 4 months ago by ariel_at_ardrive".
- Maintainers with publish rights: `vilenarios`, `fedellen`, `ariel_at_ardrive`, `dylan-ario`.
- `package.json` `"files": ["lib/**/*"]` → only the compiled `lib/` is packed. **There is NO `prepublishOnly`/`prepare` script**, so the publisher MUST `yarn build` before `yarn npm publish` or they ship stale/missing output. This is an unguarded footgun.

---

## 2. CI Pipeline

Two GitHub Actions workflows only:

### `.github/workflows/test_and_build.yml` — "Node.js CI"
- **Trigger:** `on: [push]` — **every push to any branch/ref** (branches AND tags). No PR trigger, no manual dispatch.
- **Runner:** `ubuntu-latest`, single job.
- **Node version:** read from `.nvmrc` = **`v18.17.0`** (engines requires `>=18`).
- **Steps:** checkout → setup-node (yarn cache) → `yarn --immutable` → **`yarn ci`**.
- `yarn ci` = **`yarn build && yarn test`**
  - `yarn build` = `rimraf lib …` then `tsc --project tsconfig.prod.json` (compiles **src only**; tests excluded). This is the *only* type-checking CI does.
  - `yarn test` = `nyc mocha`. Mocha uses `ts-node/register/**transpile-only**` → **test files are NOT type-checked**, only transpiled.

### What CI actually gates on
| Gate | In CI? | Notes |
|---|---|---|
| Compile `src` (`tsc` prod) | ✅ | via `yarn build` |
| Type-check test files | ❌ | mocha uses transpile-only; only local `pre-push` husky (`tsc --noEmit`) checks tests |
| ESLint | ❌ | **lint is NOT in `yarn ci`**; only local husky `pre-commit` (lint-staged on staged files) |
| Unit tests (mocha) | ✅ | 10 files, mostly CLI plumbing (see §3) |
| `bats_test/` integration | ❌ | **Never run in CI** — `grep bats .github package.json` → nothing. Separate Docker suite. |
| npm publish on tag | ❌ | manual |
| Artifact signing | ❌ | none |

### `.github/workflows/release.yml` — "Archive Dependencies for Release"
- **Trigger:** `on: release: [created]` (fires when a GitHub Release is published).
- **Does NOT publish to npm.** It only: checkout → setup Node (from `.nvmrc`) → `yarn --immutable` → `yarn build` → `tar -czf deps-<tag>.tar.gz .yarn/cache` → `gh release upload … --clobber`.
- Purpose: attach an offline dependency cache tarball to the GitHub Release (this replaced the old practice of committing `.yarn/cache` zips into git — see §4). `permissions: contents: write`.

### Is CI green on master?
- **Master itself: green.** Latest master run (`Merge #376`, the v4.0.0 commit) = **success**.
- **But CI is FLAKY (~25-30% failure rate).** Of the last 25 runs, ~7 failed. Notably the **tag pushes fail even though the identical commit passed on its branch push**: e.g. commit for #373 → **success** as `master` push (`18727442152`), **failure** as `v3.1.0` tag push (`18727824892`). Same for v3.0.5, v3.0.4, v3.0.3, v4.0.0-adjacent runs. A `dev` merge run also failed. Root cause almost certainly the **live-network unit test** (§3). Old logs are expired (HTTP 410) so the exact assertion can't be re-pulled, but the "same commit, different result" signature is textbook network flakiness.

---

## 3. Test Suite Shape

### Unit tests (the CI gate)
- **Framework: Mocha + Chai + Sinon** (NOT jest). Config `.mocharc.js`: `spec: ['src/**/*.test.ts','tests/**/*.test.ts']`, `ts-node/register/transpile-only`, `timeout 3000ms`, `parallel: true`, setup `tests/testSetup.ts` (just `sinon.restore()` afterEach).
- **Coverage:** `nyc` (istanbul) via `nyc.config.js`, TypeScript config, reporters `text-summary`+`html`. **Coverage thresholds are commented out** (`check-coverage` disabled) — coverage is informational only, not enforced.
- **Only ~10 `*.test.ts` files**, and they cover **CLI plumbing, not ArFS/core operations**:
  - `src/CLICommand/*.test.ts` — action/command/parameter/parameters_helper parsing.
  - `src/utils/*.test.ts` — `download_file`, `get_arweave_for_url`, `ipfs_utils`, `local_file_path`, `temp_folder`.
  - `src/example.test.ts` + `tests/` (stub files only; `tests/` has no real integration test, just `stub_files/` and `testSetup.ts`).
- **`parameters_helper.test.ts` references the repo-root `test_wallet.json`** — a committed real RSA JWK (keys present: d,dp,dq,e,ext,kty,n,p,q,qi; contents NOT printed). Used **offline** for wallet-load/address-derivation assertions — no network, no funds. It is a throwaway test key checked into the repo.
- **⚠ One unit test hits the LIVE network:** `src/utils/download_file.test.ts` does a real `GET https://arweave.net/pVoSqZgJ…` and asserts `contentType === 'image/jpeg'`, plus a second case asserting an exact `404 … Request failed with status code 404` string from arweave.net. **This is the CI flakiness source** and it still points at `arweave.net` even though v4.0.0 moved the default gateway to `ardrive.net`.

### `bats_test/` — bash integration tests (BATS)
- Real end-to-end CLI exercises, run via the **`ardrive-cli-bats` Docker container** (see `ardriveapp/ardrive-bats-docker`), loading `bats-support`/`bats-assert` from `/home/node/packages/...`. **Not runnable in the plain repo / not in CI.**
- Suites: `upload-file`, `create-drive`, `downloads`, `rename`, `base-reward`, `get-address`, `get-mempool`, `generate-wallet`, `version`, `help`.
- **Wallet & network reality:**
  - Most upload/create assertions use **`--dry-run`** (constructs but does not submit txns) → **no spend**. They pipe JSON through `jq` and assert transaction *shape* (e.g. bundle vs v2, file-name validation, byte-length limits). A `$WALLET` (mounted at `/home/node/tmp/wallet.json`) is still required just to sign the dry-run.
  - **`reward-test.bats` DOES hit the live Arweave gateway** — compares `upload-file` reward against the gateway price endpoint (`reward.sh` vs `upload-test.sh`). Network-dependent.
  - `wallets.md` documents needing "a wallet with BOTH a balance and a pre-existent Public Drive" for entity-loading tests → some paths assume a **funded** wallet, though the committed upload assertions stay dry-run.

### Can the suite catch a core-js-upgrade regression?
- **CI unit suite: mostly NO.** It exercises CLI arg parsing and a couple of utils. It does **not** call ArDrive/ArFS create-drive/upload/download logic, so a behavioral regression inside core-js (tag format, manifest timing, encryption, bundle assembly — the very things past bumps fixed) would **sail through CI green**. The one core-touching signal is indirect: `yarn build` (`tsc`) would catch an **API/type break** in core-js's `.d.ts` (import/signature changes), and `src/example.test.ts` imports `sleep` from core so a hard module-resolution break would fail. Runtime behavior is untested.
- **bats suite: YES, partially — but out-of-band.** The dry-run upload/create/rename assertions would catch shape regressions (bundle structure, tag validation) **without spending**, and are the real safety net for a core bump — but they must be run manually in Docker; nothing forces them before a release.
- **Biggest gap:** the only automated gate that touches core is `tsc`. Anything that compiles but behaves differently at runtime is invisible to CI. The intended behavioral net (bats) is not wired into CI and needs Docker + a wallet.

---

## 4. History of core-js Bumps (precedent)

Commits touching the core-js dep in `package.json` via `git log -S'ardrive-core-js' -- package.json`. Recent **release** bumps are tiny and mechanical:

| CLI ver | Commit / branch | Files changed | Shape |
|---|---|---|---|
| **3.0.4** | `chore: upgrade ardrive-core-js from 3.0.3 to 3.0.4` (branch `PE-8635…`) | `package.json` (1 line), `yarn.lock`, + `.yarn/cache/…core-js-3.0.4.zip` | pure dep bump, no src changes |
| **3.0.5** | `chore: bump ardrive-core-js and cli version to 3.0.5` (branch `update-core-js-and-release`) | `package.json`, `yarn.lock`, `.yarn/cache` zip | pure dep bump |
| **3.1.0** | `chore: upgrade ardrive-core-js to 3.1.0 and bump CLI version` (PR #373, `PE-8597…`) | `package.json` (4 lines), `yarn.lock`, `CHANGELOG.md`, + cache zips (added noble-ciphers/hashes, swapped core zip) | dep bump + CHANGELOG; **no src changes** |
| **4.0.0** | via `dev`→master PR #376 (`PE-8969_arweave_dot_net`) | `package.json` core→4.0.0, plus **an actual code change** (hardcoded `arweave.net`→`ardrive.net` gateway) and a **build/infra change**: stopped committing `.yarn/cache`, added `release.yml` archive workflow, `.gitignore` update | dep bump **+ deliberate code change** (this was the exception, not a plain bump) |

**Precedent takeaways:**
- The **typical** core-js bump = **one-line `package.json` change + `yarn.lock` regen + a CHANGELOG entry**, done on a short-lived branch, PR'd (often straight to master), tagged, published manually. Historically core-js resolved from a **committed `.yarn/cache` zip** (zero-install) — that changed at v4.0.0.
- **Since v4.0.0, `.yarn/cache` is no longer committed** (`.gitignore` now excludes it: "deps are archived at release time"; `git ls-files .yarn/cache` → 0 files). So a bump no longer commits a giant vendored zip; instead `yarn` fetches from the registry and the release workflow tar-archives the cache onto the GitHub Release.
- Code changes accompanied a bump **only when the CLI itself needed them** (e.g. new commands historically; the gateway rename at 4.0.0). A same-major/minor core bump has repeatedly been safe as a pure version change.
- Deeper history (`PE-2203`, `PE-883`, `PE-463`, migration `PE-608`) shows earlier bumps sometimes pointed at a **local core repo** or **alpha channels** for QA before pinning the released version — a pattern available if the new core version needs pre-release validation.

---

## 5. The Playbook — safe sequence to bump core-js + release a new CLI

> Descriptive, not a recommendation to upgrade. This is the mechanical safe path given the observed process.

1. **Branch off `master`** (dev == master right now, so either works; historically point-bumps branch off master). Name it `PE-####-update-core-js-to-<ver>` or similar.
2. **Bump the dep:** set `ardrive-core-js` to the target version in `package.json`; run `yarn install` (Yarn 3, `nodeLinker: node-modules`) to regenerate `yarn.lock`. Note `.yarn/cache` is no longer committed post-4.0.0 — don't re-add it.
3. **Bump CLI `version`** in `package.json` to match convention (CLI has tracked core's version 1:1) and **add a `CHANGELOG.md`** section ("Updated to ardrive-core-js@X").
4. **Run the real gates locally** (CI won't cover behavior):
   - `yarn build` (= `tsc` prod) — catches API/type breaks from core's new `.d.ts`. **This is the main automated safety check.**
   - `yarn test` (mocha) — but know it barely touches core; also it will **fail/flake on `download_file.test.ts` if the network hiccups**. A pre-existing flaky test, not your regression.
   - `yarn typecheck` (`tsc --noEmit`, full incl. tests) and `yarn lint` — **CI runs neither**, so run them by hand (husky runs lint-staged pre-commit and `tsc --noEmit` pre-push, but only for staged/pushed content).
   - **Run the `bats_test` dry-run suite in the `ardrive-bats-docker` container** — this is the only behavioral check that core-generated txns (bundles, tags, manifests, rename) still look right, and it needs **no spend** (dry-run) beyond a signing wallet. Skipping it means shipping on `tsc` alone.
5. **PR the branch** (to `dev` then `master`, or straight to `master` per point-release precedent). CI ("Node.js CI") runs on the push — expect possible **flaky red on the tag/merge run from the live-network download test**; verify the branch push itself was green and the failure is the known network test, not a real break.
6. **Merge to `master`.**
7. **Tag `vX.Y.Z`** on the master merge commit and **create a GitHub Release** → this fires `release.yml`, which builds and attaches `deps-vX.Y.Z.tar.gz`.
8. **Publish to npm MANUALLY:** a maintainer (vilenarios/ariel/fedellen/dylan) runs `yarn build` **then** `yarn npm publish` from `master` at the tag. **There is no `prepublishOnly` guard**, so building first is on the human.

### What could go wrong (risk register)
- **CI gives false confidence.** Green CI = "it compiles + CLI parsing works." A runtime behavior regression inside core-js (encryption, bundle format, tag units/timestamps — exactly what 3.0.3/3.0.4 fixed) **passes CI**. Mitigate with the Docker bats dry-run suite.
- **Flaky network test** (`download_file.test.ts` → live `arweave.net`) causes spurious red, especially on the tag run. Don't block on it; also don't let it mask a *real* failure — read which test failed.
- **Publish footgun:** no `prepublishOnly`; forgetting `yarn build` ships stale/empty `lib/`. `files: ["lib/**/*"]` means only `lib/` is packed.
- **Lint/full-typecheck not in CI:** style or test-file type errors only surface via local husky. If you bypass hooks, they escape.
- **Major core bumps may need code changes** (v4.0.0 needed the gateway rename). A major (e.g. new ArFS version) likely requires CLI-side adjustments, not just a version string — budget for src edits + new bats coverage. Minor/patch bumps have been pure version changes.
- **`test_wallet.json` is a committed real JWK** used only offline by unit tests — safe to leave, never print/spend; irrelevant to the bump.
- **Don't release from `staging`** (2111 commits stale). Release from `master`.

---

## Appendix — Key facts
- Node: `.nvmrc v18.17.0`, engines `>=18`. Package manager: **Yarn 3.6.1**, `nodeLinker: node-modules`.
- `yarn ci` = `yarn build && yarn test`. Build = `tsc` prod (src only). Test = `nyc mocha` (transpile-only).
- Workflows: `test_and_build.yml` (on push, CI) + `release.yml` (on release created, archive deps). **No publish workflow.**
- npm `ardrive-cli`: latest 4.0.0, 82 versions, manual publish, 4 maintainers.
- CI flakiness ~25-30% of recent runs, concentrated on tag/merge pushes; live-network download test is the prime suspect.
- Current core-js pin: `ardrive-core-js: 4.0.0` (exact, no caret).
