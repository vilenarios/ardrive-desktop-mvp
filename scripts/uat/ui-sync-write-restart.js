#!/usr/bin/env node
/*
 * UAT scenario 9 — status lifecycle ACROSS RESTART — [UAT].
 *
 * Relaunches the SAME throwaway userData created by ui-sync-write-ops.js, signs
 * back in, and asserts the upload/operation statuses are correctly restored from
 * the per-profile SQLite DB: completed rows stay completed WITH their data tx id;
 * nothing is stuck forever in pending/uploading. Compares against the
 * pre-restart-state.json snapshot written by the Phase A run. Also records what
 * statuses the app surfaces (scenario 10 status honesty).
 *
 * No new wallet, no new drive, no upload, no spend. Owner wallet never loaded.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-sync-write-restart.js <native-root>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const path = require('path');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_ROOT = process.argv[2] || '/tmp/claude-1000/-mnt-c-source-ardrive-desktop-mvp/64f37fe9-d4f4-4b08-90a8-3ca034bcac1a/scratchpad/uat-syncops-write';
const USERDATA = path.join(NATIVE_ROOT, 'userdata');
const SHOT_DIR = path.join(NATIVE_ROOT, 'shots');
const PW_FILE = path.join(NATIVE_ROOT, '.pw');
const RESTART_RESULT = path.join(NATIVE_ROOT, 'restart-result.json');
const GATEWAY = 'turbo-gateway.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const note = (m) => console.log('    · ' + m);
const check = (n, c, d) => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + d : ''}`); return !!c; };
async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch { /* noop */ } }

