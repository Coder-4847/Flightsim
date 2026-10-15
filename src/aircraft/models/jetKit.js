import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry kit shared by the jet / airliner models (jet*.js). Everything is in the aircraft body frame:
// +X nose, +Y up, +Z right wing, metres. Every geometry that leaves this module is non-indexed and has exactly
// position / normal / uv, so any two can be merged and the traffic baker can bake them.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export const sgnPow = (x, p) => Math.sign(x) * Math.abs(x) ** p;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Piecewise linear lookup in a table of objects sorted by `key`: value of `field` at `x`. */
export function tab(table, x, field, key = 'x') {
  const n = table.length;
  if (x <= table[0][key]) return table[0][field];
  if (x >= table[n - 1][key]) return table[n - 1][field];
  for (let i = 0; i < n - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (x <= b[key]) {
      const t = (x - a[key]) / (b[key] - a[key] || 1);
      return a[field] + (b[field] - a[field]) * t;
    }
  }
  return table[n - 1][field];
}

// ---- geometry normalisation ---------------------------------------------------------------------
/** Reduce to position/normal/uv, non-indexed. Computes flat-ish normals if missing. */
export function std(geo, crease = 0) {
  let g = geo;
  if (g.index) g = g.toNonIndexed();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (crease > 0) g = toCreasedNormals(g, crease);
  else if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function xform(geo, matrix) {
  geo.applyMatrix4(matrix);
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export function placeMatrix(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.clone(), new THREE.Vector3(sx, sy, sz));
}

/** Copy `geo` through a matrix. */
export function placed(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const g = geo.clone();
  g.applyMatrix4(placeMatrix(x, y, z, rx, ry, rz, sx, sy, sz));
  return g;
}

/** Mirror a geometry across the XY plane (z -> -z) and repair the winding. */
export function mirrorZ(geo) {
  const g = geo.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setZ(i, -p.getZ(i)); if (n) n.setZ(i, -n.getZ(i)); }
  const a = p.array;
  const nn = n?.array;
  const uv = g.attributes.uv?.array;
  for (let i = 0; i < p.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const t = a[(i + 1) * 3 + k]; a[(i + 1) * 3 + k] = a[(i + 2) * 3 + k]; a[(i + 2) * 3 + k] = t;
      if (nn) { const u = nn[(i + 1) * 3 + k]; nn[(i + 1) * 3 + k] = nn[(i + 2) * 3 + k]; nn[(i + 2) * 3 + k] = u; }
    }
    if (uv) for (let k = 0; k < 2; k++) { const t = uv[(i + 1) * 2 + k]; uv[(i + 1) * 2 + k] = uv[(i + 2) * 2 + k]; uv[(i + 2) * 2 + k] = t; }
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  return g;
}

export function merge(list) {
  const geos = list.filter(Boolean);
  if (!geos.length) return null;
  const out = mergeGeometries(geos.length === 1 ? [geos[0]] : geos);
  out?.computeBoundingSphere();
  return out;
}

/** Collects geometries per material and emits one merged mesh per material. */
export class PartSet {
  constructor() { this.map = new Map(); }

  add(material, geo, matrix) {
    if (!geo) return this;
    let g = geo;
    if (matrix) { g = geo.clone(); g.applyMatrix4(matrix); }
    if (!this.map.has(material)) this.map.set(material, []);
    this.map.get(material).push(g);
    return this;
  }

  addTo(group, name = '') {
    for (const [material, list] of this.map) {
      const g = merge(list);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, material);
      mesh.name = name || material.name || '';
      group.add(mesh);
    }
    return group;
  }

  triangles() {
    let t = 0;
    for (const list of this.map.values()) for (const g of list) t += g.attributes.position.count / 3;
    return t;
  }
}

// ---- grids / rings ---------------------------------------------------------------------------------
/**
 * Build a strip surface from `rings` (arrays of [x,y,z,u,v] points, all the same length). Rings are opened (the caller
 * repeats the first point at the end when the ring is closed). `flipTest(point)` gives an outward direction used to
 * orient the winding. Returns non-indexed geometry with crease-aware normals.
 */
