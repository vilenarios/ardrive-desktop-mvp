# 🚀 ArDrive Desktop MVP - Development Workflow

## Branch Strategy: Keep It Simple

For this MVP, we're using a **single-branch strategy**:
- `main` - All development happens here
- Create tags for releases

This avoids complexity while you're iterating quickly.

## Development Workflow

### 1. Daily Development
```bash
# Make changes locally
git add .
git commit -m "feat: add new feature"
git push
```

**Builds are NOT automatic** to save GitHub Actions minutes.

### 2. When You Want to Test (Manual Builds)

#### Quick Test Build:
1. Go to: Actions tab on GitHub
2. Click "MVP Build & Test"
3. Select:
   - Build type: `test`
   - Platforms: `both`
4. Click "Run workflow"
5. Download artifacts after ~15 min

#### Share with Testers:
- Download the artifacts
- Upload to Google Drive/Dropbox
- Share links

### 3. Creating a Release

When you're ready for a version:

```bash
# 1. Update version
npm version patch  # 0.0.1 → 0.0.2

# 2. Push with tags (triggers auto-build)
git push && git push --tags
```

This automatically:
- Builds both platforms
- Creates GitHub Release
- Attaches installers

## 📊 GitHub Actions Usage

**Free tier: 2,000 minutes/month**

| Action | Time | Cost |
|--------|------|------|
| Manual test build | ~18 min | Manual only |
| Release (via tag) | ~20 min | Automatic |
| Monthly budget | ~100 builds | Stay under limit |

## 🎯 MVP Best Practices

### DO:
✅ Test locally first (`npm run dev`)  
✅ Batch changes before building  
✅ Use manual builds for testing  
✅ Tag releases for versions  
✅ Keep commits clean and descriptive  

### DON'T:
❌ Enable automatic builds on every push  
❌ Create builds for tiny changes  
❌ Use complex branching (not needed yet)  
❌ Worry about code signing (MVP phase)  

## Common Scenarios

### "I want to test my changes"
```bash
git push  # Push your code
# Go to GitHub Actions → Run workflow manually
```

### "I want to release a version"
```bash
npm version patch
git push && git push --tags
# Automatic build + release
```

### "I want to test without pushing"
```bash
npm run dev  # Test locally
npm run build  # Build locally
npm run dist:win  # Create local Windows build
```

### "Build failed on GitHub"
1. Check Actions tab → Click failed build
2. Read error logs
3. Fix locally
4. Push fix
5. Run workflow again

## 📋 Release Checklist

Before creating a release:
- [ ] Test locally: `npm run dev`
- [ ] Type check: `npm run typecheck`
- [ ] Lint: `npm run lint`
- [ ] Update version: `npm version patch`
- [ ] Push tags: `git push --tags`

## 🔄 Future Improvements (Post-MVP)

Once your MVP is stable, consider:
1. **Add develop branch** for staging
2. **Enable auto-builds** on develop only
3. **Add PR checks** for code quality
4. **Implement auto-updates** in app
5. **Add code signing** for production

## Quick Commands

```bash
# Development
npm run dev           # Start dev mode
npm run build        # Build locally
npm run test         # Run tests

# Releases
npm run release:patch  # Bump version + release (0.0.1 → 0.0.2)
npm run release:minor  # Minor release (0.0.1 → 0.1.0)
npm run release:major  # Major release (0.0.1 → 1.0.0)

# Manual testing
npm run dist:win     # Build Windows locally
npm run dist:mac     # Build Mac locally
```

## 🚦 Status Checks

Check your GitHub Actions usage:
- Go to: Settings → Billing → Actions
- Shows minutes used this month
- Resets monthly

## Summary

**Your MVP workflow is:**
1. Develop on `main`
2. Push when ready
3. Manually build for testing
4. Tag for releases

Simple, effective, and preserves your free GitHub Actions minutes!