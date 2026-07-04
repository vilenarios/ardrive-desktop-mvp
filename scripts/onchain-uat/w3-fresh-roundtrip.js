/*
 * INFRA-9 W3 FRESH PRIVATE ROUND-TRIP (single process) — turbo-gateway.com ONLY.
 * Upload one <40KB private file on a fresh 0-balance wallet (free tier, net-zero),
 * then poll turbo-gateway.com until the metadata+data seed and download+decrypt+
 * SHA-256 match the exact uploaded bytes. Wallet stays in-memory (throwaway).
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const c = require('./common');
const core = require('ardrive-core-js');
const { arDriveFactory, wrapFileOrFolder, PrivateDriveKeyData, ArweaveAddress, EID, JWKWallet } = core;
const _ax = require('axios'); const axios = _ax.default || _ax;
const ax = axios.create({ validateStatus: undefined, maxRedirects: 5, timeout: 15000 });
const GATEWAY = 'turbo-gateway.com';
const DEADLINE_MS = 8.5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function avail(tx) { try { const r = await ax.get(`https://${GATEWAY}/${tx}`, { responseType: 'arraybuffer' }); return r.status === 200 && r.data && r.data.byteLength > 0; } catch { return false; } }
async function readWinc(tm) { try { return String((await tm.getBalance()).winc); } catch { return '0'; } }
async function latestMetaTx(fileId, address) {
  const q = { query: `query{transactions(owners:["${address}"],tags:[{name:"File-Id",values:["${fileId}"]}],first:3){edges{node{id}}}}` };
  const { data } = await ax.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const e = (data && data.data && data.data.transactions && data.data.transactions.edges) || [];
  return e.length ? e[0].node.id : null;
}
(async () => {
  const { password } = c.loadEnv();
  const arweave = c.initArweave();
  const tm = c.getTurboManager();
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  const ikryBefore = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'infra9-w3f-'));

  const jwk = await arweave.wallets.generate();
  const address = await arweave.wallets.jwkToAddress(jwk);
  const arDrive = arDriveFactory({ wallet: new JWKWallet(jwk), arweave, turboSettings: { turboUrl: new URL('https://upload.ardrive.io') } });
  await tm.initialize(jwk);
  const b0 = await readWinc(tm);
  c.log(`fresh ${address} balance=${b0} (expect 0)`);
  if (b0 !== '0') throw new Error('fresh wallet funded — abort');

  const pdd = await PrivateDriveKeyData.from(password, jwk);
  const dres = await arDrive.createPrivateDrive({ driveName: `infra9-w3f-${Date.now()}`, newPrivateDriveData: pdd });
  const rootFolderId = dres.created.find((e) => e.type === 'folder').entityId.toString();
  const driveKey = pdd.driveKey;

  const name = 'w3fresh.bin';
  const lp = path.join(scratch, name);
  const payload = Buffer.from('INFRA-9 fresh private round-trip\n' + crypto.randomBytes(10 * 1024).toString('hex') + '\n');
  fs.writeFileSync(lp, payload);
  const localHash = c.sha256(payload);
  const size = payload.length;
  const before = await readWinc(tm);
  const ures = await arDrive.uploadAllEntities({ entitiesToUpload: [{ wrappedEntity: wrapFileOrFolder(lp), destFolderId: EID(rootFolderId), driveKey }] });
  const after = await readWinc(tm);
  if (before !== after) throw new Error(`NET-SPEND ${before}->${after}`);
  const fe = ures.created.find((e) => e.type === 'file');
  const fileId = fe.entityId.toString();
  const dataTx = fe.dataTxId.toString();
  c.log(`uploaded fileId=${fileId} dataTx=${dataTx} size=${size}B localSha=${localHash} (balance ${before}->${after}, cost 0)`);
  const metaTx = await latestMetaTx(fileId, address).catch(() => null);
  c.log(`metadata tx=${metaTx}`);

  c.section(`poll seeding up to ${DEADLINE_MS / 60000} min`);
  const t0 = Date.now();
  let result = { pass: false };
  while (Date.now() - t0 < DEADLINE_MS) {
    const el = Math.round((Date.now() - t0) / 1000);
    const dOk = await avail(dataTx);
    const mOk = metaTx ? await avail(metaTx) : false;
    c.log(`   [+${el}s] data=${dOk} meta=${mOk}`);
    if (dOk && mOk) {
      try {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'w3f-dl-'));
        await arDrive.downloadPrivateFile({ fileId: EID(fileId), driveKey, destFolderPath: dest, defaultFileName: name });
        const buf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
        fs.rmSync(dest, { recursive: true, force: true });
        const dlHash = c.sha256(buf);
        result = { pass: dlHash === localHash && buf.length === size, fileId, dataTx, size, localHash, dlHash, bytes: buf.length };
        c.log(`   download sha256=${dlHash} == local ${localHash}? ${result.pass ? 'YES' : 'NO'}`);
        break;
      } catch (e) { c.log(`   download attempt failed: ${e.message.slice(0, 70)}; retry`); }
    }
    await sleep(15000);
  }
  if (!result.fileId) result = { pass: false, fileId, dataTx, note: 'data/metadata not servable within poll window (seeding lag)' };

  const ikryAfter = String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  c.section('W3 FRESH ROUND-TRIP RESULT');
  console.log(JSON.stringify({ gateway: GATEWAY, w3Fresh: result, spend: { freshBefore: b0, freshAfter: await readWinc(tm), ikryBefore, ikryAfter, ikryUnchanged: ikryAfter === ikryBefore && ikryAfter === c.IKRY_TURBO_BALANCE_EXPECTED } }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('W3FRESH FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
