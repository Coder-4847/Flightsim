import * as THREE from 'three';
import { MAP_HALF } from './maps.js';

// Quadtree level-of-detail terrain. Every tile is a (N+1)x(N+1) grid with skirts, so a tile of
// any size has the same triangle count: LOD level L covers 2^L times the area at 2^L times the
// vertex spacing. Tiles are built on demand from the height function and cached.

const SEGMENTS = 32;
const BASE_SIZE = 1536; // level 0 tile edge, metres (vertex spacing 48 m)
const MAX_LEVEL = 5; // 64 km tiles at the top
const SPLIT_FACTOR = 2.2; // split a tile when the camera is closer than size * factor
const NORMAL_EPS = BASE_SIZE / SEGMENTS; // metres: normals are always taken over +/- this distance
const LIMIT = 90000; // no tiles beyond this distance from the map centre

function buildIndex(n) {
  // Grid quads, then four skirt strips (edges are indexed after the grid vertices).
  const idx = [];
  const row = n + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const gridCount = row * row;
  // Skirt vertices: bottom edge (j=0), top edge (j=n), left (i=0), right (i=n), in that order.
  const skirt = (edge, flip) => {
    for (let k = 0; k < n; k++) {
      const top0 = edge.top[k];
      const top1 = edge.top[k + 1];
      const b0 = gridCount + edge.base + k;
      const b1 = b0 + 1;
      if (flip) idx.push(top0, top1, b0, top1, b1, b0);
      else idx.push(top0, b0, top1, top1, b0, b1);
    }
  };
  skirt({ top: Array.from({ length: row }, (_, i) => i), base: 0 }, false);
  skirt({ top: Array.from({ length: row }, (_, i) => n * row + i), base: row }, true);
  skirt({ top: Array.from({ length: row }, (_, j) => j * row), base: 2 * row }, true);
  skirt({ top: Array.from({ length: row }, (_, j) => j * row + n), base: 3 * row }, false);
  return new Uint32Array(idx);
}

export class Terrain {
  constructor(map, material, scene) {
    this.map = map;
    this.hf = map.hf;
    this.material = material;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tiles = new Map();
    this.index = new THREE.BufferAttribute(buildIndex(SEGMENTS), 1);
    this.frame = 0;
    this.pendingBuilds = 1;
    this.visible = new Set();
    this.queue = [];
    this.listeners = []; // called with (tile) when a tile is built, and (tile) when disposed
    this.onTileBuilt = null;
    this.onTileDisposed = null;
    this.buildsPerFrame = 2;
    this.nodeHeightCache = new Map();
    // Root tiles: a grid of top-level tiles covering the map and a margin.
    this.rootSize = BASE_SIZE * 2 ** MAX_LEVEL;
    this.roots = [];
    const r = Math.ceil(LIMIT / this.rootSize);
    for (let ix = -r; ix < r; ix++) for (let iz = -r; iz < r; iz++) this.roots.push({ level: MAX_LEVEL, ix, iz });
  }

  static key(level, ix, iz) { return `${level}:${ix}:${iz}`; }

  nodeCenter(n) {
    const size = BASE_SIZE * 2 ** n.level;
    return { x: (n.ix + 0.5) * size, z: (n.iz + 0.5) * size, size };
  }

