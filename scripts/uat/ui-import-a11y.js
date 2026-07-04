#!/usr/bin/env node
/*
 * UAT UI run — Import surfaces + a11y ground-truth (safe, offline, $0).
 *   ONB-4  Import -> Wallet File dropzone; assert it is a <div> with NO
 *          role/tabIndex (A11Y-5 / H-A11Y-3 keyboard-inoperable dropzone).
 *   ONB-5  Import -> Recovery Phrase; neutral word-count feedback copy.
 *   A11Y   first-run Create/Import are real <button>s (roles present).
 * Screenshots -> argv[2].
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-imp-'));
const results = [];
const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); };
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 15000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name); } };

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-imp-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata');
  await fsp.mkdir(userDataDir, { recursive: true });
  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir, ARDRIVE_DEV_MODE: 'false' }
  });
  let page = null;
  try {
    page = await app.firstWindow({ timeout: 120000 });
    page.setDefaultTimeout(30000);
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });

    // A11Y: first-run actions are real buttons
    const createRole = await page.getByRole('button', { name: /Create New Account/ }).count();
    const importRole = await page.getByRole('button', { name: /Import Existing Account/ }).count();
    check('A11Y first-run actions are role=button', createRole > 0 && importRole > 0);

    // ONB-4: Import -> Wallet File
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    check('ONB-4 Import step heading "Import Your Account"', true);
    await shot(page, 'onb4-import-account.png');
    // The Wallet File tab should be default; assert dropzone a11y ground truth
    const dz = await page.evaluate(() => {
      const el = document.querySelector('.wallet-dropzone');
      if (!el) return { found: false };
      return {
        found: true,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
        hasOnKeyDown: false // not observable from DOM; React handler
      };
    });
    check('ONB-4 dropzone element found', dz.found, JSON.stringify(dz));
    check('A11Y-5 dropzone is <div> with NO role (keyboard-inoperable)',
      dz.found && dz.tag === 'div' && (dz.role === null), `tag=${dz.tag} role=${dz.role} tabindex=${dz.tabindex}`);

    // ONB-5: Recovery Phrase tab
    const recoveryTab = page.getByText('Recovery Phrase', { exact: true }).first();
    if (await recoveryTab.count()) {
      await recoveryTab.click();
      await page.waitForTimeout(300);
      const ta = page.locator('#recovery-phrase-input');
      if (await ta.count()) {
        await ta.fill('one two three');
        await page.waitForTimeout(200);
        const cnt = await page.getByText(/3 words entered \(12 or 24 expected\)/).count();
        check('ONB-5 neutral word-count copy "(12 or 24 expected)"', cnt > 0);
        // a11y: textarea has an associated label (htmlFor)
        const labelled = await page.evaluate(() => {
          const ta = document.getElementById('recovery-phrase-input');
          const lab = document.querySelector('label[for="recovery-phrase-input"]');
          return !!ta && !!lab;
        });
        check('ONB-5 recovery textarea has htmlFor-linked label', labelled);
      }
      await shot(page, 'onb5-recovery-phrase.png');
    }
    await app.close();
    check('app closed cleanly', true);
  } catch (err) {
    check('run completed without harness error', false, err.message);
    try { await shot(page, 'error-import.png'); } catch { /* noop */ }
    try { await app.close(); } catch { /* noop */ }
  }
  const failed = results.filter((r) => !r.c);
  console.log(`\nTotal: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('Screenshots in: ' + SHOT_DIR);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
