/*
 * SYNC-5/D-011 READ-ONLY confirmation — decrypt the SPECIFIC hide revision tx
 * of base.webp and assert its decrypted metadata has isHidden === true.
 *
 * This is a PURE READ (no writes). The file was already restored (un-hidden)
 * by batch3-hide-restore.js, so there is ZERO reversibility risk here. Because
 * getPrivateFile only ever returns the LATEST revision (now the unhide), we
 * instead target the hide revision tx directly, fetch its (now-seeded)
 * encrypted metadata data item, derive the file key, decrypt, and read
 * isHidden — proving the hide revision reads-as-hidden on Phil's REAL file.
 *
 * turbo-gateway.com ONLY. Never prints JWK/password.
 * Run (from wt-main):  node scripts/onchain-uat/confirm-hide-read.js
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const fs = require('fs'), path = require('path');
const c = require('./common');
const { deriveFileKey, fileDecrypt } = require('ardrive-core-js/lib/utils/crypto');
const _ax = require('axios');
const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 25000 });

const GATEWAY = 'turbo-gateway.com';
const DRIVE = '8d81a9db-b665-4040-866f-37336d324e14';
const FILE_ID = '27218f49-8fcd-48c5-ab91-4c39be7c2ea3';
const HIDE_TX = 'oh2nV97rQpPYHlBrzfD0XVsU190ZHJRkqe5uhfhCKAI';   // isHidden=true revision
const UNHIDE_TX = '8nkPzEiG0bcRigAqsme3EYlwx4AWFiH_yKEF9OoETnw'; // isHidden=false revision (current)

// Poll budget kept within a single foreground window. Pure read: safe to stop anytime.
const BUDGET_S = 330, INTERVAL_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function txTags(txId) {
  const q = { query: `query{transaction(id:"${txId}"){id tags{name value}}}` };
  const { data } = await ax.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const node = data && data.data && data.data.transaction;
  if (!node) return null;
  return Object.fromEntries(node.tags.map((t) => [t.name, t.value]));
}
async function fetchData(txId) {
  const r = await ax.get(`https://${GATEWAY}/${txId}`, { responseType: 'arraybuffer' });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return Buffer.from(r.data);
}

async function decryptRevision(txId, fileKey) {
  const tags = await txTags(txId);
  if (!tags) throw new Error('tx not indexed yet');
  const cipherIV = tags['Cipher-IV'];
  if (!cipherIV) throw new Error('no Cipher-IV tag');
  const enc = await fetchData(txId); // throws if data not seeded
  const dec = await fileDecrypt(cipherIV, fileKey, enc);
  const txt = dec.toString('utf8');
  if (txt === 'Error') throw new Error('decrypt returned Error sentinel');
  return JSON.parse(txt);
}

(async () => {
  const R = { gateway: GATEWAY, driveId: DRIVE, fileId: FILE_ID, hideTx: HIDE_TX, unhideTx: UNHIDE_TX };
  const { walletPath, password } = c.loadEnv();
  const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const dkm = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'drive-key-manager.js')).driveKeyManager;
  dkm.setWallet(walletJson);
  const driveKey = await dkm.deriveKey(DRIVE, password);
  const fileKey = await deriveFileKey(FILE_ID, driveKey);

  c.section('CONFIRM  decrypt the HIDE revision tx directly; assert isHidden === true');
  c.log(`   hide tx  : ${HIDE_TX}`);
  const t0 = Date.now();
  let attempt = 0, done = false;
  while ((Date.now() - t0) / 1000 < BUDGET_S && !done) {
    attempt++;
    try {
      const meta = await decryptRevision(HIDE_TX, fileKey);
      R.hideRevision = { name: c.assertNoSecret(String(meta.name)), size: meta.size, isHidden: meta.isHidden === true ? true : (meta.isHidden === false ? false : 'absent') };
      c.log(`   [attempt ${attempt}] decrypted hide revision: name="${R.hideRevision.name}" isHidden=${meta.isHidden} (${Math.round((Date.now() - t0) / 1000)}s)`);
      R.readAsHidden = meta.isHidden === true ? 'YES' : 'NO';
      done = true;
    } catch (e) {
      c.log(`   [attempt ${attempt}] pending: ${String(e.message).slice(0, 60)} (${Math.round((Date.now() - t0) / 1000)}s)`);
      if ((Date.now() - t0) / 1000 + INTERVAL_MS / 1000 >= BUDGET_S) break;
      await sleep(INTERVAL_MS);
    }
  }
  if (!done) { R.readAsHidden = 'PENDING-SEEDING'; c.log('   hide revision data not seeded within window -> PENDING-SEEDING'); }

  // Also confirm current (unhide) revision reads as NOT hidden, when seeded (best-effort).
  c.section('CONFIRM  current (unhide) revision reads as NOT hidden (best-effort)');
  try {
    const meta = await decryptRevision(UNHIDE_TX, fileKey);
    R.unhideRevision = { name: c.assertNoSecret(String(meta.name)), isHidden: meta.isHidden === true ? true : (meta.isHidden === false ? false : 'absent') };
    c.log(`   unhide revision isHidden=${meta.isHidden} (restored state)`);
  } catch (e) {
    R.unhideRevision = { note: 'pending seeding: ' + String(e.message).slice(0, 50) };
    c.log(`   unhide revision pending: ${String(e.message).slice(0, 60)}`);
  }

  dkm.clearAllKeys();
  c.section('CONFIRM JSON');
  console.log(JSON.stringify(R, null, 2));
  process.exit(0);
})().catch((e) => { console.error('CONFIRM FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
