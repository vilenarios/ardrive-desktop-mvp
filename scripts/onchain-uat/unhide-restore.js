/*
 * SAFETY NET — idempotent UN-HIDE of base.webp in Phil's ikry private drive.
 * Run this to restore if batch3-hide-restore.js ever leaves the file hidden.
 * Unconditionally issues unhidePrivateFile (harmless if already unhidden:
 * newest revision becomes/stays isHidden=false). Free-tier; asserts balance.
 * turbo-gateway.com ONLY. Never prints JWK/password.
 *
 * Run (from wt-main):  node scripts/onchain-uat/unhide-restore.js
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const fs = require('fs');
const path = require('path');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, EID, readJWKFile } = core;

const DRIVE = '8d81a9db-b665-4040-866f-37336d324e14';
const FILE_ID = '27218f49-8fcd-48c5-ab91-4c39be7c2ea3'; // base.webp

async function ikryWinc(TurboFactory) {
  return String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
}

(async () => {
  const { walletPath, password } = c.loadEnv();
  const arweave = c.initArweave();
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  const wallet = readJWKFile(walletPath);
  const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const dkm = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
  dkm.setWallet(walletJson);
  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  const driveKey = await dkm.deriveKey(DRIVE, password);

  const before = await ikryWinc(TurboFactory);
  c.log(`ikry BEFORE: ${before} winc`);
  const res = await arDrive.unhidePrivateFile({ fileId: EID(FILE_ID), driveKey });
  const after = await ikryWinc(TurboFactory);
  const fileEnt = (res.created || []).find((e) => e.type === 'file') || (res.created || [])[0] || {};
  c.log(`unhide metadataTxId=${fileEnt.metadataTxId ? fileEnt.metadataTxId.toString() : null}`);
  c.log(`ikry AFTER : ${after} winc  (delta 0: ${before === after ? 'YES' : 'NO !!'})`);
  c.log(`RESTORE: file UN-HIDDEN. ikry == expected: ${after === c.IKRY_TURBO_BALANCE_EXPECTED}`);
  dkm.clearAllKeys();
  process.exit(0);
})().catch((e) => { console.error('UNHIDE-RESTORE FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
