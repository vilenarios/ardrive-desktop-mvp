#!/usr/bin/env node
/*
 * UAT LIVE CERTIFICATION — private-drive unlock with the REAL wallet.
 * READ-ONLY / NO-SPEND / NO-WRITE. Never prints wallet JSON, password, or
 * decrypted private content; reports counts / PASS-FAIL / generic descriptors.
 *
 * Steps:
 *   1. Import real wallet -> welcome-back. Ground-truth drive.listWithStatus():
 *      confirm 21 drives incl. 4 private (locked). Screenshot.
 *   2. Drive the PrivateDriveUnlockModal for a chosen drive (a11y: dialog,
 *      fingerprint, labelled password). Screenshot.
 *   3. WRONG password in the modal -> fails closed (modal stays, error).
 *   4. CORRECT password in the modal on a v1-signature drive -> SUCCEEDS; drive
 *      name decrypts (ground truth). Screenshot.
 *   5. Ground-truth the app's REAL drive:unlock IPC across ALL private drives to
 *      prove the v1/v2 signature-type matrix (the bug): v1 drives unlock with
 *      the correct pw; v2 drives are REJECTED with the correct pw.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-private-cert.js <shot-dir>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const os = require('os'); const path = require('path');
const { _electron: electron } = require('playwright');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SHOT_DIR = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ardrive-uat-privcert-'));
const WALLET_WSL = '/mnt/c/Source/arweave-keyfile-iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA.json';
const ENV_FILE = '/mnt/c/source/ardrive-desktop-mvp/.env';
// Ground truth from priv-signature-diagnose.js: which private drives are v1 vs v2.
const V1_DRIVE_PREFIX = 'cabca9d6'; // v1 -> app unlocks with correct pw
const V2_DRIVE_PREFIX = 'cce4300f'; // v2 -> app REJECTS even with correct pw (bug)
function readEnvPassword() { const raw = fs.readFileSync(ENV_FILE, 'utf8'); for (const l of raw.split(/\r?\n/)) { const m = l.match(/^\s*ARDRIVE_DEV_PASSWORD\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } throw new Error('no pw'); }
const results = []; const check = (n, c, d) => { results.push({ n, c: !!c, d }); console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
const note = (m) => console.log('    · ' + m);
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name); } }

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const password = readEnvPassword();
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ardrive-uat-privcert-ud-'));
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
    await page.getByRole('heading', { name: /Welcome Back|Your Drives|Choose a drive/i }).first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // ---- STEP 1: ground truth ----
    const gt = await page.evaluate(async () => { const r = await window.electronAPI.drive.listWithStatus(); return r && r.success ? r.data : []; });
    const priv = gt.filter((d) => d.privacy === 'private');
    check('STEP1 listWithStatus returns drives live', gt.length > 0, `total=${gt.length} public=${gt.filter(d => d.privacy === 'public').length} private=${priv.length}`);
    check('STEP1 has 4 private drives, all locked', priv.length === 4 && priv.every(d => d.isLocked), `private=${priv.length} locked=${priv.filter(d => d.isLocked).length}`);
    note('private drive ids: ' + JSON.stringify(priv.map(d => ({ id: String(d.id).slice(0, 8) + '…', locked: d.isLocked }))));
    const v1drive = priv.find(d => String(d.id).startsWith(V1_DRIVE_PREFIX));
    const v2drive = priv.find(d => String(d.id).startsWith(V2_DRIVE_PREFIX));
    check('STEP1 expected v1 + v2 drives present', !!v1drive && !!v2drive, `v1=${v1drive ? v1drive.id.slice(0, 8) : 'MISSING'} v2=${v2drive ? v2drive.id.slice(0, 8) : 'MISSING'}`);
    await shot(page, 'cert-01-welcome-back-drives.png');

    // ---- STEP 2-4: drive the modal on the V1 drive (should SUCCEED) ----
    const targetId = v1drive ? v1drive.id : (priv[0] && priv[0].id);
    const radio = page.locator(`input[type="radio"][value="${targetId}"]`);
    if (await radio.count()) {
      await radio.first().click({ force: true });
      await page.waitForTimeout(400);
    } else {
      note('radio for target drive not found — clicking first ENCRYPTED card');
      const enc = page.getByText('ENCRYPTED', { exact: false }).first();
      if (await enc.count()) await enc.click();
    }
    const cont = page.getByRole('button', { name: /Continue with Selected Drive/i });
    if (await cont.count()) await cont.click();

    const unlockH = page.getByRole('heading', { name: /Unlock Private Drive/i });
    await unlockH.waitFor({ state: 'visible', timeout: 30000 }).catch(() => note('unlock heading not seen'));
    check('STEP2 unlock modal appears for locked private drive', await unlockH.count() > 0);
    const a = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const fp = document.querySelector('[role="img"][aria-label*="fingerprint" i]');
      const pw = document.getElementById('password');
      const lab = document.querySelector('label[for="password"]');
      return { hasDialog: !!dlg, ariaModal: dlg && dlg.getAttribute('aria-modal'), hasFpImg: !!fp, pwLabelled: !!(pw && lab) };
    });
    check('STEP2 modal a11y: dialog+aria-modal, fingerprint img, labelled password', a.hasDialog && a.ariaModal === 'true' && a.hasFpImg && a.pwLabelled, JSON.stringify(a));
    await shot(page, 'cert-02-unlock-modal.png');

    const pwInput = page.locator('#password');
    const unlockBtn = page.getByRole('button', { name: /^Unlock$|Unlock Drive/i }).first();
    // STEP 3: WRONG password fails closed
    await pwInput.fill('definitely-the-wrong-password-123');
    await unlockBtn.click();
    await page.waitForTimeout(6000);
    const afterWrong = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const body = document.body.textContent || '';
      return { stillOpen: !!dlg, hasError: /Invalid password|incorrect|wrong|failed|check your password|Could not/i.test(body) };
    });
    check('STEP3 WRONG password fails closed (modal stays open + error)', afterWrong.stillOpen && afterWrong.hasError, `open=${afterWrong.stillOpen} err=${afterWrong.hasError}`);
    await shot(page, 'cert-03-wrong-password.png');

    // STEP 4: CORRECT password on the v1 drive -> SUCCEEDS
    await pwInput.fill(''); await pwInput.fill(password);
    await unlockBtn.click();
    note('submitted CORRECT password on v1 drive — awaiting derive+trial-decrypt (LIVE)');
    let unlocked = false, modalErr = null;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(3000);
      const st = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const tabs = document.querySelector('[role="tab"]');
        const syncSetup = /Set Up Sync Folder|Choose.*sync folder/i.test(document.body.textContent || '');
        const body = document.body.textContent || '';
        const m = body.match(/Invalid password[^.]*\.|Could not verify[^.]*\./);
        return { modalGone: !dlg, dash: !!tabs, syncSetup, err: m ? m[0] : null };
      });
      if (st.modalGone && (st.dash || st.syncSetup)) { unlocked = true; break; }
      if (st.err) modalErr = st.err;
    }
    check('STEP4 CORRECT password unlocks the v1 private drive in the LIVE UI', unlocked, unlocked ? 'proceeded past unlock' : `stuck; modalErr=${modalErr}`);
    await shot(page, 'cert-04-after-correct-unlock.png');
    if (unlocked) {
      const post = await page.evaluate(async () => { const r = await window.electronAPI.drive.listWithStatus(); return r && r.success ? r.data.filter(d => d.privacy === 'private').map(d => ({ id: String(d.id).slice(0, 8), locked: d.isLocked, nameLen: d.name ? String(d.name).length : 0, enc: d.name === 'ENCRYPTED' })) : []; });
      const target = post.find(d => targetId.startsWith(d.id));
      check('STEP4 unlocked drive name decrypts (not ENCRYPTED)', !!target && !target.locked && !target.enc && target.nameLen > 0, JSON.stringify(target));
    }

    // ---- STEP 5: ground-truth the REAL drive:unlock IPC matrix (v1 vs v2) ----
    // Fresh disposable session-independent: call the app's own handler directly.
    const matrix = await page.evaluate(async ({ pw, v1id, v2id }) => {
      const out = {};
      // wrong pw on v1 -> must fail closed
      out.v1wrong = await window.electronAPI.drive.unlock(v1id, 'wrong-pw-xyz-000');
      // correct pw on v1 -> should succeed (may already be unlocked from modal step)
      out.v1correct = await window.electronAPI.drive.unlock(v1id, pw);
      // correct pw on v2 -> reproduces the bug (reject despite correct pw)
      out.v2correct = await window.electronAPI.drive.unlock(v2id, pw);
      return out;
    }, { pw: password, v1id: v1drive ? v1drive.id : (priv[0] && priv[0].id), v2id: v2drive ? v2drive.id : (priv[1] && priv[1].id) });
    const s = (r) => r ? (r.success ? 'SUCCESS' : `REJECT[${(r.error || '').slice(0, 48)}]`) : 'null';
    note(`IPC matrix: v1+wrongPw=${s(matrix.v1wrong)} | v1+correctPw=${s(matrix.v1correct)} | v2+correctPw=${s(matrix.v2correct)}`);
    check('STEP5 IPC: v1 drive + WRONG pw -> fail closed', matrix.v1wrong && matrix.v1wrong.success === false && /invalid password/i.test(matrix.v1wrong.error || ''), s(matrix.v1wrong));
    check('STEP5 IPC: v1 drive + CORRECT pw -> unlock succeeds', matrix.v1correct && matrix.v1correct.success === true, s(matrix.v1correct));
    check('STEP5 IPC: v2 drive + CORRECT pw -> REJECTED (reproduces the signature-type bug)', matrix.v2correct && matrix.v2correct.success === false && /invalid password/i.test(matrix.v2correct.error || ''), s(matrix.v2correct));

    note(`app console errors: ${consoleErrors.length}`);
    consoleErrors.slice(0, 8).forEach(e => console.log('       ! ' + e.slice(0, 150)));
    await app.close(); check('app closed cleanly', true);
  } catch (err) {
    check('run without harness error', false, err && err.message);
    try { await shot(page, 'cert-ERROR.png'); } catch {}
    try { await app.close(); } catch {}
  }
  const failed = results.filter(r => !r.c);
  console.log('\n================ PRIVATE-DRIVE LIVE CERT RESULT ================');
  console.log(`Total: ${results.length}  Passed: ${results.length - failed.length}  Failed: ${failed.length}`);
  console.log('Screenshots in: ' + SHOT_DIR);
  console.log('RESULT: ' + (failed.length === 0 ? 'ALL-PASS' : 'SEE-ABOVE'));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
