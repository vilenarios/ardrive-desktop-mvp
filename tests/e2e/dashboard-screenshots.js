#!/usr/bin/env node
/**
 * DESIGN-4: dashboard-shell design-review screenshot tool.
 *
 * Companion to tests/e2e/screenshots.js (INFRA-12), which only captures the
 * PRE-AUTH onboarding screens. DESIGN-4 restyled the post-auth Dashboard
 * shell (header/tabs/drive selector), which requires an actual drive to
 * exist — there is no way to reach that screen without the same real
 * (zero-fund, Turbo-free-tier) wallet-import + drive-creation flow that
 * tests/e2e/smoke.js already drives. This script reuses that exact flow
 * (steps 1-8 of smoke.js) then, instead of dropping a file into the sync
 * folder, captures:
 *
 *   dashboard-overview       Dashboard shell, Overview tab, both themes
 *   dashboard-drive-selector Drive selector dropdown open
 *
 * MONEY RAIL (same as smoke.js): the wallet is generated fresh per run and
 * NEVER funded; drive creation itself has no on-chain cost when Turbo
 * accepts it as a free-tier ArFS metadata action for a zero-fund wallet, and
 * nothing here ever uploads a file. If the free-tier path is rejected for
 * any reason, the run fails loudly rather than falling back to a paid path.
 *
 * Prereq: `npm run build` (dist/main + dist/renderer must exist).
 * Run:    `node tests/e2e/dashboard-screenshots.js`               (both themes)
 *         `node tests/e2e/dashboard-screenshots.js --theme=dark`   (one theme)
 * Output: tests/e2e/artifacts/dashboard-review/<run-id>/<theme>/*.png
 *
 * Outside the vitest include glob — `npm run test` never picks this up.
 */

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const Arweave = require('arweave');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUN_ID =
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
const ARTIFACTS_ROOT = path.join(__dirname, 'artifacts', 'dashboard-review', RUN_ID);

const UI_TIMEOUT = 30_000;
const IMPORT_TIMEOUT = 180_000;
const DRIVE_CREATE_TIMEOUT = 420_000;
const LAUNCH_TIMEOUT = 120_000;

function parseArgs() {
  const args = { theme: 'both' };
  for (const raw of process.argv.slice(2)) {
    const m = /^--theme=(.*)$/.exec(raw);
    if (m) args.theme = m[1];
  }
  return args;
}

