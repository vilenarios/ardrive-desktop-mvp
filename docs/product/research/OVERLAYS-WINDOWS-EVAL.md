# Native Windows Explorer Overlay Icons for ArDrive Desktop — Technical Evaluation & Plan

**Author:** Windows systems engineering review
**Date:** 2026-07-09
**Scope:** Add green‑check / blue‑syncing / red‑error status badges painted onto files **in Windows Explorer** (not just inside the app), for ArDrive Desktop (Electron 27, electron‑builder 24, NSIS installer).
**Verdict up front:** Ship a **legacy Shell Icon Overlay Handler now**; treat the **Cloud Files (Cloud Filter) API as the deliberate Phase‑2 destination**, aligned with files‑on‑demand (FEAT‑7). Rationale, architecture, and risks below.

---

## 1. Grounding in our data model (the status source of truth)

Overlays are a *rendering* of state we already track. Our per‑file truth lives in the SQLite table `drive_metadata_cache` (per profile).

**Table shape** (`src/main/migrations.ts:98‑120`, and the v7 rebuild at `:339‑362`):

```sql
CREATE TABLE drive_metadata_cache (
  id TEXT PRIMARY KEY,
  mappingId TEXT NOT NULL,
  fileId TEXT NOT NULL UNIQUE,          -- ArFS file id — the event key
  ...
  path TEXT NOT NULL,                    -- ArFS logical path
  localPath TEXT,                        -- the on-disk absolute path  ← overlay maps THIS
  localFileExists BOOLEAN DEFAULT 0,     -- SQLite returns 0/1 INTEGER, not bool
  syncStatus TEXT DEFAULT 'pending'
     CHECK (syncStatus IN ('synced','pending','downloading','queued','cloud_only','error','failed')),
  lastError TEXT,
  ...
);
```

The **seven `syncStatus` values** we must map to a handful of overlay buckets:

| Our `syncStatus` | Meaning | Overlay bucket |
|---|---|---|
| `synced` | Local file present and matches permaweb | ✅ green check |
| `downloading` | Being pulled down now | 🔵 blue syncing |
| `queued` | Queued for download | 🔵 blue syncing |
| `pending` | Known but not yet reconciled / upload in flight | 🔵 blue syncing (or no badge) |
| `error` | User‑actionable sync failure | 🔴 red |
| `failed` | Upload/download failed | 🔴 red |
| `cloud_only` | Deliberately not kept locally | file may not exist on disk → overlay moot (no local path to badge) |

So the realistic overlay set is **3 badges**: `synced`, `syncing`, `error`. That matters — see the 15‑slot limit (§2.1).

**How status changes are produced & emitted today** (already in place, reusable):

- DB writers keyed by `fileId`: `updateFileSyncStatus(fileId, syncStatus, lastError?)` (`database-manager.ts:1794`), `updateDriveMetadataStatus(fileId, syncStatus, localFileExists)` (`:1817`+), `getFilesByStatus(mappingId, syncStatus)` (`:1875`), `getDriveMetadata(mappingId)` (`:1639`).
- Sync engine transitions e.g. `sync-manager.ts:4242/4248/4252` (download → `downloading` → `synced`/`failed`), `:3922/:4131/:4644` (`synced`).
- **A per‑file event channel already exists**: `sync:file-state-changed` with payload `{ fileId, syncStatus }`, emitted from `sync-manager.ts:2221/2252` (cloud‑only toggle) and `sync/DownloadManager.ts:233‑244` (`emitFileStateChange`). Exposed to the renderer as `electronAPI.onFileStateChanged(...)` (`preload.ts:446`).
- Renderer→main IPC follows the D‑005 envelope `{ success, data }` (`main.ts`, e.g. `sync:status` at `:2109`).

**Implication for the overlay design:** we already have (a) a queryable path→status source (`localPath` + `syncStatus`), and (b) a live per‑file change signal. The overlay provider does **not** need new sync logic — it needs a *bridge* that turns these into (i) a fast path→status lookup the shell can hit, and (ii) an Explorer refresh poke.

