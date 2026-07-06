// @vitest-environment node
//
// [SYNC] Comprehensive classification coverage for FolderOperationDetector.
//
// Folder operations mirror the file detector: an unlink+add pair inside a
// 2-second window is classified as rename / move / rename_and_move / delete /
// new, and a matched rename/move must reuse the existing ArFS folderId
// (oldArweaveFolderId) rather than re-creating the folder and orphaning its
// history.
//
// IMPORTANT behavioral note that these tests pin: the DELETE snapshot is built
// from "last known state" only — the folder is already gone, so it records an
// EMPTY children list and an EMPTY contentHash (see onFolderDelete). As a
// result the detector can only compare PARENT PATH and NAME for a match; it
// cannot use content. This makes several classifications coarser than an ideal
// spec, and the tests document exactly what the code does today (including a
// couple of limitations flagged to the coordinator).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fsp from 'fs/promises';
import {
  FolderOperationDetector,
  OperationDetection,
} from '@/main/sync/FolderOperationDetector';

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

const FOLDER_WINDOW_MS = 2000;

interface Entry {
  name: string;
  isFile: boolean;
  size?: number;
}

// Virtual filesystem for createSnapshot(): folder path -> dir stat + dirents,
// and each file child -> file stat (for its size).
const statMap = new Map<string, any>();
const readdirMap = new Map<string, any[]>();

function dirStat() {
  return { isDirectory: () => true, isFile: () => false, size: 0 };
}
function fileStat(size: number) {
  return { isDirectory: () => false, isFile: () => true, size };
}
function enoent(p: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
  e.code = 'ENOENT';
  return e;
}

// Register a folder that createSnapshot can read.
function setFolder(folderPath: string, entries: Entry[]): void {
  statMap.set(folderPath, dirStat());
  readdirMap.set(
    folderPath,
    entries.map((e) => ({
      name: e.name,
      isFile: () => e.isFile,
      isDirectory: () => !e.isFile,
    }))
  );
  for (const e of entries) {
    if (e.isFile) {
      statMap.set(`${folderPath}/${e.name}`, fileStat(e.size ?? 1));
    }
  }
}

