# Claude Code Assistant Guide

This document helps AI assistants understand and work with the ArDrive Desktop MVP codebase.

## Project Overview
ArDrive Desktop MVP is an Electron-based desktop application for syncing files with Arweave's permanent storage network.

## Quick Start Commands
```bash
# Install dependencies
npm install

# Development
npm run dev          # Start in development mode
npm run build        # Build for production
npm run dist         # Package for distribution

# Testing
npm run test         # Run tests
npm run lint         # Run linter
npm run typecheck    # Run TypeScript type checking
```

## Project Structure
```
ardrive-desktop-mvp/
├── src/
│   ├── main/           # Main process (Node.js)
│   │   ├── main.ts     # Entry point & IPC handlers
│   │   ├── wallet-manager-secure.ts  # Secure wallet operations
│   │   ├── sync-manager.ts           # File sync engine
│   │   ├── profile-manager.ts        # Multi-profile support
│   │   ├── database-manager.ts       # SQLite database
│   │   ├── turbo-manager.ts          # Turbo credits
│   │   └── ...
│   ├── renderer/       # Renderer process (React)
│   │   ├── App.tsx     # Main React component
│   │   ├── components/ # React components
│   │   │   ├── WalletSetup.tsx       # Onboarding flow
│   │   │   ├── Dashboard.tsx         # Main dashboard
│   │   │   ├── DriveAndSyncSetup.tsx # Drive setup
│   │   │   └── ...
│   │   └── styles.css  # Global styles
│   └── types/          # Shared TypeScript types
├── public/             # Static assets
├── test-scripts/       # Testing utilities
└── package.json
```

## Key Concepts
1. **Electron Architecture**: Main process (Node.js) + Renderer process (React)
2. **IPC Communication**: Uses Electron's contextBridge for secure communication
3. **Wallet Management**: Secure encryption/decryption of Arweave wallets
4. **Drive Sync**: Monitors local folders and syncs with Arweave drives
5. **Profile System**: Multi-profile support with secure wallet isolation

## Recent Updates (Dec 2024)

### Dashboard Refinements
- **Drive Context Header**: Shows active drive info, sync status, and quick actions
- **Floating Sync Widget**: Real-time sync status in bottom-right corner
- **Enhanced Empty States**: Better UX with icons, CTAs, and clear messaging
- **Permaweb Tab**: Updated header and educational content about permanent storage
- **Brand Touches**: Added tagline, consistent colors, dark mode toggle (UI ready)

### Onboarding Flow Improvements
- Simplified wallet setup with direct action buttons
- Removed seed phrase verification step to reduce friction
- Enhanced drive setup with real-time validation
- Success screen with technical details for power users
- Fixed drive mapping creation for proper sync initialization

## Common Tasks

### Adding a New IPC Handler
1. Add handler in `src/main/main.ts` (search for "ipcMain.handle")
2. Add method to API in `src/main/preload.ts`
3. Use in renderer via `window.electronAPI`

Example:
```typescript
// main.ts
ipcMain.handle('shell:open-path', async (_, path: string) => {
  const result = await shell.openPath(path);
  return true;
});

// preload.ts
shell: {
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
}

// Component
await window.electronAPI.shell.openPath(config.syncFolder);
```

### Adding a New React Component
1. Create component in `src/renderer/components/`
2. Follow existing component patterns (functional components with hooks)
3. Use existing UI patterns from Dashboard.tsx or WalletSetup.tsx

### Working with Wallets
- Wallet manager: `src/main/wallet-manager-secure.ts`
- Always use secure encryption methods
- Never store passwords in plain text
- Support for seed phrases and JWK files

### Working with Drives
- Drive operations via `ardrive-core-js`
- Drive mappings stored in SQLite database
- Sync operations in `src/main/sync-manager.ts`
- UI components handle drive creation and selection

## Dependencies & APIs
- **ardrive-core-js**: Core ArDrive functionality
- **@ardrive/turbo-sdk**: Turbo credits for free transactions
- **Electron**: Desktop app framework
- **React**: UI framework
- **TypeScript**: Type safety
- **SQLite**: Local database for metadata

## Testing Approach
1. Use test scripts in `test-scripts/` for quick testing
2. Development mode includes UAT tools (Ctrl+D to toggle)
3. Test wallet functionality with seed phrases (never use real wallets in dev)

## Common Issues & Solutions

### Build Errors
- Run `npm run typecheck` to check TypeScript errors
- Check `tsconfig.json` files for path mappings
- Ensure all imports have proper file extensions
- Verify IPC methods exist in both main.ts and preload.ts

### Wallet Issues
- Check if wallet is loaded: `walletManager.isWalletLoaded()`
- Verify profile is active: `profileManager.getActiveProfile()`
- Check logs for encryption/decryption errors

### Sync Issues
- Verify sync folder permissions
- Check if drive mapping exists in database
- Monitor sync status in dashboard
- Check logs for file watcher errors

### Drive Mapping Issues
- Ensure drive is created with `ardrive-core-js` first
- Add drive mapping to database via IPC
- Verify mapping ID matches drive ID for simplicity

## Environment Variables
```bash
NODE_ENV=development    # or production
SKIP_ONBOARDING=true   # Skip onboarding for testing
AUTO_LOGIN=true        # Auto-login for testing
```

## Code Style
- Use TypeScript for type safety
- Follow existing patterns in the codebase
- Avoid adding comments unless necessary
- Use meaningful variable/function names
- Handle errors appropriately
- Use inline styles for component-specific styling

## Security Considerations
- Never log sensitive data (wallets, passwords, seed phrases)
- Use secure encryption for wallet storage (AES-256-GCM)
- Validate all user inputs with InputValidator
- Use Electron's security best practices
- Implement proper IPC validation

## Useful Commands for Debugging
```bash
# Check TypeScript errors
npm run typecheck

# Check linting issues
npm run lint

# Clean and rebuild
npm run clean && npm run build

# Start with console logs
npm run dev

# View SQLite database
sqlite3 ~/.config/ardrive-desktop-mvp/[profile-id]/ardrive.db
```

## UI/UX Guidelines
- Use ArDrive red (#dc2626) for primary actions
- Green (#10b981) for success states
- Consistent spacing with CSS variables (--space-*)
- Empty states should have icons, clear messaging, and CTAs
- Loading states with spinning animations
- Toast notifications for copy actions

## Contributing
1. Test changes thoroughly
2. Run type checking and linting
3. Follow existing code patterns
4. Update this guide if adding major features
5. Test onboarding flow end-to-end
6. Verify sync functionality after changes