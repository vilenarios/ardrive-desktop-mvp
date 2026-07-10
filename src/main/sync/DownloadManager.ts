import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ArDrive, EID, FolderID, DriveSyncState, IncrementalSyncResult } from 'ardrive-core-js';
import { DatabaseManager } from '../database-manager';
import { IFileStateManager, ISyncProgressTracker } from './interfaces';
// FileHashVerifier no longer needed - we get hash from streaming download
import { StreamingDownloader } from './StreamingDownloader';
import { BrowserWindow } from 'electron';
import { driveKeyManager } from '../drive-key-manager';
import { runWithGatewayFailover } from './gateway-failover';
import { incrementalSyncService } from './incremental-sync-service';
import { notificationService } from '../notification-service';
import { overlayStatusPublisher, OVERLAYS_ENABLED } from '../overlay-status-publisher';

export class DownloadManager {
  private isDownloading = false;
  private downloadQueue: Map<string, any> = new Map();
  private activeDownloads: Set<string> = new Set();
  private maxConcurrentDownloads = 3; // Allow 3 concurrent downloads for better throughput
  private streamingDownloader: StreamingDownloader;
  
  // Progress batching
  private progressBatch: Map<string, any> = new Map();
  private progressFlushInterval: NodeJS.Timeout | null = null;
  private lastProgressUpdate: Map<string, number> = new Map();
  
  // Queue processing control
  private queueProcessingTimeout: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;
  private failedDownloads: Map<string, number> = new Map(); // Track retry counts
  private maxRetries = 3;
  
  // Memory cleanup
  private memoryCleanupInterval: NodeJS.Timeout | null = null;
  
  // Debug logging control
  private DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG_DOWNLOADS === 'true';
  
  // Silent mode control
  private silent = false;

  // UX-36: download-complete notification. We coalesce the background queue
  // into ONE toast per drain (not one per file — that would spam), tracking how
  // many files completed since the queue was last empty and the last file's
  // name/path so a single-file batch can reveal it directly.
  private batchDownloadCount = 0;
  private lastDownloadedFile: { name: string; localPath: string } | null = null;

  constructor(
    private databaseManager: DatabaseManager,
    private fileStateManager: IFileStateManager,
    private progressTracker: ISyncProgressTracker,
    private arDrive: ArDrive | null,
    private driveId: string | null,
    private rootFolderId: string | null,
    private syncFolderPath: string | null
  ) {
    this.streamingDownloader = new StreamingDownloader();
    this.startProgressBatching();
    this.startMemoryCleanup();
  }
  
  private startProgressBatching(): void {
    // Flush progress updates every second
    this.progressFlushInterval = setInterval(() => {
      this.flushProgressBatch();
    }, 1000);
  }
  
