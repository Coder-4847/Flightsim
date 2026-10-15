import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HIGH, MEDIUM, LOW } from './lod.js';

// High-fidelity procedural geometry kit (body frame: +X nose, +Y up, +Z right, metres).
// Everything here returns plain BufferGeometry with position/normal/uv/uv1; `Parts` merges them
// per material so a whole aircraft costs a handful of draw calls.

export { HIGH, MEDIUM, LOW };
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---- geometry normalisation and merging -------------------------------------------------------------
/** Make a geometry mergeable: indexed, with position/normal/uv/uv1 only. */
export function std(geo) {
  const pos = geo.attributes.position;
  if (!geo.index) {
    const n = pos.count;
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  if (!geo.attributes.uv1) geo.setAttribute('uv1', geo.attributes.uv.clone());
  for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(name)) geo.deleteAttribute(name);
  return geo;
}

function flipWinding(geo) {
  const a = geo.index.array;
  for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
}

/** Matrix from translation, Euler XYZ rotation (radians) and scale. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')), V(sx, sy, sz));
}

/** Transform a geometry copy; fixes winding for mirrored matrices. */
export function xf(geo, m) {
  const g = std(geo.clone());
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
  return g;
}

/** Mirror a geometry across the XY plane (z -> -z). */
export function mirrorZ(geo) {
  const g = std(geo.clone());
  g.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  flipWinding(g);
  return g;
}

/** Collects static geometry per material and merges it into one mesh per material. */
export class Parts {
  constructor(mats) {
    this.mats = mats;
    this.lists = new Map();
  }

  add(mat, geo, m) {
    const material = typeof mat === 'string' ? this.mats[mat] : mat;
    if (!material) throw new Error(`Parts: unknown material ${mat}`);
    const g = m ? xf(geo, m) : std(geo.clone());
    if (!this.lists.has(material)) this.lists.set(material, []);
    this.lists.get(material).push(g);
    return this;
  }

  /** Mirrored copy (z -> -z) of a geometry added next to the original. */
  addPair(mat, geo, m) {
    this.add(mat, geo, m);
    const mm = new THREE.Matrix4().makeScale(1, 1, -1);
    if (m) mm.multiply(m);
    this.add(mat, geo, mm);
    return this;
  }

  build(parent) {
    const out = [];
    for (const [material, list] of this.lists) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.userData.partsMaterial = true;
      parent.add(mesh);
      out.push(mesh);
    }
    this.lists.clear();
    return out;
  }
}

// ---- PCHIP interpolation (smooth, never overshoots) ---------------------------------------------------
function pchip(xs, ys) {
  const n = xs.length;
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / (h[i] || 1e-9); }
  const m = new Array(n).fill(0);
  if (n === 2) { m[0] = d[0]; m[1] = d[0]; return m; }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  return m;
}

function hermite(x0, x1, y0, y1, m0, m1, x) {
  const h = x1 - x0;
  const t = (x - x0) / (h || 1e-9);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1;
}

/** Smooth 1D curve through [x, y] points (used for chord, twist and profile laws). */
export function curve1(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const m = pchip(xs, ys);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 0;
    while (i < xs.length - 2 && x > xs[i + 1]) i++;
    return hermite(xs[i], xs[i + 1], ys[i], ys[i + 1], m[i], m[i + 1], x);
  };
}

// ---- lofted bodies (fuselages, nacelles, pods, tanks) ---------------------------------------------------
const KEYS = ['w', 'top', 'bottom', 'yc', 'zc', 'nt', 'nb', 'wb'];
const DEFAULTS = { w: 0.01, top: 0.01, bottom: 0.01, yc: 0, zc: 0, nt: 2, nb: 2, wb: 1 };

function prepStations(stations) {
  const st = stations.map((s) => {
    const o = { x: s.x };
    for (const k of KEYS) o[k] = s[k] ?? ((k === 'nt' || k === 'nb') ? (s.n ?? DEFAULTS[k]) : DEFAULTS[k]);
    return o;
  });
  const xs = st.map((s) => s.x);
  const tan = {};
  for (const k of KEYS) tan[k] = pchip(xs, st.map((s) => s[k]));
  return { st, xs, tan };
}

