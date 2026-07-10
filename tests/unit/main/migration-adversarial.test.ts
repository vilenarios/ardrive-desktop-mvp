// QA-GATE THROWAWAY PROBE (INFRA-7 verification) — DELETE AFTER GATE RUN.
// @vitest-environment node
//
// Adversarial losslessness: seeds ALL 12 v3 tables on a FILE-BACKED database
// with hostile values (emoji/unicode paths, embedded quotes, newlines,
// NULL-heavy rows, ~1MB TEXT, extreme numbers), migrates with the REAL
// DatabaseManager runner, and deep-compares every row. Also: downgrade
// refusal must leave the file byte-identical (sha256), and two connections
// racing runMigrations must serialize via BEGIN IMMEDIATE without
// double-application or corruption.
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseManager } from '../../../src/main/database-manager';
import { MIGRATIONS } from '../../../src/main/migrations';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test-ardrive') } }));
vi.mock('../../../src/main/profile-manager', () => ({
  profileManager: { getProfileStoragePath: vi.fn(() => '/tmp/test-ardrive/p/db') },
}));
vi.mock('sqlite3', () => ({ Database: vi.fn() }));

const getBuiltinModule: ((id: string) => any) | undefined = (process as any).getBuiltinModule;
const DatabaseSync: any = getBuiltinModule?.call(process, 'node:sqlite')?.DatabaseSync ?? null;

