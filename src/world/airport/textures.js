import * as THREE from 'three';
import { mulberry32 } from '../../util/random.js';

// Canvas textures shared by every airport (pavement, concrete, paint glyphs, facades, ground). All are
// generated once, tile seamlessly where they repeat, and carry mipmaps plus anisotropic filtering so they
// look right at 1 m and at 5 km. Nothing here is per airport; per-airport variation comes from material
// tints and from the shader detail layers in pavement.js.

const cache = {};
const once = (key, fn) => (cache[key] ??= fn());

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(c, { repeat = true, aniso = 8, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.shared = true;
  return t;
}

// ---- tileable value noise ---------------------------------------------------------------------------------

const fade = (t) => t * t * (3 - 2 * t);

/** size x size Float32Array in 0..1: fractal value noise that wraps in both directions. */
export function tileNoise(size, baseCells, octaves, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1; let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells * (1 << o);
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const step = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * step; const iy = Math.floor(fy); const ty = fade(fy - iy);
      const y0 = (iy % cells) * cells; const y1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * step; const ix = Math.floor(fx); const tx = fade(fx - ix);
        const x0 = ix % cells; const x1 = (ix + 1) % cells;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * tx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * tx;
        out[y * size + x] += (a + (b - a) * ty) * amp;
      }
    }
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function imageFromFn(size, fn, w = size, h = size) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = fn(x, y);
      d[i++] = px[0]; d[i++] = px[1]; d[i++] = px[2]; d[i++] = px[3] ?? 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---- pavement ---------------------------------------------------------------------------------------------

/** Asphalt aggregate, 512 px = 6 m. */
export function asphaltTexture() {
  return once('asphalt', () => {
    const S = 512;
    const low = tileNoise(S, 3, 3, 11);
    const mid = tileNoise(S, 28, 2, 12);
    const rnd = mulberry32(13);
    const c = imageFromFn(S, (x, y) => {
      const i = y * S + x;
      let v = 0.34 + (low[i] - 0.5) * 0.075 + (mid[i] - 0.5) * 0.06 + (rnd() - 0.5) * 0.085;
      const r = rnd();
      if (r < 0.018) v -= 0.09; else if (r > 0.972) v += 0.14;
      const g = v * 255;
      return [clamp255(g * 1.02), clamp255(g * 1.0), clamp255(g * 1.045)];
    });
    // larger chips of aggregate, some warm, some cool
    const ctx = c.getContext('2d');
    const rr = mulberry32(14);
    for (let k = 0; k < 1400; k++) {
      const x = rr() * S; const y = rr() * S; const s = 1.5 + rr() * 2.2;
      const t = rr();
      const L = 70 + rr() * 80;
      ctx.fillStyle = t < 0.25 ? `rgba(${L + 30},${L + 14},${L - 6},0.35)` : t < 0.55 ? `rgba(${L - 40},${L - 40},${L - 35},0.4)` : `rgba(${L},${L},${L + 5},0.28)`;
      for (const ox of [0, x < s ? S : 0, x > S - s ? -S : 0]) for (const oy of [0, y < s ? S : 0, y > S - s ? -S : 0]) ctx.fillRect(x + ox, y + oy, s, s * (0.7 + rr() * 0.6));
    }
    return finish(c, { aniso: 16 });
  });
}

/** Low frequency tone variation (R large blotches, G medium, B placement mask), 256 px, sampled at several scales. */
export function macroTexture() {
  return once('macro', () => {
    const S = 256;
    const a = tileNoise(S, 4, 5, 21); const b = tileNoise(S, 11, 4, 22); const m = tileNoise(S, 6, 4, 23);
    const c = imageFromFn(S, (x, y) => { const i = y * S + x; return [a[i] * 255, b[i] * 255, m[i] * 255, 255]; });
    return finish(c, { aniso: 4 });
  });
}

