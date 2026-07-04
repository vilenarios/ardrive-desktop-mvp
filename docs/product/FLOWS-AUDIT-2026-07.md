# ArDrive Desktop — UX Flow Audit (2026-07-04)

Read-only, code-level audit of the core user journeys. Every finding is anchored to a real
file:line on current `main` (audited via the `wt-main` worktree, commit `e6c95d5`). Findings are
grouped by journey; severity tags are **broken** / **confusing** / **friction** / **polish**.
Where a finding duplicates or confirms an existing `docs/product/BACKLOG.md` item, that's called
out explicitly with the ID — those are included only because they add a sharper file/line or a
previously-unlisted instance. Everything else is a genuinely new finding.

---

## JOURNEY 1 — Onboarding (`WalletSetup.tsx`)

### F1. [NEW · broken] "Create Account" fully provisions a wallet+profile before the user ever confirms the recovery phrase; going Back and retrying silently creates a second, orphaned account
- `src/renderer/components/WalletSetup.tsx:391` (Step 2 "Create Account" button) → `handleCreateWallet` → `window.electronAPI.wallet.generate(password)`
- `src/main/preload.ts:14-17` — `generate` maps to `wallet:create-new`; **`completeSetup` (the Step 3 "Continue to Drive Setup" button, line 516/525) is a hardcoded stub: `completeSetup: () => Promise.resolve(true)`.**
- `src/main/wallet-manager-secure.ts:50-76` (`generateNewWallet`) → `84-214` (`importFromSeedPhraseInternal`): this function does the **real work** at Step 2, before the seed phrase is even shown — it creates a brand-new profile (`profileManager.createProfile`, line 146), sets it active, and writes the encrypted wallet to disk (`writeEncryptedFile`, line 171). Step 3's "I have written down my recovery phrase" checkbox and "Continue" button are pure UI theater — the account already exists on disk regardless of whether the box is checked.
- **Consequence:** if the user clicks "Back" from Step 3 (`WalletSetup.tsx:505-513`) and clicks "Create Account" again, `generateNewWallet` runs a second time with a **new** BIP39 phrase → a new address → `profileManager.createProfile` doesn't find a matching profile → creates a **second profile with its own encrypted wallet**, silently, with no warning that the first one (whose recovery phrase the user may have already written down) still exists but is now orphaned in the profile list.
- Also: if the app is closed/crashes between Step 2 and Step 3, a fully-functional wallet+profile now exists that the user never saw the recovery phrase for, and (per Settings) the only place to view it again is `WalletExport` — worth confirming that path works for a profile the user doesn't remember creating.
- **Fix (deeper):** move the actual wallet/profile creation to `handleCompleteWalletCreation` (after confirmation), or explicitly warn before regenerating ("this replaces the account you just created — did you save its phrase?") and clean up the abandoned profile if the user backs out.

### F2. [NEW · polish] Dead link on the welcome screen
- `WalletSetup.tsx:336` — "Need help? Check out our **getting started guide**" is `<a href="#">`. Clicking it does nothing (or jumps to top of page). Quick win: link a real doc or remove the sentence.

### F3. [polish] Duplicated 8-char password-minimum logic
- `WalletSetup.tsx:392` and `:765` hardcode `password.length < 8` in button `disabled` conditions, duplicating `ClientInputValidator.validatePassword`. Not user-visible today, but a future validator change (e.g. raising the minimum) has to be updated in 3+ places across the codebase (see F10 for the drive-name regex, same pattern).

---

## JOURNEY 2 — Drive selection / creation (`DriveSelector.tsx`, `PrivateDriveUnlockModal.tsx`, `CreateDriveModal.tsx`, `AddExistingDriveModal.tsx`)

