export interface AppConfig {
  walletPath?: string;
  syncFolder?: string;
  isFirstRun: boolean;
  lastActiveDriveId?: string;
  lastActiveDriveMappingId?: string;
  driveMappings?: DriveSyncMapping[];
  /** DESIGN-2: manual theme override. 'system' (default) follows the OS preference. */
  theme?: 'light' | 'dark' | 'system';
  /**
   * SYNC-17: Arweave gateway host override (device/app-level, like `theme`).
   * Unset → defaults to turbo-gateway.com (see src/main/gateway.ts). Lets a user
   * whose default gateway is rate-limited point the app at a working one.
   */
  gatewayHost?: string;
  /**
   * SYNC-23: ordered DATA-fetch fallback gateways, tried after `gatewayHost`
   * when a by-txid data fetch persistently fails. Unset → defaults to
   * ['perma.online', 'arweave.net'] (see src/main/gateway.ts). DATA fetches
   * only — metadata/GraphQL never fails over across gateways (perma.online does
   * not index this owner's ArFS metadata; see sync/gateway-failover.ts).
   */
  gatewayFallbacks?: string[];
  /**
   * SEC-4: per-profile consent to "remember me on this device" — i.e. to keep
   * the session credential in the OS keychain so it survives an app restart.
   * Opt-in: unset/false means the credential is held in encrypted memory only
   * (gone when the app quits) and never persisted to the keychain.
   */
  rememberDevice?: boolean;
  /**
   * UX-29: whether native OS desktop notifications (sync complete/error,
   * upload complete, approval needed) are shown. Device/app-level global
   * config, like `theme`/`gatewayHost`. Defaults to true (opt-out) — the
   * ambient "it works" notifications ship on by default.
   */
  notificationsEnabled?: boolean;
  /**
   * UX-21/UX-22: whether the continuous sync engine should be running.
   * Per-profile (like `syncFolder`/`walletPath`) — each profile has its own
   * drive/sync setup and its own running engine, so pausing one profile's
   * sync must never affect another. Set at onboarding (DriveAndSyncSetup's
   * "Enable Auto Sync" toggle) and read on every boot (App.initializeApp /
   * main.restoreSyncState) to decide whether to auto-start. UX-22's
   * pause/resume control (sync:pause / sync:resume) writes this SAME flag,
   * so pausing survives a restart instead of silently resuming. Defaults to
   * true (unset means enabled) so profiles set up before this preference
   * existed keep their current auto-start behavior.
   */
  autoSyncEnabled?: boolean;
}

/**
 * MONEY-17: WHY an upload failed, at recovery granularity. Shared vocabulary
 * between the classifier (src/main/upload-error-classifier.ts), the uploads
 * DB row, and the resume logic. 'insufficient_funds' is the RECOVERABLE
 * payment/free-quota rejection; the others are terminal.
 */
export type UploadErrorReason = 'insufficient_funds' | 'network' | 'error';

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
  isRemembered?: boolean;      // PRIV-4: whether this drive's key is persisted across sessions
}

export interface FileUpload {
  id: string;
  driveId?: string;             // ArDrive ID
  localPath: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  // Payment rail recorded at approval. New records are always 'turbo'
  // (Turbo-only beta, D-010/MONEY-1); 'ar' remains in the type only because
  // historical DB rows written before MONEY-1 may carry it.
  uploadMethod?: 'ar' | 'turbo';
  dataTxId?: string;      // ArFS Data Transaction ID (actual file content)
  metadataTxId?: string;  // ArFS Metadata Transaction ID (file info)
  transactionId?: string; // Legacy field for backward compatibility
  fileId?: string;        // ArDrive File ID for sharing links
  fileKey?: string;       // File key for private files
  // SYNC-26: the EXISTING on-chain ArFS fileId this upload should revise. Set
  // only when re-uploading an EDIT of a file already on Arweave — it is threaded
  // into ardrive-core-js (wrappedFile.existingId) so the edit becomes a REVISION
  // of the same fileId (new dataTx + metadata) instead of a brand-new file
  // entity. Absent for genuinely new files (they mint a fresh fileId). Transient
  // (in-memory only; not persisted as an uploads column).
  existingArfsFileId?: string;
  error?: string;
  // MONEY-17: WHY the upload failed, at recovery granularity. 'insufficient_funds'
  // marks a payment/free-quota rejection that is RECOVERABLE — it stays a first-
  // class paused-for-credits record (distinguishable from a generic terminal
  // failure and from user-cancel/oversize) and is auto-resumed when credits/quota
  // arrive. Persisted as the nullable `errorReason` uploads column (migration v8);
  // absent/null on success and on pre-MONEY-17 rows.
  errorReason?: UploadErrorReason;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * SYNC-9: honest sync-health signal surfaced through SyncManager.getStatus().
 * Lets the UI tell the truth about a degraded/offline sync instead of looking
 * healthy while sync is actually broken.
 *   - 'healthy': normal operation (idle, syncing, or up to date).
 *   - 'error':   a NON-network failure the user must act on — e.g. a locked
 *                private drive, a died file watcher, a validation error. Not
 *                auto-retried (retrying won't fix it).
 *   - 'offline': the gateway is unreachable / the network is down (detected as
 *                the authoritative signal after SYNC-20 retries + SYNC-23
 *                failover are exhausted). Sync is paused and auto-retried until
 *                connectivity returns.
 */
export type SyncHealth = 'healthy' | 'error' | 'offline';

export interface SyncStatus {
  isActive: boolean;
  totalFiles: number;
  uploadedFiles: number;
  failedFiles: number;
  currentFile?: string;
  lastError?: string;
  // SYNC-9: degraded/offline visibility. Always present from getStatus().
  health: SyncHealth;
  // Human-readable detail for the degraded state (tooltip / notification /
  // progress-modal copy). Absent when healthy.
  healthMessage?: string;
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
  // MONEY-13: true when the AR balance could not be retrieved as a valid
  // numeric value (e.g. a gateway 429 returning a non-numeric body).
  // `balance` is '' in this case - never a fabricated '0' and never 'NaN'.
  balanceUnavailable?: boolean;
}

export interface PendingUpload {
  id: string;
  driveId?: string;             // ArDrive ID
  localPath: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;            // MIME type of the file
  estimatedCost: number; // in AR tokens
  estimatedTurboCost?: number | null; // in Turbo Credits (AR equivalent); null = no real quote available ("estimate unavailable", MONEY-3)
  // Legacy recommendation stamped at detection time (CostCalculator). The
  // approve path no longer reads it — uploads are Turbo-only (D-010/MONEY-1).
  // Kept because historical DB rows carry it and sync-manager still writes it.
  recommendedMethod?: 'ar' | 'turbo';
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
  phase: 'starting' | 'metadata' | 'folders' | 'files' | 'verification' | 'complete' | 'error';
  description: string;
  currentItem?: string;
  itemsProcessed?: number;
  estimatedRemaining?: number;
  progress?: number; // Optional real-time progress percentage (0-100)
  // UX-8: present when the sync operation failed, so the progress modal can
  // show an honest error instead of an infinite/silently-vanishing spinner.
  // main.ts's `sync:manual` error path already emits the legacy shorthand
  // `{ phase: 'complete', error: true }` (message is in `description`);
  // renderer-side failure handlers set `phase: 'error'` with a real message.
  error?: string | boolean;
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