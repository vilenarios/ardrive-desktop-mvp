/*
 * SYNC-5 / D-011 — REVERSIBLE hide->read-as-hidden->UNHIDE on Phil's REAL
 * ikry private drive, on an EXISTING seeded file. turbo-gateway.com ONLY.
 *
 * #1 RULE: REVERSIBILITY. The file is UN-HIDDEN at the end no matter what.
 * The unhide runs in a `finally` and is retry-hardened; if hide succeeded we
 * ALWAYS attempt restore, even if the read-verify errors/times out.
 *
 * MONEY SAFETY:
 *   - hide/unhide are metadata-only ArFS revisions: a tiny (<1KB) encrypted
 *     JSON data item, categorically inside Turbo's <100KiB free tier
 *     (CORE-4/batch2 W5 empirically showed 0 winc delta for hide).
 *   - getUploadCosts() CANNOT reflect the sub-100KB free subsidy (documented in
 *     batch2), so we enforce free-tier with a HARD post-write balance-delta
 *     assertion on the real ikry wallet: ikry winc must be UNCHANGED across
 *     each write. Any delta => reported LOUDLY.
 *   - ikry expected balance: 8503957651880 winc (asserted before + after).
 *
 * NEVER prints the JWK or password. Read-only creds from .env.
 *
 * Timing is bounded so the whole run finishes well under a single foreground
 * timeout (poll cap ~6 min + unhide) — no backgrounding, no Monitor.
 *
 * Run (from wt-main):
 *   node scripts/onchain-uat/batch3-hide-restore.js
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';

const fs = require('fs');
const path = require('path');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, ArweaveAddress, EID, readJWKFile } = core;
const _ax = require('axios');
const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 20000 });

const GATEWAY = 'turbo-gateway.com';
const DRIVE = '8d81a9db-b665-4040-866f-37336d324e14';
const FILE_ID = '27218f49-8fcd-48c5-ab91-4c39be7c2ea3'; // base.webp (seeded per R3)
const EXPECT_NAME = 'base.webp';

// poll budget (seconds from hide time) — kept conservative so the guaranteed
// unhide + final assertions comfortably fit one foreground timeout window.
const POLL_BUDGET_S = 360;
const POLL_INTERVAL_MS = 15000;
const PER_CALL_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(promise, ms, label) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms); });
  return Promise.race([promise.finally(() => clearTimeout(t)), to]);
}
async function retry(fn, label, tries = 5, baseMs = 1500) {
  let e;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      e = err;
      const w = baseMs * Math.pow(1.7, i);
      c.log(`   [retry] ${label} #${i + 1}/${tries}: ${String(err.message).slice(0, 70)}${i + 1 < tries ? ` wait ${Math.round(w)}ms` : ''}`);
      if (i + 1 < tries) await sleep(w);
    }
  }
  throw e;
}

// unauthenticated ikry balance (canonical spend proof)
async function ikryWinc(TurboFactory) {
  return String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
}

// Is the latest file-metadata tx that GQL returns == our hide/unhide tx?
// Light-weight "write is on-chain & indexing" signal (doesn't need data seed).
async function latestMetaTx(fileId) {
  const q = { query: `query{transactions(owners:["${c.IKRY_ADDRESS}"],tags:[{name:"File-Id",values:["${fileId}"]},{name:"Entity-Type",values:["file"]}],sort:HEIGHT_DESC,first:5){edges{node{id block{height}tags{name value}}}}}` };
  const { data } = await ax.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const edges = (data && data.data && data.data.transactions && data.data.transactions.edges) || [];
  return edges.map((e) => ({ id: e.node.id, height: e.node.block ? e.node.block.height : null }));
}

function txIdOf(res) {
  const created = (res && res.created) || [];
  const fileEnt = created.find((e) => e.type === 'file') || created[0] || {};
  return {
    metadataTxId: fileEnt.metadataTxId ? fileEnt.metadataTxId.toString() : null,
    bundledIn: fileEnt.bundledIn ? fileEnt.bundledIn.toString() : (fileEnt.bundleTxId ? fileEnt.bundleTxId.toString() : null),
  };
}

async function main() {
  const R = {
    gateway: GATEWAY, driveId: DRIVE, fileId: FILE_ID,
    initial: {}, hide: {}, verify: {}, unhide: {}, spend: {}, restoreStatus: 'UNKNOWN',
  };
  const { walletPath, password } = c.loadEnv();
  const arweave = c.initArweave();
  const { TurboFactory } = require('@ardrive/turbo-sdk');

  let wallet = readJWKFile(walletPath);
  let walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const dkm = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
  dkm.setWallet(walletJson);
  const arDrive = arDriveFactory({ wallet, arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  const owner = new ArweaveAddress(c.IKRY_ADDRESS);

  c.section('SETUP  derive drive key (app module) + snapshot ikry balance');
  const driveKey = await dkm.deriveKey(DRIVE, password);
  R.spend.ikryBefore = await ikryWinc(TurboFactory);
  R.spend.ikryExpected = c.IKRY_TURBO_BALANCE_EXPECTED;
  c.log(`   ikry balance BEFORE: ${R.spend.ikryBefore} winc (expected ${c.IKRY_TURBO_BALANCE_EXPECTED})`);
  if (R.spend.ikryBefore !== c.IKRY_TURBO_BALANCE_EXPECTED) {
    c.log('   !! ikry balance != expected snapshot — refusing to write. ABORT.');
    R.restoreStatus = 'NO-WRITE (balance precondition failed)';
    console.log('\n' + JSON.stringify(R, null, 2));
    process.exit(1);
  }

  c.section('STEP 1  read CURRENT metadata; confirm base.webp is NOT hidden');
  const meta0 = await retry(() => withTimeout(arDrive.getPrivateFile({ fileId: EID(FILE_ID), driveKey, owner }), PER_CALL_TIMEOUT_MS, 'getPrivateFile initial'), 'getPrivateFile initial', 5);
  R.initial = {
    name: String(meta0.name),
    size: Number(meta0.size.toString()),
    dataTxId: meta0.dataTxId ? meta0.dataTxId.toString() : null,
    isHidden: meta0.isHidden === true ? true : (meta0.isHidden === false ? false : 'absent/undefined'),
  };
  c.log(`   name="${c.assertNoSecret(R.initial.name)}" size=${R.initial.size}B isHidden=${R.initial.isHidden}`);
  if (R.initial.name !== EXPECT_NAME) {
    c.log(`   !! name mismatch (expected ${EXPECT_NAME}) — refusing to write. ABORT.`);
    R.restoreStatus = 'NO-WRITE (wrong file)';
    dkm.clearAllKeys();
    console.log('\n' + JSON.stringify(R, null, 2));
    process.exit(1);
  }
  if (meta0.isHidden === true) {
    c.log('   !! file is ALREADY hidden — not ours to flip. ABORT (no write, nothing to restore).');
    R.restoreStatus = 'NO-WRITE (file already hidden — untouched)';
    dkm.clearAllKeys();
    console.log('\n' + JSON.stringify(R, null, 2));
    process.exit(1);
  }

  let hideDone = false;

  try {
    // -------------------- STEP 2: HIDE --------------------
    c.section('STEP 2  HIDE base.webp (free-tier metadata revision)');
    const before = await ikryWinc(TurboFactory);
    const hideRes = await arDrive.hidePrivateFile({ fileId: EID(FILE_ID), driveKey });
    hideDone = true; // write submitted -> restore is now MANDATORY
    const after = await ikryWinc(TurboFactory);
    const hx = txIdOf(hideRes);
    R.hide = {
      metadataTxId: hx.metadataTxId, bundledIn: hx.bundledIn,
      ikryBefore: before, ikryAfter: after,
      freeTierBalanceDelta0: before === after,
      fees: hideRes.fees,
    };
    c.log(`   hide metadataTxId=${hx.metadataTxId}${hx.bundledIn ? ` bundledIn=${hx.bundledIn}` : ''}`);
    c.log(`   ikry ${before} -> ${after} winc  (free-tier delta 0: ${before === after ? 'YES' : 'NO !!'})`);
    if (before !== after) c.log('   !! NON-ZERO BALANCE DELTA ON HIDE — flagged. Proceeding to UNHIDE to restore.');

    // -------------------- STEP 3: VERIFY (best-effort, bounded) --------------------
    c.section('STEP 3  VERIFY read-as-hidden (bounded poll; PENDING-SEEDING allowed)');
    R.verify.gqlHideTxIndexed = false;
    R.verify.isHiddenObserved = 'PENDING-SEEDING';
    const t0 = Date.now();
    let attempt = 0;
    try {
      while ((Date.now() - t0) / 1000 < POLL_BUDGET_S) {
        attempt++;
        // (a) light GQL signal: is our hide tx the newest metadata tx?
        try {
          const metas = await latestMetaTx(FILE_ID);
          if (hx.metadataTxId && metas.some((m) => m.id === hx.metadataTxId)) {
            R.verify.gqlHideTxIndexed = true;
          }
        } catch (_) { /* ignore GQL blips */ }
        // (b) full read: fetch+decrypt latest metadata -> isHidden
        try {
          const m = await withTimeout(arDrive.getPrivateFile({ fileId: EID(FILE_ID), driveKey, owner }), PER_CALL_TIMEOUT_MS, 'getPrivateFile verify');
          const ih = m.isHidden === true;
          c.log(`   [poll ${attempt}] gqlHideIndexed=${R.verify.gqlHideTxIndexed} isHidden=${m.isHidden} (${Math.round((Date.now() - t0) / 1000)}s)`);
          if (ih) {
            R.verify.isHiddenObserved = true;
            R.verify.readAsHidden = 'YES';
            c.log('   READ-AS-HIDDEN: YES ✓ (isHidden === true)');
            break;
          }
        } catch (err) {
          // errors here typically = hide tx indexed but data not seeded yet
          c.log(`   [poll ${attempt}] read pending: ${String(err.message).slice(0, 60)} (${Math.round((Date.now() - t0) / 1000)}s)`);
        }
        if ((Date.now() - t0) / 1000 + POLL_INTERVAL_MS / 1000 >= POLL_BUDGET_S) break;
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (verr) {
      c.log('   verify loop error (non-fatal):', verr.message);
    }
    if (R.verify.isHiddenObserved !== true) {
      R.verify.readAsHidden = 'PENDING-SEEDING';
      R.verify.note = 'hide WRITE succeeded + on-chain; read-verify pending Turbo data seeding (6-15 min). Write is proven by tx id' + (R.verify.gqlHideTxIndexed ? ' + GQL-indexed as newest revision.' : '.');
      c.log(`   READ-AS-HIDDEN: PENDING-SEEDING (gqlHideTxIndexed=${R.verify.gqlHideTxIndexed}). Proceeding to UNHIDE.`);
    }
  } finally {
    // -------------------- STEP 4: UNHIDE (MANDATORY) --------------------
    if (hideDone) {
      c.section('STEP 4  UNHIDE base.webp (MANDATORY restore)');
      try {
        const before = await ikryWinc(TurboFactory);
        const unhideRes = await retry(() => arDrive.unhidePrivateFile({ fileId: EID(FILE_ID), driveKey }), 'unhidePrivateFile', 6, 2000);
        const after = await ikryWinc(TurboFactory);
        const ux = txIdOf(unhideRes);
        R.unhide = {
          metadataTxId: ux.metadataTxId, bundledIn: ux.bundledIn,
          ikryBefore: before, ikryAfter: after,
          freeTierBalanceDelta0: before === after,
          fees: unhideRes.fees,
        };
        R.restoreStatus = 'RESTORED (unhide write succeeded)';
        c.log(`   unhide metadataTxId=${ux.metadataTxId}${ux.bundledIn ? ` bundledIn=${ux.bundledIn}` : ''}`);
        c.log(`   ikry ${before} -> ${after} winc  (free-tier delta 0: ${before === after ? 'YES' : 'NO !!'})`);
        c.log('   RESTORE STATUS: file left UN-HIDDEN = YES ✓');
      } catch (uerr) {
        R.restoreStatus = 'FAILED-TO-RESTORE';
        R.unhideError = uerr.message;
        c.log('\n' + '#'.repeat(70));
        c.log('   !!!! CRITICAL: UNHIDE FAILED — FILE MAY REMAIN HIDDEN !!!!');
        c.log(`   driveId=${DRIVE}`);
        c.log(`   fileId =${FILE_ID} (base.webp)`);
        c.log(`   hide metadataTxId=${R.hide.metadataTxId}`);
        c.log(`   error: ${uerr.message}`);
        c.log('   MANUAL RESTORE: node scripts/onchain-uat/unhide-restore.js');
        c.log('#'.repeat(70) + '\n');
      }
    } else {
      R.restoreStatus = 'N/A (no hide write performed)';
    }
  }

  // -------------------- SPEND PROOF --------------------
  c.section('SPEND PROOF  ikry balance unchanged');
  R.spend.ikryAfter = await ikryWinc(TurboFactory);
  R.spend.ikryUnchanged = R.spend.ikryAfter === R.spend.ikryBefore && R.spend.ikryAfter === c.IKRY_TURBO_BALANCE_EXPECTED;
  c.log(`   ikry ${R.spend.ikryBefore} -> ${R.spend.ikryAfter} winc  (unchanged & == expected: ${R.spend.ikryUnchanged ? 'YES ✓' : 'NO ✗'})`);

  wallet = null; walletJson = null; dkm.clearAllKeys();
  c.section('BATCH 3 JSON SUMMARY');
  console.log(JSON.stringify(R, null, 2));
  process.exit(R.restoreStatus.startsWith('RESTORED') && R.spend.ikryUnchanged ? 0 : 2);
}

main().catch((e) => {
  console.error('BATCH3 FATAL:', e && e.stack ? e.stack : e);
  console.error('\n!!!! If a HIDE was submitted before this fatal, RESTORE with:');
  console.error('     node scripts/onchain-uat/unhide-restore.js');
  process.exit(1);
});