describe('FolderOperationDetector — classification', () => {
  let detector: FolderOperationDetector;

  beforeEach(() => {
    vi.useFakeTimers();
    statMap.clear();
    readdirMap.clear();

    vi.mocked(fsp.stat).mockImplementation(async (p: any) => {
      const s = statMap.get(String(p));
      if (!s) throw enoent(String(p));
      return s;
    });
    vi.mocked(fsp.readdir).mockImplementation(async (p: any) => {
      const d = readdirMap.get(String(p));
      if (!d) throw enoent(String(p));
      return d as any;
    });

    detector = new FolderOperationDetector();
  });

  afterEach(() => {
    detector.clearAllOperations();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // 1. Correct classification of each type
  // ---------------------------------------------------------------------------
  describe('correct classification of each type', () => {
    it("rename: same parent, different name -> 'rename' (reuses folderId, not delete+new)", async () => {
      const onConfirm = vi.fn();
      await detector.onFolderDelete('/root/old', 'folder-id-1', onConfirm);
      setFolder('/root/new', [{ name: 'a.txt', isFile: true, size: 10 }]);

      const result = await detector.onFolderAdd('/root/new');

      expect(result!.type).toBe('rename');
      expect(result!.oldPath).toBe('/root/old');
      expect(result!.newPath).toBe('/root/new');
      // MONEY/HISTORY: the ArFS folderId rides along.
      expect(result!.oldArweaveFolderId).toBe('folder-id-1');

      // The delete side must be cancelled — no confirm even past the window.
      await vi.advanceTimersByTimeAsync(FOLDER_WINDOW_MS + 500);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("move: different parent, same name -> 'move'", async () => {
      await detector.onFolderDelete('/root/docs', 'folder-id-2');
      setFolder('/archive/docs', [{ name: 'x.txt', isFile: true, size: 5 }]);

      const result = await detector.onFolderAdd('/archive/docs');

      expect(result!.type).toBe('move');
      expect(result!.oldPath).toBe('/root/docs');
      expect(result!.newPath).toBe('/archive/docs');
      expect(result!.oldArweaveFolderId).toBe('folder-id-2');
    });

    it("rename_and_move: different parent AND name, BOTH folders empty -> 'rename_and_move'", async () => {
      // The delete snapshot has empty children; only when the NEW folder is
      // also empty does childrenSimilarity([],[]) === 100 clear the >80 bar.
      await detector.onFolderDelete('/root/old', 'folder-id-3');
      setFolder('/archive/renamed', []); // empty

      const result = await detector.onFolderAdd('/archive/renamed');

      expect(result!.type).toBe('rename_and_move');
      expect(result!.oldPath).toBe('/root/old');
      expect(result!.newPath).toBe('/archive/renamed');
      expect(result!.oldArweaveFolderId).toBe('folder-id-3');
    });

    it("delete: no matching add within the window -> 'delete'", async () => {
      const onConfirm = vi.fn();
      await detector.onFolderDelete('/root/trash', 'folder-id-4', onConfirm);

      expect(onConfirm).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(FOLDER_WINDOW_MS + 100);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const cached = detector.getRecentOperation('/root/trash');
      expect(cached?.type).toBe('delete');
      expect(cached?.oldArweaveFolderId).toBe('folder-id-4');
    });

    it("new: add with no pending delete -> 'new'", async () => {
      setFolder('/root/brand-new', [{ name: 'f.txt', isFile: true, size: 1 }]);

      const result = await detector.onFolderAdd('/root/brand-new');

      expect(result!.type).toBe('new');
      expect(result!.newPath).toBe('/root/brand-new');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. The 2-second detection window edge cases
  // ---------------------------------------------------------------------------
  describe('2-second detection window', () => {
    it('add JUST INSIDE the window -> rename', async () => {
      await detector.onFolderDelete('/root/old', 'folder-id-5');
      await vi.advanceTimersByTimeAsync(1500); // still < 2000
      setFolder('/root/new', [{ name: 'a.txt', isFile: true, size: 2 }]);

      const result = await detector.onFolderAdd('/root/new');

      expect(result!.type).toBe('rename');
      expect(result!.oldArweaveFolderId).toBe('folder-id-5');
    });

    it('add JUST OUTSIDE the window -> delete + new (NOT rename)', async () => {
      const onConfirm = vi.fn();
      await detector.onFolderDelete('/root/old', 'folder-id-6', onConfirm);

      await vi.advanceTimersByTimeAsync(FOLDER_WINDOW_MS + 100);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(detector.getRecentOperation('/root/old')?.type).toBe('delete');

      setFolder('/root/new', [{ name: 'a.txt', isFile: true, size: 2 }]);
      const result = await detector.onFolderAdd('/root/new');

      expect(result!.type).toBe('new');
    });

    it('a matched add cancels the pending delete BEFORE its callback fires', async () => {
      const onConfirm = vi.fn();
      await detector.onFolderDelete('/root/old', 'folder-id-7', onConfirm);
      setFolder('/root/new', [{ name: 'a.txt', isFile: true, size: 2 }]);

      await detector.onFolderAdd('/root/new'); // resolves as rename, clears pending

      await vi.advanceTimersByTimeAsync(FOLDER_WINDOW_MS + 500);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Content / similarity boundaries + documented limitations
  // ---------------------------------------------------------------------------
  describe('content boundaries and limitations', () => {
    it('LIMITATION: renamed+moved NON-empty folder -> new (folder identity lost)', async () => {
      // Because the delete snapshot has empty children/contentHash, a folder
      // renamed AND moved that still has contents fails both the contentMatch
      // and the childrenSimilarity>80 test -> classified 'new'. The old ArFS
      // folderId is not carried forward. Flagged to the coordinator.
      await detector.onFolderDelete('/root/old', 'folder-id-8');
      setFolder('/archive/renamed', [{ name: 'keep.txt', isFile: true, size: 3 }]);

      const result = await detector.onFolderAdd('/archive/renamed');

      expect(result!.type).toBe('new');
      expect(result!.oldArweaveFolderId).toBeUndefined();
    });

    it('delete + re-add at the SAME path (same parent AND name) -> new', async () => {
      // No branch handles parentMatch && nameMatch, so an identical-path
      // re-creation is treated as a brand-new folder rather than "unchanged".
      await detector.onFolderDelete('/root/same', 'folder-id-9');
      setFolder('/root/same', [{ name: 'a.txt', isFile: true, size: 1 }]);

      const result = await detector.onFolderAdd('/root/same');

      expect(result!.type).toBe('new');
    });

    it('rename ignores content entirely: totally different contents still -> rename', async () => {
      // Same parent + different name is enough; the (empty) delete snapshot
      // cannot and does not compare contents. Documents the coarse heuristic.
      await detector.onFolderDelete('/root/old', 'folder-id-10');
      setFolder('/root/new', [
        { name: 'completely.txt', isFile: true, size: 111 },
        { name: 'different.txt', isFile: true, size: 222 },
      ]);

      const result = await detector.onFolderAdd('/root/new');

      expect(result!.type).toBe('rename');
      expect(result!.oldArweaveFolderId).toBe('folder-id-10');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Concurrent / cross-matching behavior
  // ---------------------------------------------------------------------------
  describe('concurrent operations', () => {
    it('LIMITATION: a new folder cross-matches the FIRST pending delete in the same parent', async () => {
      // Two folders deleted in the same parent within one window. A single new
      // folder in that parent is paired with whichever delete was recorded
      // first (Map insertion order), because same-parent+different-name always
      // yields 'rename' and onFolderAdd returns on the first non-'new' match.
      // With no content in the delete snapshot the detector cannot tell which
      // folder the new one actually corresponds to. Flagged to the coordinator.
      await detector.onFolderDelete('/root/alpha', 'id-alpha');
      await detector.onFolderDelete('/root/beta', 'id-beta');
      setFolder('/root/gamma', [{ name: 'z.txt', isFile: true, size: 1 }]);

      const result = await detector.onFolderAdd('/root/gamma');

      expect(result!.type).toBe('rename');
      // Attributed to the first-recorded delete, not necessarily the right one.
      expect(result!.oldPath).toBe('/root/alpha');
      expect(result!.oldArweaveFolderId).toBe('id-alpha');
    });

    it('a move in a DIFFERENT parent does not cross-match a same-parent rename candidate', async () => {
      await detector.onFolderDelete('/root/docs', 'id-docs'); // will be moved
      await detector.onFolderDelete('/root/old', 'id-old'); // same-parent rename candidate

      // Add the moved folder first (different parent, same name 'docs').
      setFolder('/archive/docs', [{ name: 'a.txt', isFile: true, size: 1 }]);
      const moved = await detector.onFolderAdd('/archive/docs');

      expect(moved!.type).toBe('move');
      expect(moved!.oldPath).toBe('/root/docs');
      expect(moved!.oldArweaveFolderId).toBe('id-docs');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Money/history-critical + consumer contract
  // ---------------------------------------------------------------------------
  describe('money/history-critical guarantees', () => {
    it('a folder rename is NEVER surfaced as delete + new', async () => {
      const onConfirm = vi.fn();
      await detector.onFolderDelete('/root/Reports', 'folder-id-x', onConfirm);
      setFolder('/root/Reports-2025', [{ name: 'q1.pdf', isFile: true, size: 9 }]);

      const result = await detector.onFolderAdd('/root/Reports-2025');

      expect(result!.type).toBe('rename');
      expect(result!.oldArweaveFolderId).toBe('folder-id-x');
      await vi.advanceTimersByTimeAsync(FOLDER_WINDOW_MS * 2);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(detector.getRecentOperation('/root/Reports')).toBeUndefined();
    });

    it("rename/move detections expose oldPath + oldArweaveFolderId for the consumer", async () => {
      await detector.onFolderDelete('/root/old', 'folder-id-y');
      setFolder('/root/new', []);

      const op: OperationDetection = (await detector.onFolderAdd('/root/new'))!;

      const isMetadataOp =
        (op.type === 'rename' || op.type === 'move' || op.type === 'rename_and_move') &&
        !!op.oldPath &&
        op.oldArweaveFolderId === 'folder-id-y';
      expect(isMetadataOp).toBe(true);
    });
  });
});
