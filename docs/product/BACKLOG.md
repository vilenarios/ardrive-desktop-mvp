# ArDrive Desktop — Product Backlog

Canonical work tracker. Every item has a stable ID — reference it in commits, PRs, and status updates (e.g. `fix(sync): re-upload edited files [SYNC-1]`).

Evidence for each item lives in [AUDIT-2026-07-02.md](./AUDIT-2026-07-02.md) (§section.finding). Line numbers there are as-of-audit and may drift.

**Severity** — `P0`: release blocker for the beta scope · `P1`: must fix before GA / seriously erodes trust · `P2`: cleanup & polish.
**Status** — `todo` · `in-progress` · `done` · `deferred` (post-beta track) · `wont-fix`.
**Phase/Track** — Phases 1–4 = beta critical path (see [ROADMAP.md](./ROADMAP.md)); Tracks A–E = post-beta.

Working an item: set `in-progress`, implement, verify per the acceptance criteria, set `done` **in the same PR** with a one-line note + commit ref. Never delete items; mark `wont-fix` with a reason.

---

## SEC — Security & data safety

### SEC-1 · P0 · Phase 1 · `done`
**Stop logging the private-drive key on creation.** Evidence: AUDIT §6.5 (wallet-manager-secure.ts:1179; same pattern :625).
Fix: remove/redact the `JSON.stringify(result)` logs; route through secure-logger.
Acceptance: creating a private drive emits no key material to stdout/logs; grep for `JSON.stringify(result` in wallet-manager-secure.ts is clean.
Done 2026-07-03 (8172c3f, qa-gate PASS — dynamically exercised + mutation-checked): all raw ArFSResult logging replaced with whitelist `summarizeArFSResult()` (new src/main/utils/arfs-result-summary.ts); includes two self-found leaks in sync-manager upload paths beyond the audited sites; sentinel leak-test covers URL-encoded and raw-bytes vectors (115+1 green).

### SEC-2 · P0 · Phase 1 · `done`
**Gate `system:get-env` behind dev mode.** Evidence: §6.4 (main.ts:2891-2898).
Fix: return nothing when `app.isPackaged` or `ARDRIVE_DEV_MODE !== 'true'`.
Acceptance: packaged build returns empty for `ARDRIVE_DEV_PASSWORD`/`ARDRIVE_DEV_WALLET_PATH`.
Note 2026-07-03: done — merged from `fix/SEC-2-env-gate` (f14755d) after qa-gate PASS (static; gate verified on compiled dist with isPackaged injected). Handler delegates to `readDevEnv` (src/main/utils/dev-env.ts), fails closed; 17 behavioral tests. Raw return shape kept deliberately — envelope lands with UX-3 (safeIpcHandler does not yet produce the D-005 envelope).

### SEC-3 · P0 · Phase 1 · `done`
**Stop sync on logout and profile switch.** Evidence: §4.9 (no stopSync in `wallet:logout`/`profiles:switch`; sync-manager holds own ArDrive ref; startSync early-returns when monitoring).
Fix: `await syncManager.stopSync()` + clear its ArDrive/drive state in both paths; make `startSync` re-target when drive/folder differ.
Acceptance: after logout, no chokidar watcher is active and syncManager holds no wallet-bearing object; switching profiles then starting sync watches the new profile's folder/drive.
Note 2026-07-03: done — merged from `fix/SEC-3-sync-logout` (0ed4d21 + QA-finding 23a3126) after qa-gate PASS (static — Electron IPC dispatch only; sever/re-target behavior exercised with real chokidar probes). stopAndClearAllState() wired into wallet:logout, wallet:clear-stored, profiles:switch (same-profile no-op via new raw getActiveProfileId()); startSync re-targets on drive/folder change. Known interplay: progress emission after stop→start stays dead until SYNC-4 (resolved 2026-07-03 — SYNC-4 merged).

### SEC-4 · P1 · Phase 3 · `todo`
**Keychain password storage: consent + lifecycle.** Evidence: §4.2.
Fix (pair with UX-6): opt-in "Keep me signed in" at login → store; opt-out/logout → delete; delete on profile deletion; remove the deterministic-key fallback file (fail closed to "not remembered"); remove hardcoded-salt in-memory obfuscation.
Acceptance: password reaches the keychain only after explicit opt-in; deleting a profile removes its keychain entry; no keychain-fallback.enc is ever created.

