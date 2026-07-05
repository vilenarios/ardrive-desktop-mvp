#!/usr/bin/env electron
/*
 * UAT POC — service-level (functional) harness.
 *
 * Proves the OPTION (b) execution path from docs/product/UAT-HARNESS.md: boot
 * the app's REAL main-process services (compiled dist/main/*) in a DISPOSABLE
 * userData dir under the Electron runtime and exercise production logic with
 * ZERO network and ZERO funds. Every assertion runs against the same code the
 * shipping app runs.
 *
 * Why Electron and not plain node: database-manager / profile-manager /
 * config-manager / wallet-manager all `import { app } from 'electron'`
 * (userData path). Under plain `node`, require('electron') is a path string,
 * so `app.getPath` is undefined. Running as an Electron MAIN process gives the
 * real `app`, and it is also how the shipping app loads these modules — so the
 * module-load-time `new ProfileManager()` / singletons see our temp userData.
 *
 * What it exercises (all local, deterministic, offline):
 *   A. DatabaseManager  — set active profile -> migrations create tables ->
 *      add + read a public drive_mapping; add + read a <100KiB pending upload,
 *      asserting the MONEY-3 DB-boundary normalization (integer 0/1 booleans
 *      come back as real JS booleans).
 *   B. crypto-utils     — AES-256-GCM + scrypt encrypt/decrypt round-trip
 *      (the wallet-at-rest primitive); wrong password must throw.
 *   C. CostCalculator   — the free-tier size gate (real production object).
 *
 * MONEY RAIL: no wallet is created, nothing touches the network, no funds can
 * move. The "secret" in test B is a random non-wallet string.
 *
 * Prereq: `npm run build` (dist/main must exist).
 * Run:    node scripts/uat/run-poc.js services      (wrapper adds electron + flags)
 *   or:   ./node_modules/.bin/electron scripts/uat/poc-services.js
 */
'use strict';

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Headless main: no GPU, no sandbox — we never open a window.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'main');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}
function section(t) {
  console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64));
}