/** Crack and tar-seam network in R (1 = crack), tile 19 m (1024 px); G holds oil/tyre smear blobs. */
export function crackTexture() {
  return once('crack', () => {
    const S = 1024;
    const c = canvas(S, S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const rnd = mulberry32(31);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const crack = (x, y, ang, len, w, depth) => {
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(255,0,0,${0.55 + rnd() * 0.45})`;
      ctx.beginPath(); ctx.moveTo(x, y);
      let steps = Math.floor(len / 5);
      for (let i = 0; i < steps; i++) {
        ang += (rnd() - 0.5) * 0.7;
        x += Math.cos(ang) * 5; y += Math.sin(ang) * 5;
        if (x < 8 || y < 8 || x > S - 8 || y > S - 8) break;
        ctx.lineTo(x, y);
        if (depth < 2 && rnd() < 0.045) { ctx.stroke(); crack(x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7), len * 0.4, w * 0.75, depth + 1); ctx.beginPath(); ctx.moveTo(x, y); }
      }
      ctx.stroke();
    };
    for (let k = 0; k < 26; k++) crack(40 + rnd() * (S - 80), 40 + rnd() * (S - 80), rnd() * Math.PI * 2, 140 + rnd() * 380, 1.1 + rnd() * 1.1, 0);
    // a few long transverse tar seams (straight, slightly wavy)
    for (let k = 0; k < 3; k++) {
      const y0 = 100 + rnd() * (S - 200); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.beginPath(); ctx.moveTo(10, y0);
      for (let x = 10; x < S - 10; x += 20) ctx.lineTo(x, y0 + Math.sin(x * 0.03 + k) * 3);
      ctx.stroke();
    }
    // smear blobs in G
    for (let k = 0; k < 70; k++) {
      const x = rnd() * S; const y = rnd() * S; const r = 14 + rnd() * 60;
      for (const ox of [0, x < r ? S : 0, x > S - r ? -S : 0]) for (const oy of [0, y < r ? S : 0, y > S - r ? -S : 0]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(0,255,0,${0.25 + rnd() * 0.5})`); g.addColorStop(1, 'rgba(0,255,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
    return finish(c, { aniso: 8 });
  });
}

/** Concrete apron: 2x2 slabs of 7.5 m (1024 px = 15 m), joints, stains, hairline cracks. */
export function concreteTexture() {
  return once('concrete', () => {
    const S = 1024;
    const low = tileNoise(S, 4, 4, 41);
    const mid = tileNoise(S, 40, 3, 42);
    const rnd = mulberry32(43);
    const tone = [0, 1, 2, 3].map(() => (rnd() - 0.5) * 0.06);
    const c = imageFromFn(S, (x, y) => {
      const i = y * S + x;
      const slab = (x >= 512 ? 1 : 0) + (y >= 512 ? 2 : 0);
      let v = 0.60 + tone[slab] + (low[i] - 0.5) * 0.07 + (mid[i] - 0.5) * 0.045 + (rnd() - 0.5) * 0.04;
      if (rnd() < 0.01) v -= 0.06;
      const g = v * 255;
      return [clamp255(g * 1.0), clamp255(g * 0.985), clamp255(g * 0.95)];
    });
    const ctx = c.getContext('2d');
    // joints
    for (const p of [0, 512, 1024]) {
      ctx.fillStyle = 'rgba(30,30,28,0.78)';
      ctx.fillRect(p - 1.5, 0, 3, S); ctx.fillRect(0, p - 1.5, S, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(p + 1.5, 0, 1.5, S); ctx.fillRect(0, p + 1.5, S, 1.5);
    }
    // oil drips and stains
    for (let k = 0; k < 16; k++) {
      const x = 30 + rnd() * (S - 60); const y = 30 + rnd() * (S - 60); const r = 12 + rnd() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(28,24,20,${0.18 + rnd() * 0.3})`); g.addColorStop(1, 'rgba(28,24,20,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // tyre scuffs near the centre of slabs
    ctx.lineCap = 'round';
    for (let k = 0; k < 7; k++) {
      ctx.strokeStyle = `rgba(20,20,20,${0.05 + rnd() * 0.07})`; ctx.lineWidth = 3 + rnd() * 6;
      const x = rnd() * S; const y = rnd() * S; const a = rnd() * Math.PI;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * 80, y + Math.sin(a) * 80, x + Math.cos(a + 0.4) * 160, y + Math.sin(a + 0.4) * 160); ctx.stroke();
    }
    // hairline cracks
    ctx.strokeStyle = 'rgba(40,40,38,0.55)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 9; k++) {
      let x = 40 + rnd() * (S - 80); let y = 40 + rnd() * (S - 80); let a = rnd() * 6.28;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let i = 0; i < 24; i++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 7; y += Math.sin(a) * 7; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return finish(c, { aniso: 16 });
  });
}

// ---- paint glyphs -------------------------------------------------------------------------------------------

const GLYPH_DEF = {
  0: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  1: [[[0.1, 0.78], [0.55, 1], [0.55, 0]]],
  2: [[[0, 1], [1, 1], [1, 0.52], [0, 0.46], [0, 0], [1, 0]]],
  3: [[[0, 1], [1, 1], [1, 0], [0, 0]], [[0.25, 0.5], [1, 0.5]]],
  4: [[[0, 1], [0, 0.4], [1, 0.4]], [[0.72, 1], [0.72, 0]]],
  5: [[[1, 1], [0, 1], [0, 0.54], [1, 0.54], [1, 0], [0, 0]]],
  6: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.5], [0, 0.5]]],
  7: [[[0, 1], [1, 1], [0.38, 0]]],
  8: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0, 0.5], [1, 0.5]]],
  9: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.5], [1, 0.5]]],
  L: [[[0, 1], [0, 0], [1, 0]]],
  R: [[[0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]], [[0.4, 0.5], [1, 0]]],
  C: [[[1, 1], [0, 1], [0, 0], [1, 0]]],
  A: [[[0, 0], [0, 1], [1, 1], [1, 0]], [[0, 0.5], [1, 0.5]]],
  B: [[[0, 0], [0, 1], [0.9, 1], [0.9, 0.5], [0, 0.5]], [[0.9, 0.5], [1, 0.5], [1, 0], [0, 0]]],
  D: [[[0, 0], [0, 1], [0.7, 1], [1, 0.7], [1, 0.3], [0.7, 0], [0, 0]]],
  E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.8, 0.5]]],
  F: [[[1, 1], [0, 1], [0, 0]], [[0, 0.5], [0.8, 0.5]]],
  G: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 0.45], [0.55, 0.45]]],
  H: [[[0, 1], [0, 0]], [[1, 1], [1, 0]], [[0, 0.5], [1, 0.5]]],
  K: [[[0, 1], [0, 0]], [[1, 1], [0, 0.45]], [[0.25, 0.62], [1, 0]]],
  '-': [[[0.1, 0.5], [0.9, 0.5]]],
};
export const GLYPH_ORDER = Object.keys(GLYPH_DEF).join('');
const GCOLS = 8; const GCW = 128; const GCH = 192;

/** White polyline numerals/letters in an alpha atlas (8 columns of 128 x 192 px cells). */
export function glyphAtlas() {
  return once('glyph', () => {
    const rows = Math.ceil(GLYPH_ORDER.length / GCOLS);
    const c = canvas(GCOLS * GCW, rows * GCH);
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#fff'; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.miterLimit = 3;
    const sw = 28;
    const bw = 84; const bh = 150;
    [...GLYPH_ORDER].forEach((ch, i) => {
      const cx = (i % GCOLS) * GCW; const cy = Math.floor(i / GCOLS) * GCH;
      const x0 = cx + (GCW - bw) / 2 + sw / 2; const y0 = cy + (GCH - bh) / 2 + sw / 2;
      const W = bw - sw; const H = bh - sw;
      ctx.lineWidth = sw;
      for (const line of GLYPH_DEF[ch]) {
        ctx.beginPath();
        line.forEach(([px, py], k) => { const X = x0 + px * W; const Y = y0 + (1 - py) * H; if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
        ctx.stroke();
      }
    });
    return finish(c, { repeat: false, aniso: 8 });
  });
}

/** UV rectangle [u0, v0, u1, v1] of a glyph inside the atlas (v up), plus the cell's ink box fractions. */
export function glyphUV(ch) {
  const i = GLYPH_ORDER.indexOf(ch);
  if (i < 0) return null;
  const rows = Math.ceil(GLYPH_ORDER.length / GCOLS);
  const col = i % GCOLS; const row = Math.floor(i / GCOLS);
  const pad = 0.5;
  return [(col * GCW + pad) / (GCOLS * GCW), 1 - ((row + 1) * GCH - pad) / (rows * GCH), ((col + 1) * GCW - pad) / (GCOLS * GCW), 1 - (row * GCH + pad) / (rows * GCH)];
}
/** Ink size of one glyph relative to its cell (cell is 128 x 192, ink about 84 x 150). */
export const GLYPH_CELL = { w: GCW, h: GCH, inkW: 84, inkH: 150 };

// ---- facades ---------------------------------------------------------------------------------------------------

function litSet(ctx, w, h, rnd, cellsX, cellsY, lit) {
  const cw = w / cellsX; const ch = h / cellsY;
  for (let j = 0; j < cellsY; j++) for (let i = 0; i < cellsX; i++) {
    const r = rnd();
    if (r > lit) continue;
    const warm = 0.75 + rnd() * 0.25;
    ctx.fillStyle = `rgba(255,${Math.floor(200 + 30 * warm)},${Math.floor(130 + 60 * warm)},${0.55 + rnd() * 0.45})`;
    ctx.fillRect(i * cw + 4, j * ch + 4, cw - 8, ch - 8);
  }
}

/** Glass curtain wall: 18 m x 9 m tile (12 panes x 2 floors). map + emissive. */
export function curtainWall() {
  return once('curtain', () => {
    const W = 1152; const H = 576; // 64 px/m
    const c = canvas(W, H); const e = canvas(W, H);
    const ctx = c.getContext('2d'); const ex = e.getContext('2d');
    const rnd = mulberry32(51);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    const pw = W / 12; const ph = H / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 12; i++) {
      const x = i * pw; const y = j * ph;
      const g = ctx.createLinearGradient(0, y, 0, y + ph);
      g.addColorStop(0, '#9db8c9'); g.addColorStop(0.42, '#5d7d92'); g.addColorStop(1, '#27394a');
      ctx.fillStyle = g; ctx.fillRect(x, y, pw, ph);
      // sky reflection streak
      ctx.fillStyle = `rgba(235,245,255,${0.10 + rnd() * 0.16})`;
      ctx.beginPath(); ctx.moveTo(x, y + ph * (0.2 + rnd() * 0.3)); ctx.lineTo(x + pw, y + ph * (0.05 + rnd() * 0.25)); ctx.lineTo(x + pw, y + ph * (0.3 + rnd() * 0.2)); ctx.lineTo(x, y + ph * (0.5 + rnd() * 0.2)); ctx.fill();
      // interior hint: dark ceiling line and silhouettes
      ctx.fillStyle = 'rgba(8,12,18,0.30)'; ctx.fillRect(x, y + ph * 0.58, pw, ph * 0.04);
      ctx.fillStyle = `rgba(8,12,18,${0.12 + rnd() * 0.1})`; ctx.fillRect(x, y + ph * 0.62, pw, ph * 0.38);
      // emissive: lit pane
      const lit = rnd();
      if (lit > 0.18) {
        const gg = ex.createLinearGradient(0, y + ph * 0.55, 0, y + ph);
        const a = 0.5 + rnd() * 0.5;
        gg.addColorStop(0, `rgba(255,236,190,${a})`); gg.addColorStop(1, `rgba(255,214,150,${a * 0.65})`);
        ex.fillStyle = gg; ex.fillRect(x + 3, y + 3, pw - 6, ph - 6);
      }
    }
    // mullions and transoms
    ctx.fillStyle = '#323a42'; ex.fillStyle = '#000';
    for (let i = 0; i <= 12; i++) { ctx.fillRect(i * pw - 3, 0, 6, H); ex.fillRect(i * pw - 3, 0, 6, H); }
    for (let j = 0; j <= 2; j++) { ctx.fillRect(0, j * ph - 4, W, 8); ex.fillRect(0, j * ph - 4, W, 8); }
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i <= 12; i++) ctx.fillRect(i * pw - 3, 0, 1.5, H);
    return { map: finish(c, { aniso: 8 }), emissive: finish(e, { aniso: 8 }), tile: [18, 9] };
  });
}

/** Punched window facade for hotels and offices: 28.8 m x 10.8 m tile (8 columns x 3 floors). */
export function punchedFacade() {
  return once('punched', () => {
    const W = 1152; const H = 432; // 40 px/m
    const c = canvas(W, H); const e = canvas(W, H);
    const ctx = c.getContext('2d'); const ex = e.getContext('2d');
    const rnd = mulberry32(61);
    const rng = (x, y, w, h) => [x, y, w, h];
    void rng;
    ctx.fillStyle = '#e4e1da'; ctx.fillRect(0, 0, W, H);
    // panel tone variation and joints
    for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rnd() * 0.04})`; ctx.fillRect(i * 144, j * 144, 144, 144);
    }
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    const cw = W / 8; const ch = H / 3;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 8; i++) {
      const x = i * cw + cw * 0.17; const y = j * ch + ch * 0.2; const w = cw * 0.66; const h = ch * 0.58;
      ctx.fillStyle = '#7d8c97'; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#6e8ba0'); g.addColorStop(1, '#2d3d4c');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(230,240,250,0.18)'; ctx.beginPath(); ctx.moveTo(x, y + h * 0.5); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x + w, y); ctx.lineTo(x, y + h * 0.9); ctx.fill();
      ctx.fillStyle = '#4b535b'; ctx.fillRect(x + w / 2 - 1.5, y, 3, h); // mullion
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x - 4, y + h + 4, w + 8, 4); // sill shadow
      if (rnd() < 0.5) {
        const a = 0.55 + rnd() * 0.45;
        ex.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 40)},${130 + Math.floor(rnd() * 60)},${a})`; ex.fillRect(x, y, w, h);
        ex.fillStyle = '#000'; ex.fillRect(x + w / 2 - 1.5, y, 3, h);
      }
    }
    // horizontal band between floors
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let j = 0; j < 3; j++) ctx.fillRect(0, j * ch - 2, W, 4);
    return { map: finish(c), emissive: finish(e), tile: [28.8, 10.8] };
  });
}

/** Ribbed metal cladding: 2 m x 2 m tile (vertical ribs every 0.25 m). */
export function metalCladding() {
  return once('metal', () => {
    const S = 256;
    const rnd = mulberry32(71);
    const c = imageFromFn(S, (x, y) => {
      const rib = Math.sin((x / S) * Math.PI * 16);
      let v = 0.78 + rib * 0.10 + (rnd() - 0.5) * 0.02;
      if (y % 128 < 3) v -= 0.12; // panel seam
      const g = v * 255;
      return [clamp255(g), clamp255(g), clamp255(g * 1.01)];
    });
    return finish(c, { aniso: 8 });
  });
}

/** Horizontal ribbed (for hangar doors): same ribs rotated. */
export function metalCladdingH() {
  return once('metalH', () => {
    const S = 256;
    const c = imageFromFn(S, (x, y) => {
      const rib = Math.sin((y / S) * Math.PI * 16);
      let v = 0.74 + rib * 0.10;
      if (x % 128 < 3) v -= 0.15;
      const g = v * 255;
      return [clamp255(g), clamp255(g), clamp255(g * 1.01)];
    });
    return finish(c, { aniso: 8 });
  });
}

/** Precast concrete panels with joints: 4 m x 3 m tile. */
export function precastPanel() {
  return once('precast', () => {
    const W = 512; const H = 384;
    const nz = tileNoise(W, 6, 3, 81);
    const rnd = mulberry32(82);
    const c = imageFromFn(W, (x, y) => {
      if (y >= H) return [0, 0, 0, 255];
      const i = y * W + x;
      let v = 0.78 + (nz[i] - 0.5) * 0.08 + (rnd() - 0.5) * 0.03;
      if (x < 2 || x > W - 3 || y < 2 || y > H - 3) v -= 0.18;
      const g = v * 255;
      return [clamp255(g), clamp255(g * 0.99), clamp255(g * 0.96)];
    }, W, H);
    return finish(c, { aniso: 8 });
  });
}

/** Roof membrane / standing seam metal: 3 m tile, seams every 0.6 m. */
export function roofSheet() {
  return once('roof', () => {
    const S = 256;
    const nz = tileNoise(S, 5, 3, 91);
    const c = imageFromFn(S, (x, y) => {
      let v = 0.62 + (nz[y * S + x] - 0.5) * 0.12;
      const seam = x % (S / 5);
      if (seam < 2) v += 0.14; else if (seam < 4) v -= 0.1;
      if (y % (S / 3) < 2) v -= 0.08;
      const g = v * 255;
      return [clamp255(g), clamp255(g), clamp255(g * 1.02)];
    });
    return finish(c, { aniso: 8 });
  });
}

/** Open-sided car park deck: 8 m x 3.2 m tile (pillar, slab band, dark interior). map + emissive. */
export function carParkFacade() {
  return once('carpark', () => {
    const W = 512; const H = 256; // 64 px/m
    const c = canvas(W, H); const e = canvas(W, H);
    const ctx = c.getContext('2d'); const ex = e.getContext('2d');
    ctx.fillStyle = '#17191c'; ctx.fillRect(0, 0, W, H);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    // ceiling and floor depth cues inside the opening
    const g = ctx.createLinearGradient(0, 60, 0, H);
    g.addColorStop(0, '#0e0f11'); g.addColorStop(0.6, '#25282c'); g.addColorStop(1, '#4a4d52');
    ctx.fillStyle = g; ctx.fillRect(0, 60, W, H - 60);
    // cars hinted as pale blobs
    const rnd = mulberry32(101);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(${90 + rnd() * 90},${90 + rnd() * 90},${90 + rnd() * 90},0.5)`; ctx.fillRect(i * 100 + rnd() * 20, 170 + rnd() * 20, 60, 30); }
    // slab (top) band
    ctx.fillStyle = '#9b9a95'; ctx.fillRect(0, 0, W, 56);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 50, W, 6);
    // parapet low wall at the bottom
    ctx.fillStyle = '#85847f'; ctx.fillRect(0, H - 32, W, 32);
    // pillars
    ctx.fillStyle = '#a9a8a2'; ctx.fillRect(0, 56, 26, H - 56); ctx.fillRect(W - 26, 56, 26, H - 56);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(24, 56, 4, H - 56);
    // lights
    ex.fillStyle = 'rgba(255,248,225,0.85)'; ex.fillRect(90, 64, 120, 5); ex.fillRect(300, 64, 120, 5);
    ex.fillStyle = 'rgba(255,230,170,0.35)'; ex.fillRect(0, 70, W, H - 100);
    return { map: finish(c), emissive: finish(e), tile: [8, 4] };
  });
}

