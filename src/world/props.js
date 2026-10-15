import { rnd2, fieldAt } from './fields.js';
import { Terrain } from './terrainTiles.js';

// Rural buildings per tile: isolated farms (house, barn, silo, sheds and a windbreak) in the
// farmland, and houses strung along the country roads. Items use the instanced building geometries;
// trees go into the tile's tree batch. Everything is positioned from hashes of fixed grid cells or
// road distances, so a tile always builds the same props.

const FARM_CELL = 1050;
const WALLS = ['#e6dfd0', '#d9cdb6', '#f0ece2', '#c9b79b', '#d7d1c4', '#e8d9b8', '#cfd6d8'];
const ROOFS = ['#8c4a38', '#a05a40', '#4c4f57', '#5a4a40', '#6b3b30', '#7a7a7e'];
const BARNS = ['#8b3a2a', '#7a3a2c', '#9a8a70', '#6a5a46', '#a04a34'];
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];

export function tileProps(tile, map, zones, batch, clear) {
  const items = [];
  if (tile.level !== 0) return items;
  const biome = map.cfg.biome;
  const seed = map.cfg.seed + 5;
  const out = {};
  const x0 = tile.x0; const z0 = tile.z0; const x1 = x0 + tile.size; const z1 = z0 + tile.size;
  const slopeAt = (x, z) => Math.hypot(Terrain.heightIn(tile, x + 14, z) - Terrain.heightIn(tile, x - 14, z), Terrain.heightIn(tile, x, z + 14) - Terrain.heightIn(tile, x, z - 14)) / 28;

  // ---- farms ----------------------------------------------------------------------------------------------
  if (biome === 'grass') {
    for (let cj = Math.floor(z0 / FARM_CELL); cj <= Math.floor(z1 / FARM_CELL); cj++) {
      for (let ci = Math.floor(x0 / FARM_CELL); ci <= Math.floor(x1 / FARM_CELL); ci++) {
        if (rnd2(ci, cj, seed + 1) > 0.55) continue;
        const x = (ci + 0.15 + 0.7 * rnd2(ci, cj, seed + 2)) * FARM_CELL;
        const z = (cj + 0.15 + 0.7 * rnd2(ci, cj, seed + 3)) * FARM_CELL;
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
        const h = Terrain.heightIn(tile, x, z);
        zones.sample(x, z, h, 0.03, out);
        if (out.farm < 0.4 || out.urban > 0.02 || slopeAt(x, z) > 0.09 || !clear.free(x, z, 60)) continue;
        const r = fieldAt(x, z, {}).region;
        const rot = Math.atan2(r.sin, r.cos);
        const at = (ox, oz) => ({ x: x + ox * r.cos - oz * r.sin, z: z + ox * r.sin + oz * r.cos });
        const yaw = -rot;
        const wall = pick(WALLS, rnd2(ci, cj, seed + 4));
        const house = at(0, 0);
        items.push({ t: 'gable', x: house.x, z: house.z, w: 11, d: 8.5, h: 5.6, yaw, wall, roof: pick(ROOFS, rnd2(ci, cj, seed + 5)), kind: 0 });
        const barn = at(30, -6);
        items.push({ t: 'gable', x: barn.x, z: barn.z, w: 24 + 10 * rnd2(ci, cj, seed + 6), d: 13, h: 6.4, yaw, wall: pick(BARNS, rnd2(ci, cj, seed + 7)), roof: '#76787a', kind: 4 });
        const shed = at(14, 20);
        items.push({ t: 'shed', x: shed.x, z: shed.z, w: 16, d: 8, h: 4, yaw, wall: '#9a8a74', roof: '#7a7c7e', kind: 3 });
        if (rnd2(ci, cj, seed + 8) < 0.6) {
          const s = at(52, 16);
          items.push({ t: 'cyl', x: s.x, z: s.z, w: 5.2, d: 5.2, h: 16, yaw: 0, wall: '#b9bec2', roof: '#9aa0a4', kind: 5 });
          const s2 = at(58, 16);
          if (rnd2(ci, cj, seed + 9) < 0.5) items.push({ t: 'cyl', x: s2.x, z: s2.z, w: 4.4, d: 4.4, h: 13, yaw: 0, wall: '#b9bec2', roof: '#9aa0a4', kind: 5 });
        }
        // Windbreak: a ring of trees west of the yard and a few around the house.
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * 6.28 + rnd2(ci, k, seed + 10) * 0.4;
          const p = at(26 + Math.cos(a) * 46, 8 + Math.sin(a) * 34);
          if (k % 3 === 0) continue;
          batch.add(k % 4 === 1 ? 'poplar' : 'oak', p.x, p.z, 0.8 + rnd2(ci, k, seed + 11) * 0.6, rnd2(ci, k, seed + 12) * 6.28, rnd2(ci, k, seed + 13));
        }
      }
    }
  }

  // ---- houses along country roads ------------------------------------------------------------------------------
  const palette = biome === 'desert' ? ['#e8d8b4', '#dcc89a', '#f2e8d0', '#d2b88a'] : biome === 'snow' ? ['#8a6a4a', '#9a7a58', '#b8a07c', '#7a5a3c'] : WALLS;
  const roofs = biome === 'desert' ? ['#e2cfa4', '#d9c394'] : biome === 'snow' ? ['#3e3a3a', '#4a2f26', '#34404a'] : ROOFS;
  for (const road of map.roads) {
    if (road.type === 'highway') continue;
    const pts = road.points;
    let s = 40 + 200 * rnd2(Math.round(pts[0].x), Math.round(pts[0].z), seed + 20);
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.01) continue;
      const tx = (b.x - a.x) / L; const tz = (b.z - a.z) / L;
      while (s - acc < L) {
        const t = s - acc;
        const k = Math.round(s);
        const side = rnd2(k, i, seed + 21) < 0.5 ? -1 : 1;
        const off = 15 + 9 * rnd2(k, i, seed + 22);
        const x = a.x + tx * t - tz * side * off;
        const z = a.z + tz * t + tx * side * off;
        s += (biome === 'desert' ? 420 : 110) + (biome === 'desert' ? 700 : 330) * rnd2(k, i, seed + 23);
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
        const h = Terrain.heightIn(tile, x, z);
        zones.sample(x, z, h, 0.03, out);
        if (out.urban > 0.05 || out.forest > 0.4 || slopeAt(x, z) > 0.12 || !clear.free(x, z, 7)) continue;
        const f = rnd2(k, i, seed + 24);
        const yaw = Math.atan2(-tz, tx);
        const flat = biome === 'desert';
        items.push({ t: flat ? 'box' : 'gable', x, z, w: 9 + 3 * f, d: 7.5 + 2 * f, h: f < 0.3 ? 5.4 : 2.9, yaw, wall: pick(palette, f * 13.7 % 1), roof: pick(roofs, f * 7.3 % 1), kind: 0 });
        if (f > 0.6 && !flat) items.push({ t: 'box', x: x + tx * 9, z: z + tz * 9, w: 5, d: 3.6, h: 2.5, yaw, wall: pick(palette, f * 3.1 % 1), roof: '#6d6f72', kind: 0 });
        if (f < 0.55) batch.add(biome === 'desert' ? 'palm' : 'oak', x - tz * side * 9 + tx * 8, z + tx * side * 9 + tz * 8, 0.7 + f, f * 40, f * 9 % 1);
      }
      acc += L;
    }
  }
  return items;
}
