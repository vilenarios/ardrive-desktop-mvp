# ArDrive Desktop Developer Setup

Complete guide for setting up the development environment and contributing to ArDrive Desktop.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Development Environment Setup](#development-environment-setup)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Building and Packaging](#building-and-packaging)
6. [Testing](#testing)
7. [Code Style and Standards](#code-style-and-standards)
8. [Debugging](#debugging)
9. [Contributing Guidelines](#contributing-guidelines)
10. [Troubleshooting Dev Issues](#troubleshooting-dev-issues)

---

## Prerequisites

### Required Software

**Node.js and npm:**
- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 8.0.0 or higher (comes with Node.js)
- Download from: [nodejs.org](https://nodejs.org/)

**Git:**
- Latest version for version control
- Download from: [git-scm.com](https://git-scm.com/)

**Code Editor:**
- **Recommended**: Visual Studio Code with extensions:
  - TypeScript and JavaScript Language Features
  - ESLint
  - Prettier
  - Electron extension pack

### Platform-Specific Requirements

**Windows:**
- Windows 10/11
- Windows Build Tools (installed automatically with npm install)
- PowerShell or Command Prompt

**macOS:**
- macOS 10.15 (Catalina) or higher
- Xcode Command Line Tools: `xcode-select --install`

**Linux:**
- Ubuntu 20.04+ or equivalent
- Python 3.x and build-essential: `sudo apt install python3 build-essential`

### ArDrive Development Requirements

**Test Wallet:**
- ArDrive wallet .json file with some AR tokens for testing
- **Warning**: Use a test wallet, not your main wallet with significant funds
- Get test tokens from ArDrive Discord community

**Network Access:**
- Stable internet connection for Arweave network access
- Ability to access arweave.net and related services

---

## Development Environment Setup

### Step 1: Clone Repository

```bash
# Clone the repository
git clone <repository-url>
cd ardrive-desktop-mvp

# Check Node.js version
node --version  # Should be 18.0.0+
npm --version   # Should be 8.0.0+
```

### Step 2: Install Dependencies

```bash
# Install all project dependencies
npm install

# This installs:
# - Electron framework
# - React and TypeScript
# - ArDrive Core JS SDK
# - Build tools and dev dependencies
```

### Step 3: Environment Configuration

**Create development config (optional):**
```bash
# Copy example environment file if provided
cp .env.example .env.local

# Edit with your preferred settings
```

**Common environment variables:**
```bash
# Development mode
NODE_ENV=development

# Enable debug logging
DEBUG=ardrive*
ARDRIVE_DEBUG=true

# Custom Arweave gateway (optional)
ARWEAVE_GATEWAY=https://arweave.net
```

### Step 4: Verify Installation

```bash
# Run type checking
npm run typecheck

# Should complete without errors
```

---

## Project Structure

### Overview
```
ardrive-desktop-mvp/
├── src/                    # Source code
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   ├── types/             # Shared TypeScript types
│   └── utils/             # Shared utilities
├── assets/                # App icons and images
├── dist/                  # Built files (generated)
├── node_modules/          # Dependencies (generated)
├── public/                # Static files for renderer
├── scripts/               # Build and utility scripts
└── [config files]         # TypeScript, Webpack, etc.
```

### Main Process (`src/main/`)
```
main/
├── main.ts                # App lifecycle, windows, tray
├── wallet-manager.ts      # Wallet encryption, ArDrive SDK
├── sync-manager.ts        # File watching, upload queue
├── database-manager.ts    # SQLite operations
├── config-manager.ts      # App configuration
└── preload.ts            # IPC bridge (renderer ↔ main)
```

### Renderer Process (`src/renderer/`)
```
renderer/
├── App.tsx                # Main React app, navigation
├── index.tsx              # React entry point
├── index.html             # HTML template
├── styles.css             # Global styles, design system
└── components/            # React components
    ├── Dashboard.tsx      # Main dashboard view
    ├── WalletSetup.tsx    # Wallet import flow
    ├── DriveManager.tsx   # Drive selection/creation
    ├── SyncManager.tsx    # Folder sync setup
    └── [other components] # Upload queue, file links, etc.
```

### Shared Code
```
types/
└── index.ts               # TypeScript interfaces

utils/
├── cost-calculator.ts     # AR token cost estimation
└── link-generator.ts      # File/drive link generation
```

---

## Development Workflow

### Starting Development

**Option 1: Automatic (Recommended)**
```bash
# Starts both React dev server and Electron app
npm run dev

# This runs:
# 1. React dev server on http://localhost:3000
# 2. Electron app pointing to dev server
# 3. Hot reload enabled for both processes
```

**Option 2: Manual (for debugging)**
```bash
# Terminal 1: Start React dev server
npm run dev:renderer

# Terminal 2: Start Electron app
npm run dev:main

# Terminal 3: Run type checking (optional)
npm run typecheck -- --watch
```

### Development Features

**Hot Reload:**
- React components reload instantly on changes
- Main process restarts on changes to main/ files
- TypeScript compilation happens automatically

**DevTools:**
- React DevTools available in development
- Electron DevTools open automatically in dev mode
- Network tab shows ArDrive API calls

**Logging:**
- Console logs from both main and renderer processes
- ArDrive Core JS network requests logged
- File system operations logged

### Making Changes

**Workflow:**
1. Create a feature branch: `git checkout -b feature/your-feature-name`
2. Make changes to source files
3. Test in development mode: `npm run dev`
4. Run type checking: `npm run typecheck`
5. Build for production: `npm run build`
6. Test built app: `npm start`
7. Commit changes: `git commit -m "descriptive message"`
8. Push and create pull request

**File Watching:**
- Changes to `src/renderer/` → Hot reload in browser
- Changes to `src/main/` → Electron app restarts
- Changes to `src/types/` → Both processes recompile

---

## Building and Packaging

### Development Build

```bash
# Compile TypeScript and bundle code
npm run build

# This creates:
# - dist/main/ - Compiled main process
# - dist/renderer/ - Bundled React app
```

### Production Build

```bash
# Full production build
npm run build

# Start built app (no hot reload)
npm start
```

### Creating Distributables

```bash
# Create platform-specific distributables
npm run package

# This creates installers/packages in:
# - dist/packaged/ - Platform-specific apps
# - Uses electron-builder for packaging
```

**Supported Platforms:**
- Windows: `.exe` installer and portable `.exe`
- macOS: `.dmg` installer and `.app` bundle
- Linux: `.AppImage`, `.deb`, and `.rpm` packages

### Build Configuration

**TypeScript Configuration:**
- `tsconfig.json` - Renderer process (React)
- `tsconfig.main.json` - Main process (Electron)

**Webpack Configuration:**
- `webpack.renderer.js` - React bundling and hot reload

**Electron Builder:**
- Package.json `build` section configures distributables

---

## Testing

### Type Checking

```bash
# Check all TypeScript files
npm run typecheck

# Watch mode for continuous checking
npm run typecheck -- --watch
```

### Manual Testing Checklist

**Core Functionality:**
- [ ] Wallet import and auto-login
- [ ] Drive selection and creation
- [ ] Folder sync setup
- [ ] File detection and upload approval
- [ ] Upload process and progress
- [ ] File link generation
- [ ] System tray functionality

**Error Scenarios:**
- [ ] Invalid wallet files
- [ ] Network disconnection
- [ ] Large file handling (>100MB)
- [ ] Insufficient AR tokens
- [ ] Corrupted file detection

**Cross-Platform:**
- [ ] Windows 10/11
- [ ] macOS 10.15+
- [ ] Ubuntu 20.04+

### Automated Testing (Future)

```bash
# Unit tests (when implemented)
npm test

# Integration tests (when implemented)
npm run test:integration

# E2E tests (when implemented)
npm run test:e2e
```

---

## Code Style and Standards

### TypeScript Standards

**Interfaces and Types:**
```typescript
// Use PascalCase for interfaces
interface FileUpload {
  id: string;
  fileName: string;
  status: 'pending' | 'uploading' | 'completed';
}

// Use camelCase for variables and functions
const uploadFile = async (file: FileUpload): Promise<void> => {
  // Implementation
};
```

**Error Handling:**
```typescript
// Always handle errors appropriately
try {
  await ardriveOperation();
} catch (error) {
  console.error('Operation failed:', error);
  // Handle error appropriately
}
```

### React Standards

**Component Structure:**
```typescript
// Use functional components with TypeScript
interface ComponentProps {
  onAction: () => void;
}

const MyComponent: React.FC<ComponentProps> = ({ onAction }) => {
  const [state, setState] = useState<string>('');
  
  return (
    <div className="component-wrapper">
      {/* JSX content */}
    </div>
  );
};

export default MyComponent;
```

**State Management:**
```typescript
// Use useState for local state
// Pass callbacks for parent communication
// Keep components focused and single-purpose
```

### CSS Standards

**Design System:**
```css
/* Use CSS custom properties */
:root {
  --ardrive-primary: #6366f1;
  --space-4: 1rem;
}

/* Use semantic class names */
.upload-status {
  color: var(--ardrive-primary);
  margin: var(--space-4);
}
```

### Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `Dashboard.tsx`)
- Utilities: `kebab-case.ts` (e.g., `cost-calculator.ts`)
- Interfaces: Defined in `src/types/index.ts`

**Functions:**
- `camelCase` for all functions
- Descriptive names: `handleUploadApproval` not `handle`
- Async functions: Include `async` in name when helpful

---

## Debugging

### React DevTools

**Installation:**
```bash
# React DevTools extension for Chrome/Firefox
# Or use standalone: npm install -g react-devtools
```

**Usage:**
- Component tree inspection
- Props and state debugging
- Performance profiling

### Electron DevTools

**Main Process Debugging:**
```bash
# Add to main.ts for debugging
if (!app.isPackaged) {
  require('electron-debug')({ showDevTools: true });
}
```

**Renderer Process:**
- F12 opens DevTools in development
- Console shows React errors and logs
- Network tab shows ArDrive API calls

### Common Debug Scenarios

**Wallet Issues:**
```typescript
// Add logging to wallet-manager.ts
console.log('Wallet import attempt:', { 
  walletPath, 
  passwordLength: password?.length 
});
```

**Sync Issues:**
```typescript
// Add logging to sync-manager.ts
console.log('File detected:', { 
  filePath, 
  fileSize: stats.size,
  hash: fileHash 
});
```

**IPC Communication:**
```typescript
// Debug main ↔ renderer communication
console.log('IPC call:', { method, parameters });
```

### Performance Monitoring

**File System Operations:**
- Monitor file watcher performance
- Check memory usage with large folders
- Profile upload queue processing

**Network Operations:**
- Monitor ArDrive API response times
- Check for rate limiting issues
- Profile large file uploads

---

## Contributing Guidelines

### Before Contributing

1. **Read Documentation:**
   - Review ARCHITECTURE.md for technical details
   - Understand SECURITY.md for wallet handling
   - Check existing issues for planned work

2. **Set Up Development:**
   - Follow this setup guide completely
   - Test core functionality works
   - Verify you can build and package

### Pull Request Process

1. **Create Issue:**
   - Describe the feature or bug
   - Discuss approach with maintainers
   - Get approval before large changes

2. **Development:**
   - Create feature branch from main
   - Follow code style standards
   - Add appropriate logging/error handling
   - Test thoroughly

3. **Submit PR:**
   - Clear title and description
   - Reference related issues
   - Include testing notes
   - Request review from maintainers

### Code Review Standards

**Required Checks:**
- [ ] TypeScript compilation passes
- [ ] Code follows style guidelines
- [ ] Error handling is appropriate
- [ ] No hardcoded credentials or secrets
- [ ] Changes are properly tested
- [ ] Documentation updated if needed

**Security Review:**
- [ ] Wallet handling follows security practices
- [ ] No private keys logged or exposed
- [ ] User data properly encrypted
- [ ] Network requests are secure

---

## Troubleshooting Dev Issues

### Common Setup Problems

**Node.js Version Issues:**
```bash
# Check version
node --version

# Use nvm to manage versions (recommended)
nvm install 18
nvm use 18
```

**Permission Errors:**
```bash
# Windows: Run as administrator
# macOS/Linux: Check file permissions
sudo chown -R $(whoami) ~/.npm
```

**Build Failures:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear TypeScript cache
npx tsc --build --clean
```

### Platform-Specific Issues

**Windows:**
- Install Windows Build Tools if native modules fail
- Use PowerShell or Git Bash, not Command Prompt
- Disable antivirus temporarily if builds fail

**macOS:**
- Install Xcode Command Line Tools
- Accept Xcode license: `sudo xcodebuild -license accept`
- Clear derived data if builds fail

**Linux:**
- Install build dependencies: `sudo apt install build-essential python3`
- Set python path if needed: `npm config set python /usr/bin/python3`

### Runtime Issues

**Electron Won't Start:**
```bash
# Check for conflicting processes
# Clear Electron cache
npm run build && npm start
```

**React Hot Reload Broken:**
```bash
# Restart dev server
# Check port 3000 isn't blocked
# Clear browser cache
```

**ArDrive API Errors:**
```bash
# Check network connectivity
# Verify test wallet has AR tokens
# Check ArDrive service status
```

### Getting Help

**Internal Resources:**
- Check ARCHITECTURE.md for technical details
- Review existing GitHub issues
- Look at code comments for context

**External Resources:**
- ArDrive Discord for community support
- Electron documentation for framework issues
- React documentation for UI problems

**Reporting Issues:**
1. Search existing issues first
2. Provide detailed reproduction steps
3. Include system information
4. Attach relevant log output
5. Tag with appropriate labels

---

**🚀 Ready to contribute? Start with a small issue to get familiar with the codebase, then tackle bigger features!**