const ALL_THEMES = ['light', 'dark'];
function resolveThemes(value) {
  if (!value || value === 'all' || value === 'both') return ALL_THEMES;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

async function runTheme(theme, manifest) {
  const themeDir = path.join(ARTIFACTS_ROOT, theme);
  await fsp.mkdir(themeDir, { recursive: true });
  console.log(`\n--- theme: ${theme} ---`);

  const runId = `${RUN_ID}-${theme}`;
  const driveName = `design4-${theme}-${Date.now().toString(36).slice(-4)}`;
  const password = `Design4-${runId}`;

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-dash-screens-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  const syncRoot = path.join(tmpRoot, 'sync');
  const walletPath = path.join(tmpRoot, 'wallet.json');
  await fsp.mkdir(userDataDir, { recursive: true });
  await fsp.mkdir(syncRoot, { recursive: true });

  const arweave = Arweave.init({});
  const jwk = await arweave.wallets.generate();
  const address = await arweave.wallets.jwkToAddress(jwk);
  await fsp.writeFile(walletPath, JSON.stringify(jwk), { mode: 0o600 });
  console.log(`  wallet: ${address} (freshly generated, zero funds)`);

  const electronApp = await electron.launch({
    cwd: REPO_ROOT,
    args: ['.'],
    timeout: LAUNCH_TIMEOUT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ARDRIVE_TEST_USERDATA: userDataDir,
      ARDRIVE_DEV_MODE: 'true',
      ARDRIVE_DEV_WALLET_PATH: walletPath,
      ARDRIVE_DEV_PASSWORD: password,
      ARDRIVE_DEV_SYNC_FOLDER: syncRoot
    }
  });

  try {
    const page = await electronApp.firstWindow({ timeout: LAUNCH_TIMEOUT });
    page.setDefaultTimeout(UI_TIMEOUT);
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await page.waitForLoadState('domcontentloaded');

    // ---- welcome + import (dev-mode autofill) ----
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByText('wallet.json', { exact: false }).first().waitFor({ timeout: UI_TIMEOUT });
    const importButton = page.getByRole('button', { name: 'Import Wallet' });
    const deadline1 = Date.now() + UI_TIMEOUT;
    while (!(await importButton.isEnabled())) {
      if (Date.now() > deadline1) throw new Error('Import Wallet button never enabled (autofill)');
      await page.waitForTimeout(300);
    }
    await importButton.click();

    // ---- drive setup (fresh wallet has no drives) ----
    const driveSetupHeading = page.getByRole('heading', { name: /Create a New Drive|Set Up Your Storage/ });
    const createNewDriveButton = page.getByRole('button', { name: /Create New Public Drive/ });
    await driveSetupHeading.or(createNewDriveButton).first().waitFor({ state: 'visible', timeout: IMPORT_TIMEOUT });
    if (await createNewDriveButton.isVisible().catch(() => false)) {
      await createNewDriveButton.click();
      await driveSetupHeading.waitFor({ state: 'visible', timeout: UI_TIMEOUT });
    }

    await page.getByPlaceholder('e.g., Personal Files, Work Documents').fill(driveName);
    await page.getByText(syncRoot, { exact: false }).first().waitFor({ timeout: UI_TIMEOUT });
    await page.getByRole('button', { name: 'Continue to Review' }).click();
    await page.getByRole('heading', { name: 'Review Your Setup' }).waitFor({ timeout: UI_TIMEOUT });

    // ---- create drive (real, on-chain, zero-fund Turbo free tier) ----
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    const success = page.getByRole('heading', { name: /Your Drive Is Ready/ });
    const failure = page.locator('.error-message');
    const deadline2 = Date.now() + DRIVE_CREATE_TIMEOUT;
    for (;;) {
      if (await success.isVisible().catch(() => false)) break;
      if (await failure.isVisible().catch(() => false)) {
        const text = (await failure.innerText()).replace(/\s+/g, ' ').trim();
        throw new Error(`Drive creation rejected: ${text}`);
      }
      if (Date.now() > deadline2) throw new Error('drive creation timed out');
      await page.waitForTimeout(3_000);
    }

    // ---- dashboard ----
    await page.getByRole('button', { name: /Open Dashboard/ }).click();
    await page.getByRole('tab', { name: /Upload Queue/ }).waitFor({ state: 'visible', timeout: IMPORT_TIMEOUT });
    // Let the header/tabs/first paint settle before the shot.
    await page.waitForTimeout(1_500);

    const overviewFile = path.join(themeDir, 'dashboard-overview.png');
    await page.screenshot({ path: overviewFile, timeout: 10_000 });
    manifest.captures.push({ theme, screen: 'dashboard-overview', file: overviewFile });
    console.log(`  [ok] ${theme}/dashboard-overview`);

    // ---- drive selector dropdown open ----
    await page.getByRole('button', { name: new RegExp(driveName) }).click();
    await page.waitForTimeout(400); // dropdown-fade-in animation
    const driveSelectorFile = path.join(themeDir, 'dashboard-drive-selector.png');
    await page.screenshot({ path: driveSelectorFile, timeout: 10_000 });
    manifest.captures.push({ theme, screen: 'dashboard-drive-selector', file: driveSelectorFile });
    console.log(`  [ok] ${theme}/dashboard-drive-selector`);
  } catch (err) {
    manifest.captures.push({ theme, screen: 'dashboard-flow', error: err.message });
    console.error(`  [FAIL] ${theme}: ${err.message}`);
    throw err;
  } finally {
    await electronApp.close().catch(() => {});
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const mainEntry = path.join(REPO_ROOT, 'dist', 'main', 'main.js');
  const rendererEntry = path.join(REPO_ROOT, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    console.error('dist/ build not found. Run `npm run build` first.');
    process.exit(2);
  }

  const { theme } = parseArgs();
  const themes = resolveThemes(theme);

  await fsp.mkdir(ARTIFACTS_ROOT, { recursive: true });
  console.log(`Run id:    ${RUN_ID}`);
  console.log(`Themes:    ${themes.join(', ')}`);
  console.log(`Artifacts: ${ARTIFACTS_ROOT}`);

  const manifest = { runId: RUN_ID, themes, startedAt: new Date().toISOString(), captures: [], result: 'pass' };
  let failed = false;
  for (const t of themes) {
    try {
      await runTheme(t, manifest);
    } catch {
      failed = true;
    }
  }
  manifest.result = failed ? 'fail' : 'pass';
  manifest.finishedAt = new Date().toISOString();
  await fsp.writeFile(path.join(ARTIFACTS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n================ DASHBOARD SCREENSHOTS RESULT ================');
  console.log(`Result: ${manifest.result.toUpperCase()}`);
  for (const c of manifest.captures) {
    console.log(`  [${c.error ? 'FAIL' : 'ok  '}] ${c.theme}/${c.screen}${c.file ? ` -> ${c.file}` : ''}${c.error ? ` (${c.error})` : ''}`);
  }
  console.log('================================================================');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
