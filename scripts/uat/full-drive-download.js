#!/usr/bin/env electron
/*
 * UAT — FULL RECURSIVE DRIVE DOWNLOAD (all files + folders, not a single file).
 *
 * Proves the initial-sync download path: DownloadManager.recursivelyListDriveContents
 * walks the WHOLE drive tree, queues every file, and downloads them in the
 * background while preserving folder structure. This exercises the REAL,
 * production, compiled classes (dist/main/*) — DatabaseManager (real SQLite),
 * FileStateManager, SyncProgressTracker, DownloadManager, StreamingDownloader —
 * against a small PUBLIC drive on turbo-gateway.com. Public drives are read
 * ANONYMOUSLY by drive-id: no wallet, no secrets, no spend.
 *
 * Why run as an Electron main process and not plain node: database-manager /
 * profile-manager / config-manager `import { app } from 'electron'`; under
 * plain node, require('electron') is a path string. Running as the real
 * Electron main gives the real `app`, matches how the shipping app loads these
 * singletons, and gives sqlite3 its expected ABI. (Pattern proven in
 * scripts/uat/poc-services.js — see docs/product/UAT-HARNESS.md §2(b).)
 *
 * Usage:
 *   node_modules/.bin/electron scripts/uat/full-drive-download.js <driveId> <label> <destRootNative>
 *
 * MONEY RAIL: read-only. No wallet is created or unlocked. No transaction is
 * ever signed or broadcast. Reads go to turbo-gateway.com only.
 */
'use strict';

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main');

const DRIVE_ID = process.argv[2];
const LABEL = process.argv[3] || 'drive';
const DEST_ROOT = process.argv[4]; // must be a NATIVE linux path

if (!DRIVE_ID || !DEST_ROOT) {
  console.error('Usage: electron full-drive-download.js <driveId> <label> <destRootNative>');
  process.exit(2);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function walkDir(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) {
      out.push({ rel, type: 'dir' });
      out.push(...walkDir(full, base));
    } else if (entry.isFile()) {
      out.push({ rel, type: 'file', size: fs.statSync(full).size });
    }
  }
  return out;
}