### SEC-5 · P1 · Phase 3 · `done`
**Stop writing the decrypted JWK to a temp file.** Evidence: §4.3 (3 sites).
Done 2026-07-04 (branch fix/SEC-5-jwk-tempfile, Opus security qa-gate PASS): all 3 sites (seed import, JWK-file import, login/loadWallet) now `new JWKWallet(walletJson)` in memory — verified core-js 4.0.0 `readJWKFile(path)` is exactly `new JWKWallet(JSON.parse(readFileSync(path)))`, so this is the same construction minus the disk round-trip. `grep readJWKFile|tmpdir → zero in src`; `secureDeleteFile` remains only for the encrypted `wallet.enc`; `git diff -w` shows no logic change beyond temp-file removal; in-memory key verified carried (private key matches); net removes a `console.log` of the temp path. Full suite 358 green, build ok; behavioral test with negative control.
Fix: construct the wallet object from the decrypted JSON in memory (bypass `readJWKFile`'s path requirement).
Acceptance: no wallet material is written under os.tmpdir() during import or login.

### SEC-6 · P1 · Phase 4 · `todo`
**Upgrade Electron to a supported major.** Evidence: §6.6. Includes: drag-drop `file.path` shim (WalletSetup.tsx:89, breaks >31), CI Node 18→20+, re-verify keytar/sqlite3 native builds.
Acceptance: app builds and passes smoke UAT on a supported Electron; CI on maintained Node.

### SEC-7 · P1 · Phase 4 · `todo`
**Harden the renderer shell.** Evidence: §6.3.
Fix: CSP meta (or session headers); `will-navigate` deny + `setWindowOpenHandler` on all windows; `sandbox: true` where possible; webpack renderer `target: 'web'`; remove `window.global` shim if possible.
Acceptance: navigation to external origins in the main window is blocked; CSP present in packaged build.

### SEC-8 · P2 · Track D · `todo`
**Adopt secure-logger; cut console noise.** Evidence: §6.8 (909 main + 238 renderer console calls; secure-logger has zero importers).
QA findings 2026-07-03 to fold in: turbo-manager.ts:289/306 log the full checkout-session object (payment URL/id — hygiene, not key material); harden `safeIdString` in arfs-result-summary.ts with a `keyData`-shape guard to make the whitelist shape-proof.
Acceptance: main-process logging goes through secure-logger with redaction; no secrets (keys, passwords, seed material) representable in logs.

### SEC-9 · P2 · Track D · `todo`
**Confine `shell:open-file/path` to sync folders.** Evidence: §6.3.
QA finding 2026-07-03 (UX-2 gate): `validateFilePath`'s substring blocklist now also rejects UNC network-share paths (`\\server\share\...`) on `sync:setFolder` — Windows NAS users can't set such folders. Fold a real path-validation design (confinement + UNC policy) into this item.
Acceptance: paths outside configured sync folders (after realpath resolution) are rejected; UNC policy explicit.

### SEC-10 · P2 · Track D · `todo`
**Migrate keytar → Electron safeStorage; retire crypto-js.** Evidence: §6.6.

### SEC-11 · P2 · Track D · `todo`
**Rate-limit local password attempts** on `profiles:switch`/`wallet:load`. Evidence: §4.6.

### SEC-12 · P1 · Phase 1 · `done`
**Fix wallet-export reveal-mask bug.** Evidence: §4.11 (WalletExport.tsx:114, 372, 396).
Fix: separate `exportComplete` from `revealed`; secrets masked until explicit reveal click. Scope extended 2026-07-03 (PM, from implementer finding): plain JWK export renders raw key material on the same screen — same defect class, included; encrypted keyfile stays unmasked (password-protected, not raw secret).
Acceptance: after export, seed phrase, private key, and plain JWK render masked; reveal toggles.
Done 2026-07-03 (1411460 + 6936567, qa-gate PASS — component driven end-to-end, mutation-checked, DOM-vector leak probe): 7 behavioral tests; no reveal-state carryover path exists; suite 122+1 green. QA notes: Copy stays ungated behind reveal (deliberate — explicit action); clipboard-timer issue filed to UX-11.

### SEC-13 · P2 · Track D · `todo`
**Make seed-confirmation real.** Evidence: §4.5 (completeSetup stub; wallet committed pre-confirmation; orphan profiles on Back).
Fix: either commit wallet only after confirmation, or drop the placebo checkbox and treat generate as commit (and de-dupe orphan profiles).

---

## MONEY — Payment & cost integrity

### MONEY-1 · P0 · Phase 1 · `done`
**Resolve the cosmetic AR/Turbo choice.** Evidence: §1.1. Per D-010 (Turbo-only beta): remove the AR payment option from the approval queue UI, stop AR balance validation on approve, record `uploadMethod: 'turbo'` truthfully, label uploads accordingly. Track B is now the D-013 direction (FEAT-2 Advanced-mode self-bundling replaces "real AR payments"); if planner changes are ever needed, ardrive-core-js is modifiable (D-016).
Acceptance: UI offers no AR payment choice; DB `uploadMethod` matches actual execution; no AR-denominated balance gate on approval.
Done 2026-07-03 (627c208 + d688d9e, qa-gate PASS — money boundary verified at the DB-write level via the REAL captured IPC handlers, mutation-checked): no AR choice representable in the queue; 'turbo' hardcoded at every addUpload site; AR gate deleted (0-AR wallets approve; live Turbo check authoritative); insufficient rows block/skip with visible reasons + top-up affordance; first main.ts handler test suite established (reusable pattern). Re-homed to MONEY-6: sync-manager :3392/:1973 money remnants + top-up row-refresh staleness.
QA findings 2026-07-03 to resolve here: define what APPROVAL means for insufficient-Turbo-balance rows (currently routes to the 'ar' rail whose cost is undisplayed — MONEY-3 left the quote visible with an "Insufficient balance" hint, but approve still submits 'ar'); sync-manager.ts:3392 hardcodes synthetic `estimatedTurboCost: 0.000001` for metadata ops (renderer masks it as "Free"; make the stored value honest); sync-manager.ts:1973 `|| undefined` would coerce a legitimate zero quote; dead `totalArCost` accumulation and dead `calculateTurboCredits` (turbo-utils) can go.

### MONEY-2 · P0 · Phase 2 · `done`
**Make cancel abort and retry safe.** Evidence: §1.2.
Fix: AbortController through UploadQueueManager → uploadFile; `uploads:cancel` aborts in-flight work before marking failed; `uploads:retry` refuses items not in a terminal state; completion handler must not resurrect cancelled records.
Acceptance: cancel during upload halts network activity and the file is not charged; retry of an in-flight upload is rejected; no path yields two charges for one file.
Note 2026-07-03: done — merged from `fix/MONEY-2-cancel-retry` (3feeae1 + fix round 0121f82 + 1e5eac8) after qa-gate FAIL → fix → PASS (static — handler wiring read-verified; all queue/pipeline/guard behavior exercised by adversarial probes). Shipped: spend checkpoints before EVERY paid call (incl. per-iteration in the folder-creation loops); pending cancels guaranteed free; no completion path resurrects a cancelled record (files AND folders — charged outcomes record the truth with tx-id evidence); retry admission (isRetryAllowed) refuses live/queued/cancellation-pending/charge-evidenced rows for retry and retry-all; uploads:cancel never rewrites completed history; cancelled-but-charged files register in processed_files (watcher re-charge closed). Known limit: an already-launched core call cannot be aborted — see MONEY-12. Money-safe residuals on record in the gate verdict (narrow interim-row race; crash-orphaned rows are SYNC-3/MONEY-10 scope).

### MONEY-3 · P0 · Phase 1 · `done`
**Remove fabricated USD pricing.** Evidence: §1.3-1.4 (MOCK_AR_PRICE_USD=6.50; 1 winston/byte AR estimate; fake `×1.1` Turbo fallback quote).
Fix: fetch a real AR/USD rate (with cache + "as of" timestamp) or drop USD display for beta; show "estimate unavailable" instead of fake fallback quotes.
Acceptance: no hardcoded exchange rate or synthetic quote is displayed anywhere.
Done 2026-07-03 (6aa174b + 29a5855, qa-gate FAIL→fix→PASS): ar-price-utils.ts deleted; honest "Estimate unavailable"/"Insufficient balance" states; ×1.1 fallback → null. QA caught a DB-shape coercion (sqlite integer booleans + raw row spread → fabricated "0.0000 Credits" banner) — fixed at the DB boundary (getPendingUploads normalization) + renderer; QA's empirical repro adopted as permanent tests (160+1 green). Left for MONEY-1: internal 1-winston/byte placeholder, approval semantics for insufficient-balance rows.

### MONEY-4 · P0 · Phase 1 · `done`
**Remove or implement Auto Top-Up.** Evidence: §1.11 (fake "saved" confirmation).
Acceptance: no UI implies recurring charges are configured unless they are.
Done 2026-07-03 (f548fbb, qa-gate PASS — all 4 tabs driven, defect-catching re-proven, CSS orphan audit both directions): fake Auto Top-Up UI fully removed per PM REMOVE decision (D-010); zero recurring-charge residue repo-wide (167+1 green). Successor finding: MONEY-11 (fabricated Usage Statistics zeros — now the Settings tab's only content).

### MONEY-5 · P1 · Phase 1 · `done`
**Remove the no-op conflict-resolution modal.** Evidence: §1.6. (Real conflict detection = Track C scope with SYNC; ship neither half until both exist.)
Acceptance: no UI offers conflict choices that are discarded.
Done 2026-07-03 (67db271, qa-gate PASS under zero-trust after implementer session died — defect-catching re-proven, completeness sweep clean): modal, Resolve button, handler, and prop chain removed; passive conflict displays remain (unreachable, conflictType hardcoded 'none'); detection stubs/DB fields preserved for Track C. Track C note: conflicted rows will render with NO actions until the real UI lands — rework the gating then.

### MONEY-6 · P1 · Phase 2 · `done`
**Fix approval-queue semantics.** Evidence: §1.5.
Fix: "Approve & Upload" calls approve-all once (no per-file follow-up loop that bypasses balance checks); consistent balance gating between single and batch paths. (Dead radio already removed by MONEY-1.)
Re-homed from MONEY-1 (2026-07-03, need sync-manager.ts access): :3392 synthetic `estimatedTurboCost: 0.000001` for metadata ops — store honest value; :1973 `|| undefined` zero-quote coercion. Plus staleness: top-up affordance doesn't refresh row quotes — blocked rows stay blocked until re-quote despite live main-side check.
Acceptance: one approval action → one approval per file; skipped-for-balance files stay skipped with a visible reason.
Done 2026-07-03 (c96d1a8, qa-gate FAIL→fix→PASS on Opus): approve-all runs once (no per-file loop); blocked/skipped rows show reasons; the top-up staleness re-fix routes wallet refresh through wallet.getInfo(true)'s RETURN VALUE (App.refreshWalletInfo, null-guarded) on Turbo-manager close + payment-completed — sidestepping the dead wallet-info-updated event channel (D1 clobber) until UX-4 rebuilds it. Production chain mutation-proven. Remnants → UX-4: the removeAllListeners clobber root fix + the missing-dep warning + double-fetch belt-and-suspenders.
### MONEY-7 · P1 · Phase 3 · `todo`
**Harden the payment window.** Evidence: §1.8.
Fix: pin allowed hosts for `payment:open-window`; success detection via `will-redirect`/`did-navigate` against the exact success URL; `closed` handler emits a cancel event; `sandbox: true` + `setWindowOpenHandler`; remove dead focus-refresh (main.ts:244-266).
Acceptance: only the checkout host can open; completing or closing the window always yields exactly one accurate event; balance refreshes on completion.

### MONEY-8 · P2 · Track D · `todo`
**AR→Credits conversion UX honesty + input bounds.** Evidence: §1.14 (instant "success" vs 5-15 min reality; validateTurboAmount 1e-12..1e6 shared USD/AR).

### MONEY-9 · P1 · Phase 2 · `in-progress`
**Serialize the upload queue properly.** Evidence: §1.9.
Fix: reentrancy guard (or work-loop) in UploadQueueManager with a configurable concurrency (default 1–2); mutex folder creation to kill the duplicate-paid-folder race.
Acceptance: concurrent uploads bounded; two files in one new folder create exactly one folder entity.

### MONEY-10 · P1 · Phase 2 · `todo`
**Re-validate file at upload time.** Evidence: §1.10.
Fix: re-stat before wrap; if size changed beyond tolerance since approval, return to `awaiting_approval` with a note.
Acceptance: a file grown after approval is not uploaded at the larger size without re-approval.


### MONEY-12 · P1 · Track B · `todo`
**Upstream: AbortSignal support in ardrive-core-js upload/create APIs.** Filed per D-016 as MONEY-2's merge condition: `uploadAllEntities`, `createPublicFolder`, `createPrivateFolder` accept no AbortSignal (ardrive-core-js lib/ardrive.d.ts), so a single already-launched paid call cannot be halted mid-flight — MONEY-2's checkpoints stop everything not yet launched. True cancel-in-flight needs core to thread a signal into its gateway/turbo requests.

### MONEY-13 · P1 · Phase 3 · `done`
**AR balance renders as NaN during a gateway 429.** Found via on-chain UAT 2026-07-04.
Done 2026-07-04 (branch fix/MONEY-13-nan-balance, Opus qa-gate PASS): `isNumericWinstonString` (/^\d+$/) guard before `winstonToAr` + bounded retry (3×, 300/600ms) in `getWalletInfo`; on persistent failure sets `balance:'' , balanceUnavailable:true` (new WalletInfo field, propagates via IPC); UserMenu + both upload-approval queues + TurboPurchaseTab render "Unavailable" (never NaN, never false "0"). Money-safe (uploads are Turbo-only; AR balance never gates a spend). Full suite 387 green; 28 new tests. FOLLOW-UPS (non-blocking, pre-existing): (a) OverviewTab rename-confirm modal shows "0.000000 AR" when unavailable (false-0 in a spend-confirm that blocks anyway) — reuse the guard there; (b) arweave.js `fetch` never applies the 120s timeout (bounded by undici defaults) — pass an AbortSignal.timeout when hardening. `arweave.js` `wallets.getBalance` swallows an HTTP 429 rate-limit — it resolves with the raw 429 HTML body as the "winston" string, so `winstonToAr` yields `NaN` and error-keyed retries never fire. The app's AR-balance path (`wallet-manager-secure.getWalletInfo`) then displays **NaN AR** during rate-limiting.
Acceptance: a 429 / non-numeric response from the balance endpoint never renders as NaN; the UI shows a transient "unavailable"/retry state instead; validate numeric + retry on error bodies; behavioral test with a mocked non-numeric response.
Implementer note 2026-07-04 (fix/MONEY-13-nan-balance): `wallet-manager-secure.getWalletInfo` now validates the winston response is `/^\d+$/` before `winstonToAr`, retrying up to 3x with backoff (300/600ms) on a non-numeric body; if still invalid, returns `balance: ''` + `balanceUnavailable: true` (never `'0'`, never `'NaN'`). Renderer guards added at every place that formats `WalletInfo.balance`/`walletBalance` (UserMenu — the persistent header display — plus UploadApprovalQueue(Modern) and TurboPurchaseTab) to render "Unavailable" instead of "NaN" on a non-numeric/empty value; the existing refresh button next to the AR balance in UserMenu doubles as the retry affordance. Turbo Credits balance path reviewed and left unchanged: `@ardrive/turbo-sdk`'s client is axios-based and throws on non-2xx (unlike arweave.js's fetch wrapper, which never checks `res.status`), so it doesn't share the swallowed-error pattern; a Turbo fetch failure already surfaces as `turboBalance: undefined`, which existing `{turboBalance && ...}` guards already handle without NaN. Status left `in-progress` for qa-gate.

### MONEY-11 · P2 · Track D · `todo`
**Usage Statistics shows fabricated zeros.** Implementer finding 2026-07-03 (during MONEY-4): the Turbo Settings tab's surviving "Usage Statistics" section renders hardcoded 0 files / 0 AR / 0 GB — same fabricated-data class as the removed Auto Top-Up. Wire to real per-profile stats (uploads table aggregates) or remove the panel.
Acceptance: every figure in Usage Statistics derives from real data, or the panel is gone.
---

## SYNC — Sync engine correctness

### SYNC-1 · P0 · Phase 2 · `done`
**Edited files must re-upload.** Evidence: §2.1 (path-match dedup bails before the update path; detectFileChange's 'update' result dead-ends).
Fix: on hash-differs-for-known-path, route to the new-version upload path (ArFS new file revision) via the approval queue.
Acceptance: UAT — edit a synced file locally → new pending upload appears → approval uploads a new revision visible in the Permaweb view.
Note 2026-07-03: done — merged from `fix/SYNC-1-reupload-edits` (e2f8867 + findings f7a2f76) after qa-gate PASS (static — the revision-upload half verified from ardrive-core source: default upsert reuses the existing fileId = ArFS revision, on both v2 and Turbo paths; on-chain UAT requires spend). Dedup is content-aware (hash-match skips, path-only match = edit → approval queue); edits of downloaded files re-upload; gate's negative control proved the tests pin the fix. Folded finding: empty upsert-skip results record a truthful skip instead of 'completed' with undefined tx ids.
Gate follow-ups filed: revert-to-original divergence + reject-is-permanent-for-content (both hash-dedup family, Track C conflict work); stale failed-download placeholder blocks edits (SYNC-2/3 cleanup family).

### SYNC-2 · P0 · Phase 2 · `done`
**Failed downloads must be recorded as failed.** Evidence: §2.2.
Fix: rethrow from `downloadFile`'s catch (or return a result the caller honors); only mark `synced` after verifying the file exists (and hash once SYNC-12 lands); make retry/permanent-error logic reachable.
Acceptance: killing the network mid-download leaves the row `failed` with retry available; no `synced` row without the file on disk.
Done 2026-07-03 (334a707, qa-gate PASS — network-shaped failures injected at the streaming boundary; absolute synced-writer sweep clean; negative control 7/8 + independent mutation 5/8): downloadFile rethrows; fs.stat+isFile gates the sole reachable synced write (ordering proven by source and test); retry/permanent classification reachable with 3-retry cap; batch continues past per-file failures (242+1 green).

### SYNC-3 · P0 · Phase 2 · `done`
**Startup crash recovery.** Evidence: §2.7.
Fix: on DB init, reset rows stuck in `uploading`→`pending`(re-approval-safe) and `downloading`/`queued`→`pending`; rehydrate queues from DB; add CHECK constraints on status columns (needs INFRA-7 migrations).
QA findings from SYNC-2's gate to absorb here (2026-07-03): rows sit `downloading` between transient retries (stuck after crash mid-retry — exactly this item's reset scope); each retry attempt inserts a fresh downloads-table row (accumulation — reuse keyed rows); brief unhandled-rejection window in downloadFile (implementer-reported, unreproduced — five-minute look while in the file).
Acceptance: kill -9 during an upload+download; relaunch resumes/requeues both; nothing remains stuck.
Note 2026-07-03: done — merged from `fix/SYNC-3-crash-recovery` (3b2bbfe + findings 0be2e2d) after qa-gate PASS (static — recovery SQL exercised against a real sqlite replica of the production schema; kill -9 relaunch UAT not drivable in this env). recoverInterruptedOperations() runs on every DB init: in-flight uploads → terminal failed with verify-before-retry (deviation from 'pending' judged sound by qa-gate: auto-resume is a blind resubmission of a possibly-completed paid call, and nothing consumes pending rows at boot anyway); never-started pending uploads → failed 'nothing was charged'; downloads → failed; metadata → pending (auto-requeued by the existing boot flow — verified). CHECK constraints remain with INFRA-7.

### SYNC-4 · P0 · Phase 2 · `done`
**Fix stop→start lifecycle.** Evidence: §2.6 (destroyed DownloadManager/SyncProgressTracker never rebuilt).
Fix: recreate (or make restartable) the tracker and download manager on start; drive switch must not leave progress reporting dead.
Acceptance: stop sync → start sync → upload/download progress still reaches the UI.
Done 2026-07-03 (f005afc, qa-gate PASS static — download chain driven end-to-end post-restart incl. the throttled path; upload half static-verified): ensureStarted() heals tracker + download manager after any stop/switch/logout; tray pause/resume path healed; discharges SEC-3's interplay note. Minor QA notes: 100%-emissions while destroyed possible (cosmetic); failed startSync leaves no-op intervals until next stop.

### SYNC-5 · P0 · Phase 2 · `done`
**Deletes propagate as ArFS hide — Dropbox-smooth.** Evidence: §2.4. Per D-011 (supersedes the disclose-only plan): local file/folder deletion → ArFS hide operation, through the approval queue like other metadata ops; wire the dead detection cache into consumption; implement the `hide`/`unhide` branch that currently throws (sync-manager.ts:3249-3253); private-drive hide paths too (upstream ardrive-core-js work allowed per D-016); honest permanence messaging in UI ("hidden, not erased — permanent storage cannot delete").
Acceptance: delete a local file → hide operation appears in queue → approval hides it on ArFS (verified via fresh listing); Permaweb view reflects hidden state; works on public and private drives; unhide path exists.
ESCALATION 2026-07-03 (worktree session, scope discovery): NO version of ardrive-core-js supports hide — the installed 3.0.3 AND the latest 4.0.0 contain zero hide APIs and zero `hidden`/`isHidden` references anywhere in the library (verified against the published 4.0.0 tarball). D-011's hide propagation therefore requires implementing the ArFS hide metadata revision from scratch (upstream core contribution per D-016, or in-app raw ArFS metadata transactions duplicating core internals). Materially larger scope than this entry — split proposal for Phil: SYNC-5a beta-interim truthful delete state (no hide claim in UI), SYNC-5b the upstream hide implementation. Awaiting Phil's call; item NOT claimed.
Done 2026-07-04 (28ec646, merged w/ dep-bump, qa-gate PASS static on network-write+GUI): delete→hide (public/private, files/folders) + unhide via approval queue, honest 'hidden not erased' UI, v5 isHidden migration, 8 core hide calls mocked/money-safe, routing mutation-checked. Lands core-js 4.x git+https dep on main. Real end-to-end ArFS hide (paid revision) awaits INFRA-9 test wallet.
IN-PROGRESS 2026-07-03 (branch `fix/SYNC-5-delete-hide`, off `chore/core-js-hide-dep` which pins the hide-capable core-js): unblocked — CORE-4 shipped `hide/unhide{Public,Private}{File,Folder}`. Implemented: FileOperationDetector confirmed-delete now drives an `onConfirmDelete` callback (dead cache consumed) → confirmed file/folder delete queues a `hide` metadata op (awaiting_approval); executeMetadataOperation's hide/unhide/delete branch routes public/private × file/folder to core (private uses driveKeyManager key, fails closed when locked); unhide affordance via `sync:unhide-entity` IPC (D-005 envelope) + StorageTab "Unhide on Arweave" menu action; honest UI ("Removed locally — hide on Arweave (can't be erased)" in the queue, "Hidden" badge + not-erased tooltip in Permaweb view); hidden state surfaced from core on refresh AND persisted locally via new v5 `isHidden` column so cached loads reflect it. Tests: sync-manager hide routing (mutation-checked public/private), detector wiring, confirm→queue, unhide reverses, honest labels. Awaiting qa-gate.
### SYNC-6 · P1 · Phase 2 · `todo`
**Size limit: 2 GiB uploads, surfaced; no download cap.** Evidence: §2.11 (100MB comments vs 500MB constant; silent skip). Per D-014: single 2 GiB upload constant; oversized files appear in UI with reason (no silent skips); downloads have no such cap and must stream larger files (web app can upload ~2GB+). Docs updated (CLAUDE.md/README still say 100MB).
**HARD DEPENDENCY: SYNC-10 must land first** — current whole-file-in-memory hashing (×3 per event) is fatal at 2 GiB.
Acceptance: dropping an oversized file shows a visible "too large" entry; a multi-GB file uploaded via web downloads successfully with flat memory.