  #nodeGround(c, key) {
    let h = this.nodeHeightCache.get(key);
    if (h === undefined) {
      h = this.hf.height(c.x, c.z);
      this.nodeHeightCache.set(key, h);
    }
    return h;
  }

  /** Choose the leaf tiles for the camera position (recursive split). */
  select(cam) {
    const leaves = [];
    const visit = (n) => {
      const c = this.nodeCenter(n);
      if (Math.abs(c.x) - c.size / 2 > LIMIT || Math.abs(c.z) - c.size / 2 > LIMIT) return;
      const key = Terrain.key(n.level, n.ix, n.iz);
      const ground = this.#nodeGround(c, key);
      // Distance to the node's footprint (not its centre) plus the height above its ground.
      const dx = Math.max(Math.abs(cam.x - c.x) - c.size / 2, 0);
      const dz = Math.max(Math.abs(cam.z - c.z) - c.size / 2, 0);
      const dy = Math.max(cam.y - ground - 250, 0);
      const dist = Math.hypot(dx, dz, dy);
      if (n.level > 0 && dist < c.size * SPLIT_FACTOR) {
        const l = n.level - 1;
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) visit({ level: l, ix: n.ix * 2 + a, iz: n.iz * 2 + b });
      } else leaves.push(n);
    };
    this.roots.forEach(visit);
    return leaves;
  }

  /** Height at (x, z) from a tile's own sample grid (matches its mesh; no function evaluation). */
  static heightIn(tile, x, z) {
    const fx = (x - tile.x0) / tile.step + 1;
    const fz = (z - tile.z0) / tile.step + 1;
    const i = Math.max(0, Math.min(tile.border - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(tile.border - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const tz = Math.max(0, Math.min(1, fz - j));
    const b = tile.border;
    const h00 = tile.heights[j * b + i];
    const h10 = tile.heights[j * b + i + 1];
    const h01 = tile.heights[(j + 1) * b + i];
    const h11 = tile.heights[(j + 1) * b + i + 1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
  }

  /** Build a tile mesh from the height function. Returns the tile record. */
  build(n) {
    const size = BASE_SIZE * 2 ** n.level;
    const x0 = n.ix * size;
    const z0 = n.iz * size;
    const row = SEGMENTS + 1;
    const step = size / SEGMENTS;
    const border = row + 2;
    const heights = new Float32Array(border * border);
    for (let j = -1; j <= SEGMENTS + 1; j++) {
      for (let i = -1; i <= SEGMENTS + 1; i++) heights[(j + 1) * border + (i + 1)] = this.hf.height(x0 + i * step, z0 + j * step);
    }
    const gridCount = row * row;
    const skirtCount = 4 * row;
    const positions = new Float32Array((gridCount + skirtCount) * 3);
    const normals = new Float32Array((gridCount + skirtCount) * 3);
    const cx = x0 + size / 2;
    const cz = z0 + size / 2;
    const skirtDepth = Math.max(40, step * 1.6);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= SEGMENTS; j++) {
      for (let i = 0; i <= SEGMENTS; i++) {
        const h = heights[(j + 1) * border + (i + 1)];
        const k = (j * row + i) * 3;
        positions[k] = x0 + i * step - cx;
        positions[k + 1] = h;
        positions[k + 2] = z0 + j * step - cz;
        // Normals use forward differences over a fixed 48 m baseline at every LOD, so neighbouring
        // tiles of different resolution shade identically along their shared edge.
        let hx;
        let hz;
        const run = NORMAL_EPS;
        if (step <= NORMAL_EPS * 1.01) {
          const h0 = heights[(j + 1) * border + (i + 1)];
          hx = heights[(j + 1) * border + (i + 2)] - h0;
          hz = heights[(j + 2) * border + (i + 1)] - h0;
        } else {
          const wx = x0 + i * step;
          const wz = z0 + j * step;
          hx = this.hf.height(wx + NORMAL_EPS, wz) - h;
          hz = this.hf.height(wx, wz + NORMAL_EPS) - h;
        }
        const inv = 1 / Math.hypot(hx, run, hz);
        normals[k] = -hx * inv;
        normals[k + 1] = run * inv;
        normals[k + 2] = -hz * inv;
        if (h < minY) minY = h;
        if (h > maxY) maxY = h;
      }
    }
    // Skirts duplicate the edge vertices, dropped down, with the same normal.
    const copyDown = (dst, src) => {
      const d = (gridCount + dst) * 3;
      positions[d] = positions[src * 3];
      positions[d + 1] = positions[src * 3 + 1] - skirtDepth;
      positions[d + 2] = positions[src * 3 + 2];
      normals[d] = normals[src * 3]; normals[d + 1] = normals[src * 3 + 1]; normals[d + 2] = normals[src * 3 + 2];
    };
    for (let i = 0; i <= SEGMENTS; i++) {
      copyDown(i, i);
      copyDown(row + i, SEGMENTS * row + i);
      copyDown(2 * row + i, i * row);
      copyDown(3 * row + i, i * row + SEGMENTS);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(this.index);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-size / 2, minY - skirtDepth, -size / 2), new THREE.Vector3(size / 2, maxY, size / 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, (minY + maxY) / 2, 0), Math.hypot(size / 2, size / 2, (maxY - minY) / 2 + skirtDepth));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(cx, 0, cz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    const tile = {
      ...n, key: Terrain.key(n.level, n.ix, n.iz), mesh, size, cx, cz, minY, maxY, lastUsed: this.frame, decor: null, built: true,
      heights, step, x0, z0, border,
    };
    this.tiles.set(tile.key, tile);
    this.onTileBuilt?.(tile);
    return tile;
  }

  /**
   * Update the visible set. Builds up to `buildsPerFrame` missing tiles (nearest first); a missing
   * leaf is covered by its nearest built ancestor until ready. Returns the number of pending builds.
   */
  update(cam, budget = this.buildsPerFrame) {
    this.frame++;
    // Nothing is waiting to be built and the camera has barely moved: the selection cannot change.
    const last = this.lastSelectCam;
    if (this.pendingBuilds === 0 && last && Math.abs(cam.x - last.x) < 20 && Math.abs(cam.z - last.z) < 20 && Math.abs(cam.y - last.y) < 12) return 0;
    this.lastSelectCam = { x: cam.x, y: cam.y, z: cam.z };
    const leaves = this.select(cam);
    const need = [];
    const show = new Set();
    for (const n of leaves) {
      const key = Terrain.key(n.level, n.ix, n.iz);
      const tile = this.tiles.get(key);
      if (tile) { show.add(tile); continue; }
      // Fallback: show the nearest built ancestor until this tile exists.
      let cover = null;
      let a = n;
      while (!cover && a.level < MAX_LEVEL) {
        a = { level: a.level + 1, ix: Math.floor(a.ix / 2), iz: Math.floor(a.iz / 2) };
        cover = this.tiles.get(Terrain.key(a.level, a.ix, a.iz));
      }
      need.push({ n, dist: Math.hypot(this.nodeCenter(n).x - cam.x, this.nodeCenter(n).z - cam.z), covered: !!cover });
      if (cover) show.add(cover);
      else {
        // Nothing to show: build the ancestors first (coarse tiles are quick to need but top priority).
        need.push({ n: { level: MAX_LEVEL, ix: Math.floor(n.ix / 2 ** (MAX_LEVEL - n.level)), iz: Math.floor(n.iz / 2 ** (MAX_LEVEL - n.level)) }, dist: -1, covered: false });
      }
    }
    need.sort((p, q) => p.dist - q.dist);
    let built = 0;
    for (const item of need) {
      if (built >= budget) break;
      const key = Terrain.key(item.n.level, item.n.ix, item.n.iz);
      if (this.tiles.has(key)) continue;
      this.build(item.n);
      built++;
    }
    // A built tile is dropped while any of its ancestors is also being shown as a fallback.
    for (const tile of [...show]) {
      let a = tile;
      while (a.level < MAX_LEVEL) {
        a = { level: a.level + 1, ix: Math.floor(a.ix / 2), iz: Math.floor(a.iz / 2) };
        const anc = this.tiles.get(Terrain.key(a.level, a.ix, a.iz));
        if (anc && show.has(anc)) { show.delete(tile); break; }
      }
    }
    // Apply visibility.
    for (const tile of this.visible) if (!show.has(tile)) { tile.mesh.removeFromParent(); this.onTileHidden?.(tile); }
    for (const tile of show) {
      if (!this.visible.has(tile)) { this.group.add(tile.mesh); this.onTileShown?.(tile); }
      tile.lastUsed = this.frame;
    }
    this.visible = show;
    this.#trim();
    this.pendingBuilds = need.filter((x) => !this.tiles.has(Terrain.key(x.n.level, x.n.ix, x.n.iz))).length;
    return this.pendingBuilds;
  }

  #trim() {
    if (this.tiles.size < 420) return;
    for (const [key, tile] of this.tiles) {
      if (this.frame - tile.lastUsed > 900 && !this.visible.has(tile)) {
        this.onTileDisposed?.(tile);
        tile.mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
  }

  /** Build everything near the camera up front (loading screen). */
  async prepare(cam, onProgress = () => {}) {
    let pending = 1;
    let first = 0;
    while (pending > 0) {
      pending = this.update(cam, 6);
      if (!first) first = pending + 1;
      onProgress(1 - pending / first);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.update(cam, 6);
  }
}

export { BASE_SIZE, MAP_HALF };
