import * as THREE from 'three';
import { buildCityTile, buildSkyline, buildingMaterial } from './buildings.js';
import { buildLandmarks, buildNavaids } from './landmarks.js';
import { buildRoads } from './roads.js';
import { TreeBatch, addVegetation, treeMaterial } from './vegetation.js';
import { makeClearance } from './placement.js';
import { buildWater } from './water.js';
import { enableShadows } from '../scene/shadows.js';

// Owns everything placed on the terrain: per-tile decoration (trees, buildings, roads) built on
// demand as tiles come into view, plus static map-wide objects (water, skyline, landmarks, navaids).

const DECOR_MAX_LEVEL = 1; // tiles up to 4 km get trees, buildings and roads

export class Scenery {
  constructor(scene, map, zones, terrain, env, opts = {}) {
    this.density = opts.density ?? 1;
    this.weather = opts.weather ?? null;
    this.clear = makeClearance(map);
    this.scene = scene;
    this.map = map;
    this.zones = zones;
    this.terrain = terrain;
    this.env = env;
    this.queue = [];
    this.time = 0;
    this.frame = 0;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.water = buildWater(map);
    this.group.add(this.water.group);
    this.landmarks = buildLandmarks(map);
    this.group.add(this.landmarks.group);
    this.navaids = buildNavaids(map);
    this.group.add(this.navaids.group);
    this.skylines = [];
    for (const city of map.cities.filter((c) => c.kind !== 'village')) {
      const sky = buildSkyline(map, zones, city);
      if (sky) { this.group.add(sky); this.skylines.push(sky); }
    }
    this.masts = [...this.landmarks.masts, ...this.navaids.masts];

    terrain.onTileShown = (tile) => this.#shown(tile);
    terrain.onTileHidden = (tile) => this.#hidden(tile);
    terrain.onTileDisposed = (tile) => this.#disposed(tile);
  }

  #shown(tile) {
    if (tile.level > DECOR_MAX_LEVEL) return;
    if (tile.decor) { this.scene.add(tile.decor); return; }
    if (!tile.queued) { tile.queued = true; this.queue.push(tile); }
  }

  #hidden(tile) {
    if (tile.decor) tile.decor.removeFromParent();
  }

  #disposed(tile) {
    if (!tile.decor) return;
    tile.decor.removeFromParent();
    tile.decor.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry && o.geometry !== undefined && !o.isInstancedMesh && o.userData.ownGeometry !== false) o.geometry.dispose(); });
    tile.decor = null;
  }

  #buildDecor(tile) {
    const g = new THREE.Group();
    const batch = new TreeBatch(tile, Math.round(1800 * this.density));
    const parts = [];
    parts.push(buildCityTile(tile, this.map, this.zones, batch, this.clear));
    addVegetation(batch, tile, this.map, this.zones, this.clear, this.density);
    parts.push(batch.finish());
    parts.push(buildRoads(tile, this.map));
    for (const p of parts) if (p) g.add(p);
    enableShadows(g, { cast: true, receive: true, skip: (o) => o.userData.noShadow });
    tile.decor = g;
    tile.queued = false;
    if (this.terrain.visible.has(tile)) this.scene.add(g);
  }

  /** Build queued decorations (nearest tiles first). `max` limits the work per frame. */
  flush(max = 1, cam = null) {
    if (cam && this.queue.length > 1) {
      this.queue.sort((a, b) => Math.hypot(a.cx - cam.x, a.cz - cam.z) - Math.hypot(b.cx - cam.x, b.cz - cam.z));
    }
    for (let i = 0; i < max && this.queue.length; i++) {
      const tile = this.queue.shift();
      if (!this.terrain.tiles.has(tile.key)) { tile.queued = false; continue; }
      this.#buildDecor(tile);
    }
    return this.queue.length;
  }

  /** Distance gating: trees switch level of detail, houses and buildings only draw near the camera. */
  #gate(cam) {
    for (const tile of this.terrain.visible) {
      if (!tile.decor) continue;
      const d = Math.max(0, Math.hypot(tile.cx - cam.x, tile.cz - cam.z) - tile.size * 0.6);
      const lvl0 = tile.level === 0;
      for (const child of tile.decor.children) {
        const kind = child.userData.kind;
        if (kind === 'trees') {
          const far = lvl0 ? 5200 : 9000;
          const thin = d < 2600 ? 1 : d < 4000 ? 0.55 : 0.32;
          child.visible = d < far;
          for (const set of child.userData.sets) {
            set.near.visible = d < 650;
            set.mid.visible = d >= 650 && d < far;
            set.mid.count = Math.max(1, Math.floor(set.n * thin));
          }
        } else if (kind === 'buildings') {
          child.visible = d < (lvl0 ? 9000 : 14000);
          for (const m of child.children) m.visible = m.userData.btype === 'gable' ? d < 2800 : true;
        }
      }
    }
  }

  update(dt, cam, wind) {
    this.time += dt;
    this.flush(1, cam);
    if ((this.frame++ & 7) === 0) this.#gate(cam);
    const pr = this.weather?.preset;
    this.water.update(this.time, this.env, pr?.precip === 'rain' ? pr.rate : 0, Math.hypot(wind.x, wind.z));
    const night = this.env.night;
    buildingMaterial().userData.uniforms.uNight.value = night;
    const cover = this.terrain.material.userData.uniforms?.uSnowCover.value ?? 0;
    buildingMaterial().userData.uniforms.uSnow.value = Math.max(this.map.cfg.biome === 'snow' ? 0.8 : 0, cover);
    // Landmark animation: turbines turn with the wind, masts blink at dusk and night.
    const speed = Math.hypot(wind.x, wind.z);
    const omega = 0.4 + Math.min(speed, 15) * 0.22;
    for (const t of this.landmarks.turbines) {
      const near = (t.position.x - cam.x) ** 2 + (t.position.z - cam.z) ** 2 < 25e6;
      if (near) t.userData.rotor.rotation.x += omega * dt;
    }
    const blink = Math.sin(this.time * 4) > 0.2 ? 1 : 0.15;
    for (const m of this.masts) m.userData.blink.material.color.setRGB(blink, 0.12 * blink, 0.12 * blink);
  }

  dispose() {
    this.scene.remove(this.group);
    this.water.dispose();
    this.group.traverse((o) => { o.geometry?.dispose?.(); });
    for (const tile of this.terrain.tiles.values()) this.#disposed(tile);
  }
}
