# Native File-Manager Overlay Badges — Unified Implementation Plan

**FEAT-9 · GA track (D-035) · 2026-07-09**

Green-check / syncing / error badges painted directly on files **in Windows Explorer and macOS Finder** — the signature "it feels like Dropbox" feature. Owner-authorized (Phil, 2026-07-09: "huge value driver… evaluate, plan, implement, thoroughly test"). Full platform evaluations: [research/OVERLAYS-WINDOWS-EVAL.md](./research/OVERLAYS-WINDOWS-EVAL.md), [research/OVERLAYS-MACOS-EVAL.md](./research/OVERLAYS-MACOS-EVAL.md).

**Bottom line:** well-established patterns, genuinely doable, **not** a quick win — ~5–7 native weeks per platform + a shared core, and it is **gated on code-signing/notarization certs** (which GA needs anyway). It does **not** block beta. Recommended: build the platform-agnostic core now (unblocked, testable in current CI), do the native layers once certs + native CI runners are in place, Windows first.

---

## 1. Shared architecture (both platforms, build first)

We already have the truth and the live channel — no new sync plumbing needed:
- **Truth:** `drive_metadata_cache.localPath` + `syncStatus` (7 values: `synced` / `pending` / `downloading` / `queued` / `cloud_only` / `error` / `failed`) in the profile DB.
- **Live channel:** `sync:file-state-changed { fileId, syncStatus }` (already emitted from `main.ts:2221/2252`, exposed in `preload.ts:447`).

