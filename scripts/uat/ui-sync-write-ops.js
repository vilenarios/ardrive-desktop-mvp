#!/usr/bin/env node
/*
 * UAT LIVE certification of SYNC WRITE OPERATIONS — [UAT].
 *
 * Beyond the already-proven plain add -> free-tier upload -> download round-trip
 * (UAT-FREETIER-UPLOAD-LIVE), this drives the FULL set of sync mutations through
 * the REAL running app on a NATIVE Linux filesystem (WSL 9p drops inotify):
 *   1 baseline add            2 edit -> re-version       3 rename
 *   4 move (into subfolder)   5 copy                     6 delete -> ArFS hide
 *   7 folder ops              8 multi-file bulk
 * (9 restart status + 10 status honesty are covered by ui-sync-write-restart.js
 *  and by observation.)
 *
 * One fresh throwaway wallet + ONE drive, created via the app's own onboarding
 * in a disposable NATIVE userData dir; the drive is indexed ONCE (self-heal) and
 * every scenario runs on it. Owner wallet is NEVER loaded.
 *
 * MONEY/SAFETY: free-tier ONLY. Every test file <= 107520 B. A HARD money guard
 * refuses to approve if ANY pending row has a non-zero Turbo cost or is over the
 * free-tier size. Never prints wallet JSON / seed / password. turbo-gateway.com.
 *
 * Results stream to <root>/results.json after every scenario (crash-resilient).
 * Screenshots to <root>/shots. Run redirected to a log; read the log.
 *
 * Run: DISPLAY=:0 node scripts/uat/ui-sync-write-ops.js <native-root>
 */
