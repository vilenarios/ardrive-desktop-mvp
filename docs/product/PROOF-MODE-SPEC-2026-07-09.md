# Proof Mode: "Notarize Everything, Free" — Product Spec + Go-to-Market

**FEAT-4 deep-dive · refines D-028 (supersede when scheduled) · 2026-07-09**

Fable deep-dive commissioned off [GROWTH-STRATEGY-2026-07-09.md](./GROWTH-STRATEGY-2026-07-09.md) §7 ("anchor-mode-as-free-funnel"). Grounded in: FEAT-4 + the `ar-io/ar-io-anchor` research note (BACKLOG), FEAT-8/D-030 (shipped desktop-side: `console.ar.io/topup?destinationAddress=<addr>&source=ardrive-desktop` + bounded balance poll), D-028's messaging-risk framing, MONEY-14 (free tier = 107520 bytes / 105 KiB, single-source `TURBO_FREE_SIZE_LIMIT` in `src/utils/turbo-utils.ts`), SYNC-6/SYNC-10 (cap is 100 MiB today; 2 GiB gated on streaming hash), the existing hash infrastructure (`processed_files` keyed by fileHash, `FileHashVerifier`, `file_versions` carrying tx ids per SYNC-28), manifest deploy + UX-33, and the beta state per BETA-EXIT-CHECKLIST.

**One-line thesis:** the proof primitive is free and already built by ar.io; the funnel's payment rail is already shipped on the desktop side; the free tier that powers both the $0 anchor and the secret free-preservation rung is already enforced to the byte. What we're actually building is **a UX for the difference between proof and preservation** — and per D-028, that difference *is* the product risk.

---

## 0. Naming decision (make it first — it shapes every screen)

**User-facing verb: "Notarize." Noun: "Proof." Feature: "Proof Mode." The word "anchor" never appears in the UI.** Keep `anchor` in code/internals where it matches the ar-io-anchor SDK.