export function ringsGeometry(rings, { crease = 40, outward = null } = {}) {
  const m = rings[0].length;
  const pos = [];
  const uv = [];
  const idx = [];
  for (const ring of rings) {
    for (const p of ring) { pos.push(p[0], p[1], p[2]); uv.push(p[3], p[4]); }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < m - 1; i++) {
      const a = r * m + i;
      const b = a + m;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if (outward) {
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const v = new THREE.Vector3();
    const nn = new THREE.Vector3();
    let score = 0;
    for (let i = 0; i < p.count; i += 5) {
      v.fromBufferAttribute(p, i);
      nn.fromBufferAttribute(n, i);
      score += nn.dot(outward(v));
    }
    if (score < 0) {
      const ia = geo.index.array;
      for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; }
      geo.computeVertexNormals();
    }
  }
  geo = geo.toNonIndexed();
  geo.deleteAttribute('normal');
  geo = toCreasedNormals(geo, crease * DEG);
  geo.computeBoundingSphere();
  return geo;
}

// ---- surfaces of revolution ----------------------------------------------------------------------------
/**
 * Revolve a profile [[x, r], ...] about the X axis. `segs` radial steps. u follows the profile arc length (0..1),
 * v goes around. The crease angle controls hard edges at the profile corners.
 */
export function revolve(profile, segs = 24, { crease = 45, closed = true, uvScale = 1 } = {}) {
  const rings = [];
  let total = 0;
  const arc = [0];
  for (let i = 1; i < profile.length; i++) {
    total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    arc.push(total);
  }
  for (let i = 0; i < profile.length; i++) {
    const [x, r] = profile[i];
    const ring = [];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU;
      ring.push([x, Math.sin(a) * r, Math.cos(a) * r, (arc[i] / (total || 1)) * uvScale, s / segs]);
    }
    rings.push(ring);
  }
  void closed;
  return ringsGeometry(rings, { crease, outward: (v) => new THREE.Vector3(0, v.y, v.z) });
}

/** Revolve with the profile given as [[x, r], ...] but with orientation forced so the surface faces away from the axis. */
export function disc(x, r0, r1, segs = 24, facing = 1) {
  // Flat annulus in the plane x = const. facing +1 -> normal +X.
  const rings = [];
  for (const r of [r0, r1]) {
    const ring = [];
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * TAU;
      ring.push([x, Math.sin(a) * r, Math.cos(a) * r, 0.5 + 0.5 * (r / (r1 || 1)) * Math.cos(a), 0.5 + 0.5 * (r / (r1 || 1)) * Math.sin(a)]);
    }
    rings.push(ring);
  }
  return ringsGeometry(rings, { crease: 80, outward: () => new THREE.Vector3(facing, 0, 0) });
}

export function cylinderGeo(r0, r1, len, segs = 12, { axis = 'y', cap = true } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1, !cap);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return std(g);
}

export function boxGeo(w, h, d) { return std(new THREE.BoxGeometry(w, h, d)); }

/** A rounded-rectangle outline as [x, y] points, counter-clockwise. */
export function roundedRect(w, h, r, steps = 4) {
  const pts = [];
  const rr = Math.min(r, w / 2, h / 2);
  const corners = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 90], [-w / 2 + rr, -h / 2 + rr, 180], [w / 2 - rr, -h / 2 + rr, 270]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + (90 * i) / steps) * DEG;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return pts;
}

// ---- airfoils ---------------------------------------------------------------------------------------------
/** Thickness distribution (half) for a unit chord at x in 0..1: NACA-00xx like, scaled to thickness ratio t. */
export function halfThickness(x, t) {
  const sx = Math.sqrt(Math.max(0, x));
  return 5 * t * (0.2969 * sx - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) + 0.0007 * x;
}

