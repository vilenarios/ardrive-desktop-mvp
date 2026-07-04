#!/usr/bin/env node
/**
 * INFRA-12: design-review screenshot tool.
 *
 * A fast, NETWORK-FREE companion to tests/e2e/smoke.js. Launches the REAL
 * built app with a disposable --user-data-dir and captures the pre-auth
 * screens (first-run / onboarding / wallet-setup) that the DESIGN track
 * (DESIGN-1..7, D-023) needs for aesthetic review — in both light and dark
 * color-scheme emulation.
 *
 * Screens captured (per theme):
 *   01-welcome                    Welcome to ArDrive Desktop (choose action)
 *   02-create-account-password    "Secure Your Account" password form
 *   03-create-recovery-phrase     "Save Your Recovery Phrase" (fresh local wallet)
 *   04-import-account-form        "Import Your Account" (blank form)
 *
 * NETWORK: none of these steps submit a real import or query the network for
 * drives. The ONE incidental call is inside the app's local "Create Account"
 * flow (WalletManager.getWalletInfo -> a read-only AR/Turbo balance lookup for
 * the freshly generated, never-funded address) — that call is wrapped in its
 * own try/catch in wallet-manager-secure.ts with a '0' fallback, so it cannot
 * fail the screenshot even if the network is unreachable or rate-limited.
 * MONEY: zero spend is possible here — nothing is ever submitted to a
 * gateway or bundler; the wallet is generated fresh, in a disposable
 * userData dir, and discarded at the end of the run.
 *
 * Today (2026-07) the app has NO ThemeProvider/dark-mode CSS yet (DESIGN-2 is
 * still `todo` in docs/product/BACKLOG.md) — so --theme=dark screenshots will
 * look IDENTICAL to light ones. That is expected, not a harness bug: this
 * tool seeds a forward-compatible `theme` key into the disposable config.json
 * AND calls page.emulateMedia({colorScheme}) so that the moment DESIGN-2 reads
 * either signal, dark screenshots start rendering dark with zero changes here.
 *
 * Prereq: `npm run build` (dist/main + dist/renderer must exist).
 * Run:    `npm run smoke:screens`                      (both themes, all screens)
 *         `node tests/e2e/screenshots.js --theme=dark`  (one theme)
 *         `node tests/e2e/screenshots.js --screen=welcome,import-account-form`
 * Output: tests/e2e/artifacts/design-review/<run-id>/<theme>/*.png + manifest.json
 *
 * This file is intentionally OUTSIDE the vitest include glob
 * (tests/**\/*.test.{ts,tsx}) so `npm run test` never picks it up.
 */

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUN_ID =
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + Math.random().toString(36).slice(2, 6);
const ARTIFACTS_ROOT = path.join(__dirname, 'artifacts', 'design-review', RUN_ID);
const UI_TIMEOUT = 30_000;
const LAUNCH_TIMEOUT = 60_000;
const PASSWORD = `Screens-${RUN_ID}`;

// ---------------------------------------------------------------------------
// CLI args / env
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = { theme: 'both', screen: 'all' };
  for (const raw of process.argv.slice(2)) {
    const m = /^--(theme|screen)=(.*)$/.exec(raw);
    if (m) args[m[1]] = m[2];
  }
  const themeEnv = process.env.SMOKE_THEME;
  const screenEnv = process.env.SMOKE_SCREEN;
  if (themeEnv) args.theme = themeEnv;
  if (screenEnv) args.screen = screenEnv;
  return args;
}

const ALL_THEMES = ['light', 'dark'];
const ALL_SCREENS = ['welcome', 'create-account-password', 'create-recovery-phrase', 'import-account-form'];

function resolveList(value, all) {
  if (!value || value === 'all' || value === 'both') return all;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Screen steps — each receives the live Page and returns when settled.
// ---------------------------------------------------------------------------
const STEPS = {
  async welcome(page) {
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT });
    await page.getByRole('button', { name: /Import Existing Account/ }).waitFor({ state: 'visible' });
  },
  async 'create-account-password'(page) {
    await page.getByRole('button', { name: /Create New Account/ }).click();
    await page.getByRole('heading', { name: 'Secure Your Account' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT });
  },
  async 'create-recovery-phrase'(page) {
    // Assumes 'create-account-password' already ran in this same window.
    // PasswordForm/PasswordInput render a bare sibling <label> (no htmlFor/
    // aria-labelledby), so getByLabel() cannot associate it — go by input
    // order instead: [0] password, [1] confirm password.
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(PASSWORD);
    await passwordInputs.nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create Account' }).click();
    // Local wallet generation (bip39 + JWK derivation) — no network required;
    // the one incidental balance lookup inside it fails soft to '0'.
    await page
      .getByRole('heading', { name: 'Save Your Recovery Phrase' })
      .waitFor({ state: 'visible', timeout: UI_TIMEOUT });
  },
  async 'import-account-form'(page) {
    // Independent entry point — needs a fresh window back at step 1.
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible', timeout: UI_TIMEOUT });
  }
};

