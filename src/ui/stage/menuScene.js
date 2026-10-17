import * as THREE from 'three';
import { AircraftView, HIGH } from '../../aircraft/aircraftView.js';
import { disposeObject } from '../../aircraft/dispose.js';
import { AIRCRAFT } from '../../aircraft/index.js';
import { FlightModel } from '../../flight/flightModel.js';
import { SimWorld } from '../../flight/world.js';
import { specWithLivery } from '../../progress/catalog.js';
import { mulberry32 } from '../../util/random.js';
import { cloudTextures, glowTexture } from './textures.js';

// The main-menu backdrop: an aircraft in golden-hour light above a sea of clouds. A hero aircraft
// flies in, holds in front of the camera, and leaves while the next one arrives. The camera stays
// put; the aircraft does all the moving.

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }`;
const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSun;
  void main() {
    float h = clamp(vDir.y, -0.2, 1.0);
    vec3 zenith = vec3(0.035, 0.075, 0.2);
    vec3 mid = vec3(0.17, 0.30, 0.58);
    vec3 low = vec3(0.95, 0.55, 0.42);
    vec3 horizon = vec3(1.0, 0.78, 0.55);
    vec3 col = mix(horizon, low, smoothstep(0.0, 0.10, h));
    col = mix(col, mid, smoothstep(0.06, 0.34, h));
    col = mix(col, zenith, smoothstep(0.30, 0.95, h));
    float s = max(dot(normalize(vDir), uSun), 0.0);
    col += vec3(1.0, 0.6, 0.3) * pow(s, 6.0) * 0.55 + vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.9;
    col = mix(col, vec3(0.30, 0.20, 0.30), smoothstep(0.0, -0.2, vDir.y) * 0.8);
    gl_FragColor = vec4(col, 1.0);
  }`;

const HERO_ORDER = ['hornet', 'cessna172', 'kingair', 'heavyfighter', 'turboprop72', 'fighter', 'caravan', 'trainer', 'narrowbody', 'citation', 'jumbo', 'bizjet', 'regional', 'widebody'];