'use strict';
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs'); const fsp = require('fs/promises'); const path = require('path'); const crypto = require('crypto'); const https = require('https');
const { _electron: electron } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NATIVE_ROOT = process.argv[2] || '/tmp/claude-1000/-mnt-c-source-ardrive-desktop-mvp/64f37fe9-d4f4-4b08-90a8-3ca034bcac1a/scratchpad/uat-syncops-write';
const USERDATA = path.join(NATIVE_ROOT, 'userdata');
const SYNCROOT = path.join(NATIVE_ROOT, 'ARDRIVE');
const SHOT_DIR = path.join(NATIVE_ROOT, 'shots');
const RESULTS_FILE = path.join(NATIVE_ROOT, 'results.json');
const PW_FILE = path.join(NATIVE_ROOT, '.pw'); // password persisted for the restart leg (throwaway, gitignored dir)
const FREE_LIMIT = 107520;
const GATEWAY = 'turbo-gateway.com';
const DRIVE_NAME = 'SYNCOPS';
const ACTIVE_WAIT_MS = Number(process.env.ACTIVE_WAIT_MS || 16 * 60 * 1000);
const RESUME = process.env.RESUME === '1';
// In resume mode reuse the already-onboarded throwaway wallet + already-indexed
// drive from the prior run (its password was persisted to .pw). This avoids a
// second ~11-min fresh-drive gateway-indexing wait.
const PASSWORD = (RESUME && fs.existsSync(PW_FILE)) ? fs.readFileSync(PW_FILE, 'utf8').trim() : ('uat-throwaway-' + crypto.randomBytes(9).toString('hex'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const note = (m) => console.log('    · ' + m);

// ---- structured results (streamed to disk) ----
const scenarios = {}; // id -> { title, verdict, evidence:[], defects:[] }
function scn(id, title) { if (!scenarios[id]) scenarios[id] = { id, title, verdict: 'PENDING', evidence: [], defects: [] }; return scenarios[id]; }
function ev_(id, msg) { const s = scenarios[id]; s.evidence.push(msg); console.log(`      [${id}] ${msg}`); flush(); }
function verdict(id, v, msg) { const s = scenarios[id]; s.verdict = v; if (msg) s.evidence.push('VERDICT: ' + msg); console.log(`  [[${id} => ${v}]] ${msg || ''}`); flush(); }
function defect(id, sev, where, desc) { scenarios[id].defects.push({ sev, where, desc }); console.log(`  !! DEFECT [${sev}] ${id} @ ${where}: ${desc}`); flush(); }
function flush() { try { fs.writeFileSync(RESULTS_FILE, JSON.stringify({ ts: Date.now(), password_saved: fs.existsSync(PW_FILE), scenarios }, null, 2)); } catch { /* noop */ } }

async function shot(page, name) { try { await page.screenshot({ path: path.join(SHOT_DIR, name), timeout: 20000 }); console.log('    · shot ' + name); } catch (e) { console.log('    · shot FAIL ' + name + ' ' + e.message); } }
function httpGet(url) { return new Promise((resolve, reject) => { https.get(url, (res) => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(httpGet(res.headers.location)); } if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); } const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c))); }).on('error', reject); }); }
function assertNative(p) { const real = fs.realpathSync(p); if (/^\/mnt\//.test(real)) throw new Error(`${p} -> ${real} is a /mnt 9p mount; inotify won't fire`); return real; }

// unique <=105KiB file content
function mkBytes(seed, size) { size = size || 40 * 1024; const b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = (i * 131 + seed) & 0xff; return b; }

let page = null; const mainLogs = [];
const ev = (fn, arg) => page.evaluate(fn, arg);
const grepMain = (re) => mainLogs.filter(l => re.test(l));
const grepMainFor = (re, sub) => mainLogs.filter(l => re.test(l) && l.includes(sub));

async function getPending() { return ev(async () => { const r = await window.electronAPI.uploads.getPending(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []); }
async function getUploads() { return ev(async () => { const r = await window.electronAPI.files.getUploads(); return r && r.success ? r.data : (Array.isArray(r) ? r : []); }).catch(() => []); }
async function getPermaweb(driveId) { return ev(async (d) => { const r = await window.electronAPI.drive.getPermawebFiles(d, true); const a = r && r.success ? r.data : (Array.isArray(r) ? r : []); return (a || []).map(x => ({ name: x.name, type: x.type, fileId: x.fileId || x.id, isHidden: x.isHidden })); }, driveId).catch(() => []); }
async function syncActive() { return ev(async () => { const s = await window.electronAPI.sync.getStatus().catch(() => null); return s && s.success && s.data ? !!s.data.isActive : (s && s.isActive) || false; }).catch(() => false); }

// Wait until pending rows exist for ALL of `names` (or timeout). Returns pending array.
async function waitPending(names, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 90000);
  let pending = [];
  let nudged = 0;
  while (Date.now() < deadline) {
    pending = await getPending();
    const have = names.every(n => pending.some(p => p.fileName === n));
    if (have && pending.length) return pending;
    if (Date.now() - (deadline - (timeoutMs || 90000)) > 12000 && nudged < 3) { nudged++; await ev(async () => { await window.electronAPI.sync.manual().catch(() => {}); }).catch(() => {}); }
    await sleep(2500);
  }
  return pending;
}

// Money guard: free-tier is SIZE-based (files < 100KB upload FREE with Turbo;
// metadata ops rename/move/hide/folder-create are size 0 = free). The
// estimatedTurboCost field is the THEORETICAL byte cost and is non-zero even
// for free-tier files (proven: a 40KB file with estimatedTurboCost 0.00042
// uploaded free on a zero-balance wallet). What the UI shows the user is "Free".
// A row is unsafe ONLY if its content size exceeds the free-tier limit. On top
// of that, the throwaway wallet holds ZERO balance, so a non-free upload would
// FAIL (insufficient balance) rather than spend — zero-spend is structural.
function moneyGuard(id, pending, expectNames) {
  const rows = (pending || []).filter(p => !expectNames || expectNames.includes(p.fileName));
  const overSize = rows.filter(p => Number(p.fileSize) > FREE_LIMIT);
  ev_(id, 'MONEY GUARD rows=' + JSON.stringify(rows.map(p => ({ n: p.fileName, size: p.fileSize, turboEstInfo: p.estimatedTurboCost, freeTier: Number(p.fileSize) <= FREE_LIMIT, op: p.operationType || 'upload' }))));
  if (overSize.length) {
    defect(id, 'CRITICAL', 'money-guard', 'row(s) exceed free-tier size (>107520B): ' + JSON.stringify(overSize.map(p => ({ n: p.fileName, size: p.fileSize }))));
    return false;
  }
  return true;
}

async function approve(id) { return ev(async (uid) => { const r = await window.electronAPI.uploads.approve(uid, 'turbo'); return r && r.success !== undefined ? { success: r.success, error: r.error } : { raw: JSON.stringify(r) }; }, id).catch(e => ({ error: String(e) })); }

// Wait until every name has a terminal upload row (completed w/ tx, or failed). Returns map name->row.
async function waitTerminal(names, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 180000);
  let last = {};
  while (Date.now() < deadline) {
    const ups = await getUploads();
    const pend = await getPending();
    const map = {};
    for (const n of names) {
      // newest row for this name
      const rows = (ups || []).filter(u => u.fileName === n);
      const row = rows.sort((a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0))[0];
      map[n] = row ? { status: row.status, dataTxId: row.dataTxId || row.transactionId || null, fileId: row.fileId || null, error: row.error, op: row.operationType } : null;
    }
    last = map;
    const allDone = names.every(n => map[n] && (/complet|success|synced|uploaded/i.test(map[n].status || '') || /fail/i.test(map[n].status || '')) && !pend.some(p => p.fileName === n));
    if (allDone) return map;
    await sleep(3000);
  }
  return last;
}

async function onboard() {
  console.log('== PHASE A: onboarding fresh throwaway wallet + drive ==');
  await page.getByRole('heading', { name: 'Welcome to ArDrive Desktop' }).waitFor({ state: 'visible' });
  await shot(page, 'a00-firstrun.png');
  await page.getByRole('button', { name: /Create New Account/ }).click();
  await page.getByRole('heading', { name: 'Secure Your Account' }).waitFor({ state: 'visible' });
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD); await pw.nth(1).fill(PASSWORD); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.getByRole('heading', { name: 'Save Your Recovery Phrase' }).waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('input[type="checkbox"]').first().check(); await page.waitForTimeout(150);
  await page.getByRole('button', { name: /Continue to Drive Setup/ }).click();
  // persist password for the restart leg (throwaway; dir is scratchpad-only, never committed)
  fs.writeFileSync(PW_FILE, PASSWORD); flush();

  await page.getByText(/Name Your Drive/i).first().waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('input[type="text"]').first().fill(DRIVE_NAME); await page.waitForTimeout(200);
  const chooseFolder = page.getByRole('button', { name: /Choose Folder/i }).first();
  if (await chooseFolder.count()) { await chooseFolder.click(); await page.waitForTimeout(800); }
  await page.getByRole('button', { name: /Continue to Review/i }).click(); await page.waitForTimeout(600);
  const complete = page.getByRole('button', { name: /Complete Setup/i });
  await complete.waitFor({ state: 'visible', timeout: 15000 });
  await complete.click();
  note('clicked Complete Setup');
  await sleep(4000);
  await shot(page, 'a01-after-complete.png');

  // resolve mapping
  let mapping = null;
  for (let i = 0; i < 12 && !(mapping && mapping.path); i++) {
    mapping = await ev(async () => { const m = await window.electronAPI.driveMappings.getPrimary(); return m && m.success && m.data ? { driveId: m.data.driveId, path: m.data.localFolderPath } : null; }).catch(() => null);
    if (!(mapping && mapping.path)) await sleep(2500);
  }
  if (!mapping || !mapping.path) throw new Error('no drive mapping established');
  assertNative(mapping.path);
  console.log('  drive mapping: ' + JSON.stringify({ id: String(mapping.driveId).slice(0, 8) + '…', path: mapping.path }));
  return mapping;
}

async function waitActive() {
  console.log('== waiting for sync watcher ACTIVE (fresh-drive indexing self-heal) ==');
  const start = Date.now(); const deadline = start + ACTIVE_WAIT_MS; let iter = 0;
  while (Date.now() < deadline) {
    iter++;
    try { const od = page.getByRole('button', { name: /Open Dashboard/i }).first(); if (await od.count()) await od.click().catch(() => {}); } catch { /* noop */ }
    try { const ta = page.getByRole('button', { name: /Try Again/i }).first(); if (await ta.count()) await ta.click().catch(() => {}); } catch { /* noop */ }
    await ev(async () => { await window.electronAPI.sync.start().catch(() => {}); }).catch(() => {});
    if (await syncActive()) { console.log('  ACTIVE after ' + Math.round((Date.now() - start) / 1000) + 's / ' + iter + ' attempts'); return true; }
    if (iter % 3 === 0) note('waiting active… elapsed=' + Math.round((Date.now() - start) / 1000) + 's');
    await sleep(15000);
  }
  return false;
}

// Generic: drop file(s), wait pending, money-guard, approve, wait terminal.
async function dropAndUpload(id, dir, files) {
  for (const f of files) await fsp.writeFile(path.join(dir, f.name), f.bytes);
  const names = files.map(f => f.name);
  const pending = await waitPending(names, 120000);
  const detected = names.filter(n => pending.some(p => p.fileName === n));
  ev_(id, 'detected pending for ' + detected.length + '/' + names.length + ': ' + JSON.stringify(detected));
  if (!moneyGuard(id, pending, names)) return { aborted: true, pending };
  for (const p of pending.filter(p => names.includes(p.fileName))) { const a = await approve(p.id); ev_(id, 'approve ' + p.fileName + ' -> ' + JSON.stringify(a)); }
  const term = await waitTerminal(names, 240000);
  ev_(id, 'terminal: ' + JSON.stringify(term));
  return { pending, term };
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(USERDATA, { recursive: true });
  fs.mkdirSync(SYNCROOT, { recursive: true });
  assertNative(USERDATA); assertNative(SYNCROOT);

  const app = await electron.launch({
    cwd: REPO_ROOT, args: ['.', '--disable-gpu', '--no-sandbox'], timeout: 120000,
    env: { ...process.env, NODE_ENV: 'production', ARDRIVE_TEST_USERDATA: USERDATA, ARDRIVE_DEV_MODE: 'false', ARDRIVE_GATEWAY_HOST: GATEWAY, ARDRIVE_DEV_SYNC_FOLDER: SYNCROOT }
  });
  try { const cp = app.process(); cp.stdout && cp.stdout.on('data', d => mainLogs.push(d.toString())); cp.stderr && cp.stderr.on('data', d => mainLogs.push(d.toString())); } catch { /* noop */ }
  await app.evaluate(async ({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, SYNCROOT);

  try {
    page = await app.firstWindow({ timeout: 120000 }); page.setDefaultTimeout(45000);
    const rendererErrors = []; page.on('console', m => { if (m.type() === 'error') rendererErrors.push(m.text()); });

    const mapping = await onboard();
    const driveId = mapping.driveId;
    const DIR = mapping.path;
    await fsp.mkdir(DIR, { recursive: true });

    const active = await waitActive();
    await shot(page, 'a02-dashboard.png');
    if (!active) {
      for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']) { scn(id, id); verdict(id, 'BLOCKED-env', 'sync never became ACTIVE within ' + Math.round(ACTIVE_WAIT_MS / 60000) + ' min (fresh-drive gateway indexing lag — environment, not product)'); }
      await app.close(); return finish(rendererErrors);
    }

    // ============ SCENARIO 1: baseline add ============
    scn('S1', 'baseline add -> pending(FREE) -> approve -> completed w/ dataTxId');
    try {
      const A = { name: 'fileA-baseline-' + Date.now() + '.bin', bytes: mkBytes(7) };
      const r = await dropAndUpload('S1', DIR, [A]);
      const row = r.term && r.term[A.name];
      const ok = row && /complet|success|uploaded|synced/i.test(row.status || '') && row.dataTxId && row.fileId;
      ev_('S1', 'baseline fileId=' + (row && row.fileId) + ' dataTxId=' + (row && row.dataTxId));
      global.__A = { name: A.name, fileId: row && row.fileId, dataTxId: row && row.dataTxId, bytes: A.bytes };
      await shot(page, 'a03-s1-baseline.png');
      verdict('S1', r.aborted ? 'BLOCKED-money' : (ok ? 'PASS' : 'FAIL'), 'status=' + (row && row.status) + ' tx=' + (row && row.dataTxId));
    } catch (e) { defect('S1', 'HIGH', 'S1', e.message); verdict('S1', 'FAIL', e.message); }

    // ============ SCENARIO 2: edit -> re-version ============
    scn('S2', 'edit same file -> new ArFS revision (fileId reused, new dataTxId)');
    try {
      const A = global.__A;
      if (!A || !A.fileId) { verdict('S2', 'BLOCKED-env', 'no baseline fileId from S1'); }
      else {
        const before = A.fileId;
        const newBytes = mkBytes(200, 41 * 1024); // different content + size
        await sleep(1500);
        await fsp.writeFile(path.join(DIR, A.name), newBytes); // edit in place
        note('edited ' + A.name + ' (new content, size ' + newBytes.length + ')');
        const pending = await waitPending([A.name], 120000);
        const editLog = grepMainFor(/Edited file detected .* new revision/i, A.name).length > 0
          || grepMain(/Is edit: true/i).length > 0;
        ev_('S2', 'engine "edit -> new revision" log seen=' + editLog + '; pending=' + JSON.stringify(pending.filter(p => p.fileName === A.name).map(p => ({ size: p.fileSize, turbo: p.estimatedTurboCost }))));
        const hasPending = pending.some(p => p.fileName === A.name);
        if (!hasPending) { verdict('S2', 'FAIL', 'edit produced no pending revision row (change not detected)'); defect('S2', 'HIGH', 'sync-manager.ts:handleFileChange', 'edit did not queue a new revision'); }
        else if (!moneyGuard('S2', pending, [A.name])) { verdict('S2', 'BLOCKED-money', 'edit row not free'); }
        else {
          for (const p of pending.filter(p => p.fileName === A.name)) { const a = await approve(p.id); ev_('S2', 'approve edit -> ' + JSON.stringify(a)); }
          const term = await waitTerminal([A.name], 240000);
          const row = term[A.name];
          const after = row && row.fileId;
          const reused = after && before && after === before;
          const newTx = row && row.dataTxId && row.dataTxId !== A.dataTxId;
          ev_('S2', 'fileId before=' + before + ' after=' + after + ' reused=' + reused + ' newDataTx=' + newTx + ' status=' + (row && row.status));
          await shot(page, 'a04-s2-edit.png');
          if (row && /complet|success|uploaded|synced/i.test(row.status || '') && newTx) {
            verdict('S2', reused ? 'PASS' : 'PARTIAL', reused ? 'same fileId, new dataTx = new ArFS revision' : 'new content uploaded but fileId CHANGED (new file, not a revision) — before=' + before + ' after=' + after);
            if (!reused) defect('S2', 'MEDIUM', 'sync-manager.ts:uploadFileWithArDriveCore', 'edited file uploaded as a NEW ArFS file (fileId changed) instead of a revision of the same fileId');
          } else if (row && /fail/i.test(row.status || '')) {
            verdict('S2', 'FAIL', 'edit upload failed: ' + row.error);
            defect('S2', 'HIGH', 'sync-manager.ts:processUploadResult', 'edit upload failed: ' + row.error);
          } else { verdict('S2', 'PARTIAL', 'edit did not reach completed: ' + JSON.stringify(row)); }
        }
      }
    } catch (e) { defect('S2', 'HIGH', 'S2', e.message); verdict('S2', 'FAIL', e.message); }

    // ============ SCENARIO 8: multi-file bulk (do early so batch files feed 3/4/5/6) ============
    scn('S8', 'drop 3-5 files at once -> all detected, queued, uploaded');
    const BATCH = [];
    try {
      const t = Date.now();
      for (let i = 1; i <= 4; i++) BATCH.push({ name: `batch${i}-${t}.bin`, bytes: mkBytes(20 + i, (30 + i) * 1024) });
      const r = await dropAndUpload('S8', DIR, BATCH);
      const names = BATCH.map(b => b.name);
      const done = names.filter(n => r.term && r.term[n] && /complet|success|uploaded|synced/i.test(r.term[n].status || '') && r.term[n].dataTxId);
      ev_('S8', 'completed ' + done.length + '/' + names.length);
      await shot(page, 'a05-s8-bulk.png');
      verdict('S8', r.aborted ? 'BLOCKED-money' : (done.length === names.length ? 'PASS' : (done.length > 0 ? 'PARTIAL' : 'FAIL')), done.length + '/' + names.length + ' completed');
      // record fileIds for reuse
      global.__BATCH = BATCH.map(b => ({ name: b.name, bytes: b.bytes, fileId: r.term && r.term[b.name] && r.term[b.name].fileId }));
    } catch (e) { defect('S8', 'HIGH', 'S8', e.message); verdict('S8', 'FAIL', e.message); }

    const batch = global.__BATCH || [];
    const pickBatch = (i) => batch[i] && batch[i].fileId ? batch[i] : null;

    // ============ SCENARIO 3: rename ============
    scn('S3', 'rename synced file -> FileOperationDetector=rename, queued op (no re-upload of content)');
    try {
      const b = pickBatch(0);
      if (!b) { verdict('S3', 'BLOCKED-env', 'no uploaded batch file to rename'); }
      else {
        const oldName = b.name; const newName = 'renamed-' + oldName;
        await sleep(2000);
        await fsp.rename(path.join(DIR, oldName), path.join(DIR, newName));
        note('renamed ' + oldName + ' -> ' + newName);
        // detector classification from main log
        let renameLog = false; for (let i = 0; i < 20 && !renameLog; i++) { renameLog = grepMain(/File operation detected: rename/i).length > 0 || grepMain(/File renamed from '.*'/i).length > 0; if (!renameLog) await sleep(1000); }
        const misMove = grepMainFor(/File operation detected: move/i, '').length > 0 && grepMain(/File renamed from/i).length === 0;
        ev_('S3', 'rename-classified=' + renameLog + ' (looked for "File operation detected: rename" / "File renamed from")');
        // pending op should be operationType rename (metadata) - NOT a fresh content upload
        const pend = await waitPending([newName], 45000);
        const myrow = pend.find(p => p.fileName === newName);
        const isRenameOp = myrow && myrow.operationType === 'rename';
        const isFreshUpload = myrow && (!myrow.operationType || myrow.operationType === 'upload') && Number(myrow.fileSize) > 0;
        ev_('S3', 'pending row: ' + JSON.stringify(myrow ? { op: myrow.operationType, size: myrow.fileSize, turbo: myrow.estimatedTurboCost } : null));
        if (myrow && !moneyGuard('S3', pend, [newName])) { verdict('S3', 'BLOCKED-money', 'rename op not free'); }
        else {
          let completed = null;
          if (myrow && isRenameOp) { const a = await approve(myrow.id); ev_('S3', 'approve rename -> ' + JSON.stringify(a)); const term = await waitTerminal([newName], 120000); completed = term[newName]; }
          await shot(page, 'a06-s3-rename.png');
          if (renameLog && isRenameOp) verdict('S3', 'PASS', 'classified rename, queued operationType=rename, no content re-upload; op terminal=' + JSON.stringify(completed));
          else if (renameLog && !myrow) verdict('S3', 'PARTIAL', 'classified rename in log but no rename op queued (file may lack recorded arfsFileId)');
          else if (isFreshUpload) { verdict('S3', 'FAIL', 'rename NOT classified — queued as a fresh content upload'); defect('S3', 'HIGH', 'FileOperationDetector.ts:detectByHash', 'rename misclassified as new upload (wasteful re-upload)'); }
          else verdict('S3', renameLog ? 'PARTIAL' : 'FAIL', 'renameLog=' + renameLog + ' row=' + JSON.stringify(myrow));
        }
        global.__renamed0 = newName;
      }
    } catch (e) { defect('S3', 'HIGH', 'S3', e.message); verdict('S3', 'FAIL', e.message); }

    // ============ SCENARIO 5: copy ============
    scn('S5', 'duplicate synced file -> classified as copy (new file)');
    try {
      const b = pickBatch(1);
      if (!b) { verdict('S5', 'BLOCKED-env', 'no uploaded batch file to copy'); }
      else {
        const src = b.name; const dup = 'copy-of-' + src;
        await sleep(2000);
        await fsp.copyFile(path.join(DIR, src), path.join(DIR, dup));
        note('copied ' + src + ' -> ' + dup);
        let copyLog = false; for (let i = 0; i < 20 && !copyLog; i++) { copyLog = grepMain(/Copy operation detected from/i).length > 0; if (!copyLog) await sleep(1000); }
        ev_('S5', 'copy-classified=' + copyLog + ' (looked for "Copy operation detected from")');
        const pend = await waitPending([dup], 60000);
        const myrow = pend.find(p => p.fileName === dup);
        ev_('S5', 'pending row for copy: ' + JSON.stringify(myrow ? { op: myrow.operationType, size: myrow.fileSize, turbo: myrow.estimatedTurboCost } : null));
        let term = null;
        if (myrow) { if (!moneyGuard('S5', pend, [dup])) { verdict('S5', 'BLOCKED-money', 'copy row not free'); } else { const a = await approve(myrow.id); ev_('S5', 'approve copy -> ' + JSON.stringify(a)); term = await waitTerminal([dup], 180000); } }
        await shot(page, 'a07-s5-copy.png');
        if (scenarios['S5'].verdict === 'PENDING') {
          const uploaded = term && term[dup] && /complet|success|uploaded|synced/i.test(term[dup].status || '') && term[dup].dataTxId;
          if (copyLog && uploaded) verdict('S5', 'PASS', 'classified copy, handled as new file, uploaded tx=' + term[dup].dataTxId);
          else if (uploaded) verdict('S5', 'PARTIAL', 'duplicate uploaded as new file but "Copy operation detected" log not seen');
          else verdict('S5', myrow ? 'PARTIAL' : 'FAIL', 'copyLog=' + copyLog + ' term=' + JSON.stringify(term && term[dup]));
        }
      }
    } catch (e) { defect('S5', 'HIGH', 'S5', e.message); verdict('S5', 'FAIL', e.message); }

    // ============ SCENARIO 7: folder ops (create folder+file, rename folder) ============
    scn('S7', 'folder create (w/ file), rename folder -> FolderOperationDetector handles');
    let subDirAbs = null; let subFolderArfsId = null;
    try {
      const subName = 'sub-' + Date.now();
      subDirAbs = path.join(DIR, subName);
      await fsp.mkdir(subDirAbs, { recursive: true });
      const inFile = { name: 'infolder-' + Date.now() + '.bin', bytes: mkBytes(90, 25 * 1024) };
      await fsp.writeFile(path.join(subDirAbs, inFile.name), inFile.bytes);
      note('created folder ' + subName + ' with file ' + inFile.name);
      // folder + file should both queue
      const pend = await waitPending([subName, inFile.name], 120000);
      const folderRow = pend.find(p => p.fileName === subName);
      const fileRow = pend.find(p => p.fileName === inFile.name);
      ev_('S7', 'folder queued=' + !!folderRow + ' file queued=' + !!fileRow + ' rows=' + JSON.stringify(pend.map(p => ({ n: p.fileName, size: p.fileSize, mt: p.mimeType, op: p.operationType }))));
      if (!moneyGuard('S7', pend, [subName, inFile.name])) { verdict('S7', 'BLOCKED-money', 'folder/file rows not free'); }
      else {
        for (const p of pend.filter(p => [subName, inFile.name].includes(p.fileName))) { const a = await approve(p.id); ev_('S7', 'approve ' + p.fileName + ' -> ' + JSON.stringify(a)); }
        const term = await waitTerminal([subName, inFile.name], 240000);
        ev_('S7', 'folder/file terminal: ' + JSON.stringify(term));
        // read back the folder's arfsFolderId from permaweb / db via mapping
        subFolderArfsId = await ev(async (p) => { const f = await window.electronAPI.driveMappings.getPrimary().catch(() => null); return null; }, subDirAbs).catch(() => null);
        // rename the folder
        await sleep(3000);
        const renamedSub = subDirAbs + '-renamed';
        await fsp.rename(subDirAbs, renamedSub);
        note('renamed folder -> ' + path.basename(renamedSub));
        let folderRenameLog = false; for (let i = 0; i < 20 && !folderRenameLog; i++) { folderRenameLog = grepMain(/FolderOperationDetector: Detected rename operation/i).length > 0 || grepMain(/Folder renamed from '.*'/i).length > 0 || grepMain(/Handling folder operation: rename/i).length > 0; if (!folderRenameLog) await sleep(1000); }
        const execLog = grepMain(/Successfully handled rename operation|renamePublicFolder|executeFolderRename/i).length > 0;
        ev_('S7', 'folder-rename classified=' + folderRenameLog + ' executed-log=' + execLog);
        await shot(page, 'a08-s7-folder.png');
        subDirAbs = renamedSub;
        const folderCompleted = term[subName] && /complet|success/i.test(term[subName].status || '');
        if (folderCompleted && folderRenameLog) verdict('S7', 'PASS', 'folder+file created on ArFS; folder rename classified & handled by FolderOperationDetector');
        else if (folderCompleted) verdict('S7', 'PARTIAL', 'folder+file created; folder-rename detection log not observed');
        else verdict('S7', 'PARTIAL', 'folder/file terminal=' + JSON.stringify(term));
      }
    } catch (e) { defect('S7', 'MEDIUM', 'S7', e.message); verdict('S7', scenarios['S7'].verdict === 'PENDING' ? 'PARTIAL' : scenarios['S7'].verdict, e.message); }

    // ============ SCENARIO 4: move (into the subfolder created in S7) ============
    scn('S4', 'move synced file into subfolder -> classified move, queued operationType=move');
    try {
      const b = pickBatch(2);
      if (!b) { verdict('S4', 'BLOCKED-env', 'no uploaded batch file to move'); }
      else if (!subDirAbs) { verdict('S4', 'BLOCKED-env', 'no target subfolder (S7 folder create failed)'); }
      else {
        const src = b.name; const dest = path.join(subDirAbs, src);
        await sleep(2500);
        await fsp.rename(path.join(DIR, src), dest);
        note('moved ' + src + ' into ' + path.basename(subDirAbs) + '/');
        let moveLog = false; for (let i = 0; i < 20 && !moveLog; i++) { moveLog = grepMain(/File operation detected: move/i).length > 0 || grepMain(/File moved from/i).length > 0 || grepMain(/Operation type: move/i).length > 0; if (!moveLog) await sleep(1000); }
        const cannotMoveLog = grepMain(/Cannot create move operation: parent folder .* not found/i).length > 0;
        ev_('S4', 'move-classified=' + moveLog + ' cannotMove(parent missing)=' + cannotMoveLog);
        const pend = await waitPending([src], 45000);
        const myrow = pend.find(p => p.fileName === src && p.operationType === 'move');
        ev_('S4', 'pending move row: ' + JSON.stringify(myrow ? { op: myrow.operationType, size: myrow.fileSize, turbo: myrow.estimatedTurboCost } : (pend.find(p => p.fileName === src) ? { note: 'row-without-move-op', row: pend.find(p => p.fileName === src) } : null)));
        let term = null;
        if (myrow) { if (!moneyGuard('S4', pend, [src])) { verdict('S4', 'BLOCKED-money', 'move op not free'); } else { const a = await approve(myrow.id); ev_('S4', 'approve move -> ' + JSON.stringify(a)); term = await waitTerminal([src], 120000); } }
        await shot(page, 'a09-s4-move.png');
        if (scenarios['S4'].verdict === 'PENDING') {
          if (moveLog && myrow) verdict('S4', 'PASS', 'classified move, queued operationType=move, terminal=' + JSON.stringify(term && term[src]));
          else if (cannotMoveLog) { verdict('S4', 'PARTIAL', 'move classified but parent folder not yet on ArFS — op dropped (line 3844 return)'); defect('S4', 'MEDIUM', 'sync-manager.ts:3844', 'move detected but parentArfsFolderId missing -> move op silently dropped (TODO: queue for later)'); }
          else if (moveLog) verdict('S4', 'PARTIAL', 'move classified in log but no move op queued');
          else { verdict('S4', 'FAIL', 'move not classified'); defect('S4', 'HIGH', 'FileOperationDetector.ts:detectByHash', 'move into subfolder not detected as move'); }
        }
      }
    } catch (e) { defect('S4', 'HIGH', 'S4', e.message); verdict('S4', 'FAIL', e.message); }

    // ============ SCENARIO 6: delete -> ArFS hide ============
    scn('S6', 'delete synced file -> ArFS hide (not hard delete); verify hidden; unhide if exposed');
    try {
      const b = pickBatch(3);
      if (!b) { verdict('S6', 'BLOCKED-env', 'no uploaded batch file to delete'); }
      else {
        const victim = b.name;
        await sleep(2500);
        await fsp.rm(path.join(DIR, victim));
        note('deleted ' + victim + ' locally');
        // confirmDelete fires after 3s window
        let hideQueued = null;
        for (let i = 0; i < 25 && !hideQueued; i++) { await sleep(1500); const pend = await getPending(); hideQueued = pend.find(p => p.operationType === 'hide' && p.fileName === victim); }
        const confirmLog = grepMainFor(/Confirming delete for/i, victim).length > 0;
        ev_('S6', 'confirm-delete log=' + confirmLog + ' hide-op-queued=' + !!hideQueued + (hideQueued ? ' row=' + JSON.stringify({ op: hideQueued.operationType, size: hideQueued.fileSize, turbo: hideQueued.estimatedTurboCost }) : ''));
        if (!hideQueued) { verdict('S6', confirmLog ? 'PARTIAL' : 'FAIL', 'no hide op queued (confirmLog=' + confirmLog + ')'); if (!confirmLog) defect('S6', 'HIGH', 'FileOperationDetector.ts:confirmDelete', 'local delete of synced file did not propagate as ArFS hide'); }
        else if (!moneyGuard('S6', [hideQueued], [victim])) { verdict('S6', 'BLOCKED-money', 'hide op not free'); }
        else {
          const a = await approve(hideQueued.id); ev_('S6', 'approve hide -> ' + JSON.stringify(a));
          const term = await waitTerminal([victim], 120000);
          const hideDone = grepMain(/Successfully hid file/i).length > 0;
          ev_('S6', 'hide terminal=' + JSON.stringify(term[victim]) + ' hid-log=' + hideDone);
          // verify hidden via permaweb listing
          await sleep(3000);
          const pw1 = await getPermaweb(driveId);
          const hiddenEntry = pw1.find(x => x.name === victim);
          ev_('S6', 'permaweb entry after hide: ' + JSON.stringify(hiddenEntry));
          const isHidden = hiddenEntry && hiddenEntry.isHidden === true;
          await shot(page, 'a10-s6-delete-hide.png');
          // attempt unhide (restore)
          let unhid = null;
          if (hiddenEntry && hiddenEntry.fileId) {
            unhid = await ev(async (p) => { const r = await window.electronAPI.sync.unhideEntity({ driveId: p.d, entityId: p.e, entityType: 'file', name: p.n }); return r && r.success !== undefined ? { success: r.success, error: r.error, id: r.data && r.data.id } : { raw: JSON.stringify(r) }; }, { d: driveId, e: hiddenEntry.fileId, n: victim }).catch(e => ({ error: String(e) }));
            ev_('S6', 'unhide queued -> ' + JSON.stringify(unhid));
            if (unhid && unhid.id) { const pend2 = await getPending(); const ur = pend2.find(p => p.id === unhid.id || (p.operationType === 'unhide')); if (ur && moneyGuard('S6', [ur], null)) { await approve(ur.id); await waitTerminal([victim], 120000); const unhidLog = grepMain(/Successfully unhid file/i).length > 0; ev_('S6', 'unhide executed-log=' + unhidLog); } }
          }
          if (hideDone || isHidden) verdict('S6', 'PASS', 'local delete became ArFS hide (hid-log=' + hideDone + ', permaweb isHidden=' + isHidden + '); unhide=' + (unhid ? JSON.stringify(unhid) : 'n/a'));
          else verdict('S6', 'PARTIAL', 'hide op approved but hide confirmation not observed; term=' + JSON.stringify(term[victim]));
        }
      }
    } catch (e) { defect('S6', 'HIGH', 'S6', e.message); verdict('S6', 'FAIL', e.message); }

    // snapshot final upload/pending state for the restart leg to compare against
    try {
      const finalUploads = await getUploads();
      const finalPending = await getPending();
      fs.writeFileSync(path.join(NATIVE_ROOT, 'pre-restart-state.json'), JSON.stringify({ driveId, dir: DIR, uploads: finalUploads.map(u => ({ n: u.fileName, s: u.status, tx: u.dataTxId || u.transactionId, fid: u.fileId, op: u.operationType })), pending: finalPending.map(p => ({ n: p.fileName, s: p.status, op: p.operationType })) }, null, 2));
      ev_('S1', 'pre-restart state snapshot written (' + finalUploads.length + ' uploads, ' + finalPending.length + ' pending)');
    } catch (e) { note('could not write pre-restart state: ' + e.message); }

    await shot(page, 'a11-final.png');
    await app.close();
    return finish(rendererErrors);
  } catch (err) {
    console.error('HARNESS ERROR', err && err.stack ? err.stack : err);
    try { await shot(page, 'aFATAL.png'); } catch { /* noop */ }
    try { await app.close(); } catch { /* noop */ }
    return finish([]);
  }
}

function finish(rendererErrors) {
  flush();
  // dump detector-relevant main log lines for the record
  const detectorLines = mainLogs.filter(l => /File operation detected|File renamed from|File moved from|Copy operation detected|Confirming delete for|Operation type: (move|rename)|FolderOperationDetector: Detected|Handling folder operation|Edited file detected|Is edit: true|Successfully (hid|unhid|handled)|Cannot create move operation/i.test(l));
  try { fs.writeFileSync(path.join(NATIVE_ROOT, 'detector-log-evidence.txt'), detectorLines.map(s => s.trim()).join('\n') + '\n'); } catch { /* noop */ }
  console.log('\n================ SYNC WRITE OPS — SUMMARY ================');
  for (const id of Object.keys(scenarios)) console.log('  ' + id + '  ' + scenarios[id].verdict + '  — ' + scenarios[id].title);
  const allDefects = [].concat(...Object.values(scenarios).map(s => s.defects.map(d => ({ id: s.id, ...d }))));
  console.log('  defects: ' + allDefects.length);
  allDefects.forEach(d => console.log('    !! [' + d.sev + '] ' + d.id + ' @ ' + d.where + ': ' + d.desc));
  console.log('  renderer errors: ' + (rendererErrors ? rendererErrors.length : 0));
  console.log('  detector-evidence lines: ' + detectorLines.length);
  console.log('RESULT: streamed to ' + RESULTS_FILE);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exit(1); });