> ⚠️ **DB‑boundary trap (CLAUDE.md):** node‑sqlite3 returns `localFileExists` as integer `0/1` and nullable columns as `null`. The event carries `fileId`, not `localPath`; the overlay must key on the **normalized local path**, so the bridge must resolve `fileId → localPath` and normalize (lowercase, canonical separators) before publishing. Any test fixtures must be DB‑shaped (integer booleans, nulls).

---

## 2. Approach 1 — Legacy Shell Icon Overlay Handler (in‑proc COM)

### 2.1 How it works
An icon overlay handler is an **in‑process COM object implemented as a DLL** that exports `IShellIconOverlayIdentifier` (plus `IUnknown`). It has exactly three methods ([MS Learn — How to Implement Icon Overlay Handlers](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-implement-icon-overlay-handlers)):

- `GetOverlayInfo(pwszIconFile, cchMax, pIndex, pdwFlags)` — returns the icon file + index; called at init, then when the shell needs to paint. The image is cached in the system image list.
- `GetPriority(pPriority)` — 0..100, tie‑break only. **"Not a reliable way to resolve conflicts between unrelated handlers… there is no way for your handler to determine what priority values other handlers are using."**
- `IsMemberOf(pwszPath, dwAttrib)` — the shell passes a **file path**; return `S_OK` to paint this handler's overlay, `S_FALSE` otherwise.

Key architectural facts that drive everything else:

