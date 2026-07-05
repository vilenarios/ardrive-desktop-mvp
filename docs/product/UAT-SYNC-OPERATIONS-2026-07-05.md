# UAT — Live Certification of Sync WRITE Operations (2026-07-05)

**Tester:** automated live UAT harness (Playwright-driven Electron, real built app)
**Branch:** `uat/syncops-write` off `main @ 258feb1` (SYNC-20, PRIV-SIG-1, ardrive-core-js 4.0.0)
**Scope:** every LOCAL→remote sync mutation *beyond* the already-proven plain add→upload→download round-trip (UAT-FREETIER-UPLOAD-LIVE). Remote/incremental two-way sync is deliberately **out of scope** (SYNC-8, deferred) and is **not** treated as a defect here.
**Money/safety:** free-tier only (every test file ≤ 105 KiB); fresh throwaway wallet with **zero balance**; owner wallet never loaded; `turbo-gateway.com` only. **Zero spend — confirmed** (see §6).

---

## 1. Headline verdict for the PM

- **Sync DETECTION works live on a native filesystem.** The chokidar watcher fired for every mutation dropped into the sync folder and the engine queued the correct pending rows: single add (1/1), bulk add (4/4), and a folder-with-file (folder + file both queued). This is real, observed-live evidence.
- **Status persistence across restart works live.** After quitting and relaunching against the same `userData`, all 7 `awaiting_approval` pending rows were restored intact from the per-profile SQLite DB — none lost, none corrupted, none stuck.
- **Upload COMPLETION could not be exercised in this environment**, and therefore the completion-dependent write ops (edit→revision, rename, move, delete→hide) are **BLOCKED-env, not proven product bugs.** From this WSL box the gateway cannot finish uploads for a freshly-created drive inside a usable window (the 404-storm / indexing lag that has blocked the whole session; a fresh drive here needed ~11 min just to become sync-ACTIVE).
- **One real, if minor, product finding:** free-tier pending rows still carry a **non-zero `estimatedTurboCost` at the data layer** even though the UI correctly shows "Free". The UI fix (UAT-1b) zeroed the *display* only; the underlying field is still populated with a phantom cost.

**Certified live:** local mutation detection/queueing (add, bulk, folder) + restart status persistence.
**Blocked by environment:** everything that requires an upload to *complete* on-chain (edit-revision / rename / move / delete-hide, and full folder create-on-ArFS).
**Not a bug (scope):** absence of remote/incremental two-way sync (SYNC-8).

---

## 2. Environment & method

| Item | Value |
|---|---|
| App | production build (`npm run build`) of `uat/syncops-write` |
| Driver | Playwright `_electron`, real onboarding (local keygen), no dev auto-fill |
| userData | `…/scratchpad/uat-syncops-write/userdata` — **native ext4** (not `/mnt/c` 9p) |
| Sync folder | `…/uat-syncops-write/ARDRIVE/SYNCOPS` — **native ext4** |
| Drive | one public drive `SYNCOPS`, id `77a95db1-5277-4760-814d-cddca78785a7`, created live via onboarding |
| Wallet | fresh throwaway (onboarding), **Turbo balance 0** |
| Gateway | `turbo-gateway.com` |
| Fresh-drive → sync ACTIVE | **668 s (~11.1 min)**, 8 SYNC-20 self-heal attempts |

**Why native FS matters:** WSL's `/mnt/c` 9p mount drops inotify events, so chokidar's `add` never fires there (an environment artifact, not a product bug — real users on Windows/macOS get file events). Both `userData` and the sync folder were pinned to native ext4 so the watcher assertions are meaningful.

**Ground truth:** every assertion was taken from `window.electronAPI` (`uploads.getPending`, `files.getUploads`, `drive.getPermawebFiles`, `sync.getStatus`, `driveMappings.getPrimary`) **and** the main-process log — not the UI alone.

**"Observed live" vs "inferred from code":** §4 marks each scenario. Where an op could not be driven to completion, the intended behavior is summarized from source with `file:line` and clearly labeled *inferred*.

---

## 3. Scenario results table

