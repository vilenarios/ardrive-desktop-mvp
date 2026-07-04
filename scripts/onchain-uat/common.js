/*
 * INFRA-9 on-chain UAT harness — shared helpers.
 *
 * Money-safety: this module NEVER prints/logs private-key JWK fields or the
 * password. Credentials are read from .env at repo root (gitignored). The
 * password is loaded, used for key derivation, and nulled by callers.
 *
 * Free tier: uploads STRICTLY smaller than 105 KiB (107520 bytes) cost 0 winc.
 *
 * Run (from wt-main):
 *   node scripts/onchain-uat/batch1-reads.js
 *   node scripts/onchain-uat/batch2-writes.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IKRY_ADDRESS = 'iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA';
const FREE_TIER_BYTES = 107520; // 105 KiB
const IKRY_TURBO_BALANCE_EXPECTED = '8503957651880'; // winc, must be unchanged after run

// --- env ---------------------------------------------------------------
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  const walletPath = out.ARDRIVE_DEV_WALLET_PATH;
  const password = out.ARDRIVE_DEV_PASSWORD;
  if (!walletPath || !password) {
    throw new Error('Missing ARDRIVE_DEV_WALLET_PATH or ARDRIVE_DEV_PASSWORD in .env');
  }
  return { walletPath, password };
}

// --- arweave -----------------------------------------------------------
// Gateway is overridable via ARDRIVE_GATEWAY_HOST for when arweave.net
// rate-limits this IP (429). Default matches the app (arweave.net).
function gatewayHost() {
  return process.env.ARDRIVE_GATEWAY_HOST || 'arweave.net';
}
function initArweave() {
  const Arweave = require('arweave');
  return (Arweave.default || Arweave).init({
    host: gatewayHost(),
    port: 443,
    protocol: 'https',
    timeout: 120000,
    logging: false,
  });
}

// --- hashing -----------------------------------------------------------
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// --- logging (secret-safe) --------------------------------------------
function log(...args) {
  console.log(...args);
}
function section(title) {
  console.log('\n' + '='.repeat(70) + '\n' + title + '\n' + '='.repeat(70));
}
// Guard: assert a string never looks like a JWK private field before printing.
function assertNoSecret(s) {
  if (typeof s === 'string' && /"[dpq]"\s*:|"(dp|dq|qi)"\s*:/.test(s)) {
    throw new Error('REFUSING to print string containing JWK private fields');
  }
  return s;
}

// --- turbo cost guard --------------------------------------------------
// Uses the APP MODULE turbo-manager (dist) so we exercise the money-guard code.
function getTurboManager() {
  const mod = require(path.resolve(__dirname, '..', '..', 'dist', 'main', 'turbo-manager.js'));
  return mod.turboManager;
}

async function assertFreeCost(turboManager, bytes, label) {
  const costs = await turboManager.getUploadCosts(bytes);
  const winc = String(costs.winc);
  log(`   [cost-check] ${label}: ${bytes} bytes -> ${winc} winc`);
  if (winc !== '0') {
    throw new Error(`ABORT UPLOAD: ${label} costs ${winc} winc (not free). bytes=${bytes}`);
  }
  return winc;
}

// --- retry with backoff (for 429 / transient gateway errors) ----------
async function withRetry(fn, { tries = 4, baseMs = 1500, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      const is429 = /429|rate|too many/i.test(msg);
      const wait = baseMs * Math.pow(2, i);
      log(`   [retry] ${label} failed (${msg.slice(0, 80)}); attempt ${i + 1}/${tries}${i + 1 < tries ? `, waiting ${wait}ms` : ''}`);
      if (i + 1 < tries) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

module.exports = {
  IKRY_ADDRESS,
  FREE_TIER_BYTES,
  IKRY_TURBO_BALANCE_EXPECTED,
  loadEnv,
  gatewayHost,
  initArweave,
  sha256,
  log,
  section,
  assertNoSecret,
  getTurboManager,
  assertFreeCost,
  withRetry,
};
