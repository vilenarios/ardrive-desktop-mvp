import * as fs from 'fs/promises';
import { Stats } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DatabaseManager } from '../database-manager';

export interface FileSnapshot {
  path: string;
  name: string;
  size: number;
  hash?: string;
  mtime?: Date;
  arfsFileId?: string;
}

export interface FileOperationDetection {
  type: 'move' | 'rename' | 'copy' | 'delete' | 'new';
  oldPath?: string;
  newPath?: string;
  oldArfsFileId?: string;
  hash?: string;
  reason: string;
}

interface PendingFileOperation {
  snapshot: FileSnapshot;
  timeout: NodeJS.Timeout;
  hash?: string;
  hashPromise?: Promise<string>;
}

interface FileMetadata {
  size: number;
  mtime: number;
}

export class FileOperationDetector {
  private pendingDeletes = new Map<string, PendingFileOperation>();
  private recentOperations = new Map<string, FileOperationDetection>();
  private fileMetadataCache = new Map<string, FileMetadata>();
  private hashCache = new Map<string, string>();
  
  // Configurable timeouts
  private readonly DETECTION_WINDOW_MS = 3000; // Increased from 2s to 3s for safety
  private readonly OPERATION_CACHE_MS = 30000; // Increased to 30s
  private readonly BATCH_OPERATION_WINDOW_MS = 500; // For detecting batch moves
  
  // Batch operation tracking
  private batchOperations = new Map<string, Set<string>>();
  private batchTimers = new Map<string, NodeJS.Timeout>();

  constructor(private databaseManager: DatabaseManager) {
    // Clean up old operations periodically
    setInterval(() => this.cleanupOldOperations(), 60000);
  }

  /**
   * Called when a file is deleted - starts tracking for potential move
   */
  async onFileDelete(filePath: string, existingHash?: string, arfsFileId?: string): Promise<void> {
    console.log(`FileOperationDetector: File delete detected - ${filePath}`);
    if (existingHash) {
      console.log(`FileOperationDetector: Using existing hash: ${existingHash.substring(0, 16)}... (full: ${existingHash})`);
    }
    if (arfsFileId) {
      console.log(`FileOperationDetector: File has ArDrive ID: ${arfsFileId}`);
    }
    
    // Clear any existing pending delete for this path
    this.clearPendingDelete(filePath);
    
    try {
      // Try to get file metadata before it's gone
      const metadata = await this.getFileMetadata(filePath).catch(() => null);
      
      if (metadata) {
        const fileAge = Date.now() - metadata.mtime;
        console.log(`FileOperationDetector: File metadata before delete - size: ${metadata.size}, age: ${fileAge}ms`);
      }
      
      // Create snapshot
      const snapshot: FileSnapshot = {
        path: filePath,
        name: path.basename(filePath),
        size: metadata?.size || 0,
        mtime: metadata ? new Date(metadata.mtime) : undefined,
        hash: existingHash,
        arfsFileId: arfsFileId
      };
      
      // If we don't have a hash, try to get it from various sources
      let hashPromise: Promise<string> | undefined;
      if (!existingHash) {
        hashPromise = this.findFileHash(filePath, snapshot);
      }
      
      // Set timeout to confirm delete
      const timeout = setTimeout(async () => {
        await this.confirmDelete(filePath);
      }, this.DETECTION_WINDOW_MS);

      this.pendingDeletes.set(filePath, { 
        snapshot, 
        timeout, 
        hash: existingHash,
        hashPromise 
      });
      
      // Track batch operations
      this.trackBatchOperation('delete', filePath);
      
    } catch (error) {
      console.error(`Error processing file delete for ${filePath}:`, error);
    }
  }