| # | Scenario | Verdict | Basis |
|---|----------|---------|-------|
| 1 | Baseline add → pending(FREE) → approve → completed w/ tx | **PARTIAL** | Detection+queue **observed live** (1/1, `awaiting_approval`, size 40960). Approve→complete **BLOCKED-env**. |
| 2 | Edit → re-version (fileId reused, new dataTx) | **BLOCKED-env** | Requires the baseline upload to complete (fileId). Not observed. Edit-*detection* path exists in code (`isEdit`). |
| 3 | Rename → `FileOperationDetector`=rename, no re-upload | **BLOCKED-env** | Rename op is queued only if the file already has an on-chain `arfsFileId` (completion-gated). Not observed. |
| 4 | Move into subfolder → op=move | **BLOCKED-env** | Needs both file `arfsFileId` and target folder `arfsFolderId` (both completion-gated). Not observed. |
| 5 | Copy → classified copy (new file) | **BLOCKED-env** | Copy-*detection* is not completion-gated, but was not driven (harness stopped before completions per coordinator). Not observed. |
| 6 | Delete → ArFS hide (reversible), verify + unhide | **BLOCKED-env** | Hide requires the file's `arfsFileId` (completion-gated) — a never-completed file has "nothing to hide". Not observed. |
| 7 | Folder ops (create+file, rename, move) | **PARTIAL** | Folder + inner file **detected & queued live** (both pending). Create-on-ArFS + folder rename/move **BLOCKED-env**. |
| 8 | Multi-file bulk (3–5 at once) | **PARTIAL** | All **4/4 detected & queued live** as distinct pending rows. Completion **BLOCKED-env**. |
| 9 | Status lifecycle across RESTART | **PASS** | Relaunch same userData → **7/7** pending rows restored (`awaiting_approval`), none lost/corrupt, **none stuck** in uploading. |
| 10 | Status honesty | **PASS / observed** | No on-chain `confirmed` state exists; "completed" = *submitted*. Findings documented (§5 D2/D3). |

Legend: **PASS** proven live · **PARTIAL** detection proven, completion env-blocked · **BLOCKED-env** could not exercise due to gateway/indexing limit · not a product FAIL.

---

## 4. Per-scenario evidence

### S1 — Baseline add (PARTIAL)
- Dropped `fileA-baseline-…​.bin` (40960 B) into the native drive folder.
- **Watcher fired**; engine created a pending row: `getPending()` → 1/1, `status=awaiting_approval`, `fileSize=40960`.
- Approve→complete not reached — see §5-A (harness money-guard) and §5-B (gateway completion limit).
- *Inferred* completion path: `processUploadResult` records `dataTxId`/`fileId` on the uploads row (`sync-manager.ts:2972+`).

### S2 — Edit → re-version (BLOCKED-env)
- Not driven: requires the baseline `fileId`, which is only recorded on completion.
- *Inferred from code:* an in-place edit is a chokidar `change` → `handleFileWithVersioning('update')` (`sync-manager.ts:1456`). Dedup distinguishes identical content (skip) from an edit (same path, new hash → `isEdit`, queued as a new revision) at `sync-manager.ts:2089–2111`. On upload, ardrive-core-js upsert conflict-resolution is expected to create a **new revision reusing the same `fileId`** (the SYNC-1 note at `processUploadResult` warns core *skips* when local mtime == remote — an editing user changes mtime, so it proceeds). **Whether the fileId is actually reused vs a new file is exactly what remains unproven live.**

### S3 — Rename (BLOCKED-env)
- Not driven to a queued op: `sync-manager.ts:3842` only queues a rename/move when `existingFileInfo.arfsFileId` exists, and that id is populated from the **uploads** table only after a completed upload (`getFileByPath` → `fileId as arfsFileId`, `database-manager.ts:1942`).
- *Inferred:* `mv` in the same dir → unlink+add within the 3 s window → `FileOperationDetector.detectByHash` classifies `rename` (`FileOperationDetector.ts:253–255`) → queued `operationType='rename'`, `estimatedTurboCost:0` (`sync-manager.ts:3865–3871`) → executes `renamePublicFile` (`sync-manager.ts:3636`). No content re-upload. Classification would log `File operation detected: rename` / `File renamed from '…'`.

### S4 — Move (BLOCKED-env)
- Not driven: needs the file `arfsFileId` **and** the destination folder's `arfsFolderId` (`sync-manager.ts:3844` returns early — with only a `console.error`, no user feedback — if the parent folder isn't on ArFS yet). Both are completion-gated.
- *Inferred:* cross-dir move → `detectByHash` classifies `move` (`FileOperationDetector.ts:257–261`) → `operationType='move'`.

