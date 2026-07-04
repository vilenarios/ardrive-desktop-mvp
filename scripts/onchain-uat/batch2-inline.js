/*
 * INFRA-9 BATCH 2 (inline-seed) — free-tier write round-trips, turbo-gateway.com ONLY.
 *
 * Fresh Turbo uploads are GQL-indexed instantly but their DATA is not servable
 * until the bundle seeds (~5-7 min, flaky). Wallet + payloads are in-memory only,
 * so all writes happen first, then a single ~7-min poll window pre-probes data
 * availability (fast axios, follows the sandbox 302) and completes each read-back
 * once servable — avoiding core-js's ~127s internal retry storm on 404s.
 *
 * MONEY SAFETY: fresh 0-balance wallet (cannot spend); every upload <40KB (< the
 * app's 100KB free tier); balance read before/after each upload asserts net-zero;
 * ikry funded wallet NEVER used except a read-only balance snapshot.
 *
 * Note: after W4 replaces the file (v2), the latest private data is v2, so the W3
 * round-trip verifies against the v2 payload (still a full fresh upload->download->
 * decrypt->SHA256 proof). W4 asserts the dataTxId changed (new revision); W5 that
 * the latest metadata reads isHidden===true.
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, wrapFileOrFolder, PrivateDriveKeyData, ArweaveAddress, EID, JWKWallet } = core;
const _ax = require('axios'); const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 20000 });
const GATEWAY = 'turbo-gateway.com';
const MAX_UPLOAD_BYTES = 40 * 1024;
const POLL_DEADLINE_MS = 7.5 * 60 * 1000; // poll budget spanning the ~6-7 min seeding lag
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toNum(x) { try { return Number(x.toString()); } catch { return NaN; } }
async function avail(txId) {
  try { const r = await ax.get(`https://${GATEWAY}/${txId}`, { responseType: 'arraybuffer' }); return r.status === 200 && r.data && r.data.byteLength > 0; }
  catch { return false; }
}
async function retryRead(fn, label, tries = 4, baseMs = 3000) {
  let e; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (err) { e = err; c.log(`     [retry] ${label} #${i + 1}: ${String(err.message).slice(0, 60)}`); if (i + 1 < tries) await sleep(baseMs); } } throw e;
}
async function readTurboWinc(tm) { try { return String((await tm.getBalance()).winc); } catch { return '0'; } }
async function latestFileMetaTx(driveId, fileId, address) {
  const q = { query: `query{transactions(owners:["${address}"],tags:[{name:"File-Id",values:["${fileId}"]},{name:"Entity-Type",values:["file"]}],first:5){edges{node{id}}}}` };
  const { data } = await ax.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const edges = (data && data.data && data.data.transactions && data.data.transactions.edges) || [];
  return edges.length ? edges[0].node.id : null;
}

async function main() {
  const results = { gateway: GATEWAY, W1: {}, W2: {}, W3: {}, W4: {}, W5: {}, W6: {}, spend: {} };
  const { password } = c.loadEnv();
  const arweave = c.initArweave();
  const turboManager = c.getTurboManager();
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  results.spend.ikryBefore = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'infra9-b2i-'));

  // ---------------- W1 ----------------
  c.section('W1  mint fresh 0-balance wallet + init');
  const jwk = await arweave.wallets.generate();
  const address = await arweave.wallets.jwkToAddress(jwk);
  const arDrive = arDriveFactory({ wallet: new JWKWallet(jwk), arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  await turboManager.initialize(jwk);
  const freshWinc = await readTurboWinc(turboManager);
  results.W1 = { pass: freshWinc === '0', address, freshWalletWinc: freshWinc };
  results.spend.freshBefore = freshWinc;
  c.log(`   fresh ${address} balance=${freshWinc} winc`);
  if (freshWinc !== '0') throw new Error('fresh wallet funded — abort');
  const owner = new ArweaveAddress(address);

  async function guardedUpload({ localPath, destFolderId, driveKey, destName, conflictResolution }) {
    const size = fs.statSync(localPath).size;
    if (size >= MAX_UPLOAD_BYTES) throw new Error(`refuse: ${size} >= cap`);
    const base = await turboManager.getUploadCosts(size).catch(() => ({ winc: '?' }));
    const before = await readTurboWinc(turboManager);
    const entity = { wrappedEntity: wrapFileOrFolder(localPath), destFolderId: EID(destFolderId) };
    if (destName) entity.destName = destName;
    if (driveKey) entity.driveKey = driveKey;
    const opts = { entitiesToUpload: [entity] };
    if (conflictResolution) opts.conflictResolution = conflictResolution;
    const res = await arDrive.uploadAllEntities(opts);
    const after = await readTurboWinc(turboManager);
    if (before !== after) throw new Error(`NET-SPEND ${before}->${after}`);
    c.log(`   [guard] ${size}B free-tier; getUploadCosts base=${base.winc} winc; balance ${before}->${after} (net-zero)`);
    return res;
  }

  // ---------------- WRITES ----------------
  c.section('WRITES (W2 create priv drive, W3 upload, W4 edit, W5 hide, W6 public)');
  // W2
  const before2 = await readTurboWinc(turboManager);
  const newPrivateDriveData = await PrivateDriveKeyData.from(password, jwk);
  const w2 = await arDrive.createPrivateDrive({ driveName: `infra9-priv-${Date.now()}`, newPrivateDriveData });
  const after2 = await readTurboWinc(turboManager);
  const pdrive = w2.created.find((e) => e.type === 'drive');
  const pfolder = w2.created.find((e) => e.type === 'folder');
  const privDrive = { driveId: pdrive.entityId.toString(), rootFolderId: pfolder.entityId.toString(), driveKey: newPrivateDriveData.driveKey };
  results.W2 = { pass: before2 === after2, driveId: privDrive.driveId, rootFolderId: privDrive.rootFolderId, driveTxId: pdrive.metadataTxId && pdrive.metadataTxId.toString(), folderTxId: pfolder.metadataTxId && pfolder.metadataTxId.toString(), cost: 0 };
  c.log(`   W2 private drive ${privDrive.driveId} (balance ${before2}->${after2})`);

  // W3 upload v1
  const localName = 'infra9-roundtrip.txt';
  const localPath = path.join(scratch, localName);
  const payloadV1 = Buffer.from('INFRA-9 round-trip v1\n' + crypto.randomBytes(8 * 1024).toString('hex') + '\n');
  fs.writeFileSync(localPath, payloadV1);
  const hashV1 = c.sha256(payloadV1);
  const w3 = await guardedUpload({ localPath, destFolderId: privDrive.rootFolderId, driveKey: privDrive.driveKey });
  const w3f = w3.created.find((e) => e.type === 'file');
  const fileId = w3f.entityId.toString();
  const dataTx1 = w3f.dataTxId.toString();
  results.W3.upload = { fileId, dataTxId: dataTx1, cost: 0, sha256Local_v1: hashV1 };
  c.log(`   W3 upload fileId=${fileId} dataTx1=${dataTx1}`);

  // W4 edit -> v2 (same name, replace => new revision)
  const payloadV2 = Buffer.from('INFRA-9 round-trip v2 EDITED\n' + crypto.randomBytes(8 * 1024).toString('hex') + '\n');
  fs.writeFileSync(localPath, payloadV2);
  const hashV2 = c.sha256(payloadV2);
  const w4 = await guardedUpload({ localPath, destFolderId: privDrive.rootFolderId, driveKey: privDrive.driveKey, destName: localName, conflictResolution: 'replace' });
  const w4f = w4.created.find((e) => e.type === 'file');
  const dataTx2 = w4f && w4f.dataTxId ? w4f.dataTxId.toString() : null;
  results.W4.upload = { fileId, oldDataTxId: dataTx1, newDataTxId: dataTx2, cost: 0 };
  c.log(`   W4 edit dataTx2=${dataTx2} (was ${dataTx1})`);

  // W5 hide is DEFERRED into the read phase: hidePrivateFile must READ the file's
  // current (v2) metadata to build the hide revision, so it only works once that
  // metadata has seeded on turbo-gateway.com.

  // W6 public
  const beforeD = await readTurboWinc(turboManager);
  const w6d = await arDrive.createPublicDrive({ driveName: `infra9-pub-${Date.now()}` });
  const afterD = await readTurboWinc(turboManager);
  const pubDrive = w6d.created.find((e) => e.type === 'drive');
  const pubRoot = w6d.created.find((e) => e.type === 'folder').entityId.toString();
  const pubName = 'infra9-public.txt';
  const pubPath = path.join(scratch, pubName);
  const pubPayload = Buffer.from('INFRA-9 PUBLIC round-trip\n' + crypto.randomBytes(6 * 1024).toString('hex') + '\n');
  fs.writeFileSync(pubPath, pubPayload);
  const hashPub = c.sha256(pubPayload);
  const w6u = await guardedUpload({ localPath: pubPath, destFolderId: pubRoot });
  const w6f = w6u.created.find((e) => e.type === 'file');
  const pubFileId = w6f.entityId.toString();
  const pubDataTx = w6f.dataTxId.toString();
  results.W6.upload = { driveId: pubDrive.entityId.toString(), fileId: pubFileId, dataTxId: pubDataTx, cost: 0, driveBalanceUnchanged: beforeD === afterD, sha256Local: hashPub };
  c.log(`   W6 public drive ${pubDrive.entityId.toString()} file ${pubFileId} dataTx=${pubDataTx}`);

  // resolve latest private metadata tx (post-hide) for W4/W5 read verification
  let privMetaTx = await latestFileMetaTx(privDrive.driveId, fileId, address).catch(() => null);
  c.log(`   latest private file metadata tx (post-hide): ${privMetaTx}`);

  // ---------------- READ PHASE (poll until seeded) ----------------
  c.section(`READ-BACK poll (up to ${POLL_DEADLINE_MS / 60000} min; verify as data seeds)`);
  const t0 = Date.now();
  let doneW3 = false, doneW4W5 = false, doneW6 = false;
  async function tryW3() {
    if (doneW3) return;
    if (!(await avail(dataTx2 || dataTx1))) return;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'w3dl-'));
    const buf = await retryRead(() => arDrive.downloadPrivateFile({ fileId: EID(fileId), driveKey: privDrive.driveKey, destFolderPath: dest, defaultFileName: localName }).then(() => fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]))), 'W3 dl');
    fs.rmSync(dest, { recursive: true, force: true });
    const h = c.sha256(buf); const match = h === hashV2; // latest content is v2
    results.W3.roundTrip = { pass: match, downloadedSha256: h, expectedSha256_v2: hashV2, bytes: buf.length, contentRevision: 'v2' };
    c.log(`   W3 round-trip: dl sha256=${h} == v2 ${hashV2}? ${match ? 'YES' : 'NO'}`);
    doneW3 = true;
  }
  let w4Verified = false, hideIssued = false, hideMetaTx = null;
  async function tryW4W5() {
    if (doneW4W5) return;
    // Phase A: once v2 metadata seeds -> verify new revision + issue the hide.
    if (!w4Verified) {
      if (!privMetaTx) privMetaTx = await latestFileMetaTx(privDrive.driveId, fileId, address).catch(() => null);
      if (!privMetaTx || !(await avail(privMetaTx))) return;
      const meta = await retryRead(() => arDrive.getPrivateFile({ fileId: EID(fileId), driveKey: privDrive.driveKey, owner }), 'W4 getPrivateFile');
      const fetchedDataTx = meta.dataTxId.toString();
      const newRevision = fetchedDataTx !== dataTx1;
      results.W4.verify = { pass: newRevision, fetchedDataTxId: fetchedDataTx, oldDataTxId: dataTx1, newRevision };
      c.log(`   W4 new revision: ${newRevision ? 'YES' : 'NO'} (fetched ${fetchedDataTx})`);
      w4Verified = true;
      const b5 = await readTurboWinc(turboManager);
      const w5 = await arDrive.hidePrivateFile({ fileId: EID(fileId), driveKey: privDrive.driveKey });
      const a5 = await readTurboWinc(turboManager);
      hideMetaTx = w5.created && w5.created[0] && w5.created[0].metadataTxId ? w5.created[0].metadataTxId.toString() : null;
      results.W5.write = { pass: b5 === a5, hideTxId: hideMetaTx, cost: 0, balanceUnchanged: b5 === a5 };
      c.log(`   W5 hide issued tx=${hideMetaTx} (balance ${b5}->${a5})`);
      hideIssued = true;
      return; // wait for the hide revision to seed
    }
    // Phase B: once the hide revision seeds -> read back isHidden.
    if (hideIssued && hideMetaTx && (await avail(hideMetaTx))) {
      const meta2 = await retryRead(() => arDrive.getPrivateFile({ fileId: EID(fileId), driveKey: privDrive.driveKey, owner }), 'W5 getPrivateFile');
      const isHidden = meta2.isHidden === true;
      results.W5.verify = { pass: isHidden, isHiddenAfterFetch: isHidden };
      c.log(`   W5 reads hidden: ${isHidden ? 'YES' : 'NO'}`);
      doneW4W5 = true;
    }
  }
  async function tryW6() {
    if (doneW6) return;
    if (!(await avail(pubDataTx))) return;
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'w6dl-'));
    const buf = await retryRead(() => arDrive.downloadPublicFile({ fileId: EID(pubFileId), destFolderPath: dest, defaultFileName: pubName }).then(() => fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]))), 'W6 dl');
    fs.rmSync(dest, { recursive: true, force: true });
    const h = c.sha256(buf); const match = h === hashPub;
    results.W6.roundTrip = { pass: match, downloadedSha256: h, expectedSha256: hashPub, bytes: buf.length };
    c.log(`   W6 round-trip: dl sha256=${h} == ${hashPub}? ${match ? 'YES' : 'NO'}`);
    doneW6 = true;
  }
  while (Date.now() - t0 < POLL_DEADLINE_MS && !(doneW3 && doneW4W5 && doneW6)) {
    const el = Math.round((Date.now() - t0) / 1000);
    c.log(`   [poll +${el}s] W3=${doneW3} W4W5=${doneW4W5} W6=${doneW6}`);
    try { await tryW3(); } catch (e) { c.log(`     W3 attempt err: ${e.message.slice(0, 60)}`); }
    try { await tryW4W5(); } catch (e) { c.log(`     W4W5 attempt err: ${e.message.slice(0, 60)}`); }
    try { await tryW6(); } catch (e) { c.log(`     W6 attempt err: ${e.message.slice(0, 60)}`); }
    if (doneW3 && doneW4W5 && doneW6) break;
    await sleep(20000);
  }
  if (!doneW3 && !results.W3.roundTrip) results.W3.roundTrip = { pass: false, note: 'private data not servable within poll window (seeding lag)' };
  if (!results.W4.verify) results.W4.verify = { pass: false, note: 'v2 metadata not servable within poll window; new revision still proven at write (dataTx2 != dataTx1)' };
  if (!results.W5.write) results.W5.write = { pass: false, note: 'hide not issued (v2 metadata not seeded in window)' };
  if (!results.W5.verify) results.W5.verify = { pass: false, note: 'hide revision not servable within poll window (read-hidden deferred; needs a second ~6min seed)' };
  if (!doneW6 && !results.W6.roundTrip) results.W6.roundTrip = { pass: false, note: 'public data not servable within poll window (seeding lag)' };

  // ---------------- SPEND PROOF ----------------
  const freshAfter = await readTurboWinc(turboManager);
  const ikryAfter = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  results.spend.freshAfter = freshAfter;
  results.spend.ikryAfter = ikryAfter;
  results.spend.freshNetZero = freshAfter === results.spend.freshBefore;
  results.spend.ikryUnchanged = ikryAfter === results.spend.ikryBefore && ikryAfter === c.IKRY_TURBO_BALANCE_EXPECTED;
  c.section('BATCH 2 SPEND PROOF + JSON');
  c.log(`   fresh ${results.spend.freshBefore}->${freshAfter} (net-zero ${results.spend.freshNetZero})`);
  c.log(`   ikry  ${results.spend.ikryBefore}->${ikryAfter} (unchanged&expected ${results.spend.ikryUnchanged})`);
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error('BATCH2-INLINE FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
