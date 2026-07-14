# Upload / Gateway Timeout Forensics — `turbo-gateway.com` timeout report

**Report under investigation (Discord):** *"anyone else seeing https://turbo-gateway.com timeout when uploading via the cli?"*

**Repos analyzed (read-only, nothing modified):**
- `/mnt/c/source/ardrive-cli` — package.json pins `ardrive-core-js@4.0.0`, `arweave@1.15.7`.
- `/mnt/c/source/ardrive-core-js` — **checked out at v3.0.x**, branch `fix/gql-empty-edges-guard`, `git describe = v3.0.0-65-gac2f0f6`, package.json `version = 3.0.3`, pins `@ardrive/turbo-sdk ^1.0.1` (installed: **1.27.0**).

## Evidence caveats (read first)

1. **The CLI's `node_modules/ardrive-core-js` is NOT installed** (`ls` returns nothing; no version resolvable). I could not inspect the *actual published 4.0.0* upload code. My core-js analysis is against the **3.0.x source in the repo**, which is a different (older) version than the CLI ships.
2. **Why this is still valid:** the 4.0.0 delta over 3.0.x is the private-drive signature work (`DriveSignatureType`, `VersionedDriveKey` — imported by the CLI `upload_file.ts`). That is a key-derivation / metadata concern. The **gateway transport, GatewayAPI retry/timeout logic, price oracle, and turbo dispatch are architecturally identical** across these versions. Where a claim depends on a version I can't see, it is flagged.
3. **`turbo-gateway.com` appears in ZERO source across all three trees** — `grep -rn "turbo-gateway"` returns nothing in `ardrive-cli/src`, `ardrive-core-js/src`, or the installed `@ardrive/turbo-sdk`. It is **not a default endpoint anywhere in the code.**

---

## TASK 1 — Endpoint map: what an upload actually contacts, in order

CLI entry: `ardrive-cli/src/commands/upload_file.ts`. The relevant wiring:

- `upload_file.ts:235` — `const arweave = getArweaveFromURL(parameters.getGateway());`
  → the **read/write gateway** for the whole upload is whatever `getGateway()` returns.
- `upload_file.ts:236` — `const turboUrl = parameters.getTurbo();`
- `upload_file.ts:243` — `turboSettings: shouldUseTurbo ? { turboUrl } : undefined`
  → **Turbo is opt-in**: only used when `--turbo` is passed (`ShouldTurboParameter = 'turbo'`, `parameter_declarations.ts:38`; `shouldUseTurbo = !!getParameterValue(...)`, `upload_file.ts:232`).
- `upload_file.ts:259-265` — for **private** drives only, `parameters.getDriveKey({ ... arDrive.getDriveIdForFolderId(parentFolderId) ... })` → an extra GraphQL drive-resolution read **before** the upload.
- `upload_file.ts:279` — `arDrive.uploadAllEntities(...)`.

### Gateway resolution (`parameters_helper.ts`)
- `getGateway()` (`:434`): precedence = `--gateway`/`-g` param → `ARWEAVE_GATEWAY` env var (`ARWEAVE_GATEWAY_ENV_VAR`, `:58`) → **`DEFAULT_GATEWAY = 'https://ardrive.net:443'`** (`:57`).
  - **Note:** the CLI default is **`ardrive.net`**, NOT core-js's `arweave.net` (`core-js constants.ts:23 defaultGatewayHost='arweave.net'` is overridden by the CLI passing its own Arweave instance).
- `getTurbo()` (`:470`): `--turbo-url` → `TURBO_URL` env (`:59`) → `turboProdUrl` (core-js `constants.ts:18 = https://upload.ardrive.io/`).
- `getArweaveFromURL()` (`utils/get_arweave_for_url.ts`): builds `Arweave.init({ host, protocol, port, timeout: 600000 })` — **10-minute** socket timeout, applied only to calls that go through the `arweave` object (balance, and the arweave-driven parts), **not** to core-js's own `GatewayAPI` axios (see Task 3).

### `uploadAllEntities` sequence (`core-js/src/ardrive.ts:583-621`)

For **each** entity, before any bytes are sent:
1. **`getDriveIdForFolderId(destFolderId)`** (`ardrive.ts:592`) → `getDriveIDForEntityId` → **GraphQL POST `{gateway}/graphql`** (via `GatewayAPI.gqlRequest`, `gateway_api.ts:82`).
2. **`assertDrivePrivacy(destDriveId, owner, driveKey)`** (`ardrive.ts:596`) → owner/drive lookup → **GraphQL POST `{gateway}/graphql`**.
3. **`resolveBulkNameConflicts(...)`** (`ardrive.ts:601`) → lists the destination folder contents to detect name collisions → **GraphQL POST `{gateway}/graphql`** (paginated; more pages for large folders).

