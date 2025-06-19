import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ArDrive, wrapFileOrFolder, EID, FolderID } from 'ardrive-core-js';
import { DatabaseManager } from './database-manager';
import { VersionManager } from './version-manager';
import { DriveSyncMapping, DriveSyncSettings, DriveSyncStatus, FileUpload, PendingUpload } from '../types';
import { turboManager } from './turbo-manager';

export class SyncEngine {
  private watcher: chokidar.FSWatcher | null = null;
  private isActive = false;
  private isPaused = false;
  private uploadQueue: Map<string, FileUpload> = new Map();
  private arDrive: ArDrive | null = null;
  private versionManager: VersionManager;
  private pendingDeletes = new Map<string, NodeJS.Timeout>();
  private isDownloading = false;
  private fileOperationLocks = new Map<string, boolean>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private stats = {
    totalFiles: 0,
    uploadedFiles: 0,
    downloadedFiles: 0,
    failedFiles: 0,
    pendingFiles: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0
  };

  constructor(
    private mapping: DriveSyncMapping,
    private databaseManager: DatabaseManager
  ) {
    this.versionManager = new VersionManager(databaseManager);
    this.versionManager.setSyncFolder(mapping.localFolderPath);
  }

  setArDrive(arDrive: ArDrive) {
    console.log(`SyncEngine[${this.mapping.driveName}] - ArDrive instance set`);
    this.arDrive = arDrive;
  }

  updateSettings(newSettings: Partial<DriveSyncSettings>) {
    console.log(`SyncEngine[${this.mapping.driveName}] - Updating settings`);
    this.mapping.syncSettings = {
      ...this.mapping.syncSettings,
      ...newSettings
    };
  }

  async start(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Starting sync`);
    
    if (!this.arDrive) {
      throw new Error('ArDrive instance must be set before starting sync');
    }

    if (this.isActive) {
      console.log(`SyncEngine[${this.mapping.driveName}] - Already active`);
      return;
    }

    // For multi-drive sync, the actual sync path should include the drive name subfolder
    // This ensures we only watch the specific drive folder, not the parent folder
    const driveFolderPath = path.join(this.mapping.localFolderPath, this.mapping.driveName);
    
    // Ensure the drive folder exists
    try {
      await fs.mkdir(driveFolderPath, { recursive: true });
      console.log(`SyncEngine[${this.mapping.driveName}] - Created/verified drive folder: ${driveFolderPath}`);
    } catch (error) {
      throw new Error(`Failed to create drive folder: ${driveFolderPath}`);
    }

    // Update the mapping to use the drive-specific folder
    this.mapping.localFolderPath = driveFolderPath;
    this.versionManager.setSyncFolder(driveFolderPath);

    this.isActive = true;
    this.isPaused = false;

    // Load existing processed files from database for this mapping
    const processedFiles = await this.databaseManager.getProcessedFiles();
    console.log(`SyncEngine[${this.mapping.driveName}] - Loaded ${processedFiles.length} processed files`);

    // Download existing files from ArDrive if sync direction allows
    if (this.shouldDownload()) {
      this.isDownloading = true;
      try {
        await this.downloadExistingDriveFiles();
        await new Promise(resolve => setTimeout(resolve, 2000));
      } finally {
        this.isDownloading = false;
      }
    }

    // Scan existing files if sync direction allows uploads
    if (this.shouldUpload()) {
      console.log(`SyncEngine[${this.mapping.driveName}] - Scanning existing files`);
      await this.scanExistingFiles();
    }

    // Start file watching
    await this.startFileWatcher();

    // Start processing upload queue
    this.processUploadQueue();

    console.log(`SyncEngine[${this.mapping.driveName}] - Sync started successfully`);
  }

  async stop(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Stopping sync`);
    
    this.isActive = false;
    this.isPaused = false;
    
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Clear pending operations
    this.pendingDeletes.forEach(timeout => clearTimeout(timeout));
    this.pendingDeletes.clear();

    // Clear debounce timers and operation locks
    this.debounceTimers.forEach(timeout => clearTimeout(timeout));
    this.debounceTimers.clear();
    this.fileOperationLocks.clear();

