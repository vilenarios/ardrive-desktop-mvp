# ArFS Snapshot Interop Harness — Golden Full-Replay Baseline

**Purpose.** Prove that the *next* core-js lane (snapshot phase 2, which will change the
drive-**LISTING** path) produces a listing that is **byte-identical** to the current
full-history-replay listing. That is the correctness gate for the highest-stakes core-js
change: if snapshot-accelerated listing ever diverges from replay listing, drives list
wrong. The only trustworthy proof is an **interop vector**:

```
canonical( snapshot-listing(driveX) )  ==  canonical( full-replay-listing(driveX) )   // GOLDEN
```

This harness captures the **golden full-replay baseline** *now*, on current core-js
(before snapshots are wired into listing), so phase 2 can diff against it.

Everything here is **read-only**: public drive listing is anonymous by drive-id. No wallet,
no secrets, no spend, no writes. No secrets are committed.

---

## 1. What was built and how the CLI was wired to local core-js

| Component | Path |
|---|---|
| ArDrive-CLI (build target) | `../ardrive-cli` |
| Local core-js build (golden base) | `../wt-snapshot-foundation` |
| This harness | `.` (`corejs-plan/interop-harness/`) |

**Wiring (per CLI README §"Using a custom ArDrive-Core-JS").** The CLI's
`package.json` `"ardrive-core-js"` dependency was repointed from the npm pin `"4.0.0"` to
the local build:

```diff
-  "ardrive-core-js": "4.0.0",
+  "ardrive-core-js": "file:../wt-snapshot-foundation",
```

Then, in `../ardrive-cli`:

```bash
nvm use 22                                                   # v18 (.nvmrc) unavailable here; 22 builds+runs fine
npm install --ignore-scripts --legacy-peer-deps              # symlinks core-js; --legacy-peer-deps: a devDep (prettier) peer clash only
npx tsc --project ./tsconfig.prod.json                       # builds CLI lib/ (bin = lib/index.js)
```

**Confirmation the CLI uses the LOCAL build (three independent checks):**

1. **Symlink realpath.** `node_modules/ardrive-core-js` → `../../wt-snapshot-foundation`;
   `require.resolve('ardrive-core-js')` from the CLI resolves to
   `…/wt-snapshot-foundation/lib/exports.js` (not npm's cache).
2. **Behavioral distinguisher (definitive).** The resolved module **exports snapshot symbols
   that npm's published `ardrive-core-js@4.0.0` does NOT**:
   `buildSnapshotQuery`, `parseSnapshotData`, `computeSnapshotSubRanges`,
   `snapshotEntityFromGQLNode`, `SnapshotTagName`, `SNAPSHOT_ENTITY_TYPE`, … The git head is
   `f6da1d2` (`feat/snapshot-foundation`, unreleased), which is not in 4.0.0.
3. **Provenance.** core-js worktree `git rev-parse HEAD` = `f6da1d21981bec874cdc825c1fe401864690cfac`
   on branch `feat/snapshot-foundation`.

**"Snapshots UNWIRED" verified.** The snapshot modules are *only re-exported* in
`lib/exports.js`; grep shows **no listing/DAO code consumes them**
(`lib/arfs/arfsdao_anonymous.js` and `arfsdao.js` contain zero `snapshot` references). So the
listing path (`getPublicDrive` → `listPublicFolder`) is **pure full-history replay** — exactly
the behavior phase 2 will extend. The request counts below (all GraphQL, many pages) corroborate
this: no snapshot-tx read shortcut is taken.

> The CLI `package.json` edit is **local scratch only** — not committed to the CLI repo.
> Original preserved at `cli-package.json.orig`.

---

## 2. Interop target drive(s)

Owner: `iKryOeZQMONi2965nKz528htMMN_sBcjlhc-VncoRjA` (public drives; enumerated read-only via
`ardrive list-all-drives --address <addr>` — no wallet file, see `all-drives.json`).

Gateway: **`https://turbo-gateway.com`** — it indexes this owner's ArFS metadata. (perma.online
does **not** index this owner's metadata GraphQL — it returns 0 drives; see the re-cert report.
Do not use it.)

