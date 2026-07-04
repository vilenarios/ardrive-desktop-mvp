/* eslint-disable no-console, @typescript-eslint/no-var-requires */
'use strict';
/**
 * DESIGN-4 static render via the Electron binary (no browser download,
 * no network, no on-chain drive). Loads tests/e2e/dashboard-static.html —
 * which links the REAL app src/renderer/styles.css and, through its
 * @imports, the DESIGN-4 dashboard-shell.css / drive-selector.css /
 * dashboard-tabs.css — and captures light + dark full-page shots plus a
 * cropped open-drive-selector shot per theme.
 *
 * Run: node_modules/.bin/electron tests/e2e/dashboard-static-electron.js
 */
const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const HTML = path.resolve(__dirname, 'dashboard-static.html');
const OUT = path.resolve(__dirname, 'artifacts', 'dashboard-static');
const W = 1280;
const H = 900;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(win, theme) {
  nativeTheme.themeSource = theme; // drives prefers-color-scheme
  await win.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; true;`
  );
  await sleep(500);

  const full = await win.webContents.capturePage();
  const fullFile = path.join(OUT, `dashboard-${theme.toUpperCase()}.png`);
  fs.writeFileSync(fullFile, full.toPNG());
  console.log('[ok]', fullFile);

  // Crop around the open drive selector — union of the trigger button and the
  // (absolutely-positioned) open dropdown, so both are in frame.
  const rect = await win.webContents.executeJavaScript(
    `(() => {
      const btn = document.querySelector('.drive-selector-button').getBoundingClientRect();
      const dd = document.querySelector('.drive-selector-dropdown').getBoundingClientRect();
      const left = Math.min(btn.left, dd.left), top = Math.min(btn.top, dd.top);
      const right = Math.max(btn.right, dd.right), bottom = Math.max(btn.bottom, dd.bottom);
      const p = 12;
      return { x: Math.max(0, Math.round(left - p)), y: Math.max(0, Math.round(top - p)),
               width: Math.round(right - left + p*2), height: Math.round(bottom - top + p*2) };
    })()`
  );
  const cropImg = await win.webContents.capturePage(rect);
  const dsFile = path.join(OUT, `drive-selector-${theme.toUpperCase()}.png`);
  fs.writeFileSync(dsFile, cropImg.toPNG());
  console.log('[ok]', dsFile);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { offscreen: false },
    backgroundColor: '#000000'
  });
  await win.loadFile(HTML);
  await sleep(600);
  for (const theme of ['light', 'dark']) {
    await capture(win, theme);
  }
  console.log('DONE');
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
