import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rnd2 as hash2 } from './fields.js';

// Low-poly tree models with vertex colours (darker towards the trunk and the underside), each in
// two levels of detail: `near` for tiles close to the camera, `mid` for everything else. All
// geometries are built once and shared by every tile.

const rgb = (hex) => new THREE.Color(hex);

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function strip(geo) {
  // Keep position, normal, color only (needed for merging), as indexed geometry.
  const g = geo.index ? geo : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** A lumpy sphere: displaced icosphere with smooth normals and a vertical colour gradient. */
function lump(radius, detail, center, squash, seed, lo, hi, lumpiness = 0.2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g = g.index ? g : mergeVertices(g);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const n = hash2(Math.round(x * 50) + seed, Math.round(y * 50) + Math.round(z * 31), seed) - 0.5;
    const k = 1 + lumpiness * n * 1.6;
    pos.setXYZ(i, x * k * radius * squash[0] + center[0], y * k * radius * squash[1] + center[1], z * k * radius * squash[2] + center[2]);
  }
  g.computeVertexNormals();
  const y0 = center[1] - radius * squash[1];
  const span = 2 * radius * squash[1];
  paint(g, (x, y, z, c) => {
    const t = Math.min(1, Math.max(0, (y - y0) / span));
    c.copy(lo).lerp(hi, 0.15 + 0.85 * t * t);
  });
  return strip(g);
}

function mergeVertices(g) {
  // IcosahedronGeometry is non-indexed; weld by position so the normals come out smooth.
  const pos = g.attributes.position;
  const map = new Map();
  const idx = [];
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
    idx.push(j);
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  ng.setIndex(idx);
  return ng;
}

function trunk(h, r0, r1, sides, color, tilt = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, 1, true).translate(0, h / 2, 0);
  if (tilt) g.rotateZ(tilt);
  const c0 = rgb(color).multiplyScalar(0.7);
  const c1 = rgb(color);
  paint(g, (x, y, z, c) => c.copy(c0).lerp(c1, Math.min(1, y / h)));
  return strip(g);
}

function cone(r, h, sides, y, lo, hi) {
  const g = new THREE.ConeGeometry(r, h, sides, 1, true).translate(0, y + h / 2, 0);
  paint(g, (x, yy, z, c) => c.copy(lo).lerp(hi, Math.min(1, Math.max(0, (yy - y) / h))));
  return strip(g);
}

function fixed(g) {
  // Merge helper requires matching attribute sets and indexing.
  return g.index ? g : g;
}

function merge(list) {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(flat);
  m.computeBoundingSphere();
  return m;
}

function frond(len, width, droop, rotY, y, lo, hi) {
  // A bent strip: three quads that curve downwards.
  const pos = [];
  const idx = [];
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * len;
    const yy = y + Math.sin(t * Math.PI * 0.5) * len * 0.35 - droop * t * t * len;
    const w = width * (1 - t * 0.85) * (t < 0.12 ? 0.5 : 1);
    pos.push(x, yy, -w / 2, x, yy, w / 2);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.rotateY(rotY);
  g.computeVertexNormals();
  paint(g, (x, yy, z, c) => c.copy(lo).lerp(hi, Math.min(1, Math.max(0, (yy - y + 3) / 7))));
  return strip(g);
}

const cache = {};

