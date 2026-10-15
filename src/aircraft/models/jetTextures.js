import * as THREE from 'three';
import { Fuselage } from './jetFuselage.js';
import { JET_CONFIGS } from './jetConfigs.js';
import { hashString, rng, clamp, TAU } from './jetKit.js';
import { wingSemi } from './jetWing.js';

// Canvas generated textures for the jet models: painted fuselage / wing / fin with panel lines, doors, stencils and weathering,
// matching normal and "ORM" (occlusion / roughness / metalness) maps, tyres, and engine cowls.

const cnv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const get = c.getContext.bind(c);
  c.getContext = (t) => get(t, { willReadFrequently: true });
  return c;
};

function toTexture(canvas, { srgb = false, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Height canvas (grey, 128 = flat) -> tangent space normal map canvas. */
function normalFromHeight(hc, strength = 2.0) {
  const w = hc.width;
  const h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cnv(w, h);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => src[((clamp(y, 0, h - 1) * w) + clamp(x, 0, w - 1)) * 4];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) / 255 * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) / 255 * strength;
      // canvas y runs down while texture v runs up -> flip dy
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

/** Combine height (AO from grooves), roughness canvas and metalness canvas into one RGB texture: R = ao, G = rough, B = metal. */
function ormFrom(hc, rc, mc) {
  const w = hc.width;
  const h = hc.height;
  const hd = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const rd = rc.getContext('2d').getImageData(0, 0, w, h).data;
  const md = mc ? mc.getContext('2d').getImageData(0, 0, w, h).data : null;
  const out = cnv(w, h);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h * 4; i += 4) {
    const hv = hd[i];
    d[i] = hv < 125 ? 150 + (hv - 70) * 1.2 : 255;
    d[i + 1] = rd[i];
    d[i + 2] = md ? md[i] : 0;
    d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

// ---- airline names for the fictional liveries -----------------------------------------------------------------
const AIRLINES = ['MERIDIAN AIR', 'HALCYON', 'KESTREL AIRWAYS', 'AERIS', 'NORTHWIND JET', 'SOLENNE', 'ORRIN AIR', 'TRANSVALE'];
export function airlineFor(spec) {
  const l = spec.livery;
  return AIRLINES[hashString(`${spec.id}${l.stripe}${l.stripe2}`) % AIRLINES.length];
}

// ---- cache ----------------------------------------------------------------------------------------------------------
const typeCache = new Map(); // id -> maps shared by every livery
const liveryCache = new Map(); // key -> livery dependent maps (LRU)
const LIVERY_LIMIT = 24;

function markShared(t) { t.userData.shared = true; return t; }

function remember(key, value) {
  liveryCache.delete(key);
  liveryCache.set(key, value);
  while (liveryCache.size > LIVERY_LIMIT) {
    const oldest = liveryCache.keys().next().value;
    const v = liveryCache.get(oldest);
    liveryCache.delete(oldest);
    for (const t of Object.values(v)) t.dispose();
  }
}

export function makeJetTextures(spec) {
  const cfg = JET_CONFIGS[spec.id];
  const fus = new Fuselage(cfg.fuselage);
  const T = typeCache.get(spec.id) ?? buildTypeMaps(spec, cfg, fus);
  typeCache.set(spec.id, T);
  const l = spec.livery;
  const key = [spec.id, l.base, l.stripe, l.stripe2, l.belly, l.wing, l.tip, l.regColor, l.roughness, spec.registration].join('|');
  let L = liveryCache.get(key);
  if (!L) {
    L = buildLiveryMaps(spec, cfg, fus);
    for (const t of Object.values(L)) markShared(t);
    remember(key, L);
  } else { liveryCache.delete(key); liveryCache.set(key, L); }
  return {
    fus: { map: L.fusMap, normal: T.fusNormal, orm: T.fusOrm },
    wing: { map: L.wingMap, normal: T.wingNormal, orm: T.wingOrm },
    fin: { map: L.finMap, normal: T.finNormal, orm: T.finOrm },
    nacelle: { map: L.nacMap, normal: T.nacNormal, orm: T.nacOrm },
    tyre: { map: T.tyreMap, normal: T.tyreNormal },
  };
}

// ---- helpers for painting on the fuselage in world coordinates ------------------------------------------------------------
class FusPainter {
  constructor(cfg, fus, ppm) {
    this.cfg = cfg;
    this.fus = fus;
    this.W = Math.round(fus.length * ppm);
    const circ = (Math.PI * (3 * (cfg.fuselage.w + cfg.fuselage.top) - Math.sqrt((3 * cfg.fuselage.w + cfg.fuselage.top) * (cfg.fuselage.w + 3 * cfg.fuselage.top))));
    this.H = Math.round(circ * ppm);
    this.ppm = ppm;
  }

  /** canvas pixel of world (x, y) on a side */
  px(x, y, side) {
    const [u, v] = this.fus.uvAt(x, y, side);
    return [u * this.W, (1 - v) * this.H];
  }

  /** fill the region between two height functions along x on a side */
  band(g, side, x0, x1, top, bot, step = 0.4) {
    g.beginPath();
    const n = Math.max(2, Math.ceil((x1 - x0) / step));
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; const [a, b] = this.px(x, top(x), side); if (i === 0) g.moveTo(a, b); else g.lineTo(a, b); }
    for (let i = n; i >= 0; i--) { const x = x0 + ((x1 - x0) * i) / n; const [a, b] = this.px(x, bot(x), side); g.lineTo(a, b); }
    g.closePath();
  }

  rect(g, side, x, y, w, h, r = 0.05) {
    const pts = [];
    const corner = (cx, cy, a0) => { for (let i = 0; i <= 3; i++) { const a = (a0 + 30 * i) * Math.PI / 180; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(x + w / 2 - r, y + h - r, 0); corner(x - w / 2 + r, y + h - r, 90); corner(x - w / 2 + r, y + r, 180); corner(x + w / 2 - r, y + r, 270);
    g.beginPath();
    pts.forEach(([a, b], i) => { const [px, py] = this.px(a, b, side); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
    g.closePath();
  }

  /** draw text readable from outside on a side, centred on world station xc; y is the baseline height */
  text(g, side, str, xc, y, sizeM, { weight = 'bold', family = 'Arial, Helvetica, sans-serif', spacing = 0.06 } = {}) {
    g.save();
    g.font = `${weight} ${sizeM * this.ppm}px ${family}`;
    if ('letterSpacing' in g) g.letterSpacing = `${spacing * sizeM * this.ppm}px`;
    const lenM = g.measureText(str).width / this.ppm;
    const xs = side > 0 ? xc - lenM / 2 : xc + lenM / 2;
    const [px, py] = this.px(xs, y, side);
    g.translate(px, py);
    if (side < 0) g.rotate(Math.PI);
    g.textBaseline = 'alphabetic';
    g.fillText(str, 0, 0);
    g.restore();
  }
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

function streak(g, x, y, len, w, alpha, color = '0,0,0', angle = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  const grad = g.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, `rgba(${color},0)`);
  grad.addColorStop(0.25, `rgba(${color},${alpha})`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, -w / 2, len, w);
  g.restore();
}

// ---- livery dependent maps --------------------------------------------------------------------------------------------------
function buildLiveryMaps(spec, cfg, fus) {
  const l = spec.livery;
  const ppm = fusPpm(cfg);
  const P = new FusPainter(cfg, fus, ppm);
  const R = rng(hashString(spec.id + l.stripe));
  const c = cnv(P.W, P.H);
  const g = c.getContext('2d');
  const yc = cfg.fuselage.yc;
  const Rw = cfg.fuselage.w;
  g.fillStyle = l.base;
  g.fillRect(0, 0, P.W, P.H);
  const LV = cfg.livery;
  const bellyCol = l.belly ?? shade(l.base, 0.86);
  for (const side of [1, -1]) {
    // belly colour below the waterline
    g.fillStyle = bellyCol;
    P.band(g, side, fus.xTail, fus.xNose, () => yc - 20, (x) => yc + LV.belly + (x < fus.xt0 ? (fus.xt0 - x) * 0.06 : 0));
    g.fill();
    if (LV.stripe) {
      const S = LV.stripe;
      const yAt = (x) => {
        const t = clamp((x - S.x0) / (S.x1 - S.x0), 0, 1); // 0 at the tail end .. 1 at the nose end
        return yc + S.y + S.rise * (1 - t) ** 2.2 - S.drop * t ** 3;
      };
      g.fillStyle = l.stripe;
      P.band(g, side, S.x0, S.x1, (x) => yAt(x) + S.w, (x) => yAt(x));
      g.fill();
      if (l.stripe2) {
        g.fillStyle = l.stripe2;
        P.band(g, side, S.x0, S.x1, (x) => yAt(x) - S.gap, (x) => yAt(x) - S.gap - S.w2);
        g.fill();
      }
    }
  }
  // radome and nose tip (dark grey cone)
  g.fillStyle = l.radome ?? '#6d737b';
  g.fillRect(P.W * ((fus.xNose - (LV.radome ?? 0.8) - fus.xTail) / fus.length), 0, P.W, P.H);
  const name = airlineFor(spec);
  for (const side of [1, -1]) {
    g.fillStyle = LV.titleColor ?? shade(l.stripe, 0.75);
    P.text(g, side, name, LV.title.xc, yc + LV.title.y, LV.title.size);
    g.fillStyle = l.regColor ?? '#1a2230';
    P.text(g, side, spec.registration, LV.reg.xc, yc + LV.reg.y, LV.reg.size, { spacing: 0.03 });
  }
  // belly grime, tyre smoke and exhaust staining
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40; i++) {
    const x = fus.xTail + R() * fus.length;
    const [px, py] = P.px(x, yc - Rw * (0.3 + R() * 0.7), R() < 0.5 ? 1 : -1);
    streak(g, px, py, 30 + R() * 90, 3 + R() * 8, 0.05 + R() * 0.07, '70,60,50', (R() - 0.5) * 0.1);
  }
  g.globalCompositeOperation = 'source-over';
  const fusMap = toTexture(c, { srgb: true });

  // wing, fin, nacelle colour maps
  const wing = paintWing(spec, cfg);
  const fin = paintFin(spec, cfg);
  const nac = paintNacelle(spec, cfg);
  return { fusMap, wingMap: wing, finMap: fin, nacMap: nac };
}

function fusPpm(cfg) {
  const len = cfg.fuselage.xNose - cfg.fuselage.xTail;
  return Math.min(100, (len > 60 ? 2560 : 2048) / len);
}

// ---- wing ----------------------------------------------------------------------------------------------------------------------
function paintWing(spec, cfg) {
  const l = spec.livery;
  const S = 1024;
  const c = cnv(S, S);
  const g = c.getContext('2d');
  const R = rng(hashString(spec.id + 'wing'));
  const top = l.wingTop ?? shade(l.wing ?? l.base, 0.8);
  g.fillStyle = l.wing ?? l.base; // lower (u 0..0.5)
  g.fillRect(0, 0, S / 2, S);
  g.fillStyle = top; // upper (u 0.5..1)
  g.fillRect(S / 2, 0, S / 2, S);
  const W = cfg.wing;
  const semi = wingSemi(W);
  const vOf = (z) => (1 - z / semi) * S;
  // weathering: leading edge dirt, engine soot behind the engines, wash streaks
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 60; i++) {
    const x = (R() < 0.5 ? S * 0.5 * R() : S * 0.5 + S * 0.5 * R());
    const y = R() * S;
    streak(g, x, y, 40 + R() * 160, 3 + R() * 8, 0.05 + R() * 0.07, '80,80,85', 0);
  }
  const lead = g.createLinearGradient(0, 0, S, 0);
  g.globalCompositeOperation = 'source-over';
  void lead;
  // coloured winglet / sharklet
  if (cfg.livery.wingletPaint) {
    g.fillStyle = l.tip ?? l.stripe;
    g.fillRect(0, 0, S, vOf(W.stations[W.stations.length - 1].z) - 2);
  }
  // control surface outlines
  g.strokeStyle = 'rgba(30,34,40,0.55)';
  g.lineWidth = 1.4;
  const outline = (z0, z1, cf0, cf1) => {
    for (const side of ['lo', 'up']) {
      const ux = (cf) => (side === 'lo' ? 0.5 * cf : 1 - 0.5 * cf) * S;
      g.strokeRect(Math.min(ux(cf0), ux(cf1)), vOf(z1), Math.abs(ux(cf1) - ux(cf0)), vOf(z0) - vOf(z1));
    }
  };
  for (const f of W.flaps ?? []) outline(f.z0, f.z1, f.cf ?? W.hinge ?? 0.74, 1);
  for (const a of W.ailerons ?? []) outline(a.z0, a.z1, a.cf ?? W.hinge ?? 0.74, 1);
  for (const s of W.slats ?? []) outline(s.z0, s.z1, 0, W.slatCf ?? 0.13);
  if (W.spoilers) {
    const sp = W.spoilers;
    for (let i = 0; i < sp.n; i++) {
      const a = sp.z0 + ((sp.z1 - sp.z0) * i) / sp.n;
      const b = sp.z0 + ((sp.z1 - sp.z0) * (i + 1)) / sp.n;
      outline(a, b, sp.cf ?? (W.hinge ?? 0.74) - 0.12, sp.cfEnd ?? (W.hinge ?? 0.74) + 0.03);
    }
  }
  // access panels / fuel tank panel lines
  g.strokeStyle = 'rgba(40,44,50,0.28)';
  for (let i = 0; i < 30; i++) {
    const z = (i / 30) * semi;
    g.beginPath(); g.moveTo(S / 2, vOf(z)); g.lineTo(S, vOf(z)); g.stroke();
    g.beginPath(); g.moveTo(0, vOf(z + 0.25)); g.lineTo(S / 2, vOf(z + 0.25)); g.stroke();
  }
  // walkway
  if (W.walkway) {
    g.fillStyle = 'rgba(40,40,44,0.55)';
    const wv = W.walkway;
    g.fillRect(S * 0.5 + S * 0.5 * 0.48, vOf(wv.z1), S * 0.5 * 0.05, vOf(wv.z0) - vOf(wv.z1));
  }
  return toTexture(c, { srgb: true });
}

function paintFin(spec, cfg) {
  const l = spec.livery;
  const W = 1024;
  const H = 1024;
  const c = cnv(W, H);
  const g = c.getContext('2d');
  const F = cfg.fin;
  const tail = cfg.livery.tailPaint ?? 'stripe';
  const col = tail === 'base' ? l.base : l.stripe;
  g.fillStyle = col;
  g.fillRect(0, 0, W, H);
  // Logo on both sides: left side is the "lower" half (u 0..0.5), right side the "upper" half.
  for (const side of [-1, 1]) {
    g.save();
    const x0 = side < 0 ? 0 : W / 2;
    g.beginPath(); g.rect(x0, 0, W / 2, H); g.clip();
    const cx = x0 + W * 0.25 + (side < 0 ? W * 0.01 : -W * 0.01);
    const cy = H * (cfg.livery.logoY ?? 0.45);
    g.fillStyle = l.stripe2 ?? '#ffffff';
    g.beginPath(); g.arc(cx, cy, W * 0.15, 0, TAU); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(cx + W * 0.03, cy - H * 0.02, W * 0.12, 0, TAU); g.fill();
    g.fillStyle = l.base;
    g.beginPath(); g.moveTo(cx - W * 0.1, cy + H * 0.06); g.quadraticCurveTo(cx, cy - H * 0.14, cx + W * 0.13, cy - H * 0.07); g.lineTo(cx + W * 0.1, cy); g.quadraticCurveTo(cx, cy - H * 0.06, cx - W * 0.1, cy + H * 0.09); g.fill();
    g.restore();
  }
  // rudder / panel lines
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  for (const u of [0.5 * (cfg.fin.hinge ?? 0.7), 1 - 0.5 * (cfg.fin.hinge ?? 0.7)]) { g.beginPath(); g.moveTo(u * W, 0); g.lineTo(u * W, H); g.stroke(); }
  void F;
  return toTexture(c, { srgb: true });
}

function paintNacelle(spec, cfg) {
  const l = spec.livery;
  const c = cnv(256, 256);
  const g = c.getContext('2d');
  const base = cfg.engines.paint === 'stripe' ? l.stripe : cfg.engines.paint === 'belly' ? (l.belly ?? l.base) : l.base;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'multiply';
  const R = rng(5);
  for (let i = 0; i < 24; i++) streak(g, R() * 256, R() * 256, 40 + R() * 100, 4 + R() * 8, 0.1, '60,55,50', 0);
  // soot at the rear
  const grad = g.createLinearGradient(160, 0, 256, 0);
  grad.addColorStop(0, 'rgba(60,55,50,0)');
  grad.addColorStop(1, 'rgba(60,55,50,0.45)');
  g.fillStyle = grad;
  g.fillRect(160, 0, 96, 256);
  return toTexture(c, { srgb: true });
}

// ---- type level maps (normal and ORM) ----------------------------------------------------------------------------------------
function buildTypeMaps(spec, cfg, fus) {
  const ppm = fusPpm(cfg);
  const P = new FusPainter(cfg, fus, ppm);
  const R = rng(hashString(spec.id));
  const W = P.W;
  const H = P.H;
  const hc = cnv(W, H);
  const hg = hc.getContext('2d');
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, W, H);
  const rc = cnv(W, H);
  const rg = rc.getContext('2d');
  rg.fillStyle = '#5a5a5a'; // roughness 0.35
  rg.fillRect(0, 0, W, H);
  const mc = cnv(W, H);
  const mg = mc.getContext('2d');
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, W, H);
  const yc = cfg.fuselage.yc;
  const Rw = cfg.fuselage.w;
  hg.strokeStyle = '#5c5c5c';
  hg.lineWidth = Math.max(1, ppm / 40);
  // circumferential skin joints (butt lines) and longitudinal lap joints
  for (const side of [1, -1]) {
    for (let x = fus.xt0 - 8; x < fus.xn0 + 0.6; x += 2.1) {
      const jitter = (Math.round(x * 3) % 3) * 0.3;
      hg.beginPath();
      let first = true;
      for (let y = yc - Rw; y <= yc + Rw; y += 0.1) { const [a, b] = P.px(x + jitter, y, side); if (first) hg.moveTo(a, b); else hg.lineTo(a, b); first = false; }
      hg.stroke();
    }
    for (const dy of [-0.85, -0.6, -0.3, 0.0, 0.32, 0.62, 0.86, 1.0]) {
      hg.beginPath();
      const y0 = yc + dy * Rw;
      let first = true;
      for (let x = fus.xTail + 0.4; x < fus.xNose - 3.0; x += 0.6) { const [a, b] = P.px(x, y0, side); if (first) hg.moveTo(a, b); else hg.lineTo(a, b); first = false; }
      hg.stroke();
    }
  }
  // doors: groove outline + slightly raised handle recess
  for (const d of cfg.doors ?? []) {
    for (const side of d.sides ?? [1, -1]) {
      hg.strokeStyle = '#444';
      hg.lineWidth = Math.max(1.2, ppm / 30);
      P.rect(hg, side, d.x, d.y0, d.w, d.h, 0.07);
      hg.stroke();
    }
  }
  // window belt: panel lines above and below the windows
  if (cfg.windows) {
    for (const side of [1, -1]) {
      for (const dy of [cfg.windows.y + (cfg.windows.h ?? 0.35) * 0.9, cfg.windows.y - (cfg.windows.h ?? 0.35) * 0.9]) {
        hg.strokeStyle = '#5a5a5a';
        hg.beginPath();
        let first = true;
        for (let x = cfg.windows.x0 - 0.4; x < cfg.windows.x1 + 0.4; x += 0.4) { const [a, b] = P.px(x, yc + dy, side); if (first) hg.moveTo(a, b); else hg.lineTo(a, b); first = false; }
        hg.stroke();
      }
    }
  }
  // rivet rows along some seams (dots)
  hg.fillStyle = '#9a9a9a';
  for (let i = 0; i < 0; i++) hg.fillRect(R() * W, R() * H, 1, 1);
  // roughness: dirtier / rougher patches
  rg.globalAlpha = 0.25;
  for (let i = 0; i < 80; i++) {
    rg.fillStyle = R() < 0.5 ? '#8a8a8a' : '#4a4a4a';
    rg.fillRect(R() * W, R() * H, 20 + R() * 120, 3 + R() * 10);
  }
  rg.globalAlpha = 1;
  const fusNormal = markShared(toTexture(normalFromHeight(hc, 2.4)));
  const fusOrm = markShared(toTexture(ormFrom(hc, rc, mc)));

  // wing / fin / nacelle share small generic panel maps
  const gen = (size, step, seed, lines) => {
    const h2 = cnv(size, size);
    const g = h2.getContext('2d');
    g.fillStyle = '#808080';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#555';
    g.lineWidth = 1.5;
    const Rr = rng(seed);
    if (lines) {
      for (let y = step; y < size; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
      for (let x = step * 1.5; x < size; x += step * 2.2) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
    }
    g.fillStyle = '#8c8c8c';
    for (let i = 0; i < 400; i++) g.fillRect(Rr() * size, Rr() * size, 1, 1);
    const r2 = cnv(size, size);
    const rg2 = r2.getContext('2d');
    rg2.fillStyle = '#666';
    rg2.fillRect(0, 0, size, size);
    return [normalFromHeight(h2, 2.2), ormFrom(h2, r2, null)];
  };
  const [wn, wo] = gen(1024, 64, 11, true);
  const [fn, fo] = gen(1024, 90, 12, true);
  // nacelle: fan cowl / thrust reverser seams, split lines and a few access doors
  const nh = cnv(256, 256);
  const nhg = nh.getContext('2d');
  nhg.fillStyle = '#808080';
  nhg.fillRect(0, 0, 256, 256);
  nhg.strokeStyle = '#4a4a4a';
  nhg.lineWidth = 2;
  for (const u of [0.3, 0.5, 0.56, 0.8]) { nhg.beginPath(); nhg.moveTo(u * 256, 0); nhg.lineTo(u * 256, 256); nhg.stroke(); }
  for (const v of [0.25, 0.75]) { nhg.beginPath(); nhg.moveTo(0, v * 256); nhg.lineTo(256, v * 256); nhg.stroke(); }
  nhg.strokeRect(0.33 * 256, 0.4 * 256, 0.14 * 256, 0.14 * 256);
  nhg.strokeRect(0.6 * 256, 0.1 * 256, 0.16 * 256, 0.12 * 256);
  nhg.fillStyle = '#909090';
  for (let i = 0; i < 300; i++) nhg.fillRect(R() * 256, R() * 256, 1, 1);
  const nr = cnv(256, 256);
  const nrg = nr.getContext('2d');
  nrg.fillStyle = '#5c5c5c';
  nrg.fillRect(0, 0, 256, 256);
  const nn = normalFromHeight(nh, 2.5);
  const no = ormFrom(nh, nr, null);
  // tyres
  const tm = cnv(256, 256);
  const tg = tm.getContext('2d');
  tg.fillStyle = '#1a1b1d';
  tg.fillRect(0, 0, 256, 256);
  tg.fillStyle = '#c9ccd0';
  tg.font = 'bold 22px Arial';
  tg.textBaseline = 'middle';
  tg.globalAlpha = 0.65;
  tg.fillText('AEROTREAD', 8, 40);
  tg.fillText('RADIAL', 8, 200);
  tg.globalAlpha = 1;
  const th = cnv(256, 256);
  const thg = th.getContext('2d');
  thg.fillStyle = '#808080';
  thg.fillRect(0, 0, 256, 256);
  thg.strokeStyle = '#2a2a2a';
  thg.lineWidth = 3;
  for (const u of [0.38, 0.5, 0.62]) { thg.beginPath(); thg.moveTo(u * 256, 0); thg.lineTo(u * 256, 256); thg.stroke(); }
  return {
    fusNormal,
    fusOrm,
    wingNormal: markShared(toTexture(wn)),
    wingOrm: markShared(toTexture(wo)),
    finNormal: markShared(toTexture(fn)),
    finOrm: markShared(toTexture(fo)),
    nacNormal: markShared(toTexture(nn)),
    nacOrm: markShared(toTexture(no)),
    tyreMap: markShared(toTexture(tm, { srgb: true })),
    tyreNormal: markShared(toTexture(normalFromHeight(th, 3))),
  };
}
