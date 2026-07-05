/**
 * Utilities for Turbo transactions and cost calculations
 */

// Turbo free-tier upload limit — the SINGLE SOURCE OF TRUTH for the whole app
// (main + renderer). Value comes from the Turbo upload service's
// `freeUploadLimitBytes`: https://upload.ardrive.io/info reports 107520 bytes
// (= 105 KiB). Files whose size is <= this are uploaded free by Turbo.
// TODO(MONEY-14): the drift-proof fix is to fetch `freeUploadLimitBytes` from
// upload.ardrive.io/info at startup, cache it, and fall back to this constant
// only if the fetch fails or returns a non-positive-integer. Deferred because
// this constant is consumed synchronously in pure functions and renderer
// render paths, so wiring a fetched value in requires IPC plumbing + state.
// Until then this constant must be updated if the service value ever changes.
export const TURBO_FREE_SIZE_LIMIT = 105 * 1024; // 107520 bytes (105 KiB)

/**
 * Check if a transaction qualifies for free Turbo upload
 */
export function isTurboFree(sizeInBytes: number): boolean {
  return sizeInBytes <= TURBO_FREE_SIZE_LIMIT;
}

/**
 * Format bytes to human readable size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get upload method recommendation based on file size and balance
 */
export interface UploadRecommendation {
  method: 'turbo' | 'ar';
  isFree: boolean;
  reason: string;
  estimatedCost?: string;
}

export function getUploadRecommendation(
  sizeInBytes: number,
  arBalance: number,
  turboBalance: number,
  arCostEstimate: number
): UploadRecommendation {
  const isFree = isTurboFree(sizeInBytes);
  
  if (isFree) {
    return {
      method: 'turbo',
      isFree: true,
      reason: `Free with Turbo! Files up to ${TURBO_FREE_SIZE_LIMIT / 1024} KiB cost no credits.`,
      estimatedCost: '0'
    };
  }
  
  // For larger files, recommend based on balance and cost
  if (turboBalance > 0) {
    return {
      method: 'turbo',
      isFree: false,
      reason: 'Fast upload with Turbo Credits',
      estimatedCost: 'Check Turbo cost'
    };
  }
  
  if (arBalance >= arCostEstimate) {
    return {
      method: 'ar',
      isFree: false,
      reason: 'Upload with AR tokens',
      estimatedCost: `~${arCostEstimate.toFixed(6)} AR`
    };
  }
  
  return {
    method: 'ar',
    isFree: false,
    reason: 'Insufficient balance for upload',
    estimatedCost: `~${arCostEstimate.toFixed(6)} AR needed`
  };
}

/**
 * Get size estimate for common ArDrive operations
 */
export const ARDRIVE_OPERATION_SIZES = {
  // Drive creation includes metadata
  CREATE_DRIVE: 1024, // ~1KB for drive metadata
  // Drive rename includes metadata update
  RENAME_DRIVE: 512, // ~0.5KB for drive rename metadata
  // Folder creation includes metadata
  CREATE_FOLDER: 512, // ~0.5KB for folder metadata
  // File metadata (not the file itself)
  FILE_METADATA: 1024, // ~1KB for file metadata
};

/**
 * Check if an ArDrive operation is free with Turbo
 */
export function isArDriveOperationFree(operation: keyof typeof ARDRIVE_OPERATION_SIZES): boolean {
  const size = ARDRIVE_OPERATION_SIZES[operation];
  return isTurboFree(size);
}