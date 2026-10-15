import * as THREE from 'three';
import { createNoise, smoothstep } from '../util/noise.js';
import { createLandforms } from './heightfield.js';
import { MAP_HALF } from './maps.js';
import { lakeD } from './lakeShape.js';
import { PolylineSet } from './polyline.js';

// Land-use masks (0..1) for a map. The same function drives the terrain shader (through two
// low-resolution textures) and the placement of trees, so what you see from far away matches what
// spawns up close.
//
// Texture 1: R farmland, G forest, B urban, A special (desert: dry lakebed).
// Texture 2: R, G, B biome specific (grass: hill outcrops, -, wet ground; desert: wadi, dunes, scrub;
//            snow: glacier, snowfield, avalanche scars), A convexity (concave hollows dark, ridges light).

export const ZONE_TEXTURE_SIZE = 512;

/** Create the zone sampler for a map. Slope is |grad h| (rise over run). */
export function createZones(map) {
  const cfg = map.cfg;
  const nF = createNoise(cfg.seed + 11);
  const nR = createNoise(cfg.seed + 12);
  const nU = createNoise(cfg.seed + 13);
  const nC = createNoise(cfg.seed + 14);
  const biome = cfg.biome;
  const cities = map.cities;
  const airports = map.airports;
  const lakes = map.lakes;
  const oases = lakes.filter((l) => l.oasis);
  const land = createLandforms(cfg);
  const lm = {};
  const infra = map.infra ?? {};
  const runs = infra.skiRuns?.length ? new PolylineSet(infra.skiRuns.map((r) => ({ points: r.points.map((p) => ({ x: p.x, z: p.z, w: r.width / 2 })) })), 600) : null;
  const quarries = infra.quarries ?? [];

  function airportClearance(x, z) {
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < a.flatRadius * 0.82) return 0;
      if (d < a.flatRadius * 1.2) return smoothstep(a.flatRadius * 0.82, a.flatRadius * 1.2, d);
    }
    return 1;
  }

  function airportMown(x, z) {
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < a.flatRadius * 1.1) return smoothstep(a.flatRadius * 0.7, a.flatRadius * 1.05, d);
    }
    return 1;
  }

  /** 0..1 closeness to open water (lake shores, river banks). */
  function wetness(x, z) {
    let w = 0;
    for (let i = 0; i < lakes.length; i++) {
      const l = lakes[i];
      const d = lakeD(l, x - l.x, z - l.z);
      if (d < 1.9) w = Math.max(w, smoothstep(1.9, 1.05, d));
    }
    if (map.rivers) {
      const r = map.rivers.nearest(x, z);
      if (r.dist < r.w * 6) w = Math.max(w, smoothstep(r.w * 6, r.w * 1.6, r.dist));
    }
    return w;
  }

  /**
   * Writes {farm, forest, urban, special, a1, a2, a3} into `out` and returns it.
   */
  function sample(x, z, h, slope, out = {}) {
    let urban = 0;
    for (let i = 0; i < cities.length; i++) {
      const c = cities[i];
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.radius * 1.15) {
        const edge = 1 - d / c.radius;
        const v = c.density * Math.max(0, edge) ** 0.7 * (0.75 + 0.5 * nU.value(x / 420, z / 420)) + (d < c.radius * 0.06 ? 0.5 : 0);
        if (v > urban) urban = v;
      }
    }
    urban = Math.min(1, urban * 1.6) * smoothstep(0.55, 0.2, slope);
    const clear = airportClearance(x, z);
    land.masks(x, z, lm);

    let forest = 0;
    let farm = 0;
    let special = 0;
    let a1 = 0;
    let a2 = 0;
    let a3 = 0;
    if (biome === 'grass') {
      const wood = smoothstep(0.52, 0.6, nF.fbm(x / 2200 + 9, z / 2200, 3)) * smoothstep(0.45, 0.25, slope) * smoothstep(1250, 900, h);
      const hillWood = smoothstep(0.07, 0.2, slope) * smoothstep(0.55, 0.32, slope) * smoothstep(1300, 800, h) * (0.55 + 0.45 * smoothstep(0.4, 0.55, nF.fbm(x / 1400 + 3, z / 1400, 3)));
      const farmNoise = nR.fbm(x / 7000 + 30, z / 7000, 3);
      farm = smoothstep(0.43, 0.5, farmNoise) * smoothstep(0.17, 0.07, slope) * smoothstep(560, 420, h);
      // Copses and shelter belts inside farmland, and small woods on gentle ground elsewhere.
      const copse = smoothstep(0.62, 0.68, nC.fbm(x / 330 + 50, z / 330, 2)) * (0.15 + 0.85 * smoothstep(0.1, 0.25, slope + 0.1 * farm)) * (farm > 0.3 ? 0.9 : 0.5) * smoothstep(0.3, 0.15, slope);
      forest = Math.max(wood, hillWood, copse);
      a1 = lm.relief;
      a2 = 1 - airportMown(x, z); // mown airfield grass
      a3 = wetness(x, z);
    } else if (biome === 'snow') {
      const f = nF.fbm(x / 1900 + 9, z / 1900, 3);
      // Conifers climb to the tree line (about 1,500 m, ragged) and thin out on steep ground.
      forest = smoothstep(0.4, 0.52, f) * smoothstep(0.62, 0.3, slope) * smoothstep(1650 + 90 * (nC.value(x / 700, z / 700) - 0.5), 1250, h);
      a1 = smoothstep(1500, 1850, h) * smoothstep(0.32, 0.1, slope) * smoothstep(0.45, 0.62, nF.fbm(x / 2600 + 70, z / 2600, 3));
      a2 = smoothstep(0.42, 0.6, nC.fbm(x / 900 + 11, z / 900, 3));
      a3 = smoothstep(0.34, 0.5, slope) * smoothstep(0.55, 0.7, nC.fbm(x / 160 + 5, z / 700, 3)) * smoothstep(1100, 1500, h);
    } else if (biome === 'desert') {
      for (let i = 0; i < oases.length; i++) {
        const o = oases[i];
        const d = Math.hypot(x - o.x, z - o.z);
        if (d > o.radius * 0.9 && d < o.radius * 2.8) forest = Math.max(forest, smoothstep(2.8, 1.4, d / o.radius) * (0.6 + 0.8 * nF.value(x / 160, z / 160)));
      }
      // Irrigated fields around oasis towns.
      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (c.kind === 'village') continue;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d > c.radius * 1.05 && d < c.radius * 2.4) farm = Math.max(farm, smoothstep(2.4, 1.3, d / c.radius) * smoothstep(0.1, 0.03, slope) * 0.85);
      }
      // Dry lakebeds: very flat ground at the basin floor.
      special = lm.bed * smoothstep(0.02, 0.006, slope);
      a1 = lm.wadi;
      a2 = lm.dune;
      a3 = smoothstep(0.5, 0.7, nF.fbm(x / 260 + 20, z / 260, 3)) * (1 - lm.dune * 0.8) * (1 - special) * smoothstep(0.35, 0.12, slope) * (0.25 + 0.75 * Math.max(lm.wadi * 1.6, smoothstep(0.45, 0.62, nR.fbm(x / 3000 + 5, z / 3000, 3))));
    }
    if (runs) {
      const r = runs.nearest(x, z);
      if (r.dist < r.w * 1.6) { const m = smoothstep(r.w * 1.5, r.w * 0.7, r.dist); forest *= 1 - m; a2 = Math.max(a2, m * 0.95); }
    }
    for (let i = 0; i < quarries.length; i++) {
      const q = quarries[i];
      const d = Math.hypot(x - q.x, z - q.z) / q.r;
      if (d < 1.15) { special = Math.max(special, smoothstep(1.15, 0.9, d)); forest *= 1 - smoothstep(1.2, 0.95, d); farm *= 1 - smoothstep(1.2, 0.95, d); }
    }
    farm *= (1 - urban);
    forest = Math.min(1, forest) * (1 - urban) * clear * (1 - farm * (biome === 'grass' ? 0.2 : 0.6));
    farm *= clear;
    out.farm = farm; out.forest = forest; out.urban = urban; out.special = special;
    out.a1 = a1; out.a2 = a2; out.a3 = a3 * clear;
    return out;
  }
  return { sample };
}

