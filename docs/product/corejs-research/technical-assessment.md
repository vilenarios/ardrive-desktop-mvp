# ardrive-core-js Improvement Plan — TECHNICAL Assessment

Principal-engineer research pass, read-only across three local repos. Nothing was modified in any repo.

- **core-js**: `/mnt/c/source/ardrive-core-js` (the library; branch `fix/gql-empty-edges-guard` checked out, dev-based)
- **web**: `/mnt/c/source/ardrive-web` (mature Dart reference; branch `fix/sync-quick-wins`, v2.85.0)
- **desktop**: `/mnt/c/source/ardrive-desktop-mvp` (the consumer)

Effort scale: **S** ≈ ≤3 days · **M** ≈ 1–2 weeks · **L** ≈ 2–4+ weeks (one focused engineer).

---

## 0. CORRECTED GROUND TRUTH (context had errors — verify these first)

The task's context contained two factual errors. Corrected from git/npm evidence:

| Claim in context | Reality (evidence) |
|---|---|
| "core-js is on branch `dev`" | Working tree is on `fix/gql-empty-edges-guard` (a **dev/3.0.3-based** fix branch). `dev` itself is **dormant and 58 commits BEHIND master** (`git rev-list --count origin/dev..origin/master` = 58; `origin/master..origin/dev` = 0). |
| "desktop node_modules has core-js **4.0.0**, package.json pins ^3.0.3, and **4.0.0 isn't published**" | Desktop `node_modules/ardrive-core-js` = **3.0.3**, lockfile pins **exactly 3.0.3** with an npm-registry integrity hash. **4.0.0 IS published** — `npm view ardrive-core-js dist-tags` → `latest: 4.0.0`. Desktop is on **3.0.3**, not 4.0.0. |

