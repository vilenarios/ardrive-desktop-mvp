# UAT-PLAN — ArDrive Desktop full acceptance-test plan [UAT]

Status: **draft, 2026-07-04.** Companion to [UAT-HARNESS.md](UAT-HARNESS.md) (how to execute) and the
working POC under `scripts/uat/`. This plan enumerates *every* user-facing situation in the app, derived
by reading the code (`src/renderer/**`, `src/main/main.ts`), not from guesses. Each scenario names the
**harness** that verifies it and flags whether it needs **funds** or **human** eyes.

> Money rail (absolute, from the product owner): **never spend real funds.** Upload/rename/manifest/unhide
> tests use free-tier (<100 KiB = 102400 bytes) files or dry-run/mock. Reads use **turbo-gateway.com**,
> never arweave.net. The test wallet is referenced by `ARDRIVE_DEV_WALLET_PATH`/`.env` only — never inline
> a wallet JSON, seed phrase, or password.

## How to read a scenario

Each scenario = `ID · title` then: **Pre** (preconditions) · **Steps** · **Expect** (functional pass
condition) · **Check** (what to inspect: FUNC = functional correctness, UX = design-system/consistency,
COPY = copy accuracy, A11Y = keyboard/roles/aria) · **Harness** · **Flags**.

### Harness legend (see UAT-HARNESS.md §2 for the feasibility verdict on each)

| Tag | Mechanism | Determinism |
|---|---|---|
| **UI** | Playwright-Electron, real built app, headless WSLg/xvfb (option a) — PROVEN | real render, some network |
| **SVC** | Service-level harness / vitest `@vitest-environment node` on `dist/main/*` (option b) — PROVEN | deterministic, offline |
| **CHAIN** | `scripts/onchain-uat/*` free-tier on-chain, throwaway zero-fund wallet, net-zero proof (option b) | real network, free tier |
| **RTL** | vitest + jsdom + React Testing Library component test (option c) | deterministic, offline |
| **STATIC** | structured code read vs DESIGN-SYSTEM.md / DESIGN-8 (option d) | deterministic, no runtime |
| **HUMAN** | needs a person (visual judgement, real payment) | — |

### Flags

- **$$** = would spend real funds → requires Phil's budget + dedicated funded wallet (BACKLOG INFRA-9); test the
  *guard/dry-run*, never the spend.
- **NET** = touches the network (free/read-only or free-tier write) — allowed, but offline harness preferred where noted.
- **HUMAN** = a person must confirm (pixel-level visual, Stripe checkout, OS keychain prompt).

## Coverage summary

**16 areas · 96 scenarios.** Counts by area:

| # | Area | ID prefix | Scenarios |
|---|---|---|---|
| 1 | Onboarding / wallet | ONB | 9 |
| 2 | Profiles | PROF | 7 |
| 3 | Public drives | PUB | 6 |
| 4 | Private drives + unlock | PRIV | 7 |
| 5 | Sync upload | UPL | 6 |
| 6 | Sync download | DL | 6 |
| 7 | Upload approval / cost | APPR | 7 |
| 8 | Turbo credits / payment | TURBO | 7 |
| 9 | Settings / gateway | SET | 6 |
| 10 | Activity | ACT | 5 |
| 11 | Storage / permaweb | PERM | 6 |
| 12 | Hide / restore | HIDE | 4 |
| 13 | Manifests | MAN | 4 |
| 14 | Error / edge states | ERR | 6 |
| 15 | Theme light/dark | THEME | 3 |
| 16 | A11y / keyboard | A11Y | 7 |

A cross-cutting **Known issue hotspots** list (§17) collects the specific defects the enumeration already
surfaced, each mapped to the scenario that must catch it.

---

## 1. Onboarding / wallet (ONB)

Entry: `App.tsx` state `wallet-setup` → `WalletSetup.tsx` (3-step wizard). Reached on a truly fresh
`userData` (no profiles). First-run heading: **"Welcome to ArDrive Desktop"**.

- **ONB-1 · First-run screen renders.**
  Pre: fresh disposable userData, no dev-wallet env. Steps: launch app. Expect: heading "Welcome to ArDrive
  Desktop"; buttons "Create New Account" (primary) + "Import Existing Account"; subtitle "Store your files
  permanently on the decentralized web". Check: FUNC/COPY heading+buttons via getByRole; UX accent-red top
  bar on card, Permahills bg, brand logo; A11Y both actions are `<button>`. Harness: **UI** (proven by
  `poc-ui-launch.js`), **RTL**, **STATIC**. Flags: —

- **ONB-2 · Create account — password step validation.**
  Pre: ONB-1 → click "Create New Account". Steps: enter password/confirm variations. Expect: "Create Account"
  disabled until `password===confirm && length>=8` (`WalletSetup.tsx:415`); PasswordStrengthIndicator moves
  weak→strong; amber "Important Security Notice / There is no way to recover this password…". Check: FUNC
  disabled logic + strength scoring (`PasswordStrengthIndicator.tsx:9`); COPY notice; A11Y password inputs
  have labels (note: not `htmlFor`-linked — A11Y-3). Harness: **RTL**, **SVC** (validator), **STATIC**. Flags: —

- **ONB-3 · Create account — seed-phrase reveal + confirm gate.**
  Pre: ONB-2 valid password → Create. Steps: view step 3. Expect: heading "Save Your Recovery Phrase"; red
  "Critical: Save This Phrase / …you lose access to your files forever."; `SeedPhraseDisplay` blur→reveal;
  "Continue to Drive Setup" disabled until "I have written down…" checkbox ticked (`:540`). Check: FUNC gate;
  COPY warning; A11Y reveal button. Harness: **RTL**, **UI**. Flags: — (wallet gen is local; no funds)

