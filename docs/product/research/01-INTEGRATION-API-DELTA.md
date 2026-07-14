# CLI ↔ core-js — Integration & API-Delta Analysis

**Scope:** How `ardrive-cli` (master, v4.0.0) consumes `ardrive-core-js`, and the API/behavior delta from the pinned `4.0.0` to core-js current `master` (and the unmerged page-size branch). Read-only analysis; no repo modified, no deps installed, no funds.

**Repos analyzed (local):**
- CLI: `/mnt/c/source/ardrive-cli` — branch `master`, self-version `4.0.0`, pins `"ardrive-core-js": "4.0.0"` (exact), `"arweave": "1.15.7"` (exact). Package manager: **yarn** (`yarn.lock`, no `package-lock.json`).
- core-js: `/mnt/c/source/ardrive-core-js` — remote `origin = github.com/ardriveapp/ardrive-core-js`. **Working tree is checked out on `fix/gql-empty-edges-guard` (`ac2f0f6`), whose `package.json` says `3.0.3`** — this is the source of the "muddy" version confusion. That branch descends from the stale `origin/dev` line, **not** from the real release line.

---

## 1. Version Story / Timeline

### The confusion, resolved
Running `node -e "require('./package.json').version"` in the core-js checkout returns `3.0.3` **because HEAD is on `fix/gql-empty-edges-guard`**, a feature branch cut from the old `origin/dev` line (`origin/HEAD → origin/dev`, tip `d082263`, dated **2025-08-01**, still the 3.0.x lineage). It is **not** master. The actual release line is `master`.

- `git show master:package.json` → **version `4.1.0`**
- `git show v4.0.0:package.json` → version `4.0.0`
- `git merge-base --is-ancestor v4.0.0 master` → **true** (master descends from the v4.0.0 tag)
- `git merge-base --is-ancestor v4.0.0 origin/dev` → **false** (dev is a divergent, older line; the `3.0.3` CHANGELOG/package there predates 4.x)

So there are effectively **two histories**: the current 4.x release line (`…v4.0.0 → master@4.1.0 → feat branch@"4.2.0"`) and a stale `dev`/3.0.3 line that `origin/HEAD` still points at (matches the standing "core-js PR base = master; origin/HEAD default is dev, which is behind" note).

### npm vs git tag vs internal label

