# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ArDrive Desktop MVP is an Electron-based desktop application for syncing files with Arweave's permanent storage network. It features secure multi-profile support, dual upload systems (AR tokens and Turbo Credits), and bidirectional file synchronization.

## Commands

### Development
```bash
npm install          # Install dependencies
npm run dev          # Start in development mode (TypeScript watch + webpack dev server)
npm run dev:main     # Watch TypeScript compilation for main process only
npm run dev:renderer # Run webpack dev server for React app only
```

### Building & Distribution
```bash
npm run build        # Full production build (main + renderer)
npm run dist         # Create platform-specific installers
npm run clean        # Clean build artifacts
npm start            # Start Electron app (requires build first)
```

### Quality Assurance
```bash
npm run lint         # ESLint code quality checks
npm run typecheck    # TypeScript type checking
npm run test         # Run Vitest tests
npm run test:ui      # Run tests with UI
npm run test:coverage # Generate test coverage reports
npm run test:watch   # Run tests in watch mode
npm run test -- --watch    # Alternative watch mode syntax
```

### Testing Specific Files
```bash
npm run test -- tests/WalletManager.test.ts  # Run specific test file
npm run test -- --grep "should create wallet" # Run tests matching pattern
npm run test -- -t "test name"               # Run single test by name
```

### User Acceptance Testing
```bash
npm run uat              # Run in test mode
npm run uat:new-user     # Test new user onboarding
npm run uat:existing-user # Test existing user flow
npm run uat:dashboard    # Test dashboard functionality
npm run uat:clean        # Clean build + run UAT
```

## Architecture

### High-Level Architecture
The application follows Electron's multi-process architecture with secure IPC communication:

1. **Main Process** (Node.js backend):
   - Manages wallet operations, file sync, and database
   - Handles all system-level operations
   - Enforces security through input validation
   - No direct renderer access to filesystem or sensitive operations

2. **Renderer Process** (React frontend):
   - UI components and user interaction
   - Communicates with main process via typed IPC channels
   - No access to Node.js APIs or filesystem

3. **Preload Script** (Bridge):
   - Exposes safe, typed API to renderer via `window.electronAPI`
   - All IPC channels are namespaced (wallet:*, drive:*, sync:*, etc.)

### Security Architecture
- **Encryption**: AES-256-GCM with authenticated encryption
- **Key Derivation**: Scrypt (N=16384, r=8, p=1) for passwords
- **Profile Isolation**: Each profile has separate encrypted storage
- **Input Validation**: All inputs validated using InputValidator class
- **No Plaintext Storage**: Passwords never stored, only derived keys

### Database Architecture
- SQLite with profile-specific databases
- Database isolation per profile for complete data separation
- Location: 
  - Windows: `%APPDATA%\ardrive-desktop-mvp\[profile-id]\ardrive.db`
  - macOS/Linux: `~/.config/ardrive-desktop-mvp/[profile-id]/ardrive.db`

### Sync Engine Architecture
The sync system uses intelligent operation detection:
- **FileOperationDetector**: Detects file moves, renames, copies, deletes
- **FolderOperationDetector**: Detects folder operations using content similarity
- **StreamingDownloader**: Handles efficient file downloads with streaming
- **FileHashVerifier**: Verifies file integrity with SHA-256 hashes
- **ErrorHandler**: Centralized error handling for sync operations
- **Hash-based matching**: SHA-256 for duplicate detection
- **3-second detection window**: Groups related operations
- **Batch support**: Handles multiple simultaneous file operations
- **SyncProgressTracker**: Real-time progress tracking for uploads/downloads

### IPC Communication Pattern
All IPC handlers follow this structure:
```typescript
// main.ts - Handler definition
ipcMain.handle('namespace:action', async (_, ...args) => {
  // Input validation
  const validated = InputValidator.validateXXX(args[0]);
  // Operation
  const result = await service.doOperation(validated);
  return { success: true, data: result };
});

// preload.ts - API exposure
namespace: {
  action: (...args) => ipcRenderer.invoke('namespace:action', ...args)
}

// Component - Usage
const result = await window.electronAPI.namespace.action(data);
```

### Key Services & Managers
- **wallet-manager-secure.ts**: Encrypted wallet operations (NEVER use wallet-manager.ts)
- **sync-manager.ts**: Main file synchronization engine
- **profile-manager.ts**: Multi-profile support and switching
- **database-manager.ts**: SQLite operations with profile isolation
- **database-types.ts**: TypeScript types for database operations
- **turbo-manager.ts**: Turbo Credits management
- **arns-service.ts**: ArNS name resolution
- **input-validator.ts**: Security-critical input validation
- **sync/interfaces.ts**: Core sync engine interfaces and types

## Important Patterns

### Adding New IPC Handlers
1. Add handler in `src/main/main.ts` (search for "ipcMain.handle")
2. Add to preload API in `src/main/preload.ts`
3. Use in renderer via `window.electronAPI`

