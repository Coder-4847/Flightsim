import { smoothstep } from '../util/noise.js';
import { MAP_HALF } from './maps.js';
import { createGradNoise, lerp, sstep, terrace, unit } from './terrainNoise.js';
import { lakeD } from './lakeShape.js';

// Terrain height for each biome plus the features carved into it (rivers, lakes) and the flat
// pads under airports. All functions are deterministic for a given map seed.
//
// Wavelengths below about 150 m stay out of the height function: the mesh is sampled every 48 m
// and the physics ground is this same function, so finer relief is added by the terrain shader.

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function noises(seed) {
  return {
    n1: createGradNoise(seed), n2: createGradNoise(seed + 101), n3: createGradNoise(seed + 202),
    n4: createGradNoise(seed + 303), nw: createGradNoise(seed + 404), n5: createGradNoise(seed + 505),
  };
}

/** Distance to the map edge as 0 (centre) .. 1 (edge): a rounded, noise-warped square. */
function makeEdge(nw) {
  return (x, z) => {
    const wx = x + 6000 * nw.s(x / 19000 + 1, z / 19000);
    const wz = z + 6000 * nw.s(x / 19000, z / 19000 + 7);
    const ax = Math.abs(wx) / MAP_HALF;
    const az = Math.abs(wz) / MAP_HALF;
    return (ax ** 3.2 + az ** 3.2) ** (1 / 3.2);
  };
}

// ---- grasslands ------------------------------------------------------------------------------------
function grass(N) {
  const { n1, n2, n3, n4, nw, n5 } = N;
  const edge = makeEdge(nw);
  const height = (x, z) => {
    const wx = x + 1300 * n5.s(x / 8000 + 2, z / 8000);
    const wz = z + 1300 * n5.s(x / 8000, z / 8000 + 5);
    let h = 175 + 150 * n1.erode(wx / 11000, wz / 11000, 4, 1.4) + 20 * n2.fbm(wx / 2400 + 11, wz / 2400, 3)
      + 4.5 * n3.fbm(x / 520, z / 520, 3) + 1.3 * n4.s(x / 170, z / 170);
    // Belts of hills with eroded ridges.
    const hm = sstep(0.4, 0.62, unit(n3.s(x / 16000 + 7, z / 16000)));
    if (hm > 0) h += hm * (50 + 480 * n2.ridged(wx / 3900 + 3, wz / 3900, 5, 0.5) ** 1.3);
    // Terraced uplands: plateaus with escarpments.
    const tm = sstep(0.45, 0.62, unit(n4.s(x / 12000 + 40, z / 12000)));
    if (tm > 0) h = lerp(h, terrace(h, 36, 0.72), tm * 0.65);
    const e = edge(x, z);
    if (e > 0.66) h += sstep(0.66, 1.0, e) * (600 + 1400 * n4.ridged(x / 7000, z / 7000, 5, 0.8));
    return h;
  };
  const masks = (x, z, out) => {
    out.relief = sstep(0.4, 0.62, unit(n3.s(x / 16000 + 7, z / 16000)));
    out.dune = 0; out.wadi = 0; out.bed = 0; out.mesa = 0;
  };
  return { height, masks, edge };
}