/** Mullioned tinted glass for the control-tower cab: 4 m x 2 m tile. */
export function cabGlass() {
  return once('cab', () => {
    const W = 512; const H = 256;
    const c = canvas(W, H); const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#87a3b4'); g.addColorStop(0.5, '#456075'); g.addColorStop(1, '#2a3a48');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(240,250,255,0.16)'; ctx.beginPath(); ctx.moveTo(0, 150); ctx.lineTo(W * 0.55, 0); ctx.lineTo(W * 0.8, 0); ctx.lineTo(0, 230); ctx.fill();
    ctx.fillStyle = '#2b3036'; ctx.fillRect(0, 0, 8, H); ctx.fillRect(W - 8, 0, 8, H); ctx.fillRect(W / 2 - 4, 0, 8, H); ctx.fillRect(0, H - 6, W, 6); ctx.fillRect(0, 0, W, 6);
    return finish(c, { aniso: 8 });
  });
}

// ---- ground -----------------------------------------------------------------------------------------------------

/** Ground cover tile (12 m): 'grass' (mown stripes along the canvas Y direction), 'dirt', 'snow'. */
export function groundTexture(kind) {
  return once(`ground-${kind}`, () => {
    const S = 512;
    const a = tileNoise(S, 3, 4, kind === 'grass' ? 111 : kind === 'dirt' ? 112 : 113);
    const b = tileNoise(S, 48, 2, 115);
    const rnd = mulberry32(116);
    const c = imageFromFn(S, (x, y) => {
      const i = y * S + x;
      let r; let g; let bl;
      if (kind === 'grass') {
        const stripe = Math.floor(x / (S / 4)) % 2 ? 1.0 : 0.88; // 3 m mowing bands
        const v = (0.55 + (a[i] - 0.5) * 0.25 + (b[i] - 0.5) * 0.22 + (rnd() - 0.5) * 0.18) * stripe;
        r = 78 * v + 10; g = 112 * v + 12; bl = 40 * v + 6;
      } else if (kind === 'dirt') {
        const v = 0.62 + (a[i] - 0.5) * 0.3 + (b[i] - 0.5) * 0.2 + (rnd() - 0.5) * 0.2;
        r = 170 * v; g = 140 * v; bl = 100 * v;
        if (rnd() < 0.01) { r *= 0.6; g *= 0.6; bl *= 0.6; }
      } else {
        const v = 0.86 + (a[i] - 0.5) * 0.1 + (b[i] - 0.5) * 0.06 + (rnd() - 0.5) * 0.05;
        r = 232 * v; g = 238 * v; bl = 246 * v;
      }
      return [clamp255(r), clamp255(g), clamp255(bl)];
    });
    return finish(c, { aniso: 8 });
  });
}

