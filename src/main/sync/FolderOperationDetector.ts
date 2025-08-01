import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface FolderSnapshot {
  path: string;
  name: string;
  parentPath: string;
  timestamp: Date;
  fileCount: number;
  immediateChildren: string[];
  totalSize: number;
  contentHash: string;
  arfsFolderId?: string;
}

export interface OperationDetection {
  type: 'rename' | 'move' | 'rename_and_move' | 'delete' | 'new';
  oldPath?: string;
  newPath?: string;
  oldArweaveFolderId?: string;
  reason: string;
}

interface PendingOperation {
  snapshot: FolderSnapshot;
  timeout: NodeJS.Timeout;
}

export class FolderOperationDetector {
  private pendingDeletes = new Map<string, PendingOperation>();
  private recentOperations = new Map<string, OperationDetection>();
  private readonly DETECTION_WINDOW_MS = 2000; // 2 seconds
  private readonly OPERATION_CACHE_MS = 10000; // 10 seconds

  constructor() {
    // Clean up old operations periodically
    setInterval(() => this.cleanupOldOperations(), 60000); // Every minute
  }

  async createSnapshot(folderPath: string, arfsFolderId?: string): Promise<FolderSnapshot> {
    try {
      const stats = await fs.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${folderPath}`);
      }

      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const immediateChildren: string[] = [];
      let totalSize = 0;
      let fileCount = 0;
      const contentParts: string[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files
        
        immediateChildren.push(entry.name);
        const entryPath = path.join(folderPath, entry.name);
        
        if (entry.isFile()) {
          fileCount++;
          const fileStats = await fs.stat(entryPath);
          totalSize += fileStats.size;
          // Add file name and size to content hash
          contentParts.push(`${entry.name}:${fileStats.size}`);
        } else if (entry.isDirectory()) {
          // For directories, just add the name
          contentParts.push(`dir:${entry.name}`);
        }
      }

      // Sort for consistent hashing
      contentParts.sort();
      const contentHash = crypto.createHash('sha256')
        .update(contentParts.join('|'))
        .digest('hex');

      return {
        path: folderPath,
        name: path.basename(folderPath),
        parentPath: path.dirname(folderPath),
        timestamp: new Date(),
        fileCount,
        immediateChildren: immediateChildren.sort(),
        totalSize,
        contentHash,
        arfsFolderId
      };
    } catch (error) {
      console.error(`Failed to create snapshot for ${folderPath}:`, error);
      throw error;
    }
  }

  async onFolderDelete(folderPath: string, arfsFolderId?: string, onConfirmDelete?: () => Promise<void>): Promise<void> {
    console.log(`FolderOperationDetector: Folder delete detected - ${folderPath}`);
    
    // Clear any existing pending delete for this path
    const existing = this.pendingDeletes.get(folderPath);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    // Create snapshot from our last known state (we can't read the folder anymore)
    const snapshot: FolderSnapshot = {
      path: folderPath,
      name: path.basename(folderPath),
      parentPath: path.dirname(folderPath),
      timestamp: new Date(),
      fileCount: 0, // We don't know these anymore
      immediateChildren: [],
      totalSize: 0,
      contentHash: '',
      arfsFolderId
    };

    // Set timeout to confirm delete
    const timeout = setTimeout(async () => {
      this.confirmDelete(folderPath);
      // Call the callback to actually delete from database
      if (onConfirmDelete) {
        await onConfirmDelete();
      }
    }, this.DETECTION_WINDOW_MS);

    this.pendingDeletes.set(folderPath, { snapshot, timeout });
  }

  async onFolderAdd(folderPath: string): Promise<OperationDetection | null> {
    console.log(`FolderOperationDetector: Folder add detected - ${folderPath}`);
    
    try {
      const newSnapshot = await this.createSnapshot(folderPath);
      
      // Check all pending deletes for potential matches
      for (const [deletedPath, pending] of this.pendingDeletes) {
        const detection = this.detectOperation(pending.snapshot, newSnapshot);
        
        if (detection.type !== 'new') {
          // Cancel the pending delete
          clearTimeout(pending.timeout);
          this.pendingDeletes.delete(deletedPath);
          
          // Cache the operation
          this.cacheOperation(folderPath, detection);
          
          console.log(`FolderOperationDetector: Detected ${detection.type} operation`);
          return detection;
        }
      }
      
      // No match found, this is a new folder
      const newFolderDetection: OperationDetection = {
        type: 'new',
        newPath: folderPath,
        reason: 'No matching deleted folder found within detection window'
      };
      
      this.cacheOperation(folderPath, newFolderDetection);
      return newFolderDetection;
      
    } catch (error) {
      console.error(`Failed to analyze folder add for ${folderPath}:`, error);
      return null;
    }
  }

  private detectOperation(oldSnapshot: FolderSnapshot, newSnapshot: FolderSnapshot): OperationDetection {
    // Calculate similarity scores
    const contentMatch = oldSnapshot.contentHash === newSnapshot.contentHash;
    const nameMatch = oldSnapshot.name === newSnapshot.name;
    const parentMatch = oldSnapshot.parentPath === newSnapshot.parentPath;
    const childrenSimilarity = this.calculateChildrenSimilarity(
      oldSnapshot.immediateChildren, 
      newSnapshot.immediateChildren
    );

    // Determine operation type
    if (parentMatch && !nameMatch) {
      // Same parent, different name = rename
      return {
        type: 'rename',
        oldPath: oldSnapshot.path,
        newPath: newSnapshot.path,
        oldArweaveFolderId: oldSnapshot.arfsFolderId,
        reason: `Folder renamed from '${oldSnapshot.name}' to '${newSnapshot.name}' in same parent directory`
      };
    } else if (!parentMatch && nameMatch) {
      // Different parent, same name = move
      return {
        type: 'move',
        oldPath: oldSnapshot.path,
        newPath: newSnapshot.path,
        oldArweaveFolderId: oldSnapshot.arfsFolderId,
        reason: `Folder '${oldSnapshot.name}' moved from '${oldSnapshot.parentPath}' to '${newSnapshot.parentPath}'`
      };
    } else if (!parentMatch && !nameMatch) {
      // Different parent and name = could be rename+move or unrelated
      if (contentMatch || childrenSimilarity > 80) {
        return {
          type: 'rename_and_move',
          oldPath: oldSnapshot.path,
          newPath: newSnapshot.path,
          oldArweaveFolderId: oldSnapshot.arfsFolderId,
          reason: `Folder renamed from '${oldSnapshot.name}' to '${newSnapshot.name}' and moved to '${newSnapshot.parentPath}'`
        };
      }
    }

    // No clear match
    return {
      type: 'new',
      newPath: newSnapshot.path,
      reason: 'No significant similarity found with deleted folder'
    };
  }

  private calculateChildrenSimilarity(oldChildren: string[], newChildren: string[]): number {
    if (oldChildren.length === 0 && newChildren.length === 0) return 100;
    if (oldChildren.length === 0 || newChildren.length === 0) return 0;

    const oldSet = new Set(oldChildren);
    const newSet = new Set(newChildren);
    const intersection = new Set([...oldSet].filter(x => newSet.has(x)));
    
    const similarity = (intersection.size * 2) / (oldSet.size + newSet.size) * 100;
    return Math.round(similarity);
  }

  private confirmDelete(folderPath: string): void {
    const pending = this.pendingDeletes.get(folderPath);
    if (!pending) return;

    console.log(`FolderOperationDetector: Confirming delete for ${folderPath}`);
    
    const deleteOperation: OperationDetection = {
      type: 'delete',
      oldPath: folderPath,
      oldArweaveFolderId: pending.snapshot.arfsFolderId,
      reason: `Folder deleted and not recreated within ${this.DETECTION_WINDOW_MS}ms window`
    };

    this.cacheOperation(folderPath, deleteOperation);
    this.pendingDeletes.delete(folderPath);
  }

  private cacheOperation(path: string, operation: OperationDetection): void {
    this.recentOperations.set(path, operation);
    
    // Auto-remove after cache period
    setTimeout(() => {
      this.recentOperations.delete(path);
    }, this.OPERATION_CACHE_MS);
  }

  private cleanupOldOperations(): void {
    const now = Date.now();
    
    // Clean up pending deletes that are too old (shouldn't happen normally)
    for (const [path, pending] of this.pendingDeletes) {
      if (now - pending.snapshot.timestamp.getTime() > this.DETECTION_WINDOW_MS * 2) {
        console.warn(`FolderOperationDetector: Cleaning up stale pending delete for ${path}`);
        clearTimeout(pending.timeout);
        this.confirmDelete(path);
      }
    }
  }

  getRecentOperation(path: string): OperationDetection | undefined {
    return this.recentOperations.get(path);
  }

  clear(): void {
    for (const pending of this.pendingDeletes.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingDeletes.clear();
    this.recentOperations.clear();
  }
}