- **ONB-4 · Import via wallet file — dropzone + validation.**
  Pre: ONB-1 → Import → "Wallet File". Steps: drop a non-`.json`, then a `.json`. Expect: non-json → error
  "Please drop a valid JSON wallet file" (`:98`); valid shows filename+path + "Change File". Check: FUNC drop
  handling; A11Y **dropzone is a click `<div>` with no role/tabIndex/onKeyDown** (A11Y hotspot — keyboard
  users can't operate it, `:594`). Harness: **RTL**, **UI**, **STATIC**. Flags: —

- **ONB-5 · Import via seed phrase — word-count validation.**
  Pre: Import → "Recovery Phrase". Steps: enter 11/12/24 words, non-letters. Expect: validator accepts exactly
  12 OR 24 words, letters-only per word (`input-validator.ts:147,153`). **COPY BUG to confirm:** UI error says
  "must contain exactly 12 words" (`WalletSetup.tsx:725`) but 24 is also valid — mismatch. Check: FUNC
  validator; COPY discrepancy (→ hotspot H-COPY-1). Harness: **SVC** (validator), **RTL**. Flags: —

- **ONB-6 · Import wallet happy path → welcome-back/drive-setup.**
  Pre: throwaway wallet at `ARDRIVE_DEV_WALLET_PATH`. Steps: import with password. Expect: `wallet:import`
  succeeds; app routes to welcome-back (has drives) or drive-setup (none) per `App.handleWalletImported`.
  Check: FUNC routing; the fresh-wallet "No drives found" branch. Harness: **UI** (dev-autofill, as
  `smoke.js` steps 03-04), **SVC** (`walletManager.importWallet`). Flags: **NET** (balance fetch, read-only).

- **ONB-7 · Import Ethereum-from-file / seed variants.**
  Pre: —. Steps: exercise `wallet:import-ethereum-from-file`, `wallet:import-from-seed-phrase` handlers.
  Expect: success/typed errors. Check: FUNC handler envelopes (D-005 `{success,data}`). Harness: **SVC**.
  Flags: — (uses throwaway keys only)

- **ONB-8 · Dev-mode autofill only when unpackaged + env set.**
  Pre: `ARDRIVE_DEV_MODE=true`, wallet/pw env. Steps: open Import. Expect: path+password prefilled
  (`WalletSetup.tsx:37`), and `system:get-env`/`readDevEnv` gate on `!isPackaged` (`main.ts:3068`). Check:
  FUNC autofill; SEC autofill must be impossible in a packaged build. Harness: **SVC** (`dev-env.test.ts`
  pattern), **UI**. Flags: —

- **ONB-9 · "Need help? getting started guide" link.**
  Pre: ONB-1. Steps: inspect footer link. Expect/Check: **COPY/FUNC BUG** — `href="#"` dead link
  (`WalletSetup.tsx:359`). Harness: **STATIC**, **RTL**. Flags: —

## 2. Profiles (PROF)

`ProfileManagement.tsx` (full-screen selector), `ProfileSwitcher.tsx` (header dropdown+modal). Complete
per-profile isolation (separate encrypted wallet, SQLite DB, config).

- **PROF-1 · Profile list + sign-in.** Pre: ≥1 saved profile. Steps: open selector, pick profile, enter
  password. Expect: heading "Select Profile"; card shows arnsName||name, truncated addr, "Last used"; inline
  password panel (autoFocus, Enter=submit, Escape=close `:376`) → `profiles.switch`. Check: FUNC auth+switch;
  COPY; A11Y Enter/Escape work, **eye toggle missing aria-label** (`:394`, hotspot). Harness: **UI**, **RTL**,
  **SVC** (`profile-authentication.test.ts`). Flags: —

- **PROF-2 · Wrong password.** Steps: sign in with bad password. Expect: error "Invalid password. Please try
  again." or specific "Could not unlock this profile: {reason}" (`:83`). Check: FUNC error surfacing; COPY.
  Harness: **RTL** (`ux7-profile-management-login-error.test.tsx`), **UI**. Flags: —

- **PROF-3 · Delete profile (two-step confirm).** Steps: click Delete → "Confirm" (red, auto-revert 3s) →
  confirm. Expect: `profiles.delete`; deleting last profile routes to create-new (`:105`). Check: FUNC
  isolation (deleted profile's DB/wallet removed); A11Y timed two-click confirm has no dialog role. Harness:
  **SVC** (delete + verify files gone), **UI**. Flags: — (destructive but on a throwaway profile only)

- **PROF-4 · Profile isolation.** Steps: create 2 profiles, add a drive mapping in A, switch to B. Expect: B
  sees 0 mappings / its own DB (`databaseManager.setActiveProfile` reopens the per-profile DB). Check: FUNC
  isolation. Harness: **SVC** — *proven by `poc-services.js` "profile isolation: second profile has 0
  mappings"*. Flags: —

- **PROF-5 · Switch profile from header.** Pre: dashboard, ≥2 profiles. Steps: UserMenu → "Switch Profile" →
  ProfileSwitcher modal → password → Unlock. Expect: switch + reload. Check: FUNC; A11Y **modal not
  role=dialog, no focus trap, uses deprecated onKeyPress, close btn no aria-label** (hotspots). Harness:
  **UI**, **RTL**. Flags: —

- **PROF-6 · Add new profile from selector.** Steps: "Add New Profile" → wallet-setup. Expect: routes to
  create/import without disturbing existing profiles. Check: FUNC. Harness: **UI**, **RTL**. Flags: —

- **PROF-7 · Keychain vs password storage method.** Steps: query `security:get-method`,
  `security:is-keychain-available`. Expect: correct method per OS; keytar availability. Check: FUNC. Harness:
  **SVC**. Flags: **HUMAN** if verifying an actual OS keychain prompt.

## 3. Public drives (PUB)

`DriveAndSyncSetup.tsx` (first-run wizard, public only), `CreateDriveModal.tsx` (dashboard, public/private),
`DriveSelector.tsx`, `AddExistingDriveModal.tsx`.

- **PUB-1 · First-run public drive wizard — form validation.** Steps: name a drive, pick sync folder.
  Expect: name `maxLength 32`, counter "{n}/32" turns error >28 (`:408`); realtime errors for >32 / bad chars
  / empty; public warning "This is a public drive. Your files will be permanently visible on the Arweave
  permaweb."; "Continue to Review" disabled until name+folder valid (`:639`). Check: FUNC validation; COPY;
  **note 32-char UI vs 100-char `validateDriveName` mismatch** (hotspot H-COPY-2). Harness: **RTL**, **UI**,
  **SVC** (validator). Flags: —

- **PUB-2 · Review summary → complete.** Steps: Continue to Review → verify summary (Drive Name / Sync Folder
  / "Public Drive" / Auto-Sync) → Complete Setup. Expect: progress "Checking wallet…→Creating your drive on
  Arweave…→…Setup complete! 🎉"; SyncProgressDisplay modal. Check: FUNC step sequence; COPY. Harness: **UI**
  (smoke.js steps 06-07), **CHAIN** (drive create free tier). Flags: **NET** (on-chain ArFS metadata, free tier).

- **PUB-3 · Create public drive on-chain (net-zero).** Steps: `arDrive.createPublicDrive` via throwaway
  zero-fund wallet. Expect: drive+root folder created, Turbo balance unchanged before/after. Check: FUNC
  drive entity + net-zero. Harness: **CHAIN** (`batch2-writes.js` W6 pattern). Flags: **NET**, uses free tier only.

- **PUB-4 · SetupSuccessScreen.** Steps: after create. Expect: "🎉 Your Drive Is Ready{, name}!"; summary
  rows; "Show Technical Details" reveals Drive ID / Root Folder ID / Drive Tx ID with Copy + View. Check:
  FUNC toggle+copy; **COPY/UX: "View" opens `https://arweave.net/{txId}` — should be turbo-gateway.com/an
  ArDrive link per money rail** (`SetupSuccessScreen.tsx:42`, hotspot H-GW-1). Harness: **RTL**, **STATIC**,
  **UI**. Flags: —

- **PUB-5 · Add existing drive.** Pre: wallet has an unmapped drive. Steps: DriveSelector → "Add Existing
  Drive" → select → Add. Expect: "Will be synced to: {folder}/{name}"; empty state "All your drives are
  already added to this device." when none. Check: FUNC mapping add; COPY. Harness: **UI**, **RTL**, **SVC**
  (`addDriveMapping` — proven by `poc-services.js`). Flags: **NET** (drive list read).

- **PUB-6 · Drive selector switch + rename.** Steps: switch active drive (native `window.confirm` →
  `drive.switchTo` → reload); rename via Overview (cost-confirm modal → `drive.rename`). Expect: switch
  reloads with new drive; rename shows "FREE with Turbo Credits" when <100KB. Check: FUNC; **A11Y native
  window.confirm not styleable** (hotspot); COPY free/paid. Harness: **UI**, **CHAIN** (rename free tier).
  Flags: **NET**, **$$** for the rename *paid* branch (test only the free-tier/guard path).

## 4. Private drives + unlock (PRIV)

`CreateDriveModal.tsx` (private path), `PrivateDriveUnlockModal.tsx`, `drive-key-manager.ts` (in-memory key
cache + opt-in encrypted persistence, cleared on profile switch).

- **PRIV-1 · Create private drive — password rules.** Steps: CreateDriveModal → Private. Expect: warning
  "Important: This password is permanent / …cannot be changed or recovered"; password required, >=8, confirm
  match (`:58`); "Create Drive" disabled until both set. Check: FUNC validation; COPY permanence warning.
  Harness: **RTL**, **UI**. Flags: —

- **PRIV-2 · Create private drive on-chain (net-zero).** Steps: `createPrivateDrive` w/ `PrivateDriveKeyData`
  on throwaway wallet. Expect: drive created, balance unchanged. Check: FUNC. Harness: **CHAIN**
  (`batch2-writes.js` W2). Flags: **NET** free tier.

- **PRIV-3 · Unlock modal — correct password.** Steps: select locked private drive → PrivateDriveUnlockModal
  → enter password → Unlock. Expect: `drive:unlock` derives key, decrypts drive name, proceeds. Check: FUNC
  unlock; A11Y **best modal**: labels htmlFor-linked, Enter=submit/Escape=cancel, eye aria-label, error
  focus-return (`PrivateDriveUnlockModal.tsx`). Harness: **UI**, **RTL** (`drive-selector-unlock.test.tsx`),
  **CHAIN** (real key derivation). Flags: **NET** (verification).

- **PRIV-4 · Unlock — wrong password vs network error.** Steps: wrong password; then simulate gateway
  failure. Expect: specific error surfaced (not a hardcoded "Invalid password") — "Invalid password. Please
  check…" vs verification-failure reason (`App.tsx:706`, UX-3). Check: FUNC error differentiation; COPY.
  Harness: **RTL** (`ux3-unlock-error-display.test.tsx`), **SVC** (`drive-unlock-validation.test.ts`). Flags: —

- **PRIV-5 · Remember-this-drive persistence (opt-in).** Steps: unlock with "Remember this drive on this
  device" ON. Expect: key persisted encrypted (`drive:set-persistence`, `drive:is-persisted`); next sign-in
  no password needed; DriveSelector shows "Remembered · Forget". Check: FUNC persist + forget rollback.
  Harness: **SVC** (`drive-key-persistence.test.ts`), **UI**. Flags: — (PRIV-4 WIP context: see BACKLOG PRIV-4)

- **PRIV-6 · Key cleared on profile switch / lock.** Steps: unlock, switch profile / `drive:lock`. Expect:
  in-memory key cleared; drive re-locks. Check: FUNC/SEC key lifecycle (`drive-key-manager.ts`). Harness:
  **SVC** (`drive-key-manager.test.ts`). Flags: —

- **PRIV-7 · Private file round-trip (upload→download→decrypt).** Steps: upload <40KiB to private drive,
  download, decrypt, compare SHA-256. Expect: byte-exact round-trip; balance net-zero. Check: FUNC integrity.
  Harness: **CHAIN** (`batch2-writes.js` W3). Flags: **NET** free tier.

## 5. Sync upload (UPL)

`sync-manager.ts` + chokidar watcher; `FileOperationDetector` (3s window); 100MB limit; free-tier gate.

- **UPL-1 · New file in sync folder → pending upload.** Pre: dashboard, sync active. Steps: drop a <100KiB
  file into `{syncFolder}/{driveName}`. Expect: after 3s detection + watcher-active gate, a
  `pending_uploads` row (status `awaiting_approval`), Upload Queue badge increments. Check: FUNC detection.
  Harness: **UI** (smoke.js steps 09-10 — `sync.getStatus().isActive` gate then `uploads.getPending`),
  **SVC** (`sync-manager.test.ts`). Flags: **NET** for the eventual upload.

- **UPL-2 · Free-tier size gate.** Steps: queue a 40KiB and a 200KiB file. Expect: 40KiB shows FREE; 200KiB
  shows a credit cost. Check: FUNC `CostCalculator.isFreeWithTurbo` (<100KiB). Harness: **SVC** — *proven by
  `poc-services.js` §C*. Flags: —

- **UPL-3 · 100MB MVP limit.** Steps: drop a >100MB file. Expect: rejected/skipped (`sync-manager.ts` limit).
  Check: FUNC limit enforcement. Harness: **SVC** (unit), **STATIC**. Flags: — (use a sparse/truncate file; no upload)

- **UPL-4 · Move / rename / copy detection.** Steps: move & rename a synced file within the folder. Expect:
  `FileOperationDetector`/`FolderOperationDetector` classify as move/rename (not re-upload) within the 3s
  window; queue shows "Moved … / Renamed …" operation rows. Check: FUNC classification; COPY op descriptions
  (`UploadApprovalQueueModern.tsx:363`). Harness: **SVC** (`FileStateManager.test.ts`), **UI**. Flags: —

- **UPL-5 · Edit → re-upload as new revision (SYNC-1).** Steps: edit a synced file, re-detect. Expect: same
  ArFS fileId, new dataTxId (a revision). Check: FUNC revisioning. Harness: **CHAIN** (`batch2-writes.js` W4).
  Flags: **NET** free tier.

- **UPL-6 · Crash recovery of interrupted uploads (SYNC-3).** Steps: leave an `uploads` row `uploading`, run
  `recoverInterruptedOperations`. Expect: it flips to `failed` with the honest "may or may not have reached
  Arweave" message (`database-manager.ts:102`). Check: FUNC recovery + money-safety copy. Harness: **SVC**.
  Flags: —

## 6. Sync download (DL)

`DownloadManager` / `StreamingDownloader`, `DownloadQueueTab.tsx`, `files:*` handlers.

- **DL-1 · Empty download queue.** Steps: open Download Queue with nothing queued. Expect: "Download Queue" /
  "No Pending Downloads" / "Files being downloaded from Arweave will show up here" + "Check for new files to
  download". Check: COPY/FUNC empty state. Harness: **UI**, **RTL**. Flags: —

- **DL-2 · Queue a cloud-only file.** Steps: StorageTab → "Download now" on a cloud_only file →
  `files.queueDownload(id)`. Expect: row appears in Download Queue with position, progress. Check: FUNC.
  Harness: **UI**, **SVC** (`download-manager.test.ts`). Flags: **NET** (read-only download, free).

- **DL-3 · Private file streaming download + decrypt.** Steps: download a private file. Expect: decrypts to
  byte-exact. Check: FUNC integrity, `FileHashVerifier` SHA-256. Harness: **SVC**
  (`download-manager-private-realfs.test.ts`), **CHAIN** (W3). Flags: **NET** free tier.

- **DL-4 · Pause / resume / retry / cancel.** Steps: exercise each row control. Expect: state transitions;
  cancel → `files.cancelDownload` (makes cloud-only). Check: FUNC controls; A11Y search/filter have
  aria-labels (`:266,272`) but row buttons use `title` only. Harness: **UI**, **RTL**. Flags: **NET**.

- **DL-5 · Flapping/streaming stability.** Steps: simulate an unstable stream. Expect: no duplicate/partial
  writes. Check: FUNC. Harness: **SVC** (`streaming-downloader-flapping.test.ts`). Flags: —

- **DL-6 · Re-download all.** Steps: `files:redownload-all`. Expect: re-queues drive files. Check: FUNC.
  Harness: **SVC**, **UI**. Flags: **NET** (downloads free).

## 7. Upload approval / cost (APPR)

`UploadApprovalQueueModern.tsx` — the money screen. Turbo-only (D-010). MONEY-1 gating.

- **APPR-1 · Queue populated shows cost banner.** Steps: queue files. Expect: banner "AR Balance / Turbo
  Credits / Total Upload Cost"; all-free → "FREE"; columns "File / Size / Cost / Status". Check: FUNC/COPY.
  Harness: **UI**, **RTL** (`UploadApprovalQueueModern.test.tsx`). Flags: —

- **APPR-2 · FREE badge for <100KiB.** Steps: queue a 40KiB file. Expect: row cost "FREE"; total "FREE".
  Check: FUNC. Harness: **UI** (smoke.js step 10), **RTL**. Flags: —

- **APPR-3 · Approve & Upload (free tier).** Steps: click "Approve & Upload" → `uploads.approveAll`. Expect:
  row → uploading → uploaded; net-zero on a zero-fund wallet. Check: FUNC upload completion. Harness: **UI**
  (smoke.js steps 11-12), **CHAIN**. Flags: **NET** free tier. (**$$** if a >100KiB file were used — forbidden.)

- **APPR-4 · Insufficient-balance gating (MONEY-1).** Pre: a row whose real quote exceeds live Turbo balance.
  Steps: attempt approve. Expect: that row is blocked/skipped, never submitted; row shows "Insufficient
  balance — top up Turbo Credits" link; "Approve & Upload" disabled → "Insufficient Turbo Credits". Check:
  FUNC gating (never spends beyond balance); COPY. Harness: **RTL** (mock balance), **SVC**. Flags: —

- **APPR-5 · DB-shape normalization (MONEY-3).** Steps: read `getPendingUploads` on DB-shaped rows (integer
  0/1 booleans, null cost). Expect: `hasSufficientTurboBalance` is a real boolean, `estimatedTurboCost` stays
  `null` (no fabricated quote). Check: FUNC boundary normalization. Harness: **SVC** — *proven by
  `poc-services.js` MONEY-3 assertions*; **RTL** (`money3-dbshape-repro.test.tsx`). Flags: —

- **APPR-6 · Reject / clear all / retry failed.** Steps: reject one, clear all, retry a failed. Expect:
  `uploads.reject/rejectAll/retry` (retry re-charges). Check: FUNC; retry admission guard (MONEY-2,
  `upload-retry-guard.test.ts`). Harness: **RTL**, **SVC**. Flags: **$$** only if retrying a paid file (test free tier).

- **APPR-7 · Conflict rows.** Steps: create a name conflict. Expect: "All files have conflicts that need to
  be resolved"; approve disabled → "Resolve conflicts first". Check: FUNC/COPY. Harness: **RTL**
  (`upload-queue-no-conflict-ui.test.tsx`), **UI**. Flags: —

## 8. Turbo credits / payment (TURBO)

`TurboCreditsManager.tsx` + `turbo/*`. Only two money paths in the whole app: fiat checkout + AR→credits.

- **TURBO-1 · Balance card + tabs.** Steps: open Turbo Credits. Expect: heading "Turbo Credits"; balance
  card labels credits as "Credits" not "AR" (TRUST-6); 4 tabs Purchase/Settings/Coming Soon/About; refresh
  aria-label present (`TurboBalanceCard.tsx:76`). Check: FUNC/COPY; A11Y **tabs are buttons but lack
  role=tab/aria-selected** (hotspot). Harness: **UI**, **RTL** (`TurboCreditsManager.test.tsx`). Flags:
  **NET** (get-balance read-only).

- **TURBO-2 · Fiat estimate (read-only).** Steps: enter a custom amount. Expect: `turbo.getFiatEstimate`
  returns storage estimate; "Secure payment powered by Stripe". Check: FUNC read-only. Harness: **SVC**,
  **RTL**. Flags: **NET** read-only.

- **TURBO-3 · Quick Buy / Purchase opens checkout — GUARD ONLY.** Steps: click a Quick Buy option. Expect:
  `turbo.createCheckoutSession` → `payment.openWindow(url)` opens a Stripe window; toast "Payment window
  opened…". Check: FUNC that a window *opens* — **do NOT complete payment.** Harness: **RTL** (mock
  createCheckoutSession, `payment-window.test.ts`), **UI** (assert window opens then close it). Flags:
  **$$/HUMAN** — real card charge needs Phil; automate only up to the checkout window.

- **TURBO-4 · Convert AR → Credits — GUARD ONLY.** Steps: inspect Convert section. Expect: "~23% conversion
  fee applies"; "Processing takes 5-15 minutes • Credits are non-transferrable"; guarded "Unavailable" when
  balance NaN (MONEY-13). Check: FUNC guard; COPY fee disclosure. Harness: **RTL** (mock). Flags:
  **$$** — `turbo.topUpWithTokens` spends AR irreversibly; never execute with real funds.

- **TURBO-5 · Payment completed / cancelled events.** Steps: fire `payment.onPaymentCompleted` /
  `onPaymentCancelled` (mock). Expect: toasts "Payment successful! …" / "Payment window closed. No charge was
  made."; balance refresh (MONEY-6 pull-based). Check: FUNC event wiring. Harness: **RTL**
  (`money6-topup-refresh.test.tsx`). Flags: —

- **TURBO-6 · Usage statistics tab.** Steps: open Settings tab. Expect: exactly TWO tiles "Files Uploaded" /
  "Data Stored" (TRUST-1 removed "Credits Used"); "—" while loading. Check: FUNC/COPY. Harness: **RTL**,
  **UI**. Flags: —

- **TURBO-7 · NaN balance rendering.** Steps: force blank/NaN balance. Expect: "Unavailable", never "NaN" or
  "$0". Check: FUNC. Harness: **RTL** (`UserMenu-nan-balance.test.tsx`,
  `wallet-manager-secure-nan-balance.test.ts`). Flags: —

## 9. Settings / gateway (SET)

`Settings.tsx`. Default gateway **turbo-gateway.com** (matches money rail).

- **SET-1 · Open settings modal.** Steps: UserMenu → Settings. Expect: sections Sync Folder / Gateway /
  Account Export / About. Check: FUNC/COPY; A11Y **modal not role=dialog, no Esc/focus trap, close no
  aria-label** (hotspot). Harness: **UI**, **RTL** (`settings-folder.test.tsx`). Flags: —

- **SET-2 · Change sync folder.** Steps: Change Folder → pick → `sync.setFolder(path,{updateActiveMapping})`
  → `sync.start`. Expect: mapping's `localFolderPath` persists (UX-2 regression guard), sync restarts;
  failure copy "Folder changed, but sync could not restart automatically. Use Sync to retry." Check: FUNC
  persistence. Harness: **SVC** (`drive-mapping-folder-persistence.test.ts`, `sync-folder-change.test.ts`),
  **UI**. Flags: —

- **SET-3 · Set gateway host — validation.** Steps: enter valid host, then garbage. Expect: valid →
  `config.setGateway` + "Gateway saved."; invalid → "That doesn't look like a valid gateway host."; empty →
  "Enter a gateway host, or use Reset to Default." Check: FUNC validation; A11Y input has htmlFor label,
  spellcheck off. Harness: **RTL** (`settings-gateway.test.tsx`), **SVC** (`gateway.test.ts`). Flags: —

- **SET-4 · Reset gateway to default.** Steps: Reset to Default. Expect: reverts to turbo-gateway.com; button
  disabled when already default. Check: FUNC. Harness: **RTL**, **SVC**. Flags: —

- **SET-5 · Theme toggle (config:set-theme).** Steps: change theme setting. Expect: `document.documentElement`
  data-theme updates; persisted to config. Check: FUNC persistence. Harness: **UI** (screenshot both),
  **SVC**. Flags: — (see THEME area)

- **SET-6 · Wallet export flow.** Steps: Settings → Export Account → `WalletExport.tsx`. Expect: 4 formats;
  dangerous formats double-confirm ("Critical Security Warning" → "I Understand the Risks - Export"); secrets
  masked until reveal; clipboard auto-clears after 30s. Check: FUNC masking + confirm gate; **SEC never log
  secrets**; A11Y show/hide + close missing aria-label. Harness: **RTL** (`WalletExport.test.tsx`), **UI**.
  Flags: **HUMAN** for real key verification (never print in logs).

## 10. Activity (ACT)

`dashboard/ActivityTab.tsx` — unified upload+download stream, 30 days, current drive.

- **ACT-1 · Empty / no-drive.** Expect: "No Drive Selected"; or "No recent activity" / "Upload or download
  files to see activity here". Check: COPY/FUNC. Harness: **UI**, **RTL**. Flags: —

- **ACT-2 · Populated + completed shows Permanent.** Steps: after an upload. Expect: row "uploaded to …",
  "Permanent" chip on completed uploads; pagination "Load More ({n} remaining)". Check: FUNC/COPY. Harness:
  **UI** (smoke.js step 13), **RTL**. Flags: **NET** to produce a real upload (free tier).

- **ACT-3 · Search + filter.** Steps: search text, filter Uploads/Downloads Only. Expect: "Showing {x} of
  {y} activities from last 30 days". Check: FUNC filtering. Harness: **RTL**, **UI**. Flags: —

- **ACT-4 · Context menu + copy link.** Steps: open row "More actions" → Open / Copy Link / View Details /
  View Online. Expect: `role=menu`/`menuitem`, `aria-haspopup`, copy toast "…link copied!". Check: FUNC;
  **A11Y this menu is done right** (contrast with others). Harness: **RTL** (`activity-tab-copy-link.test.tsx`,
  `activity-tab-context-menu-a11y.test.tsx`), **UI**. Flags: —

- **ACT-5 · Details modal.** Steps: View Details. Expect: all IDs (Upload/File/Data/Metadata Tx) with copy;
  actions View on Arweave / Retry Download / Open File. Check: FUNC; **UX Retry does full page reload**
  (jarring, `:1209`, hotspot); A11Y modal not role=dialog. Harness: **RTL**, **UI**, **STATIC**. Flags: **NET**.

## 11. Storage / permaweb (PERM)

`dashboard/StorageTab.tsx` ("Permaweb Files") — file explorer with statuses.

- **PERM-1 · Empty / new-drive / error states.** Expect: "No files on the Permaweb yet"; new drive "Your
  drive is being created …try refreshing in a minute."; error "Unable to load drive contents". Check:
  COPY/FUNC state selection (fetch-fail vs confirmed-empty). Harness: **RTL**, **UI**. Flags: **NET**.

- **PERM-2 · Populated list/grid + breadcrumbs.** Steps: browse folders. Expect: list/grid toggle,
  breadcrumb nav, search "Search files and folders…", filter All/Files/Folders. Check: FUNC nav. Harness:
  **UI**, **RTL**. Flags: **NET**.

- **PERM-3 · Sync status system (DSI-2).** Steps: inspect status pills. Expect: Synced / Downloading /
  Uploading / Queued / Cloud-only / Pending / Error labels from STATUS_META; status InfoButton lists them.
  Check: FUNC status mapping; **A11Y status is color+icon+title only, no live-region text alt** (hotspot).
  Harness: **RTL**, **STATIC**, **UI**. Flags: **NET**.

- **PERM-4 · Free up space (make cloud-only).** Steps: row → "Free up space" →
  `files.setFileSyncPreference(id,'cloud_only')`. Expect: local copy removed, still on Arweave; status →
  Cloud-only. Check: FUNC (reversible — re-download restores). Harness: **UI**, **SVC**. Flags: — (reversible)

- **PERM-5 · Permaweb view after upload.** Steps: after an upload, open Permaweb. Expect: uploaded file
  visible (allow metadata refresh lag). Check: FUNC. Harness: **UI** (smoke.js step 14 soft-assert),
  **CHAIN**. Flags: **NET**.

- **PERM-6 · Export metadata CSV.** Steps: Overview → Export Metadata → `drive.getPermawebFiles(id,true)`
  builds CSV client-side. Expect: CSV download; `alert()` on empty. Check: FUNC; **A11Y native alert**.
  Harness: **RTL**, **UI**. Flags: **NET** (read).

## 12. Hide / restore (HIDE)

ArFS hide (SYNC-5 / D-011): local delete → hide on Arweave (never truly erased); reversible via unhide.
**Every hide test must be reversible** (money rail).

- **HIDE-1 · Local delete queues a hide op.** Steps: delete a synced file locally. Expect: an approval-queue
  op "Removed locally — hide on Arweave (can't be erased): {file}"; `file-operation-detector-hide.test.ts`.
  Check: FUNC detection; COPY. Harness: **SVC**, **UI**. Flags: —

- **HIDE-2 · Hide writes metadata, re-fetch reads isHidden (net-zero).** Steps: `hidePrivateFile`, re-fetch.
  Expect: `isHidden===true`, balance unchanged. Check: FUNC. Harness: **CHAIN** (`batch2-writes.js` W5).
  Flags: **NET** free tier.

- **HIDE-3 · Hidden badge in StorageTab.** Steps: view a hidden entity. Expect: "Hidden" badge + InfoButton
  "Hidden on Arweave — removed locally… Unhide to restore it to view." Check: FUNC/COPY. Harness: **RTL**,
  **UI**. Flags: —

- **HIDE-4 · Unhide restores (reversible).** Steps: StorageTab → "Unhide on Arweave" → `sync.unhideEntity`
  (queued to approval) → approve free-tier. Expect: entity visible again. Check: FUNC reversibility.
  Harness: **UI**, **CHAIN** (`unhide-restore.js`). Flags: **NET** free tier. **Always restore what you hide.**

## 13. Manifests (MAN)

`CreateManifestModal.tsx` — index of a folder into one shareable URL. Files not re-uploaded.

- **MAN-1 · Folder picker + name.** Steps: Overview → Create Manifest. Expect: "Create Arweave Manifest";
  info "A manifest creates a single URL…If a manifest with the same name exists, it will be replaced…";
  folder tree; default name "DriveManifest.json"; "No folders found…" empty state. Check: FUNC/COPY; **A11Y
  tree rows are click `<div>`s, no role=tree/treeitem, modal not role=dialog** (hotspots). Harness: **RTL**
  (`create-drive-modal.test.tsx` sibling pattern), **UI**, **STATIC**. Flags: **NET** (folder tree read).

- **MAN-2 · Confirm dialog shows FREE.** Steps: Next → confirm. Expect: "{n} file paths will be included";
  Cost "FREE" / "Using Turbo Credits (manifests are free)". Check: FUNC/COPY. Harness: **RTL**, **UI**. Flags: —

- **MAN-3 · Create manifest on-chain (net-zero).** Steps: Confirm & Create → `drive.createManifest`. Expect:
  manifest tx; toast "Manifest created successfully! ({n} files)"; balance unchanged. Check: FUNC. Harness:
  **CHAIN**. Flags: **NET** free tier.

- **MAN-4 · Replace existing manifest (new version).** Steps: create a manifest with an existing name.
  Expect: replaced with a new version (not duplicated). Check: FUNC versioning. Harness: **CHAIN**. Flags: **NET**.

## 14. Error / edge states (ERR)

- **ERR-1 · Boot error for existing profile (offline).** Steps: existing profile, force a drive-fetch
  failure (offline). Expect: `App` state `boot-error` (NOT wallet-setup) — "We couldn't load your account" +
  Retry (UX-7). Check: FUNC routing guard (offline user never sees "Create New Account"). Harness: **RTL**
  (`ux7-boot-error-routing.test.tsx`), **UI** (launch offline w/ a seeded profile). Flags: —

- **ERR-2 · React error boundary.** Steps: force a render throw. Expect: `ErrorBoundary` full-screen
  "Something went wrong" + "Try Again"/"Reload App"; reports via `error.reportError`. Check: FUNC; **A11Y no
  role=alert; raw `white` literals** (hotspot). Harness: **RTL**, **STATIC**. Flags: —

- **ERR-3 · Free-tier boundary at exactly 102400 bytes.** Steps: check 102400-byte file. Expect: **mismatch**
  — `CostCalculator.isFreeWithTurbo` uses `<` (NOT free) while `main.ts` approval gate uses `<=` (FREE)
  (`main.ts:2174`). Check: FUNC boundary consistency. Harness: **SVC** — *proven by `poc-services.js` boundary
  assertion*. Flags: — (→ hotspot H-BND-1)

- **ERR-4 · IPC envelope consistency (D-005).** Steps: sample handlers. Expect: all return `{success,data}`
  (not raw). Check: FUNC contract (some legacy handlers return raw — CLAUDE.md trap). Harness: **SVC**
  (assert shapes), **STATIC**. Flags: —

- **ERR-5 · DB migration integrity / crash recovery.** Steps: open a v-old DB, migrate; kill mid-op, recover.
  Expect: migrations apply v3→v5 (as `poc-services.js` logs show), `recoverInterruptedOperations` resets
  transient rows. Check: FUNC. Harness: **SVC** (`database-migrations.test.ts`, `migration-adversarial.test.ts`).
  Flags: —

- **ERR-6 · Insufficient-funds upload never spends.** Steps: attempt a paid upload on a zero-balance wallet.
  Expect: rejected with "insufficient balance", no spend (the zero-fund wallet is physically incapable).
  Check: FUNC/SEC money backstop. Harness: **SVC**, **CHAIN** (implicit backstop). Flags: —

## 15. Theme light/dark (THEME)

DESIGN-SYSTEM.md: dark default; `:root[data-theme]`; WCAG-AA pairs in §1.5.

- **THEME-1 · Dark theme baseline.** Steps: default launch. Expect: `--surface #121212` canvas, `#FAFAFA`
  text, accent-red top bar. Check: UX tokens; A11Y contrast (text-primary on surface ~17:1). Harness: **UI**
  (screenshot — proven render), **HUMAN** (visual), **STATIC**. Flags: **HUMAN** for pixel judgement.

- **THEME-2 · Light theme.** Steps: switch to light. Expect: high-key surfaces, shadow-carried elevation,
  status `-fg` variants pass AA. Check: UX/A11Y both themes styled (`prefers-color-scheme` + `data-theme`).
  Harness: **UI** (screenshot both), **STATIC**, **HUMAN**. Flags: **HUMAN**.

- **THEME-3 · Token-violation sweep.** Steps: grep raw hex/rgb outside theme.css. Expect: only theme.css.
  **Known violations to catch:** `StoredFilesBrowser.tsx:283 #4A90E2`, `MetadataEditor.tsx` `white`/blue-*,
  rgba box-shadows in ProfileManagement/DriveAndSyncSetup/SyncFolderSetup/CreateManifestModal, competing
  `--ardrive-*` vs `--success-600` vs `--red-*` families. Check: UX consistency (DESIGN-2 §5 guardrail).
  Harness: **STATIC**. Flags: — (see §17)

## 16. A11y / keyboard (A11Y)

Systemic gaps found across the app — each is one testable criterion.

- **A11Y-1 · Toasts are not announced.** Steps: trigger a toast, inspect. Expect (BUG): neither
  `ToastContainer.tsx:11` nor `ToastNotification.tsx:66` has `aria-live`/`role=alert|status` → SRs never hear
  payment/copy outcomes; close btn no aria-label. Check: A11Y. Harness: **RTL** (`dashboard-toasts.test.tsx`,
  `app-toast-wiring.test.tsx` assert roles), **STATIC**. Flags: — (→ hotspot H-A11Y-1)

- **A11Y-2 · No modal is a real dialog.** Steps: open each modal. Expect (BUG): CreateManifest, FileMetadata,
  rename, Activity/Storage details, Settings, UserMenu logout, ProfileSwitcher, WalletExport, CreateDrive,
  AddExistingDrive lack `role=dialog`/`aria-modal`/focus-trap; only PrivateDriveUnlockModal handles Escape+
  Enter well. Check: A11Y. Harness: **STATIC**, **RTL** (assert role/Escape), **UI**. Flags: —

- **A11Y-3 · Labels not linked / inputs unlabeled.** Steps: getByLabelText on password fields, currency
  select, seed textarea. Expect (BUG): `PasswordInput` label not `htmlFor`-linked; TurboPurchase currency
  `<select>` + number inputs have no `<label>`/aria-label. Check: A11Y. Harness: **RTL**, **STATIC**. Flags: —

- **A11Y-4 · Icon-only buttons missing aria-label.** Steps: audit copy/refresh/eye/close/×/context buttons.
  Expect (BUG): many rely on `title=` only (StorageTab, DownloadQueue row actions, Modern queue, Overview
  copy, ProfileManagement eye, ProfileSwitcher/Settings/WalletExport close). Check: A11Y. Harness: **STATIC**,
  **RTL**. Flags: —

- **A11Y-5 · Clickable `<div>` rows not keyboard-operable.** Steps: keyboard-tab through Activity/Storage
  lists, manifest folder tree, WalletSetup dropzone. Expect (BUG): rows/dropzones are `<div onClick>` with no
  role/tabIndex/onKeyDown. Check: A11Y. Harness: **STATIC**, **RTL**. Flags: —

- **A11Y-6 · Tab a11y wiring.** Steps: inspect dashboard tabs. Expect: `TabNavigation` has role=tablist/tab/
  aria-selected (good) BUT (BUG) `aria-controls="{id}-panel"` targets IDs that don't exist and panels lack
  `role=tabpanel` (`Dashboard.tsx:824`); no arrow-key roving. Turbo tabs lack role=tab entirely. Check: A11Y.
  Harness: **STATIC**, **RTL**. Flags: —

- **A11Y-7 · Progress bar semantics.** Steps: inspect SyncProgressDisplay + StatusPill progress. Expect
  (BUG): styled `<div>` bars with no `role=progressbar`/aria-valuenow; SyncProgressDisplay has no visible
  completion frame + auto-close only. Check: A11Y. Harness: **STATIC**, **RTL**. Flags: —

---

## 17. Known issue hotspots (found during recon — each maps to a scenario)

These are concrete defects the code read already surfaced; the plan's job is to *catch and track* them.

| ID | Issue | Where | Scenario |
|---|---|---|---|
| H-A11Y-1 | Toasts have no `aria-live`/`role=alert` — silent to screen readers | ToastContainer:11, ToastNotification:66 | A11Y-1 |
| H-A11Y-2 | No modal uses role=dialog/aria-modal/focus-trap (except PrivateDriveUnlock partial) | most modals | A11Y-2 |
| H-A11Y-3 | Clickable `<div>` rows + non-focusable dropzone | ActivityTab:626, StorageTab:852, CreateManifest:204, WalletSetup:594 | A11Y-5 |
| H-A11Y-4 | `TabNavigation aria-controls` points at non-existent panel IDs; panels lack role=tabpanel | TabNavigation:36 vs Dashboard:824 | A11Y-6 |
| H-COPY-1 | Seed error says "exactly 12 words" but 24 also valid | WalletSetup:725 vs input-validator:147 | ONB-5 |
| H-COPY-2 | Drive-name cap is 32 in UI, 100 in `validateDriveName` | modals vs input-validator:112 | PUB-1 |
| H-BND-1 | Free-tier boundary at 102400: `<` (CostCalculator) vs `<=` (approval gate) | CostCalculator:88 vs main.ts:2174 | ERR-3 |
| H-GW-1 | SetupSuccessScreen "View" opens arweave.net (money rail says turbo-gateway.com) | SetupSuccessScreen:42 | PUB-4 |
| H-DEAD-1 | `UploadApprovalQueue.tsx`, `MetadataEditor.tsx`, `StoredFilesBrowser.tsx` are unreachable dead code (still hold `ar` payment choice + raw hex `#4A90E2`) | not imported | THEME-3 / scope |
| H-UX-1 | Activity "Retry Download" does a full `window.location.reload()` | ActivityTab:1209 | ACT-5 |
| H-TOKEN-1 | Competing token families `--ardrive-*` vs `--success-600` vs `--red-*`; rgba box-shadow literals | FileMetadataModal, CreateManifestModal, ProfileManagement, etc. | THEME-3 |
| H-UX-2 | Native `window.confirm`/`alert()` for drive switch + approve-all errors | Dashboard:384,550 | PUB-6 / APPR-6 |

---

## 18. What can only be verified by human or costs money

- **Real payment (Stripe checkout, AR→Credits conversion):** TURBO-3, TURBO-4 — **needs Phil's budget +
  funded wallet.** Automate only up to the checkout window opening / the guard; never complete a charge.
- **Paid (>100 KiB) uploads, paid rename, non-free manifests:** APPR-3/6, PUB-6, MAN-3 — test the **free tier
  only**; the paid branch needs the dedicated funded wallet (INFRA-9) and explicit budget.
- **Pixel-level visual / brand judgement (THEME-1/2), font rendering, animation feel:** **HUMAN** — a runtime
  can screenshot, but "does it look on-brand" is a person's call.
- **OS keychain prompt (PROF-7) and real seed/key material (SET-6):** **HUMAN**; never print secrets to logs.
- **Multi-day permanence / gateway propagation:** out of scope for a CI run; reads may lag (soft-assert).

See [UAT-HARNESS.md](UAT-HARNESS.md) for the exact commands, env, and the tester-agent protocol.