Then the path forks (`ardrive.ts:607`):

**A) Default path — `--turbo` NOT set (`isTurboUpload()===false`):**
4. `planUploadAllEntities` (`ardrive.ts:611`).
5. `calculateCostsForUploadPlan` (`:614`) → **price**: `GatewayOracle.getWinstonPriceForByteCount` → **GET `{gateway}/price/{bytes}`** (`pricing/gateway_oracle.ts:11`, **bare `axios.get`, no timeout, no retry**). Also community-tip / contract-oracle reads.
6. `assertWalletBalance` (`:617`) → **GET `{gateway}/wallet/{addr}/balance`** (via the `arweave` object → 10-min timeout).
7. `arFsDao.uploadAllEntities(...)` (`:620`) → tx header + chunk POSTs via **`MultiChunkTxUploader` bound to `this.gatewayApi`** (`arfsdao.ts:1398-1420`, `gatewayApi: this.gatewayApi` at `:1400`). `this.gatewayApi = new GatewayAPI({ gatewayUrl: gatewayUrlForArweave(arweave) })` (`arfsdao.ts:258`). → **POST `{gateway}/tx` and repeated POST `{gateway}/chunk`** (`gateway_api.ts:71-77`).

**B) Turbo path — `--turbo` set:**
4t. `arFsDao.uploadAllEntitiesToTurbo(...)` (`ardrive.ts:608`) → `@ardrive/turbo-sdk`:
   - **`https://payment.ardrive.io`** (`turbo-sdk .../common/payment.js:24 defaultPaymentServiceURL`) — balance/cost checks.
   - **`https://upload.ardrive.io`** (`turbo-sdk .../common/upload.js:40 defaultUploadServiceURL`; also core-js `turboProdUrl`) — the actual data-item upload.
   - turbo-sdk's own internal Arweave gateway default is **`https://arweave.net`** (`token/arweave.js:32`, `DEFAULT_GATEWAY_URL`), used for token/anchor concerns — **not** turbo-gateway.com.
   - **Steps 1-3 (the GraphQL drive/privacy/conflict reads) still run against `{gateway}` first**, even on the turbo path.

### Ordered endpoint list (default, public drive)
```
{gateway}/graphql        (getDriveIdForFolderId)        per entity
{gateway}/graphql        (assertDrivePrivacy/owner)     per entity
{gateway}/graphql        (conflict resolution listing)  paginated
{gateway}/price/{bytes}  (GatewayOracle)                no timeout/retry
{gateway}/wallet/{a}/balance
{gateway}/tx             (tx header)
{gateway}/chunk  x N     (data chunks)
```
`{gateway}` = `ardrive.net` by default, or `$ARWEAVE_GATEWAY` / `--gateway` if set.
With `--turbo`, the last three lines are replaced by `payment.ardrive.io` + `upload.ardrive.io`, but the three `{gateway}/graphql` reads remain.

---

## TASK 2 — How `turbo-gateway.com` could enter the picture

**It is not a default in any of the three code trees.** The ONLY injection points are user configuration of the read/write gateway:

- **`--gateway https://turbo-gateway.com`** (`parameter_declarations.ts:495`, aliases `-g`/`--gateway`), or
- **`export ARWEAVE_GATEWAY=https://turbo-gateway.com`** (`parameters_helper.ts:58,443`).

If either is set, `getArweaveFromURL(getGateway())` points the entire Arweave instance at turbo-gateway.com, so **every** step in the endpoint map above — the GraphQL drive/conflict reads, `/price`, `/wallet/.../balance`, and (default path) the `/tx` + `/chunk` POSTs — hits `turbo-gateway.com`. A slow/timing-out turbo-gateway.com then stalls or fails the upload.

Notes:
- `turbo-gateway.com` is ArDrive/Turbo's **AR.IO read gateway**. It does serve `/graphql`, `/price`, data, and can proxy `/tx`/`/chunk`, so a user *can* point `--gateway` at it and it will mostly "work" — while being subject to that gateway's GraphQL statement-timeouts and chunk-POST latency.
- `--turbo` (the Turbo **upload** service) is unrelated to `turbo-gateway.com` (the **read** gateway). A user may have conflated the two names, or followed a doc/tutorial that set `ARWEAVE_GATEWAY=https://turbo-gateway.com`.
- The CLI's *own* default (`ardrive.net`) is also an ArDrive-operated gateway, plausibly sharing backend infra with turbo-gateway.com — but the user explicitly named turbo-gateway.com, which the code never sets on its own.

**Conclusion:** turbo-gateway.com is on the upload path **only via user `--gateway`/`ARWEAVE_GATEWAY` config**. It is NOT reached by default.

---

