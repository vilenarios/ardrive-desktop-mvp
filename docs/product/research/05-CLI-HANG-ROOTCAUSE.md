# ArDrive CLI Hang — Root-Cause Forensics

Env: WSL2 (Linux 5.15), Node v23.9.0, working copy at **/mnt/c/source/ardrive-cli**
(a Windows drive mounted via **9p/drvfs**). CLI built at `lib/index.js`.
`node_modules/ardrive-core-js` = **4.1.0**. All runs prefixed
`NODE_OPTIONS=--no-experimental-strip-types`, bounded with `timeout`.
Read-only. No wallet used, no uploads, no funds spent.

Test material: public drives owned by `iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA`.
All candidate drives are tiny "UAT-TESTONLY-DELETEME" drives (1 root folder, 0 files):
- `e9b05236-8f44-4dc6-84ae-8e0c54d77200` root folder `dbe36381-…` (drive tx `_n-sRSvT…`, folder tx `bcZtOitmax5…`)
- `4d440b1c-…` root folder `883bcff2-…`

---

## TL;DR — three separable causes, ranked by contribution to the observed symptom

| # | Cause | Layer | Bound? | Contribution in this repro |
|---|-------|-------|--------|-----------|
| **A** | **WSL2 `/mnt/c` 9p module-load I/O** — `require()` of the 36k-file dep tree over 9p | **environment** (not code) | ~70s every run | **DOMINANT** (~70 of ~70–90s). Gateway-independent. |
| **B** | **arweave.net returns HTTP 429 on every request** → core-js `GatewayAPI` pauses **60s per 429 without incrementing the retry counter** → unbounded loop | core-js `gateway_api.js` | **NO (effectively infinite)** | Makes `--gateway https://arweave.net` never return |
| **C** | **ar.io data-tx fetch is slow** — `GET /{txid}` 302-redirects to a per-tx sandbox subdomain that serves slowly/variably (12–80s+ each), and core-js sets **no axios timeout** | core-js `gateway_api.js` + ar.io infra | **NO** | Adds tens of seconds→minutes on top of A for drives with many entities |

NOT observed: the ClickHouse **TOO_MANY_ROWS** row-cap. Every GraphQL query core-js
sends (including the "unscoped" single-tag ones) returned **HTTP 200 + valid data in <0.5s**
on ardrive.net and turbo. The row-cap theory did **not** manifest for these queries/drives.

---

## Matrix: {command × drive-size × gateway} → outcome

Wall-clock includes the ~70s cause-A startup tax on **every** cell.

| command | drive | default (ardrive.net) | `--gateway arweave.net` | `--gateway turbo-gateway.com` |
|---|---|---|---|---|
| `drive-info` (light) | tiny #1 | OK ~71s (exit 0) | (429 loop) HANG | OK (fast queries) |
| `drive-info` (light) | tiny #2 | OK ~71s in isolation; the loop "hang" was the next invocation's own 70s startup exceeding the outer 120s cap | (429 loop) HANG | OK |
| `list-drive` (heavy) | tiny #1 | **exit 0 but 71–84s**: ~70s startup + 1.6s queries (+ up to ~13s uncached metadata fetch on 1st run) | **HANG** (429→60s loop) | OK-ish (queries fast; data-tx fetch 0.8–8.8s) |

Killed-at-90s-zero-output (the reported symptom) = a **larger** drive: ~70s startup +
many serial slow sandbox metadata fetches (cause C) pushes total past the kill timeout.
`list-drive` prints only once at the very end (`console.log(JSON.stringify(children))`),
so a kill before completion shows **zero output**.

---

## Wire evidence

### 1. The ~70s is BEFORE any network call (cause A)
Real CLI `list-drive` with an axios request/response interceptor injected via
`--require` (timestamps relative to process start):

```
[REQ #1 +69627ms] POST https://ardrive.net/graphql      <-- first HTTP at +69.6s
[RES #1 +70313ms] 200 686ms
[REQ #2..#7 ...]  200 ~150ms each
[PROCESS EXIT +71236ms] code=0                            <-- whole op after load = 1.6s
```

