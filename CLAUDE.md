# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
ArDrive Desktop MVP is an Electron-based desktop application for syncing files with Arweave's permanent storage network. It features secure multi-profile support, dual upload systems (AR tokens and Turbo Credits), bidirectional file synchronization, and private drive encryption. Multi-drive support is the current work in progress.

## Product Docs & Agent Workflow

Development runs a three-role loop — **PM/coordinator** (main session), **implementer** agent, **qa-gate** agent (`.claude/agents/`) — defined in **[PROCESS.md](docs/product/PROCESS.md)**. The main session coordinates and merges; it does not implement-and-verify the same item itself.

Product state lives in `docs/product/` — read these before starting substantive work:
- **[BACKLOG.md](docs/product/BACKLOG.md)** — canonical work tracker with stable item IDs (SEC-1, SYNC-2, …), severity, phase, status, and acceptance criteria. Pick work from here; reference IDs in commits (`fix(sync): re-upload edited files [SYNC-1]`); update the item's status **in the same PR** as the fix.
- **[ROADMAP.md](docs/product/ROADMAP.md)** — beta scope, milestones with exit criteria, post-beta tracks, open product questions.
- **[DECISIONS.md](docs/product/DECISIONS.md)** — append-only decision log (D-###). Don't relitigate decisions in code review; supersede them with a new entry.
- **[AUDIT-2026-07-02.md](docs/product/AUDIT-2026-07-02.md)** — immutable evidence snapshot behind every backlog item. Never edit findings; line numbers drift as code changes.

Workflow rules for agents:
1. Before fixing anything user-facing, check whether it's a known backlog item — the acceptance criteria there define "done".
2. A fix isn't done until verified against its acceptance criteria (drive the actual flow, not just typecheck) and covered by at least one behavioral test where feasible.
3. **Never spend real funds.** Uploads cost AR/Turbo Credits. Use free-tier (<100KB) files for upload testing; anything larger requires the dedicated test wallet and explicit budget (see BACKLOG INFRA-9).
4. Known trap: IPC handlers currently return inconsistent shapes (raw vs `{success, data}`); the standard is the envelope (D-005). Don't add new handlers that return raw values.
5. Docs under `docs/archive/` are superseded historical plans — don't implement from them. The parked drive-key persistence WIP lives on branch `wip/drive-key-persistence` (see PRIV-4).

## Commands

### Development
```bash
npm install          # Install dependencies (postinstall runs patch-package)
npm run dev          # TypeScript watch (main) + webpack dev server (renderer, port 3000)
npm run dev:electron # Launch Electron against the dev server (sets WEBPACK_DEV_SERVER=true)
```

**Important**: `npm run dev` does NOT launch Electron — it only starts the compilers. Run `npm run dev:electron` in a second terminal once the dev server is up. Without `WEBPACK_DEV_SERVER=true`, Electron loads built files from `dist/` (so plain `npm start` requires `npm run build` first).

### Building & Distribution
```bash
npm run build        # Full production build (clean + main + renderer)
npm run dist         # Create platform-specific installers (also dist:win, dist:mac, dist:linux)
npm run clean        # Remove dist/ and release/
npm run build:testers # Build packages for external testers (scripts/build-for-testers.js)
```

### Quality Assurance
```bash
npm run typecheck    # TypeScript type checking (must pass before committing)
npm run lint         # ESLint (lint:fix to auto-fix)
npm run test         # Vitest — watch mode by default; add -- --run for a single pass
npm run test:coverage # Coverage reports (text, JSON, HTML)
```

### Running Specific Tests
```bash
npm run test -- --run tests/unit/sync/sync-manager.test.ts  # Single file
npm run test -- --run -t "test name"                        # Filter by test name
```

**Test config gotcha**: `npm run test` runs Vitest, which only picks up `tests/**/*.test.{ts,tsx}`. The tests under `src/main/__tests__/` are matched only by the legacy `jest.config.js` and do NOT run under `npm run test`. Put new tests in `tests/`.

### User Acceptance Testing
```bash
npm run uat              # Run in test mode (NODE_ENV=test)
npm run uat:new-user     # Test new user onboarding
npm run uat:existing-user # Test existing user flow
npm run uat:dashboard    # Test dashboard functionality
npm run uat:clean        # Clean build + run UAT
```

### Releases
Development on `main` with branch-per-backlog-item (see PROCESS.md); releases via tags. GitHub Actions builds are manual only (`.github/workflows/mvp-workflow.yml`, workflow_dispatch) to save CI minutes. `npm run release:patch|minor|major` bumps version, tags, and pushes; `npm run prerelease` runs typecheck + lint. See `docs/developer/release-guide.md`, `docs/developer/mvp-workflow.md`, and `docs/developer/testing-distribution.md`.

## Architecture

### High-Level Architecture
The application follows Electron's multi-process architecture with secure IPC communication:

1. **Main Process** (`src/main/`, Node.js backend):
   - Wallet operations, file sync, database, all system-level operations
   - Entry point `main.ts` is ~3,000 lines and registers ~90 `ipcMain.handle` calls — search there for existing handlers
   - Enforces security through `InputValidator`; renderer never touches the filesystem or secrets directly

2. **Renderer Process** (`src/renderer/`, React frontend):
   - UI components and user interaction; no Node.js API access
   - Communicates with main only via typed IPC channels

3. **Preload Script** (`src/main/preload.ts`):
   - Exposes safe, typed API to renderer as `window.electronAPI`
   - Namespaces: `wallet`, `drive`, `sync`, `files`, `uploads`, `config`, `dialog`, `shell`, `payment`, `security`, `turbo`, `arns`, `profiles`, `profile`, `driveMappings`, `multiSync`, `multiFiles`, `error`, `system`

### Security Architecture
- **Encryption**: AES-256-GCM with authenticated encryption (`crypto-utils.ts`)
- **Key Derivation**: Scrypt (N=16384, r=8, p=1) for passwords
- **Profile Isolation**: Each profile has separate encrypted storage
- **Input Validation**: All IPC inputs validated using the InputValidator class
- **No Plaintext Storage**: Passwords never stored, only derived keys

### Storage Layout & Database
All app data lives in Electron's `userData` directory (`%APPDATA%\ardrive-desktop-mvp` on Windows, `~/.config/ardrive-desktop-mvp` on Linux, `~/Library/Application Support/ardrive-desktop-mvp` on macOS):

```
userData/
├── profiles.json                # Profile metadata
├── profiles/{profile-id}/
│   ├── data.db                  # Per-profile SQLite database
│   └── ...                      # Encrypted wallet, drive keys, config
└── ardrive.db                   # Legacy fallback DB (no active profile)
```

`DatabaseManager.setActiveProfile()` closes and reopens the SQLite connection on profile switch — complete data isolation per profile. Tables are created in `database-manager.ts` (`createTables()`); the `drive_mappings` table underpins multi-drive support (per-drive sync folder, direction, exclude patterns).

### Sync Engine Architecture
`sync-manager.ts` (~3,500 lines) watches the sync folder with chokidar and orchestrates helpers in `src/main/sync/`:
- **FileOperationDetector / FolderOperationDetector**: Detect moves, renames, copies, deletes using content similarity; 3-second detection window groups related operations
- **FileStateManager**: Tracks known file state
- **UploadQueueManager**: Upload approval queue for cost control
- **DownloadManager / StreamingDownloader**: Efficient streaming downloads
- **FileHashVerifier**: SHA-256 integrity verification; hashes also drive duplicate detection
- **CostCalculator**: AR vs Turbo cost estimation
- **SyncProgressTracker**: Real-time progress for uploads/downloads
- **ErrorHandler**: Centralized sync error handling
- Core types live in `sync/interfaces.ts`, `sync/types.ts`, and `sync/constants.ts`

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

To add a handler: register in `main.ts`, expose in `preload.ts`, call via `window.electronAPI`.

### Key Services & Managers (`src/main/`)
- **wallet-manager-secure.ts**: Encrypted wallet operations (import via JSON or seed phrase)
- **sync-manager.ts**: Main file synchronization engine
- **profile-manager.ts**: Multi-profile support, switching, and per-profile storage paths
- **database-manager.ts**: SQLite operations with profile isolation (types in `database-types.ts`)
- **drive-key-manager.ts**: Private drive keys — in-memory cache of derived keys, opt-in encrypted persistence per drive, cleared on profile switch
- **turbo-manager.ts**: Turbo Credits (balance, top-up, uploads)
- **arns-service.ts**: ArNS name resolution
- **input-validator.ts**: Security-critical input validation
- **crypto-utils.ts**: Encryption primitives and secure file deletion
- **keychain-service.ts**: OS keychain integration (keytar)
- **config-manager.ts**: Global and per-profile configuration

## Important Patterns

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
1. Create in `src/renderer/components/` (feature subfolders exist: `dashboard/`, `turbo/`, `common/`)
2. Use functional components with TypeScript; follow patterns from Dashboard.tsx or WalletSetup.tsx
3. Use inline styles for component-specific styling; create dedicated CSS files in `src/renderer/styles/` for complex components
4. Use lucide-react for icons
5. Place utility functions in `src/renderer/utils/`

## Testing

- Framework: Vitest + React Testing Library, JSDOM environment, setup in `tests/setup.ts`
- Path alias: `@` → `src/`
- Mocks live in `tests/helpers/` (`mock-ardrive.ts`, `mock-database.ts`) — follow these patterns for mocking ardrive-core-js and the database
- Unit tests in `tests/unit/`; test both success and error cases
- Before committing: `npm run typecheck`, `npm run lint`, `npm run test -- --run` must pass. Test profile switching if touching auth; test sync operations if touching the file system.

## Environment Variables

Development mode auto-fill (`.env` file, see `.env.example`):
```env
ARDRIVE_DEV_MODE=true                        # Enable dev mode features
ARDRIVE_DEV_WALLET_PATH=C:\path\to\wallet.json # Auto-fill import flow (test wallets only)
ARDRIVE_DEV_PASSWORD=testPassword
ARDRIVE_DEV_SYNC_FOLDER=C:\ARDRIVE
DEBUG=ardrive:*                              # Detailed logging
```

## Key Technical Decisions

- **100MB file size limit** (MVP restriction), enforced in `sync-manager.ts`
- **Upload methods**: AR tokens (traditional Arweave) vs Turbo Credits (instant, fiat option); automatic recommendation by file size; files under 100KB are free with Turbo
- **Upload approval queue**: uploads require explicit user approval for cost control
- **Profile system**: complete isolation — separate encrypted wallet, SQLite database, config, and sync state per profile
- **Private drives**: keys derived from user password via ardrive-core-js; unlock via `drive:unlock` IPC; persistence is opt-in per drive

## Debugging & Troubleshooting

- **Build failures**: `npm run clean` before rebuilding; Node.js must be 18+
- **IPC handler errors**: ensure handler registered in main.ts AND exposed in preload.ts with matching namespace
- **`Drive key not found`**: private drive not unlocked — use `drive:unlock` (see drive-key-manager.ts)
- **`Wallet decryption failed`**: wrong password or corrupted wallet
- **Sync issues**: check 100MB limit in sync-manager.ts, 3-second FileOperationDetector window, and drive_mappings in the profile database

## Documentation

All docs live in `docs/` — see [docs/README.md](docs/README.md) for the index. Key areas: `docs/product/` (backlog/roadmap/process — the working docs), `docs/developer/` (setup, architecture, release/workflow guides), `docs/archive/` (superseded plans — historical only), `docs/vendor/` (third-party SDK readmes).
