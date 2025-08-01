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

/**
 * Calculate Turbo credits needed for a file
 * Note: This is a simplified calculation. Actual costs may vary.
 */
export function calculateTurboCredits(fileSize: number): number {
  if (isTurboFree(fileSize)) {
    return 0;
  }
  
  // Approximate: 1 credit per MB over the free limit
  const bytesOverLimit = fileSize - TURBO_FREE_LIMIT;
  const creditsNeeded = bytesOverLimit / (1024 * 1024);
  
  // Minimum charge
  return Math.max(0.000001, creditsNeeded);
}

/**
 * Format Turbo credits to string
 */
export function formatTurboCredits(credits: number): string {
  if (credits === 0) return '0';
  if (credits < 0.000001) return '< 0.000001';
  
  // Show up to 6 decimal places, removing trailing zeros
  return credits.toFixed(6).replace(/\.?0+$/, '');
}