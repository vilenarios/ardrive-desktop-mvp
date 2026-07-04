/*
 * AUTHORIZED SINGLE PAID TURBO UPLOAD — proves the real paid path charges.
 *
 * Uploads ONE ~115 KiB (117760 B) incompressible file from the funded ikry
 * wallet to a fresh PUBLIC drive on ikry, via Turbo. The file is just over the
 * 107520 B free tier, so Turbo actually charges. We read ikry's Turbo balance
 * BEFORE and AFTER and prove it dropped by ~the quoted winc.
 *
 * MONEY DISCIPLINE:
 *   - HARD ABORT before upload if the quote exceeds 5e11 winc (0.5 credit).
 *   - Exactly ONE upload. No retry-upload on failure (each retry re-spends).
 *   - Never prints the JWK private fields or the password.
 *
 * turbo-gateway.com ONLY.  Run (from wt-main):
 *   node scripts/onchain-uat/paid-upload.js
 */
'use strict';
process.env.ARDRIVE_GATEWAY_HOST = 'turbo-gateway.com';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const c = require('./common');

const core = require('ardrive-core-js');
const { arDriveFactory, wrapFileOrFolder, EID, JWKWallet } = core;

const GATEWAY = 'turbo-gateway.com';
const FILE_BYTES = 117760;             // ~115 KiB, comfortably over the 107520 free-tier line
const HARD_CAP_WINC = 500000000000n;   // 0.5 credit runaway guard — ABORT above this
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const _ax = require('axios');
const axios = (_ax.default || _ax).create({ validateStatus: undefined, maxRedirects: 5, timeout: 20000 });

async function gqlById(txId) {
  const q = { query: `query{transactions(ids:["${txId}"]){edges{node{id owner{address} data{size} block{height}}}}}` };
  const { data } = await axios.post(`https://${GATEWAY}/graphql`, q, { headers: { 'content-type': 'application/json' } });
  const edges = data && data.data && data.data.transactions && data.data.transactions.edges;
  return edges && edges.length ? edges[0].node : null;
}

