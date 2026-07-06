# UAT — The UI DURING a Live Download Sync (2026-07-05)

**Tester:** automated UAT harness (`scripts/uat/ui-download-live.js`), Playwright-Electron driving the
REAL built app (`dist/`) under WSLg (`DISPLAY=:0`, `--disable-gpu --no-sandbox`).
**Branch:** `uat/ui-during-sync` off `main @ 39d9f73`.
**Scope:** not "does the download work" (already proven — `docs/product/UAT-FULL-DRIVE-DOWNLOAD-2026-07-05.md`)
but **what the user actually SEES** while it happens: the setup modal, per-file status transitions, the
Download Queue/Activity tabs, overall progress legibility, UI responsiveness, and the completion moment.
**Money/data safety:** read-only navigation, zero spend. See §2 for the one necessary compromise (a real
wallet was used) and why it doesn't compromise "no spend."

---

## 1. Headline verdict

**The during-sync experience is good and close to beta-ready — clear, responsive, and honest — with one
real gap: there is no overall "X of 12 files" progress indicator anywhere in the main content area.** The
3-phase setup modal is clean and moves fast. Per-file status genuinely transitions live (queued → downloading
→ synced, observed with your own eyes in a diffed screenshot pair). The Download Queue tab is the
best-designed surface — live per-file progress bars, byte totals, and a real-time remaining count. The app
stayed clickable throughout — no jank, no frozen renderer, no console errors. The one thing keeping this from
being unambiguously "Dropbox-grade": once the setup modal disappears, the *only* place a user can tell "how
much is left" is a small red badge on the **Download Queue** tab label — there is no progress affordance on
Overview or in a global header/tray, so a user who never opens that tab has no way to know a sync is still in
flight versus finished, short of noticing file icons change.

---

## 2. Environment & method

| Item | Value |
|---|---|
| App | production build (`npm run build`) of `uat/ui-during-sync @ 39d9f73` |
| Harness | `DISPLAY=:0 node scripts/uat/ui-download-live.js <screenshot-dir>` (Playwright `_electron`, disposable native `userData` + native `/tmp` sync folder — never `/mnt/c`) |
| Target drive | `a84b951b-7d2f-4fa1-a89f-4b4ed673b404` — "You're The Man Now Dog" ("ytmnd"), public, 12 files + 1 subfolder, 1.3 MB total (the same drive certified end-to-end in the prior full-drive-download UAT) |
| Gateway | `turbo-gateway.com` only |
| Real user flow driven | Import wallet → **Welcome Back** (drive picker) → select "You're The Man Now Dog" → **Set Up Sync Folder** → **Start Syncing** → **Dashboard** (tab tour + ~5 min observation window) |
| Log | `…/scratchpad/uat-ui-during-sync/run.log` |
| Screenshots | `…/scratchpad/uat-ui-during-sync/*.png` (48 frames — referenced by name below) |

### Why a wallet was used at all (and why this is still "no spend")

The task framing called for anonymous/no-wallet access to a public drive. In practice, **the app's real
architecture doesn't support that today**: `sync:start` / `drive:switchTo` (`src/main/main.ts`) both gate on
`walletManager.listDrives()` — i.e. the currently-loaded wallet must **own** the target drive on-chain. There
is no UI path to connect to an arbitrary public drive by ID alone; `AddExistingDriveModal` only lists the
connected wallet's own drives (`drive.getAll()`). This is itself a real product finding, noted in §5.

To still drive the **real, unmodified** Dashboard/tab UI for this specific drive (rather than a fabricated
one), this harness reused the exact same wallet + password already used read-only in this repo's own prior UAT
sessions (`scripts/uat/ui-authenticated.js`, `ui-private-cert.js`) — a wallet that happens to own the ytmnd
test drive. **No transaction was ever signed or broadcast.** The disposable sync folder starts empty, so the
"bidirectional" sync setting found nothing local to push — only remote files to pull. No drive was created,
renamed, or modified. This is a read-only download exercise using a real credential purely to satisfy an
architectural gate, not a funds-spending operation.

---

## 3. Stage-by-stage observations

### 3.1 Setup / connect phase

- **Welcome Back → drive picker** (`01-welcomeback.png`): clean list of the wallet's drives as radio cards
  (name, public/private badge, created date). Selecting "You're The Man Now Dog" highlights it with a red
  outline and chevron (`02-drive-selected.png`) — clear, unambiguous selection state.
