import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { ArDrive, wrapFileOrFolder, EID, PrivateKeyData } from 'ardrive-core-js';
import { DatabaseManager } from './database-manager';
import { VersionManager, ChangeType } from './version-manager';
import { FileUpload, SyncStatus, SyncHealth, PendingUpload } from '../types';
import { SyncProgressTracker } from './sync/SyncProgressTracker';
import { FileStateManager } from './sync/FileStateManager';
import { CostCalculator } from './sync/CostCalculator';
import { UploadQueueManager } from './sync/UploadQueueManager';
import { DownloadManager } from './sync/DownloadManager';
import { FolderOperationDetector, OperationDetection } from './sync/FolderOperationDetector';
import { FileOperationDetector, FileOperationDetection } from './sync/FileOperationDetector';
import { driveKeyManager } from './drive-key-manager';
import { notificationService } from './notification-service';
import { summarizeArFSResult } from './utils/arfs-result-summary';
import { retryWithBackoff, isNetworkDownError } from './sync/retry';
import { resolveDrivePrivacyOrThrow } from './sync/drive-privacy';
// MONEY-14 single source for the Turbo free-tier boundary (107520 bytes).
// MONEY-10 uses it to flag an approved upload that grew past it before execution.
import { TURBO_FREE_SIZE_LIMIT } from '../utils/turbo-utils';
import {
  fetchTxDataWithFailover,
  queryMetadataWithResilience,
} from './sync/gateway-failover';

// SYNC-26: ArFS entity IDs (fileIds) are RFC-4122 UUIDs. core-js's EID()
// constructor throws on anything else, so we validate before threading a
// recorded id into an upload as a revision hint. This also guards against a
// dataTxId (base64url, not a UUID) that some legacy processed_files rows stored
// in the arweaveId column as a fallback — those must NOT be passed as a fileId.
const ARFS_ENTITY_ID_REGEX = /^[a-f\d]{8}-([a-f\d]{4}-){3}[a-f\d]{12}$/i;
function isValidArfsFileId(id: string | undefined | null): id is string {
  return typeof id === 'string' && ARFS_ENTITY_ID_REGEX.test(id);
}

interface SyncProgress {
  phase?: string;
  stage?: string;
  description?: string;
  totalItems?: number;
  currentItem?: number;
  itemsProcessed?: number;
  estimatedRemaining?: number;
  message?: string;
  [key: string]: unknown;
}

interface ArweaveTag {
  name: string;
  value: string;
}

interface ArweaveTransaction {
  id: string;
  tags: ArweaveTag[];
}

interface ArweaveEdge {
  node: ArweaveTransaction;
}

interface ArweaveQueryResult {
  data?: {
    transactions?: {
      edges: ArweaveEdge[];
    };
  };
}

export class SyncManager {
  private watcher: chokidar.FSWatcher | null = null;
  private syncFolderPath: string | null = null;
  private driveId: string | null = null;
  private rootFolderId: string | null = null;
  private isActive = false;
  // REMOVED: uploadQueue - now managed by UploadQueueManager
  private arDrive: ArDrive | null = null;
  private versionManager: VersionManager;
  private progressTracker: SyncProgressTracker;
  private fileStateManager: FileStateManager;
  private costCalculator: CostCalculator;
  private uploadQueueManager: UploadQueueManager;
  private downloadManager: DownloadManager;
  private folderOperationDetector: FolderOperationDetector;
  private fileOperationDetector: FileOperationDetector;
  private privateKeyData: PrivateKeyData | undefined;
  // REMOVED: File state tracking properties - now managed by FileStateManager
  
  // New sync state management
  private syncState: 'idle' | 'syncing' | 'monitoring' = 'idle';
  private watchedFolderPath: string | null = null; // folder the active watcher points at (SEC-3 re-target)
  private syncPromise: Promise<void> | null = null;
  private totalItemsToSync = 0;
  private foldersToCreate = 0;
  private filesToDownload = 0;

  // SYNC-9: honest sync-health so a degraded/offline sync is always visible
  // (surfaced through getStatus() -> the persistent header indicator + tray).
  // 'healthy' by default; set to 'error'/'offline' when sync breaks, cleared
  // back to 'healthy' on a successful (re)start or an intentional stop.
  private syncHealth: SyncHealth = 'healthy';
  private syncHealthMessage: string | null = null;
  // Params of the most recent startSync so the offline watchdog can re-attempt
  // it once connectivity returns (startSync's catch nulls driveId/rootFolderId
  // for PRIV-5, so we can't rely on those).
  private lastStartArgs: { driveId: string; rootFolderId: string; driveName?: string } | null = null;
  // SYNC-9 offline auto-resume watchdog.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private static readonly RECONNECT_DELAY_MS = 15000;

  constructor(private databaseManager: DatabaseManager) {
    this.versionManager = new VersionManager(databaseManager);
    this.progressTracker = new SyncProgressTracker();
    this.fileStateManager = new FileStateManager();
    this.costCalculator = new CostCalculator();
    
    // UploadQueueManager needs a callback for uploading files
    this.uploadQueueManager = new UploadQueueManager(
      databaseManager,
      this.progressTracker,
      (upload) => this.uploadFile(upload)
    );
    
    // DownloadManager needs references to be set later
    this.downloadManager = new DownloadManager(
      databaseManager,
      this.fileStateManager,
      this.progressTracker,
      null, // ArDrive will be set later
      null, // driveId will be set later
      null, // rootFolderId will be set later
      null  // syncFolderPath will be set later
    );
    
    this.folderOperationDetector = new FolderOperationDetector();
    this.fileOperationDetector = new FileOperationDetector(databaseManager);
  }

  private emitSyncProgress(progress: SyncProgress, silent = false) {
    console.log('🟡 [SYNC-PROGRESS] emitSyncProgress called:', {
      phase: progress.phase,
      description: progress.description,
      silent: silent,
      willEmit: !silent,
      timestamp: new Date().toISOString()
    });
    if (!silent) {
      this.progressTracker.emitSyncProgress(progress);
    }
  }

