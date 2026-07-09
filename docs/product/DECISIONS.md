# Decision Log

Append-only log of product/engineering decisions. Reference IDs (D-###) in commits and docs. To reverse a decision, add a new entry superseding the old one — don't edit history.

Status: `PROVISIONAL` = adopted by default, awaiting explicit confirmation from Phil · `CONFIRMED` · `SUPERSEDED (by D-###)`.

---

## D-001 · Beta scope: public drives, Turbo-only, single syncing drive · SUPERSEDED (by D-010) · 2026-07-02

Original provisional scope cut. Phil reversed the private-drives exclusion on 2026-07-03 — see D-010.

## D-002 · Backlog lives in docs/product/BACKLOG.md (markdown in repo) · CONFIRMED 2026-07-03 · 2026-07-02

Markdown with stable item IDs is the source of truth; status updates happen in the same PR as the fix. Mirror to GitHub Issues later if/when the team grows (revisit at Track E).

**Why:** versioned with code, diff-reviewable, directly readable/writable by agents without external tooling.

## D-003 · Pacing: quality-first, no hard release date · CONFIRMED 2026-07-03 (amended) · 2026-07-02

Work the roadmap milestones in order; the beta ships when milestone exit criteria pass, not on a calendar date.
**Amendment (Phil, 2026-07-03):** no time estimates in docs or communication — "we will loop non stop until the job is done." Milestones are ordered gates, never dated.

## D-004 · Beta distribution: private testers, unsigned builds · CONFIRMED 2026-07-03 · 2026-07-02

Beta = unsigned builds via `build:testers` + GitHub Releases to a private group. Code signing, notarization, and public distribution are Track D (GA). Auto-update (INFRA-4) is still in beta scope so testers receive fixes. Nothing is released without Phil's final approval.

## D-005 · One IPC response envelope: `{success, data?, error?}` · CONFIRMED 2026-07-03 · 2026-07-02

All ipcMain handlers return the same envelope (extend `safeIpcHandler` everywhere); preload types regenerated; renderer call sites swept (UX-3).

**Why:** the raw-vs-wrapped roulette caused three independent user-facing bugs (private-create "failure" after payment, wrong-password unlock "success", drive-list refresh TypeError).

## D-006 · Vitest is the only test runner · CONFIRMED 2026-07-03 (amended) · 2026-07-02

`jest.config.js` and jest-only deps are deleted; the four orphaned suites migrate into `tests/` (INFRA-2). CI gates on `vitest --run`.
**Amendment (Phil, 2026-07-03):** the test strategy is the full pyramid — unit + integration + UI/E2E ("we need robust tests, unit, integration and UI"). E2E harness tracked as INFRA-12.

## D-007 · Deletes don't propagate in beta — disclose, don't pretend · SUPERSEDED (by D-011) · 2026-07-02

Phil chose real hide-propagation instead — see D-011.

## D-008 · Preload events return unsubscribe functions · CONFIRMED 2026-07-03 · 2026-07-02

Replace `removeAllListeners`-based cleanup with per-subscription unsubscribe closures (UX-4). No component may remove listeners it didn't register.

## D-009 · PM may merge QA-passed branches and push · CONFIRMED · 2026-07-03

Phil: "You can push to wherever you need — as long as you follow our deployment/contribution standards." The PM merges item branches into main only after a QA-gate PASS, pushes main/wip/item branches to origin as needed, and follows CONTRIBUTING.md. Releases, tags, and version bumps remain Phil's — nothing ships without his final approval (reaffirmed 2026-07-03: "we haven't released anything and won't until it gets final approval").

## D-010 · Beta scope v2: public AND private drives, Turbo-only, single syncing drive · CONFIRMED · 2026-07-03

Phil: "public and private, one syncing drive at a time." Private drives are IN the beta — the PRIV-1..7 correctness work moves from post-beta Track A onto the beta critical path (PRIV-0's feature flag is wont-fix). Payments remain Turbo-only for the beta; the AR-payment UI still comes out (MONEY-1). Simultaneous multi-drive sync remains post-beta (Track C), with truthful single-drive UI (UX-15).

## D-011 · Local deletes propagate as ArFS hide · CONFIRMED · 2026-07-03

Phil: "use hide, yes… let's ensure this works smoothly for users (as smooth as Dropbox)." Deleting a file locally hides it on ArFS (permanent storage cannot truly delete). SYNC-5 becomes an implementation item (promoted P0): hide propagation for files and folders, Dropbox-smooth, with honest permanence messaging ("hidden, not erased") in the UI. Requires private-drive hide paths too (ardrive-core-js may need upstream work — allowed per D-016).

## D-012 · Gateway strategy: Wayfinder routing, turbo-gateway.com primary · CONFIRMED · 2026-07-03

Phil: "use turbo-gateway.com with wayfinder and simple routing to top staked gateways." Replace the hardcoded `arweave.net` with Wayfinder-based gateway selection routing across top-staked ar.io gateways, `turbo-gateway.com` as the primary. Tracked as SYNC-15; the vendored Wayfinder docs and docs/features/wayfinder-integration-proposal.md are the references. Beta minimum: no single-gateway hard dependency.

## D-013 · Wallet direction: no Ethereum; Solana-default with Turbo; "Advanced mode" Arweave self-bundling · CONFIRMED · 2026-07-03

Phil: "forget eth support — we should default to solana wallets w/ turbo. there could be an 'Advanced mode' where the user gets an arweave wallet w/ AR tokens and uploads their own bundle to arweave (kind of like a simple lite bundler!)"
- Ethereum stub deleted (part of INFRA-10).
- Post-beta Track B is rewritten: FEAT-1 = Solana-default wallet onboarding with Turbo payments; FEAT-2 = Advanced mode (Arweave wallet + AR tokens + self-bundled uploads, a "lite bundler").
- OPEN TECHNICAL QUESTION (flagged in ROADMAP): ArFS private-drive keys currently derive from an Arweave JWK signature — Solana-default accounts need a key-derivation answer (likely upstream ardrive-core-js work per D-016) before private drives work for Solana users.

## D-014 · Upload cap 2 GiB; downloads must handle larger · CONFIRMED · 2026-07-03

Phil: "2 GiB limit upload right now. download should be higher, in case they uploaded a bigger one via web." SYNC-6 implements: single 2 GiB upload constant, visibly enforced (no silent skips); download path has no such cap and must stream arbitrarily large files. HARD PREREQUISITE: SYNC-10 (streaming hashing / no whole-file buffering) — the current code reads entire files into memory up to 3× per event, which is fatal at 2 GiB. SYNC-10 is promoted onto the critical path ahead of the cap change.

## D-015 · Profile identity: generated avatar + nickname; ArNS deprioritized · CONFIRMED · 2026-07-03

Phil: "don't care about arns primary names or avatars right now — we could just generate an avatar (see our avatar gen code in ardrive-web sibling repo) and let them enter a nickname." New item UX-17: port the avatar-generation approach from ardrive-web, add an editable profile nickname; ArNS primary-name/avatar fetching is deprioritized (existing code left dormant, not extended).

## D-016 · Multi-repo strategy: siblings with shared patterns; upstream repos are modifiable · CONFIRMED · 2026-07-03

Phil: no monorepo — ardrive-web, ardrive-core-js, turbo-sdk, and ar-io-sdk are sibling repos following similar patterns/features, and "we can do whatever we need there." Consequence: findings previously treated as blocked-by-dependency (Turbo hardwiring in the ardrive-core factory, EntityKey serialization ergonomics, private download decryption APIs, Solana key derivation) can be fixed upstream. When an item needs upstream work, the backlog item names the target repo; cross-repo interop (desktop ↔ web ArFS round-trips) gets shared test vectors at Track E.

## D-017 · Beta program: small Discord-run tester group; sanitized in-app log reporting · CONFIRMED · 2026-07-03

Phil: "a handful of people — yes I'll give it over discord. sanitized logs would be dope." Feedback flows through Phil on Discord. New item UX-16: in-app "report a problem" that bundles sanitized logs (depends on SEC-8 secure-logger adoption so bundles can never contain secrets).

## D-018 · ardrive-core-js heavy-update track: incremental sync, snapshots, owner-scoped GQL · CONFIRMED · 2026-07-03

Phil: "ardrive-core-js will need heavy updates, like incremental sync, snapshot support, and even updating some of the queries to account for migration to turbo-gateway — for example most ArFS queries need to supply an owner or else GQL fails."

Three upstream work items (CORE-1..3 in BACKLOG, Track C):
- **CORE-1 owner-scoped GQL** — turbo-gateway's GQL requires an `owner` filter on most ArFS queries; core-js must thread owner through every query. This is a **hard dependency of SYNC-15** (D-012 gateway migration): raw data fetches can move to turbo-gateway early, metadata/GQL paths cannot until CORE-1 lands. Design sub-question: owner-unknown discovery flows (add-existing-drive by ID).
- **CORE-2 incremental sync** — since/cursor listing APIs; feeds desktop SYNC-8 polling and metadata-cache refresh.
- **CORE-3 snapshot support** — consume ArFS snapshots (as ardrive-web does) for cold-start listing; read-side first.

Sequencing implication: CORE work happens in the sibling repo under the same loop (D-016), consumed by desktop via version bumps gated on interop vectors.

## D-019 · CORE track clarifications: web GQL as reference; snapshot create/view parity; resume existing incremental-sync branch · CONFIRMED · 2026-07-03

Phil's clarifications on D-018:
- **CORE-1**: "compare against our GraphQL in ardrive-web" — the web app's queries are the owner-scoped reference implementation, including its pattern for owner-unknown discovery. Answers ROADMAP open question 5.
- **CORE-3/FEAT-3**: "eventually the desktop should give the user the ability to create/view snapshots, just like the web app" — snapshot writing is in scope (CORE-3 API), with a desktop create/view UI (new item FEAT-3; creation is paid → routed through the upload approval queue). Answers ROADMAP open question 6.
- **CORE-2**: "we actually started an incremental sync branch in ardrive-core-js" — first task is locating/assessing that branch rather than greenfielding.

## D-020 · Solana support derives an Arweave wallet from the Solana wallet (ardrive-web pattern) · CONFIRMED · 2026-07-03

Phil: "For Solana support we should do what we do for the ardrive app — derive an Arweave wallet from the Solana wallet. Then we have best of both worlds. Like ArNS requires a Solana wallet." (Final clause recorded verbatim.)

Resolves the FEAT-1 design blocker (ROADMAP open question 2): the Solana wallet is the user-facing identity/payment rail (Turbo), and a deterministic Arweave JWK derived from it powers everything ArFS — drive-key derivation, signing, interop — unchanged. Reference implementation: ardrive-web's existing Solana→Arweave derivation (mirror it exactly for cross-app wallet compatibility — the same Solana wallet must yield the same Arweave wallet in both apps). Upstream home for the derivation if shared: ardrive-core-js (D-016).

## D-021 · M1 smoke UAT is automated-headed with screenshot evidence · CONFIRMED · 2026-07-03

Phil can't get in front of a real display. The remaining Milestone-1 caveat is re-scoped: instead of a human manual smoke UAT, INFRA-12 is pulled forward to deliver (tier 1) a Playwright-Electron smoke suite driving the real built app headed under WSLg locally — wallet import via dev-mode, drive creation, free-tier (<100KB, zero-fund wallet) upload through the real approval queue — with step screenshots delivered to Phil for review; then (tier 2) the same suite on windows-latest CI against the packaged build (real Windows, real keytar/Credential Manager, silent NSIS install smoke), screenshots as artifacts. Honest residual (deferred to first tester, disclosed): human look-and-feel, interactive-installer UX, OS-native dialogs.

## D-022 · Build ArFS hide upstream in ardrive-core-js before SYNC-5 · CONFIRMED · 2026-07-03

Phil: SYNC-5 (delete→hide) can't ship because no ArFS hide API exists in ardrive-core-js. Decision: build hide/unhide in core-js FIRST (D-016 permits sibling-repo work), mirroring ardrive-web's mechanism exactly, then SYNC-5 consumes it via a dependency bump. Tracked as CORE-4; full spec in docs/product/CORE-4-hide-scoping.md. Mechanism (from ardrive-web): a plain metadata revision adding `isHidden: boolean` to entity JSON — no tag, no ArFS spec bump, no child cascade, `lastModifiedDate` untouched, filtering left to the consumer. Base branch: **`master`** (Phil confirmed 2026-07-03 after the scoping finding that `dev` is ~11 months dormant / real default is master). Feature branch off origin/master.

## D-023 · Design work stream: source of truth = ardrive_ui + public site; token-driven; runs parallel through the loop · CONFIRMED · 2026-07-03

Phil: "spin up a designer agent … a beautifully styled app that is familiar, sleek and modern … follow our style guidelines/themes in ardrive web app and the public site."
- **Source of truth**: ardrive-web `packages/ardrive_ui` + `lib/theme/{colors,theme}.dart` (canonical ArDrive design system) and the public site https://ardriveapp.github.io/public-site/ (modern/sleek finish). Bridged into desktop via docs/product/DESIGN-SYSTEM.md (DESIGN-1).
- **Token-driven, light+dark mandatory**; no hardcoded colors in components.
- **New `designer` agent** (.claude/agents/designer.md, default Sonnet, Opus for foundational DESIGN-1) — a specialized implementer for styling; changes visuals, not behavior.
- **Workflow**: design flows through the standard loop — designer implements → qa-gate verifies correctness + no-regression + token-purity + WCAG-AA contrast + light/dark → **Phil signs off aesthetics from screenshots** (the INFRA-12 Playwright harness doubles as the design-review evidence tool). Mechanical checks are QA's; "is it beautiful" is Phil's.
- **Parallelism**: runs concurrently with functional Phase-2 work. Lane rule: a DESIGN item and a functional item touching the SAME component serialize (styling/markup vs logic usually separable, but not always).
- **Beta bar**: DESIGN-1/2 (foundation) targeted for beta; per-surface polish (DESIGN-3+) rolls through beta → GA.

## D-024 · Design system signed off; system fallback font stack (no Wavehaus bundling) · CONFIRMED · 2026-07-03

Phil reviewed DESIGN-1 (docs/product/DESIGN-SYSTEM.md) and made the 5 aesthetic calls:
1. Replace the current off-brand palette (accidental Tailwind + Apple fonts) wholesale — YES.
2. Two brand reds kept: `--brand #D31721` (buttons/CTA) + `--accent #FE0230` (logo / accent top-bar) — matches the public site.
3. Light-mode brand hover **darkens** (`--brand-hover #B8141C`), deviating from ardrive_ui's literal lighten.
4. Dark theme uses the lighter, public-site-aligned ladder (`--surface #121212`, cards `#1E1E1E`), not near-black.
5. **Font: system fallback stack — Wavehaus NOT bundled** (proprietary; not clearing desktop licensing). Optional future: a free OFL geometric sans (Manrope/Inter) as a drop-in brand upgrade.
DESIGN-2 implements the CSS-variable token layer + ThemeProvider from this doc.

## D-025 · DESIGN-8 UI/UX sweep: trust bugs removed; free-tier copy standardized on the code-enforced 100 KiB · CONFIRMED · 2026-07-04

Phil green-lit a full top-to-bottom UI/UX sweep ("Begin. I don't have any nitpicks — it's all you.") after reviewing the consolidated punch-list (docs/product/DESIGN-8-uiux-sweep.md, 78 items). Executed as **six file-disjoint lanes** (foundation first to fix shared button/radius/cascade, then five surface lanes onto the clean base) — each QA-gated and merged behind its own gate; final `main` @ 75d19db, 483 tests green.
- **Trust/honesty is a release bar, not polish.** Three surfaces were showing dishonest UI and are fixed: fabricated Turbo usage stats (wired to real `files.getUploads()` data, or the tile removed where no real source exists — never invented numbers); a false "Enterprise Ready" marketing claim (removed — those features don't exist in this MVP); the wallet balance mislabeled "AR" when it's Turbo Credits (relabeled). The seed phrase was only visually dimmed (`opacity:0.1`) while "hidden" — real plaintext stayed in the DOM/a11y tree — now genuinely masked.
- **Free-tier copy standardized on 100 KiB** (100×1024 = 102400 bytes), the value the code actually enforces (`turbo-utils.ts`). Phil has referred to **105 KiB**. Copy deliberately uses the *smaller* number so the UI never over-promises "free." **Open action:** if Turbo's real subsidy threshold is 105 KiB, bump the enforced constant so users get the full free tier (a MONEY follow-up); if it's 100 KiB, the copy is already correct. Not blocking.
- **Modal a11y baseline set**: a shared `useModalA11y` hook (Escape / backdrop-close / focus-trap / return-focus) is now the standard for dialogs.
- **Residual design-system debt** (legacy token names, status-pill architecture, onboarding type-scale, shared PasswordInput polish) is explicitly deferred to **DESIGN-9**, not silently dropped.

## D-026 · Beta must match-or-beat ardrive-web on sync performance & UX; snapshot-consumption + incremental sync + gateway resiliency are BETA-BLOCKING · CONFIRMED · 2026-07-05

Phil (direct): *"Beta has to ship with all these improvements. We can't ship shitty software that takes forever to sync and has a bad UX. The syncing/UX must not be worse than the web app. It must be better."*
- **Quality bar (hard gate):** the desktop app's sync **performance** and **UX** must be **≥ ardrive-web**. ardrive-web is the reference *floor*, not just a pattern source. Shipping full-history-replay sync (see below) would be worse than the client users already have — a regression, not a beta.
- **Root problem this addresses:** core-js 4.0.0 has **zero snapshot support**, so the desktop reconstructs every drive by **full GraphQL history replay** = always-full-sync = slow + 404-fragile on large drives (measured live 2026-07-05: a snapshotted drive timed out at 150s in a transient-404 storm; the same tx returned 200 on retry/curl — the data was fine, the *approach* is the problem).
- **Scope change (supersedes prior deferral):** **CORE-3 snapshot CONSUMPTION** (read — the thing that ends always-full-sync) and **CORE-2 incremental sync** move from `deferred`/post-beta to **beta-blocking**. Gateway resiliency (graceful-404 + fallback, e.g. perma.online) is beta-blocking (desktop-side SYNC-22/SYNC-23 + any core-js piece). This **supersedes** the "core-js loop runs off the beta critical path" framing and the Track-C deferral of CORE-2/CORE-3 for beta purposes.
- **Still tractable, not greenfield:** web has already solved all of these — this is *porting proven patterns*. Head start: two core-js incremental branches exist (`feat/incremental-drive-sync` +7, `PE-8386-incremental-drive-sync` +10 vs master); web implements snapshots (reference).
- **Open scoping (resolved in CORE-JS-PLAN.md):** snapshot *consumption* is clearly beta-blocking; snapshot *creation* (write) may remain a fast-follow — the plan decides per-item, with a **measurable "≥ web" acceptance gate** (e.g. cold-load time of a large drive within parity of web; re-sync fetches deltas only, not full replay). Per-item beta/fast-follow calls are Phil's, informed by the plan's effort estimates.
- **Structure:** the core-js program runs as a **beta-critical parallel loop** (its own three-role cadence in the core-js repo, verified via CLI harness + interop vectors), coordinated here and sequenced by the plan. Beta timeline expands accordingly — accepted as the cost of not shipping a regression.

## D-027 · Interop-vector gate for core-js listing changes; refined to superset-with-verified-gateway-drops · CONFIRMED · 2026-07-05

Concretizes the "interop check" the CORE track promised (D-016/D-018). Any core-js change touching the drive-**listing** path (CORE-3b snapshot wiring first; also CORE-1 owner-scoped queries, CORE-2 incremental) is the highest-stakes core-js work — a wrong listing means drives list wrong — so it cannot merge on typecheck/unit tests alone. It must pass an **interop vector**: on a real drive, the new listing is compared against a **golden full-replay baseline** captured (deterministically, 3× identical) BEFORE the change, via ArDrive-CLI wired to the core-js build under test, read-only against `turbo-gateway.com`. Artifacts + runnable recipe: `docs/product/interop-harness/` (primary vector drive `1f373b21…`, 39 entities, + fallbacks; `req-count.js` measures GraphQL request count; canonicalization normalizes ORDER only — the listing is pure on-chain ArFS metadata).
- **PASS criterion — REFINED 2026-07-05 by the CORE-3b phase-2 result (NOT strict byte-identical):** strict `snapshot-listing == golden` is wrong, because full-replay is only as complete as the gateway's **mutable** GraphQL index, which drops entities over time. The correct gate is: **new listing ⊇ golden (a SUPERSET — zero removals) AND fewer GraphQL requests**, where every *addition* is a verified **real on-chain entity the gateway index has dropped** (confirm: `transactions(ids:[tx])` → 0 edges, but `GET /<tx>` → 200 with valid ArFS metadata). Proven live: drive `1f373b21`'s snapshot listing added file `aa10f0cd` ("Tropical_FishTank.jpg", metadata tx `G4MlAlM…`) that turbo-gateway GQL returns 0 edges for but serves 200/168B by-id — snapshots RESTORE gateway-dropped history. This makes snapshot consumption a **data-integrity fix, not just performance**: full-replay silently loses files the gateway forgot.
- **In the loop:** part of Definition of Done for any listing-path core-js change, and a precondition for the desktop dep bump that consumes it. A clean byte-identical PASS is still expected where the gateway index is complete (proven on drive `a84b951b`: byte-identical + 6-vs-7 requests). The zero-regression full-replay fallback must stay byte-identical (proven).
- **Provenance rule:** confirm the CLI resolves the intended core-js build (symlink realpath + a build-only exported symbol), not npm's pin — the CORE-3a/3b builds self-report `4.0.0`, same as the npm version, so the version string alone can't distinguish.

## D-028 · "Proof / anchor" mode (metadata-only) is a captured POST-BETA idea, not beta scope · PROVISIONAL · 2026-07-05

Phil proposed a metadata-only "anchor" mode: write the ArFS file metadata (content hash + name/size/time) with NO data transaction — a free/near-free timestamped *proof a file existed*, not a stored copy (bytes stay local). Assessment: genuinely good — high feasibility (ArFS already separates metadata from data, so it's a data-tx-less variant, not a fork), and it opens a free proof-of-existence + privacy (hash-only public) + free-tier funnel play. Decision: **capture now (FEAT-4), build post-beta.** It does NOT touch the beta — all beta P0s are done and D-026 (≥web sync) is shipping; introducing a new mode now would dilute focus and risk the brand. The dominant risk is **messaging**: an anchor must never be mistaken for a backup (proof ≠ preservation) — that governs the eventual design. Open questions (terminology collision with Arweave's anti-replay "anchor"; sync semantics for data-less files; verification UX) are logged on FEAT-4 for a post-beta spec. **Update 2026-07-05:** Phil pointed to `ar-io/ar-io-anchor` — ar.io's official SDK that does exactly this (hash-only, no data upload, on-chain proof-of-existence via Turbo, plus a Merkle `batch()` that anchors many files under one checkpoint ≈ free, verified by `@ar.io/proof`). This confirms feasibility and gives a foundation to lean on; it also sharpens the key decision — ar-io-anchor uses ar.io's event envelope, NOT ArFS, so we must choose envelope-native (interoperable + free batching, not a drive file) vs ArFS-wrapper (shows in the drive) vs hybrid (details on FEAT-4). Supersede with a firm decision when the feature is scheduled.

## D-029 · Auto-classification / smart tagging is a captured POST-BETA idea; on-device + local-first is the differentiator · PROVISIONAL · 2026-07-05

Phil proposed auto-classifying/tagging synced files (iCloud/OneDrive-style smart tagging — image content, OCR, document type). Assessment: strong "v2 delight" feature that elevates ArDrive from permanent-Dropbox to smart-permanent-Dropbox. Decision: **capture (FEAT-5), build post-beta** — it's a whole feature track (ML pipeline, model bundling, tag schema, search UI), larger than FEAT-4, and out of beta scope. Two positions set now: (1) **on-device / local-first classification** is the intended approach and the real differentiator — iCloud/OneDrive process in the cloud; "smart tagging that never sends your data anywhere" is uniquely on-brand for a privacy+ownership product; (2) **tags are local-mutable by default with opt-in on-chain publishing** — Arweave immutability makes on-chain auto-tags a permanent commitment and mis-tags unfixable, and on-chain tags expose file classification publicly, so confirmed/opt-in only. A cheap near-term subset (non-ML type grouping by mime/extension) may be pulled forward as beta-polish. Supersede when scheduled.

## D-030 · Multi-token top-up ships via a deep-link to ar.io Console, not in-app wallet integration · CONFIRMED · 2026-07-08

To let users pay for Turbo Credits with SOL/ETH/USDC/AR, the desktop deep-links to `console.ar.io/topup?destinationAddress=<walletAddr>&source=ardrive-desktop` rather than building browser-wallet integration into Electron. Rationale: the desktop has no web-wallet integration, so in-app crypto payment would force pasting a private key (unacceptable for self-custody); the Console already has multi-wallet connect + a settable credit destination, and Turbo credits any address. Two structural wins: (1) no private keys ever touch the desktop, and (2) the ArDrive identity wallet stays Arweave — SOL/ETH is only the payment rail — so private drives keep working and it SIDESTEPS the FEAT-1 non-Arweave-key-derivation blocker. Delivered FEAT-8: desktop merged (button + bounded balance poll); console PR ar-io/ar-io-console#14 (additive deep-link seeding, qa-gated, build/test/preview verified). Not beta-blocking (beta stays fiat+AR per D-010); a near-term launch feature.

## D-031 · Beta ships with always-prompt login (no auto-login) — UX-6 · PROVISIONAL · 2026-07-08

For a self-custody wallet, the beta keeps its current behavior: the app prompts for the password on launch (returning users hit the Welcome-Back screen). SEC-4 built the opt-in "remember me on this device" keychain infrastructure, so wiring auto-unlock-on-launch (UX-6) is possible — but auto-login means the app opens the wallet with no password on an unlocked machine, weakening the security posture that a crypto/permanence product should hold. Recommendation: **do NOT wire auto-login for beta**; make it a post-beta opt-in if desired. UX-6 is therefore a DECISION, not a build task. Pending Phil's confirmation at Gate 6; supersede if he wants auto-login pulled in.

## D-032 · Growth strategy: crypto-native beachhead + anchor-mode-as-free-funnel · PROVISIONAL · 2026-07-09

Adopts the beachhead + growth thesis from the Fable strategy memo ([GROWTH-STRATEGY-2026-07-09.md](./GROWTH-STRATEGY-2026-07-09.md)) as **Track F** on the roadmap. **Beachhead:** crypto-native + existing high-volume ArDrive/Arweave users (mainstream explicitly out of scope for now). **Positioning wedge:** "the folder that cannot lie" + the D-027 gateway-drop-recovery story (the desktop restores files the gateway index dropped — verified live this session). **Take-off motion:** folder → named permaweb site (manifest + ArNS). **Growth engine:** FEAT-4 anchor/proof mode shipped as a FREE funnel ("notarize everything free" → onboarded/daemon → upsell to preserve). **Top volume unlock:** budget-based consent (MONEY-16) + the big-file track (SYNC-10 → 2 GiB → resumable). **Zero-support is a hard design goal:** the honesty regime is the support strategy; auto-update (INFRA-4) is the mechanism by which support cost decays to zero; refuse features whose failure needs a human to adjudicate money. **Beta success metrics (answers ROADMAP open-Q1):** GB/wallet/week via desktop; desktop-share of a wallet's upload volume; 7-day top-up conversion after first cap-hit; %sessions with daemon alive >24h; support-touches/WAU (target <0.02) — instrument INFRA-5 against these. Provisional; individual items (GROWTH-1..8, MONEY-16) carry their own scope. Supersede/refine as Track F is scheduled and the anchor deep-dive lands.
## D-033 · Arweave onboarding is 12-word-only — UX-34 · CONFIRMED · 2026-07-09

Supersedes the DESIGN-8/TRUST-3 "12 or 24 words" aspiration. `ardrive-core-js`'s `SeedPhrase` derives an Arweave wallet from a **12-word** BIP-39 phrase only (regex `{12}`); `wallet-manager-secure.ts` enforces the same 12-word count before ever constructing a `SeedPhrase`. A 24-word phrase (e.g. a Ledger export) can never produce an Arweave wallet — it always failed closed at derivation with "...exactly 12 words," even though the onboarding copy and the client/main `InputValidator.validateSeedPhrase` said "12 or 24 words" and accepted a 24-word phrase as pre-submission-valid. That mismatch is a guaranteed confusing support thread: a user is invited to enter a 24-word phrase, told it validated, then told at import time that it's wrong. Fix: onboarding copy (`WalletSetup.tsx` InfoButton tooltips, placeholder, word-count hint) and both `validateSeedPhrase` implementations (renderer + main `input-validator.ts`) now say and enforce **12 words only** — the UI never invites input it will then reject. Multi-word / multi-chain recovery (Ledger 24-word, Solana/ETH-derived wallets) remains **FEAT-1**, post-beta.