Corroborating timings (all wall-clock; baseline node is instant):
```
node -e "1"                                  0.03s
node lib/index.js --help                     1:08.95   (no command, no network)
node -e "require('ardrive-core-js')"         1:12.92   (require tree only)
list-drive tiny#1 (1st run)                  1:24.44   (exit 0, 1 entity, 737B out)
list-drive tiny#1 (cache-warm re-run)        1:13.55   (exit 0)
```
`cwd` filesystem: `C:\ on /mnt/c type 9p (... msize=65536 ...)`; **36,108** `.js`
files in `node_modules`. `src/index.ts` eagerly `import('./commands')` (pulls the whole
ardrive-core-js/arweave/turbo tree) even for `--help`. → every invocation pays ~70s of
synchronous `require()` stat/open/read syscalls over 9p. **This is a
test-environment artifact of running from a Windows-mounted path under WSL2**, not a
gateway or core-js defect. On a native FS this drops to ~1–3s.

### 2. GraphQL queries are fast on ardrive.net/turbo, 429 on arweave.net
Exact queries core-js `buildQuery()` emits, curled directly (`-m` bounded):

| query (core-js source) | ardrive.net | arweave.net | turbo |
|---|---|---|---|
| `getOwnerForDriveId` — tags[Drive-Id,Entity-Type=drive], **no owner**, first 1 | 200 / 0.61s / valid | **429** / 0.14s / nginx | 200 / 0.38s / valid |
| `getDriveIDForEntityId` — **single tag [Folder-Id], no owner** (the "unscoped" one) | 200 / 0.47s / valid | **429** | 200 / 0.42s / valid |
| `getAllFoldersOfPublicDrive` — [Drive-Id,Entity-Type=folder] **+owner**, first 100 | 200 / 0.43s | **429** | 200 / 0.36s |
| `getPublicFilesWithParentFolderIds` — [Drive-Id,Parent-Folder-Id,Entity-Type=file] **+owner** | 200 / 0.43s | **429** | 200 / 0.40s |
| snapshot query — [Drive-Id,Entity-Type=snapshot] **+owner** | 200 / 0.38s | **429** | 200 / 0.40s |

So the default-gateway GraphQL path is healthy and fast. arweave.net (cdn77/nginx)
**rate-limits every anonymous request with HTTP 429**.

### 3. The ar.io data-tx fetch (`getTxData` → `GET /{txid}`) is slow (cause C)
```
GET https://ardrive.net/{txid}          -> HTTP 302 -> https://<53-char-hash>.ardrive.net/{txid}
follow redirect, ardrive.net drive tx    -> 200  12.63s   (86 B)
follow redirect, ardrive.net folder tx   -> 200  24.26s   (32 B)
follow redirect, turbo drive tx          -> 200   0.79s
follow redirect, turbo folder tx         -> 200   8.77s
follow redirect, arweave.net (either tx) -> 429   0.24s   (rate-limited even on sandbox)
```
`getTxData` in `gateway_api.js` does `axios.get(url, {responseType:'arraybuffer'})`
with **no timeout**, following the 302 to the sandbox subdomain. Each metadata tx costs
seconds-to-tens-of-seconds and is **highly variable** (cold-cache re-seed on the ar.io
node). For a drive with N entities these are serial, so total ≈ N × (12–80s). Results are
cached on disk (`ArFSMetadataCache`), which is why a warm re-run drops the data-fetch time
— but **not** the ~70s startup.

