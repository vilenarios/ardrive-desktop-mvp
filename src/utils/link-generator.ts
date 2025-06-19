/**
 * Utility functions for generating ArDrive and Arweave links
 */

export interface LinkSet {
  // Direct Arweave links
  dataTransactionUrl?: string;
  metadataTransactionUrl?: string;
  
  // ArDrive app links
  fileViewUrl?: string;
  driveViewUrl?: string;
  
  // Raw file access
  rawFileUrl?: string;
}

/**
 * Generate all relevant links for a file upload
 */
export function generateFileLinks(
  dataTxId?: string,
  metadataTxId?: string,
  fileId?: string,
  driveId?: string
): LinkSet {
  const links: LinkSet = {};

  // Direct Arweave transaction links
  if (dataTxId) {
    links.dataTransactionUrl = `https://arweave.net/tx/${dataTxId}`;
    links.rawFileUrl = `https://arweave.net/${dataTxId}`;
  }

  if (metadataTxId) {
    links.metadataTransactionUrl = `https://arweave.net/tx/${metadataTxId}`;
  }

  // ArDrive app links
  if (fileId) {
    links.fileViewUrl = `https://app.ardrive.io/#/file/${fileId}/view`;
  }

  if (driveId) {
    links.driveViewUrl = `https://app.ardrive.io/#/drives/${driveId}`;
  }

  return links;
}

/**
 * Generate a shareable link for a file
 */
export function generateShareableFileLink(fileId: string, fileName?: string): string {
  const baseUrl = `https://app.ardrive.io/#/file/${fileId}/view`;
  if (fileName) {
    // Add filename as a URL parameter for better sharing experience
    return `${baseUrl}?name=${encodeURIComponent(fileName)}`;
  }
  return baseUrl;
}

/**
 * Generate a shareable link for a drive
 */
export function generateShareableDriveLink(driveId: string, driveName?: string): string {
  const baseUrl = `https://app.ardrive.io/#/drives/${driveId}`;
  if (driveName) {
    return `${baseUrl}?name=${encodeURIComponent(driveName)}`;
  }
  return baseUrl;
}

/**
 * Generate Arweave block explorer links
 */
export function generateExplorerLinks(txId: string) {
  return {
    arweave: `https://arweave.net/tx/${txId}`,
    viewblock: `https://viewblock.io/arweave/tx/${txId}`,
    arscan: `https://arscan.io/tx/${txId}`
  };
}

/**
 * Check if a transaction ID is valid (43 characters, base64url)
 */
export function isValidArweaveTxId(txId: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(txId);
}

/**
 * Check if a file ID is valid ArDrive UUID format
 */
export function isValidArDriveFileId(fileId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId);
}