  private notifyRenderer(channel: string, data?: unknown) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }

  // ─── SYNC-9: sync-health signal ──────────────────────────────────────────
  // A degraded/offline sync must never look healthy. Health is surfaced through
  // getStatus() (the same channel the persistent header indicator + tray
  // already poll), so no parallel system is introduced.

  /** Read-only accessor used by tests / callers that want the raw health. */
  getSyncHealth(): { health: SyncHealth; message: string | null } {
    return { health: this.syncHealth, message: this.syncHealthMessage };
  }

  /** Set health, returning whether the KIND changed (so we only notify once). */
  private setSyncHealth(health: SyncHealth, message: string | null): boolean {
    const changed = this.syncHealth !== health;
    this.syncHealth = health;
    this.syncHealthMessage = health === 'healthy' ? null : message;
    return changed;
  }

  /**
   * Record that sync has broken. Classifies the failure: a network-down /
   * gateway-unreachable error (after SYNC-20 retries + SYNC-23 failover are
   * exhausted) is the authoritative OFFLINE signal; anything else is a
   * user-actionable ERROR (locked drive, watcher died, validation).
   *
   * On the TRANSITION into a degraded state we fire one OS notification (UX-29)
   * and — for a user-initiated (non-silent) flow — drive the progress modal's
   * error state (UX-8). Re-marking the same state stays quiet (no notification
   * spam while the offline watchdog keeps retrying). OFFLINE additionally arms
   * the auto-resume watchdog.
   */
  private markSyncDegraded(error: unknown, context: string, silent: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    const health: SyncHealth = isNetworkDownError(error) ? 'offline' : 'error';
    const userMessage =
      health === 'offline'
        ? "Offline — couldn't reach the gateway. Sync is paused and will resume automatically."
        : `Sync error: ${message}`;

    const changed = this.setSyncHealth(health, userMessage);
    if (changed) {
      console.warn(`⚠️ [SYNC-HEALTH] ${context}: sync is now "${health}" — ${message}`);
      // UX-29: OS notification so the failure is visible even when nothing is
      // watching the UI (e.g. a silent auto-sync at launch).
      notificationService.notifySyncError(
        health === 'offline' ? 'Offline — sync paused' : message || 'Sync error'
      );
      // UX-8: a user-initiated failure surfaces the progress modal's honest
      // error state. A silent/background failure stays quiet-modal — it is
      // still fully visible via the persistent header indicator (which polls
      // getStatus() and now sees the degraded health) + the OS notification,
      // so the app can never look healthy while offline/failing.
      if (!silent) {
        this.progressTracker.emitSyncProgress({
          phase: 'error',
          description: userMessage,
          error: userMessage,
        });
      }
    }
    if (health === 'offline') {
      this.scheduleReconnect();
    }
  }

  /** Sync is working again — clear any degraded state and stop the watchdog. */
  private markSyncHealthy(): void {
    this.clearReconnect();
    this.setSyncHealth('healthy', null);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.reconnecting) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, SyncManager.RECONNECT_DELAY_MS);
    // Never keep the process alive just for the reconnect watchdog.
    (this.reconnectTimer as unknown as { unref?: () => void }).unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
  }

  /**
   * SYNC-9 auto-resume: while offline, periodically re-attempt the last
   * startSync. A success clears the degraded state (startSync marks healthy);
   * a still-offline failure re-arms the watchdog. Read-only w.r.t. spending —
   * startSync only reads metadata and (re)attaches the watcher.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.syncHealth !== 'offline' || !this.lastStartArgs) {
      return;
    }
    // Already recovered / running under another path — nothing to resume.
    if (this.syncState !== 'idle') {
      return;
    }
    this.reconnecting = true;
    const { driveId, rootFolderId, driveName } = this.lastStartArgs;
    try {
      console.log('🔄 [SYNC-HEALTH] Offline watchdog re-attempting sync…');
      await this.startSync(driveId, rootFolderId, driveName, true);
      // startSync marks healthy on success.
    } catch {
      // startSync's catch already re-marked the degraded state; re-arm the
      // watchdog if we're still offline.
      this.reconnecting = false;
      if (this.syncHealth === 'offline') {
        this.scheduleReconnect();
      }
      return;
    }
    this.reconnecting = false;
  }

  // Helper to get parent folder ID from path
  private async getParentFolderIdFromPath(folderPath: string, mappingId: string): Promise<string | null> {
    try {
      if (folderPath === '/' || !folderPath) {
        // Root folder - get from drive mapping
        const driveMappings = await this.databaseManager.getDriveMappings();
        const mapping = driveMappings.find((m: any) => m.id === mappingId);
        return mapping?.rootFolderId || null;
      }
      
      // Look up folder in metadata cache
      const metadata = await this.databaseManager.getDriveMetadata(mappingId);
      const folder = metadata.find((item: any) => 
        item.type === 'folder' && item.path === folderPath
      );
      
      return folder?.fileId || null;
    } catch (error) {
      console.error('Error getting parent folder ID:', error);
      return null;
    }
  }

  setSyncFolder(folderPath: string) {
    console.log('SyncManager.setSyncFolder:', folderPath);
    this.syncFolderPath = folderPath;
    this.versionManager.setSyncFolder(folderPath);
    // Update download manager with new path
    if (this.driveId && this.rootFolderId) {
      this.downloadManager.setDriveInfo(this.driveId, this.rootFolderId, folderPath);
    }
  }

  setArDrive(arDrive: ArDrive, privateKeyData?: PrivateKeyData) {
    console.log('SyncManager.setArDrive - ArDrive instance set');
    this.arDrive = arDrive;
    this.privateKeyData = privateKeyData;
    this.downloadManager.setArDrive(arDrive);
  }

  async startSync(driveId: string, rootFolderId: string, driveName?: string, silent = false): Promise<boolean> {
    console.log('🟢 [SYNC-MANAGER] startSync called with:', { 
      driveId, 
      rootFolderId,
      driveName,
      silent,
      hasSyncFolder: !!this.syncFolderPath,
      hasArDrive: !!this.arDrive,
      currentState: this.syncState,
      timestamp: new Date().toISOString()
    });
    
    if (!this.syncFolderPath || !this.arDrive) {
      throw new Error('Sync folder and ArDrive instance must be set');
    }
    
    // Clean up any orphaned .downloading files on startup
    await this.cleanupTempFiles();

    if (this.syncState !== 'idle') {
      console.log('Sync already in progress or monitoring active, current state:', this.syncState);
      
      if (this.syncState === 'monitoring') {
        const sameTarget =
          this.driveId === driveId &&
          this.rootFolderId === rootFolderId &&
          this.watchedFolderPath === this.syncFolderPath;
        
        if (sameTarget) {
          console.log('Already monitoring the requested drive/folder');
          return true;
        }
        
        // SEC-3: a different drive or folder was requested while monitoring —
        // re-target instead of silently "succeeding" against the old target.
        console.log('Monitoring a different drive/folder — re-targeting sync', {
          fromDrive: this.driveId,
          toDrive: driveId,
          fromFolder: this.watchedFolderPath,
          toFolder: this.syncFolderPath
        });
        await this.stopSync();
        await this.clearAllDriveState();
        // fall through to a fresh start below
      } else {
        return false;
      }
    }

    this.syncState = 'syncing';
    this.driveId = driveId;
    this.rootFolderId = rootFolderId;
    // SYNC-9: remember what we tried to start so the offline watchdog can
    // re-attempt exactly this drive once connectivity returns.
    this.lastStartArgs = { driveId, rootFolderId, driveName };

    // SYNC-4: stopSync destroys the progress tracker and download manager in
    // place; re-arm them so progress reporting and download batching survive
    // stop -> start cycles and drive switches.
    this.progressTracker.ensureStarted();
    this.downloadManager.ensureStarted();
    
    // Update download manager with drive info
    if (this.syncFolderPath) {
      this.downloadManager.setDriveInfo(driveId, rootFolderId, this.syncFolderPath);
    }

    try {
      // PRIV-5: a locked private drive must fail loudly BEFORE any metadata
      // work — the old flow cleared the metadata cache, listed nothing (the
      // lock error was swallowed downstream), and reported a successful
      // EMPTY sync.
      const lockCheckMappings = await this.databaseManager.getDriveMappings();
      const activeMapping = lockCheckMappings.find(m => m.driveId === driveId);
      if (activeMapping?.drivePrivacy === 'private' && !driveKeyManager.isUnlocked(driveId)) {
        throw new Error(
          `Private drive "${activeMapping.driveName}" is locked — unlock it to sync`
        );
      }
      
      console.log('🚀 About to perform full drive sync...');
      // Step 1: Complete full drive sync (no file watcher yet)
      await this.performFullDriveSync(silent);
      
      console.log('✅ Full drive sync completed, starting file monitoring...');
      
      // Step 2: Only start monitoring after sync is complete
      this.syncState = 'monitoring';
      this.isActive = true;
      await this.startFileWatcher();
      
      console.log('🎯 File watcher started, sync state is now:', this.syncState);
      
      // Start processing upload queue
      this.uploadQueueManager.startProcessing();

      // SYNC-9: a successful (re)start clears any prior degraded/offline state.
      this.markSyncHealthy();
      return true;
    } catch (error) {
      console.error('Failed to start sync:', error);
      // SYNC-9: sync failing to start must NOT leave a silent healthy-looking
      // app. markSyncDegraded classifies the failure (offline vs actionable
      // error), fires the UX-29 OS notification, drives the UX-8 progress
      // modal for user-initiated starts, flips the persistent header indicator
      // (via getStatus()), and — when offline — arms the auto-resume watchdog.
      this.markSyncDegraded(error, 'startSync', silent);
      this.syncState = 'idle';
      this.isActive = false;
      // PRIV-5 (qa-gate finding): a failed start must not leave the failed
      // drive as the engine's nominal target — a lingering locked target let
      // sync:manual empty-wipe it later.
      this.driveId = null;
      this.rootFolderId = null;
      throw error;
    }
  }

  // NEW: Complete drive sync without file monitoring
  private async performFullDriveSync(silent = false): Promise<void> {
    console.log('🟢 [SYNC-MANAGER] performFullDriveSync started:', {
      silent: silent,
      timestamp: new Date().toISOString()
    });
    
    // Set silent mode on DownloadManager
    console.log('🟢 [SYNC-MANAGER] Setting DownloadManager silent mode to:', silent);
    this.downloadManager.setSilentMode(silent);
    
    this.emitSyncProgress({
      phase: 'starting',
      description: 'Initializing drive sync...'
    }, silent);

    // Small delay to ensure UI shows the starting phase
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 1: Get authoritative drive state (BLOCKING - needed for UI).
    // SYNC-20: this is the gateway GQL fetch that stalled setup on a transient
    // 404 (fresh drive not yet indexed) — the wizard hung on "Starting sync
    // engine…" with no retry/timeout. Bound it: retry with backoff so it
    // self-heals, and cap each attempt so a hung gateway can't trap setup.
    // Metadata read is idempotent (no writes/spend), so retrying is safe.
    await retryWithBackoff(() => this.downloadManager.syncDriveMetadata(), {
      label: 'syncDriveMetadata',
      timeoutMs: 30000,
    });
    
    // Update metadata sync timestamp
    if (this.driveId) {
      await this.databaseManager.updateMetadataSyncTimestamp(this.driveId);
    }
    console.log('Metadata sync completed and timestamp updated');
    
    // Step 2: Create all folder structure (BLOCKING - fast operation)
    await this.downloadManager.createAllFolders();
    
    // Step 3: Queue all missing files for background download (NON-BLOCKING)
    await this.downloadManager.downloadMissingFilesWithProgress();
    
    // Step 4: Mark sync as ready (no verification needed for queue)
    this.emitSyncProgress({
      phase: 'complete',
      description: 'Metadata sync complete. Files downloading in background.'
    }, silent);

    // UX-29: mirror the renderer-progress silent gate — a silent (background
    // auto-)sync shouldn't pop a notification every time the app launches.
    if (!silent) {
      notificationService.notifySyncComplete(await this.getKnownFileCountForNotification());
    }

    console.log('✅ Metadata sync completed, files queued for background download');
    console.log('🚀 Users can now upload files while downloads continue in background');
  }

  // UX-29: best-effort file count for the "sync complete" notification. Reads
  // the drive's currently-known file entries (read-only, no side effects) —
  // an honest, DB-backed number even though downloadMissingFilesWithProgress()
  // only QUEUES files for background download rather than blocking on them
  // (see the 'downloading in background' wording above).
  private async getKnownFileCountForNotification(): Promise<number> {
    if (!this.driveId) return 0;
    try {
      const mappings = await this.databaseManager.getDriveMappings();
      const mapping = mappings.find(m => m.driveId === this.driveId);
      if (!mapping) return 0;
      const metadata = await this.databaseManager.getDriveMetadata(mapping.id);
      return metadata.filter((item) => item.type === 'file').length;
    } catch (error) {
      console.error('Failed to compute file count for sync-complete notification:', error);
      return 0;
    }
  }

  // NEW: Start file watcher only after sync complete
  private async startFileWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
    
    console.log('👁️ Starting file monitoring (sync complete)...');
    console.log(`🔍 Watching folder: ${this.syncFolderPath}`);
    console.log(`📊 Current sync state: ${this.syncState}`);
    
    this.watchedFolderPath = this.syncFolderPath;
    this.watcher = chokidar.watch(this.syncFolderPath!, {
      ignored: [
        /(^|[/\\])\../, // ignore dotfiles
        /\.downloading$/ // ignore temp download files
      ],
      persistent: true,
      ignoreInitial: true, // Critical: ignore existing files
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    // Only handle NEW changes after sync
    this.watcher.on('add', (filePath) => {
      console.log('🆕 New file detected by watcher:', filePath);
      console.log(`📊 Current sync state when file detected: ${this.syncState}`);
      this.handleFileAdd(filePath);
    });

    this.watcher.on('addDir', (dirPath) => {
      console.log('New folder detected:', dirPath);
      this.handleFolderAdd(dirPath);
    });

    this.watcher.on('change', (filePath) => {
      console.log('File changed:', filePath);
      this.handleFileChange(filePath);
    });

    this.watcher.on('unlink', (filePath) => {
      console.log('File deleted:', filePath);
      this.handleFileDelete(filePath);
    });

    this.watcher.on('unlinkDir', (dirPath) => {
      console.log('Folder deleted:', dirPath);
      this.handleFolderDelete(dirPath);
    });

    this.watcher.on('error', (error) => {
      console.error('File watcher error:', error);
      // SYNC-9 (was UX-29): the watcher dying mid-session silently stops sync
      // with no other signal to the user. Surface it as a visible degraded
      // state (persistent indicator + OS notification + progress modal), not
      // just a console line. A watcher/FS error is local, so it classifies as
      // 'error' (user-actionable), not 'offline'.
      this.markSyncDegraded(
        error instanceof Error ? error : new Error('File watcher error'),
        'watcher',
        false
      );
    });
  }

  async stopSync(): Promise<boolean> {
    this.isActive = false;
    this.syncState = 'idle';
    // SYNC-9: an intentional stop is not a degraded state — clear any
    // error/offline health and cancel the auto-resume watchdog so a
    // deliberately-paused sync doesn't silently restart itself. The indicator
    // then honestly reads "Paused", not "Sync error"/"Offline".
    this.markSyncHealthy();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.watchedFolderPath = null;

    // Stop upload queue processing
    this.uploadQueueManager.stopProcessing();
    
    // Stop and clean up download manager
    await this.downloadManager.stopAllDownloads();
    this.downloadManager.destroy();
    
    // Clean up progress tracker
    this.progressTracker.destroy();
    
    // Clear all pending file processing timeouts
    this.fileStateManager.clearAllProcessing();

    return true;
  }

  async switchDrive(newDriveId: string, newRootFolderId: string): Promise<boolean> {
    console.log(`Switching from drive ${this.driveId} to ${newDriveId}`);
    
    // Stop current sync gracefully
    await this.stopSync();
    
    // Clear all state from previous drive
    await this.clearAllDriveState();
    
    // SYNC-7: the active mapping's localFolderPath is the single source of
    // truth — re-point the watcher and upload target at the NEW drive's
    // folder. The old flow kept watching the previous drive's folder while
    // uploading to the new drive.
    const mappings = await this.databaseManager.getDriveMappings();
    const newMapping = mappings.find(m => m.driveId === newDriveId);
    if (newMapping?.localFolderPath) {
      this.setSyncFolder(newMapping.localFolderPath);
    }
    
    // Start sync with new drive
    return this.startSync(newDriveId, newRootFolderId);
  }
  
  /**
   * SEC-3: fully sever the engine from the current profile's wallet and drive.
   * Called on logout and profile switch so profile A's watcher/ArDrive can
   * never keep running against profile B's database.
   */
  async stopAndClearAllState(): Promise<void> {
    await this.stopSync();
    await this.clearAllDriveState();
    
    // Drop every wallet-bearing / profile-specific reference
    this.arDrive = null;
    this.privateKeyData = undefined;
    this.downloadManager.setArDrive(null);
    this.syncFolderPath = null;
    
    console.log('SyncManager: stopped and cleared all wallet/drive state');
  }

  private async clearAllDriveState(): Promise<void> {
    console.log('Clearing all drive state...');
    
    // Clear drive identifiers
    const previousDriveId = this.driveId;
    this.driveId = null;
    this.rootFolderId = null;
    
    // Clear upload queue
    this.uploadQueueManager.clearQueue();
    
    // Clear download queue
    this.downloadManager.clearQueue();
    
    // Clear file operation detectors
    this.fileOperationDetector.clearAllOperations();
    this.folderOperationDetector.clearAllOperations();
    
    // Clear file state tracking
    this.fileStateManager.clearAllProcessing();
    
    // Clear version manager cache
    this.versionManager.clearCache();
    
    // Clear progress tracking
    this.progressTracker.reset();
    
    // Clear database caches for the previous drive
    if (previousDriveId) {
      try {
        const mappings = await this.databaseManager.getDriveMappings();
        const previousMapping = mappings.find(m => m.driveId === previousDriveId);
        if (previousMapping) {
          console.log(`Clearing database cache for drive mapping: ${previousMapping.id}`);
          await this.databaseManager.clearDriveMetadataCache(previousMapping.id);
        }
      } catch (error) {
        console.error('Failed to clear database cache:', error);
      }
    }
    
    // Reset sync state
    this.syncState = 'idle';
    this.syncPromise = null;
    this.totalItemsToSync = 0;
    this.foldersToCreate = 0;
    this.filesToDownload = 0;
    
    console.log('Drive state cleared successfully');
  }

  // DEBUG: Method to check current sync state
  getCurrentSyncState(): string {
    return this.syncState;
  }

  // DEBUG: Method to force file monitoring if needed
  async forceStartFileMonitoring(): Promise<void> {
    console.log('🔧 Force starting file monitoring...');
    console.log(`Current state: ${this.syncState}, isActive: ${this.isActive}`);
    
    if (!this.syncFolderPath) {
      throw new Error('No sync folder set');
    }
    
    this.syncState = 'monitoring';
    this.isActive = true;
    await this.startFileWatcher();
    
    console.log('✅ File monitoring force-started');
  }

  async getStatus(): Promise<SyncStatus> {
    const uploads = await this.databaseManager.getUploads();
    const uploadedFiles = uploads.filter(u => u.status === 'completed').length;
    const failedFiles = uploads.filter(u => u.status === 'failed').length;

    const currentUpload = this.uploadQueueManager.getCurrentUpload();

    return {
      isActive: this.isActive,
      totalFiles: uploads.length,
      uploadedFiles,
      failedFiles,
      currentFile: currentUpload?.fileName,
      // SYNC-9: the honest sync-health the persistent header indicator + tray
      // consume, so a degraded/offline sync is never hidden behind an
      // "up to date"/"paused"-looking chip.
      health: this.syncHealth,
      healthMessage: this.syncHealthMessage ?? undefined,
    };
  }

  // Add approved upload to the processing queue
  addToUploadQueue(upload: FileUpload): void {
    console.log(`Adding approved upload to processing queue: ${upload.fileName}`);
    this.uploadQueueManager.addToQueue(upload);
  }
  
  // Cancel an upload
  cancelUpload(uploadId: string): { cancelled: boolean; wasInFlight: boolean } {
    console.log(`Cancelling upload: ${uploadId}`);
    return this.uploadQueueManager.cancelUpload(uploadId);
  }

  /** MONEY-2: retry admission inputs for the uploads:retry handlers. */
  getQueueEntryStatus(uploadId: string): string | undefined {
    return this.uploadQueueManager.getQueueEntryStatus(uploadId);
  }

  isUploadCancellationPending(uploadId: string): boolean {
    return this.uploadQueueManager.isCancellationRequested(uploadId);
  }

  private static readonly UPLOAD_CANCELLED_SENTINEL = 'UPLOAD_CANCELLED_BY_USER';

  /**
   * MONEY-2: throws the cancellation sentinel when a cancellation is pending
   * for the given upload — used inside multi-step paid loops (folder
   * structure creation) so successive paid calls stop launching the moment
   * cancellation is requested (qa-gate FAIL reason 3).
   */
  private throwIfUploadCancelled(cancellationUploadId?: string): void {
    if (cancellationUploadId && this.uploadQueueManager.isCancellationRequested(cancellationUploadId)) {
      throw new Error(SyncManager.UPLOAD_CANCELLED_SENTINEL);
    }
  }

  /**
   * MONEY-2 spend checkpoint: if cancellation was requested and no money has
   * been spent yet, finalize the upload as cancelled. Returns true when the
   * upload was finalized (caller must stop).
   */
  private async finalizeCancelledUpload(upload: FileUpload): Promise<boolean> {
    if (!this.uploadQueueManager.isCancellationRequested(upload.id)) {
      return false;
    }
    this.uploadQueueManager.clearCancellationRequest(upload.id);
    upload.status = 'failed';
    upload.error = 'Cancelled by user';
    await this.databaseManager.updateUpload(upload.id, {
      status: 'failed',
      error: 'Cancelled by user'
    });
    this.emitUploadProgress(upload.id, 0, 'failed', 'Cancelled by user');
    this.uploadQueueManager.removeFromQueue(upload.id);
    console.log(`Upload ${upload.id} cancelled before any paid work started`);
    return true;
  }

  /**
   * MONEY-10 spend checkpoint: re-validate an approved file's size against the
   * on-disk bytes we are about to upload. The user approved a specific size —
   * the cost shown and OK'd was computed from it. Between approval and this
   * execution the file can change (the user edits it). Uploading whatever is on
   * disk NOW would let a file that grew after approval upload at the LARGER
   * size, which can cross the Turbo free-tier boundary (<=TURBO_FREE_SIZE_LIMIT
   * → >limit) or simply cost more than approved — an UNAPPROVED SPEND.
   *
   * Tolerance = exact match (0 bytes). Any difference between the approved size
   * and the current size returns the item to the approval queue:
   *   - Grew while paid → costs more than approved.
   *   - Crossed the free-tier boundary (free → paid) → the core money bug: an
   *     outright unapproved charge.
   *   - Shrank / changed within the free tier → cheaper or still free, but the
   *     on-disk bytes no longer match what the user reviewed; re-approving on any
   *     material change is the safe default (and only re-prompts when the file
   *     genuinely changed after approval, so it does not flap on stable files).
   *
   * Handling:
   *   - Deleted / unreadable → cancel the upload (nothing to upload); mark the
   *     execution record failed with a clear note; do NOT re-queue.
   *   - Size changed → drop the in-flight execution record and re-queue a fresh
   *     awaiting_approval pending upload at the NEW size (with a re-approve note
   *     and a freshly computed cost) so the user re-confirms.
   *
   * Returns true when the upload was handled here (caller must stop before any
   * wrap/upload); false to proceed with the upload at the approved size. Runs
   * before SYNC-26 (revision fileId) and PRIV-8 (privacy routing), so it never
   * weakens them — it only decides whether this upload happens at all.
   */
  private async revalidateApprovedFileSize(upload: FileUpload): Promise<boolean> {
    // MONEY-2 takes precedence: an upload with a pending cancellation must be
    // finalized as CANCELLED, not re-queued for approval. Defer to the existing
    // cancellation checkpoints (uploadFileWithArDriveCore / uploadFile's catch),
    // which stop before any spend — so returning false here never uploads.
    if (this.uploadQueueManager.isCancellationRequested(upload.id)) {
      return false;
    }

    const approvedSize = upload.fileSize;

    let currentSize: number;
    try {
      const stats = await fs.stat(upload.localPath);
      if (!stats.isFile()) {
        // Something that is not a regular file now sits at this path — treat it
        // as gone (we approved a file, not a directory/device).
        throw new Error('path is no longer a regular file');
      }
      currentSize = stats.size;
    } catch (statError) {
      // Deleted / moved / unreadable since approval — cancel cleanly, never crash.
      const note =
        'File no longer exists on disk — upload cancelled (nothing was uploaded)';
      console.warn(
        `MONEY-10: cannot re-stat "${upload.fileName}" (${upload.id}) before upload: ` +
          `${statError instanceof Error ? statError.message : String(statError)}. Cancelling.`
      );
      upload.status = 'failed';
      upload.error = note;
      await this.databaseManager.updateUpload(upload.id, { status: 'failed', error: note });
      this.emitUploadProgress(upload.id, 0, 'failed', note);
      this.uploadQueueManager.removeFromQueue(upload.id);
      return true;
    }

    // Unchanged — safe to upload at exactly the approved size.
    if (currentSize === approvedSize) {
      return false;
    }

    // Size changed since approval — return to the approval queue at the new size
    // via the shared re-queue path (also used by the wrap-adjacent TOCTOU assert).
    await this.requeueUploadForReapproval(upload, currentSize);
    return true;
  }

  /**
   * MONEY-10 shared re-queue: drop the in-flight execution record and return the
   * upload to the approval queue at its ACTUAL current size so the user re-confirms
   * the (possibly higher) cost. Used by BOTH the start-of-uploadFile re-stat
   * (revalidateApprovedFileSize) and the wrap-adjacent TOCTOU assert
   * (assertWrappedSizeApproved), so the two never drift apart. Never spends;
   * preserves the SYNC-26 revision target so re-approval still uploads a revision
   * of the same on-chain file rather than minting a new entity.
   */
  private async requeueUploadForReapproval(
    upload: FileUpload,
    currentSize: number
  ): Promise<void> {
    const approvedSize = upload.fileSize;
    const wasFree = approvedSize <= TURBO_FREE_SIZE_LIMIT;
    const nowFree = currentSize <= TURBO_FREE_SIZE_LIMIT;
    const crossedFreeBoundary = wasFree && !nowFree;

    const note =
      `File changed since approval — re-approve to upload at the new size ` +
      `(${approvedSize} → ${currentSize} bytes)` +
      (crossedFreeBoundary
        ? ' — now exceeds the free-tier limit and will cost credits'
        : '');

    console.warn(
      `MONEY-10: "${upload.fileName}" (${upload.id}) changed since approval — ` +
        `${approvedSize} → ${currentSize} bytes` +
        (crossedFreeBoundary ? ' (crossed the free-tier boundary)' : '') +
        `. Returning to approval queue; not uploading at the new size.`
    );

    // Recompute the cost estimate for the NEW size so the re-approval shows the
    // real (possibly higher) cost the user must confirm.
    const costs = await this.costCalculator.calculateUploadCosts(currentSize);

    // Drop the in-flight execution: remove it from the in-memory queue AND delete
    // its uploads row so re-approval's addUpload (a plain INSERT keyed by id) does
    // not collide with a stale record.
    this.uploadQueueManager.removeFromQueue(upload.id);
    await this.databaseManager.removeUpload(upload.id);

    // Re-queue as a fresh awaiting_approval pending upload at the NEW size.
    const requeued: Omit<PendingUpload, 'createdAt'> = {
      id: upload.id,
      driveId: upload.driveId,
      localPath: upload.localPath,
      fileName: upload.fileName,
      fileSize: currentSize,
      estimatedCost: costs.estimatedCost,
      // MONEY-6: a legit 0 quote (free) must not coerce to "estimate unavailable".
      estimatedTurboCost: costs.estimatedTurboCost ?? undefined,
      recommendedMethod: costs.recommendedMethod,
      hasSufficientTurboBalance: costs.hasSufficientTurboBalance,
      conflictType: 'content_conflict',
      conflictDetails: note,
      status: 'awaiting_approval',
      // SYNC-26: preserve the revision target so re-approval still uploads this as
      // a revision of the same on-chain file, not a brand-new entity.
      arfsFileId: upload.existingArfsFileId
    };
    await this.databaseManager.addPendingUpload(requeued);

    // Reflect the outcome on the in-memory record and refresh the approval UI.
    upload.status = 'pending';
    upload.error = note;
    this.notifyRenderer('sync:pending-uploads-updated');
    try {
      const stillPending = await this.databaseManager.getPendingUploads();
      notificationService.notifyApprovalNeeded(stillPending.length);
    } catch (notifyError) {
      console.error('MONEY-10: failed to notify approval-needed after re-queue:', notifyError);
    }
  }

  /**
   * MONEY-10 (TOCTOU close): assert the WRAPPED file's byte count equals the
   * approved size immediately before uploadAllEntities. wrapFileOrFolder performs
   * a FRESH disk read; between the start-of-uploadFile re-stat
   * (revalidateApprovedFileSize) and this wrap there are awaits — notably
   * getTargetFolderId(), which can create parent folders on-chain with 1s/2s
   * retry sleeps — during which the file can change. ArFSFileToUpload's `size`
   * getter is the EXACT number of bytes uploadAllEntities will upload/charge for
   * (a ByteCount; Number() unwraps it), so it is the authoritative money-safety
   * check. On mismatch, do NOT upload: re-queue for approval at the current
   * (wrapped) size via the SAME path revalidateApprovedFileSize uses and return
   * true so the caller aborts BEFORE any spend. Returns false (safe to upload)
   * ONLY when wrapped size == approved size — which also neutralizes the
   * isFreeWithTurbo(upload.fileSize) amplifier, since skipBalanceCheck can then
   * only take effect on bytes that match the approval.
   */
  private async assertWrappedSizeApproved(
    wrappedFile: unknown,
    upload: FileUpload
  ): Promise<boolean> {
    // wrapFileOrFolder returns an ArFSFileToUpload for files; its `size` getter is
    // a ByteCount (Number() unwraps it) equal to the exact bytes to be uploaded.
    // Read defensively — the type is the file|folder union at the call site.
    const rawSize =
      wrappedFile && typeof wrappedFile === 'object' && 'size' in wrappedFile
        ? (wrappedFile as { size?: unknown }).size
        : undefined;
    const wrappedSize = Number(rawSize);

    // Exact match against the approved size — the bytes about to be uploaded are
    // precisely what the user approved. Safe to proceed.
    if (Number.isFinite(wrappedSize) && wrappedSize === upload.fileSize) {
      return false;
    }

    // Mismatch (or a wrap that exposed no numeric size): the bytes about to be
    // uploaded are NOT the ones the user approved. Determine the size to re-queue
    // at (the wrapped size when numeric; otherwise a fresh stat), then return to
    // the approval queue and abort — nothing is uploaded, nothing is spent.
    let currentSize = wrappedSize;
    if (!Number.isFinite(currentSize)) {
      try {
        currentSize = (await fs.stat(upload.localPath)).size;
      } catch {
        currentSize = upload.fileSize;
      }
    }

    console.warn(
      `MONEY-10 (TOCTOU): "${upload.fileName}" (${upload.id}) changed between the ` +
        `approval re-stat and the wrap — approved ${upload.fileSize} bytes, wrapped ` +
        `${currentSize} bytes. Aborting upload and returning to the approval queue; ` +
        `no bytes uploaded at the unapproved size.`
    );
    await this.requeueUploadForReapproval(upload, currentSize);
    return true;
  }

  // Emit upload progress event
  private emitUploadProgress(uploadId: string, progress: number, status: 'uploading' | 'completed' | 'failed', error?: string): void {
    this.progressTracker.emitUploadProgress(uploadId, progress, status, error);
  }

  // Force re-download of existing drive files
  async forceDownloadExistingFiles(): Promise<void> {
    console.log('Force downloading existing drive files...');
    if (!this.arDrive || !this.rootFolderId || !this.syncFolderPath) {
      throw new Error('Sync not properly initialized');
    }
    
    // PRIV-5 (qa-gate finding): manual sync on a locked private drive must
    // fail loudly too — the metadata failure was swallowed below and the
    // already-cleared cache made the drive look empty.
    if (this.driveId) {
      const mappings = await this.databaseManager.getDriveMappings();
      const mapping = mappings.find(m => m.driveId === this.driveId);
      if (mapping?.drivePrivacy === 'private' && !driveKeyManager.isUnlocked(this.driveId)) {
        throw new Error(
          `Private drive "${mapping.driveName}" is locked — unlock it to sync`
        );
      }
    }
    
    // Make sure DownloadManager is not in silent mode for manual operations
    this.downloadManager.setSilentMode(false);
    
    // Emit starting progress
    this.emitSyncProgress({
      phase: 'starting',
      description: 'Initializing sync...'
    });
    
    // Small delay to ensure UI shows the starting phase
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 1: Sync metadata (the DownloadManager will emit its own progress)
    await this.downloadExistingDriveFiles();
    
    // Step 2: Create all folder structure (fast operation)
    await this.downloadManager.createAllFolders();
    
    // Step 3: Queue all missing files for background download (NON-BLOCKING)
    await this.downloadManager.downloadMissingFilesWithProgress();
    
    // Emit completion - files are downloading in background
    this.emitSyncProgress({
      phase: 'complete',
      description: 'Sync complete. Files downloading in background.'
    });

    // UX-29: this path is always a user-triggered manual sync (never silent),
    // so always notify.
    notificationService.notifySyncComplete(await this.getKnownFileCountForNotification());

    // Wait a bit more to ensure all database transactions are complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Scan downloaded files and add them to database
  private async scanDownloadedFiles(): Promise<void> {
    console.log('Scanning downloaded files to update database...');
    
    try {
      await this.scanDirectoryForDownloads(this.syncFolderPath!);
      console.log('Finished scanning downloaded files');
    } catch (error) {
      console.error('Failed to scan downloaded files:', error);
    }
  }

  private async scanDirectoryForDownloads(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await this.scanDirectoryForDownloads(fullPath); // Recursive scan
      } else if (entry.isFile()) {
        await this.addDownloadedFileToDatabase(fullPath);
      }
    }
  }

  private async addDownloadedFileToDatabase(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      
      // Check if this file is already in our downloads database
      const existingDownload = await this.databaseManager.getDownloadByPath(filePath);
      if (existingDownload) {
        console.log(`File already in downloads database: ${fileName}`);
        return;
      }
      
      // Add to downloads database
      const downloadId = crypto.randomUUID();
      await this.databaseManager.addDownload({
        id: downloadId,
        fileName: fileName,
        localPath: filePath,
        fileSize: stats.size,
        fileId: 'unknown', // We don't have the ArDrive file ID from direct download
        status: 'completed',
        progress: 100
      });
      
      // Add to processed files database to prevent re-upload
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      await this.databaseManager.addProcessedFile(
        hash,
        fileName,
        stats.size,
        filePath,
        'download'
      );
      
      console.log(`Added downloaded file to database: ${fileName}`);
      
    } catch (error) {
      console.error(`Failed to add downloaded file to database: ${filePath}`, error);
    }
  }

  // Download files by querying Arweave directly (bypasses ArDrive Core completely)
  private async downloadFilesViaDirectArweaveQuery(): Promise<void> {
    console.log('Querying Arweave directly for files in this folder...');
    
    try {
      // Query for transactions with Parent-Folder-Id tag matching our root folder
      const query = `
        query GetFolderFiles($folderId: String!) {
          transactions(
            tags: [
              { name: "Entity-Type", values: ["file"] }
              { name: "Parent-Folder-Id", values: [$folderId] }
            ]
            first: 100
          ) {
            edges {
              node {
                id
                tags {
                  name
                  value
                }
              }
            }
          }
        }
      `;
      
      const variables = { folderId: this.rootFolderId };
      console.log('GraphQL query variables:', variables);

      // SYNC-23: this is the app's OWN hand-rolled ArFS metadata query (distinct
      // from core-js's GatewayAPI). Metadata resilience is CONSERVATIVE and
      // deliberately DIFFERENT from data-fetch failover: retry the PRIMARY
      // gateway robustly, but fail over to an alternate gateway ONLY if the
      // primary is HARD-UNREACHABLE (network error / 5xx) — NEVER on an
      // empty/404 result. Rationale (measured live): perma.online does NOT index
      // this owner's ArFS metadata (returns EMPTY for owner-scoped entity
      // queries), so trusting an alternate's empty answer would be silently
      // WORSE than the primary's. An empty result here is a valid answer, never
      // a failover trigger. See sync/gateway-failover.ts for the full reasoning.
      const result: ArweaveQueryResult = await queryMetadataWithResilience(
        async (gatewayUrl) => {
          const response = await fetch(`${gatewayUrl}/graphql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query: query,
              variables: variables
            })
          });
          if (!response.ok) {
            // Carry the HTTP status so isHardUnreachable can classify it: a 5xx
            // means the gateway gave no answer (may fail over); a 404/other is
            // an answer — retry the primary but NEVER fail over to an alternate.
            throw Object.assign(
              new Error(`GraphQL HTTP ${response.status}: ${response.statusText}`),
              { status: response.status }
            );
          }
          return (await response.json()) as ArweaveQueryResult;
        },
        { label: 'direct ArFS folder-files query' }
      );
      console.log('Direct GraphQL result:', result);
      
      if (result.data?.transactions?.edges) {
        const transactions = result.data.transactions.edges;
        console.log(`Found ${transactions.length} file transactions via direct query`);
        
        for (const edge of transactions) {
          const tx = edge.node;
          const tags = tx.tags || [];
          
          // Extract file info from tags
          const fileName = tags.find(t => t.name === 'File-Name')?.value;
          const fileId = tags.find(t => t.name === 'File-Id')?.value;
          const dataTxId = tx.id;
          
          console.log(`Found file via direct query: ${fileName} (fileId: ${fileId}, dataTxId: ${dataTxId})`);
          
          if (fileName && dataTxId) {
            try {
              await this.downloadFileDirectlyFromArweave(fileName, dataTxId, fileId);
            } catch (downloadError) {
              console.error(`Failed to download ${fileName} directly:`, downloadError);
              // Continue with other files
            }
          }
        }
        
        console.log('Finished direct Arweave download process');
      } else {
        console.log('No files found via direct Arweave query');
      }
      
    } catch (error) {
      console.error('Direct Arweave query failed:', error);
    }
  }

  // Download a file directly from Arweave without ArDrive Core
  private async downloadFileDirectlyFromArweave(fileName: string, dataTxId: string, fileId?: string): Promise<void> {
    console.log(`Downloading ${fileName} directly from Arweave (${dataTxId})`);
    
    try {
      const localFilePath = path.join(this.syncFolderPath!, fileName);
      
      // Check if file already exists
      try {
        const stats = await fs.stat(localFilePath);
        console.log(`File already exists: ${fileName} (${stats.size} bytes)`);
        return;
      } catch (err) {
        // File doesn't exist, proceed with download
      }
      
      // Create download record
      const downloadId = crypto.randomUUID();
      await this.databaseManager.addDownload({
        id: downloadId,
        driveId: this.driveId || undefined,
        fileName: fileName,
        localPath: localFilePath,
        fileSize: 0, // Will update after download
        fileId: fileId || 'unknown',
        dataTxId: dataTxId,
        status: 'downloading',
        progress: 0
      });
      
      // Download file data directly from Arweave.
      // SYNC-17: gateway host is configurable (defaults to turbo-gateway.com).
      // SYNC-23: this is a raw by-txid DATA fetch, so it gets ordered gateway
      // FAILOVER (primary → perma.online → arweave.net), each with bounded
      // retry+backoff. The primary intermittently 404-storms data that IS
      // available; the next gateway serves it. See sync/gateway-failover.ts.
      const { buffer, gatewayHost } = await fetchTxDataWithFailover(dataTxId);
      console.log(`Fetched ${buffer.length} bytes for ${dataTxId} from ${gatewayHost}`);
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(localFilePath), { recursive: true });
      
      // Write file to disk
      await fs.writeFile(localFilePath, buffer);
      
      console.log(`Successfully downloaded ${fileName} (${buffer.length} bytes)`);
      
      // Update download record
      await this.databaseManager.updateDownload(downloadId, {
        status: 'completed',
        progress: 100,
        fileSize: buffer.length
      });
      
      // Add to processed files database
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      await this.databaseManager.addProcessedFile(
        hash,
        fileName,
        buffer.length,
        localFilePath,
        'download',
        fileId
      );
      
      console.log(`Successfully processed direct download: ${fileName}`);
      
    } catch (error) {
      console.error(`Failed to download ${fileName} directly from Arweave:`, error);
      
      // Update download record as failed
      try {
        const existingDownload = await this.databaseManager.getDownloadByPath(path.join(this.syncFolderPath!, fileName));
        if (existingDownload) {
          await this.databaseManager.updateDownload(existingDownload.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } catch (dbError) {
        console.error('Failed to update download record:', dbError);
      }
    }
  }

  // Download an individual file by file ID (bypasses folder listing issues)
  private async downloadIndividualFile(fileId: string, fileName: string, dataTxId: string, fullLocalPath?: string): Promise<void> {
    try {
      console.log(`Starting individual download: ${fileName} (${fileId})`);
      
      // Use provided full path or construct from sync folder + filename
      const localFilePath = fullLocalPath || path.join(this.syncFolderPath!, fileName);
      console.log(`Target local path: ${localFilePath}`);
      
      // Check if file already exists locally
      try {
        const stats = await fs.stat(localFilePath);
        console.log(`File already exists locally: ${fileName} (${stats.size} bytes)`);
        return;
      } catch (err) {
        // File doesn't exist, proceed with download
      }
      
      // Create download record
      const downloadId = crypto.randomUUID();
      await this.databaseManager.addDownload({
        id: downloadId,
        driveId: this.driveId || undefined,
        fileName: fileName,
        localPath: localFilePath,
        fileSize: 0, // We'll update this after download
        fileId: fileId,
        dataTxId: dataTxId,
        status: 'downloading',
        progress: 0
      });
      
      // Ensure the destination directory exists
      const destDir = path.dirname(localFilePath);
      console.log(`Ensuring directory exists: ${destDir}`);
      await fs.mkdir(destDir, { recursive: true });
      
      // Use ArDrive's downloadPublicFile method
      console.log(`Downloading file ${fileName} to ${destDir}`);
      await this.arDrive!.downloadPublicFile({
        fileId: EID(fileId),
        destFolderPath: destDir,
        defaultFileName: fileName
      });
      
      // Add a small delay to ensure file system operations are complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify the file was downloaded and get its size
      const stats = await fs.stat(localFilePath);
      console.log(`Successfully downloaded ${fileName} (${stats.size} bytes)`);
      
      // Update download record as completed
      await this.databaseManager.updateDownload(downloadId, {
        status: 'completed',
        progress: 100,
        fileSize: stats.size
      });
      
      // Add to processed files database
      const content = await fs.readFile(localFilePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      
      await this.databaseManager.addProcessedFile(
        hash,
        fileName,
        stats.size,
        localFilePath,
        'download',
        fileId
      );
      
      console.log(`Individual download completed: ${fileName}`);
      
    } catch (error) {
      console.error(`Failed to download individual file ${fileName}:`, error);
      
      // Update download record as failed
      try {
        const existingDownload = await this.databaseManager.getDownloadByFileId(fileId);
        if (existingDownload) {
          await this.databaseManager.updateDownload(existingDownload.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } catch (dbError) {
        console.error('Failed to update download record:', dbError);
      }
      
      throw error;
    }
  }


  private async downloadExistingDriveFiles() {
    if (!this.arDrive || !this.rootFolderId || !this.syncFolderPath) {
      console.log('Download check - missing requirements:', {
        hasArDrive: !!this.arDrive,
        hasRootFolderId: !!this.rootFolderId,
        hasSyncFolderPath: !!this.syncFolderPath
      });
      return;
    }

    console.log('Starting metadata sync and selective download...');
    console.log('Drive ID:', this.driveId);
    console.log('Root Folder ID:', this.rootFolderId);
    console.log('Sync Folder Path:', this.syncFolderPath);
    
    // First, sync all metadata to cache
    try {
      // SYNC-20: self-heal a transient gateway blip before declaring failure;
      // idempotent read, so bounded retry is safe (mirrors performFullDriveSync).
      await retryWithBackoff(() => this.downloadManager.syncDriveMetadata(), {
        label: 'syncDriveMetadata (manual)',
        timeoutMs: 30000,
      });

      // Update metadata sync timestamp
      if (this.driveId) {
        await this.databaseManager.updateMetadataSyncTimestamp(this.driveId);
      }
      console.log('Metadata sync completed and timestamp updated');

      // Create all folders
      await this.downloadManager.createAllFolders();
      console.log('Folder structure created');

      // Queue missing files for download
      await this.downloadManager.downloadMissingFilesWithProgress();
      console.log('Files queued for download');

      // SYNC-9: a clean manual sync clears any prior degraded/offline state.
      this.markSyncHealthy();
    } catch (error) {
      console.error('Failed to sync drive metadata:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      // PRIV-5 (qa-gate finding): never "continue anyway" — a swallowed
      // metadata failure here (locked drive, gateway) reported a successful
      // manual sync over an already-cleared cache (empty drive lie).
      // SYNC-9: extend that honesty to VISIBILITY — flip the persistent
      // indicator to offline/error via getStatus() (silent: the sync:manual
      // IPC handler owns the progress-modal error state, so we don't emit a
      // competing one here) before re-throwing.
      this.markSyncDegraded(error, 'manual metadata sync', true);
      throw error;
    }
  }

  private async downloadDriveFile(file: any) {
    try {
      // Cast to any to avoid TypeScript issues with ArDrive types
      const fileData = file as any;
      
      console.log(`Starting download for file:`, {
        name: fileData.name,
        fileId: fileData.fileId,
        size: fileData.size,
        path: fileData.path
      });

      // Normalize the path to remove drive name prefix if present
      let relativePath = fileData.path || fileData.name;
      
      // If the path starts with the drive name, remove it to avoid duplication
      // ArDrive paths might look like "/MyMobilePublic/iosFolder/file.txt" but our sync folder is already "MyMobilePublic"
      const driveName = path.basename(this.syncFolderPath!);
      if (relativePath.startsWith(`/${driveName}/`) || relativePath.startsWith(`${driveName}/`)) {
        // Remove the drive name prefix
        relativePath = relativePath.replace(new RegExp(`^/?${driveName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '');
      } else if (relativePath === `/${driveName}` || relativePath === driveName) {
        // If the path is exactly the drive name, treat as root
        relativePath = '';
      }
      
      // Ensure we don't have empty paths or leading slashes
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
      
      const localFilePath = relativePath ? path.join(this.syncFolderPath!, relativePath) : path.join(this.syncFolderPath!, fileData.name);
      
      console.log(`Download paths:`, {
        relativePath,
        localFilePath,
        syncFolderPath: this.syncFolderPath
      });

      // Check if we already have a download record for this file
      const existingDownload = await this.databaseManager.getDownloadByFileId(fileData.fileId);
      
      // Check if file already exists locally
      try {
        const stats = await fs.stat(localFilePath);
        console.log(`Local file exists with size: ${stats.size}, remote size: ${fileData.size}`);
        if (stats.size === fileData.size) {
          console.log(`File already exists with same size, skipping: ${fileData.name}`);
          
          // Update or create download record as completed if not exists
          if (existingDownload) {
            await this.databaseManager.updateDownload(existingDownload.id, {
              status: 'completed',
              progress: 100
            });
          } else {
            await this.databaseManager.addDownload({
              id: crypto.randomUUID(),
              driveId: this.driveId || undefined,
              fileName: fileData.name,
              localPath: localFilePath,
              fileSize: fileData.size,
              fileId: fileData.fileId,
              dataTxId: fileData.dataTxId,
              metadataTxId: fileData.metadataTxId,
              status: 'completed',
              progress: 100
            });
          }
          return;
        }
      } catch (err) {
        console.log(`Local file doesn't exist, proceeding with download: ${fileData.name}`);
      }

      // Create or update download record
      let downloadId: string;
      if (existingDownload) {
        downloadId = existingDownload.id;
        await this.databaseManager.updateDownload(downloadId, {
          status: 'downloading',
          progress: 0,
          error: undefined
        });
      } else {
        downloadId = crypto.randomUUID();
        await this.databaseManager.addDownload({
          id: downloadId,
          driveId: this.driveId || undefined,
          fileName: fileData.name,
          localPath: localFilePath,
          fileSize: fileData.size,
          fileId: fileData.fileId,
          dataTxId: fileData.dataTxId,
          metadataTxId: fileData.metadataTxId,
          status: 'downloading',
          progress: 0
        });
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(localFilePath);
      console.log(`Creating directory: ${dir}`);
      await fs.mkdir(dir, { recursive: true });

      // CRITICAL: Add file to recently downloaded BEFORE downloading
      // This prevents the file watcher from picking it up
      this.fileStateManager.markAsDownloaded(localFilePath);
      
      // Check if this file is already being downloaded
      if (this.fileStateManager.isDownloading(localFilePath)) {
        console.log(`File is already being downloaded: ${localFilePath}`);
        await this.fileStateManager.getDownloadPromise(localFilePath);
        return;
      }
      
      // Create a promise for this download
      const downloadPromise = this.performFileDownload(fileData, localFilePath, dir, downloadId);
      this.fileStateManager.setDownloadPromise(localFilePath, downloadPromise);

      // Pre-register the file in the processed database with a placeholder
      // This ensures that even if the file watcher detects it, it will be marked as processed
      const placeholderHash = `downloading-${fileData.fileId}-${Date.now()}`;
      try {
        await this.databaseManager.addProcessedFile(
          placeholderHash,
          fileData.name,
          fileData.size || 0,
          localFilePath,
          'download',
          fileData.fileId
        );
        console.log(`Pre-registered file with placeholder hash: ${placeholderHash}`);
      } catch (preRegError) {
        console.warn(`Failed to pre-register file:`, preRegError);
      }

      try {
        await downloadPromise;
      } finally {
        // Remove from tracking when done
        this.fileStateManager.clearDownload(localFilePath);
      }
    } catch (error) {
      console.error(`Failed to download file ${file.name}:`, error);
      console.error('Download error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Update download record as failed if we have a downloadId
      const fileData = file as any;
      if (fileData.fileId) {
        try {
          const existingDownload = await this.databaseManager.getDownloadByFileId(fileData.fileId);
          if (existingDownload) {
            await this.databaseManager.updateDownload(existingDownload.id, {
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        } catch (dbError) {
          console.error('Failed to update download record:', dbError);
        }
      }
    }
  }
  
  private async performFileDownload(fileData: any, localFilePath: string, dir: string, downloadId: string): Promise<void> {
    try {
      // Download the file using ArDrive
      console.log(`Starting ArDrive download with params:`, {
        fileId: fileData.fileId,
        destFolderPath: dir,
        defaultFileName: fileData.name
      });

      await this.arDrive!.downloadPublicFile({
        fileId: fileData.fileId,
        destFolderPath: dir,
        defaultFileName: fileData.name
      });

      console.log(`ArDrive download completed for: ${fileData.name}`);
      
      // Verify the file was downloaded
      try {
        const stats = await fs.stat(localFilePath);
        console.log(`Downloaded file stats:`, {
          path: localFilePath,
          size: stats.size,
          exists: true
        });
        
        // Update download record as completed
        await this.databaseManager.updateDownload(downloadId, {
          status: 'completed',
          progress: 100
        });
        
      } catch (verifyError) {
        console.error(`Downloaded file verification failed:`, verifyError);
        
        // Update download record as failed
        await this.databaseManager.updateDownload(downloadId, {
          status: 'failed',
          error: `Downloaded file not found at ${localFilePath}`
        });
        
        throw new Error(`Downloaded file not found at ${localFilePath}`);
      }
      
      // Update the processed files database with the real hash
      const content = await fs.readFile(localFilePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const stats = await fs.stat(localFilePath);
      const fileName = path.basename(localFilePath);
      
      // First remove the placeholder entry
      try {
        // We need to find the placeholder hash to remove it
        const processedFiles = await this.databaseManager.getProcessedFiles();
        const placeholderEntry = processedFiles.find(f => 
          f.fileHash.startsWith('downloading-') && f.localPath === localFilePath
        );
        
        if (placeholderEntry) {
          await this.databaseManager.removeProcessedFile(placeholderEntry.fileHash);
          console.log(`Removed placeholder entry for ${localFilePath}`);
        }
      } catch (deleteError) {
        console.warn(`Failed to remove placeholder entry:`, deleteError);
      }
      
      // First, remove any existing entries for this file (both by hash and path)
      // This ensures we don't have duplicates with different sources
      try {
        const existingEntries = await this.databaseManager.getProcessedFiles();
        const toRemove = existingEntries.filter(f => 
          f.fileHash === hash || f.localPath === localFilePath
        );
        
        for (const entry of toRemove) {
          if (entry.fileHash !== hash || entry.source !== 'download') {
            await this.databaseManager.removeProcessedFile(entry.fileHash);
            console.log(`Removed old entry: hash=${entry.fileHash.substring(0, 16)}..., source=${entry.source}`);
          }
        }
      } catch (cleanupError) {
        console.warn(`Failed to clean up old entries:`, cleanupError);
      }
      
      // Add the real entry with download source
      // Using INSERT OR IGNORE means if there's already an entry, it won't be overwritten
      await this.databaseManager.addProcessedFile(
        hash,
        fileName,
        stats.size,
        localFilePath,
        'download',
        fileData.fileId
      );
      
      // Also check and remove any pending uploads for this file
      try {
        const pendingUploads = await this.databaseManager.getPendingUploads();
        const pendingUpload = pendingUploads.find(u => u.localPath === localFilePath);
        if (pendingUpload) {
          await this.databaseManager.updatePendingUploadStatus(pendingUpload.id, 'rejected');
          console.log(`Removed pending upload for downloaded file: ${fileName}`);
        }
      } catch (pendingError) {
        console.warn(`Failed to check/remove pending uploads:`, pendingError);
      }
      
      console.log(`Updated processed file with real hash:`);
      console.log(`  - File: ${fileData.name}`);
      console.log(`  - Hash: ${hash}`);
      console.log(`  - Size: ${stats.size}`);
      console.log(`  - Source: download`);

      // Keep file in recently downloaded set for extended period
      // (This is now handled automatically by FileStateManager.markAsDownloaded)

      console.log(`Successfully completed download: ${fileData.name}`);
      
      // Ensure database transactions are complete
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`Failed during download process:`, error);
      
      // Update download record as failed
      await this.databaseManager.updateDownload(downloadId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error; // Re-throw to be handled by the outer try-catch
    }
  }

  private async scanExistingFiles() {
    if (!this.syncFolderPath) return;

    console.log('Scanning existing files in:', this.syncFolderPath);
    try {
      await this.scanDirectory(this.syncFolderPath);
      console.log('Finished scanning existing files');
    } catch (error) {
      console.error('Failed to scan existing files:', error);
    }
  }

  private async scanDirectory(dirPath: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    console.log(`Scanning directory: ${dirPath}, found ${entries.length} entries`);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        console.log(`Skipping hidden file/folder: ${entry.name}`);
        continue; // Skip hidden files
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        console.log(`Found directory: ${entry.name}, scanning recursively`);
        await this.scanDirectory(fullPath);
      } else if (entry.isFile()) {
        console.log(`Found file: ${entry.name}, processing...`);
        await this.handleNewFile(fullPath, 'create');
      }
    }
  }

  // Enhanced file event handlers with versioning support
  private async handleFileAdd(filePath: string) {
    console.log(`🎯 handleFileAdd called for: ${filePath}`);
    console.log(`📊 Current sync state: ${this.syncState}`);
    console.log(`🔧 Is active: ${this.isActive}`);
    
    // Skip processing if not in monitoring state
    if (this.syncState !== 'monitoring') {
      console.log(`🚫 Ignoring file add due to sync state: ${filePath} (state: ${this.syncState})`);
      return;
    }

    // Skip processing if we're currently downloading files
    if (this.downloadManager.isDownloadInProgress()) {
      console.log(`Skipping file add event during download: ${filePath}`);
      return;
    }

    // Skip processing if this file was recently downloaded
    if (this.fileStateManager.isRecentlyDownloaded(filePath)) {
      console.log(`Skipping file add event for recently downloaded file: ${filePath}`);
      return;
    }
    
    // Check if this file is currently being downloaded
    if (this.fileStateManager.isDownloading(filePath)) {
      console.log(`Skipping file add event for file being downloaded: ${filePath}`);
      // Wait for download to complete before processing
      await this.fileStateManager.getDownloadPromise(filePath);
      return;
    }

    // Clear any existing timeout for this file
    this.fileStateManager.clearProcessingTimeout(filePath);

    // Debounce file events - wait 500ms before processing
    const timeout = setTimeout(async () => {
      this.fileStateManager.clearProcessingTimeout(filePath);
      
      // Check if file is already being processed
      if (this.fileStateManager.isFileBeingProcessed(filePath)) {
        console.log(`File already being processed, skipping: ${filePath}`);
        return;
      }

      // Mark file as being processed
      this.fileStateManager.markAsProcessing(filePath);
      
      try {
        await this.handleFileWithVersioning(filePath, 'create');
      } finally {
        // Remove from processing set when done
        this.fileStateManager.clearProcessing(filePath);
      }
    }, 500);

    this.fileStateManager.setProcessingTimeout(filePath, timeout);
  }

  private async handleFileChange(filePath: string) {
    // Skip processing if we're currently downloading files
    if (this.downloadManager.isDownloadInProgress()) {
      console.log(`Skipping file change event during download: ${filePath}`);
      return;
    }

    // Clear any existing timeout for this file
    this.fileStateManager.clearProcessingTimeout(filePath);

    // Debounce file events - wait 500ms before processing
    const timeout = setTimeout(async () => {
      this.fileStateManager.clearProcessingTimeout(filePath);
      
      // Check if file is already being processed
      if (this.fileStateManager.isFileBeingProcessed(filePath)) {
        console.log(`File already being processed, skipping: ${filePath}`);
        return;
      }

      // Mark file as being processed
      this.fileStateManager.markAsProcessing(filePath);
      
      try {
        await this.handleFileWithVersioning(filePath, 'update');
      } finally {
        // Remove from processing set when done
        this.fileStateManager.clearProcessing(filePath);
      }
    }, 500);

    this.fileStateManager.setProcessingTimeout(filePath, timeout);
  }

  private async handleFileDelete(filePath: string) {
    console.log(`File delete detected: ${filePath}`);
    
    // Get existing hash if available
    let existingHash: string | undefined;
    let fileInfo: any;
    try {
      fileInfo = await this.databaseManager.getFileByPath(filePath);
      console.log(`File info retrieved for ${filePath}:`, fileInfo ? {
        id: fileInfo.id,
        hasHash: !!fileInfo.fileHash,
        hash: fileInfo.fileHash?.substring(0, 16) + '...',
        fullHash: fileInfo.fileHash,
        arfsFileId: fileInfo.arfsFileId,
        fileSize: fileInfo.fileSize
      } : 'null');
      
      if (fileInfo && fileInfo.fileHash) {
        existingHash = fileInfo.fileHash;
        console.log(`Found existing hash for deleted file: ${fileInfo.fileHash.substring(0, 16)}... (full: ${fileInfo.fileHash})`);
      } else {
        // If not found in uploads/processed_files, try to get from version manager
        const latestVersion = await this.databaseManager.getLatestFileVersion(filePath);
        if (latestVersion && latestVersion.fileHash) {
          existingHash = latestVersion.fileHash;
          console.log(`Found hash from version history: ${latestVersion.fileHash.substring(0, 16)}... (full: ${latestVersion.fileHash})`);
        }
      }
    } catch (error) {
      console.error(`Error getting file info for deleted file ${filePath}:`, error);
    }
    
    // Use the file operation detector. SYNC-5: on a CONFIRMED delete (not a
    // move/rename resolved within the detection window), propagate it as an
    // ArFS hide operation into the approval queue.
    await this.fileOperationDetector.onFileDelete(
      filePath,
      existingHash,
      fileInfo?.arfsFileId,
      (detection) => this.confirmFileDelete(detection)
    );
  }

  // SYNC-5: a confirmed local file delete becomes an ArFS "hide" operation in
  // the approval queue (permanent storage cannot truly delete — D-011).
  private async confirmFileDelete(detection: FileOperationDetection): Promise<void> {
    const filePath = detection.oldPath;
    if (!filePath) return;

    try {
      const arfsFileId = detection.oldArfsFileId;

      // A file that was never uploaded to ArDrive has nothing to hide — it only
      // existed locally. Nothing to propagate.
      if (!arfsFileId) {
        console.log(`Confirmed delete of un-uploaded file, nothing to hide on ArFS: ${filePath}`);
        return;
      }

      // Don't queue a duplicate hide for the same file if one is already pending.
      const existingPending = await this.databaseManager.getPendingUploads();
      const alreadyQueued = existingPending.some(
        (p) => p.operationType === 'hide' && p.arfsFileId === arfsFileId
      );
      if (alreadyQueued) {
        console.log(`Hide operation already pending for file ${arfsFileId}, skipping duplicate`);
        return;
      }

      const mappings = await this.databaseManager.getDriveMappings();
      const activeMapping = mappings.find((m: any) => m.isActive);
      const driveId = activeMapping?.driveId || this.driveId || undefined;

      const hideOperation: Omit<PendingUpload, 'createdAt'> = {
        id: crypto.randomUUID(),
        driveId,
        localPath: filePath,
        fileName: path.basename(filePath),
        fileSize: 0, // metadata-only op; size is irrelevant
        mimeType: 'application/octet-stream',
        // A hide is a metadata-only revision — tiny, well under the Turbo free
        // tier. Honest zero cost (MONEY-6 pattern), no synthetic value.
        estimatedCost: 0,
        estimatedTurboCost: 0,
        recommendedMethod: 'turbo',
        hasSufficientTurboBalance: true,
        conflictType: 'none',
        status: 'awaiting_approval',
        operationType: 'hide',
        previousPath: filePath,
        arfsFileId,
        metadata: {
          isHidden: true
        }
      };

      await this.databaseManager.addPendingUpload(hideOperation);
      this.notifyRenderer('sync:pending-uploads-updated');

      console.log(`Hide operation queued for deleted file: ${path.basename(filePath)} (${arfsFileId})`);
    } catch (error) {
      console.error(`Error creating hide operation for deleted file ${filePath}:`, error);
    }
  }

  private async handleFolderAdd(dirPath: string) {
    try {
      // Skip processing if not in monitoring state
      if (this.syncState !== 'monitoring') {
        console.log(`🚫 Ignoring folder add during sync: ${dirPath}`);
        return;
      }

      if (!this.syncFolderPath || dirPath === this.syncFolderPath) {
        return; // Skip root folder
      }

      const relativePath = this.versionManager.getRelativePath(dirPath);
      const folderName = path.basename(dirPath);
      
      // FIRST: Check if folder exists in ArDrive (drive_metadata_cache)
      const folderInDriveMetadata = await this.databaseManager.checkFolderInDriveMetadata(dirPath);
      if (folderInDriveMetadata) {
        console.log(`Folder already exists in ArDrive: ${relativePath}, syncing to local database`);
        // Sync to folder_structure table if not already there
        const existingFolder = await this.databaseManager.getFolderByPath(dirPath);
        if (!existingFolder) {
          await this.databaseManager.addFolder({
            id: crypto.randomUUID(),
            folderPath: dirPath,
            relativePath: relativePath,
            parentPath: path.dirname(dirPath),
            arfsFolderId: folderInDriveMetadata.fileId
          });
        }
        return; // DO NOT add to upload queue since it already exists in ArDrive
      }
      
      // Check if this folder already exists in our local database
      const existingFolder = await this.databaseManager.getFolderByPath(dirPath);
      if (existingFolder && !existingFolder.isDeleted) {
        console.log(`Folder already exists in database: ${relativePath}, skipping`);
        return; // Folder already tracked, no need to add to queue
      }
      
      // Use the new FolderOperationDetector to detect operations
      const operation = await this.folderOperationDetector.onFolderAdd(dirPath);
      
      if (operation) {
        switch (operation.type) {
          case 'rename':
          case 'move':
          case 'rename_and_move':
            await this.handleFolderOperation(operation);
            return;
          case 'new':
            // Continue with normal new folder handling
            break;
          default:
            console.log(`Unknown operation type: ${operation.type}`);
        }
      }
      
      console.log(`New folder detected: ${relativePath}`);
      
      // Add folder to upload queue instead of creating immediately
      const folderId = crypto.randomUUID();
      const parentPath = path.dirname(dirPath);
      
      // Add to database first (local tracking)
      await this.databaseManager.addFolder({
        id: folderId,
        folderPath: dirPath,
        relativePath,
        parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
        arfsFolderId: undefined // Will be set after upload
      });
      
      // Add to pending uploads table for user approval (NOT to uploadQueue yet)
      const pendingUpload: Omit<PendingUpload, 'createdAt'> = {
        id: folderId,
        driveId: this.driveId || undefined,
        localPath: dirPath,
        fileName: folderName,
        fileSize: 0,
        mimeType: 'folder',
        estimatedCost: this.costCalculator.getFolderCost(),
        status: 'awaiting_approval',
        conflictType: 'none'
      };
      
      await this.databaseManager.addPendingUpload(pendingUpload);
      
      // Notify renderer about new pending folder (don't send uploadQueue since folder isn't in it yet)
      this.notifyRenderer('sync:pending-uploads-updated');
      
      console.log(`Folder added to pending uploads queue: ${relativePath}`);
    } catch (error) {
      console.error(`Error handling folder add for ${dirPath}:`, error);
    }
  }
  
  private async handleFolderOperation(operation: OperationDetection) {
    console.log(`Handling folder operation: ${operation.type}`);
    console.log(`Reason: ${operation.reason}`);
    
    if (!operation.oldPath || !operation.newPath) {
      console.error('Invalid operation: missing paths');
      return;
    }
    
    try {
      const folder = await this.databaseManager.getFolderByPath(operation.oldPath);
      if (!folder) {
        console.warn(`Folder not found in database: ${operation.oldPath}`);
        
        // Check if the old folder exists in drive metadata (might not be tracked locally)
        const oldFolderInDrive = await this.databaseManager.checkFolderInDriveMetadata(operation.oldPath);
        if (oldFolderInDrive && operation.oldArweaveFolderId) {
          console.log(`Folder exists in ArDrive but not tracked locally, syncing and executing operation`);
          
          // Create a temporary folder entry to execute the operation
          const tempFolder = {
            id: crypto.randomUUID(),
            arfsFolderId: operation.oldArweaveFolderId
          };
          
          // Execute the ArDrive operation
          if (this.arDrive && this.driveId) {
            switch (operation.type) {
              case 'rename':
                await this.executeFolderRename(tempFolder.arfsFolderId, operation.oldPath, operation.newPath);
                break;
              case 'move':
                await this.executeFolderMove(tempFolder.arfsFolderId, operation.oldPath, operation.newPath);
                break;
              case 'rename_and_move':
                await this.executeFolderMove(tempFolder.arfsFolderId, operation.oldPath, operation.newPath);
                await this.executeFolderRename(tempFolder.arfsFolderId, operation.oldPath, operation.newPath);
                break;
            }
          }
          
          // Add the folder to local tracking with new path
          await this.databaseManager.addFolder({
            id: tempFolder.id,
            folderPath: operation.newPath,
            relativePath: this.versionManager.getRelativePath(operation.newPath),
            parentPath: path.dirname(operation.newPath),
            arfsFolderId: tempFolder.arfsFolderId
          });
          
          return;
        }
        
        // The folder might not be tracked yet, handle as new folder
        await this.handleNewFolder(operation.newPath!);
        return;
      }
      
      // Update local database first
      await this.databaseManager.updateFolderPath(folder.id, operation.newPath);
      
      // If folder has been synced to ArDrive, execute the operation there
      if (folder.arfsFolderId && this.arDrive && this.driveId) {
        switch (operation.type) {
          case 'rename':
            await this.executeFolderRename(folder.arfsFolderId, operation.oldPath, operation.newPath);
            break;
          case 'move':
            await this.executeFolderMove(folder.arfsFolderId, operation.oldPath, operation.newPath);
            break;
          case 'rename_and_move':
            // Execute as two operations: move first, then rename
            await this.executeFolderMove(folder.arfsFolderId, operation.oldPath, operation.newPath);
            await this.executeFolderRename(folder.arfsFolderId, operation.oldPath, operation.newPath);
            break;
        }
      } else if (!folder.arfsFolderId) {
        console.log(`Folder not yet synced to ArDrive, only updating local database`);
      }
      
      // Update all child paths in the database
      await this.updateChildPaths(operation.oldPath, operation.newPath);
      
      console.log(`Successfully handled ${operation.type} operation: ${operation.oldPath} -> ${operation.newPath}`);
    } catch (error) {
      console.error(`Error handling folder operation:`, error);
      // TODO: Add to operation queue for retry
    }
  }
  
  private async executeFolderRename(arfsFolderId: string, oldPath: string, newPath: string) {
    if (!this.arDrive) {
      throw new Error('ArDrive not initialized');
    }
    
    const newName = path.basename(newPath);
    console.log(`Renaming folder on ArDrive: ${path.basename(oldPath)} -> ${newName}`);

    try {
      // PRIV-8: fail closed — renamePublicFolder has no private counterpart
      // wired here; a private (or unresolved) drive must not leak the folder's
      // new name as a public plaintext revision (and spend). Block instead.
      await this.assertPublicMoveRenameOrThrow(this.driveId, `folder "${path.basename(oldPath)}"`);

      const result = await this.arDrive.renamePublicFolder({
        folderId: EID(arfsFolderId),
        newName: newName
      });
      
      console.log(`ArDrive folder rename successful:`, result);
      
      // Update operation history in database
      await this.databaseManager.addFolderOperation({
        id: crypto.randomUUID(),
        operationType: 'rename',
        oldPath: oldPath,
        newPath: newPath,
        arfsFolderId: arfsFolderId,
        status: 'completed',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Failed to rename folder on ArDrive:`, error);
      // Add to operation history as failed
      await this.databaseManager.addFolderOperation({
        id: crypto.randomUUID(),
        operationType: 'rename',
        oldPath: oldPath,
        newPath: newPath,
        arfsFolderId: arfsFolderId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        createdAt: new Date().toISOString()
      });
      throw error;
    }
  }
  
  private async executeFolderMove(arfsFolderId: string, oldPath: string, newPath: string) {
    if (!this.arDrive) {
      throw new Error('ArDrive not initialized');
    }
    
    const newParentPath = path.dirname(newPath);
    console.log(`Moving folder on ArDrive from ${path.dirname(oldPath)} to ${newParentPath}`);
    
    try {
      // PRIV-8: fail closed — movePublicFolder has no private counterpart wired
      // here; a private (or unresolved) drive must not leak the folder's new
      // location as a public plaintext revision (and spend). Block instead.
      await this.assertPublicMoveRenameOrThrow(this.driveId, `folder "${path.basename(oldPath)}"`);

      // Get the new parent folder's ArDrive ID
      const newParentFolder = await this.databaseManager.getFolderByPath(newParentPath);
      if (!newParentFolder || !newParentFolder.arfsFolderId) {
        throw new Error(`New parent folder not found or not synced: ${newParentPath}`);
      }

      const result = await this.arDrive.movePublicFolder({
        folderId: EID(arfsFolderId),
        newParentFolderId: EID(newParentFolder.arfsFolderId)
      });
      
      console.log(`ArDrive folder move successful:`, result);
      
      // Update operation history in database
      await this.databaseManager.addFolderOperation({
        id: crypto.randomUUID(),
        operationType: 'move',
        oldPath: oldPath,
        newPath: newPath,
        arfsFolderId: arfsFolderId,
        status: 'completed',
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Failed to move folder on ArDrive:`, error);
      // Add to operation history as failed
      await this.databaseManager.addFolderOperation({
        id: crypto.randomUUID(),
        operationType: 'move',
        oldPath: oldPath,
        newPath: newPath,
        arfsFolderId: arfsFolderId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        createdAt: new Date().toISOString()
      });
      throw error;
    }
  }
  
  private async updateChildPaths(oldParentPath: string, newParentPath: string) {
    // Update all child folders
    const childFolders = await this.databaseManager.getChildFolders(oldParentPath);
    for (const childFolder of childFolders) {
      const oldChildPath = childFolder.folderPath;
      const newChildPath = oldChildPath.replace(oldParentPath, newParentPath);
      await this.databaseManager.updateFolderPath(childFolder.id, newChildPath);
    }
    
    // Update all child files
    const childFiles = await this.databaseManager.getChildFiles(oldParentPath);
    for (const childFile of childFiles) {
      const oldFilePath = childFile.localPath;
      const newFilePath = oldFilePath.replace(oldParentPath, newParentPath);
      await this.databaseManager.updateFilePath(childFile.id, newFilePath);
    }
  }
  
  private async handleNewFolder(folderPath: string) {
    // Extract the existing logic from handleFolderAdd for new folders
    const relativePath = this.versionManager.getRelativePath(folderPath);
    const folderName = path.basename(folderPath);
    const folderId = crypto.randomUUID();
    const parentPath = path.dirname(folderPath);
    
    // Add to database first (local tracking)
    await this.databaseManager.addFolder({
      id: folderId,
      folderPath: folderPath,
      relativePath,
      parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
      arfsFolderId: undefined // Will be set after upload
    });
    
    // Add to pending uploads table for user approval
    const pendingUpload: Omit<PendingUpload, 'createdAt'> = {
      id: folderId,
      driveId: this.driveId || undefined,
      localPath: folderPath,
      fileName: folderName,
      fileSize: 0,
      mimeType: 'folder',
      estimatedCost: this.costCalculator.getFolderCost(),
      status: 'awaiting_approval',
      conflictType: 'none'
    };
    
    await this.databaseManager.addPendingUpload(pendingUpload);
    
    // Notify renderer about new pending folder
    this.notifyRenderer('sync:pending-uploads-updated');
    
    console.log(`Folder added to pending uploads queue: ${relativePath}`);
  }
  
  // Keep the old method for backward compatibility but deprecated
  private async handleFolderRename(oldPath: string, newPath: string) {
    console.warn('handleFolderRename is deprecated, use handleFolderOperation instead');
    const operation: OperationDetection = {
      type: 'rename',
      oldPath,
      newPath,
      reason: 'Direct call to deprecated method'
    };
    await this.handleFolderOperation(operation);
  }

  private async handleFolderDelete(dirPath: string) {
    try {
      // Get the folder's ArDrive ID before it's deleted
      const folder = await this.databaseManager.getFolderByPath(dirPath);
      const arfsFolderId = folder?.arfsFolderId;
      
      // Notify the detector about the deletion with a callback to confirm the delete
      await this.folderOperationDetector.onFolderDelete(
        dirPath,
        arfsFolderId,
        async () => {
          await this.confirmFolderDelete(dirPath, arfsFolderId);
        }
      );

    } catch (error) {
      console.error(`Error handling folder delete for ${dirPath}:`, error);
    }
  }

  private async confirmFolderDelete(dirPath: string, arfsFolderId?: string) {
    try {
      // SYNC-5: a confirmed local folder delete propagates as an ArFS "hide"
      // operation on the folder entity (permanent storage cannot delete —
      // D-011). No cascade: only the folder entity is hidden; the caller/UI
      // treats descendants as effectively hidden. Only queue if the folder was
      // actually uploaded to ArDrive (has an ArFS folder id).
      if (arfsFolderId) {
        const existingPending = await this.databaseManager.getPendingUploads();
        const alreadyQueued = existingPending.some(
          (p) => p.operationType === 'hide' && p.arfsFolderId === arfsFolderId
        );

        if (!alreadyQueued) {
          const mappings = await this.databaseManager.getDriveMappings();
          const activeMapping = mappings.find((m: any) => m.isActive);
          const driveId = activeMapping?.driveId || this.driveId || undefined;

          const hideOperation: Omit<PendingUpload, 'createdAt'> = {
            id: crypto.randomUUID(),
            driveId,
            localPath: dirPath,
            fileName: path.basename(dirPath),
            fileSize: 0,
            mimeType: 'folder',
            estimatedCost: 0,
            estimatedTurboCost: 0,
            recommendedMethod: 'turbo',
            hasSufficientTurboBalance: true,
            conflictType: 'none',
            status: 'awaiting_approval',
            operationType: 'hide',
            previousPath: dirPath,
            arfsFolderId,
            metadata: {
              isHidden: true
            }
          };

          await this.databaseManager.addPendingUpload(hideOperation);
          this.notifyRenderer('sync:pending-uploads-updated');
          console.log(`Hide operation queued for deleted folder: ${path.basename(dirPath)} (${arfsFolderId})`);
        } else {
          console.log(`Hide operation already pending for folder ${arfsFolderId}, skipping duplicate`);
        }
      } else {
        console.log(`Confirmed delete of un-uploaded folder, nothing to hide on ArFS: ${dirPath}`);
      }

      await this.databaseManager.markFolderDeleted(dirPath);
      console.log(`Marked folder as deleted: ${dirPath}`);
    } catch (error) {
      console.error(`Error handling folder delete for ${dirPath}:`, error);
    }
  }

  private async handleFileWithVersioning(filePath: string, _expectedChange: ChangeType) {
    try {
      // Use the file operation detector
      const fileHash = await this.calculateFileHash(filePath);
      const operation = await this.fileOperationDetector.onFileAdd(filePath, fileHash);
      
      if (operation && operation.type !== 'new') {
        console.log(`File operation detected: ${operation.type}`);
        console.log(`Reason: ${operation.reason}`);
        
        if (operation.type === 'move' || operation.type === 'rename') {
          if (operation.oldPath) {
            // Create file info object with the arfsFileId from the operation
            const fileInfo = operation.oldArfsFileId ? {
              arfsFileId: operation.oldArfsFileId
            } : undefined;
            
            await this.handleFileMove(operation.oldPath, filePath, fileHash, fileInfo);
            return;
          }
        } else if (operation.type === 'copy') {
          console.log(`Copy operation detected from ${operation.oldPath} to ${filePath}`);
          // Handle as new file for now
        }
      }

      // Not a move - detect actual change type
      const actualChange = await this.versionManager.detectFileChange(filePath);
      
      if (actualChange === 'unchanged') {
        console.log(`File unchanged, skipping: ${filePath}`);
        return;
      }

      console.log(`Processing file ${actualChange}: ${filePath}`);
      await this.handleNewFile(filePath, actualChange);
      
    } catch (error) {
      console.error(`Error handling file with versioning for ${filePath}:`, error);
    }
  }

  /**
   * FEAT-6: Resolve the drive_mappings.id for the drive currently being synced.
   * file_versions rows MUST carry this real id so getFileVersions (which scopes
   * rows to `mappingId IN (SELECT id FROM drive_mappings)` for the active
   * profile) returns them, and so a version stays isolated to its own
   * drive/profile — a version written under drive A's mappingId can never
   * surface under drive B. Prefers the mapping for the driveId being synced
   * (this.driveId, matching the SYNC-28 back-fill's driveId lookup), falling
   * back to the single active mapping. Returns undefined only if no mapping is
   * resolvable (in which case the row keeps a NULL mappingId — acceptable
   * degradation: the version just won't appear in history, same as today).
   */
  private async resolveActiveMappingId(): Promise<string | undefined> {
    try {
      const mappings = await this.databaseManager.getDriveMappings();
      const mapping =
        mappings.find((m) => m.driveId === this.driveId && m.isActive) ??
        mappings.find((m) => m.driveId === this.driveId) ??
        mappings.find((m) => m.isActive);
      return mapping?.id;
    } catch (error) {
      console.error('FEAT-6: failed to resolve mappingId for versioning:', error);
      return undefined;
    }
  }

  private async handleNewFile(filePath: string, changeType: ChangeType = 'create') {
    console.log(`Processing new file: ${filePath}`);
    
    // FIRST CHECK: Skip if file is being downloaded or was recently downloaded
    if (this.fileStateManager.isDownloading(filePath)) {
      console.log(`✓ File is currently being downloaded, skipping: ${filePath}`);
      return;
    }
    
    if (this.fileStateManager.isRecentlyDownloaded(filePath)) {
      console.log(`✓ File was recently downloaded, skipping: ${filePath}`);
      return;
    }
    
    try {
      // Verify file still exists (might have been a temporary file during download)
      try {
        await fs.access(filePath);
      } catch (accessError) {
        console.log(`File no longer exists, skipping: ${filePath}`);
        return;
      }
      
      const stats = await fs.stat(filePath);
      console.log(`File stats: size=${stats.size} bytes`);
      
      // Skip files larger than 100MB for MVP
      if (this.costCalculator.isFileTooBig(stats.size)) {
        console.log(`Skipping large file: ${filePath} (${stats.size} bytes)`);
        return;
      }

      // Check if we've already processed this file
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const fileName = path.basename(filePath);

      console.log(`File hash check for ${fileName}:`);
      console.log(`  - Generated hash: ${hash.substring(0, 16)}... (full: ${hash})`);
      console.log(`  - File size: ${stats.size}`);
      console.log(`  - File path: ${filePath}`);
      
      // SYNC-1: dedup must distinguish IDENTICAL content (hash match — skip)
      // from an EDIT (same path, different hash — must re-upload as a new
      // ArFS revision). The old `hash OR path` matching made every edited
      // file look "already uploaded/downloaded" and dead-ended it.
      const processedFiles = await this.databaseManager.getProcessedFiles();
      const matchingFiles = processedFiles.filter(f => f.fileHash === hash || f.localPath === filePath);
      
      const hashMatches = matchingFiles.filter(f => f.fileHash === hash);
      const hasPlaceholder = matchingFiles.some(f => f.fileHash.startsWith('downloading-'));
      const pathOnlyMatches = matchingFiles.filter(
        f => f.localPath === filePath && f.fileHash !== hash && !f.fileHash.startsWith('downloading-')
      );
      const isEdit = pathOnlyMatches.length > 0 && hashMatches.length === 0;
      
      console.log(`  - Identical-content matches: ${hashMatches.length}`);
      console.log(`  - Path-only (edited) matches: ${pathOnlyMatches.length}`);
      console.log(`  - Has placeholder: ${hasPlaceholder}`);
      console.log(`  - Is edit: ${isEdit}`);
      
      // Mid-download placeholder — not a user file event
      if (hasPlaceholder) {
        console.log(`✓ File has an active download placeholder, skipping: ${filePath}`);
        return;
      }
      
      // Identical content already known (uploaded before, or downloaded from
      // Arweave) — nothing to do
      if (hashMatches.length > 0) {
        const origin = hashMatches.some(f => f.source === 'download') ? 'downloaded from Arweave' : 'already uploaded';
        console.log(`✓ Identical content ${origin}, skipping: ${filePath}`);
        return;
      }
      
      // SYNC-26: when this is an edit of a file already on-chain, resolve the
      // EXISTING ArFS fileId so the upload can be threaded as a REVISION (same
      // fileId, new dataTx + metadata) rather than minting an unrelated new file
      // entity. We resolve it HERE — before the new-content processed_files row
      // is written below — because getFileByPath returns the newest record for
      // the path, and after that write the newest record would be this edit
      // (with no fileId yet). If no valid recorded fileId exists (e.g. the
      // original upload never completed), we leave it undefined and fall back to
      // a normal new upload.
      let existingArfsFileId: string | undefined;
      if (isEdit) {
        console.log(`✏️ Edited file detected (known path, new content) — queueing as a new revision: ${filePath}`);
        try {
          const existingRecord = await this.databaseManager.getFileByPath(filePath);
          const candidateFileId = existingRecord?.arfsFileId || existingRecord?.arweaveId;
          if (isValidArfsFileId(candidateFileId)) {
            existingArfsFileId = candidateFileId;
            console.log(`  - Threading existing ArFS fileId for revision: ${existingArfsFileId}`);
          } else {
            console.log(`  - No valid recorded fileId for ${fileName} — will upload as a new file (fallback)`);
          }
        } catch (lookupError) {
          console.warn(`  - Could not resolve existing fileId for edit, uploading as new file:`, lookupError);
        }
      }

      // Double check if this file was recently downloaded. SYNC-13: pass the
      // actual on-disk size (already read above) so a coincidental unrelated
      // write to this exact path while a download is in flight - different
      // size than what the download expects - is NOT suppressed.
      if (this.fileStateManager.isRecentlyDownloaded(filePath, stats.size)) {
        console.log(`✓ File was recently downloaded, skipping: ${filePath}`);
        return;
      }

      // Check if there's already a pending upload for this exact file path
      const pendingUploads = await this.databaseManager.getPendingUploads();
      const existingPending = pendingUploads.find(u => 
        u.localPath === filePath && u.status === 'awaiting_approval'
      );
      
      if (existingPending) {
        console.log(`✓ File already in pending queue, skipping: ${filePath}`);
        return;
      }

      console.log(`Adding new file to PENDING APPROVAL queue: ${path.basename(filePath)}`);
      
      // Ensure the parent folder is tracked in the database
      const fileDir = path.dirname(filePath);
      if (fileDir !== this.syncFolderPath) {
        console.log(`🔍 Checking parent folder for file: ${filePath}`);
        console.log(`  - File directory: ${fileDir}`);
        console.log(`  - Sync folder path: ${this.syncFolderPath}`);
        
        // First check the drive_metadata_cache table for the folder
        const folderInDriveMetadata = await this.databaseManager.checkFolderInDriveMetadata(fileDir);
        console.log(`  - Drive metadata check result:`, folderInDriveMetadata ? {
          fileId: folderInDriveMetadata.fileId,
          name: folderInDriveMetadata.name,
          type: folderInDriveMetadata.type,
          localPath: folderInDriveMetadata.localPath
        } : 'null');
        
        if (folderInDriveMetadata) {
          console.log(`  - ✅ Parent folder exists in drive metadata: ${fileDir}`);
          // Folder exists in drive metadata, sync it to folder_structure table if needed
          const folder = await this.databaseManager.getFolderByPath(fileDir);
          if (!folder) {
            console.log(`  - Syncing folder from drive metadata to local folder structure`);
            await this.databaseManager.addFolder({
              id: crypto.randomUUID(),
              folderPath: fileDir,
              relativePath: this.versionManager.getRelativePath(fileDir),
              parentPath: path.dirname(fileDir),
              arfsFolderId: folderInDriveMetadata.fileId
            });
          }
          // DO NOT call handleFolderAdd since folder already exists in ArDrive
        } else {
          // Fallback to checking the folder_structure table
          const folder = await this.databaseManager.getFolderByPath(fileDir);
          console.log(`  - Folder structure lookup result for "${fileDir}":`, folder ? {
            id: folder.id,
            folderPath: folder.folderPath,
            isDeleted: folder.isDeleted,
            arfsFolderId: folder.arfsFolderId
          } : 'null');
          
          if (!folder) {
            console.log(`  - ❌ Parent folder not tracked in either table, adding: ${fileDir}`);
            // Add the folder to the database (without Arweave ID for now)
            await this.handleFolderAdd(fileDir);
          } else {
            console.log(`  - ✅ Parent folder already exists in folder structure: ${fileDir}, skipping handleFolderAdd`);
          }
        }
      }
      
      // Calculate estimated costs for both AR and Turbo
      const costs = await this.costCalculator.calculateUploadCosts(stats.size);
      const { estimatedCost, estimatedTurboCost, recommendedMethod, hasSufficientTurboBalance } = costs;
      
      // TODO: Add conflict detection logic here
      const conflictType = 'none'; // For now, assume no conflicts
      const conflictDetails = undefined;
      
      // CRITICAL: Check if this exact CONTENT was previously downloaded BEFORE
      // adding to pending uploads. SYNC-1: match by hash only — a path match
      // with different content is an edit of a downloaded file and MUST
      // re-upload.
      const allProcessedFiles = await this.databaseManager.getProcessedFiles();
      const downloadEntry = allProcessedFiles.find(f => 
        f.fileHash === hash && f.source === 'download'
      );
      
      if (downloadEntry) {
        console.log(`✓ Identical content was downloaded from Arweave, not adding to upload queue: ${filePath}`);
        console.log(`  - Download entry: hash=${downloadEntry.fileHash.substring(0, 16)}..., source=${downloadEntry.source}`);
        return; // Don't add downloaded files to upload queue
      }

      // ADDITIONAL SAFETY CHECK: Also check the downloads table directly.
      // SYNC-1: only when this is NOT an edit — the downloads table has no
      // content hash, and an edited file's content no longer matches what was
      // downloaded to that path.
      const downloads = await this.databaseManager.getDownloads();
      const downloadRecord = isEdit ? undefined : downloads.find(d => 
        d.localPath === filePath && 
        (d.status === 'downloading' || d.status === 'completed')
      );
      
      if (downloadRecord) {
        console.log(`✓ File found in downloads table, not adding to upload queue: ${filePath}`);
        console.log(`  - Download status: ${downloadRecord.status}, fileId: ${downloadRecord.fileId}`);
        
        // Also add to processed files if not already there
        if (!downloadEntry) {
          await this.databaseManager.addProcessedFile(
            hash,
            fileName,
            stats.size,
            filePath,
            'download',
            downloadRecord.fileId
          );
          console.log(`  - Added to processed files with source: download`);
        }
        
        return; // Don't add downloaded files to upload queue
      }

      // Now that we've confirmed it's not a downloaded file, create the pending upload
      const pendingUpload: Omit<PendingUpload, 'createdAt'> = {
        id: crypto.randomUUID(),
        driveId: this.driveId || undefined,
        localPath: filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        estimatedCost,
        estimatedTurboCost: estimatedTurboCost ?? undefined, // MONEY-6: a legit 0 quote (free) must not coerce to 'estimate unavailable'
        recommendedMethod,
        hasSufficientTurboBalance,
        conflictType,
        conflictDetails,
        status: 'awaiting_approval',
        // SYNC-26: revision target (the on-chain fileId being edited). Undefined
        // for genuinely new files. operationType stays a normal 'upload', so this
        // does NOT route through the metadata-op path — it is a real data upload
        // that reuses the fileId.
        arfsFileId: existingArfsFileId
      };

      // Before adding the file, ensure all parent folders are in the queue
      await this.ensureParentFoldersInQueue(filePath);

      await this.databaseManager.addPendingUpload(pendingUpload);

      // UX-29: this file is a real cost-bearing upload candidate (it has a
      // cost estimate, unlike the free metadata-only hide/rename/move pending
      // ops elsewhere in this file) and just landed on the approval queue —
      // let the user know without requiring the app window to be open.
      try {
        const stillPending = await this.databaseManager.getPendingUploads();
        notificationService.notifyApprovalNeeded(stillPending.length);
      } catch (notifyError) {
        console.error('Failed to notify approval-needed:', notifyError);
      }

      // Create file version (without upload info yet, will be updated after upload).
      // FEAT-6: scope the version to the drive being synced so getFileVersions
      // (which filters `mappingId IN (SELECT id FROM drive_mappings)`) returns it
      // — a NULL mappingId here makes the whole history UI silently empty.
      const versionMappingId = await this.resolveActiveMappingId();
      await this.versionManager.createNewVersion(filePath, changeType, undefined, versionMappingId);
      
      // Register this exact content in processed_files unless it's already
      // known (avoids duplicate entries; for edits this records the NEW hash
      // so watcher event storms don't re-queue the same revision)
      if (hashMatches.length === 0 && !downloadEntry) {
        await this.databaseManager.addProcessedFile(
          hash,
          fileName,
          stats.size,
          filePath,
          'upload'
        );
        console.log(`Added file to processed database with source: upload`);
      }
      
      // Simple cost formatting (already in AR)
      const costInAR = this.costCalculator.formatCostInAR(estimatedCost);
      const turboCostDisplay = estimatedTurboCost ? this.costCalculator.formatCostInAR(estimatedTurboCost) : 'N/A';
      console.log(`File added to pending approval queue: ${pendingUpload.fileName} (AR Cost: ${costInAR} AR, Turbo Cost: ${turboCostDisplay} AR, Change: ${changeType})`);

    } catch (error) {
      console.error(`Failed to handle new file ${filePath}:`, error);
    }
  }

  // REMOVED: processUploadQueue and sortUploadsForProcessing - replaced by UploadQueueManager
  
  private async ensureParentFoldersInQueue(filePath: string): Promise<void> {
    if (!this.syncFolderPath) return;
    
    const fileDir = path.dirname(filePath);
    
    // If the file is directly in the sync folder, no parent folders needed
    if (fileDir === this.syncFolderPath) return;
    
    // Get all parent directories from the file's directory up to the sync folder
    const dirsToCheck: string[] = [];
    let currentDir = fileDir;
    
    while (currentDir !== this.syncFolderPath && currentDir.startsWith(this.syncFolderPath)) {
      dirsToCheck.unshift(currentDir); // Add to beginning to maintain parent->child order
      currentDir = path.dirname(currentDir);
    }
    
    console.log(`Checking parent folders for ${filePath}:`, dirsToCheck.length > 0 ? dirsToCheck : 'None (file in root)');
    
    // Check each directory and add to pending uploads if needed
    for (const dirPath of dirsToCheck) {
      try {
        // Check if folder exists in our database AND has been uploaded to Arweave
        const existingFolder = await this.databaseManager.getFolderByPath(dirPath);
        const isAlreadyOnArweave = existingFolder && existingFolder.arfsFolderId;
        
        // Check if folder exists in drive metadata cache (another way to verify it's on Arweave)
        const inDriveMetadata = await this.databaseManager.checkFolderInDriveMetadata(dirPath);
        
        // Check if it's already in pending uploads
        const pendingUploads = await this.databaseManager.getPendingUploads();
        const alreadyPending = pendingUploads.some(u => u.localPath === dirPath);
        
        // Only add to queue if:
        // 1. Not already uploaded to Arweave
        // 2. Not already in pending uploads
        if (!isAlreadyOnArweave && !inDriveMetadata && !alreadyPending) {
          console.log(`Adding parent folder to queue: ${dirPath}`);
          
          const folderName = path.basename(dirPath) + '/';
          const relativePath = this.versionManager.getRelativePath(dirPath);
          
          // Add folder to database first (local tracking)
          const folderId = crypto.randomUUID();
          await this.databaseManager.addFolder({
            id: folderId,
            folderPath: dirPath,
            relativePath,
            parentPath: path.dirname(dirPath) !== this.syncFolderPath ? path.dirname(dirPath) : undefined,
            arfsFolderId: undefined // Will be set after upload
          });
          
          // Add to pending uploads
          const pendingUpload: Omit<PendingUpload, 'createdAt'> = {
            id: folderId,
            driveId: this.driveId || undefined,
            localPath: dirPath,
            fileName: folderName,
            fileSize: 0,
            mimeType: 'folder',
            estimatedCost: this.costCalculator.getFolderCost(),
            status: 'awaiting_approval',
            conflictType: 'none'
          };
          
          await this.databaseManager.addPendingUpload(pendingUpload);
          console.log(`Parent folder added to pending uploads: ${relativePath}`);
        } else {
          // Log why we're skipping this folder
          if (isAlreadyOnArweave) {
            console.log(`Skipping folder ${dirPath} - already uploaded to Arweave (ID: ${existingFolder?.arfsFolderId})`);
          } else if (inDriveMetadata) {
            console.log(`Skipping folder ${dirPath} - exists in drive metadata`);
          } else if (alreadyPending) {
            console.log(`Skipping folder ${dirPath} - already in pending uploads`);
          }
        }
      } catch (error) {
        console.error(`Error checking/adding parent folder ${dirPath}:`, error);
      }
    }
  }

  private async uploadFile(upload: FileUpload) {
    const isFolder = upload.fileSize === 0 && upload.localPath.endsWith(upload.fileName);
    const itemName = upload.fileName;
    console.log(`Starting upload for ${isFolder ? 'folder' : 'file'}: ${itemName} using method: ${upload.uploadMethod || 'ar'}`);
    
    if (!this.arDrive || !this.rootFolderId) {
      console.error('Cannot upload: ArDrive or rootFolderId not available');
      return;
    }

    try {
      // MONEY-10: re-validate the file's size against what the user approved
      // BEFORE any upload work (before we even mark it 'uploading' or wrap it).
      // An upload is approved at a specific size (the cost the user OK'd was
      // computed from it); the file can change on disk between approval and now.
      // If it grew/shrank — or is gone — do NOT upload at the new size: re-queue
      // for approval, or cancel cleanly. Folders are metadata-only (size 0) and
      // are exempt. Returns true when handled here (nothing more to upload).
      if (!isFolder && (await this.revalidateApprovedFileSize(upload))) {
        return;
      }

      // Update status to uploading
      console.log(`Setting upload status to 'uploading' for ${itemName}`);
      upload.status = 'uploading';
      await this.databaseManager.updateUpload(upload.id, { status: 'uploading' });
      
      // Emit uploading progress event
      this.emitUploadProgress(upload.id, 0, 'uploading');

      // Use ArDrive Core for both files AND folders
      await this.uploadFileWithArDriveCore(upload);

      // Emit completion event — unless a MONEY-10 wrap-adjacent size mismatch
      // re-queued this item for approval (status 'pending'). A re-queued upload
      // was never uploaded and must not be painted 'completed'. (Only the new
      // TOCTOU re-queue leaves status === 'pending' here; success => 'completed',
      // cancellation => 'failed', both of which still emit as before.)
      // (Cast widens the flow-narrowed 'uploading' literal back to the full union —
      // uploadFileWithArDriveCore mutates upload.status through the reference.)
      if ((upload.status as FileUpload['status']) !== 'pending') {
        this.emitUploadProgress(upload.id, 100, 'completed');
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      // MONEY-2: a pending cancellation resolves here — whether the throw was
      // our own sentinel (spend loop stopped) or a genuine failure, the
      // outcome for the user is a cancelled/failed upload with no further
      // spend, and the cancellation request must not leak (a leaked request
      // blocks retry forever — qa-gate finding).
      if (message === SyncManager.UPLOAD_CANCELLED_SENTINEL ||
          this.uploadQueueManager.isCancellationRequested(upload.id)) {
        if (await this.finalizeCancelledUpload(upload)) {
          return;
        }
      }
      
      console.error(`Failed to upload ${upload.fileName}:`, error);
      
      upload.status = 'failed';
      upload.error = message;

      await this.databaseManager.updateUpload(upload.id, {
        status: 'failed',
        error: upload.error
      });
      
      // Emit failure event
      this.emitUploadProgress(upload.id, 0, 'failed', upload.error);
    }
  }

  /**
   * SYNC-26: thread an existing on-chain ArFS fileId onto a wrapped file so
   * ardrive-core-js uploads it as a REVISION of that same file (reuses the
   * fileId; new dataTx + metadata) instead of minting a new file entity.
   * No-op when the upload is not an edit (no recorded fileId) or the recorded
   * id is not a valid ArFS entity id — in which case the file uploads as a new
   * entity (the fallback for files whose original upload never completed).
   */
  private applyRevisionFileId(
    wrappedFile: { existingId?: unknown },
    upload: FileUpload
  ): void {
    if (!isValidArfsFileId(upload.existingArfsFileId)) {
      return;
    }
    wrappedFile.existingId = EID(upload.existingArfsFileId);
    console.log(
      `SYNC-26: uploading "${upload.fileName}" as a REVISION of existing fileId ${upload.existingArfsFileId}`
    );
  }

  private async uploadFileWithArDriveCore(upload: FileUpload) {
    const isFolder = upload.fileSize === 0 && upload.localPath.endsWith(upload.fileName);
    const itemName = upload.fileName;
    console.log(`Uploading ${itemName} with ArDrive Core (method: ${upload.uploadMethod || 'ar'})`);
    
    // MONEY-2: spend checkpoint — nothing paid has happened yet
    if (await this.finalizeCancelledUpload(upload)) {
      return;
    }
    
    try {
      if (isFolder) {
        // For folders, we need to create the folder on Arweave
        const parentPath = path.dirname(upload.localPath);
        let parentFolderId = this.rootFolderId;
        
        // Find parent folder ID for nested folders
        if (parentPath !== this.syncFolderPath) {
          const parentFolder = await this.databaseManager.getFolderByPath(parentPath);
          if (parentFolder?.arfsFolderId) {
            parentFolderId = parentFolder.arfsFolderId;
          }
        }
        
        console.log(`Creating folder "${itemName}" in parent folder: ${parentFolderId}`);
        
        // Check if folder already exists on Arweave
        const existingFolder = await this.databaseManager.getFolderByPath(upload.localPath);
        if (existingFolder?.arfsFolderId) {
          console.log(`Folder already exists on Arweave with ID: ${existingFolder.arfsFolderId}`);
          // MONEY-2: nothing was spent — a pending cancellation wins here
          if (await this.finalizeCancelledUpload(upload)) {
            return;
          }
          // Mark upload as completed
          upload.status = 'completed';
          await this.databaseManager.updateUpload(upload.id, { 
            status: 'completed',
            completedAt: new Date()
          });
          return;
        }
        
        // Get drive mapping to check privacy
        const mappings = await this.databaseManager.getDriveMappings();
        const mapping = mappings.find(m => m.driveId === this.driveId);
        // PRIV-8: fail closed — an unresolved mapping must NOT default to the
        // public path (would create an unencrypted public folder for a private
        // drive AND spend).
        const isPrivateDrive =
          resolveDrivePrivacyOrThrow(mapping, this.driveId, `folder "${itemName}"`) === 'private';

        // MONEY-2: last spend checkpoint before the paid folder creation
        if (await this.finalizeCancelledUpload(upload)) {
          return;
        }
        
        let result;
        if (isPrivateDrive) {
          const driveKey = driveKeyManager.getDriveKey(this.driveId!);
          if (!driveKey) {
            throw new Error('Private drive is locked - cannot create folder');
          }
          result = await this.arDrive!.createPrivateFolder({
            parentFolderId: EID(parentFolderId!),
            folderName: itemName,
            driveKey: driveKey
          });
        } else {
          result = await this.arDrive!.createPublicFolder({
            parentFolderId: EID(parentFolderId!),
            folderName: itemName
          });
        }
        
        if (result.created && result.created.length > 0) {
          const createdFolder = result.created[0];
          if (createdFolder.type === 'folder' && createdFolder.entityId) {
            const arfsFolderId = createdFolder.entityId.toString();
            console.log(`✓ Folder created on Arweave with ID: ${arfsFolderId}`);
            
            // Update the folder in database with the Arweave ID
            if (existingFolder) {
              await this.databaseManager.updateFolderArweaveId(existingFolder.id, arfsFolderId);
            } else {
              // Add new folder record
              await this.databaseManager.addFolder({
                id: upload.id,
                folderPath: upload.localPath,
                relativePath: this.versionManager.getRelativePath(upload.localPath),
                parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
                arfsFolderId
              });
            }
            
            // MONEY-2: never resurrect a cancelled record as 'completed' —
            // the folder WAS created on-chain (charged); record the truth in
            // the terminal cancelled state instead (qa-gate FAIL reason 2).
            if (this.uploadQueueManager.isCancellationRequested(upload.id)) {
              this.uploadQueueManager.clearCancellationRequest(upload.id);
              const folderTruth = 'Cancelled — but the folder had already been created on Arweave (charged)';
              upload.status = 'failed';
              upload.error = folderTruth;
              await this.databaseManager.updateUpload(upload.id, {
                status: 'failed',
                error: folderTruth,
                fileId: arfsFolderId,
                completedAt: new Date()
              });
              this.emitUploadProgress(upload.id, 100, 'failed', folderTruth);
              this.uploadQueueManager.removeFromQueue(upload.id);
              console.warn(`Folder upload ${upload.id} completed on-chain despite cancellation — recorded truthfully (folderId: ${arfsFolderId})`);
              return;
            }
            
            // Mark upload as completed
            upload.status = 'completed';
            await this.databaseManager.updateUpload(upload.id, { 
              status: 'completed',
              completedAt: new Date()
            });
          }
        }
        return;
      }
      
      // For files, continue with existing logic
      // Check if this is a free Turbo upload (within the free-tier limit)
      const isFreeWithTurbo = upload.uploadMethod === 'turbo' && this.costCalculator.isFreeWithTurbo(upload.fileSize);
      if (isFreeWithTurbo) {
        console.log(`File ${upload.fileName} is within the Turbo free-tier limit (${upload.fileSize} bytes) - should be FREE with Turbo`);
      }
      
      // Get the correct parent folder for this file (will create folder structure if needed)
      const targetFolderId = await this.getTargetFolderId(upload.localPath, upload.id);
      console.log(`Target folder ID for upload: ${targetFolderId}`);
      
      // Wrap file for upload using ArDrive Core
      const wrappedFile = wrapFileOrFolder(upload.localPath);

      // SYNC-26: if this upload is an EDIT of a file already on Arweave, thread
      // the existing fileId so ardrive-core-js writes a REVISION of that same
      // ArFS file (reuses fileId, new dataTx + metadata) instead of minting a
      // new file entity. core-js keys revisions off wrappedFile.existingId
      // (arfsdao.prepareFile: `fileId = wrappedFile.existingId ?? EID(uuid())`).
      // Relying on core's name-based conflict auto-detection alone is fragile —
      // it misses when the just-uploaded original is not yet indexed, breaking
      // the revision chain (SYNC-26 live repro: fileId changed on edit). Setting
      // it here (BEFORE the private/public branch below) makes the revision
      // deterministic for BOTH public and private drives without touching the
      // PRIV-8 privacy routing. Absent id => normal new upload (fallback).
      this.applyRevisionFileId(wrappedFile, upload);

      // MONEY-10 (TOCTOU): close the residual window between the start-of-uploadFile
      // re-stat and this wrap. wrappedFile.size is the exact byte count about to be
      // uploaded/charged; assert it still equals the approved size BEFORE building
      // upload options or calling uploadAllEntities. On mismatch, re-queue for
      // approval at the current size and abort this execution — no spend.
      if (await this.assertWrappedSizeApproved(wrappedFile, upload)) {
        return;
      }

      // Get drive mapping to check if private
      const mappings = await this.databaseManager.getDriveMappings();
      const mapping = mappings.find(m => m.driveId === this.driveId);
      // PRIV-8: fail closed — never let an unresolved mapping route a private
      // file to the unencrypted public upload path (leak + spend).
      const isPrivateDrive =
        resolveDrivePrivacyOrThrow(mapping, this.driveId, `file "${upload.fileName}"`) === 'private';

      // Build upload options
      const uploadOptions: any = {
        entitiesToUpload: [
          {
            wrappedEntity: wrappedFile,
            destFolderId: EID(targetFolderId) // Upload to correct folder
          }
        ]
      };
      
      // For private drives, add the drive key to each entity
      if (isPrivateDrive) {
        const driveKey = driveKeyManager.getDriveKey(this.driveId!);
        if (!driveKey) {
          throw new Error('Private drive is locked - cannot upload files');
        }
        console.log('Adding drive key for private file upload');
        uploadOptions.entitiesToUpload[0].driveKey = driveKey;
      }
      
      // If using Turbo, ensure ArDrive is configured for Turbo uploads
      if (upload.uploadMethod === 'turbo') {
        console.log('Configuring upload for Turbo payment method');
        
        // Try to explicitly set payment method (this might not be supported in v3.0.0)
        uploadOptions.paymentMethod = 'turbo';
        uploadOptions.useTurbo = true;
        
        // For free uploads, we might need to set a specific flag
        if (isFreeWithTurbo) {
          console.log('This is a FREE Turbo upload - attempting to bypass balance check');
          uploadOptions.skipBalanceCheck = true; // This might not exist but worth trying
        }
      }
      
      // MONEY-2: last spend checkpoint before the paid network call
      if (await this.finalizeCancelledUpload(upload)) {
        return;
      }
      
      // Upload file using ArDrive Core's recommended API
      const result = await this.arDrive!.uploadAllEntities(uploadOptions);

      // SEC-1: never log the raw ArFSResult — for private uploads,
      // created[].key carries the drive/file key. Log a key-free summary.
      console.log('ArDrive Core upload result:', summarizeArFSResult(result));
      
      // Process the upload result
      await this.processUploadResult(upload, result);

    } catch (error) {
      console.error(`ArDrive Core upload failed for ${upload.fileName}:`, error);
      
      // Provide more specific error messages
      let errorMessage = 'Unknown upload error';
      if (error instanceof Error) {
        console.error('Upload error details:', error.message, error.stack);
        
        if (error.message.includes('File-ID tag missing')) {
          // This error typically happens when trying to read back a file that wasn't properly created
          // It might be a timing issue or folder creation problem
          errorMessage = 'Upload failed: File entity creation issue. Retrying with folder verification...';
          
          // Retry once with explicit folder structure verification
          try {
            console.log('Retrying upload after folder structure verification...');
            
            // MONEY-2: the retry is a second paid attempt — honor cancellation
            if (await this.finalizeCancelledUpload(upload)) {
              return;
            }
            
            await this.ensureFolderStructure(path.dirname(upload.localPath), upload.id);
            
            // Small delay to ensure folder is fully created
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Re-wrap the file and get target folder
            const retryWrappedFile = wrapFileOrFolder(upload.localPath);
            // SYNC-26: the retry is still the same edit — keep it a revision
            this.applyRevisionFileId(retryWrappedFile, upload);
            // MONEY-10 (TOCTOU): the retry re-wraps (a SECOND fresh disk read) —
            // assert the re-wrapped bytes still match the approval before this
            // second paid attempt; on mismatch, re-queue and abort (no spend).
            if (await this.assertWrappedSizeApproved(retryWrappedFile, upload)) {
              return;
            }
            const retryTargetFolderId = await this.getTargetFolderId(upload.localPath, upload.id);
            
            // Build retry options
            const retryOptions: any = {
              entitiesToUpload: [
                {
                  wrappedEntity: retryWrappedFile,
                  destFolderId: EID(retryTargetFolderId)
                }
              ]
            };
            
            // Add drive key for private drives (check again in retry)
            const retryMappings = await this.databaseManager.getDriveMappings();
            const retryMapping = retryMappings.find(m => m.driveId === this.driveId);
            // PRIV-8: the retry is a second paid attempt — fail closed here too
            // so an unresolved mapping can't route the re-upload to public.
            const retryIsPrivateDrive =
              resolveDrivePrivacyOrThrow(retryMapping, this.driveId, `file "${upload.fileName}"`) === 'private';
            
            if (retryIsPrivateDrive) {
              const driveKey = driveKeyManager.getDriveKey(this.driveId!);
              if (driveKey) {
                retryOptions.entitiesToUpload[0].driveKey = driveKey;
              }
            }
            
            // Retry the upload
            const retryResult = await this.arDrive!.uploadAllEntities(retryOptions);
            
            // If retry succeeded, process the result
            // SEC-1: key-free summary only (raw ArFSResult can carry keys)
            console.log('Retry successful:', summarizeArFSResult(retryResult));
            return this.processUploadResult(upload, retryResult);
            
          } catch (retryError) {
            console.error('Retry failed:', retryError);
            errorMessage = 'Upload failed after retry. Please ensure the parent folder exists on ArDrive.';
          }
        } else if (error.message.includes('insufficient')) {
          // Check if this was supposed to be a free upload
          const isFreeWithTurbo = upload.uploadMethod === 'turbo' && this.costCalculator.isFreeWithTurbo(upload.fileSize);
          if (isFreeWithTurbo) {
            errorMessage = `Upload failed: This file (${upload.fileSize} bytes) should be FREE with Turbo, but ArDrive reported insufficient balance. This may be a configuration issue.`;
            console.error('FREE UPLOAD FAILED:', {
              fileName: upload.fileName,
              fileSize: upload.fileSize,
              uploadMethod: upload.uploadMethod,
              error: error.message
            });
          } else {
            errorMessage = 'Upload failed: Insufficient balance for transaction.';
          }
        } else if (error.message.includes('network')) {
          errorMessage = 'Upload failed: Network error. Please check your internet connection.';
        } else {
          errorMessage = error.message;
        }
      }
      
      throw new Error(errorMessage);
    }
  }

  private async getTargetFolderId(filePath: string, cancellationUploadId?: string): Promise<string> {
    // Get the directory containing the file
    const fileDir = path.dirname(filePath);
    
    console.log(`🔍 getTargetFolderId for file: ${filePath}`);
    console.log(`  - File directory: ${fileDir}`);
    console.log(`  - Sync folder path: ${this.syncFolderPath}`);
    
    // If file is in sync root, use root folder ID
    if (fileDir === this.syncFolderPath) {
      console.log(`  - File is in sync root, using root folder ID: ${this.rootFolderId}`);
      return this.rootFolderId!;
    }
    
    // Find the Arweave folder ID for the file's directory
    const folder = await this.databaseManager.getFolderByPath(fileDir);
    console.log(`  - Database lookup result:`, folder ? {
      id: folder.id,
      folderPath: folder.folderPath,
      arfsFolderId: folder.arfsFolderId,
      isDeleted: folder.isDeleted
    } : 'null');
    
    if (folder?.arfsFolderId) {
      console.log(`  - ✓ Found Arweave folder ID: ${folder.arfsFolderId}`);
      return folder.arfsFolderId;
    }
    
    // If folder doesn't exist on Arweave, create it first
    console.log(`  - ❌ No Arweave folder found for ${fileDir}, creating folder structure...`);
    
    // Try multiple times to create the folder structure with retries
    let retryCount = 0;
    const maxRetries = 3;
    let lastError: any = null;
    
    while (retryCount < maxRetries) {
      // MONEY-2: each retry launches more paid folder creations — stop the
      // moment cancellation is requested
      this.throwIfUploadCancelled(cancellationUploadId);
      try {
        await this.ensureFolderStructure(fileDir, cancellationUploadId);
        
        // Add a small delay to ensure folder creation is propagated
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try to get the folder again after creation
        const newFolder = await this.databaseManager.getFolderByPath(fileDir);
        console.log(`  - After creation attempt ${retryCount + 1}, database lookup result:`, newFolder ? {
          id: newFolder.id,
          folderPath: newFolder.folderPath,
          arfsFolderId: newFolder.arfsFolderId,
          isDeleted: newFolder.isDeleted
        } : 'null');
        
        if (newFolder?.arfsFolderId) {
          console.log(`  - ✓ Created folder successfully on attempt ${retryCount + 1}, using ID: ${newFolder.arfsFolderId}`);
          return newFolder.arfsFolderId;
        }
        
        // If we didn't get an Arweave ID, try again
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(`  - Folder creation didn't return Arweave ID, retrying (${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      } catch (error) {
        lastError = error;
        console.error(`Failed to create folder structure on attempt ${retryCount + 1}:`, error);
        retryCount++;
        
        if (retryCount < maxRetries) {
          console.log(`  - Retrying folder creation (${retryCount}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      }
    }
    
    // If we exhausted all retries, throw an error instead of using root
    const errorMessage = `Failed to create folder structure for ${fileDir} after ${maxRetries} attempts. ` +
                        `Please ensure the parent folder "${path.basename(fileDir)}" is created on ArDrive first.`;
    console.error(errorMessage);
    console.error('Last error:', lastError);
    
    // Instead of falling back to root, throw an error to prevent incorrect uploads
    throw new Error(errorMessage);
  }

  // Ensure folder structure exists on Arweave before uploading files
  private async ensureFolderStructure(targetPath: string, cancellationUploadId?: string): Promise<void> {
    if (!this.syncFolderPath || !this.arDrive || !this.rootFolderId) {
      throw new Error('Sync not properly initialized');
    }
    
    console.log(`Ensuring folder structure for: ${targetPath}`);
    
    // Get all parent directories that need to be created
    const dirsToCreate: string[] = [];
    let currentPath = targetPath;
    
    while (currentPath !== this.syncFolderPath && currentPath !== path.dirname(currentPath)) {
      const folder = await this.databaseManager.getFolderByPath(currentPath);
      if (!folder || !folder.arfsFolderId) {
        dirsToCreate.unshift(currentPath); // Add to beginning to create parent dirs first
      } else {
        console.log(`Folder already exists on Arweave: ${currentPath} (${folder.arfsFolderId})`);
      }
      currentPath = path.dirname(currentPath);
    }
    
    if (dirsToCreate.length === 0) {
      console.log('All folders already exist on Arweave');
      return;
    }
    
    console.log(`Creating ${dirsToCreate.length} folders on Arweave...`);
    
    // Create folders in order from parent to child
    for (const dirPath of dirsToCreate) {
      // MONEY-2: every iteration is a separate paid call — honor a pending
      // cancellation before launching the next one (qa-gate FAIL reason 3)
      this.throwIfUploadCancelled(cancellationUploadId);
      try {
        await this.createFolderOnArweave(dirPath);
      } catch (error) {
        console.error(`Failed to create folder ${dirPath}:`, error);
        throw error;
      }
    }
    
    // Final delay to ensure all folders are ready
    if (dirsToCreate.length > 0) {
      console.log('Waiting for folder creation to propagate...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Create a single folder on Arweave
  private async createFolderOnArweave(dirPath: string): Promise<void> {
    const relativePath = this.versionManager.getRelativePath(dirPath);
    const parentPath = path.dirname(dirPath);
    const folderName = path.basename(dirPath);
    
    console.log(`Creating folder on Arweave: ${relativePath}`);
    
    // Find parent folder ID
    let parentFolderId = this.rootFolderId!;
    if (parentPath !== this.syncFolderPath) {
      const parentFolder = await this.databaseManager.getFolderByPath(parentPath);
      if (parentFolder?.arfsFolderId) {
        parentFolderId = parentFolder.arfsFolderId;
      } else {
        console.warn(`Parent folder ${parentPath} doesn't have Arweave ID yet, using root folder`);
      }
    }
    
    try {
      // Get drive mapping to check privacy
      const mappings = await this.databaseManager.getDriveMappings();
      const mapping = mappings.find(m => m.driveId === this.driveId);
      // PRIV-8: fail closed — an unresolved mapping must not create an
      // unencrypted public folder for a private drive (leak + spend).
      const isPrivateDrive =
        resolveDrivePrivacyOrThrow(mapping, this.driveId, `folder "${folderName}"`) === 'private';

      let result;
      if (isPrivateDrive) {
        const driveKey = driveKeyManager.getDriveKey(this.driveId!);
        if (!driveKey) {
          throw new Error('Private drive is locked - cannot create folder');
        }
        result = await this.arDrive!.createPrivateFolder({
          parentFolderId: EID(parentFolderId),
          folderName: folderName,
          driveKey: driveKey
        });
      } else {
        result = await this.arDrive!.createPublicFolder({
          parentFolderId: EID(parentFolderId),
          folderName: folderName
        });
      }
      
      if (result.created && result.created.length > 0) {
        const createdFolder = result.created[0];
        if (createdFolder.type === 'folder' && createdFolder.entityId) {
          const arfsFolderId = createdFolder.entityId.toString();
          console.log(`✓ Folder created on Arweave with ID: ${arfsFolderId}`);
          
          // Check if folder already exists in database
          const existingFolder = await this.databaseManager.getFolderByPath(dirPath);
          if (existingFolder) {
            // Update existing folder with Arweave ID
            console.log(`Updating existing folder record with Arweave ID`);
            await this.databaseManager.updateFolderArweaveId(existingFolder.id, arfsFolderId);
          } else {
            // Add new folder to database
            console.log(`Adding new folder record with Arweave ID`);
            await this.databaseManager.addFolder({
              id: crypto.randomUUID(),
              folderPath: dirPath,
              relativePath,
              parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
              arfsFolderId
            });
          }
          
          // Small delay to ensure folder is fully propagated
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error: any) {
      console.error(`Failed to create folder ${folderName} on Arweave:`, error);
      
      // Handle "Entity name already exists" error by fetching the existing folder
      if (error.message?.includes('Entity name already exists')) {
        console.log(`Folder "${folderName}" already exists on Arweave, fetching its ID...`);
        
        try {
          // Get drive mapping to check privacy
          const mappings = await this.databaseManager.getDriveMappings();
          const mapping = mappings.find(m => m.driveId === this.driveId);
          // PRIV-8: fail closed — resolve privacy positively before listing; an
          // unresolved mapping must not silently list as public on a private drive.
          const isPrivateDrive =
            resolveDrivePrivacyOrThrow(mapping, this.driveId, `folder "${folderName}"`) === 'private';

          // List the parent folder contents to find the existing folder
          const parentContents = await this.listFolderContents(parentFolderId, isPrivateDrive);
          
          // Find the folder by name
          const existingFolder = parentContents.find(
            item => item.entityType === 'folder' && item.name === folderName
          );
          
          if (existingFolder && existingFolder.entityType === 'folder' && 'folderId' in existingFolder) {
            const arfsFolderId = existingFolder.folderId.toString();
            console.log(`✓ Found existing folder on Arweave with ID: ${arfsFolderId}`);
            
            // Update database with the existing folder ID
            const dbFolder = await this.databaseManager.getFolderByPath(dirPath);
            if (dbFolder) {
              await this.databaseManager.updateFolderArweaveId(dbFolder.id, arfsFolderId);
            } else {
              await this.databaseManager.addFolder({
                id: crypto.randomUUID(),
                folderPath: dirPath,
                relativePath,
                parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
                arfsFolderId
              });
            }
            
            return; // Success - folder exists and we have its ID
          } else {
            console.error(`Could not find folder "${folderName}" in parent folder ${parentFolderId}`);
            throw new Error(`Folder exists but could not retrieve its ID`);
          }
        } catch (listError) {
          console.error('Failed to list parent folder contents:', listError);
          throw error; // Re-throw original error
        }
      }
      
      // For other errors, re-throw
      throw error;
    }
  }
  
  private async processUploadResult(upload: FileUpload, result: any): Promise<void> {
    // qa-gate finding (SYNC-1): core's upsert conflict resolution silently
    // SKIPS when the local mtime equals the remote revision's — an empty
    // result must never be recorded as a successful upload with undefined
    // tx ids. Nothing was uploaded and nothing was charged.
    if (!result?.created || result.created.length === 0) {
      this.uploadQueueManager.clearCancellationRequest(upload.id);
      const skipMessage =
        'Upload skipped by conflict resolution — the remote revision already matches (same name and modified time); nothing was charged';
      upload.status = 'failed';
      upload.error = skipMessage;
      await this.databaseManager.updateUpload(upload.id, {
        status: 'failed',
        error: skipMessage
      });
      this.emitUploadProgress(upload.id, 0, 'failed', skipMessage);
      this.uploadQueueManager.removeFromQueue(upload.id);
      console.warn(`Upload ${upload.id} produced no created entities — recorded as skipped, not completed`);
      return;
    }
    
    // Extract transaction IDs and entity ID
    let dataTxId: string | undefined;
    let metadataTxId: string | undefined;
    let fileId: string | undefined;
    
    // ArDrive Core creates multiple transactions for a file upload
    for (const createdItem of result.created) {
      if (createdItem.type === 'file') {
        if (createdItem.dataTxId) {
          dataTxId = createdItem.dataTxId.toString();
        }
        if (createdItem.metadataTxId) {
          metadataTxId = createdItem.metadataTxId.toString();
        }
        if (createdItem.entityId) {
          fileId = createdItem.entityId.toString();
        }
      }
    }

    // MONEY-2: never resurrect a cancelled record as 'completed'. If the
    // network call finished before cancellation could take effect, money WAS
    // spent and the file IS stored — record that truth in the terminal
    // cancelled state (with the tx ids as evidence) instead of flipping the
    // record back to completed.
    if (this.uploadQueueManager.isCancellationRequested(upload.id)) {
      this.uploadQueueManager.clearCancellationRequest(upload.id);
      const truth = 'Cancelled — but the upload had already completed on Arweave (file stored and charged)';
      upload.status = 'failed';
      upload.error = truth;
      upload.dataTxId = dataTxId;
      upload.metadataTxId = metadataTxId;
      upload.fileId = fileId;
      await this.databaseManager.updateUpload(upload.id, {
        status: 'failed',
        error: truth,
        dataTxId,
        metadataTxId,
        fileId,
        completedAt: new Date()
      });
      this.emitUploadProgress(upload.id, 100, 'failed', truth);
      this.uploadQueueManager.removeFromQueue(upload.id);
      
      // The file IS on Arweave — register it in processed_files so the
      // watcher's dedup never re-detects and re-charges it (qa-gate finding:
      // skipping this left a retry-independent double-charge vector).
      try {
        const content = await fs.readFile(upload.localPath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        await this.databaseManager.addProcessedFile(
          hash,
          upload.fileName,
          upload.fileSize,
          upload.localPath,
          'upload'
        );
      } catch (dedupError) {
        console.error('Could not register cancelled-but-charged file in processed_files:', dedupError);
      }
      
      console.warn(`Upload ${upload.id} completed on-chain despite cancellation — recorded truthfully (dataTxId: ${dataTxId})`);
      return;
    }

    // Update as completed
    upload.status = 'completed';
    upload.progress = 100;
    upload.dataTxId = dataTxId;
    upload.metadataTxId = metadataTxId;
    upload.transactionId = dataTxId; // Keep legacy field for backward compatibility
    upload.fileId = fileId;
    upload.completedAt = new Date();

    console.log(`ArDrive Core upload completed - Data TX: ${dataTxId}, Metadata TX: ${metadataTxId}, File-ID: ${fileId}`);

    // Add to upload history for activity tracking if not already there
    try {
      await this.databaseManager.addUpload({
        id: upload.id,
        driveId: upload.driveId,
        localPath: upload.localPath,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        status: 'completed',
        progress: 100,
        uploadMethod: upload.uploadMethod,
        dataTxId: dataTxId,
        metadataTxId: metadataTxId,
        transactionId: dataTxId,
        fileId: fileId,
        completedAt: new Date()
      });
    } catch (error) {
      // If upload already exists (duplicate ID), update it instead
      console.log('Upload already exists, updating instead:', upload.id);
      await this.databaseManager.updateUpload(upload.id, {
        status: 'completed',
        progress: 100,
        dataTxId: upload.dataTxId,
        metadataTxId: upload.metadataTxId,
        transactionId: upload.transactionId,
        fileId: fileId,
        completedAt: upload.completedAt
      });
    }
    
    // Emit completion progress event
    this.emitUploadProgress(upload.id, 100, 'completed');

    // SYNC-28: back-fill the on-chain data-tx id onto the file_versions row that
    // createNewVersion wrote at QUEUE time (arweaveId/turboId were null then, as
    // no upload existed yet). This unblocks the version-history UI (FEAT-6),
    // which links View/Download to this tx id. Covers BOTH the normal (:2776)
    // and retry (:2842) paths since both route through processUploadResult.
    // Non-critical to upload success — the upload is already recorded — so a
    // failure here is logged, not thrown.
    if (dataTxId) {
      try {
        // New records are always Turbo (D-010/MONEY-1); only an explicit legacy
        // 'ar' routes to the arweaveId column. undefined -> 'turbo'.
        const versionMethod: 'ar' | 'turbo' = upload.uploadMethod === 'ar' ? 'ar' : 'turbo';
        const updated = await this.databaseManager.updateFileVersionTxId(
          upload.localPath,
          dataTxId,
          { method: versionMethod }
        );
        if (!updated) {
          console.warn(
            `SYNC-28: no unpopulated latest file_versions row for ${upload.localPath} — tx id ${dataTxId} not linked to a version`
          );
        }
      } catch (versionTxError) {
        console.error('SYNC-28: failed to back-fill file version tx id:', versionTxError);
      }
    }

    // UX-29: ambient "it works" confirmation for a completed upload.
    notificationService.notifyUploadComplete(upload.fileName);

    // Add the uploaded file to local cache immediately
    try {
      const driveMappings = await this.databaseManager.getDriveMappings();
      const activeMapping = driveMappings.find((m: any) => m.driveId === upload.driveId && m.isActive);
      
      if (activeMapping) {
        // Extract folder path from full file path
        const dirPath = path.dirname(upload.localPath);
        const relativePath = this.syncFolderPath ? 
          path.relative(this.syncFolderPath, dirPath).replace(/\\/g, '/') : '';
        const folderPath = relativePath ? '/' + relativePath : '/';
        
        await this.databaseManager.upsertDriveMetadata({
          mappingId: activeMapping.id,
          fileId: fileId || '',
          parentFolderId: await this.getParentFolderIdFromPath(folderPath, activeMapping.id) || '',
          name: path.basename(upload.localPath),
          path: folderPath,
          type: 'file',
          size: upload.fileSize,
          lastModifiedDate: Date.now(),
          dataTxId: dataTxId,
          metadataTxId: metadataTxId,
          contentType: '', // We don't have contentType in FileUpload
          localFileExists: true,
          syncStatus: 'synced'
        });
        console.log(`Added uploaded file to local cache: ${upload.fileName}`);
        
        // Emit file state change event to update UI
        if (fileId) {
          this.notifyRenderer('file:state-changed', {
            fileId: fileId,
            syncStatus: 'synced',
            syncPreference: 'auto'
          });
        }
      }
    } catch (error) {
      console.error('Failed to add uploaded file to cache:', error);
    }
    
    // Emit drive update event to refresh UI
    this.notifyRenderer('drive:update');
    this.notifyRenderer('activity:update');

    // Update processed files database with the completed upload
    try {
      const content = await fs.readFile(upload.localPath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const stats = await fs.stat(upload.localPath);
      
      await this.databaseManager.addProcessedFile(
        hash,
        path.basename(upload.localPath),
        stats.size,
        upload.localPath,
        'upload',
        fileId || dataTxId || upload.transactionId // Prefer File-ID, fallback to transaction ID
      );
    } catch (hashError) {
      console.warn('Failed to update processed files for completed ArDrive Core upload:', hashError);
    }

    this.uploadQueueManager.removeFromQueue(upload.id);
  }
  
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.zip': 'application/zip'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  // New method to sync drive metadata to cache
  private async syncDriveMetadata(): Promise<void> {
    this.emitSyncProgress({
      phase: 'metadata',
      description: 'Discovering drive contents...'
    });

    console.log('Syncing drive metadata to cache...');
    
    // Get the mapping ID for this drive
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      console.error('No mapping found for drive:', this.driveId);
      return;
    }

    try {
      // Check if drive is private from mapping
      // PRIV-8: fail closed — resolve privacy positively; a null/undefined
      // drivePrivacy must not silently list a private drive as public.
      const isPrivateDrive =
        resolveDrivePrivacyOrThrow(mapping, this.driveId, `drive "${mapping.driveName}"`) === 'private';
      console.log(`Fetching drive contents via ArDrive Core ${isPrivateDrive ? 'listPrivateFolder' : 'listPublicFolder'}...`);
      
      let allItems: any[] = [];
      if (isPrivateDrive) {
        const driveKey = driveKeyManager.getDriveKey(this.driveId!);
        if (!driveKey) {
          console.warn('Private drive is locked - cannot list contents');
          return; // Skip sync for locked private drives
        }
        
        console.log('Listing private folder with:', {
          folderId: this.rootFolderId,
          hasDriveKey: !!driveKey,
          driveKeyId: (driveKey as any).driveId || this.driveId,
          driveId: this.driveId
        });
        
        try {
          allItems = await this.arDrive!.listPrivateFolder({
            folderId: EID(this.rootFolderId!),
            maxDepth: 10, // Get full hierarchy
            includeRoot: false, // Don't include root folder itself
            driveKey: driveKey
          });
        } catch (error) {
          console.error('Failed to list private folder contents:', error);
          console.error('Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            rootFolderId: this.rootFolderId,
            driveId: this.driveId
          });
          // Return empty array to continue sync without metadata
          allItems = [];
        }
      } else {
        allItems = await this.arDrive!.listPublicFolder({
          folderId: EID(this.rootFolderId!),
          maxDepth: 10, // Get full hierarchy
          includeRoot: false // Don't include root folder itself
        });
      }
      
      // Sort by path like ardrive-cli does
      const sortedItems = allItems.sort((a: any, b: any) => {
        const pathA = a.path || a.name || '';
        const pathB = b.path || b.name || '';
        return pathA.localeCompare(pathB);
      });
      
      // Clean up unused properties for folders like ardrive-cli
      sortedItems.forEach((item: any) => {
        if (item.entityType === 'folder') {
          delete item.lastModifiedDate;
          delete item.size;
          delete item.dataTxId;
          delete item.dataContentType;
        }
      });
      
      console.log(`Found ${sortedItems.length} items in drive`);

      this.emitSyncProgress({
        phase: 'metadata',
        description: `Found ${sortedItems.length} items`,
        itemsProcessed: sortedItems.length
      });

      // Store for later phases
      this.totalItemsToSync = sortedItems.length;

      // Clear existing cache for this mapping
      await this.databaseManager.clearDriveMetadataCache(mapping.id);

      // Process and cache all items
      for (const item of sortedItems) {
        // Normalize the path to remove drive name prefix if present
        let itemPath = item.path || item.name;
        
        // If the path starts with the drive name, remove it to avoid duplication
        const driveName = path.basename(this.syncFolderPath!);
        if (itemPath.startsWith(`/${driveName}/`) || itemPath.startsWith(`${driveName}/`)) {
          // Remove the drive name prefix
          itemPath = itemPath.replace(new RegExp(`^/?${driveName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '');
        } else if (itemPath === `/${driveName}` || itemPath === driveName) {
          // If the path is exactly the drive name, treat as root
          itemPath = '';
        }
        
        // Ensure we don't have empty paths or leading slashes
        if (itemPath.startsWith('/')) {
          itemPath = itemPath.substring(1);
        }
        
        const localPath = itemPath ? path.join(this.syncFolderPath!, itemPath) : path.join(this.syncFolderPath!, item.name);
        
        let localFileExists = false;
        
        if (item.entityType === 'file') {
          // Check if file exists locally
          try {
            await fs.stat(localPath);
            localFileExists = true;
          } catch {
            localFileExists = false;
          }
        }

        // Store metadata in cache
        await this.databaseManager.upsertDriveMetadata({
          mappingId: mapping.id,
          fileId: item.entityType === 'file' ? item.fileId?.toString() : item.folderId?.toString(),
          parentFolderId: item.parentFolderId?.toString(),
          name: item.name,
          path: item.path || item.name,
          type: item.entityType === 'folder' ? 'folder' : 'file',
          size: item.entityType === 'file' ? (item.size ? item.size.valueOf() : 0) : undefined,
          lastModifiedDate: item.lastModifiedDate ? Number(item.lastModifiedDate) : undefined,
          dataTxId: item.dataTxId?.toString(),
          metadataTxId: (item as any).metaDataTxId?.toString() || (item as any).metadataTxId?.toString(),
          contentType: item.entityType === 'file' ? item.dataContentType : undefined,
          localPath: localPath,
          localFileExists: localFileExists,
          syncStatus: localFileExists ? 'synced' : 'pending'
        });
      }

      console.log('Metadata sync completed');
      
      // Now download only missing files
      await this.downloadManager.downloadMissingFiles();
      
    } catch (error) {
      console.error('Failed to sync drive metadata:', error);
    }
  }

  // Helper method to list folder contents (handles both public and private)
  private async listFolderContents(folderId: string, isPrivate: boolean): Promise<any[]> {
    if (isPrivate) {
      const driveKey = driveKeyManager.getDriveKey(this.driveId!);
      if (!driveKey) {
        console.warn('Private drive is locked - cannot list folder contents');
        return [];
      }
      return await this.arDrive!.listPrivateFolder({
        folderId: EID(folderId),
        driveKey: driveKey
      });
    } else {
      return await this.arDrive!.listPublicFolder({
        folderId: EID(folderId)
      });
    }
  }

  // Recursively list all drive contents
  private async recursivelyListDriveContents(folderId: string, parentPath: string, isPrivate: boolean = false): Promise<any[]> {
    const items: any[] = [];
    
    try {
      const folderContents = await this.listFolderContents(folderId, isPrivate);

      for (const item of folderContents) {
        const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        
        if (item.entityType === 'folder') {
          items.push({
            ...item,
            type: 'folder',
            path: itemPath,
            fileId: item.folderId.toString(),
            parentFolderId: folderId
          });
          
          // Recursively list folder contents
          const subItems = await this.recursivelyListDriveContents(item.folderId.toString(), itemPath, isPrivate);
          items.push(...subItems);
          
        } else if (item.entityType === 'file') {
          items.push({
            ...item,
            type: 'file',
            path: itemPath,
            fileId: item.fileId.toString(),
            parentFolderId: folderId
          });
        }
      }
    } catch (error) {
      console.error(`Failed to list folder ${folderId}:`, error);
    }

    return items;
  }

  // Fetch drive contents via direct GraphQL query
  private async fetchDriveContentsViaGraphQL(): Promise<any[]> {
    console.log('Fetching drive contents via GraphQL...');
    // This would implement direct GraphQL queries to Arweave
    // For now, return empty array
    return [];
  }

  // Download only files that don't exist locally
  private async downloadMissingFiles(mappingId: string): Promise<void> {
    console.log('Checking for missing files to download...');
    
    // Get all files from metadata cache that don't exist locally
    const allMetadata = await this.databaseManager.getDriveMetadata(mappingId);
    const missingFiles = allMetadata.filter(item => 
      item.type === 'file' && 
      !item.localFileExists &&
      item.syncStatus === 'pending'
    );

    console.log(`Found ${missingFiles.length} missing files to download`);

    // Create folders first
    const folders = allMetadata.filter(item => item.type === 'folder');
    for (const folder of folders) {
      try {
        await fs.mkdir(folder.localPath, { recursive: true });
      } catch (error) {
        console.error(`Failed to create folder ${folder.localPath}:`, error);
      }
    }

    // Download missing files
    for (const file of missingFiles) {
      try {
        console.log(`Downloading missing file: ${file.name}`);
        
        // Update status to downloading
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'downloading', false);
        
        // Use existing download method with full local path
        await this.downloadIndividualFile(file.fileId, file.name, file.dataTxId, file.localPath);
        
        // Update status to synced
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'synced', true);
        
      } catch (error) {
        console.error(`Failed to download ${file.name}:`, error);
        await this.databaseManager.updateFileSyncStatus(file.fileId, 'failed', (error as Error).message || 'Download failed');
      }
    }

    console.log('Missing files download completed');
  }

  // NEW: Create all folders before downloading files
  private async createAllFolders(): Promise<void> {
    this.emitSyncProgress({
      phase: 'folders',
      description: 'Creating folder structure...'
    });

    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      throw new Error('No mapping found for drive');
    }

    const allMetadata = await this.databaseManager.getDriveMetadata(mapping.id);
    const folders = allMetadata.filter(item => item.type === 'folder');
    
    this.foldersToCreate = folders.length;
    let created = 0;

    console.log(`Creating ${folders.length} folders...`);

    for (const folder of folders) {
      this.emitSyncProgress({
        phase: 'folders',
        description: 'Creating folder structure...',
        currentItem: folder.name,
        itemsProcessed: created,
        estimatedRemaining: this.foldersToCreate - created
      });

      try {
        await fs.mkdir(folder.localPath, { recursive: true });
        console.log(`Created folder: ${folder.localPath}`);
        created++;
      } catch (error) {
        console.error(`Failed to create folder ${folder.localPath}:`, error);
      }
    }

    console.log(`Folder creation completed: ${created}/${folders.length}`);
  }

  // NEW: Download files with progress
  private async downloadMissingFilesWithProgress(): Promise<void> {
    this.emitSyncProgress({
      phase: 'files',
      description: 'Downloading files...'
    });

    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      throw new Error('No mapping found for drive');
    }

    const allMetadata = await this.databaseManager.getDriveMetadata(mapping.id);
    const missingFiles = allMetadata.filter(item => 
      item.type === 'file' && 
      !item.localFileExists &&
      item.syncStatus === 'pending'
    );

    this.filesToDownload = missingFiles.length;
    let downloaded = 0;

    console.log(`Downloading ${missingFiles.length} missing files...`);

    for (const file of missingFiles) {
      this.emitSyncProgress({
        phase: 'files',
        description: 'Downloading files...',
        currentItem: file.name,
        itemsProcessed: downloaded,
        estimatedRemaining: this.filesToDownload - downloaded
      });

      try {
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'downloading', false);
        await this.downloadIndividualFile(file.fileId, file.name, file.dataTxId, file.localPath);
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'synced', true);
        downloaded++;
        console.log(`Downloaded: ${file.name}`);
      } catch (error) {
        console.error(`Failed to download ${file.name}:`, error);
        await this.databaseManager.updateFileSyncStatus(file.fileId, 'failed', (error as Error).message || 'Download failed');
      }
    }

    console.log(`File download completed: ${downloaded}/${missingFiles.length}`);
  }

  // NEW: Verify sync completeness
  private async verifySyncState(): Promise<void> {
    this.emitSyncProgress({
      phase: 'verification',
      description: 'Verifying sync completeness...'
    });

    console.log('🔍 Verifying sync completeness...');
    
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      throw new Error('No mapping found for drive');
    }

    const metadata = await this.databaseManager.getDriveMetadata(mapping.id);
    const folders = metadata.filter(item => item.type === 'folder');
    const files = metadata.filter(item => item.type === 'file');
    
    let missingFolders = 0;
    let missingFiles = 0;
    
    for (const folder of folders) {
      try {
        await fs.access(folder.localPath);
      } catch {
        missingFolders++;
        console.warn(`Missing folder: ${folder.localPath}`);
      }
    }
    
    for (const file of files) {
      try {
        await fs.access(file.localPath);
      } catch {
        missingFiles++;
        console.warn(`Missing file: ${file.localPath}`);
      }
    }
    
    if (missingFolders > 0 || missingFiles > 0) {
      throw new Error(`Sync incomplete: ${missingFolders} folders, ${missingFiles} files missing`);
    }
    
    console.log('✅ Sync verification passed');
  }

  // Helper method to calculate file hash
  private async calculateFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      console.error(`Failed to calculate hash for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * PRIV-8: fail-closed guard for metadata ops that currently have ONLY a
   * public ArFS code path — file/folder MOVE and RENAME. ardrive-core-js does
   * expose private move/rename, but this app has not wired those paths yet, so
   * these call sites unconditionally used the movePublic / renamePublic calls.
   * On a private drive that would write an unencrypted PUBLIC metadata revision
   * (exposing the entity's new name/location as plaintext) AND spend.
   *
   * Rather than leak, refuse: block when the drive is positively private, and
   * (via resolveDrivePrivacyOrThrow) also block when privacy can't be resolved.
   * A positively-public drive proceeds unchanged (no regression).
   */
  private async assertPublicMoveRenameOrThrow(
    driveId: string | null | undefined,
    entityDescription: string,
  ): Promise<void> {
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === driveId);
    if (resolveDrivePrivacyOrThrow(mapping, driveId, entityDescription) === 'private') {
      throw new Error(
        `Refusing to move/rename ${entityDescription} on a private drive: ` +
          `private move/rename is not supported yet and must not fall through to ` +
          `the public ArFS path (it would leak private data as public and spend).`,
      );
    }
  }

  // Execute metadata operations (move, rename, hide, etc.)
  async executeMetadataOperation(pendingUpload: PendingUpload): Promise<any> {
    if (!this.arDrive) {
      throw new Error('ArDrive not initialized');
    }
    
    console.log(`Executing ${pendingUpload.operationType} operation for ${pendingUpload.fileName}`);
    
    try {
      let result;
      
      switch (pendingUpload.operationType) {
        case 'move':
          if (!pendingUpload.arfsFileId || !pendingUpload.metadata?.newParentFolderId) {
            throw new Error('Missing required data for move operation');
          }

          // PRIV-8: fail closed — movePublicFile has no private counterpart wired
          // here; a private (or unresolved) drive must not leak+spend via public.
          await this.assertPublicMoveRenameOrThrow(
            pendingUpload.driveId || this.driveId,
            `file "${pendingUpload.fileName}"`,
          );

          result = await this.arDrive.movePublicFile({
            fileId: EID(pendingUpload.arfsFileId),
            newParentFolderId: EID(pendingUpload.metadata.newParentFolderId)
          });

          console.log(`Successfully moved file ${pendingUpload.fileName}`);
          break;

        case 'rename':
          if (!pendingUpload.arfsFileId) {
            throw new Error('Missing file ID for rename operation');
          }

          // PRIV-8: fail closed — renamePublicFile has no private counterpart
          // wired here; block private/unresolved rather than leak+spend via public.
          await this.assertPublicMoveRenameOrThrow(
            pendingUpload.driveId || this.driveId,
            `file "${pendingUpload.fileName}"`,
          );

          result = await this.arDrive.renamePublicFile({
            fileId: EID(pendingUpload.arfsFileId),
            newName: pendingUpload.fileName
          });

          console.log(`Successfully renamed file to ${pendingUpload.fileName}`);
          break;
          
        case 'hide':
        case 'unhide':
        case 'delete': {
          // SYNC-5 / D-011: a local delete propagates as an ArFS "hide"
          // (permanent storage cannot truly delete — the entity gets a metadata
          // revision with isHidden=true). 'hide' and 'delete' both HIDE; 'unhide'
          // reverses it. Works for files and folders, public and private drives.
          const shouldHide = pendingUpload.operationType !== 'unhide';
          const isFolder = !!pendingUpload.arfsFolderId;
          const entityId = isFolder ? pendingUpload.arfsFolderId : pendingUpload.arfsFileId;

          if (!entityId) {
            throw new Error(`Missing entity ID for ${pendingUpload.operationType} operation`);
          }

          // Resolve drive privacy to pick the public vs private ArFS path.
          // PRIV-8: fail closed — an unresolved mapping must NOT default to the
          // public hide/unhide path (would write an unencrypted public metadata
          // revision of a private entity AND spend).
          const mappings = await this.databaseManager.getDriveMappings();
          const opDriveId = pendingUpload.driveId || this.driveId || undefined;
          const mapping = mappings.find((m: any) => m.driveId === opDriveId);
          const isPrivateDrive =
            resolveDrivePrivacyOrThrow(
              mapping,
              opDriveId,
              `${isFolder ? 'folder' : 'file'} "${pendingUpload.fileName}"`,
            ) === 'private';

          // Private hide/unhide requires the drive key (encrypts the whole
          // metadata JSON, exactly like a private rename).
          let driveKey;
          if (isPrivateDrive) {
            if (!opDriveId) {
              throw new Error('Cannot resolve drive for private hide/unhide operation');
            }
            driveKey = driveKeyManager.getDriveKey(opDriveId);
            if (!driveKey) {
              throw new Error('Private drive is locked - unlock it to hide/unhide files');
            }
          }

          if (isFolder) {
            if (shouldHide) {
              result = isPrivateDrive
                ? await this.arDrive.hidePrivateFolder({ folderId: EID(entityId), driveKey: driveKey! })
                : await this.arDrive.hidePublicFolder({ folderId: EID(entityId) });
            } else {
              result = isPrivateDrive
                ? await this.arDrive.unhidePrivateFolder({ folderId: EID(entityId), driveKey: driveKey! })
                : await this.arDrive.unhidePublicFolder({ folderId: EID(entityId) });
            }
          } else {
            if (shouldHide) {
              result = isPrivateDrive
                ? await this.arDrive.hidePrivateFile({ fileId: EID(entityId), driveKey: driveKey! })
                : await this.arDrive.hidePublicFile({ fileId: EID(entityId) });
            } else {
              result = isPrivateDrive
                ? await this.arDrive.unhidePrivateFile({ fileId: EID(entityId), driveKey: driveKey! })
                : await this.arDrive.unhidePublicFile({ fileId: EID(entityId) });
            }
          }

          // Reflect the new hidden state locally so the Permaweb view updates
          // immediately (the cache upsert preserves this across metadata
          // re-syncs; a forced refresh reconciles against core truth).
          try {
            await this.databaseManager.updateDriveMetadataHidden(entityId, shouldHide);
          } catch (cacheError) {
            console.error('Failed to update hidden state in metadata cache:', cacheError);
          }

          console.log(
            `Successfully ${shouldHide ? 'hid' : 'unhid'} ${isFolder ? 'folder' : 'file'} ` +
            `${pendingUpload.fileName} on ${isPrivateDrive ? 'private' : 'public'} drive`
          );
          break;
        }


        default:
          throw new Error(`Unknown operation type: ${pendingUpload.operationType}`);
      }
      
      // Update local database to reflect the change
      if (pendingUpload.previousPath && pendingUpload.localPath !== pendingUpload.previousPath) {
        await this.databaseManager.updateFilePath(
          pendingUpload.arfsFileId || pendingUpload.id, 
          pendingUpload.localPath
        );
      }
      
      // Update the metadata cache to reflect the change immediately
      if (pendingUpload.arfsFileId) {
        try {
          // Update cache based on operation type
          switch (pendingUpload.operationType) {
            case 'rename':
              await this.databaseManager.updateDriveMetadataName(
                pendingUpload.arfsFileId,
                pendingUpload.fileName
              );
              break;
            case 'move':
              if (pendingUpload.metadata?.newParentFolderId) {
                // Calculate the relative path from sync folder for ArDrive
                const dirPath = path.dirname(pendingUpload.localPath);
                const relativePath = this.syncFolderPath ? 
                  path.relative(this.syncFolderPath, dirPath).replace(/\\/g, '/') : '';
                const ardrivePath = relativePath ? '/' + relativePath : '/';
                
                await this.databaseManager.updateDriveMetadataParent(
                  pendingUpload.arfsFileId,
                  pendingUpload.metadata.newParentFolderId,
                  ardrivePath
                );
              }
              break;
          }
          
          // Emit events to update UI
          this.notifyRenderer('drive:update');
          this.notifyRenderer('file:state-changed', {
            fileId: pendingUpload.arfsFileId,
            syncStatus: 'synced'
          });
        } catch (error) {
          console.error('Failed to update metadata cache after operation:', error);
        }
      }
      
      return result;
    } catch (error) {
      console.error(`Failed to execute ${pendingUpload.operationType} operation:`, error);
      throw error;
    }
  }

  // Handle file move operation - create a move operation instead of upload
  private async handleFileMove(
    oldPath: string, 
    newPath: string, 
    fileHash: string, 
    existingFileInfo?: any
  ): Promise<void> {
    console.log(`Creating file move operation: ${oldPath} -> ${newPath}`);
    
    try {
      const fileName = path.basename(newPath);
      const fileStats = await fs.stat(newPath);
      
      // Update version manager to track the move (FEAT-6: scope to its drive
      // mapping so the moved file's new version is retrievable in history).
      const moveMappingId = await this.resolveActiveMappingId();
      await this.versionManager.handleFileMove(oldPath, newPath, moveMappingId);
      
      // Get the parent folder info for the new location
      const newParentPath = path.dirname(newPath);
      let parentFolderInfo = await this.databaseManager.getFolderByPath(newParentPath);
      
      console.log(`Parent folder info for ${newParentPath}:`, parentFolderInfo ? {
        folderPath: parentFolderInfo.folderPath,
        arfsFolderId: parentFolderInfo.arfsFolderId
      } : 'null');
      
      // If not found in folder_structure, check drive metadata and sync if needed
      if (!parentFolderInfo && newParentPath !== this.syncFolderPath) {
        const folderInDriveMetadata = await this.databaseManager.checkFolderInDriveMetadata(newParentPath);
        console.log(`Drive metadata check for parent folder:`, folderInDriveMetadata ? {
          fileId: folderInDriveMetadata.fileId,
          name: folderInDriveMetadata.name,
          type: folderInDriveMetadata.type
        } : 'null');
        
        if (folderInDriveMetadata) {
          // Sync folder from drive metadata to local folder structure
          console.log(`Syncing parent folder from drive metadata to local folder structure`);
          await this.databaseManager.addFolder({
            id: crypto.randomUUID(),
            folderPath: newParentPath,
            relativePath: this.versionManager.getRelativePath(newParentPath),
            parentPath: path.dirname(newParentPath),
            arfsFolderId: folderInDriveMetadata.fileId
          });
          
          // Re-fetch the folder info after syncing
          parentFolderInfo = await this.databaseManager.getFolderByPath(newParentPath);
        }
      }
      
      // Get the parent folder ArFS ID
      const parentArfsFolderId = parentFolderInfo?.arfsFolderId;
      
      // Determine if it's a rename or move
      const oldParentPath = path.dirname(oldPath);
      const oldFileName = path.basename(oldPath);
      const isRename = oldParentPath === newParentPath && oldFileName !== fileName;
      const operationType = isRename ? 'rename' : 'move';
      
      console.log(`Operation type: ${operationType} (oldParent: ${oldParentPath}, newParent: ${newParentPath}, oldName: ${oldFileName}, newName: ${fileName})`);
      
      // Only create a pending operation if the file has been uploaded to ArDrive
      if (existingFileInfo?.arweaveId || existingFileInfo?.arfsFileId) {
        // For move operations, ensure we have the parent folder ID
        if (operationType === 'move' && !parentArfsFolderId) {
          console.error(`Cannot create move operation: parent folder ${newParentPath} not found in ArDrive`);
          // TODO: We should queue this operation for when the parent folder is uploaded
          return;
        }
        
        // Get the active drive mapping to ensure we have the correct driveId
        const mappings = await this.databaseManager.getDriveMappings();
        const activeMapping = mappings.find((m: any) => m.isActive);
        const driveId = activeMapping?.driveId || this.driveId || undefined;
        
        // Create a move/rename operation in pending uploads
        const moveOperation: Omit<PendingUpload, 'createdAt'> = {
          id: crypto.randomUUID(),
          driveId: driveId,
          localPath: newPath,
          fileName: fileName,
          fileSize: fileStats.size,
          mimeType: existingFileInfo.mimeType || 'application/octet-stream',
          // Honest values (MONEY-6): a move/rename is a metadata-only tx,
          // well under the Turbo free tier — nothing synthetic
          estimatedCost: 0,
          estimatedTurboCost: 0,
          recommendedMethod: 'turbo', // Metadata operations are tiny, perfect for Turbo
          hasSufficientTurboBalance: true,
          conflictType: 'none',
          status: 'awaiting_approval',
          operationType: operationType,
          previousPath: oldPath,
          arfsFileId: existingFileInfo.arfsFileId || existingFileInfo.arweaveId,
          metadata: {
            newParentFolderId: parentArfsFolderId
          }
        };
        
        await this.databaseManager.addPendingUpload(moveOperation);
        
        // Notify UI about the new pending operation
        this.notifyRenderer('sync:pending-uploads-updated');
        
        console.log(`Move operation added to pending queue for: ${fileName}`);
      } else {
        // File hasn't been uploaded yet, just update local tracking
        console.log(`File not yet uploaded to ArDrive, updating local path only: ${fileName}`);
        
        // Update the existing pending upload if there is one
        const pendingUploads = await this.databaseManager.getPendingUploads();
        const existingPending = pendingUploads.find(p => p.localPath === oldPath);
        
        if (existingPending) {
          await this.databaseManager.updatePendingUpload(existingPending.id, {
            localPath: newPath,
            fileName: fileName
          });
          console.log(`Updated pending upload path: ${oldPath} -> ${newPath}`);
        }
      }
      
      // Update file path in database
      await this.databaseManager.updateFilePath(existingFileInfo?.id || fileHash, newPath);
      
    } catch (error) {
      console.error(`Error handling file move:`, error);
      // Don't throw - allow the file to be processed as new if move handling fails
    }
  }

  // Public methods to access download manager functionality
  async queueDownload(fileData: any, priority: number = 0): Promise<void> {
    return this.downloadManager.queueDownload(fileData, priority);
  }

  async cancelDownload(fileId: string): Promise<void> {
    return this.downloadManager.cancelDownload(fileId);
  }

  async getQueueStatus(): Promise<{ queued: number; active: number; total: number }> {
    return this.downloadManager.getQueueStatus();
  }
  
  async getQueuedDownloads(limit: number = 30): Promise<any[]> {
    return this.downloadManager.getQueuedDownloads(limit);
  }
  
  private async cleanupTempFiles(): Promise<void> {
    if (!this.syncFolderPath) return;
    
    try {
      console.log('Cleaning up temporary .downloading files...');
      const tempFiles = await this.findTempFiles(this.syncFolderPath);
      
      for (const tempFile of tempFiles) {
        try {
          await fs.unlink(tempFile);
          console.log(`Removed orphaned temp file: ${tempFile}`);
        } catch (error) {
          console.error(`Failed to remove temp file ${tempFile}:`, error);
        }
      }
      
      if (tempFiles.length > 0) {
        console.log(`Cleaned up ${tempFiles.length} orphaned .downloading files`);
      }
    } catch (error) {
      console.error('Error during temp file cleanup:', error);
    }
  }
  
  private async findTempFiles(dir: string): Promise<string[]> {
    const tempFiles: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findTempFiles(fullPath);
          tempFiles.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith('.downloading')) {
          tempFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
    
    return tempFiles;
  }
}