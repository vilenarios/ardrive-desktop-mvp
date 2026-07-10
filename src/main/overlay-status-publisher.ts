// FEAT-9 Phase 0: platform-agnostic overlay-badge core (D-035 / OVERLAYS-PLAN-2026-07-09 §1).
//
// This module is the shared "spine" both the future Windows (Shell Icon
// Overlay Handler + memory-mapped table) and macOS (Finder Sync extension +
// App Group snapshot) native layers will consume. It intentionally contains
// NO native code and NO Electron-window/webContents concerns beyond reading
// from the DB - it just tracks "what bucket is this file in right now,
// grouped by directory" and hands that to a pluggable `OverlaySink`.
//
// OFF BY DEFAULT (OVERLAYS_ENABLED = false): every public method early-returns
// when disabled, so this module reads nothing from the DB and changes no
// existing behavior until a later phase flips the flag on.

import * as path from 'path';
import { databaseManager } from './database-manager';

/**
 * Feature flag gating the entire publisher. Phase 0 ships this hard-coded
 * `false` - there is no native transport yet, so publishing would be pure
 * overhead. Flip this (or replace with a config/env-driven gate) once a real
 * `OverlaySink` lands in a later phase.
 */
export const OVERLAYS_ENABLED = false;

/** The 7 `syncStatus` values persisted in `drive_metadata_cache`. */
export type DriveSyncStatusValue =
  | 'synced'
  | 'pending'
  | 'downloading'
  | 'queued'
  | 'cloud_only'
  | 'error'
  | 'failed';

/** The 3 badge buckets the native overlay handlers understand. */
export type OverlayBucket = 'synced' | 'syncing' | 'error';

/**
 * Collapses a `drive_metadata_cache.syncStatus` value into the 3 badge
 * buckets (or `null` for "no local badge"). Pure function, no I/O - safe to
 * exhaustively unit test.
 *
 *   synced                          -> 'synced'   (green check)
 *   pending | queued | downloading  -> 'syncing'  (blue spinner)
 *   error | failed                  -> 'error'    (red !)
 *   cloud_only                      -> null       (not on disk, nothing to badge)
 *   anything else (unknown/legacy)  -> null       (fail safe: no badge, not a crash)
 */
export function statusToBucket(status: string | null | undefined): OverlayBucket | null {
  switch (status) {
    case 'synced':
      return 'synced';
    case 'pending':
    case 'queued':
    case 'downloading':
      return 'syncing';
    case 'error':
    case 'failed':
      return 'error';
    case 'cloud_only':
    default:
      return null;
  }
}

/**
 * The slice of DatabaseManager the publisher depends on. Kept narrow (rather
 * than importing the concrete `DatabaseManager` class) so the core stays
 * platform-agnostic and trivially mockable in tests - any object shaped like
 * this (including the real DatabaseManager singleton) works.
 */
export interface OverlayMetadataSource {
  getDriveMetadataByFileId(fileId: string): Promise<{ fileId: string; localPath: string | null; syncStatus: string | null } | null>;
  getAllDriveMetadataWithLocalPath(): Promise<Array<{ fileId: string; localPath: string; syncStatus: string | null }>>;
}

/**
 * Native transport contract. Phase 0 ships only this interface plus a no-op
 * default - the Windows (memory-mapped path->bucket table + SHChangeNotify)
 * and macOS (App-Group snapshot + Darwin notification) sinks implement this
 * in later phases without touching anything above this line.
 */
export interface OverlaySink {
  /** Replace the full known-bucket state for one directory. */
  applyBadges(dirPath: string, entries: Map<string, OverlayBucket>): void;
  /** Drop all published state (shutdown / profile switch / flag disabled). */
  clear(): void;
}

/** Default sink: does nothing. Used whenever no native transport is wired up. */
export class NoopOverlaySink implements OverlaySink {
  // Deliberately ignores its arguments - fewer params than the interface
  // declares is a valid implementation in TS/JS (callers never rely on arity).
  applyBadges(): void {
    // Intentionally inert - Phase 0 has no native transport.
  }
  clear(): void {
    // Intentionally inert.
  }
}

/** Debounce window for coalescing repaint notifications (150-300ms range). */
const DEFAULT_DEBOUNCE_MS = 200;

export interface OverlayStatusPublisherOptions {
  /** Native transport; defaults to `NoopOverlaySink` (Phase 0 has none). */
  sink?: OverlaySink;
  /** Debounce window in ms for coalescing repaint notifications. */
  debounceMs?: number;
  /** Overrides `OVERLAYS_ENABLED` - primarily for tests. */
  enabled?: boolean;
}

/**
 * Platform-agnostic overlay-badge state manager.
 *
 * Maintains an in-memory `dirPath -> Map<filePath, bucket>` snapshot fed by
 * `updateFileStatus` (called from the same sites that emit
 * `sync:file-state-changed`) and seeded on startup/profile-switch by
 * `hydrateFromDb`. Notifies the configured `OverlaySink` of touched
 * directories, debounced so a full-drive sync doesn't thrash native repaints.
 */
export class OverlayStatusPublisher {
  private readonly db: OverlayMetadataSource;
  private readonly sink: OverlaySink;
  private readonly debounceMs: number;
  private readonly enabled: boolean;

