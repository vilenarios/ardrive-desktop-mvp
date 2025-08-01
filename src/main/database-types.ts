/**
 * Type definitions for database operations
 */

import { FileSyncStatus, FileSyncPreference, DatabaseFileRecord } from '../types/sync';

// Database manager method signatures
export interface IDatabaseManager {
  // Drive mappings
  getDriveMappings(): Promise<DriveSyncMapping[]>;
  getDriveMappingByDriveId(driveId: string): Promise<DriveSyncMapping | null>;
  
  // File metadata
  getFileById(mappingId: string, fileId: string): Promise<DatabaseFileRecord | null>;
  getFilesByStatus(mappingId: string, syncStatus: FileSyncStatus): Promise<DatabaseFileRecord[]>;
  updateFileSyncStatus(fileId: string, syncStatus: FileSyncStatus, lastError?: string): Promise<void>;
  updateFileSyncPreference(fileId: string, syncPreference: FileSyncPreference): Promise<void>;
  
  // Download tracking
  createDownload(downloadData: DownloadRecord): Promise<string>;
  updateDownload(downloadId: string, updates: Partial<DownloadRecord>): Promise<void>;
  getActiveDownloads(): Promise<DownloadRecord[]>;
  
  // Drive metadata cache
  storeDriveMetadata(mappingId: string, metadata: DatabaseFileRecord[]): Promise<void>;
  getDriveMetadata(mappingId: string): Promise<DatabaseFileRecord[]>;
  updateDriveMetadataStatus(fileId: string, status: FileSyncStatus, isDownloaded: boolean): Promise<void>;
}

// Drive mapping with sync settings
export interface DriveSyncMapping {
  id: string;
  profileId: string;
  driveId: string;
  rootFolderId: string;
  driveName: string;
  drivePrivacy: 'public' | 'private';
  localFolderPath: string;
  isActive: boolean;
  lastSyncTime: Date | null;
  syncSettings: SyncSettings;
  createdAt: Date;
  updatedAt: Date;
}

// Sync settings
export interface SyncSettings {
  excludePatterns?: string[];
  maxFileSize?: number;
  syncDirection: 'upload' | 'download' | 'bidirectional';
  uploadPriority?: 'turbo' | 'bundled';
  autoSync?: boolean;
  syncInterval?: number;
}

// Download record
export interface DownloadRecord {
  id?: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  localPath: string;
  dataTxId: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// Upload record
export interface UploadRecord {
  id?: string;
  localPath: string;
  fileName: string;
  fileSize: number;
  driveId: string;
  parentFolderId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  dataTxId?: string;
  metadataTxId?: string;
  bundleTxId?: string;
  uploadMethod?: 'turbo' | 'bundled';
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}