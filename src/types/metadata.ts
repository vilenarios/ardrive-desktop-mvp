export interface CustomMetadata {
  // Basic metadata
  title?: string;
  description?: string;
  keywords?: string[]; // Tags/keywords for searchability
  
  // Categorization
  category?: string;
  contentType?: string; // Document, Image, Video, etc.
  projectName?: string;
  
  // Custom fields (user-defined key-value pairs)
  customFields?: Record<string, string>;
  
  // System metadata (auto-populated, read-only)
  fileSize?: number;
  uploadDate?: string;
  mimeType?: string;
  originalFileName?: string;
}

export interface MetadataTemplate {
  id: string;
  name: string;
  description?: string;
  metadata: Partial<CustomMetadata>;
  createdAt: Date;
  lastUsed?: Date;
  useCount: number;
}

export interface FileWithMetadata {
  fileId: string;
  fileName: string;
  filePath: string;
  size: number;
  mimeType: string;
  metadata: CustomMetadata;
  hasCustomMetadata: boolean;
}

export interface MetadataValidationError {
  field: string;
  message: string;
}

export interface MetadataEditContext {
  mode: 'single' | 'bulk';
  fileIds: string[];
  files: FileWithMetadata[];
  template?: MetadataTemplate;
}