  private startMemoryCleanup(): void {
    // Run memory cleanup every 30 seconds
    this.memoryCleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, 30000);
  }
  
  private performMemoryCleanup(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute
    
    // Clean up stale progress updates
    let cleanedCount = 0;
    for (const [fileId, lastUpdate] of this.lastProgressUpdate) {
      if (now - lastUpdate > staleThreshold && !this.activeDownloads.has(fileId)) {
        this.lastProgressUpdate.delete(fileId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`Memory cleanup: removed ${cleanedCount} stale progress tracking entries`);
    }
    
    // Clean up failed downloads that have exceeded retries
    const failedToRemove: string[] = [];
    for (const [fileId, retryCount] of this.failedDownloads) {
      if (retryCount >= this.maxRetries && !this.downloadQueue.has(fileId)) {
        failedToRemove.push(fileId);
      }
    }
    
    for (const fileId of failedToRemove) {
      this.failedDownloads.delete(fileId);
      this.lastProgressUpdate.delete(fileId);
    }
    
    if (failedToRemove.length > 0) {
      console.log(`Memory cleanup: removed ${failedToRemove.length} failed download entries`);
    }
    
    // Log memory status
    if (this.DEBUG) {
      console.log('Memory status:', {
        downloadQueue: this.downloadQueue.size,
        activeDownloads: this.activeDownloads.size,
        progressBatch: this.progressBatch.size,
        lastProgressUpdate: this.lastProgressUpdate.size,
        failedDownloads: this.failedDownloads.size
      });
    }
  }
  
  private async flushProgressBatch(): Promise<void> {
    if (this.progressBatch.size === 0) return;
    
    // Get all pending updates
    const updates = Array.from(this.progressBatch.entries());
    this.progressBatch.clear();
    
    // Update database for each file
    for (const [downloadId, progressData] of updates) {
      try {
        await this.databaseManager.updateDownload(downloadId, {
          progress: progressData.progress
        });
        
        // Emit to UI
        this.progressTracker.emitDownloadProgress(progressData);
        
        // Clean up completed downloads from lastProgressUpdate
        if (progressData.progress === 100 || progressData.status === 'completed') {
          this.lastProgressUpdate.delete(downloadId);
        }
      } catch (error) {
        console.error(`Failed to update progress for ${downloadId}:`, error);
      }
    }
  }
  
  private queueProgressUpdate(downloadId: string, progressData: any): void {
    const now = Date.now();
    const lastUpdate = this.lastProgressUpdate.get(downloadId) || 0;
    
    // Always queue completion updates
    if (progressData.progress === 100 || progressData.status === 'completed') {
      this.progressBatch.set(downloadId, progressData);
      this.lastProgressUpdate.set(downloadId, now);
      return;
    }
    
    // Throttle other updates to once per second per file
    if (now - lastUpdate > 1000) {
      this.progressBatch.set(downloadId, progressData);
      this.lastProgressUpdate.set(downloadId, now);
    }
  }
  
  clearQueue(): void {
    const queueSize = this.downloadQueue.size;
    const activeSize = this.activeDownloads.size;
    
    // Cancel any active downloads
    this.streamingDownloader.cancelAllDownloads();
    
    // Clear download tracking
    this.downloadQueue.clear();
    this.activeDownloads.clear();
    this.failedDownloads.clear();
    
    // Clear progress tracking
    this.progressBatch.clear();
    this.lastProgressUpdate.clear();
    
    // Stop queue processing
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
      this.queueProcessingTimeout = null;
    }
    
    this.isProcessingQueue = false;
    this.isDownloading = false;
    
    console.log(`Cleared download queue (removed ${queueSize} queued, ${activeSize} active downloads)`);
  }

  /**
   * SYNC-4: re-arms the intervals destroy() cleared. Called from
   * SyncManager.startSync so a stop -> start cycle (or drive switch) leaves
   * download progress batching and memory cleanup alive.
   */
  ensureStarted(): void {
    if (!this.progressFlushInterval) {
      this.startProgressBatching();
    }
    if (!this.memoryCleanupInterval) {
      this.startMemoryCleanup();
    }
  }

  destroy(): void {
    // Stop all timers
    if (this.progressFlushInterval) {
      clearInterval(this.progressFlushInterval);
      this.progressFlushInterval = null;
    }
    
    if (this.memoryCleanupInterval) {
      clearInterval(this.memoryCleanupInterval);
      this.memoryCleanupInterval = null;
    }
    
    // Clear queue and active downloads
    this.clearQueue();
    
    // Clean up progress tracker
    if (this.progressTracker && typeof this.progressTracker.destroy === 'function') {
      this.progressTracker.destroy();
    }
    
    console.log('DownloadManager destroyed and memory cleaned up');
  }
  
  private emitFileStateChange(fileId: string, syncStatus: string): void {
    try {
      // Emit file state change event to UI
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('sync:file-state-changed', { fileId, syncStatus });
      }
    } catch (error) {
      // Window was destroyed, ignore
      console.debug('Cannot emit file state change - window not available');
    }

    // FEAT-9 Phase 0: this is the central emit site for all real download
    // state transitions (queued/downloading/synced/failed) - the two sites in
    // main.ts only cover the cloud_only toggle. No-op while OVERLAYS_ENABLED
    // is false; errors are swallowed so a badge-snapshot hiccup can never
    // interrupt an actual download.
    if (OVERLAYS_ENABLED) {
      overlayStatusPublisher.updateFileStatus(fileId, syncStatus).catch((error) => {
        console.debug('[OverlayStatusPublisher] updateFileStatus failed:', error);
      });
    }
  }

  setArDrive(arDrive: ArDrive | null): void {
    this.arDrive = arDrive;
  }

  setDriveInfo(driveId: string, rootFolderId: string, syncFolderPath: string): void {
    this.driveId = driveId;
    this.rootFolderId = rootFolderId;
    this.syncFolderPath = syncFolderPath;
  }
  
  setSilentMode(silent: boolean): void {
    this.silent = silent;
  }

  async syncDriveMetadata(): Promise<void> {
    if (!this.silent) {
      this.progressTracker.emitSyncProgress({
        phase: 'metadata',
        description: 'Discovering drive contents...'
      });
    }

    console.log('Syncing drive metadata to cache...');

    if (!this.driveId) {
      console.error('No drive ID available');
      return;
    }

    // Get the mapping ID for this drive
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      console.error('No mapping found for drive:', this.driveId);
      return;
    }

    const isPrivate = mapping.drivePrivacy === 'private';
    // Resolve the drive key up front. A locked private drive has no key: both the
    // incremental AND the full path need it, so we let the full path throw the
    // canonical 'Private drive is locked' (PRIV-5) rather than silently no-op.
    const driveKey: any = isPrivate ? driveKeyManager.getDriveKey(this.driveId) : null;
    const canIncremental = incrementalSyncService.isReady() && (!isPrivate || !!driveKey);

    // D-026: incremental delta-resync. Only when a prior sync state exists — a
    // first sync (or any doubt) falls back to the proven full listing below.
    if (canIncremental) {
      let priorState: DriveSyncState | undefined;
      try {
        priorState = await incrementalSyncService.loadState(this.driveId);
      } catch (error) {
        console.warn('[IncrementalSync] Failed to load prior sync state; using full listing:', error);
        priorState = undefined;
      }

      if (priorState) {
        try {
          const result = isPrivate
            ? await incrementalSyncService.syncPrivateDrive(this.driveId, driveKey, priorState)
            : await incrementalSyncService.syncPublicDrive(this.driveId, priorState);

          const applied = await this.applyIncrementalDelta(mapping, result);
          if (applied) {
            await incrementalSyncService.persistState(this.driveId, priorState, result.newSyncState);
            console.log(
              `[IncrementalSync] ${this.driveId}: delta applied — ${result.entities.length} changed entity(ies), ` +
              `${result.stats.fromNetwork} network reads, ${result.stats.totalProcessed} processed`
            );
            if (!this.silent) {
              this.progressTracker.emitSyncProgress({
                phase: 'metadata',
                description: 'Drive up to date'
              });
            }
            return;
          }

          // Delta touched folder structure (rename/move) or had unreachable
          // entities → a full re-list is the only way to keep descendant paths
          // correct. Reuse core's already-computed sync state (no extra traversal).
          console.log(`[IncrementalSync] ${this.driveId}: structural change in delta → full re-list`);
          await this.fullSyncDriveMetadata(mapping);
          await incrementalSyncService.persistState(this.driveId, priorState, result.newSyncState);
          return;
        } catch (error) {
          // Never regress correctness: any incremental failure → full listing.
          console.warn(`[IncrementalSync] ${this.driveId}: incremental sync failed, falling back to full listing:`, error);
          // fall through
        }
      }
    }

    // Full listing path: first sync, no prior state, incremental unavailable, or
    // fallback. After it succeeds, establish/refresh the sync state so the NEXT
    // sync can go incremental.
    await this.fullSyncDriveMetadata(mapping);
    if (canIncremental) {
      try {
        await this.establishSyncState(this.driveId, isPrivate, driveKey);
      } catch (error) {
        console.warn(`[IncrementalSync] ${this.driveId}: failed to establish sync state (next sync will full-list):`, error);
      }
    }
  }

  /**
   * D-026: after a first full listing (or a fallback), capture and persist the
   * drive's DriveSyncState so subsequent syncs can resume incrementally. This
   * lists the drive once via core's incremental sync with NO prior state (full
   * traversal from genesis) purely to compute the state — it is read-only and
   * runs at most once per drive (every later sync takes the incremental path).
   */
  private async establishSyncState(
    driveId: string,
    isPrivate: boolean,
    driveKey: any
  ): Promise<void> {
    const result = isPrivate
      ? await incrementalSyncService.syncPrivateDrive(driveId, driveKey)
      : await incrementalSyncService.syncPublicDrive(driveId);
    await incrementalSyncService.persistState(driveId, undefined, result.newSyncState);
    console.log(
      `[IncrementalSync] ${driveId}: established initial sync state @ block ` +
      `${result.newSyncState.lastSyncedBlockHeight} (${result.entities.length} entities)`
    );
  }

  /**
   * D-026: apply an incremental delta to the metadata cache WITHOUT clearing it.
   * Returns true if the delta was safely applied; false if the caller must fall
   * back to a full re-list (structural folder change or unreachable entities,
   * where descendant paths could otherwise go stale). Never drops entities: it
   * only upserts the changed ones, leaving unchanged rows exactly as they were.
   */
  private async applyIncrementalDelta(
    mapping: any,
    result: IncrementalSyncResult
  ): Promise<boolean> {
    // Ownership/permission changes make previously-known entities unreachable;
    // only a full re-list reflects removals correctly.
    if (result.changes?.unreachable && result.changes.unreachable.length > 0) {
      return false;
    }

    const changed = result.entities;
    if (!changed || changed.length === 0) {
      // Nothing new since the reorg look-back window — no cache mutation needed.
      return true;
    }

    // Build folderId -> {name, parentFolderId} from existing DB folders, then
    // overlay delta folders (a delta revision wins). Used to reconstruct paths.
    const existing = await this.databaseManager.getDriveMetadata(mapping.id);
    const existingByFileId = new Map<string, any>();
    const folderById = new Map<string, { name: string; parentFolderId?: string }>();
    for (const row of existing) {
      const fid = String(row.fileId);
      existingByFileId.set(fid, row);
      if (row.type === 'folder') {
        folderById.set(fid, {
          name: row.name,
          parentFolderId: row.parentFolderId ? String(row.parentFolderId) : undefined
        });
      }
    }
    for (const e of changed) {
      if (e.entityType === 'folder') {
        folderById.set(String(e.entityId), {
          name: e.name,
          parentFolderId: e.parentFolderId ? String(e.parentFolderId) : undefined
        });
      }
    }

    const rootFolderId = this.rootFolderId ? String(this.rootFolderId) : undefined;

    // Full relative path of a folder (its containing dir + its own name); '' at
    // the drive root. Throws on an unknown/cyclic parent so the caller falls back
    // to a full listing rather than writing a wrong path.
    const folderFullPath = (folderId: string, seen: Set<string> = new Set()): string => {
      if (rootFolderId && folderId === rootFolderId) return '';
      if (seen.has(folderId)) throw new Error(`cycle resolving folder path at ${folderId}`);
      seen.add(folderId);
      const info = folderById.get(folderId);
      if (!info) throw new Error(`unknown parent folder ${folderId}`);
      const parentPath = info.parentFolderId ? folderFullPath(info.parentFolderId, seen) : '';
      return parentPath ? `${parentPath}/${info.name}` : info.name;
    };
    // The directory that CONTAINS an entity = the full path of its parent folder.
    const containingDirOf = (parentFolderId: string | undefined): string =>
      parentFolderId ? folderFullPath(String(parentFolderId)) : '';

    // Validation pass: a folder rename/move (folder already in DB but with a new
    // containing path or name) shifts the paths of its unchanged, not-in-delta
    // descendants → a full re-list is required to keep them correct.
    for (const e of changed) {
      if (e.entityType !== 'folder') continue;
      const prior = existingByFileId.get(String(e.entityId));
      if (!prior) continue; // brand-new folder → safe to add
      let containingDir: string;
      try {
        containingDir = containingDirOf(e.parentFolderId ? String(e.parentFolderId) : undefined);
      } catch {
        return false;
      }
      if (String(prior.path ?? '') !== containingDir || String(prior.name) !== e.name) {
        return false;
      }
    }

    // Apply pass: upsert every changed entity with a reconstructed path. Upsert
    // is keyed on fileId, so a changed revision updates its row in place; nothing
    // is deleted, so unchanged entities survive untouched.
    for (const e of changed) {
      let containingDir: string;
      try {
        containingDir = containingDirOf(e.parentFolderId ? String(e.parentFolderId) : undefined);
      } catch {
        return false;
      }

      const isFile = e.entityType === 'file';
      const fileId = String(e.entityId);
      const prior = existingByFileId.get(fileId);

      let localFileExists = false;
      let syncStatus = prior?.syncStatus || 'pending';
      if (isFile && this.syncFolderPath) {
        const localPath = path.join(this.syncFolderPath, containingDir, e.name);
        try {
          await fs.access(localPath);
          localFileExists = true;
          if (syncStatus !== 'synced' && syncStatus !== 'cloud_only') {
            syncStatus = 'synced';
          }
        } catch {
          localFileExists = false;
          if (syncStatus === 'synced') {
            syncStatus = 'cloud_only';
          }
        }
      }

      await this.databaseManager.upsertDriveMetadata({
        mappingId: mapping.id,
        fileId,
        parentFolderId: e.parentFolderId ? String(e.parentFolderId) : undefined,
        name: e.name,
        path: containingDir,
        type: isFile ? 'file' : 'folder',
        size: isFile ? this.extractNumericSize((e as any).size) : undefined,
        lastModifiedDate: this.getUnixTimeAsNumber((e as any).lastModifiedDate),
        dataTxId: isFile && (e as any).dataTxId ? String((e as any).dataTxId) : undefined,
        // Incremental entities carry the metadata tx id (`txId`); the recursive
        // listPublicFolder path cannot, so this is strictly more information.
        metadataTxId: (e as any).txId ? String((e as any).txId) : undefined,
        contentType: isFile ? (e as any).dataContentType : undefined,
        localFileExists,
        syncStatus
      });
    }

    return true;
  }

  /**
   * Full metadata listing (the pre-D-026 behavior): clear the cache and rebuild
   * it from a recursive ArDrive folder walk. Used for first syncs and as the
   * incremental fallback. `mapping` is already resolved by the caller.
   */
  private async fullSyncDriveMetadata(mapping: any): Promise<void> {
    const mappingId = mapping.id;

    try {
      // Get existing sync status before clearing
      const existingMetadata = await this.databaseManager.getDriveMetadata(mappingId);
      const syncStatusMap = new Map<string, { syncStatus: string; localFileExists: boolean }>();
      existingMetadata.forEach((item: any) => {
        // Preserve ALL sync statuses - don't reset existing states
        syncStatusMap.set(item.fileId, {
          syncStatus: item.syncStatus || 'pending', // Default to pending for new items
          localFileExists: item.localFileExists || false
        });
      });
      console.log(`Preserving sync status for ${syncStatusMap.size} files`);
      
      // Clear existing metadata for clean sync
      await this.databaseManager.clearDriveMetadataCache(mappingId);
      
      // Start recursive listing from root folder
      if (!this.rootFolderId || !this.arDrive) {
        throw new Error('Root folder ID or ArDrive not available');
      }

      const items = await this.recursivelyListDriveContents(this.rootFolderId, '');
      console.log(`Found ${items.length} total items in drive`);
      
      // Sort items to ensure folders are processed before their contents
      const sortedItems = this.sortDriveItems(items);
      
      // Insert all metadata at once
      for (const item of sortedItems) {
        // Only log files with missing size for debugging
        if (item.type === 'file' && (!item.size || item.size === 0)) {
          console.warn(`⚠️ File missing size in metadata: ${item.name}`);
        }
        // Check if file exists locally RIGHT NOW before inserting
        let localFileExists = false;
        let syncStatus = syncStatusMap.get(item.arweaveId)?.syncStatus || 'pending';
        
        if (item.type === 'file' && this.syncFolderPath) {
          const localPath = path.join(this.syncFolderPath, item.path, item.name);
          try {
            await fs.access(localPath);
            localFileExists = true;
            // If file exists and wasn't marked as synced, update status
            if (syncStatus !== 'synced' && syncStatus !== 'cloud_only') {
              syncStatus = 'synced';
            }
          } catch (error) {
            // File doesn't exist
            localFileExists = false;
            // If it was marked as synced but doesn't exist, change to cloud_only
            if (syncStatus === 'synced') {
              syncStatus = 'cloud_only';
            }
          }
        }
        
        await this.databaseManager.upsertDriveMetadata({
          mappingId,
          fileId: item.arweaveId,
          parentFolderId: item.parentFolderId,
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size, // Don't double-convert - item.size is already a number from line 448
          lastModifiedDate: this.getUnixTimeAsNumber(item.lastModified),
          dataTxId: item.dataTxId,
          metadataTxId: item.metadataTxId, // Add metadataTxId storage
          contentType: item.mimeType,
          localFileExists: localFileExists,
          syncStatus: syncStatus
        });
      }
      
      console.log(`Inserted ${sortedItems.length} items into metadata cache`);
      console.log(`Found ${sortedItems.length} items in drive`);
      if (!this.silent) {
        this.progressTracker.emitSyncProgress({
          phase: 'metadata',
          description: `Found ${sortedItems.length} items`,
          itemsProcessed: sortedItems.length
        });
      }
      
      // File existence is now checked during upsert above, so we don't need this separate loop
      console.log('Metadata sync completed');
      
    } catch (error) {
      console.error('Failed to sync drive metadata:', error);
      throw error;
    }
  }

  async downloadMissingFiles(): Promise<void> {
    console.log('Checking for missing files to download...');
    
    if (!this.driveId || !this.syncFolderPath) {
      console.error('Drive ID or sync folder path not available');
      return;
    }

    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      console.error('No mapping found for drive');
      return;
    }

    // Get all files from metadata cache that don't exist locally
    const allMetadata = await this.databaseManager.getDriveMetadata(mapping.id);
    const missingFiles = allMetadata.filter(item => 
      item.type === 'file' && 
      !item.localFileExists &&
      item.syncStatus === 'pending'
    );

    console.log(`Found ${missingFiles.length} missing files to download`);

    // Create folders first
    const folders = allMetadata.filter(item => item.type === 'folder');
    for (const folder of folders) {
      const folderPath = path.join(this.syncFolderPath, folder.path, folder.name);
      try {
        await fs.mkdir(folderPath, { recursive: true });
        console.log(`Created folder: ${folderPath}`);
      } catch (error) {
        if ((error as any).code !== 'EEXIST') {
          console.error(`Failed to create folder ${folderPath}:`, error);
        }
      }
    }

    // Download missing files
    this.isDownloading = true;
    let downloaded = 0;
    let failed = 0;

    for (const file of missingFiles) {
      try {
        await this.downloadFile(file);
        downloaded++;
        console.log(`Downloaded ${downloaded}/${missingFiles.length} files`);
      } catch (error) {
        // SYNC-2: record the failure honestly and continue with the remaining files
        failed++;
        const errorMessage = error instanceof Error ? error.message : 'Download failed';
        console.error(`Download failed for ${file.name}: ${errorMessage}`);
        try {
          await this.databaseManager.updateFileSyncStatus(file.fileId, 'failed', errorMessage);
          this.emitFileStateChange(file.fileId, 'failed');
        } catch (dbError) {
          console.error(`Failed to record download failure for ${file.name}:`, dbError);
        }
      }
    }

    this.isDownloading = false;
    console.log(`Download completed: ${downloaded} files${failed > 0 ? `, ${failed} failed` : ''}`);
  }

  async downloadMissingFilesWithProgress(): Promise<void> {
    if (!this.silent) {
      this.progressTracker.emitSyncProgress({
        phase: 'files',
        description: 'Queueing files for download...'
      });
    }

    if (!this.driveId || !this.syncFolderPath) {
      throw new Error('Drive ID or sync folder path not available');
    }

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

    console.log(`Found ${missingFiles.length} missing files to queue for download`);

    // Queue all files for download with priorities (small files get higher priority)
    for (const file of missingFiles) {
      const priority = this.calculateDownloadPriority(file);
      await this.queueDownload(file, priority);
    }

    if (!this.silent) {
      this.progressTracker.emitSyncProgress({
        phase: 'files',
        description: `Queued ${missingFiles.length} files for background download`,
        progress: 100,
        itemsProcessed: missingFiles.length,
        totalItems: missingFiles.length
      });
    }

    console.log(`Queued ${missingFiles.length} files for background download`);
  }

  private calculateDownloadPriority(file: any): number {
    // Higher priority for smaller files (they download faster)
    const fileSize = file.size || 0;
    
    // Files under 1MB get high priority (100)
    if (fileSize < 1024 * 1024) {
      return 100;
    }
    
    // Files under 10MB get medium priority (50)
    if (fileSize < 10 * 1024 * 1024) {
      return 50;
    }
    
    // Large files get low priority (10)
    return 10;
  }

  private async downloadFile(fileData: any): Promise<void> {
    if (!this.syncFolderPath || !this.arDrive) {
      // SYNC-2: throw instead of silently returning - a silent return here made
      // callers record the file as synced without anything on disk
      throw new Error('Sync folder path or ArDrive not available');
    }

    // Validate file size before downloading
    const MAX_DOWNLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5GB limit
    const fileSize = fileData.size || 0;

    if (fileSize > MAX_DOWNLOAD_SIZE) {
      const tooLargeMessage = `File too large: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB`;
      console.error(`File ${fileData.name} is too large (${fileSize} bytes, max: ${MAX_DOWNLOAD_SIZE} bytes)`);
      await this.databaseManager.updateFileSyncStatus(fileData.fileId, 'failed', tooLargeMessage);
      this.emitFileStateChange(fileData.fileId, 'failed');

      // SYNC-2: throw so callers never overwrite the 'failed' status with 'synced'.
      // "File too large" is classified as a permanent error (no retry).
      throw new Error(tooLargeMessage);
    }

    const localFilePath = path.join(this.syncFolderPath, fileData.path, fileData.name);
    console.log(`Downloading: ${fileData.name}`);

    // Generate download ID for tracking
    const downloadId = crypto.randomUUID();

    try {
      // Create download record in database
      // The file size should already be a number from the metadata cache
      // No need to process it again
      const fileSize = fileData.size || 0;
      
      // Only log if there's an issue with the download data
      if (!fileData.size || fileSize === 0 || !fileData.metadataTxId) {
        console.warn(`⚠️ Download record issue for ${fileData.name}:`, {
          size: fileData.size,
          hasMetadataTxId: !!fileData.metadataTxId
        });
      }
      
      await this.databaseManager.addDownload({
        id: downloadId,
        driveId: this.driveId || undefined,
        fileName: fileData.name,
        localPath: localFilePath,
        fileSize: fileSize, // Use the fileSize from metadata, not processedSize
        fileId: fileData.fileId,
        dataTxId: fileData.dataTxId,
        metadataTxId: fileData.metadataTxId,
        status: 'downloading',
        progress: 0
      });

      // Create directory if it doesn't exist
      const dir = path.dirname(localFilePath);
      await fs.mkdir(dir, { recursive: true });

      // CRITICAL: Add file to recently downloaded BEFORE downloading
      // This prevents the file watcher from picking it up. SYNC-13: tracked
      // as an "expected download" keyed by path + expected size, cleared
      // explicitly on finalize (see clearDownload below) rather than after a
      // fixed timeout - large/slow downloads can take far longer than the
      // old 30s window, which let them fall through as false "new local
      // file" adds and re-upload (a feedback loop that spends real money).
      this.fileStateManager.markAsDownloaded(localFilePath, fileSize);

      // Check if this file is already being downloaded
      if (this.fileStateManager.isDownloading(localFilePath)) {
        console.log(`File is already being downloaded: ${localFilePath}`);
        await this.fileStateManager.getDownloadPromise(localFilePath);
        return;
      }
      
      // Pre-register the file in the processed database with a placeholder
      const downloadTimestamp = Date.now();
      const placeholderHash = `downloading-${fileData.fileId}-${downloadTimestamp}`;
      
      // Create a promise for this download
      const downloadPromise = this.performFileDownload(fileData, localFilePath, dir, downloadId, placeholderHash);
      this.fileStateManager.setDownloadPromise(localFilePath, downloadPromise);
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
      } catch (dbError) {
        console.warn('Failed to pre-register file, continuing with download:', dbError);
      }

      try {
        await downloadPromise;
      } finally {
        // Remove from tracking when done
        this.fileStateManager.clearDownload(localFilePath);
      }
    } catch (error) {
      console.error(`Failed to download file ${fileData.name}:`, error);
      console.error('Download error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        localFilePath,
        fileData
      });
      // SYNC-2: propagate the failure so callers record it honestly instead of
      // marking the file synced (the old swallow made every download "succeed")
      throw error;
    }
  }

  /** PRIV-1: is the active drive for this manager a private drive? */
  private async isPrivateDriveDownload(): Promise<boolean> {
    if (!this.driveId) return false;
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find((m) => m.driveId === this.driveId);
    return mapping?.drivePrivacy === 'private';
  }

  /**
   * PRIV-1: download + decrypt a private file via ardrive-core-js.
   *
   * downloadPrivateFile fetches the ciphertext and writes decrypted plaintext.
   * It offers no incremental progress events, so private downloads emit
   * start/complete only. Written to a `.downloading`-suffixed temp name first
   * (the watcher ignores that suffix and startup cleanup removes orphans),
   * then renamed into place — parity with StreamingDownloader's atomic rename.
   * Returns the sha256 of the decrypted plaintext.
   */
  private async downloadPrivateFileDecrypted(
    fileData: any,
    localFilePath: string,
    downloadId: string
  ): Promise<string> {
    if (!this.arDrive) {
      throw new Error('ArDrive not available for private download');
    }
    const driveKey = driveKeyManager.getDriveKey(this.driveId!);
    if (!driveKey) {
      throw new Error(`Private drive is locked — unlock it to download "${fileData.name}"`);
    }
    
    const dir = path.dirname(localFilePath);
    const finalName = path.basename(localFilePath);
    const tempName = `${finalName}.downloading`;
    const tempPath = path.join(dir, tempName);
    
    console.log(`Downloading private file ${fileData.name} with decryption (fileId: ${fileData.fileId})`);
    this.queueProgressUpdate(downloadId, {
      downloadId,
      fileName: fileData.name,
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: fileData.size || 0,
      speed: 0,
      remainingTime: 0
    });
    
    await this.arDrive.downloadPrivateFile({
      fileId: EID(fileData.fileId),
      driveKey,
      destFolderPath: dir,
      defaultFileName: tempName
    });
    
    // Atomic-ish move into place
    await fs.rename(tempPath, localFilePath);
    
    const plaintext = await fs.readFile(localFilePath);
    const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
    
    this.progressTracker.emitDownloadProgress({
      downloadId,
      fileName: fileData.name,
      progress: 100,
      bytesDownloaded: plaintext.length,
      totalBytes: plaintext.length,
      speed: 0,
      remainingTime: 0
    });
    
    console.log(`✓ Private file decrypted to plaintext: ${fileData.name} (${plaintext.length} bytes)`);
    return hash;
  }

  private async performFileDownload(fileData: any, localFilePath: string, dir: string, downloadId: string, placeholderHash: string): Promise<void> {
    try {
      // PRIV-1: files in private drives are ciphertext at the raw gateway
      // URL — the old path wrote encrypted bytes to the sync folder. Route
      // them through ardrive-core's downloadPrivateFile, which fetches AND
      // decrypts to plaintext. Privacy is decided FIRST: ArFS manifests are
      // public-only (core exposes only uploadPublicManifest), so a
      // manifest-looking NAME inside a private drive is just an ordinary
      // encrypted file — the raw manifest fetch must never apply to it
      // (qa-gate FAIL: the name heuristic bypassed decryption).
      const isPrivateDownload = await this.isPrivateDriveDownload();
      const isManifest = !isPrivateDownload && this.isManifestFile(fileData);
      let hash: string = ''; // Declare hash variable outside the if/else block
      
      if (isManifest) {
        console.log(`Detected manifest file: ${fileData.name}, using manifest download method`);
        const manifestResult = await this.downloadManifestFile(fileData, localFilePath, downloadId);
        hash = manifestResult.hash;
      } else if (isPrivateDownload) {
        hash = await this.downloadPrivateFileDecrypted(fileData, localFilePath, downloadId);
      } else {
        // Use streaming download for better reliability and progress tracking.
        // SYNC-17: gateway host is configurable (defaults to turbo-gateway.com).
        // StreamingDownloader follows the sandbox 302 (axios maxRedirects) and
        // retries with backoff, so a flapping 404/504 is not a hard failure.
        // SYNC-23: DATA fetches (by-txid) get ORDERED gateway FAILOVER. The
        // primary intermittently 404-storms data that IS available, so on
        // persistent failure we fall through to perma.online (serves this
        // owner's data 10/10) then arweave.net. StreamingDownloader already
        // retries each attempt internally, so the failover loop's per-gateway
        // retry is a single pass — the loop itself provides the cross-gateway
        // resilience (see sync/gateway-failover.ts).
        const downloadResult = await runWithGatewayFailover(
          (gatewayUrl) => {
            const downloadUrl = `${gatewayUrl}/${fileData.dataTxId}`;
            console.log(`Downloading file from: ${downloadUrl}`);
            return this.streamingDownloader.downloadFile(
              downloadUrl,
              localFilePath,
              downloadId,
              {
                onProgress: async (progress) => {
                  // Queue progress update instead of immediate database write
                  this.queueProgressUpdate(downloadId, {
                    downloadId,
                    fileName: fileData.name,
                    progress: progress.progress,
                    bytesDownloaded: progress.bytesDownloaded,
                    totalBytes: progress.totalBytes,
                    speed: progress.speed,
                    remainingTime: progress.remainingTime
                  });
                },
                maxRetries: 2,
                retryDelay: 1500,
                chunkSize: 2 * 1024 * 1024 // 2MB chunks for better performance
              }
            );
          },
          { label: `download ${fileData.name}`, retry: { attempts: 1 } }
        );

        // Use the hash from streaming download
        hash = downloadResult.hash;
      }

      // Verify the file was downloaded
      try {
        const stats = await fs.stat(localFilePath);
        const expectedSize = fileData.size || 0;
        
        // Always log size info for debugging the mismatch issue
        console.log(`Post-download size validation for ${fileData.name}:`);
        console.log(`  Expected size (metadata): ${expectedSize} bytes`);
        console.log(`  Actual size (on disk): ${stats.size} bytes`);
        console.log(`  Size type: ${typeof fileData.size}`);
        console.log(`  Data TX ID: ${fileData.dataTxId}`);
        
        // Size validation is tricky because:
        // 1. The metadata size might be the original uncompressed size
        // 2. The downloaded content might have been compressed during transfer
        // 3. Text files (HTML/JS) often compress significantly (50-80% reduction)
        
        if (expectedSize > 0) {
          // Only validate that we got a reasonable amount of content
          if (stats.size === 0) {
            throw new Error(`Downloaded file is empty: ${fileData.name}`);
          }
          
          // Log size differences for debugging but don't fail
          const sizeDiff = Math.abs(stats.size - expectedSize);
          const percentDiff = (sizeDiff / expectedSize) * 100;
          
          if (stats.size !== expectedSize) {
            console.log(`Size difference for ${fileData.name}: expected ${expectedSize}, got ${stats.size} (${percentDiff.toFixed(2)}% ${stats.size < expectedSize ? 'smaller' : 'larger'})`);
            
            // Common for text files to be different sizes due to compression
            const fileExt = path.extname(fileData.name).toLowerCase();
            if (['.html', '.js', '.css', '.json', '.xml', '.txt', '.md'].includes(fileExt)) {
              console.log(`  Note: Text file size differences are common due to compression during transfer`);
            }
          }
        }
        
        console.log(`✓ File size verified for ${fileData.name}: ${stats.size} bytes`);
        
        // Update download record as completed
        // Don't update fileSize - we already have the correct size from metadata
        await this.databaseManager.updateDownload(downloadId, {
          status: 'completed',
          progress: 100
        });
        
        // We already have the hash from streaming download
        console.log(`Download complete with hash for ${fileData.name}: ${hash.substring(0, 16)}... (full: ${hash})`);
        console.log(`File size from metadata: ${fileData.size}, actual size: ${stats.size}`);
        
        // Remove the placeholder entry and add the real one
        try {
          // Remove the specific placeholder entry
          await this.databaseManager.removeProcessedFile(placeholderHash);
          console.log(`Removed placeholder hash: ${placeholderHash}`);
          
          // Also remove any other placeholder entries for this file (in case of retries)
          const processedFiles = await this.databaseManager.getProcessedFiles();
          const otherPlaceholders = processedFiles.filter(f => 
            f.fileHash.startsWith(`downloading-${fileData.fileId}-`) && 
            f.localPath === localFilePath &&
            f.fileHash !== placeholderHash
          );
          
          for (const placeholder of otherPlaceholders) {
            await this.databaseManager.removeProcessedFile(placeholder.fileHash);
            console.log(`Removed additional placeholder hash: ${placeholder.fileHash}`);
          }
          
          // Add the file with the real hash
          await this.databaseManager.addProcessedFile(
            hash,
            fileData.name,
            fileData.size,  // Use metadata size, not file system size
            localFilePath,
            'download',
            fileData.fileId
          );
          console.log(`Added file with real hash: ${hash.substring(0, 16)}...`);
          
          // Log hash comparison if we have the metadata hash
          if (fileData.dataContentHash) {
            console.log(`Hash comparison - metadata: ${fileData.dataContentHash.substring(0, 16)}..., calculated: ${hash.substring(0, 16)}...`);
            if (fileData.dataContentHash !== hash) {
              console.warn(`⚠️ Hash mismatch! Metadata hash differs from calculated hash`);
            }
          }
        } catch (dbError) {
          console.error('Failed to update processed file hash:', dbError);
        }
        
        console.log(`✓ Downloaded: ${fileData.name} (${fileData.size} bytes)`);
        
      } catch (verifyError) {
        console.error('Failed to verify downloaded file:', verifyError);
        throw verifyError;
      }
      
    } catch (downloadError) {
      console.error(`ArDrive download failed for ${fileData.name}:`, downloadError);
      
      // Update download record as failed
      await this.databaseManager.updateDownload(downloadId, {
        status: 'failed',
        error: downloadError instanceof Error ? downloadError.message : 'Download failed'
      });
      
      throw downloadError;
    }
  }

  private async recursivelyListDriveContents(folderId: string, parentPath: string): Promise<any[]> {
    const items: any[] = [];
    
    try {
      // Check if drive is private to use the correct listing method
      let isPrivateDrive = false;
      let driveKey: any = null;
      
      if (this.driveId) {
        const mappings = await this.databaseManager.getDriveMappings();
        const mapping = mappings.find(m => m.driveId === this.driveId);
        isPrivateDrive = mapping?.drivePrivacy === 'private';
        
        if (isPrivateDrive) {
          // Get the drive key from the manager
          driveKey = driveKeyManager.getDriveKey(this.driveId);
          
          if (!driveKey) {
            console.error('Private drive is locked - cannot list contents');
            throw new Error('Private drive is locked');
          }
        }
      }
      
      // List folder contents using the appropriate method
      let folderContents: any[];
      if (isPrivateDrive && driveKey) {
        console.log(`Listing private folder ${folderId} with decryption key...`);
        folderContents = await this.arDrive!.listPrivateFolder({
          folderId: EID(folderId),
          driveKey
        });
      } else {
        folderContents = await this.arDrive!.listPublicFolder({
          folderId: EID(folderId)
        });
      }
      
      // Only log folder listing for root folder to reduce noise
      if (parentPath === '') {
        console.log(`Listing root folder contents (${isPrivateDrive ? 'private' : 'public'} drive)...`);
      }
      
      // Process folders (filter to get only folders)
      const folders = folderContents.filter(item => item.entityType === 'folder');
      for (const folder of folders) {
        const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name;
        items.push({
          type: 'folder',
          name: folder.name,
          path: parentPath,
          arweaveId: folder.folderId.toString(),
          parentFolderId: folderId,
          lastModified: folder.lastModifiedDate
        });
        
        // Recursively list subfolder contents
        const subItems = await this.recursivelyListDriveContents(folder.folderId.toString(), folderPath);
        items.push(...subItems);
      }
      
      // Process files (filter to get only files)
      const files = folderContents.filter(item => item.entityType === 'file');
      for (const file of files) {
        // ArDrive core returns size as a ByteCount / BigNumber-like object that
        // needs special handling to get the actual byte value (shared helper).
        const fileSize: any = file.size;
        const numericSize: number = this.extractNumericSize(fileSize);

        // Log size details for debugging
        if (this.DEBUG && (file.name.includes('video') || file.name.includes('movie') || numericSize > 10 * 1024 * 1024)) {
          console.log(`Large file metadata - ${file.name}:`, {
            originalSize: fileSize,
            numericSize,
            dataTxId: file.dataTxId.toString(),
            dataContentType: file.dataContentType
          });
        }
        
        items.push({
          type: 'file',
          name: file.name,
          path: parentPath,
          size: numericSize, // Use the converted numeric value, not the ByteCount object
          arweaveId: file.fileId.toString(),
          fileId: file.fileId.toString(),
          dataTxId: file.dataTxId.toString(),
          metadataTxId: undefined, // Not available from ardrive-core-js listPublicFolder API
          parentFolderId: folderId,
          lastModified: file.lastModifiedDate,
          mimeType: file.dataContentType
        });
      }
      
    } catch (error) {
      // PRIV-5: never swallow listing failures — a locked private drive (or
      // any listing error) previously fell through to an EMPTY item list,
      // which upstream recorded as a successful empty sync (and the metadata
      // cache had already been cleared). Partial listings are lies; abort.
      console.error(`Failed to list contents of folder ${folderId}:`, error);
      throw error;
    }
    
    return items;
  }

  private sortDriveItems(items: any[]): any[] {
    return items.sort((a, b) => {
      // Folders come before files
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      
      // Within same type, sort by path depth (shallower first)
      const depthA = (a.path.match(/\//g) || []).length;
      const depthB = (b.path.match(/\//g) || []).length;
      
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      
      // Same depth, sort alphabetically by full path
      const fullPathA = `${a.path}/${a.name}`;
      const fullPathB = `${b.path}/${b.name}`;
      return fullPathA.localeCompare(fullPathB);
    });
  }

  async createAllFolders(): Promise<void> {
    if (!this.driveId || !this.syncFolderPath) {
      console.error('Drive ID or sync folder path not available');
      return;
    }

    if (!this.silent) {
      this.progressTracker.emitSyncProgress({
        phase: 'folders',
        description: 'Creating folder structure...'
      });
    }

    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      console.error('No mapping found for drive');
      return;
    }

    const allMetadata = await this.databaseManager.getDriveMetadata(mapping.id);
    const folders = allMetadata.filter(item => item.type === 'folder');
    
    console.log(`Creating ${folders.length} folders...`);
    let created = 0;

    for (const folder of folders) {
      if (!this.silent) {
        this.progressTracker.emitSyncProgress({
          phase: 'folders',
          description: 'Creating folder structure...',
          currentItem: folder.name,
          progress: Math.round((created / folders.length) * 100),
          itemsProcessed: created,
          totalItems: folders.length
        });
      }

      const folderPath = path.join(this.syncFolderPath, folder.path, folder.name);
      try {
        await fs.mkdir(folderPath, { recursive: true });
        created++;
      } catch (error) {
        if ((error as any).code !== 'EEXIST') {
          console.error(`Failed to create folder ${folderPath}:`, error);
        } else {
          created++;
        }
      }
    }

    console.log(`Folder creation completed: ${created}/${folders.length}`);
  }

  async verifySyncState(): Promise<void> {
    if (!this.silent) {
      this.progressTracker.emitSyncProgress({
        phase: 'verification',
        description: 'Verifying sync completeness...'
      });
    }

    console.log('Verifying sync state...');
    // Verification logic can be added here if needed
  }

  isDownloadInProgress(): boolean {
    return this.isDownloading;
  }

  private getFileSizeAsNumber(size: any): number {
    if (!size) return 0;
    
    // If it's already a number, return it
    if (typeof size === 'number') return size;
    
    // If it's an object (likely BigNumber or similar)
    if (typeof size === 'object') {
      // Try toNumber() first (common in BigNumber libraries)
      if (typeof size.toNumber === 'function') {
        return size.toNumber();
      }
      
      // Try valueOf()
      if (typeof size.valueOf === 'function') {
        const numValue = size.valueOf();
        // Make sure we got a number
        if (typeof numValue === 'number') {
          return numValue;
        }
      }
      
      // Check for ethers.js BigNumber format
      if (size._hex) {
        return parseInt(size._hex, 16);
      }
      
      // Check for BN.js format
      if (size.words && Array.isArray(size.words)) {
        // This is more complex, but try toString() first
        if (typeof size.toString === 'function') {
          const strValue = size.toString(10);
          const parsed = parseInt(strValue, 10);
          return isNaN(parsed) ? 0 : parsed;
        }
      }
    }
    
    // Try to parse as string
    const parsed = Number(size);
    return isNaN(parsed) ? 0 : parsed;
  }

  private getUnixTimeAsNumber(time: any): number | undefined {
    if (!time) return undefined;
    if (typeof time === 'number') return time;
    if (time.unixTime) return time.unixTime;
    return undefined;
  }

  /**
   * Extract a byte count as a plain number from ardrive-core-js's ByteCount
   * (or BigNumber-like) values, which cross as objects. Shared by the full
   * recursive listing and the incremental delta path.
   */
  private extractNumericSize(size: any): number {
    if (size && typeof size === 'object') {
      if (typeof size.toNumber === 'function') return size.toNumber();
      if (typeof size.valueOf === 'function') return Number(size.valueOf()) || 0;
      if (size._hex) return parseInt(size._hex, 16);
      return 0;
    }
    return Number(size) || 0;
  }

  private isManifestFile(fileData: any): boolean {
    // Check if file is a manifest based on:
    // 1. Content type (if available)
    // 2. File name pattern (ends with .json and contains 'manifest')
    
    const fileName = fileData.name.toLowerCase();
    const contentType = fileData.contentType || fileData.mimeType || '';
    
    // Check content type first (most reliable)
    if (contentType.includes('x.arweave-manifest') || contentType.includes('manifest+json')) {
      return true;
    }
    
    // Check file name pattern
    if (fileName.endsWith('.json') && 
        (fileName.includes('manifest') || fileName.includes('.arweave-manifest'))) {
      return true;
    }
    
    // Additional check: ArDrive manifests often have specific naming patterns
    if (fileName === 'drivemanifest.json' || 
        fileName === 'arweave-manifest.json' ||
        fileName.endsWith('.arweave-manifest.json')) {
      return true;
    }
    
    return false;
  }

  private async downloadManifestFile(fileData: any, localFilePath: string, downloadId: string): Promise<{ hash: string }> {
    try {
      // SYNC-18: turbo-gateway.com's /raw/<txid> endpoint returns 504 — it only
      // serves data via the sandbox-redirected GET /<txid> path (same as every
      // other data fetch in this file, see the non-manifest branch above).
      // Manifests are public-only (core exposes only uploadPublicManifest), so
      // there is no private/decryption concern here — just fetch the same tx
      // through the working URL shape instead of /raw/. This also works
      // unchanged on arweave.net-style gateways, which serve plain data at
      // GET /<txid> too.
      // SYNC-23: manifests are DATA fetches too — give them the same ordered
      // gateway failover as ordinary public files (see sync/gateway-failover.ts).
      const downloadResult = await runWithGatewayFailover(
        (gatewayUrl) => {
          const manifestUrl = `${gatewayUrl}/${fileData.dataTxId}`;
          console.log(`Downloading manifest from: ${manifestUrl}`);
          return this.streamingDownloader.downloadFile(
            manifestUrl,
            localFilePath,
            downloadId,
            {
              onProgress: async (progress) => {
                // Queue progress update instead of immediate database write
                this.queueProgressUpdate(downloadId, {
                  downloadId,
                  fileName: fileData.name,
                  progress: progress.progress,
                  bytesDownloaded: progress.bytesDownloaded,
                  totalBytes: progress.totalBytes,
                  speed: progress.speed,
                  remainingTime: progress.remainingTime
                });
              },
              maxRetries: 2,
              retryDelay: 1000
            }
          );
        },
        { label: `manifest ${fileData.name}`, retry: { attempts: 1 } }
      );

      console.log(`Successfully downloaded manifest to: ${localFilePath}`);
      
      // Return the hash from the download result
      return downloadResult;
    } catch (error) {
      console.error(`Failed to download manifest file:`, error);
      throw error;
    }
  }

  // Priority queue methods
  async queueDownload(fileData: any, priority: number = 0): Promise<void> {
    const fileId = fileData.fileId;
    
    // Check if already queued or downloading
    if (this.downloadQueue.has(fileId) || this.activeDownloads.has(fileId)) {
      console.log(`File ${fileData.name} is already queued or downloading`);
      return;
    }

    // Add to queue with priority
    this.downloadQueue.set(fileId, {
      ...fileData,
      priority,
      queuedAt: Date.now()
    });

    // Update database sync status
    await this.databaseManager.updateFileSyncStatus(fileId, 'queued');
    this.emitFileStateChange(fileId, 'queued');

    console.log(`Queued download: ${fileData.name} (priority: ${priority})`);
    
    // Process queue if not already processing
    this.processDownloadQueue();
  }

  async cancelDownload(fileId: string): Promise<void> {
    console.log(`Cancelling download for file: ${fileId}`);
    
    // Remove from queue if queued
    if (this.downloadQueue.has(fileId)) {
      this.downloadQueue.delete(fileId);
      console.log(`Removed ${fileId} from download queue`);
    }

    // Mark as cloud-only in database
    await this.databaseManager.updateFileSyncStatus(fileId, 'cloud_only');
    this.emitFileStateChange(fileId, 'cloud_only');
    
    // Cancel active download if it exists
    const downloads = await this.databaseManager.getDownloads();
    const activeDownload = downloads.find(d => d.fileId === fileId && d.status === 'downloading');
    if (activeDownload) {
      await this.databaseManager.cancelDownload(activeDownload.id);
    }
  }

  private async startConcurrentDownload(fileId: string, fileToDownload: any): Promise<void> {
    try {
      // Update status to downloading
      await this.databaseManager.updateDriveMetadataStatus(fileId, 'downloading', false);
      this.emitFileStateChange(fileId, 'downloading');
      
      // Start the download
      await this.downloadFile(fileToDownload);

      // SYNC-2: only mark synced after verifying the file actually landed on disk.
      // A download that "succeeded" without a file present must never be recorded
      // as synced.
      if (!this.syncFolderPath) {
        throw new Error('Sync folder path not available');
      }
      const expectedPath = path.join(this.syncFolderPath, fileToDownload.path, fileToDownload.name);
      let diskStats;
      try {
        diskStats = await fs.stat(expectedPath);
      } catch {
        throw new Error(`Download completed but the file is missing on disk: ${expectedPath}`);
      }
      if (!diskStats.isFile()) {
        throw new Error(`Download completed but the path on disk is not a file: ${expectedPath}`);
      }

      // Mark as synced and update local file exists flag
      await this.databaseManager.updateDriveMetadataStatus(fileId, 'synced', true);
      this.emitFileStateChange(fileId, 'synced');

      // UX-36: count this successful download toward the batch-complete
      // notification fired when the queue fully drains (see the finally block).
      this.batchDownloadCount++;
      this.lastDownloadedFile = { name: fileToDownload.name, localPath: expectedPath };

      // Notify UI to update activity tab
      try {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('activity:update');
          // Don't send drive:update here - let file state change handle it
          console.log(`Notified UI about file ${fileId} sync completion`);
        }
      } catch (error) {
        console.error('Failed to notify activity update:', error);
      }
      
      // Clean up all tracking for this successfully downloaded file
      this.cleanupCompletedDownload(fileId);
      
    } catch (error) {
      console.error(`Download failed for ${fileToDownload.name}:`, error);
      
      // Check if this is a permanent error that shouldn't be retried
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
      const isPermanentError = this.isPermanentError(errorMessage);
      
      if (isPermanentError) {
        console.log(`Permanent error for ${fileToDownload.name} (${fileId}), not retrying: ${errorMessage}`);
        console.log(`Failed file details: size=${fileToDownload.size || 0} bytes, path=${fileToDownload.path}`);
        await this.databaseManager.updateFileSyncStatus(fileId, 'failed', errorMessage);
        this.emitFileStateChange(fileId, 'failed');
        // Clean up all tracking for this permanently failed file
        this.cleanupCompletedDownload(fileId);
        this.failedDownloads.delete(fileId);
      } else {
        // Increment retry count for retryable errors
        const retryCount = this.failedDownloads.get(fileId) || 0;
        const newRetryCount = retryCount + 1;
        this.failedDownloads.set(fileId, newRetryCount);
        
        // Re-queue if under retry limit
        if (newRetryCount < this.maxRetries) {
          console.log(`Re-queueing ${fileToDownload.name} for retry ${newRetryCount}/${this.maxRetries}`);
          this.downloadQueue.set(fileId, fileToDownload);
          // Trigger queue processing again after a short delay
          setTimeout(() => this.processDownloadQueue(), 2000);
        } else {
          await this.databaseManager.updateFileSyncStatus(fileId, 'failed', errorMessage);
          this.emitFileStateChange(fileId, 'failed');
          // Clean up tracking for max-retry failures
          this.cleanupCompletedDownload(fileId);
        }
      }
    } finally {
      // Remove from active downloads
      this.activeDownloads.delete(fileId);
      // UX-36: the queue has fully drained (nothing queued, nothing active) —
      // fire ONE download-complete notification for everything that succeeded
      // in this batch, then reset the counter for the next drain. Gated on
      // !silent so a background auto-sync at launch stays quiet (mirrors the
      // sync-complete gate); notification-service also honors the Settings
      // opt-out. A failed-only batch (count 0) fires nothing.
      if (this.downloadQueue.size === 0 && this.activeDownloads.size === 0) {
        this.emitBatchDownloadComplete();
      }
      // Process queue again to pick up any waiting downloads
      this.processDownloadQueue();
    }
  }

  // UX-36: emit the coalesced download-complete notification and reset batch
  // state. Best-effort — a notification failure must never affect sync.
  private emitBatchDownloadComplete(): void {
    const count = this.batchDownloadCount;
    const last = this.lastDownloadedFile;
    this.batchDownloadCount = 0;
    this.lastDownloadedFile = null;
    if (count <= 0 || this.silent) {
      return;
    }
    try {
      notificationService.notifyDownloadComplete(count, {
        fileName: last?.name,
        localPath: last?.localPath,
        syncFolderPath: this.syncFolderPath ?? undefined,
      });
    } catch (error) {
      console.error('UX-36: failed to show download-complete notification:', error);
    }
  }

  private async processDownloadQueue(): Promise<void> {
    // Prevent multiple concurrent queue processors
    if (this.isProcessingQueue) {
      return;
    }
    
    // Clear any existing timeout
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
      this.queueProcessingTimeout = null;
    }
    
    try {
      this.isProcessingQueue = true;
      
      while (this.downloadQueue.size > 0 && this.activeDownloads.size < this.maxConcurrentDownloads) {
        // Get next file to download (highest priority, then smallest size)
        const queuedFiles = Array.from(this.downloadQueue.values()).sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority; // Higher priority first
          }
          return (a.size || 0) - (b.size || 0); // Smaller files first
        });

        if (queuedFiles.length === 0) {
          break; // Nothing to download
        }

        const fileToDownload = queuedFiles[0];
        const fileId = fileToDownload.fileId;

        // Check retry count
        const retryCount = this.failedDownloads.get(fileId) || 0;
        if (retryCount >= this.maxRetries) {
          console.error(`File ${fileToDownload.name} exceeded max retries (${this.maxRetries}), removing from queue`);
          this.downloadQueue.delete(fileId);
          await this.databaseManager.updateFileSyncStatus(fileId, 'failed', `Failed after ${this.maxRetries} attempts`);
          this.emitFileStateChange(fileId, 'failed');
          // Clean up all tracking for this failed file
          this.cleanupCompletedDownload(fileId);
          continue;
        }

        // Move from queue to active downloads
        this.downloadQueue.delete(fileId);
        this.activeDownloads.add(fileId);

        // Start the download asynchronously (don't await here to allow concurrent downloads)
        console.log(`Starting concurrent download ${this.activeDownloads.size}/${this.maxConcurrentDownloads}: ${fileToDownload.name}`);
        this.startConcurrentDownload(fileId, fileToDownload).catch(error => {
          console.error(`Concurrent download handler error for ${fileToDownload.name}:`, error);
        });
      }
    } finally {
      this.isProcessingQueue = false;
      
      // Only schedule next check if there are items in queue
      if (this.downloadQueue.size > 0) {
        this.queueProcessingTimeout = setTimeout(() => this.processDownloadQueue(), 1000);
      } else {
        console.log('Download queue empty, stopping queue processor');
      }
    }
  }

  async getQueueStatus(): Promise<{ queued: number; active: number; total: number }> {
    return {
      queued: this.downloadQueue.size,
      active: this.activeDownloads.size,
      total: this.downloadQueue.size + this.activeDownloads.size
    };
  }
  
  async getQueuedDownloads(limit: number = 30): Promise<any[]> {
    // Get queued files sorted by priority and size
    const queuedFiles = Array.from(this.downloadQueue.values())
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return (a.size || 0) - (b.size || 0); // Smaller files first
      })
      .slice(0, limit)
      .map(file => ({
        id: `queued-${file.fileId}`,
        fileId: file.fileId,
        fileName: file.name,
        fileSize: file.size || 0,
        status: 'queued',
        priority: file.priority,
        queuePosition: 0, // Will be set below
        path: file.path
      }));
    
    // Add queue position
    queuedFiles.forEach((file, index) => {
      file.queuePosition = index + 1;
    });
    
    return queuedFiles;
  }

  async prioritizeDownload(fileId: string, priority: number): Promise<void> {
    if (this.downloadQueue.has(fileId)) {
      const fileData = this.downloadQueue.get(fileId);
      fileData.priority = priority;
      console.log(`Updated priority for ${fileData.name} to ${priority}`);
    }
  }

  // Stop all download processing and clear queues
  async stopAllDownloads(): Promise<void> {
    console.log('Stopping all downloads and clearing queues');
    
    // Stop queue processing
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
      this.queueProcessingTimeout = null;
    }
    
    // Cancel all active downloads
    for (const fileId of this.activeDownloads) {
      this.streamingDownloader.cancelDownload(fileId);
    }
    
    // Clear all queues and maps
    this.downloadQueue.clear();
    this.activeDownloads.clear();
    this.failedDownloads.clear();
    this.lastProgressUpdate.clear();
    this.progressBatch.clear();
    
    // Reset flags
    this.isProcessingQueue = false;
    this.isDownloading = false;
    
    console.log('All downloads stopped and memory cleared');
  }

  // Clean up completed download data from memory
  private cleanupCompletedDownload(fileId: string): void {
    this.lastProgressUpdate.delete(fileId);
    this.failedDownloads.delete(fileId);
    // Remove from progress batch if exists
    if (this.progressBatch.has(fileId)) {
      this.progressBatch.delete(fileId);
    }
  }
  
  // Check if an error is permanent and shouldn't be retried
  private isPermanentError(errorMessage: string): boolean {
    const permanentErrors = [
      'File size too small',
      'File too large',
      'File size mismatch',
      'Invalid file format',
      'Access denied',
      'File not found',
      '404',
      '403',
      '401'
    ];
    
    const lowerMessage = errorMessage.toLowerCase();
    return permanentErrors.some(err => lowerMessage.includes(err.toLowerCase()));
  }
}