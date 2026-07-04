# UAT-HARNESS — how to actually execute the UAT plan [UAT]

Status: **draft, 2026-07-04.** Companion to [UAT-PLAN.md](UAT-PLAN.md). This doc answers the crux the
product owner asked: *concretely, how does an agent run the plan accurately and completely?* Every claim
below was **proven on this machine** (headless WSL2, DISPLAY=:0 WSLg), not assumed. The working proof lives
in `scripts/uat/` and ran green (§4).

> Money rail (absolute): **never spend real funds.** Free-tier only (<100 KiB = 102400 bytes) or mock/dry-run
> the paid paths. Reads use **turbo-gateway.com**, never arweave.net. The test wallet is referenced by
> `ARDRIVE_DEV_WALLET_PATH` / `.env` **only** — never inline a wallet JSON, seed phrase, or password anywhere.

---

## 1. TL;DR — recommended combined strategy

No single mechanism covers everything. Use four, each where it's strongest:

| Layer | Mechanism | Covers | Cost |
|---|---|---|---|
| **SVC** | Service-level harness (`scripts/uat/poc-services.js`) + vitest `@vitest-environment node` suites over `dist/main/*` | Main-process logic: DB, migrations, wallet crypto, cost/free-tier gate, drive-key lifecycle, validators, IPC envelopes | offline, deterministic, $0 |
| **UI** | Playwright-Electron on the real built app (`scripts/uat/poc-ui-launch.js`, `tests/e2e/smoke.js`) | End-to-end journeys, real render, screenshots, cross-screen consistency, ground-truth via preload IPC | needs a display; free-tier network for the full journey |
| **RTL** | vitest + jsdom + React Testing Library (`tests/unit/components/*`) | Deterministic UI states/copy/roles/a11y per component without a backend | offline, deterministic, $0 |
| **CHAIN** | `scripts/onchain-uat/*` — free-tier on-chain writes, throwaway zero-fund wallet, net-zero balance proof | Real ArFS: drive create, upload, download, revision, hide/unhide, manifest | free-tier network, $0 (net-zero proven) |
| **STATIC** | Structured code read vs `DESIGN-SYSTEM.md` / `DESIGN-8-uiux-sweep.md` | Design-token violations, missing roles/aria/focus, copy audits, dead code | offline, no runtime |

Map each UAT area to its layer via the **Harness** tag already on every scenario in UAT-PLAN.md.

---

## 2. Feasibility verdict on each option (honest, tested here)

### (a) Full UI automation — Playwright-Electron — ✅ FEASIBLE & PROVEN

- **Electron boots in this headless WSL env.** Electron 27.3.11 reaches `ready`, opens a `BrowserWindow`,
  and quits cleanly under WSLg (`DISPLAY=:0`, X11 socket at `/tmp/.X11-unix/X0`). GPU init fails
  (`renderD128` permission denied) but that is **non-fatal** — it falls back to software rendering.
- **Playwright is installed** (`playwright@^1.61.1`, devDependency) and `_electron.launch` /`firstWindow`/
  `evaluate`/`screenshot`/`close` all work. `poc-ui-launch.js` drove the **real built app** to the first-run
  screen, asserted headings/buttons via `getByRole`, read ground truth over the preload IPC bridge, and
  captured a **132 KB screenshot** of the correctly-rendered wallet-setup screen. 6/6 checks passed.
