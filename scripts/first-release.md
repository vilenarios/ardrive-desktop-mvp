# 🎯 Your First GitHub Release - Quick Start

## Prerequisites
- Your code pushed to GitHub
- That's it!

## Step 1: Test the Workflow First

1. Go to your repo on GitHub:
   ```
   https://github.com/[your-username]/ardrive-desktop-mvp
   ```

2. Click the **"Actions"** tab at the top

3. You should see two workflows:
   - **Quick Test Build** - For testing
   - **Build & Release** - For releases

4. Click **"Quick Test Build"**

5. Click **"Run workflow"** button (green button on the right)

6. Select **"both"** for platform → Click **"Run workflow"**

7. Wait ~15 minutes. You'll see:
   - ✅ Green checkmark when done
   - ❌ Red X if it fails (check logs)

8. Click on the completed run, scroll to bottom

9. Download:
   - **windows-portable** (your .exe file)  
   - **mac-dmg** (your .dmg file)

## Step 2: Test Your Builds

### Windows
- Just run the .exe file
- It's portable (no installation)

### Mac  
- Open the .dmg
- Drag to Applications
- Right-click → Open (first time only)

## Step 3: Share with Testers

Upload your downloaded files to:
- Google Drive
- Dropbox  
- WeTransfer
- Direct email (if small enough)

## 🚨 If Build Fails

Common fixes:

1. **Icon error**: Your logo file might be too small
2. **TypeScript errors**: Run `npm run typecheck` locally
3. **Missing deps**: Make sure package.json is committed

Check the logs:
- Click on the failed job
- Click on the step that failed
- Read the error message

## 📈 Next Steps

Once this works, you can:
1. Create official releases with version tags
2. Set up auto-updates
3. Add code signing (later, costs money)

## Need Help?

- Check `RELEASE_GUIDE.md` for detailed info
- GitHub Actions are in `.github/workflows/`
- Free tier = 2000 minutes/month (plenty for MVP!)

---

**Quick Test Command** (if you want to trigger from command line):
```bash
gh workflow run quick-build.yml -f platform=both
```
(Requires GitHub CLI installed)