### 4. arweave.net: does it hang or eventually return? (cause B)
See core-js `gateway_api.js` `retryRequestUntilMaxRetries`: on `lastRespStatus === 429`
it calls `rateLimitThrottle()` (60s sleep) and `continue`s **without incrementing
retryNumber**. A gateway that persistently 429s (arweave.net does, for every endpoint
incl. graphql AND the sandbox) → the loop never exhausts retries → **unbounded hang**
(60s pauses forever). There is no axios `timeout` anywhere in `gateway_api.js` (the only
"timeout" reference is a string-match for the ClickHouse `statement timeout` GQL error).
Live confirmation (instrumented list flow vs arweave.net, timestamps from process start):
```
[REQ #1 +73364ms] POST https://arweave.net/graphql
[RES #1 +73681ms] 429 317ms
Gateway has returned a 429 status ... Pausing for 60.0 seconds before trying next request...
[REQ #2 +128021ms] POST https://arweave.net/graphql   <-- ~55s later, same query re-sent
[RES #2 +128164ms] 429
Gateway has returned a 429 status ... Pausing for 60.0 seconds ...   <-- loops; killed at 210s
```
→ **truly unbounded**: it never advances past the first query; retry count never increments.
(REQ #1 at +73s again shows the cause-A 9p startup tax preceding the gateway loop.)

---

## Answers to the specific questions

**Is it size, gateway, or command driven?** In this repro the dominant ~70s is **none of
those — it's the environment (9p module load)**, identical for `--help`/`drive-info`/
`list-drive` and for every gateway. On top of that: **gateway-driven** genuine bugs —
arweave.net 429-loops (cause B), ardrive.net/turbo slow data-tx fetch (cause C). Command
matters only via request VOLUME: `list-drive` fetches per-entity metadata (cause C), so it
grows with drive size; `drive-info` fetches one. The single-tag "unscoped" queries are
**not** the problem — they resolve in <0.5s.

**Is the failing query owner-scoped?** N/A — no query "failed" on ardrive.net/turbo; all
returned 200 fast, scoped or not. On arweave.net *all* requests 429 regardless of scope.

**Default-gateway choice vs core-js query-scoping vs GatewayAPI hang?** It's the
**GatewayAPI design (no timeout + unbounded 429 throttle)** combined with **ar.io infra
behavior (slow sandbox data serving)** — plus, in this box, the **9p startup tax**. It is
**NOT** a query-scoping problem (queries are fine) and **NOT** that ardrive.net can't serve
the queries (it serves them fast). The v4.0.0 default flip to ardrive.net is a secondary
factor: ardrive.net GraphQL is fine but its bulk data-tx serving is slow, and arweave.net
now 429-rate-limits CLI traffic — so *neither* current option is a clean default.

**Does `--turbo` change the read queries?** No. `--turbo` only selects the upload/payment
path. `drive-info`/`list-drive` don't accept it and the anonymous read path runs through
the same `GatewayAPI` regardless. Irrelevant to these read hangs.

---

## Would the fixes help? (PR #278 = bounded axios timeout + TOO_MANY_ROWS fail-fast)

- **Timeout half — YES, fixes the SYMPTOM (hang → clean fast error):**
  - Bounds arweave.net's **infinite** 429 loop (cause B) into a fast, clean failure.
  - Bounds the slow sandbox data-tx fetch (cause C) instead of blocking tens of seconds.
  - It does **not** speed up a *successful* large-drive listing (that needs the data served
    faster / fewer round-trips), and it does **nothing** for cause A (9p startup — outside
    core-js).
  - NOTE: the 429 branch also needs fixing directly — a plain per-request axios timeout
    still lets the 60s-pause-without-retry-increment loop re-arm; #278 should also
    increment/cap retries on 429 (or bound total elapsed) so 429s fail fast.
- **TOO_MANY_ROWS fail-fast half — not exercised here** (never triggered); harmless
  defense-in-depth. Would convert a future row-capped `{errors, HTTP 200}` into a clean
  fast error instead of the current generic `No data was returned from the GQL request.`

## Ranked fixes

1. **(Env, biggest here) Don't run the CLI from a `/mnt/c` 9p path under WSL2.** Install/run
   from a native Linux path (`~/…`) or run natively on Windows → removes ~70s instantly.
   (Secondary code mitigation: lazy-load command modules / trim the dependency tree so a
   command imports only what it needs.) *This is env-specific; a normally-installed CLI does
   not hit it.*
2. **(core-js) Add a bounded axios `timeout` on the `GatewayAPI` axios instance AND fix the
   429 handler to increment/cap retries (or bound total elapsed).** Turns cause B (infinite)
   and cause C (unbounded slow) into fast, clean, retryable errors. == PR #278's timeout,
   plus a 429-loop cap. Highest-value *code* fix.
3. **(CLI product) Revisit the v4.0.0 default gateway and/or add gateway fail-over.**
   arweave.net now 429s anonymous CLI traffic; ar.io gateways serve GraphQL fast but bulk
   data-tx slowly. Pick a default that serves both reliably, or fail over on timeout/429.
4. **(core-js, low) TOO_MANY_ROWS fail-fast (PR #278 other half).** Not needed for these
   drives; keep as defense-in-depth + clearer error text.
```
```