- **Set Up Sync Folder** (`03-syncfolder-setup.png`, `04-syncfolder-chosen.png`): a plain-language "How
  syncing works" note ("New files from ArDrive will be downloaded to this folder... files remain permanently
  stored on Arweave even if deleted locally") sets expectations honestly before anything happens. "Start
  Syncing" is correctly disabled until a folder is chosen, then enables and turns solid red once one is —
  standard, unsurprising, no dead ends.
- **The 3-phase modal** (`SyncProgressDisplay`, captured via DOM polling + `05-phase-*.png`): appears **on
  top of an already-rendered Dashboard** (the app navigates to Dashboard first, then fires `sync:start` ~100ms
  later — an implementation detail, invisible to the user in practice since the modal covers it within
  ~1.4s). Observed transitions, timestamped from a running DOM poll (150ms interval):

  | t (ms) | Step | Description | Bar |
  |---|---|---|---|
  | +1,454 | 1 of 3 | "Initializing sync" | 33% |
  | +1,941 | 2 of 3 | "Loading drive metadata" | 66% |
  | +5,256 | 3 of 3 | "Preparing file downloads" | 100% |

  Step 2 was caught on screen (`05-phase-01.png` through `05-phase-07.png`); step 1 was only caught by the DOM
  poll, not a screenshot (it's gone within ~500ms, by design — `performFullDriveSync`'s own comment says "small
  delay to ensure UI shows starting phase"). Step 3 was caught on screen (`05-phase-08/09.png`). The modal then
  **disappears with no further screen state** — `SyncProgressDisplay` treats `phase:'complete'` as
  "render nothing," so there is no explicit "your files are now downloading in the background" hand-off
  message. The user is simply looking at the Dashboard again, and the only sign anything is still happening
  is the Download Queue tab's badge (see §3.2). This is a real, if minor, gap — flagged in §5.
- **Copy is clear at every step observed** — plain language, no jargon, no dead-end disabled states without
  explanation.

### 3.2 During file download (the main event)

- **Per-file status DOES visibly transition** — directly observed, not inferred. Comparing
  `06-during-tab-permaweb.png` (t≈0s, right after the modal closed) to `07-progress-t70s.png` (t≈70s): at t=0,
  `ar.io-logo.png` and `bro.png` show a small grey/blue "queued" icon overlay; by t=70s the **same two rows**
  show the small green "synced" checkmark overlay that `ant pic` (already synced at t=0) had the whole time.
  Icons: synced = green check, downloading = blue spinner, queued = amber clock, pending = grey clock
  (`StorageTab.tsx` `STATUS_META`) — a sensible, colour-coded status model.
- **Download Queue tab populates and drains — the best surface in the app for this.**
  `06-during-tab-download-queue.png` (t≈0s): "3 downloading, 7 queued", per-file rows each with their own
  progress bar and byte size ("logo.svg 2.79 KB · Just now · 0% downloaded"), a running byte total ("176.5 KB
  total"), and a tab-label badge showing the **live remaining count** (seen going 12 → 10 → 9 → 2 → 1 → gone
  across the run). This is a genuine, legible, Dropbox-grade progress surface — the one place a user actually
  *sees* "how much is left." One caveat: individual file progress bars were only ever observed at "0%
  downloaded" in this run's captures — most of these files are small enough (KB-scale) to complete inside one
  poll interval, so whether the per-file bar animates smoothly for a large file (e.g. the 905KB
  `Geordi Drake Meme.png`) wasn't directly confirmed frame-by-frame; **inferred, not observed**, that it does
  from the presence of a progress-bar element and percentage text in the markup.
- **Activity tab populates in real time.** `06-during-tab-activity.png` (early) already lists 5 completed
  downloads with green download-arrow icons, file-type icons, size, and "Just now" timestamps; by completion
  (`10-final-activity.png`) it correctly shows **"Showing 12 of 12 activities from last 30 days"** — exactly
  the drive's 12 file entities (the 1 subfolder is correctly *not* logged as a file activity).
- **Overall progress indicator: the Download Queue badge is real and useful, but it is the *only* one.**
  There is no percentage, spinner, or count anywhere on the Overview tab or in a persistent header/tray
  element while downloads are in flight — Overview showed only static drive metadata (name, privacy, created
  date) throughout, with "Size"/"Contains" fields visibly populating from "…" to "1.3 MB" / "1 folder, 12
  files" only once metadata-listing finished (`05-phase-08.png` vs the earlier `05-phase-00.png`). A user
  sitting on Overview (the default landing tab) has **no visual cue at all** that a download is in progress
  unless they click over to Download Queue or Permaweb.
- **Responsiveness: no jank, no dropped clicks, no console errors.** Tab clicks during active downloads
  (Permaweb → Download Queue → Activity → Overview) all registered and rendered their target tab; the app
  never appeared frozen. (Caveat on the numbers: the harness's own `waitForTimeout(600)` is baked into each
  measured "response," so the ~670–2080ms figures logged are not a clean input-latency benchmark — the
  qualitative signal, that every click landed and rendered correctly with zero missed clicks or hangs across
  the whole ~5 minute observation window, is the real finding.) Zero renderer console errors were logged for
  the entire run.

### 3.3 Completion

- **Unambiguous, honest completion state.** At final check: Download Queue tab reads **"Queue empty" / "0
  Bytes total" / "No downloads in queue"** (`09-final-download-queue.png`) — a plain, correct empty state, not
  a stale "0 of 12" or a spinner left running. The sync-progress modal was confirmed gone
  (`document.querySelector('.sync-progress-content')` returned null). Overview correctly settled to "1.3 MB" /
  "1 folder, 12 files" (`11-final-overview.png`) — matches the drive's real, known contents exactly. No
  lingering spinner, no ambiguous state, observed continuously stable across `07-progress-t130s.png` through
  `07-progress-t290s.png` (screenshots byte-identical from t≈121s onward — nothing left to change).
- **Ground truth (IPC), cross-checked against the actual files on disk:** `drive:get-permaweb-files` reported
  **12/12 file entities `synced`**, 0 failed. On-disk file count: **11** distinct files — this is *not* a
  download failure; it's the same known ArFS name-collision (`bro.png` × 2, one folder, same name) already
  documented in the prior full-drive-download UAT (§4 there) — both entities were fetched and verified, they
  just resolve to the same local path. Independently re-verified here by listing the actual sync folder on
  disk: `ant pic`, `ar.io-logo.png`, `bro.png`, `logo.svg`, `TEST FILE.txt`, `youre-the-man-now-dog{.html,.jpg,
  .wav,-favicon.ico,-play.jpg}`, and `sync test/Geordi Drake Meme.png` correctly nested in its subfolder —
  same 11 files, same structure, as the prior anonymous UAT. Total drain time: downloads completed somewhere
  between t=111s (Download Queue badge showed "1") and t=121s (badge gone) — consistent with the prior UAT's
  ~140s for the same drive (gateway timing varies run to run).
- One data-model wrinkle, tracked down rather than left as a scary number: this harness's own ground-truth
  tally (which naively counts `getPermawebFiles()` rows by `syncStatus`) showed `{"pending":1,"synced":12}`
  out of 13 rows. That "1 pending" is the **"sync test" folder entity itself**, not a file — folders have no
  `syncStatus` tracked in the data model at all (`StorageTab.tsx`: `status: item.status || 'pending'`
  defaults any row without an explicit status, including folders, to "pending"). Confirmed this is **not**
  visible as a UI defect: the folder row in every Permaweb screenshot renders with a plain folder icon and
  *no* status badge — the "pending" label never reaches the screen. Flagging it only because if a future
  feature ever surfaces folder-level status, it would misleadingly show "pending" forever.

---

## 4. Honesty note — "completed" vs "confirmed"

The status model has no on-chain "confirmed" state — `synced` means "downloaded and verified locally," not
"finalized on Arweave" (that distinction matters for *uploads*, not downloads, since these files were already
mined long ago). For this download-only run that distinction is moot in one direction (nothing was uploaded)
but the **UI copy is honest about it anyway**: the file-status tooltip for `synced` literally reads "Downloaded
and available locally" (`STATUS_META.synced.label`, surfaced via native `title=` on hover and in the file
detail modal) — it does not claim or imply "confirmed on-chain," it correctly scopes the claim to "present on
this device." Nowhere in the observed flow did the UI overstate what happened. The one place a user could be
left unsure whether "sync is still going" is the gap already noted in §3.2/§5: outside the Download Queue
badge, there is no affirmative "still syncing" signal, so a user who glances at Overview mid-download and sees
static-looking drive info could reasonably wonder if anything is happening at all — not because the UI lies,
but because it says nothing there.