    // Clear upload queue to prevent memory leaks
    this.uploadQueue.clear();

    console.log(`SyncEngine[${this.mapping.driveName}] - Sync stopped and cleaned up`);
  }

  async pause(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Pausing sync`);
    this.isPaused = true;
    
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async resume(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Resuming sync`);
    
    if (!this.isActive) {
      throw new Error('Cannot resume inactive sync engine');
    }
    
    this.isPaused = false;
    await this.startFileWatcher();
    this.processUploadQueue();
  }

  async getStatus(): Promise<DriveSyncStatus> {
    // Get upload statistics for this mapping
    const uploads = await this.databaseManager.getUploadsByMapping(this.mapping.id);
    
    const uploadedFiles = uploads.filter(u => u.status === 'completed').length;
    const failedFiles = uploads.filter(u => u.status === 'failed').length;
    const pendingFiles = uploads.filter(u => u.status === 'pending' || u.status === 'uploading').length;

    // Calculate bytes uploaded
    const bytesUploaded = uploads
      .filter(u => u.status === 'completed')
      .reduce((sum, u) => sum + u.fileSize, 0);

    return {
      mappingId: this.mapping.id,
      driveId: this.mapping.driveId,
      driveName: this.mapping.driveName,
      isActive: this.mapping.isActive,
      isRunning: this.isActive && !this.isPaused,
      totalFiles: uploads.length,
      uploadedFiles,
      downloadedFiles: this.stats.downloadedFiles,
      failedFiles,
      pendingFiles,
      lastSyncTime: this.mapping.lastSyncTime,
      bytesUploaded,
      bytesDownloaded: this.stats.bytesDownloaded
    };
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  getIsPaused(): boolean {
    return this.isPaused;
  }

  addToUploadQueue(upload: FileUpload): void {
    console.log(`SyncEngine[${this.mapping.driveName}] - Adding upload to queue: ${upload.fileName}`);
    
    // Ensure upload has correct mapping ID
    upload.mappingId = this.mapping.id;
    upload.driveId = this.mapping.driveId;
    
    this.uploadQueue.set(upload.id, upload);
  }

  private async startFileWatcher(): Promise<void> {
    if (this.watcher || this.isPaused) {
      return;
    }

    console.log(`SyncEngine[${this.mapping.driveName}] - Starting file watcher: ${this.mapping.localFolderPath}`);
    
    // Build ignore patterns
    const ignored = this.buildIgnorePatterns();
    
    this.watcher = chokidar.watch(this.mapping.localFolderPath, {
      ignored,
      persistent: true,
      ignoreInitial: true // We've already scanned existing files
    });

    // File events with debouncing to prevent race conditions
    this.watcher.on('add', (filePath) => {
      if (!this.shouldProcessFile(filePath)) return;
      console.log(`SyncEngine[${this.mapping.driveName}] - New file: ${filePath}`);
      this.debouncedFileOperation(filePath, () => this.handleFileAdd(filePath));
    });

    this.watcher.on('change', (filePath) => {
      if (!this.shouldProcessFile(filePath)) return;
      console.log(`SyncEngine[${this.mapping.driveName}] - File changed: ${filePath}`);
      this.debouncedFileOperation(filePath, () => this.handleFileChange(filePath));
    });

    this.watcher.on('unlink', (filePath) => {
      console.log(`SyncEngine[${this.mapping.driveName}] - File deleted: ${filePath}`);
      this.handleFileDelete(filePath);
    });

    // Folder events
    this.watcher.on('addDir', (dirPath) => {
      console.log(`SyncEngine[${this.mapping.driveName}] - New folder: ${dirPath}`);
      this.handleFolderAdd(dirPath);
    });

    this.watcher.on('unlinkDir', (dirPath) => {
      console.log(`SyncEngine[${this.mapping.driveName}] - Folder deleted: ${dirPath}`);
      this.handleFolderDelete(dirPath);
    });

    this.watcher.on('ready', () => {
      console.log(`SyncEngine[${this.mapping.driveName}] - File watcher ready`);
    });

    this.watcher.on('error', (error) => {
      console.error(`SyncEngine[${this.mapping.driveName}] - Watcher error:`, error);
    });
  }

  private buildIgnorePatterns(): ((path: string) => boolean) | string[] {
    const patterns = [
      /(^|[\/\\])\../, // ignore dotfiles by default
      ...(this.mapping.syncSettings?.excludePatterns || [])
    ];

    return (filePath: string) => {
      // Check against all patterns
      for (const pattern of patterns) {
        if (typeof pattern === 'string') {
          // Simple glob-like matching
          if (filePath.includes(pattern.replace('*', ''))) {
            return true;
          }
        } else if (pattern instanceof RegExp) {
          if (pattern.test(filePath)) {
            return true;
          }
        }
      }
      return false;
    };
  }

  private shouldProcessFile(filePath: string): boolean {
    // Check file size limit
    if (this.mapping.syncSettings?.maxFileSize) {
      try {
        const stats = require('fs').statSync(filePath);
        if (stats.size > this.mapping.syncSettings.maxFileSize) {
          console.log(`SyncEngine[${this.mapping.driveName}] - File exceeds size limit: ${filePath}`);
          return false;
        }
      } catch (error) {
        // File might not exist anymore, ignore
        return false;
      }
    }

    return true;
  }

  // Debounced file operation to prevent race conditions
  private debouncedFileOperation(filePath: string, operation: () => void): void {
    // Check if file is already locked
    if (this.fileOperationLocks.get(filePath)) {
      console.log(`SyncEngine[${this.mapping.driveName}] - File operation already in progress: ${filePath}`);
      return;
    }

    // Clear existing timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer with 500ms debounce
    const timer = setTimeout(async () => {
      try {
        // Lock the file
        this.fileOperationLocks.set(filePath, true);
        
        // Execute the operation
        await operation();
      } catch (error) {
        console.error(`SyncEngine[${this.mapping.driveName}] - Debounced operation failed for ${filePath}:`, error);
      } finally {
        // Always unlock the file
        this.fileOperationLocks.delete(filePath);
        this.debounceTimers.delete(filePath);
      }
    }, 500);

    this.debounceTimers.set(filePath, timer);
  }

  private shouldUpload(): boolean {
    const direction = this.mapping.syncSettings?.syncDirection || 'bidirectional';
    return direction === 'bidirectional' || direction === 'upload-only';
  }

  private shouldDownload(): boolean {
    const direction = this.mapping.syncSettings?.syncDirection || 'bidirectional';
    return direction === 'bidirectional' || direction === 'download-only';
  }

  private async handleFileAdd(filePath: string): Promise<void> {
    if (!this.shouldUpload() || this.isDownloading) return;

    try {
      // Check if file was recently downloaded to avoid re-uploading
      const relativePath = path.relative(this.mapping.localFolderPath, filePath);
      const fileHash = await this.calculateFileHash(filePath);
      const isProcessed = await this.databaseManager.isFileProcessed(fileHash);
      
      if (isProcessed) {
        console.log(`SyncEngine[${this.mapping.driveName}] - Skipping already processed file: ${filePath}`);
        return;
      }

      await this.queueFileForUpload(filePath, 'create');
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Error handling file add:`, error);
    }
  }

  private async handleFileChange(filePath: string): Promise<void> {
    if (!this.shouldUpload() || this.isDownloading) return;

    try {
      await this.queueFileForUpload(filePath, 'update');
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Error handling file change:`, error);
    }
  }

  private async handleFileDelete(filePath: string): Promise<void> {
    // Handle file deletion - for now, we'll just log it
    // In the future, we might want to implement deletion sync
    console.log(`SyncEngine[${this.mapping.driveName}] - File deleted: ${filePath}`);
  }

  private async handleFolderAdd(dirPath: string): Promise<void> {
    // Handle folder creation
    console.log(`SyncEngine[${this.mapping.driveName}] - Folder created: ${dirPath}`);
  }

  private async handleFolderDelete(dirPath: string): Promise<void> {
    // Handle folder deletion
    console.log(`SyncEngine[${this.mapping.driveName}] - Folder deleted: ${dirPath}`);
  }

  private async queueFileForUpload(filePath: string, changeType: 'create' | 'update'): Promise<void> {
    try {
      const fileStats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const fileHash = await this.calculateFileHash(filePath);

      // Check if this file is already processed or in queue
      const existingUpload = Array.from(this.uploadQueue.values()).find(u => u.localPath === filePath);
      if (existingUpload) {
        console.log(`SyncEngine[${this.mapping.driveName}] - File already in upload queue: ${fileName}`);
        return;
      }

      // Create pending upload for approval
      const pendingUpload: PendingUpload = {
        id: crypto.randomUUID(),
        mappingId: this.mapping.id,
        driveId: this.mapping.driveId,
        localPath: filePath,
        fileName,
        fileSize: fileStats.size,
        estimatedCost: 0.001, // TODO: Calculate actual cost
        status: 'awaiting_approval',
        createdAt: new Date()
      };

      await this.databaseManager.addPendingUpload(pendingUpload);
      console.log(`SyncEngine[${this.mapping.driveName}] - Queued file for approval: ${fileName}`);
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Error queuing file:`, error);
    }
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    
    return new Promise((resolve, reject) => {
      stream.on('data', (data: Buffer) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async processUploadQueue(): Promise<void> {
    if (!this.isActive || this.isPaused) return;

    const uploads = Array.from(this.uploadQueue.values())
      .filter(u => u.status === 'pending')
      .sort((a, b) => {
        // Sort by priority if set, otherwise by creation time
        const aPriority = this.mapping.syncSettings?.uploadPriority || 0;
        const bPriority = this.mapping.syncSettings?.uploadPriority || 0;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    for (const upload of uploads) {
      if (!this.isActive || this.isPaused) break;
      
      try {
        await this.processUpload(upload);
        // Remove from queue on success
        this.uploadQueue.delete(upload.id);
      } catch (error) {
        console.error(`SyncEngine[${this.mapping.driveName}] - Upload failed:`, error);
        
        upload.status = 'failed';
        upload.error = error instanceof Error ? error.message : 'Unknown error';
        await this.databaseManager.updateUpload(upload.id, upload);
        
        // CRITICAL FIX: Remove failed uploads from queue to prevent memory leak
        this.uploadQueue.delete(upload.id);
        console.log(`SyncEngine[${this.mapping.driveName}] - Removed failed upload from queue: ${upload.fileName}`);
      }
    }

    // Schedule next processing cycle
    if (this.isActive && !this.isPaused && this.uploadQueue.size > 0) {
      setTimeout(() => this.processUploadQueue(), 5000);
    }
  }

  private async processUpload(upload: FileUpload): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Processing upload: ${upload.fileName}`);
    
    upload.status = 'uploading';
    await this.databaseManager.updateUpload(upload.id, upload);

    try {
      // Verify file still exists
      await fs.access(upload.localPath);
      
      // Upload using ArDrive Core
      const result = await this.uploadFileToArweave(upload);
      
      // Update upload record with success
      upload.status = 'completed';
      upload.progress = 100;
      upload.dataTxId = result.dataTxId;
      upload.metadataTxId = result.metadataTxId;
      upload.fileId = result.fileId;
      upload.completedAt = new Date();
      
      await this.databaseManager.updateUpload(upload.id, upload);
      
      // Remove from queue
      this.uploadQueue.delete(upload.id);
      
      // Update mapping last sync time
      await this.databaseManager.updateDriveMapping(this.mapping.id, {
        lastSyncTime: new Date()
      });
      
      console.log(`SyncEngine[${this.mapping.driveName}] - Upload completed: ${upload.fileName}`);
    } catch (error) {
      throw error;
    }
  }

  private async uploadFileToArweave(upload: FileUpload): Promise<{
    dataTxId: string;
    metadataTxId: string;
    fileId: string;
  }> {
    if (!this.arDrive) {
      throw new Error('ArDrive instance not available');
    }

    // Use the existing upload logic from SyncManager
    // This is a simplified version - the actual implementation would use ArDrive Core
    console.log(`SyncEngine[${this.mapping.driveName}] - Uploading to Arweave: ${upload.fileName}`);
    
    // For now, return mock data - this would be replaced with actual ArDrive Core calls
    return {
      dataTxId: `data-tx-${Date.now()}`,
      metadataTxId: `meta-tx-${Date.now()}`,
      fileId: `file-${Date.now()}`
    };
  }

  private async downloadExistingDriveFiles(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Starting metadata sync and file downloads`);
    
    if (!this.arDrive) {
      console.error(`SyncEngine[${this.mapping.driveName}] - ArDrive instance not available`);
      return;
    }

    try {
      // First sync all metadata to cache
      await this.syncDriveMetadata();
      
      // Then download missing files
      await this.downloadMissingFiles();
      
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Failed to sync and download:`, error);
    }
  }

  private async scanExistingFiles(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Scanning existing files`);
    
    try {
      await this.scanDirectory(this.mapping.localFolderPath);
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Error scanning files:`, error);
    }
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // Skip hidden files
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath); // Recursive scan
      } else if (entry.isFile()) {
        if (this.shouldProcessFile(fullPath)) {
          // Check if file needs to be uploaded
          await this.checkFileForUpload(fullPath);
        }
      }
    }
  }

  private async checkFileForUpload(filePath: string): Promise<void> {
    try {
      const fileHash = await this.calculateFileHash(filePath);
      const relativePath = path.relative(this.mapping.localFolderPath, filePath);
      
      // Check if already processed
      const isProcessed = await this.databaseManager.isFileProcessed(fileHash);
      
      if (!isProcessed) {
        await this.queueFileForUpload(filePath, 'create');
      }
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Error checking file:`, error);
    }
  }

  // Sync drive metadata to cache
  private async syncDriveMetadata(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Syncing drive metadata to cache...`);
    
    try {
      // Try to list all files and folders in the drive
      let allItems: any[] = [];
      
      try {
        // Use the appropriate method based on drive privacy
        console.log(`SyncEngine[${this.mapping.driveName}] - Fetching ${this.mapping.drivePrivacy} drive contents...`);
        
        if (this.mapping.drivePrivacy === 'public') {
          const folders = await this.arDrive!.listPublicFolder({
            folderId: EID(this.mapping.rootFolderId)
          });
          
          allItems = await this.recursivelyListDriveContents(this.mapping.rootFolderId, '');
        } else {
          // For private drives, we need the drive key - skip for now
          console.log(`SyncEngine[${this.mapping.driveName}] - Private drive sync not yet implemented (requires drive key)`);
          return;
        }
        
        console.log(`SyncEngine[${this.mapping.driveName}] - Found ${allItems.length} items in drive`);
        
      } catch (error) {
        console.error(`SyncEngine[${this.mapping.driveName}] - Failed to list drive contents:`, error);
        // Could implement GraphQL fallback here if needed
        return;
      }

      // Clear existing cache for this mapping
      await this.databaseManager.clearDriveMetadataCache(this.mapping.id);

      // Process and cache all items
      for (const item of allItems) {
        const localPath = path.join(this.mapping.localFolderPath, item.path || item.name);
        let localFileExists = false;
        
        if (item.type === 'file') {
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
          mappingId: this.mapping.id,
          fileId: item.fileId || item.entityId,
          parentFolderId: item.parentFolderId,
          name: item.name,
          path: item.path || item.name,
          type: item.type || (item.entityType === 'folder' ? 'folder' : 'file'),
          size: item.size,
          lastModifiedDate: item.lastModifiedDate,
          dataTxId: item.dataTxId,
          metadataTxId: item.metadataTxId,
          contentType: item.contentType,
          localPath: localPath,
          localFileExists: localFileExists,
          syncStatus: localFileExists ? 'synced' : 'pending'
        });
      }

      console.log(`SyncEngine[${this.mapping.driveName}] - Metadata sync completed`);
      
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Failed to sync drive metadata:`, error);
    }
  }

  // Recursively list all drive contents
  private async recursivelyListDriveContents(folderId: string, parentPath: string, isPrivate: boolean = false): Promise<any[]> {
    const items: any[] = [];
    
    try {
      // For now, only handle public folders
      if (isPrivate) {
        console.log(`SyncEngine[${this.mapping.driveName}] - Skipping private folder (requires drive key)`);
        return items;
      }
      
      const folderContents = await this.arDrive!.listPublicFolder({ folderId: EID(folderId) });

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
      console.error(`SyncEngine[${this.mapping.driveName}] - Failed to list folder ${folderId}:`, error);
    }

    return items;
  }

  // Download only files that don't exist locally
  private async downloadMissingFiles(): Promise<void> {
    console.log(`SyncEngine[${this.mapping.driveName}] - Checking for missing files to download...`);
    
    // Get all files from metadata cache that don't exist locally
    const allMetadata = await this.databaseManager.getDriveMetadata(this.mapping.id);
    const missingFiles = allMetadata.filter(item => 
      item.type === 'file' && 
      !item.localFileExists &&
      item.syncStatus === 'pending'
    );

    console.log(`SyncEngine[${this.mapping.driveName}] - Found ${missingFiles.length} missing files to download`);

    // Create folders first
    const folders = allMetadata.filter(item => item.type === 'folder');
    for (const folder of folders) {
      try {
        await fs.mkdir(folder.localPath, { recursive: true });
      } catch (error) {
        console.error(`SyncEngine[${this.mapping.driveName}] - Failed to create folder ${folder.localPath}:`, error);
      }
    }

    // Download missing files
    for (const file of missingFiles) {
      try {
        console.log(`SyncEngine[${this.mapping.driveName}] - Downloading missing file: ${file.name}`);
        
        // Update status to downloading
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'downloading', false);
        
        // Download the file
        await this.downloadIndividualFile(file.fileId, file.name, file.dataTxId, file.localPath);
        
        // Update status to synced
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'synced', true);
        
        // Update stats
        this.stats.downloadedFiles++;
        
      } catch (error) {
        console.error(`SyncEngine[${this.mapping.driveName}] - Failed to download ${file.name}:`, error);
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'error', false);
      }
    }

    console.log(`SyncEngine[${this.mapping.driveName}] - Missing files download completed`);
  }

  private async downloadIndividualFile(fileId: string, fileName: string, dataTxId: string, localFilePath: string): Promise<void> {
    try {
      console.log(`SyncEngine[${this.mapping.driveName}] - Starting download: ${fileName} (${fileId})`);
      
      // Check if file already exists locally
      try {
        const stats = await fs.stat(localFilePath);
        console.log(`SyncEngine[${this.mapping.driveName}] - File already exists locally: ${fileName} (${stats.size} bytes)`);
        return;
      } catch {
        // File doesn't exist, proceed with download
      }
      
      // Create download record
      const downloadId = crypto.randomUUID();
      await this.databaseManager.addDownload({
        id: downloadId,
        fileName: fileName,
        localPath: localFilePath,
        fileSize: 0, // Will be updated after download
        fileId: fileId,
        dataTxId: dataTxId,
        status: 'downloading',
        progress: 0
      });
      
      // Ensure directory exists
      const dir = path.dirname(localFilePath);
      await fs.mkdir(dir, { recursive: true });
      
      // Use appropriate download method based on drive privacy
      console.log(`SyncEngine[${this.mapping.driveName}] - Downloading file ${fileName} to ${dir}`);
      
      if (this.mapping.drivePrivacy === 'public') {
        await this.arDrive!.downloadPublicFile({
          fileId: EID(fileId),
          destFolderPath: dir
        });
      } else {
        // Private file download requires drive key - skip for now
        console.log(`SyncEngine[${this.mapping.driveName}] - Private file download not yet implemented (requires drive key)`);
        throw new Error('Private file download not yet implemented');
      }
      
      // Update download status
      const stats = await fs.stat(localFilePath);
      await this.databaseManager.updateDownload(downloadId, {
        status: 'completed',
        progress: 100,
        fileSize: stats.size
      });
      
      console.log(`SyncEngine[${this.mapping.driveName}] - Successfully downloaded: ${fileName} (${stats.size} bytes)`);
      
    } catch (error) {
      console.error(`SyncEngine[${this.mapping.driveName}] - Download failed for ${fileName}:`, error);
      throw error;
    }
  }
}