# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ArDrive Desktop MVP is an Electron-based desktop application for syncing files with Arweave's permanent storage network. It features secure multi-profile support, dual upload systems (AR tokens and Turbo Credits), and bidirectional file synchronization.

### Recent Updates
- Real upload process with ardrive-core-js integration
- Real-time progress tracking with IPC events
- Upload approval queue with progress bars
- Cancel and retry functionality for uploads
- Auto-remove success uploads with toast notifications
- ArNS name integration for profile identification

## Quick Start Commands
```bash
# Install dependencies
npm install

# Development
npm run dev          # Start in development mode (TypeScript watch + webpack dev server)
npm run dev:main     # Watch TypeScript compilation for main process only
npm run dev:renderer # Run webpack dev server for React app only

# Building
npm run build        # Full production build (main + renderer)
npm run dist         # Create platform-specific installers
npm run clean        # Clean build artifacts

# Quality Assurance  
npm run test         # Run Vitest tests
npm run test:ui      # Run tests with UI
npm run test:coverage # Generate test coverage reports
npm run lint         # ESLint code quality checks
npm run typecheck    # TypeScript type checking

# User Acceptance Testing
npm run uat              # Run in test mode
npm run uat:new-user     # Test new user onboarding
npm run uat:existing-user # Test existing user flow
npm run uat:dashboard    # Test dashboard functionality
```

### Dev Mode - Fast Import Testing
For rapid testing of the import user flow, you can use a `.env` file to auto-fill forms:

1. **Copy the example .env file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with your test values:**
   ```env
   # Enable dev mode
   ARDRIVE_DEV_MODE=true
   
   # Set your test wallet path
   ARDRIVE_DEV_WALLET_PATH=C:\Source\arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json
   
   # Set your test password
   ARDRIVE_DEV_PASSWORD=testingPASSword
   
   # Set your test sync folder
   ARDRIVE_DEV_SYNC_FOLDER=C:\ARDRIVE
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```

When dev mode is enabled:
- Import User flow will auto-fill the wallet path and password
- Drive setup will auto-fill the sync folder
- You can just click "Next" through the setup process

**Security Notes**: 
- Only use test wallets and passwords in dev mode
- The `.env` file is gitignored and won't be committed
- Never share your `.env` file with real wallet information

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

## Key Concepts & Architecture

### Technology Stack
- **Electron** v27.1.3 - Cross-platform desktop framework
- **React** 18 with TypeScript - Renderer process UI
- **SQLite** - Local database for metadata and mappings
- **ardrive-core-js** - Core ArDrive functionality
- **@ardrive/turbo-sdk** - Turbo Credits integration
- **Vitest** - Testing framework

### Architecture Patterns
1. **Multi-Process**: Main process (Node.js backend) + Renderer process (React frontend)
2. **IPC Bridge**: Secure communication via Electron's contextBridge
3. **Repository Pattern**: Database operations abstracted in managers
4. **Observer Pattern**: File system monitoring with Chokidar
5. **Command Pattern**: IPC handlers for all cross-process operations

### Security Architecture
- **Encryption**: AES-256-GCM with authenticated encryption
- **Key Derivation**: Scrypt (N=16384, r=8, p=1) for passwords
- **Profile Isolation**: Separate encrypted storage per profile
- **No Plaintext Storage**: Passwords never stored, only derived keys

## Important Technical Decisions

### File Sync Strategy
- Hash-based duplicate detection using SHA-256
- 100MB file size limit (MVP restriction)
- Upload approval queue for cost control
- Support for both AR tokens and Turbo Credits
- Bidirectional sync with conflict detection

### Database Schema
- SQLite with profile-specific databases
- Tables: drive_mappings, upload_history, pending_uploads
- Drive mapping ID matches drive ID for simplicity
- Upload tracking includes method (AR/Turbo) and status

### IPC Security
- All IPC channels namespaced (e.g., 'wallet:', 'drive:', 'sync:')
- Input validation on both main and renderer sides
- Sensitive operations require password verification
- No direct file system access from renderer

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

