import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { ArDrive, wrapFileOrFolder, EID } from 'ardrive-core-js';
import { DatabaseManager } from './database-manager';
import { VersionManager, ChangeType } from './version-manager';
import { FileUpload, SyncStatus, PendingUpload } from '../types';
import { SyncProgressTracker } from './sync/SyncProgressTracker';
import { FileStateManager } from './sync/FileStateManager';
import { CostCalculator } from './sync/CostCalculator';
import { UploadQueueManager } from './sync/UploadQueueManager';
import { DownloadManager } from './sync/DownloadManager';
import { FolderOperationDetector, OperationDetection } from './sync/FolderOperationDetector';
import { FileOperationDetector } from './sync/FileOperationDetector';

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
  // REMOVED: File state tracking properties - now managed by FileStateManager
  
  // New sync state management
  private syncState: 'idle' | 'syncing' | 'monitoring' = 'idle';
  private syncPromise: Promise<void> | null = null;
  private totalItemsToSync = 0;
  private foldersToCreate = 0;
  private filesToDownload = 0;

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

  setArDrive(arDrive: ArDrive) {
    console.log('SyncManager.setArDrive - ArDrive instance set');
    this.arDrive = arDrive;
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
      
      // If already monitoring, just return true (sync is working)
      if (this.syncState === 'monitoring') {
        console.log('Already in monitoring state, file watching should be active');
        return true;
      }
      
      return false;
    }

    this.syncState = 'syncing';
    this.driveId = driveId;
    this.rootFolderId = rootFolderId;
    
    // Update download manager with drive info
    if (this.syncFolderPath) {
      this.downloadManager.setDriveInfo(driveId, rootFolderId, this.syncFolderPath);
    }

    try {
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
      
      return true;
    } catch (error) {
      console.error('Failed to start sync:', error);
      this.syncState = 'idle';
      this.isActive = false;
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

    // Step 1: Get authoritative drive state (BLOCKING - needed for UI)
    await this.downloadManager.syncDriveMetadata();
    
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
    
    console.log('✅ Metadata sync completed, files queued for background download');
    console.log('🚀 Users can now upload files while downloads continue in background');
  }

  // NEW: Start file watcher only after sync complete
  private async startFileWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
    
    console.log('👁️ Starting file monitoring (sync complete)...');
    console.log(`🔍 Watching folder: ${this.syncFolderPath}`);
    console.log(`📊 Current sync state: ${this.syncState}`);
    
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
    });
  }

  async stopSync(): Promise<boolean> {
    this.isActive = false;
    this.syncState = 'idle';
    
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

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
      currentFile: currentUpload?.fileName
    };
  }

  // Add approved upload to the processing queue
  addToUploadQueue(upload: FileUpload): void {
    console.log(`Adding approved upload to processing queue: ${upload.fileName}`);
    this.uploadQueueManager.addToQueue(upload);
  }
  
  // Cancel an upload
  cancelUpload(uploadId: string): void {
    console.log(`Cancelling upload: ${uploadId}`);
    this.uploadQueueManager.cancelUpload(uploadId);
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
      
      // Make the GraphQL request
      const response = await fetch('https://arweave.net/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          variables: variables
        })
      });
      
      const result: ArweaveQueryResult = await response.json();
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
      
      // Download file data directly from Arweave
      console.log(`Fetching data from https://arweave.net/${dataTxId}`);
      const response = await fetch(`https://arweave.net/${dataTxId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const fileData = await response.arrayBuffer();
      const buffer = Buffer.from(fileData);
      
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
      await this.downloadManager.syncDriveMetadata();
      
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
      
    } catch (error) {
      console.error('Failed to sync drive metadata:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Don't fail completely - continue with sync even if metadata sync fails
      console.log('Continuing with sync despite metadata sync issues...');
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
    
    // Use the file operation detector
    await this.fileOperationDetector.onFileDelete(filePath, existingHash, fileInfo?.arfsFileId);
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
          await this.confirmFolderDelete(dirPath);
        }
      );
      
    } catch (error) {
      console.error(`Error handling folder delete for ${dirPath}:`, error);
    }
  }
  
  private async confirmFolderDelete(dirPath: string) {
    try {
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
      
      // Check database for this file - look for any entry with this hash OR path
      const processedFiles = await this.databaseManager.getProcessedFiles();
      const matchingFiles = processedFiles.filter(f => f.fileHash === hash || f.localPath === filePath);
      
      // Check if any matching file has source 'download'
      const hasDownloadEntry = matchingFiles.some(f => f.source === 'download');
      const hasPlaceholder = matchingFiles.some(f => f.fileHash.startsWith('downloading-'));
      const isAlreadyProcessed = matchingFiles.length > 0;
      
      console.log(`  - Already processed: ${isAlreadyProcessed}`);
      console.log(`  - Has download entry: ${hasDownloadEntry}`);
      console.log(`  - Has placeholder: ${hasPlaceholder}`);
      
      if (matchingFiles.length > 0) {
        console.log(`  - Found ${matchingFiles.length} matching file(s) in database:`);
        matchingFiles.forEach((f, index) => {
          console.log(`    ${index + 1}. Source: ${f.source}, Path: ${f.localPath}, Hash: ${f.fileHash.substring(0, 16)}..., ProcessedAt: ${f.processedAt}`);
        });
      }

      // Skip if this file was downloaded or is being downloaded
      if (hasDownloadEntry || hasPlaceholder) {
        console.log(`✓ File was downloaded from Arweave, skipping: ${filePath}`);
        return;
      }
      
      // Skip if already processed (but only for upload source - downloads were handled above)
      if (isAlreadyProcessed && matchingFiles.some(f => f.source === 'upload')) {
        console.log(`✓ File already uploaded, skipping: ${filePath}`);
        return;
      }

      // Double check if this file was recently downloaded
      if (this.fileStateManager.isRecentlyDownloaded(filePath)) {
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
      
      // CRITICAL: Check if this file was previously downloaded BEFORE adding to pending uploads
      const allProcessedFiles = await this.databaseManager.getProcessedFiles();
      const downloadEntry = allProcessedFiles.find(f => 
        (f.fileHash === hash || f.localPath === filePath) && f.source === 'download'
      );
      
      if (downloadEntry) {
        console.log(`✓ File was previously downloaded from Arweave, not adding to upload queue: ${filePath}`);
        console.log(`  - Download entry: hash=${downloadEntry.fileHash.substring(0, 16)}..., source=${downloadEntry.source}`);
        return; // Don't add downloaded files to upload queue
      }

      // ADDITIONAL SAFETY CHECK: Also check the downloads table directly
      const downloads = await this.databaseManager.getDownloads();
      const downloadRecord = downloads.find(d => 
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
        estimatedTurboCost: estimatedTurboCost || undefined,
        recommendedMethod,
        hasSufficientTurboBalance,
        conflictType,
        conflictDetails,
        status: 'awaiting_approval'
      };

      // Before adding the file, ensure all parent folders are in the queue
      await this.ensureParentFoldersInQueue(filePath);
      
      await this.databaseManager.addPendingUpload(pendingUpload);
      
      // Create file version (without upload info yet, will be updated after upload)
      await this.versionManager.createNewVersion(filePath, changeType);
      
      // Only add to processed files database if not already there
      // (avoids duplicate entries for downloaded files)
      if (!isAlreadyProcessed && !downloadEntry) {
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
      // Update status to uploading
      console.log(`Setting upload status to 'uploading' for ${itemName}`);
      upload.status = 'uploading';
      await this.databaseManager.updateUpload(upload.id, { status: 'uploading' });
      
      // Emit uploading progress event
      this.emitUploadProgress(upload.id, 0, 'uploading');

      // Use ArDrive Core for both files AND folders
      await this.uploadFileWithArDriveCore(upload);
      
      // Emit completion event
      this.emitUploadProgress(upload.id, 100, 'completed');

    } catch (error) {
      console.error(`Failed to upload ${upload.fileName}:`, error);
      
      upload.status = 'failed';
      upload.error = error instanceof Error ? error.message : 'Unknown error';

      await this.databaseManager.updateUpload(upload.id, {
        status: 'failed',
        error: upload.error
      });
      
      // Emit failure event
      this.emitUploadProgress(upload.id, 0, 'failed', upload.error);
    }
  }

  private async uploadFileWithArDriveCore(upload: FileUpload) {
    const isFolder = upload.fileSize === 0 && upload.localPath.endsWith(upload.fileName);
    const itemName = upload.fileName;
    console.log(`Uploading ${itemName} with ArDrive Core (method: ${upload.uploadMethod || 'ar'})`);
    
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
          // Mark upload as completed
          upload.status = 'completed';
          await this.databaseManager.updateUpload(upload.id, { 
            status: 'completed',
            completedAt: new Date()
          });
          return;
        }
        
        const result = await this.arDrive!.createPublicFolder({
          parentFolderId: EID(parentFolderId!),
          folderName: itemName
        });
        
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
      // Check if this is a free Turbo upload (under 100KB)
      const isFreeWithTurbo = upload.uploadMethod === 'turbo' && this.costCalculator.isFreeWithTurbo(upload.fileSize);
      if (isFreeWithTurbo) {
        console.log(`File ${upload.fileName} is under 100KB (${upload.fileSize} bytes) - should be FREE with Turbo`);
      }
      
      // Get the correct parent folder for this file (will create folder structure if needed)
      const targetFolderId = await this.getTargetFolderId(upload.localPath);
      console.log(`Target folder ID for upload: ${targetFolderId}`);
      
      // Wrap file for upload using ArDrive Core
      const wrappedFile = wrapFileOrFolder(upload.localPath);
      
      // Check if using Turbo and configure appropriately
      const uploadOptions: any = {
        entitiesToUpload: [
          {
            wrappedEntity: wrappedFile,
            destFolderId: EID(targetFolderId) // Upload to correct folder
          }
        ]
      };
      
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
      
      // Upload file using ArDrive Core's recommended API
      const result = await this.arDrive!.uploadAllEntities(uploadOptions);

      console.log('ArDrive Core upload result:', result);
      
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
            await this.ensureFolderStructure(path.dirname(upload.localPath));
            
            // Small delay to ensure folder is fully created
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Re-wrap the file and get target folder
            const retryWrappedFile = wrapFileOrFolder(upload.localPath);
            const retryTargetFolderId = await this.getTargetFolderId(upload.localPath);
            
            // Retry the upload
            const retryResult = await this.arDrive!.uploadAllEntities({
              entitiesToUpload: [
                {
                  wrappedEntity: retryWrappedFile,
                  destFolderId: EID(retryTargetFolderId)
                }
              ]
            });
            
            // If retry succeeded, process the result
            console.log('Retry successful:', retryResult);
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

  private async getTargetFolderId(filePath: string): Promise<string> {
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
      try {
        await this.ensureFolderStructure(fileDir);
        
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
  private async ensureFolderStructure(targetPath: string): Promise<void> {
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
      const result = await this.arDrive!.createPublicFolder({
        parentFolderId: EID(parentFolderId),
        folderName: folderName
      });
      
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
          // List the parent folder contents to find the existing folder
          const parentContents = await this.arDrive!.listPublicFolder({
            folderId: EID(parentFolderId)
          });
          
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

    // Update as completed
    upload.status = 'completed';
    upload.progress = 100;
    upload.dataTxId = dataTxId;
    upload.metadataTxId = metadataTxId;
    upload.transactionId = dataTxId; // Keep legacy field for backward compatibility
    upload.fileId = fileId;
    upload.completedAt = new Date();

    console.log(`ArDrive Core upload completed - Data TX: ${dataTxId}, Metadata TX: ${metadataTxId}, File-ID: ${fileId}`);

    await this.databaseManager.updateUpload(upload.id, {
      status: 'completed',
      progress: 100,
      dataTxId: upload.dataTxId,
      metadataTxId: upload.metadataTxId,
      transactionId: upload.transactionId,
      fileId: fileId,
      completedAt: upload.completedAt
    });
    
    // Emit completion progress event
    this.emitUploadProgress(upload.id, 100, 'completed');
    
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
      // Use the simple ArDrive Core approach like ardrive-cli
      console.log('Fetching drive contents via ArDrive Core listPublicFolder...');
      
      const allItems = await this.arDrive!.listPublicFolder({
        folderId: EID(this.rootFolderId!),
        maxDepth: 10, // Get full hierarchy
        includeRoot: false // Don't include root folder itself
      });
      
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

  // Recursively list all drive contents
  private async recursivelyListDriveContents(folderId: string, parentPath: string): Promise<any[]> {
    const items: any[] = [];
    
    try {
      const folderContents = await this.arDrive!.listPublicFolder({
        folderId: EID(folderId)
      });

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
          const subItems = await this.recursivelyListDriveContents(item.folderId.toString(), itemPath);
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
          
          result = await this.arDrive.renamePublicFile({
            fileId: EID(pendingUpload.arfsFileId),
            newName: pendingUpload.fileName
          });
          
          console.log(`Successfully renamed file to ${pendingUpload.fileName}`);
          break;
          
        case 'hide':
        case 'unhide':
        case 'delete':
          // These operations will be implemented in the future
          throw new Error(`Operation ${pendingUpload.operationType} not yet implemented`);
          
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
                await this.databaseManager.updateDriveMetadataParent(
                  pendingUpload.arfsFileId,
                  pendingUpload.metadata.newParentFolderId,
                  path.dirname(pendingUpload.localPath)
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
      
      // Update version manager to track the move
      await this.versionManager.handleFileMove(oldPath, newPath);
      
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
        
        // Create a move/rename operation in pending uploads
        const moveOperation: Omit<PendingUpload, 'createdAt'> = {
          id: crypto.randomUUID(),
          driveId: this.driveId || undefined,
          localPath: newPath,
          fileName: fileName,
          fileSize: fileStats.size,
          mimeType: existingFileInfo.mimeType || 'application/octet-stream',
          estimatedCost: 0.000001, // Metadata-only operation
          estimatedTurboCost: 0.000001,
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