**Branch/version topology (verified):**
- `origin/master` — `package.json` says `4.0.0`; is the live release line; **58 commits ahead of dev**.
- Tag `v4.0.0` = commit `a7fedad` (PR #269, "critical gateway default updated": `arweave.net` → `ardrive.net`). This is what `npm i ardrive-core-js@4.0.0` installs.
- **`master` has 3 commits AFTER the `v4.0.0` tag**: PR #270 hide/unhide (`177fb4a`, `151f6d1`, merge `b82edbc`). `git merge-base --is-ancestor 177fb4a v4.0.0` → **NO**. So **published 4.0.0 does NOT contain hide/unhide.**
- `origin/dev` — `3.0.3`, dormant, behind master. The current `fix/gql-empty-edges-guard` branch is cut from dev (pre-#270), so it also lacks hide/unhide; sibling `fix/gql-empty-edges-guard-master` carries the same fix on the master line.
- Incremental-sync branches (both **based on master**, both **unmerged**): `feat/incremental-drive-sync` = **7 commits** ahead of master; `PE-8386-incremental-drive-sync` = **10 commits** ahead.

**Deps for a 3.0.3 → 4.0.0 bump are compatible and low-risk:** both require `node>=18`, `arweave ^1.15.7`, `@ardrive/turbo-sdk ^1.0.1`; desktop already satisfies these (`arweave ^1.14.4`, `turbo-sdk ^1.27.0`). 4.0.0 only ADDS a `./web` browser export (`main` entry unchanged). The one "breaking" change (default gateway → ardrive.net) **does not affect desktop**, because desktop injects its **own** `Arweave.init({host:'arweave.net'})` instance into `arDriveFactory` (`wallet-manager-secure.ts:296-312`).

---

## 1. SNAPSHOT CONSUMPTION (read) — THE priority

**What it is.** Read ArFS `snapshot` entities so cold-start listing of a large drive reads *snapshot bodies + a short live tail* instead of replaying the drive's entire GraphQL history. Ends the desktop's always-full-sync.

**Current core-js state — ZERO.** Case-insensitive grep of `src/` for "snapshot" returns exactly one unrelated hit (a comment in `wallet_dao.test.ts:6`). No snapshot entity, no read path, no write path. Every listing is a **full GraphQL history replay**, paged 100 edges/query against a single owner-scoped query:
- `getAllFoldersOfPublicDrive` (`src/arfs/arfsdao_anonymous.ts:307`), `getPublicFilesWithParentFolderIds` (`:252`), orchestrated by `listPublicFolder` (`:367`); private mirrors in `arfsdao.ts:1614/1668`. Loop: `while(hasNextPage){ buildQuery({...,cursor,owner}); ... }`.

**Desktop impact (the measured pain).** `sync-manager.ts:3152` wipes the whole metadata cache (`clearDriveMetadataCache`) then re-lists `listPublicFolder/listPrivateFolder({maxDepth:10})` from scratch every sync (`sync-manager.ts:3099-3120`). On a large drive this is slow and 404-fragile. Schema is already staged for the fix (`drive_mappings.lastMetadataSyncAt` exists, `database-manager.ts:1351`) but nothing consumes it as a cursor. Maps to backlog **CORE-3** (P1) and **FEAT-3**.

**How web does it** (`/mnt/c/source/ardrive-web`) — **height-range set-arithmetic, not cursor chaining**:
1. Query snapshot txs: `graphql/queries/SnapshotEntityHistory.graphql` — tags `Drive-Id` + `Entity-Type="snapshot"`, `owners:[$owner]`, `block:{min:$lastBlockHeight}`, `sort:HEIGHT_DESC`; paginated by `getAllSnapshotsForDrives` (`arweave_service.dart:276`).
2. Snapshot body is JSON `{"txSnapshots":[{gqlNode, jsonMetadata}, ...]}` — it embeds **both** the original GQL node **and** the entity metadata bytes, so replaying a snapshot needs **zero per-entity data-tx GETs**. Parser: `snapshot_item.dart:255-405` (a hand-rolled brace-scanning array iterator to bound memory; filters each node by `range.isInRange(height)`; stashes `jsonMetadata` into a per-drive txId→bytes cache).
3. Merge: total window `[lastBlockHeight, currentBlockHeight]`; each snapshot claims its `[Block-Start,Block-End]` minus what newer snapshots already claimed (`obscuredBy` accumulator, newest-first). The **live tail = total − snapshotSubRanges** (`sync_repository.dart:1592`). `DriveHistoryComposite` streams both providers oldest→newest, each height segment served by exactly one source (`drive_history_composite.dart`).
4. Data handoff: `arweave_service.dart:670-718` checks the snapshot cache *before* any network fetch → snapshot-provided entities materialize with no extra GETs.
5. Precedence: structural (disjoint ranges) — newest snapshot wins overlaps; a snapshot that fails validation is dropped so its range falls back to the live tail.
6. Validation: `snapshot_validation_service.dart` — **availability only** (HEAD the snapshot tx, 200/302 ok, 404 = skip→live tail), concurrency-capped at 3, one GAR fallback gateway. No signature/hash check.

**Effort to port into core-js: M–L.** Portable building blocks (from web):
- Range/HeightRange algebra (union/difference/intersection) — **M** (pure, unit-testable, but edge cases are the backbone).
- Snapshot GQL query + pagination — **S**.
- Live tail GQL with min/max block — **S–M** (core-js already pages; add block bounds — the PE-8386 branch already added `block:{min,max}` to `buildQuery`, see §3).
- Snapshot data model + tag constants — **S** (must match on-chain format exactly for cross-client interop).
- Snapshot-body parser — **L** as a streaming parser, **S** if you accept `JSON.parse` (fine for MVP; desktop already caps files at 100MB, bodies are bounded).
- Obscuring model (newest-first subrange claim) — **M**.
- Composite merge/stream (async generators) — **M**.
- Entity-data snapshot-first cache — **M** (the payoff: skips N data-tx GETs).
- Validation — **S** (primary-gateway HEAD only) → **M** (with fallback).

**MVP read-only snapshot-aware listing** = range algebra + snapshot query + tail query + data model + JSON.parse body parser + obscuring + composite + snapshot-first cache + primary-HEAD validation. Realistically **~1.5–2 weeks (M–L)**.

**Verification.** Interop test vector: pick a snapshotted drive; assert snapshot-aware listing == full-replay listing (identical entity set + latest revisions) AND issues dramatically fewer requests (count GQL/data calls). Backlog CORE-3 acceptance already phrases exactly this.

**Dependencies.** Needs the tail query to accept block bounds (trivial; PE-8386 already did it). Naturally pairs with CORE-2 (shares the block-height watermark) but is independent. CORE-1 (owner-scoped) is already satisfied on this path (snapshot + tail queries carry `owner`).

**Classification: BETA FAST-FOLLOW (feasible, scoped as read-only MVP).** It is the single highest-leverage fix for the "slow, 404-fragile full sync on large drives" problem and web is a clean blueprint — but it is a genuine 1.5–2 week core-js effort with subtle range-math, so it is **not a beta blocker**: beta can ship on full-replay + the cheap resiliency wins (§4/§5). Land it right after beta. The streaming parser and write-side are explicitly deferred.

---

## 2. SNAPSHOT CREATION (write) — separate, lower priority

**What it is.** Produce ArFS `snapshot` entities other clients (and core-js §1) can read.

**Current core-js state — none.**

**How web does it.** `SnapshotEntity.addEntityTagsToTransaction` (`entities/snapshot_entity.dart:68-85`) writes tags `ArFS`, `Entity-Type=snapshot`, `Drive-Id`, `Snapshot-Id`, `Block-Start/Block-End`, `Data-Start/Data-End`, `Content-Type=json`. `tx_snapshot_to_snapshot_data.dart:8-38` serializes the `{"txSnapshots":[...]}` body by streaming `{gqlNode, jsonMetadata}` entries. Driven by `create_snapshot` bloc + `prompt_to_snapshot` (periodic nudge).

**Desktop impact.** Powers FEAT-3 (snapshot create/view UI). Does NOT itself end full-sync — consumption (§1) does. Creation matters so *desktop-created* drives get snapshots for future cold-starts.

**Effort: M.** Reuses the §1 data model + tag constants; add the entity/tag builder + body serializer + an upload path (Turbo). Depends on §1's data model (block 4) for shape parity.

**Verification.** Round-trip: core-js creates a snapshot → web reads it correctly (and core-js §1 reads it) → listing identical to full replay.

**Classification: POST-BETA.** Ships after consumption; gated by FEAT-3 UI which is itself deferred.

---

## 3. INCREMENTAL SYNC (CORE-2) — resume PE-8386

**What it is.** Listing APIs that accept a since/cursor (block height) so a warm re-sync of an unchanged drive transfers near-zero data. Backlog **CORE-2** (P1); desktop consumers = SYNC-8 remote polling + `drive_metadata_cache` refresh.

**Current core-js state.** None on the release line. Two unmerged branches exist (both off master):

| | `feat/incremental-drive-sync` (7 commits) | `PE-8386-incremental-drive-sync` (10 commits) |
|---|---|---|
| Integration | Modifies **existing** `arfsdao*.ts` in place; adds high-level `ArDrive` sync methods (`ardrive.ts +101`) | **Parallel** new classes `arfsdao_anonymous_incremental_sync.ts` (557 L) + `arfsdao_incremental_sync.ts` (588 L); adds `ArDrive` methods (`+82`) |
| **Filtering** | **CLIENT-SIDE**: pages history, short-circuits after `stopAfterKnownCount` known entities past `lastKnownHeight` (`arfsdao_anonymous.ts:601-606`). Does **not** touch `query.ts` → still pulls broad history. | **SERVER-SIDE**: adds `minBlock/maxBlock/first` to `buildQuery` + `block{height,timestamp}` to the node fragment (`query.ts` diff); queries only `block:{min:lastSyncedBlockHeight+1}`. Actually reduces GQL load. |
| State model | `sync_state.ts` (serialize/deserialize/**merge**/**diff**); `DriveSyncState` w/o `entityType` | `sync_types.ts` w/ `entityType`, `SyncChangeSet{added,modified,unreachable}`, `SyncStats` |
| Resumability | No partial-failure resume | **`IncrementalSyncError{partialResult, lastSuccessfulCursor}`** → resumable |
| Persistence | serialize helpers only (BYO store) | Adapters: **fs**, **browser (localStorage)**, **sqlite (`.optional`, better-sqlite3)** |
| Public/private | both | both |
| Tests/docs | `ardrive_sync.test.ts` (505 L) + migration guide | unit + **integration** tests + examples |

**Verdict — resume PE-8386.** It is further along (10 vs 7 commits) and architecturally correct: server-side `block:{min}` filtering is what actually delivers "near-zero data on unchanged drive"; feat's client-side short-circuit still walks broad history. PE-8386 also has resumable errors and persistence adapters (incl. SQLite, matching the desktop). Cherry-pick from feat only its high-level `ArDrive` API ergonomics + `mergeSyncStates/diffSyncStates` utilities if wanted.

**Completeness: PE-8386 ≈ 65–70%.** Implementation + unit/integration tests + persistence are done. **Missing / to finish:**
- **Reorg look-back (correctness bug, both branches).** PE-8386 sets `minBlock = lastSyncedBlockHeight + 1`; feat uses strict `> lastKnownHeight`. Neither has a safety window, so a chain reorg or a same-height later revision is **missed**. Web uses `kBlockHeightLookBack = 240` (`sync/constants.dart:1`, applied `sync_repository.dart:1279-1285`). Port this — it is load-bearing for correctness.
- **Rebase onto current master** (both were cut before PR #270 hide/unhide landed).
- **Deletion/`unreachable` semantics** need verifying against real drives (ArFS has no delete tx; "removed" is inferred).
- **Interop vectors** vs full-replay (delta == exactly the changed entities).
- PE-8386's SQLite adapter is `.optional` (needs `better-sqlite3`); desktop uses `node-sqlite3`, so desktop will likely persist via the `serialize/deserialize` helpers into its own DB rather than adopt that adapter — fine, but means the adapter isn't the integration path.

**Effort to finish: M** (rebase + look-back + dedup/interop tests + review + publish).

**Verification.** Unit: warm re-sync of an unchanged fixture drive issues one bounded GQL page and returns empty delta. Interop: changed-entity listing returns exactly the delta vs a full replay. Use DB-shaped fixtures for any desktop-side test (CLAUDE.md SQLite-boolean trap).

**Classification: BETA FAST-FOLLOW.** High desktop value (kills wasteful re-polls, SYNC-8), branch is ~2/3 done, but needs the reorg-lookback correctness fix + rebase + interop before it's trustworthy. Not a beta blocker (beta tolerates full re-sync); strong immediate fast-follow, and it composes with §1.

---

## 4. GATEWAY RESILIENCY / FAILOVER / WAYFINDER (SYNC-9 / SYNC-15)

**Current core-js state — single gateway, retry-in-place, no failover.**
- One `Arweave` instance (`ardrive_factory.ts:56`), default `arweave.net` (`ardrive.net` in 4.0.0); both DAOs derive one `GatewayAPI` (`arfsdao_anonymous.ts:85`, `arfsdao.ts:258`).
- `GatewayAPI.retryRequestUntilMaxRetries` (`utils/gateway_api.ts:156`): 8 retries, exponential backoff, `429` → 60s throttle (no retry consumed). **`404` is treated as a failed attempt and retried 8×** (no short-circuit) — wasteful and slow. **No host/endpoint failover.**
- `getPublicDataStream` (`arfsdao_anonymous.ts:435`) uses **plain `axios` stream with NO retry wrapper**. The `axios-retry` helper (`utils/axiosClient.ts`) exists but is **unused** by `GatewayAPI`.

**How web does it** (materially ahead):
- `data_gateway_fallback.dart`: **serial waterfall** for metadata + **hedged (staggered-parallel) racing** for downloads (`_hedgeDelay=1500ms`, first-response-wins); fallback order `primary → GAR(2) → arweave.net`. Distinguishes **all-404 (`TransactionNotFound`) vs transient**.
- `graphql_retry.dart`: 8 attempts, then on 429/5xx **fails over to a second GQL endpoint** (`arweave.net/graphql` Goldsky backstop). Retries on any non-empty `errors`.
- Typed errors (`gateway_error.dart`: `ServerError`/`RateLimitError`/…), 429-aware `retryIf:(e)=>e is! RateLimitError`, 60s stall detection on the byte stream.
- **Web does NOT use Wayfinder** — it uses `ario_sdk` GAR (Gateway Address Registry) directly + AR.IO host auto-detect. So the desktop's Wayfinder plan would put desktop *ahead* of web on routed/verified retrieval.

**Wayfinder** (`docs/vendor/wayfinder-core-README.md`, `docs/features/wayfinder-integration-proposal.md`): `@ar.io/wayfinder-core` = routing (`Random`/`RoundRobin`/`FastestPing`/`PreferredWithFallback`) + verification (`Hash`/`Signature`) + gateway providers (`NetworkGatewaysProvider` top-N by operator stake). Desktop proposal = app-side `WayfinderService` wrapping raw data fetches (`getFileUrl(txId)` with fallback to `arweave.net`) — explicitly **does not touch core-js GQL**.

**Doable APP-SIDE (no core-js change) vs NEEDS core-js:**

*App-side today (desktop already owns these fetches, hardcoded to `arweave.net`):*
- **Public data downloads** — `DownloadManager.ts:704` (`https://arweave.net/${dataTxId}`) + `StreamingDownloader` bypass core-js entirely. Route via Wayfinder or a simple `[turbo-gateway, perma.online, arweave.net]` failover list. This is the SYNC-15 "raw data fetches can migrate earlier" carve-out and the SYNC-9 beta minimum.
- **Desktop's own hand-rolled GQL** — `sync-manager.ts:721` (`fetch('https://arweave.net/graphql')`, **no owner filter, `first:100` no cursor** → truncates large folders and fails on turbo-gateway). Desktop can add owner + cursor + failover here itself.
- **Gateway for the injected Arweave instance** — desktop builds `Arweave.init({host:'arweave.net'})` at ~6 sites and injects it (`wallet-manager-secure.ts:296`); swapping the host is one line per site.

*Needs core-js (because these go through core-js's single `GatewayAPI`):*
- **Private downloads** (`downloadPrivateFile`) and **ALL metadata listing** (`listPublic/PrivateFolder`, `getAllDrivesForAddress`) — to fail over these, core-js's `GatewayAPI` must accept a **gateway list / pluggable provider** and do endpoint-failover + 404-vs-transient. Injecting a failover-capable single Arweave is a hack; the clean fix is upstream.
- **CORE-1 (owner-scoped GQL) is the prerequisite** for pointing core-js's metadata GQL at a non-arweave.net gateway (turbo-gateway requires `owner`). Largely landed in 3.0.3 already (`buildQuery` threads `owners:[...]`, listing passes `owner`); remaining work is an **audit + owner-unknown discovery flow** (`getDriveIDForEntityId` omits owner by design) + converge with web. **Effort S.**

**Effort.**
- App-side public-download failover (SYNC-9 beta minimum): **S** (desktop-side).
- core-js `GatewayAPI` multi-gateway + endpoint-failover + 404-vs-transient + typed errors (port web's `data_gateway_fallback` + `graphql_retry`): **M–L**.
- `getPublicDataStream` retry wrapper: **S** (core-js bug fix).
- CORE-1 owner-scope audit: **S**.

**Verification.** Point the gateway at a host that 404s a known tx → assert fallback to the next gateway serves it; assert a genuinely-absent tx returns a typed not-found after trying all, not 8×timeout. Interop: full drive listing + sync round-trip against `turbo-gateway.com` GQL (CORE-1 acceptance).

**Classification:**
- App-side public-download failover (SYNC-9): **BETA** ("no single hard gateway dependency" is a beta minimum).
- CORE-1 audit: **BETA FAST-FOLLOW** (unblocks SYNC-15; small).
- core-js `GatewayAPI` multi-gateway + `getPublicDataStream` retry: **BETA FAST-FOLLOW** (core-js private/metadata paths); the full Wayfinder routing+verification is **POST-BETA** (SYNC-15 deferred).

---

## 5. BROADER core-js ⟷ web PARITY GAP SWEEP

Concrete places web is materially ahead (evidence cited; not invented). Severity = resiliency/correctness impact; effort = port to TS.

| # | Gap | core-js state | web reference | Sev | Eff |
|---|---|---|---|---|---|
| P1 | **Multi-gateway data failover + 404-vs-transient** | single gateway; 404 retried 8× then thrown | `data_gateway_fallback.dart:46-225` | HIGH | M |
| P2 | **GraphQL endpoint failover (Goldsky backstop) + retry-on-errors** | GQL POST retried in place, no endpoint failover | `graphql_retry.dart:26-108` | HIGH | S |
| P3 | **`getPublicDataStream` has NO retry wrapper** | plain `axios` stream, `arfsdao_anonymous.ts:435` | web streams via retry/fallback | HIGH | S |
| P4 | **Download stall detection** (mid-stream hang) | none | `ardrive_downloader.dart:276-325` (60s) | HIGH | S |
| P5 | **Hedged parallel download racing** (tail-latency) | serial single gateway | `data_gateway_fallback.dart:92-158` | MED-HIGH | M |
| P6 | **Typed error taxonomy** (route retry decisions) | string errors + hand-rolled | `error/gateway_error.dart`, `download_exceptions.dart` | MED | S |
| P7 | **Bounded concurrency for GQL/HEAD fan-out** | `edges.map(async…)` = **unbounded `Promise.all` per 100-page** (`arfsdao_anonymous.ts:330`) | `arweave_service.dart:1396-1428` (maxConcurrent 5), snapshot HEADs capped 3 | MED | M |
| P8 | **AbortSignal / cancel support** | **none** — grep `abortsignal` in master = 0 hits; blocks desktop MONEY-2/MONEY-12 (`UploadQueueManager.ts:166`) | web cancels via bloc/http | MED | S-M |
| P9 | **Layered/TTL caching** | folder/entity in-mem caches only | `metadata_cache.dart` (persistent, 550-cap), `snapshots_cache.dart` (5-min TTL), entity/drive-tx caches | MED | M |
| P10 | **In-flight promise de-duplication** | none evident | `sync_repository.dart:1229-1249` | MED | S |
| P11 | **Cursor-resumable pagination surviving filtered pages** | pages on `pageInfo.hasNextPage` (OK for main listing) but **cursor only advances inside the edge loop → empty-edges + hasNextPage=true risks a stuck loop**; empty-edges guard only added on 2 drive-lookups (`fix/gql-empty-edges-guard`, +12 LOC) | `arweave_service.dart:743-785, 950-990` (advances cursor even when a page is all-filtered) | MED | M |
| P12 | **Snapshot consumption/creation** | none (§1/§2) | full pipeline | HIGH | L |
| P13 | **Hide/unhide** | on master post-`v4.0.0`, **unpublished** (§6) | web has it | (see CORE-4) | done, needs publish |

Newer-ArFS-feature note: manifests exist in both; **hide/unhide** landed on core-js master but is unpublished; **snapshots** absent in core-js; web additionally has license lookups and GAR/ArNS via `ario_sdk` that core-js lacks. Web's own ceilings (so *not* parity targets): no Wayfinder, no mid-file byte-range resume.

**Classification of the sweep:** P2, P3, P4, P6, P10 are cheap high-value **BETA FAST-FOLLOW** hardening (S each). P1, P5, P7, P9, P11 are **BETA FAST-FOLLOW → POST-BETA** (M). P8 AbortSignal is **BETA FAST-FOLLOW** (unblocks MONEY-2 cancel). P12 = §1/§2. P13 = §6/CORE-4.

---

## 6. VERSION / PIN REALITY (CORE-4 publish path)

**Topology (verified in §0).** Published npm: `latest = 4.0.0` (tag `v4.0.0` = `a7fedad`). Desktop is on **3.0.3** (lockfile-pinned, `^3.0.3`). `dev` (3.0.3) is dormant/behind; **`master` (4.0.0-in-package.json) is the live line, 58 commits ahead of dev**, with **3 commits past the `v4.0.0` tag** that add hide/unhide (unpublished).

**What "align the pin" actually requires — two distinct steps, don't conflate:**

1. **Bump `^3.0.3 → 4.0.0` (S, low-risk).** Deps compatible (§0). Desktop *gains*: dedupe-latest-revisions in listing/manifests (`58ff2e9`), manifest timestamp fixes, drive rename/move + public-manifest APIs, browser build, various fixes. Desktop *does NOT gain*: **hide/unhide, incremental, snapshots** (none are in 4.0.0). The ardrive.net default-gateway change is moot for desktop (injects its own Arweave). **Do this first** as a de-risking checkpoint with an interop round-trip (D-016/D-018).

2. **To unblock CORE-4/SYNC-5 (hide/unhide) — a NEW publish is required.** PR #270 is merged to master but sits *after* the `v4.0.0` tag, so it is **not on npm**. Path: cut `4.1.0` (or an alpha/tarball) from master → `npm publish` → desktop bumps to `^4.1.0`. This is exactly the "PENDING publish" step the backlog CORE-4 note flags. Same publish-gate applies to any incremental/snapshot work: it must merge to master and be released before desktop can consume it.

**Practical sequencing:** land future core-js work (CORE-1 audit, hide/unhide publish, then incremental §3, then snapshot §1) on the **master** line, republish per milestone, and have desktop track the pin forward with an interop check each bump. The dev/3.0.3 line should be abandoned (it's a dead-end 58 behind).

**Effort:** step 1 = **S**; the recurring publish discipline = **S** each.
**Classification:** step 1 (bump to 4.0.0) = **BETA** (cheap de-risk, gains real fixes). Publish-with-hide/unhide = **BETA** (P0 SYNC-5 depends on CORE-4).

---

## RANKED WORK-ITEM TABLE (by desktop impact)

| # | Work item | Area | Effort | Class | Unblocks / fixes |
|---|---|---|---|---|---|
| 1 | Bump core-js pin 3.0.3 → **4.0.0** + interop check | §6 | S | **Beta** | dedupe-latest-revisions, manifest/timestamp fixes, browser build; de-risks the line |
| 2 | Publish core-js release **incl. hide/unhide** (PR #270) → desktop consumes | §6 / CORE-4 | S | **Beta** | **CORE-4 → SYNC-5** (P0 delete→hide) |
| 3 | App-side public-download **gateway failover** (turbo-gateway → perma.online → arweave.net) | §4 | S | **Beta** | SYNC-9 "no single hard gateway"; 404 resilience on raw data |
| 4 | **CORE-1** owner-scoped GQL audit + owner-unknown discovery (converge w/ web) | §4 | S | **Beta fast-follow** | **SYNC-15** gateway swap for metadata; turbo-gateway GQL |
| 5 | core-js cheap resiliency pack: **P2** GQL endpoint failover, **P3** stream retry, **P4** stall detect, **P6** typed errors, **P10** promise-dedup | §5 | S each | **Beta fast-follow** | fewer sync hangs/false-permanent errors across all core-js fetches |
| 6 | **AbortSignal** in upload/create APIs (P8) | §5 | S–M | **Beta fast-follow** | MONEY-12 → MONEY-2 cancel-in-flight |
| 7 | **Snapshot CONSUMPTION** (read-only MVP) | §1 / CORE-3 | M–L | **Beta fast-follow** | ends always-full-sync; fast+robust cold-start on large drives |
| 8 | **Incremental sync** — resume **PE-8386** (+ reorg look-back, rebase, interop) | §3 / CORE-2 | M | **Beta fast-follow** | SYNC-8 polling; near-zero-data warm re-sync |
| 9 | core-js `GatewayAPI` **multi-gateway/endpoint failover + 404-vs-transient** (P1); bounded concurrency P7; caching P9; pagination-guard P11 | §4 / §5 | M–L | **Beta fast-follow → Post-beta** | failover for **private downloads + all metadata listing** (only fixable in core-js) |
| 10 | **Snapshot CREATION** (write) | §2 / CORE-3 | M | **Post-beta** | FEAT-3 snapshot UI; desktop-created drives get snapshots |
| 11 | Full **Wayfinder** routing + hash/signature verification (app-side) | §4 / SYNC-15 | M–L | **Post-beta** | verified retrieval; stake-weighted routing (ahead of web) |

---

## KEY VERDICTS (summary)

- **Snapshot consumption as beta fast-follow: YES, feasible** — scoped to a **read-only MVP** (snapshot query + tail + range algebra + `JSON.parse` body parser + snapshot-first cache + primary-HEAD validation; defer streaming parser + write-side). ~1.5–2 weeks (M–L). Highest-leverage fix for the measured full-sync pain; web is a clean blueprint. Not a beta *blocker* (beta ships on full-replay + cheap resiliency), but the #1 fast-follow.
- **Incremental branch: resume `PE-8386-incremental-drive-sync`** — ~65–70% done, architecturally correct (server-side `block:{min}` filtering, resumable errors, persistence incl. SQLite). Beats `feat/incremental-drive-sync` (client-side filtering only). Finish = **add reorg look-back (both branches miss it — correctness bug; web uses 240-block window)** + rebase onto master + dedup/interop tests + publish. Effort M.
- **Gateway failover split:** public **raw** data downloads + desktop's own GQL are fixable **app-side today** (Wayfinder or a simple list) → SYNC-9 beta minimum. **Private downloads + all metadata listing route through core-js's single `GatewayAPI`** → real failover there **needs core-js** (multi-gateway provider), gated on **CORE-1** for the metadata path.
- **Version reality:** context was wrong — desktop is on **3.0.3** (not 4.0.0), and **4.0.0 IS published** but **excludes hide/unhide** (PR #270 is on master after the tag). "Align the pin" = (1) bump to 4.0.0 now [S, safe], then (2) **cut a new release incl. PR #270** before SYNC-5 can consume CORE-4. Retire the dead `dev`/3.0.3 line; land future work on **master** + republish per milestone.
