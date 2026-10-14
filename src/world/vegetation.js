import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../util/random.js';
import { Terrain } from './terrainTiles.js';

// Instanced trees per terrain tile. Placement comes from the same forest mask the terrain shader
// paints, so woodland you see from afar is where the trees appear up close.

// Indexed and non-indexed primitives cannot be merged, so everything is flattened first.
function flat(geo) {
  return geo.index ? geo.toNonIndexed() : geo;
}

function colored(geo, color) {
  geo = flat(geo);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const geometries = {};
function treeGeometry(kind) {
  if (geometries[kind]) return geometries[kind];
  let geo;
  if (kind === 'conifer') {
    const c1 = colored(new THREE.ConeGeometry(3.0, 9, 5, 1, true).translate(0, 5.5, 0), '#2f6b44');
    const c2 = colored(new THREE.ConeGeometry(2.0, 7, 5, 1, true).translate(0, 10.5, 0), '#3a7d52');
    geo = mergeGeometries([c1, c2]);
  } else if (kind === 'palm') {
    const trunk = colored(new THREE.CylinderGeometry(0.28, 0.4, 9, 4, 1, true).translate(0, 4.5, 0), '#9a7a52');
    const parts = [trunk];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.PlaneGeometry(5.4, 1.2).rotateX(-Math.PI / 2).translate(2.7, 0, 0);
      f.rotateZ(-0.3);
      f.rotateY((i / 4) * Math.PI * 2);
      f.translate(0, 9, 0);
      parts.push(colored(f, '#4f9a3c'));
    }
    geo = mergeGeometries(parts);
  } else { // broadleaf
    const trunk = colored(new THREE.CylinderGeometry(0.3, 0.45, 3.4, 4, 1, true).translate(0, 1.7, 0), '#7e6244');
    const crown = colored(new THREE.IcosahedronGeometry(3.8, 0).translate(0, 6.6, 0).scale(1, 1.1, 1), '#5a9a34');
    geo = mergeGeometries([trunk, crown]);
  }
  geo.computeBoundingSphere();
  geometries[kind] = geo;
  return geo;
}

let treeMaterial = null;
function material() {
  if (!treeMaterial) treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  return treeMaterial;
}

const mask = {};

/**
 * Build the tree instances for a tile (levels 0 and 1 only). Returns a Group or null.
 */
export function buildTrees(tile, map, zones) {
  const biome = map.cfg.biome;
  const kind = biome === 'snow' ? 'conifer' : biome === 'desert' ? 'palm' : 'broadleaf';
  const spacing = tile.level === 0 ? 30 : 52;
  const n = Math.floor(tile.size / spacing);
  // Mask grid every 8 cells, sampled from the zone function with slope from the tile heights.
  const gstep = 8;
  const gn = Math.ceil(n / gstep) + 1;
  const grid = new Float32Array(gn * gn);
  let any = false;
  for (let gj = 0; gj < gn; gj++) {
    for (let gi = 0; gi < gn; gi++) {
      const x = tile.x0 + gi * gstep * spacing;
      const z = tile.z0 + gj * gstep * spacing;
      const h = Terrain.heightIn(tile, x, z);
      const e = 20;
      const slope = Math.hypot(Terrain.heightIn(tile, x + e, z) - Terrain.heightIn(tile, x - e, z), Terrain.heightIn(tile, x, z + e) - Terrain.heightIn(tile, x, z - e)) / (2 * e);
      zones.sample(x, z, h, slope, mask);
      const v = mask.forest;
      grid[gj * gn + gi] = v;
      if (v > 0.02) any = true;
    }
  }
  if (!any) return null;
  const items = [];
  const cap = 1700;
  const seed = map.cfg.seed;
  for (let j = 0; j < n && items.length < cap; j++) {
    for (let i = 0; i < n; i++) {
      const gx = i / gstep;
      const gz = j / gstep;
      const gi = Math.min(gn - 2, Math.floor(gx));
      const gj = Math.min(gn - 2, Math.floor(gz));
      const fx = gx - gi;
      const fz = gz - gj;
      const f = grid[gj * gn + gi] * (1 - fx) * (1 - fz) + grid[gj * gn + gi + 1] * fx * (1 - fz) + grid[(gj + 1) * gn + gi] * (1 - fx) * fz + grid[(gj + 1) * gn + gi + 1] * fx * fz;
      if (f < 0.04) continue;
      const wi = Math.floor(tile.x0 / spacing) + i;
      const wj = Math.floor(tile.z0 / spacing) + j;
      if (hash2(wi, wj, seed) > f * 0.85) continue;
      const x = (wi + hash2(wi, wj, seed + 1)) * spacing;
      const z = (wj + hash2(wi, wj, seed + 2)) * spacing;
      items.push({ x, z, s: 0.7 + hash2(wi, wj, seed + 3) * 0.8, r: hash2(wi, wj, seed + 4) * 6.28, c: hash2(wi, wj, seed + 5) });
      if (items.length >= cap) break;
    }
  }
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(treeGeometry(kind), material(), items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const grow = tile.level === 0 ? 1 : 1.5; // coarser tiles use fewer, larger trees to keep the canopy look
  items.forEach((it, k) => {
    const y = Terrain.heightIn(tile, it.x, it.z);
    q.setFromAxisAngle(up, it.r);
    m.compose(new THREE.Vector3(it.x, y - 0.3, it.z), q, new THREE.Vector3(it.s * grow, it.s * grow, it.s * grow));
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, col.setScalar(0.8 + it.c * 0.4));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  const g = new THREE.Group();
  g.userData.kind = 'trees';
  g.add(mesh);
  return g;
}
