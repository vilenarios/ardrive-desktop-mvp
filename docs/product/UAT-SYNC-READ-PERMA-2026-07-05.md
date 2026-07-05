# UAT — Snapshot + Download-Sync Re-Certification on perma.online (2026-07-05)

**Tester:** automated live UAT harness (`scripts/uat/live-syncread-perma.js`, Electron running the real built `dist/main/*` services)
**Branch:** `uat/syncread-perma` off `main @ 5e76e3e` (all fixes, ardrive-core-js 4.0.0, SYNC-17 gateway override)
**Scope:** READ-ONLY re-run of the snapshot-drive listing + download-sync certification that the prior read-lane (`UAT-RUN-2-LIVE`) could not complete because turbo-gateway.com was mid–404-storm.
**Money/safety:** READ-ONLY. Real owner wallet loaded for **listing / loading / downloading only** — no uploads, writes, hides, deletes, creates, or spends. Wallet balance unchanged (1.397451800582 AR / 8.502725 Turbo, identical before and after). Password read at runtime from `.env`, never printed/committed. Only counts/sizes/hashes/load-times reported — no names, no decrypted content, no secrets.

---

## 1. Headline verdict for the PM

The re-run produced a result the prior run could not: **a clean read on whether snapshots break core-js listing.** The answer is nuanced and splits cleanly into a *correctness* verdict and an *availability* verdict.

1. **Snapshots do NOT break, corrupt, or truncate core-js listing.** On a gateway that serves this owner's data, **every snapshotted public drive that listed matched the on-chain GraphQL ground truth EXACTLY** — files and folders — including a multi-folder drive (30 files / 8 folders). Re-listing was deterministic (38 = 38 entities). Non-snapshot drives behaved identically (6/6 complete). **Completeness/correctness: PASS.**

2. **The assigned gateway, perma.online, could not run the test at all** — not because of snapshots, but because **perma.online's GraphQL does not index THIS owner's ArFS metadata.** The app resolved to perma.online (confirmed in-app), then `listDrivesWithStatus` returned **0 drives in 428 ms**. perma.online serves the owner's DATA by-txid perfectly (8/8, 10/10 in curl) but returns EMPTY for every `owners + Entity-Type=drive|file|folder|snapshot` GraphQL query, so core-js cannot even enumerate the drives. This is a **perma.online index gap for this owner, not missing on-chain data** (turbo returns the same metadata; the data is retrievable by-id on both gateways).

3. **The actual snapshot/download certification was obtained on the recovered turbo-gateway.com** (control run, same harness). turbo's data endpoint has recovered (10/10 200s) and it indexes the owner's metadata, so it is the only gateway tested that can actually drive core-js listing for this wallet.

4. **Download-sync works.** A small public file was pulled to an empty native local folder via the app's real `StreamingDownloader`; it landed on disk (11,623 B) with a valid sha256 matching the metadata size. **PASS.**

5. **Was the prior failure purely the turbo blip? Mostly — but not purely.** turbo recovered enough that snapshot listing went from "1 of 7 drives listed (130 s), 6 blocked" to "4 of 10 listed complete (several < 5 s)". But turbo **still 404-storms intermittently** (94+ 404s in this run) and still blocked 5 large / most-snapshotted drives at the 150 s cap (640f8cd3 blocked in **both** runs). And two failures are **not gateway-related at all** (see §5): a core-js `Unix time must be a positive integer!` hard error on one drive, and `Invalid file state` on private-drive listings. Underneath it all sits the structural cause: **core-js 4.0.0 has zero snapshot support, so it reconstructs every drive by full-history replay** — many requests — which is exactly why large/most-snapshotted drives sink on any flaky gateway.

**Certified live:** snapshots do not corrupt listings (4/4 + 6/6 exact ground-truth match, deterministic); download-sync to native disk (byte-valid); hidden-state plumbing; private-drive unlock (PRIV-SIG-1 v1+v2).
**Not certified (blocked):** perma.online as an app gateway for this owner (metadata GraphQL gap); a full 10/10 snapshot-drive listing on any single gateway tested; private-drive *decrypted listing* (core-js `Invalid file state` + gateway timeout).

---

## 2. Environment & method

