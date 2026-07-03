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

### SEC-5 · P1 · Phase 3 · `todo`
**Stop writing the decrypted JWK to a temp file.** Evidence: §4.3 (3 sites).
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

### MONEY-2 · P0 · Phase 2 · `in-progress`
**Make cancel abort and retry safe.** Evidence: §1.2.
Fix: AbortController through UploadQueueManager → uploadFile; `uploads:cancel` aborts in-flight work before marking failed; `uploads:retry` refuses items not in a terminal state; completion handler must not resurrect cancelled records.
Acceptance: cancel during upload halts network activity and the file is not charged; retry of an in-flight upload is rejected; no path yields two charges for one file.

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

### MONEY-6 · P1 · Phase 2 · `todo`
**Fix approval-queue semantics.** Evidence: §1.5.
Fix: "Approve & Upload" calls approve-all once (no per-file follow-up loop that bypasses balance checks); consistent balance gating between single and batch paths. (Dead radio already removed by MONEY-1.)
Re-homed from MONEY-1 (2026-07-03, need sync-manager.ts access): :3392 synthetic `estimatedTurboCost: 0.000001` for metadata ops — store honest value; :1973 `|| undefined` zero-quote coercion. Plus staleness: top-up affordance doesn't refresh row quotes — blocked rows stay blocked until re-quote despite live main-side check.
Acceptance: one approval action → one approval per file; skipped-for-balance files stay skipped with a visible reason.

### MONEY-7 · P1 · Phase 3 · `todo`
**Harden the payment window.** Evidence: §1.8.
Fix: pin allowed hosts for `payment:open-window`; success detection via `will-redirect`/`did-navigate` against the exact success URL; `closed` handler emits a cancel event; `sandbox: true` + `setWindowOpenHandler`; remove dead focus-refresh (main.ts:244-266).
Acceptance: only the checkout host can open; completing or closing the window always yields exactly one accurate event; balance refreshes on completion.

### MONEY-8 · P2 · Track D · `todo`
**AR→Credits conversion UX honesty + input bounds.** Evidence: §1.14 (instant "success" vs 5-15 min reality; validateTurboAmount 1e-12..1e6 shared USD/AR).

### MONEY-9 · P1 · Phase 2 · `todo`
**Serialize the upload queue properly.** Evidence: §1.9.
Fix: reentrancy guard (or work-loop) in UploadQueueManager with a configurable concurrency (default 1–2); mutex folder creation to kill the duplicate-paid-folder race.
Acceptance: concurrent uploads bounded; two files in one new folder create exactly one folder entity.

### MONEY-10 · P1 · Phase 2 · `todo`
**Re-validate file at upload time.** Evidence: §1.10.
Fix: re-stat before wrap; if size changed beyond tolerance since approval, return to `awaiting_approval` with a note.
Acceptance: a file grown after approval is not uploaded at the larger size without re-approval.


### MONEY-11 · P2 · Track D · `todo`
**Usage Statistics shows fabricated zeros.** Implementer finding 2026-07-03 (during MONEY-4): the Turbo Settings tab's surviving "Usage Statistics" section renders hardcoded 0 files / 0 AR / 0 GB — same fabricated-data class as the removed Auto Top-Up. Wire to real per-profile stats (uploads table aggregates) or remove the panel.
Acceptance: every figure in Usage Statistics derives from real data, or the panel is gone.
---

## SYNC — Sync engine correctness