| Ref | git SHA | date | package.json | Published to npm? | Notes |
|---|---|---|---|---|---|
| npm `latest` = **`4.0.0`** | tag `v4.0.0` = `a7fedad` | 2026-02-24 | `4.0.0` | **YES** (npm `latest`) | **This is exactly what the CLI installs.** |
| core-js `master` | `0e0c1a5` | 2026-07-05 | **`4.1.0`** | **NO** | Desktop app pins this SHA, internally "4.1.0": snapshot consumption, incremental sync, CORE-5 unixTime clamp, CORE-6 invalid-file-state, CORE-4 hide/unhide. |
| `feat/gql-page-size-and-consolidation` (PR #275) | `9080751` | 2026-07-09 | (4.1.0) | **NO** | 3 commits **beyond** master; internally "4.2.0": CORE-7/8/9 GraphQL page size + consolidation. **Not merged to master.** |

**`npm view ardrive-core-js`:** `dist-tags = { latest: '4.0.0', beta: '0.4.0', alpha: '3.0.3-alpha.0' }`. Highest published version anywhere on npm is **`4.0.0`**. There is **no `4.1.0` / `4.2.0` on npm.**

**Timeline (release line):**
```
… → v4.0.0 (a7fedad, 2026-02-24, npm latest, CLI PIN)
     │  36 commits: CORE-2 incremental sync, CORE-3 snapshots, CORE-4 hide/unhide,
     │  CORE-5 unixTime tolerance, CORE-6 invalid-file-state, zero-edge guard, prepare hook
     ▼
   master = 0e0c1a5 (2026-07-05, pkg 4.1.0, NOT on npm)   ← Desktop pins this SHA
     │  +3 commits (CORE-7/8/9): setGqlPageSize, GQL page 100→1000, bounded concurrency
     ▼
   feat/gql-page-size-and-consolidation = 9080751 ("4.2.0", NOT on npm, NOT in master)
```

**Bottom line:** the CLI's `ardrive-core-js@4.0.0` is a genuine, npm-published, `latest`-tagged release = git tag `v4.0.0`. "master 4.1.0" and "4.2.0" are **git-only**; consuming them requires a git-SHA install, not `npm install ardrive-core-js@x`.

---

## 2. CLI core-js Consumption Surface

### 2a. Import channels
- **Public barrel** `from 'ardrive-core-js'` (→ `lib/exports.js`) — 30 import sites across `src/`.
- **Deep internal imports** (bypass the public API, reach into compiled `lib/…`) — **2 of them**, the fragile edge:
  - `ardrive-core-js/lib/utils/constants` → `turboProdUrl` (`src/CLICommand/parameters_helper.ts:52`)
  - `ardrive-core-js/lib/arfs/arfs_tag_settings` → `ArFSTagSettings` (`src/index.ts:14`)

### 2b. Imported symbols (the coupling surface)
**72 distinct symbols** consumed: **70 via the public barrel + 2 via deep `lib/` paths.**

Values / classes / functions (constructors `EID/ADDR/AR/W/TxID` etc.):
`ArDrive`, `ArDriveAnonymous`, `arDriveFactory`, `arDriveAnonymousFactory`, `WalletDAO`, `ArFSPrivateFileBuilder`, `deriveDriveKey`, `deriveFileKey`, `GatewayAPI`, `gatewayUrlForArweave`, `wrapFileOrFolder`, `fetchMempool`, `b64UrlToBuffer`, `bufferTob64Url`, `sleep`, `alphabeticalOrder`, `assertCustomMetaData`, `EID`, `ADDR`, `AR`, `W`, `TxID`, `replaceOnConflicts`, `skipOnConflicts`, `upsertOnConflicts`, `askOnConflicts`, `renameOnConflicts`, `useExistingFolder`.

Types / interfaces / enums:
`ArDriveSettings`, `ArDriveSettingsAnonymous`, `DriveID`, `DriveKey`, `Wallet`, `JWKWallet`, `SeedPhrase`, `ArweaveAddress`, `FeeMultiple`, `PrivateKeyData`, `PrivateDriveKeyData`, `FileNameConflictResolution`, `CustomMetaData`, `CustomMetaDataJsonFields`, `DriveSignatureType`, `VersionedDriveKey`, `ByteCount`, `Winston`, `TransactionID`, `FileID`, `FolderID`, `ArFSPublicDrive`, `ArFSPrivateDrive`, `ArFSPublicFile`, `ArFSPrivateFile`, `ArFSPublicFolder`, `ArFSPrivateFolder`, `ArFSDriveEntity`, `ArFSPrivateFileWithPaths`, `ArFSPrivateFolderWithPaths`, `ArFSPublicFolderWithPaths`, `ArFSPublicFileWithPaths`, `ArFSFileToUpload`, `ArFSFolderToUpload`, `ArDriveUploadStats`, `FileConflictPrompts`, `FileToFileNameConflictPrompt`, `FileToFolderConflictAskPrompt`, `FolderConflictPrompts`, `FolderToFileConflictAskPrompt`, `FolderToFolderConflictAskPrompt`.

Deep-import symbols: `turboProdUrl`, `ArFSTagSettings`.

### 2c. Behavioral coupling — `ArDrive`/`ArDriveAnonymous` methods the CLI calls (~40)
`createPublicDrive`, `createPrivateDrive`, `createPublicFolder`, `createPrivateFolder`, `uploadAllEntities`, `uploadPublicManifest`, `retryPublicArFSFileUploadByFileId`, `retryPublicArFSFileUploadByDestFolderId`, `assertValidPassword`, `getAllDrivesForAddress`, `getPublicDrive`/`getPrivateDrive`, `getPublicFile`/`getPrivateFile`, `getPublicFolder`/`getPrivateFolder`, `getDriveIdForFileId`/`getDriveIdForFolderId`, `getOwnerForDriveId`/`getOwnerForFileId`, `listPublicFolder`/`listPrivateFolder`, `downloadPublicFile`/`downloadPrivateFile`, `downloadPublicFolder`/`downloadPrivateFolder`, `downloadPublicDrive`/`downloadPrivateDrive`, `movePublicFile`/`movePrivateFile`, `movePublicFolder`/`movePrivateFolder`, `renamePublicFile`/`renamePrivateFile`, `renamePublicFolder`/`renamePrivateFolder`, `renamePublicDrive`/`renamePrivateDrive`. (These are the runtime surface that the CORE-2/5/6 listing rewrites touch — see §3.)

---

## 3. API Delta: 4.0.0 → master (`0e0c1a5`)

**Delta size:** 36 commits, 51 `src/` files, +7966/−88 lines. **`git diff v4.0.0 master -- src/exports.ts` is purely additive** — barrel lines were only **added** (incremental-sync DAOs, `sync_state*`, `snapshots`); **none removed or renamed.** Every one of the 72 consumed symbols was verified present/defined in `master` (40/40 spot-checked resolve; the rest are re-exports on unchanged barrels).

### Per-symbol / per-area delta

| Consumed symbol / area | Change 4.0.0 → master | Class |
|---|---|---|
| All 70 public-barrel symbols (existence) | Still exported; exports.ts additive-only | **SAFE** |
| `arDriveFactory` / `arDriveAnonymousFactory` | Unchanged call signature | **SAFE** |
| `ArDriveSettings` / `ArDriveSettingsAnonymous` | Added **optional** `syncStateStore?: SyncStateStore` (both interfaces) | **SAFE** (optional) |
| `ArDrive` class (methods CLI calls) | `ardrive.ts` +334 lines, **0 removed public methods**; new methods only (hide/unhide + incremental) | **SAFE** |
| `ArDriveAnonymous` (`ardrive_anonymous.ts`) | File unchanged in delta | **SAFE** |
| `ArFSPublicDrive/File/Folder`, `ArFSPrivate*`, `ArFSDriveEntity` | `arfs_entities.ts` additive: new `blockHeight: number = 0` (trailing ctor param **with default**) + `isHidden?: boolean` field | **SAFE** (additive) |
| `*WithPaths` types (list output) | Unchanged shape | **SAFE** |
| `ArFSPrivateFileBuilder`, `deriveFileKey`, `deriveDriveKey` | No signature line changed | **SAFE** |
| `DriveSignatureType`, `VersionedDriveKey`, `PrivateKeyData`, `FeeMultiple`, `CustomMetaData*` | Unchanged; already existed at 4.0.0 | **SAFE** |
| `GatewayAPI`, `gatewayUrlForArweave` | Present; `gateway_api.ts` +26 additive | **SAFE** |
| `wrapFileOrFolder`, `ArFSFileToUpload`, `ArFSFolderToUpload`, `ArDriveUploadStats` | Wrapper file untouched in delta | **SAFE** |
| Conflict consts/types, prompts types, `fetchMempool`, `sleep`, `b64*`, `alphabeticalOrder`, `WalletDAO`, wallet/AR/Winston types | Unchanged | **SAFE** |
| `turboProdUrl` (deep `lib/utils/constants`) | Value unchanged: `https://upload.ardrive.io/` | **SAFE-but-fragile** |
| `defaultGatewayHost` (constants) | **Unchanged = `ardrive.net`** at both refs (matches CLI's own `Arweave.init({host:'ardrive.net'})`) | **SAFE** |
| `ArFSTagSettings` (deep `lib/arfs/arfs_tag_settings`) | File present at master; not consumed via public barrel | **SAFE-but-fragile** |
| `buildQuery` (GraphQL) — **NOT imported by CLI** | Signature extended with **optional** `minBlock/maxBlock/minBlockHeight/maxBlockHeight/first`; default page size **still `pageLimit = 100`**; node fragment now also requests `block{height,timestamp}` | **SAFE** (not consumed; additive anyway) |
| Drive-listing internals behind `listPublicFolder`/`listPrivateFolder`/`getAllDrivesForAddress`/`get*` | `arfsdao.ts` +354, `arfsdao_anonymous.ts` +284 — CORE-2 (rebuild latest revision vs stale cache), CORE-5 (tolerate invalid `unixTime`), CORE-6 (tolerate incomplete private entities instead of aborting). **Signatures stable**; incremental/snapshot acceleration lives in **separate DAO subclasses** (`arfsdao_incremental_sync.ts`, `arfsdao_anonymous_incremental_sync.ts`), gated by opt-in `syncStateStore` — the CLI's default path is **not** auto-switched. | **SAFE — VERIFY** (runtime behavior of listing rewritten; robustness-in-the-tolerant-direction, but should be exercised) |

### `setGqlPageSize` / page-size 100→1000 — **NOT in master**
`git grep setGqlPageSize|GQL_PAGE_SIZE master` → **nothing.** These exports (and the 1000 default) exist **only** on `feat/gql-page-size-and-consolidation` (`exports.ts` adds `export { GQL_PAGE_SIZE, getGqlPageSize, setGqlPageSize }`). Master still hardcodes `pageLimit = 100` in `utils/query.ts`. So:
- Bumping the CLI to **master** gives **no** page-size change and **no** `setGqlPageSize` symbol.
- The page-size feature is a **further, unmerged, unpublished** step ("4.2.0"). Classify a hypothetical bump-to-feat-branch as **SAFE-additive** (adds three new optional exports; default paging behavior changes 100→1000, which is a behavior change to verify), but that is beyond master and out of the direct 4.0.0→master path.

### Delta classification tally (72 imported symbols)
- **SAFE: 72** — all consumed symbols still exist with compatible signatures; nothing the CLI imports forces a compile change.
- **NEEDS-CODE-CHANGE: 0** — no consumed export removed, renamed, or given a new required parameter.
- **BREAKING: 0** — at the API/type level.
- Caveats that are **not** symbol-level breaks but must be tracked: (a) 2 deep `lib/` imports are outside the semver contract (**fragile**); (b) listing internals behind ~15 CLI methods were materially rewritten (**SAFE-VERIFY**, behavioral); (c) `setGqlPageSize`/1000-page perf is absent from master.

---

## 4. Upgrade-Risk Assessment (CLI: core-js 4.0.0 → master / latest-publishable)

### What just works
- **Type-check / compile:** all 72 imported symbols resolve in master; only additive changes to consumed interfaces (optional `syncStateStore?`, additive entity fields). No import statement in `src/` needs editing.
- **Constants the CLI depends on** (`turboProdUrl`, `defaultGatewayHost = ardrive.net`) are byte-for-byte unchanged.
- **arweave peer:** core-js declares `arweave: ^1.15.7` at both refs; CLI pins exact `1.15.7` → satisfies.
- **New capabilities are opt-in:** snapshots, incremental sync, hide/unhide are additive; the CLI keeps its current behavior unless it explicitly wires the new APIs.

### What needs a (non-source) change or decision
- **Dependency spec must change from an npm version to a git ref.** master (`4.1.0`) is **not on npm** — the CLI cannot `npm/yarn install ardrive-core-js@4.1.0`. It must pin a git SHA (e.g. `ardriveapp/ardrive-core-js#0e0c1a5`) in `package.json` **and** regenerate `yarn.lock`. No source-code edits required, but the manifest/lockfile change is mandatory.
- **Git-install must build `lib/`.** master adds `"prepare": "tsc --project ./tsconfig.prod.json"` (commit `151f6d1`, CORE-4) — absent at 4.0.0. This hook is what makes a git-SHA install produce the `lib/` tree the CLI's `main`/`types` **and its two deep `lib/…` imports** require. If `prepare` is skipped (e.g. `--ignore-scripts`, or a consumer that doesn't run prepare for git deps), `lib/` is missing and the build fails at the two deep imports. This is the crux of the practical risk.

### What's uncertain (verify at runtime, not just typecheck)
- **Drive-listing parity.** `listPublicFolder`/`listPrivateFolder`/`getAllDrivesForAddress`/`get*` sit on `arfsdao*.ts` that gained ~640 lines (CORE-2/5/6). Signatures are stable and the changes are robustness-oriented (tolerate bad `unixTime`, tolerate incomplete private entities, rebuild latest revision instead of trusting stale cache), but the CLI's list/download commands should be exercised against a real drive to confirm identical output ordering/content.
- **GQL node fragment now always requests `block{height,timestamp}`** on every query — harmless (extra fields), but a behavioral change to the wire query worth noting.
- **Version-expectation trap:** anyone bumping "to get the page-size/consolidation perf work" will not get it from master — that lives on the unmerged `feat/gql-page-size-and-consolidation` branch and is likewise unpublished.

### Single biggest integration risk
**Distribution, not API.** The API delta is clean and additive (0 breaking, 0 needs-change). The real exposure is that master (4.1.0) / the page-size branch (4.2.0) are **not published to npm** — the highest npm version is `4.0.0`. Consuming master forces a **git-SHA install that must run the newly-added `prepare` build hook to produce `lib/`**, and the CLI compounds this by reaching into **two internal `lib/…` paths** (`turboProdUrl`, `ArFSTagSettings`) that live outside the public-API/semver contract and would break silently on any future internal reorg. Build-on-install correctness + deep-`lib/` coupling is the single biggest practical risk of the upgrade.

---

*Evidence: `git log/diff/show/merge-base/grep` across both repos; `npm view ardrive-core-js versions/dist-tags` (read-only). No repo modified, no deps installed, no funds spent.*
