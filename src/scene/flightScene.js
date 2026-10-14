import * as THREE from 'three';
import { AirportManager } from '../world/airportBuilder.js';
import { buildMap } from '../world/mapBuilder.js';
import { createMapWorld } from '../world/mapWorld.js';
import { Terrain } from '../world/terrainTiles.js';
import { createTerrainMaterial } from '../world/terrainMaterial.js';
import { buildZoneTexture, createZones } from '../world/zones.js';
import { Environment } from './environment.js';

// The 3D world: renderer, camera, environment, and the currently loaded map (terrain and
// everything placed on it). The flight session owns the aircraft and cameras.

const QUALITY_PIXEL_RATIO = { low: 1, medium: 1.5, high: 2 };
const ZERO_WIND = new THREE.Vector3();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class FlightScene {
  constructor(canvas) {
    this.canvas = canvas;
    // A logarithmic depth buffer keeps runway markings and distant terrain free of z-fighting
    // across a 100+ km view distance.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 160000);
    this.camera.position.set(0, 60, 400);
    this.env = new Environment(this.scene);
    this.map = null;
    this.mapId = null;
    this.terrain = null;
    this.built = false;
    this.setQuality('medium');
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
    this.terrainMaterial = createTerrainMaterial(texture, map.cfg.biome, map.cfg.snowLine);
    this.terrain = new Terrain(map, this.terrainMaterial, this.scene);
    this.airports = new AirportManager(this.scene, map, this.env);
    const cam = spawn ?? { x: 0, y: 500, z: 0 };
    await this.terrain.prepare(cam, (f) => onProgress(0.35 + f * 0.55, 'Building terrain'));
    this.airports.update(new THREE.Vector3(cam.x, cam.y, cam.z), new THREE.Vector3());
    this.env.setHour(this.env.hour);
    onProgress(1, 'Ready');
    this.built = true;
  }

  unloadMap() {
    if (!this.terrain) return;
    this.airports?.dispose();
    this.airports = null;
    this.terrain.group.removeFromParent();
    this.terrain.tiles.forEach((t) => t.mesh.geometry.dispose());
    this.terrainMaterial.dispose();
    this.terrain = null;
    this.map = null;
    this.mapId = null;
    this.built = false;
  }

  setQuality(level) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PIXEL_RATIO[level] ?? 1.5));
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
  update(dt, cameraPosition, wind = null) {
    this.env.update(dt, cameraPosition);
    this.terrain?.update(cameraPosition);
    this.airports?.update(cameraPosition, wind ?? ZERO_WIND);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
