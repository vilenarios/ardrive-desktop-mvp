export interface AppConfig {
  walletPath?: string;
  syncFolder?: string;
  isFirstRun: boolean;
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
}

export interface FileUpload {
  id: string;
  mappingId?: string;           // Which drive mapping this upload belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
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
}

export interface DriveSyncStatus {
  mappingId: string;
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
  mappingId?: string;           // Which drive mapping this upload belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
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
  createdAt: Date;
}

export interface ConflictResolution {
  uploadId: string;
  resolution: 'keep_local' | 'use_remote' | 'keep_both' | 'skip';
  reasoning?: string;
}

export interface FileDownload {
  id: string;
  mappingId?: string;           // Which drive mapping this download belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
  fileName: string;
  localPath: string;
  fileSize: number;
  fileId: string;           // ArDrive File ID
  dataTxId?: string;        // Arweave transaction ID for file data
  metadataTxId?: string;    // Arweave transaction ID for metadata
  status: 'downloading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  downloadedAt: Date;
  completedAt?: Date;
}

// File Version Control Types
export interface FileVersion {
  id: string;
  mappingId?: string;           // Which drive mapping this version belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
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
  mappingId?: string;           // Which drive mapping this operation belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
  fileHash: string;
  operation: 'upload' | 'download' | 'rename' | 'move' | 'delete';
  fromPath?: string;
  toPath?: string;
  metadata?: any;
  timestamp: Date;
}

export interface FolderStructure {
  id: string;
  mappingId?: string;           // Which drive mapping this folder belongs to
  driveId?: string;             // ArDrive ID (for backwards compatibility)
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