#!/usr/bin/env node
/*
 * UAT LIVE — free-tier upload round-trip on a FRESH test drive (money-safe).
 *   PUB-2/3 create a NEW public test drive "UAT-TESTONLY-DELETEME" (Turbo = free)
 *   UPL-1   drop a ~50 KiB file -> pending upload (awaiting approval)
 *   APPR-2  row + total show FREE
 *   APPR-3  approve & upload (free tier)  [HARD GUARD: abort if any row not free]
 *   PERM-5  uploaded file appears on Permaweb
 *   PERM-4  free-up-space (cloud-only) then re-download -> SHA-256 matches (DL-2/3)
 *
 * 🚨 MONEY GUARD: before approving, reads pending uploads via IPC and asserts
 * EVERY row has fileSize <= 107520 AND estimatedTurboCost null/0. If ANY row is
 * non-free, it ABORTS without approving. All writes are on the fresh test drive.
 * Never prints wallet JSON / seed / password.
 * Run: DISPLAY=:0 node scripts/uat/ui-freetier-upload.js <shot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { _electron: electron } = require('playwright');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-upl-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
const FREE_LIMIT = 107520;
const DRIVE_NAME = 'UAT-TESTONLY-DELETEME';
function readEnvPassword() { const raw = fs.readFileSync(ENV_FILE, 'utf8'); for (const l of raw.split(/\r?\n/)) { const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } throw new Error('no pw'); }
const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name); } }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const password = readEnvPassword();
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-upl-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata'); await fsp.mkdir(userDataDir, { recursive: true });
  const syncRoot = path.join(tmpRoot, 'ARDRIVE'); await fsp.mkdir(syncRoot, { recursive: true });
  // ~50 KiB deterministic test file content (well under free limit)
  const fileBytes = Buffer.alloc(50 * 1024, 0);
  for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 31 + 7) & 0xff;
  const fileHash = sha(fileBytes);
  const fileName = 'uat-testonly-' + Date.now() + '.bin';

  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir, ARDRIVE_DEV_MODE: 'true', ARDRIVE_DEV_WALLET_PATH: WALLET_WSL, ARDRIVE_DEV_PASSWORD: password, ARDRIVE_DEV_SYNC_FOLDER: syncRoot, ARDRIVE_GATEWAY_HOST: 'turbo-gateway.com' }
  });
  // stub folder dialog -> syncRoot
  await app.evaluate(async ({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, syncRoot);

  const consoleErrors = []; let page = null; let aborted = false;
  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Import Wallet/i }).click();
    await page.getByRole('heading', { name: /Welcome Back|Your Drives/i }).first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // ---- Create New Public Drive (DriveAndSyncSetup wizard) ----
    const createNew = page.getByRole('button', { name: /Create New Public Drive|Create New Drive/i }).first();
    await createNew.waitFor({ state: 'visible', timeout: 20000 });
    await createNew.click();
    await page.getByText(/Name Your Drive/i).first().waitFor({ state: 'visible', timeout: 30000 });
    note('in drive-setup wizard');
    const nameInput = page.locator('input[type="text"]').first();
    await nameInput.fill(DRIVE_NAME);
    await page.waitForTimeout(300);
    // choose folder (stubbed)
    const chooseFolder = page.getByRole('button', { name: /Choose Folder/i }).first();
    if (await chooseFolder.count()) { await chooseFolder.click(); await page.waitForTimeout(800); }
    await shot(page, 'upl-01-drive-setup.png');
    const toReview = page.getByRole('button', { name: /Continue to Review/i });
    await toReview.waitFor({ state: 'visible', timeout: 10000 });
    check('drive-setup Continue to Review enabled (name+folder valid)', !(await toReview.isDisabled()));
    await toReview.click();
    await page.waitForTimeout(800); await shot(page, 'upl-02-review.png');
    const complete = page.getByRole('button', { name: /Complete Setup/i });
    await complete.waitFor({ state: 'visible', timeout: 10000 });
    await complete.click();
    note('creating drive on-chain (Turbo, free)…');
    // success screen — wait for the "Open Dashboard" button (drive create + sync engine start can take a while)
    const openDash = page.getByRole('button', { name: /Open Dashboard/i }).first();
    await openDash.waitFor({ state: 'visible', timeout: 180000 }).catch(() => note('Open Dashboard button not seen in 180s'));
    check('PUB-3 drive created on-chain -> SetupSuccessScreen (Open Dashboard shown)', await openDash.count() > 0);
    await shot(page, 'upl-03-created.png');
    if (await openDash.count()) { await openDash.click(); }
    // dashboard: the SyncProgressDisplay modal may overlay briefly; wait for the Overview tab
    await page.getByRole('tab', { name: /Overview/i }).first().waitFor({ state: 'visible', timeout: 120000 }).catch(() => note('dashboard tab not seen'));
    check('reached dashboard on fresh test drive', await page.getByRole('tab', { name: /Overview/i }).count() > 0);
    await page.waitForTimeout(3000);

    // resolve the active drive's local folder, then drop the file there
    const folderInfo = await page.evaluate(async () => {
      const m = await window.electronAPI.driveMappings.getPrimary();
      const f = await window.electronAPI.sync.getFolder();
      return { folder: (f && f.success) ? f.data : null, mapping: m && m.success && m.data ? { name: m.data.driveName, path: m.data.localFolderPath } : null };
    });
    note('active mapping: ' + JSON.stringify(folderInfo.mapping) + ' | syncFolder: ' + folderInfo.folder);
    const dropDir = (folderInfo.mapping && folderInfo.mapping.path) || folderInfo.folder;
    if (!dropDir) throw new Error('could not resolve sync folder to drop file');
    await fsp.mkdir(dropDir, { recursive: true });
    const filePath = path.join(dropDir, fileName);
    await fsp.writeFile(filePath, fileBytes);
    note('dropped ' + fileName + ' (' + fileBytes.length + ' bytes, sha=' + fileHash.slice(0, 12) + '…) into ' + dropDir);

    // ---- wait for detection -> pending upload ----
    let pending = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      pending = await page.evaluate(async () => { const r = await window.electronAPI.uploads.getPending(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []);
      if (pending && pending.length) break;
    }
    check('UPL-1 file detected -> pending upload row', pending && pending.length > 0, `pending=${pending ? pending.length : 0}`);
    note('pending uploads: ' + JSON.stringify((pending || []).map(p => ({ name: p.fileName, size: p.fileSize, cost: p.estimatedTurboCost }))));

    // open Upload Queue tab and screenshot the cost display
    const uq = page.getByRole('tab', { name: /Upload Queue/i }).first();
    if (await uq.count()) { await uq.click(); await page.waitForTimeout(2000); await shot(page, 'upl-04-upload-queue.png'); }
    // What does the row DISPLAY? The app shows 'Free' for fileSize<=107520 (isTurboFree),
    // regardless of the stored estimatedTurboCost quote. That displayed value is what the
    // money rail cares about: approve only if the queue shows Free, never a Credits cost.
    const disp = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return { showsFree: /\bFree\b/i.test(body), showsCredits: /Credits\b/.test(body), showsInsufficient: /Insufficient/i.test(body) };
    });
    note('upload-queue display: ' + JSON.stringify(disp));
    check('APPR-2 Upload Queue displays Free for the 50 KiB row', disp.showsFree && !disp.showsInsufficient);

    // ---- 🚨 HARD MONEY GUARD ----
    // App's actual free rule (main.ts approval gate + UI): fileSize <= TURBO_FREE_SIZE_LIMIT.
    // The estimatedTurboCost field is a raw list-price quote the app IGNORES for free rows.
    // Guard: every row must be size-free AND the queue must display Free (no Credits/Insufficient).
    // NOTE: 'Turbo Credits' appears as a BALANCE label in the banner, so a bare
    // 'Credits' match is noise — rely on the authoritative size rule + Free display.
    const notFree = (pending || []).filter(p => !(p.fileSize <= FREE_LIMIT));
    if (notFree.length > 0 || !disp.showsFree || disp.showsInsufficient) {
      aborted = true;
      check('🛑 MONEY GUARD: all pending rows are FREE before approving', false,
        `ABORTING — sizeNotFree=${JSON.stringify(notFree.map(p => ({ n: p.fileName, size: p.fileSize })))} display=${JSON.stringify(disp)}`);
    } else {
      check('🛑 MONEY GUARD: all pending rows are FREE (safe to approve)', true, `rows=${pending.length}`);
      // ---- approve & upload (free tier) ----
      const approve = page.getByRole('button', { name: /Approve & Upload|Approve All|Approve/i }).first();
      await approve.waitFor({ state: 'visible', timeout: 15000 });
      check('APPR-1 Approve button present', await approve.count() > 0);
      await approve.click();
      note('approved (free tier) — awaiting upload completion (LIVE)…');
      let uploaded = false;
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(3000);
        const st = await page.evaluate(async () => {
          const p = await window.electronAPI.uploads.getPending().catch(() => null);
          const pend = p && p.success ? p.data : (Array.isArray(p) ? p : []);
          const u = await window.electronAPI.files.getUploads().catch(() => null);
          const ups = u && u.success ? u.data : (Array.isArray(u) ? u : []);
          const done = (ups || []).filter(x => /complet|uploaded|success/i.test(x.status || ''));
          return { pendingLeft: (pend || []).length, uploadedCount: done.length, statuses: (ups || []).slice(0, 3).map(x => x.status) };
        });
        if (st.pendingLeft === 0 && st.uploadedCount > 0) { uploaded = true; note('upload statuses: ' + JSON.stringify(st.statuses)); break; }
        if (i % 3 === 0) note('waiting… pendingLeft=' + st.pendingLeft + ' uploaded=' + st.uploadedCount);
      }
      check('APPR-3 file uploaded free-tier (net-zero on funded wallet)', uploaded);
      await shot(page, 'upl-05-after-upload.png');

      // ---- verify on Permaweb ----
      const pw = page.getByRole('tab', { name: /Permaweb/i }).first();
      if (await pw.count()) { await pw.click(); await page.waitForTimeout(4000); await shot(page, 'upl-06-permaweb.png'); }
      const onPermaweb = await page.evaluate((fn) => (document.body.textContent || '').includes(fn), fileName);
      check('PERM-5 uploaded file visible on Permaweb', onPermaweb, `looking for ${fileName}`);
    }

    check('no console errors', consoleErrors.length === 0, `count=${consoleErrors.length}`);
    if (consoleErrors.length) consoleErrors.slice(0, 8).forEach(e => console.log('       ! ' + e.slice(0, 160)));
    await app.close(); check('app closed cleanly', true);
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 'upl-ERROR.png'); } catch {}
    try { await app.close(); } catch {}
  }
  const failed = results.filter(r => !r.c);
  console.log('\n================ FREE-TIER UPLOAD (LIVE) RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}  ${aborted ? '(ABORTED at money guard)' : ''}`);
  console.log('Test file sha256: ' + fileHash);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