### SYNC-1 · P0 · Phase 2 · `todo`
**Edited files must re-upload.** Evidence: §2.1 (path-match dedup bails before the update path; detectFileChange's 'update' result dead-ends).
Fix: on hash-differs-for-known-path, route to the new-version upload path (ArFS new file revision) via the approval queue.
Acceptance: UAT — edit a synced file locally → new pending upload appears → approval uploads a new revision visible in the Permaweb view.

### SYNC-2 · P0 · Phase 2 · `todo`
**Failed downloads must be recorded as failed.** Evidence: §2.2.
Fix: rethrow from `downloadFile`'s catch (or return a result the caller honors); only mark `synced` after verifying the file exists (and hash once SYNC-12 lands); make retry/permanent-error logic reachable.
Acceptance: killing the network mid-download leaves the row `failed` with retry available; no `synced` row without the file on disk.

### SYNC-3 · P0 · Phase 2 · `todo`
**Startup crash recovery.** Evidence: §2.7.
Fix: on DB init, reset rows stuck in `uploading`→`pending`(re-approval-safe) and `downloading`/`queued`→`pending`; rehydrate queues from DB; add CHECK constraints on status columns (needs INFRA-7 migrations).
Acceptance: kill -9 during an upload+download; relaunch resumes/requeues both; nothing remains stuck.

### SYNC-4 · P0 · Phase 2 · `done`
**Fix stop→start lifecycle.** Evidence: §2.6 (destroyed DownloadManager/SyncProgressTracker never rebuilt).
Fix: recreate (or make restartable) the tracker and download manager on start; drive switch must not leave progress reporting dead.
Acceptance: stop sync → start sync → upload/download progress still reaches the UI.
Done 2026-07-03 (f005afc, qa-gate PASS static — download chain driven end-to-end post-restart incl. the throttled path; upload half static-verified): ensureStarted() heals tracker + download manager after any stop/switch/logout; tray pause/resume path healed; discharges SEC-3's interplay note. Minor QA notes: 100%-emissions while destroyed possible (cosmetic); failed startSync leaves no-op intervals until next stop.

### SYNC-5 · P0 · Phase 2 · `todo`
**Deletes propagate as ArFS hide — Dropbox-smooth.** Evidence: §2.4. Per D-011 (supersedes the disclose-only plan): local file/folder deletion → ArFS hide operation, through the approval queue like other metadata ops; wire the dead detection cache into consumption; implement the `hide`/`unhide` branch that currently throws (sync-manager.ts:3249-3253); private-drive hide paths too (upstream ardrive-core-js work allowed per D-016); honest permanence messaging in UI ("hidden, not erased — permanent storage cannot delete").
Acceptance: delete a local file → hide operation appears in queue → approval hides it on ArFS (verified via fresh listing); Permaweb view reflects hidden state; works on public and private drives; unhide path exists.

### SYNC-6 · P1 · Phase 2 · `todo`
**Size limit: 2 GiB uploads, surfaced; no download cap.** Evidence: §2.11 (100MB comments vs 500MB constant; silent skip). Per D-014: single 2 GiB upload constant; oversized files appear in UI with reason (no silent skips); downloads have no such cap and must stream larger files (web app can upload ~2GB+). Docs updated (CLAUDE.md/README still say 100MB).
**HARD DEPENDENCY: SYNC-10 must land first** — current whole-file-in-memory hashing (×3 per event) is fatal at 2 GiB.
Acceptance: dropping an oversized file shows a visible "too large" entry; a multi-GB file uploaded via web downloads successfully with flat memory.

### SYNC-7 · P0 · Phase 2 · `todo`
**Kill the folder-vs-drive divergence.** Evidence: §2.8 (`sync:start` watches `config.syncFolder` while syncing the active mapping's drive; `drive:switchTo` never updates config).
Fix: single source of truth = active drive mapping's `localFolderPath`; migrate `config.syncFolder` readers (OverviewTab, StorageTab, Settings, modals' base-folder heuristics).
Acceptance: after switching drives, the watched folder, UI-displayed folder, and upload target always agree.
QA finding 2026-07-03 (SYNC-4 gate): tray "Resume Sync" (main.ts:383) restarts drives[0], not the active mapping — same divergence family; fix here.

### SYNC-8 · P1 · Track C · `deferred`
**Remote change polling.** Evidence: §2.13 (no periodic remote sync while monitoring; `sync:manual` is download-only misnomer). Beta ships "remote changes appear on manual sync / restart" — document it. Efficient polling wants CORE-2 (incremental listing upstream) — full-listing polls are wasteful on large drives.

### SYNC-9 · P1 · Phase 2 · `todo`
**Minimum offline resilience.** Evidence: §2.10.
Fix: surface metadata-sync failures (no silent "continuing anyway"); watcher error → user-visible sync error state; startSync failure at boot retries with backoff or shows actionable state. Beta gateway minimum per D-012: no single-gateway hard dependency — `turbo-gateway.com` primary with simple failover (full Wayfinder routing = SYNC-15).
Acceptance: pulling the network cable yields a visible degraded-sync state, not a silent healthy-looking app.

### SYNC-10 · P1 · Phase 2 · `todo`
**Perf: streaming hash + indexed lookups.** Evidence: §2.12 (whole-file reads ×3 per event; full-table `getProcessedFiles` per event). Promoted from Track C per D-014 — hard prerequisite for the 2 GiB upload cap (SYNC-6).
Acceptance: hashing a multi-GB file keeps process memory flat (stream-based); per-event DB lookups are indexed queries, not full-table scans.

### SYNC-11 · P2 · Phase 2 · `todo`
**Watcher handler hygiene.** Evidence: §2.10 (handleFileChange missing monitoring/recently-downloaded guards; un-awaited async callbacks → unhandled rejections).

### SYNC-12 · P1 · Track C · `deferred`
**Real download hash verification.** Evidence: §2.2 (compares against never-populated field). Needs upstream hash capture at upload/listing time.

### SYNC-13 · P1 · Phase 2 · `todo`
**Fix the 30s FileStateManager eviction feedback loop.** Evidence: §2.14.
Fix: key "expected downloads" by path+size/hash rather than a fixed 30s window, or extend until watcher-quiet.

### SYNC-14 · P2 · Track C · `deferred`
**True multi-drive sync.** Evidence: §2.5 (singleton engine; `multi-sync:*` has no handlers; boot syncs first active mapping only). Beta: one drive syncs at a time — make the UI say so (see UX-15). Track C: per-mapping engine instances or a multiplexed engine, real `multi-sync` handlers, per-drive status.

### SYNC-15 · P1 · Track C · `deferred`
**Wayfinder gateway routing.** Per D-012: replace hardcoded `arweave.net` with Wayfinder-based selection — `turbo-gateway.com` primary, simple routing across top-staked ar.io gateways. References: docs/features/wayfinder-integration-proposal.md, docs/vendor/wayfinder-core-README.md. Beta's no-single-gateway minimum ships inside SYNC-9; this item is the full routing integration.
**DEPENDS: CORE-1** (D-018) — most ArFS GQL queries fail on turbo-gateway without an `owner` filter; query migration happens upstream in ardrive-core-js before the gateway swap is safe for metadata paths (raw data fetches can migrate earlier).
Acceptance: gateway outage triggers transparent failover; gateway selection observable in logs; downloads verified identical across gateways.

---

## PRIV — Private drives (beta scope per D-010)

### PRIV-0 · P0 · Phase 1 · `wont-fix`
**Feature-flag private drives off for beta.** Obsolete: D-010 (2026-07-03) put private drives IN the beta — they stay enabled and get fixed (PRIV-1..7 rephased onto the critical path) instead of hidden.

### PRIV-1 · P0 · Phase 2 · `todo`
**Implement private download decryption.** Evidence: §3.1 (raw ciphertext written to sync folder). Upstream ardrive-core-js APIs may be extended if needed (D-016).
Acceptance: round-trip UAT — upload to private drive, delete locally, re-download → plaintext bytes hash-equal the original.

### PRIV-2 · P0 · Phase 2 · `done`
**Verify drive passwords with trial decryption.** Evidence: §3.2 (HKDF never fails; garbage keys cached).
Acceptance: wrong password → `success: false`, nothing cached; correct password → decrypted drive name renders.
Note 2026-07-03: done — merged from `fix/PRIV-2-trial-decrypt` (053385e + QA-finding 094f093) after qa-gate PASS (static — GUI render of the decrypted name verified at handler/component level). deriveKey/cacheKey split; unlockPrivateDrive trial-decrypts the drive entity before caching (only real decrypt/auth error strings classify as wrong password — gateway errors report a verification failure); DriveSelector envelope-as-boolean bug fixed (§5.3.6).

### PRIV-3 · P0 · Phase 2 · `todo`
**Fix private-drive create UX.** Evidence: §3.3 (user pays, UI says failed, no mapping). Root cause is UX-3's envelope mismatch — fix both handler shape and modal expectations together; create mapping + sync folder on success.

### PRIV-4 · P0 · Phase 3 · `todo`
**Fix key persistence serialization.** Evidence: §3.4-3.5. `key.keyData.toString('base64')` on save; `new EntityKey(Buffer.from(..., 'base64'))` (+ driveSignatureType for VersionedDriveKey) on load; App.tsx must forward `persistKey`; wire the write-only DB prefs (or drop them); implement plan steps 5 (session restore) and 6 (settings UI) from docs/archive/SELECTIVE_DRIVE_PERSISTENCE_PLAN.md. The parked partial implementation lives on branch `wip/drive-key-persistence` (commit c8a1469) — review before reusing.
Acceptance: unlock with "remember" → restart → drive auto-unlocks and decrypts listings; unlock without → restart → drive locked.

### PRIV-5 · P1 · Phase 2 · `todo`
**Locked drives must not sync as "empty".** Evidence: §3.7 (swallowed listing error; boot auto-sync has no lock check).
Acceptance: locked private drive at boot → visible "locked — unlock to sync" state; no silent empty sync.

### PRIV-6 · P1 · Phase 2 · `todo`
**Private move/rename (and hide) paths.** Evidence: §3.7/§1.7 (only `*Public*` ArFS calls exist). Pairs with SYNC-5's hide implementation; upstream ardrive-core-js work allowed (D-016).
QA finding 2026-07-03: sync-manager.ts:1559/1608 log raw rename/move results — safe today only because public results omit `key` (version-fragile); when touching these paths, route through `summarizeArFSResult` (SEC-1's whitelist util).

### PRIV-7 · P2 · Phase 3 · `todo`
**Don't gate drive unlock on the 8-char wallet-password validator.** Evidence: §3.10 (drives from other clients with shorter passwords can never unlock).

---

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

### UX-10 · P1 · Phase 3 · `todo`
**Fix Copy Link dead URLs.** Evidence: §5.6 (fileId UUID preferred over dataTxId → dead arweave.net links).
Acceptance: copied links resolve; files without a dataTxId offer no raw-gateway link.

### UX-11 · P2 · Track D · `todo`
**Small-wiring batch**: rename doesn't refresh drive name (OverviewTab); DownloadQueueTab retry/pause/resume props never passed + not drive-filtered; UserMenu turbo refresh doesn't update displayed balance; `App.tsx:291` sets active drive to `drivesList[0]` on any drive:update; Permaweb copy-link feedback console-only; StorageTab `parentFolderId: ''` TODO; TurboCreditsManager shares one `loading` flag between mount-time balance load and checkout — Pay button can re-enable while a checkout session is pending (implementer finding 2026-07-03); WalletExport `handleCopy` schedules an unmanaged 30s clipboard-clear setTimeout that survives unmount and can blank unrelated clipboard content (QA finding 2026-07-03); Settings' displayed folder is local state seeded once from config — won't reflect external changes while open (QA finding, UX-2 gate). Evidence: §5.6, §5.8.

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

---

## INFRA — Build, test, release

### INFRA-1 · P0 · Phase 1 · `in-progress`
**Make CI able to run.** Evidence: §6.7.
Fix: un-gitignore + commit `package-lock.json`; commit `mvp-workflow.yml`; remove the deleted `build-release.yml` from the repo properly; reconcile release-guide.md/testing-distribution.md with the real workflow names and lockfile policy.
Acceptance: a manual workflow dispatch completes install on a clean runner.
Note 2026-07-02: lockfile + workflow committed locally (commit 6299771). Remaining: push, run a dispatch to verify acceptance, and the docs-reconciliation half (with INFRA-11).

### INFRA-2 · P0 · Phase 4 · `done`
**Resurrect the test suite.** Evidence: §6.7, ground truth.
Fix: resolve the `ecc library invalid` import failure (mock/alias the transitive @keplr-wallet chain in vitest setup); fix or rewrite the 8 failing ProfileSwitcher tests; migrate the 4 orphaned suites (database-manager, turbo-manager, version-manager, TurboCreditsManager) into `tests/` under Vitest; delete `jest.config.js` + jest-only devDeps; replace the `expect(true).toBe(true)` placeholders in the sync test.
Acceptance: `npx vitest --run` green locally and in CI; ≥1 real behavioral test per P0 fix shipped in Phases 1–3.
Note 2026-07-03: done — merged from `fix/INFRA-2-tests` (e4ed866 + QA-findings e2385e2) after qa-gate PASS (static). ecc fixed via node-env pragmas on main-process suites + @kyvejs/sdk alias stub; suites rewritten/migrated under `tests/unit/`; jest infra + placeholders deleted; `npx vitest --run` green locally (7 files, 110 passed, 1 win32 skip). The "green in CI" half is carried by INFRA-1 (first push/dispatch) + INFRA-3 (make `vitest --run` a required, gated CI step).

### INFRA-3 · P0 · Phase 4 · `todo`
**Gate CI on quality.** Evidence: §6.7 (no typecheck/lint step; tests continue-on-error; no Linux job). QA finding 2026-07-03: `npm run typecheck` never checks `tests/` (tsconfig include is `src/**/*`) — add a tests-covering typecheck (e.g. `tsconfig.tests.json`) to the gate, and make the CI test step an explicit `vitest --run`.
Acceptance: typecheck (src + tests) + lint + tests are required steps; Linux build job added or Linux support explicitly dropped from docs.

### INFRA-4 · P1 · Phase 4 · `todo`
**Auto-update for beta iteration.** Evidence: §6.9. electron-updater + GitHub Releases `publish` config; unsigned-update caveats documented for beta (per D-004).
Acceptance: a tester on build N is offered build N+1.

### INFRA-5 · P1 · Phase 4 · `todo`
**Crash & error telemetry.** No crash reporting exists. Add opt-in Sentry (or crashReporter + minidump endpoint) for main + renderer; wire unhandled rejections; pair with SEC-8 so reports carry no secrets.
Acceptance: a thrown error in main produces an inspectable report with app version.

### INFRA-6 · P2 · Track D · `in-progress`
**Repo hygiene.** Evidence: §6.10. Delete 8 dead components + 2 unreachable (≈5k lines, list in AUDIT §5.9); delete unreferenced scripts (build-installers/build-simple/test-build/quick-test-*/build-windows-simple) and `scripts/manual-tests/`; drop patch-package or add a patch; move `@types/*` to devDependencies. QA finding 2026-07-03 (MONEY-5 gate): the dead legacy UploadApprovalQueue.tsx still contains a complete conflict-resolution modal (13 refs) and `ConflictResolution` in src/types/index.ts:149 survives only to serve it — delete together.
Note 2026-07-02: root reorganization done — `nul` deleted; vendored docs → `docs/vendor/`; images → `docs/branding/`; stale plans → `docs/archive/`; workflow docs → `docs/developer/`; `test-scripts/` → `scripts/manual-tests/`. Remaining: dead-component/script deletion (needs Phil's confirmation) and dependency moves.

### INFRA-7 · P1 · Phase 4 · `todo`
**Database migration framework.** Evidence: §6.11 ("no migrations needed", schemaVersion=3). Released apps cannot recreate tables.
Fix: versioned migration runner keyed on `currentSchemaVersion`; baseline v3; every future schema change ships a migration.
Acceptance: opening a v3 profile DB with a v4 app migrates data losslessly (test with fixture DB).

### INFRA-8 · P2 · Track D · `todo`
**Dependency debt**: sqlite3 → better-sqlite3 (optional), remove ts-jest/@types/jest, retire crypto-js (pair SEC-10). Evidence: §6.6.

### INFRA-9 · P1 · Phase 4 · `todo`
**Test-money strategy for agents & CI.** Uploads cost real money; agents and CI must be able to verify money paths safely.
Fix: dedicated funded test wallet (small Turbo balance) checked into secrets (never the repo); free-tier (<100KB) fixtures for upload UAT; ArLocal or mocked gateway for integration tests; document in CLAUDE.md what may/may not spend.
Acceptance: an agent can run an end-to-end upload UAT spending only free-tier or explicitly-budgeted test credits.

### INFRA-10 · P1 · Phase 4 · `todo`
**IPC dead-surface reconciliation.** Evidence: §6.1-6.2. Remove or implement: `drive:get-metadata`/`refresh-metadata`, `multi-sync:*` (per UX-15), unexposed `sync:set-folder`/`sync:get-uploads`, ethereum stub, `wallet.completeSetup` fake, dead event channels (`sync:status-update`, `upload:complete`, `activity:update`, `sync:pending-uploads-updated`, `sync:upload-completed`), driveId/mappingId confusion (main.ts:1901).
Acceptance: every preload method has a live handler; every emitted event has ≥1 listener or is removed; a CI script greps for contract drift.

### INFRA-11 · P2 · Track D · `todo`
**Docs truth pass.** Evidence: §6.7, §6.10. Fix release-guide/testing-distribution workflow references; CLAUDE.md and README size-limit claims (2 GiB per D-014); README "Current Limitations" accuracy; README license says AGPL-3.0 while package.json says MIT — Phil to resolve.
Note 2026-07-02: superseded-doc banners and README phantom links already fixed in the repo reorg.

### INFRA-12 · P1 · Phase 4 · `todo`
**E2E/UI test harness.** Per D-006 amendment ("unit, integration and UI"): stand up Playwright (or WebdriverIO) driving the built Electron app with a disposable test profile; smoke flows first — onboarding (import test wallet), drive create/select, file drop → approval queue appears, settings. Wire into CI as a gated job (headless via xvfb on Linux runner or windows-latest).
Acceptance: one command runs the UI smoke suite against a packaged build; CI runs it on every PR; failures produce screenshots.

### INFRA-13 · P2 · Track D · `todo`
**Exhaustive field mapping + validation for drive-mapping updates.** QA finding 2026-07-03 (UX-2 gate): `updateDriveMapping` silently drops `driveId`/`drivePrivacy`/`rootFolderId`/`lastMetadataSyncAt` (fields in `Partial<DriveSyncMapping>` with no SQL branch — the same silent-no-op family as UX-2's bug), and the generic `drive-mappings:update` IPC handler (main.ts:~2814) forwards unvalidated `updates: any`. Latent today (all callers pass only mapped fields — verified), but a trap for Track A/C work.
Acceptance: every updatable field maps (compile-time-checked map or exhaustive switch); handler validates input; test feeds each field and asserts the SQL.

---

## CORE — ardrive-core-js upstream (sibling repo, per D-016/D-018)

Work items in the ardrive-core-js repo that desktop depends on. Same loop applies (implement → QA → merge there); desktop consumes via version bump with an interop check.

### CORE-1 · P1 · Track C · `deferred`
**Owner-scoped GQL queries (turbo-gateway compatibility).** Per D-018: most ArFS queries fail on turbo-gateway.com GQL unless an `owner` is supplied. Audit every GQL query core-js emits (drive/folder/file listings, drive discovery, manifest lookups) and thread `owner` through; desktop always knows the owner for its own drives (profile wallet address). BLOCKS SYNC-15's metadata migration.
**Reference implementation (D-019, Phil): ardrive-web's GraphQL queries** — the web app already runs owner-scoped; diff core-js's queries against web's and converge, including web's pattern for owner-unknown discovery flows (add-existing-drive by ID).
Acceptance: full drive listing + sync round-trip succeeds against turbo-gateway.com GQL; interop test vectors pass on both turbo-gateway and arweave.net; query shapes match ardrive-web's where semantics agree.

### CORE-2 · P1 · Track C · `deferred`
**Incremental sync support.** Per D-018: listing APIs that accept a since/cursor (block height or timestamp) so clients fetch only changes instead of full drive history. Desktop consumers: SYNC-8 remote polling, drive_metadata_cache refresh (`lastMetadataSyncAt` already exists in the schema, waiting for this).
**Head start (D-019, Phil): an incremental-sync branch was already started in ardrive-core-js** — first task is locating and assessing that branch (rebase/resume vs. cherry-pick vs. restart informed by it).
Acceptance: second listing of an unchanged large drive transfers near-zero data; changed-entity listing returns exactly the delta.

### CORE-3 · P1 · Track C · `deferred`
**ArFS snapshot support.** Per D-018: consume ArFS snapshot entities (as ardrive-web does) so cold-start listing of a large drive reads the snapshot + tail instead of replaying full GQL history. Read-side first; write-side (snapshot creation) confirmed in scope per D-019 — powers FEAT-3's desktop UI.
Acceptance: cold listing of a snapshotted large drive is dramatically fewer queries than full-history replay; results identical to full replay on interop vectors; creation API produces snapshots ardrive-web reads correctly.

---

## FEAT — Major feature work

### FEAT-1 · P1 · Track B · `deferred`
**Solana-default wallet onboarding with Turbo.** New users get a Solana wallet by default, paying via Turbo (turbo-sdk supports Solana signing/top-ups; sibling repo modifiable per D-016). OPEN DESIGN QUESTION (ROADMAP #2): ArFS private-drive key derivation for non-Arweave wallets — needs an ardrive-core-js decision before implementation starts.
Acceptance: new-user flow creates/imports a Solana wallet, tops up Turbo, and syncs a public drive end-to-end.

### FEAT-2 · P2 · Track B · `deferred`
**"Advanced mode": Arweave wallet + AR tokens + self-bundled uploads (lite bundler).** Per D-013: an opt-in mode where the user holds an Arweave wallet with AR tokens and the app builds/signs/posts its own ANS-104 bundles (arbundles is already a dependency). Scope question open (ROADMAP #4): per-file bundles vs batching with receipts.

### FEAT-3 · P1 · Track C · `deferred`
**Snapshot create/view UI (desktop, web parity).** Per D-019: users can create a snapshot of a drive and view existing snapshots, just like ardrive-web. Creation is a paid on-chain action → goes through the upload approval queue with cost shown. DEPENDS: CORE-3 (consumption + creation APIs).
Acceptance: create-snapshot flow with cost approval; snapshot list per drive; a desktop-created snapshot is readable by ardrive-web (interop vector).

---

## Item count: 68 · P0: 18 · P1: 31 · P2: 19
(2026-07-03 rescope per D-010..D-017: PRIV-1..7 onto beta phases, PRIV-0 wont-fix, SYNC-5 promoted P0, SYNC-10 promoted P1/Phase 2, +SYNC-15, +UX-16, +UX-17, +INFRA-12, +FEAT-1, +FEAT-2. Later 2026-07-03 per D-018/D-019: +CORE-1..3 upstream ardrive-core-js track, +FEAT-3 snapshot UI.)
