# Sync Manager Refactor Plan

## Overview
This document outlines a detailed, low-risk refactoring strategy for the sync-manager.ts file. The current file is 2,600+ lines and violates multiple software engineering principles. This plan breaks the refactor into small, incremental steps to minimize risk.

## Current State Analysis

### File Size: 2,600+ lines
### Issues Identified:
- **Monolithic Architecture**: Single class handling 8+ responsibilities
- **Duplicate Code**: File state checking, error handling patterns repeated
- **Complex Methods**: Several methods >100 lines, some >250 lines
- **Dead Code**: Unused variables and debug methods
- **Poor Separation**: File watching, uploading, downloading, versioning all mixed

## Refactor Strategy: "Strangler Fig Pattern"

We'll use the Strangler Fig pattern - gradually extracting functionality while keeping the original working, then slowly replacing it.

## Phase 1: Preparation (Risk: LOW)
**Duration: 1-2 days**

### Step 1.1: Add Comprehensive Tests
```bash
# Create test files
src/main/__tests__/sync-manager.test.ts
src/main/__tests__/test-helpers/mock-ardrive.ts
src/main/__tests__/test-helpers/mock-database.ts
```

**Test Coverage Targets:**
- File watching events (add, change, delete)
- Upload queue processing
- Download synchronization
- Error scenarios
- State transitions

### Step 1.2: Extract Constants and Types
```typescript
// Create: src/main/sync/constants.ts
export const SYNC_CONSTANTS = {
  TURBO_FREE_SIZE_LIMIT: 100 * 1024, // 100KB
  FILE_PROCESSING_DEBOUNCE: 500,
  FOLDER_CREATION_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
} as const;

// Create: src/main/sync/types.ts
export interface SyncState {
  phase: 'idle' | 'syncing' | 'monitoring';
  isActive: boolean;
  progress: number;
  currentFile?: string;
  totalFiles: number;
  syncedFiles: number;
  estimatedTimeRemaining?: string;
  error?: string;
}

export interface FileProcessingState {
  isDownloading: boolean;
  recentlyDownloaded: Set<string>;
  downloadingFiles: Map<string, Promise<void>>;
  processingFiles: Set<string>;
  fileProcessingQueue: Map<string, NodeJS.Timeout>;
}
```

### Step 1.3: Create Interface Definitions
```typescript
// Create: src/main/sync/interfaces.ts
export interface ISyncProgressTracker {
  emitSyncProgress(progress: any): void;
  emitUploadProgress(uploadId: string, progress: number, status: string, error?: string): void;
}

export interface IFileStateManager {
  isFileBeingProcessed(filePath: string): boolean;
  markAsDownloaded(filePath: string): void;
  isRecentlyDownloaded(filePath: string): boolean;
  markAsProcessing(filePath: string): void;
  clearProcessing(filePath: string): void;
}

export interface IFileWatcher {
  start(syncFolderPath: string): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
}
```

## Phase 2: Extract Utilities (Risk: LOW)
**Duration: 2-3 days**

### Step 2.1: Extract Progress Tracking
```typescript
// Create: src/main/sync/SyncProgressTracker.ts
export class SyncProgressTracker implements ISyncProgressTracker {
  emitSyncProgress(progress: any): void {
    console.log('🔄 Emitting sync progress:', progress);
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:progress', progress);
    }
  }

  emitUploadProgress(uploadId: string, progress: number, status: string, error?: string): void {
    const { BrowserWindow } = require('electron');
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('upload:progress', {
        uploadId, progress, status, error
      });
    }
  }
}
```

### Step 2.2: Extract File State Management
```typescript
// Create: src/main/sync/FileStateManager.ts
export class FileStateManager implements IFileStateManager {
  private recentlyDownloadedFiles = new Set<string>();
  private downloadingFiles = new Map<string, Promise<void>>();
  private processingFiles = new Set<string>();
  private fileProcessingQueue = new Map<string, NodeJS.Timeout>();

  isFileBeingProcessed(filePath: string): boolean {
    return this.downloadingFiles.has(filePath) || 
           this.recentlyDownloadedFiles.has(filePath) ||
           this.processingFiles.has(filePath);
  }

  markAsDownloaded(filePath: string): void {
    this.recentlyDownloadedFiles.add(filePath);
    // Auto-remove after 5 minutes
    setTimeout(() => {
      this.recentlyDownloadedFiles.delete(filePath);
    }, 5 * 60 * 1000);
  }

  // ... other methods
}
```

### Step 2.3: Update SyncManager to Use Utilities
```typescript
// In sync-manager.ts, replace direct calls with:
export class SyncManager {
  private progressTracker: SyncProgressTracker;
  private fileStateManager: FileStateManager;

  constructor(databaseManager: DatabaseManager) {
    this.progressTracker = new SyncProgressTracker();
    this.fileStateManager = new FileStateManager();
    // ... existing code
  }

  // Replace all emitSyncProgress calls with:
  // this.progressTracker.emitSyncProgress(progress);

  // Replace all file state checks with:
  // this.fileStateManager.isFileBeingProcessed(filePath)
}
```