Rationale (all from FEAT-4's open questions): (a) "anchor" collides with Arweave's anti-replay transaction field; (b) "anchor" *sounds like it holds something* — the proof≠preservation confusion compressed into one word; (c) "notarize" imports the right mental model — a notary stamps a document and **does not keep a copy**; nobody believes a notary backed up their contract.

**The two-word state ladder, used everywhere, no synonyms permitted:**
- **Proven** — the file's fingerprint is on Arweave. The file is not.
- **Preserved** — the file's bytes are on Arweave, forever.

**Banned words for proofs, enforced by pinned copy tests** (the DESIGN-8/UX-34 pattern — this codebase already pins copy in tests): *backed up, stored, saved, protected, secured, safe, archived, uploaded.*

---

## 1. The core loop, precisely — install → notarize → confront → preserve

1. **Acquisition promise.** Landing headline: *"Notarize your whole disk. Free. — Get a permanent, timestamped, publicly verifiable proof that every file on your machine existed today. Nothing is uploaded."* Immediately below, in **equal visual weight** (the honesty gate, not fine print): *"Proof is free forever. Preservation — actually storing the bytes on Arweave — is what we sell."* This audience respects a product that names its business model in sentence two.
2. **Onboarding fork** (`OnboardingModeChoice`): "Notarize my files (free)" → proof path · "Preserve my files on Arweave" → existing sync onboarding. Both converge on the same `wallet:create-new` with the **mandatory backup gate** (LAUNCH-READINESS B.1). Do not soften the seed ceremony for the free path; reframe it: *"This wallet is your notary identity."* **Structural funnel win: every free user exits onboarding wallet-holding and daemon-installed** — the two expensive steps of crypto onboarding, paid for by a free feature.
3. **Scope picker** (`NotarizeWizard`): folder multi-select with presets (Documents / Pictures / Desktop / Everything in home), default-on exclusions (caches, `node_modules`, browser profiles, temp — the `drive_mappings` exclude-pattern machinery already models this), live counter ("≈ 4,183 files · 12.4 GB will be fingerprinted on this device").
4. **The one-time comprehension gate** (`ProofComprehensionGate`, required once per profile — checkbox-gated Continue, the wallet-backup-gate pattern reused): ✓ SHA-256 fingerprint on this device · ✓ one permanent timestamped checkpoint on Arweave · ✗ does NOT upload your files · ✗ does NOT back them up · ☐ *"I understand: my files stay only on this device until I choose to preserve them."* This is D-028's "dominant risk is messaging" answered with a **hard gate, not a tooltip**.
5. **The run.** Streaming-hash pass, then one `batch()` call: ar-io-anchor Merkle-batches all events into **one** signed ANS-104 envelope (`ario.events/v1`) via Turbo — tiny, under the 107520-byte free line → whole-disk proof costs **$0**, one txId. Per-file inclusion proofs persisted locally (new `proofs` + `proof_runs` SQLite tables; migrations exist per INFRA-7).
6. **The receipt** (`ProofRunSummary`) — the pivot screen: file/GB count · `Checkpoint: ar://… · signed by your wallet` · [Verify now] [Share proof] [Export proof file] · then **"Proven: 4,183 files. Preserved: 0 files."** + *"If this disk dies, the proofs survive — the files don't."* + **[See what preserving them costs →]**. The honest sentence *is* the upsell; no dark pattern.
7. **The preserve ladder** (§4) — free-tier preservation first, paid second, FEAT-8 funding inline.
8. **Retention.** "Keep my proofs current" toggle: the chokidar watcher accumulates changes and re-anchors as **one batched checkpoint per day** (cadence-capped) — still $0, one tx/day. A daily, free, permanent record of your disk's existence, produced by an app that's now always running; every day it re-presents the Proven-vs-Preserved gap.

---

## 2. Proof ≠ Preservation UX — the make-or-break (D-028)

**Design principle: proof and preservation must differ on every perceptual channel at once — shape, fill, color, word, location, and arithmetic.** A user should be unable to construct the false belief even carelessly.

### 2.1 Badge system

| | **Proven** | **Preserved** |
|---|---|---|
| Icon | Notary-seal / fingerprint, **outline, hollow** | Arweave block, **solid fill** |
| Color | Slate/violet (procedural, cool) | Permanent green (existing success semantics) |
| Shape | Circle | Square/shield |
| Label | "Proven" | "Preserved" |
| Tooltip | "Fingerprint on Arweave since {date}. File exists only on this device." | "Bytes on Arweave since {date}. Recoverable from any device, forever." |

Hollow-vs-solid is the load-bearing metaphor: *the proof is an outline of the file; preservation is the file.* Never color alone (a11y baseline per DESIGN-8). A file that is both shows both badges; badges never merge into a "synced" glyph.

### 2.2 Arithmetic that cannot lie

Dashboard tiles keep the two numbers permanently separate and adjacent: **`Preserved: 0 B on Arweave · Proven: 12.4 GB fingerprinted (0 B stored)`**. Rules: proofs contribute 0 to every storage total; the "(0 B stored)" suffix is not removable; no aggregate "protected files" counter may ever exist. Invariant sentence — *"A proof shows a file existed. It does not store it."* — appears verbatim on the Proofs tab header, run summary, every proof detail view, and share pages.

### 2.3 Three verification states (streaming re-hash → `@ar.io/proof` inclusion check — offline-capable)

- **Verified** — "Matches the fingerprint proven on {date}."
- **Modified since proof** (amber) — "This file changed since it was proven. The old proof still proves the old version existed. [Notarize current version] [Preserve it]"
- **Missing locally** (red — the most important state) — *"proof.psd was proven on June 3 but no longer exists on this device. Its existence can still be proven — its contents cannot be recovered. Preserved files can always be recovered."*

That red state is where a lazy design gets sued in the court of Discord ("ArDrive lost my files") and an honest one converts. Surface a periodic scan digest via UX-29: *"3 files you proved in June are now missing from this device. Proofs survive; files don't."*

### 2.4 Structural separation

Proofs live in a dedicated **Proofs tab**, not interleaved in drive file lists (which imply storage). The Permaweb view (what's *on* Arweave) never lists proof-only files. Empty state, pre-first-run: *"Nothing proven yet. Notarizing is free and private — your files never leave this device. (Notarizing is not a backup.)"*

### 2.5 External copy discipline

Every marketing artifact pairs hook with disclosure: *"Notarize everything, free. Storage sold separately — honestly."* On-brand for the D-025 honesty regime — honesty *is* the support strategy, and here also the upsell.

---

## 3. Integration decision, resolved: **hybrid — envelope primitive + per-RUN ArFS Proof Log**

Resolves FEAT-4's trilemma (envelope-native / ArFS-wrapper / hybrid) with one correction to the naive hybrid.

### 3.1 Proof primitive: ar-io-anchor envelope, unmodified

Use `createAnchorer()` / `batch()` as shipped: N per-file events (SHA-256 computed locally; `ref`; timestamp) Merkle-batched under **one** on-chain checkpoint (`ario.events/v1` signed ANS-104 via Turbo), per-event inclusion proofs generated locally, verification via the read-only `@ar.io/proof` package. Buys: ~free whole-disk anchoring (one tx), offline third-party verification, interop with ar.io's official stack — we become the biggest write-path client of *their* standard (co-marketing, §5). Deps minimal (`@ar.io/proof`, `@noble/hashes`, `@noble/ed25519`).

**Privacy default:** the on-chain event `ref` is the hash (or an opaque id) — **no filenames on-chain by default**. Filenames-in-proof is opt-in with an explicit "file names become permanently public" warning. Preserves FEAT-4's headline privacy property.

### 3.2 The correction: per-RUN ArFS entity, not per-FILE

The naive per-file data-less ArFS wrapper must **not** ship: (a) it forfeits `batch()` economics — 4,000 metadata txs instead of 1; (b) worse, **existing clients render data-less ArFS files as normal files whose download is broken** — ardrive-web becomes an unwitting proof≠preservation violation we don't control.

Instead the ArFS presence is **one real file per anchor run — a Proof Log:**
- **What:** a genuine ArFS file (metadata + data tx — fully interoperable, downloads fine in ardrive-web / any gateway) in an auto-created public **"Proofs" drive** (or one the user chooses).
- **Data:** gzipped proof bundle — `{checkpointTxId, merkleRoot, createdAt, entries:[{ref, sha256, size, mtime, inclusionProof, name?}]}`.
- **Tags** (GraphQL-queryable): `ArDrive-Proof-Checkpoint: <txId>`, `ArDrive-Proof-Root: <root>`, `ArDrive-Proof-Count: <n>`, `App-Name: ArDrive-Desktop`.
- **Economics:** a few-hundred-file bundle compresses under 105 KiB → **the Proof Log itself is free** for small runs; a 4,000-file bundle (~1–3 MB) costs pennies → **"Publish this proof permanently — $0.0x" is the user's first, nearly-riskless paid transaction.** A deliberately tiny first conversion.
- **Custody:** proofs are always local-first (SQLite + one-click **Export proof file** → portable `*.ardrive-proof.json`). Publishing makes them recoverable-from-chain: on reinstall, a GQL query by owner + `ArDrive-Proof-*` tags restores full history. Nudge: *"Your proofs live on this device. Export them or publish them so they outlive it."*

### 3.3 What's on-chain / in-app / how verification runs

- **On-chain, always (free):** one checkpoint envelope per run (Merkle root + run metadata, signed).
- **On-chain, optional:** the Proof Log ArFS file (free small / pennies large).
- **In-app:** `proof_runs` + `proofs` tables; Proofs tab; badges; verify flows. New IPC namespace `proof:*` returning the D-005 envelope (`proof:run`, `proof:verify-file`, `proof:verify-run`, `proof:export`, `proof:publish-log`, `proof:list-runs`).
- **Verification:** in-app = streaming re-hash → inclusion proof → on-chain root; third-party = anyone with the checkpoint txId + a proof entry runs `@ar.io/proof`, **no ArDrive software required** — that independence is the feature's credibility.
- **Interop:** ardrive-web sees the Proofs drive as a normal drive of small files — zero breakage. **Later, upstream:** propose a first-class ArFS proof-entity subtype (per-file proofs render natively in all clients) via the D-022/CORE-4 upstream lane. Phase C material, not MVP.

### 3.4 One research spike before build (flagged, not assumed)

Confirm the ar-io-anchor **signer** story against our Arweave JWK: `@noble/ed25519` suggests envelope signing may be ed25519. If envelopes can't be signed by the RSA JWK directly via Turbo's signer support, derive a dedicated ed25519 event key from the wallet deterministically and document the provenance chain. Half-day spike; shapes the "signed by your wallet" copy.

---

## 4. Upsell mechanics: proven → preserved

### 4.1 The ladder — free preservation is the secret middle rung

Not one jump ($0 → $X); three rungs, the middle one enabled by **files ≤105 KiB preserve for free** (MONEY-14):

- **Rung 1 — free preservation, on the run summary:** *"1,912 of your proven files are small enough to preserve **free** right now (≤105 KiB each, via Turbo's free tier). [Preserve 1,912 files — $0]"*. Converts a proof user into an *actual storage user* — upload path exercised, Permaweb view populated, solid badges appearing — at $0 and zero risk. Dovetails with UX-32 (opt-in silent free-tier sync).
- **Rung 2 — curated paid ask** (`PreservePlanModal`, "Suggested: the irreplaceable"), highest-regret cohort first: (1) Missing/Modified-since-proof cohorts (urgency on the user's own data); (2) Unique files (hash appears once — `processed_files` index makes this cheap); (3) Photos/videos/docs by extension (FEAT-5's cheap non-ML grouping); (4) everything else by size. *"Preserve your 812 photos and documents (2.1 GB) — **$X.xx, once.** Not per month. Once — permanently."*
- **Rung 3 — "Preserve everything"** (12.4 GB → $Y once) with the anti-subscription frame: *"Dropbox for this: $Z/month, forever. This: $Y, once."*

**Pricing integrity rule:** every number comes live from `turbo:get-upload-costs` / `turbo:get-fiat-estimate` — never hardcoded (the MONEY-3 fake-USD lesson). LAUNCH-READINESS flags cost-estimate accuracy as never reconciled against a real charge (P1) — **that reconciliation is a hard precondition for this funnel** (§6).

### 4.2 The moment

Three triggers, in intent order: (1) run-summary "See what preserving them costs" (highest intent, always present, never a popup); (2) verification digest "3 proven files now missing…" (highest emotional salience, ≤ monthly per cohort, dismissible forever); (3) static Proofs-tab banner showing the delta. No nagging — this audience punishes pushiness, and the daily re-anchor loop re-presents the gap for free.

### 4.3 FEAT-8 plugs in as checkout

Plan knows its exact cost; wallet is fresh/empty (the uploader-wallet trust story: main keys never touched this machine). → **[Top up with crypto — SOL / ETH / AR]** → `shell.openExternal('https://console.ar.io/topup?destinationAddress=<addr>&amount=<X>&source=ardrive-desktop-preserve')`; **[Pay with card]** (Stripe, secondary). Desktop side already built + tested (FEAT-8: deep-link + bounded 8×14s balance poll ending in "Credits added!"). The `amount=` param is in FEAT-8's designed query surface — confirm the console side seeds it (ar-io/ar-io-console#14). On credits-arrive → **one approval for the whole plan** ("Approve preservation plan: 812 files, $X.xx") backed by per-file MONEY-10 revalidation at upload time — plan-level consent, item-level safety. Per-file approval on an 812-file plan would kill the conversion dead.

---

## 5. Viral / growth surface

Anchoring is the only free action in crypto that produces a **personal, verifiable, public artifact** — and public artifacts spread, private backups don't.

- **5.1 Proof pages.** "Share proof" → publish a tiny self-contained HTML page + proof JSON via the existing manifest-deploy path (UX-33 surfaces URLs): headline ("4,183 files · 12.4 GB · proven to exist on 2026-07-09"), checkpoint txId linked to a gateway, wallet address (provenance), and — the credibility centerpiece — a copy-paste third-party verification snippet using `@ar.io/proof` requiring no ArDrive software. Footer: *"Notarized free with ArDrive Desktop — [notarize your disk]"*. Under ~105 KiB → the share page itself is free and permanent. Later: `proofs.yourname.ar` when ArNS assignment lands (GROWTH-6).
- **5.2 The flex.** Auto-generated share card: *"I notarized 48,112 files (312 GB) on Arweave today. Cost: $0. Verify it yourself: ar://…"*. Flex culture rewards *verifiable* flex. Launch motion: a "notarize your disk day" leaderboard in the ArDrive/ar.io Discords (files proven; wallet-signed → sybil-visible-but-honest).
- **5.3 Ecosystem leverage.** Flagship write-path client of ar.io's own verification standard (`ario.events` + `@ar.io/proof`) — ar.io has direct incentive to co-market, exactly as FEAT-8 made their Console our payment rail. Recipes: notarize your repo at tag-time (release provenance), notarize masters/demos/design files (creators' IP timestamps), DAO archive proofs. The FEAT-8 `destinationAddress` gift mechanic composes: a proof page for a public-goods archive carries *"Fund preservation of this archive"* → anyone tops up the archivist's wallet → sponsored preservation.
- **5.4 The honest wedge, for marketing.** *"Everyone sells you storage. We'll prove your files exist for free — and tell you, to the byte, what's proven versus what's actually preserved."* No competitor whose margin depends on ambiguity can copy that sentence.

---

## 6. Rollout + metrics (gates, not dates — D-003)

- **Phase A — Proof MVP.** Ship gate: comprehension gate + banned-word copy tests pinned; batch checkpoint on a real folder verified by third-party `@ar.io/proof` from a clean machine; verify/modified/missing states behavioral-tested; export/import round-trips. Scope: notarize-folder flow, one-tx batch checkpoint, local proofs + export, verify flows, badge system, Proofs tab, run summary with the receipt but **only the free rung (rung 1) live**.
- **Phase B — Funnel.** Entry gate: **supervised money session passed** (real Stripe charge + crypto top-up verified) and cost-estimate reconciliation done — both open P0/P1 in LAUNCH-READINESS. Scope: curated preserve plans, live quotes, plan-level approval, FEAT-8 `amount=` handoff, publish-Proof-Log micro-purchase, verification digests.
- **Phase C — Viral + ambient.** Entry gate: Phase B conversion signal exists and INFRA-5 telemetry is live. Scope: proof pages + share cards, daily re-anchor watch mode, whole-home preset at scale, ArNS proof pages, upstream ArFS proof-entity proposal.

**Metrics** (north star: **GB preserved per anchoring user** — finally answers ROADMAP Open Question 1; INFRA-5 must be designed against these):
- *Activation:* install → first checkpoint tx < 15 min; % of new wallets created via the notarize path (target: majority onboarding route).
- *Funnel:* proof-user → free-tier-preserve (hyp. 25–40%); → any *paid* preserve within 30 days (hyp. 3–8%, calibrate on cohort 1); proven-GB → preserved-GB ratio over time; top-up completion after `amount=` handoff.
- *Retention:* % of proof users with daemon alive & re-anchoring at day 30.
- *Viral:* proof-page publishes per 100 runs; page-view → install (tag `source=proof-page`).
- *Guardrail:* support tickets containing "lost/recover/where are my files" from proof-only users — target ~0; **any** such ticket is a P0 UX defect in §2, not a support case.

**Top 3 risks**
1. **Proof mistaken for backup → real data loss + brand damage** (D-028's named #1). Mitigation: the §2 stack + a beta canary (ship Phase A to the D-017 Discord tester group first, interview for the misconception before any public "free" messaging).
2. **Free-tier economics / Turbo abuse.** Checkpoints are 1 tx/run, cadence-capped daily, but free Proof Logs + mass free-tier preservation ride Turbo's subsidy. Mitigation: in-family (ar.io runs Turbo) — agree explicit limits with the Turbo team *before* launch, rate-limit client-side, degrade gracefully to local-only proofs if throttled.
3. **A big free top-of-funnel bolted onto an unverified money path.** Mitigation is structural: Phase B's entry gate *is* the supervised money session — the funnel cannot launch before the thing it funnels into works.

---

## 7. Effort + sequencing reality check

**Cheap (exists today):** free tier with single-source constant (MONEY-14); FEAT-8 crypto top-up + balance poll (desktop done; console #14 pending); hardened wallet onboarding with mandatory backup (verified); manifest deploy + URL surfacing (UX-33) for proof pages; hash-keyed DB (`processed_files`, `file_versions` + tx ids) + `FileHashVerifier`; notifications (UX-29) + tray (UX-30); DB migrations (INFRA-7); ar-io-anchor itself (primitive/batching/verification is ar.io's maintained code).

**Real build (Phase A honest sizing — a multi-week program, ~ FEAT-6 + FEAT-8 arcs combined):** anchor service in main + `proof:*` IPC with D-005 envelopes; two tables + migrations; NotarizeWizard, ProofRunSummary, Proofs tab, badge system across Dashboard/Permaweb; verify flows; export/import; the copy-test harness for banned words; the signer spike (§3.4). Phase B adds the plan builder + plan-level approval (a real MONEY-track change — same adversarial QA as MONEY-10) + quote reconciliation. Phase C adds share-page generation + watch-mode cadence control.

**The SYNC-10 interaction (non-obvious):** current hashing reads whole files into memory ×3 (SYNC-10's evidence) — fatal for notarizing a disk with multi-GB files. But the anchor service needs only a ~20-line streaming SHA-256 utility of its own; it should *build* that utility and SYNC-10 should then *adopt* it. So Proof Mode doesn't block on SYNC-10 — it pays down SYNC-10's first brick, and SYNC-10's completion then raises the sync cap to 2 GiB (D-014), which the *preserve* rung needs anyway (you can prove a 4 GB video today, but under the current 100 MiB cap you can't preserve it — an upsell dead-end the run summary must label honestly until the cap moves: *"12 files are over the current 100 MB limit — provable now, preservable when large-file support lands"*).

**Where it sits** (unchanged from the memo's ranking): (1) ship the beta (functionally complete; awaiting the supervised session + D-009 sign-off); (2) run the memo's moves 1–3 (money session + console PR; SYNC-10/2 GiB track; auto-update/telemetry — Phase B and the metrics *depend* on these, so they're prerequisites, not competitors for the slot); (3) then Proof Mode Phase A as the first growth feature. Log the §0 naming, §3 hybrid resolution, and §6 phase gates as a DECISIONS entry (D-034) refining D-028 when scheduled.

**Bottom line:** spend the design budget on the proof-vs-preservation difference (per D-028 that difference *is* the product risk), gate the funnel behind the money session, and **ship the notary before the storefront.**