const BUILDERS = {
  oak() {
    const lo = rgb('#2b4a1c'); const hi = rgb('#6c9a3c');
    const near = merge([
      trunk(5.2, 0.5, 0.28, 5, '#5a4630'),
      lump(3.6, 1, [0, 7.4, 0], [1, 0.9, 1], 3, lo, hi, 0.26),
      lump(2.5, 1, [2.2, 6.2, 0.6], [1, 0.85, 1], 11, lo, hi, 0.26),
      lump(2.3, 1, [-1.7, 6.6, -1.2], [1, 0.85, 1], 17, lo, hi, 0.26),
    ]);
    const mid = merge([trunk(5, 0.45, 0.3, 4, '#5a4630'), lump(4.2, 0, [0, 7.2, 0], [1.05, 0.9, 1.05], 3, lo, hi, 0.2)]);
    return { near, mid, height: 11 };
  },
  poplar() {
    const lo = rgb('#2f5522'); const hi = rgb('#78a23f');
    const near = merge([trunk(4, 0.35, 0.22, 4, '#6a5a44'), lump(2.2, 1, [0, 11, 0], [1, 3.4, 1], 5, lo, hi, 0.18)]);
    const mid = merge([trunk(3.5, 0.3, 0.2, 4, '#6a5a44'), lump(2.2, 0, [0, 10.6, 0], [1, 3.4, 1], 5, lo, hi, 0.14)]);
    return { near, mid, height: 17 };
  },
  spruce() {
    const lo = rgb('#0f2d1a'); const hi = rgb('#2c6a3c');
    const tiers = [];
    for (let i = 0; i < 6; i++) tiers.push(cone(3.5 - i * 0.5, 4.6 - i * 0.2, 7, 2.2 + i * 2.1, lo, hi));
    tiers.push(cone(0.8, 2.6, 5, 14.6, lo, hi));
    const near = merge([trunk(3, 0.35, 0.25, 4, '#4a3a2a'), ...tiers]);
    const mid = merge([trunk(2.5, 0.3, 0.2, 4, '#4a3a2a'), cone(3.4, 8, 6, 2.2, lo, hi), cone(2.2, 7, 6, 7.5, lo, hi), cone(0.9, 4, 5, 12.5, lo, hi)]);
    return { near, mid, height: 17 };
  },
  pine() {
    const lo = rgb('#243f20'); const hi = rgb('#4a7a36');
    const near = merge([trunk(11, 0.5, 0.25, 5, '#6b4a30'), lump(3.2, 1, [0.4, 13, 0], [1.2, 0.5, 1.2], 7, lo, hi, 0.3), lump(2.0, 1, [-1.4, 11, 0.8], [1.1, 0.45, 1.1], 19, lo, hi, 0.3)]);
    const mid = merge([trunk(10, 0.45, 0.25, 4, '#6b4a30'), lump(3.4, 0, [0, 12.5, 0], [1.2, 0.5, 1.2], 7, lo, hi, 0.2)]);
    return { near, mid, height: 15 };
  },
  birch() {
    const lo = rgb('#5a7a2c'); const hi = rgb('#a3b84a');
    const near = merge([trunk(5.5, 0.28, 0.16, 5, '#d8d4c8'), lump(2.8, 1, [0, 7.4, 0], [1, 1.1, 1], 9, lo, hi, 0.3), lump(1.9, 1, [1.2, 6, 0.5], [1, 1, 1], 23, lo, hi, 0.3)]);
    const mid = merge([trunk(5, 0.25, 0.16, 4, '#d8d4c8'), lump(3, 0, [0, 7.2, 0], [1, 1.1, 1], 9, lo, hi, 0.2)]);
    return { near, mid, height: 10 };
  },
  palm() {
    const lo = rgb('#2f5a1e'); const hi = rgb('#78ab3a');
    const fr = [];
    for (let i = 0; i < 9; i++) fr.push(frond(5.2, 1.5, 0.55 + (i % 3) * 0.12, (i / 9) * Math.PI * 2, 10.6 + (i % 2) * 0.4, lo, hi));
    const tr = trunk(10.8, 0.45, 0.28, 6, '#8a6c48', 0.08);
    const near = merge([tr, ...fr]);
    const fm = [];
    for (let i = 0; i < 5; i++) fm.push(frond(5.0, 1.7, 0.6, (i / 5) * Math.PI * 2, 10.6, lo, hi));
    const mid = merge([trunk(10.8, 0.4, 0.28, 4, '#8a6c48'), ...fm]);
    return { near, mid, height: 13 };
  },
  acacia() {
    const lo = rgb('#4a5a22'); const hi = rgb('#8e9a3e');
    const near = merge([trunk(4.5, 0.4, 0.22, 5, '#5e4a38', 0.1), lump(3.6, 1, [0.3, 5.8, 0], [1.5, 0.38, 1.5], 13, lo, hi, 0.3)]);
    const mid = merge([trunk(4.5, 0.35, 0.22, 4, '#5e4a38'), lump(3.8, 0, [0.3, 5.8, 0], [1.5, 0.38, 1.5], 13, lo, hi, 0.2)]);
    return { near, mid, height: 7 };
  },
  shrub() {
    const lo = rgb('#3c4a22'); const hi = rgb('#7a8a3a');
    const near = merge([lump(1.4, 1, [0, 0.9, 0], [1.2, 0.8, 1.2], 31, lo, hi, 0.3)]);
    const mid = merge([lump(1.5, 0, [0, 0.9, 0], [1.2, 0.8, 1.2], 31, lo, hi, 0.2)]);
    return { near, mid, height: 2 };
  },
};

/** { near, mid, height } geometries for a species (built on first use). */
export function treeModel(kind) {
  if (!cache[kind]) cache[kind] = BUILDERS[kind]();
  return cache[kind];
}

export function disposeTreeModels() {
  for (const k of Object.keys(cache)) { cache[k].near.dispose(); cache[k].mid.dispose(); delete cache[k]; }
}
