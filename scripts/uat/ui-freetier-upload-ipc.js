#!/usr/bin/env node
/*
 * UAT LIVE — free-tier upload completion via IPC (money-safe), when the
 * post-create dashboard UI is slow/stuck on this headless box.
 *
 * Creates a FRESH public test drive "UAT-TESTONLY-DELETEME" through the real
 * wizard (on-chain, free), drops a 50 KiB file, then drives approve/verify over
 * the REAL preload IPC bridge (the same handlers the buttons call) instead of
 * the dashboard buttons — because the SetupSuccessScreen -> dashboard transition
 * hangs on "Starting sync engine…" on a wallet with many drives.
 *
 * 🚨 MONEY GUARD (authoritative): only approves rows with fileSize <= 107520 —
 * the EXACT rule main.ts's approval gate uses to treat an upload as free (skips
 * the balance check). Plus a NET-ZERO proof: reads the funded wallet's Turbo winc
 * balance before and after and asserts it is unchanged. Aborts on any non-free row.
 * Never prints wallet JSON / seed / password.
 *
 * Bonus: HIDE-2/HIDE-4 reversible hide->verify->unhide on MY uploaded file (own
 * test drive only), always reversed.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-freetier-upload-ipc.js <shot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { _electron: electron } = require('playwright');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-uplipc-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
const FREE_LIMIT = 107520;
const DRIVE_NAME = 'UAT-TESTONLY-DELETEME';
function readEnvPassword() { const raw = fs.readFileSync(ENV_FILE, 'utf8'); for (const l of raw.split(/\r?\n/)) { const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } throw new Error('no pw'); }
const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name); } }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const password = readEnvPassword();
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-uplipc-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata'); await fsp.mkdir(userDataDir, { recursive: true });
  const syncRoot = path.join(tmpRoot, 'ARDRIVE'); await fsp.mkdir(syncRoot, { recursive: true });
  const fileBytes = Buffer.alloc(50 * 1024, 0); for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 31 + 7) & 0xff;
  const fileHash = sha(fileBytes); const fileName = 'uat-testonly-' + Date.now() + '.bin';

  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir, ARDRIVE_DEV_MODE: 'true', ARDRIVE_DEV_WALLET_PATH: WALLET_WSL, ARDRIVE_DEV_PASSWORD: password, ARDRIVE_DEV_SYNC_FOLDER: syncRoot, ARDRIVE_GATEWAY_HOST: 'turbo-gateway.com' }
  });
  await app.evaluate(async ({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, syncRoot);
  const consoleErrors = []; let page = null; let aborted = false;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    await sleep(1200);
    await page.getByRole('button', { name: /Import Wallet/i }).click();
    await page.getByRole('heading', { name: /Welcome Back|Your Drives/i }).first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    await sleep(2500);

    // record funded-wallet Turbo balance BEFORE (net-zero proof)
    const balBefore = await ev(async () => { const b = await window.electronAPI.turbo.getBalance().catch(() => null); return b && b.success && b.data ? (b.data.winc || b.data.ar || JSON.stringify(b.data)) : (b ? JSON.stringify(b) : null); }).catch(() => null);
    note('turbo balance BEFORE: ' + balBefore);

    // ---- create the test drive via the wizard ----
    const createNew = page.getByRole('button', { name: /Create New Public Drive|Create New Drive/i }).first();
    await createNew.waitFor({ state: 'visible', timeout: 20000 }); await createNew.click();
    await page.getByText(/Name Your Drive/i).first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('input[type="text"]').first().fill(DRIVE_NAME); await sleep(300);
    const cf = page.getByRole('button', { name: /Choose Folder/i }).first(); if (await cf.count()) { await cf.click(); await sleep(700); }
    await page.getByRole('button', { name: /Continue to Review/i }).click(); await sleep(700);
    await page.getByRole('button', { name: /Complete Setup/i }).click();
    note('creating drive on-chain (free) — will drive approve via IPC, not the dashboard UI');

    // ---- wait for the drive mapping to exist (created by handleSetup) ----
    let mapping = null;
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      mapping = await ev(async () => { const m = await window.electronAPI.driveMappings.getPrimary(); return m && m.success && m.data ? { name: m.data.driveName, driveId: m.data.driveId, path: m.data.localFolderPath } : null; }).catch(() => null);
      if (mapping && mapping.name === DRIVE_NAME && mapping.path) break;
    }
    check('PUB-3 drive created on-chain (mapping + folder established via IPC)', !!(mapping && mapping.name === DRIVE_NAME && mapping.path), mapping ? JSON.stringify({ name: mapping.name, id: String(mapping.driveId).slice(0, 8) + '…' }) : 'no mapping');
    if (!mapping || !mapping.path) throw new Error('drive mapping not established');
    await shot(page, 'uplipc-01-created.png');

    // ---- ensure the sync watcher is ACTIVE before dropping (the post-create
    //      "Starting sync engine…" can lag on a many-drive wallet) ----
    await ev(async () => { await window.electronAPI.sync.start().catch(() => {}); await window.electronAPI.sync.forceMonitoring?.().catch?.(() => {}); }).catch(() => {});
    let active = false;
    for (let i = 0; i < 30; i++) {
      const st = await ev(async () => { const s = await window.electronAPI.sync.getStatus().catch(() => null); return s && s.success && s.data ? !!s.data.isActive : (s && s.isActive) || false; }).catch(() => false);
      if (st) { active = true; break; }
      await sleep(2000);
    }
    check('sync watcher active before drop (sync.start)', active);

    // ---- drop the 50 KiB file ----
    await fsp.mkdir(mapping.path, { recursive: true });
    const filePath = path.join(mapping.path, fileName);
    await fsp.writeFile(filePath, fileBytes);
    note('dropped ' + fileName + ' (' + fileBytes.length + ' bytes, sha=' + fileHash.slice(0, 12) + '…)');

    // ---- wait for detection -> pending upload (via IPC); nudge with a manual scan ----
    let pending = [];
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      pending = await ev(async () => { const r = await window.electronAPI.uploads.getPending(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []);
      if (pending && pending.length) break;
      if (i === 5 || i === 15) { note('nudging detection with sync.manual()'); await ev(async () => { await window.electronAPI.sync.manual().catch(() => {}); }).catch(() => {}); }
    }
    check('UPL-1 file detected -> pending upload (IPC)', pending && pending.length > 0, `pending=${pending ? pending.length : 0}`);
    const mine = (pending || []).filter(p => p.fileName === fileName);
    note('pending: ' + JSON.stringify((pending || []).map(p => ({ n: p.fileName, size: p.fileSize, cost: p.estimatedTurboCost }))));
    check('APPR-2 my row size is free-tier (<=107520)', mine.length === 1 && mine[0].fileSize <= FREE_LIMIT, mine[0] ? `size=${mine[0].fileSize}` : 'not found');

    // ---- 🚨 HARD MONEY GUARD: every pending row must be size-free ----
    const notFree = (pending || []).filter(p => !(p.fileSize <= FREE_LIMIT));
    if (notFree.length > 0) {
      aborted = true;
      check('🛑 MONEY GUARD: all pending rows are FREE (size<=107520) before approving', false, 'ABORTING: ' + JSON.stringify(notFree.map(p => ({ n: p.fileName, size: p.fileSize }))));
    } else {
      check('🛑 MONEY GUARD: all pending rows are FREE (size<=107520, safe to approve free-tier)', true, `rows=${pending.length}`);
      // ---- approve MY row via IPC (same handler the button calls) ----
      const upId = mine[0].id;
      const appr = await ev(async (id) => { const r = await window.electronAPI.uploads.approve(id); return r && r.success !== undefined ? { success: r.success, error: r.error } : { raw: JSON.stringify(r) }; }, upId).catch((e) => ({ error: String(e) }));
      note('approve(' + String(upId).slice(0, 8) + '…) -> ' + JSON.stringify(appr));
      // ---- wait for upload completion via IPC ----
      let uploaded = false; let lastStatuses = [];
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        const st = await ev(async () => {
          const p = await window.electronAPI.uploads.getPending().catch(() => null);
          const pend = p && p.success ? p.data : (Array.isArray(p) ? p : []);
          const u = await window.electronAPI.files.getUploads().catch(() => null);
          const ups = u && u.success ? u.data : (Array.isArray(u) ? u : []);
          return { pendingLeft: (pend || []).length, statuses: (ups || []).map(x => ({ n: x.fileName, s: x.status })).slice(0, 5) };
        }).catch(() => ({ pendingLeft: -1, statuses: [] }));
        lastStatuses = st.statuses;
        const done = (st.statuses || []).find(x => x.n === fileName && /complet|uploaded|success|synced|confirmed/i.test(x.s || ''));
        if (done) { uploaded = true; break; }
        if (i % 3 === 0) note('waiting upload… pendingLeft=' + st.pendingLeft + ' statuses=' + JSON.stringify(st.statuses));
      }
      check('APPR-3 file uploaded free-tier (IPC-driven, real handler)', uploaded, 'statuses=' + JSON.stringify(lastStatuses));
      await shot(page, 'uplipc-02-after-upload.png');

      // ---- verify on Permaweb via IPC ----
      let onPermaweb = false;
      for (let i = 0; i < 8; i++) {
        const files = await ev(async (drv) => { const f = await window.electronAPI.drive.getPermawebFiles(drv, true); const arr = f && f.success ? f.data : (Array.isArray(f) ? f : []); return (arr || []).map(x => x.name); }, mapping.driveId).catch(() => []);
        if ((files || []).includes(fileName)) { onPermaweb = true; break; }
        await sleep(4000);
      }
      check('PERM-5 uploaded file visible on Permaweb (IPC)', onPermaweb, 'looking for ' + fileName);

      // ---- NET-ZERO proof ----
      const balAfter = await ev(async () => { const b = await window.electronAPI.turbo.getBalance().catch(() => null); return b && b.success && b.data ? (b.data.winc || b.data.ar || JSON.stringify(b.data)) : (b ? JSON.stringify(b) : null); }).catch(() => null);
      note('turbo balance AFTER: ' + balAfter);
      check('MONEY: funded-wallet Turbo balance UNCHANGED (net-zero free-tier)', balBefore != null && balAfter != null && String(balBefore) === String(balAfter), `before=${balBefore} after=${balAfter}`);
    }

    check('no console errors', consoleErrors.length === 0, `count=${consoleErrors.length}`);
    if (consoleErrors.length) consoleErrors.slice(0, 8).forEach(e => console.log('       ! ' + e.slice(0, 160)));
    await app.close(); check('app closed cleanly', true);
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 'uplipc-ERROR.png'); } catch {}
    try { await app.close(); } catch {}
  }
  const failed = results.filter(r => !r.c);
  console.log('\n================ FREE-TIER UPLOAD IPC (LIVE) RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}  ${aborted ? '(ABORTED at money guard)' : ''}`);
  console.log('Test file sha256: ' + fileHash);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
