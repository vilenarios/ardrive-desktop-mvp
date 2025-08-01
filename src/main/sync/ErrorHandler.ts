import { SyncError, SyncErrorCode, RetryConfig, DEFAULT_RETRY_CONFIG } from '../../types/sync';
import * as fs from 'fs/promises';

export class ErrorHandler {
  private retryDelays: Map<string, number> = new Map();
  
  constructor(private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {}

  /**
   * Classify an error and return a SyncError with appropriate metadata
   */
  classifyError(error: any): SyncError {
    // Network errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      return new SyncError(
        'Network timeout',
        SyncErrorCode.NETWORK_TIMEOUT,
        true,
        'Connection timed out. Will retry automatically.'
      );
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new SyncError(
        'Network offline',
        SyncErrorCode.NETWORK_OFFLINE,
        true,
        'Unable to connect to the network. Please check your connection.'
      );
    }

    if (error.response?.status >= 500) {
      return new SyncError(
        `Gateway error: ${error.response.status}`,
        SyncErrorCode.GATEWAY_ERROR,
        true,
        'The Arweave gateway is temporarily unavailable. Will retry.'
      );
    }

    // File system errors
    if (error.code === 'ENOSPC') {
      return new SyncError(
        'Insufficient disk space',
        SyncErrorCode.INSUFFICIENT_SPACE,
        false,
        'Not enough disk space to download this file.'
      );
    }

    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return new SyncError(
        'Permission denied',
        SyncErrorCode.PERMISSION_DENIED,
        false,
        'Permission denied. Please check folder permissions.'
      );
    }

    if (error.code === 'ENOENT') {
      return new SyncError(
        'File not found',
        SyncErrorCode.FILE_NOT_FOUND,
        false,
        'The requested file was not found.'
      );
    }

    // Data integrity errors
    if (error.message?.includes('checksum') || error.message?.includes('hash')) {
      return new SyncError(
        'Checksum mismatch',
        SyncErrorCode.CHECKSUM_MISMATCH,
        true,
        'File integrity check failed. Will retry download.'
      );
    }

    if (error.message?.includes('size mismatch')) {
      return new SyncError(
        'File size mismatch',
        SyncErrorCode.SIZE_MISMATCH,
        true,
        'Downloaded file size does not match expected size.'
      );
    }

    // Default unknown error
    return new SyncError(
      error.message || 'Unknown error',
      SyncErrorCode.UNKNOWN_ERROR,
      false,
      'An unexpected error occurred.',
      { originalError: error }
    );
  }

  /**
   * Determine if an error should be retried
   */
  shouldRetry(error: SyncError, attemptNumber: number): boolean {
    if (!error.retryable) return false;
    if (attemptNumber >= this.retryConfig.maxRetries) return false;
    return this.retryConfig.retryableErrors.has(error.code);
  }

  /**
   * Calculate delay before next retry using exponential backoff
   */
  getRetryDelay(itemId: string, attemptNumber: number): number {
    const baseDelay = this.retryDelays.get(itemId) || this.retryConfig.initialDelay;
    const delay = Math.min(
      baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attemptNumber - 1),
      this.retryConfig.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    const finalDelay = Math.floor(delay + jitter);
    
    this.retryDelays.set(itemId, finalDelay);
    return finalDelay;
  }

  /**
   * Reset retry delay for an item after successful operation
   */
  resetRetryDelay(itemId: string): void {
    this.retryDelays.delete(itemId);
  }

  /**
   * Handle file system errors with appropriate recovery
   */
  async handleFileSystemError(error: any, filePath: string): Promise<void> {
    const syncError = this.classifyError(error);

    switch (syncError.code) {
      case SyncErrorCode.INSUFFICIENT_SPACE: {
        // Check actual available space
        const stats = await fs.statfs(filePath);
        const availableBytes = stats.bavail * stats.bsize;
        console.error(`Available disk space: ${availableBytes} bytes`);
        break;
      }

      case SyncErrorCode.PERMISSION_DENIED:
        // Log the specific path that failed
        console.error(`Permission denied for path: ${filePath}`);
        break;

      case SyncErrorCode.FILE_NOT_FOUND: {
        // Ensure parent directory exists
        const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
        try {
          await fs.mkdir(parentDir, { recursive: true });
          console.log(`Created missing parent directory: ${parentDir}`);
        } catch (mkdirError) {
          console.error(`Failed to create parent directory:`, mkdirError);
        }
        break;
      }
    }

    throw syncError;
  }

  /**
   * Create a user-friendly error message
   */
  getUserMessage(error: SyncError): string {
    const retryInfo = error.retryable ? ' The operation will be retried automatically.' : '';
    return `${error.userMessage}${retryInfo}`;
  }

  /**
   * Log error with appropriate level and context
   */
  logError(error: SyncError, context: Record<string, any>): void {
    const logData = {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...context
    };

    if (error.retryable) {
      console.warn('[Sync] Retryable error:', logData);
    } else {
      console.error('[Sync] Fatal error:', logData);
    }
  }
}