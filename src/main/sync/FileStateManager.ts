import { IFileStateManager } from './interfaces';

export class FileStateManager implements IFileStateManager {
  private recentlyDownloadedFiles = new Set<string>();
  private downloadingFiles = new Map<string, Promise<void>>();
  private processingFiles = new Set<string>();
  private fileProcessingQueue = new Map<string, NodeJS.Timeout>();

  isFileBeingProcessed(filePath: string): boolean {
    return this.downloadingFiles.has(filePath) || 
           this.recentlyDownloadedFiles.has(filePath) ||
           this.processingFiles.has(filePath);
  }

  markAsDownloaded(filePath: string): void {
    this.recentlyDownloadedFiles.add(filePath);
    console.log(`Added ${filePath} to recently downloaded files`);
    
    // Auto-remove after 30 seconds (matching current implementation)
    setTimeout(() => {
      this.recentlyDownloadedFiles.delete(filePath);
      console.log(`Removed ${filePath} from recently downloaded files`);
    }, 30000);
  }

  isRecentlyDownloaded(filePath: string): boolean {
    return this.recentlyDownloadedFiles.has(filePath);
  }

  markAsProcessing(filePath: string): void {
    this.processingFiles.add(filePath);
  }

  clearProcessing(filePath: string): void {
    this.processingFiles.delete(filePath);
  }

  // Additional methods to match current functionality
  isDownloading(filePath: string): boolean {
    return this.downloadingFiles.has(filePath);
  }

  setDownloadPromise(filePath: string, promise: Promise<void>): void {
    this.downloadingFiles.set(filePath, promise);
  }

  getDownloadPromise(filePath: string): Promise<void> | undefined {
    return this.downloadingFiles.get(filePath);
  }

  clearDownload(filePath: string): void {
    this.downloadingFiles.delete(filePath);
  }

  // File processing queue methods
  setProcessingTimeout(filePath: string, timeout: NodeJS.Timeout): void {
    // Clear any existing timeout first
    const existingTimeout = this.fileProcessingQueue.get(filePath);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    this.fileProcessingQueue.set(filePath, timeout);
  }

  clearProcessingTimeout(filePath: string): void {
    const timeout = this.fileProcessingQueue.get(filePath);
    if (timeout) {
      clearTimeout(timeout);
      this.fileProcessingQueue.delete(filePath);
    }
  }

  clearAllProcessing(): void {
    // Clear all pending file processing timeouts
    for (const [filePath, timeout] of this.fileProcessingQueue) {
      clearTimeout(timeout);
      console.log(`Cleared pending timeout for: ${filePath}`);
    }
    this.fileProcessingQueue.clear();
    
    // Clear processing files set
    this.processingFiles.clear();
  }
}