function createShim(engine: any) {
  const shuffle = (params: any, cb: any) =>
    typeof params === 'function' ? { params: [], cb: params } : { params: params ?? [], cb };
  return {
    exec(sql: string, cb?: (err: Error | null) => void) {
      try { engine.exec(sql); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
    run(sql: string, p?: any, c?: any) {
      const { params, cb } = shuffle(p, c);
      try { engine.prepare(sql).run(...params); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
    get(sql: string, p?: any, c?: any) {
      const { params, cb } = shuffle(p, c);
      try { cb?.(null, engine.prepare(sql).get(...params)); } catch (e) { cb?.(e as Error); }
    },
    all(sql: string, p?: any, c?: any) {
      const { params, cb } = shuffle(p, c);
      try { cb?.(null, engine.prepare(sql).all(...params)); } catch (e) { cb?.(e as Error); }
    },
    close(cb?: (err: Error | null) => void) {
      try { engine.close(); cb?.(null); } catch (e) { cb?.(e as Error); }
    },
  };
}

const NASTY_PATH = "C:\\ARDRIVE\\пап ка\\日本語📁\\it's \"quoted\" – naïve.pdf";
const NASTY_NAME = "it's \"quoted\" – naïve 📄🔥.pdf";
const NASTY_TEXT = 'x'.repeat(1024 * 1024) + "…final💥'\"";
const EMOJI_ERR = 'Fehler: Datei konnte nicht geöffnet werden 🚫\nline2\ttabbed';

function seedNasty(engine: any): void {
  const run = (sql: string, ...params: any[]) => engine.prepare(sql).run(...params);
  run(`INSERT INTO drive_mappings (id, driveId, driveName, drivePrivacy, localFolderPath, rootFolderId, isActive, lastSyncTime, excludePatterns, maxFileSize, syncDirection, uploadPriority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    'map-💾', 'drive-1', "Мой 'диск' \"quoted\"", 'private', NASTY_PATH, 'root-1', 1, null, '["*.tmp","塵*"]', 9007199254740991, 'bidirectional', -5);
  run(`INSERT INTO uploads (id, mappingId, driveId, localPath, fileName, fileSize, status, progress, uploadMethod, error) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    'up-1', 'map-💾', null, NASTY_PATH, NASTY_NAME, 0, 'failed', 99.99999, null, EMOJI_ERR);
  run(`INSERT INTO drive_metadata_cache (id, mappingId, fileId, parentFolderId, name, path, type, size, lastModifiedDate, dataTxId, contentType, fileHash, localPath, localFileExists, syncStatus, syncPreference, downloadPriority, lastError) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'meta-1', 'map-💾', 'file-🗂', null, NASTY_NAME, '/фото/日本語', 'file', 1, -1, null, 'application/octet-stream', null, null, 0, 'error', 'auto', 2147483647, EMOJI_ERR);
  run(`INSERT INTO pending_uploads (id, mappingId, localPath, fileName, fileSize, estimatedCost, estimatedTurboCost, hasSufficientTurboBalance, conflictType, metadata) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    'pend-1', 'map-💾', NASTY_PATH, NASTY_NAME, 5242880, 0.000000000001, null, 0, 'none', JSON.stringify({ note: NASTY_TEXT.slice(0, 1000), emoji: '🎯' }));
  run(`INSERT INTO processed_files (fileHash, mappingId, fileName, fileSize, localPath, source, arweaveId) VALUES (?,?,?,?,?,?,?)`,
    'hash-χξς', 'map-💾', NASTY_NAME, 123, NASTY_PATH, 'download', null);
  run(`INSERT INTO file_versions (id, mappingId, fileHash, fileName, filePath, relativePath, fileSize, version, changeType, isLatest) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    'ver-1', 'map-💾', 'hash-χξς', NASTY_NAME, NASTY_PATH, 'rel/päth', 123, 1, 'create', 1);
  run(`INSERT INTO file_operations (id, mappingId, fileHash, operation, fromPath, toPath, metadata) VALUES (?,?,?,?,?,?,?)`,
    'op-1', 'map-💾', 'hash-χξς', 'move', NASTY_PATH, NASTY_PATH + '.bak', NASTY_TEXT);
  run(`INSERT INTO folder_structure (id, mappingId, folderPath, relativePath, parentPath, arfsFolderId, isDeleted) VALUES (?,?,?,?,?,?,?)`,
    'fold-1', 'map-💾', NASTY_PATH, 'rel', null, null, 0);
  run(`INSERT INTO folder_operations (id, mappingId, operationType, oldPath, newPath, status, error) VALUES (?,?,?,?,?,?,?)`,
    'fop-1', 'map-💾', 'rename', NASTY_PATH, null, 'failed', EMOJI_ERR);
  run(`INSERT INTO downloads (id, mappingId, fileName, localPath, fileSize, fileId, status, progress, isCancelled, error) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    'dl-1', 'map-💾', NASTY_NAME, NASTY_PATH, 1048576, 'file-🗂', 'failed', 0.1, 1, EMOJI_ERR);
  run(`INSERT INTO drive_sync_state (drive_id, last_sync_time, total_files) VALUES (?,?,?)`, 'drive-1', null, 0);
  run(`INSERT INTO schema_version (version) VALUES (?)`, 2); // hostile: stray legacy row must survive untouched
}

function dumpAll(engine: any): Record<string, any[]> {
  const tables = engine
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r: any) => r.name as string);
  const out: Record<string, any[]> = {};
  for (const t of tables) out[t] = engine.prepare(`SELECT * FROM ${t}`).all().map((r: any) => ({ ...r }));
  return out;
}

// v5 (SYNC-5) adds an additive `isHidden` column to drive_metadata_cache. It is
// purely additive (default 0) and leaves every existing value untouched, so for
// the losslessness comparison we strip it from the post-migration dump and
// assert its default separately. v6 (D-026) adds a new, empty `sync_state`
// table — also purely additive — so it is dropped from the comparison too.
// v8 (MONEY-17) adds an additive `errorReason` column (default NULL) to uploads;
// strip it the same way.
const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
function stripAddedColumns(dump: Record<string, any[]>): Record<string, any[]> {
  const { sync_state: _syncState, ...rest } = dump;
  return {
    ...rest,
    drive_metadata_cache: (dump.drive_metadata_cache ?? []).map(({ isHidden, ...r }: any) => r),
    uploads: (dump.uploads ?? []).map(({ errorReason, ...r }: any) => r),
  };
}

const sha256 = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

describe.skipIf(!DatabaseSync)('QA gate probe: INFRA-7 adversarial (file-backed, real engine)', () => {
  it('migrates a hostile v3 DB losslessly: all 12 tables, emoji/quotes/NULLs/1MB text survive byte-equal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-infra7-'));
    const dbPath = path.join(dir, 'nasty.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec(MIGRATIONS[0].sql); // v3 schema (verified semantically identical to a483d94 separately)
    seedNasty(seed);
    const before = dumpAll(seed);
    expect(Object.keys(before)).toHaveLength(12);
    expect(Number(seed.prepare('PRAGMA user_version').get().user_version)).toBe(0);
    seed.close();

    const engine = new DatabaseSync(dbPath);
    const dm = new DatabaseManager();
    (dm as any).db = createShim(engine);
    await (dm as any).runMigrations();

    expect(Number(engine.prepare('PRAGMA user_version').get().user_version)).toBe(CURRENT_VERSION);
    const after = dumpAll(engine);
    // Every pre-existing value survives byte-equal (ignoring v5's additive column)
    expect(stripAddedColumns(after)).toEqual(before);
    // ...and the new column defaulted to 0 (not hidden) on the migrated row
    expect(after.drive_metadata_cache.every((r: any) => r.isHidden === 0)).toBe(true);
    expect(after.file_operations[0].metadata).toHaveLength(NASTY_TEXT.length);
    expect(after.schema_version).toEqual([expect.objectContaining({ version: 2 })]);
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('downgrade refusal leaves the database file byte-identical (sha256)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-infra7-'));
    const dbPath = path.join(dir, 'future.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec(MIGRATIONS[0].sql);
    seedNasty(seed);
    seed.exec('PRAGMA user_version = 99');
    seed.close();
    const hashBefore = sha256(dbPath);

    const engine = new DatabaseSync(dbPath);
    const dm = new DatabaseManager();
    (dm as any).db = createShim(engine);
    await expect((dm as any).runMigrations()).rejects.toThrow(/schema version 99/);
    engine.close();

    expect(sha256(dbPath)).toBe(hashBefore);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('two connections racing runMigrations serialize via BEGIN IMMEDIATE: no double-apply, no corruption', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-infra7-'));
    const dbPath = path.join(dir, 'race.db');
    const seed = new DatabaseSync(dbPath);
    seed.exec(MIGRATIONS[0].sql);
    seedNasty(seed);
    const before = dumpAll(seed);
    seed.close();

    const engineA = new DatabaseSync(dbPath);
    const engineB = new DatabaseSync(dbPath);
    const dmA = new DatabaseManager();
    const dmB = new DatabaseManager();
    (dmA as any).db = createShim(engineA);
    (dmB as any).db = createShim(engineB);

    const results = await Promise.allSettled([
      (dmA as any).runMigrations(),
      (dmB as any).runMigrations(),
    ]);

    // At least one must succeed; a loser may fail-closed on the lock (busy)
    const outcomes = results.map((r) => r.status);
    expect(outcomes).toContain('fulfilled');
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(String((r as PromiseRejectedResult).reason)).toMatch(/busy|locked|rolled back/i);
      }
    }

    engineA.close();
    engineB.close();
    const check = new DatabaseSync(dbPath);
    expect(Number(check.prepare('PRAGMA user_version').get().user_version)).toBe(CURRENT_VERSION);
    expect(stripAddedColumns(dumpAll(check))).toEqual(before); // data untouched by the race
    // v4 index exists exactly once
    const idx = check
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='idx_metadata_mapping_sync_status'")
      .get();
    expect(Number(idx.n)).toBe(1);
    check.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
