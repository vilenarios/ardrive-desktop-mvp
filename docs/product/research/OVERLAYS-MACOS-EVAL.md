# Native macOS Finder Overlay Badges for ArDrive Desktop — Technical Evaluation

**Scope:** Painting sync-status badges (green check / syncing / error / cloud-only) directly onto files *in Finder* for the ArDrive Desktop Electron app, driven by our existing per-file sync status.
**Type:** Evaluate + implementation plan. No code written; no repo changes.
**Date:** 2026-07-09

---

## 1. Executive Summary & Recommendation

**Recommended architecture:** Build a native **Finder Sync app extension** (`FIFinderSync` subclass in Swift, `com.apple.FinderSync` extension point) as a separate Xcode-built `.appex`, injected into the Electron `.app` at `Contents/PlugIns/` during `electron-builder`'s `afterPack` hook so it is sealed inside the app's Developer-ID signature and notarized as one unit. The sandboxed extension and the Electron main process share status through an **App Group container**: the main process writes a compact per-directory status snapshot (localPath → syncStatus) into the shared container and fires a **Darwin notification** on change; the extension reads the snapshot and calls `setBadgeIdentifier:forURL:` for the files Finder is currently drawing. This keeps the extension lightweight (Apple explicitly requires this — it "delegates the actual syncing" to the main app) while our existing `sync-manager` remains the single source of truth.

**Bottom line:** Technically well-understood and shipped by many apps (Dropbox, ownCloud, etc.), but it is a **native-macOS + code-signing project bolted onto an Electron app**, not an Electron feature. The engineering is moderate; the **hard, non-negotiable dependencies are an Apple Developer Program membership ($99/yr), Developer-ID signing, and notarization**, plus a **user-enable step** that Apple keeps moving around (it literally vanished from System Settings in Sequoia 15.0). Budget **4–7 focused engineering weeks** for a polished v1 across the phasing below, with real risk concentrated in signing/notarization of the embedded extension and in the enable-friction UX.

---

## 2. Grounding: Our Data Model (what the extension must consume)

The extension needs exactly two things per file: **a local path** and **a status**. We already have both.

**Source of truth — `drive_metadata_cache` table** (schema in `src/main/migrations.ts`, migrations 1 & 7):

- `localPath TEXT` — absolute on-disk path (nullable when the file is cloud-only / not yet downloaded).
- `syncStatus TEXT DEFAULT 'pending' CHECK (syncStatus IN ('synced','pending','downloading','queued','cloud_only','error','failed'))` — **seven** states after migration 7 added `'failed'`.
- Keyed on `fileId`; indexed on `path`, `localPath`-adjacent lookups exist (`getDriveMetadataByPath(mappingId, path)` in `database-manager.ts`).
- `mappingId` ties each row to a `drive_mappings` row (per-drive sync folder + direction) — this is where the **watched-folder roots** for `setDirectoryURLs` come from.

**Status writes** (`src/main/sync-manager.ts`):
- `databaseManager.updateDriveMetadataStatus(fileId, 'downloading', false)` → `'synced'` on completion (lines ~4296–4302, 4390–4392).
- `databaseManager.updateFileSyncStatus(fileId, 'failed', errorMessage)` on download failure.
- Stuck `'downloading'/'queued'` are reset to `'pending'` on startup (`database-manager.ts` line 119).

**Live events already emitted to the renderer** (`src/main/main.ts`, via `webContents.send`):
- `sync:file-state-changed` → `{ fileId, syncStatus }` (e.g. lines 2221, 2252) — **the exact per-file signal we need**, but keyed by `fileId`, so the bridge must resolve `fileId → localPath` before handing it to the extension (the cache row has both).
- `drive:metadata-updated` (driveId), `drive:update`, `activity:update` — coarser invalidation signals.
- `sync:status` IPC (`sync-manager.getStatus()`) is a **poll-based, drive-level** aggregate (health/counts), not per-file — not sufficient alone for overlays.

**Implication for design:** we do not need a new status system. We need a **new sink** that mirrors the same status transitions `sync:file-state-changed` already represents into the App Group container, keyed by `localPath`. Mapping is a 4-status collapse for the UI:

| Our `syncStatus` | Badge |
|---|---|
| `synced` | ✅ green check ("synced / permanent") |
| `pending`, `downloading`, `queued` | 🔄 syncing (rotating/arrows) |
| `error`, `failed` | ⚠️ error (red) |
| `cloud_only` | ☁️ cloud-only (not downloaded locally) |

Note: `cloud_only` files have **no** `localPath` on disk, so Finder never draws them unless we also materialize placeholder files — for a v1 that syncs *real* local folders, cloud-only files simply have no local entry to badge. Keep this out of v1 scope (see §11).

---

## 3. The Finder Sync Extension Model (`FIFinderSync` / FinderSync.framework)

A Finder Sync extension is an **app extension** (`.appex`) hosted by Finder, subclassing `FIFinderSync`, declared with extension point `com.apple.FinderSync`. It is bundled inside the container app at **`Contents/PlugIns/`** and runs as its own sandboxed process managed by `pluginkit`/`ExtensionKit`. ([Apple: App Extension Programming Guide — Finder Sync](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Finder.html))

**Info.plist (extension target):**
```xml
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key><string>com.apple.FinderSync</string>
  <key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).FinderSync</string>
</dict>
```

**Badge lifecycle & the key `FIFinderSyncController` API** ([FIFinderSyncController docs](https://developer.apple.com/documentation/findersync/fifindersynccontroller); [setBadgeImage docs](https://developer.apple.com/documentation/findersync/fifindersynccontroller/setbadgeimage(_:label:forbadgeidentifier:))):

1. **Register watched roots** — set `FIFinderSyncController.default().directoryURLs = Set<URL>` in `init` (our per-drive sync folders from `drive_mappings`). Finder only talks to the extension for items *inside* these roots.
2. **Register badge images once** — `setBadgeImage(_:label:forBadgeIdentifier:)` for each of our ~4 badge identifiers (e.g. `"synced"`, `"syncing"`, `"error"`, `"cloudOnly"`), typically in `init`. Images support **up to 320×320**, must fill edge-to-edge; display range on Retina is 12×12–320×320.
3. **Answer per-item, on demand** — the system calls `requestBadgeIdentifier(for url: URL)` **for each item currently being drawn on screen** (and as new items scroll into view). Inside it, look up our status for that URL and call `setBadgeIdentifier(_:for:)`. Apple stresses: only badge **currently visible** items — do not walk the tree.
4. **Directory observation** — `beginObservingDirectory(at:)` / `endObservingDirectory(at:)` bracket which folders are visible; the extension should only keep live state for observed dirs. The system spins up **separate extension instances** (e.g. one per Finder window, plus separate ones for Open/Save panels), each with independent lifecycle callbacks.

**Critical design constraint from Apple:** the Finder Sync extension has "a much longer lifespan than most other extensions" and must stay lightweight — do the badge/menu/toolbar work only, and **delegate real syncing to a separate service (Login Item / Launch Agent) via XPC**. For us the "separate service" *is* the Electron main process; the extension must never do I/O beyond reading the shared status snapshot.

Minimum OS: FinderSync.framework has existed since **OS X 10.10 Yosemite**; the API surface we use is stable across all currently-supported macOS versions.

---

## 4. Build Pipeline: a native `.appex` inside an Electron app (no Xcode project)

Electron/`electron-builder` has **no native-target concept** — it cannot compile Swift. The realistic pipeline is a **two-stage build**: build the extension with Xcode's toolchain, then inject the artifact.

**Stage A — build the `.appex` (macOS-only, requires Xcode):**
- Keep a small standalone Xcode project (or an SPM package + `xcodebuild`) under e.g. `native/macos/ArDriveFinderSync/`. Its product is `ArDriveFinderSync.appex`.
- CI/build step: `xcodebuild -scheme ArDriveFinderSync -configuration Release -derivedDataPath build` → produces `…/ArDriveFinderSync.appex`. This **must run on a macOS runner** with Xcode; it cannot be cross-compiled from Linux/Windows (relevant — our current CI is `.github/workflows/mvp-workflow.yml`, manual dispatch; a macOS job is required).

**Stage B — inject into the Electron `.app`, then sign the whole app:**
- `extraFiles` alone is **insufficient** and dangerous: it copies too late/at the wrong layer and can break the seal. The correct integration is an **`electron-builder` `afterPack` hook** that copies the prebuilt `.appex` into `<App>.app/Contents/PlugIns/ArDriveFinderSync.appex` using **`ditto`, never `cp`** (`cp` expands symlinks and corrupts the bundle). ([Apple Developer Forums — app extension signing order](https://developer.apple.com/forums/thread/763450))
- **Signing must be inside-out and before the outer app is sealed.** The `.appex` is signed first (with its own entitlements — sandbox + App Groups), *then* the container `.app` is signed so the extension is covered by the app's signature. Ordering pitfalls that are documented and easy to hit:
  - Inserting the `.appex` *after* the app is signed → "replacing existing signature".
  - Inserting *after* notarization → "app is damaged" at launch.
  So the hook must land the `.appex` **before** `electron-builder` runs its `signAndEditExecutables`/final `codesign`. In practice: build `.appex` (Stage A, self-signed with its own entitlements) → `afterPack` `ditto` into `Contents/PlugIns/` → let `electron-builder` sign the outer app (which re-seals over the extension) → notarize the whole `.app`. ([electron-builder Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing); [electron-builder notarization](https://www.electron.build/docs/notarization/))
- `electron-builder` config: `mac.hardenedRuntime: true`, `mac.gatekeeperAssess: false`, `mac.entitlements`/`entitlementsInherit` pointing at plist files that include the App Group entitlement; `afterSign` runs `@electron/notarize`.

**Net:** this adds a mandatory **macOS + Xcode build stage** to the pipeline and makes the `afterPack`/signing ordering the single most fragile part of the whole feature.

---

## 5. Status Channel: sandboxed extension ⇄ Electron main process

The extension is **App-Sandboxed by requirement** (all app extensions are), so it cannot read our SQLite DB in `userData`, cannot open arbitrary paths, and cannot talk to Node directly. Options:

| Mechanism | Fit | Notes |
|---|---|---|
| **App Group shared container** (recommended) | ✅ Best | Both processes declare `com.apple.security.application-groups` with the same group id; both access `containerURL(forSecurityApplicationGroupIdentifier:)`. Main writes a status snapshot file there; extension reads it. Cross-process, sandbox-legal, no long-lived socket. ([Apple: Accessing app group containers](https://developer.apple.com/documentation/xcode/accessing-app-group-containers)) |
| **App Group + Darwin notification** (recommended add-on) | ✅ | Snapshot file gives *state*; a `CFNotificationCenterGetDarwinNotifyCenter` "ardrive.status.changed" ping gives *push* so the extension refreshes badges immediately instead of polling. Darwin notifications carry no payload (fine — payload is the file). |
| **XPC / Mach service** | ⚠️ Possible, heavier | `NSXPCConnection(machServiceName:)` works but the endpoint must be vended by a launchd-registered service; wiring an XPC listener from Electron's Node main process is awkward (needs a native addon or a helper Login Item). Overkill for read-mostly badge state. ([Apple Forums — NSXPCConnection app↔FinderSync](https://developer.apple.com/forums/thread/677665)) |
| **Local unix socket / localhost TCP** | ❌ Avoid | The sandboxed extension needs a network entitlement; brittle, and Apple's guidance is App Groups for this. |
| **Shared `NSUserDefaults(suiteName:)`** | ⚠️ Small data only | Convenient (`initWithSuiteName:`), but not meant for a large, frequently-updated path→status map. Use the container **file** for the map; user defaults only for config (which roots to watch). |

**Recommended concrete design:**
- Main process (new module `src/main/finder-sync-bridge.ts`, macOS-gated) subscribes to the same transitions behind `sync:file-state-changed`, resolves `fileId → localPath` from `drive_metadata_cache`, and maintains a compact snapshot in the App Group container — e.g. one small file **per watched directory** (`<dir-hash>.json` mapping child filename → 1 of 4 badge ids), so the extension reads only the directory Finder is drawing, and writes stay tiny. Write atomically (temp + rename), then post the Darwin notification.
- Extension keeps an in-memory map for observed dirs, invalidates on the Darwin ping (`FIFinderSyncController` re-requests badges for visible items), and answers `requestBadgeIdentifier(for:)` from memory only.

**Sandbox/entitlement implications:**
- Extension entitlements: `com.apple.security.app-sandbox = true` (mandatory), `com.apple.security.application-groups = [group.io.ardrive.desktop]`, plus read-only file access is granted **implicitly** to the app-group container and to the user-selected sync folders Finder hands it.
- Container app entitlements: **same** `application-groups` group id. The Electron app is typically **not** sandboxed (Developer-ID direct distribution), which is fine — a non-sandboxed app may still adopt the App Groups entitlement to reach the shared container. **Validate early:** App Groups for **Developer-ID (non-Mac-App-Store)** builds is historically finicky (the group id must be registered on the developer portal and, on some macOS versions, the app group container path differs / needs the team-id prefix). This is a concrete "prove it on real hardware in week 1" item.

---

## 6. Enabling the Extension: first-run UX & the friction problem

**The friction is real and Apple-imposed.** A freshly installed Finder Sync extension is **not automatically active** for the user — it must be enabled, and the app **cannot enable it programmatically** (a sandboxed/Developer-ID app cannot call `pluginkit -e use` on the user's behalf).

**Where the toggle lives — and the Sequoia regression:**
- Ventura/Sonoma: **System Settings ▸ General ▸ Login Items & Extensions ▸ (Added Extensions / File Providers)**.
- **macOS Sequoia 15.0: the Finder Sync management UI was removed entirely** — there was *no graphical way* to enable it; users had to use `pluginkit` in Terminal or a third-party tool (e.g. FinderSyncer). Apple confirmed this was a **bug**, and **restored the UI in 15.2** under a combined "Finder Sync / File Providers" subsection. ([Michael Tsai — Finder Sync Extensions Removed From System Settings in Sequoia](https://mjtsai.com/blog/2024/10/03/finder-sync-extensions-removed-from-system-settings-in-sequoia/); [Enabling Finder Extensions on Sequoia 15.2+](https://apptyrant.com/2025/05/09/how-to-enable-finder-extensions-on-macos-sequoia-15-2-and-newer/))
- Practical consequence: our onboarding instructions **must be version-aware**, and we must warn users on 15.0/15.1 specifically.

**How the big vendors handle it:** Dropbox/OneDrive ship the extension as part of install and then **coach the user through enabling** ("Turn on the Finder/system extension in Settings"), and provide `pluginkit -e use -i <bundle-id>` as the documented Terminal fallback for support. ([OneDrive — turn on Finder extension](https://learn.microsoft.com/en-us/answers/questions/5014633/turn-on-finder-extension-for-onedrive-macos); Dropbox community threads reference `pluginkit -e use -i com.dropbox.DropboxFinderSync`.)

**Recommended first-run UX for ArDrive:**
1. On first launch on macOS, detect enablement state. The app can shell out to `pluginkit -m -i <our.bundle.id>` (read-only, allowed for non-sandboxed Electron) to check whether our extension is present/enabled, and re-check on focus.
2. If not enabled, show a **guided card**: a screenshot + a "Open Extension Settings" button that deep-links via `x-apple.systempreferences:com.apple.ExtensionsPreferences` (opens the Extensions pane). Keep it **non-blocking** — overlays are an enhancement, the app must work without them.
3. Ship a **version-aware help doc**: normal path for 13/14/15.2+, and the explicit Terminal `pluginkit -e use -i io.ardrive.desktop.FinderSync` fallback for 15.0/15.1 and troubleshooting.
4. Re-detect after the user returns; when enabled, force one refresh (see §8).

---

## 7. Signing + Notarization (the hard external dependency)

This is the gating dependency and the highest-risk area.

**What is required:**
- **Apple Developer Program membership** ($99/yr) → a **Developer ID Application** certificate. Without it there is no valid signing identity and **no notarization is possible**.
- **Hardened Runtime** (`hardenedRuntime: true`) on the app *and* the embedded extension — notarization requires it. ([electron-builder notarization](https://www.electron.build/docs/notarization/); [Kilian Valkhof — Notarizing your Electron application](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/))
- **Inside-out signing**: `.appex` signed first with its own sandbox + App Groups entitlements, then the container `.app` signed over it (see §4), then the **whole `.app` notarized** with `@electron/notarize` (via `notarytool` / an app-specific password or API key), then **stapled**.
- **App Group entitlement** present on both and the group id **registered** on the developer portal.

**What breaks if unsigned / un-notarized:**
- **Unsigned or ad-hoc-signed extension:** Finder/`pluginkit` will refuse to load an app extension whose signature doesn't validate against the container app; the extension silently won't appear/run. Team-ID consistency between app and appex is enforced.
- **Un-notarized app (Developer-ID, direct download):** Gatekeeper blocks first launch ("cannot be opened because Apple cannot check it for malicious software"); most users can't get past it. The extension never gets a chance to run.
- **Signing-order mistakes:** "replacing existing signature" (appex inserted after app signed) or **"app is damaged, move to Trash"** (appex inserted after notarization) — both are total failures, and both are easy to trip in the `afterPack` hook.
- **Entitlement mismatch (App Group not matching / not registered):** the container file handoff fails; extension loads but shows no/blank badges — a confusing, silent failure mode.

**Implication:** ArDrive Desktop must adopt full Developer-ID signing + notarization for its macOS builds regardless (it's already needed for a friction-free installer), but this feature makes it **mandatory and more intricate** because of the embedded extension. If the project is currently shipping unsigned/ad-hoc macOS builds, **that must be fixed first** — it is a prerequisite, not a sub-task.

---

## 8. macOS Version Support & Finder Quirks

**Support floor:** FinderSync since 10.10; safe to target **all currently supported macOS (13 Ventura, 14 Sonoma, 15 Sequoia)**. Nothing we use is newer-only.

**Known quirks to design around:**
- **Sequoia 15.0/15.1 enable-UI bug** (§6) — version-aware onboarding is mandatory.
- **Badge refresh staleness:** Finder caches badges aggressively. After enabling, or when many statuses change at once, badges may not repaint until the view is touched. Mitigations: the Darwin-notification push (§5) to nudge re-request; as a last resort, `killall Finder` forces a full reload but is user-hostile — never do it automatically, only offer it as a manual "badges look stuck?" troubleshooting action.
- **Multiple extension instances:** one per Finder window + separate ones for Open/Save panels; keep all state in the shared container, not extension-process memory-of-record, so instances agree.
- **Extension crashes:** a crash just makes badges disappear until Finder relaunches the extension — non-fatal to the app, but log/telemetry on the extension side is limited by the sandbox (write diagnostics into the app-group container).
- **Conflicts with other badge providers:** Finder shows a limited number of overlays and multiple sync tools competing for the same files can flicker/override (documented on Apple forums) — an edge case, worth a known-issue note.
- **`cloud_only` items** have no on-disk file, so Finder never asks us to badge them in a real-folder model (see §2/§11).

---

## 9. Honest Alternative: File Provider Extension (why we are *not* choosing it for v1)

Apple's strategic direction for cloud storage is the **File Provider framework** (`NSFileProviderReplicatedExtension`), and **Box, Dropbox, Google Drive, and OneDrive all migrated to it** (Ventura era); badges there come from **`NSFileProviderItemDecorating`**, not Finder Sync. ([TidBITS — Apple's File Provider Forces Mac Cloud Storage Changes](https://tidbits.com/2023/03/10/apples-file-provider-forces-mac-cloud-storage-changes/)) Apple even combined Finder Sync and File Provider management into one Settings pane in 15.2.

**Why File Provider is the wrong fit for ArDrive today:** File Provider replaces the user's real folder with a **provider-managed synthetic domain** — the OS owns materialization/eviction, online-only files, etc. That is a **ground-up re-architecture** of ArDrive's storage model (we sync a *real* local folder that chokidar watches in `sync-manager.ts`), it forbids things our model allows (e.g. arbitrary external-drive locations), and it is dramatically more work. **Finder Sync overlays a real folder we already own — it matches our model with far less disruption.** File Provider is a legitimate *long-term* direction if ArDrive ever moves to on-demand/online-only files, but it is out of scope here. This is the honest trade: Finder Sync is the pragmatic path; File Provider is the Apple-blessed but far larger path.

---

## 10. Testing Strategy

**Automation is very limited.** Finder Sync involves the real Finder UI, `pluginkit` registration, code-signed bundles, and user-enable toggles — none of which run in CI headlessly or under our current Vitest/Electron setup. Plan for **mostly manual, on-device testing**.

- **Unit-testable (CI, our stack):** the `finder-sync-bridge` mapping logic (fileId→localPath resolution, 7-status → 4-badge collapse, snapshot serialization, atomic write) — pure functions, testable with **DB-shaped fixtures** (integer booleans, `null`s — per our CLAUDE.md DB-boundary trap). No Finder needed.
- **Native extension:** small XCTest around the status-file parsing/badge-id selection in Swift, but the badge *rendering* can only be verified in real Finder.
- **Manual matrix (real Macs required):**
  - macOS **13, 14, 15.2+** (normal enable path) **and 15.0/15.1** (broken-UI / Terminal path) — Apple Silicon and at least one Intel if we still support it.
  - Flows: fresh install → enable extension → badges appear; status transitions (pending→downloading→synced, →failed) reflect within a second; rename/move/delete; large folder scroll (perf); multiple Finder windows + Open/Save panel; app quit (badges should go stale gracefully, not wrong); re-launch.
  - Signing/notarization gate: install the **notarized DMG on a clean machine with Gatekeeper on** (not the dev machine) — this is the only way to catch "app is damaged"/enable failures.
- **Diagnostics:** since the sandboxed extension can't log freely, have it append to a log file in the app-group container that the main app can surface in a support bundle.

---

## 11. Effort & Phasing (honest sizing)

Assumes one engineer comfortable with Swift *and* the Electron build; **prerequisite: Developer-ID signing + notarization already working for macOS builds** (if not, add ~1 week to stand that up first).

| Phase | Deliverable | Est. |
|---|---|---|
| **0. Signing/notarization prerequisite** | Developer-ID cert, hardened runtime, notarized macOS build pipeline green (if not already) | 0.5–1 wk |
| **1. Skeleton + one static badge** | Xcode `.appex` target, `afterPack` `ditto` injection, inside-out signing works end-to-end, extension enables via `pluginkit`, paints one hardcoded badge on files in a watched dir on a notarized build | 1–1.5 wk |
| **2. App Group status channel + 4 states** | `finder-sync-bridge.ts`, App Group container plumbing, snapshot writer, extension reads it, all four badges map from real `drive_metadata_cache` status (static/one-shot) | 1–1.5 wk |
| **3. Live updates** | Darwin-notification push on `sync:file-state-changed`, fileId→localPath resolution, sub-second repaint, refresh-on-enable, multi-window correctness | 1 wk |
| **4. Enable-UX polish + version handling** | First-run detection, deep-link to Settings, version-aware help (15.0/15.1 Terminal fallback), "badges stuck?" troubleshooting, telemetry/log bundle | 0.5–1 wk |
| **Total** | | **~4–7 wks** |

Deliberately out of v1 scope: `cloud_only` placeholder materialization, right-click context-menu actions (Finder Sync also supports menus/toolbar — easy add later), File Provider migration.

---

## 12. Top Risks & Mitigations

1. **Signing + notarization of the embedded extension (highest).** Inside-out signing order and the `afterPack`/`ditto` injection are fragile; mistakes yield "app is damaged" or a silently non-loading extension, only reproducible on a clean Gatekeeper machine. *Mitigate:* nail Phase 1 on a notarized build on a clean VM/Mac before writing any status logic; script the injection with `ditto` and assert the sealed signature with `codesign --verify --deep --strict` + `spctl -a -vv` in CI.
2. **Enable-friction / Apple moving the toggle (high).** Users must manually enable; the UI vanished in Sequoia 15.0 and only returned in 15.2. Silent "why are there no badges" support load. *Mitigate:* non-blocking guided first-run UX, in-app enablement detection via `pluginkit -m`, version-aware instructions incl. the `pluginkit -e use` Terminal fallback, and never let missing overlays degrade core app function.
3. **App Groups on Developer-ID (non-MAS) builds not wiring up (high).** The shared-container handoff can silently fail if the group id isn't registered/entitled correctly for direct-distribution signing, producing blank badges. *Mitigate:* prove the App Group container round-trip (main writes, extension reads) on real hardware in week 1, before building anything on top of it.
4. **Native macOS build stage added to CI (medium).** Requires a macOS+Xcode runner in `mvp-workflow.yml`; can't cross-compile. *Mitigate:* add a dedicated macOS job; keep the Xcode project minimal (`xcodebuild` one-liner).
5. **Badge staleness/refresh (medium).** Finder caches; badges can lag. *Mitigate:* Darwin-notification push; manual "refresh"/`killall Finder` only as user-initiated troubleshooting, never automatic.

---

## 13. Hard External Dependencies

- **Apple Developer Program membership** ($99/yr) and a **Developer ID Application** certificate — without these, no signing and no notarization; the feature cannot ship at all.
- **A macOS machine/CI runner with Xcode** to compile the Swift `.appex` (cannot be built on Linux/Windows — affects our current manual GitHub Actions setup).
- **Notarization credentials** (App Store Connect API key or app-specific password) for `notarytool`/`@electron/notarize`.
- **Registered App Group identifier** on the Apple Developer portal, shared by app + extension.
- **Real Mac hardware across macOS 13/14/15 (incl. 15.0/15.1 and 15.2+)** for the manual test matrix — no headless substitute.

---

## 14. Sources

- Apple — [App Extension Programming Guide: Finder Sync](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Finder.html)
- Apple — [FIFinderSyncController](https://developer.apple.com/documentation/findersync/fifindersynccontroller)
- Apple — [setBadgeImage(_:label:forBadgeIdentifier:)](https://developer.apple.com/documentation/findersync/fifindersynccontroller/setbadgeimage(_:label:forbadgeidentifier:))
- Apple — [FIFinderSync](https://developer.apple.com/documentation/findersync/fifindersync)
- Apple — [Accessing app group containers in your existing macOS app](https://developer.apple.com/documentation/xcode/accessing-app-group-containers)
- Apple — [Enabling App Sandbox / Entitlement Key Reference](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)
- Apple Developer Forums — [Signing application with app extension (inside-out signing, ditto vs cp)](https://developer.apple.com/forums/thread/763450)
- Apple Developer Forums — [NSXPCConnection between app and FinderSync extension](https://developer.apple.com/forums/thread/677665)
- Electron — [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- electron-builder — [macOS Notarization](https://www.electron.build/docs/notarization/)
- Kilian Valkhof — [Notarizing your Electron application](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/)
- @electron/notarize — [GitHub](https://github.com/electron/notarize)
- Michael Tsai — [Finder Sync Extensions Removed From System Settings in Sequoia](https://mjtsai.com/blog/2024/10/03/finder-sync-extensions-removed-from-system-settings-in-sequoia/)
- AppTyrant — [How to Enable Finder Extensions on macOS Sequoia 15.2 (and Newer)](https://apptyrant.com/2025/05/09/how-to-enable-finder-extensions-on-macos-sequoia-15-2-and-newer/)
- Microsoft — [Turn on Finder extension for OneDrive macOS](https://learn.microsoft.com/en-us/answers/questions/5014633/turn-on-finder-extension-for-onedrive-macos)
- TidBITS — [Apple's File Provider Forces Mac Cloud Storage Changes](https://tidbits.com/2023/03/10/apples-file-provider-forces-mac-cloud-storage-changes/)
- ownCloud — [FinderSync.m reference implementation](https://github.com/owncloud/client/blob/master/shell_integration/MacOSX/OwnCloudFinderSync/FinderSyncExt/FinderSync.m)