### Running a Single Test
```bash
# Run a specific test file
npm run test -- WalletManager.test.ts

# Run tests matching a pattern
npm run test -- --grep "should create wallet"

# Run tests in watch mode
npm run test:watch
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

## Core Dependencies
- **ardrive-core-js**: Drive operations, file uploads, metadata
- **@ardrive/turbo-sdk**: Turbo Credits purchases and conversions
- **arweave**: Direct blockchain interactions
- **sqlite3/better-sqlite3**: Local database operations
- **chokidar**: File system monitoring
- **react-router-dom**: Navigation between screens
- **axios**: HTTP requests for API calls

### Key Services
- **arns-service.ts**: ArNS name resolution for profile identification
- **turbo-manager.ts**: Turbo Credits management and conversions
- **upload-manager.ts**: Upload queue and progress tracking
- **input-validator.ts**: Input validation for security

## Testing & Quality Assurance

### Test Framework
- **Vitest** with React Testing Library
- Configuration in `vitest.config.ts`
- Tests in `tests/` directory
- JSDOM environment for component testing

### Testing Commands
```bash
npm run test          # Run all tests
npm run test:ui       # Run with Vitest UI
npm run test:coverage # Generate coverage report
```

### UAT Tools
- Development mode includes UAT panel (Ctrl+D to toggle)
- Test scripts in `test-scripts/` for quick scenarios
- Environment variables for testing:
  - `SKIP_ONBOARDING=true` - Skip onboarding flow
  - `AUTO_LOGIN=true` - Auto-login for testing

### Testing Best Practices
- Never use real wallets in development/testing
- Test with 12-word seed phrases only
- Verify sync functionality after file system changes
- Test profile switching thoroughly
- Check error handling for network failures
- Test upload approval queue with multiple files
- Verify progress tracking and cancellation
- Test Turbo Free functionality for small files

## Common Issues & Solutions

### Build/TypeScript Errors
```bash
# Check TypeScript errors
npm run typecheck

# Common fixes:
- Path aliases: Check tsconfig.json for '@/' mapping
- Missing types: Install @types/ packages
- Import extensions: Add .js for relative imports
- IPC mismatch: Ensure handlers exist in both main.ts and preload.ts
```

### Wallet Issues
```typescript
// Debugging wallet problems
const isLoaded = await walletManager.isWalletLoaded();
const profile = profileManager.getActiveProfile();
const address = await walletManager.getWalletAddress();
```

### Sync Issues
- Check folder permissions: `fs.accessSync(path, fs.constants.W_OK)`
- Verify drive mapping: `SELECT * FROM drive_mappings`
- Monitor file watcher: Check logs for Chokidar errors
- Test with small files first (< 1MB)

### Database Issues
```bash
# View database directly
sqlite3 ~/.config/ardrive-desktop-mvp/[profile-id]/ardrive.db
.tables
.schema drive_mappings
SELECT * FROM drive_mappings;
```

## Configuration & Environment

### Environment Variables
Create a `.env` file from `.env.example` for local development:

```bash
# Core environment settings
NODE_ENV=development     # or production
DEBUG=ardrive:*         # Enable debug logging

# Testing shortcuts
SKIP_ONBOARDING=true    # Skip onboarding flow
AUTO_LOGIN=true         # Auto-login for testing

