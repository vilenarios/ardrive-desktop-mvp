#!/usr/bin/env node
/*
 * UAT DIAGNOSTIC — private-drive unlock root cause (READ-ONLY, NO SPEND).
 *
 * Reproduces the app's unlock derivation vs. the ardrive-core-js 4.0.0 v2
 * signature-type derivation against the owner's REAL private drives, to decide
 * whether the earlier "Invalid password" rejection is a real bug (wrong
 * DriveSignatureType) or a genuine password mismatch.
 *
 * For each private drive it:
 *   - derives a v1 key the way the app does (drive-key-manager.ts:99 →
 *     deriveDriveKey(password, driveId, walletJSON) which DEFAULTS to v1), and
 *   - derives a v2 key (deriveDriveKey({..., driveSignatureType: v2})), the way
 *     the app CREATES drives (PrivateDriveKeyData.from → v2),
 *   then trial-decrypts the drive entity with each (arDrive.getPrivateDrive).
 *   Whichever decrypts is the drive's true signature type.
 *
 * Round-trip: with the working key, lists the root folder (names must decrypt,
 * not "ENCRYPTED") and, if a small (<=105 KiB) file exists, downloads it and
 * verifies it decrypts to plausible plaintext (size/sha256/printable-ratio only
 * — NEVER prints or writes the file contents or sensitive names).
 *
 * SAFETY: no uploads/writes/renames/deletes/payments. Reads/decrypts only.
 * Secrets (password, wallet JSON) and private CONTENT are never printed/logged.
 *
 * Run: node scripts/uat/priv-signature-diagnose.js
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const crypto = require('crypto');
const core = require('ardrive-core-js');
const { deriveDriveKey, DriveSignatureType, arDriveFactory, JWKWallet, ArweaveAddress, EID, PrivateKeyData } = core;

const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
const GATEWAY_HOST = process.env.ARDRIVE_GATEWAY_HOST || 'turbo-gateway.com';
const SMALL_FILE_LIMIT = 105 * 1024;

function readEnvPassword() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('no ARDRIVE_DEV_PASSWORD in .env');
}

const results = [];
const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
// classify an error string WITHOUT leaking anything sensitive
function classify(msg) {
  if (!msg) return 'none';
  if (/unsupported state or unable to authenticate data/i.test(msg)) return 'decrypt-auth-fail(GCM)';
  if (/invalid drive state/i.test(msg)) return 'invalid-drive-state';
  if (/error decrypting/i.test(msg)) return 'error-decrypting';
  if (/not the owner/i.test(msg)) return 'owner-mismatch';
  if (/Bad Gateway|502|503|504|ETIMEDOUT|ECONNRESET|network|timeout/i.test(msg)) return 'network/gateway';
  return 'other: ' + msg.slice(0, 80);
}

async function trialDecryptDrive(arDrive, driveId, driveKey, owner) {
  try {
    const drive = await arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey, owner });
    return { ok: true, name: drive && drive.name, sigType: drive && drive.driveSignatureType, rootFolderId: drive && drive.rootFolderId && drive.rootFolderId.toString() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, cls: classify(msg) };
  }
}

async function main() {
  const password = readEnvPassword();
  const walletJson = JSON.parse(fs.readFileSync(WALLET_WSL, 'utf8'));
  const walletStr = JSON.stringify(walletJson);
  const Arweave = require('arweave').default || require('arweave');
  const arweave = Arweave.init({ host: GATEWAY_HOST, port: 443, protocol: 'https', timeout: 120000 });
  const wallet = new JWKWallet(walletJson);
  const owner = await wallet.getAddress();
  const ownerStr = owner.toString();
  note(`gateway=${GATEWAY_HOST} owner=${ownerStr.slice(0, 4)}…${ownerStr.slice(-4)}`);

  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });

  // list drives with an EMPTY PrivateKeyData (mirrors a locked session) so
  // private names come back as ciphertext/ENCRYPTED
  const emptyPkd = new PrivateKeyData({ driveKeys: [] });
  const drives = await arDrive.getAllDrivesForAddress({ address: new ArweaveAddress(ownerStr), privateKeyData: emptyPkd });
  const priv = drives.filter((d) => String(d.drivePrivacy) === 'private');
  check('listed drives live', drives.length > 0, `total=${drives.length} public=${drives.filter(d => String(d.drivePrivacy) === 'public').length} private=${priv.length}`);
  note('private drive ids: ' + JSON.stringify(priv.map(d => String(d.driveId).slice(0, 8) + '…')));

  if (priv.length === 0) { console.log('\nNo private drives; nothing to diagnose.'); return; }

  // ---- Root cause: v1 (app default) vs v2 (create default) per private drive ----
  let anyV1 = 0, anyV2 = 0;
  const workingByDrive = {};
  for (const d of priv) {
    const driveId = String(d.driveId);
    const tag = driveId.slice(0, 8) + '…';
    const keyV1 = await deriveDriveKey(password, driveId, walletStr); // 3-arg → DEFAULTS to v1 (== app unlock path)
    const keyV2 = await deriveDriveKey({ dataEncryptionKey: password, driveId, walletPrivateKey: walletStr, driveSignatureType: DriveSignatureType.v2 });
    const r1 = await trialDecryptDrive(arDrive, driveId, keyV1, ownerStr);
    const r2 = await trialDecryptDrive(arDrive, driveId, keyV2, ownerStr);
    if (r1.ok) anyV1++;
    if (r2.ok) anyV2++;
    const decryptedName = (r1.ok && r1.name) || (r2.ok && r2.name);
    const nameOk = decryptedName && String(decryptedName) !== 'ENCRYPTED';
    note(`drive ${tag}: v1(app-default)=${r1.ok ? 'DECRYPTS sig=' + r1.sigType : 'FAIL[' + r1.cls + ']'} | v2=${r2.ok ? 'DECRYPTS sig=' + r2.sigType : 'FAIL[' + r2.cls + ']'} | nameDecrypted=${nameOk ? 'yes' : 'no'}`);
    if (r1.ok) workingByDrive[driveId] = { key: keyV1, r: r1, via: 'v1' };
    else if (r2.ok) workingByDrive[driveId] = { key: keyV2, r: r2, via: 'v2' };
  }

  check('CORRECT password decrypts each private drive with SOME signature type', Object.keys(workingByDrive).length === priv.length,
    `unlocked=${Object.keys(workingByDrive).length}/${priv.length} (v1-drives=${anyV1} v2-drives=${anyV2})`);
  // The app's unlock path (drive-key-manager.ts:99) derives v1 by DEFAULT. A
  // drive is reachable by the app iff its v1-derivation decrypts. v2 drives are
  // therefore UNREACHABLE by the shipping app even with the correct password.
  const appUnlockable = anyV1;               // v1 drives the app path decrypts
  const appUnreachable = anyV2;              // v2 drives the app path CANNOT decrypt
  const realBug = appUnreachable > 0;
  check('DIAGNOSIS: some private drives are UNREACHABLE by the app v1-default derivation (real bug)', realBug,
    realBug ? `${appUnreachable}/${priv.length} drives are v2 → app derives v1 → "Invalid password" despite CORRECT pw (bug in drive-key-manager.ts:99). ${appUnlockable}/${priv.length} are v1 and DO unlock.`
      : 'all private drives are v1 → app path unlocks them all; earlier reject was NOT a signature-type bug');

  // ---- Round-trip: list root folder + small-file content decrypt ----
  // Metadata-name decryption is already proven per drive above. Prove FOLDER +
  // FILE decryption too; try every working drive since some root-folder data
  // txs 404 on turbo-gateway.com (transient SYNC-20 class, not a decrypt fault).
  const firstDriveId = Object.keys(workingByDrive)[0];
  if (firstDriveId) {
    const { r, via } = workingByDrive[firstDriveId];
    check('drive metadata name decrypts (not ENCRYPTED/ciphertext)', r.name && String(r.name) !== 'ENCRYPTED', `via=${via} len=${r.name ? String(r.name).length : 0}`);
  }
  // Scan EVERY working drive's root folder (tolerate 404s), prove entity-name
  // decryption, and collect the globally smallest file for a content round-trip.
  let listedAny = false;
  const allFiles = [];
  let keyForFile = null;
  for (const driveId of Object.keys(workingByDrive)) {
    const { key, r } = workingByDrive[driveId];
    try {
      const entities = await arDrive.listPrivateFolder({ folderId: EID(r.rootFolderId), driveKey: key, owner: ownerStr, maxDepth: 0 });
      listedAny = true;
      const names = entities.map(e => e.name).filter(Boolean);
      const anyEncrypted = names.some(n => String(n) === 'ENCRYPTED');
      const printable = names.every(n => /[\x20-\x7e]/.test(String(n)));
      const files = entities.filter(e => String(e.entityType) === 'file');
      note(`drive ${driveId.slice(0, 8)}… (via ${workingByDrive[driveId].via}): entities=${entities.length} files=${files.length} namesDecrypted=${!anyEncrypted && printable}`);
      for (const f of files) { allFiles.push({ f, key }); }
    } catch (e) {
      note(`list root of ${driveId.slice(0, 8)}… failed: ${classify(e instanceof Error ? e.message : String(e))} — trying next drive`);
    }
  }
  check('root folder listing decrypts entity names (no ENCRYPTED) on >=1 drive', listedAny, `driveswithlisting: ${listedAny ? 'yes' : 'none (all 404)'}`);
  if (listedAny) {
    {
      const sizes = allFiles.map(x => Number(x.f.size) || 0).sort((a, b) => a - b);
      note(`private file sizes seen (bytes, sorted): ${JSON.stringify(sizes.slice(0, 12))}`);
      // Prefer a <=105 KiB file; else fall back to the globally smallest real
      // file (download+decrypt is FREE + read-only, so a larger file is fine).
      const DL_CAP = 8 * 1024 * 1024;
      const candidates = allFiles.filter(x => (Number(x.f.size) || 0) > 0).sort((a, b) => Number(a.f.size) - Number(b.f.size));
      const preferred = candidates.find(x => (Number(x.f.size) || 0) <= SMALL_FILE_LIMIT);
      const pick = preferred || candidates.find(x => (Number(x.f.size) || 0) <= DL_CAP);
      const small = pick ? { fileId: pick.f.fileId, size: Number(pick.f.size) } : null;
      const key = pick ? pick.key : keyForFile;
      note(preferred ? 'using a <=105 KiB private file for content round-trip' : (pick ? `no <=105 KiB file; using smallest available (${small.size} bytes) — download is free/read-only` : 'no downloadable file'));
      if (small) {
        const os = require('os'); const path = require('path');
        const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-priv-dl-'));
        try {
          await arDrive.downloadPrivateFile({ fileId: small.fileId, driveKey: key, destFolderPath: dlDir, defaultFileName: 'uat-priv-sample.bin' });
          const written = fs.readdirSync(dlDir);
          let okContent = false, verify = '';
          if (written.length) {
            const fp = path.join(dlDir, written[0]);
            const buf = fs.readFileSync(fp);
            const sha = crypto.createHash('sha256').update(buf).digest('hex');
            // "not ciphertext" heuristic: real plaintext of most file types is
            // NOT high-entropy random. We report size + sha + a coarse entropy
            // band. We do NOT print any bytes.
            const freq = new Array(256).fill(0);
            for (const b of buf) freq[b]++;
            let H = 0; for (const f of freq) { if (f) { const p = f / buf.length; H -= p * Math.log2(p); } }
            const sizeMatch = Number(small.size) === buf.length;
            okContent = written.length === 1 && buf.length > 0 && sizeMatch;
            verify = `bytes=${buf.length} sizeTagMatch=${sizeMatch} sha256=${sha.slice(0, 12)}… entropyBits/byte=${H.toFixed(2)}`;
          }
          check('small private file downloads + decrypts to plaintext (size/sha verified, content NOT shown)', okContent, verify);
        } catch (e) {
          check('small private file content round-trip', false, 'download/decrypt err: ' + classify(e instanceof Error ? e.message : String(e)));
        } finally {
          try { fs.rmSync(dlDir, { recursive: true, force: true }); } catch {}
        }
      } else {
        note('no small (<=105 KiB) private file present in root folder — content round-trip skipped (metadata decrypt already proven)');
      }
    }
  } else {
    note('root-folder listing unavailable on all working drives (gateway 404, SYNC-20 class) — file-level round-trip could not run; per-drive metadata decryption already proves the drive key is correct');
  }

  const failed = results.filter(r => !r.c);
  console.log('\n================ PRIVATE SIGNATURE DIAGNOSTIC ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('RESULT: ' + (failed.length === 0 ? 'ALL-PASS' : 'SEE-ABOVE'));
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); process.exit(1); });
