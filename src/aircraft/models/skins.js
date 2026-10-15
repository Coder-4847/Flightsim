import * as THREE from 'three';
import { LOW } from './lod.js';

// Generated textures and PBR materials for the high-fidelity aircraft models: a reflection environment, tileable
// skin detail maps (panel seams, rivets), painters for fuselage and wing livery maps and the material set itself.
// Everything is drawn on canvases at run time (no image files).

const TAU = Math.PI * 2;

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Smooth value-noise lookup returning a Float32Array grid of (w x h) values 0..1 (fBm, tileable off). */
export function noiseGrid(w, h, scale, seed, octaves = 4) {
  const R = rng(seed);
  const size = 64;
  const lat = new Float32Array(size * size);
  for (let i = 0; i < lat.length; i++) lat[i] = R();
  const smooth = (t) => t * t * (3 - 2 * t);
  const val = (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = smooth(x - xi); const fy = smooth(y - yi);
    const g = (ix, iy) => lat[((iy & 63) * size) + (ix & 63)];
    const a = g(xi, yi); const b = g(xi + 1, yi); const c = g(xi, yi + 1); const d = g(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let amp = 0.5; let f = scale; let s = 0; let n = 0;
      for (let o = 0; o < octaves; o++) { s += val(x * f / w * 8 + o * 17.3, y * f / h * 8 + o * 9.1) * amp; n += amp; amp *= 0.5; f *= 2; }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

// ---- reflection environment ------------------------------------------------------------------------------
let envTexture = null;
/** Daylight sky/ground equirectangular map used for reflections on paint, glass and metal. */
export function getEnvMap() {
  if (envTexture) return envTexture;
  const W = 512; const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#3567a8');
  grad.addColorStop(0.2, '#5f90cc');
  grad.addColorStop(0.4, '#a9c8e6');
  grad.addColorStop(0.49, '#e4edf5');
  grad.addColorStop(0.505, '#a8ad9c');
  grad.addColorStop(0.58, '#6b7260');
  grad.addColorStop(1, '#2f3328');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const R = rng(7);
  for (let i = 0; i < 60; i++) {
    const x = R() * W; const y = H * (0.08 + R() * 0.36);
    const rw = 20 + R() * 60; const rh = 5 + R() * 12;
    const rg = g.createRadialGradient(x, y, 0, x, y, rw);
    rg.addColorStop(0, `rgba(255,255,255,${0.18 + R() * 0.2})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(x, y); g.scale(1, rh / rw); g.translate(-x, -y);
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, rw, 0, TAU); g.fill(); g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  envTexture = tex;
  return tex;
}

// ---- tileable skin detail maps ------------------------------------------------------------------------------
const tiles = new Map();

const TILE_KINDS = {
  // GA aluminium: lapped sheets with double rivet rows.
  rivet: { cols: 2, rows: 4, seam: 3, rivet: 1.7, pitch: 12, off: 7, stagger: true, access: 0, strength: 5.5, rough: 0.12, warp: 0.035 },
  // Jet transports / turboprops: finer seams, flush fasteners.
  flush: { cols: 2, rows: 5, seam: 2.2, rivet: 1.1, pitch: 22, off: 6, stagger: true, access: 0.15, strength: 4.5, rough: 0.1, warp: 0.02 },
  // Fighter skins: big panels, screws, access doors.
  fighter: { cols: 2, rows: 3, seam: 2.4, rivet: 1.2, pitch: 30, off: 8, stagger: true, access: 0.5, strength: 4.2, rough: 0.14, warp: 0.015 },
};

/** { normal, orm } for a tile kind. orm: R occlusion, G roughness multiplier, B metalness multiplier (both on channel uv1). */
export function getSkinTile(kind = 'rivet') {
  if (tiles.has(kind)) return tiles.get(kind);
  const P = TILE_KINDS[kind];
  const N = 1024;
  const R = rng(hashStr(kind) + 11);
  const h = new Float32Array(N * N).fill(0.5);
  const rough = new Float32Array(N * N).fill(1);
  const ao = new Float32Array(N * N).fill(1);
  const idx = (x, y) => ((y + N) % N) * N + ((x + N) % N);
  const rowH = N / P.rows;
  const colW = N / P.cols;
  const groove = (x, y, depth, aoDepth) => { const i = idx(x, y); h[i] -= depth; ao[i] = Math.min(ao[i], 1 - aoDepth); };
  const line = (x0, y0, x1, y1, width, depth) => {
    // Axis-aligned seam with a smooth V profile and a soft occlusion halo.
    const horizontal = y0 === y1;
    const len = horizontal ? x1 - x0 : y1 - y0;
    const halo = width * 2.6;
    for (let t = 0; t <= len; t++) {
      for (let o = -Math.ceil(halo); o <= Math.ceil(halo); o++) {
        const d = Math.abs(o);
        const px = horizontal ? x0 + t : x0 + o;
        const py = horizontal ? y0 + o : y0 + t;
        const i = idx(Math.round(px), Math.round(py));
        if (d <= width) h[i] -= depth * (1 - d / (width + 0.5)) * 0.7;
        ao[i] = Math.min(ao[i], 1 - 0.38 * Math.max(0, 1 - d / halo));
      }
    }
  };
  const rivetAt = (x, y, r) => {
    const rr = Math.ceil(r + 1);
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r) { const i = idx(Math.round(x + dx), Math.round(y + dy)); h[i] += 0.28 * (1 - (d / r) ** 2); ao[i] = Math.min(ao[i], 0.93); }
      }
    }
  };
  // Sheets: per-sheet height, roughness and oil-canning.
  for (let ry = 0; ry < P.rows; ry++) {
    const shift = P.stagger && ry % 2 ? colW / 2 : 0;
    for (let cx = 0; cx < P.cols + 1; cx++) {
      const x0 = Math.round(cx * colW - shift); const x1 = Math.round((cx + 1) * colW - shift);
      const y0 = Math.round(ry * rowH); const y1 = Math.round((ry + 1) * rowH);
      const dh = (R() - 0.5) * 0.05; const dr = 1 + (R() - 0.5) * 2 * P.rough;
      const ph = R() * 6;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = idx(x, y);
          const u = (x - x0) / (x1 - x0); const v = (y - y0) / (y1 - y0);
          h[i] += dh + P.warp * Math.sin(u * 3.1 + ph) * Math.sin(v * 3.0 + ph * 0.7) * (0.5 + 0.5 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI));
          rough[i] = dr;
        }
      }
      // Seams on the left edge and top edge of each sheet.
      line(x0, y0, x0, y1, P.seam * 0.7, 0.55);
      line(x0, y0, x1, y0, P.seam, 0.7);
      // Rivet rows either side of the seams.
      for (let t = 0; t < y1 - y0; t += P.pitch) { rivetAt(x0 + P.off, y0 + t + P.pitch / 2, P.rivet); rivetAt(x0 - P.off, y0 + t + P.pitch / 2, P.rivet); }
      for (let t = 0; t < x1 - x0; t += P.pitch) { rivetAt(x0 + t + P.pitch / 2, y0 + P.off, P.rivet); rivetAt(x0 + t + P.pitch / 2, y0 - P.off, P.rivet); }
      // Access panels with corner screws.
      if (R() < P.access) {
        const ix = x0 + (x1 - x0) * 0.22; const iy = y0 + (y1 - y0) * 0.2;
        const iw = (x1 - x0) * 0.5; const ih = (y1 - y0) * 0.55;
        line(Math.round(ix), Math.round(iy), Math.round(ix + iw), Math.round(iy), 1.6, 0.6);
        line(Math.round(ix), Math.round(iy + ih), Math.round(ix + iw), Math.round(iy + ih), 1.6, 0.6);
        line(Math.round(ix), Math.round(iy), Math.round(ix), Math.round(iy + ih), 1.6, 0.6);
        line(Math.round(ix + iw), Math.round(iy), Math.round(ix + iw), Math.round(iy + ih), 1.6, 0.6);
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0.5, 1]]) rivetAt(ix + 8 + (iw - 16) * sx, iy + 8 + (ih - 16) * sy, 2.2);
      }
    }
  }
  // Fine grain so flat areas are not perfectly smooth.
  const grain = noiseGrid(256, 256, 6, hashStr(kind), 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] += (grain[(y >> 2) * 256 + (x >> 2)] - 0.5) * 0.025;
  // Encode.
  const nrm = canvas(N, N); const orm = canvas(N, N);
  const ng = nrm.getContext('2d'); const og = orm.getContext('2d');
  const nd = ng.createImageData(N, N); const od = og.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = h[idx(x + 1, y)] - h[idx(x - 1, y)];
      const dy = h[idx(x, y + 1)] - h[idx(x, y - 1)];
      let nx = -dx * P.strength; let ny = dy * P.strength; let nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nd.data[i * 4] = (nx * 0.5 + 0.5) * 255; nd.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nd.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; nd.data[i * 4 + 3] = 255;
      od.data[i * 4] = Math.max(0, Math.min(255, ao[i] * 255));
      od.data[i * 4 + 1] = Math.max(0, Math.min(255, rough[i] * 0.92 * 255 + (h[i] - 0.5) * 40));
      od.data[i * 4 + 2] = 255; od.data[i * 4 + 3] = 255;
    }
  }
  ng.putImageData(nd, 0, 0); og.putImageData(od, 0, 0);
  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.channel = 1;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.userData.shared = true;
    return t;
  };
  const out = { normal: mk(nrm, false), orm: mk(orm, false) };
  tiles.set(kind, out);
  return out;
}

// ---- tyre texture ------------------------------------------------------------------------------------------
let tireTextures = null;
/** Shared tyre maps: u around the tyre, v across (sidewall, tread, sidewall). */
export function getTireTextures() {
  if (tireTextures) return tireTextures;
  const W = 1024; const H = 256;
  const col = canvas(W, H); const hh = canvas(W, H);
  const g = col.getContext('2d'); const k = hh.getContext('2d');
  g.fillStyle = '#17181a'; g.fillRect(0, 0, W, H);
  k.fillStyle = '#808080'; k.fillRect(0, 0, W, H);
  // Tread band (middle 40 %): circumferential grooves and slight lugs.
  const t0 = H * 0.3; const t1 = H * 0.7;
  for (let i = 0; i < 4; i++) {
    const y = t0 + ((i + 0.5) / 4) * (t1 - t0);
    k.fillStyle = '#303030'; k.fillRect(0, y - 3, W, 6);
    g.fillStyle = '#0d0e0f'; g.fillRect(0, y - 3, W, 6);
  }
  for (let x = 0; x < W; x += 16) { k.fillStyle = '#606060'; k.fillRect(x, t0, 2, t1 - t0); }
  // Sidewall: moulded rim ribs and text.
  for (const [y, hgt] of [[H * 0.12, 3], [H * 0.2, 2], [H * 0.8, 2], [H * 0.88, 3]]) { k.fillStyle = '#a0a0a0'; k.fillRect(0, y, W, hgt); g.fillStyle = '#222426'; g.fillRect(0, y, W, hgt); }
  g.fillStyle = '#9a9c9e'; k.fillStyle = '#b8b8b8';
  g.font = 'bold 26px Arial, Helvetica, sans-serif'; k.font = g.font;
  g.textBaseline = 'middle'; k.textBaseline = 'middle';
  g.fillText('AEROTYRE  6.00-6  6 PLY RATING  TUBELESS', 30, H * 0.045 + 6);
  k.fillText('AEROTYRE  6.00-6  6 PLY RATING  TUBELESS', 30, H * 0.045 + 6);
  g.fillText('AEROTYRE  6.00-6  6 PLY RATING  TUBELESS', 30, H * 0.955 - 6);
  k.fillText('AEROTYRE  6.00-6  6 PLY RATING  TUBELESS', 30, H * 0.955 - 6);
  // Wear speckle.
  const R = rng(5);
  g.fillStyle = 'rgba(70,70,70,0.25)';
  for (let i = 0; i < 1400; i++) g.fillRect(R() * W, R() * H, 1 + R() * 2, 1);
  // Convert height to normal.
  const hd = k.getImageData(0, 0, W, H);
  const nd = k.createImageData(W, H);
  const hv = (x, y) => hd.data[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = hv(x + 1, y) - hv(x - 1, y); const dy = hv(x, y + 1) - hv(x, y - 1);
      let nx = -dx * 3.2; let ny = dy * 3.2; let nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      nd.data[i] = (nx * 0.5 + 0.5) * 255; nd.data[i + 1] = (ny * 0.5 + 0.5) * 255; nd.data[i + 2] = (nz * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
    }
  }
  const nc = canvas(W, H); nc.getContext('2d').putImageData(nd, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.userData.shared = true; return t; };
  tireTextures = { map: mk(col, true), normal: mk(nc, false) };
  return tireTextures;
}

// ---- painters -----------------------------------------------------------------------------------------------------
export const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif';

/** Soft elliptical blot (dirt, stains, exhaust soot) with a radial alpha fall-off. */
export function blot(g, x, y, rx, ry, color, alpha) {
  g.save();
  g.translate(x, y); g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  rg.addColorStop(0, rgba(color, alpha));
  rg.addColorStop(0.5, rgba(color, alpha * 0.55));
  rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill();
  g.restore();
}

/** Streak that fades along its length (airflow dirt, oil runs). dir: radians in canvas space. */
export function streak(g, x, y, len, width, dir, color, alpha) {
  g.save();
  g.translate(x, y); g.rotate(dir);
  const lg = g.createLinearGradient(0, 0, len, 0);
  lg.addColorStop(0, rgba(color, alpha));
  lg.addColorStop(0.35, rgba(color, alpha * 0.7));
  lg.addColorStop(1, rgba(color, 0));
  g.fillStyle = lg;
  g.beginPath(); g.ellipse(len * 0.5, 0, len * 0.5, width * 0.5, 0, 0, TAU); g.fill();
  g.restore();
}

const _c = new THREE.Color();
export function rgba(color, a) {
  _c.set(color);
  return `rgba(${Math.round(_c.r * 255)},${Math.round(_c.g * 255)},${Math.round(_c.b * 255)},${a})`;
}
export function shade(color, f) { // lighten (f>0) or darken (f<0) a css/hex colour
  _c.set(color);
  _c.convertLinearToSRGB();
  const out = new THREE.Color();
  if (f >= 0) out.setRGB(_c.r + (1 - _c.r) * f, _c.g + (1 - _c.g) * f, _c.b + (1 - _c.b) * f);
  else out.setRGB(_c.r * (1 + f), _c.g * (1 + f), _c.b * (1 + f));
  return `#${new THREE.Color().setRGB(out.r, out.g, out.b, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
}
export function mix(a, b, t) {
  const ca = new THREE.Color(a); const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

/** Overlay low-frequency mottling (paint fade, dirt) on the whole canvas. */
export function mottle(g, w, h, color, alpha, scale, seed) {
  const gw = 256; const gh = Math.max(32, Math.round(256 * h / w));
  const n = noiseGrid(gw, gh, scale, seed, 4);
  const c = canvas(gw, gh);
  const cg = c.getContext('2d');
  const id = cg.createImageData(gw, gh);
  _c.set(color);
  for (let i = 0; i < gw * gh; i++) {
    const v = Math.max(0, n[i] - 0.4) * 1.7;
    id.data[i * 4] = _c.r * 255; id.data[i * 4 + 1] = _c.g * 255; id.data[i * 4 + 2] = _c.b * 255; id.data[i * 4 + 3] = Math.min(255, v * alpha * 255);
  }
  cg.putImageData(id, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(c, 0, 0, w, h);
}

/**
 * Painter for a body-of-revolution livery map (see loftBody): x along the body (u), angle around (v).
 * Draw in metres with `local()`: the transform maps 1 unit to 1 metre at the station radius.
 */
export class BodyPaint {
  constructor(body, { W = 2048, H = 1024 } = {}) {
    this.body = body;
    this.W = W; this.H = H;
    this.canvas = canvas(W, H);
    this.g = this.canvas.getContext('2d');
    this.x0 = body.xMin; this.x1 = body.xMax;
    this.sx = W / (this.x1 - this.x0);
  }

  px(x) { return (x - this.x0) * this.sx; }

  py(a) { return this.H * (1 - (a + Math.PI / 2) / TAU); }

  radius(x) { const p = this.body.params(x); return Math.max(0.05, (p.w + (p.top + p.bottom) / 2) / 2); }

  fill(color) { this.g.fillStyle = color; this.g.fillRect(0, 0, this.W, this.H); }

  /** Band between two angles (degrees, -90 = belly, 0 = right side, 90 = top, 180 = left) over an x range. */
  band(aLoDeg, aHiDeg, color, xa = this.x0, xb = this.x1) {
    const y0 = this.py(aHiDeg * Math.PI / 180); const y1 = this.py(aLoDeg * Math.PI / 180);
    this.g.fillStyle = color;
    this.g.fillRect(this.px(xa), y0, this.px(xb) - this.px(xa), y1 - y0);
  }

  /** Polygon from [x, angleDeg] points. */
  poly(pts, fill, alpha = 1) {
    const g = this.g;
    g.save(); g.globalAlpha = alpha; g.fillStyle = fill; g.beginPath();
    pts.forEach(([x, a], i) => { const X = this.px(x); const Y = this.py(a * Math.PI / 180); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.closePath(); g.fill(); g.restore();
  }

  /** Smooth ribbon along x: lo(x) and hi(x) give angle degrees. Handy for cheat lines. */
  ribbon(xa, xb, lo, hi, color, steps = 60) {
    const top = []; const bot = [];
    for (let i = 0; i <= steps; i++) { const x = xa + ((xb - xa) * i) / steps; top.push([x, hi(x)]); bot.push([x, lo(x)]); }
    this.poly([...top, ...bot.reverse()], color);
  }

  /** Run fn(g) with a metric transform at (x, angleDeg) on the given side (1 right, -1 left). */
  local(x, aDeg, side, fn, rOverride) {
    const g = this.g;
    const R = rOverride ?? this.radius(x);
    if (side < 0) aDeg = 180 - aDeg; // callers give right-side angles; the left side mirrors them
    g.save();
    g.translate(this.px(x), this.py(aDeg * Math.PI / 180));
    g.scale(this.sx, this.H / (TAU * R));
    if (side < 0) g.rotate(Math.PI);
    fn(g, R);
    g.restore();
  }

  /** Text in metres: height `size` (cap-ish), anchored at its centre. Sides: +1 right, -1 left (auto flipped). */
  text(str, x, aDeg, side, size, { color = '#111', weight = 'bold', stretch = 1, font = FONT, alpha = 1 } = {}) {
    this.local(x, aDeg, side, (g) => {
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.font = `${weight} ${size * 100}px ${font}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.scale(0.01 * stretch, 0.01); g.fillText(str, 0, 0); g.restore();
    });
  }

  /** Rounded quad window / panel outline from patch corners [[x, aRad], ...]. */
  quad(corners, outline, { fill = null, stroke = null, width = 2, alpha = 1 } = {}) {
    const g = this.g;
    g.save(); g.globalAlpha = alpha; g.beginPath();
    outline.forEach(([x, a], i) => { const X = this.px(x); const Y = this.py(a); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = width; g.stroke(); }
    g.restore();
    void corners;
  }

  /** Straight panel line in (x, angleDeg) space. */
  seam(x0, a0, x1, a1, color = 'rgba(40,44,50,0.55)', width = 1.5) {
    const g = this.g;
    g.save(); g.strokeStyle = color; g.lineWidth = width; g.beginPath();
    g.moveTo(this.px(x0), this.py(a0 * Math.PI / 180)); g.lineTo(this.px(x1), this.py(a1 * Math.PI / 180)); g.stroke(); g.restore();
  }

  /** Dirt/exhaust streak running aft from (x, angleDeg): fades toward the tail. */
  airflowStreak(x, aDeg, lenM, widthM, color, alpha) {
    const R = this.radius(x);
    streak(this.g, this.px(x), this.py(aDeg * Math.PI / 180), lenM * this.sx, widthM * this.H / (TAU * R), Math.PI, color, alpha);
  }

  blob(x, aDeg, rxM, ryM, color, alpha) {
    const R = this.radius(x);
    blot(this.g, this.px(x), this.py(aDeg * Math.PI / 180), rxM * this.sx, ryM * this.H / (TAU * R), color, alpha);
  }

  texture(maxAniso = 8) {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }
}

/**
 * Atlas for lifting surfaces. Each rect holds one panel unrolled: horizontal = span (metres from the root), vertical =
 * skin distance from the leading edge (upper surface above the centre line, lower below).
 * Use `rect.uv(z, p)` for geometry and `rect.paint(g => ...)` to draw in (span m, skin m) coordinates.
 */
export class AtlasPaint {
  constructor(panels, { W = 2048, H = 2048, pad = 6 } = {}) {
    this.W = W; this.H = H;
    this.canvas = canvas(W, H);
    this.g = this.canvas.getContext('2d');
    // Shelf-pack panels, shrinking the scale until everything fits.
    let k = 400;
    let placed = null;
    for (; k > 20; k *= 0.93) {
      let x = pad; let y = pad; let rowH = 0; let ok = true;
      const out = {};
      for (const [name, p] of Object.entries(panels)) {
        const w = Math.ceil(p.span * k); const h = Math.ceil(p.chord * 2 * k);
        if (w > W - pad * 2) { ok = false; break; }
        if (x + w + pad > W) { x = pad; y += rowH + pad; rowH = 0; }
        if (y + h + pad > H) { ok = false; break; }
        out[name] = { x, y, w, h, z0: p.z0 ?? 0, chord: p.chord };
        x += w + pad; rowH = Math.max(rowH, h);
      }
      if (ok) { placed = out; break; }
    }
    this.k = k;
    this.rects = {};
    for (const [name, r] of Object.entries(placed)) {
      const kk = k;
      this.rects[name] = {
        ...r,
        uv: (z, p) => [(r.x + (z - r.z0) * kk) / W, 1 - (r.y + r.h / 2 - p * kk) / H],
        // draw in (span m from the root, skin m) with +skin up the canvas (upper surface)
        paint: (fn) => {
          const g = this.g;
          g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
          g.translate(r.x - r.z0 * kk, r.y + r.h / 2); g.scale(kk, -kk);
          fn(g, r);
          g.restore();
        },
      };
    }
  }

  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
}

// ---- materials -------------------------------------------------------------------------------------------------------
const PRO = new Map();
/** Mark aircraft ids as using the high-fidelity material set (skin detail tile kind per id). */
export function registerPro(ids, tile = 'rivet') { for (const id of ids) PRO.set(id, tile); }
export const isPro = (id) => PRO.has(id);
export const proTile = (id) => PRO.get(id) ?? 'rivet';

/**
 * The full material set for the high-fidelity aircraft. Legacy keys (skin, wing, accent, dark, metal, steel,
 * rubber, glass, window, intake, prop, propTip) are all present so shared helpers keep working. `skin` and `wing`
 * get their `map` from the aircraft's own painter later (see attachSkin).
 */
export function createProMaterials(spec, { quality = 1, tile = 'rivet' } = {}) {
  const livery = spec.livery;
  const env = getEnvMap();
  const detail = getSkinTile(tile);
  const envMats = [];
  const phys = (p) => {
    const m = new THREE.MeshPhysicalMaterial({ envMap: env, envMapIntensity: 0.55, ...p });
    envMats.push(m);
    return m;
  };
  const baseRough = livery.roughness ?? 0.42;
  const paint = (extra = {}) => phys({
    color: 0xffffff, roughness: baseRough, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.18,
    normalMap: detail.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughnessMap: detail.orm, aoMap: detail.orm, aoMapIntensity: 0.85,
    ...extra,
  });
  const mats = {
    skin: paint(),
    wing: paint(),
    accent: phys({ color: livery.stripe ?? '#c0392b', roughness: 0.4, metalness: 0.1 }),
    dark: phys({ color: 0x1b1e23, roughness: 0.62, metalness: 0.2 }),
    trim: phys({ color: 0x262a2f, roughness: 0.75, metalness: 0.05 }),
    boot: phys({ color: 0x141517, roughness: 0.62, metalness: 0.0, normalMap: detail.normal, normalScale: new THREE.Vector2(0.4, 0.4) }),
    metal: phys({ color: 0xb4bcc4, roughness: 0.3, metalness: 1, envMapIntensity: 0.9 }),
    alu: phys({ color: 0xa9b0b7, roughness: 0.38, metalness: 1, envMapIntensity: 0.85, normalMap: detail.normal, normalScale: new THREE.Vector2(0.5, 0.5) }),
    steel: phys({ color: 0x6a717a, roughness: 0.42, metalness: 0.9, envMapIntensity: 0.8 }),
    chrome: phys({ color: 0xdfe4ea, roughness: 0.12, metalness: 1, envMapIntensity: 1.0 }),
    exhaust: phys({ color: 0x4a4540, roughness: 0.55, metalness: 0.85 }),
    rubber: phys({ color: 0x17191c, roughness: 0.9, metalness: 0 }),
    radome: phys({ color: 0xc9ccc4, roughness: 0.4, metalness: 0, clearcoat: 0.3 }),
    glass: phys({ color: 0x2c4a60, roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.42, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tint: phys({ color: 0x0b1118, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.78, envMapIntensity: 1.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    window: phys({ color: 0x141c26, roughness: 0.08, metalness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0, envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    intake: phys({ color: 0x0a0c0f, roughness: 0.85, metalness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.2 }),
    prop: phys({ color: 0x1d2024, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide, envMapIntensity: 0.7 }),
    propTip: phys({ color: livery.tip ?? 0xf2c230, roughness: 0.45, side: THREE.DoubleSide }),
    lensClear: phys({ color: 0xe8f0f8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.6, envMapIntensity: 1.2 }),
    lensRed: phys({ color: 0xc01818, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x300000, envMapIntensity: 1.2 }),
    lensGreen: phys({ color: 0x18a840, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85, emissive: 0x002a0c, envMapIntensity: 1.2 }),
    black: phys({ color: 0x0c0d0f, roughness: 0.7, metalness: 0 }),
  };
  const tireTex = getTireTextures();
  mats.tire = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tireTex.map, normalMap: tireTex.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92, metalness: 0 });
  mats.hub = phys({ color: livery.hub ?? 0xc9ced4, roughness: 0.35, metalness: 0.9 });
  mats.__envMats = envMats;
  mats.__quality = quality;
  mats.__tile = tile;
  mats.__pro = true;
  mats.setNight = (night) => {
    const k = 1 - 0.93 * night;
    for (const m of envMats) m.envMapIntensity = (m.userData.baseEnv ??= m.envMapIntensity) * k;
  };
  return mats;
}

/** Textures sized by the quality setting (0.5 for AI traffic). */
export const texSize = (mats, base) => Math.max(256, Math.round(base * (mats.__quality ?? 1) / 64) * 64);

export function attachMap(material, texture) {
  material.map = texture;
  material.needsUpdate = true;
}

export { LOW };
