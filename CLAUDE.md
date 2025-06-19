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
│   │   ├── main.ts     # Entry point
│   │   ├── wallet-manager.ts
│   │   ├── sync-manager.ts
│   │   └── ...
│   ├── renderer/       # Renderer process (React)
│   │   ├── App.tsx     # Main React component
│   │   ├── components/ # React components
│   │   └── ...
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

## Common Tasks

### Adding a New IPC Handler
1. Add handler in `src/main/main.ts` (search for "ipcMain.handle")
2. Add type definition in `src/preload.ts`
3. Use in renderer via `window.electronAPI`

### Adding a New React Component
1. Create component in `src/renderer/components/`
2. Follow existing component patterns (functional components with hooks)
3. Use existing UI patterns from Dashboard.tsx or WalletSetup.tsx

### Working with Wallets
- Wallet manager: `src/main/wallet-manager-secure.ts`
- Always use secure encryption methods
- Never store passwords in plain text

### Working with Drives
- Drive operations in wallet manager
- Sync operations in `src/main/sync-manager.ts`
- Drive selection UI in `src/renderer/components/WalletSetup.tsx` (Step 4)

## Dependencies & APIs
- **ardrive-core-js**: Core ArDrive functionality
- **@ardrive/turbo-sdk**: Turbo credits for free transactions
- **Electron**: Desktop app framework
- **React**: UI framework
- **TypeScript**: Type safety

## Testing Approach
1. Use test scripts in `test-scripts/` for quick testing
2. Development mode includes UAT tools (Ctrl+D to toggle)
3. Test wallet functionality with seed phrases (never use real wallets in dev)

## Common Issues & Solutions

### Build Errors
- Run `npm run typecheck` to check TypeScript errors
- Check `tsconfig.json` files for path mappings
- Ensure all imports have proper file extensions

### Wallet Issues
- Check if wallet is loaded: `walletManager.isWalletLoaded()`
- Verify profile is active: `profileManager.getActiveProfile()`
- Check logs for encryption/decryption errors

### Sync Issues
- Verify sync folder permissions
- Check if drive is selected
- Monitor sync status in dashboard

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

## Security Considerations
- Never log sensitive data (wallets, passwords)
- Use secure encryption for wallet storage
- Validate all user inputs
- Use Electron's security best practices

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
```

## Contributing
1. Test changes thoroughly
2. Run type checking and linting
3. Follow existing code patterns
4. Update this guide if adding major features