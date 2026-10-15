import * as THREE from 'three';
import { forEachHedgePoint, fieldAt, CROP, rnd2 as hash2 } from './fields.js';
import { getNoiseTexture } from './noiseTexture.js';
import { applyAtmosphere } from '../scene/atmosphere.js';
import { Terrain } from './terrainTiles.js';
import { treeModel } from './treeModels.js';

// Instanced trees per terrain tile. Woodland placement comes from the same forest mask the terrain
// shader paints, hedgerows and orchards from the same field lattice, so what you see from afar is
// where the trees appear up close. Every species has two levels of detail sharing one instance
// buffer; the scenery switches them by distance.

let treeMat = null;
export function treeMaterial() {
  if (treeMat) return treeMat;
  const noise = getNoiseTexture();
  treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const uniforms = { uNoise: { value: noise }, uSnowT: { value: 0 } };
  treeMat.userData.uniforms = uniforms;
  treeMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWP;\nuniform sampler2D uNoise; uniform float uSnowT;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 lp = vTWP.xz * 0.9 + vTWP.y * vec2(0.7, 1.3);
          float lf = texture2D(uNoise, fract(lp / 6.5)).g;
          float lf2 = texture2D(uNoise, fract(lp / 1.7 + 0.37)).r;
          float pixT = max(fwidth(vTWP.x), fwidth(vTWP.z)) + fwidth(vTWP.y);
          float fade = 1.0 - smoothstep(0.4, 2.5, pixT);
          diffuseColor.rgb *= 1.0 + fade * ((lf - 0.5) * 0.9 + (lf2 - 0.5) * 0.6);
        }`);
    applyAtmosphere(shader);
  };
  return treeMat;
}

const SPECIES = ['oak', 'poplar', 'spruce', 'pine', 'birch', 'palm', 'acacia', 'shrub'];

/** Collects tree instances from several sources, then builds the meshes for one tile. */
export class TreeBatch {
  constructor(tile, cap = 1800) {
    this.tile = tile;
    this.cap = cap;
    this.lists = {};
    this.count = 0;
    this.seed = tile.ix * 7349 + tile.iz * 1931 + tile.level;
  }

  add(kind, x, z, s = 1, rot = 0, tint = 1, y = null) {
    if (this.count >= this.cap) return false;
    const t = this.tile;
    if (x < t.x0 - 1 || x >= t.x0 + t.size + 1 || z < t.z0 - 1 || z >= t.z0 + t.size + 1) return false;
    (this.lists[kind] ??= []).push({ x, z, s, rot, tint, y });
    this.count++;
    return true;
  }

  /** Build the meshes. `nearModel` selects which LOD is created first; both share instance data. */
  finish() {
    const tile = this.tile;
    const g = new THREE.Group();
    g.userData.kind = 'trees';
    g.userData.sets = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const kind of SPECIES) {
      const list = this.lists[kind];
      if (!list?.length) continue;
      // Shuffle (deterministic) so that drawing only the first N spreads thinning evenly.
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(hash2(i, this.seed, 41) * (i + 1));
        const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      }
      const model = treeModel(kind);
      const near = new THREE.InstancedMesh(model.near, treeMaterial(), list.length);
      near.userData.ownGeometry = false;
      list.forEach((it, k) => {
        const y = it.y ?? Terrain.heightIn(tile, it.x, it.z);
        q.setFromAxisAngle(up, it.rot);
        pos.set(it.x, y - 0.25, it.z);
        scl.set(it.s * (0.9 + 0.2 * ((it.tint * 7.3) % 1)), it.s, it.s * (0.9 + 0.2 * ((it.tint * 3.1) % 1)));
        m.compose(pos, q, scl);
        near.setMatrixAt(k, m);
        col.setRGB(0.82 + 0.38 * it.tint, 0.85 + 0.3 * ((it.tint * 5.7) % 1), 0.8 + 0.25 * ((it.tint * 2.3) % 1));
        near.setColorAt(k, col);
      });
      near.instanceMatrix.needsUpdate = true;
      near.instanceColor.needsUpdate = true;
      near.computeBoundingSphere();
      const mid = new THREE.InstancedMesh(model.mid, treeMaterial(), list.length);
      mid.userData.ownGeometry = false;
      mid.instanceMatrix = near.instanceMatrix;
      mid.instanceColor = near.instanceColor;
      mid.boundingSphere = near.boundingSphere;
      near.castShadow = mid.castShadow = true;
      near.receiveShadow = mid.receiveShadow = true;
      near.userData.shadowSet = mid.userData.shadowSet = true;
      near.visible = false;
      g.add(near, mid);
      g.userData.sets.push({ near, mid, n: list.length });
    }
    return g.userData.sets.length ? g : null;
  }
}

const hashNoise = (x, z, cell, seed) => {
  // Smooth-ish 2D value noise from hashes (0..1), used for clumping in woodland.
  const gx = x / cell; const gz = z / cell;
  const ix = Math.floor(gx); const iz = Math.floor(gz);
  const fx = gx - ix; const fz = gz - iz;
  const a = hash2(ix, iz, seed); const b = hash2(ix + 1, iz, seed); const c = hash2(ix, iz + 1, seed); const d = hash2(ix + 1, iz + 1, seed);
  const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
};

const mask = {};

/**
 * Add the woodland, scrub, hedgerow and orchard trees of a tile to `batch`.
 * `density` (0..1) scales how many trees are made (graphics quality).
 */
export function addVegetation(batch, tile, map, zones, clear, density = 1) {
  const biome = map.cfg.biome;
  const seed = map.cfg.seed;
  const lvl0 = tile.level === 0;
  const spacing = lvl0 ? 22 : 44;
  const grow = lvl0 ? 1 : 1.7;
  const n = Math.floor(tile.size / spacing);
  const gstep = 6;
  const gn = Math.ceil(n / gstep) + 1;
  const gridF = new Float32Array(gn * gn);
  const gridS = new Float32Array(gn * gn); // scrub (desert) / secondary mask
  const gridA = new Float32Array(gn * gn); // wadi
  let any = false;
  for (let gj = 0; gj < gn; gj++) {
    for (let gi = 0; gi < gn; gi++) {
      const x = tile.x0 + gi * gstep * spacing;
      const z = tile.z0 + gj * gstep * spacing;
      const h = Terrain.heightIn(tile, x, z);
      const e = 20;
      const slope = Math.hypot(Terrain.heightIn(tile, x + e, z) - Terrain.heightIn(tile, x - e, z), Terrain.heightIn(tile, x, z + e) - Terrain.heightIn(tile, x, z - e)) / (2 * e);
      zones.sample(x, z, h, slope, mask);
      gridF[gj * gn + gi] = mask.forest;
      gridS[gj * gn + gi] = biome === 'desert' ? mask.a3 : biome === 'snow' ? mask.urban : mask.farm;
      gridA[gj * gn + gi] = mask.a1;
      if (mask.forest > 0.02 || (biome === 'desert' && mask.a3 > 0.08) || (biome === 'grass' && mask.farm > 0.3)) any = true;
    }
  }
  if (!any) return;
  const bil = (grid, i, j) => {
    const gx = i / gstep; const gz = j / gstep;
    const gi = Math.min(gn - 2, Math.floor(gx)); const gj = Math.min(gn - 2, Math.floor(gz));
    const fx = gx - gi; const fz = gz - gj;
    return grid[gj * gn + gi] * (1 - fx) * (1 - fz) + grid[gj * gn + gi + 1] * fx * (1 - fz) + grid[(gj + 1) * gn + gi] * (1 - fx) * fz + grid[(gj + 1) * gn + gi + 1] * fx * fz;
  };
  const pickWood = (x, z, h, r, f) => {
    if (biome === 'snow') return h > 1250 ? (r < 0.55 ? 'spruce' : 'pine') : h < 1000 && r > 0.7 ? 'birch' : r < 0.7 ? 'spruce' : 'pine';
    if (biome === 'desert') return r < 0.8 ? 'palm' : 'acacia';
    const hill = h > 380 ? 0.6 : 0.12;
    return r < hill ? 'spruce' : r < hill + 0.04 ? 'poplar' : 'oak';
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const wi = Math.floor(tile.x0 / spacing) + i;
      const wj = Math.floor(tile.z0 / spacing) + j;
      const x = (wi + hash2(wi, wj, seed + 1)) * spacing;
      const z = (wj + hash2(wi, wj, seed + 2)) * spacing;
      const f = bil(gridF, i, j);
      if (f > 0.12) {
        const clump = hashNoise(x, z, 46, seed + 9);
        const fs = Math.min(1, Math.max(0, (f - 0.12) / 0.5));
        const p = (fs * fs * (3 - 2 * fs)) * (0.45 + 0.9 * clump) * density;
        if (hash2(wi, wj, seed) < p * (lvl0 ? 0.95 : 0.8) && clear.free(x, z, 6)) {
          const h = Terrain.heightIn(tile, x, z);
          const kind = pickWood(x, z, h, hash2(wi, wj, seed + 6), f);
          batch.add(kind, x, z, (0.7 + hash2(wi, wj, seed + 3) * 0.75) * grow * (kind === 'palm' ? 0.9 : 1), hash2(wi, wj, seed + 4) * 6.28, hash2(wi, wj, seed + 5));
        }
      }
      if (biome === 'desert') {
        const sc = bil(gridS, i, j);
        if (sc > 0.08 && hash2(wi, wj, seed + 21) < sc * 0.85 * density * (lvl0 ? 1 : 0.6) && clear.free(x, z, 5)) {
          const wad = bil(gridA, i, j);
          const kind = wad > 0.2 && hash2(wi, wj, seed + 22) < 0.12 ? 'acacia' : 'shrub';
          batch.add(kind, x, z, (kind === 'shrub' ? 0.6 + hash2(wi, wj, seed + 23) * 0.9 : 0.8 + hash2(wi, wj, seed + 23) * 0.5) * grow, hash2(wi, wj, seed + 24) * 6.28, hash2(wi, wj, seed + 25));
        }
      }
    }
  }
  if (biome === 'grass' && lvl0) addFarmTrees(batch, tile, map, zones, clear, density);
}

function addFarmTrees(batch, tile, map, zones, clear, density) {
  const seed = map.cfg.seed;
  const out = {};
  const x0 = tile.x0; const z0 = tile.z0; const x1 = x0 + tile.size; const z1 = z0 + tile.size;
  // Hedgerow trees along field boundaries.
  forEachHedgePoint(x0, z0, x1, z1, 11, (x, z, kind, k) => {
    if (kind !== 0) return;
    const r = hash2(Math.round(x), Math.round(z), seed + 31);
    if (r > 0.5 * density) return;
    const h = Terrain.heightIn(tile, x, z);
    zones.sample(x, z, h, 0.03, out);
    if (out.farm < 0.45 || !clear.free(x + 0.001, z, 4)) return;
    const pick = hash2(k, Math.round(x * 3), seed + 32);
    const jx = x + (hash2(k, 1, seed + 33) - 0.5) * 2.4;
    const jz = z + (hash2(k, 2, seed + 33) - 0.5) * 2.4;
    batch.add(pick < 0.6 ? 'oak' : pick < 0.8 ? 'poplar' : 'shrub', jx, jz, pick < 0.8 ? 0.65 + hash2(k, 3, seed + 34) * 0.8 : 0.9 + hash2(k, 3, seed + 34) * 0.6, hash2(k, 4, seed + 35) * 6.28, hash2(k, 5, seed + 36));
  });
  // Orchards: the grid the shader paints as dots.
  const seen = new Set();
  for (let z = z0; z < z1; z += 36) {
    for (let x = x0; x < x1; x += 36) {
      const f = fieldAt(x, z, {});
      if (f.crop !== CROP.ORCHARD) continue;
      const key = `${f.region.mx},${f.region.mz},${f.ci},${f.cj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = f.region;
      const ql = f.ci * r.sx; const qb = f.cj * r.sy;
      for (let qy = Math.ceil((qb + 3) / 5.0) * 5.0 - 2.5; qy < qb + r.sy - 3; qy += 5.0) {
        for (let qx = Math.ceil((ql + 3) / 6.5) * 6.5 - 3.25; qx < ql + r.sx - 3; qx += 6.5) {
          const wx = r.cos * qx - r.sin * qy;
          const wz = r.sin * qx + r.cos * qy;
          if (wx < x0 || wx >= x1 || wz < z0 || wz >= z1) continue;
          if (fieldAt(wx, wz, {}).crop !== CROP.ORCHARD) continue;
          const hh = Terrain.heightIn(tile, wx, wz);
          zones.sample(wx, wz, hh, 0.03, out);
          if (out.farm < 0.4 || !clear.free(wx, wz, 3)) continue;
          if (hash2(Math.round(wx * 2), Math.round(wz * 2), seed + 41) > density) continue;
          batch.add('oak', wx, wz, 0.42 + hash2(Math.round(qx), Math.round(qy), seed + 42) * 0.12, hash2(Math.round(qx), 7, seed + 43) * 6.28, hash2(Math.round(qy), 9, seed + 44));
        }
      }
    }
  }
}

