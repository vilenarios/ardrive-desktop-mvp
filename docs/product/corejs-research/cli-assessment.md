# ArDrive-CLI as a headless verification harness for ardrive-core-js — assessment

Clone: `git clone https://github.com/ardriveapp/ardrive-cli` succeeded on the first try (plain https, no auth needed — public repo).
Local copy: `/tmp/claude-1000/-mnt-c-source-ardrive-desktop-mvp/64f37fe9-d4f4-4b08-90a8-3ca034bcac1a/scratchpad/ardrive-cli`
HEAD at clone time: `481fe57` "Merge pull request #376 from ardriveapp/dev" (2026-02-26).

## 1. core-js dependency

`package.json` (line 11): `"ardrive-core-js": "4.0.0"` (pinned exact, not `^`). CLI's own version is also `4.0.0` (`package.json` line 3) — the CLI major-versions in lockstep with core-js.

npm registry check (`npm view ardrive-core-js dist-tags`):
```
{ "beta": "0.4.0", "alpha": "3.0.3-alpha.0", "latest": "4.0.0" }
```
So **CLI's pinned core-js (4.0.0) IS npm's current `latest`** — not stale. There is no published `dev` dist-tag on npm today, so whatever "core-js dev/4.x line" work is in flight is presumably unreleased/unpublished; the CLI would need to consume it via a local path or git dependency rather than a version bump.

Bump/dev-consumption mechanics are already documented and easy:
- README §"Using a custom ArDrive-Core-JS (Optional)" (`README.md:253-260`) tells contributors to point `package.json`'s `ardrive-core-js` line at a local checkout, e.g. `"ardrive-core-js": "../ardrive-core-js/"`. That's exactly the yarn `file:`/relative-path linking pattern needed to run the CLI against an uncommitted/unpublished core-js branch.
- `CHANGELOG.md` shows the CLI has bumped core-js on every one of its last 5 releases (3.0.3→3.0.4→3.0.5→3.1.0→4.0.0), each a small, mechanical PR (e.g. `4a74012 chore: upgrade ardrive-core-js to 3.1.0 and bump CLI version`). This is a well-worn path, not a one-off.
- For comparison, the **desktop app itself is on `ardrive-core-js@^3.0.3`** (`package.json:51` in this repo, resolved 3.0.3 in package-lock.json) — i.e. the CLI is actually a full major version *ahead* of ardrive-desktop's current core-js dependency. Bumping the CLI to track core-js `dev` is low-effort; the CLI is not the laggard here.

**Verdict: current, and trivially bumpable** (edit one line + `yarn`, or point at a local core-js checkout per the documented pattern).

## 2. Command surface

`src/commands/index.ts` registers 30 commands (alphabetical):
`base-reward, create-drive, create-folder, create-manifest, create-tx, download-drive, download-file, download-folder, drive-info, file-info, folder-info, generate-seedphrase, generate-wallet, get-address, get-balance, get-drive-key, get-file-key, get-mempool, last-tx, list-all-drives, list-drive, list-folder, move-file, move-folder, rename-drive, rename-file, rename-folder, retry-tx, send-ar, send-tx, tx-status, upload-file`.

Coverage of ArFS operations relevant to core-js verification:
- **Create**: create-drive, create-folder, upload-file (files), create-manifest — public and private (`-P` flag family, `DrivePrivacyParameters`)
- **Read/list**: list-all-drives (by wallet address), list-drive (full recursive tree via `listPublicFolder`/`listPrivateFolder`, with `--max-depth`), list-folder, drive-info, folder-info, file-info (all print `Partial<ArFS*Entity>` as JSON)
- **Download**: download-file, download-folder, download-drive (streaming, byte-verified against `dataTxId`)
- **Mutate**: move-file, move-folder, rename-drive, rename-file, rename-folder
- **Private-drive crypto**: get-drive-key, get-file-key (key derivation from wallet+password, independent of network)
- **Wallet/tx utilities**: generate-wallet, generate-seedphrase, get-address, get-balance, send-ar, send-tx, create-tx, retry-tx, tx-status, last-tx, get-mempool, base-reward

**Gaps relative to what we want to verify:**
- **No snapshot command.** `grep -rni snapshot src README.md CHANGELOG.md` → zero hits anywhere in the CLI. Snapshot support would be new CLI work (a `create-snapshot`/`get-snapshot` command wrapping whatever core-js exposes), not something to "flip on."
- **No explicit incremental-listing command.** `list-drive`/`list-folder` are full recursive walks each time (`children = await arDrive.listPrivateFolder({..., includeRoot: true})`); there's no cursor/since-timestamp flag in `parameter_declarations.ts`. Verifying incremental-sync behavior would mean driving core-js's incremental API directly from a small script/test, or adding CLI flags — the CLI doesn't currently expose that surface.
- Gateway resiliency (retries/fallback) isn't a CLI concern to configure beyond pointing at a different gateway URL (see §3) — core-js's internal retry/backoff logic would be exercised transparently, not independently controllable from CLI flags.

