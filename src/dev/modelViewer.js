import * as THREE from 'three';
import { AircraftView } from '../aircraft/aircraftView.js';
import { getAircraft } from '../aircraft/index.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { FlightModel } from '../flight/flightModel.js';
import { SimWorld } from '../flight/world.js';

// Developer tool (not part of the game build): view one aircraft model in a studio setting.
// /models.html?id=jumbo&yaw=35&pitch=12&dist=1.5&cockpit=1&night=1&gear=0&look=0.3
// Extra parameters: d (absolute camera distance, m), tx/ty/tz (look-at point, body frame), fov, lod (0/1/2 forces a level),
// air=1 (no ground, as in flight), throttle, flaps, aileron/elevator/rudder (-1..1 surface test), w/h (size),
// sun (azimuth deg), rpm=1 (prop at speed), ab=1 (afterburner).

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const spec = getAircraft(q.get('id') ?? 'cessna172');

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const night = num('night', 0);
const air = q.get('air') === '1';
scene.background = new THREE.Color(night ? 0x05070d : 0x9db8d6);
const sunAz = (num('sun', -35) * Math.PI) / 180;
const sun = new THREE.DirectionalLight(night ? 0x9db4ff : 0xfff1d6, night ? 0.5 : 2.6);
sun.position.set(Math.cos(sunAz) * 700, 600, Math.sin(sunAz) * 700);
const hemi = new THREE.HemisphereLight(0xcfe3f5, 0x5d6a52, night ? 0.18 : 1.1);
scene.add(sun, hemi);
// Ground: grass with an asphalt apron under the aircraft.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x4f5a48, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
const apron = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.95 }));
apron.rotation.x = -Math.PI / 2;
apron.position.y = 0.01;
ground.add(apron);
if (!air) scene.add(ground);

const model = new FlightModel(spec, new SimWorld());
model.reset({ mode: 'runway' });
if (q.get('gear') === '0' || air) { model.gear.extension = model.gear.target = 0; model.controls.gearDown = false; }
const view = new AircraftView(spec, createCockpit);
scene.add(view.root);
const cockpit = q.get('cockpit') === '1';
view.setCockpitActive(cockpit);
if (view.setNight) view.setNight(night);
model.controls.lights = !!night;
if (q.has('throttle')) model.controls.throttle.fill(num('throttle', 0));
if (q.has('flaps')) { model.controls.flapsStage = num('flaps', 0); model.surfaces.flap = spec.flaps.stages[model.controls.flapsStage].deg; }
for (let i = 0; i < 30; i++) model.step(1 / 120, true);
if (q.has('aileron')) model.surfaces.aileron = num('aileron', 0) * 0.35;
if (q.has('elevator')) model.surfaces.elevator = num('elevator', 0) * 0.35;
if (q.has('rudder')) model.surfaces.rudder = num('rudder', 0) * 0.4;
if (q.has('brake')) model.surfaces.speedbrake = num('brake', 0);
if (q.get('ab') === '1') for (const e of model.engines) e.afterburner = 1;
if (q.get('rpm') === '1') for (const e of model.engines) { e.spool = 1; e.running = true; }
for (let i = 0; i < 4; i++) view.update(model, 1, 0.06, i * 0.06 + 0.02);
view.root.position.set(0, 0, 0);
view.root.quaternion.identity();
ground.position.y = spec.gear.mainLeft.y;
if (q.has('lod')) {
  view.lod.autoUpdate = false;
  const k = num('lod', 2); // 2 = HIGH
  view.lod.levels.forEach((l, i) => { l.object.visible = i === 2 - k; });
}

const camera = new THREE.PerspectiveCamera(num('fov', cockpit ? 75 : 40), innerWidth / innerHeight, 0.05, 5000);
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
  // yaw 0 = looking at the tail; positive yaw swings toward the right side; 90 = from the right, 180 = from the nose.
  camera.position.set(tx + Math.cos(yaw) * Math.cos(pitch) * -d, ty + Math.sin(pitch) * d, tz + Math.sin(yaw) * Math.cos(pitch) * d);
  camera.lookAt(tx, ty, tz);
}
let frames = 0;
function frame() {
  renderer.render(scene, camera);
  if (++frames === 3) {
    const info = renderer.info;
    window.__info = { calls: info.render.calls, tris: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries };
    document.title = 'ready';
  }
  requestAnimationFrame(frame);
}
frame();
