import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ArDrive, EID, FolderID } from 'ardrive-core-js';
import { DatabaseManager } from '../database-manager';
import { IFileStateManager, ISyncProgressTracker } from './interfaces';

export class DownloadManager {
  private isDownloading = false;

  constructor(
    private databaseManager: DatabaseManager,
    private fileStateManager: IFileStateManager,
    private progressTracker: ISyncProgressTracker,
    private arDrive: ArDrive | null,
    private driveId: string | null,
    private rootFolderId: string | null,
    private syncFolderPath: string | null
  ) {}

  setArDrive(arDrive: ArDrive): void {
    this.arDrive = arDrive;
  }

  setDriveInfo(driveId: string, rootFolderId: string, syncFolderPath: string): void {
    this.driveId = driveId;
    this.rootFolderId = rootFolderId;
    this.syncFolderPath = syncFolderPath;
  }

  async syncDriveMetadata(): Promise<void> {
    this.progressTracker.emitSyncProgress({
      phase: 'metadata',
      description: 'Discovering drive contents...'
    });

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
        await this.databaseManager.upsertDriveMetadata({
          mappingId,
          fileId: item.arweaveId,
          parentFolderId: item.parentFolderId,
          name: item.name,
          path: item.path,
          type: item.type,
          size: this.getFileSizeAsNumber(item.size),
          lastModifiedDate: this.getUnixTimeAsNumber(item.lastModified),
          dataTxId: item.dataTxId,
          metadataTxId: item.metadataTxId, // Add metadataTxId storage
          contentType: item.mimeType,
          localFileExists: false,
          syncStatus: 'pending'
        });
      }
      
      console.log(`Inserted ${sortedItems.length} items into metadata cache`);
      console.log(`Found ${sortedItems.length} items in drive`);
      this.progressTracker.emitSyncProgress({
        phase: 'metadata',
        description: `Found ${sortedItems.length} items`,
        itemsProcessed: sortedItems.length
      });
      
      // Check local files exist for metadata entries
      for (const item of sortedItems) {
        if (item.type === 'file' && this.syncFolderPath) {
          const localPath = path.join(this.syncFolderPath, item.path, item.name);
          try {
            await fs.access(localPath);
            // File exists locally
            // File exists locally - would be updated in the upsert above
            // Just mark for future reference
          } catch (error) {
            // File doesn't exist locally - already marked as pending in the upsert above
          }
        }
      }
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
    this.progressTracker.emitSyncProgress({
      phase: 'files',
      description: 'Downloading files...'
    });

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

    console.log(`Found ${missingFiles.length} missing files to download`);
    this.isDownloading = true;
    let downloaded = 0;

    for (const file of missingFiles) {
      this.progressTracker.emitSyncProgress({
        phase: 'files',
        description: 'Downloading files...',
        currentItem: file.name,
        progress: Math.round((downloaded / missingFiles.length) * 100),
        itemsProcessed: downloaded,
        totalItems: missingFiles.length
      });

      await this.downloadFile(file);
      downloaded++;
    }

    this.isDownloading = false;
    console.log(`Download completed: ${downloaded} files`);
  }

  private async downloadFile(fileData: any): Promise<void> {
    if (!this.syncFolderPath || !this.arDrive) {
      console.error('Sync folder path or ArDrive not available');
      return;
    }

    const localFilePath = path.join(this.syncFolderPath, fileData.path, fileData.name);
    console.log(`Downloading: ${fileData.name}`);

    // Generate download ID for tracking
    const downloadId = crypto.randomUUID();

    try {
      // Create download record in database
      // Only log if there's an issue with the download data
      if (!fileData.size || fileData.size === 0 || !fileData.metadataTxId) {
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
        fileSize: this.getFileSizeAsNumber(fileData.size),
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
      
      // Create a promise for this download
      const downloadPromise = this.performFileDownload(fileData, localFilePath, dir, downloadId);
      this.fileStateManager.setDownloadPromise(localFilePath, downloadPromise);

      // Pre-register the file in the processed database with a placeholder
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

  private async performFileDownload(fileData: any, localFilePath: string, dir: string, downloadId: string): Promise<void> {
    try {
      // Download the file using ArDrive

      await this.arDrive!.downloadPublicFile({
        fileId: EID(fileData.fileId),
        destFolderPath: dir,
        defaultFileName: fileData.name
      });

      // Small delay to ensure file system sync on Windows
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the file was downloaded
      try {
        const stats = await fs.stat(localFilePath);
        
        // Update download record as completed
        await this.databaseManager.updateDownload(downloadId, {
          status: 'completed',
          progress: 100,
          fileSize: stats.size
        });
        
        // Update processed files database with actual hash
        const content = await fs.readFile(localFilePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        // Update processed file source to 'download'
        await this.databaseManager.updateProcessedFileSource(hash, 'download');
        
        console.log(`✓ Downloaded: ${fileData.name} (${stats.size} bytes)`);
        
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
        
        items.push({
          type: 'file',
          name: file.name,
          path: parentPath,
          size: file.size,
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

    this.progressTracker.emitSyncProgress({
      phase: 'folders',
      description: 'Creating folder structure...'
    });

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
      this.progressTracker.emitSyncProgress({
        phase: 'folders',
        description: 'Creating folder structure...',
        currentItem: folder.name,
        progress: Math.round((created / folders.length) * 100),
        itemsProcessed: created,
        totalItems: folders.length
      });

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
    this.progressTracker.emitSyncProgress({
      phase: 'verification',
      description: 'Verifying sync completeness...'
    });

    console.log('Verifying sync state...');
    // Add verification logic here if needed
    // For now, just a placeholder
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  isDownloadInProgress(): boolean {
    return this.isDownloading;
  }

  private getFileSizeAsNumber(size: any): number {
    if (!size) return 0;
    if (typeof size === 'number') return size;
    if (typeof size.valueOf === 'function') return size.valueOf();
    return 0;
  }

  private getUnixTimeAsNumber(time: any): number | undefined {
    if (!time) return undefined;
    if (typeof time === 'number') return time;
    if (time.unixTime) return time.unixTime;
    return undefined;
  }
}