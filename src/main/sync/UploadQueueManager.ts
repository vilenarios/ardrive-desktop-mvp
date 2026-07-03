import * as path from 'path';
import { FileUpload } from '../../types';
import { DatabaseManager } from '../database-manager';
import { ISyncProgressTracker } from './interfaces';

export interface CancelUploadResult {
  /** True when the cancel request was accepted (pending removed or in-flight flagged). */
  cancelled: boolean;
  /** True when the upload was already uploading — network work may still complete. */
  wasInFlight: boolean;
}

export class UploadQueueManager {
  private uploadQueue = new Map<string, FileUpload>();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  // MONEY-2: ids whose in-flight cancellation has been requested. The upload
  // pipeline checks this at every spend checkpoint and at completion so a
  // cancelled record is never resurrected as 'completed'.
  private cancellationRequests = new Set<string>();

  constructor(
    private databaseManager: DatabaseManager,
    private progressTracker: ISyncProgressTracker,
    private onUploadFile: (upload: FileUpload) => Promise<void>
  ) {}

  addToQueue(upload: FileUpload): void {
    this.uploadQueue.set(upload.id, upload);
    console.log(`Added ${upload.fileName} to upload queue (ID: ${upload.id})`);
  }

  removeFromQueue(uploadId: string): void {
    if (this.uploadQueue.delete(uploadId)) {
      console.log(`Upload ${uploadId} removed from queue`);
    }
  }

  getQueueSize(): number {
    return this.uploadQueue.size;
  }

  getAllUploads(): FileUpload[] {
    return Array.from(this.uploadQueue.values());
  }

  getUploadById(uploadId: string): FileUpload | undefined {
    return this.uploadQueue.get(uploadId);
  }

  getCurrentUpload(): FileUpload | undefined {
    return Array.from(this.uploadQueue.values()).find(u => u.status === 'uploading');
  }

  updateUploadStatus(uploadId: string, status: FileUpload['status'], error?: string): void {
    const upload = this.uploadQueue.get(uploadId);
    if (upload) {
      upload.status = status;
      if (error) {
        upload.error = error;
      }
    }
  }

  async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      console.log('Upload queue processor already running');
      return;
    }

    this.isProcessing = true;
    console.log('Starting upload queue processor');
    
    // Process queue every second
    this.processingInterval = setInterval(async () => {
      await this.processNextUpload();
    }, 1000);
  }

  stopProcessing(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('Upload queue processor stopped');
  }

  clearQueue(): void {
    const queueSize = this.uploadQueue.size;
    this.uploadQueue.clear();
    this.cancellationRequests.clear();
    console.log(`Cleared upload queue (removed ${queueSize} items)`);
  }

  private async processNextUpload(): Promise<void> {
    if (!this.isProcessing) return;

    const pendingUploads = Array.from(this.uploadQueue.values())
      .filter(u => u.status === 'pending');

    if (pendingUploads.length === 0) {
      return; // No pending uploads
    }

    // Sort uploads to ensure proper order (folders before files, parents before children)
    const sortedUploads = this.sortUploadsForProcessing(pendingUploads);
    console.log(`Processing ${sortedUploads.length} pending uploads (sorted for folder structure)`);
    
    const upload = sortedUploads[0];
    await this.onUploadFile(upload);
  }

  private sortUploadsForProcessing(uploads: FileUpload[]): FileUpload[] {
    // Separate folders and files
    const folders = uploads.filter(u => u.fileSize === 0 && u.localPath.endsWith(u.fileName));
    const files = uploads.filter(u => !(u.fileSize === 0 && u.localPath.endsWith(u.fileName)));
    
    // Sort folders by path depth (parent folders first)
    folders.sort((a, b) => {
      const depthA = (a.localPath.match(/[/\\]/g) || []).length;
      const depthB = (b.localPath.match(/[/\\]/g) || []).length;
      
      // First sort by depth (shallower paths first)
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      
      // Then sort alphabetically within same depth
      return a.localPath.localeCompare(b.localPath);
    });
    
    // Sort files by path to group them with their parent folders
    files.sort((a, b) => {
      const dirA = path.dirname(a.localPath);
      const dirB = path.dirname(b.localPath);
      
      // First sort by directory
      if (dirA !== dirB) {
        return dirA.localeCompare(dirB);
      }
      
      // Then by filename within directory
      return a.fileName.localeCompare(b.fileName);
    });
    
    // Return folders first, then files
    return [...folders, ...files];
  }

  // Queue management methods
  cancelUpload(uploadId: string): CancelUploadResult {
    const upload = this.uploadQueue.get(uploadId);
    if (!upload) {
      return { cancelled: false, wasInFlight: false };
    }
    if (upload.status === 'pending') {
      // Never started — guaranteed free. Mark as failed with cancellation message.
      upload.status = 'failed';
      upload.error = 'Cancelled by user';
      this.uploadQueue.delete(uploadId);
      console.log(`Upload ${uploadId} cancelled and removed from queue`);
      return { cancelled: true, wasInFlight: false };
    }
    if (upload.status === 'uploading') {
      // MONEY-2: ardrive-core-js has no abort support, so the network call
      // cannot be halted mid-flight. Register the request: the pipeline's
      // spend checkpoints skip any work not yet started, and the completion
      // handler refuses to resurrect the record.
      this.cancellationRequests.add(uploadId);
      console.log(`Upload ${uploadId} is in flight — cancellation requested`);
      return { cancelled: true, wasInFlight: true };
    }
    return { cancelled: false, wasInFlight: false };
  }

  isCancellationRequested(uploadId: string): boolean {
    return this.cancellationRequests.has(uploadId);
  }

  clearCancellationRequest(uploadId: string): void {
    this.cancellationRequests.delete(uploadId);
  }

  /** Live status of the in-memory queue entry, if any (retry admission input). */
  getQueueEntryStatus(uploadId: string): string | undefined {
    return this.uploadQueue.get(uploadId)?.status;
  }

  retryUpload(uploadId: string): void {
    const upload = this.uploadQueue.get(uploadId);
    if (upload && upload.status === 'failed') {
      upload.status = 'pending';
      upload.error = undefined;
      console.log(`Upload ${uploadId} marked for retry`);
    }
  }

  clearCompleted(): void {
    const completedIds: string[] = [];
    for (const [id, upload] of this.uploadQueue) {
      if (upload.status === 'completed') {
        completedIds.push(id);
      }
    }
    
    completedIds.forEach(id => this.uploadQueue.delete(id));
    console.log(`Cleared ${completedIds.length} completed uploads from queue`);
  }
}