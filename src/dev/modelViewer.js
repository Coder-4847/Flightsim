import * as THREE from 'three';
import { AircraftView } from '../aircraft/aircraftView.js';
import { getAircraft } from '../aircraft/index.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { FlightModel } from '../flight/flightModel.js';
import { SimWorld } from '../flight/world.js';

// Developer tool (not part of the game build): view one aircraft model in a studio setting.
// /models.html?id=jumbo&yaw=35&pitch=12&dist=1.5&cockpit=1&night=1&gear=0&look=0.3
// More: d=<metres> tx/ty/tz=<look-at point> fov=<deg> lod=0|1|2 (force LOW/MEDIUM/HIGH) flaps=<stage> sun=<azimuth deg>

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const spec = getAircraft(q.get('id') ?? 'cessna172');

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const night = num('night', 0);
scene.background = new THREE.Color(night ? 0x05070d : 0x9db8d6);
const sun = new THREE.DirectionalLight(0xfff1d8, night ? 0.3 : 3.0);
sun.position.set(-40, 70, 30);
if (q.has('sun')) { const a = (num('sun', 0) * Math.PI) / 180; sun.position.set(Math.cos(a) * 60, 55, Math.sin(a) * 60); }
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x4a4f45, night ? 0.25 : 1.1));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x57674a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const model = new FlightModel(spec, new SimWorld());
model.reset({ mode: 'runway' });
if (q.get('gear') === '0') { model.gear.extension = model.gear.target = 0; model.controls.gearDown = false; }
const t0 = performance.now();
const view = new AircraftView(spec, createCockpit);
const buildMs = Math.round(performance.now() - t0);
scene.add(view.root);
if (q.has('lod')) {
  const want = 2 - num('lod', 2); // lod=2 -> HIGH (levels[0])
  view.lod.autoUpdate = false;
  view.lod.levels.forEach((l, i) => { l.object.visible = i === want; });
}
ground.position.y = view.root.position.y; // set after first update
const cockpit = q.get('cockpit') === '1';
view.setCockpitActive(cockpit);
if (view.setNight) view.setNight(night);
if (q.has('throttle')) model.controls.throttle.fill(num('throttle', 0));
if (q.has('flaps')) { model.controls.flapsStage = num('flaps', 0); model.surfaces.flap = spec.flaps.stages[model.controls.flapsStage].deg; }
for (let i = 0; i < 30; i++) model.step(1 / 120, true);
for (let i = 0; i < 4; i++) view.update(model, 1, 0.06, i * 0.06);
view.root.position.set(0, 0, 0);
view.root.quaternion.identity();
ground.position.y = -(spec.gear.mainLeft.y - 0.0) * -1; // ground sits at the gear contact height
ground.position.y = spec.gear.mainLeft.y;

const camera = new THREE.PerspectiveCamera(cockpit ? 75 : num('fov', 40), innerWidth / innerHeight, 0.1, 5000);
if (cockpit) {
  const e = view.cockpit.eye;
  camera.position.copy(e);
  const look = num('look', 0);
  camera.lookAt(e.x + Math.cos(look), e.y - 0.05 + num('lookUp', 0), e.z + Math.sin(look));
} else {
  const d = q.has('d') ? num('d', 10) : view.chaseDistance * num('dist', 1) * 0.9;
  const yaw = (num('yaw', 35) * Math.PI) / 180;
  const pitch = (num('pitch', 12) * Math.PI) / 180;
  const [tx, ty, tz] = [num('tx', 0), num('ty', 0), num('tz', 0)];
  // yaw 0 = looking at the tail; positive yaw swings toward the right side.
  camera.position.set(tx + Math.cos(yaw) * Math.cos(pitch) * -d, ty + Math.sin(pitch) * d + 1, tz + Math.sin(yaw) * Math.cos(pitch) * d);
  camera.lookAt(tx, ty, tz);
}
let frames = 0;
function frame() {
  renderer.render(scene, camera);
  if (frames === 2) {
    let tris = 0;
    let meshes = 0;
    view.lod.levels.forEach((l) => { if (!l.object.visible) return; l.object.traverse((o) => { if (o.isMesh && o.visible) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } }); });
    const list = [];
    view.lod.levels.forEach((l) => { if (!l.object.visible) return; l.object.traverse((o) => { if (o.isMesh && o.visible) list.push([o.name || o.parent?.name || '?', (o.material?.name ?? '') , Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3)]); }); });
    list.sort((a, b) => b[2] - a[2]);
    window.__top = list.slice(0, 14);
    window.__info = { buildMs, calls: renderer.info.render.calls, tris: Math.round(renderer.info.render.triangles), sceneTris: Math.round(tris), meshes };
  }
  if (++frames === 3) document.title = 'ready';
  requestAnimationFrame(frame);
}
frame();
