import * as THREE from 'three';
import { buildMap } from '../../mapBuilder.js';
import { Environment } from '../../../scene/environment.js';
import { AirportManager } from '../../airportBuilder.js';

// Developer-only airport viewer (not part of the build): /src/world/airport/dev/viewer.html
// Loads the airport data of a map without terrain, puts it on a flat plane, and exposes window.view().

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 160000);
const env = new Environment(scene);
env.setHour(Number(q.get('hour') ?? 14));
env.timeScale = 0;

const mapId = q.get('map') ?? 'grasslands';
const map = buildMap(mapId);
const biome = map.cfg.biome;
const groundColor = { grass: 0x4d6e2b, desert: 0xc19a62, snow: 0xe6edf4 }[biome];
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 240, 240).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }));
scene.add(ground);

// planes and airports that the viewer needs sit at their world positions; the ground follows the airport elevation
const manager = new AirportManager(scene, map, env);
let current = null;

window.show = (code) => {
  current = map.airports.find((a) => a.code === code) ?? map.airports.find((a) => a.cls === code) ?? map.airports[0];
  ground.position.set(current.x, current.elevation - 0.02, current.z);
  return current.code;
};

/** Place the camera in the airport frame (along, perp, height) looking at (lalong, lperp, lalt). */
window.view = (v) => {
  const a = current;
  const h = a.runways[0].heading * Math.PI / 180;
  const d = { x: Math.sin(h), z: -Math.cos(h) }; const side = { x: -d.z, z: d.x };
  const P = (al, pe, alt) => new THREE.Vector3(a.x + d.x * al + side.x * pe, a.elevation + alt, a.z + d.z * al + side.z * pe);
  camera.position.copy(P(v.along, v.perp, v.alt));
  camera.lookAt(P(v.lalong ?? 0, v.lperp ?? 0, v.lalt ?? 0));
  camera.fov = v.fov ?? 60; camera.near = v.near ?? 0.5; camera.updateProjectionMatrix();
  if (v.hour != null) env.setHour(v.hour);
  // build everything near the camera, then render twice (shaders compile on the first)
  for (let i = 0; i < 4; i++) manager.update(camera.position, new THREE.Vector3(v.wx ?? 0, 0, v.wz ?? 0), camera, renderer);
  env.update(0, camera.position);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  const info = renderer.info;
  return { calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, tex: info.memory.textures };
};

window.show(q.get('airport') ?? 'hub');
window.__THREE = THREE;
window.__viewer = { scene, camera, renderer, manager, env, map, get current() { return current; } };
if (q.get('along') != null) {
  window.view({
    along: Number(q.get('along')), perp: Number(q.get('perp') ?? 0), alt: Number(q.get('alt') ?? 100),
    lalong: Number(q.get('lalong') ?? 0), lperp: Number(q.get('lperp') ?? 0), lalt: Number(q.get('lalt') ?? 0), fov: Number(q.get('fov') ?? 60),
  });
}