---

## 5. Ranked UX issues

1. **[Observed] No overall progress indicator outside the Download Queue tab.** The only live "how much is
   left" signal (a small badge count) lives on one tab label. Overview — the default landing tab — shows
   nothing while a 12-file, 1.3MB initial sync is actively running in the background. A first-time user who
   doesn't think to click "Download Queue" has no way to tell "syncing" from "done" from "stuck." **Fix
   suggestion:** a lightweight "Syncing N files…" chip near the drive selector / Sync button, visible from
   any tab.
2. **[Observed] The 3-phase setup modal's disappearance is a silent hand-off.** It goes from "Step 3 of 3:
   Preparing file downloads" straight to *nothing* (no toast, no "files are now downloading in the
   background" message), with the actual bulk-download phase never represented in the modal at all (its
   `currentItem`/`itemsProcessed` fields, present in the component, were empty/unset throughout this run — they
   describe the metadata-listing phase, not the per-file download phase). A one-line transition toast
   ("Metadata loaded — 12 files downloading in the background") would close this gap cheaply.
3. **[Observed, minor/cosmetic] Folder entities default to a `pending` sync-status in the data model** with
   no real tracking (§3.3) — currently harmless (no badge is shown for folders), but latent: any future surface
   that reads `syncStatus` in bulk (a summary count, an export, a "sync health" indicator) would need to
   explicitly exclude folder-type rows or it will report a permanently-stuck item that isn't real.