function evalStations(P, x) {
  const { st, xs, tan } = P;
  const n = xs.length;
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const xc = Math.min(xs[n - 1], Math.max(xs[0], x));
  const out = {};
  for (const k of KEYS) out[k] = hermite(xs[i], xs[i + 1], st[i][k], st[i + 1][k], tan[k][i], tan[k][i + 1], xc);
  return out;
}

/** [z, y] on the superellipse cross-section at angle a (0 = right side, pi/2 = top). */
function ringPoint(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const up = s >= 0;
  const A = Math.max(1e-4, p.w * (up ? 1 : p.wb));
  const B = Math.max(1e-4, up ? p.top : p.bottom);
  const n = Math.max(2, up ? p.nt : p.nb);
  const r = (Math.abs(c / A) ** n + Math.abs(s / B) ** n) ** (-1 / n);
  return [p.zc + r * c, p.yc + r * s];
}

/**
 * Loft a body through superellipse stations (ascending x):
 * {x, w (half width), top, bottom (heights above/below yc), yc, zc, n | nt, nb (squareness), wb (lower width factor)}.
 * The seam runs along the belly: v = 0 at the belly, 0.25 right side, 0.5 top, 0.75 left side.
 * Returns { geo, at(x, a, lift) -> {p, n}, uvOf(x, a), xMin, xMax, ringAt(x) }.
 */