/**
 * Rasterise the zones into two RGBA textures covering the whole map. Built in slices so the
 * loading screen can keep updating. Returns {zone, zone2}.
 */
export async function buildZoneTexture(map, zones, onProgress = () => {}) {
  const N = ZONE_TEXTURE_SIZE;
  const cell = (MAP_HALF * 2) / N;
  // Height grid with a one-cell border so slopes can be taken by central differences.
  const G = N + 2;
  const heights = new Float32Array(G * G);
  const hf = map.hf;
  const rowsPerSlice = 32;
  for (let j = 0; j < G; j += rowsPerSlice) {
    for (let r = j; r < Math.min(G, j + rowsPerSlice); r++) {
      for (let i = 0; i < G; i++) heights[r * G + i] = hf.height(-MAP_HALF + (i - 0.5) * cell, -MAP_HALF + (r - 0.5) * cell);
    }
    onProgress(0.5 * Math.min(1, (j + rowsPerSlice) / G));
    await new Promise((res) => setTimeout(res, 0));
  }
  const data = new Uint8Array(N * N * 4);
  const data2 = new Uint8Array(N * N * 4);
  const out = {};
  for (let j = 0; j < N; j += rowsPerSlice) {
    for (let r = j; r < Math.min(N, j + rowsPerSlice); r++) {
      for (let i = 0; i < N; i++) {
        const gi = i + 1;
        const gj = r + 1;
        const hC = heights[gj * G + gi];
        const sx = (heights[gj * G + gi + 1] - heights[gj * G + gi - 1]) / (2 * cell);
        const sz = (heights[(gj + 1) * G + gi] - heights[(gj - 1) * G + gi]) / (2 * cell);
        zones.sample(-MAP_HALF + (i + 0.5) * cell, -MAP_HALF + (r + 0.5) * cell, hC, Math.hypot(sx, sz), out);
        // Convexity: height against the mean of the 5x5 neighbourhood two cells away.
        let sum = 0;
        let cnt = 0;
        for (let dj = -2; dj <= 2; dj += 2) for (let di = -2; di <= 2; di += 2) {
          if (!di && !dj) continue;
          const ni = Math.min(G - 1, Math.max(0, gi + di));
          const nj = Math.min(G - 1, Math.max(0, gj + dj));
          sum += heights[nj * G + ni]; cnt++;
        }
        const conv = Math.max(-1, Math.min(1, (hC - sum / cnt) / 28));
        const k = (r * N + i) * 4;
        data[k] = out.farm * 255; data[k + 1] = out.forest * 255; data[k + 2] = out.urban * 255; data[k + 3] = out.special * 255;
        data2[k] = out.a1 * 255; data2[k + 1] = out.a2 * 255; data2[k + 2] = out.a3 * 255; data2[k + 3] = 128 + conv * 127;
      }
    }
    onProgress(0.5 + 0.5 * Math.min(1, (j + rowsPerSlice) / N));
    await new Promise((res) => setTimeout(res, 0));
  }
  const mk = (d) => {
    const tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };
  return { zone: mk(data), zone2: mk(data2) };
}
