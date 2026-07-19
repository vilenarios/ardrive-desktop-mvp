// @vitest-environment node
//
// SYNC-10: hashFileStream() replaces every whole-file `fs.readFile(...) +
// createHash('sha256').update(content)` site in the sync engine with a
// streamed digest, so process memory stays flat regardless of file size —
// the prerequisite for raising the upload cap to 2 GiB (SYNC-6/D-014).
//
// MONEY-CRITICAL INVARIANT: the streamed hash MUST be byte-identical to the
// old whole-file hash for the same content. If it ever drifted, the sync
// engine's dedup/edit-detection logic (which keys off this hash) would see
// every existing file as "changed" and mass re-upload — spending real
// AR/Turbo credits. These tests use the REAL filesystem (no fs mocks) so the
// streaming code path is genuinely exercised, not simulated.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { hashFileStream } from '@/main/sync/streaming-hash';

/** The old, pre-SYNC-10 whole-file hashing approach — the baseline to prove equivalence against. */
function wholeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('SYNC-10 hashFileStream — money-critical hash-identity proof', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  const sizes = [
    { label: 'empty file (0 bytes)', size: 0 },
    { label: 'a few bytes', size: 5 },
    { label: 'just under one default stream chunk (64 KiB highWaterMark)', size: 65535 },
    { label: 'exactly one default stream chunk', size: 65536 },
    { label: 'just over one chunk (spans two reads)', size: 65537 },
    { label: 'several chunks (~200 KiB)', size: 200 * 1024 },
    { label: '1 MiB (many chunks)', size: 1024 * 1024 },
  ];

  for (const { label, size } of sizes) {
    it(`streamed hash === whole-file hash for ${label} (${size} bytes)`, async () => {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync10-hash-identity-'));
      const filePath = path.join(tmpDir, 'content.bin');
      const content = size === 0 ? Buffer.alloc(0) : crypto.randomBytes(size);
      await fsp.writeFile(filePath, content);

      const expected = wholeFileHash(filePath);
      const actual = await hashFileStream(filePath);

      expect(actual).toBe(expected);
      // Sanity: also matches a hash computed directly from the in-memory buffer
      // (proves the fixture write round-tripped losslessly).
      expect(actual).toBe(crypto.createHash('sha256').update(content).digest('hex'));
    });
  }

  it('produces the well-known SHA-256 of the empty string for a 0-byte file', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync10-hash-empty-'));
    const filePath = path.join(tmpDir, 'empty.bin');
    await fsp.writeFile(filePath, Buffer.alloc(0));

    const hash = await hashFileStream(filePath);

    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('rejects for a file that does not exist (no silent empty-hash fallback)', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync10-hash-missing-'));
    const missingPath = path.join(tmpDir, 'does-not-exist.bin');

    await expect(hashFileStream(missingPath)).rejects.toThrow();
  });

  it('keeps process memory flat while hashing a large (150-300 MB) file', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync10-hash-memory-'));
    const filePath = path.join(tmpDir, 'large.bin');
    const FILE_SIZE = 220 * 1024 * 1024; // 220 MiB — within the requested 150-300 MB range

    // Create the fixture as a SPARSE file (ftruncate) so setup itself never
    // materializes 220 MB in JS memory — only hashFileStream's own streaming
    // is under test here. (Content is still read/hashed byte-for-byte from
    // disk; sparse regions read back as zero bytes, which is fine — this test
    // proves memory behavior, not hash correctness, which the identity tests
    // above already cover on real random content.)
    const handle = await fsp.open(filePath, 'w');
    try {
      await handle.truncate(FILE_SIZE);
    } finally {
      await handle.close();
    }

    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;

    const hash = await hashFileStream(filePath);

    if (global.gc) global.gc();
    const rssAfter = process.memoryUsage().rss;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Flat memory: RSS growth must stay far below the 220 MB file size — a
    // whole-file `fs.readFile` would grow RSS by ~FILE_SIZE (plus the hash
    // buffer). Streamed, growth should only reflect small per-chunk buffers.
    // Generous threshold (60 MB) to absorb GC timing noise without a
    // --expose-gc flag, while still failing hard on whole-file buffering.
    const growth = rssAfter - rssBefore;
    const maxAllowedGrowth = 60 * 1024 * 1024;
    expect(growth).toBeLessThan(maxAllowedGrowth);
    expect(growth).toBeLessThan(FILE_SIZE * 0.3);
  }, 30000);
});
