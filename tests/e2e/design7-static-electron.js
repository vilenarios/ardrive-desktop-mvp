/* eslint-disable no-console, @typescript-eslint/no-var-requires */
'use strict';
/**
 * DESIGN-7 static render via the Electron binary (no browser download, no
 * network, no on-chain drive) — same pattern as DESIGN-4's
 * dashboard-static-electron.js. Loads the design7-*.html harness pages,
 * which link the REAL src/renderer/styles.css and, through its @imports,
 * the real styles/modal.css (DESIGN-7), styles/user-menu.css, and
 * styles/settings.css. Captures full-page light + dark screenshots for
 * each page.
 *
 * Run: node_modules/.bin/electron tests/e2e/design7-static-electron.js
 */
const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = '/mnt/c/source/ardrive-design-review';
const W = 1280;

const PAGES = [
  { file: 'design7-drive-modals.html', name: 'drive-modals' },
  { file: 'design7-screens.html', name: 'screens' },
  { file: 'design7-usermenu-settings-toasts.html', name: 'usermenu-settings-toasts' }
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(win, page, theme) {
  nativeTheme.themeSource = theme; // drives prefers-color-scheme
  await win.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true;`
  );
  // Generous wait: on these tall (2000px+) pages the software rasterizer
  // (no GPU in this sandbox — see the TU/MESA warnings at startup) can take
  // well over 500ms to fully repaint after a theme swap. A short sleep here
  // previously caused capturePage() to grab a partially-painted frame that
  // looked like the *other* theme (proven by a debug harness: same bug
  // reproduced with a 300-500ms wait, gone at 2000ms).
  await sleep(3500);

  const full = await win.webContents.capturePage();
  const outFile = path.join(OUT, `design7-${page.name}-${theme.toUpperCase()}.png`);
  fs.writeFileSync(outFile, full.toPNG());
  console.log('[ok]', outFile);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  for (const page of PAGES) {
    // Start with a generous default height, measure the real rendered
    // document height, then resize the window's content area to match
    // exactly — avoids guessing a fixed height and clipping content.
    const win = new BrowserWindow({
      width: W,
      height: 1000,
      useContentSize: true,
      show: false,
      // backgroundThrottling: false — without this, Chromium throttles
      // painting on a hidden/unfocused window, so capturePage() after the
      // theme switch can return a stale (pre-switch) frame instead of a
      // fresh repaint.
      webPreferences: { offscreen: false, backgroundThrottling: false },
      backgroundColor: '#000000'
    });
    await win.loadFile(path.resolve(__dirname, page.file));
    await sleep(400);

    const measuredHeight = await win.webContents.executeJavaScript(
      'Math.ceil(document.documentElement.scrollHeight)'
    );
    win.setContentSize(W, Math.max(measuredHeight, 200));
    await sleep(3500);

    for (const theme of ['light', 'dark']) {
      await capture(win, page, theme);
    }
    win.close();
  }

  console.log('DONE');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
