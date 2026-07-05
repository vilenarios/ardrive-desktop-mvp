# Snapshot consumption — desktop wiring + performance (CORE-3d)

**Date:** 2026-07-05 · read-only, public drives, turbo-gateway.com, no wallet/spend.
**Builds under test (ardrive-core-js):**
- `full-replay` = `feat/snapshot-foundation @ f6da1d2` (snapshots unwired → pure full-history replay; == what desktop ships today behaviorally)
- `snapshot` = `feat/snapshot-integration @ f647d59` (snapshot-accelerated `listPublic/PrivateFolder`)
- `snapshot+core5` = above + cherry-picked CORE-5 fix (`bd1575b`, tolerate invalid entity unixTime) → branch `feat/snapshot-plus-core5`

Measured via ArDrive-CLI `list-drive` (the desktop uses the SAME core-js `listPublicFolder`/`listPrivateFolder`; the CLI is the CORE-JS-PLAN §5 sanctioned verification vehicle). `gqlReqs` from `req-count.js`.

## Biggest iKry drives — the ones that ALL timed out at 150s under full-replay in the 2026-07-05 re-cert

| Drive | Name | Entities | full-replay | snapshot | snapshot+core5 |
|---|---|---:|---|---|---|
| `2c69d539…` | ArConnect Archives (9 snapshots, most-snapshotted) | 753 | **TIMEOUT @146s** | CORE-5 err→fallback→timeout-class | **2.0s / 6 GQL** |
| `640f8cd3…` | YO BRO | 16 | timed out (re-cert) | **2.9s / 6 GQL** | — |
| `47b02f32…` | Demo Drive | 51 | timed out (re-cert) | **3.6s / 6 GQL** | — |
| `83f0adae…` | My Public Drive | 99 | timed out (re-cert) | **4.6s / 6 GQL** | — |
| `21e28851…` | MyMobilePublic | 6 | timed out (re-cert) | **3.1s / 6 GQL** | — |
| `a173761d…` | Public 1 (CORE-5 unixtime drive) | 23 | err (CORE-5) | CORE-5 err→fallback→err | **1.9s / 6 GQL** |
| `3b6b8980…` | Demo Drive 2 | 7 | **24.4s / 7 GQL** | **3.0s / 6 GQL** | — |

**Result: all 7 biggest drives now fully list in 2–5 s** (5 on snapshot alone; the remaining 2 need the CORE-5 fix folded in — both failed on the SAME independent `Unix time must be a positive integer!` data bug, NOT a snapshot defect; the snapshot path correctly logged `[snapshot] falling back to full-history replay`). Headline: `2c69d539` (753 entities, most-snapshotted) went from **never completes (146s+ timeout)** → **2.0 s / 6 requests**.

## Head-to-head (first-party, this session)
- `3b6b8980`: full-replay **24.4s / 7 GQL** → snapshot **3.0s / 6 GQL** (~8×). (re-cert measured 68.7s on a slower gateway day.)
- `2c69d539`: full-replay **TIMEOUT @146s** → snapshot+core5 **2.0s / 6 GQL** (753 entities).

## Correctness / no-corruption (interop vs full-replay golden, snapshot+core5 build)
- `a84b951b`: **INTEROP PASS — byte-identical** to full-replay golden, 6 vs 7 GQL. Snapshots do not corrupt listings.
- `1f373b21`: **superset** — snapshot listing == golden **+1** entity (an `image/jpeg` file the full-replay/gateway index had dropped). Confirms D-027 "superset-with-verified-gateway-drops" and the finding *snapshots are a data-integrity fix, not just perf*.

## Desktop consumption (branch `feat/snapshot-consume-desktop`)
- Wiring = **pin bump only**. The desktop enumerates all content via core-js `listPublicFolder`/`listPrivateFolder` (`DownloadManager.recursivelyListDriveContents` → `DownloadManager.ts:885/890`; UI browse in `main.ts`); no active hand-rolled GraphQL walker (`sync-manager.ts:726` is dead code). Snapshot acceleration is transparent.
- Gateway flows through `gateway.ts` `getGatewayConfig()` (default `turbo-gateway.com`, which indexes snapshots) into `arDriveFactory` (`wallet-manager-secure.ts`).
- Gates with the snapshot pin: **typecheck 0 · lint 0 errors · build OK · vitest 556 passed / 1 skipped**. Zero regressions.
- Pin used for verification: local tarball of `feat/snapshot-integration` (`corejs-plan/ardrive-core-js-4.0.0.tgz`).

## Merge condition (blocked on upstream)
Shipping requires the core-js side to fold **snapshot-integration (+CORE-5)** into a **pushed** release and the desktop to pin to that commit (one line, like the CORE-4 pin `dab49ed`). Today `release/4.0.1-prep` is hide/unhide + zero-edge only — it does NOT include snapshots, and `f647d59` is not pushed. So CORE-3d is **verified-ready, blocked on the core-js release (item A)**.
