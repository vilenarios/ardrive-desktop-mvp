/*
 * INFRA-9 BATCH 2 — Free-tier write round-trips on a FRESH minted wallet.
 *
 * MONEY SAFETY (net spend MUST be 0):
 *   - The paying wallet is a BRAND-NEW wallet with 0 winc / 0 AR. It is
 *     physically incapable of spending — a paid upload would throw
 *     "insufficient balance", not spend. This is the hard backstop.
 *   - Every uploaded data item is kept FAR below the free tier (<< 100 KB,
 *     the app's TURBO_FREE_SIZE_LIMIT). Free tier => 0 winc deducted.
 *   - ArDrive is built with turboSettings (Turbo-only, never AR tokens).
 *   - Per upload we read the fresh wallet's Turbo balance BEFORE and AFTER
 *     and assert it is unchanged (direct net-zero proof).
 *
 * NOTE on getUploadCosts: turbo-sdk getUploadCosts() returns the BASE winc
 * price for the bytes and does NOT reflect the <100KB free-tier subsidy
 * (empirically 50000 bytes -> ~5.1e8 winc). The app itself never gates on
 * getUploadCosts==0; it gates on a pure size check. We therefore gate on
 * size + the zero-balance wallet + balance-delta, and log getUploadCosts for
 * transparency only.
 *
 * The ikry funded wallet is NEVER used here.
 *
 * Run (from wt-main):  node scripts/onchain-uat/batch2-writes.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const c = require('./common');

const core = require('ardrive-core-js');
const {
  arDriveFactory,
  arDriveAnonymousFactory,
  wrapFileOrFolder,
  PrivateDriveKeyData,
  ArweaveAddress,
  EID,
} = core;

const APP_FREE_LIMIT = 100 * 1024; // app's TURBO_FREE_SIZE_LIMIT
const MAX_UPLOAD_BYTES = 40 * 1024; // our self-imposed hard cap, well under free tier

function toNum(x) { try { return Number(x.toString()); } catch { return NaN; } }

async function readTurboWinc(turboManager) {
  // fresh wallet is likely unknown to Turbo -> treat errors/absence as 0
  try {
    const { winc } = await turboManager.getBalance();
    return String(winc);
  } catch (e) {
    return '0'; // unregistered / zero-balance
  }
}

async function main() {
  const results = { W1: {}, W2: {}, W3: {}, W4: {}, W5: {}, W6: {}, spend: {} };
  const { password } = c.loadEnv();
  const arweave = c.initArweave();
  const turboManager = c.getTurboManager();

  // ikry balance snapshot (must be unchanged; never touched here)
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  results.spend.ikryBefore = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'infra9-b2-'));
  c.log('scratch dir:', scratch);

  // ---------------- W1: mint fresh wallet + headless onboard ----------------
  c.section('W1  mint fresh wallet (0 balance) + init ArDrive/Turbo headless');
  let jwk = null;
  let arDrive = null;
  let address = null;
  try {
    jwk = await arweave.wallets.generate(); // memory only; never written/committed
    address = await arweave.wallets.jwkToAddress(jwk);
    arDrive = arDriveFactory({
      wallet: jwk,
      arweave,
      turboSettings: { turboUrl: new URL('https://upload.ardrive.io') },
    });
    await turboManager.initialize(jwk); // app module turbo (Turbo-only)
    const winc = await readTurboWinc(turboManager);
    results.W1 = { pass: true, address, freshWalletWinc: winc };
    results.spend.freshBefore = winc;
    c.log(`   fresh wallet address: ${address}`);
    c.log(`   fresh wallet Turbo balance: ${winc} winc (expected 0)`);
    if (winc !== '0') throw new Error('fresh wallet unexpectedly funded — aborting to protect funds');
  } catch (e) {
    results.W1 = { pass: false, error: e.message };
    c.log('   W1 FAIL:', e.message);
    console.log('\n' + JSON.stringify(results, null, 2));
    return finish(results, turboManager, TurboFactory);
  }

  const owner = new ArweaveAddress(address);

  // helper: guarded upload of a single wrapped file
  async function guardedUpload({ localPath, destFolderId, driveKey, destName, conflictResolution }) {
    const size = fs.statSync(localPath).size;
    if (size >= MAX_UPLOAD_BYTES) throw new Error(`refusing upload: ${size} bytes >= cap ${MAX_UPLOAD_BYTES}`);
    // transparency: base price (NOT the free-tier price)
    const base = await turboManager.getUploadCosts(size).catch(() => ({ winc: '?' }));
    c.log(`   [guard] size=${size}B (<100KB free tier). getUploadCosts base=${base.winc} winc (free-tier not reflected).`);
    const before = await readTurboWinc(turboManager);
    const wrapped = wrapFileOrFolder(localPath);
    const entity = { wrappedEntity: wrapped, destFolderId: EID(destFolderId) };
    if (destName) entity.destName = destName;
    if (driveKey) entity.driveKey = driveKey;
    const opts = { entitiesToUpload: [entity] };
    if (conflictResolution) opts.conflictResolution = conflictResolution;
    const res = await arDrive.uploadAllEntities(opts);
    const after = await readTurboWinc(turboManager);
    if (before !== after) throw new Error(`NET-SPEND DETECTED: fresh balance ${before} -> ${after} winc`);
    c.log(`   [guard] balance unchanged (${before} -> ${after} winc) — free-tier confirmed.`);
    return res;
  }

  // ---------------- W2: create a PRIVATE drive ----------------
  c.section('W2  create a PRIVATE drive (Turbo, free metadata)');
  let privDrive = null;
  try {
    const before = await readTurboWinc(turboManager);
    const newPrivateDriveData = await PrivateDriveKeyData.from(password, jwk);
    const res = await arDrive.createPrivateDrive({ driveName: `infra9-priv-${Date.now()}`, newPrivateDriveData });
    const after = await readTurboWinc(turboManager);
    if (before !== after) throw new Error(`NET-SPEND DETECTED on drive create: ${before} -> ${after}`);
    const driveEntity = res.created.find((e) => e.type === 'drive');
    const folderEntity = res.created.find((e) => e.type === 'folder');
    const driveId = driveEntity.entityId.toString();
    const rootFolderId = folderEntity.entityId.toString();
    const driveKey = newPrivateDriveData.driveKey;
    privDrive = { driveId, rootFolderId, driveKey };
    results.W2 = {
      pass: true, driveId, rootFolderId,
      driveTxId: driveEntity.metadataTxId && driveEntity.metadataTxId.toString(),
      folderTxId: folderEntity.metadataTxId && folderEntity.metadataTxId.toString(),
      fees: res.fees, balanceUnchanged: before === after,
    };
    c.log(`   ✓ private drive ${driveId} (root ${rootFolderId}); balance ${before}->${after}; fees=${JSON.stringify(res.fees)}`);
  } catch (e) {
    results.W2 = { pass: false, error: e.message };
    c.log('   W2 FAIL:', e.message);
  }

  // ---------------- W3: upload <100KB private file + download + round-trip ----------------
  c.section('W3  upload <100KB private file, download+decrypt, assert SHA-256 round-trip');
  const localName = 'infra9-roundtrip.txt';
  const localPath = path.join(scratch, localName);
  let w3FileId = null;
  let w3DataTxId = null;
  if (privDrive) {
    try {
      const payloadV1 = Buffer.from('INFRA-9 round-trip v1\n' + crypto.randomBytes(8 * 1024).toString('hex') + '\n');
      fs.writeFileSync(localPath, payloadV1);
      const localHashV1 = c.sha256(payloadV1);
      const res = await guardedUpload({ localPath, destFolderId: privDrive.rootFolderId, driveKey: privDrive.driveKey });
      const fileEntity = res.created.find((e) => e.type === 'file');
      w3FileId = fileEntity.entityId.toString();
      w3DataTxId = fileEntity.dataTxId && fileEntity.dataTxId.toString();
      c.log(`   uploaded fileId=${w3FileId} dataTxId=${w3DataTxId}`);

      // download + decrypt
      const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'infra9-w3dl-'));
      await arDrive.downloadPrivateFile({ fileId: EID(w3FileId), driveKey: privDrive.driveKey, destFolderPath: dest, defaultFileName: localName });
      const dlBuf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
      const dlHash = c.sha256(dlBuf);
      fs.rmSync(dest, { recursive: true, force: true });
      const match = dlHash === localHashV1 && dlBuf.equals(payloadV1);
      results.W3 = { pass: match, fileId: w3FileId, dataTxId: w3DataTxId, localSha256: localHashV1, downloadSha256: dlHash, byteEqual: dlBuf.equals(payloadV1), bytes: dlBuf.length };
      c.log(`   local  sha256=${localHashV1}`);
      c.log(`   remote sha256=${dlHash}`);
      c.log(`   ROUND-TRIP MATCH: ${match ? 'YES ✓' : 'NO ✗'}`);
    } catch (e) {
      results.W3 = { pass: false, error: e.message };
      c.log('   W3 FAIL:', e.message);
    }
  } else {
    results.W3 = { pass: false, error: 'no private drive (W2 failed)' };
    c.log('   W3 skipped (no private drive)');
  }

  // ---------------- W4: edit + re-upload => NEW REVISION (SYNC-1) ----------------
  c.section('W4  edit local file + re-upload => new revision of same fileId (SYNC-1)');
  if (privDrive && w3FileId) {
    try {
      const payloadV2 = Buffer.from('INFRA-9 round-trip v2 EDITED\n' + crypto.randomBytes(8 * 1024).toString('hex') + '\n');
      fs.writeFileSync(localPath, payloadV2); // same path/name => same ArFS name => revision
      const res = await guardedUpload({ localPath, destFolderId: privDrive.rootFolderId, driveKey: privDrive.driveKey, destName: localName, conflictResolution: 'replace' });
      const fileEntity = res.created.find((e) => e.type === 'file');
      const newFileId = fileEntity ? fileEntity.entityId.toString() : null;
      const newDataTxId = fileEntity && fileEntity.dataTxId ? fileEntity.dataTxId.toString() : null;
      // confirm by re-fetching metadata
      const meta = await arDrive.getPrivateFile({ fileId: EID(w3FileId), driveKey: privDrive.driveKey, owner });
      const fetchedDataTxId = meta.dataTxId.toString();
      const sameFile = (newFileId === null || newFileId === w3FileId);
      const newRevision = fetchedDataTxId !== w3DataTxId;
      results.W4 = { pass: sameFile && newRevision, fileId: w3FileId, oldDataTxId: w3DataTxId, newDataTxId: newDataTxId || fetchedDataTxId, fetchedDataTxId, sameFileId: sameFile, newRevision };
      c.log(`   same fileId: ${sameFile} (${w3FileId})`);
      c.log(`   old dataTxId=${w3DataTxId}`);
      c.log(`   new dataTxId=${fetchedDataTxId}`);
      c.log(`   NEW REVISION: ${newRevision ? 'YES ✓' : 'NO ✗'}`);
    } catch (e) {
      results.W4 = { pass: false, error: e.message };
      c.log('   W4 FAIL:', e.message);
    }
  } else {
    results.W4 = { pass: false, error: 'prereq missing (W2/W3)' };
    c.log('   W4 skipped');
  }

  // ---------------- W5: hide => re-fetch reads as hidden (SYNC-5 / D-011) ----------------
  c.section('W5  hide the file, re-fetch, assert isHidden === true (SYNC-5/D-011)');
  if (privDrive && w3FileId) {
    try {
      const before = await readTurboWinc(turboManager);
      const hideRes = await arDrive.hidePrivateFile({ fileId: EID(w3FileId), driveKey: privDrive.driveKey });
      const after = await readTurboWinc(turboManager);
      if (before !== after) throw new Error(`NET-SPEND on hide: ${before} -> ${after}`);
      const meta = await arDrive.getPrivateFile({ fileId: EID(w3FileId), driveKey: privDrive.driveKey, owner });
      const isHidden = meta.isHidden === true;
      const hideTx = hideRes.created && hideRes.created[0] && hideRes.created[0].metadataTxId ? hideRes.created[0].metadataTxId.toString() : null;
      results.W5 = { pass: isHidden, fileId: w3FileId, hideTxId: hideTx, isHiddenAfterFetch: isHidden, balanceUnchanged: before === after };
      c.log(`   hide tx=${hideTx}; balance ${before}->${after}`);
      c.log(`   re-fetched isHidden: ${isHidden ? 'TRUE ✓' : 'FALSE ✗'}`);
    } catch (e) {
      results.W5 = { pass: false, error: e.message };
      c.log('   W5 FAIL:', e.message);
    }
  } else {
    results.W5 = { pass: false, error: 'prereq missing' };
    c.log('   W5 skipped');
  }

  // ---------------- W6: public drive round-trip ----------------
  c.section('W6  PUBLIC drive: create + upload <100KB + download + round-trip');
  try {
    const beforeD = await readTurboWinc(turboManager);
    const dres = await arDrive.createPublicDrive({ driveName: `infra9-pub-${Date.now()}` });
    const afterD = await readTurboWinc(turboManager);
    if (beforeD !== afterD) throw new Error(`NET-SPEND on public drive create: ${beforeD} -> ${afterD}`);
    const pubFolder = dres.created.find((e) => e.type === 'folder');
    const pubDriveEntity = dres.created.find((e) => e.type === 'drive');
    const pubRoot = pubFolder.entityId.toString();

    const pubName = 'infra9-public.txt';
    const pubPath = path.join(scratch, pubName);
    const pubPayload = Buffer.from('INFRA-9 PUBLIC round-trip\n' + crypto.randomBytes(6 * 1024).toString('hex') + '\n');
    fs.writeFileSync(pubPath, pubPayload);
    const pubLocalHash = c.sha256(pubPayload);
    const ures = await guardedUpload({ localPath: pubPath, destFolderId: pubRoot });
    const pubFileEntity = ures.created.find((e) => e.type === 'file');
    const pubFileId = pubFileEntity.entityId.toString();

    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'infra9-w6dl-'));
    await arDrive.downloadPublicFile({ fileId: EID(pubFileId), destFolderPath: dest, defaultFileName: pubName });
    const dlBuf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
    const dlHash = c.sha256(dlBuf);
    fs.rmSync(dest, { recursive: true, force: true });
    const match = dlHash === pubLocalHash && dlBuf.equals(pubPayload);
    results.W6 = {
      pass: match, driveId: pubDriveEntity.entityId.toString(), rootFolderId: pubRoot, fileId: pubFileId,
      dataTxId: pubFileEntity.dataTxId && pubFileEntity.dataTxId.toString(),
      localSha256: pubLocalHash, downloadSha256: dlHash, byteEqual: dlBuf.equals(pubPayload),
    };
    c.log(`   ✓ public drive ${results.W6.driveId}; file ${pubFileId}`);
    c.log(`   ROUND-TRIP MATCH: ${match ? 'YES ✓' : 'NO ✗'}`);
  } catch (e) {
    results.W6 = { pass: false, error: e.message };
    c.log('   W6 FAIL:', e.message);
  }

  await finish(results, turboManager, TurboFactory);
}

async function finish(results, turboManager, TurboFactory) {
  const freshAfter = await readTurboWinc(turboManager);
  const ikryAfter = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  results.spend.freshAfter = freshAfter;
  results.spend.ikryAfter = ikryAfter;
  results.spend.ikryUnchanged = ikryAfter === results.spend.ikryBefore && ikryAfter === c.IKRY_TURBO_BALANCE_EXPECTED;
  results.spend.freshNetZero = freshAfter === (results.spend.freshBefore || '0');

  c.section('BATCH 2 — SPEND PROOF');
  c.log(`   fresh wallet: ${results.spend.freshBefore || '0'} -> ${freshAfter} winc (net-zero: ${results.spend.freshNetZero ? 'YES ✓' : 'NO ✗'})`);
  c.log(`   ikry wallet : ${results.spend.ikryBefore} -> ${ikryAfter} winc (unchanged & == expected: ${results.spend.ikryUnchanged ? 'YES ✓' : 'NO ✗'})`);

  c.section('BATCH 2 JSON SUMMARY');
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error('BATCH2 FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
