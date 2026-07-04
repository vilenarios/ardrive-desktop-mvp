/*
 * INFRA-9 BATCH 1 R2-R5 (focused probe) — private drive READ verification.
 *
 * Seeded with ikry's 4 private drive IDs (from the raw-GQL enumeration) to skip
 * core-js's expensive getAllDrivesForAddress (which is unusable while arweave.net
 * 429-rate-limits this IP). Runs the real core-js private read path through a
 * configurable gateway (ARDRIVE_GATEWAY_HOST, default ar-io.dev).
 *
 * Layers:
 *   R2 derive  : APP MODULE dist/main/drive-key-manager (deriveKey) + core-js getPrivateDrive
 *   R2 list    : core-js listPrivateFolder
 *   R3 download: core-js downloadPrivateFile (sha256 stable x2)
 *   R4 hidden  : core-js listing .isHidden
 *   R5 robust  : entity-type / content-type tallies + error capture
 *
 * Run: ARDRIVE_GATEWAY_HOST=ar-io.dev node scripts/onchain-uat/batch1-private-probe.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, ArweaveAddress, EID, readJWKFile } = core;

const PRIVATE_DRIVE_IDS = [
  'cce4300f-1a69-4480-bc28-75917151fda9',
  '7cea4056-3cd0-47ab-85f6-529fcfbe4c53',
  'cabca9d6-7305-4fe5-b522-404b0c63aae3',
  '8d81a9db-b665-4040-866f-37336d324e14',
];
const CANNOT_DECRYPT = new Set(['ENCRYPTED', 'Encrypted', 'ENCRYPTED_DATA']);
function toNum(x) { try { return Number(x.toString()); } catch { return NaN; } }
function looksLikeText(buf) {
  const n = Math.min(buf.length, 512); if (!n) return false; let p = 0;
  for (let i = 0; i < n; i++) { const b = buf[i]; if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) p++; }
  return p / n > 0.85;
}

async function main() {
  const results = { gateway: c.gatewayHost(), R2: {}, R3: {}, R4: {}, R5: {} };
  const { walletPath, password } = c.loadEnv();
  const arweave = c.initArweave();
  c.log('gateway:', c.gatewayHost());

  // readJWKFile -> Wallet wrapper (for the factory). driveKeyManager.setWallet
  // needs the RAW parsed JWK (matches app: it passes walletJson, not the Wallet).
  let wallet = readJWKFile(walletPath);
  let walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const driveKeyManager = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
  driveKeyManager.setWallet(walletJson);
  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  const owner = new ArweaveAddress(c.IKRY_ADDRESS);

  // ---------- R2: derive key + decrypt drive + list root ----------
  c.section('R2  derive key (APP MODULE) + decrypt private drive metadata + list root');
  const decrypted = [];
  for (const driveId of PRIVATE_DRIVE_IDS) {
    try {
      const driveKey = await driveKeyManager.deriveKey(driveId, password); // app module
      const drive = await c.withRetry(() => arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey, owner }), { label: `getPrivateDrive ${driveId.slice(0, 8)}`, tries: 3, baseMs: 2000 });
      const nameOk = !CANNOT_DECRYPT.has(String(drive.name)) && String(drive.name).length > 0;
      c.log(`   drive ${driveId.slice(0, 8)}: name="${c.assertNoSecret(String(drive.name))}" decrypted=${nameOk}`);
      if (nameOk) {
        driveKeyManager.cacheKey(driveId, driveKey);
        decrypted.push({ driveId, name: String(drive.name), rootFolderId: drive.rootFolderId.toString(), driveKey });
      }
    } catch (e) {
      c.log(`   drive ${driveId.slice(0, 8)}: FAILED (${e.message.slice(0, 90)})`);
    }
  }
  results.R2.decryptedCount = decrypted.length;
  results.R2.decryptedNames = decrypted.map((d) => d.name);

  const allEntities = []; // gathered for R3/R4/R5
  for (const d of decrypted) {
    try {
      const ents = await c.withRetry(() => arDrive.listPrivateFolder({ folderId: EID(d.rootFolderId), driveKey: d.driveKey, owner, maxDepth: 2 }), { label: `listPrivateFolder ${d.name}`, tries: 3, baseMs: 2000 });
      d.entities = ents;
      const named = ents.map((e) => ({ type: e.entityType, name: String(e.name), id: (e.entityId || e.fileId || e.folderId || '').toString(), size: e.entityType === 'file' ? toNum(e.size) : undefined, isHidden: e.isHidden === true, drive: d, raw: e }));
      allEntities.push(...named);
      const decNames = named.filter((n) => !CANNOT_DECRYPT.has(n.name) && n.name.length);
      c.log(`   "${d.name}" root+children: ${named.length} entities (${decNames.length} decrypted names)`);
      named.slice(0, 10).forEach((n) => c.log(`     - [${n.type}] "${c.assertNoSecret(n.name)}"${n.size != null ? ` ${n.size}B` : ''}${n.isHidden ? ' [HIDDEN]' : ''}`));
    } catch (e) {
      c.log(`   list "${d.name}" FAILED: ${e.message.slice(0, 120)}`);
      d.listError = e.message;
    }
  }
  results.R2.listErrors = decrypted.filter((d) => d.listError).map((d) => ({ name: d.name, error: d.listError }));

  // ---------- R3: download smallest private file, sha256 stable x2 ----------
  c.section('R3  download+decrypt smallest <105KiB private file; sha256 stable x2');
  try {
    let files = allEntities.filter((e) => e.type === 'file' && Number.isFinite(e.size) && e.size > 0);
    const seen = new Set(); files = files.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
    files.sort((a, b) => a.size - b.size);
    results.R3.candidateCount = files.length;
    const CAP = 1024 * 1024;
    const pick = files.find((f) => f.size < c.FREE_TIER_BYTES) || files.find((f) => f.size < CAP);
    if (!pick) { results.R3.note = files.length ? `smallest ${files[0].size}B > cap` : 'no files'; c.log('   ' + results.R3.note); }
    else {
      results.R3.picked = { name: pick.name, id: pick.id, size: pick.size, under105KiB: pick.size < c.FREE_TIER_BYTES };
      c.log(`   picked "${c.assertNoSecret(pick.name)}" ${pick.size}B id=${pick.id}`);
      const hashes = [];
      for (let i = 0; i < 2; i++) {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), `infra9-r3-${i}-`));
        await c.withRetry(() => arDrive.downloadPrivateFile({ fileId: EID(pick.id), driveKey: pick.drive.driveKey, destFolderPath: dest, defaultFileName: 'dl.bin' }), { label: 'downloadPrivateFile', tries: 3, baseMs: 2000 });
        const buf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
        hashes.push({ sha256: c.sha256(buf), bytes: buf.length, text: looksLikeText(buf) });
        fs.rmSync(dest, { recursive: true, force: true });
      }
      results.R3.hashes = hashes;
      results.R3.stable = hashes[0].sha256 === hashes[1].sha256 && hashes[0].bytes === hashes[1].bytes;
      c.log(`   dl#1 ${hashes[0].sha256} (${hashes[0].bytes}B ${hashes[0].text ? 'text' : 'bin'})`);
      c.log(`   dl#2 ${hashes[1].sha256} (${hashes[1].bytes}B)`);
      c.log(`   STABLE: ${results.R3.stable ? 'YES ✓' : 'NO ✗'}`);
    }
  } catch (e) { results.R3.error = e.message; c.log('   R3 ERROR:', e.message); }

  // ---------- R4: hidden files ----------
  c.section('R4  hidden files (isHidden) surfaced by read path');
  const hidden = allEntities.filter((e) => e.isHidden);
  results.R4.entitiesScanned = allEntities.length;
  results.R4.hiddenCount = hidden.length;
  results.R4.hidden = hidden.slice(0, 20).map((h) => ({ type: h.type, name: h.name, id: h.id, drive: h.drive.name }));
  c.log(`   scanned ${allEntities.length} entities; hidden=${hidden.length}`);
  hidden.slice(0, 15).forEach((h) => c.log(`     - [${h.type}] "${c.assertNoSecret(h.name)}" (${h.id})`));
  if (!hidden.length) c.log('   (no hidden entities among decrypted drives; W5 will verify hide READ on fresh data)');

  // ---------- R5: robustness ----------
  c.section('R5  robustness (entity/content-type tallies, snapshots, errors)');
  const typeCounts = {}, contentTypes = {};
  for (const e of allEntities) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
    const dct = e.raw && e.raw.dataContentType ? String(e.raw.dataContentType) : null;
    if (dct) contentTypes[dct] = (contentTypes[dct] || 0) + 1;
  }
  results.R5.entityTypeCounts = typeCounts;
  results.R5.dataContentTypes = contentTypes;
  results.R5.threw = false;
  c.log('   entity types:', JSON.stringify(typeCounts));
  c.log('   content types:', JSON.stringify(contentTypes));

  wallet = null; walletJson = null; driveKeyManager.clearAllKeys();
  c.section('BATCH 1 R2-R5 JSON SUMMARY');
  console.log(JSON.stringify(results, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error('PROBE FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
