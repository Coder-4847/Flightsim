import * as THREE from 'three';
import { AircraftView, HIGH, MEDIUM } from '../../aircraft/aircraftView.js';
import { getEnvMap } from '../../aircraft/models/skins.js';
import { disposeObject } from '../../aircraft/dispose.js';
import { AIRCRAFT } from '../../aircraft/index.js';
import { FlightModel } from '../../flight/flightModel.js';
import { SimWorld } from '../../flight/world.js';
import { specWithLivery } from '../../progress/catalog.js';
import { mulberry32 } from '../../util/random.js';
import { enableShadows } from '../../scene/shadows.js';
import { bayDecal, floorTexture, glowTexture, windowWallTexture } from './textures.js';

// The showroom hangar: every aircraft parked in its own bay along one very long hall, the camera
// gliding from bay to bay. Only the selected aircraft and its neighbours exist as 3D models at any
// time (a model costs 100 ms to a second to build the first time), the others are floor markings
// until the camera gets near.

const GAP = 22;
const WINDOW = 2; // models kept on each side of the selected one
const CLASS_TINT = { 'Light prop': '#7ee0a8', Turboprop: '#7ee0a8', 'Jet trainer': '#ffcf6b', 'Business jet': '#8fb6ff', Airliner: '#3cc0ff', Fighter: '#ff7a8a' };

