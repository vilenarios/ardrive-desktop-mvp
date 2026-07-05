#!/usr/bin/env node
/*
 * canonicalize.js — turn a raw `ardrive list-drive` JSON array into a
 * stable, order-independent, deep-key-sorted canonical form so it can be
 * used as a byte-exact golden diff target.
 *
 * Why: the CLI already sorts by path, but we do not want the golden to
 * depend on the CLI's sort implementation. We re-sort by entityId (a UUID,
 * unique per entity) with entityType as a tiebreaker, and sort every
 * object's keys (recursively) so key-insertion order can never cause a
 * spurious diff. No field values are altered or stripped — the listing is
 * pure on-chain ArFS metadata (no query timestamps / gateway fields), so
 * value-level normalization is unnecessary; only ORDER is normalized.
 *
 * Usage:  node canonicalize.js <raw.json>   # prints canonical JSON to stdout
 */
'use strict';
const fs = require('fs');

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k]);
    return out;
  }
  return value;
}

const raw = fs.readFileSync(process.argv[2], 'utf8');
const arr = JSON.parse(raw);
if (!Array.isArray(arr)) {
  console.error('Expected a JSON array from list-drive');
  process.exit(2);
}

const canon = arr
  .map(sortKeysDeep)
  .sort((a, b) => {
    const ai = String(a.entityId), bi = String(b.entityId);
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    const at = String(a.entityType), bt = String(b.entityType);
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

process.stdout.write(JSON.stringify(canon, null, 2) + '\n');