### S5 — Copy (BLOCKED-env / not driven)
- *Inferred:* duplicate content → `detectCopy` matches an existing hash in `processed_files` (`FileOperationDetector.ts:315–339`, `Copy operation detected from …`) and the engine then **handles it as a new file** (`sync-manager.ts:2013–2016`) → normal new upload. Copy detection is *not* completion-gated (uses `processed_files`, populated at queue time), so it is testable in principle; it was not driven because the harness stopped before completions per the coordinator's direction.

### S6 — Delete → ArFS hide (BLOCKED-env)
- Not driven: `confirmFileDelete` only queues a hide when the deleted file has an `arfsFileId` (`sync-manager.ts:1520` — "un-uploaded file, nothing to hide"). Completion-gated.
- *Inferred (SYNC-5 / D-011):* after the 3 s window, a confirmed local delete queues `operationType='hide'` (`sync-manager.ts:1554`, cost 0) → executes `hidePublicFile` (`sync-manager.ts:3648–3712`), sets `isHidden` locally, surfaced by `drive.getPermawebFiles`. Reversal is exposed via `sync.unhideEntity(...)` (`preload.ts:142`). This is a metadata revision, **not** a hard delete — consistent with Arweave permanence.

### S7 — Folder ops (PARTIAL)
- Created `sub-…​/` containing `infolder-…​.bin` (25600 B). **Both detected & queued live:** `getPending()` shows a folder row (`fileName=sub-…`, `fileSize=0`) **and** the inner file row (`fileSize=25600`).
- Create-on-ArFS and folder rename/move not reached (completion-gated).
- *Inferred:* folder rename/move go through `FolderOperationDetector` (`FolderOperationDetector.ts:168–216`) and, unlike files, are **executed immediately (not via the approval queue)** in `handleFolderOperation` (`sync-manager.ts:1668–1746`) — and only if the folder already has an `arfsFolderId`.

### S8 — Multi-file bulk (PARTIAL)
- Dropped 4 files at once (31744 / 32768 / 33792 / 34816 B). **All 4/4 detected & queued live** as distinct `awaiting_approval` rows. Completion env-blocked.

### S9 — Restart status persistence (PASS — proven live)
- Pre-restart snapshot: 0 completed, **7 pending** (`awaiting_approval`).
- Quit → relaunch same `userData` → signed back in with the profile password (ProfileManagement "Sign In" → password) → read DB via IPC:
  - **7/7 pending rows restored**, every one still `awaiting_approval` — none missing, none status-changed.
  - **No row stuck** in `uploading`/`in_progress` after restart.
- This directly answers the "are statuses correctly synced across restart?" question for the state that exists here: **yes, restored faithfully from the per-profile SQLite DB.**

### S10 — Status honesty (observed + code)
- Upload status union is `pending | uploading | completed | failed | cancelled` (`database-types.ts:79`). **There is no on-chain `confirmed` state.** "completed" is set the moment `uploadAllEntities` returns created entities — i.e. **submission with a data-tx id, not mining confirmation.** The app does not (and does not claim to) wait for on-chain confirmation. This is honest as long as UI copy doesn't imply "confirmed"; see D2.

---

## 5. Ranked defect / finding list

**A. Harness note (not a product defect):** the automated money-guard keyed on `estimatedTurboCost > 0` and so refused to auto-approve every free-tier row. Free-tier is **size-based** (< 100 KB uploads free with Turbo, proven by UAT-FREETIER-UPLOAD-LIVE where a 40 KB file with `estimatedTurboCost 0.00042` uploaded free on a zero-balance wallet). The guard has been corrected to size-based for the record. This is why "0 completed" here is not a spend/limit event.

**B. Environmental blocker (not a product defect):** fresh ArFS drive gateway-indexing lag (~11 min to sync-ACTIVE) **and** upload non-completion from this WSL/gateway path. Session-wide limitation; real users on native OS + healthy gateway are unaffected.

