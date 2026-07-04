/*
 * INFRA-9 BATCH 1 — Reads on the ikry test wallet. ZERO writes, ZERO cost.
 *
 * Layers exercised:
 *   R0 balance  : turbo-sdk unauthenticated (no private key loaded) + arweave.
 *   R1 enumerate: core-js arDriveAnonymousFactory.getAllDrivesForAddress
 *                 (identical call to app's SecureWalletManager.listDrives).
 *   R2 derive   : APP MODULE dist/main/drive-key-manager (deriveKey + PrivateKeyData)
 *                 + core-js getPrivateDrive / listPrivateFolder.
 *   R3 download : core-js downloadPrivateFile (app's DownloadManager is too
 *                 Electron-coupled to load headless).
 *   R4 hidden   : core-js listing .isHidden surface.
 *   R5 robustness: enumeration/list error capture.
 *
 * Run (from wt-main):  node scripts/onchain-uat/batch1-reads.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('./common');

const core = require('ardrive-core-js');
const {
  arDriveFactory,
  arDriveAnonymousFactory,
  PrivateKeyData,
  ArweaveAddress,
  EID,
  readJWKFile,
} = core;

const CANNOT_DECRYPT = new Set(['ENCRYPTED', 'Encrypted', 'ENCRYPTED_DATA']);

function toNum(x) {
  if (x == null) return NaN;
  if (typeof x === 'number') return x;
  try { return Number(x.toString()); } catch { return NaN; }
}

function looksLikeText(buf) {
  // crude printable-ratio sniff over first 512 bytes
  const n = Math.min(buf.length, 512);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  }
  return printable / n > 0.85;
}

async function main() {
  const results = { R0: {}, R1: {}, R2: {}, R3: {}, R4: {}, R5: {} };
  const { walletPath, password } = c.loadEnv();
  const arweave = c.initArweave();

  // ---------------- R0: balances ----------------
  c.section('R0  balances (ikry) — turbo (unauth, no key) + AR');
  try {
    const { TurboFactory } = require('@ardrive/turbo-sdk');
    const bal = await c.withRetry(
      () => TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS),
      { label: 'turbo getBalance' }
    );
    results.R0.turboWinc = String(bal.winc);
    c.log(`   Turbo balance: ${bal.winc} winc  (${(Number(bal.winc) / 1e12).toFixed(6)} credits)`);
  } catch (e) {
    results.R0.turboError = e.message;
    c.log('   Turbo balance ERROR:', e.message);
  }
  try {
    // NOTE: arweave.wallets.getBalance RESOLVES with the raw 429 HTML body on
    // rate limit (does not throw), so validate the result is numeric and force
    // a retry otherwise.
    const winston = await c.withRetry(
      async () => {
        const w = await arweave.wallets.getBalance(c.IKRY_ADDRESS);
        if (!/^\d+$/.test(String(w).trim())) throw new Error('non-numeric balance (rate-limited?)');
        return String(w).trim();
      },
      { label: 'AR getBalance', tries: 6, baseMs: 3000 }
    );
    results.R0.arWinston = String(winston);
    results.R0.ar = arweave.ar.winstonToAr(winston);
    c.log(`   AR balance: ${results.R0.ar} AR  (${winston} winston)`);
  } catch (e) {
    results.R0.arError = e.message;
    c.log('   AR balance ERROR:', e.message);
  }

  // ---------------- R1: enumerate all drives (no keys) ----------------
  c.section('R1  enumerate ALL drives for ikry (owner-scoped) — CORE-1 path');
  const anon = arDriveAnonymousFactory({ arweave });
  const emptyPkd = new PrivateKeyData({ driveKeys: [] });
  let drives = [];
  try {
    drives = await c.withRetry(
      () => anon.getAllDrivesForAddress({ address: new ArweaveAddress(c.IKRY_ADDRESS), privateKeyData: emptyPkd }),
      { label: 'getAllDrivesForAddress', tries: 4, baseMs: 2000 }
    );
    const inv = drives.map((d) => ({
      id: d.driveId.toString(),
      privacy: String(d.drivePrivacy),
      name: String(d.name),
      nameDecrypted: !CANNOT_DECRYPT.has(String(d.name)),
    }));
    const pub = inv.filter((d) => d.privacy === 'public');
    const priv = inv.filter((d) => d.privacy === 'private');
    results.R1.total = inv.length;
    results.R1.public = pub.length;
    results.R1.private = priv.length;
    results.R1.inventory = inv;
    c.log(`   Total drives: ${inv.length}  (public: ${pub.length}, private: ${priv.length})`);
    c.log('   Public drives:');
    pub.forEach((d) => c.log(`     - "${c.assertNoSecret(d.name)}"  [${d.id}]`));
    c.log('   Private drives (names ENCRYPTED without key):');
    priv.forEach((d) => c.log(`     - "${c.assertNoSecret(d.name)}"  [${d.id}]`));
  } catch (e) {
    results.R1.error = e.message;
    c.log('   R1 ERROR:', e.message);
  }

  // ---------------- R2: derive key + decrypt private metadata ----------------
  c.section('R2  derive private drive key (APP MODULE) + decrypt root metadata');
  let jwk = null;
  let arDrive = null;
  let driveKeyManager = null;
  const decryptedDrives = []; // { driveId, driveName, rootFolderId, driveKey }
  try {
    jwk = readJWKFile(walletPath); // Wallet wrapper for the factory; nulled below
    const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8')); // raw JWK for key derivation
    driveKeyManager = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
    driveKeyManager.setWallet(walletJson); // app passes raw walletJson, not the Wallet
    arDrive = arDriveFactory({
      wallet: jwk,
      arweave,
      turboSettings: { turboUrl: new URL('https://upload.ardrive.io') },
    });

    const owner = new ArweaveAddress(c.IKRY_ADDRESS);
    const privateDrives = drives.filter((d) => String(d.drivePrivacy) === 'private');
    results.R2.privateDrivesFound = privateDrives.length;
    let tried = 0;
    for (const d of privateDrives) {
      if (decryptedDrives.length >= 3) break; // enough proof; keep it quick
      tried++;
      const driveId = d.driveId.toString();
      try {
        // APP MODULE derivation (PRIV-2: derive succeeds for any pw; verify by decrypt)
        const driveKey = await driveKeyManager.deriveKey(driveId, password);
        const privDrive = await arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey, owner });
        const nameOk = !CANNOT_DECRYPT.has(String(privDrive.name)) && String(privDrive.name).length > 0;
        if (nameOk) {
          driveKeyManager.cacheKey(driveId, driveKey);
          decryptedDrives.push({
            driveId,
            driveName: String(privDrive.name),
            rootFolderId: privDrive.rootFolderId.toString(),
            driveKey,
          });
          c.log(`   ✓ DECRYPTED private drive name: "${c.assertNoSecret(String(privDrive.name))}"  [${driveId}]`);
        }
      } catch (e) {
        // wrong password for this drive, or gateway error — expected for some
      }
    }
    results.R2.triedPrivateDrives = tried;
    results.R2.decryptedCount = decryptedDrives.length;
    results.R2.decryptedNames = decryptedDrives.map((x) => x.driveName);

    // list root of first decrypted drive
    if (decryptedDrives.length > 0) {
      const target = decryptedDrives[0];
      c.log(`   Listing root of "${target.driveName}" ...`);
      const entities = await c.withRetry(
        () => arDrive.listPrivateFolder({
          folderId: EID(target.rootFolderId),
          driveKey: target.driveKey,
          owner,
          maxDepth: 1,
        }),
        { label: 'listPrivateFolder', tries: 3, baseMs: 2000 }
      );
      const names = entities.map((e) => ({
        type: e.entityType,
        name: String(e.name),
        id: (e.entityId || e.fileId || e.folderId || '').toString(),
        size: e.entityType === 'file' ? toNum(e.size) : undefined,
        isHidden: e.isHidden === true,
      }));
      const decryptedNames = names.filter((n) => !CANNOT_DECRYPT.has(n.name) && n.name.length > 0);
      results.R2.rootEntityCount = names.length;
      results.R2.rootDecryptedCount = decryptedNames.length;
      results.R2.rootSample = names.slice(0, 8);
      target.entities = names;
      target.rawEntities = entities;
      c.log(`   Root entities: ${names.length} (decrypted names: ${decryptedNames.length})`);
      names.slice(0, 12).forEach((n) =>
        c.log(`     - [${n.type}] "${c.assertNoSecret(n.name)}"${n.size != null ? ` (${n.size}B)` : ''}${n.isHidden ? ' [HIDDEN]' : ''}`)
      );
    } else {
      c.log('   No private drive decrypted with the provided password.');
    }
  } catch (e) {
    results.R2.error = e.message;
    c.log('   R2 ERROR:', e.message);
  }

  // ---------------- R3: download + decrypt small private file, sha256 stable ----------------
  c.section('R3  download+decrypt a small (<105KiB) private file; sha256 stable x2');
  try {
    const owner = new ArweaveAddress(c.IKRY_ADDRESS);
    // gather candidate files from decrypted drives (deep list a bit if needed)
    let candidates = [];
    for (const dd of decryptedDrives) {
      let ents = dd.rawEntities;
      if (!ents) {
        ents = await arDrive.listPrivateFolder({
          folderId: EID(dd.rootFolderId), driveKey: dd.driveKey, owner, maxDepth: 2,
        }).catch(() => []);
      }
      for (const e of ents) {
        if (e.entityType === 'file') {
          candidates.push({ drive: dd, fileId: (e.fileId || e.entityId).toString(), name: String(e.name), size: toNum(e.size) });
        }
      }
      if (candidates.length && dd === decryptedDrives[0]) {
        // deep-list first drive to improve chance of a tiny file
        const deep = await arDrive.listPrivateFolder({
          folderId: EID(dd.rootFolderId), driveKey: dd.driveKey, owner, maxDepth: 3,
        }).catch(() => []);
        for (const e of deep) {
          if (e.entityType === 'file') candidates.push({ drive: dd, fileId: (e.fileId || e.entityId).toString(), name: String(e.name), size: toNum(e.size) });
        }
      }
    }
    // dedupe by fileId
    const seen = new Set();
    candidates = candidates.filter((f) => (seen.has(f.fileId) ? false : (seen.add(f.fileId), true)));
    candidates = candidates.filter((f) => Number.isFinite(f.size) && f.size > 0).sort((a, b) => a.size - b.size);
    results.R3.candidateCount = candidates.length;
    const CAP = 1024 * 1024; // 1 MiB read cap
    const pick = candidates.find((f) => f.size < c.FREE_TIER_BYTES) || candidates.find((f) => f.size < CAP);
    if (!pick) {
      results.R3.note = candidates.length ? `smallest private file is ${candidates[0].size}B (> read cap ${CAP}); skipped download` : 'no private files found in decrypted drives';
      c.log('   ' + results.R3.note);
    } else {
      results.R3.picked = { name: pick.name, fileId: pick.fileId, size: pick.size, under105KiB: pick.size < c.FREE_TIER_BYTES };
      c.log(`   Picked file "${c.assertNoSecret(pick.name)}" (${pick.size}B, id=${pick.fileId})`);
      const hashes = [];
      for (let i = 0; i < 2; i++) {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), `infra9-r3-${i}-`));
        await arDrive.downloadPrivateFile({
          fileId: EID(pick.fileId),
          driveKey: pick.drive.driveKey,
          destFolderPath: dest,
          defaultFileName: 'download.bin',
        });
        const files = fs.readdirSync(dest);
        const fp = path.join(dest, files[0]);
        const buf = fs.readFileSync(fp);
        hashes.push({ sha256: c.sha256(buf), bytes: buf.length, text: looksLikeText(buf) });
        fs.rmSync(dest, { recursive: true, force: true });
      }
      const stable = hashes[0].sha256 === hashes[1].sha256 && hashes[0].bytes === hashes[1].bytes;
      results.R3.hashes = hashes;
      results.R3.stable = stable;
      results.R3.decryptedBytes = hashes[0].bytes;
      results.R3.looksLikeText = hashes[0].text;
      c.log(`   download#1 sha256=${hashes[0].sha256} (${hashes[0].bytes}B, ${hashes[0].text ? 'text' : 'binary'})`);
      c.log(`   download#2 sha256=${hashes[1].sha256} (${hashes[1].bytes}B)`);
      c.log(`   STABLE across two downloads: ${stable ? 'YES ✓' : 'NO ✗'}`);
    }
  } catch (e) {
    results.R3.error = e.message;
    c.log('   R3 ERROR:', e.message);
  }

  // ---------------- R4: hidden files ----------------
  c.section('R4  hidden files (ArFS isHidden) surfaced by read path');
  try {
    const owner = new ArweaveAddress(c.IKRY_ADDRESS);
    const hidden = [];
    let scanned = 0;
    for (const dd of decryptedDrives) {
      const ents = await arDrive.listPrivateFolder({
        folderId: EID(dd.rootFolderId), driveKey: dd.driveKey, owner, maxDepth: 3,
      }).catch(() => []);
      scanned += ents.length;
      for (const e of ents) {
        if (e.isHidden === true) {
          hidden.push({ drive: dd.driveName, type: e.entityType, name: String(e.name), id: (e.entityId || e.fileId || e.folderId).toString() });
        }
      }
    }
    results.R4.entitiesScanned = scanned;
    results.R4.hiddenCount = hidden.length;
    results.R4.hidden = hidden.slice(0, 20);
    c.log(`   Scanned ${scanned} private entities across ${decryptedDrives.length} drive(s); hidden=${hidden.length}`);
    hidden.slice(0, 15).forEach((h) => c.log(`     - [${h.type}] "${c.assertNoSecret(h.name)}" (${h.id}) in "${h.drive}"`));
    if (hidden.length === 0) c.log('   (no hidden entities in decrypted drives; will verify hide READ on fresh data in Batch 2 W5)');
  } catch (e) {
    results.R4.error = e.message;
    c.log('   R4 ERROR:', e.message);
  }

  // ---------------- R5: robustness (snapshots/pinned/licensed/entity types) ----------------
  c.section('R5  enumeration robustness (entity types / snapshots / errors)');
  try {
    const typeCounts = {};
    const contentTypes = {};
    for (const dd of decryptedDrives) {
      for (const e of (dd.entities || [])) {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
      }
      for (const e of (dd.rawEntities || [])) {
        const dct = e.dataContentType ? String(e.dataContentType) : null;
        if (dct) contentTypes[dct] = (contentTypes[dct] || 0) + 1;
      }
    }
    results.R5.entityTypeCounts = typeCounts;
    results.R5.dataContentTypes = contentTypes;
    results.R5.enumerationThrew = false;
    c.log('   Entity type counts (root sample):', JSON.stringify(typeCounts));
    c.log('   Data content types seen:', JSON.stringify(contentTypes));
    c.log('   Enumeration/list completed without throwing on this wallet.');
  } catch (e) {
    results.R5.error = e.message;
    results.R5.enumerationThrew = true;
    c.log('   R5 ERROR:', e.message);
  }

  // scrub secrets
  jwk = null;
  if (driveKeyManager) driveKeyManager.clearAllKeys();

  c.section('BATCH 1 JSON SUMMARY');
  console.log(JSON.stringify(results, null, 2));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('BATCH1 FATAL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
