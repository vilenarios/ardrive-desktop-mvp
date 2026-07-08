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
 * Value is 100 MiB — matching the CLAUDE.md / README / in-code claim. The old
 * 500 MiB CostCalculator constant silently contradicted every one of those
 * (audit §2.11), which is exactly the dishonesty SYNC-6 removes.
 *
 * FOLLOW-UP: raising this to 2 GiB (D-014's eventual target) is blocked on
 * SYNC-10 (streaming hashing) — today the sync path reads whole files into
 * memory up to 3× per event, which is fatal at 2 GiB. Until SYNC-10 lands the
 * honest beta cap stays 100 MiB.
 */
export const MAX_SYNC_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MiB

export const SYNC_CONSTANTS = {
  // Single source of truth lives in utils/turbo-utils (107520 bytes / 105 KiB).
  TURBO_FREE_SIZE_LIMIT,
  MAX_SYNC_FILE_SIZE_BYTES,
  FILE_PROCESSING_DEBOUNCE: 500,
  FOLDER_CREATION_DELAY: 1000,
  MAX_RETRIES: 3,
  CACHE_DURATION: 10 * 60 * 1000, // 10 minutes
} as const;