/*
 * req-count.js — a zero-dependency Node preload that counts every outbound
 * HTTP(S) request the process makes, classifying GraphQL vs data/tx fetches.
 *
 * Load it with:  NODE_OPTIONS="--require /abs/path/req-count.js" node <cli> ...
 *
 * On process exit it writes a one-line JSON summary to stderr, prefixed with
 * REQCOUNT so a harness can grep it out, e.g.:
 *   REQCOUNT {"total":142,"graphql":51,"data":88,"other":3,"byHost":{...}}
 *
 * WHY it matters for the snapshot interop lane: the golden baseline is
 * produced by FULL-HISTORY REPLAY (many GraphQL pages + per-entity fetches).
 * The phase-2 snapshot-accelerated path must produce the SAME listing with
 * FEWER requests. Capture REQCOUNT for both; assert
 * snapshot.graphql < golden.graphql while the canonical listings are equal.
 *
 * It patches both node core http/https.request (covers axios / arweave-js)
 * and global.fetch (covers undici-based fetch), so it is transport-agnostic.
 */
'use strict';
const http = require('http');
const https = require('https');

const counts = { total: 0, graphql: 0, data: 0, other: 0, byHost: {} };

function classify(urlStr) {
  counts.total++;
  let host = 'unknown';
  let isGql = false;
  try {
    const u = new URL(urlStr);
    host = u.host;
    isGql = /graphql/i.test(u.pathname);
  } catch {
    isGql = /graphql/i.test(String(urlStr));
  }
  counts.byHost[host] = (counts.byHost[host] || 0) + 1;
  if (isGql) counts.graphql++;
  else if (host !== 'unknown') counts.data++;
  else counts.other++;
}

function urlFromArgs(proto, args) {
  // http.request(url[, options][, cb]) or http.request(options[, cb])
  const a = args[0];
  if (typeof a === 'string') return a;
  if (a instanceof URL) return a.toString();
  if (a && typeof a === 'object') {
    const host = a.hostname || a.host || 'localhost';
    const path = a.path || a.pathname || '/';
    const port = a.port ? `:${a.port}` : '';
    const scheme = a.protocol || proto + ':';
    return `${scheme}//${host}${port}${path}`;
  }
  return `${proto}://unknown`;
}

for (const [mod, proto] of [[http, 'http'], [https, 'https']]) {
  const origRequest = mod.request;
  mod.request = function (...args) {
    try { classify(urlFromArgs(proto, args)); } catch { counts.total++; counts.other++; }
    return origRequest.apply(this, args);
  };
  const origGet = mod.get;
  mod.get = function (...args) {
    try { classify(urlFromArgs(proto, args)); } catch { counts.total++; counts.other++; }
    return origGet.apply(this, args);
  };
}

if (typeof global.fetch === 'function') {
  const origFetch = global.fetch;
  global.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      classify(url);
    } catch { counts.total++; counts.other++; }
    return origFetch.call(this, input, init);
  };
}

process.on('exit', () => {
  try {
    process.stderr.write('REQCOUNT ' + JSON.stringify(counts) + '\n');
  } catch { /* ignore */ }
});
