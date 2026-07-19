// @vitest-environment node
//
// [SYNC] Comprehensive classification coverage for FileOperationDetector.
//
// This detector protects money AND revision history: it groups a chokidar
// unlink+add pair inside a 3-second window and decides whether a filesystem
// change is a rename / move / copy / delete / new. The stakes:
//   - A rename or move MUST classify as rename/move so the consumer
//     (sync-manager.handleFileWithVersioning -> handleFileMove) reuses the
//     existing ArFS fileId as a metadata-only tx (estimatedTurboCost: 0). If it
//     instead read as delete+new, the file would be RE-UPLOADED (spend
//     AR/Turbo) and its ArFS revision history would be orphaned.
//   - A copy of an existing file MUST classify as copy (not a move that steals
//     the original's fileId).
//
// Tests are deterministic: fs stats + file content are mocked, and hashes are
// supplied explicitly to onFileDelete/onFileAdd so no real hashing/IO happens.
// Timers are faked; the detector's internal 100ms write-settle delay and the
// 3000ms detection window are driven with advanceTimersByTimeAsync.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsp from 'fs/promises';
import type { Stats } from 'fs';
import {
  FileOperationDetector,
  FileOperationDetection,
} from '@/main/sync/FileOperationDetector';
import { createMockDatabaseManager } from '../../helpers/mock-database';

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

// SYNC-10: FileOperationDetector.calculateFileHash now streams via the real
// fs.createReadStream (the plain 'fs' module, unmocked here) — the retry-hash
// verification inside detectByHash (a same-size hash miss re-reads the file)
// and the fileHash-not-supplied fallback in onFileAdd both go through it. On
// this virtual filesystem (statMap/contentMap, no real files on disk) that
// would ENOENT. Route the shared streaming-hash utility through the SAME
// mocked fs/promises.readFile (i.e. contentMap) the old inline
// `readFile + createHash` code used to, so hash-dependent classification
// (move via metadata fallback, etc.) still resolves correctly.
vi.mock('@/main/sync/streaming-hash', () => ({
  hashFileStream: vi.fn(async (filePath: string) => {
    const fsp = await import('fs/promises');
    const crypto = await import('crypto');
    const content = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(content as any).digest('hex');
  }),
}));

const ARFS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DETECTION_WINDOW_MS = 3000;

// A small, controllable virtual filesystem for the mocked fs/promises calls.
const statMap = new Map<string, Stats>();
const contentMap = new Map<string, Buffer>();

function fileStat(size: number, mtimeMs = 1000): Stats {
  return {
    size,
    mtimeMs,
    mtime: new Date(mtimeMs),
    isFile: () => true,
    isDirectory: () => false,
  } as unknown as Stats;
}

