# ArDrive Desktop Architecture

Technical overview of the ArDrive Desktop application architecture, component design, and data flow.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Process Architecture](#process-architecture)
3. [Component Overview](#component-overview)
4. [Data Flow](#data-flow)
5. [File Sync System](#file-sync-system)
6. [Upload Approval System](#upload-approval-system)
7. [Security Architecture](#security-architecture)
8. [Database Schema](#database-schema)
9. [IPC Communication](#ipc-communication)
10. [Design Patterns](#design-patterns)
11. [Performance Considerations](#performance-considerations)
12. [Future Architecture](#future-architecture)

---

## High-Level Architecture

### Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    ArDrive Desktop MVP                      │
├─────────────────────────────────────────────────────────────┤
│  UI Layer:           React + TypeScript + CSS Variables    │
│  Desktop Framework:  Electron (Chromium + Node.js)         │
│  Storage:           SQLite + Encrypted Local Files         │
│  Blockchain SDK:    ArDrive Core JS                        │
│  Network:           Arweave Blockchain + ArDrive Services   │
└─────────────────────────────────────────────────────────────┘
```

### Application Boundaries

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   User Interface    │    │   Core Logic        │    │   External Services │
│                     │    │                     │    │                     │
│ • React Components  │◄──►│ • Wallet Manager    │◄──►│ • Arweave Network   │
│ • Dashboard         │    │ • Sync Manager      │    │ • ArDrive API       │
│ • Setup Wizards     │    │ • Database Manager  │    │ • File System       │
│ • System Tray       │    │ • Config Manager    │    │ • System Keychain   │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

---

## Process Architecture

### Electron Multi-Process Model

ArDrive Desktop follows Electron's multi-process architecture for security and performance:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Main Process                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐│
│  │   App Lifecycle │ │  Window Mgmt    │ │     Business Logic           ││
│  │                 │ │                 │ │                             ││
│  │ • Startup       │ │ • Main Window   │ │ • Wallet Manager            ││
│  │ • System Tray   │ │ • File Dialogs  │ │ • Sync Manager              ││
│  │ • IPC Handlers  │ │ • Menu (hidden) │ │ • Database Manager          ││
│  │ • Shutdown      │ │ • Notifications │ │ • Config Manager            ││
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                               IPC Bridge
                                    │
┌─────────────────────────────────────────────────────────────────────────┐
│                        Renderer Process                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐│
│  │   React App     │ │   UI Components │ │        State Mgmt           ││
│  │                 │ │                 │ │                             ││
│  │ • App.tsx       │ │ • Dashboard     │ │ • React useState            ││
│  │ • Navigation    │ │ • WalletSetup   │ │ • Props/Callbacks           ││
│  │ • IPC Calls     │ │ • DriveManager  │ │ • Local Storage             ││
│  │ • Error Mgmt    │ │ • SyncManager   │ │ • Component State           ││
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### Process Responsibilities

**Main Process:**
- Application lifecycle management
- System-level operations (file system, networking)
- Secure operations (wallet encryption, database)
- Background operations (file watching, uploads)
- IPC communication management

**Renderer Process:**
- User interface rendering
- User interaction handling
- Form validation and state management
- Display of data from main process
- Navigation and routing

---

## Component Overview

### Main Process Components

#### 1. Wallet Manager (`wallet-manager.ts`)

**Purpose:** Secure wallet operations and ArDrive SDK integration

```typescript
class WalletManager {
  // Core responsibilities:
  private wallet: any = null;                    // ArDrive wallet instance
  private arDrive: ArDrive | null = null;        // ArDrive SDK instance
  private walletStoragePath: string;             // Encrypted wallet file path
  private passwordStoragePath: string;           // Encrypted password path
  
  // Key methods:
  async importWallet(walletFilePath, password)   // Import and encrypt wallet
  async attemptAutoLoad()                        // Auto-load on startup
  async getWalletInfo()                          // Get address and balance
  async listDrives()                             // Fetch user's drives
  async createDrive(name)                        // Create new drive
}
```

**Key Features:**
- AES encryption with machine-specific keys
- Automatic wallet loading between sessions
- ArDrive Core JS SDK integration
- Secure credential storage

#### 2. Sync Manager (`sync-manager.ts`)

**Purpose:** File monitoring, sync logic, and upload queue management

```typescript
class SyncManager {
  // Core responsibilities:
  private watcher: chokidar.FSWatcher | null;    // File system watcher
  private uploadQueue: Map<string, FileUpload>;  // Active upload queue
  private processedHashes: Set<string>;          // Duplicate detection
  private arDrive: ArDrive | null;               // ArDrive instance
  
  // Key methods:
  async startSync(driveId, rootFolderId)         // Start sync process
  async downloadExistingDriveFiles()             // Initial download
  async handleNewFile(filePath)                  // Process new files
  async uploadFile(upload)                       // Execute upload
}
```

**Sync Flow:**
1. **Initialize**: Load processed file hashes from database
2. **Download**: Fetch existing ArDrive files to local folder
3. **Scan**: Check existing local files against processed hashes
4. **Monitor**: Start file system watcher for new files
5. **Process**: Add new files to approval queue with cost estimation

#### 3. Database Manager (`database-manager.ts`)

**Purpose:** SQLite database operations for local data persistence

```sql
-- Database Schema
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  localPath TEXT NOT NULL,
  fileName TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  dataTxId TEXT,
  metadataTxId TEXT,
  fileId TEXT,
  error TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME
);

CREATE TABLE pending_uploads (
  id TEXT PRIMARY KEY,
  localPath TEXT NOT NULL,
  fileName TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  estimatedCost REAL NOT NULL,
  conflictType TEXT DEFAULT 'none',
  conflictDetails TEXT,
  status TEXT DEFAULT 'awaiting_approval',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 4. Config Manager (`config-manager.ts`)

**Purpose:** Application configuration persistence

```typescript
interface AppConfig {
  walletPath?: string;      // Path to imported wallet
  selectedDriveId?: string; // Currently selected drive
  syncFolderPath?: string;  // Local sync folder path
  isFirstRun: boolean;      // First run flag
}
```

### Renderer Process Components

#### 1. App Component (`App.tsx`)

**Purpose:** Main application component with navigation logic

```typescript
const App: React.FC = () => {
  // Navigation logic:
  if (config?.isFirstRun) return <WalletSetup />;
  if (changingDrive) return <DriveManager onCancel={...} />;
  if (!config?.selectedDriveId) return <DriveManager />;
  if (!config?.syncFolderPath) return <SyncManager />;
  return <Dashboard />;
};
```

#### 2. UI Components

**Dashboard (`Dashboard.tsx`):**
- Sync status monitoring
- Upload history display
- Configuration management
- File link generation

**Setup Components:**
- `WalletSetup.tsx`: Wallet import flow
- `DriveManager.tsx`: Drive selection/creation
- `SyncManager.tsx`: Folder sync setup

**Utility Components:**
- `UploadApprovalQueue.tsx`: Cost control interface
- `LinkButton.tsx`: File sharing links
- `FileLinkActions.tsx`: File-specific link actions

---

## Data Flow

### Application Startup Flow

```
1. Electron App Start
   ↓
2. Main Process Initialize
   ↓
3. Config Manager Load
   ↓
4. Attempt Wallet Auto-Load
   ↓
5. Create Renderer Window
   ↓
6. React App Mount
   ↓
7. Check Config State
   ↓
8. Navigate to Appropriate Screen
```

### File Sync Data Flow

```
User Adds File to Sync Folder
   ↓
Chokidar Detects File Change
   ↓
Sync Manager Calculates Hash
   ↓
Check Against Processed Hashes
   ↓
[If New] → Add to Pending Approval Queue
   ↓
User Reviews in Upload Queue UI
   ↓
[If Approved] → Add to Upload Queue
   ↓
Sync Manager Processes Upload
   ↓
ArDrive Core JS Uploads to Arweave
   ↓
Update Database with Transaction IDs
   ↓
UI Displays Upload Success + Links
```

### IPC Communication Flow

```
Renderer Process              Main Process
     │                             │
     │── wallet:import ──────────→  │
     │                             │── WalletManager.importWallet()
     │                             │── ConfigManager.setWalletPath()
     │←─── success/error ───────────│
     │                             │
     │── sync:start ─────────────→  │
     │                             │── SyncManager.startSync()
     │                             │── DatabaseManager.loadUploads()
     │←─── status ──────────────────│
     │                             │
     │── files:get-uploads ──────→  │
     │                             │── DatabaseManager.getUploads()
     │←─── upload array ───────────│
```

---

## File Sync System

### Hash-Based Duplicate Detection

**Algorithm:**
```typescript
// Generate unique file key
const content = await fs.readFile(filePath);
const hash = crypto.createHash('sha256').update(content).digest('hex');
const stats = await fs.stat(filePath);
const fileKey = `${filePath}:${stats.size}:${hash}`;

// Check for duplicates
if (processedHashes.has(fileKey)) {
  // Skip - already processed
  return;
}

// Add to approval queue
addToPendingApproval(fileInfo);
processedHashes.add(fileKey);
```

**Benefits:**
- Prevents re-uploading identical files
- Handles file moves and renames
- Detects content changes vs. metadata changes
- Efficient O(1) lookup for duplicates

### Conflict Resolution Strategy

**Current Implementation:**
1. **Download First**: Always download existing ArDrive files
2. **Hash Comparison**: Compare local vs. remote content hashes
3. **Skip Duplicates**: Don't upload if hash matches existing file
4. **User Control**: All uploads require explicit approval

**Future Enhancements:**
- Content-aware conflict resolution
- Merge strategies for document types
- Version history tracking
- Selective sync options

### File System Monitoring

**Chokidar Configuration:**
```typescript
this.watcher = chokidar.watch(syncFolderPath, {
  ignored: /(^|[\/\\])\../,  // Ignore dotfiles
  persistent: true,
  ignoreInitial: true        // Don't process existing files
});

this.watcher.on('add', (filePath) => {
  this.handleNewFile(filePath);
});
```

**Event Handling:**
- **add**: New file detected → Add to approval queue
- **change**: File modified → Check if content hash changed
- **unlink**: File deleted → Remove from tracking (future)

---

## Upload Approval System

### Cost Calculation

**Algorithm:**
```typescript
class CostCalculator {
  static BASE_AR_COST_PER_BYTE = 0.00000001;      // Base Arweave cost
  static ARFS_METADATA_OVERHEAD = 1024;           // ArFS metadata size
  static NETWORK_FEE_MULTIPLIER = 1.2;            // Network fee buffer
  
  static estimateUploadCost(fileSizeBytes: number): number {
    const dataCost = fileSizeBytes * this.BASE_AR_COST_PER_BYTE;
    const metadataCost = this.ARFS_METADATA_OVERHEAD * this.BASE_AR_COST_PER_BYTE;
    const totalCost = (dataCost + metadataCost) * this.NETWORK_FEE_MULTIPLIER;
    return Math.round(totalCost * 1000000) / 1000000; // 6 decimal precision
  }
}
```

### Approval Queue Management

**Data Structure:**
```typescript
interface PendingUpload {
  id: string;                    // Unique identifier
  localPath: string;             // Full file path
  fileName: string;              // Display name
  fileSize: number;              // Size in bytes
  estimatedCost: number;         // AR tokens required
  conflictType: ConflictType;    // Conflict status
  status: ApprovalStatus;        // Approval state
  createdAt: Date;               // Queue timestamp
}
```

**Approval Actions:**
- **Individual Approval**: Single file approval with cost confirmation
- **Batch Approval**: Multiple files approved simultaneously
- **Rejection**: Remove from queue without uploading
- **Cost Estimation**: Real-time AR token cost calculation

---

## Security Architecture

### Wallet Security

**Encryption Strategy:**
```typescript
// Machine-specific key generation
private getMachineKey(): string {
  const machineId = os.hostname() + os.platform() + os.arch();
  return crypto.SHA256(machineId).toString();
}

// Wallet encryption
const encryptedWallet = crypto.AES.encrypt(walletData, password).toString();

// Password encryption (machine-specific)
const machineKey = this.getMachineKey();
const encryptedPassword = crypto.AES.encrypt(password, machineKey).toString();
```

**Security Properties:**
- Wallet encrypted with user password
- Password encrypted with machine-specific key
- No plaintext credentials stored
- Auto-logout capability
- Cannot transfer encrypted data between machines

### Network Security

**HTTPS Enforcement:**
- All Arweave network communication over HTTPS
- ArDrive API calls use secure endpoints
- Certificate validation enabled

**Data Minimization:**
- Only necessary data transmitted
- No private keys sent over network
- Minimal logging of sensitive operations

---

## Database Schema

### Upload Tracking Table

```sql
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,              -- UUID for upload
  localPath TEXT NOT NULL,          -- Full local file path
  fileName TEXT NOT NULL,           -- Display filename
  fileSize INTEGER NOT NULL,        -- File size in bytes
  status TEXT DEFAULT 'pending',    -- pending|uploading|completed|failed
  progress INTEGER DEFAULT 0,       -- Upload progress (0-100)
  dataTxId TEXT,                    -- Arweave data transaction ID
  metadataTxId TEXT,                -- ArFS metadata transaction ID
  fileId TEXT,                      -- ArDrive file ID for sharing
  error TEXT,                       -- Error message if failed
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME              -- Completion timestamp
);
```

### Approval Queue Table

```sql
CREATE TABLE pending_uploads (
  id TEXT PRIMARY KEY,                           -- UUID for pending upload
  localPath TEXT NOT NULL,                       -- Full local file path
  fileName TEXT NOT NULL,                        -- Display filename
  fileSize INTEGER NOT NULL,                     -- File size in bytes
  estimatedCost REAL NOT NULL,                   -- Estimated AR cost
  conflictType TEXT DEFAULT 'none',              -- Conflict detection result
  conflictDetails TEXT,                          -- Human-readable conflict info
  status TEXT DEFAULT 'awaiting_approval',       -- awaiting_approval|approved|rejected
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP   -- Queue entry timestamp
);
```

### Database Operations

**Common Queries:**
```sql
-- Get recent uploads
SELECT * FROM uploads ORDER BY createdAt DESC LIMIT 10;

-- Get pending approvals
SELECT * FROM pending_uploads WHERE status = 'awaiting_approval';

-- Get upload statistics
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM uploads;
```

---

## IPC Communication

### IPC Handler Architecture

**Handler Registration:**
```typescript
// In main.ts
ipcMain.handle('wallet:import', async (_, walletPath: string, password: string) => {
  return await this.walletManager.importWallet(walletPath, password);
});

ipcMain.handle('sync:start', async () => {
  const config = await this.configManager.getConfig();
  return await this.syncManager.startSync(config.selectedDriveId, rootFolderId);
});
```

**Renderer Invocation:**
```typescript
// In React components
const handleImport = async () => {
  try {
    await window.electronAPI.wallet.import(walletPath, password);
    // Handle success
  } catch (error) {
    // Handle error
  }
};
```

### API Surface

**Wallet Operations:**
- `wallet:import` - Import wallet file with password
- `wallet:get-info` - Get address and balance
- `wallet:ensure-loaded` - Auto-load wallet if available
- `wallet:clear-stored` - Clear stored credentials

**Drive Operations:**
- `drive:list` - Get user's ArDrive drives
- `drive:create` - Create new public drive
- `drive:select` - Set selected drive ID

**Sync Operations:**
- `sync:start` - Begin file sync process
- `sync:stop` - Stop file monitoring
- `sync:status` - Get current sync status
- `sync:set-folder` - Set local sync folder

**File Operations:**
- `files:get-uploads` - Get upload history
- `uploads:get-pending` - Get approval queue
- `uploads:approve` - Approve single upload
- `uploads:approve-all` - Approve all pending uploads

---

## Design Patterns

### Repository Pattern (Database Access)

```typescript
// DatabaseManager encapsulates all SQLite operations
class DatabaseManager {
  async getUploads(): Promise<FileUpload[]> { /* ... */ }
  async addUpload(upload: FileUpload): Promise<void> { /* ... */ }
  async updateUpload(id: string, updates: Partial<FileUpload>): Promise<void> { /* ... */ }
}
```

### Observer Pattern (File Watching)

```typescript
// Chokidar emits events, SyncManager observes
this.watcher.on('add', (filePath) => this.handleNewFile(filePath));
this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
```

### Strategy Pattern (Link Generation)

```typescript
// Different link types for different use cases
class LinkGenerator {
  static getArweaveFileLink(dataTxId: string): string { /* ... */ }
  static getArDriveFileLink(fileId: string): string { /* ... */ }
  static getArDriveDriveLink(driveId: string): string { /* ... */ }
}
```

### Command Pattern (IPC Operations)

```typescript
// Each IPC handler is a command with specific responsibility
const commands = {
  'wallet:import': (walletPath, password) => walletManager.importWallet(walletPath, password),
  'sync:start': () => syncManager.startSync(driveId, rootFolderId),
  // ...
};
```

---

## Performance Considerations

### File System Performance

**Efficient File Watching:**
- Chokidar uses native file system events
- Configurable ignore patterns for performance
- Debounced event handling for rapid changes

**Hash Calculation Optimization:**
```typescript
// Stream-based hashing for large files (future)
const hash = crypto.createHash('sha256');
const stream = fs.createReadStream(filePath);
stream.on('data', (chunk) => hash.update(chunk));
stream.on('end', () => {
  const fileHash = hash.digest('hex');
  // Process hash
});
```

### Memory Management

**Upload Queue Management:**
- Bounded queue size (prevent memory exhaustion)
- Cleanup completed uploads from memory
- Efficient hash set for duplicate detection

**Database Connection Pooling:**
- Single SQLite connection per process
- Prepared statements for common queries
- Transaction batching for bulk operations

### Network Performance

**Upload Optimization:**
- Single concurrent upload (avoid ArDrive rate limits)
- Retry logic with exponential backoff
- Progress tracking for user feedback

**API Call Efficiency:**
- Cache drive listings where possible
- Batch operations when supported
- Minimal polling for status updates

---

## Future Architecture

### Planned Enhancements

**Real-Time Sync:**
```typescript
// Future: WebSocket connection for real-time updates
class RealtimeSyncManager {
  private wsConnection: WebSocket;
  
  async enableRealTimeSync() {
    // Connect to ArDrive real-time service
    // Listen for remote file changes
    // Update local files automatically
  }
}
```

**Advanced Conflict Resolution:**
```typescript
// Future: Content-aware conflict resolution
interface ConflictResolver {
  detectConflictType(local: FileInfo, remote: FileInfo): ConflictType;
  resolveConflict(strategy: ResolutionStrategy): Promise<void>;
  generateMergePreview(files: FileInfo[]): Promise<string>;
}
```

**Plugin Architecture:**
```typescript
// Future: Plugin system for extensibility
interface Plugin {
  name: string;
  version: string;
  onFileDetected?(file: FileInfo): Promise<void>;
  onUploadComplete?(upload: FileUpload): Promise<void>;
  getCustomActions?(): PluginAction[];
}
```

**Private Drive Support:**
```typescript
// Future: Private drive encryption
class PrivateDriveManager {
  async createPrivateDrive(name: string, driveKey: string): Promise<DriveInfo>;
  async encryptFile(filePath: string, driveKey: string): Promise<Buffer>;
  async decryptFile(encryptedData: Buffer, driveKey: string): Promise<Buffer>;
}
```

### Scalability Considerations

**Large Folder Support:**
- Incremental scanning for folders with thousands of files
- Background indexing to avoid UI blocking
- Configurable file size and count limits

**Multi-Drive Sync:**
- Support for syncing multiple drives simultaneously
- Drive-specific configuration and policies
- Independent sync states per drive

**Enterprise Features:**
- Team drive sharing and permissions
- Audit logging and compliance reporting
- Integration with enterprise identity systems

---

**📐 This architecture provides a solid foundation for the MVP while allowing for future enhancements and scale.**