/** Mean camber line (NACA 4-digit style): maximum camber m at position p. */
export function camberLine(x, m, p = 0.55) {
  if (!m) return 0;
  return x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
}

/** Upper and lower surface heights (y/c) at chord fraction x. Supercritical-ish: flatter top, aft cusp underneath. */
export function airfoilYs(x, t, m = 0.012, p = 0.6) {
  const yt = halfThickness(x, t);
  const cam = camberLine(x, m, p);
  const cusp = 0.9 * t * smooth((x - 0.72) / 0.28) * 0.35;
  return { up: cam + yt * (0.96 - 0.04 * smooth((x - 0.1) / 0.5)), lo: cam - yt * 1.04 + cusp };
}

function chordSamples(cf0, cf1, n) {
  const xs = [];
  for (let i = 0; i <= n; i++) {
    const beta = (1 - Math.cos(Math.PI * (i / n))) / 2;
    xs.push(cf0 + (cf1 - cf0) * beta);
  }
  return xs;
}

/**
 * Loft airfoil sections along a path of frames.
 * frame: { p: Vector3 leading-edge point, c: Vector3 chord vector (LE -> TE, length = chord), u: Vector3 unit "up"
 *          (surface normal of the upper side), t: thickness ratio, m: camber (0 = none), pc: camber position, v: texture v }
 * Surfaces between chord fractions cf0 and cf1. uv: u = 0..0.5 lower side (LE -> TE) and 0.5..1 upper side (TE -> LE) in chord
 * fraction, so panel textures can be drawn in chord coordinates; v comes from the frame.
 */