// ---- desert ---------------------------------------------------------------------------------------------
function desert(N) {
  const { n1, n2, n3, n4, nw, n5 } = N;
  const edge = makeEdge(nw);
  const cosA = Math.cos(0.52);
  const sinA = Math.sin(0.52);
  const SLIP = 0.72;
  const saw = (t) => (t < SLIP ? smooth01(t / SLIP) : 1 - smooth01((t - SLIP) / (1 - SLIP)));
  const parts = (x, z) => {
    const wx = x + 1100 * n5.s(x / 7000 + 2, z / 7000);
    const wz = z + 1100 * n5.s(x / 7000, z / 7000 + 5);
    const base = 620 + 80 * n1.erode(wx / 10000, wz / 10000, 4, 1.0) + 14 * n2.fbm(x / 2300, z / 2300, 3);
    const dm = sstep(0.36, 0.52, unit(n3.s(x / 7500 + 5, z / 7500)));
    let dunes = 0;
    if (dm > 0) {
      const u = (x * cosA + z * sinA) / 300 + 1.8 * n4.fbm(x / 900, z / 900, 3);
      const amp = 14 + 18 * unit(n2.s(x / 3000 + 3, z / 3000));
      dunes = dm * (amp * saw(u - Math.floor(u)) + 1.5 * n2.s(x / 170, z / 170));
    }
    const p = n1.fbm(x / 4800 + 20, z / 4800, 4);
    const mesaM = sstep(0.08, 0.125, p);
    const mesa = mesaM * (115 + 8 * n3.fbm(x / 700, z / 700, 3)) + sstep(0.24, 0.28, p) * 65 + 0.0;
    const canyonN = n4.ridged(wx / 6000 + 40, wz / 6000, 3, 0.2);
    const canyon = sstep(0.86, 0.93, canyonN) * 170;
    const wadiN = 1 - Math.abs(n5.s(wx / 4200 + 60, wz / 4200));
    const wadi = sstep(0.93, 0.975, wadiN);
    const bed = sstep(0.28, 0.34, n2.fbm(x / 11000 + 90, z / 11000, 3));
    return { base, dunes, mesa, mesaM, canyon, wadi, bed, dm };
  };
  const height = (x, z) => {
    const q = parts(x, z);
    const raw = q.base + q.dunes * (1 - q.mesaM * 0.9) + q.mesa * (1 - 0.5 * q.dm) - q.canyon - q.wadi * 4.5;
    const e = edge(x, z);
    const rim = e > 0.7 ? sstep(0.7, 1.0, e) * (500 + 700 * n3.ridged(x / 8000, z / 8000, 4, 0.6)) : 0;
    return lerp(raw, 575, q.bed) + rim * (1 - q.bed);
  };
  const masks = (x, z, out) => {
    const q = parts(x, z);
    out.dune = q.dm; out.wadi = q.wadi * (1 - q.bed); out.bed = q.bed; out.mesa = q.mesaM; out.relief = q.mesaM;
  };
  return { height, masks, edge };
}

// ---- snow --------------------------------------------------------------------------------------------------
function snow(N) {
  const { n1, n2, n3, n4, nw, n5 } = N;
  const edge = makeEdge(nw);
  const height = (x, z) => {
    const wx = x + 900 * n5.s(x / 6000 + 2, z / 6000);
    const wz = z + 900 * n5.s(x / 6000, z / 6000 + 5);
    const valley = 900 + 110 * n1.erode(x / 11000, z / 11000, 4, 1.0) + 18 * n2.fbm(x / 2300, z / 2300, 3);
    const range = sstep(0.12, 0.34, n3.fbm(x / 17000 + 30, z / 17000, 3) + 0.2);
    const pass = sstep(0.1, 0.5, n4.fbm(x / 7000 + 60, z / 7000, 3));
    const e = edge(x, z);
    const rim = sstep(0.5, 1.0, e) * 0.6;
    const m = range * (1 - 0.32 * pass) + rim;
    if (m <= 0.001) return valley;
    const peaks = n2.ridged(wx / 5600 + 3, wz / 5600, 6, 0.8);
    let mountains = m * (1750 * peaks ** 1.25 + 280 * unit(n1.fbm(x / 1900, z / 1900, 3)));
    // Glacial valleys: wide, flat-floored troughs between the ranges.
    const trough = smooth01(1 - mountains / 420);
    mountains *= 1 - 0.35 * trough * trough;
    return valley + mountains;
  };
  const masks = (x, z, out) => {
    out.relief = sstep(0.12, 0.34, n3.fbm(x / 17000 + 30, z / 17000, 3) + 0.2);
    out.dune = 0; out.wadi = 0; out.bed = 0; out.mesa = 0;
  };
  return { height, masks, edge };
}

const BIOMES = { grass, desert, snow };

/** Landform model for a map: raw elevation plus a few region masks the zone builder can use. */
export function createLandforms(config) {
  return BIOMES[config.biome](noises(config.seed));
}