### Error Handling Pattern
```typescript
try {
  const result = await operation();
  return { success: true, data: result };
} catch (error) {
  console.error('[Service] Operation failed:', error);
  throw new Error(error instanceof Error ? error.message : 'Operation failed');
}
```

### Component Creation
1. Create in `src/renderer/components/`
2. Use functional components with TypeScript
3. Follow existing patterns from Dashboard.tsx or WalletSetup.tsx
4. Use inline styles for component-specific styling
5. Use lucide-react for icons
6. Place utility functions in `src/renderer/utils/`
7. Create dedicated CSS files in `src/renderer/styles/` for complex components

## Development Workflow

### Before Starting
1. Check git status for modified files
2. Review recent commits for work-in-progress
3. Set up dev environment with `.env` file (see .env.example)

### While Developing
1. Use TypeScript strictly - no `any` types
2. Validate all user inputs with InputValidator
3. Handle errors gracefully with user-friendly messages
4. Test in development mode frequently

### Before Committing
1. Run `npm run typecheck` - must pass
2. Run `npm run lint` - fix any issues  
3. Run `npm run test` - ensure tests pass
4. Test profile switching if touching auth
5. Test sync operations if touching file system

## Current Development Status
Based on git status:
- **Modified**: Core sync engine, database manager, upload queue components
- **New**: FileOperationDetector, FolderOperationDetector, StreamingDownloader, FileHashVerifier, ErrorHandler, UploadApprovalQueueModern
- **Deleted**: sync-engine.ts (functionality merged into sync-manager.ts), SYNC_MANAGER_CLEANUP_TODO.md, SYNC_MANAGER_REFACTOR_PLAN.md

Recent commits show active development on:
- Advanced file operation detection (moves, renames, copies)
- Streaming download implementation
- Modern upload approval queue UI
- Enhanced error handling and progress tracking

## Testing

### Test Configuration
- Framework: Vitest with React Testing Library
- Environment: JSDOM for component testing
- Mocks: Comprehensive mocks in `tests/__mocks__/`
- Coverage: Reports in text, JSON, and HTML formats

### Writing Tests
- Tests go in `tests/` directory
- Unit tests in `tests/unit/`
- Test helpers in `tests/helpers/`
- Follow existing patterns for mocking (see mock-ardrive.ts, mock-database.ts)
- Use descriptive test names
- Test both success and error cases
- Component tests use React Testing Library

## Environment Variables

### Development Mode (.env file)
```env
# Enable dev mode features
ARDRIVE_DEV_MODE=true

# Auto-fill import flow (testing only)
ARDRIVE_DEV_WALLET_PATH=C:\path\to\test-wallet.json
ARDRIVE_DEV_PASSWORD=testPassword
ARDRIVE_DEV_SYNC_FOLDER=C:\ARDRIVE

# Testing shortcuts (from .env.example)
NODE_ENV=development
DEBUG=ardrive:*
```

## Key Technical Decisions

### File Size Limits
- 100MB maximum file size (MVP restriction)
- Enforced in sync-manager.ts

### Upload Methods
- **AR Tokens**: Traditional Arweave upload
- **Turbo Credits**: Instant upload with fiat payment option
- Automatic recommendations based on file size

### Profile System
- Complete isolation between profiles
- Each profile has separate:
  - Encrypted wallet storage
  - SQLite database
  - Configuration
  - Sync state

### Sync Strategy
- Hash-based duplicate detection
- Upload approval queue for cost control
- Bidirectional sync with conflict detection
- Intelligent operation detection for moves/renames
- Streaming downloads for efficient memory usage
- Progress tracking with real-time updates

## Debugging & Troubleshooting

### Common Issues and Solutions

1. **Build Failures**
   - Run `npm run clean` before rebuilding
   - Check Node.js version (must be 18+)
   - Delete node_modules and run `npm install`

2. **IPC Handler Errors**
   - Ensure handler is registered in main.ts
   - Check preload.ts exposes the method
   - Verify namespace matches (e.g., wallet:*, sync:*)

3. **Profile/Wallet Issues**
   - Profile data location: `%APPDATA%\ardrive-desktop-mvp\[profile-id]\`
   - Wallet encryption uses AES-256-GCM
   - Password issues: Check InputValidator.validatePassword

4. **Sync Engine Problems**
   - Check sync-manager.ts for file size limits (100MB)
   - Verify FileOperationDetector timing (3-second window)
   - Database queries in database-manager.ts

### Debug Mode
Enable detailed logging with environment variables:
```bash
# Windows
set DEBUG=ardrive:*
npm run dev

# macOS/Linux
DEBUG=ardrive:* npm run dev
```

### Common Error Patterns
- `ENOENT`: File/directory not found - check paths are absolute
- `EPERM`: Permission denied - check file access rights
- `Wallet decryption failed`: Wrong password or corrupted wallet
- `IPC handler not found`: Missing handler registration in main.ts