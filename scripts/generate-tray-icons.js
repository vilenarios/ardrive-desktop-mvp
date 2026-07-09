#!/usr/bin/env node
/*
 * UX-36: generate the state-reflecting tray icon variants from the existing
 * ArDrive mark (assets/tray-icon.png + trayTemplate.png, and their @2x HiDPI
 * pairs — the UX-35 assets). We composite a small status badge into the
 * bottom-right corner so the tray glyph itself reflects the resolved status
 * kind (idle / syncing / paused / error) — parity with OneDrive/Dropbox,
 * whose tray glyph changes, not just the tooltip.
 *
 * Environment note: the UX-35 rsvg/app-builder tooling is NOT installed in
 * this dev box (no rsvg-convert / sharp / ImageMagick), so rather than call an
 * external rasterizer we decode the already-rasterized base PNGs with a tiny
 * self-contained PNG codec (Node's built-in zlib) and paint the badge on the
 * pixel buffer. Output is re-encoded as real 8-bit RGBA PNGs — verify with
 * `file assets/tray-icon-*.png` (must say "PNG image data", never "ASCII text").
 *
 * COLORED variants (Windows/Linux, and macOS error): full-color badge disc +
 * white inner glyph.
 * TEMPLATE variants (macOS syncing/paused): black+alpha silhouette badge with
 * the glyph CUT OUT (alpha 0) — template images render monochrome and recolor
 * to the menu-bar foreground, so we can't tint them; a distinct SILHOUETTE is
 * the only way to differentiate. The macOS error state deliberately uses the
 * COLORED red icon as a NON-template image (see main.ts) so an error actually
 * reads as red in the menu bar rather than a subtle monochrome shape.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSETS = path.join(__dirname, '..', 'assets');

// ── minimal PNG codec (8-bit, non-interlaced, color type 2/6) ──────────────
function decodePng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (bitDepth=${bitDepth}, colorType=${colorType})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let p = 0;
  const paeth = (a, b, c) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error('bad filter ' + filter);
      }
      line[i] = v & 0xff;
    }
    for (let xp = 0; xp < width; xp++) {
      const src = xp * channels;
      const dst = (y * width + xp) * 4;
      rgba[dst] = line[src];
      rgba[dst + 1] = line[src + 1];
      rgba[dst + 2] = line[src + 2];
      rgba[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    line.copy(prev);
  }
  return { width, height, rgba };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c;
}

// ── pixel helpers ──────────────────────────────────────────────────────────
function setPx(img, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const sa = a / 255;
  // alpha-over composite onto existing pixel
  const da = img.rgba[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) { img.rgba[i] = img.rgba[i + 1] = img.rgba[i + 2] = img.rgba[i + 3] = 0; return; }
  img.rgba[i] = Math.round((r * sa + img.rgba[i] * da * (1 - sa)) / outA);
  img.rgba[i + 1] = Math.round((g * sa + img.rgba[i + 1] * da * (1 - sa)) / outA);
  img.rgba[i + 2] = Math.round((b * sa + img.rgba[i + 2] * da * (1 - sa)) / outA);
  img.rgba[i + 3] = Math.round(outA * 255);
}
function clearPx(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.rgba[i] = img.rgba[i + 1] = img.rgba[i + 2] = img.rgba[i + 3] = 0;
}

// Draw a status badge. `mode`:
//   'color' -> filled colored disc (rgb) with white glyph
//   'template' -> black disc, transparent separator ring, transparent glyph cutout
function drawBadge(img, kind, mode, rgb) {
  const s = img.width;
  const R = s * 0.30;                 // badge radius
  const cx = s - R - Math.max(0.5, s * 0.04);
  const cy = s - R - Math.max(0.5, s * 0.04);

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (mode === 'template' && d > R && d <= R + Math.max(1, s * 0.06)) {
        // transparent separator so the badge silhouette detaches from the mark
        clearPx(img, x, y);
      }
      if (d <= R) {
        if (mode === 'color') {
          setPx(img, x, y, rgb[0], rgb[1], rgb[2], 255);
        } else {
          setPx(img, x, y, 0, 0, 0, 255);
        }
      }
    }
  }

  // inner glyph
  const glyph = (x, y) => {
    if (mode === 'color') setPx(img, x, y, 255, 255, 255, 255);
    else clearPx(img, x, y);
  };
  const gr = R * 0.60; // glyph half-extent
  if (kind === 'paused') {
    const bw = Math.max(1, Math.round(R * 0.22));
    const bh = Math.round(gr * 1.35);
    const gap = Math.max(1, Math.round(R * 0.24));
    for (let dy = -bh; dy <= bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        glyph(Math.round(cx - gap - dx), Math.round(cy + dy));
        glyph(Math.round(cx + gap + dx), Math.round(cy + dy));
      }
    }
  } else if (kind === 'error') {
    const bw = Math.max(1, Math.round(R * 0.20));
    const bh = Math.round(gr * 1.05);
    for (let dy = -bh; dy <= bh * 0.45; dy++) {
      for (let dx = -Math.floor(bw / 2); dx <= Math.floor(bw / 2); dx++) {
        glyph(Math.round(cx + dx), Math.round(cy + dy));
      }
    }
    // dot
    const dotY = Math.round(cy + gr * 0.95);
    for (let dy = -bw; dy <= bw; dy++)
      for (let dx = -bw; dx <= bw; dx++)
        if (dx * dx + dy * dy <= bw * bw) glyph(Math.round(cx + dx), dotY + dy);
  } else if (kind === 'syncing') {
    // a broken ring (annulus with a gap) reads as a refresh/rotation mark
    const outer = gr * 1.05;
    const inner = gr * 0.50;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= inner && d <= outer) {
          const ang = Math.atan2(dy, dx); // gap in the top-right octant
          if (ang > -Math.PI * 0.9 && ang < Math.PI * 0.15) continue;
          glyph(x, y);
        }
      }
    }
    // small arrow head at the ring gap to imply direction
    const hx = Math.round(cx + outer * 0.75);
    const hy = Math.round(cy - outer * 0.35);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= 2) glyph(hx + dx, hy + dy);
  }
}

const BADGE_COLORS = {
  syncing: [43, 127, 255],   // brand blue
  paused: [107, 116, 128],   // neutral slate
  error: [229, 72, 77],      // alert red
};

function variant(baseName, outName, kind, mode) {
  const base = decodePng(fs.readFileSync(path.join(ASSETS, baseName)));
  const img = { width: base.width, height: base.height, rgba: Buffer.from(base.rgba) };
  drawBadge(img, kind, mode, BADGE_COLORS[kind]);
  const out = encodePng(img.width, img.height, img.rgba);
  fs.writeFileSync(path.join(ASSETS, outName), out);
  console.log(`  wrote ${outName} (${img.width}x${img.height})`);
}

console.log('Generating colored tray variants (Windows/Linux + macOS error):');
for (const kind of ['syncing', 'paused', 'error']) {
  variant('tray-icon.png', `tray-icon-${kind}.png`, kind, 'color');
  variant('tray-icon@2x.png', `tray-icon-${kind}@2x.png`, kind, 'color');
}
console.log('Generating template tray variants (macOS syncing/paused):');
for (const kind of ['syncing', 'paused']) {
  variant('trayTemplate.png', `trayTemplate-${kind}.png`, kind, 'template');
  variant('trayTemplate@2x.png', `trayTemplate-${kind}@2x.png`, kind, 'template');
}
console.log('Done.');
