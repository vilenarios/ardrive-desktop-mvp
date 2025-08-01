/**
 * Utility functions for MIME type handling
 */

// Common MIME type mappings
const MIME_TYPES: { [key: string]: string } = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  
  // Text
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  
  // Code
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.jsx': 'text/javascript',
  '.tsx': 'text/typescript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.sh': 'text/x-shellscript',
  '.md': 'text/markdown',
  
  // Archives
  '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  
  // Media
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  
  // Other
  '.bin': 'application/octet-stream',
  '.exe': 'application/x-msdownload',
  '.dmg': 'application/x-apple-diskimage',
  '.apk': 'application/vnd.android.package-archive'
};

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) {
    return 'application/octet-stream';
  }
  
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Check if MIME type is an image
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Check if MIME type is a video
 */
export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * Check if MIME type is audio
 */
export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

/**
 * Check if MIME type is text-based
 */
export function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || 
         mimeType === 'application/json' || 
         mimeType === 'application/xml';
}

/**
 * Get file category from MIME type
 */
export function getFileCategory(mimeType: string): string {
  if (isImageMimeType(mimeType)) return 'image';
  if (isVideoMimeType(mimeType)) return 'video';
  if (isAudioMimeType(mimeType)) return 'audio';
  if (isTextMimeType(mimeType)) return 'text';
  if (mimeType.includes('pdf')) return 'document';
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar')) return 'archive';
  return 'other';
}