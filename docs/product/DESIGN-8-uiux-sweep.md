# DESIGN-8 — UI/UX Sweep: Master Punch-List

Consolidation of four surface-by-surface critiques (onboarding, drives/sync-setup,
dashboard/content, settings/profile/payments) into one deduped, prioritized punch-list.
Source critiques: `uiux-crit-onboarding.md`, `uiux-crit-drives.md`,
`uiux-crit-dashboard.md`, `uiux-crit-settings.md` (~142 raw findings). All four were
read in full against `docs/product/DESIGN-SYSTEM.md` in worktree `wt-main`.

Reading this doc: items are grouped by **theme**, in the priority order below (trust
bugs first, polish last — not file order). Recurring bugs that hit many files (a
hardcoded `background:'white'`, `.button.secondary`'s invisible text, the
`onMouseEnter` §5A anti-pattern, the `--radius-xl` duplicate) are merged into **one**
item each, with every site listed — don't file six duplicate tickets for the same
root cause. Each item: `file:line(s)` · severity · the problem (1 line) · the fix
(1 line). Severities: **broken** (visibly/functionally wrong in some theme or input
mode) · **inconsistent** (works, violates the design system or a sibling surface) ·
**copy-clarity** (jargon/ambiguous/misleading wording) · **missing-info-bubble** ·
**polish** (nitpick).

## Totals

**78 deduped items** (down from ~142 raw findings — the reduction is almost entirely
from merging multi-site bugs like the white-background regression, which alone
collapses ~20 raw citations into one item).

**By theme:**

| # | Theme | Items |
|---|---|---|
| 1 | Trust / honesty bugs | 6 |
| 2 | Dark-mode & cascade bugs | 4 |
| 3 | DESIGN-5 restyle debt | 9 |
| 4 | Accessibility | 5 |
| 5 | Info-bubble distribution | 8 (+ 16-concept coverage table) |
| 6 | Design-system integrity | 8 |
| 7 | Copy & permanence | 15 |
| 8 | Polish | 23 |

**By severity** (dominant tag per item — several items are genuinely cross-tagged,
e.g. broken + trust, and are counted once under their primary tag):

| Severity | Items |
|---|---|
| broken | 14 |
| inconsistent | 20 |
| copy-clarity | 16 |
| missing-info-bubble | 5 |
| polish | 23 |

All 6 Theme-1 (trust) and all 4 Theme-2 (dark-mode) items are tagged **broken** — the
top two priority themes are, not coincidentally, also where nearly all of the
`broken` severity lives. The remaining 4 `broken` items outside those two themes are
`RESTYLE-8` (dead search/filter state), `A11Y-1`/`A11Y-2` (two keyboard-unreachable
controls), and `INFO-6` (the Winston jargon leak, tagged broken in the source
critique as an outright jargon exposure rather than a mere missing tooltip).

---

## Theme 1 — Trust / honesty bugs

These lie to the user, directly or by omission. Top priority regardless of effort —
the whole product's pitch is "trust us with your permanent files," and every one of
these undercuts that in a different place.

### TRUST-1 — TurboSettingsTab shows fabricated usage stats
`src/renderer/components/turbo/TurboSettingsTab.tsx:13,18,23` · **broken**
"Files Uploaded: 0", "Credits Used: 0 AR", "Data Stored: 0 GB" are hardcoded literals
wired to nothing — they read "0" forever no matter how much a user has actually
uploaded or spent, in a *payment* settings tab.
**Fix:** wire to real usage counters, or replace with the app's existing
`TurboComingSoonTab` empty-state pattern instead of fake zeros.

### TRUST-2 — "Enterprise Ready" claims features that don't exist in this MVP
`src/renderer/components/turbo/TurboAboutTab.tsx:88-97` · **broken**
Claims "built-in compliance features, audit trails, and team management" — none of
which exist in this single-profile-at-a-time desktop app. Sits next to true claims
("Files under 100KB are free"); one falsifiable claim discredits the honest ones
around it.
**Fix:** cut the card, or move it to `TurboComingSoonTab` explicitly labeled roadmap.

### TRUST-3 — Seed-phrase validation shows a factually wrong error, and fires while the user is still typing
`src/renderer/components/WalletSetup.tsx:693-727`, `src/renderer/styles.css:474` ·
**broken**
`ClientInputValidator.validateSeedPhrase` (`src/renderer/input-validator.ts:147`)
accepts 12 *or* 24 words, but the hardcoded copy says "must contain exactly 12
words" — a valid 24-word phrase is told it's wrong. The same condition also drives
`.seed-phrase-textarea.invalid`, so the border/inline error flips to danger-red on
the first keystroke and stays red for every keystroke until the phrase is complete —
i.e. red for ~95% of normal typing, on the single most sensitive field in the app.
**Fix:** surface `validateSeedPhrase(seedPhrase).error` instead of a hand-written
string (or fix the copy to "12 or 24 words"), and only validate on blur/submit — show
a neutral "3 of 12 words" counter instead of an error mid-entry.

### TRUST-4 — "Hidden" recovery-phrase words are only visually dimmed, not actually hidden
`src/renderer/components/common/SeedPhraseDisplay.tsx:59-97` · **broken** (security/a11y)
`opacity: showSeedPhrase ? 1 : 0.1` — the real word text stays in the DOM at 10%
opacity. A screen reader reads it regardless, and it's trivially visible via DOM
inspection or a non-pixel screen-recording tool — for the single most sensitive
string in the app, "hidden" should mean hidden. Contrast the import textarea, which
uses real `-webkit-text-security: disc` masking.
**Fix:** swap the rendered word text for masked placeholders (or don't render the
real words at all) until `showSeedPhrase` is true, mirroring the textarea.

### TRUST-5 — Drive-setup success screen shows the wrong privacy icon
`src/renderer/components/SetupSuccessScreen.tsx:125-143` · **broken**
The "Drive Type" row hardcodes a `Globe` icon — a **private** drive's own confirmation
screen shows the public icon. `WelcomeBackScreen.tsx:264-274` correctly branches
`Lock`/`Globe` on `drive.privacy` a few files away; this one doesn't. Showing "public"
on a private drive's summary is exactly backwards for a screen whose whole job is
letting the user trust what "private" means before they upload anything.
**Fix:** branch the icon (and ideally accent color) on `driveType`/`drive.privacy`,
same as `WelcomeBackScreen`.

### TRUST-6 — Turbo Credits balance is denominated in "AR" — conflates two currencies the app elsewhere insists are distinct
`src/renderer/components/turbo/TurboBalanceCard.tsx:44-48` · **broken (semantic)**
The app's own `TurboAboutTab` teaches "Turbo Credits vs. AR tokens are two different
systems," then the balance card shows the Credits balance with the unit label "AR" —
one click away from the separate, literal AR wallet balance in `UserMenu`. A
non-crypto user has no way to tell these are different things.
**Fix:** label as "Credits (≈ AR)" or show fiat-primary/AR-equivalent-secondary, and
add an `InfoButton` here (see INFO coverage table).

---

## Theme 2 — Dark-mode & cascade bugs

Functional breakage: content that's genuinely unreadable, not just off-brand. Every
one of these is a cascade/specificity problem — a rule loaded later in `styles.css`
silently wins over the intended one, or a raw color literal ignores the theme
entirely.