  /**
   * Called when a new file is detected - checks if it's a move
   */
  async onFileAdd(filePath: string, fileHash?: string): Promise<FileOperationDetection | null> {
    console.log(`FileOperationDetector: File add detected - ${filePath}`);
    
    try {
      const stats = await fs.stat(filePath);
      
      // Add a small delay to ensure file write is complete (Windows file system)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const newFileHash = fileHash || await this.calculateFileHash(filePath);
      console.log(`FileOperationDetector: Calculated hash for ${filePath}: ${newFileHash.substring(0, 16)}... (size: ${stats.size})`);
      
      // If this is a recently moved file, give it more time to stabilize
      const fileName = path.basename(filePath);
      const recentlyMoved = Array.from(this.pendingDeletes.values()).some(
        p => p.snapshot.name === fileName && Date.now() - (p.snapshot.mtime?.getTime() || 0) < 5000
      );
      
      if (recentlyMoved) {
        console.log(`Recently moved file detected, waiting for stabilization...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        // Recalculate hash after wait
        const recalculatedHash = await this.calculateFileHash(filePath);
        if (recalculatedHash !== newFileHash) {
          console.log(`Hash changed after stabilization wait!`);
          console.log(`  Original: ${newFileHash.substring(0, 16)}...`);
          console.log(`  After wait: ${recalculatedHash.substring(0, 16)}...`);
        }
      }
      
      // Quick check: is this file in a batch operation?
      const batchId = this.getBatchOperationId('add', filePath);
      if (batchId) {
        console.log(`File is part of batch operation: ${batchId}`);
      }
      
      // Method 1: Check by hash (most reliable)
      if (newFileHash) {
        const detection = await this.detectByHash(filePath, newFileHash, stats);
        if (detection) return detection;
      }
      
      // Method 2: Check by name and size (faster, less reliable)
      const detection = await this.detectByMetadata(filePath, stats);
      if (detection) {
        console.log(`FileOperationDetector: Move detected by metadata`);
        return detection;
      }
      
      // Method 3: Check if this might be a copy (same hash exists elsewhere)
      const copyDetection = await this.detectCopy(filePath, newFileHash);
      if (copyDetection) return copyDetection;
      
      // No match found - this is a new file
      return {
        type: 'new',
        newPath: filePath,
        hash: newFileHash,
        reason: 'No matching deleted file found within detection window'
      };
      
    } catch (error) {
      console.error(`Failed to analyze file add for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Detect operation by file hash
   */
  private async detectByHash(
    newPath: string, 
    hash: string, 
    stats: Stats
  ): Promise<FileOperationDetection | null> {
    
    // Check all pending deletes
    for (const [deletedPath, pending] of this.pendingDeletes) {
      // Wait for hash calculation if in progress
      if (pending.hashPromise && !pending.hash) {
        try {
          pending.hash = await Promise.race([
            pending.hashPromise,
            new Promise<string>((_, reject) => 
              setTimeout(() => reject(new Error('Hash calculation timeout')), 1000)
            )
          ]);
        } catch (e) {
          console.warn(`Hash calculation timed out for ${deletedPath}`);
        }
      }
      
      console.log(`FileOperationDetector: Comparing hashes for ${deletedPath}:`);
      console.log(`  - Pending hash: ${pending.hash?.substring(0, 16)}... (full: ${pending.hash})`);
      console.log(`  - New file hash: ${hash.substring(0, 16)}... (full: ${hash})`);
      console.log(`  - Hash match: ${pending.hash === hash}`);
      console.log(`  - Size comparison: old=${pending.snapshot.size}, new=${stats.size}`);
      
      // If hashes don't match but sizes do, try recalculating after a delay
      if (pending.hash !== hash && pending.snapshot.size === stats.size) {
        console.log(`FileOperationDetector: Hash mismatch but same size, retrying hash calculation after delay...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryHash = await this.calculateFileHash(newPath);
        console.log(`  - Retry hash: ${retryHash.substring(0, 16)}... (full: ${retryHash})`);
        console.log(`  - Retry match: ${pending.hash === retryHash}`);
        if (pending.hash === retryHash) {
          hash = retryHash; // Use the retry hash
        }
      }
      
      if (pending.hash === hash) {
        // Found a match!
        clearTimeout(pending.timeout);
        this.pendingDeletes.delete(deletedPath);
        
        const oldName = path.basename(deletedPath);
        const newName = path.basename(newPath);
        const oldDir = path.dirname(deletedPath);
        const newDir = path.dirname(newPath);
        
        let type: 'move' | 'rename';
        let reason: string;
        
        if (oldDir === newDir) {
          type = 'rename';
          reason = `File renamed from '${oldName}' to '${newName}'`;
        } else if (oldName === newName) {
          type = 'move';
          reason = `File moved from '${oldDir}' to '${newDir}'`;
        } else {
          type = 'move'; // move with rename
          reason = `File moved from '${deletedPath}' to '${newPath}'`;
        }
        
        return {
          type,
          oldPath: deletedPath,
          newPath,
          hash,
          oldArfsFileId: pending.snapshot.arfsFileId,
          reason
        };
      }
    }
    
    return null;
  }

  /**
   * Detect operation by file metadata (name, size, mtime)
   */
  private async detectByMetadata(
    newPath: string, 
    stats: Stats
  ): Promise<FileOperationDetection | null> {
    
    const fileName = path.basename(newPath);
    const fileSize = stats.size;
    
    for (const [deletedPath, pending] of this.pendingDeletes) {
      const snapshot = pending.snapshot;
      
      // Check if same filename and size
      if (snapshot.name === fileName && snapshot.size === fileSize) {
        console.log(`FileOperationDetector: Metadata match - name: ${fileName}, size: ${fileSize}`);
        
        clearTimeout(pending.timeout);
        this.pendingDeletes.delete(deletedPath);
        
        return {
          type: 'move',
          oldPath: deletedPath,
          newPath,
          oldArfsFileId: snapshot.arfsFileId,
          reason: `Same filename and size detected within ${this.DETECTION_WINDOW_MS}ms`
        };
      }
    }
    
    return null;
  }

  /**
   * Detect if this is a copy operation
   */
  private async detectCopy(
    filePath: string, 
    hash: string
  ): Promise<FileOperationDetection | null> {
    
    if (!hash) return null;
    
    // Check if this hash exists in the database
    const existingFiles = await this.databaseManager.getFilesByHash(hash);
    
    // Filter out the current file and any pending deletes
    const activeFiles = existingFiles.filter(f => 
      f.localPath !== filePath && 
      !this.pendingDeletes.has(f.localPath)
    );
    
    if (activeFiles.length > 0) {
      return {
        type: 'copy',
        oldPath: activeFiles[0].localPath,
        newPath: filePath,
        hash,
        reason: `File with same hash exists at: ${activeFiles[0].localPath}`
      };
    }
    
    return null;
  }

  /**
   * Track batch operations (multiple files moved together)
   */
  private trackBatchOperation(type: 'add' | 'delete', filePath: string): void {
    const dir = path.dirname(filePath);
    const batchId = `${type}-${dir}`;
    
    if (!this.batchOperations.has(batchId)) {
      this.batchOperations.set(batchId, new Set());
    }
    
    this.batchOperations.get(batchId)!.add(filePath);
    
    // Clear existing timer
    if (this.batchTimers.has(batchId)) {
      clearTimeout(this.batchTimers.get(batchId)!);
    }
    
    // Set new timer to clear batch
    const timer = setTimeout(() => {
      this.batchOperations.delete(batchId);
      this.batchTimers.delete(batchId);
    }, this.BATCH_OPERATION_WINDOW_MS);
    
    this.batchTimers.set(batchId, timer);
  }

  /**
   * Get batch operation ID if file is part of one
   */
  private getBatchOperationId(type: 'add' | 'delete', filePath: string): string | null {
    const dir = path.dirname(filePath);
    const batchId = `${type}-${dir}`;
    
    if (this.batchOperations.has(batchId)) {
      return batchId;
    }
    
    return null;
  }

  /**
   * Try to find file hash from various sources
   */
  private async findFileHash(filePath: string, snapshot: FileSnapshot): Promise<string> {
    // Try database first
    try {
      const fileInfo = await this.databaseManager.getFileByPath(filePath);
      if (fileInfo?.fileHash) {
        console.log(`Found hash in database for ${filePath}`);
        return fileInfo.fileHash;
      }
    } catch (error) {
      console.warn(`Database lookup failed for ${filePath}:`, error);
    }
    
    // Try cache
    const cached = this.hashCache.get(filePath);
    if (cached) {
      console.log(`Found hash in cache for ${filePath}`);
      return cached;
    }
    
    // If file still exists, calculate hash
    try {
      const hash = await this.calculateFileHash(filePath);
      this.hashCache.set(filePath, hash);
      return hash;
    } catch (error) {
      console.warn(`Cannot calculate hash for ${filePath}:`, error);
      return '';
    }
  }

  /**
   * Calculate file hash with timeout
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Hash calculation timeout'));
      }, 5000); // 5 second timeout
      
      fs.readFile(filePath)
        .then(content => {
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          clearTimeout(timeout);
          resolve(hash);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Get file metadata safely
   */
  private async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        mtime: stats.mtimeMs
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear pending delete operation
   */
  private clearPendingDelete(filePath: string): void {
    const existing = this.pendingDeletes.get(filePath);
    if (existing) {
      clearTimeout(existing.timeout);
      this.pendingDeletes.delete(filePath);
    }
  }

  /**
   * Confirm a file was actually deleted
   */
  private async confirmDelete(filePath: string): Promise<void> {
    const pending = this.pendingDeletes.get(filePath);
    if (!pending) return;
    
    console.log(`FileOperationDetector: Confirming delete for ${filePath}`);
    
    const deleteOperation: FileOperationDetection = {
      type: 'delete',
      oldPath: filePath,
      hash: pending.hash,
      oldArfsFileId: pending.snapshot.arfsFileId,
      reason: `File deleted and not recreated within ${this.DETECTION_WINDOW_MS}ms window`
    };
    
    this.cacheOperation(filePath, deleteOperation);
    this.pendingDeletes.delete(filePath);
  }

  /**
   * Cache recent operations
   */
  private cacheOperation(path: string, operation: FileOperationDetection): void {
    this.recentOperations.set(path, operation);
    
    // Auto-remove after cache period
    setTimeout(() => {
      this.recentOperations.delete(path);
    }, this.OPERATION_CACHE_MS);
  }

  /**
   * Clean up old operations
   */
  private cleanupOldOperations(): void {
    const now = Date.now();
    
    // Clean up pending deletes that are too old
    for (const [path, pending] of this.pendingDeletes) {
      const age = now - (pending.snapshot.mtime?.getTime() || now);
      if (age > this.DETECTION_WINDOW_MS * 2) {
        console.warn(`FileOperationDetector: Cleaning up stale pending delete for ${path}`);
        clearTimeout(pending.timeout);
        this.confirmDelete(path);
      }
    }
    
    // Clean up hash cache
    if (this.hashCache.size > 1000) {
      const entries = Array.from(this.hashCache.entries());
      this.hashCache.clear();
      // Keep last 500 entries
      entries.slice(-500).forEach(([k, v]) => this.hashCache.set(k, v));
    }
  }

  /**
   * Get recent operation for a path
   */
  getRecentOperation(path: string): FileOperationDetection | undefined {
    return this.recentOperations.get(path);
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    for (const pending of this.pendingDeletes.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingDeletes.clear();
    this.recentOperations.clear();
    this.fileMetadataCache.clear();
    this.hashCache.clear();
    
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchOperations.clear();
    this.batchTimers.clear();
  }
}