export function loftFrames(frames, {
  cf0 = 0, cf1 = 1, nChord = 20, capStart = true, capEnd = true, crease = 32, teBlunt = 0,
} = {}) {
  const xs = chordSamples(cf0, cf1, nChord);
  let rings = [];
  const pt = new THREE.Vector3();
  for (const f of frames) {
    const chord = f.c.length();
    const ring = [];
    const at = (x, y) => pt.copy(f.p).addScaledVector(f.c, x).addScaledVector(f.u, y * chord);
    for (let i = 0; i <= nChord; i++) {
      const { lo } = airfoilYs(xs[i], f.t, f.m ?? 0.012, f.pc ?? 0.6);
      at(xs[i], lo);
      ring.push([pt.x, pt.y, pt.z, 0.5 * xs[i], f.v]);
    }
    for (let i = nChord; i >= 0; i--) {
      const { up } = airfoilYs(xs[i], f.t, f.m ?? 0.012, f.pc ?? 0.6);
      at(xs[i], up + (i === nChord ? teBlunt : 0));
      ring.push([pt.x, pt.y, pt.z, 1 - 0.5 * xs[i], f.v]);
    }
    const first = ring[0].slice();
    first[3] = 0.5 * xs[0];
    ring.push(first);
    rings.push(ring);
  }
  // Orientation: the quad on the upper surface (middle of the ring) must face the frame's up vector.
  const m = rings[0].length;
  const j = Math.floor(m * 0.75);
  const A = new THREE.Vector3(...rings[0][j].slice(0, 3));
  const A1 = new THREE.Vector3(...rings[0][j + 1].slice(0, 3));
  const B = new THREE.Vector3(...rings[1][j].slice(0, 3));
  const faceN = B.sub(A).cross(A1.sub(A));
  if (faceN.dot(frames[0].u) < 0) rings = rings.reverse();
  const travel = new THREE.Vector3().copy(frames[frames.length - 1].p).sub(frames[0].p);
  if (travel.lengthSq() < 1e-9) travel.copy(frames[0].c).cross(frames[0].u);
  travel.normalize();
  const first = rings[0];
  const last = rings[rings.length - 1];
  const geo = ringsGeometry(rings, { crease });
  const parts = [geo];
  const cap = (ring, normalDir, v) => {
    const c = new THREE.Vector3();
    for (const p of ring) c.add(new THREE.Vector3(p[0], p[1], p[2]));
    c.divideScalar(ring.length);
    const pos = [];
    const uv = [];
    const t0 = new THREE.Vector3();
    const t1 = new THREE.Vector3();
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      t0.set(a[0] - c.x, a[1] - c.y, a[2] - c.z);
      t1.set(b[0] - c.x, b[1] - c.y, b[2] - c.z);
      const flip = t0.clone().cross(t1).dot(normalDir) < 0;
      if (flip) pos.push(c.x, c.y, c.z, b[0], b[1], b[2], a[0], a[1], a[2]);
      else pos.push(c.x, c.y, c.z, a[0], a[1], a[2], b[0], b[1], b[2]);
      uv.push(0.5, v, a[3], v, b[3], v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  const dirA = travel.clone().negate();
  if (capStart) parts.push(cap(first, dirA, first[0][4]));
  if (capEnd) parts.push(cap(last, travel, last[0][4]));
  return merge(parts);
}

// ---- wing planform record --------------------------------------------------------------------------------
/**
 * Piecewise linear wing description: stations {z, x (leading edge), y (leading edge), c (chord), t (thickness ratio),
 * tw (twist deg, nose up positive about quarter chord), m (camber)}. `at(z)` interpolates every field.
 */
export class Planform {
  constructor(stations, vs = 1) { this.s = stations; this.vs = vs; }

  at(z) {
    const s = this.s;
    const out = { z };
    let a = s[0];
    let b = s[s.length - 1];
    if (z <= s[0].z) { b = a; } else if (z >= s[s.length - 1].z) { a = b; } else {
      for (let i = 0; i < s.length - 1; i++) { if (z <= s[i + 1].z) { a = s[i]; b = s[i + 1]; break; } }
    }
    const t = a === b ? 0 : (z - a.z) / (b.z - a.z);
    for (const k of ['x', 'y', 'c', 't', 'tw', 'm']) out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
    return out;
  }

  get tipZ() { return this.s[this.s.length - 1].z; }

  /** Frame of the section at span `z` for the right wing (+Z outboard). */
  frame(z, vScale = this.vs) {
    const r = this.at(z);
    const tw = (r.tw ?? 0) * DEG;
    const c0 = r.c;
    // Twist about the quarter chord.
    const cv = new THREE.Vector3(-Math.cos(tw), -Math.sin(tw), 0).multiplyScalar(c0);
    const uv = new THREE.Vector3(-Math.sin(tw), Math.cos(tw), 0);
    const p = new THREE.Vector3(r.x, r.y, z);
    p.x += 0.25 * c0 - 0.25 * c0 * Math.cos(tw);
    p.y += 0.25 * c0 * Math.sin(tw);
    return { p, c: cv, u: uv, t: r.t, m: r.m, v: z * vScale, rec: r };
  }

  /** Point on the surface at span z, chord fraction x and side ('up'|'lo'). */
  point(z, x, side = 'up', lift = 0) {
    const f = this.frame(z);
    const { up, lo } = airfoilYs(x, f.t, f.m || 0.012);
    const y = (side === 'up' ? up : lo) * f.c.length() + (side === 'up' ? lift : -lift);
    return f.p.clone().addScaledVector(f.c, x).addScaledVector(f.u, y);
  }

  /** Frames for the span interval [z0, z1] including the stations in between and `extra` evenly spaced subdivisions. */
  frames(z0, z1, { vScale = this.vs, step = 0 } = {}) {
    const zs = [z0];
    for (const st of this.s) if (st.z > z0 + 1e-4 && st.z < z1 - 1e-4) zs.push(st.z);
    zs.push(z1);
    const all = [];
    for (let i = 0; i < zs.length - 1; i++) {
      const n = step > 0 ? Math.max(1, Math.round((zs[i + 1] - zs[i]) / step)) : 1;
      for (let k = 0; k < n; k++) all.push(zs[i] + ((zs[i + 1] - zs[i]) * k) / n);
    }
    all.push(z1);
    return all.map((z) => this.frame(z, vScale));
  }
}
