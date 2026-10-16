import * as THREE from 'three';
import { AirportManager } from '../world/airportBuilder.js';
import { buildMap } from '../world/mapBuilder.js';
import { createMapWorld } from '../world/mapWorld.js';
import { Scenery } from '../world/scenery.js';
import { Terrain } from '../world/terrainTiles.js';
import { createTerrainMaterial } from '../world/terrainMaterial.js';
import { buildZoneTexture, createZones } from '../world/zones.js';
import { Environment } from './environment.js';
import { AirTraffic } from '../traffic/airTraffic.js';
import { Weather } from './weather.js';
import { installAtmosphere } from './atmosphere.js';
import { ShadowRig, enableShadows } from './shadows.js';
import { SkyEnvironment } from './skyEnv.js';

// The 3D world: renderer, camera, environment, and the currently loaded map (terrain and
// everything placed on it). The flight session owns the aircraft and cameras.

const QUALITY_PIXEL_RATIO = { auto: 2, low: 1, medium: 1.5, high: 2 };
const ZERO_WIND = new THREE.Vector3();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class FlightScene {
  constructor(canvas) {
    this.canvas = canvas;
    // A logarithmic depth buffer keeps runway markings and distant terrain free of z-fighting
    // across a 100+ km view distance.
    installAtmosphere();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 160000);
    this.camera.position.set(0, 60, 400);
    this.env = new Environment(this.scene);
    this.weather = new Weather(this.scene, this.env);
    this.shadows = new ShadowRig(this.renderer, this.env);
    this.skyEnv = new SkyEnvironment(this.renderer, this.scene, this.env);
    this.frameCount = 0;
    this.clock = 0;
    this.qualityScale = 0.85;
    this.map = null;
    this.mapId = null;
    this.terrain = null;
    this.built = false;
    this.renderScale = 1;
    this.setQuality('auto');
    this.resize();
  }

  /** Load (or switch to) a map. Reports progress 0..1 with a label. */
  async loadMap(mapId, spawn, onProgress = () => {}) {
    if (this.mapId === mapId && this.built) {
      onProgress(1, 'Ready');
      return;
    }
    this.unloadMap();
    onProgress(0.02, 'Generating terrain');
    await nextFrame();
    const map = buildMap(mapId);
    this.map = map;
    this.mapId = mapId;

    const zones = createZones(map);
    const texture = await buildZoneTexture(map, zones, (f) => onProgress(0.05 + f * 0.3, 'Surveying land use'));
    this.zones = zones;
    this.skyEnv.setBiome(map.cfg.biome);
    this.zoneTextures = texture;
    this.terrainMaterial = createTerrainMaterial(texture, map.cfg.biome, map.cfg.snowLine);
    this.terrain = new Terrain(map, this.terrainMaterial, this.scene);
    this.airports = new AirportManager(this.scene, map, this.env);
    this.scenery = new Scenery(this.scene, map, zones, this.terrain, this.env, { density: this.qualityScale, weather: this.weather });
    this.airTraffic = new AirTraffic(this.scene, map, 8);
    const cam = spawn ?? { x: 0, y: 500, z: 0 };
    await this.terrain.prepare(cam, (f) => onProgress(0.35 + f * 0.4, 'Building terrain'));
    // Trees, roads and buildings around the start point.
    let left = this.scenery.flush(0, cam);
    const total = Math.max(1, left);
    while (left > 0) {
      left = this.scenery.flush(2, cam);
      onProgress(0.75 + (1 - left / total) * 0.2, 'Placing towns and forests');
      await new Promise((r) => setTimeout(r, 0));
    }
    this.airports.update(new THREE.Vector3(cam.x, cam.y, cam.z), new THREE.Vector3());
    this.env.setHour(this.env.hour);
    onProgress(1, 'Ready');
    this.built = true;
    this.mapFrames = 0;
  }

  unloadMap() {
    if (!this.terrain) return;
    this.airports?.dispose();
    this.airports = null;
    this.scenery?.dispose();
    this.scenery = null;
    this.airTraffic?.dispose();
    this.airTraffic = null;
    this.terrain.group.removeFromParent();
    this.terrain.tiles.forEach((t) => t.mesh.geometry.dispose());
    this.terrainMaterial.userData.dispose?.();
    this.terrainMaterial.dispose();
    this.zoneTextures?.zone.dispose();
    this.zoneTextures?.zone2.dispose();
    this.zoneTextures = null;
    this.terrain = null;
    this.map = null;
    this.mapId = null;
    this.built = false;
  }

  setQuality(level) {
    this.quality = level;
    this.shadows?.setQuality(level);
    this.qualityScale = { low: 0.5, medium: 0.75, high: 1, auto: 0.85 }[level] ?? 0.85;
    this.renderScale = 1;
    this.#applyRatio();
  }

  /** Dynamic resolution (Auto quality): scales the pixel ratio between about 0.55 and 1 of its maximum. */
  setRenderScale(scale) {
    if (Math.abs(scale - this.renderScale) < 0.001) return;
    this.renderScale = scale;
    this.#applyRatio();
  }

  #applyRatio() {
    const max = QUALITY_PIXEL_RATIO[this.quality] ?? 1.5;
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(window.devicePixelRatio || 1, max) * (this.renderScale ?? 1)));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Physics world for the loaded map. */
  createPhysicsWorld(weather = 'calm') {
    return createMapWorld(this.map, weather);
  }

  /** Per-frame world update: terrain streaming, environment clock. */
  update(dt, cameraPosition, wind = null, velocity = null) {
    this.clock += dt;
    this.frameCount++;
    this.env.update(dt, cameraPosition);
    this.weather.update(dt, this.camera, velocity ?? ZERO_WIND, wind ?? ZERO_WIND);
    this.terrain?.update(cameraPosition);
    this.airports?.update(cameraPosition, wind ?? ZERO_WIND, dt);
    this.scenery?.update(dt, cameraPosition, wind ?? ZERO_WIND);
    this.airTraffic?.update(dt);
    if (this.terrainMaterial) {
      const u = this.terrainMaterial.userData.uniforms;
      u.uNight.value = this.env.night;
      const pr = this.weather.preset;
      const wetT = pr.precip === 'rain' ? 0.5 + 0.5 * pr.rate : this.weather.presetId === 'fog' ? 0.25 : 0;
      const snowT = pr.precip === 'snow' ? 0.8 : 0;
      const snap = this.mapFrames++ < 40;
      const k = snap ? 1 : 1 - Math.exp(-dt * (wetT > u.uWet.value ? 0.05 : 0.01));
      u.uWet.value += (wetT - u.uWet.value) * k;
      u.uSnowCover.value += (snowT - u.uSnowCover.value) * (snap ? 1 : 1 - Math.exp(-dt * 0.02));
    }
    if (this.map && (this.frameCount & 15) === 1) this.#shadowScan();
    if (this.map) this.shadows.update(this.camera, this.map.hf.height(cameraPosition.x, cameraPosition.z));
    this.skyEnv.update(this.clock);
  }

  /** Flag the meshes of newly built airports, traffic and the aircraft as shadow casters/receivers. */
  #shadowScan() {
    if (this.shadows.size === 0) return;
    const known = new Set([this.terrain?.group, this.scenery?.group, this.airTraffic?.group]);
    for (const g of this.airports?.built.values() ?? []) {
      if (g.userData.shadowScan) continue;
      g.userData.shadowScan = true;
      enableShadows(g, { cast: true, receive: true });
    }
    if (this.airTraffic?.group && !this.airTraffic.group.userData.shadowScan) { this.airTraffic.group.userData.shadowScan = true; enableShadows(this.airTraffic.group, { cast: true, receive: false }); }
    for (const c of this.scene.children) {
      if (!c.isGroup || known.has(c) || c.userData.shadowScan || c.userData.airport) continue;
      c.userData.shadowScan = true;
      enableShadows(c, { cast: true, receive: false });
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