  // dirPath -> (filePath -> bucket). This is the full published snapshot.
  private snapshot = new Map<string, Map<string, OverlayBucket>>();
  // filePath -> dirPath index, so a status update can find (and clear) a
  // file's previous directory without scanning the whole snapshot.
  private pathIndex = new Map<string, string>();

  // Directories touched since the last flush, and the pending debounce timer.
  private pendingDirs = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(db: OverlayMetadataSource, options: OverlayStatusPublisherOptions = {}) {
    this.db = db;
    this.sink = options.sink ?? new NoopOverlaySink();
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.enabled = options.enabled ?? OVERLAYS_ENABLED;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Seeds the in-memory snapshot from `drive_metadata_cache`. Call once on
   * app start (after the active profile's DB is open) and again on every
   * profile switch (a fresh DB connection means a fresh set of files).
   *
   * No-op (including no DB read) when the flag is off.
   */
  async hydrateFromDb(): Promise<void> {
    if (!this.enabled) return;

    this.snapshot.clear();
    this.pathIndex.clear();

    const rows = await this.db.getAllDriveMetadataWithLocalPath();
    const touchedDirs = new Set<string>();
    for (const row of rows) {
      if (!row.localPath) continue; // defensive; query already filters this
      const dirPath = this.setPath(row.localPath, statusToBucket(row.syncStatus));
      touchedDirs.add(dirPath);
    }
    this.scheduleFlush(touchedDirs);
  }

  /**
   * Called from the same sites that emit `sync:file-state-changed`. Resolves
   * `fileId -> localPath` via the DB and updates the snapshot accordingly.
   * A missing row or null/empty `localPath` is skipped silently - e.g.
   * `cloud_only` files, or a fileId not yet cached - never throws.
   *
   * No-op (including no DB read) when the flag is off.
   */
  async updateFileStatus(fileId: string, syncStatus: string | null | undefined): Promise<void> {
    if (!this.enabled) return;

    const row = await this.db.getDriveMetadataByFileId(fileId);
    const localPath = row?.localPath;
    if (!localPath) return; // nothing on disk to badge

    const bucket = statusToBucket(syncStatus ?? row?.syncStatus);
    const dirPath = this.setPath(localPath, bucket);
    this.scheduleFlush([dirPath]);
  }

  /** Pull-model accessor for a single path (e.g. context-menu "sync status"). */
  getBucketForPath(filePath: string): OverlayBucket | null {
    const dirPath = path.dirname(filePath);
    return this.snapshot.get(dirPath)?.get(filePath) ?? null;
  }

  /** Read-only view of a directory's current published entries (mainly for tests). */
  getDirEntries(dirPath: string): Map<string, OverlayBucket> {
    return new Map(this.snapshot.get(dirPath) ?? []);
  }

  /** Tears down the debounce timer and clears all published state. */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.snapshot.clear();
    this.pathIndex.clear();
    this.pendingDirs.clear();
    this.sink.clear();
  }

  // -- internal --

  /**
   * Sets (or clears, when bucket is null) one file's entry in the snapshot,
   * moving it between directory buckets if its directory changed since the
   * last update. Returns the file's current directory.
   */
  private setPath(filePath: string, bucket: OverlayBucket | null): string {
    const dirPath = path.dirname(filePath);
    const previousDir = this.pathIndex.get(filePath);

    if (previousDir && previousDir !== dirPath) {
      const oldDirMap = this.snapshot.get(previousDir);
      oldDirMap?.delete(filePath);
      if (oldDirMap && oldDirMap.size === 0) {
        this.snapshot.delete(previousDir);
      }
      this.pendingDirs.add(previousDir);
    }

    if (bucket === null) {
      const dirMap = this.snapshot.get(dirPath);
      dirMap?.delete(filePath);
      if (dirMap && dirMap.size === 0) {
        this.snapshot.delete(dirPath);
      }
      this.pathIndex.delete(filePath);
    } else {
      let dirMap = this.snapshot.get(dirPath);
      if (!dirMap) {
        dirMap = new Map();
        this.snapshot.set(dirPath, dirMap);
      }
      dirMap.set(filePath, bucket);
      this.pathIndex.set(filePath, dirPath);
    }

    return dirPath;
  }

  private scheduleFlush(dirPaths: Iterable<string>): void {
    for (const d of dirPaths) {
      this.pendingDirs.add(d);
    }
    if (this.pendingDirs.size === 0) return;
    if (this.debounceTimer) return; // already coalescing a burst

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    const dirs = Array.from(this.pendingDirs);
    this.pendingDirs.clear();
    for (const dirPath of dirs) {
      const entries = this.snapshot.get(dirPath) ?? new Map<string, OverlayBucket>();
      this.sink.applyBadges(dirPath, entries);
    }
  }
}

// Module-level singleton, mirroring the existing `databaseManager` /
// `turboManager` / `arnsService` pattern in this codebase. Wired directly into
// `databaseManager` and constructed with the default (disabled) flag, a
// no-op sink, so every call site below (main.ts's two emit sites plus
// DownloadManager's central `emitFileStateChange`) can import this single
// instance without threading a publisher through SyncManager/DownloadManager
// constructors. Cheap to construct (no I/O) even when disabled.
export const overlayStatusPublisher = new OverlayStatusPublisher(databaseManager);