(async () => {
  const out = { gateway: GATEWAY, phase: 'init' };
  const { walletPath, password } = c.loadEnv();
  void password; // not needed for a public upload; loaded only to prove env wiring
  const arweave = c.initArweave();
  const { TurboFactory } = require('@ardrive/turbo-sdk');
  const tm = c.getTurboManager();

  // --- load funded ikry wallet (in-memory only; never logged) ---
  const jwk = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const address = await arweave.wallets.jwkToAddress(jwk);
  if (address !== c.IKRY_ADDRESS) throw new Error(`wallet address ${address} != expected ikry`);
  await tm.initialize(jwk);
  const arDrive = arDriveFactory({
    wallet: new JWKWallet(jwk),
    arweave,
    turboSettings: { turboUrl: new URL('https://upload.ardrive.io') },
  });

  const readUnauth = async () => String((await TurboFactory.unauthenticated().getBalance(c.IKRY_ADDRESS)).winc);
  const readAuth = async () => { try { return String((await tm.getBalance()).winc); } catch { return '(err)'; } };

  // --- Step 2: cost quote for the exact bytes + HARD CAP guard ---
  c.section('STEP 2  cost quote + hard-cap guard');
  const quote = await tm.getUploadCosts(FILE_BYTES);
  const quoteWinc = String(quote.winc);
  c.log(`   getUploadCosts(${FILE_BYTES}) = ${quoteWinc} winc (${(Number(quoteWinc) / 1e12).toFixed(9)} credits)`);
  if (BigInt(quoteWinc) > HARD_CAP_WINC) {
    console.log(JSON.stringify({ ABORT: 'quote exceeds hard cap', quoteWinc, hardCapWinc: HARD_CAP_WINC.toString() }, null, 2));
    process.exit(2);
  }
  if (FILE_BYTES <= c.FREE_TIER_BYTES) throw new Error('file not over free tier — would not prove paid path');
  c.log('   quote under hard cap; proceeding to the ONE authorized paid upload.');

  // --- Step 3: balance BEFORE ---
  c.section('STEP 3  ikry balance BEFORE');
  const beforeUnauth = await readUnauth();
  const beforeAuth = await readAuth();
  c.log(`   ikry BEFORE (unauth): ${beforeUnauth} winc`);
  c.log(`   ikry BEFORE (auth)  : ${beforeAuth} winc`);

  // --- Step 4: create a public drive (ArFS metadata is free-tier), then the PAID upload ---
  c.section('STEP 4  create public drive + upload the ~115 KiB file (PAID)');
  const dres = await arDrive.createPublicDrive({ driveName: `paid-proof-${Date.now()}` });
  const driveEntity = dres.created.find((e) => e.type === 'drive');
  const rootFolder = dres.created.find((e) => e.type === 'folder');
  const driveId = driveEntity.entityId.toString();
  const rootFolderId = rootFolder.entityId.toString();
  c.log(`   public drive created: driveId=${driveId} rootFolderId=${rootFolderId} (metadata free-tier)`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-'));
  const fileName = 'paid-proof-115kib.bin';
  const localPath = path.join(scratch, fileName);
  const payload = crypto.randomBytes(FILE_BYTES); // incompressible so Turbo can't undercount
  fs.writeFileSync(localPath, payload);
  const localSha = c.sha256(payload);
  c.log(`   payload: ${payload.length} bytes, sha256=${localSha}`);
  if (payload.length !== FILE_BYTES) throw new Error('payload size mismatch');

  c.log('   >>> uploading (single attempt, no retry) ...');
  const ures = await arDrive.uploadAllEntities({
    entitiesToUpload: [{ wrappedEntity: wrapFileOrFolder(localPath), destFolderId: EID(rootFolderId) }],
  });
  const fileEntity = ures.created.find((e) => e.type === 'file');
  const fileId = fileEntity.entityId.toString();
  const dataTxId = fileEntity.dataTxId && fileEntity.dataTxId.toString();
  const metaTxId = fileEntity.metadataTxId && fileEntity.metadataTxId.toString();
  c.log(`   uploaded: fileId=${fileId} dataTxId=${dataTxId} metaTxId=${metaTxId}`);

  // --- Step 5: balance AFTER (poll a few times for settlement; NO re-upload) ---
  c.section('STEP 5  ikry balance AFTER (settlement poll, read-only)');
  let afterUnauth = await readUnauth();
  for (let i = 0; i < 8 && BigInt(afterUnauth) >= BigInt(beforeUnauth); i++) {
    c.log(`   [+${i}] AFTER still ${afterUnauth}; waiting for settlement...`);
    await sleep(8000);
    afterUnauth = await readUnauth();
  }
  const afterAuth = await readAuth();
  const deltaWinc = (BigInt(beforeUnauth) - BigInt(afterUnauth)).toString();
  c.log(`   ikry AFTER (unauth): ${afterUnauth} winc`);
  c.log(`   ikry AFTER (auth)  : ${afterAuth} winc`);
  c.log(`   DELTA (spend): ${deltaWinc} winc (${(Number(deltaWinc) / 1e12).toFixed(9)} credits)`);

  // --- Step 6: GQL indexing of the data tx ---
  c.section('STEP 6  GQL-index check for data tx');
  let gqlNode = null;
  for (let i = 0; i < 12 && !gqlNode; i++) {
    gqlNode = await gqlById(dataTxId).catch(() => null);
    c.log(`   [+${i * 10}s] gql indexed=${!!gqlNode}${gqlNode ? ` (size=${gqlNode.data && gqlNode.data.size}, block=${gqlNode.block && gqlNode.block.height})` : ''}`);
    if (!gqlNode) await sleep(10000);
  }

  // --- optional download-verify (may be seeding-limited) ---
  let downloadVerify = { attempted: false };
  try {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-dl-'));
    downloadVerify.attempted = true;
    await sleep(5000);
    await arDrive.downloadPublicFile({ fileId: EID(fileId), destFolderPath: dest, defaultFileName: fileName });
    const dlBuf = fs.readFileSync(path.join(dest, fs.readdirSync(dest)[0]));
    fs.rmSync(dest, { recursive: true, force: true });
    downloadVerify = { attempted: true, ok: c.sha256(dlBuf) === localSha, bytes: dlBuf.length, dlSha256: c.sha256(dlBuf) };
  } catch (e) {
    downloadVerify.note = `download not yet servable (seeding lag): ${String(e.message).slice(0, 80)}`;
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  // --- verdict ---
  const dropped = BigInt(deltaWinc) > 0n;
  const closeToQuote = dropped && BigInt(deltaWinc) >= (BigInt(quoteWinc) * 8n) / 10n && BigInt(deltaWinc) <= (BigInt(quoteWinc) * 20n) / 10n;
  c.section('PAID-UPLOAD RESULT (raw for PM)');
  console.log(JSON.stringify({
    gateway: GATEWAY,
    fileBytes: FILE_BYTES,
    overFreeTier: FILE_BYTES > c.FREE_TIER_BYTES,
    costQuoteWinc: quoteWinc,
    costQuoteCredits: (Number(quoteWinc) / 1e12).toFixed(9),
    balanceBeforeWinc: beforeUnauth,
    balanceAfterWinc: afterUnauth,
    balanceBeforeAuth: beforeAuth,
    balanceAfterAuth: afterAuth,
    actualSpendWinc: deltaWinc,
    actualSpendCredits: (Number(deltaWinc) / 1e12).toFixed(9),
    driveId,
    rootFolderId,
    fileId,
    dataTxId,
    metaTxId,
    localSha256: localSha,
    gqlIndexed: !!gqlNode,
    gqlNode,
    downloadVerify,
    paidPathChargedCorrectly: dropped ? (closeToQuote ? 'YES' : 'YES(charged, delta not ~=quote)') : 'NO',
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('PAID-UPLOAD FATAL:', e && e.stack ? e.stack : e); process.exit(1); });