export function loftBody(stations, {
  detail = HIGH, segs, step = 0.2, tile = 2, minSub = 1,
} = {}) {
  const P = prepStations(stations);
  const nSeg = segs ?? [12, 26, 56][detail];
  const xs = P.xs;
  const ringX = [xs[0]];
  for (let i = 0; i < xs.length - 1; i++) {
    const len = xs[i + 1] - xs[i];
    const sub = Math.max(detail === LOW ? 1 : minSub, Math.ceil(len / (step * [4, 2, 1][detail])));
    for (let k = 1; k <= sub; k++) ringX.push(xs[i] + (len * k) / sub);
  }
  const cols = nSeg + 1;
  const nRing = ringX.length;
  const pos = new Float32Array(nRing * cols * 3);
  const uv = new Float32Array(nRing * cols * 2);
  const uv1 = new Float32Array(nRing * cols * 2);
  let perimMax = 0;
  const perim = [];
  for (let r = 0; r < nRing; r++) {
    const p = evalStations(P, ringX[r]);
    let a2 = 0; let pz = 0; let py = 0;
    for (let s = 0; s <= 24; s++) { const [z, y] = ringPoint(p, -Math.PI / 2 + (s / 24) * TAU); if (s) a2 += Math.hypot(z - pz, y - py); pz = z; py = y; }
    perim.push(a2); perimMax = Math.max(perimMax, a2);
  }
  const x0 = xs[0];
  const xSpan = xs[xs.length - 1] - x0 || 1;
  for (let r = 0; r < nRing; r++) {
    const p = evalStations(P, ringX[r]);
    let arc = 0;
    let prevZ = 0;
    let prevY = 0;
    for (let s = 0; s < cols; s++) {
      const a = -Math.PI / 2 + (s / nSeg) * TAU;
      const [z, y] = ringPoint(p, a);
      const o = (r * cols + s) * 3;
      pos[o] = ringX[r]; pos[o + 1] = y; pos[o + 2] = z;
      if (s > 0) arc += Math.hypot(z - prevZ, y - prevY);
      prevZ = z; prevY = y;
      const q = (r * cols + s) * 2;
      uv[q] = (ringX[r] - x0) / xSpan; uv[q + 1] = s / nSeg;
      uv1[q] = ringX[r] / tile; uv1[q + 1] = (s / nSeg) * (perimMax * 0.55 * 0.7 + perim[r] * 0.3) / tile; void arc;
    }
  }
  // Analytic grid normals (smooth across the belly seam).
  const nrm = new Float32Array(pos.length);
  const P3 = (r, s) => { const o = (r * cols + (s % nSeg)) * 3; return [pos[o], pos[o + 1], pos[o + 2]]; };
  for (let r = 0; r < nRing; r++) {
    const r0 = Math.max(0, r - 1);
    const r1 = Math.min(nRing - 1, r + 1);
    for (let s = 0; s < cols; s++) {
      const sa = (s + nSeg - 1) % nSeg;
      const sb = (s + 1) % nSeg;
      const A = P3(r, sa); const B = P3(r, sb);
      const C = P3(r0, s); const D = P3(r1, s);
      const dxv = [D[0] - C[0], D[1] - C[1], D[2] - C[2]];
      const dav = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      let nx = dxv[1] * dav[2] - dxv[2] * dav[1];
      let ny = dxv[2] * dav[0] - dxv[0] * dav[2];
      let nz = dxv[0] * dav[1] - dxv[1] * dav[0];
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) { nx = r === 0 ? -1 : 1; ny = 0; nz = 0; } else { nx /= len; ny /= len; nz /= len; }
      const o = (r * cols + s) * 3;
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
    }
  }
  const idx = [];
  for (let r = 0; r < nRing - 1; r++) {
    for (let s = 0; s < nSeg; s++) {
      const a = r * cols + s;
      const b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  geo.setIndex(idx);
  // Make sure triangles face the same way as the normals.
  {
    const ia = geo.index.array;
    const i0 = ia[3 * Math.floor(ia.length / 6)]; const i1 = ia[3 * Math.floor(ia.length / 6) + 1]; const i2 = ia[3 * Math.floor(ia.length / 6) + 2];
    const pa = V(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]);
    const pb = V(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]);
    const pc = V(pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]);
    const fn = pb.clone().sub(pa).cross(pc.clone().sub(pa));
    const vn = V(nrm[i0 * 3], nrm[i0 * 3 + 1], nrm[i0 * 3 + 2]);
    if (fn.dot(vn) < 0) flipWinding(geo);
  }
  geo.computeBoundingSphere();

  const pointAt = (x, a) => { const p = evalStations(P, x); const [z, y] = ringPoint(p, a); return V(x, y, z); };
  const at = (x, a, lift = 0) => {
    const e = 0.02;
    const p0 = pointAt(x, a);
    const dxv = pointAt(x + e, a).sub(pointAt(x - e, a));
    const dav = pointAt(x, a + 0.01).sub(pointAt(x, a - 0.01));
    const n = dxv.cross(dav).normalize();
    if (!Number.isFinite(n.x)) n.set(0, 1, 0);
    return { p: p0.addScaledVector(n, lift), n };
  };
  return {
    geo, at, xMin: x0, xMax: xs[xs.length - 1], params: (x) => evalStations(P, x),
    uvOf: (x, a) => [(x - x0) / xSpan, (a + Math.PI / 2) / TAU],
    P,
  };
}

/**
 * A patch conforming to a lofted body: corners [[x, a], x4] in (x, angle) space (order: aft-low, fore-low,
 * fore-high, aft-high in angle terms, any consistent quad), rounded by superellipse power `p`.
 * Used for windows, windshields, panels and fairings so they hug the skin exactly.
 */
