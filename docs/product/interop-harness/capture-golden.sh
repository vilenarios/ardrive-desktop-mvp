#!/usr/bin/env bash
#
# capture-golden.sh — capture a deterministic full-replay golden listing for a
# PUBLIC ArDrive drive, using the ArDrive-CLI wired to the local core-js build
# (feat/snapshot-foundation, snapshots UNWIRED => pure full-history replay).
#
# Read-only. No wallet, no spend. Public drive listing is anonymous by drive-id.
#
# Runs `ardrive list-drive` N times against turbo-gateway.com, canonicalizes
# each result (canonicalize.js), hashes them, and only writes the golden if all
# N canonical captures are byte-identical (determinism gate). Also records the
# outbound-request count (req-count.js) so the phase-2 snapshot path can later
# prove it makes FEWER requests for the SAME listing.
#
# Usage:
#   ./capture-golden.sh <drive-id> [label] [runs] [gateway]
# Defaults: label=<drive-id prefix>, runs=3, gateway=https://turbo-gateway.com
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$(cd "$HERE/../../ardrive-cli" && pwd)"

DRIVE_ID="${1:?drive-id required}"
LABEL="${2:-${DRIVE_ID%%-*}}"
RUNS="${3:-3}"
GATEWAY="${4:-https://turbo-gateway.com}"
TIMEOUT="${TIMEOUT:-160}"

# Load node 22 via nvm if present (CLI/core-js build target; v18 unavailable here)
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; nvm use 22 >/dev/null 2>&1 || true; fi

WORK="$HERE/captures/$LABEL"
mkdir -p "$WORK"
echo "== capture-golden =="
echo "drive:   $DRIVE_ID"
echo "gateway: $GATEWAY"
echo "runs:    $RUNS"
echo "cli:     $CLI  (core-js -> $(readlink -f "$CLI/node_modules/ardrive-core-js"))"
echo "node:    $(node --version)"
echo

hashes=()
for i in $(seq 1 "$RUNS"); do
  raw="$WORK/run$i.raw.json"
  canon="$WORK/run$i.canon.json"
  err="$WORK/run$i.err"
  echo "-- run $i/$RUNS --"
  start=$(date +%s.%N)
  NODE_OPTIONS="--require $HERE/req-count.js" \
    timeout "$TIMEOUT" node "$CLI/lib/index.js" list-drive \
      --drive-id "$DRIVE_ID" -g "$GATEWAY" > "$raw" 2>"$err" || {
        echo "   FAILED (exit $?) — see $err"; tail -3 "$err"; exit 3; }
  end=$(date +%s.%N)
  node "$HERE/canonicalize.js" "$raw" > "$canon"
  h=$(sha256sum "$canon" | cut -d' ' -f1)
  hashes+=("$h")
  n=$(node -e "console.log(require('$canon').length)")
  reqc=$(grep '^REQCOUNT ' "$err" | tail -1 | sed 's/^REQCOUNT //')
  printf "   entities=%s  time=%.1fs  sha256=%s\n" "$n" "$(echo "$end - $start" | bc)" "${h:0:16}…"
  echo "   reqcount=$reqc"
done

echo
echo "== determinism gate =="
first="${hashes[0]}"
ok=1
for h in "${hashes[@]}"; do [ "$h" = "$first" ] || ok=0; done
if [ "$ok" -eq 1 ]; then
  echo "DETERMINISTIC: all $RUNS canonical captures identical (sha256=$first)"
  golden="$HERE/golden-$LABEL.json"
  cp "$WORK/run1.canon.json" "$golden"
  # baseline GraphQL request count (from the last run's REQCOUNT line)
  golden_gql=$(printf '%s' "$reqc" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s||'{}').graphql??''))")
  # entity breakdown + meta
  node -e '
    const a=require(process.argv[1]);
    const t={}; a.forEach(x=>t[x.entityType]=(t[x.entityType]||0)+1);
    const meta={
      driveId: process.argv[2], label: process.argv[3], gateway: process.argv[4],
      runs: Number(process.argv[5]), capturedAt: new Date().toISOString(),
      corejs: "feat/snapshot-foundation (git f6da1d2, snapshots UNWIRED => full-replay)",
      cli: "ardrive-cli 4.0.0 (local, tsc build)",
      canonicalization: "sort by entityId then entityType; deep key-sort; 2-space JSON; trailing newline",
      totalEntities: a.length, breakdown: t,
      goldenSha256: process.argv[6],
      goldenGraphqlRequests: process.argv[8] === "" ? null : Number(process.argv[8])
    };
    require("fs").writeFileSync(process.argv[7], JSON.stringify(meta,null,2)+"\n");
    console.log(JSON.stringify(meta,null,2));
  ' "$golden" "$DRIVE_ID" "$LABEL" "$GATEWAY" "$RUNS" "$first" "$HERE/golden-$LABEL.meta.json" "$golden_gql"
  echo
  echo "GOLDEN written: $golden"
  echo "META written:   $HERE/golden-$LABEL.meta.json"
else
  echo "NON-DETERMINISTIC: canonical captures differ across runs — DO NOT trust as golden"
  printf '  %s\n' "${hashes[@]}"
  exit 4
fi
