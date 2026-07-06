# Build & Distribution Strategy (2026-07-05)

Grounded in the actual `package.json` `build` config + release workflow. How we build today, what to prep before public/strategic distribution, and where to place the app.

## Where we are today (honest)
- **electron-builder** produces: **Windows** nsis installer + portable (x64), **macOS** dmg + zip (x64 **and** arm64), **Linux** (AppImage/deb). appId `com.ardrive.desktop`.
- Release via `release:patch|minor|major` (version bump + tag + push); GitHub Actions `mvp-workflow.yml` builds the Win+Mac matrix on `workflow_dispatch` or a version tag and uploads artifacts.
- **UNSIGNED, un-notarized, no auto-update, no publish provider.** No `mac.notarize`/`hardenedRuntime`/`identity`, no `win.certificateFile`, no `afterSign`, no `electron-updater`.
- **Verdict:** correct for the **closed tester beta** (D-004: unsigned installers via GitHub Releases). **Not ready** for public or any strategic channel — those all require signed/notarized builds.

## What to prep BEFORE public / strategic distribution (the gating work)

### 1. Code signing + notarization — THE prerequisite (Track D)
Almost every strategic channel and auto-update itself require this. Without it: macOS Gatekeeper blocks ("unidentified developer"), Windows SmartScreen warns ("unknown publisher") — brutal install friction.
- **macOS:** Apple Developer Program ($99/yr) → Developer ID Application cert → `hardenedRuntime: true` + entitlements + `notarize` (staple the ticket). CI secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows:** a code-signing cert. An OV cert still shows SmartScreen until reputation accrues; **EV cert or Azure Trusted Signing** (the modern, cheaper, no-hardware path) gives immediate trust. CI secrets: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (or Trusted Signing config).
- Cost: ~$99/yr Apple + ~$100–400/yr Windows. **This is the #1 dependency — schedule it first.**

### 2. Auto-update (INFRA-4 — currently MISSING)
`electron-updater` + a publish provider (GitHub Releases works as the feed; or S3/generic). Requires signed builds (mandatory on macOS). Without it, users get stranded on old versions and you can't push security fixes.

### 3. Canonical download page
The single strategic anchor everything points to: **ardrive.io/download** with OS auto-detect, SHA-256 checksums, "what's new," and system requirements. Bonus/on-brand: **host it on the permaweb** (dogfood — ArDrive distributed via Arweave).

### 4. Release hygiene
Semver (have it), a maintained CHANGELOG + release notes, published SHA-256 checksums, and ideally reproducible builds. Consider a `latest` channel vs `beta` channel.

## Strategic distribution channels (tiered by leverage vs effort)

### Tier 1 — Own & direct (do first, post-signing)
- **ardrive.io download page** (canonical) + **GitHub Releases** (already the mechanism).
- **Permaweb-hosted** download page / web app — censorship-resistant, on-brand.

### Tier 2 — Package managers (high leverage, power-user + dev reach, low cost once signed)
- **macOS — Homebrew Cask** (`brew install --cask ardrive`) — the Mac-dev default; a PR to homebrew-cask (needs notarized build).
- **Windows — winget** (`winget install ArDrive`, Microsoft's official CLI, increasingly default) + **Chocolatey**.
- **Linux — Flathub (Flatpak) + Snap Store + AUR** — broad reach across distros.

### Tier 3 — App stores (highest trust/discovery, most friction)
- **Microsoft Store** — relatively easy for Electron (wrap the installer as MSIX / Desktop Bridge); good discovery.
- **Mac App Store** — big trust + discovery, BUT sandboxing is hard for a sync app (arbitrary-folder access + keychain + network); likely doesn't fit MAS rules cleanly — **assess before committing**; notarized direct-download is often the better call for a power tool.
- **Setapp** (Mac subscription bundle) — a distribution + monetization channel worth evaluating.

### Tier 4 — Ecosystem & discovery (marketing-driven)
- **ar.io / Arweave ecosystem** placement (app directories, ecosystem partners, awesome-arweave) — home-turf.
- **Product Hunt** launch; **AlternativeTo** (position vs Dropbox / OneDrive / iCloud); web3/crypto app directories.

## Recommended sequencing
1. **Now (closed beta):** ship as-is — unsigned GitHub Releases + `build:testers`. Fine per D-004.
2. **Before public launch:** **sign + notarize** → **auto-update** → **ardrive.io/download page** → **Homebrew + winget** (cheap, high-leverage).
3. **Post-launch traction:** Microsoft Store, Flathub/Snap, Product Hunt, ecosystem placement; evaluate MAS sandboxing + Setapp.

## Key dependency
**Signing gates everything strategic.** Stores + package managers require signed/notarized builds, and auto-update needs signing on macOS. Get the Apple Developer account + a Windows signing solution in motion first; the rest unblocks from there.
