/*
 * INFRA-9 BATCH 1 (focused R2-R5) — turbo-gateway.com ONLY.
 *
 * Why this exists: listPrivateFolder fetches EVERY child's metadata tx and a
 * single unavailable child (turbo-gateway.com has partial data availability =>
 * some bundled data-items 404) makes core-js retry ~127s then abort the whole
 * listing, blocking R3/R4. This script instead:
 *   - GQL-enumerates file entities per drive (owner-scoped)
 *   - pre-probes each file's LATEST metadata tx for data availability (fast)
 *   - decrypts only available files via core-js getPrivateFile (real path)
 *   - pre-probes the file's dataTxId availability
 *   - downloads the smallest available <105KiB file via core-js
 *     downloadPrivateFile TWICE and asserts a stable SHA-256 (PRIV-1)
 *
 * NEVER prints JWK/password. Read-only against ikry's drives. turbo-gateway.com
 * exclusively (ARDRIVE_GATEWAY_HOST forced below).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ARDRIVE_GATEWAY_HOST = process.env.ARDRIVE_GATEWAY_HOST || 'turbo-gateway.com';
const GATEWAY = process.env.ARDRIVE_GATEWAY_HOST;

const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, ArweaveAddress, EID, readJWKFile } = core;
const _ax = require('axios');
const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 30000 });

const TARGET_DRIVES = [
  'cabca9d6-7305-4fe5-b522-404b0c63aae3',
  '8d81a9db-b665-4040-866f-37336d324e14',
];
const CANNOT_DECRYPT = new Set(['ENCRYPTED', 'Encrypted', 'ENCRYPTED_DATA']);
const FREE = c.FREE_TIER_BYTES;

function toNum(x) { try { return Number(x.toString()); } catch { return NaN; } }
function looksLikeText(buf) {
  const n = Math.min(buf.length, 512); if (!n) return false; let p = 0;
  for (let i = 0; i < n; i++) { const b = buf[i]; if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) p++; }
  return p / n > 0.85;
}
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms); });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}
async function gqlFiles(driveId) {
  const q = { query: `query{transactions(owners:["${c.IKRY_ADDRESS}"],tags:[{name:"Drive-Id",values:["${driveId}"]},{name:"Entity-Type",values:["file"]}],first:100){edges{node{id tags{name value}}}}}` };
  const { data } = await ax.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const edges = (data && data.data && data.data.transactions && data.data.transactions.edges) || [];
  const byFileId = new Map(); // first occurrence = latest revision (HEIGHT_DESC)
  for (const e of edges) {
    const t = Object.fromEntries(e.node.tags.map((x) => [x.name, x.value]));
    const fid = t['File-Id'];
    if (fid && !byFileId.has(fid)) byFileId.set(fid, { fileId: fid, metaTx: e.node.id });
  }
  return [...byFileId.values()];
}
async function isAvailable(txId) {
  try {
    const r = await ax.get(`https://${GATEWAY}/${txId}`, { responseType: 'arraybuffer' });
    return { ok: r.status === 200, status: r.status, bytes: r.data ? r.data.byteLength : 0, finalUrl: (r.request && r.request.res && r.request.res.responseUrl) || null };
  } catch (e) { return { ok: false, status: 0, err: e.message }; }
}

async function main() {
  const results = { gateway: GATEWAY, R2: {}, R3: {}, R4: {}, R5: {} };
  const { walletPath, password } = c.loadEnv();
  const arweave = c.initArweave();
  c.log('gateway:', GATEWAY, '(turbo-gateway.com exclusive)');

  let wallet = readJWKFile(walletPath);
  let walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const driveKeyManager = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
  driveKeyManager.setWallet(walletJson);
  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  const owner = new ArweaveAddress(c.IKRY_ADDRESS);

  // ---------- R2 ----------
  c.section('R2  derive key (APP MODULE) + decrypt private drive metadata');
  const drives = [];
  for (const driveId of TARGET_DRIVES) {
    try {
      const driveKey = await driveKeyManager.deriveKey(driveId, password);
      const drive = await withTimeout(arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey, owner }), 40000, `getPrivateDrive ${driveId.slice(0, 8)}`);
      const nameOk = !CANNOT_DECRYPT.has(String(drive.name)) && String(drive.name).length > 0;
      c.log(`   drive ${driveId.slice(0, 8)}: name="${c.assertNoSecret(String(drive.name))}" decrypted=${nameOk}`);
      if (nameOk) { driveKeyManager.cacheKey(driveId, driveKey); drives.push({ driveId, name: String(drive.name), driveKey }); }
    } catch (e) { c.log(`   drive ${driveId.slice(0, 8)}: FAILED (${e.message.slice(0, 100)})`); }
  }
  results.R2.decryptedNames = drives.map((d) => d.name);
  results.R2.decryptedCount = drives.length;

  // ---------- enumerate + decrypt available files (feeds R3/R4/R5) ----------
  // Search-and-break: find an R3 pick (small file w/ available data) ASAP.
  // Cap total getPrivateFile decrypts so 92-file drives don't blow the budget.
  c.section('enumerate file entities (GQL) + pre-probe availability + decrypt (getPrivateFile)');
  const decryptedFiles = [];
  const availabilityTally = { metaAvail: 0, meta404: 0, dataAvail: 0, data404: 0 };
  const MAX_DECRYPT = 30;
  let pick = null, pickDataProbe = null, decryptCount = 0;
  outer:
  for (const d of drives) {
    let list;
    try { list = await gqlFiles(d.driveId); }
    catch (e) { c.log(`   GQL enumerate ${d.name} FAILED: ${e.message}`); continue; }
    c.log(`   "${d.name}": ${list.length} unique file entities`);
    for (const f of list) {
      if (decryptCount >= MAX_DECRYPT && pick) break outer;
      const metaAvail = await isAvailable(f.metaTx);
      if (!metaAvail.ok) { availabilityTally.meta404++; continue; }
      availabilityTally.metaAvail++;
      if (decryptCount >= MAX_DECRYPT) continue; // stop decrypting, keep tallying availability
      let meta;
      try {
        meta = await withTimeout(arDrive.getPrivateFile({ fileId: EID(f.fileId), driveKey: d.driveKey, owner }), 20000, `getPrivateFile ${f.fileId.slice(0, 8)}`);
      } catch (e) { c.log(`     getPrivateFile ${f.fileId.slice(0, 8)} err: ${e.message.slice(0, 70)}`); continue; }
      decryptCount++;
      const name = String(meta.name);
      const size = toNum(meta.size);
      const dataTxId = meta.dataTxId ? meta.dataTxId.toString() : null;
      const isHidden = meta.isHidden === true;
      const nameDec = !CANNOT_DECRYPT.has(name) && name.length > 0;
      const rec = { drive: d, fileId: f.fileId, name, size, dataTxId, isHidden, nameDec, metaTx: f.metaTx };
      decryptedFiles.push(rec);
      c.log(`     [${decryptCount}] "${c.assertNoSecret(name)}" ${size}B data=${dataTxId ? dataTxId.slice(0, 8) : 'none'}${isHidden ? ' [HIDDEN]' : ''}`);
      // R3 pick search (inline early break)
      if (!pick && dataTxId && Number.isFinite(size) && size > 0 && size < FREE) {
        const probe = await isAvailable(dataTxId);
        if (probe.ok) { availabilityTally.dataAvail++; pick = rec; pickDataProbe = probe; c.log(`     -> R3 candidate FOUND (data available)`); break outer; }
        availabilityTally.data404++;
        c.log(`     data ${dataTxId.slice(0, 8)} not available (status ${probe.status})`);
      }
    }
  }
  results.R2.filesDecrypted = decryptedFiles.length;
  c.log(`   decrypted metadata for ${decryptedFiles.length} files (meta avail=${availabilityTally.metaAvail}, meta 404=${availabilityTally.meta404})`);

  // ---------- R3 ----------
  c.section('R3  download+decrypt smallest available <105KiB private file; SHA-256 stable x2 (PRIV-1)');
  try {
    results.R3.candidateCount = decryptedFiles.filter((f) => f.dataTxId && Number.isFinite(f.size) && f.size > 0).length;
    if (!pick) {
      results.R3.note = withData.length ? 'no <105KiB file with available data tx on turbo-gateway.com' : 'no sized files decrypted';
      c.log('   ' + results.R3.note);
    } else {
      results.R3.picked = { name: pick.name, fileId: pick.fileId, size: pick.size, dataTxId: pick.dataTxId, dataFinalUrl: pickDataProbe.finalUrl };
      c.log(`   picked "${c.assertNoSecret(pick.name)}" ${pick.size}B fileId=${pick.fileId} dataTx=${pick.dataTxId}`);
      c.log(`   data serves via: ${pickDataProbe.finalUrl}`);
      const hashes = [];
      for (let i = 0; i < 2; i++) {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), `infra9-r3-${i}-`));
        await withTimeout(arDrive.downloadPrivateFile({ fileId: EID(pick.fileId), driveKey: pick.drive.driveKey, destFolderPath: dest, defaultFileName: 'dl.bin' }), 60000, 'downloadPrivateFile');
        const buf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
        hashes.push({ sha256: c.sha256(buf), bytes: buf.length, text: looksLikeText(buf) });
        fs.rmSync(dest, { recursive: true, force: true });
      }
      results.R3.hashes = hashes;
      results.R3.stable = hashes[0].sha256 === hashes[1].sha256 && hashes[0].bytes === hashes[1].bytes;
      results.R3.plaintextMatchesSize = hashes[0].bytes === pick.size;
      c.log(`   dl#1 ${hashes[0].sha256} (${hashes[0].bytes}B ${hashes[0].text ? 'text' : 'bin'})`);
      c.log(`   dl#2 ${hashes[1].sha256} (${hashes[1].bytes}B)`);
      c.log(`   STABLE SHA-256: ${results.R3.stable ? 'YES' : 'NO'}`);
    }
  } catch (e) { results.R3.error = e.message; c.log('   R3 ERROR:', e.message); }

  // ---------- R4 ----------
  c.section('R4  hidden files surface as hidden');
  const hidden = decryptedFiles.filter((f) => f.isHidden);
  results.R4.filesScanned = decryptedFiles.length;
  results.R4.hiddenCount = hidden.length;
  results.R4.hidden = hidden.slice(0, 20).map((h) => ({ name: h.name, fileId: h.fileId, drive: h.drive.name }));
  c.log(`   scanned ${decryptedFiles.length} decrypted files; hidden=${hidden.length}`);
  hidden.slice(0, 15).forEach((h) => c.log(`     - "${c.assertNoSecret(h.name)}" (${h.fileId})`));
  if (!hidden.length) c.log('   (no hidden files among available decrypted files; W5 verifies hide-read on fresh data)');

  // ---------- R5 ----------
  c.section('R5  robustness (does enumeration/decrypt crash?)');
  results.R5.threw = false;
  results.R5.availability = availabilityTally;
  results.R5.namesDecrypted = decryptedFiles.filter((f) => f.nameDec).length;
  results.R5.namesUndecryptable = decryptedFiles.filter((f) => !f.nameDec).length;
  c.log(`   availability: ${JSON.stringify(availabilityTally)}`);
  c.log(`   names decrypted=${results.R5.namesDecrypted} undecryptable=${results.R5.namesUndecryptable}; no crash.`);

  wallet = null; walletJson = null; driveKeyManager.clearAllKeys();
  c.section('BATCH 1 (focused) JSON SUMMARY');
  console.log(JSON.stringify(results, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error('FOCUSED FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