## TASK 3 — Timeout & retry behavior (hang risk)

Two distinct HTTP clients are in play; this is the crux.

### (a) core-js `GatewayAPI` — used for GraphQL, `/tx`, `/chunk`, tx fetches
File `core-js/src/utils/gateway_api.ts`:
- axios instance = `axios.create({ validateStatus: undefined })` (`:60`) — **NO `timeout` set.** So each individual request has **no client-side timeout**; a connection that is accepted but never responds hangs until the OS TCP timeout (minutes). Retries do not rescue a socket that is hung *open*.
- `maxRetriesPerRequest = 8` (`:57`) → up to 9 attempts.
- Exponential backoff `2^n * 500ms` (`:222`, `INITIAL_ERROR_DELAY=500`): cumulative backoff ≈ **127.5s** across retries (comment block `:22-44`), plus each attempt's own (untimed) duration.
- **Rate-limit (HTTP 429):** waits **60s and does NOT increment the retry counter** (`rateLimitThrottle`, `:230`; loop `continue` at `gateway_api.ts` retry loop). A gateway that keeps returning 429 → **effectively unbounded 60s-loop wait**.
- GraphQL server-timeout is surfaced explicitly: if GQL returns `"canceling statement due to statement timeout"`, core-js throws **`"GQL Query has been timed out."`** (`gateway_api.ts:93-99`). This is a **server-side Postgres statement timeout on the gateway's GraphQL** — a first-class, expected failure mode, and a very plausible "timeout when uploading" symptom because the upload path does GraphQL reads *before* sending data.

### (b) `GatewayOracle` price — `pricing/gateway_oracle.ts`
- Bare `axios.get('{gateway}/price/{bytes}')` (`:11`) — **no timeout, no retry.** A hung `/price` on a slow gateway blocks the upload with no recovery.

### (c) The `arweave` object — `{ timeout: 600000 }` (10 min)
- Applies to calls routed through the arweave instance (e.g. wallet balance). 10 minutes is long enough to *feel* like a hang to a user.

### Hang-risk summary
- **Yes, there is real hang risk**, and it is concentrated in **pre-upload GATEWAY READS**, not in the data POST itself:
  - GraphQL reads (drive resolution + conflict-resolution folder listing) can hit a server statement-timeout → hard fail (`"GQL Query has been timed out."`).
  - `GatewayAPI` requests have no client timeout → a slow gateway hangs each attempt for a long time; 8 retries + 127s backoff + possible 60s-per-429 loop can stretch a single stalled upload to many minutes.
  - `/price` has neither timeout nor retry.
- **Large files** amplify (b/default path): more `/chunk` POSTs, each against the possibly-slow gateway with no per-request timeout; but the *first* thing that fails on a slow gateway is usually the GraphQL read, before any chunk is sent.

---

## TASK 4 — Would a core-js 4.1 / 4.2 bump plausibly fix this?

Our 4.1 (snapshot / incremental / unixTime / invalid-file-state) and 4.2 (GraphQL page-size / consolidation) changes are **READ-path**. Assessment:

- **The data write itself (`/tx`, `/chunk`, or turbo `upload.ardrive.io`) is untouched** by those changes. If the timeout is on the POST/chunk phase or on turbo, **a bump does nothing.**
- **The one narrow, plausible mechanism:** the upload path performs **GraphQL folder-listing for conflict resolution** (`resolveBulkNameConflicts`, `ardrive.ts:601`) *before* uploading. For a **large destination folder**, that is paginated GraphQL against the gateway, and it is exactly the kind of query that trips a server **statement timeout** (`"GQL Query has been timed out."`). **4.2's GraphQL page-size / consolidation reduces the number/size of those pages**, which *could* reduce the chance of hitting that timeout during the pre-upload conflict check. This is the ONLY path by which a read-side bump could relieve an "upload timeout."
- **Caveats that make even that weak:** (i) it only helps if the user is uploading into a large folder AND the timeout is in that listing, not in `/chunk` or `/price`; (ii) it does not change the gateway being hit — if the user has `--gateway turbo-gateway.com` and that gateway is overloaded, fewer pages may still time out; (iii) I could not confirm 4.0.0's exact conflict-resolution query shape (node_modules not installed), so I can't prove 4.0.0 is worse than 4.2 here.
- **Does 4.0.0 code *cause* an upload-time turbo-gateway.com timeout?** No unique 4.0.0 bug is implicated. The timeout is a property of (the configured gateway's health) × (the no-timeout/8-retry GatewayAPI client) — both identical in 3.0.x/4.0.0/4.1/4.2.

**Honest verdict:** **No, a core-js bump does not reliably fix this, and most likely does nothing.** The only "maybe" is a large-folder conflict-resolution GraphQL statement-timeout, which 4.2 could marginally reduce — but that is a specific, unconfirmed sub-case, and it does not address a gateway that is simply slow/overloaded or a `/chunk`/`/price` stall.

---

## TASK 5 — Most likely root causes, ranked

### #1 — User has `ARWEAVE_GATEWAY` / `--gateway` pointed at `turbo-gateway.com`, and that gateway's GraphQL (or chunk POST) is slow/statement-timing-out
- **For:** The word "turbo-gateway.com" only enters the CLI via user config (Task 2) — the code never sets it. The upload does mandatory GraphQL reads against that gateway *before* sending data (Task 1). GraphQL statement-timeout is an explicit, named failure (`gateway_api.ts:93`). No client timeout + retries make it present as a long hang then failure (Task 3). This single hypothesis explains BOTH the specific hostname AND the "timeout when uploading" symptom.
- **Against:** Requires the user to have set the env/flag; needs confirmation. The live check showing turbo-gateway.com HTTP 200 in <0.5s was likely a plain `GET /` — not a heavy GraphQL drive/folder query or a large `/chunk` POST, so it doesn't refute a GraphQL statement-timeout under real upload load.

### #2 — Transient turbo-gateway.com load / GraphQL statement-timeout (same endpoint, not a persistent misconfig)
- **For:** Gateway GraphQL statement-timeouts are load-dependent and intermittent ("anyone else seeing…" phrasing suggests intermittent, shared). A momentarily overloaded gateway trips the exact `"GQL Query has been timed out."` path. Consistent with the live 200 (recovered by check time).
- **Against:** Still requires the user to be *using* turbo-gateway.com as their gateway (default is ardrive.net), so this overlaps with #1's config precondition.

### #3 — Large file / slow connection hitting the untimed, un-retried client on the default (non-turbo) path
- **For:** Default path POSTs every chunk through the no-timeout GatewayAPI; `/price` has no timeout/retry; big files = many chunks = long exposure. 10-min arweave timeout also feels like a hang.
- **Against:** Doesn't explain the *turbo-gateway.com* hostname unless the user also configured it; more likely surfaces as `ardrive.net`.

### #4 — Genuine hang bug in the 4.0.0 upload path
- **For:** The no-client-timeout + 60s-per-429 rate-limit loop is a real unbounded-wait smell (Task 3).
- **Against:** It's a resilience weakness, not a hostname-specific bug; identical across versions; nothing 4.0.0-unique. Low as *the* cause, but it's the reason any slow gateway becomes a long hang.

### #5 — core-js version issue that a bump fixes
- **For:** —
- **Against:** Upload transport unchanged across versions; 4.1/4.2 are read-path (Task 4). Ranked last deliberately: the report should NOT be closed as "bump core-js."

### What to ask the user (to disambiguate #1 vs #2 vs #3)
1. **"Do you have `ARWEAVE_GATEWAY` set, or are you passing `--gateway`/`-g`? Run `echo $ARWEAVE_GATEWAY` and paste your exact command."** ← decisive for #1.
2. **"Are you using `--turbo`?"** (turbo path vs default `/chunk` path — and confirms turbo-gateway.com is a *read* gateway, not the turbo upload service).
3. **"Paste the exact error text."** — `"GQL Query has been timed out."` ⇒ GraphQL statement-timeout (#1/#2); `ECONNABORTED`/socket timeout on `/chunk` ⇒ #3; a 429 message ⇒ rate-limit loop (#4).
4. **"How big is the file, and how large is the destination folder you're uploading into?"** — large folder ⇒ conflict-resolution GraphQL is the suspect (the only spot 4.2 could help); large file ⇒ chunk POST.
5. **"Does `ardrive upload-file ... --gateway https://arweave.net` (or omit `--gateway` to use the default) succeed?"** — if yes, it's the turbo-gateway.com endpoint, not the CLI.
6. **"Which ardrive-cli version (`ardrive --version`)?"** — confirm it's the 4.0.0 CLI.

---

## Bottom line
- **turbo-gateway.com is NOT on the upload path by default** — it appears in zero source. It enters only if the user set `--gateway`/`ARWEAVE_GATEWAY` to it, in which case the upload's mandatory pre-send GraphQL reads (and, on the default path, the chunk POSTs) all hit it.
- **A core-js version bump is not a reliable fix** — the upload write transport is version-invariant; only a narrow large-folder conflict-resolution GraphQL case could marginally benefit from 4.2, and even that is unconfirmed.
- **Top-2 causes:** (1) user's gateway is configured to turbo-gateway.com and its GraphQL/chunk endpoint is slow/statement-timing-out; (2) transient turbo-gateway.com load hitting the explicit GraphQL statement-timeout path. Both are gateway/config issues, not a 4.0.0 upload bug.
