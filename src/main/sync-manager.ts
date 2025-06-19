import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { ArDrive, wrapFileOrFolder, EID, FolderID } from 'ardrive-core-js';
import { DatabaseManager } from './database-manager';
import { VersionManager, ChangeType } from './version-manager';
import { FileUpload, SyncStatus, PendingUpload } from '../types';
import { turboManager } from './turbo-manager';

export class SyncManager {
  private watcher: chokidar.FSWatcher | null = null;
  private syncFolderPath: string | null = null;
  private driveId: string | null = null;
  private rootFolderId: string | null = null;
  private isActive = false;
  private uploadQueue: Map<string, FileUpload> = new Map();
  private arDrive: ArDrive | null = null;
  private versionManager: VersionManager;
  private pendingDeletes = new Map<string, NodeJS.Timeout>();
  private isDownloading = false; // Flag to indicate when downloads are in progress

  constructor(private databaseManager: DatabaseManager) {
    this.versionManager = new VersionManager(databaseManager);
  }

  setSyncFolder(folderPath: string) {
    console.log('SyncManager.setSyncFolder:', folderPath);
    this.syncFolderPath = folderPath;
    this.versionManager.setSyncFolder(folderPath);
  }

  setArDrive(arDrive: ArDrive) {
    console.log('SyncManager.setArDrive - ArDrive instance set');
    this.arDrive = arDrive;
  }

  async startSync(driveId: string, rootFolderId: string, driveName?: string): Promise<boolean> {
    console.log('SyncManager.startSync called with:', { 
      driveId, 
      rootFolderId,
      driveName,
      hasSyncFolder: !!this.syncFolderPath,
      hasArDrive: !!this.arDrive
    });
    
    if (!this.syncFolderPath || !this.arDrive) {
      throw new Error('Sync folder and ArDrive instance must be set');
    }

    // If we have a drive name, create a subfolder for this drive
    // This ensures consistency - we only watch the drive folder, not the parent
    if (driveName) {
      const driveFolderPath = path.join(this.syncFolderPath, driveName);
      
      // Ensure the drive folder exists
      try {
        await fs.mkdir(driveFolderPath, { recursive: true });
        console.log(`Created/verified drive folder: ${driveFolderPath}`);
      } catch (error) {
        throw new Error(`Failed to create drive folder: ${driveFolderPath}`);
      }
      
      // Update sync folder to the drive-specific folder
      this.syncFolderPath = driveFolderPath;
      this.versionManager.setSyncFolder(driveFolderPath);
    }

    this.driveId = driveId;
    this.rootFolderId = rootFolderId;
    this.isActive = true;

    // Load existing processed files from database
    const processedFiles = await this.databaseManager.getProcessedFiles();
    console.log(`Loaded ${processedFiles.length} processed files from database`);

    // Download existing files from ArDrive to local folder
    this.isDownloading = true;
    try {
      await this.downloadExistingDriveFiles();
      
      // Longer delay to ensure all download operations and database transactions are complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      this.isDownloading = false;
    }

    // Scan existing files (should now skip downloaded files due to database checking)
    console.log('Starting scan of existing files...');
    await this.scanExistingFiles();

    // Start watching for new files
    console.log('Starting file watcher for:', this.syncFolderPath);
    this.watcher = chokidar.watch(this.syncFolderPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true // We've already scanned existing files
    });

    // File events
    this.watcher.on('add', (filePath) => {
      console.log('New file detected:', filePath);
      this.handleFileAdd(filePath);
    });

    this.watcher.on('change', (filePath) => {
      console.log('File changed:', filePath);
      this.handleFileChange(filePath);
    });

    this.watcher.on('unlink', (filePath) => {
      console.log('File deleted:', filePath);
      this.handleFileDelete(filePath);
    });

    // Folder events
    this.watcher.on('addDir', (dirPath) => {
      console.log('New folder detected:', dirPath);
      this.handleFolderAdd(dirPath);
    });

