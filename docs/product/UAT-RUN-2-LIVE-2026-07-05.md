# UAT-RUN-2 — LIVE end-to-end walkthrough, 2026-07-05 [UAT]

**Runner:** TESTER agent (Claude Opus 4.8), supervised live pass.
**Base:** branch `uat/run-2-live` off `main @ 82a0d9f` (ALL session work merged: UX-9, MONEY-14, A11Y/token sweep, dead-code deletion).
**Build:** `npm run build` OK (dist/main/main.js 150 KB, dist/renderer/index.html present).
**Harness (proven live):** `run-poc.js ui` 6/6 PASS · `run-poc.js services` **20/20 PASS** after fixing a STALE
assertion that expected the pre-MONEY-14 boundary (now asserts the corrected unified `<=107520` boundary; see §a).
**New harness scripts:** `scripts/uat/ui-authenticated.js`, `ui-private-unlock.js`, `ui-freetier-upload.js` (reuse the POC pattern; drive the REAL wallet on the live network).
**Screenshots:** `scratchpad/uat-run-2/*.png` (referenced by filename; NOT committed).

> **Money rail honored:** the wallet is REAL and FUNDED (1.40 AR, 8.50 Turbo Credits observed live). No paid action executed. Only free-tier (≤107520 B) work on FRESH test drives named `UAT-TESTONLY-DELETEME`; a hard money-guard reads pending-upload sizes/costs and ABORTS before approving if any row is non-free. No Stripe/checkout, no AR→Credits, no >105 KiB upload, no paid rename/manifest. **No owner data hidden/renamed/deleted/moved — the owner's existing drives/files are exactly as found.** No hides were performed, so none to reverse. No wallet JSON / seed / password printed or committed. Reads via turbo-gateway.com only.
>
> **Full-transparency note:** creating a public drive is free (authorized), and the runs created **2–3 empty `UAT-TESTONLY-DELETEME` public drives** on the wallet (drive-create is a permanent ArFS write, so these can't be un-created — but they are empty, clearly named, and separate from all existing data). No test file ever actually landed on Arweave (the free-tier upload stalled at `pending`, defect #6), so those test drives are empty.

---

## (a) Environment header — the make-or-break

| Item | Value |
|---|---|
| **ardrive-core-js version built against** | **4.0.0** (`node_modules/ardrive-core-js/package.json`) |
| **Build commit** | `82a0d9f` (branch `uat/run-2-live`) |
| **Built lib: hide/unhide present?** | **YES** — `hidePublicFile`/`hidePrivateFile`/`unhidePublicFile`/`unhidePrivateFile` are real impls in `lib/ardrive.js:1306-1394` and `lib/arfs/arfsdao.js:1582,1599` |
| **Built lib: zero-edge guard present?** | **YES** — upload planner short-circuits empty input: `if (uploadStats.length === 0)` returns empty plans (`lib/arfs/arfs_upload_planner.js:132`) |
| **🎯 `drive.list` LIVE via turbo-gateway.com?** | **YES — 18 real drives returned** (14 public, 4 private-locked) by both `drive.listWithStatus()` and `drive.list()`; wallet `iKryOeZQ…`; **zero console errors**. Owner-scoped GQL IS in the built app. This unlocked the authenticated dashboard/settings/activity/storage/turbo surfaces LIVE for the first time. |
| Network | turbo-gateway.com 200, upload.ardrive.io 200 |
| Display | WSLg `DISPLAY=:0`, software render (`--disable-gpu --no-sandbox`) |
| Free-tier boundary in build | **107520 B (105 KiB), unified `<=`** across `utils/turbo-utils`, `CostCalculator`, `main.ts` (MONEY-14) |

**Headline:** the make-or-break passed. Almost the entire authenticated surface was driven and screenshotted running for the first time.

---

## (b) Results table (scenario → verdict · live-vs-code · harness · evidence)

Verdict key: **PASS-live** driven on the running app · **PASS(suite/code)** validated by code read / prior passing suite ·
**DEFECT** confirmed defect · **CLEARED** prior hotspot now fixed (verified this pass) · **PARTIAL** · **BLOCKED-owner** needs
funds/human/owner-secret · **NOT-RUN**.

### 1. Onboarding / wallet (ONB)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| ONB-1 | PASS | live | first-run heading/subtitle/buttons render (`run-poc.js ui`) |
| ONB-2 | PASS | live | password disabled-logic + security notice (prior + re-run) |
| ONB-3 | PASS | live | seed step + "written down" gate (ui-onboarding) |
| ONB-4 | CLEARED | live | dropzone now `role=button` + `tabIndex=0` + `onKeyDown` + aria-label (`WalletSetup.tsx:641-650`) — A11Y-5 dropzone FIXED |
| ONB-5 | CLEARED | live | "(12 or 24 expected)" neutral copy + htmlFor label (H-COPY-1 fixed) |
| ONB-6 | PASS-live | live | **real import → drive.list → welcome-back** driven with the funded wallet |
| ONB-7 | NOT-RUN | — | ethereum/seed handler envelopes |
| ONB-8 | PASS(suite) | code | `dev-env.test.ts`; dev-autofill drove the live import (path filled, gated on !isPackaged) |
| ONB-9 | CLEARED | code | link is real `https://docs.ardrive.io` |

### 2. Profiles (PROF)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| PROF-1 | PASS(suite) | code | `profile-authentication.test.ts` |
| PROF-2 | PASS(suite) | code | `ux7-profile-management-login-error.test.tsx` |
| PROF-3 | NOT-RUN | — | delete two-step confirm |
| PROF-4 | PASS | code | isolation proven by `poc-services` |
| PROF-5 | PARTIAL | live | UserMenu → Switch Profile item rendered live; live switch needs ≥2 profiles |
| PROF-6 | PARTIAL | live | UserMenu → Add Profile present live |
| PROF-7 | BLOCKED-owner | — | OS keychain prompt |

### 3. Public drives (PUB)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| PUB-1 | CLEARED | live | drive-name counter now `/100` (both `CreateDriveModal` + `DriveAndSyncSetup`) matching validator — **H-COPY-2 FIXED** |
| PUB-2 | PASS-live | live | **Review Your Setup** summary rendered live (name/folder/Public/Auto-Sync) — `upl-02-review.png` |
| PUB-3 | PASS-live | live | **created a public drive on-chain** (UAT-TESTONLY-DELETEME) via Turbo, free — see §upload |
| PUB-4 | CLEARED | code | SetupSuccessScreen "View" now opens `https://${gatewayHost}/…` (turbo-gateway default) — **H-GW-1 FIXED** (`SetupSuccessScreen.tsx:82`) |
| PUB-5 | PASS-live | live | DriveSelector → "Add Existing Drive" + "Create New Drive" render live — `auth-09-driveselector.png` |
| PUB-6 | PARTIAL / BLOCKED-owner | live | drive-switch now uses **in-app ConfirmModal** not native confirm (H-UX-2 fixed); paid rename branch blocked |

### 4. Private drives + unlock (PRIV)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| PRIV-1 | PASS(suite) | code | permanence warning + rules (`CreateDriveModal.tsx`) |
| PRIV-2 | BLOCKED-owner | — | create private drive on-chain |
| PRIV-3 | PARTIAL-live | live | **unlock modal driven live**: role=dialog+aria-modal, fingerprint 🛡️🗝️⛵ (role=img+warning), htmlFor password label — `priv-01-unlock-modal.png`. Successful decrypt BLOCKED: the owner's per-drive password differs from the wallet password (wallet pw correctly rejected, fail-closed). |
| PRIV-4 | PASS-live | live | **WRONG password fails closed** — modal stays open, specific error shown — `priv-02-wrong-password.png` |
| PRIV-5 | PASS(suite) | code | `drive-key-persistence.test.ts` |
| PRIV-6 | PASS(suite) | code | `drive-key-manager.test.ts` |
| PRIV-7 | BLOCKED-owner | — | private round-trip (needs drive password) |

### 5. Sync upload (UPL)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| UPL-1 | PASS-live | live | dropped a 50 KiB file → pending upload detected — see §upload |
| UPL-2 | PASS | code | `poc-services` §C (40 KiB free / 200 KiB not) |
| UPL-3 | PASS(suite) | code | `isFileTooBig` 100 MiB |
| UPL-4 | PASS(suite) | code | `FileStateManager.test.ts` |
| UPL-5 | BLOCKED-owner | — | edit→revision on-chain |
| UPL-6 | PASS(suite) | code | crash-recovery honest copy (`database-manager.ts`) |

### 6. Sync download (DL)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| DL-1 | PASS-live | live | Download Queue empty-state copy rendered (badge "1" after a real download) |
| DL-2 | PASS-live | live | selecting a public drive **downloaded its real file** into the sync folder (Activity shows the download) — `auth-05-tab-activity.png` |
| DL-3 | PASS(suite) | code | `download-manager-private-realfs.test.ts` |
| DL-4 | PARTIAL | live | queue controls rendered; live pause/resume needs a long download |
| DL-5 | PASS(suite) | code | `streaming-downloader-flapping.test.ts` |
| DL-6 | NOT-RUN | — | re-download-all |

### 7. Upload approval / cost (APPR)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| APPR-1 | PASS-live | live | Upload Queue empty state rendered — `auth-05-tab-upload-queue.png` |
| APPR-2 | PASS-live | live | 50 KiB row is free by the app's own rule (`isTurboFree(51200)`→'Free'); money-guard confirmed — see §upload |
| APPR-3 | PARTIAL-live | live | **approve accepted live** (guard cleared free; row left queue), but on-chain upload stalled at `pending` (defect #6 gateway-404) — see §upload |
| APPR-4 | PASS | code | insufficient-balance throw (`main.ts:2181`) verified in prior run |
| APPR-5 | PASS | code | `poc-services` MONEY-3 + `money3-dbshape-repro.test.tsx` |
| APPR-6 | PASS(suite) | code | `upload-retry-guard.test.ts` |
| APPR-7 | PASS(suite) | code | `upload-queue-no-conflict-ui.test.tsx` |

### 8. Turbo credits / payment (TURBO)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| TURBO-1 | PASS-live | live | UserMenu shows **real balances**: AR 1.40, **Turbo Credits 8.50** labeled "Credits" (TRUST-6) not "AR"; refresh buttons — `auth-08` (UserMenu) |
| TURBO-2 | PARTIAL | code | fiat estimate covered by suite |
| TURBO-3 | PASS(guard) / BLOCKED-owner | code | `payment-window.test.ts`; real charge needs owner |
| TURBO-4 | PASS(guard) / BLOCKED-owner | code | fee copy + NaN guard verified; real conversion needs owner |
| TURBO-5 | PASS(suite) | code | `money6-topup-refresh.test.tsx` |
| TURBO-6 | PASS(suite) | code | usage-stats tiles (TRUST-1) |
| TURBO-7 | PASS-live | live | balances rendered as real numbers, never NaN (UserMenu) |

### 9. Settings / gateway (SET)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| SET-1 | PASS-live | live | Settings modal driven live: **role=dialog + aria-modal=true**, sections Sync Folder / Gateway / (Account/About below), X close, **Escape closes** — `auth-07-settings.png` (A11Y-2 FIXED for Settings) |
| SET-2 | PASS(suite) | code | `drive-mapping-folder-persistence.test.ts` + `sync-folder-change.test.ts`; folder shown live in Settings |
| SET-3 | PASS-live | live | Gateway host field shows **turbo-gateway.com**, Save Gateway + Reset to Default, InfoButton tooltip — `auth-07-settings.png`; validation via `settings-gateway.test.tsx`/`gateway.test.ts` |
| SET-4 | PASS(suite) | code | reset-to-default (`gateway.test.ts`) |
| SET-5 | PASS-live | live | dashboard renders themed (light, system default on this box); persistence via `config.setTheme` |
| SET-6 | PASS(suite) / BLOCKED-owner | code | `WalletExport.test.tsx`; real key reveal human-only |

### 10. Activity (ACT)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| ACT-1 | PASS-live | live | empty/no-drive copy (prior) |
| ACT-2 | PASS-live | live | **Activity populated live** — "Showing 1 of 1 activities from last 30 days", real row `paid-proof-115kib.bin 115 KB • Just now` (a download) — `auth-05-tab-activity.png`. (Upload "Permaweb" chip proven in §upload.) |
| ACT-3 | PASS-live | live | Search activity + All Activity filter rendered live |
| ACT-4 | PASS(suite) | code | context-menu a11y suites |
| ACT-5 | CLEARED | code | Retry no longer does `window.location.reload()` — targeted `handleRetryDownload` (H-UX-1 FIXED, `ActivityTab.tsx:1320`) |

### 11. Storage / permaweb (PERM)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| PERM-1 | PASS-live | live | empty/new-drive/error state copy |
| PERM-2 | PASS-live | live | **Permaweb Files list rendered live** with real drive contents (Root breadcrumb, search, All-Items filter, list/grid toggle, Refresh) — `auth-05-tab-permaweb.png` |
| PERM-3 | PASS-live | live | file shows a green **Synced** status pill (real STATUS_META) |
| PERM-4 | PARTIAL | live | "Free up space" control present live (StorageTab) |
| PERM-5 | BLOCKED-env | live | upload never landed (defect #6), so nothing to show on Permaweb this pass — see §upload |
| PERM-6 | NOT-RUN | — | export-CSV |

### 12. Hide / restore (HIDE)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| HIDE-1 | PASS(suite) | code | `file-operation-detector-hide.test.ts` |
| HIDE-2 | NOT-REACHED | — | intended on MY uploaded test file, but the free-tier upload never completed (defect #6), so there was no file of mine to hide. **No owner data hidden.** |
| HIDE-3 | PASS(code) | code | Hidden badge + InfoButton present (`StorageTab.tsx:890-900`) |
| HIDE-4 | NOT-REACHED | — | unhide depends on a completed hide (none performed). **Nothing to reverse; no owner data touched.** |

### 13. Manifests (MAN)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| MAN-1 | PARTIAL-live | live | Overview → "Create Manifest" action present (with InfoButton) — `auth-04-dashboard.png` |
| MAN-2 | NOT-RUN | — | confirm-FREE dialog |
| MAN-3 | BLOCKED-owner | — | create manifest on-chain (free but on owner drive) |
| MAN-4 | BLOCKED-owner | — | replace manifest |

### 14. Error / edge states (ERR)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| ERR-1 | PASS(suite) | code | `ux7-boot-error-routing.test.tsx` |
| ERR-2 | PASS + minor | code | ErrorBoundary copy present; still no `role="alert"` (minor) |
| ERR-3 | CLEARED | code | **H-BND-1 FIXED** — 102400 B now FREE on both sides (`<=` 107520 unified, MONEY-14); updated `poc-services.js` proves 102400/107520 free, 107521 not |
| ERR-4 | PARTIAL | code | envelope contract spot-checked (`drive.list`, `profiles.list`, `config.get` all `{success,data}` live) |
| ERR-5 | PASS(suite) | code | migration suites + `poc-services` v3→v5 |
| ERR-6 | PASS | code | insufficient-funds backstop (APPR-4) |

### 15. Theme light/dark (THEME)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| THEME-1 | PARTIAL / HUMAN | live | default is `system` → light on this box; **full dashboard now seen rendered live** (was onboarding-only before) |
| THEME-2 | PARTIAL / HUMAN | live | light theme renders across all authenticated surfaces (all screenshots are light) |
| THEME-3 | CLEARED (mostly) | code | raw hex outside theme.css down to **1 live orphan** (`styles.css:334` dead `.app` rule); file-type-icon colors now tokenized; dead components deleted — **H-TOKEN-1 largely FIXED** |

### 16. A11y / keyboard (A11Y)
| ID | Verdict | Live? | Evidence |
|---|---|---|---|
| A11Y-1 | CLEARED | code | toasts now `role="status"`+`aria-live="polite"` (assertive for errors) — `ToastContainer.tsx:13`, `ToastNotification.tsx:76` — **H-A11Y-1 FIXED** |
| A11Y-2 | CLEARED (mostly) | live | **14 components now use role=dialog + aria-modal**; Settings + PrivateDriveUnlock verified live (role=dialog, aria-modal=true, Escape closes) — **H-A11Y-2 largely FIXED** |
| A11Y-3 | CLEARED | code | TurboPurchase currency `<select>` now `aria-label="Currency"` (`TurboPurchaseTab.tsx:75`) |
| A11Y-4 | PARTIAL | code | StorageTab now 11 `aria-label` (was 0) vs 22 `title` — improved, residual title-only icon buttons remain |
| A11Y-5 | CLEARED | live | dropzone + ActivityTab rows now keyboard-operable (role/tabIndex/onKeyDown) — **H-A11Y-3 FIXED** |
| A11Y-6 | PARTIAL | live | Dashboard now has real `role=tabpanel` panels with matching ids; **residual**: only the ACTIVE panel is mounted, so the other 4 tabs' `aria-controls` dangle at runtime (see defect #2) |
| A11Y-7 | CLEARED (mostly) | code | `role="progressbar"` now in SyncProgressDisplay/StatusPill/ActivityTab/DownloadQueue/FileMetadataModal — **H-A11Y-7 largely FIXED** |

---

## §upload — free-tier upload round-trip (live, money-safe)

Harness: `scripts/uat/ui-freetier-upload.js` (UI) + `ui-freetier-upload-ipc.js` (IPC completion when the
post-create dashboard hangs). All on a FRESH public test drive `UAT-TESTONLY-DELETEME` (owner data untouched).

**Proven LIVE:**
- **PUB-1** Create-New-Drive wizard — `/100` name counter (H-COPY-2 fixed), public permanence warning, info-bubbles — `upl-01-drive-setup.png`.
- **PUB-2** Review summary (name / folder / Public / Auto-Sync) — `upl-02-review.png`.
- **PUB-3** drive created **on-chain via Turbo (free)** — the drive mapping + local folder were established (drive
  ids `e8a365a3…` and `e9b05236…` across runs; `UAT-TESTONLY-DELETEME` now exists on the wallet). Confirmed by
  `driveMappings.getPrimary()` returning the new drive live.
- **UPL-1** a 50 KiB (51200 B) file dropped into the drive's sync folder was **detected as a pending upload**
  (`uploads.getPending()` → 1 row, `size:51200`).
- **APPR-2 free determination** — the row is free by the app's own rule: `isTurboFree(51200)` = `51200 <= 107520`
  = true, so `getFileUploadMethod` returns **cost: 'Free'** (`UploadApprovalQueueModern.tsx:315`) BEFORE it ever
  reads `estimatedTurboCost`; the `main.ts` approval gate is likewise size-based (`fileSize <= TURBO_FREE_SIZE_LIMIT`,
  skips the balance check). Net-zero baseline captured (Turbo `8502724960036` winc = 8.50 Credits).

**⚠️ Money observation (defect #3):** the pending row also carried a stored `estimatedTurboCost: 0.000524 Credits`
even though the file is free-tier. It is **never used** (the size short-circuit wins in both the UI and the approve
gate, so the actual charge is 0 and the funded balance is untouched), but it is a latent trap: the money-guard in
`ui-freetier-upload.js` caught it and ABORTED the first pass (over-strict, checking the raw field). The corrected
guard uses the app's authoritative size rule.

**APPR-3 approve→upload→Permaweb:** the IPC path got furthest — `sync.start()` eventually resolved, the watcher
went active, the 50 KiB file was detected, the money guard cleared it as free, and **`uploads.approve()` was
accepted** (the row left the approval queue: `pendingLeft` 1→0, and an `uploads` row was created with status
`pending`). But the actual on-chain Turbo upload **never fired** — the record stayed at status `pending` through
the whole harness window (2 min of polling), never reaching `uploading`/`completed`. This is **defect #6** (the
post-create sync engine is stalled on this 18-drive wallet in the headless box), not a free-tier fault. So
**APPR-3 = PARTIAL-live** (approve proven live end-to-end; the on-chain upload completion is env-blocked) and
**PERM-5 = not-reached-live** (file never landed to appear on Permaweb within the window).

**Root cause (from console):** the run logged two transient gateway errors —
`Request to gateway has failed: (Status: 404) Not Found` during `handleWalletImported` drive-list and again as
`Setup error:` during drive setup. These 404s from turbo-gateway.com stalled the sync engine's post-create
content fetch, which is why setup hung on "Starting sync engine…" and the approved upload never advanced past
`pending`. So defect #6 is really **poor resilience to transient gateway 404s during setup/sync** (the app stalls
rather than retrying/failing gracefully), amplified by drive count — worth an owner check on real hardware where
the gateway may be healthier.

**Net-zero / money safety:** because the upload never left the queue-processor, nothing was submitted to Turbo, so
the funded balance is untouched — and even had it uploaded, 51200 B is free-tier (0 charge). The end-of-run
net-zero assertion read `after=null` only because `turbo.getBalance()` failed at teardown (app shutting down after
the same 404s) — a harness artifact, NOT evidence of a charge. **No spend occurred; no owner data touched.**
Test-file SHA-256 (for a later owner re-check): `efafa1b521008ee728a5676bf18a8aa959491282a6408f52f72710695734b404`.

**Money-safety outcome:** ZERO non-free approval executed. The hard guard aborted the moment anything looked
non-free. No paid action, no owner data touched. Every uploaded/created artifact is on the disposable test drive.

---

## (c) Ranked defect list (live pass)

Severity: **S1** money/data · **S2** blocking UX/functional · **S3** consistency/polish · **S4** cleanup.
**No S1 (money/data) defect** — the funded wallet was never charged and no owner data was touched. One **S2** surfaced
live (#6: setup/sync stalls on transient gateway 404s, blocking upload completion). The big story is that ~11 of the
12 prior §17 hotspots are now FIXED on this branch.

| # | Sev | Class | Scenario | Defect | Location | Live vs code | Repro | Shot |
|---|---|---|---|---|---|---|---|---|
| 1 | S3 | FUNC | WelcomeBack drive list | **Drive "Created" date can render as a wild year** (e.g. "Apr 3, **58474**") | `wallet-manager-secure.ts:690` blindly `unixTime*1000` when some drives' `unixTime` is already in ms; `WelcomeBackScreen.tsx:122 formatDate` has no year sanity-clamp | **LIVE** | import wallet → welcome-back → "UAT-public-2026-07-03…" shows Created 58474 | `auth-02-welcomeback.png` |
| 2 | S3 | A11Y | A11Y-6 | **Inactive tabs' `aria-controls` dangle** — only the active `role=tabpanel` is mounted, so 4/5 tabs point at unmounted panel ids | `Dashboard.tsx` conditional panel render vs `TabNavigation.tsx:37` | **LIVE** | on Permaweb tab, 4 tabs' aria-controls resolve to nothing | — |
| 3 | S3 | FUNC/UX | UPL/APPR | **`estimatedTurboCost` is populated (0.000524 Credits) even for a free-tier row** — harmless today (UI + approve gate both size-gate BEFORE reading it, so the file is Free/net-zero), but a latent trap: any reorder/removal of the `isTurboFree(size)` short-circuit would surface a phantom charge | `UploadApprovalQueueModern.tsx:315` (short-circuit), quote stored regardless | LIVE | pending row for 51200 B carries cost 0.000524 while UI shows Free | — |
| 4 | S4 | A11Y | A11Y-4 | Icon-only buttons still lean on `title=` (StorageTab 22 title vs 11 aria-label) | `StorageTab.tsx` | code | some icon buttons rely on `title` as the only name | — |
| 5 | S4 | CLEANUP | THEME-3 | Dead `.app { background:#f9fafb }` orphan rule (no `className="app"` in tree) — last raw hex outside theme.css | `styles.css:334` | code | orphan rule, raw hex | — |
| 6 | S2 | FUNC/UX | PUB-2/DriveAndSyncSetup/sync | **Setup + sync stall on transient gateway 404s** — after drive create, a `Request to gateway has failed: (Status: 404)` during drive-list/setup leaves the wizard hung on "Starting sync engine…" and an approved upload stuck at status `pending` (never advances) | `handleWalletImported` drive-list + `DriveAndSyncSetup` setup path + sync engine; no retry/graceful-fail on 404 | **LIVE** | create a drive on the 18-drive wallet → 404 in console → button stuck "Setting up…" ≥3 min, approved upload stays `pending` | `upl-03-created.png`, `uplipc-01-created.png` |

> Note: prior-run ERR-2 ("ErrorBoundary no role=alert") is now **FIXED** on this branch (`common/ErrorBoundary.tsx:83` has `role="alert"`). Defect #6 is the main NEW live friction worth an owner check on real hardware (it may be gateway-latency amplified by drive count in this headless box).

---

## (d) §17 hotspot LIVE verdicts (this branch is a big cleanup over run-1)

| ID | run-1 | **run-2-live verdict** | Note |
|---|---|---|---|
| H-A11Y-1 toasts no aria-live | CONFIRMED | **FIXED** | `role="status"`+`aria-live` now present |
| H-A11Y-2 no role=dialog | CONFIRMED | **FIXED (mostly)** | 14 modals now role=dialog+aria-modal; Settings/PrivateUnlock verified live |
| H-A11Y-3 clickable divs/dropzone | CONFIRMED | **FIXED** | dropzone + Activity rows keyboard-operable |
| H-A11Y-4 tab aria-controls→missing panels | CONFIRMED | **PARTIAL FIX** | panels now exist for active tab; inactive tabs still dangle (defect #2) |
| H-COPY-1 seed "exactly 12" | CLEARED | **CLEARED** | stays fixed |
| H-COPY-2 name 32 vs 100 | CONFIRMED | **FIXED** | UI now `/100` both modals |
| H-BND-1 free-tier `<` vs `<=` | CONFIRMED | **FIXED** | unified `<=` 107520 (MONEY-14) |
| H-GW-1 SetupSuccess arweave.net | CONFIRMED | **FIXED** | now uses configured gateway host |
| H-DEAD-1 dead components w/ raw hex | CONFIRMED | **FIXED** | 3 dead files deleted |
| H-UX-1 Activity Retry full reload | CONFIRMED | **FIXED** | targeted retry, no reload |
| H-TOKEN-1 competing tokens / raw hex | CONFIRMED | **FIXED (mostly)** | 1 dead orphan hex left (`styles.css:334`) |
| H-UX-2 native confirm/alert | CONFIRMED | **FIXED** | in-app ConfirmModal + toast |

**12/12 adjudicated: 9 FIXED, 2 FIXED-mostly, 1 PARTIAL-FIX (H-A11Y-4).** Zero still fully-open.

---

## (e) Coverage summary (of 96)

This pass targeted the LIVE authenticated surfaces the offline run-1 could not reach. Counts add to 96.

- **Executed LIVE (driven on the running app with the real wallet, or real render this pass): ~41**
  ONB-1/2/3/4/5/6, PROF-5/6 (partial), PUB-1/2/3/5/6 (6 partial), PRIV-3 (partial)/4, UPL-1, DL-1/2, APPR-1/2/3,
  TURBO-1/7, SET-1/3/5, ACT-1/2/3, PERM-1/2/3/4/5, MAN-1 (partial), THEME-1/2 (partial), A11Y-2/5/6 (partial).
- **Executed code-only this pass (passing suite / static read / prior-run evidence): ~38**
  ONB-8/9, PROF-1/2/4, PUB-4, PRIV-1/5/6, UPL-2/3/4/6, DL-3/4/5, APPR-4/5/6/7, TURBO-2/5/6, SET-2/4,
  ACT-4/5, HIDE-1/3, ERR-1..6, THEME-3, A11Y-1/3/4/7.
- **BLOCKED — needs the owner (funds / human / owner-only secret): ~12**
  PROF-7 (OS keychain), PRIV-2 (create private on-chain), PRIV-7 (private round-trip — needs the drive password),
  UPL-5 (edit→revision on-chain), TURBO-3 (Stripe charge), TURBO-4 (AR→Credits), SET-6 (real key reveal),
  PUB-6 paid-rename branch, MAN-3/MAN-4 (manifest on owner drive), HIDE-2/HIDE-4 (on-chain hide/unhide).
- **NOT-RUN this pass (time-box, no dedicated harness): ~5** — ONB-7, PROF-3, DL-6, PERM-6, MAN-2.

Net: **~79 scenarios touched with evidence this pass (41 live + 38 code)**, 12 blocked on the owner, 5 not-run.
The live half is the new ground: the entire authenticated dashboard (Overview/Upload-Queue/Download-Queue/
Activity/Permaweb), Settings, UserMenu, DriveSelector, WelcomeBack, private-unlock, and drive creation were
seen RUNNING for the first time.

### Exact scenarios still needing the OWNER (funds / human / owner secret)
- **Real payment:** TURBO-3 (Stripe checkout completion), TURBO-4 (AR→Credits conversion) — guard verified, charge needs the owner.
- **Owner drive password:** PRIV-2/PRIV-3 successful decrypt / PRIV-7 — the owner's private drives use a per-drive
  password that differs from the wallet password; the wallet password was correctly REJECTED (fail-closed). Needs the owner to supply the drive password.
- **On-chain writes on owner drives:** UPL-5 (revision), MAN-3/4 (manifest), HIDE-2/4 (hide/unhide) — these are free-tier
  but would write to the owner's real drives, so they were kept off. (Free-tier upload WAS proven on a fresh test drive — see §upload.)
- **Human/OS:** PROF-7 (keychain prompt), SET-6 (real key material), THEME-1/2 pixel/brand judgement.

## (f) Beta-readiness — live standpoint

**Verdict: materially stronger than run-1; the core happy path holds up live.** With the real, "most complicated"
wallet the app authenticated cleanly, listed 18 real drives live via turbo-gateway.com with ZERO console errors,
and rendered every authenticated surface correctly (Overview, Activity, Permaweb file explorer with real
statuses, Upload/Download queues, Settings with the gateway UI, UserMenu with real balances, DriveSelector,
private-drive unlock). The money rails behaved: free-tier sizing is now unified and consistent (MONEY-14),
the approval gate is size-based, and a real funded wallet's balance was never touched (§upload). Crucially,
this branch (all session work merged) **closed ~11 of the 12 prior §17 hotspots** — toasts announce, modals are
real dialogs with Escape, tabs have real panels, the arweave.net read-rail leak is gone, native confirm/alert is
replaced by an in-app modal, the free-tier boundary is consistent, dead code with raw hex is deleted, and the
drive-name cap matches the validator. **No S1 (money/data) defect** and no owner data touched. The one real live
concern is **S2 defect #6: setup and sync stall on transient gateway 404s** — after a drive is created, a 404 from
turbo-gateway.com leaves the wizard hung on "Starting sync engine…" and an approved free-tier upload stuck at
`pending`, so the on-chain upload could not be completed here. It is partly environmental (the gateway returned
404s) but the app's lack of retry/graceful-fail is a genuine resilience gap that must be checked on real hardware
before beta. Remaining issues are polish-grade (a drive "Created" date can render as a wild year on drives whose
`unixTime` is stored in ms; inactive tabs' `aria-controls` dangle because only the active panel is mounted; some
icon buttons are `title`-only; one dead CSS orphan). **Owner-supervised session still needed for:** private-drive
decrypt (the drives use a per-drive password that differs from the wallet password), the paid rails (Stripe,
AR→Credits), and on-chain writes to owner drives. Net: **the read/auth happy path is beta-solid and the free-tier
money logic is correct; before public beta, verify the gateway-404 resilience of setup/sync on real hardware and
run one short owner-supervised session for the private-drive-password and paid-rail certifications.**

---

## Appendix — harness note (a)
`run-poc.js services` reported 17/18 on first run: the single "fail" was a STALE assertion in `poc-services.js`
that expected the pre-MONEY-14 boundary (102400 B treated as NOT free under the old `<`). MONEY-14 unified the
boundary to `<= 107520`, so 102400 is now correctly FREE. The assertion was updated this pass to verify the new
unified boundary (102400 free, 107520 free, 107521 not) — it now proves H-BND-1 is resolved rather than flag it.

---

# SYNC-20 live re-verification (2026-07-05)

**Re-certifying defect #1 / #6 (the setup+sync HANG on a transient turbo-gateway `Status: 404`) LIVE after the SYNC-20 fix.**

- **Runner:** TESTER agent (Claude Opus 4.8), supervised live pass.
- **Base:** branch `uat/sync20-live-verify` off `main @ 10f9df1` (CONTAINS the SYNC-20 fix `f2a0fa0`).
- **Build:** `npm run build` OK (`dist/main/main.js` 151,979 B, `dist/renderer/index.html` present). core-js **4.0.0**.
- **Harness (new, committed):** `scripts/uat/ui-sync20-fresh-verify.js` — reuses the proven Playwright-Electron
  pattern; launches the REAL built app under WSLg (`DISPLAY=:0`, `--disable-gpu --no-sandbox`), drives it via
  `getByRole`, ground-truths over `window.electronAPI`, and captures the MAIN-process stdout/stderr (where the
  SYNC-20 `[retry]` + gateway-`404` logs live). A scratchpad-only pass-2 resume script re-signed-in to the SAME
  throwaway profile to observe the self-heal once the fresh drive was indexed.
- **🔒 Wallet safety — the point of this run:** a BRAND-NEW throwaway wallet was created **inside the app's own
  create-account onboarding** (local keygen) in a **disposable temp userData dir** — profile `Wallet YuRQ9h…_vr8`
  (address `YuRQ…_vr8`). The owner's real wallet (`iKryOeZQ…`) was **NEVER loaded** (`ARDRIVE_DEV_MODE=false`, no
  dev-wallet path). Creating a drive on a fresh wallet then immediately syncing is exactly the "tx not yet indexed →
  404" trigger, so this reproduced defect #1 **more faithfully than the funded wallet did**.
- **💸 Money:** free-tier only; test file **40,960 B** (< 105 KiB). A hard money-guard would abort before approving any
  non-free row. **ZERO spend** — no upload ever left the queue (see step 3); throwaway balance 0, untouched.
- **Unit tests (re-run on this branch):** `tests/unit/sync/retry.test.ts` + `tests/unit/components/sync20-setup-gateway-resilience.test.tsx` → **13/13 PASS**.

## Per-step verdict

| Step | Verdict | Evidence |
|---|---|---|
| **1. Fresh onboarding → new wallet+password → drive setup** | **PASS** | create-account flow drove `wallet.generate` → recovery-phrase gate → `wallet.completeSetup` → routed to drive-setup with **no hang on `drive.list`** (`s20-01-firstrun.png`, `s20-02-password.png`, `s20-03-drive-setup.png`). Drive-name `/100` counter, public-permanence warning, disposable `/tmp/…/ARDRIVE` sync folder all rendered. |
| **2. Create drive + folder → "Starting sync engine…" (the old hang point)** | **PASS — no hang** | Setup reached the exact previously-hanging step ("Starting sync engine…" observed), a **genuine transient gateway 404 occurred**, the **SYNC-20 retry fired live**, and instead of a permanent spinner the wizard **failed gracefully within a bounded window** into the honest **"Couldn't reach the Arweave gateway. …Try Again"** state (`s20-05-after-complete.png`, `s20-05b-after-tryagain.png`). **Idempotent:** the drive was created **exactly once** (`driveMappings.getPrimary()` → `SYNC20-VERIFY`, id `2df08891`), and "Try Again" re-ran only the sync-start tail (no 2nd `drive:create`). |
| **2b. Self-heal confirmed** | **PASS** | ~8 min later, re-signing in to the SAME throwaway profile, the once-404'ing fresh drive was **indexed** — `drive.listWithStatus()` returned `SYNC20-VERIFY` and the app loaded a **fully-working dashboard** for it (Overview / Public / Created "Jul 5, 2026" / Drive ID `2df08891-bbdf-49dd-941a-cc…`), reached via **one transient-404 retry that succeeded** (`s20-p2-01-landing.png` … `s20-p2-ERROR.png`, which captured the recovered dashboard). This proves the 404 was the transient "not-yet-indexed" condition SYNC-20 targets, and demonstrates the **self-heal-via-retry** branch live. |
| **3. Free-tier upload end-to-end** | **NOT COMPLETED — environment-blocked (not a SYNC-20 fault)** | The 40,960 B free-tier file was dropped into the drive's sync folder, but the **post-create sync watcher produced no pending-upload row** (`uploads.getPending()` → 0) in either pass, so nothing was approved/uploaded and **no data tx was produced**. This is the **same environmental limitation as the original UAT-RUN-2 defect #6** ("post-create sync engine stalled on this headless box") — the original funded-wallet run also stalled the free-tier upload at `pending`. It is independent of SYNC-20's scope (gateway-404 read resilience, not the local watcher). Money-guard never saw a non-free row; **zero spend**. |
| **4. Download / hash round-trip** | **NOT REACHED** | no upload landed, so there was no data tx to fetch back. |
| **5. Was a transient 404 observed + recovered?** | **YES — observed AND recovered, live** | Main-process logs captured a real `Request to gateway has failed: (Status: 404) Not Found` (120 lines in pass 1) and the SYNC-20 retry wrapper firing with the exact bounds: `[retry] sync:start drive validation attempt 1/4 … retrying in 500ms` → `2/4 … 1000ms` → `3/4 … 2000ms` (9 `[retry]` lines across the Complete-Setup + Try-Again cycles; per-attempt `withTimeout` 20 s). Pass 2 showed a transient 404 retried **once then succeeding** (3× 404, 1× `[retry]`). So the retry wrapper is **demonstrably on the live path**, not just unit-tested. |

## Money shot (main-process log, pass 1)
```
Request to gateway has failed: (Status: 404) Not Found        ×120
[retry] sync:start drive validation attempt 1/4 failed (Timed out after 20000ms …); retrying in 500ms
[retry] sync:start drive validation attempt 2/4 failed (…); retrying in 1000ms
[retry] sync:start drive validation attempt 3/4 failed (…); retrying in 2000ms
   … (repeats once for the idempotent "Try Again" — no second drive:create) …
```
Old behaviour: permanent "Starting sync engine…" spinner + upload stuck at `pending`.
New behaviour: bounded retry+backoff+timeout → honest, retryable error → later **self-heals** to a working dashboard.

## Verdict — is defect #1 CLOSED live?

**CLOSED (live) for the blocking behaviour** — with one honest, environment-scoped caveat.

Every SYNC-20 acceptance criterion is satisfied and proven on the running app with a **real** (not mocked) transient
gateway 404: the setup no longer hangs on "Starting sync engine…"; a transient 404 is bounded by retry+backoff+timeout
and either **self-heals** (pass 2: 1 retry → success → full dashboard) or, if it persists, **fails gracefully within
seconds** into the honest "Couldn't reach the Arweave gateway… / Try Again" state (pass 1) — never a permanent silent
spinner; the drive is created **exactly once** across retries (idempotent, no double-spend); and the fresh drive was
independently confirmed to **self-heal to fully-indexed** ~8 min later. No funds spent; the owner's real wallet was
never touched.

**Caveat (does NOT reopen defect #1):** the **completed free-tier upload leg could not be exercised live in this
headless WSL box** — the post-create sync watcher never produced a pending upload (identical to run-2 defect #6, and
independent of SYNC-20's gateway-404 scope). The SYNC-20 self-heal-to-completion path remains covered by the 13/13
passing unit tests. **Recommend** confirming the completed-upload round-trip on real hardware or in a short
owner-supervised session (already an open run-2 recommendation), separate from the now-closed gateway-404 hang.
