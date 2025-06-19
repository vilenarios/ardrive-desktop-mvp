# ArDrive Desktop - Building Installers

This guide shows you how to build installable packages for Windows, macOS, and Linux.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Project dependencies installed (`npm install`)
- Application built (`npm run build`)

### Build Commands

```bash
# Build for your current platform
npm run dist

# Build for specific platforms
npm run dist:win     # Windows (.exe installer + portable)
npm run dist:mac     # macOS (.dmg + .zip)
npm run dist:linux   # Linux (.AppImage + .deb)

# Build for all platforms (requires platform-specific tools)
npm run dist:all

# Use the helper script
npm run build-installer windows
npm run build-installer mac  
npm run build-installer linux
npm run build-installer all
```

## 📦 What Gets Built

### Windows
- **ArDrive Desktop Setup.exe** - NSIS installer with wizard
- **ArDrive Desktop.exe** - Portable executable (no installation)

### macOS  
- **ArDrive Desktop.dmg** - Disk image for drag-to-Applications install
- **ArDrive Desktop-mac.zip** - Archive for manual installation

### Linux
- **ArDrive Desktop.AppImage** - Universal Linux app (no installation needed)
- **ArDrive Desktop.deb** - Debian package for apt-based systems

## 🛠️ Platform-Specific Setup

### Building on Windows
```cmd
# Install Visual Studio Build Tools (for native modules)
npm install --global windows-build-tools

# Build Windows installer
npm run dist:win
```

### Building on macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Build macOS installer  
npm run dist:mac

# For code signing (optional)
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist:mac
```

### Building on Linux (Ubuntu/Debian)
```bash
# Install build dependencies
sudo apt update
sudo apt install build-essential libnss3-dev libatk-bridge2.0-dev libdrm2-dev libxss1-dev libgconf-2-4 libxrandr2-dev libasound2-dev libpangocairo-1.0-0 libatk1.0-dev libcairo-dev libgtk-3-dev libgdk-pixbuf2.0-dev

# Build Linux packages
npm run dist:linux
```

## 🔧 Troubleshooting

### SQLite Native Module Issues (WSL/Linux)
If you get SQLite compilation errors, try:

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install

# Force rebuild native modules
npm rebuild sqlite3

# Skip native rebuild (for testing)
npm run build
npx electron-builder --linux --publish=never
```

### Windows on WSL
WSL cannot build Windows executables. Use one of these approaches:

1. **Use Windows Command Prompt/PowerShell directly**
2. **Use GitHub Actions** (recommended for CI/CD)
3. **Use a Windows VM or machine**

### macOS Code Signing
To disable code signing (for testing):
```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run dist:mac
```

For real code signing, you need:
- Apple Developer account
- Code signing certificate
- Set `CSC_LINK` or `CSC_KEY_PASSWORD` environment variables

## 🤖 Automated Builds with GitHub Actions

Create `.github/workflows/build.yml`:

```yaml
name: Build Installers

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    
    runs-on: ${{ matrix.os }}
    
    steps:
    - uses: actions/checkout@v3
    
    - uses: actions/setup-node@v3
      with:
        node-version: 18
        cache: 'npm'
    
    - run: npm ci
    - run: npm run build
    - run: npm run dist
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    
    - uses: actions/upload-artifact@v3
      with:
        name: installers-${{ matrix.os }}
        path: release/
```

## 📋 Build Configuration

The build configuration in `package.json` includes:

```json
{
  "build": {
    "appId": "com.ardrive.desktop",
    "productName": "ArDrive Desktop",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "package.json",
      "assets/*"
    ]
  }
}
```

### Customizing the Build

#### Change App Icon
Replace `assets/favicon.png` with your icon (256x256 PNG recommended)

#### Windows Installer Options
```json
{
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  }
}
```

#### macOS DMG Options
```json
{
  "dmg": {
    "title": "ArDrive Desktop ${version}",
    "background": "assets/dmg-background.png",
    "contents": [
      { "x": 130, "y": 150, "type": "file" },
      { "x": 410, "y": 150, "type": "link", "path": "/Applications" }
    ]
  }
}
```

## 🚀 Release Process

### 1. Prepare Release
```bash
# Update version
npm version patch  # or minor, major

# Build and test
npm run build
npm run test
```

### 2. Build Installers
```bash
# Build for all platforms (if available)
npm run dist:all

# Or build individually
npm run dist:win
npm run dist:mac  
npm run dist:linux
```

### 3. Test Installers
- Test installation on target platforms
- Verify app functionality after installation
- Check file associations and shortcuts

### 4. Upload to GitHub
```bash
# Create release on GitHub
gh release create v0.0.1 release/* --title "ArDrive Desktop v0.0.1" --notes-file RELEASE_NOTES_v0.0.1.md
```

## 📁 Output Structure

After building, the `release/` folder contains:

```
release/
├── ArDrive Desktop Setup 0.0.1.exe          # Windows installer
├── ArDrive Desktop 0.0.1.exe                # Windows portable
├── ArDrive Desktop-0.0.1.dmg                # macOS installer
├── ArDrive Desktop-0.0.1-mac.zip            # macOS archive
├── ArDrive Desktop-0.0.1.AppImage           # Linux universal
├── ArDrive Desktop_0.0.1_amd64.deb          # Linux Debian
└── builder-*.yaml                           # Build metadata
```

## 🔍 File Sizes (Approximate)

- **Windows**: ~150MB (installer), ~300MB (unpacked)
- **macOS**: ~160MB (DMG), ~320MB (unpacked)  
- **Linux**: ~170MB (AppImage), ~150MB (DEB)

## 📞 Support

If you encounter build issues:

1. Check the [Electron Builder docs](https://www.electron.build/)
2. Review the troubleshooting section above
3. Open an issue with build logs
4. Ask in the ArDrive Discord

## 🎯 Next Steps

- Set up automated builds with GitHub Actions
- Add code signing for Windows and macOS
- Create auto-updater functionality
- Optimize bundle size

**Happy building! 🚀**