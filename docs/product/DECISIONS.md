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

