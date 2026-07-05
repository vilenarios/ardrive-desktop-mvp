#!/usr/bin/env node
/*
 * UAT LIVE re-certification of SYNC-20 (gateway-404 resilience) — [SYNC-20].
 *
 * Proves, on the RUNNING built app, that the setup/sync path that used to HANG
 * on a transient turbo-gateway `Status: 404` (a just-created ArFS drive/tx not
 * yet indexed) now SELF-HEALS or fails gracefully, and that a free-tier upload
 * completes end-to-end with a real data tx that round-trips by hash.
 *
 * Uses a FRESH THROWAWAY wallet created via the app's OWN create-account
 * onboarding (local keygen) in a DISPOSABLE userData dir — the owner's real
 * wallet is NEVER loaded. Creating a drive on a brand-new wallet then syncing
 * immediately is exactly the "tx not yet indexed → 404" trigger.
 *
 * MONEY/SAFETY: free-tier ONLY. Test file <= 107520 B. A HARD money guard aborts
 * before approving if any pending row is not size-free. Never prints wallet
 * JSON / seed / password. turbo-gateway.com only.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-sync20-fresh-verify.js <shot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const os = require('os'); const path = require('path'); const crypto = require('crypto'); const https = require('https');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-sync20-'));
const FREE_LIMIT = 107520;
const GATEWAY = 'turbo-gateway.com';
const DRIVE_NAME = 'SYNC20-VERIFY';

const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
// Ephemeral per-run password for the disposable throwaway wallet — generated at
// runtime and never logged/committed (money/safety rule: no secrets in the repo).
const THROWAWAY_PW = 'uat-throwaway-' + crypto.randomBytes(9).toString('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name + ' ' + e.message); } }

// Fetch a tx body from the gateway, following redirects, with bounded retries
// (a fresh Turbo tx can 404 for a few seconds until indexed — that is fine,
// it is the very indexing delay SYNC-20 exists to survive).
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(httpGet(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-sync20-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata'); await fsp.mkdir(userDataDir, { recursive: true });
  const syncRoot = path.join(tmpRoot, 'ARDRIVE'); await fsp.mkdir(syncRoot, { recursive: true });
  // small deterministic free-tier test file (~40 KiB, well under 105 KiB)
  const fileBytes = Buffer.alloc(40 * 1024); for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 131 + 17) & 0xff;
  const fileHash = sha(fileBytes); const fileName = 'sync20-verify-' + Date.now() + '.bin';

  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: {
      ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir,
      ARDRIVE_DEV_MODE: 'false',                 // NO wallet autofill -> genuine fresh wallet
      ARDRIVE_GATEWAY_HOST: GATEWAY,
    }
  });

  // Capture MAIN-process stdout/stderr — this is where the SYNC-20 `[retry]`
  // warnings and gateway `Status: 404` / `Setup error:` logs surface (the money
  // shot: proof a 404 was observed and recovered).
  const mainLogs = [];
  try {
    const cp = app.process();
    cp.stdout && cp.stdout.on('data', d => mainLogs.push(d.toString()));
    cp.stderr && cp.stderr.on('data', d => mainLogs.push(d.toString()));
  } catch (e) { note('could not attach to main process stdio: ' + e.message); }

  // stub the native folder picker -> syncRoot
  await app.evaluate(async ({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, syncRoot);

  const rendererErrors = []; let page = null; let aborted = false;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const scanMain = (re) => mainLogs.filter(l => re.test(l));
  let dataTxId = null; let setupOutcome = 'unknown'; let hitStartingSyncEngine = false; let a404Observed = false; let a404Recovered = false;

  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });

    // ============ STEP 1: fresh create-account onboarding ============
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await shot(page, 's20-01-firstrun.png');
    await page.getByRole('button', { name: /Create New Account/ }).click();
    await page.getByRole('heading', { name: 'Secure Your Account' }).waitFor({ state: 'visible' });
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(THROWAWAY_PW);
    await pw.nth(1).fill(THROWAWAY_PW);
    await page.waitForTimeout(200);
    const createAcct = page.getByRole('button', { name: 'Create Account' });
    check('ONB create-account enabled with valid password', !(await createAcct.isDisabled()));
    await shot(page, 's20-02-password.png');
    await createAcct.click();
    // seed step — DO NOT screenshot (contains recovery phrase); just tick the gate
    await page.getByRole('heading', { name: 'Save Your Recovery Phrase' }).waitFor({ state: 'visible', timeout: 45000 });
    check('ONB recovery-phrase step reached (fresh wallet generated locally)', true);
    await page.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(150);
    const continueDrive = page.getByRole('button', { name: /Continue to Drive Setup/ });
    await continueDrive.click();
    note('local wallet created + persisted; routing to drive setup…');

    // ============ STEP 2: drive + sync-folder setup (the old hang point) ============
    await page.getByText(/Name Your Drive/i).first().waitFor({ state: 'visible', timeout: 60000 });
    check('reached drive-setup wizard on fresh wallet (no hang on drive.list)', true);
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill(DRIVE_NAME); await page.waitForTimeout(200);
    const chooseFolder = page.getByRole('button', { name: /Choose Folder/i }).first();
    if (await chooseFolder.count()) { await chooseFolder.click(); await page.waitForTimeout(800); }
    await shot(page, 's20-03-drive-setup.png');
    const toReview = page.getByRole('button', { name: /Continue to Review/i });
    await toReview.waitFor({ state: 'visible', timeout: 15000 });
    await toReview.click(); await page.waitForTimeout(600);
    await shot(page, 's20-04-review.png');

    // Complete Setup — this is where it USED to hang on "Starting sync engine…".
    const complete = page.getByRole('button', { name: /Complete Setup/i });
    await complete.waitFor({ state: 'visible', timeout: 15000 });
    await complete.click();
    note('clicked Complete Setup — drive-create on-chain (Turbo free) then sync start; watching for hang / recover / graceful-fail…');

    // Bounded observation window: worst-case sync:start retry is ~4x20s+backoff (~84s)
    // plus drive.create; poll up to 200s for a DEFINITIVE terminal state.
    const deadline = Date.now() + 200000;
    let openDash = null; let tryAgain = null; let gwError = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2500);
      const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      if (/Starting sync engine/i.test(bodyText)) hitStartingSyncEngine = true;
      // terminal: success screen
      if (await page.getByRole('button', { name: /Open Dashboard/i }).count()) { openDash = page.getByRole('button', { name: /Open Dashboard/i }).first(); setupOutcome = 'completed'; break; }
      // terminal: honest gateway error + Try Again (graceful fail)
      if (/Couldn't reach the Arweave gateway/i.test(bodyText) && await page.getByRole('button', { name: /Try Again/i }).count()) {
        tryAgain = page.getByRole('button', { name: /Try Again/i }).first(); gwError = true; setupOutcome = 'graceful-error'; break;
      }
    }
    // scan main-process logs for the 404 + retry money shot
    a404Observed = scanMain(/status:?\s*404|not found|request to gateway has failed/i).length > 0;
    a404Recovered = scanMain(/\[retry\]/i).length > 0;
    note('setup outcome=' + setupOutcome + ' | saw "Starting sync engine"=' + hitStartingSyncEngine + ' | 404 in main logs=' + a404Observed + ' | retry fired=' + a404Recovered);
    await shot(page, 's20-05-after-complete.png');

    check('STEP2: setup did NOT hang indefinitely (reached a terminal state)', setupOutcome === 'completed' || setupOutcome === 'graceful-error', 'outcome=' + setupOutcome);

    if (setupOutcome === 'graceful-error') {
      check('STEP2: honest "Couldn\'t reach the gateway" + Try Again shown (no silent spinner)', gwError, 'graceful');
      note('clicking Try Again (idempotent retry) to attempt recovery…');
      await tryAgain.click();
      // give the idempotent retry its own bounded window
      const d2 = Date.now() + 120000;
      while (Date.now() < d2) {
        await page.waitForTimeout(2500);
        if (await page.getByRole('button', { name: /Open Dashboard/i }).count()) { openDash = page.getByRole('button', { name: /Open Dashboard/i }).first(); setupOutcome = 'completed-after-retry'; break; }
      }
      a404Recovered = a404Recovered || scanMain(/\[retry\]/i).length > 0;
      check('STEP2: Try Again recovered to success screen', setupOutcome === 'completed-after-retry', 'outcome=' + setupOutcome);
      await shot(page, 's20-05b-after-tryagain.png');
    }

    if (openDash) { await openDash.click(); note('opened dashboard'); }
    await page.getByRole('tab', { name: /Overview/i }).first().waitFor({ state: 'visible', timeout: 60000 }).catch(() => note('dashboard Overview tab not seen (continuing via IPC)'));
    await page.waitForTimeout(2000);
    await shot(page, 's20-06-dashboard.png');

    // Ground-truth the created drive via IPC
    const mapping = await ev(async () => { const m = await window.electronAPI.driveMappings.getPrimary(); return m && m.success && m.data ? { name: m.data.driveName, driveId: m.data.driveId, path: m.data.localFolderPath } : null; }).catch(() => null);
    check('STEP2: drive mapping established (drive created on fresh wallet)', !!(mapping && mapping.path), mapping ? JSON.stringify({ name: mapping.name, id: String(mapping.driveId).slice(0, 8) + '…' }) : 'none');
    if (!mapping || !mapping.path) throw new Error('no drive mapping — cannot proceed to upload');

    // ============ STEP 3: free-tier upload end-to-end ============
    // ensure the watcher is active
    await ev(async () => { await window.electronAPI.sync.start().catch(() => {}); }).catch(() => {});
    let active = false;
    for (let i = 0; i < 20; i++) { const st = await ev(async () => { const s = await window.electronAPI.sync.getStatus().catch(() => null); return s && s.success && s.data ? !!s.data.isActive : (s && s.isActive) || false; }).catch(() => false); if (st) { active = true; break; } await sleep(2000); }
    check('STEP3: sync watcher active', active);

    await fsp.mkdir(mapping.path, { recursive: true });
    await fsp.writeFile(path.join(mapping.path, fileName), fileBytes);
    note('dropped ' + fileName + ' (' + fileBytes.length + ' B, sha=' + fileHash.slice(0, 12) + '…) into ' + mapping.path);

    let pending = [];
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      pending = await ev(async () => { const r = await window.electronAPI.uploads.getPending(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []);
      if (pending && pending.length) break;
      if (i === 5 || i === 15) { note('nudging detection with sync.manual()'); await ev(async () => { await window.electronAPI.sync.manual().catch(() => {}); }).catch(() => {}); }
    }
    check('STEP3/UPL: file detected -> pending upload row', pending && pending.length > 0, `pending=${pending ? pending.length : 0}`);
    const mine = (pending || []).filter(p => p.fileName === fileName);
    note('pending: ' + JSON.stringify((pending || []).map(p => ({ n: p.fileName, size: p.fileSize, cost: p.estimatedTurboCost }))));
    check('STEP3/APPR: my row is free-tier (<=107520)', mine.length === 1 && mine[0].fileSize <= FREE_LIMIT, mine[0] ? `size=${mine[0].fileSize}` : 'not found');

    // try to screenshot the Upload Queue UI showing Free
    const uq = page.getByRole('tab', { name: /Upload Queue/i }).first();
    if (await uq.count()) { await uq.click().catch(() => {}); await page.waitForTimeout(1500); await shot(page, 's20-07-upload-queue.png'); }
    const disp = await page.evaluate(() => { const b = document.body.textContent || ''; return { showsFree: /\bFree\b/i.test(b), showsInsufficient: /Insufficient/i.test(b) }; }).catch(() => ({}));
    note('upload-queue display: ' + JSON.stringify(disp));

    // 🚨 HARD MONEY GUARD
    const notFree = (pending || []).filter(p => !(p.fileSize <= FREE_LIMIT));
    if (notFree.length > 0 || disp.showsInsufficient) {
      aborted = true;
      check('🛑 MONEY GUARD: all pending rows FREE before approving', false, 'ABORTING: ' + JSON.stringify(notFree.map(p => ({ n: p.fileName, size: p.fileSize }))) + ' disp=' + JSON.stringify(disp));
    } else {
      check('🛑 MONEY GUARD: all pending rows FREE (safe to approve free-tier)', true, `rows=${pending.length}`);
      const upId = mine[0].id;
      const appr = await ev(async (id) => { const r = await window.electronAPI.uploads.approve(id); return r && r.success !== undefined ? { success: r.success, error: r.error } : { raw: JSON.stringify(r) }; }, upId).catch((e) => ({ error: String(e) }));
      note('approve(' + String(upId).slice(0, 8) + '…) -> ' + JSON.stringify(appr));

      // wait for completion + a dataTxId (proof it actually landed) — this is the
      // path that used to stall at `pending`.
      let completed = false; let lastStatuses = [];
      for (let i = 0; i < 60; i++) {
        await sleep(3000);
        const st = await ev(async () => {
          const p = await window.electronAPI.uploads.getPending().catch(() => null);
          const pend = p && p.success ? p.data : (Array.isArray(p) ? p : []);
          const u = await window.electronAPI.files.getUploads().catch(() => null);
          const ups = u && u.success ? u.data : (Array.isArray(u) ? u : []);
          return { pendingLeft: (pend || []).length, ups: (ups || []).map(x => ({ n: x.fileName, s: x.status, tx: x.dataTxId || x.transactionId || null })) };
        }).catch(() => ({ pendingLeft: -1, ups: [] }));
        lastStatuses = st.ups;
        const done = (st.ups || []).find(x => x.n === fileName && /complet|uploaded|success|synced|confirmed/i.test(x.s || '') && x.tx);
        if (done) { completed = true; dataTxId = done.tx; break; }
        if (i % 3 === 0) note('waiting upload… pendingLeft=' + st.pendingLeft + ' ups=' + JSON.stringify(st.ups));
      }
      check('STEP3/APPR: free-tier upload COMPLETED with a data tx id (no stall at pending)', completed && !!dataTxId, 'tx=' + (dataTxId ? String(dataTxId).slice(0, 12) + '…' : 'none') + ' statuses=' + JSON.stringify(lastStatuses));
      await shot(page, 's20-08-after-upload.png');

      // verify on Permaweb via IPC
      let onPermaweb = false;
      for (let i = 0; i < 8; i++) {
        const names = await ev(async (drv) => { const f = await window.electronAPI.drive.getPermawebFiles(drv, true); const arr = f && f.success ? f.data : (Array.isArray(f) ? f : []); return (arr || []).map(x => x.name); }, mapping.driveId).catch(() => []);
        if ((names || []).includes(fileName)) { onPermaweb = true; break; }
        await sleep(4000);
      }
      check('STEP3/PERM: uploaded file appears on Permaweb (IPC)', onPermaweb, 'looking for ' + fileName);

      // ============ STEP 4: download / hash round-trip ============
      if (dataTxId) {
        let roundTripped = false; let gotBytes = null; let last = '';
        for (let i = 0; i < 12; i++) {
          try { gotBytes = await httpGet('https://' + GATEWAY + '/' + dataTxId); if (gotBytes) break; }
          catch (e) { last = e.message; if (/404|HTTP 4|HTTP 5/i.test(e.message)) note('gateway not-yet-indexed (' + e.message + '), retrying…'); }
          await sleep(5000);
        }
        if (gotBytes) {
          const gotHash = sha(gotBytes);
          roundTripped = gotHash === fileHash && gotBytes.length === fileBytes.length;
          note('fetched ' + gotBytes.length + ' B from gateway, sha=' + gotHash.slice(0, 12) + '… (expected ' + fileHash.slice(0, 12) + '…)');
        } else { note('could not fetch tx from gateway: ' + last); }
        check('STEP4: data tx round-trips by SHA-256 from turbo-gateway.com', roundTripped, dataTxId ? 'tx=' + String(dataTxId).slice(0, 16) + '…' : '');
      } else {
        check('STEP4: data tx round-trips by SHA-256', false, 'no dataTxId to fetch');
      }
    }

    // throwaway wallet balance (informational — expected 0, stays 0)
    const bal = await ev(async () => { const b = await window.electronAPI.turbo.getBalance().catch(() => null); return b && b.success && b.data ? (b.data.winc || b.data.ar || JSON.stringify(b.data)) : (b ? JSON.stringify(b) : null); }).catch(() => null);
    note('throwaway wallet Turbo balance: ' + bal + ' (free-tier => no spend)');

    await app.close();
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 's20-ERROR.png'); } catch { /* best effort */ }
    try { await app.close(); } catch { /* best effort */ }
  }

  // main-log evidence summary (redacted: only classification, never raw seed/JSON)
  const l404 = scanMain(/status:?\s*404|request to gateway has failed/i);
  const lretry = scanMain(/\[retry\]/i);
  const lsse = scanMain(/starting sync engine/i);
  console.log('\n---- main-process log evidence ----');
  console.log('  "Starting sync engine" in main log:', lsse.length);
  console.log('  gateway-404 lines:', l404.length, l404.slice(0, 4).map(s => s.trim().slice(0, 140)));
  console.log('  [retry] lines   :', lretry.length, lretry.slice(0, 6).map(s => s.trim().slice(0, 140)));
  console.log('  "Setup error:" seen:', scanMain(/setup error:/i).length);

  const failed = results.filter(r => !r.c);
  console.log('\n================ SYNC-20 FRESH-WALLET RE-VERIFICATION ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}  ${aborted ? '(ABORTED at money guard)' : ''}`);
  console.log('setupOutcome        :', setupOutcome);
  console.log('saw Starting-sync   :', hitStartingSyncEngine);
  console.log('404 observed (main) :', a404Observed);
  console.log('retry fired (main)  :', a404Recovered || lretry.length > 0);
  console.log('data tx id          :', dataTxId || '(none)');
  console.log('test file sha256    :', fileHash);
  console.log('renderer errors     :', rendererErrors.length);
  if (rendererErrors.length) rendererErrors.slice(0, 8).forEach(e => console.log('   ! ' + e.slice(0, 160)));
  console.log('Screenshots in      :', SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
