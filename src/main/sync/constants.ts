import { TURBO_FREE_SIZE_LIMIT } from '../../utils/turbo-utils';

/**
 * SYNC-6 / D-014: single source of truth for the beta upload size cap.
 *
 * A file strictly larger than this is NOT uploaded — but it must be surfaced
 * loudly (OS notification + a persistent failed-upload record), never silently
 * dropped (audit §2.11). BOTH the enforcement check (CostCalculator.isFileTooBig)
 * and every user-facing "too big" message derive from THIS constant so the two
 * can never drift apart.
 *
 * Value is 2 GiB (D-014's eventual target), matching the ArDrive web app's
 * upload ceiling. Raised from the interim 100 MiB now that SYNC-10 (streaming
 * hashing + indexed processed_files lookups) has landed — the sync path no
 * longer reads whole files into memory per event, so hashing/dedup at this
 * size keeps memory flat. Downloads have no such cap (SYNC-6) and must keep
 * streaming arbitrarily large files.
 */
export const MAX_SYNC_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export const SYNC_CONSTANTS = {
  // Single source of truth lives in utils/turbo-utils (107520 bytes / 105 KiB).
  TURBO_FREE_SIZE_LIMIT,
  MAX_SYNC_FILE_SIZE_BYTES,
  FILE_PROCESSING_DEBOUNCE: 500,
  FOLDER_CREATION_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
} as const;