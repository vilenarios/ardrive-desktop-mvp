export interface AppConfig {
  walletPath?: string;
  syncFolder?: string;
  isFirstRun: boolean;
  lastActiveDriveId?: string;
  lastActiveDriveMappingId?: string;
  driveMappings?: DriveSyncMapping[];
}

export interface DriveSyncMapping {
  id: string;                    // Unique mapping ID
  driveId: string;              // ArDrive ID
  driveName: string;            // Display name for drive
  drivePrivacy: 'public' | 'private';
  localFolderPath: string;      // Local folder to sync
  rootFolderId: string;         // Root folder ID in the drive
  isActive: boolean;            // Whether sync is enabled
  lastSyncTime?: Date;          // Last successful sync
  lastMetadataSyncAt?: Date;    // Last time metadata was synced
  syncSettings?: DriveSyncSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface DriveSyncSettings {
  excludePatterns?: string[];   // Glob patterns to exclude (*.tmp, .DS_Store)
  maxFileSize?: number;         // Max file size in bytes
  syncDirection?: 'bidirectional' | 'upload-only' | 'download-only';
  uploadPriority?: number;      // Higher number = higher priority
}

export interface Profile {
  id: string;
  name: string;
  address: string;
  avatarUrl?: string;
  arnsName?: string;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface DriveInfo {
  id: string;
  name: string;
  privacy: 'public' | 'private';
  rootFolderId: string;
  metadataTxId?: string;
  dateCreated: number;  // Timestamp
  size: number;         // Total size in bytes
  isPrivate?: boolean;  // Alternative to privacy field
}

export interface DriveInfoWithStatus extends DriveInfo {
  isLocked: boolean;           // For private drives: whether they need unlocking
  emojiFingerprint?: string;   // For private drives: emoji representation
}

export interface FileUpload {
  id: string;
  driveId?: string;             // ArDrive ID
  localPath: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  uploadMethod?: 'ar' | 'turbo';  // Method used for upload
  dataTxId?: string;      // ArFS Data Transaction ID (actual file content)
  metadataTxId?: string;  // ArFS Metadata Transaction ID (file info)
  transactionId?: string; // Legacy field for backward compatibility
  fileId?: string;        // ArDrive File ID for sharing links
  fileKey?: string;       // File key for private files
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface SyncStatus {
  isActive: boolean;
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
  currentFile?: string;
  lastError?: string;
}

export interface DriveSyncStatus {
  driveId: string;
  driveName: string;
  isActive: boolean;
  isRunning: boolean;
  totalFiles: number;
  uploadedFiles: number;
  downloadedFiles: number;
  failedFiles: number;
  pendingFiles: number;
  currentFile?: string;
  lastSyncTime?: Date;
  lastError?: string;
  bytesUploaded: number;
  bytesDownloaded: number;
}

export interface GlobalSyncStatus {
  activeMappings: number;
  totalMappings: number;
  isAnyActive: boolean;
  globalTotalFiles: number;
  globalUploadedFiles: number;
  globalFailedFiles: number;
  driveStatuses: DriveSyncStatus[];
  lastGlobalSync?: Date;
}

export interface WalletInfo {
  address: string;
  balance: string;
  walletType: 'arweave' | 'ethereum';
  turboBalance?: string;      // Turbo Credits balance in AR equivalent
  turboWinc?: string;         // Turbo Credits balance in winc
}

export interface PendingUpload {
  id: string;
  driveId?: string;             // ArDrive ID
  localPath: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;            // MIME type of the file
  estimatedCost: number; // in AR tokens
  estimatedTurboCost?: number; // in Turbo Credits (AR equivalent)
  recommendedMethod?: 'ar' | 'turbo'; // Recommended upload method
  hasSufficientTurboBalance?: boolean; // Whether user has enough Turbo Credits
  conflictType?: 'none' | 'duplicate' | 'filename_conflict' | 'content_conflict';
  conflictDetails?: string;
  status: 'awaiting_approval' | 'approved' | 'rejected';
  operationType?: 'upload' | 'move' | 'rename' | 'hide' | 'unhide' | 'delete'; // Type of operation
  previousPath?: string;        // For moves/renames - the original path
  arfsFileId?: string;          // For operations on existing files
  arfsFolderId?: string;        // For folder operations
  metadata?: {                  // Operation-specific metadata
    newParentFolderId?: string; // For moves
    isHidden?: boolean;         // For hide/unhide
    tags?: string[];            // For future tag operations
    [key: string]: any;         // Extensible for future operations
  };
  createdAt: Date;
}

export interface ConflictResolution {
  uploadId: string;
  resolution: 'keep_local' | 'use_remote' | 'keep_both' | 'skip';
  reasoning?: string;
}

export interface SyncProgress {
  phase: 'starting' | 'metadata' | 'folders' | 'files' | 'verification' | 'complete';
  description: string;
  currentItem?: string;
  itemsProcessed?: number;
  estimatedRemaining?: number;
  progress?: number; // Optional real-time progress percentage (0-100)
}

export interface FileDownload {
  id: string;
  driveId?: string;             // ArDrive ID
  fileName: string;
  localPath: string;
  fileSize: number;
  fileId: string;           // ArDrive File ID
  dataTxId?: string;        // Arweave transaction ID for file data
  metadataTxId?: string;    // Arweave transaction ID for metadata
  status: 'downloading' | 'completed' | 'failed' | 'pending';
  progress: number;
  priority?: number;        // Download priority (higher = more important)
  isCancelled?: boolean;    // Whether download was cancelled
  error?: string;
  downloadedAt: Date;
  completedAt?: Date;
}

// File sync preferences and state
export type FileSyncPreference = 'auto' | 'cloud_only';
export type FileSyncStatus = 'synced' | 'downloading' | 'queued' | 'cloud_only' | 'pending' | 'error';

export interface FileSyncState {
  fileId: string;
  syncStatus: FileSyncStatus;
  syncPreference: FileSyncPreference;
  localFileExists: boolean;
  downloadPriority: number;
  lastError?: string;
  lastSyncedAt?: Date;
}

export interface FileMetadata {
  id: string;
  fileId: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  path: string;
  parentFolderId?: string;
  dataTxId?: string;
  metadataTxId?: string;
  contentType?: string;
  lastModifiedDate?: number;
  // Sync-related fields
  syncStatus: FileSyncStatus;
  syncPreference: FileSyncPreference;
  localFileExists: boolean;
  downloadPriority: number;
  lastError?: string;
  lastSyncedAt?: Date;
}

// File Version Control Types
export interface FileVersion {
  id: string;
  driveId?: string;             // ArDrive ID
  fileHash: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  fileSize: number;
  arweaveId?: string;
  turboId?: string;
  version: number;
  parentVersion?: string;
  changeType: 'create' | 'update' | 'rename' | 'move';
  uploadMethod?: 'ar' | 'turbo';
  createdAt: Date;
  isLatest: boolean;
}

export interface FileOperation {
  id: string;
  driveId?: string;             // ArDrive ID
  fileHash: string;
  operation: 'upload' | 'download' | 'rename' | 'move' | 'delete';
  fromPath?: string;
  toPath?: string;
  metadata?: any;
  timestamp: Date;
}

export interface FolderStructure {
  id: string;
  driveId?: string;             // ArDrive ID
  folderPath: string;
  relativePath: string;
  parentPath?: string;
  arweaveFolderId?: string;
  createdAt: Date;
  isDeleted: boolean;
}

// Wallet Storage Format
export interface WalletStorageFormat {
  type: 'arweave';
  jwk: any; // JWK interface from ardrive-core-js
  metadata: {
    createdFrom: 'seed' | 'jwk' | 'generated';
    seedPhrase?: string; // Only stored if wallet was created from seed
    createdAt: string; // ISO timestamp
  };
}

// Permaweb File Interface
export interface PermawebFile {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  parentId?: string;
  parentName?: string;
  dataTxId?: string;
  metadataTxId?: string;
  createdAt?: string;
  modifiedAt?: string;
}

// Download item interface
export interface DownloadItem {
  id: string;
  fileName: string;
  status: 'downloading' | 'completed' | 'failed';
  progress?: number;
  size?: number;
  error?: string;
}

// Manifest creation result
export interface ManifestCreationResult {
  success: boolean;
  manifestUrl: string;
  fileUrls: string[];
  fees: any;
  txId: string;
  fileCount: number;
  manifestName: string;
}

// Folder node for tree view
export interface FolderNode {
  id: string;
  name: string;
  parentId: string;
  path: string;
}