# Dev Mode Auto-fill (Import User Flow Testing)
ARDRIVE_DEV_MODE=true    # Enable dev mode auto-fill
ARDRIVE_DEV_WALLET_PATH=C:\path\to\wallet.json  # Auto-fill wallet path
ARDRIVE_DEV_PASSWORD=testPassword               # Auto-fill password
ARDRIVE_DEV_SYNC_FOLDER=C:\ARDRIVE             # Auto-fill sync folder
```

The `.env` file is automatically loaded in development mode and is gitignored for security.

### Configuration Files
- `tsconfig.json` - Base TypeScript config
- `tsconfig.main.json` - Main process specific
- `webpack.renderer.js` - Renderer bundling
- `.eslintrc.js` - Linting rules
- `vitest.config.ts` - Test configuration

### Build Configuration
- Electron Builder config in `package.json`
- Multi-platform support (Windows, macOS, Linux)
- Code signing ready
- Auto-update capable

## Code Style & Patterns

### TypeScript Guidelines
- Strict mode enabled - no `any` types
- Use interfaces for data shapes
- Prefer `const` assertions for literals
- Explicit return types for public APIs

### React Patterns
- Functional components with hooks
- Inline styles for component-specific styling
- CSS variables for theme values (--space-*, --color-*)
- Follow patterns in Dashboard.tsx and WalletSetup.tsx

### Error Handling
```typescript
try {
  // Operation
} catch (error) {
  console.error('[Component] Operation failed:', error);
  // User-friendly error handling
}
```

### IPC Pattern
```typescript
// Always validate inputs
if (!isValidInput(data)) {
  throw new Error('Invalid input');
}
// Perform operation
return { success: true, data: result };
```

## Security Guidelines

### Critical Security Rules
1. **NEVER** log sensitive data:
   - Wallet contents or seed phrases
   - Passwords or derived keys
   - Decrypted private keys

2. **ALWAYS** validate inputs:
   ```typescript
   // Use InputValidator for all user inputs
   if (!InputValidator.isValidDriveName(name)) {
     throw new Error('Invalid drive name');
   }
   ```

3. **Wallet Security**:
   - Use `wallet-manager-secure.ts` (NOT wallet-manager.ts)
   - Passwords processed with Scrypt before use
   - Wallets encrypted with AES-256-GCM
   - Machine-specific salt for extra protection

4. **IPC Security**:
   - Validate all IPC inputs
   - Use typed IPC channels
   - No direct file system access from renderer
   - Password required for sensitive operations

## Debugging & Troubleshooting

### Console Access
- Main process: Check terminal running `npm run dev`
- Renderer process: DevTools Console (Ctrl+Shift+I)

### Common Debugging Commands
```bash
# Type checking with detailed errors
npm run typecheck -- --verbose

# Lint with auto-fix
npm run lint -- --fix

# Clean build (fixes many issues)
npm run clean && npm run build

# Test specific file
npm run test -- WalletManager.test.ts

# Database inspection
sqlite3 ~/.config/ardrive-desktop-mvp/[profile-id]/ardrive.db
.tables
.schema
SELECT * FROM drive_mappings;
SELECT * FROM upload_history ORDER BY created_at DESC LIMIT 10;
```

### Electron Debugging
```bash
# Enable Electron logging
ELECTRON_ENABLE_LOGGING=1 npm run dev

# Debug main process
npm run dev:main -- --inspect
```

### Windows-Specific Paths
On Windows, the database is located at:
```
%APPDATA%\ardrive-desktop-mvp\[profile-id]\ardrive.db
```

## UI/UX Guidelines

### Design System
- **Primary**: ArDrive red (#dc2626)
- **Success**: Green (#10b981)
- **Background**: #f9fafb (light), #111827 (dark ready)
- **Text**: #374151 (primary), #6b7280 (secondary)

### Component Patterns
- Empty states: Icon + Message + CTA button
- Loading: Spinning animation with message
- Errors: Red text with clear explanation
- Success: Green checkmark with message
- Toast notifications: Bottom-right, auto-dismiss

### Spacing System
```css
--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;
```

### Icons
- Use existing icon set for consistency
- File type icons from `getFileIcon()` utility
- Status icons: ✓ (success), ⚠️ (warning), ✗ (error)

## Development Workflow

### Before Starting
1. Review existing patterns in similar files
2. Check CLAUDE.md for guidance
3. Run `npm run dev` to start development

### While Developing
1. Use TypeScript - no `any` types
2. Follow existing component patterns
3. Test in development mode frequently
4. Handle errors gracefully
5. Add to UAT tools if creating new features

### Before Committing
1. Run `npm run typecheck` - must pass
2. Run `npm run lint` - fix any issues
3. Run `npm run test` - ensure tests pass
4. Test profile switching if touching auth
5. Test sync if touching file operations
6. Update CLAUDE.md if adding major features

### MVP Limitations to Remember
- Public drives only (no private drives)
- 100MB file size limit
- Manual sync control (no auto-sync)
- Basic conflict resolution only