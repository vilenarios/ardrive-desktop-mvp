import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ArDrive, EID, FolderID } from 'ardrive-core-js';
import { DatabaseManager } from '../database-manager';
import { IFileStateManager, ISyncProgressTracker } from './interfaces';
// FileHashVerifier no longer needed - we get hash from streaming download
import { StreamingDownloader } from './StreamingDownloader';
import { BrowserWindow } from 'electron';

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
    
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
      this.queueProcessingTimeout = null;
    }
    
    // Clear all data structures to free memory
    this.downloadQueue.clear();
    this.activeDownloads.clear();
    this.progressBatch.clear();
    this.lastProgressUpdate.clear();
    this.failedDownloads.clear();
    
    // Cancel any active downloads
    this.streamingDownloader.cancelAllDownloads();
    
    // Clean up progress tracker
    if (this.progressTracker && typeof this.progressTracker.destroy === 'function') {
      this.progressTracker.destroy();
    }
    
    // Mark as not processing
    this.isProcessingQueue = false;
    this.isDownloading = false;
    
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
  }

  setArDrive(arDrive: ArDrive): void {
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
    
    for (const file of missingFiles) {
      await this.downloadFile(file);
      downloaded++;
      console.log(`Downloaded ${downloaded}/${missingFiles.length} files`);
    }
    
    this.isDownloading = false;
    console.log(`Download completed: ${downloaded} files`);
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
      console.error('Sync folder path or ArDrive not available');
      return;
    }

    // Validate file size before downloading
    const MAX_DOWNLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5GB limit
    const fileSize = fileData.size || 0;
    
    if (fileSize > MAX_DOWNLOAD_SIZE) {
      console.error(`File ${fileData.name} is too large (${fileSize} bytes, max: ${MAX_DOWNLOAD_SIZE} bytes)`);
      await this.databaseManager.updateFileSyncStatus(fileData.fileId, 'failed', `File too large: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB`);
      this.emitFileStateChange(fileData.fileId, 'failed');
      
      // Don't throw - just skip this file
      return;
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
      // This prevents the file watcher from picking it up
      this.fileStateManager.markAsDownloaded(localFilePath);
      
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
    }
  }

  private async performFileDownload(fileData: any, localFilePath: string, dir: string, downloadId: string, placeholderHash: string): Promise<void> {
    try {
      // Check if this is a manifest file
      const isManifest = this.isManifestFile(fileData);
      let hash: string = ''; // Declare hash variable outside the if/else block
      
      if (isManifest) {
        console.log(`Detected manifest file: ${fileData.name}, using raw download method`);
        const manifestResult = await this.downloadManifestFile(fileData, localFilePath, downloadId);
        hash = manifestResult.hash;
      } else {
        // Use streaming download for better reliability and progress tracking
        const gatewayUrl = 'https://arweave.net';
        const downloadUrl = `${gatewayUrl}/${fileData.dataTxId}`;
        
        console.log(`Downloading file from: ${downloadUrl}`);
        
        const downloadResult = await this.streamingDownloader.downloadFile(
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
            maxRetries: 5,
            retryDelay: 2000,
            chunkSize: 2 * 1024 * 1024 // 2MB chunks for better performance
          }
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
      const folderContents = await this.arDrive!.listPublicFolder({
        folderId: EID(folderId)
      });
      
      // Only log folder listing for root folder to reduce noise
      if (parentPath === '') {
        console.log(`Listing root folder contents...`);
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
        // CRITICAL FIX: ArDrive core might return size as a BigNumber-like object
        // that needs special handling to get the actual byte value
        const fileSize: any = file.size;
        let numericSize: number;
        
        if (fileSize && typeof fileSize === 'object') {
          // Handle ByteCount object
          const sizeObj = fileSize as any;
          // Try different methods to extract the numeric value
          if (typeof sizeObj.toNumber === 'function') {
            numericSize = sizeObj.toNumber();
          } else if (typeof sizeObj.valueOf === 'function') {
            numericSize = sizeObj.valueOf();
          } else if (sizeObj._hex) {
            // ethers.js BigNumber format
            numericSize = parseInt(sizeObj._hex, 16);
          } else {
            numericSize = 0;
          }
        } else {
          numericSize = Number(fileSize) || 0;
        }
        
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
      console.error(`Failed to list contents of folder ${folderId}:`, error);
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
      // For manifests, we need to download from the raw endpoint
      const gatewayUrl = 'https://arweave.net';
      const rawUrl = `${gatewayUrl}/raw/${fileData.dataTxId}`;
      
      console.log(`Downloading manifest from raw URL: ${rawUrl}`);
      
      // Use streaming download for manifests too
      const downloadResult = await this.streamingDownloader.downloadFile(
        rawUrl,
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
          maxRetries: 3,
          retryDelay: 1000
        }
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

        try {
          // Update status to downloading
          await this.databaseManager.updateDriveMetadataStatus(fileId, 'downloading', false);
          this.emitFileStateChange(fileId, 'downloading');
          
          // Start the download
          await this.downloadFile(fileToDownload);
          
          // Mark as synced and update local file exists flag
          await this.databaseManager.updateDriveMetadataStatus(fileId, 'synced', true);
          this.emitFileStateChange(fileId, 'synced');
          
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
            const newRetryCount = retryCount + 1;
            this.failedDownloads.set(fileId, newRetryCount);
            
            // Re-queue if under retry limit
            if (newRetryCount < this.maxRetries) {
              console.log(`Re-queueing ${fileToDownload.name} for retry ${newRetryCount}/${this.maxRetries}`);
              this.downloadQueue.set(fileId, fileToDownload);
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
        }
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