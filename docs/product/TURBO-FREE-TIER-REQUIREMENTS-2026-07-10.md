# What ArDrive Desktop Needs From Turbo for a Proper Free-Tier UX

**2026-07-10 · hand-off to the Turbo / ar.io team · pairs with MONEY-17 (desktop graceful handling)**

Context: Turbo's free tier is moving from a **per-file size threshold** (currently `/info` `freeUploadLimitBytes` = 107520 B, which the desktop reads today) to a **cumulative quota**: ~10 MB free per user (per wallet **and** IP), and 10 MB/month recurring after a ≥$5 credit top-up. Anti-spam gating (e.g. email confirmation) is under consideration.

The desktop can build **reactive graceful handling** with what exists today (MONEY-17, in progress) — but a genuinely good UX (accurate "free remaining," no surprise failures, honest approval screens, spam resistance) needs the following from Turbo. Ordered by desktop UX impact.

## 1. Remaining-allowance query (biggest UX lever)
An endpoint to fetch, for a wallet, the current free-tier state:
```
GET /account/{address}/free-allowance  →
  { freeBytesRemaining, monthlyEntitlementBytes, lifetimeFreeBytesRemaining,
    periodResetsAt (ISO), tier: "anonymous" | "topped-up", eligible: bool }
```
Without this the desktop is **blind and purely reactive** — it can't show "X MB of 10 MB left," can't pre-warn before a big batch, and can only discover exhaustion by *failing* an upload. With it we can show a live allowance meter and warn *before* the user hits the wall. (The IP dimension is inherently server-side; the app can't compute it — so even a wallet-scoped best-effort number is a big improvement over nothing.)

## 2. A typed, machine-readable "can't place this" error (must-have)
Today the desktop **string-matches `"insufficient"`** to detect payment failure (`sync-manager.ts:3495`) — fragile. Return a stable status + code so we can reliably branch and show the right message/CTA:
```
HTTP 402, body: { code: "free_quota_exhausted" | "insufficient_balance"
                          | "free_tier_ineligible", message, requiredWinc?, freeBytesRemaining? }
```
Distinguishing **quota_exhausted** (top up for more/monthly) from **insufficient_balance** (buy credits) from **ineligible** (verify email — §5) lets us show the correct next step instead of a generic error.

## 3. Free-aware cost preflight (accurate approval screens)
`getUploadCosts` / a preflight should tell us whether **this specific upload** (size + wallet) would be **covered by free allowance** vs. **cost N credits** — ideally `{ coveredByFreeTier: bool, freeBytesUsedByThis, wincCost }`. Otherwise our approval UI must either lie ("Free") or hedge ("may use your free allowance"). The desktop already never hardcodes prices (MONEY-3 lesson) — we just need the free tier reflected in the quote.

## 4. Monthly-entitlement / top-up status (so we can pitch it honestly)
Expose whether the wallet has unlocked the **10 MB/month** benefit (the ≥$5 top-up), and when it resets, so the desktop can accurately say "Top up $5 → 10 MB free every month" vs. "You have 10 MB free until {date}." Folds into §1's `tier` + `periodResetsAt`.

## 5. Anti-spam / eligibility (Phil's email-confirm idea) — a Turbo-side contract
If free access is gated behind verification (email confirm or similar) to stop free-tier abuse, the desktop needs three things to present it cleanly:
- **Status:** a way to read whether the wallet/account is verified/eligible for free (`eligible` in §1).
- **Flow:** the endpoint(s) to *initiate* and *confirm* verification (so we can host or deep-link the flow — e.g. "Confirm your email to unlock free storage").
- **Distinct denial:** the `free_tier_ineligible` code (§2) when free is refused for lack of verification, so we prompt verification rather than "top up." 
Design note: because the quota is **per wallet + IP**, verification is the real spam lever (a wallet is free to mint); tying free eligibility to a verified identity is the robust control. The desktop can host the confirm-email UX, but the enforcement and the identity↔wallet binding must live in Turbo.

## 6. Idempotent retry / no double-charge (correctness for auto-resume)
MONEY-17 will **auto-resume** a "needs-funds" upload once credits/quota arrive. To make retry safe, uploads should be **idempotent** (idempotency key or content-hash dedupe) so a resumed submission of the same data can't double-charge or double-store. Confirm turbo-sdk's retry semantics here.

## 7. Config-driven free-tier params (stop hardcoding)
The desktop currently reads `freeUploadLimitBytes` from `/info`. Under the new model, expose the free-tier shape there too — `{ perFileFreeBytes?, monthlyFreeBytes, lifetimeFreeBytes, perFileFreeStillApplies: bool }` — so the app reads config instead of baking in 10 MB / $5 / "105 KiB per file still free?". This also answers a desktop design fork: **does the old per-file 105 KiB free tier survive, or is it fully replaced by the quota?**

## 8. Cheap "funds/allowance changed" signal (for auto-resume)
So the desktop can detect when credits or quota arrive and auto-resume paused uploads without hammering. A lightweight balance+allowance status endpoint (poll) is enough — we already do a bounded post-top-up poll (FEAT-8); a webhook is nice-to-have, not required.

---

### Minimum vs. ideal
- **Minimum for a non-broken UX (MONEY-17 ships on this):** §2 (typed error) + §6 (idempotent retry) + §7's answer to "does per-file free survive?". With just these the app fails gracefully, recovers safely, and stops lying in the obvious ways.
- **For a *great* UX:** add §1 (allowance query) + §3 (free-aware preflight) + §4 → live allowance meter, pre-warnings, honest approval screens.
- **For spam resistance:** §5.

### Open questions back to Turbo
1. Does the per-file 105 KiB free tier persist alongside the 10 MB quota, or fully replace it?
2. Is there (or will there be) a remaining-allowance API per §1?
3. What's the exact error shape on quota/balance failure today, and can it become the typed §2 form?
4. Are uploads idempotent on retry (§6)?
5. Timeline for the server-side flip — so the desktop change lands in step, not early/late.