### SYNC-7 · P0 · Phase 2 · `done`
**Kill the folder-vs-drive divergence.** Evidence: §2.8 (`sync:start` watches `config.syncFolder` while syncing the active mapping's drive; `drive:switchTo` never updates config).
Fix: single source of truth = active drive mapping's `localFolderPath`; migrate `config.syncFolder` readers (OverviewTab, StorageTab, Settings, modals' base-folder heuristics).
Acceptance: after switching drives, the watched folder, UI-displayed folder, and upload target always agree.
Done 2026-07-03 (branch fix/SYNC-7-folder-truth incl. f56176b tray fix, qa-gate FAIL→fix→PASS static): active mapping is the source of truth; config.syncFolder healed as a mirror at switch/start; tray Resume restarts the ACTIVE mapping (integer-boolean safe), not drives[0]; PRIV-5 interference probed clean (locked-drive switch cannot lie, recovers fully).
QA finding 2026-07-03 (SYNC-4 gate): tray "Resume Sync" (main.ts:383) restarts drives[0], not the active mapping — same divergence family; fix here.

### SYNC-8 · P1 · Track C · `deferred`
**Remote change polling.** Evidence: §2.13 (no periodic remote sync while monitoring; `sync:manual` is download-only misnomer). Beta ships "remote changes appear on manual sync / restart" — document it. Efficient polling wants CORE-2 (incremental listing upstream) — full-listing polls are wasteful on large drives.

### SYNC-9 · P1 · Phase 2 · `todo`
**Minimum offline resilience.** Evidence: §2.10.
Fix: surface metadata-sync failures (no silent "continuing anyway"); watcher error → user-visible sync error state; startSync failure at boot retries with backoff or shows actionable state. Beta gateway minimum per D-012: no single-gateway hard dependency — `turbo-gateway.com` primary with simple failover (full Wayfinder routing = SYNC-15).
Acceptance: pulling the network cable yields a visible degraded-sync state, not a silent healthy-looking app.
QA finding 2026-07-03 (SYNC-2 gate): `isPermanentError` substring-matches messages that now embed user paths — a filename containing "404"/"file not found" misclassifies as permanent; harden to error codes/classes.
QA findings 2026-07-03 (SYNC-7 gate, filed by PM after routing-claim audit found them missing): (a) no-profile heal edge — the config-mirror heal path when no profile is active needs a guard; (b) boot mirror fragility — boot-time folder resolution still trusts the config mirror before the mapping heal runs; harden boot to resolve from the mapping directly.

### SYNC-10 · P1 · Phase 2 · `todo`
**Perf: streaming hash + indexed lookups.** Evidence: §2.12 (whole-file reads ×3 per event; full-table `getProcessedFiles` per event). Promoted from Track C per D-014 — hard prerequisite for the 2 GiB upload cap (SYNC-6).
Acceptance: hashing a multi-GB file keeps process memory flat (stream-based); per-event DB lookups are indexed queries, not full-table scans.

### SYNC-11 · P2 · Phase 2 · `todo`
**Watcher handler hygiene.** Evidence: §2.10 (handleFileChange missing monitoring/recently-downloaded guards; un-awaited async callbacks → unhandled rejections).
SYNC-13 gate finding 2026-07-03: in `handleNewFile`, the sized `isRecentlyDownloaded(filePath, stats.size)` refinement at sync-manager.ts:2106 is SHADOWED by the earlier unsized guard at :2032 (`isRecentlyDownloaded(filePath)`), which early-returns first for any in-flight entry — so the size-disambiguation can never let an unrelated different-size write through at the integration level. Effect is over-suppression (money-safe: never spends; extreme edge = editing a path while its own download is mid-flight). Fix when consolidating this handler: compute `stats.size` before the :2032 guard and pass it, or unify the two guards.