function enoent(p: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: no such file, ${p}`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

describe('FileOperationDetector — classification', () => {
  let detector: FileOperationDetector;
  let db: ReturnType<typeof createMockDatabaseManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    statMap.clear();
    contentMap.clear();

    vi.mocked(fsp.stat).mockImplementation(async (p: any) => {
      const s = statMap.get(String(p));
      if (!s) throw enoent(String(p));
      return s;
    });
    vi.mocked(fsp.readFile).mockImplementation(async (p: any) => {
      const c = contentMap.get(String(p));
      if (c === undefined) throw enoent(String(p));
      return c as any;
    });

    db = createMockDatabaseManager();
    // detectCopy consults the DB; default to "no other file has this hash".
    (db as any).getFilesByHash = vi.fn().mockResolvedValue([]);

    detector = new FileOperationDetector(db);
  });

  afterEach(() => {
    detector.clearAllOperations();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Drive onFileAdd through its internal write-settle timers deterministically.
  async function detectAdd(
    filePath: string,
    hash: string,
    advanceMs = 250
  ): Promise<FileOperationDetection | null> {
    const p = detector.onFileAdd(filePath, hash);
    await vi.advanceTimersByTimeAsync(advanceMs);
    return p;
  }

  // ---------------------------------------------------------------------------
  // 1. Correct classification of each operation type
  // ---------------------------------------------------------------------------
  describe('correct classification of each type', () => {
    it("rename: same dir, same content -> 'rename' (reuses fileId, not delete+new)", async () => {
      const onConfirm = vi.fn();
      // File is already gone when the delete fires (realistic): stat rejects,
      // hash comes from the DB. arfsFileId is the identity we must preserve.
      await detector.onFileDelete('/sync/dir/old.txt', 'hash-A', ARFS_ID, onConfirm);
      statMap.set('/sync/dir/new.txt', fileStat(120));

      const result = await detectAdd('/sync/dir/new.txt', 'hash-A');

      expect(result).not.toBeNull();
      expect(result!.type).toBe('rename');
      expect(result!.oldPath).toBe('/sync/dir/old.txt');
      expect(result!.newPath).toBe('/sync/dir/new.txt');
      // MONEY/HISTORY: the ArFS fileId must ride along so the consumer does a
      // metadata-only rename, not a fresh upload.
      expect(result!.oldArfsFileId).toBe(ARFS_ID);

      // And the delete must NOT also confirm — advancing well past the window
      // proves the pending delete was cancelled, so no hide/delete is emitted.
      await vi.advanceTimersByTimeAsync(DETECTION_WINDOW_MS + 500);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("move: different dir, same name, same content -> 'move'", async () => {
      await detector.onFileDelete('/sync/a/report.txt', 'hash-B', ARFS_ID);
      statMap.set('/sync/b/report.txt', fileStat(400));

      const result = await detectAdd('/sync/b/report.txt', 'hash-B');

      expect(result!.type).toBe('move');
      expect(result!.oldPath).toBe('/sync/a/report.txt');
      expect(result!.newPath).toBe('/sync/b/report.txt');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it("move+rename: different dir AND different name, same content -> 'move'", async () => {
      await detector.onFileDelete('/sync/a/old.txt', 'hash-C', ARFS_ID);
      statMap.set('/sync/b/renamed.txt', fileStat(999));

      const result = await detectAdd('/sync/b/renamed.txt', 'hash-C');

      // The detector collapses move-with-rename into 'move' (both dir and name
      // changed). Still a metadata op that reuses the fileId.
      expect(result!.type).toBe('move');
      expect(result!.oldPath).toBe('/sync/a/old.txt');
      expect(result!.newPath).toBe('/sync/b/renamed.txt');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it("copy: add whose hash matches an existing kept file (original still present) -> 'copy'", async () => {
      // No pending delete: the original was never removed. The DB reports
      // another active file with the same hash.
      (db as any).getFilesByHash = vi.fn().mockResolvedValue([
        {
          id: 'hash-D',
          localPath: '/sync/dir/original.txt',
          fileName: 'original.txt',
          fileHash: 'hash-D',
          fileSize: 50,
        },
      ]);
      statMap.set('/sync/dir/duplicate.txt', fileStat(50));

      // SYNC-24 (F1): the copy decision is now DEFERRED until the detection
      // window elapses (so an add-before-unlink move can be caught). With no
      // unlink of the source, it settles as 'copy' — the outcome is unchanged,
      // only the timing, so we advance past the window here.
      const result = await detectAdd(
        '/sync/dir/duplicate.txt',
        'hash-D',
        DETECTION_WINDOW_MS + 300
      );

      // MONEY/HISTORY: a copy must NOT read as 'new' (it isn't fresh content)
      // and must NOT read as 'move' (it must not steal the original's fileId).
      expect(result!.type).toBe('copy');
      expect(result!.oldPath).toBe('/sync/dir/original.txt');
      expect(result!.newPath).toBe('/sync/dir/duplicate.txt');
    });

    it("delete: unlink with no matching re-add in the window -> 'delete'", async () => {
      const onConfirm = vi.fn();
      await detector.onFileDelete('/sync/gone.txt', 'hash-E', ARFS_ID, onConfirm);

      expect(onConfirm).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(DETECTION_WINDOW_MS + 100);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const detection: FileOperationDetection = onConfirm.mock.calls[0][0];
      expect(detection.type).toBe('delete');
      expect(detection.oldPath).toBe('/sync/gone.txt');
      expect(detection.oldArfsFileId).toBe(ARFS_ID);
      // Cached for the consumer to read back.
      expect(detector.getRecentOperation('/sync/gone.txt')?.type).toBe('delete');
    });

    it("new: add with no hash match anywhere -> 'new'", async () => {
      statMap.set('/sync/brand-new.txt', fileStat(10));

      const result = await detectAdd('/sync/brand-new.txt', 'hash-UNIQUE');

      expect(result!.type).toBe('new');
      expect(result!.newPath).toBe('/sync/brand-new.txt');
      expect(result!.hash).toBe('hash-UNIQUE');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. The 3-second detection window edge cases
  // ---------------------------------------------------------------------------
  describe('3-second detection window', () => {
    it('unlink+add JUST INSIDE the window -> rename (pending still tracked)', async () => {
      await detector.onFileDelete('/sync/dir/a.txt', 'hash-W', ARFS_ID);
      // Wait almost the whole window, then the add arrives.
      await vi.advanceTimersByTimeAsync(2000);
      statMap.set('/sync/dir/b.txt', fileStat(77));

      const result = await detectAdd('/sync/dir/b.txt', 'hash-W', 200); // total ~2200ms

      expect(result!.type).toBe('rename');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it('unlink+add JUST OUTSIDE the window -> delete + new (NOT rename)', async () => {
      const onConfirm = vi.fn();
      await detector.onFileDelete('/sync/dir/a.txt', 'hash-W2', ARFS_ID, onConfirm);

      // Let the window elapse: the delete confirms and the pending is gone.
      await vi.advanceTimersByTimeAsync(DETECTION_WINDOW_MS + 100);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm.mock.calls[0][0].type).toBe('delete');

      // The (late) re-add can no longer be paired -> brand new file.
      statMap.set('/sync/dir/b.txt', fileStat(77));
      const result = await detectAdd('/sync/dir/b.txt', 'hash-W2');

      expect(result!.type).toBe('new');
      // This is the boundary where a too-slow rename becomes a re-upload.
    });

    it('ordering: unlink BEFORE add (the normal rename ordering) -> rename', async () => {
      await detector.onFileDelete('/sync/dir/a.txt', 'hash-O', ARFS_ID);
      statMap.set('/sync/dir/b.txt', fileStat(5));

      const result = await detectAdd('/sync/dir/b.txt', 'hash-O');

      expect(result!.type).toBe('rename');
    });

    it('ordering: add BEFORE unlink, source unlinked in-window -> MOVE (reuses fileId, no re-upload) [SYNC-24 F1]', async () => {
      // If the OS/chokidar surfaces the new file before the unlink of the old
      // one, there is no pending delete yet, so detectCopy first sees a copy
      // candidate (source still in the DB). SYNC-24 (F1): that decision is now
      // DEFERRED. When the source path is unlinked within the detection window,
      // the pair is correctly reclassified as a MOVE — the ArFS fileId rides
      // along (carried by the unlink) so the consumer does a metadata-only move
      // instead of re-uploading the content and orphaning history.
      (db as any).getFilesByHash = vi.fn().mockResolvedValue([
        {
          id: 'hash-P',
          localPath: '/sync/a/report.txt',
          fileName: 'report.txt',
          fileHash: 'hash-P',
          fileSize: 5,
        },
      ]);
      statMap.set('/sync/b/report.txt', fileStat(5));

      // The add fires first and reaches the (now deferred) copy decision...
      const addPromise = detector.onFileAdd('/sync/b/report.txt', 'hash-P');
      await vi.advanceTimersByTimeAsync(250); // settle + register the pending copy
      // ...then, still inside the window, the source is unlinked (different dir,
      // same name -> a move).
      await detector.onFileDelete('/sync/a/report.txt', 'hash-P', ARFS_ID);

      const result = await addPromise;

      expect(result!.type).toBe('move');
      expect(result!.oldPath).toBe('/sync/a/report.txt');
      expect(result!.newPath).toBe('/sync/b/report.txt');
      // MONEY/HISTORY: the fileId is carried forward -> metadata-only, cost 0.
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it('ordering: add BEFORE unlink, source STAYS -> COPY once window elapses (genuine copy preserved) [SYNC-24 F1]', async () => {
      // The disambiguator is purely whether the source is unlinked in-window.
      // Here it never is (a real duplicate), so the deferred decision settles as
      // 'copy' — a genuine copy must NEVER be reclassified as a move.
      (db as any).getFilesByHash = vi.fn().mockResolvedValue([
        {
          id: 'hash-P',
          localPath: '/sync/dir/a.txt',
          fileName: 'a.txt',
          fileHash: 'hash-P',
          fileSize: 5,
        },
      ]);
      statMap.set('/sync/dir/b.txt', fileStat(5));

      const result = await detectAdd(
        '/sync/dir/b.txt',
        'hash-P',
        DETECTION_WINDOW_MS + 300
      );

      expect(result!.type).toBe('copy');
      expect(result!.oldPath).toBe('/sync/dir/a.txt');
      // A copy never steals the original's identity.
      expect(result!.oldArfsFileId).toBeUndefined();
    });

    it('multiple concurrent ops in one window are grouped by HASH, not cross-matched', async () => {
      // Two unrelated files deleted in the same directory within one window.
      await detector.onFileDelete('/sync/dir/alpha.txt', 'hash-ALPHA', 'id-alpha');
      await detector.onFileDelete('/sync/dir/gamma.txt', 'hash-GAMMA', 'id-gamma');

      statMap.set('/sync/dir/alpha-renamed.txt', fileStat(11));
      statMap.set('/sync/dir/gamma-renamed.txt', fileStat(22));

      const r1 = await detectAdd('/sync/dir/alpha-renamed.txt', 'hash-ALPHA');
      const r2 = await detectAdd('/sync/dir/gamma-renamed.txt', 'hash-GAMMA');

      // Each add resolves against its OWN deleted file by content hash — the
      // two operations do not bleed into each other.
      expect(r1!.type).toBe('rename');
      expect(r1!.oldPath).toBe('/sync/dir/alpha.txt');
      expect(r1!.oldArfsFileId).toBe('id-alpha');

      expect(r2!.type).toBe('rename');
      expect(r2!.oldPath).toBe('/sync/dir/gamma.txt');
      expect(r2!.oldArfsFileId).toBe('id-gamma');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Hash / similarity boundaries
  // ---------------------------------------------------------------------------
  describe('hash / content boundaries', () => {
    it('same-path edit (changed content, no matching pending delete) -> new, NOT move/copy', async () => {
      // An in-place edit surfaces as an add with a fresh hash and no unlink to
      // pair with. The DB has no other file at this hash. The detector must not
      // invent a move/copy — downstream versioning handles the modification.
      statMap.set('/sync/dir/doc.txt', fileStat(200));

      const result = await detectAdd('/sync/dir/doc.txt', 'hash-EDITED');

      expect(result!.type).toBe('new');
    });

    it('different content, same name, DIFFERENT size, within window -> new (no false move)', async () => {
      // Realistic delete: the file is already gone, so its snapshot size is 0.
      await detector.onFileDelete('/sync/a/name.txt', 'hash-OLD', ARFS_ID);
      statMap.set('/sync/b/name.txt', fileStat(500)); // different content + size

      const result = await detectAdd('/sync/b/name.txt', 'hash-NEW');

      // Hashes differ, sizes differ, DB has nothing at hash-NEW -> new file.
      expect(result!.type).toBe('new');
    });

    it('metadata fallback: same name + same captured size, different content -> move [heuristic, documented]', async () => {
      // Here the delete snapshot DID capture the size (stat succeeded before the
      // file vanished). detectByHash fails (different content) but
      // detectByMetadata pairs on name+size alone -> 'move'. Content is NOT
      // required for this fallback. In production the delete snapshot size is
      // usually 0 (the file is already gone), so this fallback rarely triggers
      // — see the companion "size 0" test below.
      statMap.set('/sync/a/report.txt', fileStat(300, 1000)); // old mtime => not "recentlyMoved"
      await detector.onFileDelete('/sync/a/report.txt', 'hash-OLD', ARFS_ID);
      statMap.set('/sync/b/report.txt', fileStat(300));
      contentMap.set('/sync/b/report.txt', Buffer.from('unrelated but same length!!!'));

      // advance extra: detectByHash retries hashing (500ms) on a same-size miss.
      const result = await detectAdd('/sync/b/report.txt', 'hash-DIFFERENT', 900);

      expect(result!.type).toBe('move');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it('metadata fallback is inert on a realistic delete (snapshot size 0) -> new', async () => {
      // Same scenario but the delete stat fails (file already gone) so the
      // snapshot size is 0 and cannot match the new file's real size.
      await detector.onFileDelete('/sync/a/report.txt', 'hash-OLD', ARFS_ID);
      statMap.set('/sync/b/report.txt', fileStat(300));

      const result = await detectAdd('/sync/b/report.txt', 'hash-DIFFERENT');

      expect(result!.type).toBe('new');
    });

    it('empty files: two empty files (size 0) that hash-match -> rename', async () => {
      // Empty content still produces a stable sha256; when it matches, a move
      // between empty files is a rename/move like any other.
      await detector.onFileDelete('/sync/dir/empty-old.txt', 'hash-EMPTY', ARFS_ID);
      statMap.set('/sync/dir/empty-new.txt', fileStat(0));

      const result = await detectAdd('/sync/dir/empty-new.txt', 'hash-EMPTY');

      expect(result!.type).toBe('rename');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
    });

    it('empty new file with no match -> new', async () => {
      statMap.set('/sync/dir/fresh-empty.txt', fileStat(0));

      const result = await detectAdd('/sync/dir/fresh-empty.txt', 'hash-EMPTY-2');

      expect(result!.type).toBe('new');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Money / history critical assertions (explicit)
  // ---------------------------------------------------------------------------
  describe('money/history-critical guarantees', () => {
    it('a rename is NEVER surfaced as delete + new (no spend, no orphaned history)', async () => {
      const onConfirm = vi.fn();
      await detector.onFileDelete('/sync/dir/invoice.pdf', 'hash-M', ARFS_ID, onConfirm);
      statMap.set('/sync/dir/invoice-final.pdf', fileStat(1234));

      const result = await detectAdd('/sync/dir/invoice-final.pdf', 'hash-M');

      // Classified as rename...
      expect(result!.type).toBe('rename');
      // ...carrying the original fileId (metadata-only tx, cost 0)...
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
      // ...and crucially the delete side is fully cancelled: even long after
      // the window, no confirmed-delete (which would become an ArFS hide /
      // re-upload path) is ever emitted.
      await vi.advanceTimersByTimeAsync(DETECTION_WINDOW_MS * 2);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(detector.getRecentOperation('/sync/dir/invoice.pdf')).toBeUndefined();
    });

    it('a move carries the fileId forward and does not confirm a delete', async () => {
      const onConfirm = vi.fn();
      await detector.onFileDelete('/sync/a/photo.jpg', 'hash-MV', ARFS_ID, onConfirm);
      statMap.set('/sync/b/photo.jpg', fileStat(4096));

      const result = await detectAdd('/sync/b/photo.jpg', 'hash-MV');

      expect(result!.type).toBe('move');
      expect(result!.oldArfsFileId).toBe(ARFS_ID);
      await vi.advanceTimersByTimeAsync(DETECTION_WINDOW_MS * 2);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('a copy is NOT surfaced as a move (never reuses the original fileId)', async () => {
      (db as any).getFilesByHash = vi.fn().mockResolvedValue([
        {
          id: 'hash-CP',
          localPath: '/sync/dir/source.bin',
          fileName: 'source.bin',
          fileHash: 'hash-CP',
          fileSize: 8,
        },
      ]);
      statMap.set('/sync/dir/source-copy.bin', fileStat(8));

      // SYNC-24 (F1): copy is decided after the window (deferred); advance past
      // it. The source is never unlinked, so it stays a copy.
      const result = await detectAdd(
        '/sync/dir/source-copy.bin',
        'hash-CP',
        DETECTION_WINDOW_MS + 300
      );

      expect(result!.type).toBe('copy');
      // A copy detection has no oldArfsFileId — the original keeps its identity.
      expect(result!.oldArfsFileId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Detector -> consumer contract (the fields sync-manager relies on)
  // ---------------------------------------------------------------------------
  describe('consumer contract (sync-manager.handleFileWithVersioning)', () => {
    // sync-manager only routes to handleFileMove (metadata op, estimatedCost 0)
    // when type is 'move' | 'rename' AND operation.oldPath is set; it then
    // reuses operation.oldArfsFileId. These assertions pin exactly those fields.
    it("rename detection exposes { type:'rename', oldPath, oldArfsFileId } for the move path", async () => {
      await detector.onFileDelete('/sync/dir/a.txt', 'hash-K', ARFS_ID);
      statMap.set('/sync/dir/b.txt', fileStat(3));

      const op = await detectAdd('/sync/dir/b.txt', 'hash-K');

      const routesToMove =
        (op!.type === 'move' || op!.type === 'rename') && !!op!.oldPath;
      expect(routesToMove).toBe(true);
      expect(op!.oldArfsFileId).toBe(ARFS_ID);
    });

    it("a 'new' detection does NOT route to the move path", async () => {
      statMap.set('/sync/dir/fresh.txt', fileStat(3));
      const op = await detectAdd('/sync/dir/fresh.txt', 'hash-FRESH');

      const routesToMove =
        (op!.type === 'move' || (op as any)!.type === 'rename') && !!op!.oldPath;
      expect(routesToMove).toBe(false);
    });
  });
});
