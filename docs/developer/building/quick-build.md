# ArDrive Desktop - Quick Build Guide for v0.0.1

## 🚨 WSL/Linux Build Issues - Solutions

The SQLite native module issue in WSL is common. Here are several working solutions:

### ✅ **Solution 1: Use GitHub Actions (Recommended)**

Create `.github/workflows/build-release.yml`:

```yaml
name: Build Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            platform: win
          - os: macos-latest
            platform: mac
          - os: ubuntu-latest
            platform: linux

    runs-on: ${{ matrix.os }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: npm run build

      - name: Build installer
        run: npm run dist
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ArDrive-Desktop-${{ matrix.platform }}
          path: release/
```

**Usage:**
1. Commit your code to GitHub
2. Create a tag: `git tag v0.0.1 && git push origin v0.0.1`
3. GitHub will automatically build installers for all platforms
4. Download from Actions artifacts

### ✅ **Solution 2: Windows Command Line (If available)**

If you have access to Windows (not WSL):

```cmd
# In Windows Command Prompt or PowerShell
npm install
npm run build
npm run dist:win
```

### ✅ **Solution 3: Docker Build (Cross-platform)**

Create `Dockerfile.build`:

```dockerfile
FROM node:18-alpine

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libx11-dev \
    libxkbfile-dev \
    libsecret-dev

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Build for Linux
RUN npm run dist:linux
```

**Usage:**
```bash
# Build the Docker image
docker build -f Dockerfile.build -t ardrive-builder .

# Run the build
docker run --rm -v $(pwd)/release:/app/release ardrive-builder

# Copy built files
cp -r release/ ./final-release/
```

### ✅ **Solution 4: Skip Native Rebuild (Testing Only)**

For development/testing purposes:

```bash
# Set environment to skip native rebuilds
export npm_config_build_from_source=false
export npm_config_cache_min=999999999

# Try building with reduced rebuilding
npx electron-builder --linux --publish=never --config.electronDist=dist --config.electronVersion=27.1.3
```

## 🎯 **Immediate Action Plan**

Since you want to release v0.0.1 quickly, here's what I recommend:

### **Option A: GitHub Actions (Best)**
1. **Create the workflow file above**
2. **Commit and push to GitHub**
3. **Create release tag**: `git tag v0.0.1 && git push origin v0.0.1`
4. **Wait 10-15 minutes for builds to complete**
5. **Download all platform installers from GitHub Actions**

### **Option B: Manual Platform Builds**
1. **Windows**: Use a Windows machine or VM
2. **macOS**: Use a Mac or macOS VM  
3. **Linux**: Use a native Linux system (not WSL)

### **Option C: Release Source Code Only (MVP)**
For immediate v0.0.1 release:
1. **Tag the release**: `git tag v0.0.1`
2. **Push to GitHub**: `git push origin v0.0.1`
3. **Create GitHub release with source code**
4. **Add note**: "Compiled binaries coming soon - users can build from source"

## 📦 **Manual Build Instructions for Users**

Include this in your release notes:

```markdown
## Building from Source

### Prerequisites
- Node.js 18+
- Git

### Steps
```bash
git clone https://github.com/ardriveapp/ardrive-desktop.git
cd ardrive-desktop
npm install
npm run build
npm start  # Run directly with Electron
```

### Create Installer
```bash
# Windows
npm run dist:win

# macOS  
npm run dist:mac

# Linux
npm run dist:linux
```
```

## 🚀 **GitHub Actions Workflow (Copy & Paste)**

Create this file: `.github/workflows/build-release.yml`

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'
  pull_request:
    branches: [ main ]

jobs:
  build:
    name: Build on ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]

    steps:
    - name: Check out Git repository
      uses: actions/checkout@v4

    - name: Install Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 18
        cache: npm

    - name: Install dependencies
      run: npm ci

    - name: Build Electron app
      run: npm run build

    - name: Package Electron app
      run: npm run dist
      env:
        # Disable code signing for now
        CSC_IDENTITY_AUTO_DISCOVERY: false
        # Set GitHub token for auto-publish
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    - name: Upload build artifacts
      uses: actions/upload-artifact@v4
      with:
        name: ${{ matrix.os }}-build
        path: |
          release/*.exe
          release/*.dmg
          release/*.AppImage
          release/*.deb
          release/*.zip
        retention-days: 30
```

## 🏃‍♂️ **30-Second Quick Release**

If you want to release **right now**:

```bash
# 1. Finalize your code
git add .
git commit -m "Release v0.0.1 - Initial MVP"

# 2. Create the tag
git tag v0.0.1

# 3. Push everything
git push origin main
git push origin v0.0.1

# 4. Create GitHub release
gh release create v0.0.1 \
  --title "ArDrive Desktop v0.0.1 - Initial MVP" \
  --notes-file RELEASE_NOTES_v0.0.1.md \
  --draft

# 5. Add a note about upcoming binaries
echo "Compiled installers for Windows, macOS, and Linux will be added within 24 hours. Users can build from source in the meantime." | gh release edit v0.0.1 --notes-file -
```

## 🔧 **Next Steps After Release**

1. **Set up CI/CD** with the GitHub Actions workflow above
2. **Test builds** on different platforms
3. **Add code signing** for Windows and macOS
4. **Set up auto-updates** for future versions

The most important thing is getting v0.0.1 tagged and released - you can always add the compiled binaries later!

**Would you like me to help you set up the GitHub Actions workflow right now?**