# UAT — LIVE private-drive unlock + round-trip certification, 2026-07-05 [PRIV]

**Runner:** TESTER agent (Claude Opus 4.8), supervised live pass with the owner's REAL wallet + confirmed private-drive password.
**Base:** branch `uat/private-drive-verify` off `main @ c5bd69c` (all session fixes incl. SYNC-20, ardrive-core-js 4.0.0).
**Build:** `npm run build` OK (dist/main/main.js + dist/renderer/index.html present).
**Wallet:** `iKryOeZQ…oRjA` (real, referenced by address only — JSON never printed/committed).
**Gateway:** turbo-gateway.com ONLY (never arweave.net).
**Harness (new, committed):** `scripts/uat/priv-signature-diagnose.js` (headless core-js v1/v2 root-cause probe), `scripts/uat/ui-private-cert.js` (live Playwright-Electron UI cert). Logs/screenshots in `scratchpad/uat-priv-verify/` (referenced by filename; **NOT committed**).

> **Safety honored:** READ-ONLY / decrypt-only pass. NO uploads, NO writes, NO hide/rename/move/delete, NO drive creation, NO payment. The owner's drives are exactly as found. No password / wallet JSON / decrypted private content printed or committed; private drive/file NAMES are reported by count / length / generic descriptor only.

---

## Headline

**The earlier "wallet password rejected" was NOT a password mismatch — it is a REAL BUG.** The owner's confirmed password is correct: with it, **all 4 private drives decrypt**. But the app's unlock derivation **hardcodes `DriveSignatureType.v1`**, so the **2 of 4 private drives that use v2 signatures are unreachable** — they reject with "Invalid password" *despite the correct password*. The other 2 (v1) unlock and decrypt cleanly, live, through the real UI. See **Defect PRIV-SIG-1** below.

---

## Environment

| Item | Value |
|---|---|
| ardrive-core-js | **4.0.0** |
| Build commit | `c5bd69c` (branch `uat/private-drive-verify`) |
| `drive.listWithStatus()` live | **21 drives** (17 public, **4 private — all locked**), wallet `iKryOeZQ…`, zero console errors on load |
| Private drives (id prefix → signature type, proven) | `cce4300f…` **v2** · `7cea4056…` **v2** · `cabca9d6…` **v1** · `8d81a9db…` **v1** |
| Network | turbo-gateway.com 200 (GQL + metadata); 404s on some ArFS child-DATA txs (known, D-012/CORE-1) |
| Display | WSLg `DISPLAY=:0`, software render (`--disable-gpu --no-sandbox`) |
| Disposable userData | per-run temp dir (isolated from any concurrent live test) |

> The 21 (vs the 18 seen in `UAT-RUN-2-LIVE`) is expected: the earlier run created 2–3 empty `UAT-TESTONLY-DELETEME` public drives; public went 14→17, private unchanged at 4.

---

## Per-step results

### Live UI certification — `ui-private-cert.js` → **12 / 12 PASS**

| # | Step | Result | Evidence |
|---|---|---|---|
| 1 | Load real wallet → welcome-back; `listWithStatus()` returns 21 drives incl. 4 private (locked) | **PASS** | `cert-01-welcome-back-drives.png`; total=21 public=17 private=4 locked=4 |
| 2 | Open PrivateDriveUnlockModal on a locked private drive; a11y | **PASS** | `cert-02-unlock-modal.png`; `role=dialog` + `aria-modal=true`, fingerprint `role=img`, `<label for=password>` linked |
| 3 | **Wrong password → fails closed** (modal stays open + error surfaced) | **PASS** | `cert-03-wrong-password.png`; modal open=true, error shown |
| 4 | **Correct password on a v1 drive → UNLOCKS live**; drive name decrypts | **PASS** | `cert-04-after-correct-unlock.png`; proceeded past unlock; `cabca9d6…` post-unlock `isLocked=false`, name decrypted to a 15-char plaintext string (NOT "ENCRYPTED") |
| 5 | App's real `drive:unlock` IPC matrix (v1 vs v2) | **PASS** | see matrix below |