- **Gotchas (documented so the tester doesn't rediscover them):**
  - Pass `--disable-gpu --no-sandbox` (args) — software render is reliable, sandbox off is needed as this
    user. `poc-services.js` also calls `app.disableHardwareAcceleration()`.
  - **Screenshots of a hidden (`show:false`) window hang** ("waiting for fonts"). The real app shows its
    window on `ready-to-show` (`main.ts:255,296`), so screenshots work; if you build a throwaway window,
    set `show:true`.
  - Needs a display: **WSLg here**, or `xvfb-run` elsewhere (xvfb is *not* installed on this box —
    `apt-get install xvfb` offline mirror if you move to a display-less CI). WSLg makes it unnecessary here.
- **Disposable + fail-closed:** `main.ts:9` honors `ARDRIVE_TEST_USERDATA` **only when `!app.isPackaged`** —
  redirects userData to a temp dir, refusing in packaged builds. Dev-wallet autofill is gated on
  `ARDRIVE_DEV_MODE && !isPackaged`. So a tester gets a clean, throwaway world every run.
- **Limits:** the *full* journey (`tests/e2e/smoke.js`) does a **real on-chain drive create + free-tier
  upload** — allowed (free tier, zero-fund wallet) but it's slow (arweave.net 429 backoff observed, minutes)
  and touches the network. Keep the funded/paid parts human-gated. Verdict: **use UI for journeys, states,
  screenshots, and consistency; keep it offline (stop before network) wherever a scenario allows.**

### (b) Functional / IPC-level service harness — ✅ FEASIBLE & PROVEN (the reliable functional path)

- **Constraint discovered:** `database-manager.ts`, `profile-manager.ts`, `config-manager.ts`,
  `wallet-manager-secure.ts` all `import { app } from 'electron'`. Under **plain `node`**, `require('electron')`
  is a path string → `app.getPath` is undefined → crash. **`turbo-manager.ts` has no electron import**, which
  is why `scripts/onchain-uat/*` can `require('dist/main/turbo-manager.js')` under plain node.
- **Solution (proven):** run the service harness **as an Electron main process** (`electron
  scripts/uat/poc-services.js`). `require('electron')` then yields the real `app`; call
  `app.setPath('userData', tmp)` and `require` the compiled `dist/main/*` **after** so the singletons resolve
  paths inside the temp dir. This is also faithful to how the shipping app loads these modules, and
  `sqlite3`'s native binding is already built for the Electron ABI (the app uses it).
- `poc-services.js` exercised the **real** `DatabaseManager` (migrations v3→v5, per-profile isolation, drive
  mappings, pending uploads with the **MONEY-3 integer→boolean normalization**), `crypto-utils`
  (AES-256-GCM + scrypt round-trip, wrong-password throws), and `CostCalculator` (free-tier gate + the
  102400-byte boundary discrepancy). **18/18 checks passed, fully offline, $0.**
- Verdict: **the dependable path for functional correctness.** Deterministic, offline, no funds. For
  on-chain functional flows, pair with **CHAIN** (`scripts/onchain-uat/*`), which already proves net-zero
  free-tier writes on a throwaway wallet.

### (c) Renderer / component testing — vitest + jsdom + RTL — ✅ FEASIBLE & already in heavy use

- 40+ existing suites in `tests/unit/components/*` prove states/copy/roles deterministically without a
  backend. Best for a11y assertions (role/aria/label), copy strings, and disabled-logic edge cases.
- **Caveat (from CLAUDE.md, confirmed):** the ardrive-core-js/turbo-sdk import chain fails its ecc self-check
  under jsdom — **main-process suites must use `// @vitest-environment node`** (`tests/unit/main/*` do). Keep
  component tests in jsdom, main-process tests in node.
- Verdict: **use for per-component UI/copy/a11y truth** that a live app would make flaky.

### (d) Static UI/UX review — ✅ FEASIBLE, no runtime

- A structured read of components against `DESIGN-SYSTEM.md` (tokens, roles, focus recipes §5A) already
  surfaced the entire §17 hotspot list in UAT-PLAN.md (toast aria-live, non-dialog modals, token-family
  drift, dead code with raw hex, copy mismatches). The DESIGN-2 guardrail grep
  (`grep -RInE '#[0-9a-fA-F]{3,8}|rgb\(' src/renderer --include=*.css --include=*.tsx`, clean except
  theme.css) is a mechanical check the tester can run.
- Verdict: **use for design-system consistency and a11y-structure issues a runtime can't easily catch.**

### Vestigial infra note

The `uat:new-user` / `uat:existing-user` / `uat:dashboard` npm scripts set `UAT_SCENARIO`, but **nothing in
`src/` reads that variable** — they only differ from `npm run uat` by a dead env var. `npm run uat` itself is
just `NODE_ENV=test electron .` (no special test path in `main.ts` beyond dotenv). Treat these as "launch the
app manually" helpers, not an automated harness. The real automation is `scripts/uat/*`, `tests/e2e/smoke.js`,
`scripts/onchain-uat/*`, and vitest.

---

## 3. Setup (once)

```bash
# from the repo root (or this worktree). node_modules is present (symlinked) — do NOT npm install.
npm run build            # produces dist/main + dist/renderer — REQUIRED for SVC/UI/CHAIN
npm run typecheck        # must pass before committing changes
```

Environment (never commit real values; `.env` is gitignored):

```env
# .env  — used by CHAIN scripts and by UI dev-autofill. Reference by ENV only.
ARDRIVE_DEV_WALLET_PATH=/abs/path/to/throwaway-wallet.json   # a FRESH zero-fund wallet for UI autofill
ARDRIVE_DEV_PASSWORD=<throwaway password, min 8>              # only ever in .env, never inline
ARDRIVE_DEV_SYNC_FOLDER=/abs/path/to/ARDRIVE
ARDRIVE_DEV_MODE=true                                         # enables UI autofill (unpackaged only)
# optional: ARDRIVE_GATEWAY_HOST=turbo-gateway.com            # keep reads off arweave.net
```

Money-safety rules the harness enforces (keep them):
- **UI/CHAIN uploads must be <100 KiB** and ride a **zero-fund wallet** (physically can't spend). `smoke.js`
  and `batch2-writes.js` both assert `<100*1024` bytes and a net-zero balance delta.
- The funded wallet (`iKry…`, INFRA-9) is for **read snapshots only** unless Phil authorizes a paid test with
  budget. Never point writes at `arweave.net`.

Disposable-world pattern every run uses: a fresh `os.tmpdir()` dir for `userData` + sync folder + wallet,
removed on exit. Nothing is written inside the repo except opt-in screenshot artifacts.

---

## 4. The commands (and their proven output)

```bash
# (b) service-level functional harness — offline, deterministic, $0
node scripts/uat/run-poc.js services      # wrapper => electron scripts/uat/poc-services.js
```
Proven output (2026-07-04, this machine):
```
A. DatabaseManager — profile isolation, mappings, pending uploads
  [PASS] setActiveProfile opens per-profile DB + runs migrations
  [PASS] drive_mapping.isActive normalized to JS boolean (not 0/1)
  [PASS] MONEY-3: hasSufficientTurboBalance integer 1 -> JS boolean true
  [PASS] MONEY-3: estimatedTurboCost null preserved (no fabricated quote)
  [PASS] profile isolation: second profile has 0 mappings
B. crypto-utils — AES-256-GCM + scrypt round-trip
  [PASS] decrypt with correct password round-trips exactly
  [PASS] decrypt with WRONG password throws (auth tag)
C. CostCalculator — free-tier size gate
  [PASS] 40KiB is free / 200KiB is NOT free
  [PASS] BOUNDARY NOTE: CostCalculator treats exactly 102400 bytes as NOT free (strict <)
Total: 18  Passed: 18  Failed: 0   RESULT: PASS
```

```bash
# (a) UI-automation feasibility — real built app to first-run screen, offline, $0
node scripts/uat/run-poc.js ui            # wrapper => node scripts/uat/poc-ui-launch.js
```
Proven output:
```
  [PASS] disposable userData hook in effect
  [PASS] first-run heading "Welcome to ArDrive Desktop" visible
  [PASS] primary actions Create/Import present (getByRole button)
  [PASS] preload IPC reachable & reports 0 profiles (envelope shape)
  [PASS] screenshot captured (renderer painted under software render) — 132801 bytes
  [PASS] app closed cleanly
Total: 6  Passed: 6  Failed: 0   RESULT: PASS
```

```bash
# (a) FULL end-to-end UI journey — real on-chain free-tier upload (slow; free tier, zero-fund wallet)
npm run smoke                             # tests/e2e/smoke.js — screenshots each step under tests/e2e/artifacts/

# (c) component / renderer + main-process unit suites
npm run test -- --run                     # vitest, all suites
npm run test -- --run tests/unit/components/UploadApprovalQueueModern.test.tsx   # one file

# (b/CHAIN) on-chain free-tier functional round-trips (needs .env; net-zero proof built in)
node scripts/onchain-uat/batch1-reads.js  # reads only (turbo-gateway.com)
node scripts/onchain-uat/batch2-writes.js # fresh zero-fund wallet: drive create/upload/download/revision/hide

# (d) static design-system guardrail
grep -RInE '#[0-9a-fA-F]{3,8}|rgb\(' src/renderer --include=*.css --include=*.tsx   # clean except theme.css
```

Prereqs: `npm run build` before SVC/UI/CHAIN. UI needs a display (WSLg `DISPLAY=:0` here, else `xvfb-run`).

---

## 5. The POC files (what's in `scripts/uat/`)

- **`poc-services.js`** — runs as an Electron main; disposable userData; drives real `dist/main/*`
  (DatabaseManager, crypto-utils, CostCalculator). Offline, $0. The reference pattern for SVC scenarios.
- **`poc-ui-launch.js`** — Playwright-Electron; launches the real built app into a disposable userData with
  no wallet/dev env, asserts the first-run screen, screenshots, quits. Offline, $0. The reference pattern for
  UI scenarios (and the concrete proof UI automation works here).
- **`run-poc.js`** — `node scripts/uat/run-poc.js <services|ui>` convenience wrapper (adds the electron
  binary + flags).

They intentionally sit **outside** the vitest glob (`tests/**/*.test.*`) so `npm run test` never runs them.

---

## 6. Tester-agent protocol (step-by-step)

A downstream "tester" agent executes UAT-PLAN.md like this:

1. **Prepare.** `npm run build`; confirm `dist/main/main.js` + `dist/renderer/index.html` exist. Confirm a
   display (`echo $DISPLAY`) or use `xvfb-run`. Load `.env` (throwaway wallet path/password by ENV only).
   **Never** print wallet JSON / seed / password.
2. **Pick scenarios by harness.** Read each scenario's **Harness** tag and batch by layer:
   - **SVC/RTL/STATIC** first — offline, deterministic, fast, $0. Run these before anything on the network.
   - **UI** next — offline UI checks (states/copy/a11y/screenshots) that stop before a network write.
   - **CHAIN + full UI journey** last — free-tier, zero-fund wallet only; assert net-zero balance.
3. **Drive each scenario:**
   - SVC: extend `poc-services.js` (or add a vitest node suite) — assert the **Expect** condition against
     `dist/main/*`. Use **DB-shaped fixtures** (integer booleans, nulls) per the MONEY-3 trap, never clean JS.
   - UI: launch via the `poc-ui-launch.js` pattern; navigate with `getByRole`; read ground truth with
     `page.evaluate(() => window.electronAPI.<ns>.<fn>())`; **screenshot** each asserted state.
   - RTL: mount the component, assert copy/roles/disabled-logic; assert the a11y **Check** items directly
     (e.g. `getByRole('dialog')` *should fail* for A11Y-2 — record it as the known defect, not a test error).
   - STATIC: read the cited file:line against DESIGN-SYSTEM.md; run the guardrail grep.
4. **Record per scenario:** `PASS` / `FAIL` / `BLOCKED(reason)` / `SKIP(needs funds|human)`, plus for each an
   **issue class** — FUNC / UX / COPY / A11Y — with file:line and a screenshot path where relevant. Match
   findings against §17 hotspots; new findings get a new row.
5. **Never spend.** If a scenario's only remaining step would charge money (TURBO-3/4, paid uploads/rename),
   **STOP at the guard** (assert the window opens / the gate blocks) and mark **SKIP — needs Phil budget**.
   Any hide/delete test must be **restored** before moving on (HIDE-4 unhides what HIDE-2 hid).
6. **Report.** Emit a table: area → scenario → verdict → issue class → evidence (file:line / screenshot).
   Roll up counts and list every FAIL/defect with a one-line repro. Flag anything that needs funds or human
   eyes (see UAT-PLAN §18).

### Guardrails the tester must not violate
- No `npm install` (node_modules is symlinked/managed).
- No writes to `arweave.net`; reads via turbo-gateway.com.
- No file ≥ 100 KiB in any upload path; zero-fund wallet only for CHAIN/UI writes.
- Secret-scan any new artifact before committing (`grep -RiE '"d"\s*:|-----BEGIN|mnemonic|seed phrase'`).
- Screenshots may contain a wallet **address** (public, fine) but never a key — keep dev autofill on a
  throwaway wallet.

---

## 7. Gaps / open decisions for Phil

- **Paid-path coverage** (real Stripe checkout, AR→Credits, >100 KiB uploads, paid rename/manifest): needs a
  **funded test wallet + budget** (BACKLOG INFRA-9). Currently only the free-tier + guard paths are automated.
- **Display-less CI:** works here via WSLg; a headless CI runner needs `xvfb` (not installed offline yet) or a
  container with X. Decision: provision `xvfb` in the CI image, or keep UI runs on a WSLg/desktop box.
- **Human-eyes items:** brand/visual judgement (THEME-1/2), OS keychain prompts (PROF-7), real key material
  (SET-6). These stay manual by design.
