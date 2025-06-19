import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as path from 'path';
import { DatabaseManager } from './database-manager';

export type ChangeType = 'create' | 'update' | 'rename' | 'move' | 'unchanged';

export interface FileVersion {
  id: string;
  fileHash: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  fileSize: number;
  arweaveId?: string;
  turboId?: string;
  version: number;
  parentVersion?: string;
  changeType: ChangeType;
  uploadMethod?: 'ar' | 'turbo';
  createdAt: Date;
  isLatest: boolean;
}

export interface FileOperation {
  id: string;
  fileHash: string;
  operation: 'upload' | 'download' | 'rename' | 'move' | 'delete';
  fromPath?: string;
  toPath?: string;
  metadata?: any;
  timestamp: Date;
}

export class VersionManager {
  private syncFolderPath: string | null = null;

  constructor(private databaseManager: DatabaseManager) {}

  setSyncFolder(folderPath: string) {
    this.syncFolderPath = folderPath;
  }

  async calculateFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (error) {
      throw new Error(`Failed to calculate hash for ${filePath}: ${error}`);
    }
  }

  getRelativePath(filePath: string): string {
    if (!this.syncFolderPath) {
      throw new Error('Sync folder path not set');
    }
    
    // Normalize paths to handle Windows/Linux differences  
    const normalizedSyncPath = path.resolve(this.syncFolderPath);
    const normalizedFilePath = path.resolve(filePath);
    
    const relativePath = path.relative(normalizedSyncPath, normalizedFilePath);
    
    // Always use forward slashes for consistency
    return relativePath.replace(/\\/g, '/');
  }

  async detectFileChange(filePath: string): Promise<ChangeType> {
    try {
      const currentHash = await this.calculateFileHash(filePath);
      const lastVersion = await this.databaseManager.getLatestFileVersion(filePath);

      if (!lastVersion) {
        console.log(`New file detected: ${filePath}`);
        return 'create';
      }

      if (lastVersion.fileHash !== currentHash) {
        console.log(`File content changed: ${filePath}`);
        return 'update';
      }

      // Check if file was moved (different path but same content)
      // This would require additional logic to detect moves vs copies
      console.log(`File unchanged: ${filePath}`);
      return 'unchanged';
    } catch (error) {
      console.error(`Error detecting file change for ${filePath}:`, error);
      throw error;
    }
  }

  async createNewVersion(
    filePath: string, 
    changeType: ChangeType,
    uploadInfo?: {
      arweaveId?: string;
      turboId?: string;
      uploadMethod?: 'ar' | 'turbo';
    }
  ): Promise<FileVersion> {
    try {
      const fileHash = await this.calculateFileHash(filePath);
      const relativePath = this.getRelativePath(filePath);
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);

      // Get the latest version to determine next version number
      const lastVersion = await this.databaseManager.getLatestFileVersion(filePath);
      const version = lastVersion ? lastVersion.version + 1 : 1;
      const parentVersion = lastVersion ? lastVersion.id : undefined;

      const versionId = crypto.randomUUID();

      const newVersion: Omit<FileVersion, 'createdAt' | 'isLatest'> = {
        id: versionId,
        fileHash,
        fileName,
        filePath,
        relativePath,
        fileSize: stats.size,
        arweaveId: uploadInfo?.arweaveId,
        turboId: uploadInfo?.turboId,
        version,
        parentVersion,
        changeType,
        uploadMethod: uploadInfo?.uploadMethod
      };

      await this.databaseManager.addFileVersion({
        ...newVersion,
        changeType: changeType as 'create' | 'update' | 'rename' | 'move'
      });

      // Record the operation
      let operation: 'upload' | 'download' | 'rename' | 'move' | 'delete';
      switch (changeType) {
        case 'create':
          operation = 'upload';
          break;
        case 'update':
          operation = 'upload';
          break;
        case 'rename':
          operation = 'rename';
          break;
        case 'move':
          operation = 'move';
          break;
        default:
          operation = 'upload';
      }

      await this.recordFileOperation({
        id: crypto.randomUUID(),
        fileHash,
        operation,
        toPath: filePath,
        metadata: {
          versionId,
          uploadMethod: uploadInfo?.uploadMethod,
          fileSize: stats.size
        }
      });

      console.log(`Created version ${version} for file: ${filePath} (${changeType})`);

      return {
        ...newVersion,
        createdAt: new Date(),
        isLatest: true
      };
    } catch (error) {
      console.error(`Failed to create new version for ${filePath}:`, error);
      throw error;
    }
  }

  async recordFileOperation(operation: Omit<FileOperation, 'timestamp'>): Promise<void> {
    try {
      await this.databaseManager.addFileOperation(operation);
      console.log(`Recorded operation: ${operation.operation} for file hash ${operation.fileHash}`);
    } catch (error) {
      console.error(`Failed to record file operation:`, error);
      throw error;
    }
  }

  async getFileVersionHistory(filePath: string): Promise<FileVersion[]> {
    try {
      const versions = await this.databaseManager.getFileVersions(filePath);
      return versions.map(v => ({
        ...v,
        changeType: v.changeType as ChangeType,
        uploadMethod: v.uploadMethod as 'ar' | 'turbo' | undefined
      }));
    } catch (error) {
      console.error(`Failed to get version history for ${filePath}:`, error);
      throw error;
    }
  }

  async getFileOperationHistory(fileHash: string): Promise<FileOperation[]> {
    try {
      const operations = await this.databaseManager.getFileOperations(fileHash);
      return operations.map(op => ({
        ...op,
        operation: op.operation as 'upload' | 'download' | 'rename' | 'move' | 'delete'
      }));
    } catch (error) {
      console.error(`Failed to get operation history for file hash ${fileHash}:`, error);
      throw error;
    }
  }

  async detectMove(fromPath: string, toPath: string): Promise<boolean> {
    try {
      // Check if this is a move by comparing file hashes
      const fromHash = await this.calculateFileHash(fromPath).catch(() => null);
      const toHash = await this.calculateFileHash(toPath).catch(() => null);

      if (fromHash && toHash && fromHash === toHash) {
        console.log(`Move detected: ${fromPath} -> ${toPath}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Error detecting move from ${fromPath} to ${toPath}:`, error);
      return false;
    }
  }

  async handleFileMove(fromPath: string, toPath: string): Promise<void> {
    try {
      const fileHash = await this.calculateFileHash(toPath);
      
      // Create a new version for the move
      await this.createNewVersion(toPath, 'move');

      // Record the move operation
      await this.recordFileOperation({
        id: crypto.randomUUID(),
        fileHash,
        operation: 'move',
        fromPath,
        toPath,
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

      console.log(`Handled file move: ${fromPath} -> ${toPath}`);
    } catch (error) {
      console.error(`Failed to handle file move from ${fromPath} to ${toPath}:`, error);
      throw error;
    }
  }

  async handleFileRename(oldPath: string, newPath: string): Promise<void> {
    try {
      const fileHash = await this.calculateFileHash(newPath);
      
      // Create a new version for the rename
      await this.createNewVersion(newPath, 'rename');

      // Record the rename operation
      await this.recordFileOperation({
        id: crypto.randomUUID(),
        fileHash,
        operation: 'rename',
        fromPath: oldPath,
        toPath: newPath,
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

      console.log(`Handled file rename: ${oldPath} -> ${newPath}`);
    } catch (error) {
      console.error(`Failed to handle file rename from ${oldPath} to ${newPath}:`, error);
      throw error;
    }
  }

  async isFileTracked(filePath: string): Promise<boolean> {
    try {
      const version = await this.databaseManager.getLatestFileVersion(filePath);
      return !!version;
    } catch (error) {
      console.error(`Error checking if file is tracked: ${filePath}`, error);
      return false;
    }
  }

  async getVersionCount(filePath: string): Promise<number> {
    try {
      const versions = await this.databaseManager.getFileVersions(filePath);
      return versions.length;
    } catch (error) {
      console.error(`Error getting version count for ${filePath}:`, error);
      return 0;
    }
  }

  // Utility method to clean up old versions (keep last N versions)
  async cleanupOldVersions(filePath: string, keepCount: number = 10): Promise<void> {
    try {
      const versions = await this.databaseManager.getFileVersions(filePath);
      
      if (versions.length <= keepCount) {
        return; // Nothing to clean up
      }

      const versionsToDelete = versions.slice(keepCount);
      
      for (const version of versionsToDelete) {
        // Note: This would require additional logic to actually delete from Arweave
        // For now, we just mark them in our database
        console.log(`Would clean up version ${version.version} of ${filePath}`);
      }
    } catch (error) {
      console.error(`Error cleaning up old versions for ${filePath}:`, error);
    }
  }
}