# ArDrive Desktop — Design System (DESIGN-1)

Status: **SIGNED OFF 2026-07-03 (D-024).** This is the desktop-app translation of ArDrive's
canonical design language (Flutter `ardrive_ui` + the public marketing site) into web/CSS terms. It is
the source of truth for the DESIGN track: **DESIGN-2** implements these tokens as a CSS-variable theme
layer + ThemeProvider; **DESIGN-3..7** restyle each surface against it.

Everything below is CSS-ready (real hex, px, ms). Every value is cited to its origin so implementers can
trace a decision back to the source.

## Sources & how they relate

| Source | Path / URL | Role |
|---|---|---|
| **ardrive_ui — new tokens** | `ardrive-web/packages/ardrive_ui/lib/src/styles/colors/colors_new.dart` | Canonical modern token system: `Primitives` (grey/red ladders + transparency overlays) + `ArDriveColorTokens` (container L0–L3, text high→xlow, stroke, button states, input, icon). **Primary basis for this spec.** |
| **ardrive_ui — legacy semantic** | `.../colors/sematic_colors.dart`, `.../colors/global_colors.dart` | Older `ArDriveColors` (light() + dark()). Source of the **status colors** (success/warning/error/info) and the fullest **light theme**. |
| **ardrive_ui — type** | `.../styles/fonts/typography_new.dart` (+ `typography.dart`) | Wavehaus type scale (desktop + mobile). |
| **ardrive_ui — sizing/shadow** | `.../constants/size_constants.dart`, `.../styles/shadows/shadows.dart` | Radii, button/modal sizes, 5-step elevation. |
| **ardrive_ui — components** | `.../components/{button,card,modal,text_field_new,tab_view,feedback_message}.dart` | Component idioms + states. |
| **App theme** | `ardrive-web/lib/theme/{colors,theme}.dart` | App-level ThemeData; confirms brand red `#FE0230`. |
| **Public site** | `https://ardriveapp.github.io/public-site/` — CSS bundle `_next/static/css/6c5b808e039ec18b.css` | The sleek/modern marketing finish. Fumadocs `--color-fd-*` token set (dark). **Fetched via curl** (WebFetch's markdown conversion strips CSS; the raw bundle was pulled directly). |
| **Style guide** | `docs/branding/ardrive-styleguide.png` | Visual confirmation: Wavehaus weights, red accent, dark canvas, green/blue/red status, pill toasts, "Permahills" wireframe motif. |
| **Current desktop (to replace)** | `src/renderer/styles.css` + `src/renderer/styles/*.css` | Currently an **off-brand Tailwind-ish palette** (`#dc2626` red, `#10b981` emerald, `#3b82f6` blue) + Apple system fonts. DESIGN-2 replaces this wholesale. |

**Convergence is strong.** The public site and `ardrive_ui` independently agree on the core palette,
which gives us confidence in the tokens below:

| Concept | Public site (`--color-fd-*`) | ardrive_ui origin | Chosen token |
|---|---|---|---|
| Primary / CTA | `--fd-primary: 211 23 33` = **#D31721** | `colors_new` `buttonPrimaryDefault` = `solidRed700` **#D31721** | `--brand #D31721` |
| Bright accent | `--fd-accent: 254 2 48` = **#FE0230** | legacy `themeAccentBrand` = `red.500` **#FE0230** | `--accent #FE0230` |
| Success | `--color-ardrive-success: 24 169 87` = **#18A957** | `green.500` **#18A957** | `--success #18A957` |
| Info | `--color-ardrive-info: 49 66 196` = **#3142C4** | `blue.600` **#3142C4** | `--info #3142C4` |
| Dark canvas | `--fd-background: 18 18 18` = **#121212** | `solidGrey800` **#121212** (container L2) | `--surface #121212` |
| Dark card | `--fd-card: 30 30 30` = **#1E1E1E** | `solidGrey700`/`L3` ≈ #171717–#1F1F1F | `--surface-raised #1E1E1E` |
| Text primary (dark) | `--fd-foreground: 250 250 250` = **#FAFAFA** | `textHigh`/`iconHigh` ≈ #E0E0E0–#FFFFFF | `--text-primary #FAFAFA` |
| Border (dark) | `--fd-border` = white @ 12% | `strokeMid` = `transparent100_12` (white 12%) | `--border rgba(250,250,250,.12)` |

---

## 1. Color tokens

Two brand reds are intentional (both canonical, both used by the public site):

- **`--brand` = `#D31721`** — the workhorse: primary buttons, primary CTAs, focus ring, active nav.
  (public `--fd-primary`/`--fd-ring`; `colors_new` `buttonPrimaryDefault`.)
- **`--accent` = `#FE0230`** — the bright highlight: logomark, the 6px red line atop cards/modals,
  selected-state emphasis, "permanent" callouts. Higher energy, use sparingly.
  (public `--fd-accent`; legacy `themeAccentBrand`; style-guide "Base / Accent" swatch.)

### 1.1 Semantic tokens — Dark theme (default)

```css
:root, :root[data-theme="dark"] {
  /* Surfaces — elevation ladder (colors_new container L0–L3 + public fd-*) */
  --surface-sunken:   #0D0D0D; /* wells, inset areas — colors_new containerL1 (solidGrey900) */
  --surface:          #121212; /* app canvas / page bg — containerL2 (solidGrey800) = fd-background */
  --surface-raised:   #1E1E1E; /* cards, panels, sidebars — fd-card (≈ containerL3 #171717 / legacy #1F1F1F) */
  --surface-overlay:  #242424; /* modals, menus, popovers, dropdowns — fd-popover */
  --surface-inset:    #2A2A2A; /* hover row / muted fill — fd-muted */

  /* Text (colors_new textHigh→textXLow; primary lifted to fd-foreground for crispness) */
  --text-primary:     #FAFAFA; /* fd-foreground (textHigh is #E0E0E0 — see §1.4 note) */
  --text-secondary:   #A6A6A6; /* textMid (solidGrey200) ≈ fd-muted-foreground #A0A0A0 */
  --text-tertiary:    #7D7D7D; /* textLow (solidGrey300) */
  --text-disabled:    #5E5E5E; /* textXLow-ish (solidGrey400) */
  --text-on-brand:    #FFFFFF; /* colors_new textOnPrimary (solidGrey50) */
  --text-link:        #FAFAFA; /* colors_new textLink (underlined; see Button/tertiary) */

  /* Brand + accent */
  --brand:            #D31721; /* buttonPrimaryDefault / solidRed700 / fd-primary */
  --brand-hover:      #C0151E; /* buttonPrimaryHover / solidRed600 */
  --brand-active:     #9A1118; /* buttonPrimaryPress / solidRed500 */
  --brand-disabled:   #2E2E2E; /* buttonDisabled / solidGrey600 */
  --accent:           #FE0230; /* fd-accent / legacy themeAccentBrand */

  /* Borders / strokes (colors_new stroke* = white-on-dark transparency) */
  --border:           rgba(250,250,250,0.12); /* strokeMid / fd-border */
  --border-subtle:    rgba(250,250,250,0.08); /* strokeLow */
  --border-strong:    rgba(250,250,250,0.16); /* strokeHigh */

  /* Inputs (colors_new inputDefault/inputDisabled) */
  --input-bg:         #0D0D0D; /* inputDefault (solidGrey900) */
  --input-bg-disabled:#121212; /* inputDisabled (solidGrey800) */
  --input-border:     var(--border);
  --input-placeholder:#7D7D7D;

  /* Icons (colors_new iconLow/Mid/High) */
  --icon-low:         #5E5E5E;
  --icon-mid:         #A6A6A6;
  --icon-high:        #FFFFFF;

  /* Status — hue shared across themes; -fg = accessible text/icon, -surface = tint bg */
  --success:          #18A957; /* green.500 = ardrive-success */
  --success-fg:       #5DC389; /* green.400 — readable on dark */
  --success-surface:  rgba(24,169,87,0.16);
  --warning:          #FFBB38; /* yellow.500 */
  --warning-fg:       #FFCF74; /* yellow.400 */
  --warning-surface:  rgba(255,187,56,0.16);
  --danger:           #FE0230; /* red.500 = accent doubles as error, per style guide */
  --danger-fg:        #E95C7B; /* red.400 — readable on dark (legacy dark themeErrorFg) */
  --danger-surface:   rgba(254,2,48,0.16);
  --info:             #3D53F5; /* blue.500 (brighter on dark; #3142C4 also valid) */
  --info-fg:          #8B98F9; /* blue.300 */
  --info-surface:     rgba(61,83,245,0.16);
  --on-status:        #000000; /* text on solid warning fill (themeWarningOnWarning = black) */

  /* Overlay scrim + focus */
  --overlay:          rgba(8,8,8,0.72);  /* modal backdrop — transparent900_64+ / legacy overlay black */
  --focus-ring:       #D31721;           /* fd-ring */

  /* Shadow ink (shadows.dart: dark shadowColor #0D0D0D @ 0.9) */
  --shadow-ink:       rgba(13,13,13,0.9);
}
```

### 1.2 Semantic tokens — Light theme

Light theme comes from `ArDriveColors.light()` + `ArDriveColorTokens.lightMode()` (the public site is
dark-only). In light, elevation reads through **shadow**, not just fill; surfaces stay high-key.

```css
:root[data-theme="light"] {
  /* Surfaces (lightMode container L0–L2 + legacy BgCanvas/BgSurface) */
  --surface-sunken:   #EBEBEB; /* containerL1 (solidGrey100 light) — wells */
  --surface:          #F7F7F7; /* containerL0 (solidGrey50 light) ≈ legacy BgCanvas #FCFCFC — page bg */
  --surface-raised:   #FFFFFF; /* legacy BgSurface (white) — cards/panels */
  --surface-overlay:  #FFFFFF; /* modals/menus */
  --surface-inset:    #F1EFF0; /* hover row — legacy light tableTheme.cellColor */

  /* Text (lightMode textHigh→textXLow; primary deepened for contrast) */
  --text-primary:     #1F1F1F; /* solidGrey1000 light (textHigh is #3B3B3B; see §1.4) */
  --text-secondary:   #4F4F4F; /* textMid (solidGrey700 light) */
  --text-tertiary:    #666666; /* textLow (solidGrey600) */
  --text-disabled:    #8A8A8A; /* textXLow (solidGrey500) */
  --text-on-brand:    #FFFFFF;
  --text-link:        #4F4F4F; /* lightMode textLink */

  /* Brand + accent (buttonPrimary* lightMode — see §1.4 note re: hover) */
  --brand:            #D31721; /* buttonPrimaryDefault / solidRed700 */
  --brand-hover:      #B8141C; /* DEVIATION: darken (lightMode token lightens to #DF565D — see §1.4) */
  --brand-active:     #9A1118;
  --brand-disabled:   #CECECE; /* buttonDisabled lightMode (solidGrey300) */
  --accent:           #FE0230;

  /* Borders (lightMode stroke*: black-on-light transparency / grey300) */
  --border:           rgba(0,0,0,0.10);  /* strokeMid (transparent900_16≈) */
  --border-subtle:    rgba(0,0,0,0.06);  /* strokeLow */
  --border-strong:    #CECECE;           /* strokeHigh (solidGrey300) */

  /* Inputs (lightMode inputDefault #EBEBEB; legacy input bg white for form fields) */
  --input-bg:         #FFFFFF;
  --input-bg-disabled:#EBEBEB;
  --input-border:     #CECECE;
  --input-placeholder:#8A8A8A;

  /* Icons */
  --icon-low:         #8A8A8A;
  --icon-mid:         #666666;
  --icon-high:        #4F4F4F;

  /* Status — same hues; -fg deepened to pass AA on light (matches legacy light() choices) */
  --success:          #18A957;
  --success-fg:       #11763D; /* green.600 — AA text on white (green.500 fails, see §1.5) */
  --success-surface:  #E8F6EE; /* green.100 */
  --warning:          #FFBB38;
  --warning-fg:       #B38327; /* yellow.600 — legacy light themeWarningFg */
  --warning-surface:  #FFF8EB; /* yellow.100 */
  --danger:           #FE0230;
  --danger-fg:        #DF1642; /* red.600 — legacy light themeErrorFg; AA on white */
  --danger-surface:   #FCE8EC; /* red.100 */
  --info:             #3142C4; /* blue.600 — AA text on white */
  --info-fg:          #3142C4;
  --info-surface:     #ECEEFE; /* blue.50 */
  --on-status:        #000000;

  --overlay:          rgba(0,0,0,0.48);
  --focus-ring:       #D31721;
  --shadow-ink:       rgba(48,49,51,0.10); /* shadows.dart: light shadowColorLight #303133 @ 0.1 */
}
```

### 1.3 Primitive ladders (reference — not consumed directly by components)

Components should use the **semantic** tokens above. These raw ladders exist so DESIGN-2 can add new
semantic tokens without inventing colors. All from `colors_new.dart` (`Primitives`) unless noted.

**Grey — dark mode** (`Primitives.darkMode`): `50 #FFFFFF · 100 #E0E0E0 · 200 #A6A6A6 · 300 #7D7D7D · 400 #5E5E5E · 500 #424241 · 600 #2E2E2E · 700 #171717 · 800 #121212 · 900 #0D0D0D · 1000 #080808 · 1100 #000000`

**Grey — light mode** (`Primitives.lightMode`): `50 #F7F7F7 · 100 #EBEBEB · 200 #DEDEDE · 300 #CECECE · 400 #BABABA · 500 #8A8A8A · 600 #666666 · 700 #4F4F4F · 800 #3B3B3B · 900 #262626 · 1000 #1F1F1F · 1100 #000000`

**Red — dark mode**: `100 #150203 · 200 #260406 · 300 #4D080C · 400 #730D12 · 500 #9A1118 · 600 #C0151E · 700 #D31721 · 800 #D42C35 · 900 #DF565D · 1000 #E78086 · 1100 #F7D5D7`

**Red — light mode**: `100 #FCF9FA · 200 #F7D2D4 · 300 #F2B6B9 · 400 #ED9A9F · 500 #E78086 · 600 #DF565D · 700 #D31721 · 800 #D42C35 · 900 #C0151E · 1000 #4D080C · 1100 #150203`

**Status hue ladders** (legacy `global_colors.dart`, theme-independent, for tints/scales):
- Blue: `50 #ECEEFE · 300 #8B98F9 · 500 #3D53F5 · 600 #3142C4 · 900 #0C1131`
- Green: `100 #E8F6EE · 400 #5DC389 · 500 #18A957 · 600 #11763D · 800 #052211`
- Yellow: `100 #FFF8EB · 300 #FFE4AF · 500 #FFBB38 · 600 #B38327 · 800 #33250B`
- Red(status): `100 #FCE8EC · 300 #F2A2B3 · 400 #E95C7B · 500 #FE0230 · 600 #DF1642 · 800 #2D040D`

**Overlay transparency steps** (for hover/scrim math): white/black at `4% · 8% · 12% · 16% · 32% · 64%`
(`Primitives.transparent100_*` / `transparent900_*`). Dark hover fill = white 8–12%; light hover = black 8–12%.

**Toggle "on" green** = `#139310` (`theme.dart` `ArDriveToggleTheme.backgroundOnColor`). Map to a
`--toggle-on` if needed; otherwise use `--success`.

### 1.4 Design notes / deviations (for Phil)

**All resolved 2026-07-03 (D-024), confirmed as written below:** text-primary `#FAFAFA` kept · light-mode hover **darkens** (note 2) · dark uses the **lighter public-site ladder** (note 3) · danger = accent red kept.


1. **Text-primary (dark) uses `#FAFAFA`** (public site) rather than `colors_new textHigh #E0E0E0` — crisper,
   and it's what the marketing site ships. If you prefer softer text, swap to `#E0E0E0`.
2. **Brand hover in *light* theme lightens in the raw tokens** (`buttonPrimaryHover` = light `solidRed600`
   = `#DF565D`, lighter than the `#D31721` default). That's an unusual affordance on a light bg. This spec
   **deviates to `--brand-hover: #B8141C` (darken)** for a conventional, more accessible press feel. Flag
   if you'd rather stay literal to the token (`#DF565D`).
3. **Dark canvas depth.** `ardrive_ui`'s in-app canvas runs near-black (`containerL0 #080808` → `L2 #121212`);
   the public site sits a touch lighter (`#121212` bg / `#1E1E1E` cards). This spec anchors dark on the
   **public-site-aligned, slightly-lifted ladder** (`--surface #121212`, cards `#1E1E1E`) for the "sleek"
   marketing finish. If you want the app darker/near-black, drop `--surface` to `#0D0D0D` and cards to `#171717`.
4. **Danger == accent red (`#FE0230`).** The style guide uses the bright red for both the brand accent and
   error state. Kept as-is; error *text* uses `--danger-fg` (deepened) for contrast.

### 1.5 WCAG-AA contrast pairings (verified)

Foreground / background — ratio — verdict (AA normal ≥ 4.5, AA large/UI ≥ 3.0):

| Pair | Ratio | Verdict |
|---|---|---|
| `--text-primary #FAFAFA` on `--surface #121212` | ~17.4:1 | AAA |
| `--text-secondary #A6A6A6` on `#121212` | ~7.7:1 | AAA |
| `--text-tertiary #7D7D7D` on `#121212` | ~4.5:1 | AA (use for secondary/UI, not long body) |
| `--text-on-brand #FFFFFF` on `--brand #D31721` | ~7.4:1 | AAA |
| `--text-primary #1F1F1F` on light `--surface-raised #FFFFFF` | ~16.4:1 | AAA |
| `--text-secondary #4F4F4F` on `#FFFFFF` | ~7.9:1 | AAA |
| `--text-tertiary #666666` on `#FFFFFF` | ~5.5:1 | AA |
| `--success-fg #11763D` on `#FFFFFF` | ~5.5:1 | AA ✓ (note: `--success #18A957` as text ≈ 3.1:1 — **fills/icons only**) |
| `--info #3142C4` on `#FFFFFF` | ~8:1 | AAA |
| `--danger-fg #DF1642` on `#FFFFFF` | ~5:1 | AA ✓ (note: `--danger #FE0230` as text ≈ 4.0:1 — **fills/icons only**) |
| black `--on-status` on `--warning #FFBB38` | ~12:1 | AAA (warning fill takes **dark** text) |

Rule of thumb: **status hues (`--success`/`--warning`/`--danger`/`--info`) are for fills, icons, and
borders; use the `-fg` variant for text on a light surface.**

---

## 2. Typography

### 2.1 Family

**DECIDED (D-024): system fallback stack — Wavehaus is NOT bundled.** ArDrive's brand font Wavehaus
(`typography_new.dart` `fontFamily = 'Wavehaus'`) is a **proprietary geometric sans**; Electron's CSP means it
would have to ship as self-hosted woff2, and we are not clearing that licensing for the desktop app. So the
desktop uses the **system-font fallback stack** — clean and modern (what many desktop apps ship). Wavehaus stays
as an opportunistic first entry (honored only if a user/dev has it installed locally); we do not ship it, so the
effective font is `system-ui`.

- **Future brand-character upgrade (optional, not now):** if we later want more distinctiveness than system fonts,
  a **free OFL-licensed geometric sans** close to Wavehaus's feel — e.g. **Manrope** or **Inter** — is a drop-in:
  self-host the woff2 (freely bundleable, no licensing issue), prepend to `--font-sans`. No token changes needed.
- **Font stack** (system-first; tail matches the public site's `--font-body`):
  ```css
  --font-sans: 'Wavehaus', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  ```

Weight map (Wavehaus's numeric names → CSS `font-weight`, per `pubspec.yaml:44-55` and the style guide):

| Wavehaus | CSS weight | Role |
|---|---|---|
| 28 Thin | 300 | rare / decorative |
| 42 Light | 400 | rare |
| **66 Book** | **500** | **base body weight** (ArDrive's default is 500, not 400) |
| **95 SemiBold** | **600** | labels, buttons, emphasis (`ArFontWeight.semiBold`) |
| **128 Bold** | **700** | headings (`ArFontWeight.bold`) |
| **158 ExtraBold** | **800** | display / hero (style-guide "158 ExtraBold") |

Note the ArDrive quirk: **body regular = 500**, not 400. Set `body { font-weight: 500; }` — system fonts render
this as medium, preserving ArDrive's slightly-heavier body feel with no font files. (If a webfont is added later
per the upgrade note above, map its Book/Medium→500, SemiBold→600, Bold→700, ExtraBold→800.)

### 2.2 Type scale (desktop)

From `ArDriveDesktopTypography` (`typography_new.dart:49`). Line-heights are literal from source
(headings ≤ h3 use 1.3; h4–h6 use 1.4; body uses 1.5). Web headings add `letter-spacing: 0.5px`
(`typography.dart:527` `letterSpacingHeadlines = kIsWeb ? 0.5 : -1`).

| Token | px (rem) | Weight | line-height | letter-spacing | Source | Use |
|---|---|---|---|---|---|---|
| `--text-display` | 45px (2.8125rem) | 800 | 1.3 | 0.5px | `display()` | page hero / splash |
| `--text-h1` | 36px (2.25rem) | 700 | 1.3 | 0.5px | `heading1()` | screen title |
| `--text-h2` | 28px (1.75rem) | 700 | 1.3 | 0.5px | `heading2()` | section title |
| `--text-h3` | 25px (1.5625rem) | 700 | 1.3 | 0.5px | `heading3()` | subsection |
| `--text-h4` | 22px (1.375rem) | 600 | 1.4 | 0 | `heading4()` | card title |
| `--text-h5` | 20px (1.25rem) | 600 | 1.4 | 0 | `heading5()` | panel heading |
| `--text-h6` | 18px (1.125rem) | 600 | 1.4 | 0 | `heading6()` | small heading |
| `--text-body-xl` | 18px (1.125rem) | 500 | 1.5 | 0 | `paragraphXLarge()` | lead paragraph |
| `--text-body-lg` | 16px (1rem) | 500 | 1.5 | 0 | `paragraphLarge()` | **button text (600)**, prominent body |
| `--text-body` | 14px (0.875rem) | 500 | 1.5 | 0 | `paragraphNormal()` | **default body** |
| `--text-body-sm` | 12px (0.75rem) | 500 | 1.5 | 0 | `paragraphSmall()` | secondary / dense |
| `--text-caption` | 11px (0.6875rem) | 500 | 1.5 | 0 | `caption()` | captions, timestamps, meta |
| `--text-mono` | 13px (0.8125rem) | 500 | 1.5 | 0 | (mono stack) | tx IDs, addresses, hashes, code |

Mobile/compact scale (if narrow windows matter — `ArDriveMobileTypography`, switch < 834px width):
display 30 · h1 28 · h2 26 · h3 23 · h4 21 · h5 19 · h6 16 · body 13 · caption 10.

Recommended defaults: `body { font: 500 14px/1.5 var(--font-sans); }`; headings `font-family: var(--font-sans); font-weight: 700;` (600 for h4–h6).

---

## 3. Spacing & layout

**Base unit: 4px** (public site `--spacing: .25rem`; matches the existing desktop scale in
`docs/developer/design-guidelines.md:91`). Use a fixed scale, not arbitrary px.

```css
--space-0: 0;
--space-1: 4px;    /* tight — icon gaps, chip padding */
--space-2: 8px;    /* component inner padding (ardrive_ui icon↔label gap = 8) */
--space-3: 12px;   /* element margins */
--space-4: 16px;   /* card/modal padding (ardrive_ui card & modal contentPadding = 16) */
--space-5: 20px;
--space-6: 24px;   /* section spacing (tab_view content gap = 28 ≈ 24–32) */
--space-8: 32px;   /* large gaps */
--space-10: 40px;
--space-12: 48px;  /* page margins */
--space-16: 64px;  /* hero / empty-state padding */
```

**Container widths / layout:**
- App content max width: **1280px** (`--wide` breakpoint from design-guidelines); center with auto margins.
- Modal widths (`size_constants.dart`): standard/mini/icon = **350px** (`--modal-w-standard`); long = **583px** (`--modal-w-long`).
- Grid gutter: **16px** default, **24px** for card grids.

**Breakpoints** (`docs/developer/design-guidelines.md:261`; ardrive_ui desktop/mobile split = 834):
```css
--bp-mobile: 640px;  --bp-tablet: 768px;  --bp-desktop: 1024px;  --bp-wide: 1280px;
```

---

## 4. Radii, elevation, borders

### 4.1 Radii (`size_constants.dart` + public `--radius-*`)

```css
--radius-sm:  4px;   /* buttons(legacy 3) & checkbox(3) rounded to 4; small chips */
--radius-md:  6px;   /* ArDriveButtonNew default (borderRadius: 6) = public --radius-md */
--radius-lg:  8px;   /* cards (cardDefaultBorderRadius: 8) = public --radius-lg */
--radius-xl:  12px;  /* modals (modalBorderRadius: 9, rounded up toward public --radius-xl 12) */
--radius-pill: 9999px; /* toasts, badges/pills, toggle track */
```
Guidance: **buttons `--radius-md` (6px)** · **inputs 6–8px** · **cards/panels `--radius-lg` (8px)** ·
**modals `--radius-xl`** · **pills/toasts `--radius-pill`**.

### 4.2 Elevation / shadows (`shadows.dart`)

Five steps; offset/blur are literal from source, ink from `--shadow-ink` (dark `rgba(13,13,13,0.9)`,
light `rgba(48,49,51,0.1)`).

```css
--elevation-1: 0 0 1px  var(--shadow-ink);   /* boxShadow20 — hairline lift */
--elevation-2: 0 2px 4px var(--shadow-ink);  /* boxShadow40 — resting card */
--elevation-3: 0 4px 8px var(--shadow-ink);  /* boxShadow60 — hover card, dropdown */
--elevation-4: 0 8px 16px var(--shadow-ink); /* boxShadow80 — modal / dialog (ardrive modals use shadow80) */
--elevation-5: 0 16px 24px var(--shadow-ink);/* boxShadow100 — top-level overlay */
```
On **dark**, cards lean on `--surface-raised` fill more than shadow; on **light**, shadow carries elevation.

### 4.3 Borders

Default border = `1px solid var(--border)` (`buttonBorderWidth: 1`). Use `--border-strong` for
hover/active edges and focused inputs; `--border-subtle` for low-emphasis dividers. Card border is
optional on dark (fill + shadow suffice); recommended `1px solid var(--border)` on light.

---

## 5. Motion

Durations and easings from the public site bundle (`--default-transition-duration: .15s`,
`--ease-in-out: cubic-bezier(.4,0,.2,1)`, `--ease-out: cubic-bezier(0,0,.2,1)`) and ardrive_ui
component animations (button hover slide = 100ms; card hover in design-guidelines = 0.2s).

```css
--motion-fast:     100ms; /* button/icon micro-interactions (ardrive_ui AnimatedSlide 100ms) */
--motion-base:     150ms; /* hover/color/opacity — the default */
--motion-moderate: 200ms; /* card hover, tab switch, expand/collapse */
--motion-slow:     300ms; /* modal enter/leave, route transitions */

--ease-standard:   cubic-bezier(0.4, 0, 0.2, 1);   /* default in/out */
--ease-out:        cubic-bezier(0, 0, 0.2, 1);      /* enter (decelerate) — modals, toasts in */
--ease-in:         cubic-bezier(0.4, 0, 1, 1);      /* exit (accelerate) */
```

Common transitions:
- **Hover** (bg/border/color): `transition: background-color var(--motion-base) var(--ease-standard), border-color var(--motion-base) var(--ease-standard);`
- **Modal**: backdrop fade `--motion-base`; panel `opacity` + `translateY(8px→0)`/`scale(.98→1)` over `--motion-slow` `--ease-out`.
- **Tab switch**: indicator/label color `--motion-moderate` `--ease-standard`.
- **Toast**: slide-in from edge + fade, `--motion-moderate` `--ease-out`; auto-dismiss.

**Reduced motion — required:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```
(Keep instantaneous state changes — just remove the tweening; never remove focus outlines.)

---

## 6. Component patterns

Each primitive lists the tokens it consumes, its states, and the `ardrive_ui` widget it mirrors. Sizes:
default control height **56px** (`buttonDefaultHeight`), compact/action height **32–40px**
(`buttonActionHeight: 32`; modal action buttons use 40).

### 6.1 Buttons — mirrors `ArDriveButtonNew` (`button.dart:256`)

Shared: `--radius-md` (6px), `--text-body-lg` weight 600, padding `10px 16px` (icon variants add
24px side padding), height 40–56px, `transition: var(--motion-base) var(--ease-standard)`. Focus:
`outline: 2px solid var(--focus-ring); outline-offset: 2px;`.

| Variant | Default | Hover | Active | Disabled | Text | Mirror |
|---|---|---|---|---|---|---|
| **Primary** | bg `--brand` | bg `--brand-hover` | bg `--brand-active` | bg `--brand-disabled`, text `--text-disabled` | `--text-on-brand` | `ButtonVariant.primary` |
| **Secondary** | bg `--surface-inset` (dark) / `--surface-sunken` (light), 1px `--border` | bg lighten via white/black 8–12% overlay | overlay 16% | as primary | `--text-link` / `--text-primary` | `ButtonVariant.secondary` (`buttonSecondary*`) |
| **Ghost / Outline** | transparent, 1px `--border` | bg white/black 8% + border `--border-strong` | bg 12% | text `--text-disabled` | `--text-primary` | `ButtonVariant.outline` (`buttonOutline*`, side `strokeMid→strokeHigh`) |
| **Danger** | bg `--danger` | darken (`--brand-active`-style step) | darker | `--brand-disabled` | `#FFFFFF` | primary recolored to `containerRed` |
| **Text / tertiary** | transparent, underlined label | no bg (transparent overlay) | — | `--text-disabled` | `--text-link` underline | `ArDriveTextButton` (`button.dart:222`) |

One primary action per screen (design-guidelines). Icon gap = `--space-2` (8px).

### 6.2 Text input — mirrors `ArDriveTextFieldNew` (`text_field_new.dart`) + style-guide "Forms"

- Container: bg `--input-bg`, 1px `--input-border`, `--radius-md`/`--radius-lg`, height ~44–48px, padding `--space-3` `--space-4`, text `--text-body-lg`, placeholder `--input-placeholder`.
- **States** (style-guide shows Normal / Focused / Success / Error / Disabled):
  - *Focus*: border `--focus-ring`, `outline: 2px solid var(--focus-ring); outline-offset: 1px;`.
  - *Success*: border `--success`, trailing check icon `--success` (style-guide green check).
  - *Error*: border `--danger`, message `--danger-fg`, trailing alert icon.
  - *Disabled*: bg `--input-bg-disabled`, text `--text-disabled`, no focus.
- Label above field in `--text-body-sm` weight 600 (`--text-secondary`); required marker uses `--accent`.

### 6.3 Card / panel — mirrors `ArDriveCard` (`card.dart:7`)

- bg `--surface-raised`, `--radius-lg` (8px), padding `--space-4` (16px), optional 1px `--border`, shadow `--elevation-2` (hover `--elevation-3`).
- **Accent-top variant** (`withRedLineOnTop`): a **6px `--accent` bar** flush to the top edge (top corners follow `--radius-lg`). Signature ArDrive treatment for primary/attention cards & modals.
- Interactive card: `cursor: pointer`, hover raises shadow + border → `--border-strong`, `transition: var(--motion-moderate) var(--ease-standard)`.

### 6.4 Modal / dialog — mirrors `ArDriveModalNew` (`modal.dart:34`)

- Panel: bg `--surface-overlay`, `--radius-xl`, shadow `--elevation-4`, max-width `--modal-w-standard` (350) or `--modal-w-long` (583). **6px `--accent` bar across the top** (top corners rounded).
- Body padding `--space-4`; **action row** bottom-right, padding `16px 16px 24px`, primary action = Primary button height 40. Secondary/Cancel to its left (design-guidelines modal footer convention).
- Backdrop: `--overlay` scrim, fade `--motion-base`; panel enter `--motion-slow` `--ease-out` (fade + translateY 8px). `Esc` closes; focus trap; return focus on close.

### 6.5 Tab bar — mirrors `ArDriveTabBar` (`tab_view.dart:108`)

- Track: height **40px**, `--radius-sm`+ (source uses 5px), bg `--surface` , 1px border `--surface-raised`/`--border`.
- Selected tab: indicator fill `--surface-inset` (dark `#2C2C2C` / light `#F1EFF0`), label `--text-primary` weight 600.
- Unselected tab: transparent, label `--text-tertiary` (`themeAccentDisabled`), hover → `--text-secondary`.
- Indicator color/position transitions `--motion-moderate` `--ease-standard`. Content area gap below tabs = `--space-6` (source 28px).

### 6.6 Toast / notification — mirrors `FeedbackMessage` (`feedback_message.dart`) + style-guide "Notifications"

- Pill-ish container, `--radius-md`/`--radius-pill`, padding `--space-2` `--space-4`, height ~50px, `--elevation-3`, text `--text-body` weight 600, trailing `×` dismiss (`--icon-mid`).
- Colored by kind: **Success** bg `--success-surface`, border/icon `--success`; **Warning** bg `--warning-surface`, icon `--warning` (dark text `--on-status` if solid fill); **Error** bg `--danger-surface`, border/icon `--danger`, text `--danger-fg`; **Info** bg `--info-surface`, icon `--info`.
- Enter: slide from edge + fade `--motion-moderate` `--ease-out`; auto-dismiss with pause-on-hover.

### 6.7 List / table row — mirrors `ArDriveDataTable` / `tableTheme`

- Table bg `--surface`, cell/row bg `--surface-raised` (dark `#1E1E1E`; legacy dark cell `#191919`), selected row `--surface-inset` (dark `#2C2C2C` / light `#F1EFF0`).
- Row: padding `--space-3` `--space-4`, 1px bottom `--border-subtle`, hover bg white/black 4–8% overlay, `--motion-base`. Header row: `--text-body-sm` weight 600 `--text-secondary`.
- Monospace columns (tx id, address) use `--text-mono` `--text-tertiary` with truncation + copy affordance.

### 6.8 Badge / pill / chip

- Padding `2px 8px`, `--radius-pill`, `--text-caption` weight 600. Neutral: bg `--surface-inset`, text `--text-secondary`. Status: `-surface` bg + `-fg` text (e.g. "Permanent" = `--success-surface`/`--success-fg`; "Pending" = `--warning-surface`/`--warning-fg`; "Failed" = `--danger-surface`/`--danger-fg`). Ensure color is not the *only* signal (icon or label too — design-guidelines a11y).

### 6.9 Checkbox / radio / toggle — style-guide "Forms"

- Checkbox: **18px** (`checkboxSize`), `--radius-sm` (3), unchecked 1px `--border` on `--input-bg`; checked bg `--brand`, white check; focus ring `--focus-ring`. Indeterminate = brand bar.
- Radio: 18px circle, same state colors.
- Toggle: track `--radius-pill`; off = `--surface-inset`/`--border`; **on = `--success`** (`#139310`/`#18A957`); knob `#FFFFFF`; `--motion-base` slide.

### 6.10 Signature motifs

- **Accent red top-bar** (6px) on hero cards & modals — the recurring ArDrive tell (`withRedLineOnTop`, `ArDriveModalNew`).
- **"Permahills"** — the wireframe topographic-mesh graphic (style-guide "Permahills", public-site `permahills.svg`). Use as a subtle hero/empty-state/footer background at low opacity; ship as an inlined SVG/data-URI asset (Electron CSP — no remote fetch). Do **not** let it reduce text contrast.
- **Logo**: red circular logomark + lowercase "ardrive" wordmark; light (white) wordmark on dark surfaces.

---

## 7. Application map (seeds DESIGN-3..7)

Which desktop surfaces use which tokens/components. Backlog owners in brackets.

| Surface | Backing components | Key tokens |
|---|---|---|
| **Onboarding / wallet setup** [DESIGN-3] | accent-top Card, Primary/Secondary buttons, Text input (recovery-phrase, password), Toast | `--surface`, `--surface-raised`, `--accent` top-bar, `--brand`, input tokens, `--text-display`/`--text-h2` |
| **Dashboard shell + tabs + drive selector** [DESIGN-4] | App frame (`--surface`), sidebar (`--surface-raised`), Tab bar, dropdown (drive selector), List rows | `--surface*`, `--border`, tab tokens, `--text-primary/secondary`, `--icon-*` |
| **Upload approval queue + Turbo/payments** [DESIGN-5] | List/table rows, Badges (status), Primary/Danger buttons, cost callout Card, progress bar (`--brand`) | `--surface-raised`, status `-surface`/`-fg`, `--brand`, `--warning` (cost), `--text-mono` (sizes/ids) |
| **Permaweb / activity / storage** [DESIGN-6] | Table rows, Badges (Permanent/Pending/Failed), Cards, Permahills empty-state | status tokens, `--success`/`--warning`/`--danger`, `--text-mono`, `--surface*` |
| **Settings** [DESIGN-7] | Section Cards, Toggles, Text inputs, Secondary/Ghost buttons, list items | `--surface-raised`, `--border`, toggle/input tokens, `--text-h5`/`--text-body` |
| **Modals (all)** [DESIGN-7] | `ArDriveModalNew` pattern, action row, backdrop | `--surface-overlay`, `--overlay`, `--accent` top-bar, `--elevation-4`, `--radius-xl` |
| **Toasts / notifications** [DESIGN-7] | `FeedbackMessage` pattern | status `-surface`/`-fg`, `--radius-pill`, `--elevation-3`, `--motion-moderate` |
| **User menu / profile switcher** [DESIGN-7] | dropdown/popover (`--surface-overlay`), list rows, avatar | `--surface-overlay`, `--surface-inset` hover, `--border`, `--text-*` |

---

## 8. Implementation note for DESIGN-2

**Goal:** one token source; a light/dark ThemeProvider; zero raw color literals outside the theme layer.

1. **Token layer** — create `src/renderer/styles/theme.css` (or `tokens.css`) defining the §1 tokens on
   `:root`/`:root[data-theme="dark"]` (default) and `:root[data-theme="light"]`, plus the theme-agnostic
   scale tokens (§2–5: `--space-*`, `--text-*`, `--radius-*`, `--elevation-*`, `--motion-*`, `--font-*`).
   Import it **first** in `styles.css` (before component CSS).
2. **ThemeProvider** — a React context that (a) reads OS preference (`matchMedia('(prefers-color-scheme: dark)')`,
   mirroring ardrive_ui's `onPlatformBrightnessChanged`), (b) allows a manual override persisted to config,
   and (c) sets `document.documentElement.dataset.theme = 'light' | 'dark'`. Components read tokens via CSS
   vars, so most never touch the context. Dark is the default (matches `themes.dart` default).
3. **Fonts** — NO font bundling (D-024): set `--font-sans`/`--font-mono` to the §2.1 system stack on
   `html,body`, and `body { font-weight: 500; }`. No `@font-face`, no font assets. (Optional future webfont per §2.1.)
4. **Migration of scattered CSS** — the current `src/renderer/styles.css` `:root` is an off-brand
   Tailwind-ish palette (`--ardrive-primary: #dc2626`, `--ardrive-success: #10b981`, `--ardrive-info: #3b82f6`,
   Apple system font). Strategy:
   - Replace that `:root` block with the new token layer.
   - **Bridge old → new** for a mechanical migration: alias legacy names to new tokens
     (`--ardrive-primary: var(--brand); --ardrive-surface: var(--surface-raised); --ardrive-text-primary: var(--text-primary); --ardrive-success: var(--success); --ardrive-danger: var(--danger); --ardrive-info: var(--info);` …). This lets `styles/*.css` and inline styles keep working while they're ported file-by-file, then delete the aliases.
   - Port the seven `styles/*.css` files + the ~39 components using inline `style={{}}` (grep `#[0-9a-fA-F]`, `rgb(`, `--ardrive-`, `--gray-`) to semantic tokens.
5. **Guardrail** — after migration, `grep -RInE '#[0-9a-fA-F]{3,8}|rgb\(' src/renderer --include=*.css --include=*.tsx` should be clean **except** `theme.css`. This is the designer agent's diff check and a DESIGN-2 acceptance gate.
6. **Sanity** — verify both themes on the dashboard + a modal + a toast; confirm the §1.5 contrast pairs;
   confirm reduced-motion (§5) disables transitions.

---

*DESIGN-1 deliverable. Cited to `ardrive-web` (`packages/ardrive_ui/**`, `lib/theme/**`) and the public
site CSS bundle. Signed off by Phil 2026-07-03 (D-024); DESIGN-2 implements the token layer from here.*