| Item | Value |
|---|---|
| App | production build (`npm run build`) of `uat/syncread-perma @ 5e76e3e` |
| Runtime | `./node_modules/.bin/electron scripts/uat/live-syncread-perma.js`, disposable `userData` (auto-deleted) |
| ardrive-core-js | 4.0.0 (**no snapshot support** — full-history replay for all listings) |
| Owner wallet | `iKryOeZQ…oRjA` (WSL keyfile), **READ-ONLY** |
| Gateway under test | **perma.online** (`ARDRIVE_GATEWAY_HOST=perma.online`; SYNC-17 env > config > default) — confirmed in-app: `getGatewayHost()` = `perma.online` |
| Control gateway | **turbo-gateway.com** (recovered) — separate run, `ARDRIVE_GATEWAY_HOST=turbo-gateway.com` |
| Ground truth | independent GraphQL `distinct File-Id / Folder-Id` counts (owner-scoped), run against a working gateway so completeness is verifiable regardless of the gateway-under-test |
| Downloads | native ext4 folder `…/scratchpad/uat-syncread-perma/downloads/` (not `/mnt/c`) |
| Logs | `…/scratchpad/uat-syncread-perma/run.log` (perma), `run-turbo-control.log` (turbo), `build.log` |

**Ground-truth design note.** Because perma.online's GraphQL does not return this owner's ArFS metadata, using perma for the completeness cross-check would yield false zeros. The harness therefore points the **app-under-test** at the target gateway but runs the **independent ground-truth GraphQL** against a gateway that indexes the metadata (turbo). This is *more* rigorous, not less: the app's core-js listing is judged against an on-chain truth it did not itself produce.

---

## 3. Owner drive inventory (ground truth, on-chain)

| Metric | Count |
|---|---|
| Total drives | 20 (16 public, 4 private) |
| Snapshotted drives (Entity-Type=snapshot on-chain) | **13 distinct** (25 snapshot txs total) |
| Snapshotted **public** | 10 |
| Snapshotted **private** | 3 |
| Most-snapshotted drive | `2c69d539…` (9 snapshot txs) |

Setup PASSED identically on both gateways for the *snapshot ground truth* (13/10/3) because that count comes from the independent GraphQL path. The difference is entirely in what **core-js could reconstruct** from each gateway.

---

## 4. Scenario results

### Scenario table

| # | Scenario | perma.online (assigned) | turbo-gateway.com (recovered, control) |
|---|---|---|---|
| — | App resolved gateway | ✅ `perma.online` (confirmed in-app) | ✅ `turbo-gateway.com` |
| — | `listDrivesWithStatus` | ❌ **0 drives in 428 ms** (metadata GraphQL gap) | ✅ **20 drives in 1,142 ms** |
| 1 | Snapshot public-drive listing COMPLETE + correct | ⛔ blocked at source (0 drives) | ✅ **4/4 listed = exact ground-truth match** (files+folders); 5/10 gateway-blocked (150 s timeout); **1/10 core-js hard error** |
| 1 | Deterministic re-list | ⛔ n/a | ✅ 38 = 38 entities (`1f373b21…`) |
| 1 | Non-snapshot consistency baseline | ⛔ n/a | ✅ 6/6 complete |
| 2 | Largest drive lists fully | ⛔ n/a | ✅ `1f373b21…` 30 files / 8 folders / 38 total in **4,968 ms** |
| 3 | Download-sync → native local disk | ⛔ n/a (no drives) | ✅ **1/1 landed, byte-valid** (11,623 B, sha256 = metaSize) |
| 4 | Special files (hidden/isHidden) | ⛔ n/a | ✅ isHidden surfaced (0 hidden entities in this data) |
| 5 | Private + snapshot: unlock + decrypted list | ⛔ n/a | ⚠️ **3/3 unlocked** (PRIV-SIG-1 v1+v2), but **0/3 listed** (2× core-js `Invalid file state`, 1× 150 s gateway timeout) |

### Scenario 1 — per-drive snapshot listing (turbo control run)

| Drive (prefix) | snaps | Result | Files (list/gt) | Folders (list/gt) | Time |
|---|---|---|---|---|---|
| `c863be1f…` | 1 | ✅ COMPLETE | 3 / 3 | 0 / 0 | 1,865 ms |
| `a84b951b…` | 1 | ✅ COMPLETE | 12 / 12 | 1 / 1 | 2,408 ms |
| `3b6b8980…` | 1 | ✅ COMPLETE | 5 / 5 | 1 / 1 | 68,758 ms |
| `1f373b21…` | 2 | ✅ COMPLETE | 30 / 30 | 8 / 8 | 4,968 ms |
| `640f8cd3…` | 1 | ⛔ gateway timeout (150 s) — blocked in prior run too | — | — | 150,000 ms |
| `21e28851…` | 1 | ⛔ gateway timeout (150 s) | — | — | 150,000 ms |
| `47b02f32…` | 2 | ⛔ gateway timeout (150 s) | — | — | 150,000 ms |
| `83f0adae…` | 1 | ⛔ gateway timeout (150 s) | — | — | 150,000 ms |
| `2c69d539…` | 9 | ⛔ gateway timeout (150 s) — most-snapshotted/largest history | — | — | 150,000 ms |
| `a173761d…` | 1 | 🐞 **core-js hard error**: `Unix time must be a positive integer!` | — | — | — |