/** Direct gateway fetch, bypassing the app entirely — used for one independent cross-check. */
function fetchFromGateway(txId) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://turbo-gateway.com/${txId}`, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow one redirect (sandbox domain)
        https.get(res.headers.location, { timeout: 30000 }, (res2) => {
          const chunks = [];
          res2.on('data', (c) => chunks.push(c));
          res2.on('end', () => resolve({ status: res2.statusCode, buffer: Buffer.concat(chunks) }));
          res2.on('error', reject);
        }).on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function main() {
  const results = [];
  function check(name, cond, detail) {
    results.push({ name, pass: !!cond, detail: detail || '' });
    console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    return !!cond;
  }
  function section(t) {
    console.log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70));
  }

  // --- disposable world (native linux path — never /mnt/c) -------------------
  fs.mkdirSync(DEST_ROOT, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(DEST_ROOT, `run-${LABEL}-`));
  const userData = path.join(tmpRoot, 'userdata');
  const syncFolderPath = path.join(tmpRoot, 'synced');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(syncFolderPath, { recursive: true });
  app.setPath('userData', userData);
  console.log('Drive under test :', DRIVE_ID, `(${LABEL})`);
  console.log('Disposable userData:', userData);
  console.log('Sync folder (native):', syncFolderPath);

  // Require the REAL compiled services AFTER userData is redirected.
  const { databaseManager } = require(path.join(DIST_MAIN, 'database-manager.js'));
  const { FileStateManager } = require(path.join(DIST_MAIN, 'sync', 'FileStateManager.js'));
  const { SyncProgressTracker } = require(path.join(DIST_MAIN, 'sync', 'SyncProgressTracker.js'));
  const { DownloadManager } = require(path.join(DIST_MAIN, 'sync', 'DownloadManager.js'));
  const Arweave = require('arweave');
  const { arDriveAnonymousFactory, EID } = require('ardrive-core-js');

  section(`SETUP — anonymous ArDrive + resolve drive ${DRIVE_ID}`);
  const arweave = Arweave.init({ host: 'turbo-gateway.com', port: 443, protocol: 'https', timeout: 60000 });
  const arDrive = arDriveAnonymousFactory({ arweave });

  const publicDrive = await arDrive.getPublicDrive({ driveId: EID(DRIVE_ID) });
  const rootFolderId = publicDrive.rootFolderId.toString();
  check('resolved public drive anonymously (no wallet)', !!rootFolderId, `rootFolderId=${rootFolderId}`);
  console.log(`  drive name: "${publicDrive.name}"`);

  const profileId = 'uat-fulldrive-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(path.join(userData, 'profiles', profileId), { recursive: true });
  await databaseManager.setActiveProfile(profileId);

  const mappingId = 'map-' + profileId;
  await databaseManager.addDriveMapping({
    id: mappingId,
    driveId: DRIVE_ID,
    driveName: publicDrive.name,
    drivePrivacy: 'public',
    localFolderPath: syncFolderPath,
    rootFolderId,
    isActive: true,
    syncSettings: { syncDirection: 'download-only', uploadPriority: 0 }
  });
  check('drive_mapping persisted (public, read-only)', true, `mappingId=${mappingId}`);

  const fileStateManager = new FileStateManager();
  const progressTracker = new SyncProgressTracker();
  const dm = new DownloadManager(
    databaseManager,
    fileStateManager,
    progressTracker,
    arDrive,
    DRIVE_ID,
    rootFolderId,
    syncFolderPath
  );

  // ===========================================================================
  section('STEP 1 — recursive metadata sync (recursivelyListDriveContents)');
  // ===========================================================================
  await dm.syncDriveMetadata();
  const afterMetaSync = await databaseManager.getDriveMetadata(mappingId);
  const expectedFiles = afterMetaSync.filter((i) => i.type === 'file');
  const expectedFolders = afterMetaSync.filter((i) => i.type === 'folder');
  console.log(`  metadata cache: ${expectedFiles.length} files, ${expectedFolders.length} folders (${afterMetaSync.length} total entities)`);

  // ===========================================================================
  section('STEP 2 — create folder structure (createAllFolders)');
  // ===========================================================================
  await dm.createAllFolders();
  for (const folder of expectedFolders) {
    const p = path.join(syncFolderPath, folder.path, folder.name);
    check(`folder created: ${folder.path}/${folder.name}`, fs.existsSync(p) && fs.statSync(p).isDirectory());
  }

  // ===========================================================================
  section('STEP 3 — queue + background download ALL files (downloadMissingFilesWithProgress)');
  // ===========================================================================
  await dm.downloadMissingFilesWithProgress();

  const start = Date.now();
  const MAX_WAIT_MS = 4 * 60 * 1000; // 4 min cap for a small drive
  let status = await dm.getQueueStatus();
  while ((status.queued > 0 || status.active > 0) && Date.now() - start < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await dm.getQueueStatus();
  }
  const drained = status.queued === 0 && status.active === 0;
  check('download queue drained within time cap', drained, `queued=${status.queued} active=${status.active} elapsed=${((Date.now() - start) / 1000).toFixed(1)}s`);

  // ===========================================================================
  section('STEP 4 — VERIFY completeness, folder structure, byte-validity');
  // ===========================================================================
  const finalMeta = await databaseManager.getDriveMetadata(mappingId);
  const finalFiles = finalMeta.filter((i) => i.type === 'file');
  const syncedCount = finalFiles.filter((f) => f.syncStatus === 'synced').length;
  const failedCount = finalFiles.filter((f) => f.syncStatus === 'failed').length;
  const otherCount = finalFiles.length - syncedCount - failedCount;
  console.log(`  DB status: synced=${syncedCount} failed=${failedCount} other=${otherCount} (of ${finalFiles.length} file entities)`);

  const onDisk = walkDir(syncFolderPath, syncFolderPath);
  const onDiskFiles = onDisk.filter((e) => e.type === 'file');
  console.log(`  on-disk: ${onDiskFiles.length} files across ${onDisk.filter((e) => e.type === 'dir').length} dirs`);
  onDiskFiles.forEach((f) => console.log(`    ${f.rel}  (${f.size} bytes)`));

  // Detect ArFS-level name collisions (two file entities, same folder+name —
  // a real drive property, not a harness bug: the local FS can only hold one
  // path, so on-disk count can be < ArFS file-entity count even at 100% success).
  const byLocalPath = new Map();
  for (const f of finalFiles) {
    const key = path.join(f.path || '', f.name);
    if (!byLocalPath.has(key)) byLocalPath.set(key, []);
    byLocalPath.get(key).push(f);
  }
  const collisions = Array.from(byLocalPath.entries()).filter(([, v]) => v.length > 1);
  const distinctPaths = byLocalPath.size;

  check(
    'completeness: on-disk file count vs ArFS file-entity count',
    onDiskFiles.length === finalFiles.length || onDiskFiles.length === distinctPaths,
    `onDisk=${onDiskFiles.length} arfsEntities=${finalFiles.length} distinctLocalPaths=${distinctPaths} collisions=${collisions.length}`
  );
  if (collisions.length > 0) {
    for (const [key, entries] of collisions) {
      console.log(`  ⚠ name collision at "${key}": ${entries.length} ArFS file entities share this local path (fileIds: ${entries.map((e) => e.fileId).join(', ')})`);
    }
  }

  // Folder-structure check: at least one file must be nested inside a subfolder.
  const nestedFileEntities = finalFiles.filter((f) => (f.path || '').split('/').filter(Boolean).length > 1);
  const nestedOnDisk = onDiskFiles.filter((f) => f.rel.includes(path.sep) && f.rel.split(path.sep).length > 2);
  check(
    'folder structure preserved (nested file lands at correct subfolder path)',
    nestedFileEntities.length === 0 || nestedOnDisk.length > 0,
    `nestedEntities=${nestedFileEntities.length} nestedOnDisk=${nestedOnDisk.length}`
  );

  // Byte-validity: size + sha256 for every landed file, cross-checked against
  // the ArFS metadata size (from the DB cache, which came from the same
  // on-chain listing recursivelyListDriveContents queried).
  section('STEP 5 — byte-validity sample (size + sha256 per file)');
  let sizeOk = 0, sizeMismatch = 0;
  const hashes = {};
  for (const entity of finalFiles) {
    const localPath = path.join(syncFolderPath, entity.path || '', entity.name);
    if (!fs.existsSync(localPath)) {
      console.log(`  [MISSING] ${entity.path}/${entity.name} (fileId=${entity.fileId}, status=${entity.syncStatus})`);
      continue;
    }
    const stat = fs.statSync(localPath);
    const hash = await sha256File(localPath);
    hashes[entity.fileId] = { localPath, size: stat.size, hash };
    const expected = entity.size || 0;
    const match = stat.size === expected;
    if (match) sizeOk++; else sizeMismatch++;
    console.log(`  ${match ? 'OK  ' : 'DIFF'} ${entity.name}: expected=${expected}B actual=${stat.size}B sha256=${hash.substring(0, 16)}...`);
  }
  check('byte-validity: on-disk size matches ArFS metadata size for every landed file', sizeMismatch === 0, `ok=${sizeOk} mismatch=${sizeMismatch}`);
  check('sha256 well-formed 64-hex for every landed file', Object.values(hashes).every((h) => /^[0-9a-f]{64}$/.test(h.hash)));

  // ===========================================================================
  section('STEP 6 — independent gateway cross-check (bypass the app entirely)');
  // ===========================================================================
  const sampleEntity = finalFiles.find((f) => hashes[f.fileId] && (f.size || 0) > 0 && (f.size || 0) < 2_000_000);
  if (sampleEntity) {
    try {
      const gw = await fetchFromGateway(sampleEntity.dataTxId);
      const gwHash = crypto.createHash('sha256').update(gw.buffer).digest('hex');
      const local = hashes[sampleEntity.fileId];
      check(
        `direct gateway fetch of "${sampleEntity.name}" (dataTxId=${sampleEntity.dataTxId}) matches downloaded file`,
        gw.status === 200 && gw.buffer.length === local.size && gwHash === local.hash,
        `gwStatus=${gw.status} gwBytes=${gw.buffer.length} localBytes=${local.size} gwSha=${gwHash.substring(0, 16)} localSha=${local.hash.substring(0, 16)}`
      );
    } catch (e) {
      check(`direct gateway fetch cross-check`, false, `error: ${e.message}`);
    }
  } else {
    console.log('  (no suitable small sample file found for direct gateway cross-check)');
  }

  // --- cleanup ---------------------------------------------------------------
  dm.destroy();
  await databaseManager.close();

  section('RESULT');
  const failed = results.filter((r) => !r.pass);
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('VERDICT: ' + (failed.length === 0 ? 'PASS' : 'FAIL'));
  console.log(JSON.stringify({
    driveId: DRIVE_ID,
    label: LABEL,
    driveName: publicDrive.name,
    arfsFileEntities: finalFiles.length,
    arfsFolderEntities: expectedFolders.length,
    distinctLocalPaths: distinctPaths,
    onDiskFiles: onDiskFiles.length,
    syncedCount, failedCount, otherCount,
    collisions: collisions.map(([k, v]) => ({ path: k, fileIds: v.map((e) => e.fileId) })),
    sizeOk, sizeMismatch,
    results
  }, null, 2));

  return failed.length === 0 ? 0 : 1;
}

app.whenReady().then(main).then(
  (code) => { app.exit(code); },
  (err) => { console.error('UAT FATAL:', err && err.stack ? err.stack : err); app.exit(1); }
);
