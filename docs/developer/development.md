# Development Guide

## Prerequisites
- Node.js 18+ 
- npm 9+
- Git

## Initial Setup
```bash
# Clone the repository
git clone <repo-url>
cd ardrive-desktop-mvp

# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Common Development Workflows

### 1. Starting Fresh Development
```bash
npm run clean      # Clean build artifacts
npm install        # Install dependencies
npm run dev        # Start development server
```

### 2. Type Checking Before Commits
```bash
npm run typecheck  # Check TypeScript errors
npm run lint       # Check linting issues
npm run build      # Ensure production build works
```

### 3. Testing New User Flow
```bash
npm run uat:new-user    # Test new user onboarding
npm run uat:dashboard   # Test with existing setup
```

### 4. Building for Distribution
```bash
npm run dist    # Creates installers in /release
```

## Troubleshooting

### Build Errors
1. Run `npm run clean` first
2. Delete `node_modules` and run `npm install`
3. Check TypeScript errors: `npm run typecheck`

### Electron Not Starting
1. Ensure all TypeScript compiles: `npm run build:main`
2. Check for port conflicts (webpack dev server uses 8080)
3. Try running main and renderer separately:
   ```bash
   npm run dev:main     # In one terminal
   npm run dev:renderer # In another terminal
   ```

### Module Not Found Errors
1. Check imports use correct paths
2. Ensure TypeScript paths are configured in tsconfig.json
3. Restart the dev server after installing new packages

## Project Structure Guide

### Adding New Features
1. **New IPC Handler**: Add to `src/main/main.ts` and update `src/preload.ts`
2. **New Component**: Create in `src/renderer/components/` following existing patterns
3. **New Route/Page**: Update `App.tsx` with new route logic

### Key Files to Know
- `src/main/main.ts` - Electron main process entry
- `src/renderer/App.tsx` - React app entry
- `src/types/index.ts` - Shared TypeScript types
- `src/preload.ts` - Electron API bridge

### State Management
- Component state: React hooks (useState, useEffect)
- Global config: Through IPC to main process
- Persistent data: SQLite database via database-manager

## Best Practices
1. Always handle errors appropriately
2. Use TypeScript types for all data structures
3. Follow existing code patterns
4. Test with development wallets only
5. Run typecheck before committing