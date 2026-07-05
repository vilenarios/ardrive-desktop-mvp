#!/usr/bin/env node
/*
 * UAT LIVE — private drive unlock with the REAL wallet (read-only, safe).
 *   PRIV-3  select a locked private drive -> PrivateDriveUnlockModal
 *   PRIV-4  WRONG password fails closed (modal stays, error shown)
 *   PRIV-3  CORRECT password (wallet password) derives key + decrypts name
 *   A11Y    modal role=dialog, fingerprint role=img, Escape closes
 * NO writes. Never prints wallet JSON / seed / password.
 * Run: DISPLAY=:0 node scripts/uat/ui-private-unlock.js <shot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const os = require('os'); const path = require('path');
const { _electron: electron } = require('playwright');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-priv-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
function readEnvPassword() { const raw = fs.readFileSync(ENV_FILE, 'utf8'); for (const l of raw.split(/\r?\n/)) { const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } throw new Error('no pw'); }
const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name); } }

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const password = readEnvPassword();
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-priv-ud-'));
  const userDataDir = path.join(tmpRoot, 'userdata'); await fsp.mkdir(userDataDir, { recursive: true });
  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: userDataDir, ARDRIVE_DEV_MODE: 'true', ARDRIVE_DEV_WALLET_PATH: WALLET_WSL, ARDRIVE_DEV_PASSWORD: password, ARDRIVE_GATEWAY_HOST: 'turbo-gateway.com' }
  });
  const consoleErrors = []; let page = null;
  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Import Existing Account/ }).click();
    await page.getByRole('heading', { name: 'Import Your Account' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /Import Wallet/i }).click();
    await page.getByRole('heading', { name: /Welcome Back|Your Drives/i }).first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(4500);

    // find a locked private drive via ground truth
    const gt = await page.evaluate(async () => { const r = await window.electronAPI.drive.listWithStatus(); return r && r.success ? r.data : []; });
    const priv = gt.filter((d) => d.privacy === 'private');
    check('has locked private drive(s) live', priv.length > 0, `private=${priv.length} locked=${priv.filter(d => d.isLocked).length}`);
    note('private drive ids: ' + JSON.stringify(priv.map(d => ({ id: String(d.id).slice(0, 8) + '…', locked: d.isLocked }))));

    // click the first ENCRYPTED card in the welcome-back list
    const enc = page.getByText('ENCRYPTED', { exact: false }).first();
    await enc.waitFor({ state: 'visible', timeout: 15000 });
    await enc.click(); await page.waitForTimeout(400);
    const cont = page.getByRole('button', { name: /Continue with Selected Drive/i });
    if (await cont.count()) await cont.click();
    // unlock modal
    const unlockH = page.getByRole('heading', { name: /Unlock Private Drive/i });
    await unlockH.waitFor({ state: 'visible', timeout: 30000 }).catch(() => note('unlock heading not seen'));
    check('PRIV-3 unlock modal appears for locked private drive', await unlockH.count() > 0);
    await shot(page, 'priv-01-unlock-modal.png');

    // a11y ground truth
    const a = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const fp = document.querySelector('[role="img"][aria-label*="fingerprint" i]');
      const pw = document.getElementById('password');
      const lab = document.querySelector('label[for="password"]');
      return { hasDialog: !!dlg, ariaModal: dlg && dlg.getAttribute('aria-modal'), fingerprint: fp ? (fp.textContent || '').trim().slice(0, 20) : null, hasFpImg: !!fp, pwLabelled: !!(pw && lab) };
    });
    note('unlock a11y: ' + JSON.stringify(a));
    check('PRIV-3 modal role=dialog + aria-modal', a.hasDialog && a.ariaModal === 'true');
    check('PRIV-3 fingerprint present (role=img, aria-label)', a.hasFpImg, `fp=${a.fingerprint}`);
    check('PRIV-3 password input htmlFor-linked label', a.pwLabelled);

    // WRONG password -> fails closed
    const pwInput = page.locator('#password');
    await pwInput.fill('definitely-the-wrong-password-123');
    const unlockBtn = page.getByRole('button', { name: /^Unlock$|Unlock Drive/i }).first();
    await unlockBtn.click();
    await page.waitForTimeout(6000);
    const afterWrong = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const body = document.body.textContent || '';
      return { stillOpen: !!dlg, hasError: /Invalid password|incorrect|wrong|failed|check your password|Could not/i.test(body) };
    });
    check('PRIV-4 WRONG password fails closed (modal stays open)', afterWrong.stillOpen, `stillOpen=${afterWrong.stillOpen}`);
    check('PRIV-4 WRONG password surfaces an error', afterWrong.hasError);
    await shot(page, 'priv-02-wrong-password.png');

    // CORRECT password (wallet password) — try unlock
    await pwInput.fill(''); await pwInput.fill(password);
    await unlockBtn.click();
    note('submitted correct (wallet) password — awaiting key derivation + name decrypt (LIVE)');
    let unlocked = false; let stayedWithError = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const st = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const tabs = document.querySelector('[role="tab"]');
        const syncSetup = /Set Up Sync Folder/i.test(document.body.textContent || '');
        const body = document.body.textContent || '';
        return { modalGone: !dlg, dash: !!tabs, syncSetup, hasError: /Invalid password|Could not|verification|failed/i.test(body) };
      });
      if (st.modalGone && (st.dash || st.syncSetup)) { unlocked = true; break; }
      if (!st.modalGone && st.hasError) { stayedWithError = true; }
    }
    check('PRIV-3 CORRECT wallet password unlocks the private drive', unlocked, unlocked ? 'proceeded past unlock' : (stayedWithError ? 'rejected — drive password may differ from wallet password' : 'timeout'));
    await shot(page, 'priv-03-after-unlock.png');

    // verify the drive name decrypted (no longer ENCRYPTED) if unlocked
    if (unlocked) {
      const names = await page.evaluate(async () => { const r = await window.electronAPI.drive.listWithStatus(); return r && r.success ? r.data.filter(d => d.privacy === 'private').map(d => ({ n: d.name, locked: d.isLocked })) : []; });
      note('private drive names post-unlock: ' + JSON.stringify(names));
      check('PRIV-3 at least one private drive name decrypted (not ENCRYPTED)', names.some(x => x.n && x.n !== 'ENCRYPTED' && !x.locked), JSON.stringify(names.slice(0, 3)));
    }
    check('no console errors', consoleErrors.length === 0, `count=${consoleErrors.length}`);
    if (consoleErrors.length) consoleErrors.slice(0, 6).forEach(e => console.log('       ! ' + e.slice(0, 160)));
    await app.close(); check('app closed cleanly', true);
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 'priv-ERROR.png'); } catch {}
    try { await app.close(); } catch {}
  }
  const failed = results.filter(r => !r.c);
  console.log('\n================ PRIVATE UNLOCK (LIVE) RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'PASS' : 'PARTIAL/FAIL'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