### F4. [confirms/sharpens DESIGN-4 & DESIGN-7 · broken in dark mode] Hardcoded `backgroundColor: 'white'` in drive-selection surfaces + a genuine gap in the DESIGN-4..7 fan-out plan
DESIGN-2/3 (both `done`) shipped the dark-theme token layer and ported `WalletSetup.tsx` only; DESIGN-4..7 (`todo`) are supposed to port the rest. This audit's file list gives exact, ready-to-fix targets:
- `src/renderer/components/DriveSelector.tsx:97` (button) and `:131` (dropdown) — literal `'white'`, while the text next to it uses `var(--gray-900)` → `var(--text-primary)`, which is **near-white (`#fafafa`) in dark mode** (the app's default theme, per `theme.css:11-14`). Result: white-on-white, effectively unreadable.
- `src/renderer/components/PrivateDriveUnlockModal.tsx:88` — same pattern, on the password-entry modal for a **security-critical** flow.
- `src/renderer/components/CreateDriveModal.tsx:180`, `AddExistingDriveModal.tsx:118,313` — same pattern.
- **Genuine gap, not just a dup:** `WelcomeBackScreen.tsx:156,364,430` and `SetupSuccessScreen.tsx:58,270,322,374,403` have the identical bug, but neither file is obviously in scope for DESIGN-4 ("dashboard shell + tabs + drive selector"), DESIGN-5 (upload/turbo), DESIGN-6 (permaweb/activity/storage), or DESIGN-7 (settings+modals+toasts+user menu) — and DESIGN-3's "done" scope was explicitly `WalletSetup.tsx` + its internal steps, not these separate components. Every returning user sees `WelcomeBackScreen` at boot; it will ship dark-mode-broken unless someone explicitly claims it. **Recommend an explicit line item (or folding into DESIGN-4) for `WelcomeBackScreen.tsx` + `SetupSuccessScreen.tsx`.**
- Full grep of `backgroundColor: 'white'` / `background: 'white'` across `src/renderer/components` turned up ~20 files; the above are the ones on the audited journeys. Quick win for whoever picks up DESIGN-4..7: `grep -rn "backgroundColor: 'white'\|background: 'white'" src/renderer/components` is the exact worklist.

### F5. [NEW · friction, needs Phil's sign-off] "Create Drive" defaults to Private
- `CreateDriveModal.tsx:18` — `useState<'public'|'private'>('private')`. A first-time drive creation defaults to the option that carries "**this password cannot be changed or recovered — if you forget it you permanently lose access to all files**" (the warning shown at lines 378-387), rather than the simpler, no-password-loss-risk Public option. This is a deliberate-looking product choice, not obviously a bug — flagging for a design call, not a quick-fix.

### F6. [NEW · friction] Drive-password fields don't reuse the app's own strength-meter component
- `CreateDriveModal.tsx:392-454` hand-rolls password/confirm inputs with only submit-time validation (`validatePassword`, line 58-75). `WalletSetup.tsx` already has a shared `PasswordForm`/`PasswordInput` with a live strength meter (`showStrength`) — not reused here, despite the drive password being *more* permanent than the wallet password (no re-encrypt path exists for a lost drive password at all). Quick win: swap in `PasswordForm`.

### F7. [NEW · friction] No cost disclosure before drive creation
- `CreateDriveModal.tsx` (whole file) never shows an estimated fee before the user clicks "Create Drive," even though the action writes a real metadata transaction (paid via Turbo, per D-010) and PRIV-3's evidence explicitly notes "user pays" for private-drive creation. Compare to the Upload Approval Queue (Journey 4), which prominently shows cost before every paid action. Quick win: even a one-line "This creates a small on-chain transaction" note, ideally with the actual quoted cost.

### F8. [NEW · confusing] No escape hatch if drive creation hangs
- `CreateDriveModal.tsx:544` — the Cancel button is `disabled={isCreating}`, same pattern UX-8/UX-9 already flag for the sync-progress modal. If `drive.createPrivate`/`drive.create` (main.ts) never resolves (network stall), the user is stuck on a modal reading "Creating..." with no way to close it.

### F9. [confirms UX-3, still present] Hardcoded unlock error text
- `PrivateDriveUnlockModal.tsx:35` (`'Invalid password. Please check your password and try again.'` on any `false` return) and `:46` (`'Failed to unlock drive. Please try again.'` in the `catch` block) both discard the real error from `drive:unlock` — confirms UX-3's note verbatim, and additionally shows the *thrown-error* path (line 46) has the exact same problem as the *false-return* path UX-3 already documented.

### F10. [polish] Drive-name validation is oddly restrictive, duplicated in two files
- `CreateDriveModal.tsx:39` and `DriveAndSyncSetup.tsx:98` both use `/^[a-zA-Z0-9\s\-_]*$/` — no periods, apostrophes, parentheses, or non-ASCII characters allowed in a drive name (e.g. "Phil's Files", "Q1.2026", or any non-Latin script name would be rejected). Distinct from the path-traversal (`..`) defense noted under PRIV-3/SEC-9 — this is a separate, probably-too-strict client-side rule.

---

## JOURNEY 3 — Sync lifecycle

### F11. [NEW · broken, high impact] There is no UI control anywhere to pause or stop continuous sync
- `src/main/preload.ts:94` exposes `window.electronAPI.sync.stop()` (`sync:stop`), fully wired to a backend handler — but a repo-wide grep of `src/renderer` for `sync.stop(` returns **zero call sites**.
- The Dashboard header's "Sync" button (`Dashboard.tsx:790-810`) calls `sync.manual()` — a one-shot manual pass, not a start/stop toggle.
- The floating sync-status widget (`Dashboard.tsx:1046-1124`) *displays* a "Sync Paused" state (`:1075-1080`, `Pause` icon + label) purely as a **read-only** reflection of `syncStatus.isActive` — there's no button anywhere that would let a user *reach* that state on purpose, nor a "Resume" control to leave it.
- `Settings.tsx` only ever calls `sync.setFolder` and `sync.start` (never `sync.stop`).
- **Net effect:** once sync starts (automatically at every boot — see F12), a user who wants to intentionally pause syncing (finish editing a large file before it uploads, work offline on purpose, save bandwidth) has no lever except quitting the entire application. This is a real gap in the "sync lifecycle" journey, distinct from anything in SYNC-*/PRIV-* backlog items (those are about correctness of an already-running sync, not about user control over its lifecycle).

### F12. [NEW · broken] "Enable Auto Sync" onboarding toggle is never persisted — it's fabricated, like MONEY-4's removed Auto Top-Up
- `DriveAndSyncSetup.tsx:24` (`useState(true)`), `:526` (the checkbox), `:197-202` (branches on it to decide whether to call `sync.start()` **during setup only**).
- `SetupSuccessScreen.tsx:177-189` proudly displays "Auto Sync: Enabled/Disabled" as if it were a saved setting.
- Grep confirms `enableAutoSync`/`autoSync` is **never written to config or the database** anywhere in `src/main` — the `autoSync?: boolean` field in `database-types.ts:52` is declared but nothing ever sets it.
- **Consequence:** if a user unchecks "Enable Auto Sync" during setup, `App.tsx:219` still calls `window.electronAPI.sync.start()` unconditionally on the very next boot (`initializeApp`), regardless of the user's choice. The preference has zero effect beyond the current onboarding session. This is the same class of bug as the already-fixed MONEY-4 (fake Auto Top-Up "saved" confirmation) and MONEY-11 (fabricated Usage Statistics) — recommend treating it as a sibling item.

### F13. [sharpens UX-13] No connectivity/offline indicator anywhere in the renderer
- Repo-wide grep for `offline`/`navigator.onLine`/`isOnline` under `src/renderer` returns nothing. UX-13 currently scopes this to "show 'unavailable', not `0 AR`" for balances specifically; the gap is broader — there is no general "you're offline" signal anywhere in the UI, which compounds F11 (a user who intentionally wants to work offline has no way to signal that, and no way to confirm the app noticed).

---

## JOURNEY 4 — Upload approval queue (`UploadApprovalQueueModern.tsx`, `Dashboard.tsx`)

This journey is the most heavily hardened part of the app (MONEY-1/2/3/6 all landed real fixes here — FREE/paid labeling, per-row insufficient-balance messaging with a top-up link, honest "estimate unavailable" states). The remaining gaps are sharper than the money-correctness class already fixed:

### F14. [NEW · confusing→broken] "Clear All" silently rejects every pending upload, no confirmation, sits next to the primary action
- `UploadApprovalQueueModern.tsx:848-870` — "Clear All" (→ `onRejectAll` → `Dashboard.tsx:617-624` → `uploads.rejectAll()`) fires immediately on click, no `confirm()`, no modal, no undo. It renders in the same flex row as, and directly adjacent to, the primary "Approve & Upload" button (`:872-948`).
- The label "Clear All" reads like "clear the list view," not "permanently reject every queued file" — the actual semantics (does a rejected file get re-queued automatically if it changes again, or is it gone until the user re-touches it?) aren't disclosed anywhere in the UI.
- **Fix (quick win):** add a confirm step (in-app, not `window.confirm`) and rename to something unambiguous like "Reject All."

### F15. [NEW · confusing] Approve/reject error feedback is inconsistent across four near-identical handlers in the same file
- `Dashboard.tsx:576-585` (`handleApproveUpload`) — catch block only `console.error`s. Silent to the user.
- `Dashboard.tsx:587-594` (`handleRejectUpload`) — same, silent.
- `Dashboard.tsx:596-615` (`handleApproveAll`) — uses a blocking native `alert()` for both the partial-failure case and the catch block.
- `Dashboard.tsx:617-624` (`handleRejectAll`) — silent again.
- All four have `toast` available (it's a prop on this exact component, and used nearby at lines 429, 459, 493, 520) — none of the four use it. A user whose single reject or reject-all silently fails sees nothing wrong; the file just sits there with no explanation. Quick win: replace all four with `toast?.error(...)`.

### F16. [sharpens UX-14 · confirms a second instance] Metadata editor is unreachable here too
- `UploadApprovalQueueModern.tsx:12-13` imports `MetadataEditor`/`MetadataTemplateManager`; `:65-66` declares `showMetadataEditor`/`showTemplateManager` state — neither is ever set to a truthy value or rendered anywhere else in the file. UX-14 cites `Dashboard.tsx:636-639`; this is an independent second dead code path for the same unreachable feature, worth folding into the same fix.

### F17. [hygiene, not user-facing] `UploadApprovalQueue.tsx` (~1300 lines, the pre-"Modern" version) is dead code
- Confirmed via grep: nothing imports it. Includes the same hardcoded-white dark-mode bug as its replacement, but since it's unreferenced, no user is affected. Worth deleting during any DESIGN-5 pass to avoid future confusion about which file is live.

---

## JOURNEY 5 — Dashboard (Overview/Storage/Activity/DownloadQueue tabs, profile switching, user menu)

### F18. [NEW · broken, high impact] Returning users with a locked/private primary drive see a false "No drives found" on the Welcome Back screen
- `WelcomeBackScreen.tsx:28` — `const [drivesLoading, setDrivesLoading] = useState(!initialDrives)`. Since the caller always passes an array (even an empty one), `!initialDrives` evaluates `![]` → **`false`** — the loading skeleton is skipped from the very first render.
- `WelcomeBackScreen.tsx:32-46` — the mount effect only calls `loadDrives()` (the real backend fetch) when `initialDrives` is literally `undefined`; if it's `[]`, the `else` branch treats that empty array as **final, authoritative data** and never fetches.
- `App.tsx:145-188` (`initializeApp`) routes to `'welcome-back'` in exactly two cases: the primary mapped drive is private **and currently locked** (line 162-170), or every drive is private (176-187) — and in **neither branch does it ever call `setDrives(driveList)`** (confirmed by grepping all 3 `setDrives(` call sites in `App.tsx`; none are in `initializeApp`). So `WelcomeBackScreen` receives `initialDrives={drives}` where `drives` is still its original `[]` from `useState<DriveInfoWithStatus[]>([])` — never populated for this path.
- **Net result:** `WelcomeBackScreen` renders the "No drives found. Create your first drive to start syncing files" empty state (`:396-460`) with a "Create New Public Drive" button — for a user who has a real (but locked) private drive. Since `startSyncMonitoring()` (which registers the `onDriveUpdate` listener that's the only other path that populates `drives`) isn't called until the dashboard is reached, this isn't a brief flash — it's a **persistent** wrong state until the user does something else.
- **Why this matters more than it looks:** PRIV-4 (drive-key persistence) is still `todo`, so a private drive is **locked on every single app restart** by default. This isn't an edge case — it's the default returning-user experience for anyone using a private drive in the beta (which D-010 explicitly puts in scope). A user could easily click "Create New Public Drive" believing they have no drives, ending up with a redundant drive while their real one sits invisible.
- This is distinct from PRIV-5 ("locked drives must not sync as empty," which is about the *sync engine* not silently completing an empty sync) — this bug is in the **welcome-back drive list UI**, a different code path entirely.
- **Fix (quick win):** in `App.tsx`, call `setDrives(driveList)` before both `setAppState('welcome-back')` returns in `initializeApp`. In `WelcomeBackScreen.tsx`, change the loading-state check from `!initialDrives` to `!initialDrives || initialDrives.length === 0` combined with actually calling `loadDrives()` as a fallback/verification when the array is empty, so an empty array is never blindly trusted as "no drives."

### F19. [sharpens UX-5, very concretely] `UserMenu` has 5 dead props — this is *why* Profile Switcher is unreachable
- `UserMenu.tsx:29-32,41` accept `onSwitchProfile`, `onAddProfile`, `profileCount`, `onCreateDrive`, `onShowWalletExport` — none of the five are referenced anywhere in the component's render body (confirmed by grep against the full file).
- Concretely, this means `Dashboard.tsx`'s `ProfileSwitcher` modal (rendered at `:1127-1143`) is **100% unreachable** in the shipped app: its only trigger is `handleSwitchProfile` (`Dashboard.tsx:413-415`, `setShowProfileSwitcher(true)`), which is passed to `UserMenu` as `onSwitchProfile` — and `UserMenu` never calls it. There's no menu item, no button, nothing. The fix for UX-5's "wire UserMenu menu items" is literally "add five `<button>`s that call the five props already being passed in."
- Also dead: `onShowWalletExport` — wallet export IS reachable, but only via `Settings` (a separate wiring, `Dashboard.tsx:835-838`), making this a redundant/confusing prop rather than a missing feature.

### F20. [sharpens UX-5] Even with UserMenu fixed, a successful profile switch wouldn't refresh the dashboard
- `Dashboard.tsx:1130-1133` — `ProfileSwitcher`'s `onProfileSwitch` callback does nothing but `setShowProfileSwitcher(false)`. The comment says "The profile switch will trigger app reload via main process," but nothing in this call chain (`ProfileSwitcher.tsx:85` → `profiles.switch` → this callback) triggers a reload, a re-run of `App.initializeApp()`, or any state refresh. This confirms UX-5's "post-switch stale renderer" concern with the exact dead-end line.

### F21. [confirms/broadens UX-11] UserMenu's manual balance-refresh buttons discard their own result — for **both** AR and Turbo, not just Turbo
- `UserMenu.tsx:85-95` (`handleRefreshARBalance`) and `:97-107` (`handleRefreshTurboBalance`) both `await` an IPC call and then do nothing with the result — no state update, no callback to parent. The spin animation (`isRefreshingAR`/`isRefreshingTurbo`) completes, giving the appearance of a successful refresh, but the displayed `walletBalance`/`turboBalance` (props from `Dashboard`) never change. UX-11 names only "UserMenu turbo refresh doesn't update displayed balance" — this confirms the identical bug also affects the AR refresh button.

### F22. [NEW · confusing, cross-cutting] Copy-to-clipboard feedback is silent/inconsistent in three separate places
- `dashboard/OverviewTab.tsx:121-127` (`copyToClipboard`, used at `:380` for "copy drive ID") — no toast, no state change, despite this component receiving a `toast` prop that IS used for other actions in the same file.
- `dashboard/ActivityTab.tsx:389-419` (`handleShareFile`, "Share"/copy-link context menu action) — `// TODO: Add toast notification for copied link` (line 412); only a `console.log`.
- `dashboard/StorageTab.tsx:888-894` ("Copy ArDrive link" quick action) — `// TODO: Add toast notification` (line 892); not even a `console.log`.
- Compare to `WalletSetup.tsx` (button swaps to "Copied!" for 2s) and `UserMenu.tsx` (icon swaps to a checkmark) — both of which get this right. UX-11 currently cites only "Permaweb copy-link feedback console-only" (presumably StorageTab); this broadens it to a 3-file pattern that a single shared `useCopyToClipboard(toast)` hook would fix everywhere at once.

### F23. [sharpens UX-10, currently in-progress] The exact bug and its fix, and a fix instance the in-progress branch should also hit
- `dashboard/ActivityTab.tsx:389-419` (`handleShareFile`) prefers `upload.fileId` over `upload.dataTxId` when building the `arweave.net/...` link — the precise UX-10 bug pattern (dead links when `fileId` is a UUID not a valid gateway path).
- Right next to it, `dashboard/ActivityTab.tsx:421-449` (`handleViewOnline`) gets the precedence **right** (`dataTxId` first, `fileId` fallback) for the "View on Arweave" action on the same activity item.
- Since UX-10 is claimed and in progress (branch `fix/UX-10-copy-link`), flagging this concretely so the fix also covers `ActivityTab.tsx:395-399` and not just wherever its original evidence pointed — the file literally has both the correct and incorrect version of the same precedence check 30 lines apart, a good template for the fix and a regression test.

### F24. [confirms UX-11, pinned to exact call site] Download retry/pause/resume buttons never render
- `dashboard/DownloadQueueTab.tsx:397-433` gates the retry/pause/resume buttons on `onRetryDownload`/`onPauseDownload`/`onResumeDownload` being truthy. `Dashboard.tsx:996-1003` instantiates `<DownloadQueueTab>` passing only `downloads`, `onOpenFolder`, `onSyncDrive` — the three action props are never passed, so the buttons can never appear in the shipped app.

### F25. [confirms UX-9, pinned to exact call site] "Retry Download" / "Remove from Queue" force a full page reload for a single-item refresh
- `dashboard/ActivityTab.tsx:1249` and `:1265` both call `window.location.reload()` after a single `queueDownload`/`cancelDownload` call, just to refresh the activity list. UX-9 already names "ActivityTab retry" — this pins the exact two lines.

### F26. [confirms UX-18, pinned to exact call site] No drive-removal UI in StorageTab
- `dashboard/StorageTab.tsx:40,83` accept `onDriveDeleted` as a prop; grep confirms it is never called anywhere in the file. Matches UX-18's "onDriveDeleted plumbing wired but never invoked" exactly.

### F27. [NEW · polish] Toast IDs can collide within the same millisecond
- `hooks/useToast.ts:8` — `const id = Date.now().toString()`. Two toasts fired in the same tick (plausible from a batch action, e.g. multiple sequential `toast.error()` calls) get the same `id`, causing duplicate React keys in `ToastContainer` and both toasts dismissing together instead of independently. Quick win: use a counter or `crypto.randomUUID()`.

### F28. [polish, likely unreachable] Dead-end copy with no actionable recovery
- `Dashboard.tsx:842-873` — if `selectedDrive` is falsy, the empty state reads "No drive configured. **Please restart the application.**" with no button, not even a relaunch action (Electron supports `app.relaunch()`), and no path back to drive-setup. Likely unreachable today since `App.tsx:711` only renders `Dashboard` when `drive` is truthy, but worth tightening if that guard is ever loosened.

---

## Cross-cutting (App.tsx boot routing — sharpens UX-7)

### F31. [sharpens UX-7] The exact unguarded calls inside `initializeApp`'s single catch-all
- `App.tsx:225-229` — one `catch` around the entire ~150-line `initializeApp`, which includes several awaited IPC calls with **no individual guard**: `drive.listWithStatus` (:125), `driveMappings.getPrimary` (:149), `driveMappings.list` (:153), `drive.isUnlocked` (:163), `sync.getFolder` (:194). A transient failure on *any* of these — for an existing, multi-month user with real data — routes to `'wallet-setup'` (Create/Import screens), not an error+retry screen. Compounding: if that confused user clicks "Create New Account" believing they need to re-onboard, F1 means they'd silently provision a brand-new wallet+profile rather than getting any indication their real account is intact but just failed to load this one time.

### F32. [sharpens UX-7] Two infinite loading spinners, no timeout, no retry, no error state
- `App.tsx:628-648` (initial boot) and `:710,735-754` (post-init dashboard-precondition fallback, rendered whenever `walletInfo && currentProfile && drive` isn't all simultaneously truthy) are both bare spinners with the literal text "Loading..."/"Loading ArDrive...". If any one of those three pieces of state never gets set due to a partial failure inside `initializeApp` or `handleWalletImported`, the user is stuck indefinitely with no error, no retry button, no way out short of a hard restart.

---

## Quick-wins mergeable tonight (small diff, no design/product sign-off needed)

1. **F15** — swap the 4 approve/reject error paths in `Dashboard.tsx` (576-624) to use the already-available `toast` prop instead of silent `console.error`/blocking `alert()`.
2. **F2** — remove or link the dead `href="#"` in `WalletSetup.tsx:336`.
3. **F21** — have `UserMenu`'s `handleRefreshARBalance`/`handleRefreshTurboBalance` actually bubble their fetched result up (or just call the existing `onRefreshWalletInfo`-style callback pattern already used elsewhere in `Dashboard.tsx`).
4. **F27** — replace `Date.now().toString()` with a monotonic counter or `crypto.randomUUID()` in `useToast.ts:8`.
5. **F14** — add an in-app confirm step + rename "Clear All" → "Reject All" in `UploadApprovalQueueModern.tsx`.
6. **F22** — one shared copy-with-toast utility/hook, applied to `OverviewTab.tsx`, `ActivityTab.tsx`, `StorageTab.tsx`.
7. **F18 (partial)** — add the missing `setDrives(driveList)` calls in `App.tsx`'s `initializeApp` before both `welcome-back` routes; this alone fixes the worst part of the bug even before `WelcomeBackScreen.tsx`'s loading-state logic is properly reworked.
8. **F19** — wire the 5 already-passed, already-typed props in `UserMenu.tsx` to actual menu items (Profile Switcher becomes reachable immediately).
9. **F17** — delete the dead `UploadApprovalQueue.tsx`.

## Needs Phil's design/product sign-off (behavior or default changes, not pure bugs)

1. **F5** — whether "Create Drive" should default to Public instead of Private.
2. **F11** — whether/how to expose a pause/stop-sync control (and what "paused" should mean for the floating widget, given it currently only ever shows a state nobody can reach).
3. **F12** — whether "Enable Auto Sync" should be removed (MONEY-4-style) or actually implemented and persisted; this is a product-truthfulness call, same family as already-decided MONEY-4/MONEY-11.
4. **F7** — how much cost-disclosure UI drive creation needs relative to the upload queue's bar.
5. **F18 (full fix)** — beyond the quick patch, whether `WelcomeBackScreen` should proactively re-verify against the backend whenever it receives an empty array, which is a slightly bigger behavioral change than the one-line quick win.

---

## Summary by severity

- **broken:** F1, F11, F12, F18 (4) — plus F14 borderline broken/confusing.
- **confusing:** F9 (confirms UX-3), F14, F15, F19/F20 (sharpens UX-5), F21 (confirms/broadens UX-11), F22, F23 (sharpens UX-10), F31 (sharpens UX-7) (9)
- **friction:** F5, F6, F7, F8, F10, F13 (6)
- **polish:** F2, F3, F16 (confirms UX-14), F17, F24 (confirms UX-11), F25 (confirms UX-9), F26 (confirms UX-18), F27, F28, F32 (sharpens UX-7) (10)

**New findings not previously in the backlog:** F1, F2, F5, F6, F7, F8, F11, F12, F13 (broadens), F14, F15, F18, F22 (broadens), F27, F28, F31/F32 (sharpen) — roughly 16 items.
**Confirmations/sharper-specificity on existing backlog items:** F3(minor), F9→UX-3, F4→DESIGN-4/7 (+ a genuine gap), F16→UX-14, F19/F20→UX-5, F21→UX-11, F23→UX-10, F24→UX-11, F25→UX-9, F26→UX-18, F31/F32→UX-7 — roughly 12 items.
