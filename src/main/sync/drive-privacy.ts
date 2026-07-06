// PRIV-8: fail-closed privacy resolution for metadata-op routing.
//
// Every metadata op (upload / folder-create / list / rename / move / hide)
// must pick the PUBLIC vs PRIVATE ArFS path. The historical pattern
//
//     const isPrivateDrive = mapping?.drivePrivacy === 'private';
//
// silently collapses THREE distinct states into two: when the mapping is
// UNRESOLVED (missing row, or a null/undefined drivePrivacy column) the
// expression is `false`, so a PRIVATE entity's op would fall through to the
// unencrypted PUBLIC ArFS path AND spend — writing a public, plaintext
// revision of private data (privacy leak + unapproved spend).
//
// This helper is the ONE place that rule lives. It distinguishes:
//   - positively public  (drivePrivacy === 'public')  -> 'public'
//   - positively private (drivePrivacy === 'private') -> 'private'
//   - UNRESOLVED (anything else) -> THROW (refuse to proceed)
//
// so a private-capable op can NEVER default to public and can NEVER spend on
// an unverified route. Callers that only have a public code path additionally
// treat a positively-'private' result as a hard block (there is no safe way to
// route private data through a public-only call).
//
// NOTE on types: DriveSyncMapping declares `drivePrivacy: 'public' | 'private'`,
// but that is optimistic. These rows cross the SQLite/IPC boundary raw — a
// missing mapping yields `undefined` and a null column yields `null` at
// runtime, neither of which the compile-time type captures. We narrow
// defensively against the REAL runtime shape, not the declared one.

export type DrivePrivacy = 'public' | 'private';

/**
 * Resolve a drive's privacy for metadata-op routing, or throw if it cannot be
 * POSITIVELY determined (fail closed).
 *
 * @param mapping           the drive mapping (may be undefined/null if unresolved)
 * @param driveId           drive id, for the error message only
 * @param entityDescription what is being acted on, for the error message only
 * @returns 'public' or 'private' — never a defaulted value
 * @throws  Error when privacy is unresolved (missing mapping or null/undefined
 *          drivePrivacy). Callers must let this propagate — it is the guard.
 */
export function resolveDrivePrivacyOrThrow(
  mapping: { drivePrivacy?: string | null } | null | undefined,
  driveId?: string | null,
  entityDescription = 'entity',
): DrivePrivacy {
  const privacy = mapping?.drivePrivacy;

  if (privacy === 'public') {
    return 'public';
  }
  if (privacy === 'private') {
    return 'private';
  }

  // Unresolved: mapping missing, or drivePrivacy null/undefined/unexpected.
  throw new Error(
    `Cannot resolve drive privacy for ${entityDescription} ` +
      `(drive ${driveId ?? 'unknown'}); refusing to write to avoid leaking ` +
      `private data as public.`,
  );
}