## 3. Harness viability

**Machine-parseable output**: yes, uniformly. Every read command (`list-drive`, `drive-info`, `file-info`, `folder-info`, `list-all-drives`) does `console.log(JSON.stringify(result, null, 4))` and returns a `SUCCESS_EXIT_CODE`. Every write command (`create-drive`, `upload-file`, etc.) prints a `{ created: [...], tips: [...], fees: {...} }` envelope. README's own quick-start examples (`README.md:8-64`) are literally CLI-invocation-then-JSON-blob pairs — the project treats JSON-on-stdout as its primary contract, which is exactly what a scripted assertion harness wants (pipe to `jq`, diff against fixtures).

**Dry-run is the key enabler for "never spend real funds"**: `--dry-run` (documented `README.md:389-392`, exercised throughout `bats_test/upload-file/*.bats`) runs the full core-js ArFS-construction pipeline — bundling decisions, per-file/per-folder entity creation, fee calculation, duplicate-name handling (`--skip`/`--upsert`) — and prints the resulting JSON *without broadcasting a transaction or spending anything*. Example from `bats_test/upload-file/single-bundled-files.bats`:
```
yarn ardrive upload-file --dry-run --local-path '/home/node/10Chunks.txt' -F $PUB_FOLD_ID -w $WALLET | jq '.created[] .type'
```
asserts on bundle-vs-v2-tx choice, fee-key shape (43-char tx-id regex), and created-entity ordering — all offline-cost-free. This directly matches our own CLAUDE.md constraint ("Never spend real funds… use free-tier files… test wallet + explicit budget for anything real"). Read-only commands (`list-drive`, `download-*`, `drive-info` etc. against *public* drives) need no wallet and no funds at all — `list-drive`/`list-all-drives`/`download-drive` fall back to `cliArDriveAnonymousFactory` when `-P` isn't passed (see `src/commands/list_drive.ts`), so a large chunk of core-js's read path (listing, path-resolution, streaming download + hash verification) is verifiable with zero wallet involvement.

**Gateway configurability**: every command takes `-g/--gateway <protocol://host:port>` (`GatewayParameter`, `parameter_declarations.ts:494-497`), fed straight into `Arweave.init()` via `getArweaveFromURL` (`src/utils/get_arweave_for_url.ts`) — trivially pointed at `turbo-gateway.com`, `perma.online`, or a local test gateway. Uploads separately take `--turbo-url` (`TurboUrlParameter`, `parameter_declarations.ts:499-503`) to redirect Turbo data-item submission. Default gateway is hardcoded to `ardrive.net` in `src/index.ts:38` (changed from `arweave.net` in commit `dad1e8e`, Feb 2026) but every command's `-g` flag overrides it per-invocation — no env-var plumbing needed for our purposes.

**Existing testing story to model**:
- Unit tests: Mocha + Chai + Sinon + nyc (`yarn test` / `yarn ci`), `src/**/*.test.ts` colocated with source, run in GitHub Actions on every push (`.github/workflows/test_and_build.yml`, just `yarn ci` = build + test). Fast, no network needed for most of these (some, like `src/utils/download_file.test.ts`, hit real `arweave.net` URLs directly).
- **Real integration tests exist and are exactly the harness pattern we'd want**: `bats_test/` is a full BATS (Bash Automated Testing System) suite — `create-drive/`, `downloads/{drive,folder,file}-downloads/`, `rename/{drive,file,folder}/`, `upload-file/`, `get-address/`, `base-reward/`, `get-mempool/`, `generate-wallet/`, `help/`, `version/`. These run the built CLI binary against **real mainnet data** — e.g. `bats_test/downloads/drive-downloads/happy_paths.bats` downloads a fixed, permanent public drive (`MY_DRIVE_ID="c0c8ba1c-efc5-420d-a07c-a755dc67f6b2"`) and asserts specific files/folders land on disk with `assert_dir_exist`/`assert_file_exist`. This is effectively a live fixture drive already deployed to Arweave that we could reuse or extend for core-js read-path regression checks.
- Caveat: bats_test is **not wired into CI** (`test_and_build.yml` only runs `yarn ci`, i.e. unit tests) — it's designed to run inside a separate Docker container (`ardrive-bats-docker`, referenced in `bats_test/readme.md`/`wallets.md`) with a funded wallet copied in (`docker exec … cat > /home/node/tmp/wallet.json`). So it's a documented, real pattern but requires standing up that Docker image (external repo `ardriveapp/ardrive-bats-docker`) or reimplementing an equivalent lightweight runner ourselves — the bats *scripts* are useful reference/reusable assertions, the Docker *infrastructure* is an extra dependency we'd need to either adopt or replace with something simpler (e.g. plain bats-core locally, or a thin Node/TS test runner shelling out to the built CLI).

