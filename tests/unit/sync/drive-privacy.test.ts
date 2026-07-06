// @vitest-environment node
//
// PRIV-8: unit coverage for the single fail-closed privacy resolver that every
// metadata-op site in sync-manager routes through. The whole point is that an
// UNRESOLVED mapping can NEVER be silently treated as "public" — it must throw.
import { describe, it, expect } from 'vitest';
import { resolveDrivePrivacyOrThrow } from '@/main/sync/drive-privacy';

describe('resolveDrivePrivacyOrThrow (PRIV-8 fail-closed)', () => {
  it('returns "public" for a positively-public mapping', () => {
    expect(resolveDrivePrivacyOrThrow({ drivePrivacy: 'public' }, 'drive-1', 'file "a"')).toBe(
      'public',
    );
  });

  it('returns "private" for a positively-private mapping', () => {
    expect(resolveDrivePrivacyOrThrow({ drivePrivacy: 'private' }, 'drive-1', 'file "a"')).toBe(
      'private',
    );
  });

  // --- the fail-closed core: every unresolved shape must THROW, never default ---

  it('throws when the mapping is undefined (no mapping found)', () => {
    expect(() => resolveDrivePrivacyOrThrow(undefined, 'drive-1', 'file "secret"')).toThrow(
      /refusing to write to avoid leaking private data as public/i,
    );
  });

  it('throws when the mapping is null', () => {
    expect(() => resolveDrivePrivacyOrThrow(null, 'drive-1', 'file "secret"')).toThrow(
      /Cannot resolve drive privacy/i,
    );
  });

  it('throws when drivePrivacy is undefined (present mapping, missing column)', () => {
    expect(() => resolveDrivePrivacyOrThrow({}, 'drive-1', 'folder "x"')).toThrow(
      /refusing to write/i,
    );
  });

  it('throws when drivePrivacy is null (SQLite null column crosses raw)', () => {
    expect(() => resolveDrivePrivacyOrThrow({ drivePrivacy: null }, 'drive-1')).toThrow(
      /Cannot resolve drive privacy/i,
    );
  });

  it('throws on any unexpected/garbage privacy value (never assumes public)', () => {
    expect(() =>
      resolveDrivePrivacyOrThrow({ drivePrivacy: 'PUBLIC' as any }, 'drive-1'),
    ).toThrow(/Cannot resolve drive privacy/i);
    expect(() =>
      resolveDrivePrivacyOrThrow({ drivePrivacy: '' as any }, 'drive-1'),
    ).toThrow(/Cannot resolve drive privacy/i);
  });

  it('names the entity and drive in the error for diagnosability', () => {
    expect(() => resolveDrivePrivacyOrThrow(undefined, 'drive-xyz', 'file "report.pdf"')).toThrow(
      /file "report\.pdf".*drive-xyz/is,
    );
  });
});