| Golden | Drive ID | Files | Folders* | Total | List time | GraphQL reqs |
|---|---|---:|---:|---:|---:|---:|
| **`bundled-drive`** (PRIMARY) | `1f373b21-117d-4988-9107-ac12676bd342` | 30 | 9 | **39** | ~1–3 s | **14** |
| `ytmnd` (fallback) | `a84b951b-7d2f-4fa1-a89f-4b4ed673b404` | 12 | 2 | 14 | ~2 s | 7 |
| `new-test-drive` (smoke) | `c863be1f-a725-4554-9a9e-18268ed8a035` | 3 | 1 | 4 | ~1 s | 6 |

\* Folder count **includes the drive root folder** (`list-drive` is called with `includeRoot:true`).
The re-cert reported `1f373b21` as "30 files / 8 folders / 38" excluding root; +root = 9 folders / 39.

**Primary = `1f373b21` (`bundled-drive`)** — most entities (30 files across 8 real subfolders +
mixed `ArDrive-Web`/`ArDrive-App`/`ArDrive-Core` app tags and 2 on-chain snapshots) = the strongest
interop signal, and it lists reliably and fast on turbo. The two smaller drives are kept as fallbacks
if turbo 404-storms the primary during a phase-2 run.

---

## 3. The golden baseline — complete & deterministic

Each golden was captured by running `list-drive` **3×** and requiring all 3 **canonical**
captures to be byte-identical before writing the golden (`capture-golden.sh` determinism gate).
**All three drives passed 3/3 identical.**

| Golden file | Canonical sha256 | Determinism |
|---|---|---|
| `golden-bundled-drive.json` | `1ee56cb114f0fca4bfc0ab08f9bf3b7d9976886d2f20a029b9f5f2ed767dbf7b` | 3/3 identical |
| `golden-ytmnd.json` | `4607b96fc56f0181a60e15dba5a93cfb23b9ffe931de01ea1e2fcd5a0327542e` | 3/3 identical |
| `golden-new-test-drive.json` | `7d507f235f9d6a1814d7395de4d19ca2f3ccda101467dd86bd9112d4c55fbb59` | 3/3 identical |

Each golden has a sidecar `*.meta.json` (drive id, gateway, counts, sha256, baseline GraphQL
request count, canonicalization spec). Raw per-run captures are under `captures/<label>/`.

**Canonicalization (`canonicalize.js`) — why the golden is a stable diff target.** The listing is
pure on-chain ArFS metadata (appName/appVersion/arFS/txId/unixTime/entityId/paths/size/…): there are
**no query timestamps or gateway-specific fields**, so *values* need no normalization. Only **order**
is normalized, so the golden can never spuriously diff on ordering:

- sort entities by `entityId` (a UUID, unique per entity), tiebreak by `entityType`;
- deep-sort every object's keys (incl. nested `customMetaDataGqlTags`);
- emit 2-space JSON + trailing newline.

No fields are stripped or altered.

---

## 4. How phase 2 verifies against the golden (the interop recipe)

Phase 2 will wire snapshots into the listing DAO. To prove interop, point the **same CLI** at the
**snapshot-wired** core-js build and re-run the exact listing, then diff:

```bash
# 1. Repoint the CLI at the phase-2 (snapshot-wired) core-js build and rebuild:
cd ../ardrive-cli
#   edit package.json: "ardrive-core-js": "file:../<phase-2-corejs-worktree>"
npm install --ignore-scripts --legacy-peer-deps
npx tsc --project ./tsconfig.prod.json

# 2. Run the interop gate (canonicalizes the live listing and diffs it vs the golden):
cd ../corejs-plan/interop-harness
bash ./verify-against-golden.sh 1f373b21-117d-4988-9107-ac12676bd342 golden-bundled-drive.json
#   exit 0 + "INTEROP PASS"  => snapshot listing == full-replay listing  (byte-identical)
#   exit 1 + "INTEROP FAIL"  => prints a unified diff of the divergence
```

Equivalent by hand (no wrapper):

```bash
NODE_OPTIONS="--require $PWD/req-count.js" \
  node ../../ardrive-cli/lib/index.js list-drive \
    --drive-id 1f373b21-117d-4988-9107-ac12676bd342 -g https://turbo-gateway.com > actual.raw.json
node canonicalize.js actual.raw.json > actual.canon.json
diff -u golden-bundled-drive.json actual.canon.json && echo "INTEROP PASS"
```

**Gate proven to have teeth (self-test):**
- Positive: `verify-against-golden.sh 1f373b21 golden-bundled-drive.json` on the current
  (unwired) build → **INTEROP PASS**, exit 0.
