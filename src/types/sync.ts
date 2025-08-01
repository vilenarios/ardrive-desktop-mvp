/**
 * Type definitions for the sync system
 */

import { EntityID, FolderID, DriveID } from 'ardrive-core-js';

// Sync preferences and status
export type FileSyncPreference = 'auto' | 'always_local' | 'cloud_only';
export type FileSyncStatus = 'synced' | 'downloading' | 'queued' | 'cloud_only' | 'pending' | 'error';

// File metadata from ArDrive
export interface ArDriveFileMetadata {
  fileId: string;
  driveId: string;
  parentFolderId: string;
  name: string;
  size: number;
  lastModifiedDate: Date;
  dataTxId: string;
  metadataTxId: string;
  entityType: 'file' | 'folder';
  path?: string;
  contentType?: string;
}

// Download queue item
export interface DownloadQueueItem {
  fileId: string;
  driveId: string;
  name: string;
  size: number;
  dataTxId: string;
  localPath: string;
  priority: number;
  retryCount: number;
  maxRetries: number;
  addedAt: Date;
  syncPreference: FileSyncPreference;
}

// Download progress
export interface DownloadProgress {
  downloadId: string;
  fileName: string;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number; // bytes per second
  remainingTime: number; // seconds
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

// Download options
export interface DownloadOptions {
  priority?: number;
  maxRetries?: number;
  retryDelay?: number;
  chunkSize?: number;
  onProgress?: (progress: DownloadProgress) => Promise<void>;
}

// Error types
export class SyncError extends Error {
  constructor(
    message: string,
    public code: SyncErrorCode,
    public retryable: boolean,
    public userMessage: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export enum SyncErrorCode {
  // Network errors
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  NETWORK_OFFLINE = 'NETWORK_OFFLINE',
  GATEWAY_ERROR = 'GATEWAY_ERROR',
  
  // File system errors
  INSUFFICIENT_SPACE = 'INSUFFICIENT_SPACE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  
  // Data errors
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  SIZE_MISMATCH = 'SIZE_MISMATCH',
  INVALID_METADATA = 'INVALID_METADATA',
  
  // Sync errors
  SYNC_CANCELLED = 'SYNC_CANCELLED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Sync progress events
export interface SyncProgress {
  phase: 'metadata' | 'folders' | 'downloads' | 'uploads' | 'complete';
  stage?: string;
  description: string;
  totalItems?: number;
  currentItem?: number;
  itemsProcessed?: number;
  estimatedRemaining?: number;
  currentFile?: string;
}

// File state for UI
export interface FileState {
  fileId: string;
  syncStatus: FileSyncStatus;
  syncPreference: FileSyncPreference;
  downloadProgress?: number;
  lastError?: string;
  isDownloaded: boolean;
  lastSyncedAt?: Date;
}

// Queue status
export interface QueueStatus {
  queued: number;
  active: number;
  total: number;
  paused: boolean;
  downloads: DownloadQueueItem[];
}

// Sync operation result
export interface SyncResult<T = any> {
  success: boolean;
  data?: T;
  error?: SyncError;
}

// Database file record
export interface DatabaseFileRecord {
  id: string;
  mappingId: string;
  fileId: string;
  driveId: string;
  parentFolderId: string;
  name: string;
  size: number;
  lastModifiedDate: string;
  dataTxId: string;
  metadataTxId: string;
  type: 'file' | 'folder';
  path: string;
  localPath: string;
  isDownloaded: boolean;
  syncStatus: FileSyncStatus;
  syncPreference: FileSyncPreference;
  downloadPriority: number;
  lastError?: string;
  contentType?: string;
}

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: Set<SyncErrorCode>;
}

// Default retry configuration
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: new Set([
    SyncErrorCode.NETWORK_TIMEOUT,
    SyncErrorCode.NETWORK_OFFLINE,
    SyncErrorCode.GATEWAY_ERROR
  ])
};