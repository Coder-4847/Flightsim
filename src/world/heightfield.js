import { createNoise, smoothstep } from '../util/noise.js';
import { MAP_HALF } from './maps.js';

// Terrain height for each biome plus the features carved into it (rivers, lakes) and the flat
// pads under airports. All functions are deterministic for a given map seed.

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

function ridged(n, x, z, octaves = 5) {
  let sum = 0; let amp = 0.5; let norm = 0; let f = 1;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(2 * n.value(x * f, z * f) - 1);
    sum += v * v * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Raw biome elevation (metres MSL), before rivers, lakes and airports. */
export function createBaseHeight(config) {
  const s = config.seed;
  const n1 = createNoise(s);
  const n2 = createNoise(s + 101);
  const n3 = createNoise(s + 202);
  const n4 = createNoise(s + 303);
  const nw = createNoise(s + 404);
  // Distance to the map edge as 0 (centre) .. 1 (edge): a rounded, noise-warped square so the
  // mountain rim is irregular rather than a perfect frame.
  const edge = (x, z) => {
    const wx = x + 9000 * (nw.value(x / 28000 + 1, z / 28000) - 0.5) * 2;
    const wz = z + 9000 * (nw.value(x / 28000, z / 28000 + 7) - 0.5) * 2;
    const ax = Math.abs(wx) / MAP_HALF;
    const az = Math.abs(wz) / MAP_HALF;
    return (ax ** 3.2 + az ** 3.2) ** (1 / 3.2);
  };

  if (config.biome === 'grass') {
    return (x, z) => {
      const rolling = (n1.fbm(x / 9000, z / 9000, 5) - 0.5) * 2 * 120 + (n2.fbm(x / 2100 + 11, z / 2100, 4) - 0.5) * 2 * 28
        + (n3.fbm(x / 480, z / 480, 3) - 0.5) * 2 * 4.5;
      const rim = smoothstep(0.66, 1.0, edge(x, z)) * (700 + 1200 * ridged(n4, x / 9000, z / 9000, 5));
      const hills = smoothstep(0.52, 0.72, n3.fbm(x / 26000 + 7, z / 26000, 3)) * 620 * ridged(n2, x / 6000 + 3, z / 6000, 5);
      return 170 + rolling + rim + hills;
    };
  }

  if (config.biome === 'desert') {
    const cosA = Math.cos(0.52);
    const sinA = Math.sin(0.52);
    return (x, z) => {
      const base = 620 + (n1.fbm(x / 12000, z / 12000, 4) - 0.5) * 2 * 90 + (n2.fbm(x / 2600, z / 2600, 4) - 0.5) * 2 * 18;
      // Dunes: elongated sinusoidal ridges inside dune-field regions.
      const dm = smoothstep(0.45, 0.6, n3.fbm(x / 9000 + 5, z / 9000, 3));
      const u = (x * cosA + z * sinA) / 230 + 2.4 * n4.fbm(x / 1100, z / 1100, 3);
      const crest = Math.abs(Math.sin(u * Math.PI));
      const dunes = dm * (crest ** 1.4) * 26 + dm * (n2.fbm(x / 140, z / 140, 2) - 0.5) * 3;
      // Mesas: flat-topped plateaus with steep cliffs.
      const p = n1.fbm(x / 5500 + 20, z / 5500, 4);
      const mesa = smoothstep(0.575, 0.6, p) * (170 + 55 * n3.fbm(x / 800, z / 800, 3)) * (1 - 0.5 * dm);
      // Canyons carved through everything, narrow with steep walls.
      const c = ridged(n4, x / 6500 + 40, z / 6500, 3);
      const canyon = smoothstep(0.93, 0.975, c) * 175;
      // Dry lakebeds: perfectly flat basins.
      const bedMask = smoothstep(0.64, 0.68, n2.fbm(x / 14000 + 90, z / 14000, 3));
      const rawH = base + dunes + mesa - canyon;
      const rim = smoothstep(0.7, 1.0, edge(x, z)) * (500 + 700 * ridged(n3, x / 8000, z / 8000, 4));
      return lerp(rawH, 575, bedMask) + rim * (1 - bedMask);
    };
  }

  // snow
  return (x, z) => {
    const valley = 900 + (n1.fbm(x / 15000, z / 15000, 4) - 0.5) * 2 * 150 + (n2.fbm(x / 2500, z / 2500, 4) - 0.5) * 2 * 25;
    const range = smoothstep(0.38, 0.6, n3.fbm(x / 26000 + 30, z / 26000, 3));
    const pass = smoothstep(0.7, 0.9, n4.fbm(x / 9000 + 60, z / 9000, 3));
    const peaks = ridged(n2, x / 7000 + 3, z / 7000, 6);
    const rim = smoothstep(0.55, 1.0, edge(x, z)) * 0.55;
    const mountains = (range * (1 - 0.32 * pass) + rim) * (1900 * peaks ** 1.3 + 330 * n1.fbm(x / 2300, z / 2300, 3));
    return valley + mountains;
  };
}

/**
 * Full height function. `features` holds the carved rivers/lakes; airports are added later with
 * `setAirports` (they need the pre-flatten terrain to choose sites).
 */
export function createHeightfield(config, features) {
  const base = createBaseHeight(config);
  const { rivers, lakes } = features;
  let airports = [];

  // Terrain including rivers and lakes but not airport pads.
  const carved = (x, z) => {
    let h = base(x, z);
    if (rivers) {
      const r = rivers.nearest(x, z);
      if (r.dist < r.w * 2.2) {
        const bed = r.y - 1.4;
        const t = smoothstep(r.w * 0.5, r.w * 2.2, r.dist);
        h = lerp(bed - 0.4 * (1 - t), h, t);
      }
    }
    for (let i = 0; i < lakes.length; i++) {
      const l = lakes[i];
      const dx = x - l.x;
      const dz = z - l.z;
      const d2 = dx * dx + dz * dz;
      const outer = l.radius * 1.7;
      if (d2 > outer * outer) continue;
      const d = Math.sqrt(d2) / l.radius;
      if (d < 1) h = l.level - 1.5 - 16 * (1 - d * d);
      else h = lerp(l.level + 0.6, h, smoothstep(1, 1.7, d));
    }
    return h;
  };

  const height = (x, z) => {
    let h = carved(x, z);
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      const dx = x - a.x;
      const dz = z - a.z;
      const outer = a.flatRadius * 2.4;
      if (dx > outer || dx < -outer || dz > outer || dz < -outer) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < outer) h = lerp(a.elevation, h, smoothstep(a.flatRadius, outer, d));
    }
    return h;
  };

  return {
    base, carved, height, rivers, lakes,
    setAirports(list) { airports = list; },
  };
}
