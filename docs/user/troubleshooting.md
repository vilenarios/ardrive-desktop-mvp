# Troubleshooting Guide

## Common Issues and Solutions

### TypeScript Errors

#### "Property does not exist on type"
- Check type definitions in `src/types/index.ts`
- Ensure imports are correct
- Run `npm run typecheck` to see all errors

#### "Module not found"
- Check import paths (use relative paths)
- Ensure the file exists
- Restart dev server after installing packages

### Build Issues

#### "Cannot find module 'electron'"
```bash
npm install
npm run clean
npm run build
```

#### Build hangs or fails
```bash
# Clean everything and rebuild
rm -rf node_modules dist out
npm install
npm run build
```

### Wallet Issues

#### "Wallet not loaded"
- Ensure wallet import completed successfully
- Check if profile is active
- Verify password is correct

#### "Invalid seed phrase"
- Must be exactly 12 words
- Check for extra spaces
- Verify words are valid BIP39 words

### Sync Issues

#### Files not syncing
1. Check sync folder permissions
2. Verify drive is selected
3. Check if sync is running (see dashboard)
4. Look at console logs for errors

#### "Permission denied" errors
- Run as administrator (Windows)
- Check folder ownership (macOS/Linux)
- Ensure antivirus isn't blocking

### Runtime Errors

#### White screen on startup
1. Open DevTools (Ctrl+Shift+I)
2. Check console for errors
3. Usually a React rendering error

#### App crashes immediately
- Check main process logs
- Run `npm run dev:main` separately
- Look for unhandled promise rejections

### Development Issues

#### Hot reload not working
- Restart the dev server
- Check webpack dev server is running
- Clear webpack cache

#### Changes not reflecting
1. Hard refresh (Ctrl+Shift+R)
2. Restart dev server
3. Check file saved correctly

## Debug Commands

```bash
# Check all TypeScript errors
npm run typecheck

# Run linter
npm run lint

# Clean build
npm run clean && npm run build

# Test specific flows
npm run uat:new-user      # New user flow
npm run uat:dashboard     # Dashboard testing
```

## Logging

### Enable verbose logging
```javascript
// In main.ts
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('v', '1');
```

### View logs
- Windows: `%APPDATA%/ardrive-desktop-mvp/logs`
- macOS: `~/Library/Logs/ardrive-desktop-mvp`
- Linux: `~/.config/ardrive-desktop-mvp/logs`

## Getting Help

1. Check console logs first
2. Run with `npm run dev` for detailed output
3. Use development tools (Ctrl+D) for testing
4. Check [CLAUDE.md](./CLAUDE.md) for architecture details