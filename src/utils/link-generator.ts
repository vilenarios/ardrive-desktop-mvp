/**
 * Utility functions for generating ArDrive and Arweave links
 */

// SYNC-19: matches src/main/gateway.ts's DEFAULT_GATEWAY_HOST and
// src/renderer/utils/gateway.ts's fallback. arweave.net rate-limits (429s)
// some users, so no link builder in this file may fall back to it silently —
// every function below takes the resolved gateway host as a parameter and
// defaults it to turbo-gateway.com, never arweave.net. Callers should pass
// the actual configured host (via src/renderer/utils/gateway.ts's
// getGatewayHost()) whenever one is available.
export const DEFAULT_GATEWAY_HOST = 'turbo-gateway.com';

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
  driveId?: string,
  fileKey?: string,
  gatewayHost: string = DEFAULT_GATEWAY_HOST
): LinkSet {
  const links: LinkSet = {};

  // Direct Arweave transaction links
  if (dataTxId) {
    links.dataTransactionUrl = `https://${gatewayHost}/tx/${dataTxId}`;
    links.rawFileUrl = `https://${gatewayHost}/${dataTxId}`;
  }

  if (metadataTxId) {
    links.metadataTransactionUrl = `https://${gatewayHost}/tx/${metadataTxId}`;
  }

  // ArDrive app links
  if (fileId) {
    // Include file key for private files
    const baseUrl = `https://app.ardrive.io/#/file/${fileId}/view`;
    links.fileViewUrl = fileKey ? `${baseUrl}?fileKey=${fileKey}` : baseUrl;
  }

  if (driveId) {
    links.driveViewUrl = `https://app.ardrive.io/#/drives/${driveId}`;
  }

  return links;
}

/**
 * Generate a shareable link for a file
 */
export function generateShareableFileLink(fileId: string, fileName?: string, fileKey?: string): string {
  const baseUrl = `https://app.ardrive.io/#/file/${fileId}/view`;
  const params: string[] = [];
  
  // Add file key for private files
  if (fileKey) {
    params.push(`fileKey=${fileKey}`);
  }
  
  // Add filename for better sharing experience
  if (fileName) {
    params.push(`name=${encodeURIComponent(fileName)}`);
  }
  
  return params.length > 0 ? `${baseUrl}?${params.join('&')}` : baseUrl;
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
export function generateExplorerLinks(txId: string, gatewayHost: string = DEFAULT_GATEWAY_HOST) {
  return {
    arweave: `https://${gatewayHost}/tx/${txId}`,
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