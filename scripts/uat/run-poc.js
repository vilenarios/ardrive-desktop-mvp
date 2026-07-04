#!/usr/bin/env node
/*
 * UAT POC runner — convenience wrapper.
 *
 *   node scripts/uat/run-poc.js services   # offline service-level harness (Electron main)
 *   node scripts/uat/run-poc.js ui         # Playwright-Electron first-run launch smoke
 *
 * Both require `npm run build` first (they drive the compiled dist/).
 * Neither spends funds or touches the network's paid paths.
 */
'use strict';

/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const path = require('path');
const { spawnSync } = require('child_process');

const mode = (process.argv[2] || '').toLowerCase();
const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..');
const electronBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron');

let cmd, args;
if (mode === 'services') {
  // Runs AS an Electron main process (real `app`, sqlite3 on electron ABI).
  cmd = electronBin;
  args = [path.join(HERE, 'poc-services.js')];
} else if (mode === 'ui') {
  // Playwright launches Electron itself; this is a plain node driver.
  cmd = process.execPath;
  args = [path.join(HERE, 'poc-ui-launch.js')];
} else {
  console.error('Usage: node scripts/uat/run-poc.js <services|ui>');
  process.exit(2);
}

const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
process.exit(res.status == null ? 1 : res.status);
