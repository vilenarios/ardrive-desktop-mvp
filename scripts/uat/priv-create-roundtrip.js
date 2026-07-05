#!/usr/bin/env node
/*
 * PRIV-SIG-1 CREATE→RE-UNLOCK ROUND-TRIP — the data-loss regression guard.
 * THROWAWAY WALLET ONLY. NO on-chain writes. NO spend. NO network.
 *
 * Reproduces, in pure local crypto, the exact invariant the fix restores:
 *   - CREATE caches the key `PrivateDriveKeyData.from(password, wallet)`
 *     produces (a **v2** VersionedDriveKey) — the app's create path
 *     (wallet-manager-secure.ts createPrivateDrive → driveKeyManager.cacheKey).
 *   - RE-UNLOCK later derives the key via the app's real
 *     DriveKeyManager.deriveKey with the DETECTED type (v2, the drive's true
 *     signature type).
 *
 * Proof (no on-chain drive needed — AES-256-GCM is authenticated, so a
 * successful decrypt with the re-unlock key cryptographically proves the keys
 * match):
 *   1. Encrypt a sample blob with the CREATE-cached key (driveEncrypt).
 *   2. Decrypt it with the RE-UNLOCK-derived (v2) key → MUST succeed → the
 *      created drive can be re-unlocked. (FIXED behavior.)
 *   3. Decrypt it with the OLD-BUG key (deriveKey ..., v1) → MUST fail GCM auth
 *      → the pre-fix create path (cached v1) could NEVER re-unlock the drive.
 *      (Data-loss reproduced and now avoided.)
 *
 * Uses a FRESH wallet generated at runtime — never the owner's wallet, never
 * touches the network. Secrets/keys never printed.
 *
 * Run: node scripts/uat/priv-create-roundtrip.js
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const path = require('path');
const crypto = require('crypto');
const core = require('ardrive-core-js');
const { PrivateDriveKeyData, DriveSignatureType, getDriveSignatureType, driveEncrypt, driveDecrypt } = core;
const { DriveKeyManager } = require(path.resolve(__dirname, '../../dist/main/drive-key-manager.js'));

const results = [];
const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };

async function main() {
  // FRESH THROWAWAY wallet — generated here, never persisted, never the owner's.
  const Arweave = require('arweave').default || require('arweave');
  const arweave = Arweave.init({ host: 'arweave.net', protocol: 'https', port: 443 });
  const wallet = await arweave.wallets.generate();
  const password = 'throwaway-roundtrip-' + crypto.randomBytes(6).toString('hex');

  // ---- CREATE side: exactly what SecureWalletManager.createPrivateDrive caches ----
  const pdkd = await PrivateDriveKeyData.from(password, wallet);
  const driveId = pdkd.driveId.toString();
  const createCachedKey = pdkd.driveKey;               // the FIX caches THIS
  const createdType = getDriveSignatureType(createCachedKey);
  check('drive created as v2 (PrivateDriveKeyData.from)', createdType === DriveSignatureType.v2, `createdType=v${createdType}`);

  // ---- RE-UNLOCK side: the app's real DriveKeyManager.deriveKey w/ detected type ----
  const dkm = new DriveKeyManager();
  dkm.setWallet(wallet);
  const reUnlockKey = await dkm.deriveKey(driveId, password, DriveSignatureType.v2); // detected type = v2
  const oldBugKey = await dkm.deriveKey(driveId, password, DriveSignatureType.v1);   // what the OLD create path cached

  // Key-level invariant
  check('re-unlock key === create-cached key (created drive is re-unlockable)',
    reUnlockKey.keyData.equals(createCachedKey.keyData), `keyLen=${reUnlockKey.keyData.length}`);
  check('OLD-BUG v1 key !== create-cached v2 key (pre-fix = permanent lockout)',
    !oldBugKey.keyData.equals(createCachedKey.keyData), 'v1 re-derivation would not match the v2 drive');

  // ---- End-to-end AES-256-GCM round-trip (authenticated decrypt = cryptographic proof) ----
  const blob = crypto.randomBytes(4096); // stand-in for private drive/file content
  const enc = await driveEncrypt(createCachedKey, blob);

  let reUnlockOk = false;
  try {
    const dec = await driveDecrypt(enc.cipherIV, reUnlockKey, enc.data);
    reUnlockOk = Buffer.isBuffer(dec) && dec.equals(blob);
  } catch { reUnlockOk = false; }
  check('CREATE→RE-UNLOCK round-trip: content encrypted at create decrypts after re-unlock', reUnlockOk, 'GCM auth + plaintext match');

  let oldBugFailsClosed = false;
  try {
    await driveDecrypt(enc.cipherIV, oldBugKey, enc.data);
    oldBugFailsClosed = false; // should NOT have decrypted
  } catch { oldBugFailsClosed = true; } // GCM auth failure = the pre-fix data-loss
  check('OLD-BUG (v1 re-derive) FAILS to decrypt the v2 drive content (data-loss reproduced, now avoided)', oldBugFailsClosed, 'GCM auth rejects wrong-type key');

  const failed = results.filter(r => !r.c);
  console.log('\n============ PRIV-SIG-1 CREATE→RE-UNLOCK ROUND-TRIP ============');
  console.log('Wallet: FRESH THROWAWAY (generated at runtime, never persisted). No network. No spend.');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('RESULT: ' + (failed.length === 0 ? 'ALL-PASS' : 'SEE-ABOVE'));
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