/** Soft round glow used for floodlight pools on the apron. */
export function lightPoolTexture() {
  return once('pool', () => {
    const S = 128;
    const c = canvas(S, S); const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(0.7, 'rgba(255,255,255,0.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return finish(c, { repeat: false, aniso: 1 });
  });
}

/** Soft dark square used as contact shadow below buildings and parked aircraft. */
export function blobShadowTexture() {
  return once('blob', () => {
    const S = 64;
    const c = canvas(S, S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return finish(c, { repeat: false, aniso: 1 });
  });
}

/** Chain-link fence cell: alpha texture, 4 m x 2.4 m. */
export function fenceTexture() {
  return once('fence', () => {
    const W = 256; const H = 154;
    const c = canvas(W, H); const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(190,195,200,0.9)'; ctx.lineWidth = 1.4;
    const s = 8;
    ctx.beginPath();
    for (let k = -H; k < W + H; k += s) { ctx.moveTo(k, 0); ctx.lineTo(k + H, H); ctx.moveTo(k, H); ctx.lineTo(k + H, 0); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,175,180,0.95)'; ctx.fillRect(0, 0, W, 3); ctx.fillRect(0, H - 2, W, 2);
    return finish(c, { aniso: 4 });
  });
}

/** Tyre rubber deposits for a touchdown zone: 512 m x 32 m mapped on 2048 x 256 px, alpha map (black ink). */
export function rubberTexture() {
  return once('rubber', () => {
    const W = 2048; const H = 256;
    const c = canvas(W, H); const ctx = c.getContext('2d');
    const rnd = mulberry32(131);
    ctx.clearRect(0, 0, W, H);
    // density falls off with distance from the threshold (x = 0); main wheel tracks at +-5 m from the centreline
    for (let k = 0; k < 5200; k++) {
      const x = Math.pow(rnd(), 1.5) * W;
      const dens = 1 - x / W;
      if (rnd() > 0.25 + dens * 0.75) continue;
      const track = rnd() < 0.5 ? -1 : 1;
      const lane = rnd() < 0.55 ? 5 : rnd() < 0.5 ? 2.2 : 8.5; // metres from the centreline
      const y = H / 2 + track * (lane * 8 + (rnd() - 0.5) * 22);
      const len = 14 + rnd() * 70;
      ctx.fillStyle = `rgba(8,8,10,${0.04 + rnd() * 0.13 * (0.4 + dens)})`;
      ctx.fillRect(x, y, len, 2 + rnd() * 5);
    }
    // heavy touchdown smudges
    for (let k = 0; k < 60; k++) {
      const x = rnd() * W * 0.55; const track = rnd() < 0.5 ? -1 : 1; const y = H / 2 + track * (40 + rnd() * 24);
      const g = ctx.createRadialGradient(x, y, 0, x, y, 24 + rnd() * 30);
      g.addColorStop(0, `rgba(5,5,6,${0.15 + rnd() * 0.2})`); g.addColorStop(1, 'rgba(5,5,6,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 70, y - 70, 140, 140);
    }
    return finish(c, { repeat: false, aniso: 8 });
  });
}

/** Faint oil/wear streak down the centreline: 64 x 512 px tile (1 m x 60 m), alpha. */
export function streakTexture() {
  return once('streak', () => {
    const W = 64; const H = 512;
    const c = canvas(W, H); const ctx = c.getContext('2d');
    const rnd = mulberry32(141);
    for (let k = 0; k < 160; k++) {
      const x = W / 2 + (rnd() - 0.5) * 26 * rnd(); const y = rnd() * H; const len = 8 + rnd() * 60;
      ctx.fillStyle = `rgba(10,9,8,${0.03 + rnd() * 0.1})`; ctx.fillRect(x, y, 1 + rnd() * 3, len);
    }
    return finish(c, { aniso: 4 });
  });
}

/** Parking lot / road paint stripes helper: a 4x4 white pixel (used via flat colour materials). */
export function disposeAirportTextures() {
  for (const k of Object.keys(cache)) {
    const v = cache[k];
    const list = v?.isTexture ? [v] : [v?.map, v?.emissive].filter(Boolean);
    for (const t of list) t.dispose();
    delete cache[k];
  }
}