export function createMenuScene({ renderer, reduceMotion }) {
  const scene = new THREE.Scene();
  const FOG = new THREE.Color(0xc98a7e);
  scene.fog = new THREE.FogExp2(FOG, 0.00011);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 1, 30000);

  // ---- sky and sun ----
  const sunDir = new THREE.Vector3(0.5, 0.17, -0.85).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uSun: { value: sunDir } }, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  const glow = glowTexture('rgba(255,244,220,1)', 'rgba(255,190,120,0.35)');
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sun.position.copy(sunDir).multiplyScalar(15000);
  sun.scale.setScalar(6500);
  scene.add(sun);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff9a5a, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.5 }));
  flare.position.copy(sunDir).multiplyScalar(14000);
  flare.scale.setScalar(16000);
  scene.add(flare);

  const key = new THREE.DirectionalLight(0xffc48f, 4.2);
  key.position.copy(sunDir).multiplyScalar(500);
  const fill = new THREE.DirectionalLight(0x8fb6ff, 1.1);
  fill.position.set(-300, 120, 400);
  const bounce = new THREE.DirectionalLight(0xffa77a, 1.8); // light bouncing up off the cloud tops
  bounce.position.set(60, -300, 200);
  scene.add(key, fill, bounce, new THREE.HemisphereLight(0xa9c0ff, 0xffa878, 1.5));

  // ---- cloud sea ----
  // A dark base far below shows through the gaps between the puffs, which is what gives the cloud sea its relief.
  const base = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshBasicMaterial({ color: 0x3b3566, fog: true }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -520;
  scene.add(base);
  const clouds = new THREE.Group();
  scene.add(clouds);
  const puffs = cloudTextures();
  const rnd = mulberry32(777);
  const layers = [];
  const addCloud = (x, y, z, size, tint, opacity, speed) => {
    const mat = new THREE.SpriteMaterial({ map: puffs[Math.floor(rnd() * puffs.length)], color: tint, transparent: true, opacity, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.position.set(x, y, z);
    s.scale.set(size, size * 0.6, 1);
    clouds.add(s);
    layers.push({ s, speed });
  };
  const cool = new THREE.Color(0x9fb0e0);
  const warm = new THREE.Color(0xffd2b0);
  const tmpC = new THREE.Color();
  const sunFlat = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
  for (let i = 0; i < 230; i++) {
    const z = -rnd() * 9000 + 500;
    const x = (rnd() - 0.5) * 13000 * (0.3 + (-z) / 9000);
    const near = 1 - Math.min(1, -z / 9000);
    const y = -190 - rnd() * 110 - (1 - near) * 40;
    const size = 300 + rnd() * 700 + (1 - near) * 700;
    // Clouds toward the sun catch its warm light; the ones near the camera sit in cool shadow.
    const toSun = Math.max(0, (new THREE.Vector2(x, z - 300).normalize().dot(sunFlat) + 0.15) / 1.15);
    tmpC.copy(cool).lerp(warm, Math.min(1, toSun ** 1.2 * 0.95 + (1 - near) * 0.2));
    tmpC.multiplyScalar(1.05 + rnd() * 0.35);
    addCloud(x, y, z, size, tmpC.clone(), 0.9, 6 + rnd() * 5);
  }
  // Near field: distinct cumulus tops with gaps between them, so the cloud sea has relief instead of reading as haze.
  for (let i = 0; i < 120; i++) {
    const z = -300 - rnd() * 3200;
    const x = (rnd() - 0.5) * 5200;
    const y = -150 - rnd() * 100 + Math.sin(x * 0.0021 + z * 0.0017) * 45;
    const size = 260 + rnd() * 620;
    const toSun = Math.max(0, (new THREE.Vector2(x, z - 300).normalize().dot(sunFlat) + 0.2) / 1.2);
    tmpC.copy(cool).lerp(warm, Math.min(1, toSun * 0.8 + 0.1)).multiplyScalar(1.0 + rnd() * 0.3);
    addCloud(x, y, z, size, tmpC.clone(), 1, 8 + rnd() * 6);
  }
  // A few tall banks on the horizon and wisps above the aircraft.
  for (let i = 0; i < 26; i++) addCloud((rnd() - 0.5) * 20000, -100 + rnd() * 380, -7000 - rnd() * 8000, 2400 + rnd() * 3400, new THREE.Color(0xe79a8c), 0.55, 3);
  for (let i = 0; i < 14; i++) addCloud((rnd() - 0.5) * 6000, 300 + rnd() * 700, -1200 - rnd() * 4500, 700 + rnd() * 900, new THREE.Color(0xe8a48e), 0.22, 8);
  // Distant mountain ridges poking through the cloud tops (flat jagged silhouettes, softened by the fog).
  function ridge(z, color, amp, base, seed, opacity = 1) {
    const r = mulberry32(seed);
    const pts = [[-26000, -3000]];
    let hgt = 0.5;
    for (let x = -26000; x <= 26000; x += 320) {
      hgt = Math.max(0.05, Math.min(1, hgt + (r() - 0.5) * 0.55));
      const peak = Math.abs(Math.sin(x * 0.00021 + seed)) * 0.7 + 0.3;
      pts.push([x, base + amp * hgt * peak]);
    }
    pts.push([26000, -3000]);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: true, transparent: opacity < 1, opacity, depthWrite: false }));
    m.position.z = z;
    m.renderOrder = -5;
    scene.add(m);
  }
  ridge(-17000, 0x6a5f94, 2300, -200, 3, 1);
  ridge(-12500, 0x463f78, 1900, -330, 8, 1);
  ridge(-8800, 0x2c2a58, 1500, -420, 15, 1);

  // ---- hero aircraft ----
  const world = new SimWorld();
  let hero = null; // { view, model, size, spec, t, phase }
  let heroIndex = -1;
  let order = HERO_ORDER.filter((id) => AIRCRAFT.some((a) => a.id === id));
  let next = null;
  const caption = { name: '', maker: '' };
  let onCaption = null;

  function build(id) {
    const spec = specWithLivery(id, 'factory');
    const view = new AircraftView(spec, null, { detail: HIGH });
    const model = new FlightModel(spec, world);
    model.reset({ mode: 'air', altitude: 3000, heading: 90, speed: spec.speeds.cruise * 0.514 });
    model.controls.gearDown = false;
    const size = Math.max(spec.wing.span, spec.geometry.length);
    return { view, model, size, spec };
  }

  function show(entry, fromRight = false) {
    if (hero) { scene.remove(hero.view.root); disposeObject(hero.view.root); }
    hero = { ...entry, t: reduceMotion() ? 3.6 : 0, fromRight };
    scene.add(hero.view.root);
    caption.name = entry.spec.name;
    caption.maker = `${entry.spec.maker} · ${entry.spec.class}`;
    onCaption?.(caption);
  }

  const TIMES = { arrive: 3.2, hold: 11, depart: 2.6 };
  const total = TIMES.arrive + TIMES.hold + TIMES.depart;
  const ease = (t) => 1 - (1 - t) ** 3;

  function cycle(step = 1) {
    heroIndex = (heroIndex + step + order.length) % order.length;
    show(build(order[heroIndex]));
  }
  function prefetch() {
    if (next) return;
    next = build(order[(heroIndex + 1) % order.length]);
  }

    function place(dt) {
    if (!hero) return;
    hero.t += dt;
    const { size } = hero;
    const k = size * 1.55; // how far the aircraft sits from the camera and how wide its path is
    let t = hero.t;
    let px; let py; let pz; let bank; let pitch;
    const cx = -size * 0.04; const cy = size * 0.02;
    if (t < TIMES.arrive) {
      const u = ease(t / TIMES.arrive);
      px = cx - (1 - u) * k * 5.2; py = cy + (1 - u) * k * 0.28; pz = -k * (0.1 + (1 - u) * 1.2);
      bank = (1 - u) * 0.25; pitch = -(1 - u) * 0.08;
    } else if (t < TIMES.arrive + TIMES.hold) {
      const h = t - TIMES.arrive;
      px = cx + Math.sin(h * 0.37) * k * 0.05; py = cy + Math.sin(h * 0.6) * size * 0.015; pz = -k * 0.1 + Math.sin(h * 0.23) * k * 0.05;
      bank = Math.sin(h * 0.5) * 0.035; pitch = Math.sin(h * 0.43) * 0.012;
    } else {
      const u = (t - TIMES.arrive - TIMES.hold) / TIMES.depart;
      const a = u * u * u;
      px = cx + a * k * 7; py = cy + a * k * 0.5; pz = -k * 0.1 - a * k * 2.4;
      bank = -a * 0.3; pitch = a * 0.12;
    }
    const v = hero.view;
    hero.model.surfaces.aileron = 0;
    v.update(hero.model, 1, dt, performance.now() / 1000);
    // Nose to the right and a little toward the camera: a three-quarter front view. Body +X is the nose, +Y up, +Z the right wing,
    // so a negative yaw swings the nose toward +z (the camera); Euler order YZX = yaw, then pitch, then roll about the body axes.
    v.root.position.set(px, py, pz);
    v.root.rotation.set(bank, -0.92, pitch + 0.05, 'YZX');
    if (hero.t > total) { if (next) { show(next); next = null; } else cycle(1); }
    else if (hero.t > TIMES.arrive + TIMES.hold * 0.45 && !next) prefetch();
  }

  const camTarget = new THREE.Vector3();
  function updateCamera(w, h, shift) {
    const size = hero?.size ?? 12;
    const k = size * 1.55;
    camera.aspect = w / h;
    // Camera slightly below the wing line looking up a touch: the aircraft against the sun-lit sky reads big and heroic.
    const dist = (size * 1.55 + 9) * Math.min(2.2, Math.max(1, 1.4 / (w / h)));
    camera.position.set(size * 0.02, -size * 0.03, dist);
    camTarget.set(0, size * 0.035, -k * 0.1);
    camTarget.y -= size * 0.05;
    camera.lookAt(camTarget);
    camera.fov = 32;
    camera.clearViewOffset();
    if (shift) camera.setViewOffset(w, h, -w * shift, 0, w, h);
    camera.updateProjectionMatrix();
  }

  let time = 0;
  return {
    scene, camera, kind: 'menu',
    /** `shift`: fraction of the width the image is moved right (room for the menu on the left). */
    update(dt, w, h, shift) {
      time += dt;
      if (!hero) cycle(0);
      place(reduceMotion() ? 0 : dt);
      for (const l of layers) {
        if (!reduceMotion()) l.s.position.x += l.speed * dt;
        if (l.s.position.x > 9000) l.s.position.x -= 18000;
      }
      updateCamera(w, h, shift);
    },
    next(step = 1) { cycle(step); next = null; },
    /** Test hook: jump the hero to `id` and `t` seconds into its flight. */
    seek(id, t = 5) { const i = order.indexOf(id); if (i >= 0) heroIndex = i; show(build(order[heroIndex])); hero.t = t; },
    onCaption(fn) { onCaption = fn; if (hero) fn(caption); },
    dispose() {
      if (hero) disposeObject(hero.view.root);
      if (next) disposeObject(next.view.root);
      scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    },
  };
}