**Testing**: Verify all progress tracking and file state management still works.

## Phase 3: Extract File Operations (Risk: MEDIUM)
**Duration: 3-4 days**

### Step 3.1: Extract Cost Calculator
```typescript
// Create: src/main/sync/CostCalculator.ts
export class CostCalculator {
  async calculateUploadCosts(fileSize: number): Promise<{
    estimatedCost: number;
    estimatedTurboCost: number | null;
    recommendedMethod: 'ar' | 'turbo';
    hasSufficientTurboBalance: boolean;
  }> {
    // Move cost calculation logic here
  }
}
```

### Step 3.2: Extract Upload Queue Manager
```typescript
// Create: src/main/sync/UploadQueueManager.ts
export class UploadQueueManager {
  private uploadQueue = new Map<string, FileUpload>();
  private costCalculator: CostCalculator;

  constructor(
    private databaseManager: DatabaseManager,
    private progressTracker: ISyncProgressTracker
  ) {
    this.costCalculator = new CostCalculator();
  }

  addToQueue(upload: FileUpload): void {
    this.uploadQueue.set(upload.id, upload);
  }

  async processQueue(): Promise<void> {
    // Move upload processing logic here
  }

  private sortUploadsForProcessing(uploads: FileUpload[]): FileUpload[] {
    // Move sorting logic here
  }
}
```

### Step 3.3: Extract Download Manager
```typescript
// Create: src/main/sync/DownloadManager.ts
export class DownloadManager {
  constructor(
    private databaseManager: DatabaseManager,
    private fileStateManager: IFileStateManager,
    private progressTracker: ISyncProgressTracker
  ) {}

  async syncDriveMetadata(): Promise<void> {
    // Move metadata sync logic here
  }

  async downloadMissingFiles(): Promise<void> {
    // Move download logic here
  }

  private async downloadFile(fileData: any, localPath: string): Promise<void> {
    // Move individual file download logic here
  }
}
```

## Phase 4: Extract File Watching (Risk: MEDIUM-HIGH)
**Duration: 3-4 days**

### Step 4.1: Create File Event Handlers
```typescript
// Create: src/main/sync/FileEventHandler.ts
export class FileEventHandler {
  constructor(
    private databaseManager: DatabaseManager,
    private fileStateManager: IFileStateManager,
    private costCalculator: CostCalculator
  ) {}

  async handleFileAdd(filePath: string): Promise<void> {
    // Move file add logic here
  }

  async handleFileChange(filePath: string): Promise<void> {
    // Move file change logic here
  }

  async handleFileDelete(filePath: string): Promise<void> {
    // Move file delete logic here
  }

  async handleFolderAdd(dirPath: string): Promise<void> {
    // Move folder add logic here
  }

  private async ensureParentFoldersInQueue(filePath: string): Promise<void> {
    // Move parent folder logic here
  }
}
```

### Step 4.2: Create File Watcher
```typescript
// Create: src/main/sync/FileWatcher.ts
export class FileWatcher implements IFileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private isWatcherActive = false;

  constructor(private eventHandler: FileEventHandler) {}

  async start(syncFolderPath: string): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    this.watcher = chokidar.watch(syncFolderPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    this.setupEventListeners();
    this.isWatcherActive = true;
  }

  private setupEventListeners(): void {
    if (!this.watcher) return;

    this.watcher.on('add', (filePath) => {
      this.eventHandler.handleFileAdd(filePath);
    });

    this.watcher.on('addDir', (dirPath) => {
      this.eventHandler.handleFolderAdd(dirPath);
    });

    // ... other event listeners
  }
}
```

## Phase 5: Refactor Main SyncManager (Risk: HIGH)
**Duration: 4-5 days**

