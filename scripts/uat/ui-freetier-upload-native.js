#!/usr/bin/env node
/*
 * UAT LIVE free-tier upload round-trip on a NATIVE Linux filesystem — [UAT].
 *
 * Purpose: close the last live gap — prove a free-tier upload completes
 * end-to-end on the RUNNING built app, AND that chokidar's file-add watcher
 * FIRES for a dropped file. Prior UAT runs put the sync folder on a `/mnt/c`
 * 9p WSL mount, where native inotify does NOT deliver add events, so
 * `watcher.on('add')` never fired and getPending() stayed empty. That is an
 * ENVIRONMENT artifact (real users on native Windows/macOS get file events),
 * not a product bug. Here we pin BOTH the disposable userData dir AND the
 * sync folder to a NATIVE ext4/tmpfs path and assert the watcher fires.
 *
 * A fresh ArFS drive is not immediately indexed by the gateway, so the first
 * sync:start after create 404s (SYNC-20 retries, then reports a transient
 * gateway error). We therefore ACTIVELY self-heal: keep re-driving
 * Open-Dashboard / Try-Again / sync.start() until the watcher is ACTIVE (up to
 * ~13 min) — only then is the app-flow "does chokidar fire" test meaningful.
 *
 * FRESH THROWAWAY wallet only, created via the app's OWN onboarding (local
 * keygen) in a disposable userData dir. The owner's real wallet is NEVER
 * loaded.
 *
 * MONEY/SAFETY: free-tier ONLY. Test file <= 107520 B. A HARD money guard aborts
 * before approving if any pending row is not size-free. Never prints wallet
 * JSON / seed / password. turbo-gateway.com only.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-freetier-upload-native.js <native-root>
 *   <native-root> defaults to scratchpad/uat-upload-native (must be ext4/tmpfs).
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const path = require('path'); const crypto = require('crypto'); const https = require('https');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_ROOT = process.argv[2] || '/tmp/claude-1000/-mnt-c-source-ardrive-desktop-mvp/64f37fe9-d4f4-4b08-90a8-3ca034bcac1a/scratchpad/uat-upload-native';
const RUN_DIR = path.join(NATIVE_ROOT, 'run-' + Date.now());
const SHOT_DIR = path.join(NATIVE_ROOT, 'shots');
const FREE_LIMIT = 107520;
const GATEWAY = 'turbo-gateway.com';
const DRIVE_NAME = 'FREETIER-NATIVE';
const ACTIVE_WAIT_MS = Number(process.env.ACTIVE_WAIT_MS || 13 * 60 * 1000); // fresh-drive indexing can take several minutes

const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
const THROWAWAY_PW = 'uat-throwaway-' + crypto.randomBytes(9).toString('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name + ' ' + e.message); } }

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

function assertNative(p, label) {
  const real = fs.realpathSync(p);
  const isNative = !/^\/mnt\//.test(real);
  check(`ENV: ${label} is on a NATIVE fs (not /mnt/c 9p)`, isNative, real);
  if (!isNative) throw new Error(`${label} resolved to a /mnt mount (${real}) — inotify won't fire; aborting`);
  return real;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const userDataDir = path.join(RUN_DIR, 'userdata'); await fsp.mkdir(userDataDir, { recursive: true });
  const syncRoot = path.join(RUN_DIR, 'ARDRIVE'); await fsp.mkdir(syncRoot, { recursive: true });
  assertNative(userDataDir, 'userData dir');
  const nativeSync = assertNative(syncRoot, 'sync folder');

  const fileBytes = Buffer.alloc(40 * 1024); for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 131 + 17) & 0xff;
  const fileHash = sha(fileBytes); const fileName = 'freetier-native-' + Date.now() + '.bin';
  note('test file ' + fileName + ' = ' + fileBytes.length + ' B (<= ' + FREE_LIMIT + '), sha256=' + fileHash);

  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: {
      ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir,
      ARDRIVE_DEV_MODE: 'false',
      ARDRIVE_GATEWAY_HOST: GATEWAY,
      ARDRIVE_DEV_SYNC_FOLDER: syncRoot,
    }
  });

  const mainLogs = [];
  try {
    const cp = app.process();
    cp.stdout && cp.stdout.on('data', d => mainLogs.push(d.toString()));
    cp.stderr && cp.stderr.on('data', d => mainLogs.push(d.toString()));
  } catch (e) { note('could not attach to main process stdio: ' + e.message); }

  await app.evaluate(async ({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, syncRoot);

  const rendererErrors = []; let page = null; let aborted = false;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const scanMain = (re) => mainLogs.filter(l => re.test(l));
  let dataTxId = null; let setupOutcome = 'unknown'; let hitStartingSyncEngine = false;
  let a404Observed = false; let a404Recovered = false; let watcherFired = false; let roundTripped = false; let active = false;

  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });

    // ============ STEP 1: fresh create-account onboarding ============
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await shot(page, 'n01-firstrun.png');
    await page.getByRole('button', { name: /Create New Account/ }).click();
    await page.getByRole('heading', { name: 'Secure Your Account' }).waitFor({ state: 'visible' });
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(THROWAWAY_PW);
    await pw.nth(1).fill(THROWAWAY_PW);
    await page.waitForTimeout(200);
    const createAcct = page.getByRole('button', { name: 'Create Account' });
    check('ONB create-account enabled with valid password', !(await createAcct.isDisabled()));
    await shot(page, 'n02-password.png');
    await createAcct.click();
    await page.getByRole('heading', { name: 'Save Your Recovery Phrase' }).waitFor({ state: 'visible', timeout: 45000 });
    check('ONB recovery-phrase step reached (fresh wallet generated locally)', true);
    await page.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /Continue to Drive Setup/ }).click();
    note('local wallet created + persisted; routing to drive setup…');

    // ============ STEP 2: drive + native sync-folder setup ============
    await page.getByText(/Name Your Drive/i).first().waitFor({ state: 'visible', timeout: 60000 });
    check('reached drive-setup wizard on fresh wallet', true);
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill(DRIVE_NAME); await page.waitForTimeout(200);
    const chooseFolder = page.getByRole('button', { name: /Choose Folder/i }).first();
    if (await chooseFolder.count()) { await chooseFolder.click(); await page.waitForTimeout(800); }
    await shot(page, 'n03-drive-setup.png');
    const toReview = page.getByRole('button', { name: /Continue to Review/i });
    await toReview.waitFor({ state: 'visible', timeout: 15000 });
    await toReview.click(); await page.waitForTimeout(600);
    await shot(page, 'n04-review.png');

    const complete = page.getByRole('button', { name: /Complete Setup/i });
    await complete.waitFor({ state: 'visible', timeout: 15000 });
    await complete.click();
    note('clicked Complete Setup — drive-create (Turbo free) then sync start…');

    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2500);
      const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      if (/Starting sync engine/i.test(bodyText)) hitStartingSyncEngine = true;
      if (await page.getByRole('button', { name: /Open Dashboard/i }).count()) { setupOutcome = 'completed'; break; }
      if (/Couldn't reach the Arweave gateway/i.test(bodyText) && await page.getByRole('button', { name: /Try Again/i }).count()) { setupOutcome = 'graceful-error'; break; }
    }
    a404Observed = scanMain(/status:?\s*404|not found|request to gateway has failed/i).length > 0;
    a404Recovered = scanMain(/\[retry\]/i).length > 0;
    note('setup outcome=' + setupOutcome + ' | 404 in main logs=' + a404Observed + ' | retry fired=' + a404Recovered);
    await shot(page, 'n05-after-complete.png');
    check('STEP2: setup reached a terminal state (no infinite hang)', setupOutcome === 'completed' || setupOutcome === 'graceful-error', 'outcome=' + setupOutcome);

    // Resolve the drive mapping (drive was created even if sync:start 404'd).
    let mapping = null;
    for (let i = 0; i < 12 && !(mapping && mapping.path); i++) {
      mapping = await ev(async () => { const m = await window.electronAPI.driveMappings.getPrimary(); return m && m.success && m.data ? { name: m.data.driveName, driveId: m.data.driveId, path: m.data.localFolderPath } : null; }).catch(() => null);
      if (!(mapping && mapping.path)) await sleep(2500);
    }
    check('STEP2: drive mapping established (drive created on fresh wallet)', !!(mapping && mapping.path), mapping ? JSON.stringify({ name: mapping.name, id: String(mapping.driveId).slice(0, 8) + '…', path: mapping.path }) : 'none');
    if (!mapping || !mapping.path) throw new Error('no drive mapping — cannot proceed to upload');
    assertNative(mapping.path, 'drive mapping localFolderPath');

    // ==== LONG self-heal wait: re-drive Open-Dashboard / Try-Again / sync.start()
    // until the watcher goes ACTIVE (fresh drive must index first). ====
    note('entering long self-heal wait for sync to become ACTIVE (fresh-drive indexing delay)…');
    let iter = 0; const startWait = Date.now(); const activeDeadline = startWait + ACTIVE_WAIT_MS;
    while (Date.now() < activeDeadline) {
      iter++;
      try { const od = page.getByRole('button', { name: /Open Dashboard/i }).first(); if (await od.count()) { await od.click().catch(() => {}); } } catch { /* ignore */ }
      try { const ta = page.getByRole('button', { name: /Try Again/i }).first(); if (await ta.count()) { await ta.click().catch(() => {}); note('clicked Try Again (self-heal attempt ' + iter + ')'); } } catch { /* ignore */ }
      const sres = await ev(async () => { try { const r = await window.electronAPI.sync.start(); return r && r.success !== undefined ? { ok: r.success, err: r.error } : { raw: true }; } catch (e) { return { err: String((e && e.message) || e) }; } }).catch((e) => ({ err: String(e) }));
      const st = await ev(async () => { const s = await window.electronAPI.sync.getStatus().catch(() => null); return s && s.success && s.data ? !!s.data.isActive : (s && s.isActive) || false; }).catch(() => false);
      if (scanMain(/\[retry\]/i).length) a404Recovered = true;
      if (scanMain(/status:?\s*404|request to gateway has failed/i).length) a404Observed = true;
      if (st) { active = true; break; }
      if (iter % 2 === 0) note('waiting sync-active… iter=' + iter + ' start=' + JSON.stringify(sres) + ' elapsed=' + Math.round((Date.now() - startWait) / 1000) + 's');
      await sleep(15000);
    }
    check('STEP3: sync watcher ACTIVE (drive indexed / self-healed)', active, 'after ' + iter + ' attempts / ' + Math.round((Date.now() - startWait) / 1000) + 's');
    await shot(page, 'n06-dashboard.png');

    // ============ STEP 3/4: free-tier upload (only meaningful once watcher active) ============
    if (!active) {
      check('STEP3/WATCH: chokidar "add" observed via app flow', false, 'sync never became ACTIVE within ' + Math.round(ACTIVE_WAIT_MS / 60000) + ' min (fresh-drive indexing / gateway-404 env limit; watcher not started — NOT a filesystem result)');
      note('SKIPPING file-drop/upload leg — app watcher not started. The isolated FS result is in chokidar-fs-probe (FIRED on ext4, NO-EVENT on 9p).');
    } else {
      await fsp.mkdir(mapping.path, { recursive: true });
      await fsp.writeFile(path.join(mapping.path, fileName), fileBytes);
      note('dropped ' + fileName + ' into NATIVE ' + mapping.path);

      let pending = [];
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        if (scanMain(/New file detected by watcher/i).some(l => l.includes(fileName))) watcherFired = true;
        pending = await ev(async () => { const r = await window.electronAPI.uploads.getPending(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []);
        if (pending && pending.length) break;
        if (i === 5 || i === 15) { note('nudging detection with sync.manual()'); await ev(async () => { await window.electronAPI.sync.manual().catch(() => {}); }).catch(() => {}); }
      }
      if (scanMain(/New file detected by watcher/i).some(l => l.includes(fileName))) watcherFired = true;
      check('STEP3/WATCH: chokidar "add" FIRED on native fs (defect #6 = environmental)', watcherFired, 'main-log add-event for ' + fileName);
      check('STEP3/UPL: file detected -> pending upload row', pending && pending.length > 0, `pending=${pending ? pending.length : 0}`);
      const mine = (pending || []).filter(p => p.fileName === fileName);
      note('pending: ' + JSON.stringify((pending || []).map(p => ({ n: p.fileName, size: p.fileSize, cost: p.estimatedTurboCost }))));
      check('STEP3/APPR: my row is free-tier (<=107520)', mine.length === 1 && mine[0].fileSize <= FREE_LIMIT, mine[0] ? `size=${mine[0].fileSize}` : 'not found');

      const uq = page.getByRole('tab', { name: /Upload Queue/i }).first();
      if (await uq.count()) { await uq.click().catch(() => {}); await page.waitForTimeout(1500); await shot(page, 'n07-upload-queue.png'); }
      const disp = await page.evaluate(() => { const b = document.body.textContent || ''; return { showsFree: /\bFree\b/i.test(b), showsInsufficient: /Insufficient/i.test(b) }; }).catch(() => ({}));
      note('upload-queue display: ' + JSON.stringify(disp));

      // 🚨 HARD MONEY GUARD
      const notFree = (pending || []).filter(p => !(p.fileSize <= FREE_LIMIT));
      if (notFree.length > 0 || disp.showsInsufficient || !mine.length) {
        aborted = true;
        check('🛑 MONEY GUARD: all pending rows FREE before approving', false, 'ABORTING: ' + JSON.stringify(notFree.map(p => ({ n: p.fileName, size: p.fileSize }))) + ' disp=' + JSON.stringify(disp) + ' mine=' + mine.length);
      } else {
        check('🛑 MONEY GUARD: all pending rows FREE (safe to approve free-tier)', true, `rows=${pending.length}`);
        const upId = mine[0].id;
        const appr = await ev(async (id) => { const r = await window.electronAPI.uploads.approve(id); return r && r.success !== undefined ? { success: r.success, error: r.error } : { raw: JSON.stringify(r) }; }, upId).catch((e) => ({ error: String(e) }));
        note('approve(' + String(upId).slice(0, 8) + '…) -> ' + JSON.stringify(appr));

        let completed = false; let lastStatuses = [];
        for (let i = 0; i < 80; i++) {
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
        check('STEP3/APPR: free-tier upload COMPLETED with a data tx id (no stall)', completed && !!dataTxId, 'tx=' + (dataTxId ? String(dataTxId).slice(0, 12) + '…' : 'none') + ' statuses=' + JSON.stringify(lastStatuses));
        await shot(page, 'n08-after-upload.png');

        let onPermaweb = false;
        for (let i = 0; i < 8; i++) {
          const names = await ev(async (drv) => { const f = await window.electronAPI.drive.getPermawebFiles(drv, true); const arr = f && f.success ? f.data : (Array.isArray(f) ? f : []); return (arr || []).map(x => x.name); }, mapping.driveId).catch(() => []);
          if ((names || []).includes(fileName)) { onPermaweb = true; break; }
          await sleep(4000);
        }
        check('STEP3/PERM: uploaded file appears on Permaweb (IPC)', onPermaweb, 'looking for ' + fileName);

        // ============ STEP 4: download / hash round-trip ============
        if (dataTxId) {
          let gotBytes = null; let last = '';
          for (let i = 0; i < 20; i++) {
            try { gotBytes = await httpGet('https://' + GATEWAY + '/' + dataTxId); if (gotBytes) break; }
            catch (e) { last = e.message; if (/404|HTTP 4|HTTP 5/i.test(e.message)) note('gateway not-yet-indexed (' + e.message + '), retrying…'); }
            await sleep(5000);
          }
          if (gotBytes) {
            const gotHash = sha(gotBytes);
            roundTripped = gotHash === fileHash && gotBytes.length === fileBytes.length;
            note('fetched ' + gotBytes.length + ' B from gateway, sha=' + gotHash + ' (expected ' + fileHash + ')');
          } else { note('could not fetch tx from gateway: ' + last); }
          check('STEP4: data tx round-trips by SHA-256 from turbo-gateway.com', roundTripped, dataTxId ? 'tx=' + dataTxId : '');
        } else {
          check('STEP4: data tx round-trips by SHA-256', false, 'no dataTxId to fetch');
        }
      }
    }

    const bal = await ev(async () => { const b = await window.electronAPI.turbo.getBalance().catch(() => null); return b && b.success && b.data ? (b.data.winc || b.data.ar || JSON.stringify(b.data)) : (b ? JSON.stringify(b) : null); }).catch(() => null);
    note('throwaway wallet Turbo balance: ' + bal + ' (free-tier => no spend)');

    await app.close();
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 'nERROR.png'); } catch { /* best effort */ }
    try { await app.close(); } catch { /* best effort */ }
  }

  const addLines = scanMain(/New file detected by watcher/i);
  const l404 = scanMain(/status:?\s*404|request to gateway has failed/i);
  const lretry = scanMain(/\[retry\]/i);
  try {
    fs.writeFileSync(path.join(NATIVE_ROOT, 'main-log-evidence.txt'),
      '--- watcher add-event lines ---\n' + addLines.map(s => s.trim()).join('\n') +
      '\n\n--- gateway 404 lines (count ' + l404.length + ', first 6) ---\n' + l404.slice(0, 6).map(s => s.trim().slice(0, 200)).join('\n') +
      '\n\n--- [retry] lines (count ' + lretry.length + ') ---\n' + lretry.map(s => s.trim().slice(0, 200)).join('\n') + '\n');
  } catch { /* best effort */ }

  const failed = results.filter(r => !r.c);
  console.log('\n================ FREE-TIER UPLOAD (NATIVE FS) ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}  ${aborted ? '(ABORTED at money guard)' : ''}`);
  console.log('sync folder (native):', nativeSync);
  console.log('sync watcher active :', active);
  console.log('watcher add fired   :', watcherFired, '(' + addLines.length + ' add-event line(s))');
  console.log('setupOutcome        :', setupOutcome);
  console.log('404 observed (main) :', a404Observed);
  console.log('retry fired (main)  :', a404Recovered || lretry.length > 0);
  console.log('data tx id          :', dataTxId || '(none)');
  console.log('round-trip matched  :', roundTripped);
  console.log('test file sha256    :', fileHash);
  console.log('renderer errors     :', rendererErrors.length);
  if (rendererErrors.length) rendererErrors.slice(0, 8).forEach(e => console.log('   ! ' + e.slice(0, 160)));
  console.log('Screenshots in      :', SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
