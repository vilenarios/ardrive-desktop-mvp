/**
 * Utility functions for Turbo integration
 */

// Turbo Free tier limit: 100KB (100 * 1024 bytes)
const TURBO_FREE_LIMIT = 100 * 1024;

/**
 * Check if a file is eligible for Turbo Free tier
 */
export function isTurboFree(fileSize: number): boolean {
  return fileSize <= TURBO_FREE_LIMIT;
}

/**
 * Format file size to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get Turbo Free status text
 */
export function getTurboFreeStatus(fileSize: number): string {
  if (isTurboFree(fileSize)) {
    return `Free (under ${formatFileSize(TURBO_FREE_LIMIT)})`;
  }
  return `Requires credits (${formatFileSize(fileSize - TURBO_FREE_LIMIT)} over limit)`;
}

// NOTE (MONEY-1): calculateTurboCredits ("1 credit per MB" invention) was
// deleted — it was unreferenced and its formula had no relation to real
// Turbo pricing. Real quotes come from turbo-manager.getUploadCosts.

/**
 * Format Turbo credits to string
 */
export function formatTurboCredits(credits: number): string {
  if (credits === 0) return '0';
  if (credits < 0.000001) return '< 0.000001';
  
  // Show up to 6 decimal places, removing trailing zeros
  return credits.toFixed(6).replace(/\.?0+$/, '');
}