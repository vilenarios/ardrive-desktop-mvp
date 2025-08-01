import * as fs from 'fs';
import * as path from 'path';
import { pipeline, Transform } from 'stream';
import { pipeline as pipelineAsync } from 'stream/promises';
import { createWriteStream } from 'fs';
import { EventEmitter } from 'events';
import axios from 'axios';
import * as crypto from 'crypto';

export interface DownloadProgress {
  downloadId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
  speed: number; // bytes per second
  remainingTime: number; // seconds
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

export class StreamingDownloader extends EventEmitter {
  private activeDownloads: Map<string, AbortController> = new Map();
  private DEBUG = process.env.NODE_ENV === 'development' && process.env.DEBUG_DOWNLOADS === 'true';
  
  async downloadFile(
    url: string,
    destPath: string,
    downloadId: string,
    options: {
      onProgress?: (progress: DownloadProgress) => void;
      maxRetries?: number;
      retryDelay?: number;
      chunkSize?: number;
    } = {}
  ): Promise<{ hash: string }> {
    const {
      onProgress,
      maxRetries = 3,
      retryDelay = 1000,
      chunkSize = 1024 * 1024 // 1MB chunks
    } = options;

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`Retry attempt ${attempt}/${maxRetries} for ${path.basename(destPath)}`);
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }

        const result = await this.performDownload(url, destPath, downloadId, { onProgress, chunkSize });
        return result; // Success with hash
        
      } catch (error) {
        lastError = error as Error;
        console.error(`Download attempt ${attempt + 1} failed:`, error);
        
        // Clean up partial file
        // Clean up temp file on error
        const tempPath = `${destPath}.downloading`;
        try {
          await fs.promises.unlink(tempPath);
        } catch (unlinkError) {
          // Ignore unlink errors - file might not exist
        }
        
        if (this.isAbortError(error)) {
          throw error; // Don't retry aborted downloads
        }
      }
    }
    
    throw new Error(`Download failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }

  private async performDownload(
    url: string,
    destPath: string,
    downloadId: string,
    options: {
      onProgress?: (progress: DownloadProgress) => void;
      chunkSize?: number;
    }
  ): Promise<{ hash: string }> {
    // Create abort controller for cancellation
    const abortController = new AbortController();
    this.activeDownloads.set(downloadId, abortController);

    try {
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

      // Start download with streaming
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        signal: abortController.signal,
        headers: {
          'User-Agent': 'ArDrive-Desktop/1.0'
        },
        // Let axios handle decompression automatically
        decompress: true,
        // Timeout settings
        timeout: 30000, // 30 seconds for initial connection
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      const fileName = path.basename(destPath);
      
      let bytesDownloaded = 0;
      let lastProgressTime = Date.now();
      let lastBytesDownloaded = 0;

      // Create temp file path
      const tempPath = `${destPath}.downloading`;
      
      // Create write stream for temp file
      const writeStream = createWriteStream(tempPath, {
        highWaterMark: options.chunkSize || 1024 * 1024, // 1MB buffer
        flags: 'w', // Write mode (create or truncate)
        mode: 0o666 // File permissions
      });
      
      // Create hash stream
      const hashStream = crypto.createHash('sha256');

      // Set up progress tracking
      let lastDataTime = Date.now();
      response.data.on('data', (chunk: Buffer) => {
        bytesDownloaded += chunk.length;
        lastDataTime = Date.now();
        
        // Calculate speed and remaining time
        const now = Date.now();
        const timeDiff = (now - lastProgressTime) / 1000; // seconds
        
        if (timeDiff >= 0.1) { // Update every 100ms
          const bytesDiff = bytesDownloaded - lastBytesDownloaded;
          const speed = bytesDiff / timeDiff;
          const remainingBytes = contentLength - bytesDownloaded;
          const remainingTime = speed > 0 ? remainingBytes / speed : 0;
          
          const progress: DownloadProgress = {
            downloadId,
            fileName,
            bytesDownloaded,
            totalBytes: contentLength,
            progress: contentLength > 0 ? Math.round((bytesDownloaded / contentLength) * 100) : 0,
            speed,
            remainingTime,
            status: 'downloading'
          };
          
          if (options.onProgress) {
            options.onProgress(progress);
          }
          
          lastProgressTime = now;
          lastBytesDownloaded = bytesDownloaded;
        }
      });

      // Pipe the download stream through hash calculation to file
      let finalHash: string | null = null;
      
      await new Promise<void>((resolve, reject) => {
        let streamClosed = false;
        let downloadTimeout: NodeJS.Timeout | null = null;
        
        const cleanup = () => {
          if (!streamClosed) {
            streamClosed = true;
            writeStream.destroy();
            response.data.destroy();
            hashStream.destroy();
            passThrough.destroy();
            
            if (downloadTimeout) {
              clearTimeout(downloadTimeout);
              downloadTimeout = null;
            }
          }
        };
        
        // Set an inactivity timeout (30 seconds without data)
        const resetTimeout = () => {
          if (downloadTimeout) {
            clearTimeout(downloadTimeout);
          }
          downloadTimeout = setTimeout(() => {
            cleanup();
            reject(new Error('Download stalled - no data received for 30 seconds'));
          }, 30 * 1000);
        };
        
        resetTimeout();
        
        // Create transform stream to pass data through while hashing
        const passThrough = new Transform({
          transform(chunk, encoding, callback) {
            // Reset inactivity timeout on data
            resetTimeout();
            
            // Update hash
            hashStream.update(chunk);
            // Pass chunk through
            callback(null, chunk);
          }
        });
        
        // Pipe: response -> passThrough -> writeStream
        response.data.pipe(passThrough).pipe(writeStream);
        
        writeStream.on('finish', () => {
          // Calculate final hash
          finalHash = hashStream.digest('hex');
          
          // Ensure all data is flushed to disk
          writeStream.end(() => {
            // Force sync to disk on Windows
            if (process.platform === 'win32') {
              setTimeout(resolve, 500); // Give Windows time to release file handle
            } else {
              resolve();
            }
          });
        });
        
        writeStream.on('error', (error) => {
          cleanup();
          reject(error);
        });
        
        response.data.on('error', (error: Error) => {
          cleanup();
          reject(error);
        });
        
        passThrough.on('error', (error: Error) => {
          cleanup();
          reject(error);
        });
        
        response.data.on('end', () => {
          // Ensure write stream is properly closed
          if (!writeStream.destroyed) {
            writeStream.end();
          }
        });
      });

      // Wait a bit for file system to sync
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify temp file size
      const stats = await fs.promises.stat(tempPath);
      if (this.DEBUG) {
        console.log(`Download complete for ${fileName}: Content-Length=${contentLength}, Actual size=${stats.size}`);
      }
      
      // Content-Length validation is not reliable when compression is involved
      // The Content-Length header reflects the compressed size, but we save the decompressed content
      if (contentLength > 0) {
        console.log(`Size info for ${fileName}:`);
        console.log(`  Content-Length header: ${contentLength} bytes (may be compressed size)`);
        console.log(`  Actual file size: ${stats.size} bytes (decompressed)`);
        
        // Only validate that we got some content
        if (stats.size === 0) {
          throw new Error(`Downloaded file is empty: ${fileName}`);
        }
        
        // Don't compare sizes directly as Content-Length might be for compressed data
        // The actual decompressed size can be significantly different
      }

      // Atomic rename from temp file to final destination
      try {
        await fs.promises.rename(tempPath, destPath);
        // TypeScript needs explicit check here
        if (finalHash) {
          const hashStr = finalHash as string;
          console.log(`✓ Download completed: ${fileName} (${stats.size} bytes, hash: ${hashStr.substring(0, 16)}...)`);
        } else {
          console.log(`✓ Download completed: ${fileName} (${stats.size} bytes)`);
        }
      } catch (renameError) {
        // Clean up temp file on error
        try {
          await fs.promises.unlink(tempPath);
        } catch (unlinkError) {
          // Ignore unlink errors
        }
        throw new Error(`Failed to save downloaded file: ${renameError}`);
      }
      
      if (!finalHash) {
        throw new Error('Failed to calculate file hash during download');
      }
      
      return { hash: finalHash };
      
    } finally {
      this.activeDownloads.delete(downloadId);
    }
  }

  cancelDownload(downloadId: string): boolean {
    const controller = this.activeDownloads.get(downloadId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(downloadId);
      return true;
    }
    return false;
  }

  cancelAllDownloads(): void {
    console.log(`Cancelling all ${this.activeDownloads.size} active downloads`);
    for (const [downloadId, controller] of this.activeDownloads) {
      controller.abort();
    }
    this.activeDownloads.clear();
  }

  private isAbortError(error: any): boolean {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
  }

  // Helper to format bytes for display
  static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper to format time for display
  static formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  }
}