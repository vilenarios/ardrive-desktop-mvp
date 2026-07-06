# UAT — Manifest site-deploy flow (folder → browsable Arweave site), 2026-07-05 [SYNC-18]

**Runner:** TESTER agent (Claude Opus 4.8/Sonnet 5), supervised pass.
**Base:** branch `uat/manifest-deploy` off `main @ 873ec8c` (core-js **4.1.0** pinned, D-026).
**Scope:** verify the `drive:create-manifest` flow — turning a folder into a browsable Arweave path-manifest site — end to end: code path, a new deterministic test, and a live resolution check via the app's configured gateway.

> **Money/safety.** No funds spent. All GraphQL/resolution checks are read-only. The one write (Step 3) is a path-manifest transaction — **918 bytes**, computed and confirmed **free-tier-eligible before upload** (Turbo's 105 KiB / 107,520-byte free-tier threshold, `src/utils/turbo-utils.ts`), and the resulting `fees: {}` in the upload result **confirms zero cost**. Deployed from an existing SMALL PUBLIC drive (`a84b951b-7d2f-4fa1-a89f-4b4ed673b404`, "You're The Man Now Dog") whose files were already on-chain — no new file data was uploaded, only the manifest transaction itself. No wallet password was read, printed, or committed (the raw JWK keyfile needs none — confirmed by precedent scratch scripts in this session).

---

## HEADLINE

**COMPLETED-LIVE.** The `drive:create-manifest` → `uploadPublicManifest` → browsable-site flow is verified end to end: the handler is exercised by 14 new passing tests (11 main-process + 3 renderer), and a fresh, free, real manifest transaction (`UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ`) was deployed and **confirmed to resolve as a browsable site via `turbo-gateway.com`** — both the index route (byte-exact match, 49,924 B) and a known sub-path (byte-exact match, `TEST_FILE.txt`) returned HTTP 200 with exactly the right content, ~6 minutes after the free upload. See the [LIVE verdict](#3-live-verdict) for the exact HTTP results.

**Adjacent finding (not core scope, but concretely proven with this session's own manifest):** the SYNC-18 *download*-side fix (`DownloadManager.downloadManifestFile`, fetching a manifest FILE entity's own bytes to save locally) reuses the plain `GET /<txid>` shape — but on an ar.io/turbo-gateway.com gateway, hitting a manifest-content-type tx's own ID **always resolves through its path-manifest index** (that's the whole point of a path manifest), with no way to get the manifest's own raw JSON via that route. Verified directly: `GET https://turbo-gateway.com/UXu-lD2j-...` (redirect-following, exactly what axios/StreamingDownloader do) returned the **resolved index target** (`image/webp`, 49,924 B — `ant_pic`), not the manifest's own ~918-byte JSON. See [§3d](#3d-adjacent-finding-sync-18s-download-side-fix-likely-fetches-the-wrong-bytes).

---

## 1. The flow as coded

```
CreateManifestModal.tsx (renderer)
  └─ window.electronAPI.drive.createManifest({driveId, folderId, manifestName})
       │  (preload.ts:87-92 — thin ipcRenderer.invoke wrapper)
       ▼
main.ts:1424  ipcMain.handle('drive:create-manifest', envelopeHandler(async (_, params) => {
main.ts:1432-1433   InputValidator.validateDriveId / validateEntityId   — throws before ArDrive is touched
main.ts:1436-1439   const arDrive = walletManager.getArDrive()          — 'ArDrive not initialized' if no wallet
main.ts:1445-1467   drive = listDrives().find(...); if private → driveKeyManager.getDriveKey()
                       unlocked  → arDrive.listPrivateFolder({folderId, driveKey, maxDepth: MAX_SAFE_INTEGER, includeRoot:false})
                       locked    → throw 'Private drive is locked'
                       public    → arDrive.listPublicFolder({folderId, maxDepth: MAX_SAFE_INTEGER, includeRoot:false})
main.ts:1471-1480   files = entities.filter(entityType==='file'); 0 files → error; >20,000 → error
main.ts:1483        manifestName = params.manifestName || 'DriveManifest.json'
main.ts:1488-1492   result = await arDrive.uploadPublicManifest({
                       folderId: new EntityID(validatedFolderId),
                       destManifestName: manifestName,
                       conflictResolution: 'upsert'          // re-running updates the same-named manifest
                     })
main.ts:1494-1512   addUpload(...) — records the manifest to upload history (uploadMethod:'turbo', dataTxId, etc.)
main.ts:1515-1519   webContents.send('drive:metadata-updated' / 'drive:update')  — tells the UI to refresh
main.ts:1521-1528   return { manifestUrl: result.links[0], fileUrls: result.links.slice(1),
                              fees: result.fees, txId: result.created[0].dataTxId, fileCount, manifestName }
}));
       │  (envelopeHandler wraps this in {success, data} — D-005)
       ▼
CreateManifestModal.tsx:164-177
  result = await window.electronAPI.drive.createManifest(...)
  if (!result.success) throw ...
  onSuccess(result.data.manifestUrl)     // ← passed through VERBATIM, no rewriting
       ▼
OverviewTab.tsx:572-584  <CreateManifestModal onSuccess={(manifestUrl) => console.log(...)} />
```

### Where the gateway comes from

The link the user gets is **not** built by this app's own renderer link-generator (`src/utils/link-generator.ts` — that module only builds links for ordinary uploaded *files*, e.g. `FileLinkActions.tsx`; manifests never touch it). It's built entirely inside `ardrive-core-js`:

- `ArDrive.uploadPublicManifest` (`node_modules/ardrive-core-js/lib/ardrive.js:709-736`) calls `this.arFsDao.getManifestLinks(manifestTxId, arweaveManifest)`.
- `ArFSDAO.getManifestLinks` (`arfsdao.js:1898-1900`) → `manifest.getLinksOutput(dataTxId, gatewayUrlForArweave(this.arweave))`.
- `getLinksOutput` (`arfs_file_wrapper.js:145-157`) builds `links[0] = "<gateway.href><dataTxId>"` (the site root) and `links[1..] = "<gateway.href><dataTxId>/<encoded-path>"` for every file.
- `gatewayUrlForArweave(this.arweave)` resolves from the `Arweave` instance **the app itself constructed**, at wallet-load time: `wallet-manager-secure.ts:424-434` (`importWallet`) and `:525-535` (`loadWallet`) both do `Arweave.init(getGatewayConfig({timeout, logging}))`.
- `getGatewayConfig`/`getGatewayHost` (`src/main/gateway.ts:51-63`) resolve **env var `ARDRIVE_GATEWAY_HOST` > persisted config `gatewayHost` > `DEFAULT_GATEWAY_HOST = 'turbo-gateway.com'`** — pinned by the pre-existing `tests/unit/main/gateway.test.ts`.

So: **the manifest link uses whatever gateway the app is configured with (turbo-gateway.com by default), never arweave.net**, by construction — main.ts's handler is a pure pass-through of core-js's result, and core-js itself was handed the app's configured `Arweave` instance. There is no `/raw/`-style rewriting on the create/deploy side (that was specifically a *download*-side issue, SYNC-18, already fixed on `main`).

### A real (adjacent) UX gap found while reading this path

`git log --follow -p -- src/renderer/components/CreateManifestModal.tsx` shows a `navigator.clipboard.writeText(result.manifestUrl)` call **existed** and was removed at some point (during the two-step confirmation-dialog / envelope refactor). `OverviewTab.tsx:580`'s `onSuccess` handler still has the comment *"The URL is already copied to clipboard by CreateManifestModal"* — **that's stale**; today the modal has **no visible UI for the resulting link at all** (only `console.log`). A user who creates a manifest today gets a success toast with a file count and then has no way to retrieve their manifest URL from the app itself. Confirmed by `tests/unit/components/create-manifest-modal.test.tsx` (the `onSuccess` callback receives the correct URL, but nothing in the component surfaces it to the user). Flagged for the backlog; not fixed here (out of scope for a verification pass).

---

## 2. Deterministic test (no spend, no network)

Two new test files (14 tests, all passing), following the codebase's existing `main-approve-handlers.test.ts` harness pattern (capture `ipcMain.handle` registrations from a fully-mocked Electron boot, invoke directly):

**`tests/unit/main/create-manifest-handler.test.ts`** (11 tests) — mocks `wallet-manager-secure` (`getArDrive`/`listDrives`), `drive-key-manager`, and `ardrive-core-js` (`EntityID` only — the real package isn't loaded, avoiding its ecc self-check). Proves:
- Malformed `driveId`/`folderId` are rejected by `InputValidator` **before** `getArDrive()`/`uploadPublicManifest` are ever called.
- `ArDrive not initialized` and `Private drive is locked` fail loudly (envelope `{success:false}`), never silently producing an empty manifest.
- Public drives route through `listPublicFolder` (uncapped depth, root excluded); private (unlocked) drives route through `listPrivateFolder` with the derived drive key.
- `uploadPublicManifest` is called with `folderId` wrapped in `EntityID`, the user's `manifestName` (defaulting to `DriveManifest.json`), and `conflictResolution: 'upsert'`.
- **The load-bearing gateway assertion:** the returned envelope's `manifestUrl`/`fileUrls` are `result.links` **verbatim** — a fixture link built from the real `DEFAULT_GATEWAY_HOST` export of `src/main/gateway.ts` (not a hand-typed string) round-trips unchanged, and the test explicitly asserts it does **not** contain `arweave.net`.
- The manifest is recorded to upload history (`addUpload` called with `uploadMethod:'turbo'`, `dataTxId`, `transactionId`).

**`tests/unit/components/create-manifest-modal.test.tsx`** (3 tests) — mocks `window.electronAPI`, drives the modal through folder-select → Next → Confirm & Create. Proves:
- `onSuccess` receives the IPC envelope's `manifestUrl` **unchanged** (still `https://turbo-gateway.com/...`, asserted to not contain `arweave.net`) — i.e. the renderer does not rewrite or re-derive the link.
- A `{success:false}` envelope surfaces the error via `toast.error` and does **not** call `onSuccess`/`onClose`.
- The user-edited manifest name is threaded through to the IPC call.

**Result:** both files pass in full. Full-suite impact: **697 pass / 1 skip** (up from the stated baseline of **683 pass / 1 skip**; +14, matching the two new files exactly), 81 test files, 0 regressions.

---

## 3. LIVE verdict

**COMPLETED-LIVE.**

### 3a. Existing-manifest search (read-only first)

Queried `turbo-gateway.com/graphql` for this owner's (`iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA`) transactions tagged `Content-Type: application/x.arweave-manifest+json` **and** `App-Name: ArDrive-Core` (the tag ardrive-core-js stamps by default — matches what this app itself would produce). Found 4 pre-existing manifests, all from **2025-07** (core-js 3.0.0 era):
`MSWQ8J-8J2FpAeYu_kCiRG-78qw6cKu2QOppPHeRolM`, `C6whxXSSAcrkgefad_QYpEjCRzOdv5qh69SVkPI7ius`, `5dYQ_qxSyKfiin-RuqMib6lI6SgwYkK5aUrSQuSP-E8`, `1xoPEqXZ5udJBndk0C4CAUp5KsBnUgEseh5ek30EvJ0`.

Attempted read-only resolution of all 4 via `GET https://turbo-gateway.com/<txid>/`: 3 of 4 timed out/504'd or 404'd (consistent with the codebase's own documented turbo-gateway.com flakiness on cold/rarely-accessed data, `src/main/gateway.ts`'s `DEFAULT_GATEWAY_FALLBACKS` comment). The 4th (`MSWQ8J...`) **did resolve** on retry: a 302→301→200 chain landed on a **different underlying data item** (`x-ar-io-data-id: Hxu6uwBJw03nmY5PGTTcMvRAJk-MtnH3uDYrQy-pBys`) whose own on-chain tags (`x-arweave-tag-content-type: application/vnd.ipld.car`, `x-arweave-tag-app-name: ArDrive-CLI`) **exactly matched** the served `Content-Type` and bytes. That is: the manifest's path-resolution mechanism worked correctly (it served the *target* the manifest pointed to, not the manifest's own JSON) — this old manifest's chosen index just happens to be a `.car` test fixture rather than a webpage, so it doesn't itself demonstrate an HTML "site." → **read-only check alone was inconclusive for a full index+subpath site confirmation**, so proceeded to Step 3 for a controlled deploy.

### 3b. Fresh free-tier deploy

Deployed a manifest for the existing small **public** drive `a84b951b-7d2f-4fa1-a89f-4b4ed673b404` ("You're The Man Now Dog"), root folder `b2858293-c463-4675-9983-250a8b06d83a` (12 pre-existing files, already on-chain — no new file data uploaded). Used a harness script (`scratchpad/uat-manifest-deploy/deploy-manifest.js`, not committed — see below) calling the **exact same core-js entry point** the app's handler calls (`arDrive.uploadPublicManifest({folderId, destManifestName, conflictResolution:'upsert'})`), with the same gateway (`turbo-gateway.com`) and Turbo (`upload.ardrive.io`) config as `wallet-manager-secure.ts`.

**Safety gate honored:** the manifest wrapper was built and measured **before** calling the real upload — `918 bytes`, verified `≤ 107,520` (Turbo free-tier threshold) — and only then was the live call made. Post-upload, `result.fees` was `{}` (empty) — **zero cost confirmed**.

```
manifestTxId: UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ
indexPath:    ant_pic          (no index.html in the folder → alphabetically-first path, per core-js's ArFSManifestToUpload)
paths (11):   ant_pic, ar.io-logo.png, bro.png, logo.svg, sync_test/Geordi_Drake_Meme.png,
              TEST_FILE.txt, youre-the-man-now-dog-favicon.ico, youre-the-man-now-dog-play.jpg,
              youre-the-man-now-dog.html, youre-the-man-now-dog.jpg, youre-the-man-now-dog.wav
manifestUrl:  https://turbo-gateway.com/UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ
fees:         {}   ← ZERO COST
```

GraphQL confirms the tx (`App-Name: ArDrive-Core`, `App-Version: 4.1.0` — matching this worktree's pinned core-js) was indexed within seconds of upload (`block: null` = mempool, not yet mined — expected for a just-submitted Turbo-bundled item).

### 3c. Resolution confirmation

Polled `GET https://turbo-gateway.com/<manifestTxId>/` and `.../TEST_FILE.txt` every ~45-70s (Turbo-bundled data items need time before the AR.IO gateway's data-serving layer can unbundle/resolve them, even though GraphQL indexes the tx within seconds — `block: null` = mempool). Both routes 404'd for the first ~5 minutes, then resolved cleanly:

| Attempt | Time since upload | Index route (`.../`) | Sub-path (`.../TEST_FILE.txt`) |
|---|---|---|---|
| 1–5 | 0–4.5 min | 404 | 404 "Not found" |
| 6 | ~5.5 min | 404 | **200 — `THIS IS TEST 1`** (byte-exact) |
| 7 | ~6 min | **200 — `image/webp`, 49,924 B** | 200 — `THIS IS TEST 1` |

**Index route**, `https://turbo-gateway.com/UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ/`:
```
HTTP/2 200
content-type: image/webp
content-length: 49924
x-ar-io-data-id: Lt3pyCXSdM9R2_lxhnqj3rzzhuLszT8s-p8vM1fpeJc
```
`x-ar-io-data-id` and the byte count are an **exact match** to `ant_pic`'s own on-chain `dataTxId`/size from the folder listing (`Lt3pyCXSdM9R2_lxhnqj3rzzhuLszT8s-p8vM1fpeJc`, 49,924 B, `image/webp`) — i.e. the manifest's chosen index (`ant_pic`, no `index.html` present in the folder → alphabetically-first path per core-js) resolved to precisely the right file.

**Sub-path**, `https://turbo-gateway.com/UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ/TEST_FILE.txt`:
```
HTTP/2 200
body: THIS IS TEST 1
```
Byte-exact match to the ground truth fetched independently from the file's own `dataTxId` (`0xWAQ8Yjjq6j9whoaVqtgsmB1PEEf7kjPH9rkTz9znY`) — `THIS IS TEST 1`, 14 bytes, no trailing newline.

**A second sub-path**, `.../youre-the-man-now-dog.html` (a real HTML page in the same folder, more representative of a "site" than the image index), was also checked for extra confidence:
```
HTTP/2 200
content-type: text/html; charset=utf-8
content-length: 4299
sha256: 07d0efba7a080c42e1e3961d3c3c8b6370da9fe7e6d2f70f68614cfbc4b33bb4
```
Matches the independently-fetched ground truth exactly (4,299 B, same SHA-256).

**Verdict: YES — a deployed manifest resolves as a browsable site via the app's configured gateway.** Index route and two independent sub-paths all returned HTTP 200 with byte-exact content, ~6 minutes after a free upload.

### 3d. Adjacent finding: SYNC-18's download-side fix likely fetches the wrong bytes

While chasing why the *index* route consistently 404'd/resolved differently than expected on the first few tries, a re-read of `DownloadManager.downloadManifestFile` (`src/main/sync/DownloadManager.ts:1161-1163`) raised a concern: it builds the fetch URL as `${gatewayUrl}/${fileData.dataTxId}` — i.e. **the manifest's own transaction ID**, the exact same shape SYNC-18 uses for ordinary files — and streams it through `StreamingDownloader` (axios, default `maxRedirects`, i.e. it **follows redirects**). This is meant to save the manifest's own JSON locally as e.g. `DriveManifest.json` (a manifest, once uploaded, is a real ArFS File entity like any other, so it can be synced/downloaded to a local folder like any file).

Verified directly against this session's own manifest tx: `GET https://turbo-gateway.com/UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ` (bare ID, redirects followed — precisely what `StreamingDownloader` does) returns:
```
HTTP/2 302 → 301 (adds trailing slash) → 200
content-type: image/webp
content-length: 49924
x-ar-io-data-id: Lt3pyCXSdM9R2_lxhnqj3rzzhuLszT8s-p8vM1fpeJc
```
That's **`ant_pic` again** (the manifest's resolved index target) — **not** the manifest's own ~918-byte `application/x.arweave-manifest+json` body. The key mechanical difference from an ordinary file: fetching an ordinary file's `dataTxId` is a **single** 302 (gateway → sandbox subdomain) landing directly on that file's own bytes; fetching a **manifest**-content-type tx's ID gets a **second** 301 (adds a trailing slash) that specifically triggers path-manifest index resolution — universal AR.IO/ar-io-gateway behavior (per the path-manifest spec: visiting the manifest's own ID *is* "visit the site"), not a turbo-gateway.com quirk. There is no way to get a manifest tx's own raw bytes via the plain `/<txid>` route on such gateways — only via a raw/no-resolution endpoint (the same `/raw/<txid>` that SYNC-18 found 504s on turbo-gateway.com and moved away from).

**Net effect (not verified end-to-end in the app itself — this is a code-path + live-gateway-behavior inference, not a full repro through `DownloadManager`):** if a user syncs a drive containing a manifest file, the locally-downloaded copy (e.g. `DriveManifest.json`) would likely contain the bytes of whatever the manifest's index points to (an image, in this case) mislabeled with a `.json` name, rather than the manifest's own JSON. This is **outside this task's scope** (SYNC-18/download path, not the create/deploy path this UAT was chartered to verify) and wasn't fixed here — flagged as a candidate follow-up backlog item, since the existing SYNC-18 test only pins the *URL shape*, not the *bytes actually returned by a live gateway*.

---

## 4. Build gates

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** — clean, no errors |
| `npm run lint` | **PASS** — 0 errors, 350 warnings (all pre-existing `no-explicit-any`/unused-var/hook-deps warnings in files this change didn't touch; the two new test files introduce **zero** new lint findings) |
| `npm run build` | **PASS** — `tsc -p tsconfig.main.json` + webpack renderer both succeed |
| `npm run test -- --run` | **PASS** — 81 files, **697 pass / 1 skip** (baseline was 683 pass / 1 skip; +14 new tests, 0 regressions) |

---

## Evidence index

- New tests: `tests/unit/main/create-manifest-handler.test.ts` (11), `tests/unit/components/create-manifest-modal.test.tsx` (3).
- GraphQL owner-manifest search: `scratchpad/uat-manifest-deploy/gql-query3.json` / result inline above.
- Deploy harness (not committed, scratch-only): `scratchpad/uat-manifest-deploy/deploy-manifest.js`; live output `scratchpad/uat-manifest-deploy/deploy-live.log`.
- Resolution poll log: `scratchpad/uat-manifest-deploy/resolve-poll2.log`.
- Fresh manifest tx: `UXu-lD2j-HbIAfwSPV1anhIn9KfucoVqc0FsysnNCIQ` (deployed live this session, zero cost).
- Ground truth for subpath verification: `TEST_FILE.txt` = 14 bytes, `THIS IS TEST 1` (no trailing newline); `youre-the-man-now-dog.html` = 4,299 bytes, SHA-256 `07d0efba7a080c42e1e3961d3c3c8b6370da9fe7e6d2f70f68614cfbc4b33bb4`.