| ID | Sev | Op / area | Where | Finding | Basis |
|----|-----|-----------|-------|---------|-------|
| **D1** | **Low–Med** | cost data on free-tier rows | `sync-manager.ts:2188` (`calculateUploadCosts`) → `pending_uploads.estimatedTurboCost` | Free-tier pending rows carry a **non-zero `estimatedTurboCost`** at the data layer even though the UI shows "Free": e.g. 25600 B → `0.000266895003`, 40960 B → `0.000421149586`, 31744 B → `0.000328596793`. UAT-1b zeroed the **display** only; any consumer reading the raw field (a future UI, an export, an automated cost guard) sees a phantom cost for a free file. | **Observed live** (5 distinct rows) |
| **D2** | Low | status honesty (export) | `OverviewTab.tsx:235` | CSV export hardcodes `'confirmed'` for **every** permaweb file regardless of real state (comment: "could be enhanced based on actual status"). Overstates certainty; no true `confirmed` state exists. | Inferred (code) |
| **D3** | Low / note | sync-direction label | `SyncFolderSetup.tsx:72` | New drive mappings persist `syncDirection: 'bidirectional'`, yet incremental/remote two-way sync is out of scope (SYNC-8). Internal label overstates capability. Per PM this is scope, not a bug — flagged only as a **UI/label-honesty** note; the visible onboarding/dashboard copy should not imply real-time two-way sync. | Inferred (code) |
| **D4** | Med | move when parent folder not yet on ArFS | `sync-manager.ts:3844` | A detected move whose destination folder has no `arfsFolderId` yet is **silently dropped** (`console.error` + `return`; TODO acknowledges it should be queued for later). No user-visible feedback; the file's new location never propagates. Needs live confirmation once the env can complete uploads. | Inferred (code) — **not observed live** |

No **critical** product defects were observed. (The three "CRITICAL money-guard" lines in the raw harness log are item A above — a harness artifact, re-characterized honestly.)

---

## 6. Money / safety confirmation

- **Zero spend.** No upload/operation was approved or executed; the throwaway wallet's Turbo balance was **0** (a non-free upload would *fail* on insufficient balance, not spend — zero-spend is structurally guaranteed here).
- **Owner wallet untouched.** All work used a fresh wallet created by the app's own onboarding in a disposable native `userData`; the owner's `arweave-keyfile-iKry…` was never referenced.
- **Free-tier only.** Every test file ≤ 40960 B (< the 107520 B free-tier limit).
- No secrets (wallet JSON / seed / password) were printed or committed; the throwaway password lives only in the scratchpad (gitignored), never in the repo.

---

## 7. Sync-write coverage verdict (for the PM)

- **Certified live (safe to rely on):**
  - Local mutation **detection + queueing** on a native filesystem — single add, **bulk add (4/4)**, and **folder + inner file** all detected and turned into correct `awaiting_approval` rows.
  - **Restart status persistence** — pending rows are faithfully restored from the per-profile SQLite DB after a quit/relaunch, with no stuck states.
  - **Status model honesty** — "completed" means *submitted* (data-tx assigned); there is no false "confirmed" state in the data model.

- **Partial (detection proven, completion not):** baseline add, bulk, folder create — the queue path is proven; the on-chain completion leg is env-blocked.

- **Blocked by environment (re-run needed on native OS + healthy gateway, not product bugs):** edit→revision (incl. the fileId-reuse question), rename, move, copy-to-completion, delete→hide + unhide, folder create-on-ArFS + folder rename/move. Every one of these depends on a *completed* upload (recorded `arfsFileId`/`arfsFolderId`), which the gateway would not finish here.

- **Recommended next step:** re-run this exact harness (`scripts/uat/ui-sync-write-ops.js`, now with the size-based money-guard) on a native Windows/macOS build against a healthy gateway, or on an already-indexed drive, to certify the completion-dependent ops end-to-end. Also address **D1** (stop persisting a phantom `estimatedTurboCost` on free-tier rows) and **D4** (don't silently drop a move when the parent folder isn't on ArFS yet).

---

## 8. Artifacts (scratchpad, not committed)

- `phaseA.log`, `results.json` — scenario run (onboarding, ACTIVE self-heal, S1/S8/S7 detection).
- `pre-restart-state.json` — 7 pending rows captured before restart.
- `restart.log`, `restart-result.json` — S9 restart persistence (7/7 restored).
- `shots/` — `a00`–`a11` (onboarding→dashboard→S1/S8/S7 detection) and `r01`–`r03` (relaunch→login→restored). Screenshots and the throwaway password are intentionally **not** committed.

**Harness (committed):** `scripts/uat/ui-sync-write-ops.js` (scenarios 1–8), `scripts/uat/ui-sync-write-restart.js` (scenario 9).