/** Raw biome elevation (metres MSL), before rivers, lakes and airports. */
export function createBaseHeight(config) {
  return createLandforms(config).height;
}

/**
 * Full height function. `features` holds the carved rivers/lakes; airports are added later with
 * `setAirports` (they need the pre-flatten terrain to choose sites).
 */
export function createHeightfield(config, features) {
  const base = createBaseHeight(config);
  const { rivers, lakes } = features;
  let airports = [];
  let pits = [];
  let pads = []; // flat building plots under the cities, set once the city sites are known

  // Terrain including rivers and lakes but not airport pads.
  const makeCarved = (withPads) => (x, z) => {
    let h = base(x, z);
    // Cities stand on level ground: the terrain eases onto a flat plot under the built-up area (before rivers and lakes
    // are cut, so those still carve through the blend).
    for (let i = 0; withPads && i < pads.length; i++) {
      const c = pads[i];
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx > c.outer || dx < -c.outer || dz > c.outer || dz < -c.outer) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < c.outer) h = lerp(c.elevation, h, smoothstep(c.flat, c.outer, d));
    }
    if (rivers) {
      const r = rivers.nearest(x, z);
      if (r.dist < r.w * 9) {
        // A shallow floodplain valley widening around the channel, then the channel itself.
        const plain = r.y + 2.4 + (r.dist - r.w) * 0.018;
        if (plain < h) h = lerp(h, plain, smoothstep(r.w * 9, r.w * 3, r.dist) * 0.92);
        if (r.dist < r.w * 2.2) {
          const bed = r.y - 1.4;
          const t = smoothstep(r.w * 0.5, r.w * 2.2, r.dist);
          h = lerp(bed - 0.4 * (1 - t), h, t);
        }
      }
    }
    for (let i = 0; i < lakes.length; i++) {
      const l = lakes[i];
      const dx = x - l.x;
      const dz = z - l.z;
      const d2 = dx * dx + dz * dz;
      const outer = l.radius * 2.4;
      if (d2 > outer * outer) continue;
      const d = lakeD(l, dx, dz);
      if (d > 1.7) continue;
      if (d < 1) h = l.level - 1.5 - 16 * (1 - d * d);
      else h = lerp(l.level + 0.6, h, smoothstep(1, 1.7, d));
    }
    for (let i = 0; i < pits.length; i++) {
      const q = pits[i];
      const dx = x - q.x; const dz = z - q.z;
      if (dx * dx + dz * dz > q.r * q.r) continue;
      const d = Math.sqrt(dx * dx + dz * dz) / q.r;
      // Terraced open-cast pit: benches stepping down to a flat floor.
      const t = smoothstep(1.0, 0.42, d + 0.05 * Math.sin(Math.atan2(dz, dx) * 5 + q.x));
      h -= q.depth * (Math.floor(t * 5) / 5 + smoothstep(0.62, 1.0, (t * 5) % 1) / 5);
    }
    return h;
  };

  // `carved` (no city plots) is what the site search and airport elevations use, so the layout of cities and airports
  // does not depend on the plots; `height` is the real ground.
  const carved = makeCarved(false);
  const carvedWithPads = makeCarved(true);
  const height = (x, z) => {
    let h = carvedWithPads(x, z);
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
    /** Level the ground under cities: [{ x, z, radius }]. The plot height is the mean of the natural terrain across the city. */
    setCities(list) {
      pads = [];
      list.forEach((c) => {
        let sum = base(c.x, c.z);
        let n = 1;
        for (const f of [0.4, 0.8]) {
          for (let k = 0; k < 8; k++) {
            const a = k * 0.785 + f;
            sum += base(c.x + Math.cos(a) * c.radius * f, c.z + Math.sin(a) * c.radius * f);
            n++;
          }
        }
        pads.push({ x: c.x, z: c.z, elevation: sum / n, flat: c.radius * 1.05, outer: c.radius * (c.kind === 'major' ? 2.2 : 2.0) });
      });
    },
    setPits(list) { pits = list; },
  };
}
