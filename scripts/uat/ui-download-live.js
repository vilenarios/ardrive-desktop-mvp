#!/usr/bin/env node
/*
 * UAT — observe the REAL app UI DURING a live initial-sync DOWNLOAD.
 *
 * Drives the actual built app (dist/) through the real "existing user" flow:
 * import wallet -> Welcome Back -> select an existing PUBLIC drive -> Set Up
 * Sync Folder -> Start Syncing -> Dashboard, then watches (screenshots +
 * ground-truth IPC polling) while DownloadManager pulls every file in the
 * drive down to a disposable, empty, native (non-/mnt/c) sync folder.
 *
 * Why a wallet is used at all: the app's drive-connect architecture (main.ts
 * sync:start / drive:switchTo) gates on the loaded wallet OWNING the target
 * drive (walletManager.listDrives() -> arDrive.getAllDrivesForAddress) — there
 * is currently no UI path to connect to an arbitrary public drive by ID alone
 * (AddExistingDriveModal only lists the connected wallet's own drives). This
 * harness reuses the exact wallet already used read-only for authenticated UI
 * tours in this repo (scripts/uat/ui-authenticated.js) — it happens to own
 * the target public test drives. This is the SAME wallet/pattern, not a new
 * exposure.
 *
 * MONEY/DATA SAFETY: read-only navigation. No upload occurs (the disposable
 * sync folder starts empty, so "bidirectional" sync finds nothing local to
 * push — only remote files to pull). No transaction is ever signed or
 * broadcast (drive creation is NOT performed — an EXISTING drive is selected).
 * Reads go to turbo-gateway.com only.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-download-live.js <screenshot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UI_TIMEOUT = 45_000;
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-dl-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
const TARGET_DRIVE_ID = 'a84b951b-7d2f-4fa1-a89f-4b4ed673b404'; // ytmnd (~12 files + subfolder)
const FALLBACK_DRIVE_ID = 'c863be1f-a725-4554-9a9e-18268ed8a035'; // new-test-drive (3 files)
const MAX_DRAIN_WAIT_MS = 5 * 60 * 1000; // 5 min cap for the download-drain watch

function readEnvPassword() {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('ARDRIVE_DEV_PASSWORD not found in ' + ENV_FILE);
}

const results = [];
const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
const ts = () => new Date().toISOString().slice(11, 23);
async function shot(page, name) {
  const p = path.join(SHOT_DIR, name);
  try { await page.screenshot({ path: p, timeout: 20000 }); console.log(`    · [${ts()}] shot ` + name); }
  catch (e) { console.log(`    · [${ts()}] shot FAIL ` + name + ' : ' + e.message); }
  return p;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(WALLET_WSL)) { console.error('wallet not found:', WALLET_WSL); process.exit(2); }
  const password = readEnvPassword();

  // Disposable userData AND sync folder — both under os.tmpdir() (native ext4
  // here, confirmed via `df -T`, NOT /mnt/c — chokidar/fs semantics break
  // under WSL's /mnt/c 9p mount).
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-dl-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  await fsp.mkdir(userDataDir, { recursive: true });
  const syncFolder = path.join(tmpRoot, 'ARDRIVE');
  await fsp.mkdir(syncFolder, { recursive: true });
  note('userData: ' + userDataDir);
  note('syncFolder (native, empty): ' + syncFolder);

  const app = await electron.launch({
    cwd: REPO_ROOT,
    args: ['.', '--disable-gpu', '--no-sandbox'],
    timeout: 120000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ARDRIVE_TEST_USERDATA: userDataDir,
      ARDRIVE_DEV_MODE: 'true',
      ARDRIVE_DEV_WALLET_PATH: WALLET_WSL,
      ARDRIVE_DEV_PASSWORD: password,
      ARDRIVE_DEV_SYNC_FOLDER: syncFolder,
      ARDRIVE_GATEWAY_HOST: 'turbo-gateway.com'
    }
  });

  // Stub the native folder dialog in the MAIN process (established pattern).
  await app.evaluate(async ({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, syncFolder);

  const consoleErrors = [];
  let page = null;
  const timeline = []; // { t, phase, description, itemsProcessed }
  try {
    page = await app.firstWindow({ timeout: 120000 });
    page.setDefaultTimeout(UI_TIMEOUT);
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    // ---- Import wallet (dev-autofill) ----
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    const importBtn = page.getByRole('button', { name: /Import Wallet/i });
    await importBtn.waitFor({ state: 'visible' });
    await importBtn.click();
    note('import submitted — awaiting drive.list (LIVE, turbo-gateway.com)');

    // ---- welcome-back ----
    await page.getByRole('heading', { name: /Welcome Back|Choose.*Drive|Your Drives/i }).first()
      .waitFor({ state: 'visible', timeout: 90000 });
    await page.waitForTimeout(4000); // let drive rows hydrate past skeletons
    await shot(page, '01-welcomeback.png');

    const gt = await page.evaluate(async () => {
      const ws = await window.electronAPI.drive.listWithStatus().catch((e) => ({ error: String(e) }));
      return ws;
    });
    const list = gt && gt.success && Array.isArray(gt.data) ? gt.data : [];
    check('drive.listWithStatus returns real drives LIVE', list.length > 0, `count=${list.length}`);

    let target = list.find((d) => d.id === TARGET_DRIVE_ID);
    let usedFallback = false;
    if (!target) {
      target = list.find((d) => d.id === FALLBACK_DRIVE_ID);
      usedFallback = true;
    }
    check('target public drive found in wallet\'s drive list', !!target,
      target ? `using ${usedFallback ? 'FALLBACK' : 'PRIMARY'} target: "${target.name}" (${target.id})` : `neither ${TARGET_DRIVE_ID} nor ${FALLBACK_DRIVE_ID} present`);
    if (!target) throw new Error('Neither target drive is owned by this wallet — cannot proceed.');
    const targetName = target.name;
    note('target drive: "' + targetName + '" privacy=' + target.privacy);

    // ---- select the target drive ----
    const card = page.getByText(targetName, { exact: false }).first();
    await card.click({ timeout: 15000 }).catch(async () => {
      const radios = page.locator('input[type="radio"]');
      if (await radios.count()) await radios.first().check();
    });
    await page.waitForTimeout(500);
    await shot(page, '02-drive-selected.png');
    const cont = page.getByRole('button', { name: /Continue with Selected Drive/i });
    await cont.click();
    note('continuing -> sync-folder-setup');

    // ---- Set Up Sync Folder ----
    await page.getByRole('heading', { name: /Set Up Sync Folder/i }).waitFor({ state: 'visible', timeout: 60000 });
    await shot(page, '03-syncfolder-setup.png');
    const chooseBtn = page.getByRole('button', { name: /Choose Folder/i });
    if (await chooseBtn.count()) { await chooseBtn.click(); await page.waitForTimeout(800); }
    await shot(page, '04-syncfolder-chosen.png');
    const startBtn = page.getByRole('button', { name: /Start Syncing/i });
    await startBtn.waitFor({ state: 'visible', timeout: 15000 });
    check('Start Syncing enabled after folder chosen', !(await startBtn.isDisabled()));

    // Start polling sync-progress phase text immediately — SyncFolderSetup
    // navigates to Dashboard FIRST, then fires sync.start() ~100ms later, so
    // the 3-phase modal appears ON TOP of an already-visible Dashboard.
    const pollStart = Date.now();
    let stopPolling = false;
    const pollPhase = async () => {
      while (!stopPolling) {
        try {
          const phaseInfo = await page.evaluate(() => {
            const modal = document.querySelector('.sync-progress-content');
            if (!modal) return null;
            const title = modal.querySelector('h3')?.textContent || '';
            const desc = modal.querySelector('.sync-progress-description')?.textContent || '';
            const step = modal.querySelector('.sync-progress-step')?.textContent || '';
            const item = modal.querySelector('.sync-progress-current-item span')?.textContent || '';
            const bar = modal.querySelector('.sync-progress-bar');
            const width = bar ? bar.style.width : null;
            return { title, desc, step, item, width };
          }).catch(() => null);
          if (phaseInfo) {
            const line = { t: Date.now() - pollStart, ...phaseInfo };
            const last = timeline[timeline.length - 1];
            if (!last || last.desc !== line.desc || last.step !== line.step) {
              timeline.push(line);
              note(`[t+${line.t}ms] modal: "${line.title}" step="${line.step}" desc="${line.desc}" item="${line.item}" bar=${line.width}`);
            }
          }
        } catch { /* page may be mid-navigation */ }
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    const pollPromise = pollPhase();

    await startBtn.click();
    note('Start Syncing clicked -> dashboard (sync fires ~100ms later)');

    // Catch dashboard arrival
    let dash = false;
    try { await page.getByRole('tab', { name: /Overview/i }).first().waitFor({ state: 'visible', timeout: 90000 }); dash = true; }
    catch (e) { note('dashboard Overview tab not seen: ' + e.message); }
    check('reached DASHBOARD', dash);

    // Rapid-fire screenshots for the first few seconds to catch the 3-phase
    // modal (starting -> metadata -> folders -> files/complete), which can
    // move fast.
    for (let i = 0; i < 10; i++) {
      await shot(page, `05-phase-${String(i).padStart(2, '0')}.png`);
      await page.waitForTimeout(400);
    }

    // ---- responsiveness probe: click between tabs WHILE downloads are
    // still in flight (queue should not be drained yet for a 12-file drive) ----
    const tabsOrder = ['Permaweb', 'Download Queue', 'Activity', 'Overview'];
    for (const t of tabsOrder) {
      const tab = page.getByRole('tab', { name: new RegExp('^' + t, 'i') }).first();
      const clickStart = Date.now();
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(600);
      }
      const clickMs = Date.now() - clickStart;
      note(`tab click "${t}" responded in ${clickMs}ms`);
      await shot(page, `06-during-tab-${t.toLowerCase().replace(/ /g, '-')}.png`);
    }

    // ---- ground-truth poll loop across the download window ----
    const drainStart = Date.now();
    let drained = false;
    let lastSnapshot = null;
    const snapshots = [];
    while (Date.now() - drainStart < MAX_DRAIN_WAIT_MS) {
      const snap = await page.evaluate(async (driveId) => {
        const qs = await window.electronAPI.sync.getQueueStatus().catch((e) => ({ error: String(e) }));
        const pf = await window.electronAPI.drive.getPermawebFiles(driveId, false).catch((e) => ({ error: String(e) }));
        const files = pf && pf.success && Array.isArray(pf.data) ? pf.data : (Array.isArray(pf) ? pf : []);
        const byStatus = {};
        for (const f of files) {
          const s = f.syncStatus || f.status || 'unknown';
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        return { queue: qs && qs.success ? qs.data : qs, total: files.length, byStatus };
      }, target.id).catch((e) => ({ error: String(e) }));

      const t = Date.now() - drainStart;
      const line = `[t+${(t / 1000).toFixed(1)}s] queue=${JSON.stringify(snap.queue)} total=${snap.total} byStatus=${JSON.stringify(snap.byStatus)}`;
      if (JSON.stringify(snap) !== JSON.stringify(lastSnapshot)) {
        console.log('    · ' + line);
        snapshots.push({ t, ...snap });
        lastSnapshot = snap;
      }

      const q = snap.queue || {};
      if ((q.queued === 0 && q.active === 0) && snap.total > 0) { drained = true; break; }
      await page.waitForTimeout(2000);
      // periodic screenshot of the Permaweb tab (per-file statuses) every ~10s
      if (Math.floor(t / 10000) !== Math.floor((t - 2000) / 10000)) {
        const permawebTab = page.getByRole('tab', { name: /^Permaweb/i }).first();
        if (await permawebTab.count()) { await permawebTab.click(); await page.waitForTimeout(300); }
        await shot(page, `07-progress-t${Math.floor(t / 1000)}s.png`);
      }
    }
    check('download queue drained within cap', drained, `elapsed=${((Date.now() - drainStart) / 1000).toFixed(1)}s`);
    stopPolling = true;
    await pollPromise;

    // ---- final state ----
    await page.waitForTimeout(1500);
    const modalStillUp = await page.evaluate(() => !!document.querySelector('.sync-progress-content'));
    check('sync-progress modal is gone after drain (no lingering spinner)', !modalStillUp);
    const permawebTab2 = page.getByRole('tab', { name: /^Permaweb/i }).first();
    if (await permawebTab2.count()) { await permawebTab2.click(); await page.waitForTimeout(800); }
    await shot(page, '08-final-permaweb.png');
    const dqTab = page.getByRole('tab', { name: /^Download Queue/i }).first();
    if (await dqTab.count()) { await dqTab.click(); await page.waitForTimeout(800); }
    await shot(page, '09-final-download-queue.png');
    const actTab = page.getByRole('tab', { name: /^Activity/i }).first();
    if (await actTab.count()) { await actTab.click(); await page.waitForTimeout(800); }
    await shot(page, '10-final-activity.png');
    const ovTab = page.getByRole('tab', { name: /^Overview/i }).first();
    if (await ovTab.count()) { await ovTab.click(); await page.waitForTimeout(800); }
    await shot(page, '11-final-overview.png');

    // final ground truth
    const finalSnap = await page.evaluate(async (driveId) => {
      const pf = await window.electronAPI.drive.getPermawebFiles(driveId, false).catch((e) => ({ error: String(e) }));
      const files = pf && pf.success && Array.isArray(pf.data) ? pf.data : (Array.isArray(pf) ? pf : []);
      const byStatus = {};
      for (const f of files) { const s = f.syncStatus || f.status || 'unknown'; byStatus[s] = (byStatus[s] || 0) + 1; }
      return { total: files.length, byStatus };
    }, target.id).catch((e) => ({ error: String(e) }));
    note('FINAL file-status breakdown: ' + JSON.stringify(finalSnap));
    check('final state: all files synced (no stragglers)', finalSnap.byStatus && Object.keys(finalSnap.byStatus).length === 1 && finalSnap.byStatus.synced === finalSnap.total,
      JSON.stringify(finalSnap.byStatus));

    // on-disk cross-check
    function walk(dir) {
      let n = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) n += walk(p); else if (e.isFile()) n += 1;
      }
      return n;
    }
    let onDiskCount = 0;
    try { onDiskCount = walk(syncFolder); } catch { /* noop */ }
    note('on-disk file count under sync folder: ' + onDiskCount);

    check('no console errors during run', consoleErrors.length === 0, `count=${consoleErrors.length}`);
    if (consoleErrors.length) consoleErrors.slice(0, 10).forEach((e) => console.log('       ! ' + e.slice(0, 200)));

    console.log('\n================ TIMELINE (sync-progress modal phases) ================');
    timeline.forEach((l) => console.log(`  [t+${l.t}ms] "${l.title}" step=${l.step} desc="${l.desc}" item="${l.item}" bar=${l.width}`));
    console.log('\n================ SNAPSHOTS (ground-truth queue/file-status over time) ================');
    snapshots.forEach((s) => console.log(`  [t+${(s.t / 1000).toFixed(1)}s] queue=${JSON.stringify(s.queue)} total=${s.total} byStatus=${JSON.stringify(s.byStatus)}`));
    console.log('\nON-DISK FILES: ' + onDiskCount);

    await app.close();
    check('app closed cleanly', true);
  } catch (err) {
    check('run completed without harness error', false, err && err.message);
    try { await shot(page, 'ERROR.png'); } catch { /* noop */ }
    try { await app.close(); } catch { /* noop */ }
  }

  const failed = results.filter((r) => !r.c);
  console.log('\n================ UI DOWNLOAD-LIVE RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