export function bodyPatch(body, corners, {
  lift = 0.006, p = 4, nu = 10, nv = 6, uvCorners = null,
} = {}) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const [c00, c10, c11, c01] = corners;
  const bil = (u, v) => {
    const x = (1 - u) * (1 - v) * c00[0] + u * (1 - v) * c10[0] + u * v * c11[0] + (1 - u) * v * c01[0];
    const a = (1 - u) * (1 - v) * c00[1] + u * (1 - v) * c10[1] + u * v * c11[1] + (1 - u) * v * c01[1];
    return [x, a];
  };
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      let su = (i / nu) * 2 - 1;
      let sv = (j / nv) * 2 - 1;
      const m = Math.max(Math.abs(su), Math.abs(sv));
      if (m > 0) {
        const k = m / (Math.abs(su) ** p + Math.abs(sv) ** p) ** (1 / p);
        su *= k; sv *= k;
      }
      const [x, a] = bil((su + 1) / 2, (sv + 1) / 2);
      const { p: pt, n } = body.at(x, a, lift);
      pos.push(pt.x, pt.y, pt.z); nrm.push(n.x, n.y, n.z);
      uv.push(i / nu, j / nv);
    }
  }
  void uvCorners;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Orient like the normals.
  const i0 = idx[0]; const i1 = idx[1]; const i2 = idx[2];
  const pa = V(pos[i0 * 3], pos[i0 * 3 + 1], pos[i0 * 3 + 2]);
  const fn = V(pos[i1 * 3], pos[i1 * 3 + 1], pos[i1 * 3 + 2]).sub(pa).cross(V(pos[i2 * 3], pos[i2 * 3 + 1], pos[i2 * 3 + 2]).sub(pa));
  if (fn.dot(V(nrm[i0 * 3], nrm[i0 * 3 + 1], nrm[i0 * 3 + 2])) < 0) flipWinding(g);
  return std(g);
}

/** Outline (closed polyline of [x, a]) of the same rounded quad bodyPatch uses, for painting into textures. */
export function patchOutline(corners, { p = 4, n = 40 } = {}) {
  const [c00, c10, c11, c01] = corners;
  const bil = (u, v) => [
    (1 - u) * (1 - v) * c00[0] + u * (1 - v) * c10[0] + u * v * c11[0] + (1 - u) * v * c01[0],
    (1 - u) * (1 - v) * c00[1] + u * (1 - v) * c10[1] + u * v * c11[1] + (1 - u) * v * c01[1],
  ];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const su = Math.sign(c) * Math.abs(c) ** (2 / p);
    const sv = Math.sign(s) * Math.abs(s) ** (2 / p);
    pts.push(bil((su + 1) / 2, (sv + 1) / 2));
  }
  return pts;
}

// ---- airfoils and wings --------------------------------------------------------------------------------------
/** NACA four-digit camber line y_c(x) and its thickness distribution (closed trailing edge). */
export function nacaThickness(x, t) {
  return 5 * t * (0.2969 * Math.sqrt(Math.max(x, 0)) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}
export function nacaCamber(x, m, p) {
  if (!m) return 0;
  return x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * ((1 - 2 * p) + 2 * p * x - x * x);
}

/**
 * Section keys: {z (span), x (leading edge), y, chord, t (thickness), camber (max camber), cp (camber position),
 * twist (deg, nose-up positive), dy (extra vertical offset)}. Linear interpolation between sections.
 */
export function sectionAt(sections, z) {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (z <= first.z) return { ...first, z };
  if (z >= last.z) return { ...last, z };
  let i = 0;
  while (i < sections.length - 2 && z > sections[i + 1].z) i++;
  const a = sections[i];
  const b = sections[i + 1];
  const t = (z - a.z) / (b.z - a.z || 1);
  const out = { z };
  for (const key of ['x', 'y', 'chord', 't', 'camber', 'cp', 'twist']) out[key] = (a[key] ?? (key === 'cp' ? 0.4 : 0)) + ((b[key] ?? (key === 'cp' ? 0.4 : 0)) - (a[key] ?? (key === 'cp' ? 0.4 : 0))) * t;
  return out;
}

/** Point on a section at chord fraction xf (0 = leading edge) on the upper (+1) or lower (-1) surface. */
export function foilPoint(sec, xf, side, thickScale = 1) {
  const th = nacaThickness(xf, sec.t * thickScale);
  const cm = nacaCamber(xf, sec.camber ?? 0, sec.cp ?? 0.4);
  const yy = cm + side * th;
  const tw = ((sec.twist ?? 0) * DEG);
  const dx = xf - 0.25;
  const rx = 0.25 + dx * Math.cos(tw) + yy * Math.sin(tw);
  const ry = -dx * Math.sin(tw) + yy * Math.cos(tw);
  return [sec.x - rx * sec.chord, sec.y + ry * sec.chord];
}

const cosSpace = (a, b, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * ((1 - Math.cos(Math.PI * (i / n))) / 2));
  return out;
};