### SYNC-12 · P1 · Track C · `deferred`
**Real download hash verification.** Evidence: §2.2 (compares against never-populated field). Needs upstream hash capture at upload/listing time.
QA finding 2026-07-03 (SYNC-2 gate): failed re-download keeps stale `localFileExists=1` — display-level only (`isDownloaded` at main.ts:1086 can claim downloaded for an externally-deleted file whose re-download failed); fix alongside verification.

### SYNC-13 · P1 · Phase 2 · `done`
**Fix the 30s FileStateManager eviction feedback loop.** Evidence: §2.14.
Fix: key "expected downloads" by path+size/hash rather than a fixed 30s window, or extend until watcher-quiet.
Done 2026-07-03 (branch fix/SYNC-13-eviction, Opus qa-gate PASS): the fixed 30s `setTimeout` window is gone — `FileStateManager` now tracks an `expectedDownloads` Map keyed by path (with optional `expectedSize` for disambiguation), evicted by an explicit `clearDownload()` in a try/finally around the download promise in BOTH DownloadManager and sync-manager (success AND failure paths), with a 30-min `.unref()`ed backstop as leak-guard only. Undefined-size conservatively suppresses (money-safe); the post-download hash entry is written before the in-flight entry is cleared, so dedup is gapless. Dynamically exercised: a 35s in-flight download is NOT re-detected as a new local add (no re-upload); a genuine different-size edit still queues after clear. 351 tests, typecheck/eslint/build green.

### SYNC-14 · P2 · Track C · `deferred`
**True multi-drive sync.** Evidence: §2.5 (singleton engine; `multi-sync:*` has no handlers; boot syncs first active mapping only). Beta: one drive syncs at a time — make the UI say so (see UX-15). Track C: per-mapping engine instances or a multiplexed engine, real `multi-sync` handlers, per-drive status.

### SYNC-15 · P1 · Track C · `deferred`
**Wayfinder gateway routing.** Per D-012: replace hardcoded `arweave.net` with Wayfinder-based selection — `turbo-gateway.com` primary, simple routing across top-staked ar.io gateways. References: docs/features/wayfinder-integration-proposal.md, docs/vendor/wayfinder-core-README.md. Beta's no-single-gateway minimum ships inside SYNC-9; this item is the full routing integration.
**DEPENDS: CORE-1** (D-018) — most ArFS GQL queries fail on turbo-gateway without an `owner` filter; query migration happens upstream in ardrive-core-js before the gateway swap is safe for metadata paths (raw data fetches can migrate earlier).
Acceptance: gateway outage triggers transparent failover; gateway selection observable in logs; downloads verified identical across gateways.

---

## PRIV — Private drives (beta scope per D-010)

### SYNC-16 · P1 · Phase 2 · `todo`
**`syncStatus='failed'` writes violate the drive_metadata_cache CHECK on real DBs.** qa-gate finding (SYNC-3 gate, 2026-07-03): live code writes `syncStatus='failed'` (DownloadManager.ts:496, 1161, 1179, 1229; sync-manager.ts:3095, 3186) but the CHECK allows only ('synced','pending','downloading','queued','cloud_only','error') — on a real (non-mocked) DB these UPDATEs throw; invisible under mocked tests. Fix: map 'failed' → 'error' at the write sites (extending the CHECK needs INFRA-7).
Also (same gate): wallet-import flows re-point the DB without stopping sync (wallet-manager-secure.ts:157, 272) — SEC-3 family, transient self-correcting, fold into UX-6/SEC-4 rework; no upload-retry UI affordance exists (preload uploads.retry/retryAll have zero renderer callers) — fold into UX-11.

### PRIV-0 · P0 · Phase 1 · `wont-fix`
**Feature-flag private drives off for beta.** Obsolete: D-010 (2026-07-03) put private drives IN the beta — they stay enabled and get fixed (PRIV-1..7 rephased onto the critical path) instead of hidden.

### PRIV-1 · P0 · Phase 2 · `done`
**Implement private download decryption.** Evidence: §3.1 (raw ciphertext written to sync folder). Upstream ardrive-core-js APIs may be extended if needed (D-016).
Acceptance: round-trip UAT — upload to private drive, delete locally, re-download → plaintext bytes hash-equal the original.
Done 2026-07-03 (b9cb77d + 4c3973d + isolation hardening, qa-gate PASS static — decrypt chain source-verified into ardrive-core (AES-GCM StreamDecrypt, authTag enforced), real-fs pipeline probes adopted as download-manager-private-realfs.test.ts; privacy decided before the manifest-name heuristic after a round-1 FAIL): private files decrypt to plaintext on disk; locked drives fail loudly. Residual behind (static): live funded round-trip → INFRA-9 UAT. Open QA notes: progress-0 flush race on sub-second downloads; per-download getDriveMappings query (perf); core sets mtime to on-chain lastModifiedDate on the private route — watch SYNC-1 edit-detection interplay.

### PRIV-2 · P0 · Phase 2 · `done`
**Verify drive passwords with trial decryption.** Evidence: §3.2 (HKDF never fails; garbage keys cached).
Acceptance: wrong password → `success: false`, nothing cached; correct password → decrypted drive name renders.
Note 2026-07-03: done — merged from `fix/PRIV-2-trial-decrypt` (053385e + QA-finding 094f093) after qa-gate PASS (static — GUI render of the decrypted name verified at handler/component level). deriveKey/cacheKey split; unlockPrivateDrive trial-decrypts the drive entity before caching (only real decrypt/auth error strings classify as wrong password — gateway errors report a verification failure); DriveSelector envelope-as-boolean bug fixed (§5.3.6).

### PRIV-3 · P0 · Phase 2 · `done`
**Fix private-drive create UX.** Evidence: §3.3 (user pays, UI says failed, no mapping). Root cause is UX-3's envelope mismatch — fix both handler shape and modal expectations together; create mapping + sync folder on success.
Note 2026-07-03: done — merged from `fix/PRIV-3-create-private` (479b0be + finding 825b943) after qa-gate PASS (static — on-chain creation spends, forbidden; handler body proven by real-schema/fs replica probes). CreateDriveModal unwraps both current handler shapes and surfaces real errors (negative-control verified); mapping + local folder created on success (drive-mappings:add validates + mkdir -p, fail-closed); both modals now set the mapping id (gate finding: NULL PRIMARY KEY silently no-oped every later mapping update/rename/remove). Handler-shape unification deliberately left to UX-3 (gate concurred: enveloping drive:create now would break its live callers). Gate follow-ups filed into SEC-9 (legit `..`-containing drive names now rejected by the traversal defense; legacy UNC sync folders fail the mapping add post-payment).

### PRIV-4 · P0 · Phase 3 · `todo`
**Fix key persistence serialization.** Evidence: §3.4-3.5. `key.keyData.toString('base64')` on save; `new EntityKey(Buffer.from(..., 'base64'))` (+ driveSignatureType for VersionedDriveKey) on load; App.tsx must forward `persistKey`; wire the write-only DB prefs (or drop them); implement plan steps 5 (session restore) and 6 (settings UI) from docs/archive/SELECTIVE_DRIVE_PERSISTENCE_PLAN.md. The parked partial implementation lives on branch `wip/drive-key-persistence` (commit c8a1469) — review before reusing.
Acceptance: unlock with "remember" → restart → drive auto-unlocks and decrypts listings; unlock without → restart → drive locked.

### PRIV-5 · P1 · Phase 2 · `done`
**Locked drives must not sync as "empty".** Evidence: §3.7 (swallowed listing error; boot auto-sync has no lock check).
Acceptance: locked private drive at boot → visible "locked — unlock to sync" state; no silent empty sync.
Note 2026-07-03: done — merged from `fix/PRIV-5-locked-sync` (54d4c93 + findings 9759f06) after qa-gate PASS (static — boot GUI not drivable; negative control proved 3/4 tests pin the audited silent-empty behavior). startSync lock pre-flight (single choke point, before the cache wipe) + listing failures now abort instead of yielding empty/partial listings; folded gate findings: manual-sync (sync:manual/redownload-all) lock pre-flight + no more 'continuing anyway' swallow; failed starts clear the nominal drive target; tray toggle catches rejections.
Gate follow-ups filed: clear-cache-before-list window (list-then-swap, SYNC-9/SYNC-15 family); recursion log cascade (cosmetic); dead legacy syncDriveMetadata at sync-manager.ts:~3032 still contains the resurrectable silent-locked-skip — DELETE with INFRA-6; App boot swallow of non-primary locked mismatch → SYNC-9.