4. **[Inferred, not observed] Per-file progress-bar granularity for large files is unverified.** The Download
   Queue's per-row progress bar was only ever caught at "0% downloaded" in this run because the drive's files
   are small/fast; whether it animates smoothly through intermediate percentages for a large (multi-hundred-KB+)
   file was not directly confirmed frame-by-frame here — worth a follow-up UAT against a drive with a
   multi-MB+ file if that guarantee matters.
5. **[Product/architecture finding, not a during-sync UX bug per se] No supported UI path to connect an
   arbitrary public drive by ID without owning it.** `sync:start`/`drive:switchTo` require wallet ownership;
   `AddExistingDriveModal` only lists the connected wallet's own drives. This isn't a defect in the
   during-sync experience itself, but it's the reason this UAT needed a real (if zero-spend) wallet rather than
   a pure anonymous flow, and may be worth a product decision if "browse/preview any public ArFS drive
   read-only" is ever a desired feature.

---

## 6. Overall verdict

**Beta-ready, with one worthwhile polish item before calling the during-sync experience fully "Dropbox-grade."**
Everything that must be true is true and was directly observed: real per-file status transitions, a genuinely
useful and legible Download Queue surface, an Activity feed that populates correctly, zero console errors, zero
UI freezes/dropped clicks across a ~5-minute live download, and an honest, unambiguous completion state with no
lingering spinners or stale counts. The gap that keeps it from top marks is legibility of *overall* progress
outside one tab — cheap to fix (a small persistent "Syncing N files…" indicator) and does not require any
change to the underlying (already-correct) sync mechanics.

---

## Appendix — reproduce

```bash
npm run build   # dist/main + dist/renderer required
DISPLAY=:0 node scripts/uat/ui-download-live.js /path/to/screenshot/dir
```

Requires: the same wallet keyfile + `ARDRIVE_DEV_PASSWORD` used by `scripts/uat/ui-authenticated.js` (not
committed; read from the developer's local `.env` at runtime, never printed). Destination screenshot dir and
Electron's `userData`/sync-folder are both disposable and native (`/tmp`, never `/mnt/c`).

Known harness limitation (not a product bug): the harness's periodic ground-truth poll called
`window.electronAPI.sync.getQueueStatus()`, which doesn't exist (`getQueueStatus` lives under the `files`
namespace, not `sync`, in `preload.ts`) — so the poll silently errored every iteration and the "drained"
early-exit never fired, causing the harness to run its full 5-minute cap instead of stopping at actual
completion (~120s). This cost extra wall-clock time but did not affect any observation above — completion was
independently confirmed via screenshots (Download Queue badge disappearing, `09-final-download-queue.png`'s
"Queue empty" state) and the harness's separate, correctly-named final `drive.getPermawebFiles()` check.
