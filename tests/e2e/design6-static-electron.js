/* eslint-disable no-console, @typescript-eslint/no-var-requires */
'use strict';
/**
 * DESIGN-6 static render via the Electron binary (no browser download, no
 * network, no on-chain drive — the same pattern DESIGN-4/DESIGN-7 used).
 * Loads tests/e2e/design6-{overview,activity,storage}-static.html — each
 * links the REAL app src/renderer/styles.css and, through its @imports,
 * the DESIGN-6-touched styles/activity-tab.css and styles.css rules — and
 * captures light + dark full-page shots per tab, plus a bonus modal crop
 * for Overview and Activity (not part of the required 6, but shows the
 * biggest raw-hex-to-token cleanups in this item).
 *
 * Run: node_modules/.bin/electron tests/e2e/design6-static-electron.js
 */
const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, 'artifacts', 'design6-static');
const W = 1280;
const H = 900;

const PAGES = [
  { name: 'overview', file: 'design6-overview-static.html', modalSelector: '.design6-modal-demo' },
  { name: 'activity', file: 'design6-activity-static.html', modalSelector: '.design6-modal-demo' },
  { name: 'storage', file: 'design6-storage-static.html', modalSelector: null }
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capturePageWithRetry(win, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await win.webContents.capturePage();
    } catch (e) {
      console.warn('  capturePage retry', i, e.message);
      await sleep(500);
    }
  }
  return win.webContents.capturePage();
}

async function captureTab(win, page, theme) {
  nativeTheme.themeSource = theme; // drives prefers-color-scheme
  await win.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true;`
  );
  await sleep(400);

  const full = await capturePageWithRetry(win);
  const fullFile = path.join(OUT, `design6-${page.name}-${theme.toUpperCase()}.png`);
  fs.writeFileSync(fullFile, full.toPNG());
  console.log('[ok]', fullFile);

  if (page.modalSelector) {
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(page.modalSelector)}).classList.add('is-visible'); true;`
    );
    await sleep(300);
    const modalShot = await capturePageWithRetry(win);
    const modalFile = path.join(OUT, `design6-${page.name}-modal-${theme.toUpperCase()}.png`);
    fs.writeFileSync(modalFile, modalShot.toPNG());
    console.log('[ok]', modalFile);
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(page.modalSelector)}).classList.remove('is-visible'); true;`
    );
    await sleep(150);
  }
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // A fresh BrowserWindow per page — reusing one window across multiple
  // loadFile() calls made the offscreen render surface intermittently
  // unavailable to capturePage() on the second navigation in this sandbox.
  for (const page of PAGES) {
    console.log('[page] starting', page.name);
    const win = new BrowserWindow({
      width: W,
      height: H,
      show: false,
      webPreferences: { offscreen: false },
      backgroundColor: '#000000'
    });
    console.log('[page] window created', page.name);
    await win.loadFile(path.resolve(__dirname, page.file));
    console.log('[page] loadFile resolved', page.name);
    await sleep(900);
    for (const theme of ['light', 'dark']) {
      console.log('[page] capturing', page.name, theme);
      await captureTab(win, page, theme);
    }
    console.log('[page] done', page.name);
    // Deliberately not destroying/closing the window here — doing so
    // crashed this sandboxed software-rendering Electron mid-run. Keep all
    // windows alive; app.quit() below tears everything down at once.
  }

  console.log('DONE');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