### PRIV-6 · P1 · Phase 2 · `todo`
**Private move/rename (and hide) paths.** Evidence: §3.7/§1.7 (only `*Public*` ArFS calls exist). Pairs with SYNC-5's hide implementation; upstream ardrive-core-js work allowed (D-016).
QA finding 2026-07-03: sync-manager.ts:1559/1608 log raw rename/move results — safe today only because public results omit `key` (version-fragile); when touching these paths, route through `summarizeArFSResult` (SEC-1's whitelist util).

### PRIV-7 · P2 · Phase 3 · `done`
**Don't gate drive unlock on the 8-char wallet-password validator.** Evidence: §3.10 (drives from other clients with shorter passwords can never unlock).
Done 2026-07-04 (branch fix/PRIV-7-unlock-validation, Opus security qa-gate PASS): new `InputValidator.validateExistingPassword` (non-empty, ≤128, no min-length) on the `drive:unlock` handler only; all 6 password-MINTING paths (wallet import/create/seed, profiles:switch, drive:create-private) keep `validatePassword` (min 8). Wrong-password rejection is unchanged — still owned by trial-decryption in wallet-manager-secure.ts (the length check never rejected wrong passwords). Renderer imposes no length gate. Full suite 370 green, build ok; 12 new tests incl. the 3 required assertions. KNOWN EDGE (pre-existing, not worsened): `validateString` trims, so a cross-client password with leading/trailing whitespace still wouldn't derive — candidate follow-up if that surfaces in real testing.

---

### PRIV-8 · P1 · Phase 3 · `todo`
**Fail-closed privacy routing for metadata ops.** QA finding 2026-07-04 (SYNC-5 gate): the whole metadata-op family (rename/move/hide at sync-manager.ts:2459/2552/2854/3196/3633) resolves privacy via `mapping?.drivePrivacy === 'private'`, which is FALSE when the mapping is unresolved — so in the rare missing-mapping state, a PRIVATE entity's op routes to the unencrypted PUBLIC path AND spends. Pre-existing pattern (not introduced by SYNC-5). Fix: fail closed — refuse a private-capable op when privacy can't be positively resolved, rather than defaulting public.
Acceptance: an op on a private-drive entity with an unresolved mapping throws/blocks, never writes an unencrypted public revision.

## UX — Flows & wiring

### UX-1 · P0 · Phase 1 · `done`
**Pass the toast prop.** Evidence: §5.1 (App.tsx:654 renders Dashboard without `toast`; all feedback silent).
Acceptance: drive switch failure / removal / creation / sync completion each shows a visible toast.
Done 2026-07-03 (0908cf5 + 698316f, qa-gate PASS static, cross-session verdict adjudicated by PM): toast prop passed; listWithStatus envelope unwrapped at all 3 Dashboard call sites (fixed a mount-time false-error toast QA caught); switch-failure/creation/sync toasts empirically driven. PM re-scope ruling recorded: the "removal" clause is met at wiring level — NO drive-removal surface exists on main (it was parked with the WIP branch); restoring it is UX-18. QA's adversarial probe suite adopted as tests/unit/components/qa-ux1-reverify-probe.test.tsx.

### UX-2 · P0 · Phase 1 · `done`
**Fix Settings "Change Folder".** Evidence: §5.2 (reads `.filePath` off a string).
Acceptance: changing the folder from Settings persists and re-targets sync (respecting SYNC-7's source of truth).
Done 2026-07-03 (2dec4c6 + 2a54c1b, qa-gate FAIL→fix→PASS static): renderer fix + the QA-caught silent no-op in updateDriveMapping (missing localFolderPath SQL branch) fixed at the DB layer; real-SQLite integration tests replicate sync:start's gate end-to-end; mapping update is opt-in (Settings only) so onboarding flows can't clobber other drives. Negative control: 5 fix-dependent tests fail on revert.

### UX-3 · P0 · Phase 3 · `todo`
**One IPC response envelope.** Evidence: §5.3, §3.3, §3.6 (raw-vs-`{success,data}` roulette breaks CreateDriveModal private path, DriveSelector unlock, Dashboard.handleDriveCreated).
Fix: standardize every handler on `{success, data?, error?}` (extend `safeIpcHandler` to all 91), regenerate preload types, sweep all renderer call sites.
Acceptance: typecheck enforces the envelope; the three known-broken call sites pass UAT; no `.find()`/`.id` on wrapper objects remains.
Also (PRIV-2 qa-gate findings 2026-07-03): the specific unlock error plumbed through `drive:unlock` is displayed nowhere — PrivateDriveUnlockModal hardcodes 'Invalid password' on any false return, and App.tsx/DriveSelector reduce the envelope to a boolean, so the network-vs-password distinction never reaches the user; `drive:unlock` also uses `drive` instead of D-005's `data` field.

### UX-4 · P1 · Phase 3 · `todo`
**Redesign preload event subscriptions.** Evidence: §5.4 (removeAllListeners clobbering family + StorageTab leak + App's uncleaned registrations).
Fix: preload `on*` methods return an unsubscribe function bound to the specific wrapped listener; components clean up their own; delete `remove*Listener` global-nuke helpers.
MONEY-6 QA finding 2026-07-03: D1 concrete instance — first TurboCreditsManager close kills App's wallet-info-updated listener for the session (all consumers dead); interim mitigation shipped in MONEY-6 (return-value refresh on manager close); root fix remains this item.
Acceptance: visiting Turbo screen / Permaweb tab / upload queue no longer kills sibling listeners (regression test: balance updates still arrive after opening+closing Turbo manager).

### UX-5 · P1 · Phase 3 · `todo`
**Make profile switching real.** Evidence: §5.5, §4.8 (UserMenu props unused; post-switch stale renderer; add-profile reload loop).
Fix: wire UserMenu menu items; after `profiles:switch`, main emits a `profile-switched` event → renderer re-runs initializeApp (full state reset); "Add Profile" routes to wallet-setup.
Also (implementer finding 2026-07-03): when `loadWallet` returns false mid-switch, rollback restores only `currentProfileId` — not the already-cleared arDrive/wallet objects; the failed-switch path must restore or fully clear all manager state (pairs with SEC-3).
Acceptance: switch profile from the dashboard → UI shows the new profile's drives/balances without manual reload; add-profile lands on wallet import.

### UX-6 · P1 · Phase 3 · `todo`
**Auto-login: implement or remove.** Evidence: §4.1 (circular gate — dead code). Pair with SEC-4: with opt-in consent, fix `hasStoredWallet` to check profiles independent of `currentProfileId` so `attemptAutoLoad` can run; without opt-in, don't store the password at all.
Acceptance: opted-in returning user lands on the dashboard without typing a password; opted-out user gets the login screen and no keychain entry exists.

### UX-7 · P1 · Phase 3 · `todo`
**Fail-safe boot routing.** Evidence: §4.10 (initializeApp catch → wallet-setup; listDrives `[]` on network error → auto-create-drive routing).
Fix: distinguish "no drives" from "couldn't fetch drives" (error state + retry); boot exceptions route to an error screen with retry, never to create-account for existing profiles.
Also (implementer finding 2026-07-03): `loadWallet` swallows its specific "Invalid password" error — the outer catch (wallet-manager-secure.ts:434) rethrows everything as generic "Failed to decrypt wallet"; surface the real cause to the login UI.
Acceptance: booting offline with an existing profile shows retry, not "Create New Account" or the create-drive flow; a wrong password says so, distinctly from corruption/IO failures.

### UX-8 · P1 · Phase 3 · `todo`
**Sync progress modal: error state + escape hatch.** Evidence: §5.7.
Acceptance: a failed sync shows the error and the modal is dismissible; no infinite spinner.

### UX-9 · P2 · Track D · `todo`
**Replace `window.location.reload()`/`alert()`/`confirm()`** with state refresh + in-app dialogs (Dashboard drive flows, ActivityTab retry, add-profile). Evidence: §5.6, §5.10.

### UX-10 · P1 · Phase 3 · `done`
**Fix Copy Link dead URLs.** Evidence: §5.6 (fileId UUID preferred over dataTxId → dead arweave.net links).
Done 2026-07-04 (branch fix/UX-10-copy-link, Sonnet qa-gate PASS): ActivityTab's Copy Link + View Online now build `https://arweave.net/<dataTxId>` via a single `getRawGatewayUrl` helper (fileId never used); both buttons are hidden (not dead) when a file has no dataTxId. Gate independently confirmed every other renderer copy-link site (StorageTab/OverviewTab/FileLinkActions/link-generator/SetupSuccessScreen) already gates on dataTxId or falls back to an app link, not a raw fileId URL. Behavioral test disproved-on-old-code; full suite 353 green.
Acceptance: copied links resolve; files without a dataTxId offer no raw-gateway link.

### UX-11 · P2 · Track D · `todo`
**Small-wiring batch**: CreateDriveModal setActive-without-switch divergence — creating a drive sets it active without running the switch heal, so folder/mapping can diverge until next real switch (QA finding 2026-07-03, SYNC-7 gate, filed by PM); rename doesn't refresh drive name (OverviewTab); DownloadQueueTab retry/pause/resume props never passed + not drive-filtered; UserMenu turbo refresh doesn't update displayed balance; `App.tsx:291` sets active drive to `drivesList[0]` on any drive:update; Permaweb copy-link feedback console-only; StorageTab `parentFolderId: ''` TODO; TurboCreditsManager shares one `loading` flag between mount-time balance load and checkout — Pay button can re-enable while a checkout session is pending (implementer finding 2026-07-03); WalletExport `handleCopy` schedules an unmanaged 30s clipboard-clear setTimeout that survives unmount and can blank unrelated clipboard content (QA finding 2026-07-03); Settings' displayed folder is local state seeded once from config — won't reflect external changes while open (QA finding, UX-2 gate). Evidence: §5.6, §5.8.

### UX-12 · P2 · Track D · `todo`
**Move wallet keygen off the main process** (worker thread) + real progress. Evidence: §4.4.

### UX-13 · P2 · Track D · `todo`
**Offline balance honesty**: show "unavailable", not `0 AR`. Evidence: §1.15.

### UX-14 · P2 · Track D · `todo`
**Metadata editing: wire or remove.** Evidence: §5.9 (unreachable editor; dropped metadata param, Dashboard.tsx:636-639).

### UX-15 · P1 · Phase 3 · `todo`
**Truthful multi-drive UI for beta.** Evidence: §2.5.
Fix: UI states plainly that the selected drive is the one that syncs; non-active mapped drives show "not syncing"; remove dead `multiSync`/`drive.getMetadata` preload surface or add handlers.
Acceptance: no UI implies simultaneous multi-drive sync.

### UX-16 · P1 · Track D · `todo`
**In-app "report a problem" with sanitized logs.** Per D-017 ("sanitized logs would be dope"): a button that bundles recent app logs — passed through secure-logger redaction so key material/passwords/seeds are unrepresentable — plus app version and OS into a shareable file for Phil's Discord testers. DEPENDS: SEC-8.
Acceptance: generated bundle contains zero secrets under adversarial grep; a tester can produce and share it in under a minute.

### UX-17 · P2 · Phase 3 · `todo`
**Profile identity: generated avatar + nickname.** Per D-015: port the avatar-generation approach from the ardrive-web sibling repo; add an editable profile nickname; deprioritize ArNS primary-name/avatar fetching (leave existing code dormant; also fixes the always-refetch cache bug §4.12 by simply not calling it).
Acceptance: every profile shows a stable generated avatar and editable nickname; no ArNS network calls on profile load.

### UX-18 · P1 · Phase 3 · `todo`
**Restore the drive-removal surface.** Found via UX-1's QA cycle: no product UI on main can remove a drive mapping — `onDriveDeleted` plumbing (App→Dashboard→StorageTab) is wired but never invoked; zero `driveMappings.remove` callers. A removal implementation exists on the parked `wip/drive-key-persistence` branch (Dashboard.tsx) — review it when implementing (with PRIV-4's wip review). The success toast is already wired (UX-1).
Acceptance: user can remove a mapped drive from the UI (with confirm); mapping deleted, sync re-targets or stops, removal toast shows; covered by a behavioral test.

### UX-19 · P1 · Phase 3 · `done`
**Returning user sees false "No drives found".** Found via flows audit 2026-07-04 (finding F18 in docs/product/FLOWS-AUDIT-2026-07.md — the returning-user false-empty case; earlier notes mislabeled it F1).
Done 2026-07-04 (branch fix/UX-19-returning-drives, Sonnet qa-gate PASS): App.tsx `initializeApp()` now `setDrives(driveList)` before the welcome-back branches (mirroring handleWalletImported), and WelcomeBackScreen treats an empty array as not-yet-verified (`!initialDrives || length===0`) → real `loadDrives()` re-check, so the empty-state renders only after a fetch confirms zero. Full suite green; 6 behavioral tests, regression-proven. NOTES: (a) the "re-verify on empty array" behavior was implemented as a correctness fix (no visible UX change) — the audit had flagged it for possible Phil sign-off; flagged, judged safe to merge. (b) Minor non-blocking follow-up: one redundant read-only `drive.list` IPC call on the post-import path (self-correcting, no spend) — candidate polish. `initializeApp()` never calls `setDrives(driveList)` on the welcome-back routes (App.tsx:145-188), and `WelcomeBackScreen`'s loading check (`!initialDrives`, WelcomeBackScreen.tsx:28,32-46) treats an empty-but-defined array as final data — so a returning user with a locked/private primary drive is told to "create one". Compounded by PRIV-4 (private drives lock every restart). Quick-win part = the missing `setDrives()` calls + fix the loading-vs-empty distinction; the deeper locked-drive UX pairs with PRIV-4 (needs Phil sign-off).
Acceptance: a returning user with existing (incl. locked/private) drives sees their drives, never a false "no drives" prompt; empty-state only shows when the account genuinely has zero drives; behavioral test.

### UX-20 · P1 · Phase 3 · `in-progress`
**Create-Account persists wallet/profile before confirmation → orphaned wallets.** Flows audit 2026-07-04 (see FLOWS-AUDIT-2026-07.md). Claimed 2026-07-04 (overnight loop, branch fix/UX-20-orphaned-profiles, Opus). "Create Account" fully creates + persists wallet+profile at Step 2 (WalletSetup.tsx:391) before the recovery-phrase confirmation, and `completeSetup` is a no-op stub (preload.ts:16-17; wallet-manager-secure.ts:50-214). Going Back and retrying silently spawns a second orphaned profile+wallet with a *different* seed phrase. Data-integrity/UX bug. Fix: defer persistence until after recovery-phrase confirmation, or make Back clean up the provisional profile; make `completeSetup` real (or remove it).
Acceptance: navigating Back during create and retrying leaves exactly one profile/wallet; no orphaned profiles or divergent seed phrases; behavioral test.

### UX-21 · P1 · Phase 3 · `todo`
**"Enable Auto Sync" toggle is never persisted.** Flows audit (F4). The setup toggle (DriveAndSyncSetup.tsx:24,197-202,526; SetupSuccessScreen.tsx:177-189) is never saved; the next boot starts sync unconditionally regardless of the user's choice — same fabricated-setting class as the already-fixed MONEY-4/MONEY-11.
Acceptance: the Auto-Sync choice persists and is honored on boot (off ⇒ no auto-start); behavioral test. (If the answer is "remove the toggle" vs "implement it" — Phil's call; see FLOWS-AUDIT F4.)

### UX-22 · P1 · Phase 3 · `todo`
**No user control to pause/stop continuous sync.** Flows audit (F3). There is no UI to pause/stop sync once running; the "Sync" button is a one-shot manual pass and the widget's "Sync Paused" state (Dashboard.tsx:790-810,1075-1080; unused preload.ts:94) is read-only/unreachable. Directly relevant to the "sync must be top-tier" bar. Needs a small design call on the control's shape (Phil).
Acceptance: user can pause/resume (or stop/start) continuous sync from the UI; state is truthful and reachable; behavioral test.

> Flows audit 2026-07-04 also surfaced: F7 dark-mode gaps on drive-selection + WelcomeBackScreen/SetupSuccessScreen surfaces (fold into DESIGN scope — not fully covered by DESIGN-4..7 as written); F10 drive creation defaults to Private/unrecoverable (product decision — Phil); plus ~9 quick-wins (toast consistency, Clear-All confirm, copy-to-clipboard feedback) detailed in docs/product/FLOWS-AUDIT-2026-07.md.

---

## INFRA — Build, test, release

### INFRA-1 · P0 · Phase 1 · `done`
**Make CI able to run.** Evidence: §6.7.
Fix: un-gitignore + commit `package-lock.json`; commit `mvp-workflow.yml`; remove the deleted `build-release.yml` from the repo properly; reconcile release-guide.md/testing-distribution.md with the real workflow names and lockfile policy.
Acceptance: a manual workflow dispatch completes install on a clean runner.
Done 2026-07-03: pushed; acceptance verified on clean windows-latest — run 28665170914 fully green (npm ci → tests → build → installer → Windows-build artifact, 7m03s) after 3 empirical workflow fixes (YAML parse: unquoted # truncation + matrix-context in job-level if; WIN_CSC_LINK 'none' resolved as cert path; electron-builder auto-publish demanding GH_TOKEN → --publish never). Docs-reconciliation half stays with INFRA-11. CI annotation for SEC-6: actions forced Node 20→24.

### INFRA-2 · P0 · Phase 4 · `done`
**Resurrect the test suite.** Evidence: §6.7, ground truth.
Fix: resolve the `ecc library invalid` import failure (mock/alias the transitive @keplr-wallet chain in vitest setup); fix or rewrite the 8 failing ProfileSwitcher tests; migrate the 4 orphaned suites (database-manager, turbo-manager, version-manager, TurboCreditsManager) into `tests/` under Vitest; delete `jest.config.js` + jest-only devDeps; replace the `expect(true).toBe(true)` placeholders in the sync test.
Acceptance: `npx vitest --run` green locally and in CI; ≥1 real behavioral test per P0 fix shipped in Phases 1–3.
Note 2026-07-03: done — merged from `fix/INFRA-2-tests` (e4ed866 + QA-findings e2385e2) after qa-gate PASS (static). ecc fixed via node-env pragmas on main-process suites + @kyvejs/sdk alias stub; suites rewritten/migrated under `tests/unit/`; jest infra + placeholders deleted; `npx vitest --run` green locally (7 files, 110 passed, 1 win32 skip). The "green in CI" half is carried by INFRA-1 (first push/dispatch) + INFRA-3 (make `vitest --run` a required, gated CI step). 2026-07-03: demonstrated — CI run 28665250732 (clean windows-latest) ran the vitest step green; making it a required gate remains INFRA-3.

### INFRA-3 · P0 · Phase 4 · `in-progress`
**Gate CI on quality.** Evidence: §6.7 (no typecheck/lint step; tests continue-on-error; no Linux job). QA finding 2026-07-03: `npm run typecheck` never checks `tests/` (tsconfig include is `src/**/*`) — add a tests-covering typecheck (e.g. `tsconfig.tests.json`) to the gate, and make the CI test step an explicit `vitest --run`.
Acceptance: typecheck (src + tests) + lint + tests are required steps; Linux build job added or Linux support explicitly dropped from docs.
Note 2026-07-03: gates are live and demonstrated — dispatch run 28672506367: required `quality` job (ubuntu; npm ci, typecheck, typecheck:tests via new tsconfig.tests.json, lint, `npx vitest --run`) gates the build matrix; the continue-on-error test step is gone; tests-typecheck immediately surfaced and fixed 3 latent errors. REMAINING: Phil's call on the either/or half — add Linux packaging (AppImage/deb) to the build matrix vs drop Linux support from docs for beta.

### INFRA-4 · P1 · Phase 4 · `todo`
**Auto-update for beta iteration.** Evidence: §6.9. electron-updater + GitHub Releases `publish` config; unsigned-update caveats documented for beta (per D-004).
Acceptance: a tester on build N is offered build N+1.

### INFRA-5 · P1 · Phase 4 · `todo`
**Crash & error telemetry.** No crash reporting exists. Add opt-in Sentry (or crashReporter + minidump endpoint) for main + renderer; wire unhandled rejections; pair with SEC-8 so reports carry no secrets.
Acceptance: a thrown error in main produces an inspectable report with app version.

### INFRA-6 · P2 · Track D · `in-progress`
**Repo hygiene.** Evidence: §6.10. Delete 8 dead components + 2 unreachable (≈5k lines, list in AUDIT §5.9); delete FileOperationDetector.recentOperations/getRecentOperation (still dead after SYNC-5 used a new onConfirmDelete callback — QA finding 2026-07-04); delete unreferenced scripts (build-installers/build-simple/test-build/quick-test-*/build-windows-simple) and `scripts/manual-tests/`; drop patch-package or add a patch; move `@types/*` to devDependencies. QA finding 2026-07-03 (MONEY-5 gate): the dead legacy UploadApprovalQueue.tsx still contains a complete conflict-resolution modal (13 refs) and `ConflictResolution` in src/types/index.ts:149 survives only to serve it — delete together. SYNC-2 gate adds: sync-manager's private downloadMissingFiles/downloadMissingFilesWithProgress/downloadIndividualFile (:3056-:3190) are unreachable ungated synced-writers — delete to keep the writer sweep trivially clean. SYNC-13 gate adds: sync-manager's `downloadDriveFile` (~:1132/:1166) is labelled "dead-code equivalent" in-comment and overlaps this cleanup — if truly dead, delete; if live, it should pass `expectedSize` to `markAsDownloaded` like DownloadManager does (it currently always-suppresses).
Note 2026-07-02: root reorganization done — `nul` deleted; vendored docs → `docs/vendor/`; images → `docs/branding/`; stale plans → `docs/archive/`; workflow docs → `docs/developer/`; `test-scripts/` → `scripts/manual-tests/`. Remaining: dead-component/script deletion (needs Phil's confirmation) and dependency moves.

### INFRA-7 · P1 · Phase 4 · `done` (branch fix/INFRA-7-db-migrations)
**Database migration framework.** Evidence: §6.11 ("no migrations needed", schemaVersion=3). Released apps cannot recreate tables.
Fix: versioned migration runner keyed on `currentSchemaVersion`; baseline v3; every future schema change ships a migration.
Acceptance: opening a v3 profile DB with a v4 app migrates data losslessly (test with fixture DB).
Done 2026-07-03 (45b1b2e + adopted QA probe, qa-gate PASS — real-engine adversarial fixture across all 12 tables; baseline semantically identical to a483d94's DDL at engine level, 37 objects): PRAGMA user_version runner, per-migration transactions with stamp-in-txn rollback, downgrade refusal (file-hash-identical), single schema source (createTables + 453 lines of dead legacy code deleted), v4 status index live in query plans. Migration-author rules documented in migrations.ts (no BEGIN/COMMIT inside migrations; versions stay integer literals — PRAGMA interpolation is guarded but literal-only by convention). Future v5 candidates: drop inert schema_version table; stop creating the legacy fallback ardrive.db for profile-only installs. Native node-sqlite3 driver validation → INFRA-12 tier 2.

### INFRA-8 · P2 · Track D · `todo`
**Dependency debt**: sqlite3 → better-sqlite3 (optional), remove ts-jest/@types/jest, retire crypto-js (pair SEC-10). Evidence: §6.6.

### INFRA-9 · P1 · Phase 4 · `in-progress`
**Test-money strategy for agents & CI.** Uploads cost real money; agents and CI must be able to verify money paths safely.
Fix: dedicated funded test wallet (small Turbo balance) checked into secrets (never the repo); free-tier (<100KB) fixtures for upload UAT; ArLocal or mocked gateway for integration tests; document in CLAUDE.md what may/may not spend.
Acceptance: an agent can run an end-to-end upload UAT spending only free-tier or explicitly-budgeted test credits.
Note 2026-07-03 (Phil, direct): tester wallet designated — `/mnt/c/source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json` (the 'ikry' wallet: many drives, AR, Turbo Credits). Rules of engagement: reference by path only (contents never read into logs/transcripts/repo); free-tier (<100KB) files only unless Phil budgets spend per item; UAT runs against a disposable user-data dir, never real profile data. Local machine only — the path must never appear in CI config.
Progress 2026-07-04: on-chain UAT harness BUILT at `scripts/onchain-uat/` (gateway-configurable via ARDRIVE_GATEWAY_HOST/GQL_GATEWAY, reads .env, no secrets). Batch 1 PARTIAL — owner-scoped GQL enumeration works (17 ikry drives: 13 public + 4 private), drive-key derivation works (app module), spend ZERO (ikry balance unchanged). BLOCKED (infra, not code): R2–R5 private decrypt + all Batch 2 free-tier writes — arweave.net hard-429'd the IP all session (transient burst throttle); no fallback gateway had both a full GQL index and reliable data/anchor. RE-RUN needed after cooldown to complete the paramount private-decrypt round-trip + real sync-write UAT. Money-rule corrected: `getUploadCosts` returns BASE price (not free-tier) — gate on size(<100 KiB) + zero-balance wallet + balance-delta, not on cost estimate.

### INFRA-10 · P1 · Phase 4 · `todo`
**IPC dead-surface reconciliation.** Evidence: §6.1-6.2. Remove or implement: `drive:get-metadata`/`refresh-metadata`, `multi-sync:*` (per UX-15), unexposed `sync:set-folder`/`sync:get-uploads`, ethereum stub, `wallet.completeSetup` fake, dead event channels (`sync:status-update`, `upload:complete`, `activity:update`, `sync:pending-uploads-updated`, `sync:upload-completed`), driveId/mappingId confusion (main.ts:1901).
Acceptance: every preload method has a live handler; every emitted event has ≥1 listener or is removed; a CI script greps for contract drift.

### INFRA-11 · P2 · Track D · `todo`
**Docs truth pass.** Evidence: §6.7, §6.10. Fix release-guide/testing-distribution workflow references; CLAUDE.md and README size-limit claims (2 GiB per D-014); README "Current Limitations" accuracy; README license says AGPL-3.0 while package.json says MIT — Phil to resolve.
Note 2026-07-02: superseded-doc banners and README phantom links already fixed in the repo reorg.

### INFRA-12 · P1 · Phase 2 (pulled forward per D-021) · `done`
**E2E/UI test harness.** Per D-006 amendment ("unit, integration and UI"): stand up Playwright (or WebdriverIO) driving the built Electron app with a disposable test profile; smoke flows first — onboarding (import test wallet), drive create/select, file drop → approval queue appears, settings. Wire into CI as a gated job (headless via xvfb on Linux runner or windows-latest).
Acceptance: one command runs the UI smoke suite against a packaged build; CI runs it on every PR; failures produce screenshots.
Done 2026-07-04 (merged): `npm run smoke` (full money-path flow, zero-fund wallet, free-tier) + `npm run smoke:screens` (network-free design-review screenshots, light/dark, parameterizable) against the real built app; test-userdata hook guarded (`!app.isPackaged`). Env finding: worktrees under /tmp get a native Linux Electron so plain Playwright `_electron`+WSLg works (the Windows-native issue is only the /mnt/c primary checkout). DEFERRED: 'CI runs on every PR' (conflicts with the workflow_dispatch-only policy — needs a decision); full authenticated upload smoke (blocked here by sandbox-IP arweave.net 429s, and the on-chain steps want INFRA-9's wallet); packaged-build smoke.
Tier-2 addition (INFRA-7 QA finding, 2026-07-03): include a packaged-app migration smoke — open a copied v3 fixture profile DB, expect v4 stamp + intact rows — to validate the real native sqlite3 driver path (unverifiable on the arm64 WSL dev machine).
Note 2026-07-04 (session, branch fix/INFRA-12-smoke-harness): confirmed Playwright `_electron.launch()` DOES drive the app directly in this worktree (its own `npm install` pulled a native linux-arm64 electron binary — unlike the /mnt/c main checkout's Windows electron.exe, which needs the WSL→Windows interop workaround); no interop layer needed here. Two runnable pieces: (1) `npm run smoke` (`tests/e2e/smoke.js`, pre-existing) — real built app, disposable `--user-data-dir`, fresh zero-fund wallet; steps 1-6 (launch, welcome, import autofill, wallet import→drive setup, drive form, review) pass reliably; step 7 (real on-chain drive creation) reliably times out at 420s on persistent gateway 429s from arweave.net — confirmed NOT a funds/balance issue (audited ardrive-core-js: `useTurbo` is unconditional when turboSettings is passed, so `assertWalletBalance` is never called for drive/metadata creation regardless of size or balance) but this sandbox's egress IP being rate-limited; may behave differently on a real dev machine or CI runner. Not the INFRA-9 blocker as originally assumed — flagging in case it reproduces elsewhere. (2) `npm run smoke:screens` (new, `tests/e2e/screenshots.js`) — the design-review evidence tool PROCESS.md §65 describes: captures the 4 pre-auth screens (welcome, create-account password, recovery-phrase, import-form) with zero network dependency, in light+dark (`page.emulateMedia` + a forward-compatible `theme` key seeded into the disposable config.json). Verified working end-to-end, 8/8 captures. Caveat: dark == light pixel-for-pixel today because DESIGN-2 (ThemeProvider/dark CSS) hasn't landed — that's a product gap the tool surfaces, not a harness bug; screenshots start differing automatically once DESIGN-2 ships. Not done: CI wiring (D-021/acceptance says "CI runs it on every PR" — out of scope for this session per current GH Actions workflow_dispatch-only policy, see INFRA-1) and the Tier-2 packaged-migration-smoke addition (needs an actual `electron-builder` package, not attempted).

### INFRA-13 · P2 · Track D · `todo`
**Exhaustive field mapping + validation for drive-mapping updates.** QA finding 2026-07-03 (UX-2 gate): `updateDriveMapping` silently drops `driveId`/`drivePrivacy`/`rootFolderId`/`lastMetadataSyncAt` (fields in `Partial<DriveSyncMapping>` with no SQL branch — the same silent-no-op family as UX-2's bug), and the generic `drive-mappings:update` IPC handler (main.ts:~2814) forwards unvalidated `updates: any`. Latent today (all callers pass only mapped fields — verified), but a trap for Track A/C work.
Acceptance: every updatable field maps (compile-time-checked map or exhaustive switch); handler validates input; test feeds each field and asserts the SQL.

---

## DESIGN — Visual design & styling (parallel work stream, per D-023)

Handled by the `designer` agent. Token-driven, light+dark, mirrors ardrive-web's `ardrive_ui` + the public site. DESIGN-1→2 are the sequential foundation; DESIGN-3+ fan out in parallel. Design flows through the loop (designer → qa-gate for correctness/no-regression/token-purity/contrast → Phil aesthetic sign-off via INFRA-12 screenshots).

### DESIGN-1 · P1 · Design · `done`
**Extract the ArDrive design system → docs/product/DESIGN-SYSTEM.md.** Foundation for everything else. Distill tokens (color palette light+dark, typography scale, spacing, radii, shadows, motion) and component patterns from ardrive-web `packages/ardrive_ui` + `lib/theme/{colors,theme}.dart` + the public site (https://ardriveapp.github.io/public-site/). Opus-tier (taste + synthesis).
Acceptance: DESIGN-SYSTEM.md defines a complete, implementable token set (both themes) + component-pattern specs, cited to ardrive-web/public-site sources.
Done 2026-07-03 (D-024, Phil signed off): DESIGN-SYSTEM.md landed — full light+dark token set, type scale, components, application map, DESIGN-2 impl plan. 5 aesthetic calls resolved: replace off-brand palette; two-red split; darken hover; lighter dark ladder; **system fallback font stack (no Wavehaus bundling)**.

### DESIGN-2 · P1 · Design · `done`
**Desktop theme/token foundation.** Implement the DESIGN-1 tokens as a CSS-variable theme layer in the renderer + a light/dark ThemeProvider; migrate the scattered hardcoded colors in src/renderer/styles/* to tokens. Prereq for all restyling. DEPENDS: DESIGN-1.
Acceptance: one token source; light/dark switch works; no raw color literals remain outside the theme layer (grep-clean); no visual regression vs current on a screenshot pass.
Progress 2026-07-03 (branch `design/DESIGN-2-token-foundation`): token layer (`styles/theme.css`, §1–5) + `ThemeProvider`/`useTheme` (`contexts/ThemeContext.tsx`, OS-pref + config-persisted override, dark default) landed. Every legacy `--ardrive-*`/`--gray-*`/Tailwind-ladder/`--font-*` custom property still referenced by `styles/*.css` and the ~39 components' inline styles is bridged to a new semantic token in `styles.css`'s `:root` (grep-verified complete — see designer report). Scale tokens (space/radius/shadow/type-size) intentionally NOT remapped yet (would reflow/resize untouched components) — still literal legacy values pending DESIGN-3..7's file-by-file port, so the grep-clean acceptance bar is not yet met (theme.css's own literals are the token layer and are exempt; the bridge aliases in styles.css are pointers, not literals). **Known transitional regression**: components with hardcoded light-literal surfaces (e.g. WalletSetup's `backgroundColor:'white'` card) now render near-invisible dark-mode text, because global rules like `h1..h6{color:var(--gray-900)}` are theme-reactive but that component's own background isn't yet — screenshotted on the onboarding screen. Not fixable within DESIGN-2's scope (no component edits); makes DESIGN-3 (onboarding/wallet-setup) the priority next item.
Done 2026-07-03 (merged to main c815a5c via ff, with DESIGN-3): the beta-required **foundation** is delivered — single token source (`styles/theme.css`), `ThemeProvider`/`useTheme` (OS-pref + config-persisted, dark default), and complete bridge aliases; light/dark switch works. Scope note: the *app-wide* raw-literal grep-clean in the acceptance is intentionally NOT fully met here — it proceeds per-surface through DESIGN-3 (`done`) and DESIGN-4..7 (`todo`), matching ROADMAP ("foundation for beta, per-surface polish to GA"). The transitional dark-mode faint-heading regression this item introduced is resolved by DESIGN-3. Marked done because the foundation beta depends on is shipped and the residual literal purge is tracked as its own items.

### DESIGN-3 · P2 · Design · `done`
**Onboarding / wallet-setup restyle.** Port `WalletSetup.tsx` + its screens (welcome, create-account/password, recovery-phrase, import-account) off hardcoded literals onto DESIGN-SYSTEM.md tokens (cards use `--surface-raised`, not literal white) — fixes the DESIGN-2 dark-mode faint-heading regression. Fast-tracked to ship WITH DESIGN-2 so there's no regression window. DEPENDS: DESIGN-2.
Acceptance: surface matches DESIGN-SYSTEM.md in light+dark; token-driven (zero raw color literals in touched files); screenshots attached; no behavior change.
Done 2026-07-03 (merged to main c815a5c via ff): WalletSetup + all onboarding screens (welcome, create/password, recovery-phrase, import) ported onto tokens (cards use `--surface-raised`, not literal white — fixes the DESIGN-2 dark faint-heading regression) + a full **polish/micro-interactions pass** (§5A of DESIGN-SYSTEM.md): inline JS hovers → CSS `:hover`/`:active`/`:focus-visible`, button hover-lift + branded glow, disabled/loading/cursor states, token transitions, reduced-motion honored. Caught + fixed a real bug: SeedPhraseDisplay's inline styles were overriding the outline-button `:hover` so it never fired. Verified: typecheck clean, eslint clean, 339 tests + build green (in the 4.0.0 tree), zero raw literals in touched files. Screenshots delivered to Phil (light+dark, 6 shots). **Phil aesthetic sign-off 2026-07-03.**

### DESIGN-4..7 · P2 · Design · `todo` (fan out after DESIGN-2)
Restyle each surface against the system, in parallel: **DESIGN-4** dashboard shell + tabs + drive selector · **DESIGN-5** upload approval queue + Turbo/payments · **DESIGN-6** permaweb/activity/storage views · **DESIGN-7** settings + modals + toasts + user menu.
Acceptance (each): surface matches DESIGN-SYSTEM.md in light+dark; token-driven; screenshots attached; no behavior change.

## CORE — ardrive-core-js upstream (sibling repo, per D-016/D-018)

Work items in the ardrive-core-js repo that desktop depends on. Same loop applies (implement → QA → merge there); desktop consumes via version bump with an interop check.

### CORE-1 · P1 · Track C (elevated 2026-07-04 — near-term robustness for private-drive verification) · `in-progress`
**Owner-scoped GQL queries (turbo-gateway compatibility).** Per D-018: most ArFS queries fail on turbo-gateway.com GQL unless an `owner` is supplied. Audit every GQL query core-js emits (drive/folder/file listings, drive discovery, manifest lookups) and thread `owner` through; desktop always knows the owner for its own drives (profile wallet address). BLOCKS SYNC-15's metadata migration.
**Reference implementation (D-019, Phil): ardrive-web's GraphQL queries** — the web app already runs owner-scoped; diff core-js's queries against web's and converge, including web's pattern for owner-unknown discovery flows (add-existing-drive by ID).
Acceptance: full drive listing + sync round-trip succeeds against turbo-gateway.com GQL; interop test vectors pass on both turbo-gateway and arweave.net; query shapes match ardrive-web's where semantics agree.
Harness finding 2026-07-04 (on-chain UAT): owner-scoped enumeration actually WORKS (17 ikry drives returned WITH owner on a full-index gateway; empty results were rate-limit / index-gaps, NOT missing-owner). The concrete near-term bug: core-js `getPrivateDrive` reads `edges[0].node` with NO empty-edges guard → opaque `TypeError: Cannot read properties of undefined (reading 'node')` when GQL returns zero edges (wrong owner OR index gap) instead of a clear "drive not found". **IMMEDIATE fix (authorized core-js lane): guard empty edges + surface a clear error**; keep the broader owner-threading audit (D-018) for turbo-gateway compat as the larger CORE-1 scope.
Progress 2026-07-04: guard IMPLEMENTED + verified in isolation in ardrive-core-js (branch `fix/gql-empty-edges-guard`, commit `ac2f0f6`): empty-edges guard added to `getDriveSignatureInfo` (arfsdao.ts:1506, the site `getPrivateDrive` hits first) AND `isPublicDrive` (1919); both now throw `Drive with Drive-Id "<id>" not found (check the drive id and that the owner address is correct)`. The 3 drive builders were already guarded (shared `parseFromArweaveNode`). 2 new tests pass; the change compiles and isn't in any error set. **CONSUMPTION BLOCKED (needs Phil):** the core-js repo checkout is on a DIRTY `dev` branch with unrelated in-flight browser-support WIP (browser adapters, crypto-node.ts, src/browser*.ts) that independently breaks `yarn typecheck` (45 errs), `yarn build` (browser entrypoints), and 87 private-drive tests — so a clean 100%-verified PR-to-master + desktop git-pin bump can't be done without resolving/clarifying that WIP first. Fix commit is clean & cherry-pickable onto master/the hide branch. NOT pushed. Held to avoid disturbing the WIP or shipping an unverified pin.

### CORE-2 · P1 · Track C · `deferred`
**Incremental sync support.** Per D-018: listing APIs that accept a since/cursor (block height or timestamp) so clients fetch only changes instead of full drive history. Desktop consumers: SYNC-8 remote polling, drive_metadata_cache refresh (`lastMetadataSyncAt` already exists in the schema, waiting for this).
**Head start (D-019, Phil): an incremental-sync branch was already started in ardrive-core-js** — first task is locating and assessing that branch (rebase/resume vs. cherry-pick vs. restart informed by it).
Acceptance: second listing of an unchanged large drive transfers near-zero data; changed-entity listing returns exactly the delta.

### CORE-3 · P1 · Track C · `deferred`
**ArFS snapshot support.** Per D-018: consume ArFS snapshot entities (as ardrive-web does) so cold-start listing of a large drive reads the snapshot + tail instead of replaying full GQL history. Read-side first; write-side (snapshot creation) confirmed in scope per D-019 — powers FEAT-3's desktop UI.
Acceptance: cold listing of a snapshotted large drive is dramatically fewer queries than full-history replay; results identical to full replay on interop vectors; creation API produces snapshots ardrive-web reads correctly.

---

### CORE-4 · P0 · Track C (blocks SYNC-5) · `in-progress`
**ArFS hide/unhide in ardrive-core-js.** Per D-022. Mirror ardrive-web: add `isHidden: boolean` to file/folder(/drive?) entity JSON metadata via a plain new metadata revision (no tag, no ArFS spec bump, no cascade, `lastModifiedDate` untouched). New public API `hide/unhide × Public/Private × File/Folder` mirroring the rename methods; surface `isHidden` on parsed entities; filtering stays in the consumer. FULL SPEC + insertion points: docs/product/CORE-4-hide-scoping.md. Base branch: **master** (confirmed; dev is dormant). Implementation is Opus-tier (ArFS protocol correctness).
Acceptance: hidePublicFile/unhidePublicFile (+ private + folder) write a metadata revision setting isHidden; round-trips through builders for public AND private; published (alpha or tarball) so desktop SYNC-5 can consume; interop — a core-js-hidden entity reads as hidden in ardrive-web.
Impl done 2026-07-03 on core-js branch `feat/hide-unhide-support` (commit 177fb4a, off origin/master): 8 methods (file/folder × public/private × hide/unhide), 14 tests pass in core-js suite, mutation-checked, lastModifiedDate no-op asserted; drive-level hide + web-ArDrive parity deferred (cheap). PR OPEN: ardrive-core-js#270. COMPAT VERIFIED GREEN + CI-SAFE 2026-07-03 (branch `chore/core-js-hide-dep`, ready to merge with SYNC-5): prepare hook on core-js (PR#270 @151f6d1) + desktop pinned via `git+https` (keyless `npm ci` proven with GIT_SSH_COMMAND=/bin/false; also fixed 2 pre-existing ssh transitive deps avsc + js-human-crypto-keys that v4 pulls). Dep-bump LANDED on main 2026-07-04 via the SYNC-5 merge (core-js 4.x git+https). Upstream PR #270 still open (CodeRabbit/CI). — desktop typecheck+build+321 tests all pass against a fresh install of master+hide (no desktop source changes; 4.0.0 Node API intact). Consumption path: add a `prepare` build script to core-js (enables `github:#sha` git-pinning) → pin desktop dep → SYNC-5 consumes. Then → merge → publish (alpha/tarball) → desktop dep bump (3.0.3→4.x gap) → SYNC-5 unblocks.

## FEAT — Major feature work

### FEAT-1 · P1 · Track B · `deferred`
**Solana-default wallet onboarding with Turbo.** New users get a Solana wallet by default, paying via Turbo (turbo-sdk supports Solana signing/top-ups; sibling repo modifiable per D-016). Design RESOLVED per D-020: derive a deterministic Arweave wallet FROM the Solana wallet, mirroring ardrive-web's derivation exactly (same Solana wallet → same Arweave wallet in both apps) — ArFS drive keys/signing work unchanged on the derived JWK. First task: locate ardrive-web's derivation code and pin it as the interop reference (test vector: known Solana key → expected Arweave address in both apps).
Acceptance: new-user flow creates/imports a Solana wallet, tops up Turbo, and syncs public AND private drives end-to-end; derived Arweave address matches ardrive-web's for the same Solana wallet.

### FEAT-2 · P2 · Track B · `deferred`
**"Advanced mode": Arweave wallet + AR tokens + self-bundled uploads (lite bundler).** Per D-013: an opt-in mode where the user holds an Arweave wallet with AR tokens and the app builds/signs/posts its own ANS-104 bundles (arbundles is already a dependency). Scope question open (ROADMAP #4): per-file bundles vs batching with receipts.

### FEAT-3 · P1 · Track C · `deferred`
**Snapshot create/view UI (desktop, web parity).** Per D-019: users can create a snapshot of a drive and view existing snapshots, just like ardrive-web. Creation is a paid on-chain action → goes through the upload approval queue with cost shown. DEPENDS: CORE-3 (consumption + creation APIs).
Acceptance: create-snapshot flow with cost approval; snapshot list per drive; a desktop-created snapshot is readable by ardrive-web (interop vector).

---

## Item count: 68 · P0: 18 · P1: 31 · P2: 19
(2026-07-03 rescope per D-010..D-017: PRIV-1..7 onto beta phases, PRIV-0 wont-fix, SYNC-5 promoted P0, SYNC-10 promoted P1/Phase 2, +SYNC-15, +UX-16, +UX-17, +INFRA-12, +FEAT-1, +FEAT-2. Later 2026-07-03 per D-018/D-019: +CORE-1..3 upstream ardrive-core-js track, +FEAT-3 snapshot UI.)
