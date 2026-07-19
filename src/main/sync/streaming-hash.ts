import { createReadStream } from 'fs';
import { createHash } from 'crypto';

/**
 * SYNC-10: compute the SHA-256 hash of a file's contents by streaming it
 * through the digest in fixed-size chunks (`fs.createReadStream` piped into
 * `crypto.createHash`), rather than reading the whole file into memory first
 * (`fs.readFile(...)` + `.update(buffer)`). Process memory stays flat
 * regardless of file size.
 *
 * This is the money-critical prerequisite for the 2 GiB upload cap
 * (SYNC-6/D-014): every sync file event previously read the full file into
 * memory multiple times (dedup check, version-change detection, move/rename
 * similarity, upload-completion registration) — fatal at multi-GB sizes.
 *
 * INVARIANT: this MUST produce the exact same hex digest as the old
 * `createHash('sha256').update(await fs.readFile(filePath)).digest('hex')`
 * for identical file content. The sync engine's dedup/edit-detection logic
 * keys off this hash — if it ever drifted from the whole-file hash, every
 * existing file would look "changed" and the app would mass re-upload,
 * spending real AR/Turbo credits. See streaming-hash.test.ts for the
 * hash-identity proof across several sizes.
 */
export function hashFileStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
    });

    stream.on('error', (err) => {
      reject(err);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}
