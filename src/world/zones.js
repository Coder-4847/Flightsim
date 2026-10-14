import * as THREE from 'three';
import { createNoise, smoothstep } from '../util/noise.js';
import { MAP_HALF } from './maps.js';

// Land-use masks (0..1) for a map: farmland, forest, urban and a biome-specific "special" channel.
// The same function drives the terrain shader (through a low-resolution texture) and the placement
// of trees and buildings, so what you see from far away matches what spawns up close.

export const ZONE_TEXTURE_SIZE = 384;

/** Create the zone sampler for a map. Slope is |grad h| (rise over run). */
export function createZones(map) {
  const cfg = map.cfg;
  const nF = createNoise(cfg.seed + 11);
  const nR = createNoise(cfg.seed + 12);
  const nU = createNoise(cfg.seed + 13);
  const biome = cfg.biome;
  const cities = map.cities;
  const airports = map.airports;
  const oases = map.lakes.filter((l) => l.oasis);

  function airportClearance(x, z) {
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      const d = Math.hypot(x - a.x, z - a.z);
      if (d < a.flatRadius * 0.9) return 0;
      if (d < a.flatRadius * 1.6) return smoothstep(a.flatRadius * 0.9, a.flatRadius * 1.6, d);
    }
    return 1;
  }

  /** Writes {farm, forest, urban, special} into `out` and returns it. */
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

    let forest = 0;
    let farm = 0;
    let special = 0;
    if (biome === 'grass') {
      const f = nF.fbm(x / 2600 + 9, z / 2600, 3);
      forest = smoothstep(0.54, 0.62, f) * smoothstep(0.4, 0.2, slope) * smoothstep(1100, 700, h);
      const farmNoise = nR.fbm(x / 9500 + 30, z / 9500, 3);
      farm = smoothstep(0.44, 0.52, farmNoise) * smoothstep(0.16, 0.06, slope) * smoothstep(420, 300, h);
    } else if (biome === 'snow') {
      const f = nF.fbm(x / 2200 + 9, z / 2200, 3);
      forest = smoothstep(0.42, 0.55, f) * smoothstep(0.6, 0.3, slope) * smoothstep(1650, 1250, h);
    } else if (biome === 'desert') {
      for (let i = 0; i < oases.length; i++) {
        const o = oases[i];
        const d = Math.hypot(x - o.x, z - o.z);
        if (d > o.radius * 0.9 && d < o.radius * 2.6) forest = Math.max(forest, smoothstep(2.6, 1.4, d / o.radius) * (0.6 + 0.8 * nF.value(x / 160, z / 160)));
      }
      // Dry lakebeds: very flat ground at the basin floor.
      special = smoothstep(0.014, 0.004, slope) * smoothstep(12, 2, Math.abs(h - 575));
    }
    farm *= (1 - urban);
    forest = Math.min(1, forest) * (1 - urban) * clear * (1 - farm * 0.6);
    farm *= clear;
    out.farm = farm; out.forest = forest; out.urban = urban; out.special = special;
    return out;
  }
  return { sample };
}

/**
 * Rasterise the zones into an RGBA texture covering the whole map (R farm, G forest, B urban,
 * A special). Built in slices so the loading screen can keep updating.
 */
export async function buildZoneTexture(map, zones, onProgress = () => {}) {
  const N = ZONE_TEXTURE_SIZE;
  const cell = (MAP_HALF * 2) / N;
  // Height grid with a one-cell border so slopes can be taken by central differences.
  const G = N + 2;
  const heights = new Float32Array(G * G);
  const hf = map.hf;
  const rowsPerSlice = 24;
  for (let j = 0; j < G; j += rowsPerSlice) {
    for (let r = j; r < Math.min(G, j + rowsPerSlice); r++) {
      for (let i = 0; i < G; i++) heights[r * G + i] = hf.height(-MAP_HALF + (i - 0.5) * cell, -MAP_HALF + (r - 0.5) * cell);
    }
    onProgress(0.5 * Math.min(1, (j + rowsPerSlice) / G));
    await new Promise((res) => setTimeout(res, 0));
  }
  const data = new Uint8Array(N * N * 4);
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
        const k = (r * N + i) * 4;
        data[k] = out.farm * 255; data[k + 1] = out.forest * 255; data[k + 2] = out.urban * 255; data[k + 3] = out.special * 255;
      }
    }
    onProgress(0.5 + 0.5 * Math.min(1, (j + rowsPerSlice) / N));
    await new Promise((res) => setTimeout(res, 0));
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
