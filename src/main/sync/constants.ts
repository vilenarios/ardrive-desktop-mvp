import { TURBO_FREE_SIZE_LIMIT } from '../../utils/turbo-utils';

export const SYNC_CONSTANTS = {
  // Single source of truth lives in utils/turbo-utils (107520 bytes / 105 KiB).
  TURBO_FREE_SIZE_LIMIT,
  FILE_PROCESSING_DEBOUNCE: 500,
  FOLDER_CREATION_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
} as const;