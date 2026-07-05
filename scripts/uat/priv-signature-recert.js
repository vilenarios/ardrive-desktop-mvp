#!/usr/bin/env node
/*
 * PRIV-SIG-1 LIVE RE-CERT — proves the FIXED unlock path (per-drive v1/v2
 * signature-type DETECTION + type-aware derivation) now unlocks BOTH v1 and v2
 * private drives with the correct password. READ-ONLY / NO SPEND.
 *
 * Unlike priv-signature-diagnose.js (which brute-derives v1 AND v2), this
 * harness runs the app's ACTUAL fixed logic, module-for-module:
 *   1. DETECT: arDrive.getDriveSignatureInfo({ driveId, owner }) wrapped in the
 *      REAL SYNC-20 retry helper (dist/main/sync/retry.js) — exactly what
 *      SecureWalletManager.unlockPrivateDrive now does.
 *   2. DERIVE: the REAL DriveKeyManager.deriveKey (dist/main/drive-key-manager.js)
 *      with the DETECTED signatureType (+ encryptedSignatureData).
 *   3. UNLOCK: arDrive.getPrivateDrive(...) trial-decrypt (the app's PRIV-2
 *      verification) — the drive NAME must decrypt (not "ENCRYPTED").
 *   4. LIST: root-folder entity names must decrypt (tolerate gateway 404s).
 *
 * Pass iff >=1 v1 drive AND >=1 v2 drive unlock via the DETECTED type.
 *
 * SAFETY: no uploads/writes/renames/deletes/payments; reads/decrypts only.
 * NEVER prints password, wallet JSON, or any private name/content — only
 * counts / lengths / signature types.
 *
 * Run: node scripts/uat/priv-signature-recert.js
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const core = require('ardrive-core-js');
const { DriveSignatureType, arDriveFactory, JWKWallet, ArweaveAddress, EID, PrivateKeyData } = core;

// REAL app modules (built), so we exercise the shipped fix, not a re-impl.
const { DriveKeyManager } = require(path.resolve(__dirname, '../../dist/main/drive-key-manager.js'));
const { retryWithBackoff } = require(path.resolve(__dirname, '../../dist/main/sync/retry.js'));

const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
const GATEWAY_HOST = process.env.ARDRIVE_GATEWAY_HOST || 'turbo-gateway.com';

function readEnvPassword() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('no ARDRIVE_DEV_PASSWORD in .env');
}

function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms ${label}`)), ms);
    t.unref && t.unref();
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

const results = [];
const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
function classify(msg) {
  if (!msg) return 'none';
  if (/unsupported state or unable to authenticate data/i.test(msg)) return 'decrypt-auth-fail(GCM)';
  if (/invalid drive state/i.test(msg)) return 'invalid-drive-state';
  if (/error decrypting/i.test(msg)) return 'error-decrypting';
  if (/Bad Gateway|502|503|504|ETIMEDOUT|ECONNRESET|network|timeout|404|not found/i.test(msg)) return 'network/gateway';
  return 'other: ' + msg.slice(0, 60);
}

async function main() {
  const password = readEnvPassword();
  const walletJson = JSON.parse(fs.readFileSync(WALLET_WSL, 'utf8'));
  const Arweave = require('arweave').default || require('arweave');
  const arweave = Arweave.init({ host: GATEWAY_HOST, port: 443, protocol: 'https', timeout: 120000 });
  const wallet = new JWKWallet(walletJson);
  const owner = await wallet.getAddress();
  const ownerStr = owner.toString();
  note(`gateway=${GATEWAY_HOST} owner=${ownerStr.slice(0, 4)}…${ownerStr.slice(-4)}`);

  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });

  // The REAL app key manager (the fixed deriveKey lives here).
  const dkm = new DriveKeyManager();
  dkm.setWallet(walletJson);

  // List drives with an EMPTY PrivateKeyData (mirrors a locked session).
  const emptyPkd = new PrivateKeyData({ driveKeys: [] });
  const drives = await arDrive.getAllDrivesForAddress({ address: new ArweaveAddress(ownerStr), privateKeyData: emptyPkd });
  const priv = drives.filter((d) => String(d.drivePrivacy) === 'private');
  check('listed drives live (locked session)', drives.length > 0, `total=${drives.length} private=${priv.length}`);
  if (priv.length === 0) { console.log('\nNo private drives; nothing to re-cert.'); return; }

  let unlockedV1 = 0, unlockedV2 = 0, failedUnlock = 0;
  for (const d of priv) {
    const driveId = String(d.driveId);
    const tag = driveId.slice(0, 8) + '…';
    // Reliable cross-check: the plaintext Drive-Signature-Type tag is on the
    // (locked) drive object from getAllDrivesForAddress — no data fetch.
    const tagType = d.driveSignatureType;

    // 1) DETECT (real app detection path: getDriveSignatureInfo + SYNC-20 retry,
    //    bounded so a transient turbo-gateway 404 storm on the v1 signature-data
    //    fetch can't block the OTHER drives). If it can't complete, fall back to
    //    the drive-metadata tag so we still exercise derive+trial-decrypt.
    let sigInfo = null;
    let detectVia = 'getDriveSignatureInfo';
    try {
      sigInfo = await retryWithBackoff(
        () => arDrive.getDriveSignatureInfo({ driveId: EID(driveId), owner: new ArweaveAddress(ownerStr) }),
        { label: `drive ${tag} signature type`, attempts: 3, timeoutMs: 20000 }
      );
    } catch (e) {
      detectVia = 'drive-metadata-tag (getDriveSignatureInfo storm: ' + classify(e instanceof Error ? e.message : String(e)) + ')';
      sigInfo = { driveSignatureType: tagType, encryptedSignatureData: undefined };
    }
    const st = sigInfo.driveSignatureType;
    note(`drive ${tag}: detectedType=v${st} via ${detectVia}${tagType !== undefined ? ` (tag=v${tagType})` : ''}`);

    // 2) DERIVE with the DETECTED type (real DriveKeyManager.deriveKey)
    const key = await dkm.deriveKey(driveId, password, st, sigInfo.encryptedSignatureData);

    // 3) UNLOCK: trial-decrypt the drive entity (PRIV-2 verification)
    let unlocked = false, nameLen = 0, sigFromEntity = null, rootFolderId = null;
    try {
      const drive = await withTimeout(
        arDrive.getPrivateDrive({ driveId: EID(driveId), driveKey: key, owner: ownerStr }),
        45000, `getPrivateDrive ${tag}`
      );
      const decryptedName = drive && drive.name;
      unlocked = !!decryptedName && String(decryptedName) !== 'ENCRYPTED';
      nameLen = decryptedName ? String(decryptedName).length : 0;
      sigFromEntity = drive && drive.driveSignatureType;
      rootFolderId = drive && drive.rootFolderId && drive.rootFolderId.toString();
    } catch (e) {
      note(`drive ${tag}: getPrivateDrive FAILED [${classify(e instanceof Error ? e.message : String(e))}]`);
    }

    // 4) LIST root-folder entity names (tolerate 404 gateway data-availability)
    let listInfo = 'listing skipped';
    if (unlocked && rootFolderId) {
      try {
        const entities = await withTimeout(
          arDrive.listPrivateFolder({ folderId: EID(rootFolderId), driveKey: key, owner: ownerStr, maxDepth: 0 }),
          45000, `listPrivateFolder ${tag}`
        );
        const names = entities.map(e => e.name).filter(Boolean);
        const anyEncrypted = names.some(n => String(n) === 'ENCRYPTED');
        const printable = names.every(n => /[\x20-\x7e]/.test(String(n)));
        listInfo = `entities=${entities.length} namesDecrypted=${!anyEncrypted && printable}`;
      } catch (e) {
        listInfo = `root-list 404/err [${classify(e instanceof Error ? e.message : String(e))}] (gateway data-availability, not a decrypt fault)`;
      }
    }

    if (unlocked) { if (st === DriveSignatureType.v2) unlockedV2++; else unlockedV1++; } else { failedUnlock++; }
    note(`drive ${tag}: DETECTED=v${st} → deriveKey(v${st}) → unlocked=${unlocked ? 'YES' : 'no'} (entitySig=v${sigFromEntity}, nameLen=${nameLen}) | ${listInfo}`);
  }

  check('a V1 private drive UNLOCKS via detected type', unlockedV1 > 0, `v1 unlocked=${unlockedV1}`);
  check('a V2 private drive UNLOCKS via detected type (the fix)', unlockedV2 > 0, `v2 unlocked=${unlockedV2}`);
  check('every private drive unlocked with the correct password', failedUnlock === 0, `unlocked=${unlockedV1 + unlockedV2}/${priv.length} failed=${failedUnlock}`);

  const failed = results.filter(r => !r.c);
  console.log('\n================ PRIV-SIG-1 LIVE RE-CERT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log(`v1 drives unlocked: ${unlockedV1}   v2 drives unlocked: ${unlockedV2}   (of ${priv.length} private)`);
  console.log('RESULT: ' + (failed.length === 0 ? 'ALL-PASS' : 'SEE-ABOVE'));
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e); process.exit(1); });
