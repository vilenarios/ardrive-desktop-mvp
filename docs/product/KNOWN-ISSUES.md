# ArDrive Desktop Beta — Known Issues & Intentional Limitations

What this beta **deliberately does not do yet**, so testers know what's a scope boundary vs. a bug. Report anything *outside* this list. Derived from [ROADMAP.md](./ROADMAP.md) (post-beta tracks) and [BACKLOG.md](./BACKLOG.md); scope decisions are in [DECISIONS.md](./DECISIONS.md).

## Sync

- **One drive syncs at a time.** You can have multiple drives, but only one actively syncs; the UI reflects this. Simultaneous multi-drive sync is post-beta (SYNC-14).
- **Sync is one-way + on-demand for remote changes.** The app watches your *local* folder and uploads changes continuously. Changes made *elsewhere* (another device, the web app) appear on **manual sync or restart**, not in real time — there's no continuous remote-change polling yet (SYNC-8). *(Delta re-sync is efficient — it only fetches what changed since last sync, not the whole drive.)*
- **No automatic conflict resolution.** If the same file changes in two places, the app does not yet merge or prompt to resolve; last-write behavior applies. Conflict detection/resolution is post-beta.
- **Downloads are not hash-verified on arrival.** Integrity is checked on upload; a post-download hash check is post-beta (SYNC-12).
- **2 GB per-file cap** (MVP; larger via streaming upload is post-beta, SYNC-6/10). Files over the cap are rejected with a clear message.

## Snapshots

- **The app *reads* snapshots (fast large-drive loading) but does not *create* them.** Snapshot consumption ships in this beta (it's what makes big drives load in seconds); making/publishing new snapshots from the desktop is post-beta (FEAT-3).
- **Some legacy files may not display.** A small number of very old files whose on-chain metadata is genuinely incomplete (missing a required tag) are skipped rather than shown — this affects the file, not the rest of the drive.

## Gateways / network

- **Single primary gateway with fallback, not full stake-weighted routing.** The app uses a configurable primary (default `turbo-gateway.com`) with automatic **data** fallback (e.g. `perma.online`) when it's flaky. Full Wayfinder top-staked-gateway routing + retrieval verification is post-beta (SYNC-15).
- **Metadata (drive listing) does not fall over between gateways.** Data downloads fail over freely; drive-*listing* queries stay on the primary and retry, because some gateways don't index every account's metadata (a fallback could silently return an empty drive). This is intentional.

## Accounts / payments

- **Turbo Credits only** for uploads (card top-up, or free tier). Paying uploads directly with AR tokens is not in this beta (D-010).
- **Arweave-wallet onboarding only.** Solana-first onboarding and advanced AR-token mode are post-beta (FEAT-1/2).
- **Free tier: files ≤ 105 KiB** upload free via Turbo. Larger files show a cost estimate and require explicit approval.

## Platform / distribution

- **Unsigned installers.** Beta builds are not code-signed/notarized — your OS may warn on first launch. Signing is a GA item, not beta (Track D).
- **Manual updates** (no auto-update in beta) — you'll be pointed to new builds.

---
*If you hit something not on this list, it's a bug — please report it. Updated as scope changes; check the date against the build you're testing.*
