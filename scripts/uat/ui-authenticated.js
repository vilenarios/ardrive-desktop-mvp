#!/usr/bin/env node
/*
 * UAT LIVE — authenticated surfaces with the REAL funded wallet (UAT run-2 live).
 *
 * Loads the owner's real wallet into a DISPOSABLE userData, imports it, verifies
 * drive.list returns the real drives LIVE via turbo-gateway.com, reaches the
 * authenticated DASHBOARD (folder dialog is stubbed in the main process so no
 * human is needed), and screenshots every authenticated surface.
 *
 * MONEY/DATA SAFETY: reads/navigation only. NO uploads. NO hide/delete of real
 * data. Selects an EXISTING public drive for a read-only tour; the sync folder
 * is a disposable temp dir (files only download in, nothing is dropped so
 * nothing uploads). Never prints wallet JSON / seed / password. Password read
 * from repo .env at runtime and handed to the app only via dev-autofill env.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-authenticated.js <screenshot-dir>
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
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-auth-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';

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
async function shot(page, name) {
  const p = path.join(SHOT_DIR, name);
  try { await page.screenshot({ path: p, timeout: 20000 }); console.log('    · shot ' + name); }
  catch (e) { console.log('    · shot FAIL ' + name + ' : ' + e.message); }
  return p;
}
const sanitize = (arr) => (arr || []).map((d) => ({ name: d && d.name, id: d && typeof d.id === 'string' ? d.id.slice(0, 8) + '…' : d && d.id, privacy: d && d.privacy, isLocked: d && d.isLocked }));

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(WALLET_WSL)) { console.error('wallet not found:', WALLET_WSL); process.exit(2); }
  const password = readEnvPassword();

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-auth-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  await fsp.mkdir(userDataDir, { recursive: true });
  const syncFolder = path.join(tmpRoot, 'ARDRIVE');
  await fsp.mkdir(syncFolder, { recursive: true });

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

  // Stub the native folder dialog in the MAIN process so "Choose Folder" returns
  // our disposable sync dir without a human. (Well-known Playwright-Electron technique.)
  await app.evaluate(async ({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, syncFolder);

  const consoleErrors = [];
  let page = null;
  try {
    page = await app.firstWindow({ timeout: 120000 });
    page.setDefaultTimeout(UI_TIMEOUT);
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    // ---- Import (dev-autofill) ----
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    const importBtn = page.getByRole('button', { name: /Import Wallet/i });
    await importBtn.waitFor({ state: 'visible' });
    await importBtn.click();
    note('import submitted — awaiting drive.list (LIVE)');

    // ---- welcome-back + ground truth ----
    await page.getByRole('heading', { name: /Welcome Back|Choose.*Drive|Your Drives/i }).first()
      .waitFor({ state: 'visible', timeout: 90000 }).catch(() => note('welcome-back heading not matched'));
    // wait for drive rows to hydrate (skeletons gone)
    await page.waitForTimeout(4000);
    const gt = await page.evaluate(async () => {
      const ws = await window.electronAPI.drive.listWithStatus().catch((e) => ({ error: String(e) }));
      const w = await window.electronAPI.wallet.getInfo().catch(() => null);
      return { ws, addr: w && w.success && w.data ? String(w.data.address || '').slice(0, 8) + '…' : null };
    });
    const list = gt.ws && gt.ws.success && Array.isArray(gt.ws.data) ? gt.ws.data : [];
    note('wallet: ' + gt.addr + ' | drives live: ' + list.length);
    check('drive.list returns real drives LIVE', list.length > 0, `count=${list.length}`);
    const pub = list.filter((d) => d.privacy === 'public');
    const priv = list.filter((d) => d.privacy === 'private');
    note('public=' + pub.length + ' private=' + priv.length);
    await shot(page, 'auth-02-welcomeback.png');

    // ---- select a PUBLIC drive (read-only tour; avoids unlock modal) ----
    const targetName = pub[0].name;
    note('selecting public drive: ' + targetName);
    const card = page.getByText(targetName, { exact: false }).first();
    await card.click({ timeout: 15000 }).catch(async () => {
      const radios = page.locator('input[type="radio"]');
      if (await radios.count()) await radios.first().check();
    });
    await page.waitForTimeout(500);
    const cont = page.getByRole('button', { name: /Continue with Selected Drive/i });
    await cont.click();
    note('continuing -> sync-setup');

    // ---- sync-setup: choose folder (stubbed) + Start Syncing ----
    await page.getByRole('heading', { name: /Set Up Sync Folder/i }).waitFor({ state: 'visible', timeout: 60000 }).catch(() => note('sync-setup heading not seen'));
    await shot(page, 'auth-03-sync-setup.png');
    const chooseBtn = page.getByRole('button', { name: /Choose Folder/i });
    if (await chooseBtn.count()) { await chooseBtn.click(); await page.waitForTimeout(800); }
    const startBtn = page.getByRole('button', { name: /Start Syncing/i });
    await startBtn.waitFor({ state: 'visible', timeout: 15000 });
    check('Start Syncing enabled after folder chosen (dialog stub worked)', !(await startBtn.isDisabled()));
    await startBtn.click();
    note('Start Syncing clicked -> dashboard');

    // ---- DASHBOARD ----
    let dash = false;
    try { await page.getByRole('tab', { name: /Overview/i }).first().waitFor({ state: 'visible', timeout: 90000 }); dash = true; }
    catch (e) { note('dashboard Overview tab not seen: ' + e.message); }
    check('reached authenticated DASHBOARD', dash);
    await page.waitForTimeout(2500);
    await shot(page, 'auth-04-dashboard.png');

    if (dash) {
      // ground truth: overview stats + permaweb files for the selected drive
      const dgt = await page.evaluate(async () => {
        const drivesR = await window.electronAPI.drive.listWithStatus().catch(() => null);
        const mapR = await window.electronAPI.driveMappings.getPrimary().catch(() => null);
        let files = null;
        try {
          const active = mapR && mapR.success && mapR.data ? mapR.data.driveId : null;
          if (active) { const f = await window.electronAPI.drive.getPermawebFiles(active, false); files = f && f.success && Array.isArray(f.data) ? f.data.length : (Array.isArray(f) ? f.length : null); }
        } catch (e) { files = 'err:' + String(e && e.message || e).slice(0, 60); }
        return { primaryDrive: mapR && mapR.success && mapR.data ? { name: mapR.data.driveName, id: String(mapR.data.driveId || '').slice(0, 8) + '…' } : null, permawebFileCount: files };
      });
      note('primary mapping: ' + JSON.stringify(dgt.primaryDrive) + ' | permaweb files: ' + dgt.permawebFileCount);

      // ---- Tab tour ----
      const tabs = ['Overview', 'Upload Queue', 'Download Queue', 'Activity', 'Permaweb'];
      for (const t of tabs) {
        try {
          const tab = page.getByRole('tab', { name: new RegExp('^' + t, 'i') }).first();
          if (await tab.count()) { await tab.click(); await page.waitForTimeout(3000); await shot(page, 'auth-05-tab-' + t.toLowerCase().replace(/ /g, '-') + '.png'); note('tab: ' + t); }
        } catch (e) { note('tab ' + t + ' failed: ' + e.message); }
      }

      // a11y ground truth on dashboard tabs (H-A11Y-4 verification)
      const a11y = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
        const controlsTargets = tabs.map((t) => t.getAttribute('aria-controls'));
        const panelIds = panels.map((p) => p.id);
        const dangling = controlsTargets.filter((id) => id && !document.getElementById(id));
        // toasts
        const toastRegion = document.querySelector('[aria-live]');
        return { tabCount: tabs.length, panelCount: panels.length, controlsTargets, panelIds, danglingControls: dangling, hasAriaLiveRegion: !!toastRegion };
      });
      note('a11y tabs: ' + JSON.stringify(a11y));
      check('H-A11Y-4 FIXED: tab aria-controls all resolve to real panels', a11y.danglingControls.length === 0, `dangling=${JSON.stringify(a11y.danglingControls)}`);
      check('H-A11Y-4 FIXED: role=tabpanel present', a11y.panelCount > 0, `panels=${a11y.panelCount}`);

      // ---- Settings modal ----
      try {
        await page.getByRole('button', { name: /Overview/i }).first().count(); // ensure page steady
        // open user menu then Settings
        const menuBtn = page.locator('.dashboard-header-actions button').first();
        await menuBtn.click(); await page.waitForTimeout(600);
        await shot(page, 'auth-06-usermenu.png');
        const settingsItem = page.getByText(/^Settings$/i).first();
        if (await settingsItem.count()) { await settingsItem.click(); await page.waitForTimeout(1500); await shot(page, 'auth-07-settings.png'); note('opened Settings'); }
        const settingsA11y = await page.evaluate(() => {
          const dlg = document.querySelector('[role="dialog"]');
          const gwLabel = document.querySelector('label[for]');
          return { hasDialog: !!dlg, ariaModal: dlg ? dlg.getAttribute('aria-modal') : null, gatewayText: (document.body.textContent || '').includes('turbo-gateway.com') };
        });
        note('settings a11y: ' + JSON.stringify(settingsA11y));
        check('SET-1 modal is role=dialog + aria-modal (A11Y-2 fix)', settingsA11y.hasDialog && settingsA11y.ariaModal === 'true');
        check('SET-3 gateway default turbo-gateway.com visible', settingsA11y.gatewayText);
        // Escape closes?
        await page.keyboard.press('Escape'); await page.waitForTimeout(600);
        const stillOpen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
        check('SET-1 Escape closes settings modal (A11Y)', !stillOpen, `stillOpen=${stillOpen}`);
      } catch (e) { note('settings flow failed: ' + e.message); await shot(page, 'auth-07-settings-ERR.png'); }

      // ---- Turbo Credits manager ----
      try {
        const menuBtn = page.locator('.dashboard-header-actions button').first();
        await menuBtn.click(); await page.waitForTimeout(500);
        const turboItem = page.getByText(/Turbo Credits|Buy Credits|Turbo/i).first();
        if (await turboItem.count()) { await turboItem.click(); await page.waitForTimeout(2500); await shot(page, 'auth-08-turbo.png'); note('opened Turbo manager'); }
        // back out
        const back = page.getByRole('button', { name: /Back|Close|Dashboard/i }).first();
        if (await back.count()) { await back.click(); await page.waitForTimeout(1000); }
      } catch (e) { note('turbo flow failed: ' + e.message); }

      // ---- DriveSelector dropdown ----
      try {
        const ds = page.locator('.dashboard-header-center button').first();
        await ds.click(); await page.waitForTimeout(1000); await shot(page, 'auth-09-driveselector.png'); note('opened DriveSelector');
        await page.keyboard.press('Escape');
      } catch (e) { note('driveselector failed: ' + e.message); }
    }

    check('no console errors during authenticated flow', consoleErrors.length === 0, `count=${consoleErrors.length}`);
    if (consoleErrors.length) consoleErrors.slice(0, 10).forEach((e) => console.log('       ! ' + e.slice(0, 200)));

    await app.close();
    check('app closed cleanly', true);
  } catch (err) {
    check('run completed without harness error', false, err && err.message);
    try { await shot(page, 'auth-ERROR.png'); } catch { /* noop */ }
    try { await app.close(); } catch { /* noop */ }
  }

  const failed = results.filter((r) => !r.c);
  console.log('\n================ UI AUTHENTICATED (LIVE) RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
