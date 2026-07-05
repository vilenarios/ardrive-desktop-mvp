#!/usr/bin/env node
/*
 * Isolating probe: does chokidar's file-ADD event fire under the EXACT config
 * sync-manager.ts uses, on a NATIVE ext4/tmpfs path vs a /mnt/c 9p mount?
 *
 * This isolates the filesystem question (inotify delivery) from the app's
 * setup/indexing path. It replicates sync-manager.ts:341 chokidar options
 * verbatim (no usePolling — same as production) and reports, per path,
 * whether `watcher.on('add')` fired for a freshly-written file.
 *
 * Run: node scripts/uat/chokidar-fs-probe.js [nativeDir] [mntDir]
 */
'use strict';
/* eslint-disable no-console */
const fs = require('fs'); const path = require('path'); const os = require('os');
const chokidar = require('chokidar');

const NATIVE_DIR = process.argv[2] || path.join('/tmp/claude-1000/-mnt-c-source-ardrive-desktop-mvp/64f37fe9-d4f4-4b08-90a8-3ca034bcac1a/scratchpad/uat-upload-native', 'chokidar-probe-native');
const MNT_DIR = process.argv[3] || null; // optional /mnt/c control

function probe(dir, label) {
  return new Promise((resolve) => {
    fs.mkdirSync(dir, { recursive: true });
    let realPath; try { realPath = fs.realpathSync(dir); } catch { realPath = dir; }
    let fired = false; let firedPath = null;
    // EXACT options from sync-manager.ts startFileWatcher() — no usePolling.
    const watcher = chokidar.watch(dir, {
      ignored: [/(^|[/\\])\../, /\.downloading$/],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    });
    const fileName = 'probe-' + Date.now() + '.bin';
    watcher.on('add', (fp) => { fired = true; firedPath = fp; });
    watcher.on('ready', () => {
      // write AFTER ready so it is a genuine add-after-watch (like a user drop)
      fs.writeFileSync(path.join(dir, fileName), Buffer.alloc(40 * 1024, 7));
    });
    // awaitWriteFinish adds ~1s; give it a generous window
    setTimeout(async () => {
      await watcher.close();
      const fsType = (() => { try { return require('child_process').execSync('df -T ' + JSON.stringify(realPath) + ' 2>/dev/null | tail -1').toString().trim().split(/\s+/)[1] || '?'; } catch { return '?'; } })();
      console.log(`[${fired ? 'FIRED' : 'NO-EVENT'}] ${label} — path=${realPath} fs=${fsType}` + (fired ? ` firedPath=${firedPath}` : ''));
      resolve({ label, dir: realPath, fsType, fired });
    }, 6000);
  });
}

(async () => {
  console.log('chokidar version:', require('chokidar/package.json').version);
  const out = [];
  out.push(await probe(NATIVE_DIR, 'NATIVE (ext4/tmpfs)'));
  if (MNT_DIR) out.push(await probe(MNT_DIR, 'MNT (/mnt/c 9p control)'));
  console.log('\nRESULT: ' + JSON.stringify(out));
  process.exit(0);
})();
