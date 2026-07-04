/*
 * INFRA-9 R1 (fallback) — raw OWNER-SCOPED ArFS GraphQL enumeration.
 *
 * Why this exists: arweave.net rate-limits (429) this IP hard, and core-js's
 * getAllDrivesForAddress makes many arweave.net calls -> unusable. AR.IO
 * gateways (e.g. permagate.io) serve the same GraphQL happily. This script
 * runs the identical owner-scoped drive query core-js issues (owners:[addr] +
 * Entity-Type=drive) directly against a healthy GQL gateway and classifies the
 * results — proving the owner-scoped query returns data when owner is supplied.
 *
 * Layer: raw GraphQL (gateway), NOT app-module. Demonstrates the CORE-1 path.
 *
 * Run:  GQL_GATEWAY=https://permagate.io/graphql node scripts/onchain-uat/gql-enum.js
 */
'use strict';
const c = require('./common');

const GQL = process.env.GQL_GATEWAY || 'https://permagate.io/graphql';
const OWNER = c.IKRY_ADDRESS;

function tag(node, name) {
  const t = (node.tags || []).find((x) => x.name === name);
  return t ? t.value : undefined;
}

async function pageDrives(after) {
  const query = `query{
    transactions(
      owners:["${OWNER}"],
      tags:[{name:"Entity-Type",values:["drive"]}],
      first:100${after ? `,after:"${after}"` : ''}
    ){
      pageInfo{hasNextPage}
      edges{cursor node{id owner{address} tags{name value}}}
    }
  }`;
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GQL http ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error('GQL errors: ' + JSON.stringify(json.errors));
  return json.data.transactions;
}

async function main() {
  c.section(`R1 (raw GQL) owner-scoped drive enumeration for ikry via ${GQL}`);
  const byDrive = new Map(); // driveId -> { privacy, appName, arfs, txCount, latestTx }
  let after = null;
  let pages = 0;
  let totalTx = 0;
  const wrongOwner = [];
  do {
    const tx = await c.withRetry(() => pageDrives(after), { label: 'gql page', tries: 4, baseMs: 1500 });
    pages++;
    for (const e of tx.edges) {
      totalTx++;
      const n = e.node;
      if (n.owner && n.owner.address && n.owner.address !== OWNER) wrongOwner.push(n.owner.address);
      const driveId = tag(n, 'Drive-Id');
      const privacy = tag(n, 'Drive-Privacy') || 'unknown';
      const appName = tag(n, 'App-Name');
      const arfs = tag(n, 'ArFS');
      const unix = Number(tag(n, 'Unix-Time') || 0);
      if (!driveId) continue;
      const prev = byDrive.get(driveId);
      if (!prev || unix > prev.unix) {
        byDrive.set(driveId, { driveId, privacy, appName, arfs, unix, txCount: (prev ? prev.txCount : 0) + 1, latestTx: n.id });
      } else {
        prev.txCount++;
      }
    }
    after = tx.edges.length ? tx.edges[tx.edges.length - 1].cursor : null;
    if (!tx.pageInfo.hasNextPage) break;
  } while (after && pages < 50);

  const drives = [...byDrive.values()];
  const pub = drives.filter((d) => d.privacy === 'public');
  const priv = drives.filter((d) => d.privacy === 'private');
  c.log(`   drive metadata txns scanned: ${totalTx} across ${pages} page(s)`);
  c.log(`   UNIQUE drives: ${drives.length}  (public: ${pub.length}, private: ${priv.length})`);
  c.log(`   owner-address integrity: every returned tx owned by ikry? ${wrongOwner.length === 0 ? 'YES ✓' : 'NO ✗ (' + wrongOwner.length + ' foreign)'}`);
  c.log('   --- drive inventory (id | privacy | createdBy | arfs | #revisions) ---');
  drives
    .sort((a, b) => (a.privacy < b.privacy ? -1 : 1) || a.unix - b.unix)
    .forEach((d) => c.log(`     ${d.driveId} | ${d.privacy.padEnd(7)} | ${(d.appName || '?').padEnd(14)} | ArFS ${d.arfs || '?'} | ${d.txCount} rev`));

  c.section('R1 (raw GQL) JSON SUMMARY');
  console.log(JSON.stringify({
    gateway: GQL,
    ownerScopedQuery: `transactions(owners:["${OWNER}"],tags:[{name:"Entity-Type",values:["drive"]}])`,
    driveMetadataTxns: totalTx,
    uniqueDrives: drives.length,
    public: pub.length,
    private: priv.length,
    ownerIntegrityOk: wrongOwner.length === 0,
    drives: drives.map((d) => ({ driveId: d.driveId, privacy: d.privacy, createdBy: d.appName, arfs: d.arfs, revisions: d.txCount })),
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('GQL-ENUM FATAL:', e.message); process.exit(1); });