- Negative control: listing `a84b951b` but diffing against `golden-bundled-drive.json` →
  **INTEROP FAIL** with a diff, non-zero exit. A false PASS cannot slip through.

Run the same for the fallbacks (`golden-ytmnd.json` / `golden-new-test-drive.json`) for a
multi-drive interop signal.

---

## 5. Measuring request count (proving the snapshot path does LESS work)

`req-count.js` is a zero-dep Node `--require` preload that patches `http/https.request` and
`global.fetch` and, on exit, prints one line to stderr:

```
REQCOUNT {"total":14,"graphql":14,"data":0,"other":0,"byHost":{"turbo-gateway.com":14}}
```

`verify-against-golden.sh` captures it automatically and compares against the golden's recorded
baseline. Full-replay baselines (this capture):

| Drive | GraphQL requests (full-replay golden) |
|---|---|
| `1f373b21` | **14** |
| `a84b951b` | 7 |
| `c863be1f` | 6 |

**Interop success condition for phase 2:** the canonical listing must be **byte-identical**
to the golden **AND** the GraphQL request count must **drop** (`actual.graphql < golden.graphql`)
— same tree, fewer requests, which is the entire point of snapshot acceleration. (All requests
here are GraphQL because `list-drive` fetches metadata only, not file data; the snapshot path
should replace many history-paging GQL calls with a small number of snapshot-tx reads.)

---

## 6. Flakiness encountered & how it was handled

- turbo-gateway.com **404-storms intermittently** (documented in the re-cert). During this
  capture it was healthy: all 9 golden runs (3 drives × 3) completed clean, no 404s, sub-3 s each.
- Mitigations baked in: `capture-golden.sh` and `verify-against-golden.sh` wrap the CLI in a
  `timeout` (160 s default), and the determinism gate refuses to emit a golden unless all N runs
  agree — a mid-capture 404 storm would surface as a failed run or a non-deterministic gate, not a
  silently-bad golden.
- **Fallback ladder** if the primary drive flakes during a phase-2 run: `1f373b21` (primary) →
  `a84b951b` → `c863be1f`. All three have deterministic goldens, so any is a valid interop target.
- v18 (CLI `.nvmrc`) is not installed here; **node 22** was used to build and run the CLI — no
  issues (core-js `lib/` was already built; listing works).

---

## 7. Files in this harness

```
INTEROP-HARNESS.md            this doc
capture-golden.sh             capture a deterministic golden (runs N×, canon, gate, write)
verify-against-golden.sh      PHASE-2 GATE: list live, canonicalize, diff vs golden, req-count delta
canonicalize.js               order-normalize a raw list-drive array -> stable diff target
req-count.js                  Node preload: count+classify outbound HTTP(S)/fetch requests
golden-bundled-drive.json     PRIMARY golden (1f373b21, 39 entities)      + .meta.json
golden-ytmnd.json             fallback golden (a84b951b, 14 entities)     + .meta.json
golden-new-test-drive.json    smoke golden (c863be1f, 4 entities)         + .meta.json
all-drives.json               read-only public drive enumeration for this owner (target picking)
cli-package.json.orig         pristine CLI package.json (before the file: repoint)
captures/<label>/             raw+canon+stderr for each of the 3 runs per drive
```

**Re-capture a golden** (e.g. new target): `bash capture-golden.sh <drive-id> [label] [runs] [gateway]`.

---
## Acceptance criterion refinement (2026-07-05, phase-2 learning)

Strict byte-identical is NOT always the right gate. Full-replay listing is only as complete as the **gateway's mutable GraphQL index**, which can DROP entities over time. Snapshots (permanent on-chain) preserve them. So a snapshot listing may be a **strict superset** of the full-replay golden.

**Correct acceptance:** snapshot listing ⊇ golden (a SUPERSET: zero removals) AND fewer GraphQL requests, where every *addition* is a verified **real on-chain entity that the gateway GraphQL index has dropped** (confirm: `transactions(ids:[tx])` → 0 edges, but `GET /<tx>` → 200 with valid ArFS metadata).

Proven case: drive `1f373b21`, file `aa10f0cd` "Tropical_FishTank.jpg", metadata tx `G4MlAlM1OcryUBKD4F95hPvLoXhhhaK9B4JWU2qaaS4` — GQL 0 edges, by-id 200/168B valid file JSON. Snapshot restores it; full-replay silently loses it. This makes snapshots a DATA-INTEGRITY fix, not just performance.