**`OverlayStatusPublisher`** (new, Electron main, platform-agnostic, pure TS — **Phase 0, ships in normal CI**):
1. Subscribes to `sync:file-state-changed`; resolves `fileId → localPath` via `drive_metadata_cache`.
2. Collapses the 7 statuses → **3 badge buckets** (keep it to 3 — Windows only has slots for a few, and 3 reads clearly):
   - **Synced** (green ✓) ← `synced`
   - **Syncing** (blue ⟳) ← `pending`, `queued`, `downloading`
   - **Error** (red !) ← `error`, `failed`
   - `cloud_only` → no local badge (it isn't on disk; revisit with FEAT-7 files-on-demand)
3. Publishes a `path → bucket` snapshot per watched directory to the native layer through a small platform-specific transport (below), and signals the shell to repaint.

This core is the reusable spine; each OS differs only in *transport + shell integration*.

---

## 2. Windows

**Approach (now): legacy Shell Icon Overlay Handler.** In-proc COM DLL implementing `IShellIconOverlayIdentifier`, three CLSIDs (synced/syncing/error), registered under `HKLM\…\ShellIconOverlayIdentifiers`. It badges our **real, already-local** files with zero change to storage semantics and uses only 3 of the 15 slots.

**Bridge:** an Electron-main `OverlayStatusPublisher` writes a lock-free **memory-mapped `path → bucket` table** the DLL reads on Explorer's UI thread (no DB/IO in the handler — critical for shell stability), then pokes `SHChangeNotify`. DLL in C++/MSVC; a small **N-API addon** does the MMF write + `SHChangeNotify`.

**Phase 2 (later, with FEAT-7):** migrate to the **Windows Cloud Files / Cloud Filter API** (`StorageProviderSyncRootManager`, `cldapi`) — what modern OneDrive uses. It gives overlays "free" (no slot war) but forces placeholder/hydration/reparse-point semantics + NTFS-only + a sparse-MSIX identity — only worth it once we actually build files-on-demand, which it then subsumes.

**Top risks:** (1) **15-slot global limit** — on machines with OneDrive+Dropbox+Google+Tortoise our badges can silently never paint (alphabetical-first-15, ~11 usable); mitigate with leading-space key names + keep in-app status authoritative. (2) **In-proc stability inside explorer.exe** — a slow/crashy `IsMemberOf` degrades the whole shell; mitigate with lock-free MMF reads only, fail-safe to `S_FALSE`. (3) **HKLM/admin/per-machine install + locked-DLL updates** + our installer currently signs nothing and is per-user.

**Effort:** ~5–7 focused Win32/COM weeks (greenfield DLL + shared-memory bridge + native `SHChangeNotify` addon + NSIS registration surgery + first-time signing + a manual Win10/11 matrix; repo has no native-addon toolchain today).

---

## 3. macOS

**Approach: Finder Sync app-extension** (`FIFinderSync`, extension point `com.apple.FinderSync`), Swift, built separately with **Xcode into an `.appex`**, injected into the Electron `.app` at `Contents/PlugIns/` via an electron-builder **`afterPack`** hook (`ditto`, inside-out signing) so it's sealed in the app's Developer-ID signature and **notarized as one unit**.

**Bridge:** the sandboxed extension and Electron main share an **App Group container** — the `OverlayStatusPublisher`'s macOS transport writes a per-directory `path → bucket` snapshot into the shared container and fires a **Darwin notification** so the extension repaints visible items.

**Top risks:** (1) **Notarization + inside-out signing of the embedded `.appex`** (highest) — wrong order → "app is damaged" or a silently non-loading extension, only reproducible on a clean Gatekeeper machine. (2) **Enable-friction** — the user must manually enable it (the app can't); Apple *removed* the toggle in macOS 15.0 and restored it in 15.2, so we need version-aware first-run coaching UX (+ a `pluginkit` fallback). (3) **App Groups on Developer-ID (non-App-Store) builds** silently failing the shared-container handoff → blank badges; prove the round-trip on real hardware in week 1. (Apple's strategic path — File Provider / `NSFileProviderItemDecorating` — is deliberately out of scope; it would re-architect our real-local-folder model.)

**Effort:** ~4–7 focused weeks, +~1 week if signing/notarization isn't already working.

---

## 4. Hard external dependencies (Phil's to procure — blocking, and GA needs them anyway)

These gate the native layers *and* GA distribution broadly (beta is unsigned per D-004; GA is not):
- **Windows: an OV Authenticode code-signing certificate** (OV is sufficient — EV lost its SmartScreen edge in March 2024; both need HSM/token now) on a cloud HSM. Days-to-weeks identity-vetting lead time.
- **macOS: Apple Developer Program** ($99/yr) + a Developer ID cert + notarization credentials + a registered **App Group ID**.
- **CI:** a **Windows/MSVC agent** and a **macOS+Xcode runner** (the `.appex` cannot be cross-compiled from our current Linux/Windows CI) + Win10/Win11 and macOS 13/14/15 (incl. 15.0/15.1 and 15.2+) **test machines** — the test matrix is largely manual.

---

## 5. Phasing & sequencing (gates, not dates — D-003)

- **Phase 0 — shared core (now, unblocked):** `OverlayStatusPublisher` (fileId→localPath, 7→3 bucket collapse, per-dir snapshot + native-facing contract, debounced updates). Pure TS, unit-tested in existing CI. De-risks the integration before any native code.
- **Phase 1 — one platform, static → live:** pick Windows first (larger install base for a sync utility). MVP one static green-check → all three buckets → live `SHChangeNotify` updates → slot-collision/polish. Requires the Windows cert + MSVC CI.
- **Phase 2 — second platform:** macOS Finder Sync `.appex` + App Group bridge + enable-UX. Requires Apple Developer setup + macOS CI.
- **Phase 3 (future, with FEAT-7 files-on-demand):** Windows Cloud Files API + (re-evaluate) macOS File Provider — overlays come "free," slot war disappears.

**Recommended immediate step:** start Phase 0 now (I can dispatch it — it's safe and useful regardless), and in parallel Phil procures the certs + CI runners (which GA needs anyway). Native phases begin once those land.

## 6. Open decisions for Phil
1. **Platform order** — Windows first (recommended) vs macOS first vs fund both in parallel.
2. **Cert/CI procurement** — greenlight the Apple Developer Program + Windows OV cert + macOS CI runner (the blocking dependency; also the GA-distribution prerequisite).
3. **Confirm GA-track** — overlays do not block beta; ship beta on the current in-app + tray + notification status surfaces, add overlays for GA.
