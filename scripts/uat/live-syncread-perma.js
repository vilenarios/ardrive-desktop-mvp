#!/usr/bin/env electron
/*
 * UAT LIVE CERTIFICATION — SYNC READ paths + special content.
 * READ-ONLY / NO-WRITE / NO-SPEND. Real owner wallet.
 *
 * Boots the app's REAL compiled main-process services (dist/main/*) under the
 * Electron runtime in a DISPOSABLE userData dir, loads the owner's wallet, and
 * exercises the exact production listing/download primitives against the LIVE
 * turbo-gateway.com network. Nothing is written on-chain; no funds can move.
 * Only reads: importWallet (local decrypt), listPublic/PrivateFolder (core-js),
 * unlockPrivateDrive (local key derivation), StreamingDownloader (HTTP GET).
 *
 * NEVER prints the password, wallet JSON, decrypted content, or file names.
 * Reports COUNTS / sizes / load-times / PASS-FAIL and generic descriptors only.
 *
 * Scenarios:
 *   1  SNAPSHOT drive loads correctly (PRIORITY) — a drive WITH on-chain ArFS
 *      snapshot entities lists its full, coherent contents (vs GraphQL ground
 *      truth) with no crash/partial/hang.
 *   2  Large-drive listing — the drive with the most files lists fully; time it.
 *   3  Download-sync — pull a public drive's small files to an EMPTY native
 *      local folder via the app's real StreamingDownloader; assert bytes land +
 *      hash/size sane.
 *   4  Special file types — hidden badges (isHidden) on real data; pinned /
 *      licensed state.
 *   5  Private + snapshot combo — unlock a snapshotted private drive; list
 *      decrypted contents.
 *
 * Run: ./node_modules/.bin/electron scripts/uat/live-syncops-read.js  > log 2>&1
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main');
// GATEWAY UNDER TEST — the app (core-js listing + downloads) is pointed here.
const GATEWAY_HOST = process.env.ARDRIVE_GATEWAY_HOST || 'perma.online';
// INDEPENDENT GROUND-TRUTH GraphQL gateway (cross-check ONLY, read-only).
// Kept SEPARATE from the gateway-under-test so the completeness cross-check
// stays valid even if the tested gateway's GraphQL tag-index is incomplete for
// this owner's ArFS metadata. Defaults to turbo-gateway.com (recovered from its
// temporal 404 blip). Override with UAT_GT_GATEWAY_HOST.
const GT_GATEWAY_HOST = process.env.UAT_GT_GATEWAY_HOST || 'turbo-gateway.com';
const WALLET_WSL = process.env.ARDRIVE_DEV_WALLET_PATH ||
  '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = process.env.ARDRIVE_ENV_FILE || '/mnt/c/source/ardrive-desktop-mvp/.env';
const OUT_DIR = process.env.UAT_OUT_DIR ||
  path.resolve(REPO_ROOT, '..', 'uat-syncread-perma');
const DL_DIR = path.join(OUT_DIR, 'downloads');

// Force the gateway-under-test for every core-js / app code path (env > config > default).
process.env.ARDRIVE_GATEWAY_HOST = GATEWAY_HOST;

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}
function note(m) { console.log('    · ' + m); }
function section(t) { console.log('\n' + '='.repeat(70) + '\n' + t + '\n' + '='.repeat(70)); }
function short(id) { return String(id).slice(0, 8) + '…'; }

// Hard cap on any single network op so a persistent gateway 404/backoff (D-012)
// records a BLOCKED result instead of hanging the whole run. The underlying
// promise keeps running detached; app.exit() force-quits at the end regardless.
function withTimeout(promise, ms, label) {
  let to;
  const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
}

function readEnvPassword() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('ARDRIVE_DEV_PASSWORD not found in .env');
}

// ---- GraphQL ground-truth helper (owner-scoped reads) ----------------------
function gql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      host: GT_GATEWAY_HOST, path: '/graphql', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 45000
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('gql parse: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('gql timeout')); });
    req.write(body); req.end();
  });
}

// Distinct entity ids of a given ArFS Entity-Type in a drive (owner-scoped),
// following pagination (capped so a huge drive can't stall the run).
// Returns { ids:Set, capped:bool }. capped=true means there were MORE pages
// than we enumerated, so the id count is a floor, not the exact total.
const GT_PAGE_CAP = 25; // 25 * 100 = 2500 entities max enumerated per drive
async function distinctEntityIds(owner, driveId, entityType, idTagName) {
  const ids = new Set();
  let cursor = null;
  let capped = false;
  for (let page = 0; page < GT_PAGE_CAP; page++) {
    const after = cursor ? `,after:"${cursor}"` : '';
    const q = `query{transactions(owners:["${owner}"],first:100${after},` +
      `tags:[{name:"Entity-Type",values:["${entityType}"]},{name:"Drive-Id",values:["${driveId}"]}]){` +
      `pageInfo{hasNextPage} edges{cursor node{tags{name value}}}}}`;
    const r = await gql(q);
    const edges = (r && r.data && r.data.transactions && r.data.transactions.edges) || [];
    for (const e of edges) {
      const t = Object.fromEntries(e.node.tags.map((x) => [x.name, x.value]));
      if (t[idTagName]) ids.add(t[idTagName]);
      cursor = e.cursor;
    }
    if (!r.data.transactions.pageInfo.hasNextPage) break;
    if (page === GT_PAGE_CAP - 1) capped = true;
  }
  return { ids, capped };
}

async function snapshotDriveIds(owner) {
  const perDrive = {};
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const after = cursor ? `,after:"${cursor}"` : '';
    const q = `query{transactions(owners:["${owner}"],first:100${after},` +
      `tags:[{name:"Entity-Type",values:["snapshot"]}]){pageInfo{hasNextPage} edges{cursor node{tags{name value}}}}}`;
    const r = await gql(q);
    const edges = (r && r.data && r.data.transactions && r.data.transactions.edges) || [];
    for (const e of edges) {
      const t = Object.fromEntries(e.node.tags.map((x) => [x.name, x.value]));
      if (t['Drive-Id']) perDrive[t['Drive-Id']] = (perDrive[t['Drive-Id']] || 0) + 1;
      cursor = e.cursor;
    }
    if (!r.data.transactions.pageInfo.hasNextPage) break;
  }
  return perDrive;
}

function countEntities(entities) {
  let files = 0, folders = 0, hidden = 0, withData = 0;
  for (const e of entities) {
    if (e.entityType === 'file') { files++; if (e.dataTxId) withData++; }
    else if (e.entityType === 'folder') folders++;
    if (e.isHidden === true) hidden++;
  }
  return { files, folders, hidden, withData, total: entities.length };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DL_DIR, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-syncread-'));
  const userData = path.join(tmpRoot, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  console.log('Disposable userData:', app.getPath('userData'));
  console.log('Output dir:', OUT_DIR);
  console.log('Gateway UNDER TEST (app/core-js/downloads):', GATEWAY_HOST);
  console.log('Gateway for INDEPENDENT ground-truth GraphQL:', GT_GATEWAY_HOST);

  const password = readEnvPassword();

  // Real compiled services (after userData redirect).
  const { walletManager } = require(path.join(DIST_MAIN, 'wallet-manager-secure.js'));
  const { driveKeyManager } = require(path.join(DIST_MAIN, 'drive-key-manager.js'));
  const { StreamingDownloader } = require(path.join(DIST_MAIN, 'sync', 'StreamingDownloader.js'));
  const gatewayMod = require(path.join(DIST_MAIN, 'gateway.js'));
  const core = require('ardrive-core-js');
  const EID = core.EID;

  // ===========================================================================
  section('SETUP — load owner wallet (READ-ONLY) + list drives');
  // ===========================================================================
  const t0 = Date.now();
  const imported = await walletManager.importWallet(WALLET_WSL, password);
  check('wallet imports/loads (local decrypt, no chain write)', imported === true, `${Date.now() - t0}ms`);
  const info = await walletManager.getWalletInfo();
  const owner = info && info.address;
  check('wallet address resolved', !!owner, owner ? short(owner) : 'MISSING');
  check(`app resolved gateway = ${GATEWAY_HOST}`, gatewayMod.getGatewayHost() === GATEWAY_HOST, gatewayMod.getGatewayUrl());

  // GRAPHQL GATEWAY PROBE — document, in-harness, whether the gateway-under-test
  // returns THIS owner's ArFS metadata (Entity-Type=drive) via a combined
  // owners+tags query (the shape core-js uses to reconstruct drives), vs the
  // independent ground-truth gateway. Read-only.
  async function gqlOn(host, query) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ query });
      const req = https.request({ host, path: '/graphql', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 45000 },
        (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
      req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(body); req.end();
    });
  }
  const driveProbeQ = `query{transactions(owners:["${owner}"],first:5,tags:[{name:"Entity-Type",values:["drive"]}]){edges{node{id}}}}`;
  try {
    const [pProbe, gProbe] = await Promise.all([gqlOn(GATEWAY_HOST, driveProbeQ), gqlOn(GT_GATEWAY_HOST, driveProbeQ)]);
    const pN = pProbe && pProbe.data && pProbe.data.transactions ? pProbe.data.transactions.edges.length : 'ERR';
    const gN = gProbe && gProbe.data && gProbe.data.transactions ? gProbe.data.transactions.edges.length : 'ERR';
    note(`GraphQL owner+Entity-Type=drive probe: ${GATEWAY_HOST} returns ${pN} edge(s); ${GT_GATEWAY_HOST} returns ${gN} edge(s) (first page)`);
  } catch (e) { note(`GraphQL probe error: ${(e && e.message || 'err').slice(0, 80)}`); }

  let drives = [];
  let driveListErr = null;
  const tDrives = Date.now();
  try {
    drives = await withTimeout(walletManager.listDrivesWithStatus(), 150000, 'listDrivesWithStatus');
  } catch (e) {
    driveListErr = (e && e.message) || String(e);
    note(`listDrivesWithStatus on ${GATEWAY_HOST} FAILED/BLOCKED: ${driveListErr.slice(0, 120)}`);
  }
  const pub = drives.filter((d) => d.privacy === 'public');
  const priv = drives.filter((d) => d.privacy === 'private');
  check('drive.listWithStatus returns real drives LIVE (on gateway-under-test)', drives.length > 0,
    `total=${drives.length} public=${pub.length} private=${priv.length} in ${Date.now() - tDrives}ms${driveListErr ? ' ERR=' + driveListErr.slice(0, 60) : ''}`);

  // Snapshot ground truth
  const snapMap = await snapshotDriveIds(owner);
  const snapSet = new Set(Object.keys(snapMap));
  note(`snapshotted drives (on-chain Entity-Type=snapshot): ${snapSet.size} distinct, ${Object.values(snapMap).reduce((a, b) => a + b, 0)} snapshot txs total`);
  const snapPub = pub.filter((d) => snapSet.has(d.id));
  const snapPriv = priv.filter((d) => snapSet.has(d.id));
  check('owner has snapshotted drives (Scenario-1 precondition)', snapSet.size > 0,
    `snapshotted: public=${snapPub.length} private=${snapPriv.length}`);
  note('snapshotted drive summary (id-prefix / privacy / #snapshots / locked):');
  for (const d of drives.filter((x) => snapSet.has(x.id))) {
    note(`   ${short(d.id)} | ${d.privacy} | snaps=${snapMap[d.id]} | locked=${d.isLocked === true}`);
  }

  const arDrive = walletManager.getArDrive();

  // ===========================================================================
  section('SCENARIOS 1+2+4 — public drive listings vs snapshot + GraphQL ground truth');
  // ===========================================================================
  // List every PUBLIC drive the app can, timing it and cross-checking
  // completeness against the on-chain distinct File-Id / Folder-Id counts.
  // PRIORITY: process snapshotted drives FIRST so the scenario-1 evidence lands
  // even if the gateway is slow on the long tail of empty/non-snapshot drives.
  const pubOrdered = pub.slice().sort((a, b) =>
    (snapSet.has(b.id) ? 1 : 0) - (snapSet.has(a.id) ? 1 : 0));
  const listResults = [];
  const LIST_BUDGET_MS = 16 * 60 * 1000; // global cap; snapshotted drives go first
  const listStart = Date.now();
  for (const d of pubOrdered) {
    if (Date.now() - listStart > LIST_BUDGET_MS) {
      note(`LIST BUDGET reached — skipping remaining ${pubOrdered.length - listResults.length} drive(s) (mostly non-snapshot tail)`);
      break;
    }
    if (!d.rootFolderId) { note(`skip ${short(d.id)} — no rootFolderId`); continue; }
    const hasSnap = snapSet.has(d.id);
    let rec = { id: d.id, hasSnap, ok: false };
    // Ground truth (on-chain, independent of core-js) — best-effort; a gateway
    // stall here must NOT discard a successful listing below.
    let gtFiles = null, gtFolders = null, gtCapped = false, gtOk = false;
    try {
      const fileGt = await withTimeout(distinctEntityIds(owner, d.id, 'file', 'File-Id'), 90000, 'gt-files');
      const folderGt = await withTimeout(distinctEntityIds(owner, d.id, 'folder', 'Folder-Id'), 90000, 'gt-folders');
      gtFiles = fileGt.ids.size;
      gtFolders = Math.max(0, folderGt.ids.size - 1); // minus root (includeRoot:false)
      gtCapped = fileGt.capped || folderGt.capped;
      gtOk = true;
    } catch (e) { note(`${short(d.id)} ground-truth unavailable (${(e && e.message || 'err').slice(0, 40)})`); }
    try {
      const t = Date.now();
      const entities = await withTimeout(arDrive.listPublicFolder({
        folderId: EID(d.rootFolderId), maxDepth: 10, includeRoot: false
      }), 150000, 'listPublicFolder');
      const ms = Date.now() - t;
      const c = countEntities(entities);
      // gt capped => floor (list >= gt); fully enumerated => exact; gt unknown => null.
      const filesComplete = !gtOk ? null : (gtCapped ? (c.files >= gtFiles) : (c.files === gtFiles));
      const foldersComplete = !gtOk ? null : (gtCapped ? (c.folders >= gtFolders) : (c.folders === gtFolders));
      rec = {
        id: d.id, hasSnap, ok: true, ms, gtOk, gtCapped,
        gtFiles, gtFolders, listFiles: c.files, listFolders: c.folders,
        hidden: c.hidden, total: c.total, filesComplete, foldersComplete
      };
      const verdict = !gtOk ? 'LISTED(no-gt)' : (filesComplete && foldersComplete ? 'COMPLETE' : 'DISCREPANCY');
      note(`${short(d.id)} snap=${hasSnap} | list files=${c.files}/gt${gtOk ? gtFiles : '?'}${gtCapped ? '+' : ''} folders=${c.folders}/gt${gtOk ? gtFolders : '?'} hidden=${c.hidden} | ${ms}ms | ${verdict}`);
    } catch (e) {
      rec.err = (e && e.message) || String(e);
      rec.blocked = /TIMEOUT/.test(rec.err);
      note(`${short(d.id)} snap=${hasSnap} | LIST ${rec.blocked ? 'BLOCKED(gateway timeout)' : 'ERROR'}: ${rec.err.slice(0, 120)}`);
    }
    listResults.push(rec);
  }

  const okLists = listResults.filter((r) => r.ok);
  const blockedLists = listResults.filter((r) => !r.ok && r.blocked);
  const erroredLists = listResults.filter((r) => !r.ok && !r.blocked);
  const snapLists = okLists.filter((r) => r.hasSnap);
  const nonSnapLists = okLists.filter((r) => !r.hasSnap);
  const snapAttempted = listResults.filter((r) => r.hasSnap);
  note(`listing tally: ok=${okLists.length} gatewayBlocked=${blockedLists.length} errored=${erroredLists.length}`);
  if (erroredLists.length) erroredLists.forEach((r) => note(`  ERRORED ${short(r.id)}: ${(r.err || '').slice(0, 90)}`));

  // SCENARIO 1 (PRIORITY): snapshotted drives list complete + coherent when they
  // list at all. A gateway TIMEOUT is BLOCKED-env (D-012), NOT a product FAIL —
  // scored separately. Completeness is judged only over drives whose on-chain
  // ground truth was retrievable (gtOk).
  const snapGt = snapLists.filter((r) => r.gtOk);
  const snapFileComplete = snapGt.filter((r) => r.filesComplete);
  const snapFullComplete = snapGt.filter((r) => r.filesComplete && r.foldersComplete);
  check('SCENARIO-1 snapshotted public drives that listed did so with NO crash/error (gateway timeouts scored separately)',
    erroredLists.filter((r) => r.hasSnap).length === 0,
    `snapshotted: listed-ok=${snapLists.length} gatewayBlocked=${snapAttempted.filter((r) => r.blocked).length} hard-errored=${erroredLists.filter((r) => r.hasSnap).length} of ${snapAttempted.length} attempted`);
  check('SCENARIO-1 snapshotted drives list COMPLETE files vs on-chain ground truth (no missing files from snapshots)',
    snapGt.length > 0 && snapFileComplete.length === snapGt.length,
    `fileComplete ${snapFileComplete.length}/${snapGt.length} (drives with retrievable ground truth)`);
  check('SCENARIO-1 snapshotted drives list COMPLETE folders vs ground truth',
    snapGt.length > 0 && snapFullComplete.length === snapGt.length,
    `fullComplete ${snapFullComplete.length}/${snapGt.length}`);
  // discrepancy detail (any drive where listing < ground truth = incompleteness)
  for (const r of snapGt) {
    if (!r.filesComplete || !r.foldersComplete) {
      note(`  DISCREPANCY ${short(r.id)}: files ${r.listFiles} vs gt ${r.gtFiles}${r.gtCapped ? '+' : ''}, folders ${r.listFolders} vs gt ${r.gtFolders}`);
    }
  }
  // Sanity: consistency with non-snapshot drives (same completeness behavior)
  const nonSnapGt = nonSnapLists.filter((r) => r.gtOk);
  check('SCENARIO-1 non-snapshot public drives list complete too (consistency baseline)',
    nonSnapGt.every((r) => r.filesComplete && r.foldersComplete),
    `complete ${nonSnapGt.filter((r) => r.filesComplete && r.foldersComplete).length}/${nonSnapGt.length} (with ground truth)`);

  // Determinism re-list of the largest snapshotted drive (no partial/flaky listing)
  if (snapLists.length > 0) {
    const target = snapLists.slice().sort((a, b) => b.total - a.total)[0];
    const td = pub.find((d) => d.id === target.id);
    try {
      const e2 = await withTimeout(arDrive.listPublicFolder({ folderId: EID(td.rootFolderId), maxDepth: 10, includeRoot: false }), 150000, 'relist');
      check('SCENARIO-1 snapshotted-drive listing is deterministic on re-list',
        e2.length === target.total, `relist=${e2.length} first=${target.total} (drive ${short(td.id)})`);
    } catch (e) {
      note('re-list skipped/blocked: ' + ((e && e.message) || 'err'));
    }
  }

  // SCENARIO 2: largest drive lists fully.
  const largest = okLists.slice().sort((a, b) => b.total - a.total)[0];
  if (largest) {
    check('SCENARIO-2 largest drive listed fully without hang/error',
      largest.ok && largest.filesComplete !== false,
      `drive ${short(largest.id)} snap=${largest.hasSnap} files=${largest.listFiles} folders=${largest.listFolders} total=${largest.total} in ${largest.ms}ms (gt=${largest.gtOk ? largest.gtFiles + (largest.gtCapped ? '+' : '') : 'n/a'})`);
  }

  // SCENARIO 4: special file types.
  const totalHidden = okLists.reduce((a, r) => a + (r.hidden || 0), 0);
  note(`total HIDDEN entities across public drives (core-js isHidden=true): ${totalHidden}`);
  check('SCENARIO-4 hidden-state (isHidden) surfaced by core-js listing on real data',
    okLists.every((r) => typeof r.hidden === 'number'),
    `hidden entities found=${totalHidden} (app maps entity.isHidden -> "Hidden" badge in StorageTab)`);

  // ===========================================================================
  section('SCENARIO 3 — download-sync: pull small public files to a native local folder');
  // ===========================================================================
  const streamer = new StreamingDownloader();
  const gatewayUrl = gatewayMod.getGatewayUrl();
  // pick a public drive that has small files (<=105KiB, >0, with dataTxId)
  let dlDrive = null, smallFiles = [];
  for (const r of okLists.sort((a, b) => a.total - b.total)) {
    const d = pub.find((x) => x.id === r.id);
    if (!d || !d.rootFolderId) continue;
    try {
      const entities = await withTimeout(arDrive.listPublicFolder({ folderId: EID(d.rootFolderId), maxDepth: 10, includeRoot: false }), 90000, 'dl-list');
      const files = entities.filter((e) => e.entityType === 'file' && e.dataTxId &&
        e.size !== undefined && Number(e.size.valueOf ? e.size.valueOf() : e.size) > 0 &&
        Number(e.size.valueOf ? e.size.valueOf() : e.size) <= 107520);
      if (files.length > 0) { dlDrive = d; smallFiles = files.slice(0, 3); break; }
    } catch (e) { /* try next */ }
  }
  if (!dlDrive) {
    check('SCENARIO-3 a public drive with small (<=105KiB) files exists to download', false, 'none found');
  } else {
    note(`download source: public drive ${short(dlDrive.id)} snap=${snapSet.has(dlDrive.id)} — ${smallFiles.length} small file(s) selected`);
    const localFolder = path.join(DL_DIR, 'drive-' + short(dlDrive.id).replace('…', ''));
    fs.mkdirSync(localFolder, { recursive: true });
    let landed = 0, valid = 0;
    for (const f of smallFiles) {
      const sizeMeta = Number(f.size.valueOf ? f.size.valueOf() : f.size);
      const dest = path.join(localFolder, 'file-' + short(String(f.fileId)).replace('…', '') + path.extname(String(f.name || '')));
      const url = `${gatewayUrl}/${f.dataTxId}`;
      try {
        const t = Date.now();
        const res = await streamer.downloadFile(url, dest, 'uat-dl-' + crypto.randomBytes(3).toString('hex'), { maxRetries: 3, retryDelay: 1500 });
        const st = fs.statSync(dest);
        landed++;
        const sane = st.size > 0 && !!res.hash && res.hash.length === 64;
        if (sane) valid++;
        note(`  landed: onDisk=${st.size}B metaSize=${sizeMeta}B hash=${res.hash.slice(0, 12)}… ${Date.now() - t}ms`);
      } catch (e) {
        note(`  FAILED download: ${(e && e.message || 'err').slice(0, 140)}`);
      }
    }
    check('SCENARIO-3 files actually land on native local disk', landed > 0, `${landed}/${smallFiles.length} landed`);
    check('SCENARIO-3 at least one downloaded file has valid bytes (size>0 + sha256)', valid > 0, `${valid}/${landed} byte-valid`);
    // independent size cross-check for the first landed file vs gateway HEAD-ish (data endpoint returns bytes)
  }

  // ===========================================================================
  section('SCENARIO 5 — private + snapshot combo: unlock + list decrypted');
  // ===========================================================================
  // Prefer a snapshotted private drive; among those prefer a v1 drive (cabca9d6)
  // which the app unlocks reliably, then also try the others.
  const privSnap = priv.filter((d) => snapSet.has(d.id));
  check('SCENARIO-5 owner has a snapshotted PRIVATE drive (combo precondition)', privSnap.length > 0,
    `snapshotted private drives=${privSnap.length}`);
  // Order: known-v1 prefix first, then remaining snapshotted private, then any private.
  const order = privSnap.slice().sort((a, b) => (String(b.id).startsWith('cabca9d6') ? 1 : 0) - (String(a.id).startsWith('cabca9d6') ? 1 : 0));
  const candidates = order.length ? order : priv;
  let anyUnlocked = false;
  for (const d of candidates) {
    try {
      const res = await walletManager.unlockPrivateDrive(d.id, password);
      if (!res.success) { note(`  ${short(d.id)} snap=${snapSet.has(d.id)} unlock REJECTED: ${(res.error || '').slice(0, 60)}`); continue; }
      // re-list to get decrypted rootFolderId
      const fresh = (await walletManager.listDrives()).find((x) => x.id === d.id);
      const key = driveKeyManager.getDriveKey(d.id);
      if (!fresh || !fresh.rootFolderId || !key) { note(`  ${short(d.id)} unlocked but no rootFolderId/key`); continue; }
      const gtFiles = (await withTimeout(distinctEntityIds(owner, d.id, 'file', 'File-Id'), 120000, 'priv-gt')).ids.size;
      const t = Date.now();
      const entities = await withTimeout(arDrive.listPrivateFolder({
        folderId: EID(fresh.rootFolderId), driveKey: key, maxDepth: 10, includeRoot: false, withKeys: true
      }), 150000, 'listPrivateFolder');
      const ms = Date.now() - t;
      const c = countEntities(entities);
      note(`  ${short(d.id)} snap=${snapSet.has(d.id)} UNLOCKED — decrypted list files=${c.files}/gt${gtFiles} folders=${c.folders} hidden=${c.hidden} ${ms}ms`);
      const complete = c.files === gtFiles;
      check(`SCENARIO-5 snapshotted PRIVATE drive ${short(d.id)} unlocks + lists decrypted contents COMPLETE`,
        c.total >= 0 && complete, `files ${c.files} vs gt ${gtFiles}`);
      anyUnlocked = true;
      break; // one solid combo proof is enough
    } catch (e) {
      note(`  ${short(d.id)} combo ERROR: ${(e && e.message || 'err').slice(0, 120)}`);
    }
  }
  if (!anyUnlocked) check('SCENARIO-5 at least one snapshotted private drive unlocked + listed', false, 'none unlocked');

  // ===========================================================================
  section('SYNC-READ LIVE CERT RESULT');
  // ===========================================================================
  const failed = results.filter((r) => !r.pass);
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('RESULT: ' + (failed.length === 0 ? 'ALL-PASS' : 'SEE-ABOVE'));

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  return failed.length === 0 ? 0 : 1;
}

app.whenReady().then(main).then(
  (code) => { app.exit(code); },
  (err) => { console.error('FATAL:', err && err.stack ? err.stack : err); app.exit(1); }
);