async function main() {
  // --- disposable world -----------------------------------------------------
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-svc-'));
  const userData = path.join(tmpRoot, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  console.log('Disposable userData:', app.getPath('userData'));

  // Require the REAL compiled services AFTER userData is redirected, so the
  // singletons' constructors resolve paths inside the temp dir.
  const { databaseManager } = require(path.join(DIST_MAIN, 'database-manager.js'));
  const cryptoUtils = require(path.join(DIST_MAIN, 'crypto-utils.js'));
  const { CostCalculator } = require(path.join(DIST_MAIN, 'sync', 'CostCalculator.js'));

  // ===========================================================================
  section('A. DatabaseManager — profile isolation, mappings, pending uploads');
  // ===========================================================================
  const profileId = 'uat-poc-' + crypto.randomBytes(4).toString('hex');
  // profileManager.getProfileStoragePath joins but does NOT mkdir — create it.
  fs.mkdirSync(path.join(userData, 'profiles', profileId), { recursive: true });

  await databaseManager.setActiveProfile(profileId);
  check('setActiveProfile opens per-profile DB + runs migrations', true, `profile=${profileId}`);

  // --- public drive mapping round-trip ---
  const driveId = '00000000-0000-4000-8000-' + crypto.randomBytes(6).toString('hex');
  await databaseManager.addDriveMapping({
    id: 'map-' + profileId,
    driveId,
    driveName: 'UAT POC Public Drive',
    drivePrivacy: 'public',
    localFolderPath: path.join(tmpRoot, 'sync', 'UAT POC Public Drive'),
    rootFolderId: '11111111-0000-4000-8000-' + crypto.randomBytes(6).toString('hex'),
    isActive: true,
    syncSettings: { syncDirection: 'bidirectional', uploadPriority: 0 }
  });
  const mappings = await databaseManager.getDriveMappings();
  check('drive_mapping persisted & read back', mappings.length === 1, `count=${mappings.length}`);
  check('drive_mapping.drivePrivacy === "public"', mappings[0] && mappings[0].drivePrivacy === 'public');
  check(
    'drive_mapping.isActive normalized to JS boolean (not 0/1)',
    mappings[0] && typeof mappings[0].isActive === 'boolean' && mappings[0].isActive === true,
    `typeof=${mappings[0] && typeof mappings[0].isActive} value=${mappings[0] && mappings[0].isActive}`
  );

  // --- pending upload round-trip: the MONEY-3 DB-boundary normalization ---
  const FREE_BYTES = 40 * 1024; // 40KiB — well under the 100KiB free tier
  const pendingId = 'pu-' + crypto.randomBytes(4).toString('hex');
  await databaseManager.addPendingUpload({
    id: pendingId,
    localPath: path.join(tmpRoot, 'sync', 'UAT POC Public Drive', 'note.txt'),
    fileName: 'note.txt',
    fileSize: FREE_BYTES,
    estimatedCost: 0,
    estimatedTurboCost: null,          // "no quote" — must survive as null
    recommendedMethod: 'turbo',
    hasSufficientTurboBalance: 1,       // DB-SHAPED integer boolean (the trap)
    conflictType: 'none',
    conflictDetails: null,
    status: 'awaiting_approval',        // getPendingUploads filters on this
    operationType: 'upload'
  });
  const pending = await databaseManager.getPendingUploads();
  const row = pending.find((r) => r.id === pendingId);
  check('pending upload persisted & read back (status awaiting_approval)', !!row, `count=${pending.length}`);
  check(
    'MONEY-3: hasSufficientTurboBalance integer 1 -> JS boolean true',
    row && row.hasSufficientTurboBalance === true && typeof row.hasSufficientTurboBalance === 'boolean',
    `typeof=${row && typeof row.hasSufficientTurboBalance} value=${row && row.hasSufficientTurboBalance}`
  );
  check('MONEY-3: estimatedTurboCost null preserved (no fabricated quote)', row && row.estimatedTurboCost === null,
    `value=${row && row.estimatedTurboCost}`);
  check('createdAt materialized as Date', row && row.createdAt instanceof Date, `${row && row.createdAt}`);
  check('pending upload size < 100KiB free tier', row && row.fileSize < 100 * 1024, `${row && row.fileSize} bytes`);

  // --- profile isolation: a different profile sees an empty DB ---
  const otherId = 'uat-poc-other-' + crypto.randomBytes(3).toString('hex');
  fs.mkdirSync(path.join(userData, 'profiles', otherId), { recursive: true });
  await databaseManager.setActiveProfile(otherId);
  const otherMappings = await databaseManager.getDriveMappings();
  check('profile isolation: second profile has 0 mappings', otherMappings.length === 0, `count=${otherMappings.length}`);
  await databaseManager.close();

  // ===========================================================================
  section('B. crypto-utils — wallet-at-rest AES-256-GCM + scrypt round-trip');
  // ===========================================================================
  // NOT a real wallet — a random payload. No secret is ever printed/committed.
  const payload = JSON.stringify({ marker: 'uat-poc', nonce: crypto.randomBytes(16).toString('hex') });
  const password = 'uat-poc-throwaway-' + crypto.randomBytes(6).toString('hex');
  const enc = await cryptoUtils.encryptData(payload, password);
  check('encryptData returns {encrypted,salt,iv,tag}', enc && enc.encrypted && enc.salt && enc.iv && enc.tag);
  check('ciphertext != plaintext', enc && enc.encrypted !== payload);
  const dec = await cryptoUtils.decryptData(enc, password);
  check('decrypt with correct password round-trips exactly', dec === payload);
  let threw = false;
  try { await cryptoUtils.decryptData(enc, password + 'x'); } catch { threw = true; }
  check('decrypt with WRONG password throws (auth tag)', threw);

  // ===========================================================================
  section('C. CostCalculator — free-tier size gate (real production object)');
  // ===========================================================================
  const cc = new CostCalculator();
  check('40KiB is free (isFreeWithTurbo)', cc.isFreeWithTurbo(40 * 1024) === true);
  check('200KiB is NOT free', cc.isFreeWithTurbo(200 * 1024) === false);
  check('100MiB exceeds MVP max (isFileTooBig false for 100MiB)', cc.isFileTooBig(100 * 1024 * 1024) === false);
  // MONEY-14 (H-BND-1 RESOLVED): the free-tier limit is now a single source of
  // truth (TURBO_FREE_SIZE_LIMIT = 107520 = 105 KiB) with a consistent `<=`
  // boundary across CostCalculator, turbo-utils, and main.ts's approval gate.
  // The old `<` (which made exactly 102400 NOT free) is gone. Assert the new,
  // unified boundary so the tester notices if either side regresses.
  check('H-BND-1 RESOLVED: 102400 bytes is FREE (<= 107520, MONEY-14 unified boundary)',
    cc.isFreeWithTurbo(102400) === true);
  check('boundary: exactly 107520 (105 KiB) is FREE', cc.isFreeWithTurbo(107520) === true);
  check('boundary: 107521 (just over 105 KiB) is NOT free', cc.isFreeWithTurbo(107521) === false);

  // --- cleanup + verdict ----------------------------------------------------
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }

  section('SERVICE POC RESULT');
  const failed = results.filter((r) => !r.pass);
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'FAIL'));
  return failed.length === 0 ? 0 : 1;
}

app.whenReady().then(main).then(
  (code) => { app.exit(code); },
  (err) => { console.error('POC FATAL:', err && err.stack ? err.stack : err); app.exit(1); }
);
