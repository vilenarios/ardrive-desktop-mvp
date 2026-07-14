# ardrive-cli — Build Health & core-js Bump Probe (empirical)

**Repo:** `/mnt/c/source/ardrive-cli`
**Date run:** 2026-07-14
**master HEAD (untouched):** `481fe5757b8a9d4c8b320f61a057a0909d604020` (`Merge pull request #376 from ardriveapp/dev`)
**Probe branch:** `analysis/corejs-bump-probe` @ `3c1023c42204b72c4b42474d7b0b6bdf69d8442e` (local, **unpushed**)
**Pin under test:** `ardrive-core-js: 4.0.0` (published npm latest)
**Env:** Node v23.9.0 (repo `.nvmrc` = v18.17.0; nvm here has only v22/v23, no v18), yarn 3.6.1 (Berry, nodeLinker: node-modules), npm 10.9.2

---

## TL;DR

- **Baseline on 4.0.0 (AS-IS):** `typecheck` PASS, `lint` PASS, `build` PASS. `test` = **84 passing / 1 pending / 3 failing**, where **all failures are network-dependent** (arweave.net HTTP 429 rate-limits and an IPFS-CID timeout), not code defects. One env caveat: the test runner needs `NODE_OPTIONS=--no-experimental-strip-types` under Node 23 (see Env Gotcha).
- **Is a newer core-js PUBLISHED to npm?** **No.** npm `latest` = **4.0.0** (published 2026-02-25). There is **no 4.1.0/4.2.0 on npm**. core-js `master` (SHA `0e0c1a5`) self-declares `version: 4.1.0` but is **git-only / unpublished**. **Publishing 4.1.0 to npm is a prerequisite** for a normal version bump.
- **Bump breakages (4.0.0 → 4.1.0, properly built):** **ZERO.** With core-js `master` actually compiled, `yarn typecheck` and `yarn build` both PASS (exit 0), and the test suite shows no new code regressions (same flaky network tests only).
- **Caveat that looks like breakage but isn't:** A *plain yarn git dependency* on the SHA does **not** run core-js's `prepare` build, so `lib/` is missing and you get **54 phantom errors** (38× TS2307 "cannot find module" + 16 cascade). This is a packaging/install artifact, **not an API delta** — it vanishes once core-js is built.

---

## 1. Baseline on core-js 4.0.0 (unmodified master)

Installed: `yarn install` completed with warnings (optional native deps `utf-8-validate` / `bufferutil` failed to compile — these are optional `ws` accelerators and are non-blocking). Confirmed installed `ardrive-core-js` = **4.0.0**.

| Script | Command | Result |
|---|---|---|
| typecheck | `yarn typecheck` (`tsc --noemit`) | **PASS** (exit 0) |
| lint | `yarn lint` (`eslint . --ext .ts`) | **PASS** (exit 0) |
| build | `yarn build` (`clean` + `tsc -p tsconfig.prod.json`) | **PASS** (exit 0, emits `lib/index.js`) |
| test | `yarn test` (`nyc mocha`) | **84 passing, 1 pending, 3 failing** — failures are network-only |

### Env gotcha (not a repo defect)
Under Node **23.9.0**, `yarn test` first dies with:
```
SyntaxError: Named export 'restore' not found. The requested module 'sinon' is a CommonJS module...
  at file:///.../tests/testSetup.ts:1
```
Cause: Node 23's **native TS type-stripping** hijacks the ESM path and loads `.ts` as ES modules, bypassing mocha's `ts-node/register/transpile-only`. Fix used for the run: `export NODE_OPTIONS="--no-experimental-strip-types"`. The repo targets Node 18 (`.nvmrc`), which predates type-stripping and would not hit this. **This is an environment/Node-version issue, unrelated to core-js.**

### The 3 failing tests (all network-dependent, flaky)
1. `downloadFile function › downloads a file into the provided folder when given a valid link` — live GET to `arweave.net`, got **HTTP 429** (rate-limited).
2. `downloadFile function › download throws when given an invalid link` — expected `404`, got **429** (rate-limit masks the 404 assertion).
3. `deriveIpfsCid function › returns the expeced hash` — **Timeout 3000ms** (IPFS/network).