async function main() {
  const PASSWORD = fs.existsSync(PW_FILE) ? fs.readFileSync(PW_FILE, 'utf8').trim() : null;
  const pre = fs.existsSync(path.join(NATIVE_ROOT, 'pre-restart-state.json')) ? JSON.parse(fs.readFileSync(path.join(NATIVE_ROOT, 'pre-restart-state.json'), 'utf8')) : null;
  if (!PASSWORD) { console.log('NO SAVED PASSWORD — cannot run restart leg'); process.exit(0); }

  const app = await electron.launch({ cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: USERDATA, ARDRIVE_DEV_MODE: 'false', ARDRIVE_GATEWAY_HOST: GATEWAY } });
  const mainLogs = []; try { const cp = app.process(); cp.stdout && cp.stdout.on('data', d => mainLogs.push(d.toString())); cp.stderr && cp.stderr.on('data', d => mainLogs.push(d.toString())); } catch { /* noop */ }
  let page = null; const result = { statuses: null, restored: null, stuck: null };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    await sleep(3000); await shot(page, 'r01-relaunch-landing.png');

    // sign back in (WelcomeBack / ProfileManagement "Sign In" -> password -> Sign In)
    const signIn = page.getByRole('button', { name: /^Sign In$/i }).first();
    if (await signIn.count()) {
      await signIn.click(); await sleep(600);
      const pwField = page.locator('input[type="password"]').first();
      if (await pwField.count()) { await pwField.waitFor({ state: 'visible', timeout: 15000 }); await pwField.fill(PASSWORD); await sleep(200); const submit = page.getByRole('button', { name: /^Sign In$/i }).last(); await submit.click(); note('signed in'); }
    } else {
      // maybe a bare password prompt (WelcomeBackScreen)
      const pwField = page.locator('input[type="password"]').first();
      if (await pwField.count()) { await pwField.fill(PASSWORD); await sleep(200); const unlock = page.getByRole('button', { name: /Sign In|Unlock|Continue/i }).first(); if (await unlock.count()) await unlock.click(); note('unlocked via password prompt'); }
      else note('no sign-in UI — auto-loaded');
    }
    await sleep(6000); await shot(page, 'r02-after-login.png');

    // read restored statuses straight from the DB via IPC (ground truth)
    const restored = await ev(async () => {
      const u = await window.electronAPI.files.getUploads().catch(() => null);
      const ups = u && u.success ? u.data : (Array.isArray(u) ? u : []);
      const p = await window.electronAPI.uploads.getPending().catch(() => null);
      const pend = p && p.success ? p.data : (Array.isArray(p) ? p : []);
      return { uploads: (ups || []).map(x => ({ n: x.fileName, s: x.status, tx: x.dataTxId || x.transactionId || null, fid: x.fileId || null, op: x.operationType || null })), pending: (pend || []).map(x => ({ n: x.fileName, s: x.status, op: x.operationType || null })) };
    }).catch(e => ({ error: String(e) }));
    result.statuses = restored;
    console.log('  RESTORED uploads: ' + JSON.stringify(restored.uploads));
    console.log('  RESTORED pending: ' + JSON.stringify(restored.pending));

    // assertion 0 (primary in this env): the PENDING (awaiting_approval) rows are
    // restored from the DB after restart — not lost, not corrupted. This is the
    // real "status correctly synced across restart" test when no upload completed.
    let pendingPreserved = true; const missingPending = []; const corrupt = [];
    if (pre) {
      const prePending = pre.pending || [];
      for (const pp of prePending) {
        const now = (restored.pending || []).find(u => u.n === pp.n);
        if (!now) { pendingPreserved = false; missingPending.push(pp.n); }
        else if (now.s !== pp.s) { corrupt.push({ n: pp.n, was: pp.s, now: now.s }); }
      }
      check('S9: all pre-restart PENDING rows restored after restart (count ' + prePending.length + ')', pendingPreserved && corrupt.length === 0,
        'restored=' + (restored.pending || []).length + '/' + prePending.length + (missingPending.length ? ' MISSING=' + JSON.stringify(missingPending) : '') + (corrupt.length ? ' STATUS-CHANGED=' + JSON.stringify(corrupt) : ' — all status=awaiting_approval preserved'));
    }
    result.pending = { pendingPreserved, missingPending, corrupt, count: (restored.pending || []).length };

    // assertion 1: completed rows from pre-restart still completed WITH tx
    let completedPreserved = true; const lost = [];
    if (pre) {
      const preCompleted = (pre.uploads || []).filter(u => /complet|success|uploaded|synced/i.test(u.s || '') && u.tx);
      for (const pc of preCompleted) {
        const now = (restored.uploads || []).find(u => u.n === pc.n && u.tx === pc.tx);
        if (!now || !/complet|success|uploaded|synced/i.test(now.s || '') || !now.tx) { completedPreserved = false; lost.push(pc.n); }
      }
      check('S9: pre-restart COMPLETED uploads restored WITH tx id (n=' + preCompleted.length + ')', completedPreserved, lost.length ? 'lost/changed: ' + JSON.stringify(lost) : (preCompleted.length + ' completed rows preserved'));
    } else { note('no pre-restart snapshot to compare (Phase A may not have finished)'); }
    result.restored = { completedPreserved, lost };

    // assertion 2: nothing stuck forever in 'uploading'/'pending-progress' after relaunch
    // (awaiting_approval is legitimately pending user action; 'uploading'/'in_progress' with no worker is the bug)
    await sleep(4000);
    const after = await ev(async () => { const u = await window.electronAPI.files.getUploads().catch(() => null); const ups = u && u.success ? u.data : (Array.isArray(u) ? u : []); return (ups || []).map(x => ({ n: x.fileName, s: x.status })); }).catch(() => []);
    const stuck = (after || []).filter(x => /uploading|in_progress|processing/i.test(x.s || ''));
    check('S9: no upload left stuck in a live "uploading/in_progress" state after restart', stuck.length === 0, stuck.length ? 'STUCK: ' + JSON.stringify(stuck) : 'none stuck');
    result.stuck = stuck;

    await shot(page, 'r03-restored.png');
    await app.close();
  } catch (err) { check('S9 run without harness error', false, err && err.message); try { await shot(page, 'rERROR.png'); } catch { /* noop */ } try { await app.close(); } catch { /* noop */ } }
  try { fs.writeFileSync(RESTART_RESULT, JSON.stringify(result, null, 2)); } catch { /* noop */ }
  console.log('\n== RESTART (S9) SUMMARY ==');
  console.log('  completedPreserved:', result.restored && result.restored.completedPreserved);
  console.log('  stuck-uploading   :', result.stuck ? result.stuck.length : '?');
  console.log('  result written to :', RESTART_RESULT);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
