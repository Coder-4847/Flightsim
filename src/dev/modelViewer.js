import * as THREE from 'three';
import { AircraftView } from '../aircraft/aircraftView.js';
import { getAircraft } from '../aircraft/index.js';
import { createCockpit } from '../aircraft/cockpit/index.js';
import { FlightModel } from '../flight/flightModel.js';
import { SimWorld } from '../flight/world.js';

// Developer tool (not part of the game build): view one aircraft model in a studio setting.
// /models.html?id=jumbo&yaw=35&pitch=12&dist=1.5&cockpit=1&night=1&gear=0&look=0.3

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
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x4a4f45, night ? 0.25 : 1.1));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x57674a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const model = new FlightModel(spec, new SimWorld());
model.reset({ mode: 'runway' });
if (q.get('gear') === '0') { model.gear.extension = model.gear.target = 0; model.controls.gearDown = false; }
const view = new AircraftView(spec, createCockpit);
scene.add(view.root);
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

const camera = new THREE.PerspectiveCamera(cockpit ? 75 : 40, innerWidth / innerHeight, 0.1, 5000);
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
  if (++frames === 3) document.title = 'ready';
  requestAnimationFrame(frame);
}
frame();