/**
 * Loft a (right-hand, +Z span) lifting-surface panel between spans z0..z1 and chord fractions xf0..xf1.
 * Options: detail, roundNose (aft slices get a rounded nose), tipRound (rounded tip cap), capA / capB (flat end caps),
 * map(z, p) -> [u, v] atlas coordinates (p = signed distance along the skin from the leading edge: upper +, lower -),
 * tile (metres per detail-texture repeat), dz (max spanwise slice).
 */
export function wingSurface(sections, z0, z1, {
  xf0: xf0In = 0, xf1: xf1In = 1, detail = HIGH, roundNose = false, tipRound = 0, capA = false, capB = false, map = null, tile = 2, dz = 0.4,
  thickScale = 1,
} = {}) {
  const xf0Min = typeof xf0In === 'function' ? 0.3 : xf0In;
  void xf0Min;
  const nCh = [3, 8, 18][detail];
  const zs = [z0];
  const bps = [z0, ...sections.map((s) => s.z).filter((z) => z > z0 + 1e-6 && z < z1 - 1e-6), z1];
  for (let i = 0; i < bps.length - 1; i++) {
    const n = Math.max(1, Math.ceil((bps[i + 1] - bps[i]) / (dz * [4, 2, 1][detail])));
    for (let k = 1; k <= n; k++) zs.push(bps[i] + ((bps[i + 1] - bps[i]) * k) / n);
  }
  // Rounded tip: extra rings that close the section down to its camber line.
  const rings = zs.map((z) => ({ z, k: 1 }));
  if (tipRound > 0) {
    const sec = sectionAt(sections, z1);
    const r = tipRound;
    const steps = detail === LOW ? 1 : 5;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2);
      rings.push({ z: z1 + r * Math.sin(a), k: Math.max(0.02, Math.cos(a)), sec });
    }
  }
  const runsOf = (sec, k) => {
    const xf0 = typeof xf0In === 'function' ? xf0In(sec.z) : xf0In;
    const xf1 = typeof xf1In === 'function' ? xf1In(sec.z) : xf1In;
    const lower = cosSpace(xf1, xf0, nCh);
    const upper = cosSpace(xf0, xf1, nCh);
    const kk = k * thickScale;
    const run = [];
    for (const x of lower) run.push({ p: foilPoint(sec, x, -1, kk), xf: x, side: -1 });
    if (xf0 > 0 && roundNose) {
      // Rounded nose in front of the hinge line.
      const up = foilPoint(sec, xf0, 1, kk); const lo = foilPoint(sec, xf0, -1, kk);
      const cx = (up[0] + lo[0]) / 2; const cy = (up[1] + lo[1]) / 2;
      const rad = Math.hypot(up[0] - lo[0], up[1] - lo[1]) / 2;
      for (let i = 1; i < 5; i++) {
        const ang = Math.PI * (i / 5);
        // Rotate from the lower point around the front to the upper point.
        const dxv = lo[0] - cx; const dyv = lo[1] - cy;
        const c = Math.cos(ang); const s = Math.sin(ang);
        run.push({ p: [cx + (dxv * c - dyv * s) * 1, cy + (dxv * s + dyv * c) * 1 + 0], xf: xf0, side: 0, nose: rad });
      }
    }
    const upperPts = (xf0 === 0 || roundNose) && !(xf0 > 0 && roundNose) ? upper.slice(1) : upper;
    for (const x of upperPts) run.push({ p: foilPoint(sec, x, 1, kk), xf: x, side: 1 });
    const runs = [run];
    if (xf1 < 1 || hasCut) runs.push([run[run.length - 1], run[0]]); // flat cut face at the hinge
    return runs;
  };
  const pos = [];
  const nrm = [];
  const uvA = [];
  const uvB = [];
  const idx = [];
  const hasCut = typeof xf1In === 'function' || xf1In < 1;
  const runCount = hasCut ? 2 : 1;
  const bases = [];
  const runLens = [];
  const ringRuns = rings.map((rg) => runsOf(rg.sec ?? sectionAt(sections, rg.z), rg.k));
  for (let q = 0; q < runCount; q++) {
    bases.push(pos.length / 3);
    runLens.push(ringRuns[0][q].length);
    for (let r = 0; r < rings.length; r++) {
      const sec = rings[r].sec ?? sectionAt(sections, rings[r].z);
      for (const pt of ringRuns[r][q]) {
        pos.push(pt.p[0], pt.p[1], rings[r].z);
        const arc = pt.side === 0 ? 0 : pt.side * pt.xf * sec.chord;
        const m = map ? map(rings[r].z, arc, pt.side) : [0, 0];
        uvA.push(m[0], m[1]);
        uvB.push(rings[r].z / tile, arc / tile);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < runLens[q] - 1; i++) {
        const a = bases[q] + r * runLens[q] + i;
        const b = a + runLens[q];
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(uvB, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The upper surface must face +Y.
  {
    const n = geo.attributes.normal;
    const p = geo.attributes.position;
    let score = 0;
    for (let i = 0; i < p.count; i += 3) score += n.getY(i) * Math.sign(p.getY(i) - (sectionAt(sections, p.getZ(i)).y));
    if (score < 0) flipWinding(geo);
    geo.computeVertexNormals();
  }
  const parts = [geo];
  const cap = (ringIndex, dir) => {
    const run = ringRuns[ringIndex][0];
    const z = rings[ringIndex].z;
    const c = [0, 0];
    for (const pt of run) { c[0] += pt.p[0]; c[1] += pt.p[1]; }
    c[0] /= run.length; c[1] /= run.length;
    const cp = [c[0], c[1], z];
    const cpos = [cp[0], cp[1], cp[2]];
    for (const pt of run) cpos.push(pt.p[0], pt.p[1], z);
    const cidx = [];
    for (let i = 0; i < run.length - 1; i++) cidx.push(0, 1 + i, 2 + i);
    cidx.push(0, run.length, 1);
    const cn = [];
    for (let i = 0; i < run.length + 1; i++) cn.push(0, 0, dir);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    g.setIndex(cidx);
    const t0 = g.index.array;
    const pa = V(cpos[0], cpos[1], cpos[2]); const pb = V(cpos[3], cpos[4], cpos[5]); const pc = V(cpos[6], cpos[7], cpos[8]);
    if (pb.sub(pa).cross(pc.sub(pa)).z * dir < 0) { for (let i = 0; i < t0.length; i += 3) { const t = t0[i + 1]; t0[i + 1] = t0[i + 2]; t0[i + 2] = t; } }
    parts.push(g);
  };
  if (capA) cap(0, -1);
  if (capB && !tipRound) cap(rings.length - 1, 1);
  const out = parts.length === 1 ? std(parts[0]) : mergeGeometries(parts.map(std), false);
  out.computeBoundingSphere();
  return out;
}

/** The hinge line (x, y of the section at chord fraction xf) at two spans, for pivots. */
export function hingePoints(sections, z0, z1, xf) {
  const pt = (z) => { const s = sectionAt(sections, z); const [x, y] = foilPoint(s, typeof xf === 'function' ? xf(z) : xf, 1, 0); return V(x, y, z); };
  return [pt(z0), pt(z1)];
}

/**
 * A hinged control surface (aft slice of a wing panel) with its own pivot. `m` places the panel in the aircraft frame
 * (identity for ordinary wings, a rotation for fins), `side` = +1/-1 mirrors it across the centreline.
 * Returns { pivot, axis, mesh }. The axis follows the rig convention (see aircraftView): wings and stabilisers rotate about the
 * outboard direction on the right and the inboard direction on the left; rudders always point up.
 */
export function hingedSurface(sections, z0, z1, xf, material, {
  detail = HIGH, m = null, side = 1, map = null, tile = 2, kind = 'wing', thickScale = 1, capA = true, capB = true, dz,
} = {}) {
  let geo = wingSurface(sections, z0, z1, { xf0: xf, xf1: 1, detail, roundNose: true, capA, capB, map, tile, thickScale, dz });
  const [h0, h1] = hingePoints(sections, z0, z1, xf);
  let a = h0.clone(); let b = h1.clone();
  if (m) { geo = xf2(geo, m); a.applyMatrix4(m); b.applyMatrix4(m); }
  if (side < 0) {
    geo = mirrorZ(geo);
    a = V(a.x, a.y, -a.z); b = V(b.x, b.y, -b.z);
  }
  geo.translate(-a.x, -a.y, -a.z);
  const axis = b.clone().sub(a).normalize();
  if (side < 0 && kind !== 'rudder') axis.set(-axis.x, -axis.y, -axis.z);
  const pivot = new THREE.Object3D();
  pivot.position.copy(a);
  const mesh = new THREE.Mesh(geo, material);
  pivot.add(mesh);
  return { pivot, axis, mesh };
}
const xf2 = (g, m) => xf(g, m);

// ---- surfaces of revolution --------------------------------------------------------------------------------------
/**
 * Revolve a profile [[x, r], ...] about the X axis. Duplicate consecutive points make a hard edge.
 * `open` leaves it as a thin shell (no end caps are generated either way).
 */
export function revolve(profile, segs = 24) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0004), x));
  const geo = new THREE.LatheGeometry(pts, segs);
  geo.rotateZ(-Math.PI / 2);
  // After the rotation the lathe seam sits on -Y/+Z; normals face outward for descending-x profiles.
  geo.computeBoundingSphere();
  return std(geo);
}