    this.watcher.on('unlinkDir', (dirPath) => {
      console.log('Folder deleted:', dirPath);
      this.handleFolderDelete(dirPath);
    });

    this.watcher.on('ready', () => {
      console.log('File watcher is ready and monitoring for changes');
    });

    this.watcher.on('error', (error) => {
      console.error('Watcher error:', error);
    });

    // Start processing upload queue
    this.processUploadQueue();

    return true;
  }

  async stopSync(): Promise<boolean> {
    this.isActive = false;
    
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    return true;
  }

  async getStatus(): Promise<SyncStatus> {
    const uploads = await this.databaseManager.getUploads();
    const pendingFiles = uploads.filter(u => u.status === 'pending' || u.status === 'uploading').length;
    const uploadedFiles = uploads.filter(u => u.status === 'completed').length;
    const failedFiles = uploads.filter(u => u.status === 'failed').length;

    const currentUpload = Array.from(this.uploadQueue.values()).find(u => u.status === 'uploading');

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
    this.uploadQueue.set(upload.id, upload);
  }

  // Force re-download of existing drive files
  async forceDownloadExistingFiles(): Promise<void> {
    console.log('Force downloading existing drive files...');
    if (!this.arDrive || !this.rootFolderId || !this.syncFolderPath) {
      throw new Error('Sync not properly initialized');
    }
    
    // Set downloading flag to prevent file watcher from processing downloaded files
    this.isDownloading = true;
    try {
      await this.downloadExistingDriveFiles();
      
      // Wait a bit more to ensure all database transactions are complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      this.isDownloading = false;
    }
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
      // Use the raw Arweave instance to query for files
      const arweave = require('arweave').init({
        host: 'arweave.net',
        port: 443,
        protocol: 'https'
      });
      
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
      
      const result = await response.json();
      console.log('Direct GraphQL result:', result);
      
      if (result.data?.transactions?.edges) {
        const transactions = result.data.transactions.edges;
        console.log(`Found ${transactions.length} file transactions via direct query`);
        
        for (const edge of transactions) {
          const tx = edge.node;
          const tags = tx.tags || [];
          
          // Extract file info from tags
          const fileName = tags.find((t: any) => t.name === 'File-Name')?.value;
          const fileId = tags.find((t: any) => t.name === 'File-Id')?.value;
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
  private async downloadIndividualFile(fileId: string, fileName: string, dataTxId: string): Promise<void> {
    try {
      console.log(`Starting individual download: ${fileName} (${fileId})`);
      
      const localFilePath = path.join(this.syncFolderPath!, fileName);
      
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
        fileName: fileName,
        localPath: localFilePath,
        fileSize: 0, // We'll update this after download
        fileId: fileId,
        dataTxId: dataTxId,
        status: 'downloading',
        progress: 0
      });
      
      // Use ArDrive's downloadPublicFile method
      console.log(`Downloading file ${fileName} to ${path.dirname(localFilePath)}`);
      await this.arDrive!.downloadPublicFile({
        fileId: EID(fileId),
        destFolderPath: path.dirname(localFilePath),
        defaultFileName: fileName
      });
      
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
      await this.syncDriveMetadata();
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

      const relativePath = fileData.path || fileData.name;
      const localFilePath = path.join(this.syncFolderPath!, relativePath);
      
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
      
      // Add to processed files database to avoid re-uploading
      const content = await fs.readFile(localFilePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const stats = await fs.stat(localFilePath);
      const fileName = path.basename(localFilePath);
      
      await this.databaseManager.addProcessedFile(
        hash,
        fileName,
        stats.size,
        localFilePath,
        'download',
        fileData.fileId
      );
      
      console.log(`Added downloaded file to processed database:`);
      console.log(`  - File: ${fileData.name}`);
      console.log(`  - Hash: ${hash}`);
      console.log(`  - Size: ${stats.size}`);

      console.log(`Successfully completed download: ${fileData.name}`);
      
      // Small delay to ensure database transaction completes before file watcher detects the file
      await new Promise(resolve => setTimeout(resolve, 100));

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
    // Skip processing if we're currently downloading files
    if (this.isDownloading) {
      console.log(`Skipping file add event during download: ${filePath}`);
      return;
    }
    await this.handleFileWithVersioning(filePath, 'create');
  }

  private async handleFileChange(filePath: string) {
    // Skip processing if we're currently downloading files
    if (this.isDownloading) {
      console.log(`Skipping file change event during download: ${filePath}`);
      return;
    }
    await this.handleFileWithVersioning(filePath, 'update');
  }

  private async handleFileDelete(filePath: string) {
    // Use pending delete to detect moves
    this.pendingDeletes.set(filePath, setTimeout(async () => {
      try {
        await this.confirmFileDelete(filePath);
      } catch (error) {
        console.error('Failed to confirm file delete:', error);
      } finally {
        this.pendingDeletes.delete(filePath);
      }
    }, 1000)); // Wait 1 second before confirming delete
  }

  private async confirmFileDelete(filePath: string) {
    try {
      const fileHash = await this.versionManager.calculateFileHash(filePath).catch(() => null);
      if (fileHash) {
        await this.versionManager.recordFileOperation({
          id: crypto.randomUUID(),
          fileHash,
          operation: 'delete',
          fromPath: filePath,
          metadata: {
            timestamp: new Date().toISOString()
          }
        });
      }
      console.log(`Confirmed file deletion: ${filePath}`);
    } catch (error) {
      console.error(`Error confirming file deletion for ${filePath}:`, error);
    }
  }

  private async handleFolderAdd(dirPath: string) {
    try {
      if (!this.syncFolderPath || dirPath === this.syncFolderPath) {
        return; // Skip root folder
      }

      const relativePath = this.versionManager.getRelativePath(dirPath);
      const parentPath = path.dirname(dirPath);
      
      console.log(`Creating folder: ${relativePath}`);
      
      // Create folder on Arweave first
      let arweaveFolderId: string | undefined;
      if (this.arDrive && this.rootFolderId) {
        try {
          console.log(`Creating folder on Arweave: ${relativePath}`);
          
          // Find parent folder ID for nested folders
          let parentFolderId = this.rootFolderId;
          if (parentPath !== this.syncFolderPath) {
            const parentFolder = await this.databaseManager.getFolderByPath(parentPath);
            if (parentFolder?.arweaveFolderId) {
              parentFolderId = parentFolder.arweaveFolderId;
            }
          }

          const folderName = path.basename(dirPath);
          const result = await this.arDrive.createPublicFolder({
            parentFolderId: EID(parentFolderId),
            folderName: folderName
          });

          if (result.created && result.created.length > 0) {
            const createdFolder = result.created[0];
            if (createdFolder.type === 'folder' && createdFolder.entityId) {
              arweaveFolderId = createdFolder.entityId.toString();
              console.log(`✓ Folder created on Arweave with ID: ${arweaveFolderId}`);
            }
          }
        } catch (arweaveError) {
          console.error(`Failed to create folder on Arweave: ${arweaveError}`);
          // Continue with local tracking even if Arweave creation fails
        }
      }
      
      await this.databaseManager.addFolder({
        id: crypto.randomUUID(),
        folderPath: dirPath,
        relativePath,
        parentPath: parentPath !== this.syncFolderPath ? parentPath : undefined,
        arweaveFolderId
      });

      console.log(`Folder added to database: ${relativePath}${arweaveFolderId ? ` (Arweave ID: ${arweaveFolderId})` : ' (local only)'}`);
    } catch (error) {
      console.error(`Error handling folder add for ${dirPath}:`, error);
    }
  }

  private async handleFolderDelete(dirPath: string) {
    try {
      await this.databaseManager.markFolderDeleted(dirPath);
      console.log(`Marked folder as deleted: ${dirPath}`);
    } catch (error) {
      console.error(`Error handling folder delete for ${dirPath}:`, error);
    }
  }

  private async handleFileWithVersioning(filePath: string, expectedChange: ChangeType) {
    try {
      // Check if this is actually a move (file appeared after a recent delete)
      const fileName = path.basename(filePath);
      for (const [deletedPath, timeout] of this.pendingDeletes) {
        if (path.basename(deletedPath) === fileName) {
          // This might be a move
          clearTimeout(timeout);
          this.pendingDeletes.delete(deletedPath);
          
          const isMove = await this.versionManager.detectMove(deletedPath, filePath);
          if (isMove) {
            await this.versionManager.handleFileMove(deletedPath, filePath);
            return;
          }
        }
      }

      // Detect actual change type
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
      if (stats.size > 100 * 1024 * 1024) {
        console.log(`Skipping large file: ${filePath} (${stats.size} bytes)`);
        return;
      }

      // Check if we've already processed this file
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const fileName = path.basename(filePath);

      console.log(`File hash check for ${fileName}:`);
      console.log(`  - Generated hash: ${hash}`);
      console.log(`  - File size: ${stats.size}`);
      console.log(`  - File path: ${filePath}`);
      
      // Check database for this file hash
      const isAlreadyProcessed = await this.databaseManager.isFileProcessed(hash);
      console.log(`  - Already processed: ${isAlreadyProcessed}`);
      
      // Additional debugging: check if this file was recently downloaded
      const processedFiles = await this.databaseManager.getProcessedFiles();
      const matchingFiles = processedFiles.filter(f => f.fileHash === hash);
      if (matchingFiles.length > 0) {
        console.log(`  - Found ${matchingFiles.length} matching file(s) in database:`);
        matchingFiles.forEach((f, index) => {
          console.log(`    ${index + 1}. Source: ${f.source}, Path: ${f.localPath}, ProcessedAt: ${f.processedAt}`);
        });
      }

      if (isAlreadyProcessed) {
        console.log(`✓ File already processed, skipping: ${filePath}`);
        return; // Already processed
      }

      console.log(`Adding new file to PENDING APPROVAL queue: ${path.basename(filePath)}`);
      
      // Calculate estimated costs for both AR and Turbo
      // ArDrive uses ~1 winston per byte, convert to AR (1 AR = 1e12 winston)
      const estimatedCostWinc = stats.size; // winston
      const estimatedCost = estimatedCostWinc / 1e12; // Convert to AR
      let estimatedTurboCost: number | undefined;
      let recommendedMethod: 'ar' | 'turbo' = 'ar';
      
      // Always try to get Turbo cost and check balance - this enables the option in UI
      let hasSufficientTurboBalance = false;
      try {
        if (turboManager.isInitialized()) {
          console.log('Turbo manager is initialized, getting cost estimate...');
          const turboCosts = await turboManager.getUploadCosts(stats.size);
          estimatedTurboCost = parseFloat(turboCosts.winc) / 1e12; // Convert winc to AR equivalent
          console.log(`Turbo cost calculated: ${estimatedTurboCost} AR`);
          
          // Check if user has sufficient Turbo balance
          try {
            const balance = await turboManager.getBalance();
            const balanceInWinc = parseFloat(balance.winc);
            const requiredWinc = parseFloat(turboCosts.winc);
            hasSufficientTurboBalance = balanceInWinc >= requiredWinc;
            console.log(`Turbo balance check: Required ${(requiredWinc/1e12).toFixed(6)} AR, Available ${balance.ar} AR, Sufficient: ${hasSufficientTurboBalance}`);
          } catch (balanceError) {
            console.log('Failed to check Turbo balance:', balanceError);
            hasSufficientTurboBalance = false;
          }
          
          // Recommend Turbo for files > 1MB or if significantly cheaper (and user has balance)
          const isLargeFile = stats.size > 1024 * 1024;
          const isCheaper = estimatedTurboCost < estimatedCost * 0.9; // 10% cheaper
          
          if (hasSufficientTurboBalance && (isLargeFile || isCheaper)) {
            recommendedMethod = 'turbo';
            console.log('Recommending Turbo due to:', { isLargeFile, isCheaper, hasSufficientTurboBalance });
          }
        } else {
          // Even if not initialized, show Turbo option with estimated cost
          // This allows users to see the option and get Turbo Credits if needed
          console.log('Turbo manager not initialized, using estimated cost...');
          
          // Rough estimate: Turbo is typically similar cost to AR but faster
          // We'll set it to a slightly higher cost to be conservative
          estimatedTurboCost = estimatedCost * 1.1; // 10% more than AR, already in AR units
          console.log(`Turbo estimated cost (not initialized): ${estimatedTurboCost} AR`);
          hasSufficientTurboBalance = false; // Can't have balance if not initialized
        }
      } catch (turboError) {
        console.warn('Failed to get Turbo cost estimate:', turboError);
        // Even on error, provide estimated cost so users see the option
        estimatedTurboCost = estimatedCost * 1.1; // Conservative estimate, already in AR
        hasSufficientTurboBalance = false;
      }
      
      // TODO: Add conflict detection logic here
      const conflictType = 'none'; // For now, assume no conflicts
      const conflictDetails = undefined;
      
      const pendingUpload: Omit<PendingUpload, 'createdAt'> = {
        id: crypto.randomUUID(),
        localPath: filePath,
        fileName: path.basename(filePath),
        fileSize: stats.size,
        estimatedCost,
        estimatedTurboCost,
        recommendedMethod,
        hasSufficientTurboBalance,
        conflictType,
        conflictDetails,
        status: 'awaiting_approval'
      };

      await this.databaseManager.addPendingUpload(pendingUpload);
      
      // Create file version (without upload info yet, will be updated after upload)
      await this.versionManager.createNewVersion(filePath, changeType);
      
      // Only add to processed files database if not already there
      // (avoids duplicate entries for downloaded files)
      if (!isAlreadyProcessed) {
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
      const costInAR = estimatedCost.toFixed(6);
      const turboCostDisplay = estimatedTurboCost ? estimatedTurboCost.toFixed(6) : 'N/A';
      console.log(`File added to pending approval queue: ${pendingUpload.fileName} (AR Cost: ${costInAR} AR, Turbo Cost: ${turboCostDisplay} AR, Change: ${changeType})`);

    } catch (error) {
      console.error(`Failed to handle new file ${filePath}:`, error);
    }
  }

  private async processUploadQueue() {
    console.log('Starting upload queue processor');
    while (this.isActive) {
      const pendingUploads = Array.from(this.uploadQueue.values())
        .filter(u => u.status === 'pending');

      if (pendingUploads.length > 0) {
        console.log(`Processing ${pendingUploads.length} pending uploads`);
        const upload = pendingUploads[0];
        await this.uploadFile(upload);
      } else {
        // console.log('No pending uploads, waiting...');
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('Upload queue processor stopped');
  }

  private async uploadFile(upload: FileUpload) {
    console.log(`Starting upload for file: ${upload.fileName} using method: ${upload.uploadMethod || 'ar'}`);
    if (!this.arDrive || !this.rootFolderId) {
      console.error('Cannot upload: ArDrive or rootFolderId not available');
      return;
    }

    try {
      // Update status to uploading
      console.log(`Setting upload status to 'uploading' for ${upload.fileName}`);
      upload.status = 'uploading';
      await this.databaseManager.updateUpload(upload.id, { status: 'uploading' });

      // Use ArDrive Core for both AR and Turbo uploads
      // The upload method is determined by ArDrive Core based on wallet configuration and payment method selection
      await this.uploadFileWithArDriveCore(upload);

    } catch (error) {
      console.error(`Failed to upload ${upload.fileName}:`, error);
      
      upload.status = 'failed';
      upload.error = error instanceof Error ? error.message : 'Unknown error';

      await this.databaseManager.updateUpload(upload.id, {
        status: 'failed',
        error: upload.error
      });
    }
  }

  private async uploadFileWithArDriveCore(upload: FileUpload) {
    console.log(`Uploading ${upload.fileName} with ArDrive Core (method: ${upload.uploadMethod || 'ar'})`);
    
    try {
      // Get the correct parent folder for this file
      const targetFolderId = await this.getTargetFolderId(upload.localPath);
      
      // Wrap file for upload using ArDrive Core
      const wrappedFile = wrapFileOrFolder(upload.localPath);
      
      // Upload file using ArDrive Core's recommended API
      const result = await this.arDrive!.uploadAllEntities({
        entitiesToUpload: [
          {
            wrappedEntity: wrappedFile,
            destFolderId: EID(targetFolderId) // Upload to correct folder
          }
        ]
      });

      console.log('ArDrive Core upload result:', result);
      
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
      upload.completedAt = new Date();

      console.log(`ArDrive Core upload completed - Data TX: ${dataTxId}, Metadata TX: ${metadataTxId}, File-ID: ${fileId}`);

      await this.databaseManager.updateUpload(upload.id, {
        status: 'completed',
        progress: 100,
        dataTxId: upload.dataTxId,
        metadataTxId: upload.metadataTxId,
        transactionId: upload.transactionId,
        completedAt: upload.completedAt
      });

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

      this.uploadQueue.delete(upload.id);

    } catch (error) {
      console.error(`ArDrive Core upload failed for ${upload.fileName}:`, error);
      throw error;
    }
  }

  private async getTargetFolderId(filePath: string): Promise<string> {
    // Get the directory containing the file
    const fileDir = path.dirname(filePath);
    
    // If file is in sync root, use root folder ID
    if (fileDir === this.syncFolderPath) {
      return this.rootFolderId!;
    }
    
    // Find the Arweave folder ID for the file's directory
    const folder = await this.databaseManager.getFolderByPath(fileDir);
    if (folder?.arweaveFolderId) {
      return folder.arweaveFolderId;
    }
    
    // Fallback to root if folder not found
    console.warn(`No Arweave folder found for ${fileDir}, using root folder`);
    return this.rootFolderId!;
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
    console.log('Syncing drive metadata to cache...');
    
    // Get the mapping ID for this drive
    const mappings = await this.databaseManager.getDriveMappings();
    const mapping = mappings.find(m => m.driveId === this.driveId);
    if (!mapping) {
      console.error('No mapping found for drive:', this.driveId);
      return;
    }

    try {
      // Try to list all files and folders in the drive
      let allItems: any[] = [];
      
      try {
        // First try the standard ArDrive Core approach
        console.log('Fetching drive contents via ArDrive Core...');
        const folders = await this.arDrive!.listPublicFolder({
          folderId: EID(this.rootFolderId!)
        });
        
        allItems = await this.recursivelyListDriveContents(this.rootFolderId!, '');
        console.log(`Found ${allItems.length} items in drive`);
        
      } catch (error) {
        console.log('ArDrive Core listing failed, trying direct GraphQL...');
        // Fallback to direct GraphQL query if ArDrive Core fails
        allItems = await this.fetchDriveContentsViaGraphQL();
      }

      // Clear existing cache for this mapping
      await this.databaseManager.clearDriveMetadataCache(mapping.id);

      // Process and cache all items
      for (const item of allItems) {
        const localPath = path.join(this.syncFolderPath!, item.path || item.name);
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
          mappingId: mapping.id,
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

      console.log('Metadata sync completed');
      
      // Now download only missing files
      await this.downloadMissingFiles(mapping.id);
      
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
        
        // Use existing download method
        await this.downloadIndividualFile(file.fileId, file.name, file.dataTxId);
        
        // Update status to synced
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'synced', true);
        
      } catch (error) {
        console.error(`Failed to download ${file.name}:`, error);
        await this.databaseManager.updateDriveMetadataStatus(file.fileId, 'error', false);
      }
    }

    console.log('Missing files download completed');
  }
}