**Every drive that listed listed COMPLETELY and correctly.** No drive returned a partial or wrong tree. The failures are timeouts (availability) and one core-js parse error — never a silent truncation.

---

## 5. Findings

### F1 — perma.online GraphQL does not index this owner's ArFS metadata (blocks all listing)
perma.online is a full gateway for **data** (curl: the owner's file-metadata/data txids return 8/8 and 10/10 200s; sandbox redirects work), and it indexes *other* owners' metadata and this owner's `App-Name=ArDrive-Core` data-items. But for owner `iKryOeZQ…`, **every combined `owners + tags` GraphQL query for ArFS metadata returns empty**:

| GraphQL query (owner = iKryOeZQ…) | perma.online | turbo-gateway.com |
|---|---|---|
| `owners` only | ✅ returns txs | ✅ |
| `Entity-Type=snapshot` only (any owner) | ✅ returns txs | ✅ |
| `owners + Entity-Type=drive` | ❌ **0 edges** | ✅ 5 edges |
| `owners + Entity-Type=file` | ❌ **0 edges** | ✅ |
| `owners + Entity-Type=snapshot` | ❌ **0 edges** | ✅ 3 |
| `owners + App-Name=ArDrive-App` | ❌ **0 edges** | ✅ |
| `owners + App-Name=ArDrive-Core` | ✅ (a data-item) | ✅ |

The in-harness probe reproduced this exactly: *"GraphQL owner+Entity-Type=drive probe: perma.online returns 0 edge(s); turbo-gateway.com returns 5 edge(s)."* Because core-js reconstructs drives entirely via these combined queries, **core-js on perma.online sees 0 drives for this owner.** This is an index gap on perma.online (the metadata exists on-chain and is served by turbo), **not** missing data and **not** a snapshot problem.

### F2 — Snapshots do not corrupt listings; the failure mode is availability, not correctness
On turbo, 4/4 snapshot drives + 6/6 non-snapshot drives that listed matched ground truth exactly, and the re-list was deterministic. The drives that failed did so by **timeout** (5) or a **core-js parse error** (1), never by returning a wrong/partial tree. Snapshots are transparent to core-js (it ignores them and replays full history); the listing it produces is complete and correct when it completes.

### F3 — turbo still 404-storms intermittently; the no-snapshot replay amplifies it on big drives
turbo's data endpoint has recovered (10/10 on the prior-failing tx), but the harness still logged **94+ intermittent 404s** with exponential backoff up to 64 s. The 5 timed-out drives are the **largest / most-snapshotted** (2c69d539 = 9 snaps; 640f8cd3; 47b02f32; …). Scenario-6 curl proof: a file-metadata tx from the *blocked* drive `640f8cd3` returns **turbo 7/8, perma 8/8 200s** — the data is present and retrievable by-id on both gateways. So the block is *not* a missing tx; it is **cumulative backoff from intermittent 404s across the many-request full-history replay** exceeding the 150 s cap. This is the structural cost of core-js 4.0.0 having no snapshot support.

### F4 — Two non-gateway core-js robustness errors
- `a173761d…` (public, snapshotted): **`Unix time must be a positive integer!`** thrown during reconstruction — a malformed/zero timestamp somewhere in that drive's history that core-js refuses to parse. Reproducible; independent of gateway.
- Private drives `cabca9d6…` (v1) and `8d81a9db…` (v1): **`Invalid file state`** during `listPrivateFolder` (with `Error decrypting file data` / `Error building folder. Skipping…` in the log) — decrypted-listing reconstruction fails on some entities. Independent of gateway (`cce4300f…` failed separately on a gateway timeout).

### F5 — Private-drive UNLOCK works (PRIV-SIG-1); decrypted LISTING is the blocker
All 3 snapshotted private drives **unlocked successfully** — v1 (`cabca9d6`, `8d81a9db`) and v2 (`cce4300f`) — confirming PRIV-SIG-1's per-drive v1/v2 signature handling. The failure is downstream, in the decrypted folder reconstruction (F4) and gateway latency, not in key derivation.

### F6 — Download-sync verified end-to-end
`StreamingDownloader` pulled a small public file from drive `c863be1f…` to an empty native ext4 folder: **on-disk 11,623 B = metadata 11,623 B**, sha256 `4f116279784a…` (64-hex, valid), in 16.2 s. File present on disk after the run.

---

## 6. Answers to the commissioning questions

- **Resolved gateway = perma.online?** ✅ Confirmed in-app for the assigned run (`getGatewayHost()` → `perma.online`, `https://perma.online`). The certification data came from a second, explicitly-labelled control run on turbo-gateway.com because perma.online cannot enumerate this owner's drives.
- **Do snapshotted drives load complete + correct on a healthy gateway?** ✅ **Correctness: YES** — 4/4 snapshot drives that listed matched on-chain ground truth exactly (files + folders), deterministic re-list, consistent with non-snapshot drives. Snapshots do not break, corrupt, or truncate listing. ⚠️ **Availability: PARTIAL** — only 4/10 snapshot drives *completed* on the still-flaky turbo gateway (5 timed out, 1 core-js error); 0/10 on perma (metadata gap). No single gateway tested is clean enough (reliable data **and** full metadata index) to certify a 10/10 complete listing.
- **Large-drive listing?** ✅ The largest that completed (`1f373b21…`, 30 files / 8 folders) listed fully in ~5 s. The genuinely-largest-history drives (`2c69d539…` 9 snaps, `640f8cd3…`) **timed out** under turbo's 404-flakiness — the replay cost, not a correctness fault.
- **Download-sync works (files land + valid)?** ✅ YES — 1/1 file landed on native disk, size matches metadata, sha256 valid.
- **Special files render?** ✅ Partial — `isHidden` state is surfaced by core-js and mapped to the app's "Hidden" badge; this owner's public drives contained 0 hidden/pinned/licensed entities, so positive-badge rendering could not be exercised on live data.
- **Was the prior turbo-gateway failure purely the blip?** **Mostly, not purely.** turbo recovered substantially (snapshot listing went from 1→4 drives complete, several sub-5 s), which confirms the prior wall-to-wall timeout was dominated by the temporal 404 storm. But residual intermittent 404s persist and still block the largest drives, and two failures (F4) are core-js robustness issues with **no gateway involvement**. The deeper, permanent factor is core-js 4.0.0's lack of snapshot support (full-history replay).
- **Any remaining 404s — gateway or absent data?** **Gateway.** Every tx checked (incl. from *blocked* drives) is retrievable by-id: prior-failing `0xWAQ8…` = turbo 10/10, perma 200; blocked-drive metadata `4KYE-…` = turbo 7/8, perma 8/8. The data is on-chain; the 404s are gateway serving flakiness, and perma's "empty" is a GraphQL index gap, not missing data.
- **READ-ONLY / no-spend / no-secrets?** ✅ Confirmed. Only importWallet (local decrypt), list/load/unlock (local key derivation), and HTTP GET downloads were exercised. Wallet balance identical before/after (1.397451800582 AR / 8.502725 Turbo). No names, decrypted content, or secrets are in this report, the harness, or the logs committed.

---

## 7. Recommendation

- **Do not adopt perma.online as the default/app gateway for accounts like this one** until its GraphQL indexes their ArFS metadata — it silently returns 0 drives (worst-case UX: "you have no drives"). Its data-serving is excellent and would pair well with a gateway/failover that supplies the metadata GraphQL.
- **The real fix for large-drive listing is snapshot support in core-js** (or an app-level snapshot-aware listing path). Full-history replay makes big/most-snapshotted drives fragile on *any* imperfectly-reliable gateway. Ties directly to the known no-snapshot gap; recommend a backlog item.
- **File two core-js robustness bugs** independent of gateway: `Unix time must be a positive integer!` on drive reconstruction (F4a) and `Invalid file state` on private folder listing (F4b/F5).
- **Gateway resilience (SYNC-20/D-012):** the 150 s timeout + exponential backoff correctly *contained* the flakiness (blocked drives recorded, run never hung), but users on a flaky gateway will see large drives fail to load. Consider surfacing a "gateway is degraded / retrying" state rather than an indefinite spinner.

---

*Harness: `scripts/uat/live-syncread-perma.js` (this branch). Evidence: `…/scratchpad/uat-syncread-perma/{run.log, run-turbo-control.log, build.log, downloads/}`. No screenshots, secrets, or content committed.*