A second baseline run showed a 4th intermittent failure (`ParametersHelper › getCustomMetaDataWithIpfsCid` — 3000ms timeout, also IPFS). Failure count **varies run-to-run** purely due to arweave.net rate-limiting → confirms these are environmental, not deterministic code failures. **No core-logic unit test fails.**

### test_wallet.json dependency
`test_wallet.json` is referenced only by `src/CLICommand/parameters_helper.test.ts` to exercise `--wallet-file` / `-w` **argument parsing** (reads the JWK from disk). It needs **no network and no funds**, and those tests **passed**. (Contents were not read/printed.)

---

## 2. Published-version findings (read-only npm queries)

```
npm view ardrive-core-js dist-tags  → { beta: 0.4.0, alpha: 3.0.3-alpha.0, latest: 4.0.0 }
npm view ardrive-core-js versions   → newest published = 4.0.0 (no 4.1.0, no 4.2.0)
publish time of 4.0.0               → 2026-02-25T06:13:47Z
```
- **Latest published = 4.0.0** — exactly what the CLI already pins.
- **core-js `master` SHA `0e0c1a5b5b719c7f4ab6afd0d44f7eeb5a3fba4c`** is the current tip of `refs/heads/master`; its `package.json` declares **`version: 4.1.0`**, `main: ./lib/exports.js`, and has a `prepare: tsc -p ./tsconfig.prod.json` script.
- Therefore **"4.1.0" is a git SHA only, not an npm release.** Any consumer bump via the registry is blocked until PDS publishes 4.1.0 (or a tag) to npm.

### Factual correction re: task premise
The task states the desktop app pins core-js "via git dependency at SHA `0e0c1a5`." As of this run, the desktop app (`/mnt/c/source/ardrive-desktop-mvp/package.json`) actually pins **`ardrive-core-js: ^3.0.3`** (installed 3.0.3), a **published** version — not the SHA. So there is no existing built copy of 4.1.0 to reuse; it had to be built from source for this probe.

---

## 3. Bump probe (branch `analysis/corejs-bump-probe`)

Changed only `package.json` (+ `yarn.lock`):
```
-  "ardrive-core-js": "4.0.0",
+  "ardrive-core-js": "git+https://github.com/ardriveapp/ardrive-core-js.git#0e0c1a5b5b719c7f4ab6afd0d44f7eeb5a3fba4c",
```

### 3a. Plain git install does NOT build core-js → 54 PHANTOM errors (artifact, not delta)
`yarn install` fetched the SHA but **did not run core-js's `prepare` script**, so the installed package contained only `CHANGELOG.md / LICENSE / README.md / package.json / node_modules` — **no `lib/`** (its `files` whitelist is `["lib/**/*","dist/web/**/*"]`, both empty without a build). `main`/`types` point at the missing `./lib/exports.*`.

`yarn typecheck` then reported **54 errors in 35 files**, by code:
```
38 × TS2307  Cannot find module 'ardrive-core-js' or its corresponding type declarations
13 × TS7031  Binding element '…' implicitly has an 'any' type      (cascade)
 2 × TS7006  Parameter '…' implicitly has an 'any' type            (cascade)
 1 × TS2339  Property 'toWinston' does not exist on type 'string'  (cascade)
```
Verbatim samples:
```
src/CLICommand/parameters_helper.ts(1,25):  error TS2307: Cannot find module 'ardrive-core-js' or its corresponding type declarations.
src/CLICommand/parameters_helper.ts(52,30): error TS2307: Cannot find module 'ardrive-core-js/lib/utils/constants' or its corresponding type declarations.
src/commands/base_reward.ts(1,27):          error TS2307: Cannot find module 'ardrive-core-js' or its corresponding type declarations.
src/commands/create_tx.ts(28,37):           error TS2339: Property 'toWinston' does not exist on type 'string'.
src/prompts.ts(16,2):                        error TS7031: Binding element 'fileId' implicitly has an 'any' type.
```
**These 54 errors are 100% an artifact of the unbuilt package** (module unresolved → every core-js import becomes `any` → `noImplicitAny`/cascade fires). They are **not** an API delta. They disappear entirely once core-js is built (see 3b). This IS a real *operational* gotcha for anyone attempting the bump via a bare git dep under yarn 3.