export function createHangarScene({ renderer, reduceMotion, liveryFor, quality = () => 'high' }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060b16);
  scene.fog = new THREE.FogExp2(0x070d1a, 0.0016);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 2500);
  const env = getEnvMap();

  // ---- layout ----
  const items = AIRCRAFT.map((spec) => ({ spec, size: Math.max(spec.wing.span, spec.geometry.length), x: 0, view: null, model: null, loading: false, livery: null }));
  let cursor = 0;
  items.forEach((it, i) => {
    const r = it.size * 0.5;
    cursor += i === 0 ? 0 : items[i - 1].size * 0.5 + GAP + r;
    it.x = cursor;
  });
  const rowEnd = items[items.length - 1].x;
  const hallStart = -items[0].size - 420;
  const hallEnd = rowEnd + items[items.length - 1].size + 420;
  const hallLen = hallEnd - hallStart;
  const hallMid = (hallStart + hallEnd) / 2;

  // ---- the hall ----
  const floorTex = floorTexture();
  floorTex.repeat.set(hallLen / 28, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, 400), new THREE.MeshStandardMaterial({
    map: floorTex, color: 0xb8c4d6, roughness: 0.38, metalness: 0.2, envMap: env, envMapIntensity: 0.35,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(hallMid, 0, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  const wallTex = windowWallTexture();
  wallTex.repeat.set(hallLen / 160, 1);
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, 70), new THREE.MeshBasicMaterial({ map: wallTex, fog: false, toneMapped: false }));
  windows.position.set(hallMid, 35, -190);
  scene.add(windows);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.8, metalness: 0.3 });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, 70), darkMat);
  front.position.set(hallMid, 35, 190);
  front.rotation.y = Math.PI;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, 400), new THREE.MeshStandardMaterial({ color: 0x080d18, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(hallMid, 60, 0);
  scene.add(front, ceiling);
  for (const sx of [hallStart, hallEnd]) {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(400, 70), darkMat);
    end.position.set(sx, 35, 0);
    end.rotation.y = sx === hallStart ? Math.PI / 2 : -Math.PI / 2;
    scene.add(end);
  }
  // Trusses and light strips.
  const trussCount = Math.floor(hallLen / 26);
  const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1.6, 400), new THREE.MeshStandardMaterial({ color: 0x131c2e, roughness: 0.6, metalness: 0.6 }), trussCount);
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(14, 0.4, 0.9), new THREE.MeshBasicMaterial({ color: 0xdceaff, fog: false, toneMapped: false }), trussCount * 4);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < trussCount; i++) {
    const x = hallStart + 13 + i * 26;
    m4.makeTranslation(x, 57, 0); truss.setMatrixAt(i, m4);
    [-110, -40, 40, 110].forEach((z, j) => { m4.makeTranslation(x, 56, z); strips.setMatrixAt(i * 4 + j, m4); });
  }
  scene.add(truss, strips);
  // Glowing guide line along the back of the bays.
  const guide = new THREE.Mesh(new THREE.PlaneGeometry(hallLen, 0.5), new THREE.MeshBasicMaterial({ color: 0x3cc0ff, transparent: true, opacity: 0.55, fog: false }));
  guide.rotation.x = -Math.PI / 2;
  guide.position.set(hallMid, 0.03, -62);
  scene.add(guide);

  // ---- bays ----
  const glowTex = glowTexture('rgba(120,200,255,0.9)', 'rgba(60,150,255,0.25)');
  for (const it of items) {
    const r = it.size * 0.5;
    const tint = CLASS_TINT[it.spec.class] ?? '#3cc0ff';
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.96, r * 0.985, 120), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint), transparent: true, opacity: 0.55, fog: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(it.x, 0.04, 0);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r * 1.12, 64), new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(tint), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(it.x, 0.035, 0);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.5, r * 0.375), new THREE.MeshBasicMaterial({ map: bayDecal(it.spec.name, it.spec.class, tint), transparent: true, depthWrite: false, fog: false }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(it.x - r * 0.22, 0.05, r * 1.04 + 3);
    scene.add(ring, pad, label);
    it.ring = ring; it.pad = pad;
  }

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0x7f9ccc, 0x151b2a, 0.75));
  const fillLight = new THREE.DirectionalLight(0xb5cdf5, 0.9);
  fillLight.position.set(-60, 90, 120);
  scene.add(fillLight, fillLight.target);
  const spot = new THREE.SpotLight(0xfff0dc, 11000, 0, 0.5, 0.75, 2);
  spot.position.set(0, 52, 22);
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.camera.near = 15; spot.shadow.camera.far = 140;
  spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.2; spot.shadow.radius = 3;
  scene.add(spot, spot.target);
  const rimA = new THREE.PointLight(0x3cc0ff, 1500, 0, 2);
  const rimB = new THREE.PointLight(0xff9a6a, 1100, 0, 2);
  scene.add(rimA, rimB);

  // Dust motes drifting through the light.
  const dustN = 260;
  const dustPos = new Float32Array(dustN * 3);
  const dustRnd = mulberry32(99);
  for (let i = 0; i < dustN; i++) { dustPos[i * 3] = (dustRnd() - 0.5) * 120; dustPos[i * 3 + 1] = 2 + dustRnd() * 40; dustPos[i * 3 + 2] = (dustRnd() - 0.5) * 120; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.2)'), size: 0.9, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  scene.add(dust);

  // ---- state ----
  const state = {
    index: Math.max(0, items.findIndex((i) => i.spec.id === 'cessna172')), x: 0, dist: 40, theta: -0.55, phi: 0.2,
    idle: 0, dragging: false, framing: 'browse', shift: 0, tx: 0, tdist: 40, lookY: 4, lastW: 1, lastH: 1,
  };
  let onLoad = null;
  const queue = [];
  const yawFor = () => -Math.PI / 2 + 0.42;

  const targetDist = (it) => it.size * 1.85 + 9;
  function syncTargets(instant) {
    const it = items[state.index];
    state.tx = it.x;
    state.tdist = targetDist(it) * (state.framing === 'setup' ? 1.18 : 1);
    if (instant) { state.x = state.tx; state.dist = state.tdist; }
  }

  function removeView(it) {
    if (!it.view) return;
    scene.remove(it.view.root);
    disposeObject(it.view.root);
    it.view = null; it.model = null;
  }

  function buildView(it) {
    const livery = liveryFor?.(it.spec.id) ?? 'factory';
    const spec = specWithLivery(it.spec.id, livery);
    const near = Math.abs(items.indexOf(it) - state.index) <= 1;
    const view = new AircraftView(spec, null, { detail: near ? HIGH : MEDIUM });
    view.root.position.set(it.x, -spec.gear.mainLeft.y + 0.02, 0);
    view.root.rotation.y = yawFor();
    scene.add(view.root);
    it.view = view; it.livery = livery; it.detail = near ? HIGH : MEDIUM;
    it.model = null;
    if (it === items[state.index]) activate(it);
  }

  /** The selected aircraft gets a parked flight model (lights, gear compression, control surfaces) and casts the spotlight shadow. */
  function activate(it) {
    if (!it.view) return;
    if (!it.model) {
      const spec = it.view.spec;
      it.model = new FlightModel(spec, new SimWorld());
      it.model.controls.lights = true;
    }
    if (quality() !== 'low') enableShadows(it.view.root, { cast: true, receive: false });
  }
  function deactivate(it) {
    if (!it?.view) return;
    it.view.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    for (const m of [it.view.root]) m.traverse((o) => { if (o.userData) o.userData.shadowSet = false; });
  }

  function pump() {
    // Build one model per call, nearest first; drop the ones far from the selection.
    for (const it of items) if (it.view && Math.abs(items.indexOf(it) - state.index) > WINDOW) removeView(it);
    for (const it of items) {
      if (!it.view) continue;
      const near = Math.abs(items.indexOf(it) - state.index) <= 1;
      if (near && it.detail !== HIGH) { removeView(it); }
    }
    const want = [];
    for (let d = 0; d <= WINDOW; d++) for (const s of d === 0 ? [0] : [1, -1]) {
      const i = state.index + s * d;
      if (i >= 0 && i < items.length && !items[i].view) want.push(i);
    }
    if (!want.length) return false;
    buildView(items[want[0]]);
    onLoad?.(want[0]);
    return want.length > 1;
  }
  let pumpTimer = 0;
  function schedule(delay = 30) {
    clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => { if (pump()) schedule(60); }, delay);
  }

  let ghostSprites = 0;
  void ghostSprites; void queue;

  const tmp = new THREE.Vector3();
  let t = 0;
  return {
    scene, camera, kind: 'hangar', items,
    get index() { return state.index; },
    get framing() { return state.framing; },
    get ready() { return !!items[state.index].view; },
    onLoad(fn) { onLoad = fn; },
    select(i, { instant = false } = {}) {
      const next = Math.max(0, Math.min(items.length - 1, i));
      if (next !== state.index) { deactivate(items[state.index]); state.index = next; }
      syncTargets(instant || reduceMotion());
      if (items[state.index].view) activate(items[state.index]);
      schedule(instant ? 0 : 160);
    },
    step(n) { this.select(state.index + n); },
    /** 'browse' orbits the selected aircraft in the middle of the screen, 'setup' moves it left to make room for the options. */
    setFraming(f) { state.framing = f; syncTargets(false); },
    setLivery(id) {
      const it = items.find((x) => x.spec.id === id);
      if (!it?.view) return;
      const was = it === items[state.index];
      removeView(it);
      buildView(it);
      if (was) activate(it);
    },
    orbit(dx, dy) { state.theta -= dx * 0.006; state.phi = Math.max(0.02, Math.min(1.1, state.phi + dy * 0.004)); state.idle = 0; },
    zoom(delta) { state.zoom = Math.max(0.55, Math.min(1.7, (state.zoom ?? 1) * Math.exp(delta * 0.001))); state.idle = 0; },
    setDragging(on) { state.dragging = on; state.idle = 0; },
    warm() { schedule(0); },
    update(dt, w, h) {
      t += dt;
      state.idle += dt;
      const k = reduceMotion() ? 1 : 1 - Math.exp(-dt * 4.2);
      state.x += (state.tx - state.x) * k;
      state.dist += (state.tdist - state.dist) * k;
      const sel = items[state.index];
      if (!state.dragging && !reduceMotion() && state.idle > 1.5) state.theta += dt * (state.framing === 'setup' ? 0.16 : 0.1);
      const aspect = w / h;
      const dist = state.dist * (state.zoom ?? 1) * Math.min(2.4, Math.max(1, 1.5 / aspect)); // portrait screens need the camera further back
      const lookY = sel.size * 0.1 + 1.5;
      tmp.set(state.x, lookY, 0);
      camera.position.set(tmp.x + Math.sin(state.theta) * Math.cos(state.phi) * dist, lookY + Math.sin(state.phi) * dist + 1, Math.cos(state.theta) * Math.cos(state.phi) * dist);
      camera.lookAt(tmp);
      camera.aspect = w / h;
      camera.clearViewOffset();
      const shift = state.framing === 'setup' ? (w > 900 ? -0.2 : 0) : (w > 900 ? 0.02 : 0);
      if (shift) camera.setViewOffset(w, h, -w * shift, 0, w, h);
      camera.updateProjectionMatrix();
      // Lights follow the selection.
      spot.position.set(state.x + 6, 54, 24);
      spot.target.position.set(state.x, 2, 0);
      spot.angle = Math.min(0.9, Math.atan((sel.size * 0.75) / 52) + 0.08);
      spot.castShadow = quality() !== 'low';
      rimA.position.set(state.x - sel.size * 0.8 - 14, 16, -sel.size * 0.7 - 24);
      rimB.position.set(state.x + sel.size * 0.85 + 14, 14, -sel.size * 0.75 - 28);
      fillLight.position.set(state.x - 50, 90, 120);
      fillLight.target.position.set(state.x, 0, 0);
      dust.position.x = state.x;
      dust.position.y = Math.sin(t * 0.15) * 1.2;
      dust.rotation.y = t * 0.01;
      // Rings pulse on the selected bay.
      for (const it of items) {
        const on = it === sel;
        it.ring.material.opacity += ((on ? 0.95 : 0.28) - it.ring.material.opacity) * 0.1;
        it.pad.material.opacity += ((on ? 0.34 : 0.1) - it.pad.material.opacity) * 0.1;
      }
      // Animate the selected aircraft (strobes, beacon, gear) from its parked model.
      if (sel.view && sel.model) {
        const px = sel.view.root.position.x; const py = sel.view.root.position.y;
        sel.view.update(sel.model, 1, dt, t);
        sel.view.root.position.set(px, py, 0);
        sel.view.root.rotation.set(0, yawFor(), 0);
      }
    },
    dispose() {
      clearTimeout(pumpTimer);
      for (const it of items) removeView(it);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    },
  };
}