- **One DLL/CLSID paints exactly one overlay image.** To show 3 states you register **3 handlers** (this is why Dropbox ships `DropboxExt01…10`, OneDrive `OneDrive1…7`, `SkyDrivePro1…3`, Google Drive `GoogleDriveSynced/Syncing/Blacklisted`, TortoiseSVN/Git `Tortoise1Normal…9Unversioned` — [Wikipedia: List of shell icon overlay identifiers](https://en.wikipedia.org/wiki/List_of_shell_icon_overlay_identifiers)).
- **The DLL is loaded *into `explorer.exe`***, runs on the shell's UI path, and is called with **only a path** — it must map path→status itself, **synchronously and very fast**. It has no idea about our DB; it must consult an out‑of‑process status source cheaply (§4).

### 2.2 The 15‑slot global limit (the headline risk)
Overlays are drawn via image‑list overlays, where the style word reserves **4 bits** for the overlay index; one value means "no overlay," leaving **15 slots total**, and **~4 are reserved by the OS**, so in practice only ~**11** third‑party overlays render. Windows picks the **first 15 alphabetically** from the registry key. Raymond Chen's own post: *"It would be a lot of work and we are lazy,"* and notes Windows 10 deliberately **moved OneDrive off overlays to a Status column** to escape the limit ([The Old New Thing — Why is there a limit of 15 shell icon overlays?](https://devblogs.microsoft.com/oldnewthing/20190313-00/?p=101094); [MS Q&A on the limit](https://learn.microsoft.com/en-us/answers/questions/2777426/icon-overlays-in-windows-10)).

**The leading‑space naming war.** Because selection is alphabetical over the subkey **names** under `ShellIconOverlayIdentifiers`, vendors prepend spaces to force their keys to sort first (e.g. `"  DropboxExt01"`, `" OneDrive1"`). A machine with OneDrive + Dropbox + Google Drive + a Tortoise client can *already* exceed 11 slots, at which point a late‑arriving handler **silently never paints** — no error, badges just absent. We would compete by naming our keys with leading spaces (e.g. `"  ArDriveSynced"`, `"  ArDriveSyncing"`, `"  ArDriveError"`), but this is a fragile arms race we cannot win deterministically.

### 2.3 Registration
- Overlays register under **`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers\<Name>`** (default value = the CLSID), plus the normal COM `CLSID\{…}\InprocServer32` entries. **`HKCU` is NOT recognized by Explorer** — there is no per‑user overlay registration ([MS Learn — How to Register Icon Overlay Handlers](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-register-icon-overlay-handlers); [MSDN forum confirmation](https://social.msdn.microsoft.com/Forums/windowsdesktop/en-US/02e4fbf7-5541-4f86-bc6c-f95a1d8e73cb/)).
- Writing HKLM ⇒ **requires admin/elevation**. If the *"Allow only per user or approved shell extensions"* policy (`EnforceShellExtensionSecurity`) is enabled, the DLL's CLSID must also be listed under `HKLM\…\Shell Extensions\Approved` ([Windows security encyclopedia](https://www.windows-security.org/771eaa0a7c97e37225d7a3349678af60/allow-only-per-user-or-approved-shell-extensions)) — again admin‑only.
- Overlays are **machine‑global**: one HKLM registration affects **every user's Explorer** on the box. There is no clean "just for me" install.

### 2.4 Refresh
- After first registering the handler, **Explorer must be relaunched** for the image list to load the new overlay ([MS Q&A](https://learn.microsoft.com/en-us/answers/questions/3849937/what-are-these-icon-overlays)).
- To refresh a *file's* overlay after a status change, the provider calls `SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, path, NULL)` (or `SHCNE_UPDATEDIR`), which makes Explorer re‑query `IsMemberOf` for that item. Overlay results are cached aggressively; stale badges until a refresh/scroll are a known annoyance.

### 2.5 Pros / cons
**Pros:** works on a folder of **real, already‑local files** with zero change to how we store files; small, self‑contained; extremely well‑trodden (Dropbox, Tortoise, Nextcloud/ownCloud pre‑VFS); no NTFS requirement; no package‑identity requirement.
**Cons:** the 15‑slot lottery (may silently not render); runs inside `explorer.exe` (a slow/crashy handler degrades the *whole OS shell*); HKLM/admin/machine‑global install; caching/refresh quirks; Microsoft considers it legacy.

---

## 3. Approach 2 — Windows Cloud Files (Cloud Filter) API

### 3.1 What it is
Introduced in Windows 10 1709, the Cloud Files API is the modern platform that OneDrive uses. It has two layers ([MS Learn — Build a Cloud Sync Engine that Supports Placeholder Files](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine)):
- **Cloud Filter API** (Win32, `cldapi.dll` / `cfapi.h`): `CfRegisterSyncRoot`, placeholder creation (`CfCreatePlaceholders`), `CfConvertToPlaceholder`, hydration/dehydration, and `CF_OPERATION` callbacks serviced by your provider. Backed by the **`cldflt.sys` minifilter**, which is **NTFS‑only**.
- **`Windows.Storage.Provider` WinRT**: `StorageProviderSyncRootManager.Register` configures the provider and registers the sync root for full shell integration.

**Overlays come "for free":** *"The cloud files API provides standardized, automatic hydration state icons shown in File Explorer and on the Windows desktop… Replaces legacy icon overlay Shell extensions."* You also get a branded navigation‑pane node, context‑menu verbs, progress UI, and **custom state icons** for service‑specific properties (via a `CustomStateProvider` / `StorageProviderItemProperties`). **No 15‑slot war.**

### 3.2 Can we adopt it for a folder of REAL, already‑local files?
Yes, mechanically — but it is a *sync‑engine contract*, not just an icon API:
- You register a sync root over an existing populated folder, then convert existing real files with **`CfConvertToPlaceholder`** (or create new ones with `CfCreatePlaceholders`, which is preferred for new items) ([CfConvertToPlaceholder](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfconverttoplaceholder)).
- **Hydration is not mandatory** — files can be **"pinned full files"** (`CF_PIN_STATE_PINNED`, the *"Always keep on this device"* state) that are guaranteed local/offline. The FAQ confirms you *can* leave items as normal files, but then they *"won't have cloud placeholder semantics"* and you may get a **broken cross overlay** if the sync root is registered without proper status handling ([Cloud File API FAQ](https://learn.microsoft.com/en-us/answers/questions/2288103/cloud-file-api-faq); [Cross icon shown in placeholder files](https://learn.microsoft.com/en-us/answers/questions/934208/)).
- Once a folder is a sync root, **you own the hydration callbacks forever.** Anything that dehydrates a file (system space pressure, user "free up space") fires `FETCH_DATA`, and if your provider isn't running/able to fetch, the file is broken. You've effectively become a cloud provider for that tree. Placeholders are **reparse points**, hidden from most apps — a known source of app‑compat papercuts.

### 3.3 The package‑identity wrinkle (critical for an Electron NSIS app)
- `CfRegisterSyncRoot` (Win32) can be called by an **unpackaged** app. But the *high‑level* `StorageProviderSyncRootManager.Register` (WinRT) — the one that gives clean, fully‑integrated status UI — expects **package identity** (MSIX / Desktop Bridge), and the docs state sync engines *"are designed to use the Desktop Bridge as an implementation requirement."* ([build doc](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine); [WindowsAppSDK #4909](https://github.com/microsoft/WindowsAppSDK/issues/4909)).
- Our app is an **unpackaged NSIS install with no package identity.** To get the full modern integration we'd need to add a **sparse package (packaging‑with‑external‑location MSIX)** to grant identity ([Grant identity to non‑packaged apps](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)). That's a second packaging pipeline on top of NSIS.

### 3.4 Pros / cons
**Pros:** overlays free of the 15‑slot war; the "right" architecture; directly *is* the files‑on‑demand mechanism we want for **FEAT‑7**; richer shell integration (nav node, progress, context verbs, custom states).
**Cons:** **NTFS‑only**; you become a real sync provider servicing hydration callbacks over a tree of the user's actual files (data‑handling risk); package‑identity / sparse‑MSIX for full integration; reparse‑point app‑compat; a materially larger, higher‑risk build. It changes our *file‑handling model*, not just our icons.

---

## 4. Recommendation

**Do the legacy Shell Icon Overlay Handler now; make the Cloud Files API the Phase‑2 target when FEAT‑7 (files‑on‑demand) is actually scheduled.**

Why:
1. **We only need ~3 badges over real local files, without changing storage semantics.** The overlay handler does exactly that with a small, isolated component. Cloud Files would force every file in the sync folder to become a placeholder/reparse point and put us on the hook for hydration correctness — a large behavior change and data‑safety surface for what is, today, a cosmetic enhancement.
2. **The slot‑war risk is real but survivable and *degrades safely*.** Worst case, our badges don't paint; the app is unaffected and our in‑app status view remains authoritative. That's an acceptable failure mode for a v1 enhancement. By contrast, a Cloud Files bug can break access to a user's real files.
3. **Cost/timing.** Cloud Files also demands NTFS + (for full integration) a sparse‑MSIX identity pipeline bolted onto our NSIS build. That's a bigger lift than the whole overlay handler, and it only pays off once we actually build files‑on‑demand.
4. **FEAT‑7 is the right trigger to switch.** When we implement files‑on‑demand we'll be adopting placeholders/hydration anyway; at that point Cloud Files *subsumes* overlays and eliminates the slot war "for free." Build the status bridge (§5) so the same path→status source feeds either front‑end.

Net: **overlay handler = correct, cheap first step; Cloud Files = correct destination, but only worth its cost when FEAT‑7 lands.**

---

## 5. Architecture (for the recommended overlay‑handler approach)

Three cooperating pieces. The golden rule: **the code that runs inside `explorer.exe` must be tiny, allocation‑light, lock‑free, and never touch the DB, network, or disk.**

```
 ┌─────────────────────────┐        publishes           ┌──────────────────────────┐
 │  Electron MAIN process   │  path→status snapshot      │  Shared memory (MMF)      │
 │  OverlayStatusPublisher  │ ─────────────────────────▶ │  hashmap: normPath→bucket │
 │  • subscribes to         │        + SHChangeNotify     │  (read-only for shell)    │
 │    sync:file-state-changed│                            └──────────────────────────┘
 │  • reads drive_metadata_  │                                       ▲ lock-free read
 │    cache (fileId→localPath)│                                      │
 │  • maps 7 statuses→3 buckets│                          ┌──────────┴───────────────┐
 │  • writes MMF, pokes shell │                          │ ArDriveOverlay.dll (x3 CLSIDs)│
 └─────────────────────────┘                            │ IShellIconOverlayIdentifier   │
                                                          │ IsMemberOf(path): O(1) lookup │
                                                          │ loaded INTO explorer.exe      │
                                                          └───────────────────────────────┘
```

### 5.1 The provider process — where does status truth live?
**Use the existing Electron main process as the publisher; do NOT stand up a separate long‑running daemon.** Main already owns the DB and already receives every status transition. Add an `OverlayStatusPublisher` module in `src/main/` that:
- On startup and profile switch, seeds the map from `getDriveMetadata(mappingId)` for each active mapping.
- Subscribes to the same signals that drive `sync:file-state-changed` (download completion in `DownloadManager`, sync transitions in `sync-manager`). On each change: resolve `fileId → localPath`, **normalize** (lowercase, backslashes, long‑path form), map `syncStatus → {synced|syncing|error|none}`, upsert the shared map, and `SHChangeNotify` the affected path.
- On sync‑folder unmap / cloud_only / delete, remove the entry.

The map lives in a **memory‑mapped file** (a fixed‑capacity open‑addressing hash table of `hash(path) → 1‑byte bucket`, plus a generation counter for lock‑free reads). MMF is chosen over a **named pipe** deliberately: `IsMemberOf` runs on Explorer's UI path and is called for *every visible item*; a pipe round‑trip per item risks visibly hanging Explorer. An MMF read is a pointer dereference. (Named pipe is a fine *fallback/control channel*, e.g. the DLL announcing "I'm loaded," but not the per‑item hot path.)

### 5.2 The native DLL
- **Language/toolchain: C++ with MSVC** (WRL/WIL/ATL for the COM plumbing). This is the battle‑tested path for shell extensions and has the best docs/samples. **Rust (windows‑rs) is viable** and memory‑safer, but in‑proc shell‑extension COM registration and lifetime in Rust is less trodden and more finicky; only choose it if the team has Rust‑COM experience. Either way the output is a **single self‑contained x64 DLL**.
- Implements **three CLSIDs** (one per badge) in one DLL. Each `IsMemberOf`: normalize the path, hash, read the MMF bucket, return `S_OK` iff bucket == this handler's badge, else `S_FALSE`. No allocations beyond a stack buffer; hard‑fail‑safe to `S_FALSE` if the MMF is missing/being rewritten (never block, never throw across the COM boundary).
- `GetOverlayInfo` returns an `.ico`/index embedded in the DLL. `GetPriority` returns 0.
- Registry names use leading spaces to fight for slots: `"  ArDriveSynced"`, `"  ArDriveSyncing"`, `"  ArDriveError"`.

### 5.3 Explorer refresh
The publisher calls `SHChangeNotify(SHCNE_UPDATEITEM, ...)` per changed path (coalesced/debounced to avoid storms during a bulk download). `SHChangeNotify` itself is a tiny Win32 call — expose it to the main process via a **small N‑API addon** (or fold the writer + notify into a helper the DLL/publisher shares). This addon is also where the MMF *write* happens (Node can't easily create a Windows named MMF + call `SHChangeNotify` without native code).

### 5.4 Status → bucket mapping (authoritative)
`synced → synced(green)`; `downloading|queued|pending → syncing(blue)`; `error|failed → error(red)`; `cloud_only → none` (no local file to badge). Guard against the `localFileExists` integer‑boolean trap when deciding whether a path is even present to badge.

---

## 6. Packaging / build (electron‑builder NSIS)

Current config (`package.json`): NSIS `oneClick:false`, `allowToChangeInstallationDirectory:true`, **no `perMachine`** (⇒ default **per‑user**, no admin), and **no code signing at all** (`win.signAndEditExecutable:false`, `signingHashAlgorithms:[]`). Both are blockers.

- **Bundle** the signed `ArDriveOverlay.dll` (and any helper exe / `.node` addon) as an extra resource.
- **Register on install / unregister on uninstall / re‑register on update** via a custom NSIS include (`nsis.include: "build/installer.nsh"`) using `customInstall` / `customUnInstall` macros that run `regsvr32` (or write the keys directly). This is a known‑supported pattern with known papercuts around `Exec`/`ExecWait` ([electron‑builder #5701](https://github.com/electron-userland/electron-builder/issues/5701), [NSIS docs](https://www.electron.build/docs/nsis/)).
- **Admin is required** (HKLM + Approved list). Options: (a) switch to **`perMachine: true`** (UAC once, machine‑wide) — cleanest, and matches the machine‑global nature of overlays; or (b) keep the per‑user app but **elevate only the overlay‑registration step** (dedicated elevated sub‑installer). Recommend **(a)** unless per‑user install is a hard product constraint. Either way, document that overlays are a **machine‑global side effect** affecting all users.
- **Locked‑DLL updates:** while Explorer is running it holds `ArDriveOverlay.dll` open, so an in‑place overwrite fails. Handle via `regsvr32 /u` + free, then replace‑on‑reboot (`MoveFileEx`/NSIS `Rename /REBOOTOK`) or a brief `explorer.exe` restart during install. This is the single most annoying packaging detail.
- After (un)registration, `SHChangeNotify(SHCNE_ASSOCCHANGED,...)`; first‑time appearance may still need an Explorer relaunch.

---

## 7. Code signing (hard prerequisite, currently absent)

- **What must be signed:** the **overlay DLL** (loads into `explorer.exe`), the **N‑API/helper binaries**, and the **NSIS installer + app `.exe`**. Shell extensions load into a trust‑sensitive system process; unsigned/untrusted shell extensions are a red flag for AV/endpoint policy and SmartScreen will warn on the unsigned installer. **We currently sign nothing** — this must be set up first.
- **Cert type:** **OV Authenticode is sufficient**; **EV is not required.** EV is mandatory only for kernel‑mode drivers / WHQL, which this is not. Since **March 2024, EV no longer grants instant SmartScreen bypass** — EV and OV now build SmartScreen reputation equally by download volume ([Code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options); [EV vs OV](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)). Note that modern OV certs (like EV) now require a **hardware token / cloud HSM**, so key handling in CI is non‑trivial either way.
- **Recommendation:** procure an **OV code‑signing cert on a cloud HSM** (e.g. Azure Trusted Signing / a CA's HSM offering), sign all four artifact classes in CI. Budget for **identity‑vetting lead time (days–weeks)** and CI secret handling.

---

## 8. Testing strategy

Overlays are Explorer‑visual, so testing is **majority manual with a thin automatable core.**

**Automatable (CI / unit):**
- Status‑mapping table and the `OverlayStatusPublisher` (feed DB‑shaped fixtures — integer booleans, nulls — per the CLAUDE.md trap; assert MMF bucket + that `SHChangeNotify` fired).
- A **native test harness** that `CoCreateInstance`s each CLSID and calls `IsMemberOf` directly against fixture paths + a seeded MMF (no Explorer needed) — verifies the hot path in isolation.
- **Registry assertions** post‑install: our three keys exist under `ShellIconOverlayIdentifiers`, CLSIDs resolve, Approved list populated; post‑uninstall: all removed.

**Manual (Win10 + Win11 VMs, multiple builds):**
- Fresh install → badges appear on real local files; live `synced → syncing → error` transitions as sync events fire; refresh works without pressing F5; update replaces the locked DLL; uninstall cleans up.
- **15‑slot collision test:** pre‑install OneDrive + Dropbox + Google Drive + TortoiseGit (which alone can push past ~11 slots), then verify whether our leading‑space keys still win a slot and actually paint — this is the **graceful‑degradation** test, and the expected outcome on a crowded machine is "badges absent, app fine."
- **Explorer restart / cache quirks:** overlays cache in the system image list; first registration usually needs an Explorer relaunch, and per‑folder repaint can lag until scroll. Expect flakiness here; script an "assert our keys are within the first 15 alphabetically" check but keep pixel verification screenshot‑based/manual.

**Known flakiness:** overlay cache staleness, delayed repaint, first‑run needing logoff/Explorer restart, AV false‑positives on a freshly‑signed low‑reputation DLL.

---

## 9. Effort & phasing (honest)

This is **not** a small feature. It is a greenfield native COM component + a new shared‑memory bridge + a native `SHChangeNotify`/MMF addon + installer surgery + first‑time code‑signing + a manual Win10/11 test matrix. There is **no existing native‑addon toolchain** in the repo today (no `binding.gyp`, no `.node`), so the C++/MSVC build is greenfield in CI too.

**Rough sizing** (engineer comfortable with Win32/COM; add ~50–100% if learning COM):
- Native DLL: 3 handlers, COM registration, MMF reader, `IsMemberOf` — **~1.5–2.5 wks**
- Main‑process publisher + fileId→path mapping + status mapping — **~1–1.5 wks**
- Native MMF‑writer / `SHChangeNotify` N‑API addon + CI MSVC build — **~0.5–1 wk**
- electron‑builder NSIS registration + perMachine/elevation + locked‑DLL update handling — **~1 wk**
- Code‑signing wiring (cert procurement is *external* lead time; CI wiring ~2–3 days once in hand)
- Test matrix + slot‑collision + polish — **~1–1.5 wks**
- **Total ≈ 5–7 focused weeks** + external cert lead time.

**Phased rollout:**
1. **MVP — one badge, static.** Green‑check on locally‑present `synced` files, set at download/upload completion. perMachine **signed** install. Proves the whole pipeline (DLL ↔ MMF ↔ publisher ↔ installer ↔ signing) end‑to‑end.
2. **All four states.** Add syncing (blue) + error (red); map the full 7‑value status set → 3 buckets.
3. **Live updates.** Wire `sync:file-state-changed` → publisher → MMF + debounced `SHChangeNotify` for real‑time transitions during active sync.
4. **Polish.** Leading‑space slot competition + graceful degradation, robust locked‑DLL update & clean uninstall, and telemetry on "did our handler actually get a slot."

**Top risks & mitigations:**
1. **15‑slot exhaustion → badges silently don't paint** on crowded machines. *Mitigate:* leading‑space naming; keep the in‑app status view as the authoritative surface (overlays are enhancement‑only); detect + message when we lose the race; long‑term migrate to Cloud Files (no slot war).
2. **In‑proc stability/perf inside `explorer.exe`** — a slow or crashy `IsMemberOf` can hang or take down the whole shell. *Mitigate:* lock‑free MMF reads only, zero DB/IO/heavy‑alloc in the handler, fail‑safe to `S_FALSE`, defensive COM boundaries, heavy soak testing.
3. **Signing + admin/HKLM/perMachine + locked‑DLL updates.** *Mitigate:* procure OV/HSM cert early (external lead time); perMachine or elevated sub‑step; replace‑on‑reboot for the locked DLL; thorough uninstall.

---

## 10. Windows 10/11 support & failure‑mode note

- **Support:** Both approaches are supported on **Windows 10 (1709+) and Windows 11**. The overlay‑handler API is stable and identical across both; behavior is consistent. (Cloud Files, for Phase 2, is also 1709+ but **NTFS‑only** via `cldflt.sys`.)
- **Design principle: overlays are enhancement‑only; every failure path degrades to "no badge," never to data loss or a broken shell.**
  - **HKLM registration fails (no admin / policy):** no overlays; app fully functional; in‑app status view unaffected.
  - **We lose the 15‑slot alphabetical race:** Explorer silently ignores our handlers — no error, badges simply absent. In‑app UI still authoritative.
  - **Publisher/MMF unavailable** (app closed, map mid‑rewrite): `IsMemberOf` returns `S_FALSE` → no badge. It must **never block or throw**.
  - **DLL crash:** worst case is Explorer instability — hence the strict "no work in the handler" rule and defensive coding; a crash here is an OS‑shell problem, not just an app problem.
  - **Stale badge after a status change:** possible until `SHChangeNotify`/refresh lands; cosmetic, self‑heals on refresh.

---

## Sources
- [The Old New Thing — Why is there a limit of 15 shell icon overlays?](https://devblogs.microsoft.com/oldnewthing/20190313-00/?p=101094)
- [MS Learn — How to Implement Icon Overlay Handlers](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-implement-icon-overlay-handlers)
- [MS Learn — How to Register Icon Overlay Handlers](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-register-icon-overlay-handlers)
- [MSDN forum — HKCU overlay registration is not recognized](https://social.msdn.microsoft.com/Forums/windowsdesktop/en-US/02e4fbf7-5541-4f86-bc6c-f95a1d8e73cb/)
- [MS Q&A — Icon overlays in Windows 10 (limit / reserved slots)](https://learn.microsoft.com/en-us/answers/questions/2777426/icon-overlays-in-windows-10)
- [Wikipedia — List of shell icon overlay identifiers](https://en.wikipedia.org/wiki/List_of_shell_icon_overlay_identifiers)
- [Windows security encyclopedia — Allow only per user or approved shell extensions](https://www.windows-security.org/771eaa0a7c97e37225d7a3349678af60/allow-only-per-user-or-approved-shell-extensions)
- [MS Learn — Build a Cloud Sync Engine that Supports Placeholder Files](https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine)
- [MS Learn — CfRegisterSyncRoot](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfregistersyncroot)
- [MS Learn — CfConvertToPlaceholder](https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfconverttoplaceholder)
- [MS Q&A — Cloud File API FAQ (Win32 vs WinRT, hydration optional)](https://learn.microsoft.com/en-us/answers/questions/2288103/cloud-file-api-faq)
- [MS Q&A — Cross icon shown in placeholder files](https://learn.microsoft.com/en-us/answers/questions/934208/)
- [GitHub — WindowsAppSDK #4909 (CfRegisterSyncRoot vs StorageProviderSyncRootManager.Register)](https://github.com/microsoft/WindowsAppSDK/issues/4909)
- [MS Learn — Grant package identity to non‑packaged apps (sparse package)](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps)
- [MS Learn — Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [SSL.com — Which Code Signing Certificate: EV or OV?](https://www.ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)
- [electron‑builder — NSIS docs](https://www.electron.build/docs/nsis/) and [issue #5701 (regsvr32 DLL registration)](https://github.com/electron-userland/electron-builder/issues/5701)
- [ownCloud docs — Using the Virtual Filesystem (Cloud Filter API in production)](https://doc.owncloud.com/desktop/next/vfs.html)

**In‑repo anchors:** `src/main/migrations.ts:98‑120` & `:339‑362` (table + CHECK set), `src/main/database-manager.ts:1794` (`updateFileSyncStatus`), `:1817` (`updateDriveMetadataStatus`), `:1875` (`getFilesByStatus`), `src/main/sync/DownloadManager.ts:233‑244` (`emitFileStateChange`), `src/main/sync-manager.ts:2221/2252` (`sync:file-state-changed`), `src/main/preload.ts:446` (`onFileStateChanged`), `package.json` build/win/nsis block (no signing, per‑user default).
