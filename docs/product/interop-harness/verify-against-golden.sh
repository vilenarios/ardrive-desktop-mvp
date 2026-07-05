#!/usr/bin/env bash
#
# verify-against-golden.sh — the phase-2 interop gate.
#
# Lists a PUBLIC drive with the CURRENT CLI/core-js build (whatever the CLI's
# node_modules/ardrive-core-js points at — swap it to the snapshot-wired build
# to test phase 2), canonicalizes the result the same way the golden was made,
# and diffs it against the recorded golden. Byte-identical => interop PASS
# (snapshot listing == full-replay listing). Also reports the outbound request
# count and, if the golden's .meta.json is present, the GraphQL-request delta so
# you can prove the snapshot path makes FEWER requests for the SAME listing.
#
# Read-only. No wallet, no spend.
#
# Usage:  ./verify-against-golden.sh <drive-id> <golden.json> [gateway]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$(cd "$HERE/../../ardrive-cli" && pwd)"

DRIVE_ID="${1:?drive-id required}"
GOLDEN="${2:?golden json path required}"
GATEWAY="${3:-https://turbo-gateway.com}"
TIMEOUT="${TIMEOUT:-160}"
[ -f "$GOLDEN" ] || { echo "golden not found: $GOLDEN"; exit 2; }
GOLDEN="$(cd "$(dirname "$GOLDEN")" && pwd)/$(basename "$GOLDEN")"  # -> absolute for require()

if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; nvm use 22 >/dev/null 2>&1 || true; fi

TMP="$(mktemp -d)"
raw="$TMP/actual.raw.json"; canon="$TMP/actual.canon.json"; err="$TMP/actual.err"

echo "verify: drive=$DRIVE_ID  gateway=$GATEWAY"
echo "core-js -> $(readlink -f "$CLI/node_modules/ardrive-core-js")"
NODE_OPTIONS="--require $HERE/req-count.js" \
  timeout "$TIMEOUT" node "$CLI/lib/index.js" list-drive \
    --drive-id "$DRIVE_ID" -g "$GATEWAY" > "$raw" 2>"$err" || {
      echo "LIST FAILED (exit $?)"; tail -5 "$err"; exit 3; }
node "$HERE/canonicalize.js" "$raw" > "$canon"

reqc=$(grep '^REQCOUNT ' "$err" | tail -1 | sed 's/^REQCOUNT //')
actual_gql=$(printf '%s' "$reqc" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s||'{}').graphql||'?'))")

echo
if diff -u "$GOLDEN" "$canon" > "$TMP/diff.txt"; then
  echo "INTEROP PASS: canonical listing == golden ($(basename "$GOLDEN"))"
  echo "  entities=$(node -e "console.log(require('$canon').length)")  actual reqcount=$reqc"
  meta="${GOLDEN%.json}.meta.json"
  if [ -f "$meta" ]; then
    golden_gql=$(node -e "const m=require('$meta'); console.log(m.goldenGraphqlRequests ?? '(not recorded)')")
    echo "  golden GraphQL requests (full-replay baseline): $golden_gql"
    echo "  actual GraphQL requests (this build):           $actual_gql"
    echo "  => for a PASS, snapshot phase-2 should show actual_gql < golden_gql"
  fi
  rm -rf "$TMP"; exit 0
else
  echo "INTEROP FAIL: canonical listing != golden — DIFF FOLLOWS"
  echo "  actual reqcount=$reqc"
  sed -n '1,120p' "$TMP/diff.txt"
  echo "(full diff: $TMP/diff.txt)"
  exit 1
fi
