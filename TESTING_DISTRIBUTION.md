# ArDrive Desktop - Testing Distribution Guide

## 🚀 Quick Start for Developers

### One-Command Build for Testers

```bash
# Automatically builds for your current platform
npm run build:testers
```

This command will:
1. Clean previous builds
2. Install dependencies
3. Build the application
4. Create installer packages
5. Show you exactly what files to share

### Platform-Specific Builds

```bash
# Windows only
npm run dist:win

# macOS only  
npm run dist:mac

# Linux only
npm run dist:linux
```

## 📦 Distribution Files

After building, find your installers in the `release/` folder:

| Platform | File Type | Description | File Size |
|----------|-----------|-------------|-----------|
| Windows | `.exe` | NSIS installer (recommended) | ~80-100 MB |
| Windows | `-portable.exe` | Portable version (no install) | ~80-100 MB |
| macOS | `.dmg` | Disk image installer (recommended) | ~100-120 MB |
| macOS | `.zip` | Archive (quick testing) | ~100-120 MB |
| Linux | `.AppImage` | Universal package | ~100-120 MB |
| Linux | `.deb` | Debian/Ubuntu package | ~80-100 MB |

## 🎯 Distribution Methods

### Method 1: Direct File Sharing (Easiest)
**Best for:** Small group of trusted testers

1. Build locally: `npm run build:testers`
2. Upload to your preferred service:
   - Google Drive
   - Dropbox
   - WeTransfer
   - Direct email (if under 25MB)
3. Share download link with testers

### Method 2: GitHub Releases (Recommended)
**Best for:** Public testing, version tracking

1. Create a test release tag:
   ```bash
   git tag v0.0.1-beta.1
   git push origin v0.0.1-beta.1
   ```

2. GitHub Actions will automatically:
   - Build for Windows, macOS, and Linux
   - Create a GitHub Release
   - Attach all installers

3. Share the release URL with testers

### Method 3: Manual GitHub Release
**Best for:** Quick releases without CI

1. Build locally for each platform
2. Go to GitHub → Releases → "Draft a new release"
3. Upload the files from `release/` folder
4. Mark as "Pre-release" for beta testing

## 🧪 For Testers

### Installation Instructions

#### Windows
1. Download the `.exe` file
2. Run the installer
3. Windows SmartScreen may warn about unsigned app - click "More info" → "Run anyway"

#### macOS  
1. Download the `.dmg` file
2. Open the DMG and drag ArDrive to Applications
3. First run: Right-click → Open (to bypass Gatekeeper for unsigned app)

#### Linux
1. Download the `.AppImage`
2. Make it executable: `chmod +x ArDrive-Desktop-*.AppImage`
3. Run it: `./ArDrive-Desktop-*.AppImage`

### Known Issues for Unsigned Apps

Since the app isn't code-signed yet (requires paid certificates):

- **Windows:** SmartScreen warning
- **macOS:** Gatekeeper warning  
- **Linux:** No issues

These warnings are normal for test builds and will be resolved with code signing in production.

## 🔄 GitHub Actions (Automated Builds)

The repository includes a GitHub Actions workflow that:

1. **Triggers on:**
   - Push to tags starting with `v*` (e.g., `v0.0.1-beta`)
   - Manual trigger via Actions tab

2. **Builds for:**
   - Windows (x64)
   - macOS (x64 + arm64)
   - Linux (x64)

3. **Creates:**
   - GitHub Release with all installers
   - Download artifacts (kept for 30 days)

### To Use GitHub Actions:

1. Push a version tag:
   ```bash
   npm version patch  # Updates version in package.json
   git push && git push --tags
   ```

2. Or manually trigger:
   - Go to Actions tab → "Build and Release" → "Run workflow"

## 📝 Version Management

### Versioning Strategy

```
v0.0.1-beta.1  → Beta testing
v0.0.1-rc.1    → Release candidate
v0.0.1         → Official release
```

### Update Version

```bash
# Update package.json version
npm version patch     # 0.0.1 → 0.0.2
npm version minor     # 0.0.1 → 0.1.0
npm version major     # 0.0.1 → 1.0.0

# Or manually edit package.json
```

## 🛡️ Future: Code Signing

For production releases, you'll want to sign your apps:

### Windows
- Need a Code Signing Certificate (~$200-500/year)
- Or use Azure Trusted Signing (~$10/month)

### macOS
- Need Apple Developer account ($99/year)
- Notarization required for distribution outside App Store

### Benefits
- No security warnings
- Automatic updates work properly
- Professional appearance
- User trust

## 🎯 Recommendation for Getting Started

**For immediate testing with 5-10 testers:**
1. Use `npm run build:testers` locally
2. Upload to Google Drive/Dropbox
3. Share links directly

**Once you have more testers or want automation:**
1. Use the GitHub Actions workflow
2. Create beta releases with version tags
3. Testers download from GitHub Releases page

**For production:**
1. Set up code signing
2. Consider auto-updater
3. Use GitHub Actions for all builds

## 📊 Testing Feedback

Create a simple feedback form for testers:
- Installation issues
- Performance problems  
- Feature requests
- Bug reports

Consider using:
- GitHub Issues with a "beta-feedback" label
- Google Forms for non-technical testers
- Discord/Slack channel for real-time feedback