// Each flow is a sequence of screens captured back-to-back in ONE fresh app
// window, in the app's own navigation order. Screens in different flows
// can't share a window: e.g. once 'create-account-password' has advanced the
// UI past step 1, that window can never show 'welcome' (step 1) again.
// Every flow starts from the app's real initial state (step 1), so each gets
// its own disposable launch.
const FLOWS = [
  ['welcome'],
  ['create-account-password', 'create-recovery-phrase'],
  ['import-account-form']
];

async function screenshot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, timeout: 10_000 });
  return file;
}

async function runFlow(theme, themeDir, flow, wanted, manifest) {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-screens-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  await fsp.mkdir(userDataDir, { recursive: true });

  // Forward-compatible seed: once DESIGN-2 lands a ThemeProvider that reads a
  // `theme` key from global config.json, this starts working with zero
  // changes to this harness. Harmless no-op today (ConfigManager doesn't read
  // this key yet, extra JSON fields are ignored).
  await fsp.writeFile(
    path.join(userDataDir, 'config.json'),
    JSON.stringify({ isFirstRun: true, theme }, null, 2)
  );

  const electronApp = await electron.launch({
    cwd: REPO_ROOT,
    args: ['.'],
    timeout: LAUNCH_TIMEOUT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ARDRIVE_TEST_USERDATA: userDataDir
      // Deliberately no ARDRIVE_DEV_* vars: this tool reviews the true
      // first-run experience, not the dev-autofill convenience path.
    }
  });

  try {
    const page = await electronApp.firstWindow({ timeout: LAUNCH_TIMEOUT });
    page.setDefaultTimeout(UI_TIMEOUT);
    // Chromium-level color-scheme emulation. Currently a no-op visually
    // (no prefers-color-scheme CSS in the app yet) but wired for the day it
    // exists — see module doc comment.
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await page.waitForLoadState('domcontentloaded');

    // Run every step in the flow (earlier steps may just be navigation
    // required to reach a later one) but only screenshot the ones the
    // caller actually asked for.
    for (const name of flow) {
      await STEPS[name](page);
      if (!wanted.includes(name)) continue;
      const file = await screenshot(page, themeDir, name);
      manifest.captures.push({ theme, screen: name, file });
      console.log(`  [ok] ${theme}/${name}`);
    }
  } catch (err) {
    manifest.captures.push({ theme, screen: flow.join('+'), error: err.message });
    console.error(`  [FAIL] ${theme}/${flow.join('+')}: ${err.message}`);
    throw err;
  } finally {
    await electronApp.close().catch(() => {});
    await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function captureTheme(theme, screens, manifest) {
  const themeDir = path.join(ARTIFACTS_ROOT, theme);
  await fsp.mkdir(themeDir, { recursive: true });
  console.log(`\n--- theme: ${theme} ---`);

  let failed = false;
  for (const flow of FLOWS) {
    const wanted = flow.filter((s) => screens.includes(s));
    if (wanted.length === 0) continue;
    try {
      await runFlow(theme, themeDir, flow, wanted, manifest);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error(`one or more flows failed for theme ${theme}`);
}

async function main() {
  const mainEntry = path.join(REPO_ROOT, 'dist', 'main', 'main.js');
  const rendererEntry = path.join(REPO_ROOT, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    console.error('dist/ build not found. Run `npm run build` first.');
    process.exit(2);
  }

  const { theme, screen } = parseArgs();
  const themes = resolveList(theme, ALL_THEMES);
  const screens = resolveList(screen, ALL_SCREENS);
  const unknown = screens.filter((s) => !ALL_SCREENS.includes(s));
  if (unknown.length) {
    console.error(`Unknown --screen value(s): ${unknown.join(', ')}. Known: ${ALL_SCREENS.join(', ')}`);
    process.exit(2);
  }

  await fsp.mkdir(ARTIFACTS_ROOT, { recursive: true });
  console.log(`Run id:    ${RUN_ID}`);
  console.log(`Themes:    ${themes.join(', ')}`);
  console.log(`Screens:   ${screens.join(', ')}`);
  console.log(`Artifacts: ${ARTIFACTS_ROOT}`);

  const manifest = { runId: RUN_ID, themes, screens, startedAt: new Date().toISOString(), captures: [], result: 'pass' };
  let failed = false;
  for (const t of themes) {
    try {
      await captureTheme(t, screens, manifest);
    } catch {
      failed = true;
    }
  }
  manifest.result = failed ? 'fail' : 'pass';
  manifest.finishedAt = new Date().toISOString();
  await fsp.writeFile(path.join(ARTIFACTS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n================ SCREENSHOTS RESULT ================');
  console.log(`Result: ${manifest.result.toUpperCase()}`);
  for (const c of manifest.captures) {
    console.log(`  [${c.error ? 'FAIL' : 'ok  '}] ${c.theme}/${c.screen}${c.file ? ` -> ${c.file}` : ''}${c.error ? ` (${c.error})` : ''}`);
  }
  console.log('=====================================================');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
