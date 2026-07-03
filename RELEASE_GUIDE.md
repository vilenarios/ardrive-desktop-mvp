# 🚀 ArDrive Desktop - Release Guide

## Overview

This guide explains how to build and release ArDrive Desktop using GitHub Actions (free tier optimized).

## 📊 GitHub Free Tier Limits
- **2,000 minutes/month** for private repos
- **Unlimited** for public repos  
- Build times: ~8 min (Windows), ~10 min (Mac)

## 🛠️ Available Workflows

### 1. Quick Test Build (`quick-build.yml`)
**Purpose:** Fast builds for testing without creating releases  
**When to use:** Testing changes, sharing with a few testers  
**How to trigger:**
1. Go to Actions tab → "Quick Test Build"
2. Click "Run workflow"
3. Select platform (Windows/Mac/Both)
4. Downloads available for 3 days

### 2. Build & Release (`build-test-release.yml`)
**Purpose:** Official releases with GitHub Release page  
**When to use:** Beta releases, official versions  
**How to trigger:**

**Option A - Manual Release:**
1. Go to Actions tab → "Build & Release"
2. Click "Run workflow"
3. Select release type:
   - `test` = Draft release (not public)
   - `beta` = Pre-release (marked as beta)
   - `release` = Full release

**Option B - Tag Release:**
```bash
# Update version in package.json first
npm version patch  # or minor/major

# Push with tags
git push && git push --tags
```

## 📝 Step-by-Step Release Process

### For Quick Testing (Recommended for MVP)

1. **Make your changes and commit:**
```bash
git add .
git commit -m "Fix: some issue"
git push
```

2. **Go to GitHub Actions:**
- Navigate to: `https://github.com/[your-username]/ardrive-desktop-mvp/actions`
- Click "Quick Test Build"
- Click "Run workflow" → Select "both" → Run

3. **Download builds (after ~15 minutes):**
- Click on the completed workflow run
- Download artifacts at the bottom:
  - `windows-portable` → .exe file
  - `mac-dmg` → .dmg and .zip files

4. **Share with testers:**
- Upload to Google Drive/Dropbox
- Share download links

### For Official Releases

1. **Update version:**
```bash
# Update version number
npm version patch  # Changes 0.0.1 → 0.0.2
```

2. **Commit and tag:**
```bash
git add package.json package-lock.json
git commit -m "Release v0.0.2"
git tag v0.0.2
git push && git push --tags
```

3. **GitHub automatically:**
- Builds for Windows and Mac
- Creates a GitHub Release
- Attaches installers

4. **Share release link:**
```
https://github.com/[your-username]/ardrive-desktop-mvp/releases/latest
```

## 🎯 MVP Testing Strategy

### Phase 1: Initial Testing (You are here)
1. Use "Quick Test Build" workflow
2. Download artifacts
3. Test on your Mac
4. Share .exe with Windows testers

### Phase 2: Beta Testing  
1. Create beta releases with version tags
2. Share GitHub release links
3. Gather feedback via Issues

### Phase 3: Production
1. Add code signing ($99/year Apple, $200+/year Windows)
2. Set up auto-updater
3. Create official releases

## 💰 Cost Optimization Tips

### Keep builds under free tier:
- **Test locally first** - Don't trigger builds for every small change
- **Batch changes** - Group multiple fixes before building  
- **Use quick-build** - Only builds, no release overhead
- **Cancel stuck builds** - Save minutes if build hangs

### Monthly budget (2000 minutes):
- Quick builds: ~18 minutes (both platforms)
- Full releases: ~25 minutes (both platforms)
- **You can do ~100 quick builds/month on free tier**

## 🔧 Troubleshooting

### Build Fails
- Check Actions tab for error logs
- Common issues:
  - Icon size (must be 256x256+)
  - Missing dependencies
  - TypeScript errors

### Can't Download Artifacts
- Artifacts expire after set days (3 for quick, 7 for releases)
- Must be logged into GitHub to download

### Mac Build Issues
- Gatekeeper warnings are normal (app not signed)
- Tell testers: Right-click → Open on first run

## 📋 Pre-Release Checklist

Before creating a release:
- [ ] Run `npm run typecheck`
- [ ] Run `npm run lint`
- [ ] Test locally with `npm run dev`
- [ ] Update version in package.json
- [ ] Commit all changes
- [ ] Push to GitHub

## 🚦 Quick Commands Reference

```bash
# Local testing
npm run dev              # Development mode
npm run build           # Build locally
npm run dist:win        # Build Windows locally
npm run dist:mac        # Build Mac locally

# Version management  
npm version patch       # 0.0.1 → 0.0.2
npm version minor       # 0.0.1 → 0.1.0  
npm version major       # 0.0.1 → 1.0.0

# Git release
git tag v0.0.2          # Create version tag
git push --tags         # Push tags to trigger release

# Check workflow status
gh workflow list        # List all workflows
gh run list            # List recent runs
gh run watch          # Watch current run
```

## 📱 Sharing with Testers

### Windows Testers
1. Download: `ArDrive Desktop Setup 0.0.1.exe`
2. Install: Run exe, ignore SmartScreen warning
3. Or use portable: `ArDrive Desktop 0.0.1.exe` (no install)

### Mac Testers  
1. Download: `ArDrive Desktop-0.0.1.dmg`
2. Install: Open DMG, drag to Applications
3. First run: Right-click → Open

### Feedback Collection
- GitHub Issues with "beta-feedback" label
- Simple Google Form
- Discord/Slack channel

## 🎉 Your First Release

Ready to test? Here's the simplest approach:

1. Push your current code:
```bash
git push
```

2. Go to: https://github.com/[your-username]/ardrive-desktop-mvp/actions

3. Click "Quick Test Build" → "Run workflow" → Select "both"

4. Wait 15 minutes, download builds, test!

That's it! You'll have both Windows and Mac builds ready for testing.