### 3b. Real delta — with core-js 4.1.0 actually built = ZERO breakages
To measure the true delta, core-js `master` was cloned at the SHA, `yarn install` + `yarn build` run (build PASS, produced `lib/exports.d.ts`), and the built `lib/` + private `node_modules/` vendored into the CLI's `node_modules/ardrive-core-js/`. Re-running against the real 4.1.0 type surface:

| Script | Result on built 4.1.0 |
|---|---|
| `tsc --noemit` (typecheck, src+tests) | **PASS — 0 errors** |
| `yarn build` (`tsc -p tsconfig.prod.json`, src) | **PASS — 0 errors**, emits `lib/index.js` |
| `yarn test` | **83 passing / 1 pending / 4 failing** — the 4 failures are the same flaky network/IPFS tests as baseline; **no new code regressions** |

**Symbol-surface check:** all 69 distinct symbols the CLI imports from `ardrive-core-js` (e.g. `ArDrive`, `EID`, `ByteCount`, `Winston`, `DriveSignatureType`, `wrapFileOrFolder`, `deriveDriveKey`, `ArFSPrivateFileBuilder`, …) still resolve in 4.1.0. Both **deep subpath imports** — `ardrive-core-js/lib/arfs/arfs_tag_settings` (`ArFSTagSettings`) and `ardrive-core-js/lib/utils/constants` (`turboProdUrl`) — also still resolve (files present, exports intact). 4.1.0 is purely **additive** for the CLI's usage (new exports: `sync_state*`, `arfsdao_*_incremental_sync`, `snapshots`, `wallet_utils`).

### 3c. New transitive deps in 4.1.0 (peer-warning noise, non-blocking)
Installing 4.1.0 surfaced new peer-dependency warnings absent on 4.0.0 — core-js `master` pulled in multi-chain wallet stacks:
```
@keplr-wallet/common@0.12.245 doesn't provide bitcoinjs-lib / starknet …
@solana/web3.js@1.98.2 doesn't provide typescript …
```
These are **warnings only** (unmet optional peers), did not block install/typecheck/build, but signal a materially larger dependency tree (Solana web3.js, Keplr) in 4.1.0.

---

## 4. Breakage categorization (step 3 of task)

Measuring the **real** delta (core-js properly built, §3b), against the CLI's own source:

| Category | Count | Notes |
|---|---:|---|
| **Trivial** (import path / type rename) | **0** | all 69 imported symbols + 2 deep subpaths still resolve |
| **Moderate** (signature change needs a code tweak) | **0** | typecheck + build clean |
| **Structural** (behavior/API redesign) | **0** | no compile-visible API redesign affecting the CLI |
| **Operational / packaging** (not a code delta) | **2** | (a) 4.1.0 unpublished → must publish to npm or vendor a built copy; a bare git dep leaves `lib/` unbuilt (54 phantom TS2307/cascade errors); (b) new heavy transitive deps (Solana/Keplr) raise peer-warning noise |

The 54 errors from the naive git install are catalogued above but are **explicitly excluded** from trivial/moderate/structural because they are install-packaging artifacts, not source-level API breakages.

---

## 5. State left behind

- **master:** untouched @ `481fe57`.
- **Probe branch:** `analysis/corejs-bump-probe` @ `3c1023c` — local, **unpushed**; single commit repointing `package.json`/`yarn.lock` at the SHA.
- Nothing published; no PR; no funds spent; test wallet contents never read/printed.
- **Reproduce note:** the CLI's `node_modules/ardrive-core-js` currently holds a **hand-built** 4.1.0 (`lib/` + deps copied in) so typecheck/build reflect the real surface. A fresh `yarn install` on the branch would re-fetch the **unbuilt** git package and reproduce the §3a phantom errors — to consume 4.1.0 for real you must either (i) publish 4.1.0 to npm, or (ii) supply a pre-built core-js (git dep with a working `prepare`, a tarball, or a `portal:`/`file:` link to a built checkout).
```

Built-core-js clone for reproduction: /tmp/.../scratchpad/cli-research/core-js-build (@ SHA 0e0c1a5, version 4.1.0)
```