### DARK-1 — Hardcoded `background: white` (and literal overlay colors) bypass theme tokens → invisible or near-invisible content in dark mode
**Status (DESIGN-8, Foundation lane): PARTIALLY DONE.** Fixed the
onboarding/setup + Wallet Export sites (this lane's ownership):
`DriveAndSyncSetup.tsx:279`, `SyncFolderSetup.tsx:119`,
`ProfileManagement.tsx:192,238,467`, and `styles.css`'s Wallet Export modal
(overlay scrim → `var(--overlay)`, panel + format-choice cards →
`var(--surface-raised)`, `.seed-word` → `var(--surface-inset)`). Also swapped
the onboarding "loading" spinners' literal `white`/`rgba(255,255,255,0.3)` for
the existing `--text-on-brand`/`--spinner-track-on-brand` tokens (same file,
same bug class). `DownloadQueueTab.tsx`, `UploadApprovalQueueModern.tsx`, and
`turbo-credits.css` are **owned by the parallel DESIGN-5/restyle lane** — not
touched here, per this lane's file-ownership boundary. The dead-code sites
(`DriveManager.tsx`, `ProfileSelection.tsx`) are resolved by DSI-6's deletion
below. Note for whichever lane picks up the remaining sites: this lane's audit
also found ~18 more live `background: white` sites elsewhere in `styles.css`
(payment-modal, file-metadata-modal, info-card, status-card, activity-section,
download-overlay, global-status-card, mapping-card, form-section, etc.) that
this doc's original sweep didn't enumerate — worth a follow-up pass.
**broken** — the single most-repeated bug across all four critiques. Every heading/
label inside these cards inherits `--text-primary`, which is `#FAFAFA` in dark theme
(`theme.css:30`) — white text on a hardcoded white card.

*Live, reachable sites (fix now):*
- `src/renderer/components/DriveAndSyncSetup.tsx:279` — first-run "Let's Set Up Your
  Storage" card; the actual first-run screen every new user sees.
- `src/renderer/components/SyncFolderSetup.tsx:119` — "Set Up Sync Folder" card,
  reached from the live returning-user flow (`App.tsx:836-846`).
- `src/renderer/components/ProfileManagement.tsx:192,238,467` — the live multi-profile
  sign-in screen (`App.tsx:787-793`, case `'profile-management'`).
- `src/renderer/components/dashboard/DownloadQueueTab.tsx:307` — every download row
  card.
- `src/renderer/components/UploadApprovalQueueModern.tsx:827` — "Retry Failed" button
  resting state.
- `src/renderer/styles.css:2772,2779,2842,3113` — the **Wallet Export modal**: overlay
  scrim, panel, the four format-choice cards, and — worst of all — line 3113's
  `.seed-word { background: white }` paired with `.word-text { color: var(--gray-900)
  }` → `--text-primary` (#FAFAFA dark) means **the revealed seed-phrase words render
  near-white-on-white**, exactly when a user is carefully transcribing 12 irreplaceable
  words. This is the highest-stakes screen in the app and the worst instance of this
  bug.
- `src/renderer/styles/turbo-credits.css:14,47,64,196,255,299,347,358,532,657,729` —
  the **entire Turbo Credits Manager** (11 sites: header, close button, balance card,
  inactive tabs, every section wrapper, quick-buy options, feature/benefit cards,
  comparison rows) — every panel a user sees while buying credits with a real card.
  Two of these sites are worse than "wrong background": `.tcm-amount-input` and
  `.tcm-currency-select select` (`turbo-credits.css:345-363`) set `background: white`
  with **no explicit `color`**, so typed text inherits `--text-primary` and is
  literally invisible — a user cannot see the dollar amount they're typing to buy
  credits.

*Dead-code sites (recommend delete rather than fix — see DSI-6):*
- `src/renderer/components/DriveManager.tsx:142,264` (unreachable, not imported
  anywhere).
- `src/renderer/components/ProfileSelection.tsx:~449,474,635` (unreachable, superseded
  by `ProfileManagement.tsx`).

**Fix:** replace every literal `white`/`rgba(0,0,0,…)` with the correct token —
`var(--surface-raised)` for cards, `var(--surface-overlay)` for modals/panels,
`var(--overlay)` for scrims, `var(--input-bg)`/`var(--text-primary)` for inputs —
the same recipe already applied to the three DESIGN-7 drive modals (`modal.css`'s own
header comment documents this exact fix, "F7," having already been done there).

### DARK-2 — `.button.secondary` renders invisible white-on-white text in dark mode
**Status: DONE (DESIGN-8, Foundation lane).** `.button.secondary` now uses
`background: var(--surface-inset); color: var(--text-primary); border: 1px
solid var(--border-strong);` (resting), with matching `:hover`/`:active`/
`:disabled` states mirroring `.button.outline`'s recipe. Verified by cascade:
both tokens resolve to legible, distinguishable pairs in each theme
(dark: `#2a2a2a` bg / `#fafafa` text; light: `#f1eff0` bg / `#1f1f1f` text).
Confirmed live call sites (`FileLinkActions.tsx`, `StorageTab.tsx`,
`CreateManifestModal.tsx:426,601`, `SyncManager.tsx`, `FileMetadataModal.tsx`,
`OverviewTab.tsx`, `ActivityTab.tsx`, `UploadApprovalQueue.tsx`) all pick up
the shared class — no per-component change needed.
`src/renderer/styles.css:704-708` · **broken** (pixel-verified: sampled
`design6-overview-modal-DARK.png`'s Cancel button — every pixel ≥ RGB(250,250,250),
the label isn't rendered visibly at all)
```css
.button.secondary {
  background: var(--gray-800);   /* bridged for TEXT use, resolves to #FAFAFA dark */
  color: white;
  border: 1px solid var(--gray-700);
}
```
Hits `CreateManifestModal.tsx:426` and `:601` directly (its Cancel/Back buttons use
`className="button secondary"`).
**Fix:** give `.button.secondary` its own dark-safe tokens — `background:
var(--surface-inset); color: var(--text-primary); border: 1px solid
var(--border-strong);` (the same recipe as `.button.outline`) instead of a bridged
"gray text" token repurposed as a fill.

### DARK-3 — Dead `.file-icon` rule blocks win the cascade → invisible file-type icons in dark mode
**Status: DONE (DESIGN-8, Foundation lane).** `:3818`'s bare `.file-icon {
color: var(--gray-600) }` was confirmed dead (its whole surrounding block —
`.activity-item`, `.item-icon`, `.item-meta`, etc. — has zero live consumers,
superseded by `.unified-activity-item`) and deleted. `:1568` (the 56px
file-detail-modal box) turned out to be **live** — `FileMetadataModal.tsx`
genuinely renders `<div className="file-icon"><FileText/></div>` for its
56px icon well — so instead of deleting it, it was renamed to
`.file-detail-icon` (CSS + the one TSX call site) and its `background: white`
swapped for `var(--surface-inset)` (DARK-1 same-bug). This leaves exactly one
bare `.file-icon` declaration (`activity-tab.css:157`, 12px sizing) beneath
the canonical `.file-icon.<family>` color rules — the collision is gone.
Verified via full-repo grep: no other component references the old bare
`"file-icon"` class except the already-dead, out-of-mandate
`StoredFilesBrowser.tsx` (unreferenced anywhere — not deleted since it isn't
named in this doc, but flagged here for a future dead-code pass).
`src/renderer/styles.css:1568` and `:3818` · **broken**
Two leftover `.file-icon` blocks (one a 56px file-detail-modal relic with
`background:white`, one a dead duplicate) share the canonical rule's specificity
(`0,1,0`) with the *intended*, DESIGN-6-canonical rule
(`src/renderer/styles/activity-tab.css:157-160` + `styles.css:4314-4373`, explicitly
commented "canonical, DESIGN-6"). Because `styles.css:1568` loads after all
`@import`s, it wins `width`/`height`/`background` for every `.file-icon.archive/
.package/.python/...` icon — which are colored via `--gray-700` → `--text-primary`
(#FAFAFA dark) — rendering as a near-white glyph on its own leftover white box:
**completely invisible**. Confirmed in `reconciled-design6-activity-DARK.png` (every
row's icon is a pale blob) and `reconciled-design6-storage-DARK.png` (the `.zip` icon
is fully invisible; the same row in light mode looks fine only because it blends with
the white page). This is the surface where it's most visible: Activity and Storage
tabs, where every row has a file-type icon.
**Fix:** delete both dead blocks (`:1568`, `:3818`) or rename whatever the 56px rule
actually belongs to (grep its real consumer first) so it stops colliding with the
canonical rule.

### DARK-4 — `--radius-xl` is split-brained (12px vs 24px), and the wrong one silently wins
**Status: DONE (DESIGN-8, Foundation lane).** Removed the `--radius-sm/md/lg/xl`
redeclaration from `styles.css`'s legacy bridge block; those four names now
resolve to `theme.css`'s spec'd 4/6/8/12px scale everywhere (`settings.css:23`,
`user-menu.css:88`/`:449`, and every DESIGN-7 modal get the correct radius with
no further changes needed). `--radius` (no suffix) is **not** part of
theme.css's scale and was left untouched — it has ~40 live call sites across
`styles.css`/`turbo-credits.css`/`activity-tab.css` with no equivalent token to
bridge to; deleting it would zero out their `border-radius` entirely, which is
out of scope for this fix. Checked for hard-dependencies on the old inflated
literals (e.g. paired `clip-path`/offset math assuming a specific px value) —
found none; border-radius is purely cosmetic at every call site.
`src/renderer/styles/theme.css:216` (12px, DESIGN-SYSTEM-spec'd) vs
`src/renderer/styles.css:217` (24px, `:root` block loaded *after* the `@import`,
"intentionally left as literal" per that file's own comment) · **broken (guardrail
violation)**
Cascade rules mean the 24px value always wins everywhere, including in DESIGN-7-
migrated files that reference `--radius-xl` expecting the spec's 12px:
`settings.css:23`, `user-menu.css:88`, logout-modal (`:449`). Not a hard visual break
(24px still reads as "a modal"), but every migrated modal is silently 2x the spec'd
corner radius, invisible unless you diff both files. *(Also flagged under
design-system integrity — DSI cross-reference — but counted once, here, since the
root cause is a cascade/load-order bug like DARK-3.)*
**Fix:** finish porting the modal surfaces and delete the `styles.css` override, or
update `DESIGN-SYSTEM.md`/the `styles.css` comment to state which value is
authoritative today.

---

## Theme 3 — DESIGN-5 restyle debt

Per `docs/product/BACKLOG.md`: DESIGN-4 (shell/tabs), DESIGN-6 (Overview/Activity/
Storage), and DESIGN-7 (modals) are merged. **DESIGN-5 (Upload Approval Queue +
Turbo/payments) is explicitly not done.** `DownloadQueueTab.tsx` isn't owned by any
DESIGN-4..7 branch and has no design-review screenshot — it fell through the cracks
entirely. These are the two "money moves" / "files moving" screens — the most
emotionally load-bearing moments in a permanent-storage app — and they look like a
different, older app sitting next to an otherwise-polished dashboard.

### RESTYLE-1 — Upload Approval Queue: systemic legacy tokens, zero §5A polish
`src/renderer/components/UploadApprovalQueueModern.tsx` (whole file) · **inconsistent**
(systemic, flagged once for the file) 25+ occurrences of legacy bridged token names
(`--gray-*`, `--ardrive-primary*`, `--warning-50/600/700`, `--success-600`,
`--info-600/700`, `--ardrive-danger`) — resolve fine today via the bridge, but the
component never got a §5A polish pass. See RESTYLE-9 for the hover-handler count.
**Fix:** port to semantic token names as part of finishing DESIGN-5.

### RESTYLE-2 — Primary button hover-glow uses the old pre-rebrand red, not brand red
`src/renderer/components/UploadApprovalQueueModern.tsx:933` · **inconsistent**
`boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)'` — `rgb(220,38,38)` is `#dc2626`, the
Tailwind red `DESIGN-SYSTEM.md` §1 explicitly replaced with `--brand`/`#D31721`. Every
other primary-button glow in the restyled surfaces uses the correct brand red; this
one quietly glows a different red.
**Fix:** `boxShadow: 0 4px 12px rgba(var(--brand-rgb), 0.2)`.

### RESTYLE-3 — No column headers on the one screen where users compare cost vs. size
`src/renderer/components/UploadApprovalQueueModern.tsx:595` · **inconsistent**
`gridTemplateColumns: '20px 1fr auto 120px auto'` crams icon/name/size/cost/status
into a dense row with no header labels — unlike `StorageTab`'s file browser, which
has an explicit `Name / Size / Modified` header (`StorageTab.tsx:801-806`). On the
one screen where a user decides whether to spend money, they can't tell which number
is size vs. cost without reading full rows.
**Fix:** add a header row, matching `StorageTab`'s convention.

### RESTYLE-4 — Insufficient-balance message mixes two alert hues in one sentence
`src/renderer/components/UploadApprovalQueueModern.tsx:659-663` · **inconsistent**
Amber (`--warning-600`) message text next to a brand-red "top up" link — two different
alert colors in one two-line message reads visually uncoordinated.
**Fix:** keep the message on one hue; underline the link instead of recoloring it red.

### RESTYLE-5 — Download Queue tab is entirely un-restyled and has no search/filter
`src/renderer/components/dashboard/DownloadQueueTab.tsx` (whole file) ·
**inconsistent** (functions correctly; just isn't the same app as the rest of the
dashboard) 100% inline `style={{}}` for layout/color, legacy bridged tokens
throughout, raw `'0.2s'`/`'0.3s'` transitions instead of `--motion-*` tokens, an
arbitrary `maxHeight: 'calc(100vh - 400px)'` magic number (`:270`, likely to clip
awkwardly on smaller windows), and — unlike Activity/Storage, which both have one —
**no search or filter at all** (the grouping logic itself — active downloads, then a
"Queued Downloads" separator with position-in-queue — is good; keep that, just bring
the visual/interaction layer up to the Storage-tab standard).
**Fix:** restyle onto real CSS classes + tokens, add search/filter to match
Activity/Storage.

### RESTYLE-6 — Turbo Credits Manager reads as a different, older app
`src/renderer/styles/turbo-credits.css` (whole file) · **inconsistent**
No accent-top bar on `.tcm-section` (every other restyled surface has one), no
`--elevation-*` steps (uses legacy `box-shadow: var(--shadow-md)`), legacy
`border-radius: var(--radius)` (6-8px) instead of the signature `--radius-lg`/
`--radius-xl`. Given this is the literal money surface, it should be the *most*
branded, not the least. (White-background specifics already covered in DARK-1.)
**Fix:** apply the same accent-bar/elevation/radius treatment `settings.css`/
`modal.css` already use.

### RESTYLE-7 — `CreateManifestModal` never got the DESIGN-7 shared modal-shell treatment
`src/renderer/components/CreateManifestModal.tsx:253-274,456-475` · **inconsistent**
No `.drive-modal-panel`/`.drive-modal-header`/`.drive-modal-footer`, no 6px accent-top
bar, raw `rgba(0,0,0,0.5)`/`rgba(0,0,0,0.7)` backdrops instead of `var(--overlay)`
(lines 260, 462 — won't get the correct lighter light-theme scrim), ad-hoc `boxShadow`
instead of `var(--elevation-4)`. Same feature area as `CreateDriveModal`/
`AddExistingDriveModal`/`PrivateDriveUnlockModal`, which all share one consistent
"ArDrive modal" look; this one looks like a different app. Also ships repeated
`console.log`/`console.warn` in the render path, including one **inlined directly in
JSX** (`{console.warn('MANIFEST DEBUG - Rendering folders:', folders)}`, line 370) —
lines 41, 51, 59, 75, 88, 94-95, 99, 193 too.
**Fix:** port to `.drive-modal-overlay`/`.drive-modal-panel` classes from `modal.css`;
remove the debug logging (gate behind a dev-only flag if still needed).

### RESTYLE-8 — Dead search/filter state: Upload Queue and Download Queue look searchable but aren't
`src/renderer/components/Dashboard.tsx:83-84,100-123,837-885` · **broken** (looks like
a shipped feature; isn't) `searchQuery`/`statusFilter` state and the derived
`filteredUploads`/`filteredDownloads` are computed but never rendered as an input and
never passed to `UploadApprovalQueueModern`/`DownloadQueueTab` (both receive the raw,
unfiltered arrays). Meanwhile Activity and Storage each independently implement their
own search (three different implementations of the same concept across the app).
**Fix:** wire a real search/filter bar into Upload Queue and Download Queue, or delete
the dead state.

### RESTYLE-9 — §5A hover-handler violations recur across 4 components (10 sites)
**inconsistent** DESIGN-SYSTEM.md §5A: *"If you catch yourself writing a
mouse-enter handler to swap a color, that color belongs in a CSS class instead."*
Sites:
- `UploadApprovalQueueModern.tsx:531-538, 710-716, 734-740, 757-764, 838-844,
  868-873, 929-941` — 7 separate instances in one file.
- `src/renderer/components/dashboard/DownloadQueueTab.tsx:311-316` — `onMouseEnter`
  mutating `boxShadow` directly.
- `src/renderer/components/CreateManifestModal.tsx:218-227, 299-306` — folder-tree
  rows and the close button.
- `src/renderer/components/ProfileManagement.tsx:467,473-480` — "Add New Profile"
  button.
**Fix:** move every instance to a `:hover` CSS rule (e.g. `.upload-row:hover`,
`.download-card:hover`, `.manifest-folder-row:hover`, `.profile-add-btn:hover`).
Mechanical, low-risk, same fix shape everywhere.

---

## Theme 4 — Accessibility

Keyboard-unreachable controls and modals with no escape hatch.

### A11Y-1 — Drive-selection radios are keyboard-unreachable
`src/renderer/components/WelcomeBackScreen.tsx:254-261` · **broken**
```tsx
<input type="radio" ... style={{ display: 'none' }} />
```
`display:none` removes the radio from both the tab order and the a11y tree — a
keyboard-only user cannot reach or select any drive on this screen. The
`.drive-select-card:focus-within` rule (`modal.css:361`) proves keyboard support was
intended but never reachable.
**Fix:** use a visually-hidden pattern (`position:absolute; width:1px; height:1px;
opacity:0; pointer-events:none` / a standard `.sr-only` class) instead of
`display:none`, so the input stays tabbable and `:focus-within` fires.

### A11Y-2 — Activity row context menu is mouse-only
`src/renderer/components/dashboard/ActivityTab.tsx:626-627,745-801` · **broken** (for
keyboard users) The "…" trigger only mounts when `hoveredItem === activity.id`
(JS-state-gated, not CSS `:hover`) — no `:focus-within` fallback exists, so
"Open / Copy Link / View Details / View Online" are unreachable without a mouse.
Also violates §5A (state changes should be CSS, not JS).
**Fix:** always mount the trigger button; show/hide via `:hover`/`:focus-within` on
the row in CSS.

### A11Y-3 — No Escape-to-close, backdrop-click, or focus-trap on 3 of 4 drive modals
`CreateDriveModal.tsx`, `AddExistingDriveModal.tsx`, `CreateManifestModal.tsx` ·
**inconsistent** DESIGN-SYSTEM.md §6.4 requires *"Esc closes; focus trap; return
focus on close."* `PrivateDriveUnlockModal.tsx` is the only one with backdrop-click
(lines 76-81) and `autoFocus` (line 179) — proving the pattern is known — but even
there `Escape` is wired only to the password `<input>`'s `onKeyDown` (line 67), so
Escape does nothing once focus moves to the checkbox or eye-toggle.
**Fix:** lift Escape/backdrop-click handling to the overlay `<div>` once (or extract a
shared `<DriveModal>` wrapper) and reuse across all four.

### A11Y-4 — Labels aren't programmatically associated with their inputs
`CreateDriveModal.tsx`, `AddExistingDriveModal.tsx`, `DriveAndSyncSetup.tsx`,
`SyncFolderSetup.tsx`, `CreateManifestModal.tsx`, `DriveManager.tsx` ·
**inconsistent** (a11y) Every `<label>` in these files is bare text with no
`htmlFor`, paired with an `<input>` with no `id`. Only
`PrivateDriveUnlockModal.tsx:166,202` does this correctly. Screen readers can't
announce field names; clicking label text doesn't focus the input.
**Fix:** add matching `id`/`htmlFor` pairs everywhere.

### A11Y-5 — No `<h1>` anywhere in the onboarding flow
`src/renderer/components/WalletSetup.tsx:295,368,455,558` · **inconsistent** (a11y)
Every screen title in this multi-step, primary-content flow is an `<h2>` — screen
readers using heading navigation never find a level-1 heading in onboarding at all.
**Fix:** promote each step's screen title to `<h1>`.

---

## Theme 5 — Info-bubble distribution

The app already has a well-built, accessible `InfoButton` component
(`common/InfoButton.tsx` + `info-button.css`: fade-in, `:focus-visible` ring,
`role="tooltip"`, optional "Learn more" link) — 18 live usages across onboarding,
Turbo/payments, and metadata surfaces prove the pattern works. On dashboard/content
surfaces specifically, usage drops to **zero** despite being imported. The fix for
almost everything below is "wire up the component that's already there," which is
about as cheap as design debt gets.

### INFO-1 — `InfoButton` imported but never rendered, on the two highest-stakes surfaces in the app
`src/renderer/components/dashboard/StorageTab.tsx:3` (1,377-line file, never called)
and `src/renderer/components/UploadApprovalQueueModern.tsx:14` (never called) ·
**missing-info-bubble** Storage/"Permaweb" has the highest concentration of
crypto-native concepts in the dashboard (permaweb, cloud-only, synced, hidden/
unhide) and zero definitions. Upload Queue is where real Turbo Credits get spent and
has the highest concentration of unexplained concepts in the app (see INFO-5).
**Fix:** wire the already-imported component up on both surfaces — see the coverage
table below for exact copy.

### INFO-2 — Three different, inconsistent mechanisms deliver the same "explain this" job
**Status: PARTIALLY DONE (DESIGN-8, Settings+Gateway lane).** Fixed the
`UserMenu.tsx` sites (this lane's ownership): the AR Balance and Turbo
Credits hand-rolled hover-only `.balance-tooltip` widgets
(`UserMenu.tsx:226-229,251-254` at the time of the original sweep) are now
`<InfoButton>` (keyboard-accessible, click-triggered, matching the rest of
the app). The dead `.balance-tooltip`/`.export-tooltip`/`.menu-tooltip-content`
CSS these widgets used is removed from `user-menu.css` rather than left as
dead code. `DriveSelector.tsx:181-192` and `StorageTab.tsx:836-844`/`:485-503`
are **owned by the drive/dashboard lanes** — out of this lane's file-ownership
boundary, left untouched.
**inconsistent** `InfoButton` (click-triggered, keyboard-accessible) coexists with:
native HTML `title=` attributes (hover-only, no keyboard/touch access, unstyled) at
`DriveSelector.tsx:181-192` (Remember-this-drive toggle) and `StorageTab.tsx:836-844`
+ `:485-503` (Hidden badge and sync-status icons); and a hand-rolled hover-only
tooltip at `UserMenu.tsx:226-229,251-254` (AR/Turbo balance rows) that also has no
keyboard trigger. The `StorageTab` Hidden-badge copy is genuinely the best microcopy
in the app ("Hidden on Arweave — removed locally. Permanent storage can't be deleted;
the data still exists. Unhide to restore it to view.") — it's discoverability/access
that's broken, not the words.
**Fix:** replace every native `title=`/custom hover tooltip with `<InfoButton>`,
reusing the existing copy where it's already good.

### INFO-3 — Gateway setting has zero UI despite a fully wired backend
**Status: DONE (DESIGN-8, Settings+Gateway lane).** Added a "Gateway" section
to `Settings.tsx` (between Sync Folder and Account Export): a labeled text
input pre-filled with the persisted `config.gatewayHost` (or empty, showing
the `turbo-gateway.com` placeholder), a "Save Gateway" action, a "Reset to
Default" action (disabled once the field already reads the default), inline
error/success feedback, and an `InfoButton` using this doc's own suggested
copy. Persistence reuses the **existing** `config:set-gateway` IPC handler
and `config.setGateway` preload method (both already existed, already
enveloped per D-005, already validated via
`InputValidator.validateGatewayHost`) — no new IPC handler was needed or
added. New behavioral tests: `tests/unit/components/settings-gateway.test.tsx`
(placeholder/prefill, successful save, `{success:false}` validator-error
surfaced in place, client-side empty-host guard, reset-to-default, and the
disabled-when-already-default state).
`src/main/gateway.ts`, `config:set-gateway` IPC, `AppConfig.gatewayHost` all exist;
no control anywhere in `Settings.tsx` · **missing-info-bubble** (the whole control is
missing, not just its bubble) Per SYNC-17, the backend is done; there's no way for a
user to ever see or change it from the UI.
**Fix:** add a "Network" section to Settings with the gateway field, a reset-to-
default action, and an `InfoButton` (see coverage table).

### INFO-4 — Dashboard header has zero explanatory tooltips
**Status: PARTIALLY DONE.** The "AR/Turbo balances (via `UserMenu`) have no
tooltips" half is resolved by INFO-2's `UserMenu.tsx` fix above (now
`InfoButton`, not zero). The Sync button and drive selector (`Dashboard.tsx`)
are **owned by the dashboard lane** — untouched here.
`src/renderer/components/Dashboard.tsx:700-753` · **missing-info-bubble** Sync button,
drive selector, and the AR/Turbo balances (via `UserMenu`) have no tooltips at all. A
first-run, non-crypto user sees a red "Sync" button and two currency figures with no
model for either.
**Fix:** add `InfoButton`s to the balance figures at minimum (ties to INFO-2's
UserMenu fix).

### INFO-5 — Upload Queue leaves "why does this need approval" and "estimate unavailable" completely unexplained
`src/renderer/components/UploadApprovalQueueModern.tsx:359,685-688` (estimate
unavailable) and the approval-queue concept itself (nowhere in the component) ·
**missing-info-bubble** On top of the Turbo/AR/FREE-badge gaps already in the
coverage table: "Estimate unavailable" never says *why* (Turbo quote service
unreachable) or what it means (cost unknown until retried); nothing explains why
uploads require approval at all.
**Fix:** wire the already-imported `InfoButton` (see INFO-1) on the cost banner and
add one line explaining the approval queue's purpose on first view.

### INFO-6 — "Winston" raw protocol jargon exposed with zero explanation
`src/renderer/components/turbo/TurboBalanceCard.tsx:53` · **broken (jargon leak)**
Winston is Arweave's smallest unit (like a satoshi) — an internal protocol term with
no meaning to any user without prior Arweave knowledge. Directly violates "unfamiliar/
crypto concepts must be explained."
**Fix:** drop the stat from the primary card (put it behind "show technical details"),
or add the `InfoButton` copy in the coverage table.

### INFO-7 — ArNS mentioned with a bare CTA and no in-app explanation
**Status: DONE (DESIGN-8, Settings+Gateway lane).** Added the suggested
`InfoButton` alongside the "Get your ArNS name" button (now wrapped in a
`.arns-prompt-row`, `user-menu.css`). Also added an `InfoButton` on the
wallet-address row (coverage-table "Wallet address" concept, previously
**Weak**) using that row's suggested copy.
`src/renderer/components/UserMenu.tsx:189-201` · **copy-clarity /
missing-info-bubble** Links out to `arns.ar.io` with zero context for what ArNS is —
a crypto-native user knows; a Dropbox-migrant user does not.
**Fix:** add an `InfoButton`: *"ArNS gives your wallet a memorable name instead of a
long address — like a domain name for Arweave."*

### INFO-8 — "What is a drive" and "drive vs. local sync folder" have no explanation anywhere reachable
`DriveSelector.tsx` header/dropdown, `CreateDriveModal.tsx` title,
`AddExistingDriveModal.tsx:196-202` (auto-creates a subfolder with no explanation of
the relationship) · **missing-info-bubble** The only existing explanation
(`DriveManager.tsx:97-99`) is dead code, unreachable. These two foundational concepts
aren't in the 16-concept table below (they're closer to onboarding vocabulary than a
single tooltip-able fact), but they're real, repeated gaps worth fixing in the same
pass.
**Fix:** *"A drive is your own permanent storage space on Arweave — like a top-level
folder that lives on the network forever. This local folder is just a mirror of it;
you can move or delete the folder without affecting the drive."*

### Info-bubble coverage table

Every concept the four critiques flagged as needing explanation, where it shows up,
whether it's explained today, and suggested copy. `Have` = a real, accessible
explanation already exists · `Weak` = some copy exists but isn't accessible/complete ·
`Missing` = no explanation anywhere.

| Concept | Surface(s) | Status | Suggested `InfoButton` copy |
|---|---|---|---|
| **Permanence / irreversibility** | Welcome tagline (`WalletSetup.tsx:296-298`), `CreateDriveModal.tsx` (absent), `AddExistingDriveModal.tsx` (absent), Activity stream (no "Permanent" chip on completed uploads), Overview Rename quick action (cost modal explains it only after commitment) | **Missing** almost everywhere it matters most — the one place it's said at all is a single unelaborated sentence on the welcome screen | *"Once uploaded to Arweave, files can't be edited or deleted — by you or anyone else, including ArDrive. That's the whole point: your files outlive any single company or server."* |
| **Turbo Credits** (what it is, vs. AR) | `UserMenu.tsx:279-282` nav item (still missing — see note), `UserMenu.tsx` Balances row (**DONE**, DESIGN-8 Settings/Gateway lane — this exact copy), Upload Queue balance row (imported `InfoButton` unused), `TurboAboutTab` (have, good) | **Have** in two places now, still missing at the Upload Queue row and the `UserMenu` nav item (that nav item is a single full-width `<button>` — an `InfoButton` can't nest inside it without an invalid nested-interactive-control; would need a layout change out of this lane's minimal-diff scope) | *"Turbo Credits are prepaid, instant-upload credits you buy with a card — no crypto wallet required."* |
| **Free upload under 100 KiB** (100 × 1024 bytes, confirmed `turbo-utils.ts:5-6`) | Upload Queue "FREE" badge (`:654-655`, unexplained), Overview rename-cost modal (have, good: *"This operation is under 100KB and qualifies for free upload via Turbo"*) | **Have** in Overview, **missing** in Upload Queue | *"Files under 100 KiB upload free via Turbo Credits."* |
| **Permaweb** | Storage tab — literally titled "Permaweb" in the nav, `InfoButton` imported but never rendered | **Missing** — the tab name is undefined jargon | *"Permaweb = Arweave's permanent web. Every file here is stored forever — it can be hidden from view but never truly deleted."* |
| **Hidden ≠ deleted** | Storage tab badge (`:836-844`, excellent copy, delivered via native `title=` only), Activity tab (plain inline text, no chip), Download Queue "make cloud-only" (nothing) | **Weak** — right words, wrong/inconsistent widget | Promote Storage's existing copy into a real `InfoButton`; give Activity the same pill treatment. |
| **cloud_only** ("make cloud-only" / cancel download) | Storage tab menu (native `title=` only), `DownloadQueueTab.tsx:440` button (nothing) | **Missing/weak** | *"Cloud-only files stay stored permanently on Arweave but won't take up space on this device."* |
| **Manifest (ArFS)** | `OverviewTab.tsx:480-493` quick action (nothing), `CreateManifestModal.tsx:284-286` title (no bubble; one paragraph at `:312-324` explains it but isn't a tooltip and never says "permanent") | **Missing/partial** | *"A manifest publishes an index of every file in this folder as one shareable webpage — anyone with the link can browse your files without installing ArDrive."* |
| **Tx IDs / "view on Arweave"** | `OverviewTab.tsx:384-396` Drive ID row (copy button, no explanation), `OverviewTab.tsx:466-478` Export Metadata (CSV of tx IDs, unexplained), Activity/Storage detail modals (raw values + external links) | **Missing** | *"This is the permanent Arweave transaction ID — a receipt you can use to verify or view this file directly on the network, forever."* |
| **Private vs. public drive** | `WelcomeBackScreen.tsx:264-274,301-309` badges (unexplained), `CreateDriveModal.tsx:220-247` (two-word subtitles only, no permanence framing), `OverviewTab.tsx:345` vs `:359` (Lucide icon then raw-emoji fallback, inconsistent) | **Missing** almost everywhere except thin two-word hints | Public: *"Anyone with the link can view these files, forever. Don't use this for anything sensitive."* Private: *"Files are encrypted with your password before they ever leave your device. ArDrive never sees or stores this password."* |
| **Drive fingerprint** (emoji sequence) | `WelcomeBackScreen.tsx:292-299`, `PrivateDriveUnlockModal.tsx:139-145` — also renders as tofu boxes on some fonts with no text fallback | **Missing entirely** | *"This emoji sequence is a visual fingerprint of your drive's encryption key. It should look identical every time you unlock this drive — if it changes, stop and don't enter your password."* |
| **Remember-this-drive** (key persistence) | `DriveSelector.tsx:181-192` (native `title=` only), `PrivateDriveUnlockModal.tsx:220-225` (have, good, explained inline with an opt-out) | **Have** in one place, **weak/inaccessible** in the other | Reuse the good copy: *"Your drive's decryption key is stored encrypted on this device, so you won't be asked for this password again here. Turn off anytime."* |
| **Gateway** | `Settings.tsx` "Gateway" section (**DONE**, DESIGN-8 Settings/Gateway lane) | **Have** — see INFO-3 | *"Gateway — the server ArDrive uses to reach the Arweave network. Default: turbo-gateway.com. Change this only if uploads or downloads are failing."* |
| **Profiles** | `ProfileManagement.tsx`, `ProfileSwitcher.tsx`, `UserMenu.tsx` "Switch Profile" (action now wired — see POLISH-20 — but still no concept bubble; same nested-button constraint as the Turbo Credits nav item above) | **Missing** — never defined for a first-time user | *"A profile is a separate encrypted wallet + settings on this device. Use multiple profiles to keep different Arweave accounts fully isolated."* |
| **Wallet address** | `AddressDisplay.tsx:11` (label only: "Your Arweave Address (public)"), `UserMenu.tsx` profile row (**DONE**, DESIGN-8 Settings/Gateway lane — this exact copy) | **Have** in `UserMenu`; `AddressDisplay.tsx` (out of this lane's ownership) still label-only | *"This is your public wallet address — safe to share. It's used to receive AR tokens and to prove you own your uploads. It is not a secret."* |
| **AR vs. Turbo** | `TurboAboutTab.tsx` comparison table (have, good — but undercut by the TRUST-2 "Enterprise Ready" overclaim sitting right next to it), `TurboBalanceCard` (conflates them, see TRUST-6) | **Have**, but trust-undermined | Fix TRUST-2/TRUST-6 first; the explanatory copy itself is fine. |
| **Winston** | `TurboBalanceCard.tsx:53` | **Missing** (see INFO-6) | *"Winston is the smallest unit of AR — like a satoshi for Bitcoin. 1 AR = 10^12 Winston."* |

---

## Theme 6 — Design-system integrity

Violations of the design system's own rules that resolve correctly today (via the
legacy-token bridge or by accident) but represent debt that breaks silently the
moment an assumption changes.

### DSI-1 — Legacy token names remain in ≥6 files, with 3 different spellings for "danger" alone
`CreateManifestModal.tsx`, `DriveAndSyncSetup.tsx`, `SyncFolderSetup.tsx`,
`DriveManager.tsx`, `ProfileSwitcher.tsx:307-768` (styled via an inline `<style>` tag,
not even a dedicated CSS file), `ProfileManagement.tsx:214,327-330` · **inconsistent**
All reference `--ardrive-primary`, `--gray-50..900`, `--success-600`, `--error-500/
600/50/200/700`, `--warning-*`, `--red-50/200/700` instead of the DESIGN-SYSTEM.md §1
semantic names. These resolve correctly only via the `styles.css` bridge layer, which
§8.4 says is meant to be temporary — when it's deleted, these files break first, with
`ProfileSwitcher`'s inline `<style>` block breaking least visibly (nothing greps it as
"unmigrated" the way a `.css` file would). Three different spellings for "danger" in
active use (`--error-*`, `--danger-*`, `--red-*`) means a future contributor has no
single answer for "how do I show an error."
**Fix:** port to semantic token names; standardize on `--danger`/`--danger-fg`/
`--danger-surface` and delete the `--error-*`/`--red-*` aliases once callers move.

### DSI-2 — Brand red / status hues used for benign, non-alert UI (4 sites)
**Status: PARTIALLY DONE (DESIGN-8, Foundation + Settings/Gateway lanes).**
Foundation lane fixed one additional shared/token-level instance this pass
turned up: `styles.css`'s `.sync-progress-bar` (the fill inside
`SyncProgressDisplay.tsx`, rendered from `DriveAndSyncSetup.tsx`) used
`var(--ardrive-primary)` (brand red) for an ordinary "sync in progress" bar —
remapped to `var(--info)`, matching the already-correct
`.progress-fill.download` convention elsewhere in the file.
**Settings/Gateway lane fixed its named site:** `settings.css:141-145`'s
`.settings-icon` now uses `var(--icon-mid)` instead of `var(--ardrive-primary)`
— every section icon (Sync Folder, the new Gateway, Account Export, About) is
neutral now, not brand-red; verified in both themes (the icon reads as a
plain gray glyph, not a call-to-action, alongside the still-correctly-red
primary "Change Folder"/"Save Gateway" buttons). The remaining 2 sites
(`StorageTab.tsx` inline styles, `turbo-credits.css`) and the aesthetic note
on `CreateDriveModal.tsx` are **owned by other lanes** — out of this lane's
strict file ownership, left untouched per instructions ("if unsure, leave and
note it").
**inconsistent** Status hues are reserved for actual state signals; using them
decoratively teaches users to distrust the "something's wrong" signal.
- `StorageTab.tsx:485-503` — "downloading"/"uploading" (ordinary, expected states) use
  `--ardrive-primary-600` (brand red) instead of `--info` (blue); only "synced"
  (green) and "error" (red) are correctly status-colored.
- `src/renderer/styles/turbo-credits.css:41-43` — `.tcm-header-icon` colors a purely
  decorative `Zap` icon with `--ardrive-warning` (amber).
- `src/renderer/styles/settings.css:141-145` — `.settings-icon` colors every section
  icon (including the purely informational "About" section) brand-red, making every
  row look like a call-to-action.
- `CreateDriveModal.tsx` privacy-card "selected" state also uses brand red — see the
  aesthetic note below: on the Create Drive screen, a red-selected "Private" card sits
  above an amber warning banner next to red CTA buttons; nothing reads calm-neutral.
**Fix:** `--info` for in-progress states; a neutral/brand-adjacent (not warning) tone
for the decorative Turbo icon; `--icon-mid`/`--icon-high` for neutral settings icons;
a quieter selection indicator (not red) for "this is chosen" vs. "this is dangerous."

### DSI-3 — Raw emoji mixed into the lucide-react icon system (2 sites)
**inconsistent**
- `OverviewTab.tsx:345` vs `:359` — uses the Lucide `Lock`/`Globe` component in the
  card header, then falls back to raw emoji text (`🔒 Private`/`🌐 Public`) 14 lines
  later for the identical concept. Emoji also carry real cross-platform "tofu box"
  risk — visible in `reconciled-design6-overview-{LIGHT,DARK}.png`, where the lock
  emoji renders as an empty glyph box.
- `TurboAboutTab.tsx:121-159` — the "Turbo vs. Traditional Arweave" comparison table
  uses 12 raw emoji (⏳⚡🪙💳💰🆓📈📊❌✅🔧🎯) as its entire icon system, while every
  other icon in the app is a stroke-matched `lucide-react` SVG.
**Fix:** drop the emoji fallback in Overview; replace the comparison-table emoji with
matched lucide icons (`Clock`, `Zap`, `CreditCard`, `Coins`, `DollarSign`,
`TrendingUp`, `Check`, `X`, `Wrench`, `Target`), colored via status tokens.

### DSI-4 — Three parallel "status pill" implementations for one concept
`common/StatusPill.tsx` (used only in Upload Queue), `.detail-badge-*` classes
(`styles.css:4939-4967`, used in Activity/Storage detail modals), and an ad hoc
inline-style pill (`StorageTab.tsx:1317-1335`, hand-rolled rather than reusing either)
· **inconsistent**
**Fix:** consolidate onto one pill component — extend `StatusPill` to cover file-sync
states, or the reverse.

### DSI-5 — Cancel-button class disagreement across sibling modals
`CreateDriveModal.tsx:331`, `AddExistingDriveModal.tsx:210`,
`PrivateDriveUnlockModal.tsx:239` use `className="button outline"` for Cancel;
`CreateManifestModal.tsx:426,601` uses `className="button secondary"` for the same
semantic action — which also trips DARK-2's invisible-text bug. · **inconsistent**
**Fix:** standardize every modal Cancel/Back on `button outline`.

### DSI-6 — Dead/unreachable components duplicate the bugs of their live siblings
**Status: DONE (DESIGN-8, Foundation lane).** Deleted all three:
`SecurityStatus.tsx`, `DriveManager.tsx`, `ProfileSelection.tsx`. Verified zero
references first — repo-wide grep (`src/`, `tests/`, all `.ts`/`.tsx`/`.js`)
for each component name matched only the file's own definition, both before
and re-confirmed after deletion; `typecheck`/`build`/`test` all still pass.
This also resolves DSI-6's own POLISH-23 cross-reference (duplicate "remember
me"/spinner code in the now-deleted `ProfileSelection.tsx`) and clears
`DriveManager.tsx`'s slice of DSI-1's legacy-token debt for free. Did not
restyle-and-wire `SecurityStatus.tsx` per the doc's alternate option — that's
a product decision (surfacing it in password setup) beyond a dark-mode/DS-
integrity fix, left for a future pass. Also found (but did NOT delete, since
it isn't named in this doc): `StoredFilesBrowser.tsx` is equally
unreferenced anywhere in the repo — worth a DSI-6 follow-up entry.
`src/renderer/components/SecurityStatus.tsx` (not imported anywhere; ships Tailwind-
shaped classes — `text-green-600`, `bg-gray-50`, `list-disc`, `hover:opacity-80` —
that don't exist in this app's CSS, so it'd render as unstyled black-on-white text if
ever mounted), `DriveManager.tsx` (unreachable; carries the DARK-1 white-background
bug plus an MVP-era "Private (Soon)" disabled toggle), `ProfileSelection.tsx`
(845 lines, unreferenced outside its own file, duplicates ~80% of
`ProfileManagement.tsx` with its own DARK-1-style white-background bugs at
`~449,474,635`, its own under-explained "Remember me" checkbox, and delete-copy that
breaks the app's calm tone with ALL-CAPS/emoji panic — *"🚨 THIS ACTION CANNOT BE
UNDONE!"* — inconsistent with `WalletExport`'s measured register for equally serious
warnings) · **inconsistent / broken-if-reached**
`SecurityStatus.tsx`'s actual content (keychain/Touch-ID/Credential-Manager
reassurance) is exactly the kind of trust signal worth having during password setup —
worth restyling and surfacing deliberately rather than leaving as dead weight.
**Fix:** delete all three, or — for `SecurityStatus` only — restyle and wire it into
the password-setup step on purpose.

### DSI-7 — Focus ring skips `:focus-visible` and the shared focus token
`src/renderer/components/common/ExpandableSection.tsx:88-91` · **inconsistent**
(polish-adjacent) `.section-header:focus { outline: 2px solid
var(--ardrive-primary); ... }` fires on every click, not just keyboard focus, unlike
every other migrated interactive element (buttons, inputs, `InfoButton`, drive
modals), and uses `--ardrive-primary` instead of the dedicated `--focus-ring` token.
**Fix:** `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset:
2px; }`.

### DSI-8 — Onboarding never adopted the type-scale tokens; global `h1`/`h2` still render at the legacy scale
`WalletSetup.tsx`, `WelcomeBackScreen.tsx`, `SetupSuccessScreen.tsx` (raw inline
`fontSize` on every heading/body string — WalletSetup: 16 occurrences across 12-15px;
WelcomeBackScreen: 12 across 12-32px; SetupSuccessScreen: 18 across 13-32px; zero use
of `var(--text-h1..caption)` anywhere despite `theme.css` defining the full scale),
plus `styles.css:255-270`'s global `h1`/`h2` rule still rendering at the legacy scale
(30px/24px, weight 600) instead of the DESIGN-SYSTEM spec (36px/28px, weight 700) —
per §8 note 4 that migration was explicitly deferred, but onboarding is the one
surface DESIGN-3 claims to have restyled. Also, the Private/Public badge
(`WelcomeBackScreen.tsx:301-309`) doesn't follow the §6.8 badge spec: `--radius-sm`
(a rectangle, not `--radius-pill`), a raw `'12px'` font-size instead of
`--text-caption`, no explicit weight. · **inconsistent**
**Fix:** replace ad-hoc px/weight literals with `var(--text-h1..caption)` + the
documented weight map; fix the badge to `--radius-pill`/`--text-caption`/weight 600.

*(`--radius-xl`'s dark-vs-light split is the same class of bug — a cascade/load-order
issue — and is counted once, under DARK-4.)*

---

## Theme 7 — Copy & permanence

Permanence — the one thing that makes this product different from Dropbox — is
stated once in passing and never reinforced. Several flows also actively undersell or
misstate what "permanent" means at the exact moments it matters most.

### COPY-1 — `CreateDriveModal` never mentions permanence for either privacy option
`src/renderer/components/CreateDriveModal.tsx:216-249` · **copy-clarity** The
Public/Private cards say only "Anyone can view" / "End-to-end encrypted" — two words
each. No mention that a Public drive's files are permanently, publicly visible
forever, even though the older `DriveAndSyncSetup.tsx:441-448` flow already says
exactly this with an `InfoButton`.
**Fix:** add the permanence sentence + an `InfoButton` to both cards (see the
coverage table's "private vs. public" row).

### COPY-2 — No disclosure that the Public/Private choice is permanent
`CreateDriveModal.tsx` (nowhere) · **copy-clarity** Nowhere does it say the choice
can't be changed after the drive is created — a direct miss for a critique whose
whole brief is "surface irreversibility before commitment."
**Fix:** one line under the privacy cards: *"This can't be changed after the drive is
created."*

### COPY-3 — No cost information anywhere in drive creation
`CreateDriveModal.tsx` (entire component) · **copy-clarity** Creating a drive is a
real (if small) on-chain transaction. `CreateManifestModal.tsx:544-574` and the
Rename-drive surface both show a proper "FREE with Turbo Credits / AR cost / Turbo
balance" breakdown; `CreateDriveModal` shows none of it — users have no idea if
clicking "Create Drive" spends anything.
**Fix:** reuse the existing cost-callout pattern here too.

### COPY-4 — "Replaced with a new version" undersells what permanence means for old manifests
`src/renderer/components/CreateManifestModal.tsx:321-323` · **copy-clarity** The old
manifest's transaction isn't gone — it's retrievable forever by its tx ID; only the
"current" name/pointer moves. As written, it reads like an ordinary overwrite, which
undercuts the app's own permanence story.
**Fix:** *"...the old version stays permanently accessible by its transaction ID, but
this name will now point to the new one."*

### COPY-5 — Sync-status widget's "uploaded" doesn't distinguish submitted vs. permanently confirmed
`src/renderer/components/Dashboard.tsx:963-971` · **copy-clarity** `{count} uploaded`
is vaguer than the vocabulary the app already uses elsewhere (`ActivityTab.tsx:
899-901` has explicit `completed`/`failed` badges; `StorageTab.tsx:839` explicitly
talks about permanence). A file can be "uploaded" (submitted) before it's actually
confirmed on Arweave.
**Fix:** rename to "confirmed"/"permanent" if that's what the count represents, or
split submitted vs. confirmed if it isn't yet.

### COPY-6 — Sync direction ("bidirectional") is hardcoded and never surfaced
`CreateDriveModal.tsx:142`, `AddExistingDriveModal.tsx:85`,
`DriveAndSyncSetup.tsx:201`, `SyncFolderSetup.tsx:72` all hardcode
`syncDirection: 'bidirectional' as const` with zero UI exposure · **copy-clarity**
A user has no way to learn their drive syncs both ways — i.e. that a local delete, or
a remote change, can propagate — because it's never surfaced anywhere.
**Fix:** one line in the setup summary: *"Files sync both ways between this folder
and your drive."*

### COPY-7 — Welcome screen's "permanent"/"decentralized web" tagline is the app's biggest unexplained concept
`src/renderer/components/WalletSetup.tsx:293-298` · **copy-clarity** The single most
important mental-model shift for a Dropbox user ("forever, no delete") is stated once
in passing, with zero elaboration anywhere in the entire onboarding flow. See the
INFO coverage table's "permanence" row for suggested copy — this is the highest-value
single fix in the whole sweep.

### COPY-8 — Rename Drive quick action gives no upfront cost/permanence cue
`src/renderer/components/dashboard/OverviewTab.tsx:429-445` · **copy-clarity** The
cost-confirmation modal (`:565-673`) only reveals "this is paid and permanent" after
the user has already committed to the flow and typed a new name. A Dropbox user's
default mental model is "rename = free, instant, local."
**Fix:** a small muted caption on the quick-action row itself, e.g. "· writes a
permanent record."

### COPY-9 — "Wallet" and "account" are used interchangeably with no acknowledgment they're the same thing
`src/renderer/components/WalletSetup.tsx:293-360` · **copy-clarity** Buttons say
"Create New Account"/"Import Existing Account"; the drop zone says "Select Wallet
File"; the toggle says "Wallet File"; the CTA says "Import Wallet" — zero
acknowledgment these are the same concept, which is precisely the kind of thing the
brief calls out as needing explanation.
**Fix:** add an `InfoButton` on step 1: *"Your ArDrive account is powered by a
cryptographic wallet. There's no company-side password reset: your wallet + recovery
phrase together are your account."*

### COPY-10 — Password-loss warning omits the actual safety net
`src/renderer/components/WalletSetup.tsx:369-401` · **copy-clarity** "There is no way
to recover this password if you forget it" appears *before* the user has even seen
the recovery phrase (step 2 vs. step 3), and never mentions that re-importing via the
recovery phrase lets you set a brand-new password (`handleImport` confirms this path
exists). As written, a user reads "forget password = lose everything," which is
inaccurate and needlessly frightening.
**Fix:** *"If you forget this password, your recovery phrase (shown next) can restore
access with a new password — but there's no way to reset just the password itself.
Keep both safe."*

### COPY-11 — Password-encryption tooltip is inconsistent between Create and Import
`WalletSetup.tsx:378` vs `:748` · **copy-clarity** Create: *"This password encrypts
your wallet file. You'll need it every time you sign in, and it will never leave your
computer."* Import: *"Choose a password to encrypt your wallet on this device."* The
import version drops the "never leaves your computer" reassurance.
**Fix:** use one shared tooltip string for both flows.

### COPY-12 — "Recovery phrase" vs. "seed phrase" used interchangeably app-wide
`Settings.tsx:126` ("recovery phrase") vs. `WalletExport.tsx:48` ("Seed Phrase") vs.
`ProfileSelection.tsx:410` ("12-word recovery phrase") · **copy-clarity** Pick one
term; a non-crypto user benefits from exactly one name for this concept.
**Fix:** standardize on "recovery phrase" (the more plain-language of the two) app-wide.

### COPY-13 — "Skip Setup" doesn't say what it skips to
`src/renderer/components/WelcomeBackScreen.tsx:408-419` · **copy-clarity** No
tooltip/subtext explains the consequence — does the user land on an empty dashboard?
No drive configured? Presented as a peer option next to "Continue with Selected
Drive," a returning user can't make an informed choice from the label alone.
**Fix:** small caption under the button: *"You can add a drive anytime from the
dashboard."*

### COPY-14 — No clipboard-security note when copying the recovery phrase
`src/renderer/components/common/SeedPhraseDisplay.tsx:125-146` · **copy-clarity**
`allowCopyWhenHidden` lets a user copy the recovery phrase to the OS clipboard without
ever visually revealing it — nice privacy feature, but no accompanying note that
clipboard managers/history can retain sensitive data.
**Fix:** inline note under the Copy button: *"Copied — remember to clear your
clipboard history after pasting somewhere safe."*

### COPY-15 — Completed uploads render identically to completed downloads — no "Permanent" reinforcement
`src/renderer/components/dashboard/ActivityTab.tsx` (whole stream) · **copy-clarity**
DESIGN-SYSTEM.md §6.8 calls out `"Permanent"` (green) as the canonical example badge,
and the brief asks for permanence to be *felt* — but a completed upload shows just a
filename, no positive confirmation chip. This is the exact screen that could
reinforce "this file is now stored forever" and currently doesn't.
**Fix:** small green "Permanent ✓" chip on completed uploads.

---

## Theme 8 — Polish

Nitpicks. Each is cheap; most should be swept up opportunistically by whichever lane
already has the file open (noted per item) rather than dispatched as standalone work.

### POLISH-1 — Password field's autoFocus outline reads as an error before any error exists
`common/PasswordInput.tsx:36-46` + `styles.css:868-872`, `WalletSetup.tsx:380` ·
**polish** `--focus-ring: #D31721` is in the same hue family as `--danger`. Because
the Create-Account password field has `autoFocus`, the first thing a new user sees
after clicking "Create New Account" is a password box with a solid red outline —
before typing anything. *(Bundle with Lane E — same file as several COPY items.)*
**Fix:** drop `autoFocus` on this screen, or give text-input `:focus` a distinct,
non-error-adjacent treatment.

### POLISH-2 — Dead "getting started guide" link
`src/renderer/components/WalletSetup.tsx:352-361` · **polish** `href="#"` on the very
first screen, offered specifically to a confused newcomer. The app already has a real
pattern for this (`TurboCreditsManager.tsx:257`'s `helpUrl`,
`common/ErrorMessage.tsx:26`'s `mailto:`). *(Bundle with Lane E.)*
**Fix:** point to a real docs.ardrive.io page using the existing convention.

### POLISH-3 — Emoji in the confirmation screen's H1 undercuts the "sleek/permanent" tone
`src/renderer/components/SetupSuccessScreen.tsx:84` · **polish** "🎉 Your Drive Is
Ready...!" — a party-popper emoji in the largest, boldest text on the confirmation
screen. *(Bundle with Lane E.)*
**Fix:** use a `CheckCircle`/`Shield`-style icon (already used at line 74) instead.

### POLISH-4 — Toggle icons don't match their concepts
`src/renderer/components/WalletSetup.tsx:571,580` · **polish** "Wallet File" uses a
`Key` icon (reads as password/security); "Recovery Phrase" uses a `Hexagon` icon (no
established association with a word list). *(Bundle with Lane F.)*
**Fix:** `FileText`/`FileJson` for "Wallet File" (already used elsewhere on this
screen); `KeyRound`/`ListOrdered` for "Recovery Phrase."

### POLISH-5 — Same `Shield` icon marks both advisory and critical warnings
`WalletSetup.tsx:390-401,467-486,762-773` · **polish** Relies entirely on color to
distinguish "important" from "critical, irreversible." *(Bundle with Lane F.)*
**Fix:** `AlertTriangle` for the danger/critical box (recovery-phrase loss) to
differentiate from the softer advisory box.

### POLISH-6 — An 8-character password the app's own meter calls "weak" is allowed through with no confirmation
`common/PasswordStrengthIndicator.tsx` + `WalletSetup.tsx:415` · **polish** The
Create-Account button disables only on `password.length < 8`, so a "weak"-rated
password can be submitted with no soft warning — notable given the password can
never be reset. *(Bundle with Lane E.)*
**Fix:** a lightweight "Use anyway?" confirmation, or require "fair" or better.

### POLISH-7 — No password minimum-length hint before typing
`common/PasswordInput.tsx` / `common/PasswordForm.tsx` · **polish** The 8-character
minimum isn't stated until after typing starts or the button silently stays disabled.
*(Bundle with Lane E.)*
**Fix:** small helper text under the label: "At least 8 characters."

### POLISH-8 — No "success" input state
`common/PasswordInput.tsx` / `styles.css:851-893` · **polish** DESIGN-SYSTEM.md §6.2
documents five text-input states including a green-border Success state; password
fields here only ever implement Error. *(Bundle with Lane F.)*
**Fix:** add the Success state when both passwords match and meet length.

### POLISH-9 — Import step overflows the app's own default window size
`src/main/main.ts:246-247` (1000×700 default) · **polish** Confirmed via
`5-import-LIGHT-with-hover.png`/`6-import-DARK-with-hover.png`: the wallet-file drop
zone + password fields + warning box requires scrolling before reaching Submit, with
the warning box visibly clipped at the fold. *(Bundle with Lane E.)*
**Fix:** tighten vertical rhythm (e.g. collapse the repeated Security Notice box) or
verify against the actual default size, not a larger dev monitor.

### POLISH-10 — No loading reassurance during Import, unlike Create
`WalletSetup.tsx:408-419` vs. `:436-446` · **polish** Create shows "This may take a
moment while we generate your secure wallet..."; Import has no equivalent despite
likely similar crypto-derivation time. *(Bundle with Lane E.)*

### POLISH-11 — Drive names truncate mid-word in the header dropdown despite spare room
`drive-selector.css:20,88` (`min-width: 200px` on both button and dropdown) ·
**polish** Screenshots show "Private Drive ..." / "Work Docum..." with ~250px of
unused space in a 1280px-wide header. *(Bundle with Lane F.)*
**Fix:** widen to ~260px and/or decouple the dropdown's width from the button's.

### POLISH-12 — Privacy icons are too subtle for a security-relevant signal
`drive-selector.css:147-162` (`opacity: 0.6`, 14px, `--icon-mid`) · **polish**
Public-vs-private is arguably the single most consequential fact about a drive,
relegated to a barely-visible icon. *(Bundle with Lane F.)*
**Fix:** full opacity, and/or pair with a text label ("Private"/"Public").

### POLISH-13 — Sync-status widget isn't clickable and has no `aria-live`
`src/renderer/components/Dashboard.tsx:928-974`,
`src/renderer/styles/dashboard-shell.css:102-113` · **polish** `position: fixed`, no
close/collapse affordance, not clickable to open Activity, no `aria-live` on status
text that changes as files sync. *(Bundle with Lane D — same a11y concern as A11Y-2.)*
**Fix:** make the widget clickable → Activity tab; add dismiss/minimize; add
`aria-live="polite"`.

### POLISH-14 — Emoji-fingerprint has no text fallback if glyphs fail to render
`src/renderer/components/PrivateDriveUnlockModal.tsx:139-145` · **polish** Renders as
tofu boxes in the Linux screenshot environment — likely a font-availability artifact,
but there's no fallback if it happens on a real target machine, which is worse than
nothing for a security cue meant to help users spot a wrong-drive situation.
*(Bundle with Lane C — same fix session as the fingerprint's info-bubble, see coverage
table.)*
**Fix:** verify on Win/Mac; add a text fallback regardless.

### POLISH-15 — Character-limit color feedback is implemented in one drive-name field but not its sibling
`DriveAndSyncSetup.tsx:408` (warns near the limit) vs. `CreateDriveModal.tsx:211-213`
(always neutral) · **polish** *(Bundle with Lane F.)*
**Fix:** apply the same near-limit color rule in both, or extract one shared
`<CharCounter>` component.

### POLISH-16 — Upload Queue tab shows a redundant double attention-signal
`src/renderer/components/Dashboard.tsx:793-799`,
`src/renderer/styles/dashboard-tabs.css:103-136` · **polish** Sets both `count`
(numeric pill) and `badge:'attention'` (colored dot) simultaneously for the same
signal. *(Bundle with Lane A.)*
**Fix:** keep the count; it's more informative than a bare dot.

### POLISH-17 — Overview's two-column grid doesn't collapse responsively
`src/renderer/components/dashboard/OverviewTab.tsx:335-340`
(`gridTemplateColumns: '1fr 1fr'`) · **polish** On a narrowed window, Drive Info and
Quick Actions (five stacked buttons) get cramped side by side rather than stacking.
*(Bundle with Lane A.)*

### POLISH-18 — The tab literally named "Overview" surfaces no at-a-glance sync health
`src/renderer/components/dashboard/OverviewTab.tsx` (whole tab) · **polish**
(information-layout) No pending-upload or failed-item count anywhere — a user with a
failed upload has to know to check Activity or Upload Queue instead. *(Bundle with
Lane A.)*
**Fix:** add a small "needs your attention" summary (pending/failed counts) to
Overview.

### POLISH-19 — In-progress activity rows show a bare percentage with no label
`src/renderer/components/dashboard/ActivityTab.tsx:711-718` · **polish** A bare `63%`
reads ambiguous ("63% of what?") out of context. *(Bundle with Lane A.)*
**Fix:** add a word, e.g. "63% uploaded."

### POLISH-20 — Settings and profile management are two disconnected entry points
**Status: DONE (DESIGN-8, Settings+Gateway lane) — via a different, arguably
better root fix than the one originally proposed.** Investigating the "add a
deep-link" fix turned up the real cause: `UserMenu.tsx` already received
`onSwitchProfile`/`onAddProfile`/`profileCount` props from `Dashboard.tsx`
(wired to a real `handleSwitchProfile`/`ProfileSwitcher` flow there) — but
never rendered a single control that called them. `ProfileSwitcher` was
unreachable dead code app-wide; `Users`/`Plus`/`Edit` icon imports sat unused
in `UserMenu.tsx` alongside it. Rather than adding a new deep-link *from*
Settings, wired a "Switch Profile" menu item directly into `UserMenu.tsx`'s
final menu section, immediately above "Settings" — same dropdown, one row
apart, zero new props or cross-component wiring needed (everything required
was already threaded down, just unused). `onAddProfile`/`onCreateDrive`
remain unused (a separate "Add Profile" action would duplicate
`ProfileSwitcher`'s own add-profile affordance; `onCreateDrive` is a
drive-management action, judged out of this lane's Settings/Gateway/UserMenu
scope) — flagged here rather than wired speculatively.
`Settings.tsx` (whole file) vs. `UserMenu.tsx:212-221` · **polish**
(information-architecture) No cross-link between "Settings" (sync folder/export/
about) and "Manage Profiles" (separate `ProfileSwitcher` action) — a Dropbox-caliber
app typically treats "Account" as one place. *(Bundle with Lane C or F, whichever
touches Settings.tsx first.)*
**Fix:** add a "Profiles" section to Settings that deep-links to profile management.

### POLISH-21 — The 23% AR→Turbo conversion fee is disclosed but not explained
`src/renderer/components/turbo/TurboPurchaseTab.tsx:122-129` · **polish** Good
disclosure of the number and timing, but doesn't say *why* the fee is so high
(conversion goes through the open market) — a suspicious user might reasonably want
to know before converting real tokens. *(Bundle with Lane C — same file as Turbo
info-bubble work.)*

### POLISH-22 — "Private Key" export doesn't clarify it's a different artifact from the Keyfile
`src/renderer/components/WalletExport.tsx:53-59` · **polish** A non-crypto user has
no way to know "Private Key" and "Keyfile" aren't the same thing (one is a raw key,
one is a JSON structure containing it). Low priority — this screen is already gated
behind multiple warnings. *(Bundle with Lane E.)*

### POLISH-23 — Duplicate "remember me"/loading-spinner implementations between `ProfileManagement` and the dead `ProfileSelection.tsx`
`ProfileManagement.tsx:139-147` vs. `ProfileSelection.tsx:232-242,457-465` ·
**polish** Two components solving the identical "loading profiles" spinner and
"remember me" checkbox with diverging code/copy quality; low stakes since
`ProfileSelection` is dead (see DSI-6), but flags the duplication. *(Resolved for
free once DSI-6's delete happens — Lane B.)*

---

## Execution plan — 6 dispatchable lanes

Lanes are ordered by the priority scheme above, not by size. "Quick win" = mechanical/
localized (token swap, copy edit, wiring an existing component) with low regression
risk; "bigger" = needs a shared abstraction, new data wiring, or touches many call
sites.

| Lane | Scope | Items | Size |
|---|---|---|---|
| **A — DESIGN-5 restyle** | Finish the Upload Approval Queue + Download Queue + Turbo Credits Manager restyle: legacy→semantic tokens, column headers, off-brand glow, balance-message color, dead search/filter wiring, CreateManifestModal's modal-shell port + debug-log removal. Sweeps in: POLISH-16/17/18/19 (same files). | RESTYLE-1..8 (8) + 4 polish sweep-ins | **Bigger** — largest lane by file-touch count; RESTYLE-9 (hover-handler fix) can be done here in the same pass since it's the same files |
| **B — Dark-mode + `styles.css` dead-block purge** | Token-swap every hardcoded `white`/literal color to the correct surface/overlay/input token (DARK-1, 11+ sites); fix `.button.secondary` (DARK-2); delete or rename the two dead `.file-icon` blocks (DARK-3); resolve the `--radius-xl` split-brain (DARK-4); delete the 3 dead components carrying the same bugs (DSI-6, which also clears POLISH-23 for free). | DARK-1..4 (4) + DSI-6 (1) | **Quick win** for the token swaps (mechanical, same recipe as the already-shipped "F7" fix); **medium** for DARK-3/4 (need cascade investigation before deleting). **Status:** DONE for the shared/global-foundation slice (DESIGN-8 "Foundation" implementer pass) — DARK-2/3/4 fully done; DARK-1 done for onboarding/setup + Wallet Export only (Turbo/Upload/Download surfaces remain for the parallel restyle lane); DSI-6 fully done (all 3 components deleted); one DSI-2 site (`.sync-progress-bar`) fixed as a bonus find. `typecheck`/`lint`/`build`/`test` all pass. |
| **C — Info-bubble distribution pass** | Wire the already-built, accessible `InfoButton` onto ~20 surfaces per the coverage table; standardize on it over native `title=`/custom hover tooltips (INFO-2); build the missing Gateway Settings UI (INFO-3, bigger — new control, not just a bubble). Sweeps in: POLISH-14 (fingerprint fallback, same session as its bubble), POLISH-20/21 (same files). | INFO-1..8 (8) + 16-concept table + 3 polish sweep-ins | **Quick win** for wiring existing `InfoButton`s (cheapest fix in this whole sweep); **bigger** only for INFO-3 (Gateway UI doesn't exist yet). **Status:** DONE for the **Settings + Gateway** slice (DESIGN-8 Settings/Gateway implementer pass): INFO-3 (Gateway UI, reusing the existing `config:set-gateway` IPC — no new handler needed), INFO-2's `UserMenu.tsx` sites, INFO-7 (ArNS), the Wallet-address coverage-table row, half of the Turbo Credits row, and POLISH-20 (via wiring UserMenu's dead `onSwitchProfile` prop rather than a Settings-side deep-link) all landed, plus DSI-2's `settings.css` site. INFO-1/4/5/6, POLISH-14/21, and the remaining coverage-table rows (Permanence, Permaweb, Hidden≠deleted, cloud_only, Manifest, Tx IDs, Private/public, Drive fingerprint, Remember-this-drive) are **dashboard/drive/turbo surfaces out of this lane's file ownership** — still open for a future pass. |
| **D — Modal a11y + hover-control keyboard reach** | Escape/backdrop-click/focus-trap on `CreateDriveModal`/`AddExistingDriveModal`/`CreateManifestModal` (ideally one shared `<DriveModal>` wrapper); WelcomeBackScreen radio fix; ActivityTab context-menu keyboard reach; label/input `htmlFor` pairs; onboarding `<h1>` promotion. Sweeps in: POLISH-13 (same a11y concern as A11Y-2). | A11Y-1..5 (5) + 1 polish sweep-in | **Quick win** for A11Y-1/4/5 (small, contained diffs); **bigger** for A11Y-3 if done as a shared wrapper (recommended — do it once, not 3x) |
| **E — Trust & copy fixes** | Every Theme 1 (trust/honesty) and Theme 7 (copy/permanence) item — mostly copy edits, a few conditional/data-wiring fixes (TRUST-1's fake stats, TRUST-3's validator wiring). Sweeps in the onboarding-adjacent Theme 8 polish items that live in the same files (POLISH-1/2/3/6/7/9/10/22). | TRUST-1..6 (6) + COPY-1..15 (15) + 8 polish sweep-ins | **Quick win** for the vast majority (localized copy/conditional fixes); **bigger** only for TRUST-1 if real usage counters are wired instead of a "Coming soon" swap, and COPY-5 if submitted-vs-confirmed needs new state tracking |
| **F — Design-system integrity** | Token-naming consolidation (DSI-1), status-hue misuse (DSI-2), emoji→lucide (DSI-3), status-pill consolidation (DSI-4), Cancel-button standardization (DSI-5), focus-visible fix (DSI-7), onboarding type-scale migration (DSI-8). Sweeps in: POLISH-4/5/8/11/12/15 (same consistency theme). | DSI-1..8 minus DSI-6 (7, since DSI-6 moved to Lane B) + 6 polish sweep-ins | **Quick win** for DSI-2/3/5/7 (small, mechanical); **bigger** for DSI-1 (6+ files) and DSI-8 (3 files, full type-scale pass) |

**Suggested dispatch order:** B and E first (both are almost entirely quick wins and
fix the two categories — visible breakage and dishonest copy — that damage trust
fastest); C next (cheap, high-value, no new abstractions needed except the Gateway
UI); A and D can run in parallel once B/C/E land, since they touch mostly-disjoint
files; F last, as genuine low-risk cleanup with no user-facing urgency.
