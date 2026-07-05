# ardrive-core-js Improvement Plan (beta-critical, per D-026)

**Purpose.** Bring the desktop app's sync **performance and UX to ≥ ardrive-web** (per **[D-026](DECISIONS.md)**) by closing the ardrive-core-js gaps behind the desktop's slow, full-history-replay sync. This is the **beta sequencing spine**, not a post-beta program.

Synthesized by the PM from two research passes (read-only, nothing modified):
- Technical + web-parity: `scratchpad/corejs-plan/technical-assessment.md`
- CLI-as-harness: `scratchpad/corejs-plan/cli-assessment.md`

Effort scale: **S** ≤3 days · **M** 1–2 weeks · **L** 2–4+ weeks (one focused engineer).

---

## 1. Why this is beta-critical (the measured problem)

core-js has **zero snapshot support** (grep-confirmed). So the desktop reconstructs every drive by **full GraphQL history replay** — `sync-manager.ts:3152` wipes the metadata cache and re-lists the whole drive from scratch every sync. On a large drive that is slow and 404-fragile: proven live 2026-07-05 — a snapshotted drive timed out at 150s in a transient turbo-gateway 404 storm, while the exact tx it choked on returned 200 on retry/curl. **The data was fine; the *approach* (walk everything, every time) is the defect.** ardrive-web solved this years ago with snapshots + incremental sync. Shipping without them = shipping worse than web = D-026 violation.

## 2. Corrected ground truth (a release dependency, not housekeeping)

The desktop's shipping dependency is **core-js `3.0.3`** (lockfile-pinned, npm-integrity), **not** the 4.0.0 that happened to be installed in a scratch worktree. And:

- Published **`4.0.0` does NOT contain hide/unhide** — PR #270 sits on `master` *after* the `v4.0.0` tag (`git merge-base --is-ancestor 177fb4a v4.0.0` → NO).
- The desktop's **PRIV-SIG-1 fix depends on `getDriveSignatureInfo`** (in the 4.x line), and **CORE-4/SYNC-5 depend on hide/unhide** (master, post-4.0.0).
- ⇒ **Beta requires core-js to cut a fresh release off `master`** (with #270 hide/unhide + #271 zero-edge guard + owner-scoped GQL) and desktop to **pin to it**. Bump risk is low: node/arweave/turbo peer ranges already satisfied; the only 4.0.0 "breaking" change (default gateway → ardrive.net) doesn't affect desktop, which injects its own Arweave instance.

This is **BETA-BLOCKING item #1** — everything else rides on a clean, current core-js release.

## 3. Work items, ranked & classified (reconciled with D-026)

Per D-026, snapshot **consumption** and incremental sync are **beta-blocking** (the scout's engineering view rated them "fast-follow"; Phil's product call overrides — they're in beta, with the effort below made explicit for sequencing).

| # | Item | Effort | Class | Unblocks / Why |
|---|---|---|---|---|
| 1 | **core-js release off master + desktop pin bump** (hide/unhide #270, #271, owner-GQL, getDriveSignatureInfo) | S | **BETA (blocker)** | Prereq for CORE-4/SYNC-5, PRIV-SIG-1 shipping, all below |
| 2 | **Snapshot CONSUMPTION (read-only MVP)** | M–L (~1.5–2wk) | **BETA (D-026)** | Ends always-full-sync; fast large-drive cold-start — *the* ≥web fix |
| 3 | **Incremental sync — resume `PE-8386`** (+reorg look-back) | M | **BETA (D-026)** | Delta-only warm re-sync; SYNC-8 |
| 4 | **App-side gateway failover** (public dl + desktop GQL: turbo→perma→arweave) | S | **BETA** | 404 resilience without core-js; "handle 404s + fall back" |
| 5 | **Cheap resiliency pack** (GQL endpoint failover, stream retry, stall-detect, typed errors, promise-dedup) | S each | **BETA fast-follow** | Fewer sync hangs / false-permanent errors |
| 6 | **CORE-1 owner-GQL audit + owner-unknown discovery** | S | **BETA fast-follow** | SYNC-15 metadata gateway swap; prereq for #8 metadata failover |
| 7 | **AbortSignal in upload/create APIs** | S–M | Fast-follow | MONEY-12 → MONEY-2 cancel |
| 8 | **core-js `GatewayAPI` multi-gateway/endpoint failover** (+concurrency/caching/pagination guards) | M–L | Fast-follow → post-beta | Failover for *private* downloads + all metadata listing |
| 9 | **Snapshot CREATION (write)** | M | **Post-beta** | FEAT-3 snapshot UI |
| 10 | **Full Wayfinder routing + verification** | M–L | **Post-beta** | Stake-weighted/verified retrieval |

## 4. The four beta-critical workstreams

### A. Release alignment (item 1) — do first, unblocks everything
core-js: cut a release off `master` (has #270/#271/owner-GQL/getDriveSignatureInfo). Desktop: bump the pin, run an interop check, re-verify PRIV-SIG-1 + hide/unhide against the pinned release. **Verification:** CLI + desktop unit suite green on the new pin.

### B. Snapshot consumption (item 2) — the headline ≥web fix
Port web's **height-range set-arithmetic** model (not cursor chaining). Web blueprint is clean and portable (`snapshot_item.dart`, `sync_repository.dart:1553-1615`, `SnapshotEntityHistory.graphql`):
1. Query snapshot txs (`Entity-Type=snapshot`, owner-scoped, `block:{min:lastHeight}`).
2. Snapshot body embeds **both** the GQL node **and** the entity metadata bytes → replaying a snapshot needs **zero per-entity data-tx GETs** (this is the speed win).
3. Merge: total window `[lastHeight, currentHeight]`; newest snapshot claims its block sub-range; **live tail = total − snapshot ranges**.
4. Entity-data cache checked **before** any network fetch.
5. Validation = **availability only** (HEAD the snapshot tx; 404 → skip to live tail). No signature/hash check needed for the MVP.
**MVP scope:** `JSON.parse` body parser (defer the streaming parser), primary-gateway HEAD validation (defer fallback), read-only (defer write). Range algebra is the backbone — unit-test it hard. Schema is already staged (`drive_mappings.lastMetadataSyncAt`).

### C. Incremental sync (item 3) — resume `PE-8386`, don't restart
`PE-8386-incremental-drive-sync` (10 commits, ~65–70% complete) beats `feat/` (7 commits): server-side `block:{min}` filtering, resumable `IncrementalSyncError{partialResult, lastSuccessfulCursor}`, `entityType` tracking, fs/browser/sqlite persistence adapters. **To finish (M):** ⚠️ **both branches share a correctness bug — no reorg look-back** (PE-8386 uses `minBlock = lastSyncedHeight+1`; a reorg or same-height-later revision is missed). Web uses a **240-block safety window** (`kBlockHeightLookBack`) — port it. Then rebase onto the new master release, verify deletion/`unreachable` semantics, add interop-vs-full-replay vectors. Optionally cherry-pick `feat/`'s high-level `ArDrive` API + `merge/diffSyncStates` helpers.

### D. Gateway resiliency (items 4 + 8) — split cleanly
- **App-side, beta, no core-js change (item 4):** public raw-data downloads (`DownloadManager.ts:704`, `StreamingDownloader`), the desktop's own hand-rolled GQL (`sync-manager.ts:721`), and the injected Arweave host — add ordered failover (turbo-gateway → perma.online → arweave.net) + retry-on-404. Covers the SYNC-9 beta minimum and Phil's "fall back to perma.online."
- **Needs core-js (item 8, fast-follow→post-beta):** private downloads (`downloadPrivateFile`) and **all** metadata listing route through core-js's single `GatewayAPI` (8× retry-in-place, 404 retried as failure, no host failover; `getPublicDataStream` has *no* retry). Real failover there is a core-js change, gated on CORE-1 (owner-scoped GQL) for the metadata path.

## 5. Verification — the CLI harness (how we avoid repeating today's pain)

We will **not** verify core-js changes through Electron (today's Playwright+gateway flakiness cost hours). Instead, **ArDrive-CLI** (cloned, `ardrive-core-js@4.0.0`, actively maintained, same org):
- README documents pointing at a **local core-js checkout** (`"ardrive-core-js": "../ardrive-core-js/"`) for dev-branch testing — well-worn.
- All read commands emit `JSON.stringify` → machine-parseable; `--dry-run` runs the **full ArFS pipeline without broadcasting a tx** (free, headless), with an existing **BATS suite** asserting via `jq`.
- Gateway (`-g`) + Turbo (`--turbo-url`) are per-command flags → point at turbo-gateway.com / perma.online at will. Public reads need no wallet.
**Plan:** add `create-snapshot` / snapshot-aware-list + incremental flags to the CLI as we build them (~few days), and drive **interop vectors** = *snapshot/incremental result must equal full-replay result* on fixed public drives. This is the correctness gate for B and C.

## 6. Loop structure & sequencing

**A dedicated, beta-critical core-js loop** — same three-role cadence (implementer / qa-gate) in the core-js repo, coordinated here, verified via the CLI harness + interop vectors. Runs **in parallel** with finishing the desktop beta items, but its output is **on** the beta critical path.

**Dependency order:** `A (release) → then B, C, D-app in parallel → D-core-js + resiliency pack fast-follow`. A gates everything; B and C are the long poles (~2wk + ~1–2wk); D-app is independent and quick.

## 7. The ≥web acceptance gate (D-026, made measurable)

Beta does not exit until, on a large real drive (use the owner's snapshotted drives):
- [ ] **Cold-load** is snapshot-accelerated (reads snapshot + tail), within parity of web — **not** a full-history replay.
- [ ] **Warm re-sync** fetches **deltas only** (incremental), not a full walk — near-zero data on an unchanged drive.
- [ ] Sync **rides through** gateway 404 blips (retry + fallback), never stalls/timeouts the whole drive.
- [ ] Large-drive listing/status UX is as responsive as web.
- [ ] Interop: snapshot/incremental listing == full-replay listing on fixed vectors (via CLI harness).

## 8. Open decisions for Phil

1. **Snapshot creation (item 9)** — confirm post-beta (consumption is the ≥web fix; creation only powers FEAT-3's "make a snapshot" UI). **Recommend: post-beta.**
2. **Incremental in beta vs fast-follow** — D-026 puts it in beta. It's ~M and depends on the release + reorg fix. Confirm it stays a beta blocker vs. ship snapshots-first and incremental as the immediate fast-follow. **Recommend: snapshots beta-blocking; incremental beta-blocking but sequence second.**
3. **Who staffs the core-js loop** — same agentic loop (authorized per D-016) coordinated here, or does core-js work route through your team's own review? Affects cadence and how PRs land.
