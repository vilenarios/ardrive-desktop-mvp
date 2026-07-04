#!/usr/bin/env node
/*
 * UAT POC — UI-automation feasibility proof (Playwright-Electron).
 *
 * Proves OPTION (a) from docs/product/UAT-HARNESS.md actually works in THIS
 * headless WSL/Linux environment: launch the REAL built app (dist/) via
 * playwright's _electron, drive the renderer through the accessibility tree
 * (getByRole), read ground truth over the real preload IPC bridge, and capture
 * a screenshot — the exact mechanism a UI-driving tester agent would use.
 *
 * Deliberately OFFLINE + ZERO-FUNDS: it launches into a DISPOSABLE userData
 * with NO stored profile and NO dev-wallet env, so the app rests on the
 * first-run wallet-setup screen (App.initializeApp: profiles.list() empty ->
 * setAppState('wallet-setup')) — reached with no network call, no wallet, no
 * money. It asserts the screen's headings/buttons render and quits. The FULL
 * end-to-end UI journey (wallet import -> drive create -> free-tier upload)
 * already lives in tests/e2e/smoke.js (INFRA-12) for a funded/human-ack'd run.
 *
 * Prereq: `npm run build` (dist/main + dist/renderer).
 * Run:    node scripts/uat/run-poc.js ui
 *   or:   node scripts/uat/poc-ui-launch.js
 * Needs a display: WSLg (DISPLAY=:0) or xvfb-run. GPU is disabled (software
 * render) so it works with no GPU passthrough.
 */
'use strict';

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UI_TIMEOUT = 30_000;

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return !!cond;
}

async function main() {
  const mainEntry = path.join(REPO_ROOT, 'dist', 'main', 'main.js');
  const rendererEntry = path.join(REPO_ROOT, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    console.error('dist/ not built. Run `npm run build` first.');
    process.exit(2);
  }
  if (!process.env.DISPLAY && process.platform === 'linux') {
    console.warn('WARNING: no DISPLAY. Use WSLg (DISPLAY=:0) or `xvfb-run node scripts/uat/poc-ui-launch.js`.');
  }

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-ui-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  await fsp.mkdir(userDataDir, { recursive: true });
  const shot = path.join(tmpRoot, 'first-run.png');

  console.log('Disposable userData:', userDataDir);

  const electronApp = await electron.launch({
    cwd: REPO_ROOT,
    // --disable-gpu / --no-sandbox make software rendering reliable headless.
    args: ['.', '--disable-gpu', '--no-sandbox'],
    timeout: 120_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',            // no auto DevTools
      ARDRIVE_TEST_USERDATA: userDataDir, // disposable-userData hook (main.ts:9)
      ARDRIVE_DEV_MODE: 'false'           // no wallet autofill -> genuine first run
    }
  });

  let page = null;
  try {
    page = await electronApp.firstWindow({ timeout: 120_000 });
    page.setDefaultTimeout(UI_TIMEOUT);

    // 1) disposable userData actually in effect (fails-closed hook)
    const effective = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    check('disposable userData hook in effect', effective === userDataDir, effective);

    // 2) first-run wallet-setup screen renders (drive via the a11y tree)
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' })
      .waitFor({ state: 'visible', timeout: UI_TIMEOUT });
    check('first-run heading "Welcome to ArDrive Desktop" visible', true);

    const createBtn = page.getByRole('button', { name: /Create New Account/ });
    const importBtn = page.getByRole('button', { name: /Import Existing Account/ });
    await createBtn.waitFor({ state: 'visible' });
    await importBtn.waitFor({ state: 'visible' });
    check('primary actions Create/Import present (getByRole button)', true);

    // 3) ground truth over the real preload IPC bridge (no network)
    const noProfiles = await page.evaluate(async () => {
      const r = await window.electronAPI.profiles.list();
      return r && r.success && Array.isArray(r.data) && r.data.length === 0;
    });
    check('preload IPC reachable & reports 0 profiles (envelope shape)', noProfiles);

    // 4) screenshot proves the renderer actually painted headless
    await page.screenshot({ path: shot, timeout: 15_000 });
    const size = fs.existsSync(shot) ? fs.statSync(shot).size : 0;
    check('screenshot captured (renderer painted under software render)', size > 1000, `${size} bytes @ ${shot}`);

    // 5) clean quit
    await electronApp.close();
    check('app closed cleanly', true);
  } catch (err) {
    check('run completed without harness error', false, err.message);
    try { await page?.screenshot({ path: path.join(tmpRoot, 'error.png') }); } catch { /* best effort */ }
    try { await electronApp.close(); } catch { /* best effort */ }
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n================ UI-LAUNCH POC RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'FAIL'));
  console.log('Screenshot kept at: ' + shot + ' (in os.tmpdir, not committed)');
  console.log('=====================================================');
  // Keep the screenshot dir for inspection; userData is disposable but small.
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error('UI POC FATAL:', err && err.stack ? err.stack : err); process.exit(1); });