### Step 5.1: Create Orchestrator SyncManager
```typescript
// Create: src/main/sync/SyncManagerV2.ts
export class SyncManagerV2 {
  private fileWatcher: FileWatcher;
  private uploadQueueManager: UploadQueueManager;
  private downloadManager: DownloadManager;
  private fileStateManager: FileStateManager;
  private progressTracker: SyncProgressTracker;
  private eventHandler: FileEventHandler;
  
  private syncState: 'idle' | 'syncing' | 'monitoring' = 'idle';
  private isActive = false;

  constructor(private databaseManager: DatabaseManager) {
    this.fileStateManager = new FileStateManager();
    this.progressTracker = new SyncProgressTracker();
    this.uploadQueueManager = new UploadQueueManager(databaseManager, this.progressTracker);
    this.downloadManager = new DownloadManager(databaseManager, this.fileStateManager, this.progressTracker);
    this.eventHandler = new FileEventHandler(databaseManager, this.fileStateManager, new CostCalculator());
    this.fileWatcher = new FileWatcher(this.eventHandler);
  }

  async startSync(driveId: string, rootFolderId: string, driveName?: string): Promise<boolean> {
    try {
      this.syncState = 'syncing';
      
      // Phase 1: Download everything from Arweave
      await this.downloadManager.syncDriveMetadata();
      await this.downloadManager.downloadMissingFiles();
      
      // Phase 2: Start monitoring local changes
      this.syncState = 'monitoring';
      await this.fileWatcher.start(this.syncFolderPath!);
      
      // Phase 3: Process any pending uploads
      this.uploadQueueManager.startProcessing();
      
      this.isActive = true;
      return true;
    } catch (error) {
      this.syncState = 'idle';
      this.isActive = false;
      throw error;
    }
  }

  async stopSync(): Promise<boolean> {
    this.isActive = false;
    this.syncState = 'idle';
    
    await this.fileWatcher.stop();
    this.uploadQueueManager.stopProcessing();
    
    return true;
  }

  // Simple delegation methods
  addToUploadQueue(upload: FileUpload): void {
    this.uploadQueueManager.addToQueue(upload);
  }

  getCurrentSyncState(): any {
    return {
      syncState: this.syncState,
      isActive: this.isActive,
      // ... other state
    };
  }
}
```

### Step 5.2: Gradual Migration Strategy
```typescript
// Create: src/main/sync-manager-v2.ts (copy of above)
// In main.ts, add feature flag:

const USE_NEW_SYNC_MANAGER = process.env.USE_NEW_SYNC_MANAGER === 'true';

// Switch between old and new:
if (USE_NEW_SYNC_MANAGER) {
  this.syncManager = new SyncManagerV2(databaseManager);
} else {
  this.syncManager = new SyncManager(databaseManager);
}
```

## Phase 6: Testing and Cleanup (Risk: LOW)
**Duration: 2-3 days**

### Step 6.1: Comprehensive Testing
- Run both sync managers in parallel (with different test folders)
- Verify feature parity
- Performance testing
- Error scenario testing

### Step 6.2: Migration and Cleanup
- Switch default to new sync manager
- Remove old sync-manager.ts
- Update all imports
- Remove feature flag

## Risk Mitigation Strategies

### 1. Feature Flags
```typescript
// Allow switching between implementations
const config = {
  useNewSyncManager: process.env.USE_NEW_SYNC_MANAGER === 'true',
  useNewFileWatcher: process.env.USE_NEW_FILE_WATCHER === 'true',
  useNewUploadManager: process.env.USE_NEW_UPLOAD_MANAGER === 'true',
};
```

### 2. Parallel Testing
```typescript
// Run both implementations and compare results
const oldResult = await oldSyncManager.operation();
const newResult = await newSyncManager.operation();
assert.deepEqual(oldResult, newResult);
```

### 3. Gradual Rollout
- Phase 2-3: Internal testing only
- Phase 4: Feature flag for beta users
- Phase 5: Default for new installs
- Phase 6: Full migration

### 4. Rollback Plan
- Keep old sync-manager.ts until Phase 6 complete
- Environment variable to instantly switch back
- Database migrations are backwards compatible

## Success Metrics

### Code Quality Metrics
- **Before**: 1 file, 2,600+ lines
- **After**: 8 files, ~300 lines each (average)
- **Cyclomatic Complexity**: Reduce from ~50+ to <10 per method
- **Test Coverage**: Increase from 0% to 80%+

### Performance Metrics
- Sync startup time should remain <5 seconds
- File processing latency should remain <1 second
- Memory usage should not increase >10%

### Maintainability Metrics
- New features should require changes to 1-2 files max
- Bug fixes should be isolatable to single components
- Onboarding new developers should take <1 day

## Timeline Summary

| Phase | Duration | Risk Level | Deliverable |
|-------|----------|------------|-------------|
| 1 | 1-2 days | LOW | Tests, constants, interfaces |
| 2 | 2-3 days | LOW | Progress & state utilities |
| 3 | 3-4 days | MEDIUM | Upload/download managers |
| 4 | 3-4 days | MEDIUM-HIGH | File watching system |
| 5 | 4-5 days | HIGH | New orchestrator |
| 6 | 2-3 days | LOW | Testing & cleanup |

**Total: 15-21 days**

## Next Steps

1. **Review this plan** with the team
2. **Create feature branch** for refactor work
3. **Start with Phase 1** - establish testing foundation
4. **Daily reviews** to catch issues early
5. **Adjust timeline** based on complexity discovered

## Emergency Rollback

If anything goes wrong at any phase:

```bash
# Immediate rollback
git checkout main
npm run build
npm run dev

# Disable feature flags
export USE_NEW_SYNC_MANAGER=false
export USE_NEW_FILE_WATCHER=false
```

The old sync-manager.ts will continue working until Phase 6 is complete and thoroughly tested.