**Verdict: usable-with-work, and a notably stronger foundation than expected.** For verifying core-js changes to existing commands (listing, download, upload bundling/fees, drive/file/folder metadata, key derivation), the CLI is close to being pluggable as-is: point `package.json` at the working core-js branch, run `yarn build`, script `ardrive <cmd> ... | jq` against public fixture drives or `--dry-run` for write paths, assert on JSON. For snapshot/incremental-specific verification, new CLI commands are needed first (see §4) — the harness pattern is proven, but the surface to drive doesn't exist yet.

## 4. Update cost

To make the CLI a genuinely useful harness *and* a valid second consumer for the core-js improvement program:

1. **Core-js bump/link** (trivial, <1 hr): swap `package.json:11` to the local core-js path (documented pattern) or a git-branch dependency; `yarn build`. Already a well-trodden 5-times-repeated chore in this repo's history.
2. **New commands for snapshots** (small-medium, likely 1-3 days depending on core-js API shape): a `create-snapshot` / `get-snapshot` (or similar) command following the existing command template (`src/commands/drive_info.ts` is a good ~40-line model: parameter declarations → factory call → `console.log(JSON.stringify(...))`). Needs new `parameter_declarations.ts` entries if snapshot ops need new flags (e.g. snapshot range, block height).
3. **Incremental listing exposure** (small-medium, 1-2 days): either add `--since`/cursor-style flags to `list-drive`/`list-folder`, or — if core-js's incremental API is more of an internal building block than a full command — skip CLI surfacing entirely and drive it via a small standalone TS script that imports core-js directly (still "headless," just not through `ardrive <cmd>`). Worth deciding based on whether incremental sync is meant to be user-facing in the CLI too, or purely a desktop-app internal.
4. **Gateway config for the harness**: no work needed — `-g`/`--turbo-url` already exist per-command.
5. **Test fixtures**: the bats_test fixture drives (real, permanent, already on-chain) are directly reusable for read-path regression tests; for new snapshot/incremental behavior we'd need to create+fund new fixture drives once (small one-time cost, real but tiny AR spend, or Turbo free-tier for <100KB per our own project's testing rule).
6. **CI wiring** (optional, small): nothing stops us from adding a lightweight non-Docker integration job (plain `bats-core` + built CLI) to GitHub Actions if we want this to run automatically rather than being agent-invoked manually.

Rough total: a few days of focused work to get snapshot + incremental commands in place and a couple of fixture drives set up; the rest (bump, gateway config, JSON-output scripting, dry-run cost safety) is already there today.

## 5. Maintenance state

- **Actively maintained, not dormant.** Releases: v3.0.0 (2025-06-16) → v3.0.1 → v3.0.2 → v3.0.3 (2025-08-01) → v3.0.4 (2025-10-13) → v3.0.5 (2025-10-16) → v3.1.0 (2025-10-22) → v4.0.0 (2026-02-26, latest). Cadence: roughly monthly-to-quarterly, with a cluster of core-js-tracking releases in Oct 2025 and the most recent one 5 months before this assessment (2026-07-05).
- Every release in `CHANGELOG.md` since 3.0.0 is either a core-js version bump or a small compatibility fix (timestamp/contentType/manifest bugs) — the project's cadence *is* core-js's release cadence, which is a good sign for our "second consumer" goal: this team already treats CLI releases as a core-js-tracking exercise.
- Recent commits (`git log`) show real engineering care, not just mechanical bumps: idempotent CI artifact uploads, gateway default migration from `arweave.net`→`ardrive.net`, yarn cache housekeeping — all Feb 2026, i.e. current.
- **GitHub state** (`gh repo view` / `gh issue list` / `gh pr list` / `gh release list`): 0 open PRs, 5 open issues (oldest from 2022, none blocking — one is literally "Outdated packages" from 2025-08 and the CLI has since bumped everything anyway). Not high-traffic but clearly not abandoned — last release 2026-02-26, last commit same day, CI green (`test_and_build.yml` on every push).
- License AGPL-3.0, maintained by Permanent Data Solutions Inc (ArDrive's own org) — same org as core-js and desktop, so no external-maintainer risk for coordinating a bump.

## Bottom line

- **Cloned**: yes, plain `git clone` over https, no auth friction.
- **core-js version**: pinned exact `4.0.0`, which is npm's current `latest` — ahead of ardrive-desktop's own `^3.0.3`. Bump-to-dev-branch is a documented one-line/local-path change.
- **Command surface**: 30 commands covering create/list/download/rename/move/key-derivation for both public and private drives, with uniform JSON output. No snapshot command; no incremental-listing flags — both would be new work.
- **Harness viability**: usable-with-work, and better positioned than expected — JSON-on-stdout by design, `--dry-run` gives cost-free write-path verification, anonymous factory gives cost-free/walletless read-path verification against public drives, gateway/turbo-url are already CLI flags, and there's a real (if Docker-coupled) BATS integration-test precedent to model or lift assertions from.
- **Effort to round out**: on the order of a few days — mostly adding snapshot + incremental-listing command surface and one-time fixture-drive setup; everything else (bump mechanics, gateway config, JSON contract, cost-free testing modes) already exists.
- **Maintenance**: active, same-org, release cadence tracks core-js releases almost 1:1; no red flags.
