import * as THREE from 'three';
import { hash2 } from '../util/random.js';
import { Terrain } from './terrainTiles.js';

// Instanced city buildings. Blocks sit on the same 88 m grid the terrain shader draws streets on,
// so buildings fill the blocks between the painted roads. Windows and night lighting are drawn
// in the material from world position, so any building size looks right.

export const BLOCK = 88;
// Unit box without its bottom face (never visible), origin at the base.
const unitBox = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  const pos = g.attributes.position;
  const keep = [];
  for (let i = 0; i < pos.count; i += 3) {
    const allBottom = pos.getY(i) < 0.01 && pos.getY(i + 1) < 0.01 && pos.getY(i + 2) < 0.01;
    if (!allBottom) keep.push(i, i + 1, i + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const src = g.attributes[name];
    const arr = new Float32Array(keep.length * src.itemSize);
    keep.forEach((v, k) => { for (let c = 0; c < src.itemSize; c++) arr[k * src.itemSize + c] = src.array[v * src.itemSize + c]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
  }
  out.computeBoundingSphere();
  return out;
})();

let material = null;
export function buildingMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  const uniforms = { uNight: { value: 0 }, uSnow: { value: 0 } };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 bw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vWPos = bw.xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uSnow;
        varying vec3 vWPos; varying vec3 vWN;
        float bh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float facade = 1.0 - smoothstep(0.35, 0.6, abs(vWN.y));
        vec2 tang = vec2(-vWN.z, vWN.x);
        vec2 wc = vec2(dot(vWPos.xz, tang) / 3.6, vWPos.y / 3.3);
        vec2 wf = fract(wc);
        float win = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.28, wf.y) * step(wf.y, 0.82) * facade;
        float lit = step(bh(floor(wc) + floor(vWPos.xz / 40.0)), 0.42) * win;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.14, 0.20), win * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.5, 0.9, vWN.y));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * lit * uNight * 0.9;`);
  };
  return material;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();
const WALLS = ['#cfc8bb', '#b9b4aa', '#d8d2c4', '#a9a49c', '#c4bcae', '#b0aaa0', '#9da3a8', '#d7d3cc'];
const TOWER_WALLS = ['#9aa7b5', '#8895a3', '#b4bcc6', '#7f8c99', '#a5b0bc'];

/** Decide the buildings in one 88 m block (deterministic). Returns an array of {x,z,w,d,h,c}. */
function blockBuildings(bx, bz, zone, city, seed, tall) {
  const out = [];
  const baseX = bx * BLOCK;
  const baseZ = bz * BLOCK;
  const dens = zone.urban;
  const cx = baseX + BLOCK / 2;
  const cz = baseZ + BLOCK / 2;
  const dc = Math.hypot(cx - city.x, cz - city.z) / city.radius; // 0 centre .. 1 edge
  // Zones: a compact tower core, a mid-rise ring, then low-rise suburbs thinning into open lots.
  const coreR = city.kind === 'major' ? 0.13 : city.kind === 'town' ? 0.07 : 0;
  const midR = city.kind === 'major' ? 0.34 : city.kind === 'town' ? 0.3 : 0.15;
  const occupancy = dc < coreR ? 0.9 : dc < midR ? 0.78 : 0.08 + 0.62 * dens * dens;
  if (hash2(bx, bz, seed) > occupancy) return out;
  let count = dc < coreR ? 1 : dc < midR ? 1 + Math.floor(hash2(bx, bz, seed + 7) * 2) : 1 + Math.floor(hash2(bx, bz, seed + 7) * 4);
  count = Math.min(count, 4);
  const subs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let k = 0; k < count; k++) {
    const hh = hash2(bx * 7 + k, bz * 13, seed + 11);
    const [sx, sz] = count === 1 ? [0, 0] : subs[k];
    const half = count === 1 ? 1 : count === 2 && k === 1 ? 0.8 : 0.5;
    const w = (BLOCK - 14) * half * (0.55 + 0.4 * hash2(bx + k, bz, seed + 2));
    const d = (BLOCK - 14) * half * (0.55 + 0.4 * hash2(bx, bz + k, seed + 3));
    let h;
    if (dc < coreR) h = 55 + hh * hh * 230;
    else if (dc < midR) h = 16 + hh * 38;
    else h = 5 + hh * 11;
    const isTower = h >= 45;
    if (isTower !== tall) continue;
    out.push({
      x: cx + sx * (BLOCK / 4), z: cz + sz * (BLOCK / 4), w, d, h,
      c: isTower ? TOWER_WALLS[Math.floor(hh * 977) % TOWER_WALLS.length] : WALLS[Math.floor(hh * 977) % WALLS.length],
    });
  }
  return out;
}

function toMesh(items, ground, mat) {
  const mesh = new THREE.InstancedMesh(unitBox, mat, items.length);
  items.forEach((b, i) => {
    _m.compose(new THREE.Vector3(b.x, ground(b.x, b.z) - 0.4, b.z), _q.identity(), new THREE.Vector3(b.w, b.h + 0.4, b.d));
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, _col.set(b.c));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Low and mid-rise buildings for a tile (towers live in the skyline mesh). */
export function buildCityTile(tile, map, zones) {
  const x0 = Math.floor(tile.x0 / BLOCK);
  const x1 = Math.floor((tile.x0 + tile.size) / BLOCK);
  const z0 = Math.floor(tile.z0 / BLOCK);
  const z1 = Math.floor((tile.z0 + tile.size) / BLOCK);
  // Only cities that overlap the tile matter.
  const cities = map.cities.filter((c) => c.x + c.radius > tile.x0 && c.x - c.radius < tile.x0 + tile.size && c.z + c.radius > tile.z0 && c.z - c.radius < tile.z0 + tile.size);
  if (!cities.length) return null;
  const items = [];
  const zone = {};
  const seed = map.cfg.seed + 77;
  for (let bz = z0; bz <= z1; bz++) {
    for (let bx = x0; bx <= x1; bx++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cz = bz * BLOCK + BLOCK / 2;
      const city = cities.find((c) => Math.hypot(cx - c.x, cz - c.z) < c.radius * 1.05);
      if (!city) continue;
      const h = Terrain.heightIn(tile, cx, cz);
      zones.sample(cx, cz, h, 0.02, zone);
      if (zone.urban < 0.12) continue;
      for (const b of blockBuildings(bx, bz, zone, city, seed, false)) items.push(b);
    }
  }
  if (!items.length) return null;
  const mesh = toMesh(items, (x, z) => Terrain.heightIn(tile, x, z), buildingMaterial());
  const g = new THREE.Group();
  g.userData.kind = 'buildings';
  g.add(mesh);
  return g;
}

/** All towers of a city in one mesh, visible from any distance (the skyline). */
export function buildSkyline(map, zones, city) {
  const items = [];
  const zone = {};
  const seed = map.cfg.seed + 77;
  const reach = city.radius * (city.kind === 'major' ? 0.5 : 0.3);
  const b0x = Math.floor((city.x - reach) / BLOCK);
  const b1x = Math.floor((city.x + reach) / BLOCK);
  const b0z = Math.floor((city.z - reach) / BLOCK);
  const b1z = Math.floor((city.z + reach) / BLOCK);
  for (let bz = b0z; bz <= b1z; bz++) {
    for (let bx = b0x; bx <= b1x; bx++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cz = bz * BLOCK + BLOCK / 2;
      if (Math.hypot(cx - city.x, cz - city.z) > reach) continue;
      zones.sample(cx, cz, map.hf.height(cx, cz), 0.02, zone);
      if (zone.urban < 0.12) continue;
      for (const b of blockBuildings(bx, bz, zone, city, seed, true)) items.push(b);
    }
  }
  if (!items.length) return null;
  return toMesh(items, (x, z) => map.hf.height(x, z), buildingMaterial());
}