**Step 5 — real-handler IPC ground truth (the bug, live through the app's own `drive:unlock`):**

| Drive | Password | Result | Meaning |
|---|---|---|---|
| v1 (`cabca9d6…`) | **wrong** | `REJECT — "Invalid password…"` | fail-closed ✔ |
| v1 (`cabca9d6…`) | **correct** | **`SUCCESS`** | app unlocks v1 with correct pw ✔ |
| v2 (`cce4300f…`) | **correct** | `REJECT — "Invalid password…"` | **BUG: v2 drive unreachable despite correct pw** |

### Headless root-cause diagnostic — `priv-signature-diagnose.js` → **6 checks, root cause isolated**

Per private drive, derived a key **the app's way** (`deriveDriveKey(password, driveId, walletJSON)` — 3-arg form, **defaults to v1**) AND the v2 way (`{…, driveSignatureType: v2}`), then trial-decrypted the drive entity with each:

| Drive | app-default (v1) | v2 | drive-name decrypts? |
|---|---|---|---|
| `cce4300f…` | **FAIL** (GCM auth) | **DECRYPTS** (sig=2) | yes (via v2) |
| `7cea4056…` | **FAIL** (GCM auth) | **DECRYPTS** (sig=2) | yes (via v2) |
| `cabca9d6…` | **DECRYPTS** (sig=1) | FAIL (GCM auth) | yes (via v1) |
| `8d81a9db…` | **DECRYPTS** (sig=1) | FAIL (GCM auth) | yes (via v1) |

- **CORRECT password decrypts every private drive under its own signature type** (4/4) → password is correct.
- **App's v1-default derivation decrypts only 2/4** (the v1 drives) → the 2 v2 drives are unreachable by the shipping app.

---

## Certification answers

1. **Did a real private drive UNLOCK with the correct password, live?** **YES (partial).** The 2 **v1** drives unlock through the live UI and the real `drive:unlock` IPC with the confirmed password. The 2 **v2** drives do **NOT** unlock via the app (see PRIV-SIG-1), though they DO decrypt with the same password when the key is derived as v2.
2. **Did metadata/content decrypt correctly?** **YES for metadata; file-BLOB round-trip gateway-blocked.**
   - Drive-entity **names** decrypt to real plaintext for all 4 drives (via the correct signature type); the unlocked v1 drive's name rendered decrypted in the live UI (15-char string, not "ENCRYPTED").
   - **Folder-entity (file NAME) metadata** decrypts: a v2 drive's root folder listed **3 files with fully decrypted, printable names** (no "ENCRYPTED", no ciphertext) — file names are drive-key-encrypted content, so this proves the private-content decrypt path end-to-end. Verified by count/printability only; names NOT recorded.
   - **File-BLOB content round-trip:** attempted on the smallest reachable private file (root folders held only ≥1.17 MB files; download/decrypt is free + read-only so size was not a blocker). **BLOCKED** — turbo-gateway.com returns **404 on the ArFS child DATA txs** (both a v2 drive's file blob and the v1 drives' folder-child data). This is the **known, pre-existing gateway data-availability limitation** (BACKLOG line 470, D-012/CORE-1), **not a decryption defect** — decryption itself is proven by the metadata/name decrypts above (AES-GCM is authenticated: a successful decrypt cryptographically proves the correct key).
3. **Did wrong-password FAIL CLOSED?** **YES.** In the live modal the wrong password kept the modal open with an error and did not decrypt; the real `drive:unlock` IPC returns `{success:false, "Invalid password…"}`. Cryptographically, a wrong key fails the AES-GCM auth tag ("Unsupported state or unable to authenticate data") — the app classifies only genuine decrypt/auth errors as wrong-password (gateway/network errors report a distinct "could not verify" message), so it fails closed without masquerading network faults as bad passwords.
4. **Is the earlier rejection explained — password-mismatch vs real-bug?** **REAL BUG, definitively.**
   - The password is **correct** (all 4 drives decrypt with it; 2 unlock live through the app).
   - The earlier UAT clicked the **first** ENCRYPTED drive = `cce4300f…`, a **v2** drive. The app derived a **v1** key → AES-GCM auth failure → "Invalid password." Had it clicked a v1 drive, it would have succeeded.
   - This **corrects the prior speculation** (BACKLOG line 470: "2 of 4 … likely a different password") — it is **not** a different password; it is a **signature-type derivation bug**.

---

## Defect PRIV-SIG-1 (NEW) — unlock hardcodes `DriveSignatureType.v1`; cannot unlock v2 private drives · **P0/beta-blocker candidate**

**Symptom:** unlocking a v2-signature private drive with the CORRECT password is rejected as "Invalid password." Affects 2 of the owner's 4 private drives, and — critically — **every private drive this app itself creates** (create uses v2, see below).

**Root cause — `src/main/drive-key-manager.ts:95-100`:**
```ts
async deriveKey(driveId: string, password: string): Promise<DriveKey> {
  if (!this.walletJson) throw new Error('Wallet not loaded');
  return deriveDriveKey(password, driveId, JSON.stringify(this.walletJson)); // 3-arg → DEFAULTS to v1
}
```
In ardrive-core-js 4.0.0 the legacy 3-argument `deriveDriveKey(dataEncryptionKey, driveId, walletPrivateKey)` overload hardcodes `driveSignatureType: DriveSignatureType.v1` (`node_modules/ardrive-core-js/lib/utils/crypto.js:120-127`). v1 and v2 produce **different wallet signatures** (RSA-sign vs `signDataItem`) → **different HKDF keys**. `getPrivateDrive` reads the drive's true type from the owner-scoped `Drive-Signature-Type` GQL tag and builds the entity as v2, but it decrypts with the **caller-supplied** (v1) key → GCM auth failure → the `unlockPrivateDrive` trial-decrypt classifies it as "Invalid password" (`wallet-manager-secure.ts:1384-1402`).

**Self-inconsistency (raises severity):** `SecureWalletManager.createPrivateDrive` derives the drive key via `PrivateDriveKeyData.from(password, walletJson)` which is **v2** (`arfsdao.js:63-68`), but then caches the session key via `driveKeyManager.unlockDriveUnverified` → `deriveKey` → **v1** (`wallet-manager-secure.ts:1308,1343`). So a private drive created in this app is v2 on-chain but can only ever be re-derived as v1 → **it can never be unlocked again**. (Not exercised live here — no drive creation, per safety — but it follows directly from the same defect and should be verified when fixed.)

**Fix direction:** derive with the drive's actual signature type. core-js exposes this via `ArFSDAO.getDriveSignatureInfo(driveId, owner)` (reads the `Drive-Signature-Type` tag, owner-scoped; `arfsdao.js:985-1037`) — thread `driveSignatureType` (and, for v1 drives with an on-chain `drive-signature` tx, `encryptedSignatureData`) into `deriveDriveKey({…})`. Pragmatic fallback: try v2 then v1 via trial-decrypt. Also align create-time caching to the same derivation so new v2 drives stay unlockable. Add a v1+v2 unlock regression test against DB-shaped/real fixtures.

**Owner-scoped GQL / CORE-1:** ruled OUT as the cause here — `getPrivateDrive` fills `owner` from the wallet address (`ardrive.js:931-933`) and the owner-scoped query returned edges (no CORE-1 empty-edges crash). The failure is specifically an AES-GCM **decryption** failure from the wrong key, not a query/enumeration failure.

---

## Verdict on PRIV-2 / PRIV-3 / PRIV-7

| Item | Scope | Verdict | Notes |
|---|---|---|---|
| **PRIV-2** (trial-decrypt before caching; fail-closed) | security invariant | **CERTIFIED LIVE** | Wrong password AND wrong-signature key both fail closed via GCM auth; only real decrypt errors classify as "invalid password"; correct key caches + decrypts. Proven on real on-chain drives. |
| **PRIV-3** (unlock modal + decrypt) | unlock UX + decrypt | **PARTIAL** | Modal/a11y correct; **v1 drives unlock and decrypt live** (name rendered decrypted). **NOT certified for v2 drives** — blocked by PRIV-SIG-1. |
| **PRIV-7** (`validateExistingPassword`, accept any-length existing pw) | input validation | **CERTIFIED LIVE** | The confirmed password is accepted (no length gate blocks it); wrong password rejected by trial decryption, not by the validator. Not the cause of any rejection. |

**Overall private-drive-unlock flow: PARTIAL / BLOCKED.** The security model (PRIV-2/7) is sound and certified; the unlock UX (PRIV-3) works for v1 drives but is broken for v2 drives (half the owner's private drives, and all app-created private drives) by **PRIV-SIG-1**, which should be filed and fixed before private drives are called beta-ready.

---

## Safety attestation

READ-ONLY pass. No uploads, writes, hides, renames, moves, deletes, drive creations, or payments. The owner's drives are exactly as found. turbo-gateway.com only. No password, wallet JSON, decrypted file content, or sensitive private names were printed, logged into committed files, or committed. Screenshots and run logs live only under `scratchpad/uat-priv-verify/` and are NOT committed.