/** Cylinder-ish tube from a to b (cone when radii differ). */
export function tubeBetween(a, b, r0, r1 = r0, segs = 10, capped = true) {
  const dir = V().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), segs, 1, !capped);
  g.applyMatrix4(new THREE.Matrix4().compose(V().addVectors(a, b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize()), V(1, 1, 1)));
  return std(g);
}

/** Streamlined (elliptical or airfoil section) strut between two points; `chord` along X, `thick` ratio. */
export function airfoilStrut(a, b, chord, tc = 0.12, segs = 10) {
  const dir = V().subVectors(b, a);
  const len = dir.length();
  const sec = { z: 0, x: chord * 0.5, y: 0, chord, t: tc, camber: 0 };
  const g = wingSurface([sec, { ...sec, z: len }], 0, len, { detail: HIGH, dz: len / segs, capA: true, capB: true });
  // Wing span runs along +Z; rotate so +Z -> dir.
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a, q, V(1, 1, 1)));
  return g;
}

export const roundedBox = (w, h, d, r = 0.01, segs = 2) => std(new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
export const boxG = (w, h, d) => std(new THREE.BoxGeometry(w, h, d));
export const sphereG = (r, ws = 16, hs = 10) => std(new THREE.SphereGeometry(r, ws, hs));
export const cylX = (r0, r1, len, segs = 14, capped = true) => {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !capped);
  g.rotateZ(Math.PI / 2);
  return std(g);
};
export const cylY = (r0, r1, len, segs = 14, capped = true) => std(new THREE.CylinderGeometry(r1, r0, len, segs, 1, !capped));
export const cylZ = (r0, r1, len, segs = 14, capped = true) => {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !capped);
  g.rotateX(Math.PI / 2);
  return std(g);
};

/** Extruded 2D outline (in the XY plane, thickness along Z), centred on z = 0. */
export function extrudeShape(points, depth, bevel = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return std(g);
}

export function tubePath(points, radius, segs = 24, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (Array.isArray(p) ? V(...p) : p)));
  return std(new THREE.TubeGeometry(curve, segs, radius, radial, false));
}

export const vec = V;
