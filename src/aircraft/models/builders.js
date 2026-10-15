import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise } from '../../util/noise.js';
import { createProMaterials, isPro, proTile } from './skins.js';

// Procedural geometry kit for aircraft. Everything is built in the aircraft body frame:
// +X forward, +Y up, +Z right wing, origin at the centre of gravity, metres.

import { HIGH, MEDIUM, LOW } from './lod.js';

export { HIGH, MEDIUM, LOW };

const CREASE = (55 * Math.PI) / 180;

// ---- textures --------------------------------------------------------------------------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let panelBump = null;
/** Shared panel-line / rivet bump map for painted skin. */
export function getPanelBump() {
  if (panelBump) return panelBump;
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#4a4a4a';
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 85) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.fillStyle = '#9a9a9a';
  for (let x = 6; x < 512; x += 16) {
    for (const y of [0, 85, 170, 255, 340, 425]) { g.fillRect(x, y + 5, 2, 2); g.fillRect(x, y - 7, 2, 2); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.userData.shared = true;
  panelBump = tex;
  return tex;
}

/**
 * Fuselage livery canvas. u runs tail->nose, v runs around the body (0 = right side,
 * 0.25 = top, 0.5 = left, 0.75 = belly). `livery`: {base, stripe, stripe2, belly, reg, lower}
 */
export function makeLiveryTexture(livery, reg) {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = livery.base;
  g.fillRect(0, 0, W, H);
  if (livery.belly) {
    g.fillStyle = livery.belly;
    g.fillRect(0, H * 0.63, W, H * 0.24);
  }
  // Side cheat-line stripes (right side centred at v=0 and 1, left side at 0.5).
  const band = (v, h, color, x0 = 0.04, x1 = 0.97, slope = 0) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(W * x0, H * (v - h / 2));
    g.lineTo(W * x1, H * (v - h / 2 - slope));
    g.lineTo(W * x1, H * (v + h / 2 - slope));
    g.lineTo(W * x0, H * (v + h / 2));
    g.fill();
  };
  for (const v of [0.02, 0.5]) {
    if (livery.stripe) band(v, 0.07, livery.stripe, 0.12, 0.99, 0.02);
    if (livery.stripe2) band(v + 0.06, 0.025, livery.stripe2, 0.12, 0.99, 0.02);
  }
  if (livery.lower) {
    g.fillStyle = livery.lower;
    g.fillRect(0, H * 0.58, W, H * 0.04);
  }
  // Registration on both sides near the tail, readable from outside.
  g.fillStyle = livery.regColor ?? '#1a2230';
  const size = livery.regSize ?? 34;
  g.font = `bold ${size}px Arial, sans-serif`;
  g.textBaseline = 'middle';
  // Right side reads left-to-right as drawn; on the left side (v = 0.5) the surface runs the
  // other way, so that copy is turned 180 degrees.
  g.save();
  g.translate(W * 0.2, H * 0.985);
  g.scale(1.5, 1);
  g.fillText(reg, 0, 0);
  g.restore();
  g.save();
  g.translate(W * 0.2 + size * 1.5 * reg.length * 0.62, H * 0.47);
  g.rotate(Math.PI);
  g.scale(1.5, 1);
  g.fillText(reg, 0, 0);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.userData.shared = true;
  return glowTexture;
}

// ---- materials -------------------------------------------------------------------------
export function makeMaterials(spec, opts = {}) {
  if (isPro(spec.id)) return createProMaterials(spec, { quality: opts.quality ?? 1, tile: proTile(spec.id) });
  const livery = spec.livery;
  const bump = getPanelBump();
  const skin = new THREE.MeshStandardMaterial({
    map: makeLiveryTexture(livery, spec.registration),
    roughness: livery.roughness ?? 0.38, metalness: livery.metalness ?? 0.2,
    bumpMap: bump, bumpScale: 0.6,
  });
  return {
    skin,
    wing: new THREE.MeshStandardMaterial({ color: livery.wing ?? livery.base, roughness: 0.4, metalness: 0.2, bumpMap: bump, bumpScale: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ color: livery.stripe ?? '#c0392b', roughness: 0.4, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2128, roughness: 0.6, metalness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5a626b, roughness: 0.45, metalness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.95, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x28435c, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.55,
      envMapIntensity: 1.2,
    }),
    // Cabin windows: dark glass by day, warm light at night (see AircraftView.setNight).
    window: new THREE.MeshStandardMaterial({ color: 0x1a2531, roughness: 0.1, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.8, metalness: 0.5, side: THREE.DoubleSide }),
    prop: new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
    propTip: new THREE.MeshStandardMaterial({ color: livery.tip ?? 0xf2c230, roughness: 0.5 }),
  };
}

// ---- shape helpers ------------------------------------------------------------------------
const sgnPow = (x, p) => Math.sign(x) * Math.abs(x) ** p;

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smoothly interpolate station property `key` at fractional index `f`. */
function sampleStations(stations, key, f) {
  const n = stations.length;
  const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const t = f - i;
  const get = (k) => stations[Math.min(n - 1, Math.max(0, k))][key] ?? 0;
  return catmull(get(i - 1), get(i), get(i + 1), get(i + 2), t);
}

/**
 * Lofted fuselage. `stations` run tail -> nose: {x, w, top, bottom, yc, n}
 * (half-width, heights above/below the centreline, centreline height, superellipse exponent).
 */
export function fuselageGeometry(stations, detail = HIGH) {
  const segs = [10, 18, 30][detail];
  const perStation = [1, 3, 5][detail];
  const rings = (stations.length - 1) * perStation + 1;
  const pos = [];
  const uv = [];
  const xMin = stations[0].x;
  const xSpan = (stations[stations.length - 1].x - xMin) || 1;
  for (let r = 0; r < rings; r++) {
    const f = (r / (rings - 1)) * (stations.length - 1);
    const x = sampleStations(stations, 'x', f);
    const w = Math.max(0.001, sampleStations(stations, 'w', f));
    const top = Math.max(0.001, sampleStations(stations, 'top', f));
    const bottom = Math.max(0.001, sampleStations(stations, 'bottom', f));
    const yc = sampleStations(stations, 'yc', f);
    const n = Math.max(2, sampleStations(stations, 'n', f) || 2);
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const z = w * sgnPow(ca, 2 / n);
      const y = yc + (sa >= 0 ? top : bottom) * sgnPow(sa, 2 / n);
      pos.push(x, y, z);
      uv.push((x - xMin) / xSpan, s / segs); // u: tail -> nose by distance, v: around the body
    }
  }
  const idx = [];
  const row = segs + 1;
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * row + s;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return finishGeometry(geo, (g) => outwardCheck(g, (v) => new THREE.Vector3(0, v.y - stations[0].yc, v.z)));
}

/** Flip triangle winding if normals point inward (tested against a user-supplied "outward" direction). */
function outwardCheck(geo, outwardFor) {
  geo.computeVertexNormals();
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  let score = 0;
  const v = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 7) {
    v.fromBufferAttribute(p, i);
    nn.fromBufferAttribute(n, i);
    score += nn.dot(outwardFor(v).normalize());
  }
  if (score < 0) {
    const index = geo.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
  }
  return geo;
}

function finishGeometry(geo, orient) {
  if (orient) orient(geo);
  const creased = toCreasedNormals(geo, CREASE);
  creased.computeBoundingSphere();
  return creased;
}

// ---- wings --------------------------------------------------------------------------------
/**
 * Wing section key: {z (span), x (leading edge), y, chord, t (thickness ratio), camber, twist (deg)}.
 * Returns the section at span position z by linear interpolation.
 */
export function sectionAt(sections, z) {
  if (z <= sections[0].z) return { ...sections[0], z };
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z || 1);
      const out = { z };
      for (const key of ['x', 'y', 'chord', 't', 'camber', 'twist']) out[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t;
      return out;
    }
  }
  return { ...sections[sections.length - 1], z };
}

function airfoilRing(section, from, to, points) {
  // Cosine-spaced chord stations from `from` to `to`; lower surface forward, upper surface back.
  const xs = [];
  for (let i = 0; i <= points; i++) {
    const u = i / points;
    const beta = (1 - Math.cos(Math.PI * u)) / 2; // 0..1 clustered at both ends
    xs.push(from + (to - from) * beta);
  }
  const thick = (x) => 5 * section.t * (0.2969 * Math.sqrt(Math.max(x, 0)) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const camber = (x) => (section.camber ?? 0) * Math.sin(Math.PI * Math.min(1, x) ** 0.8);
  const twist = ((section.twist ?? 0) * Math.PI) / 180;
  const ring = [];
  const place = (x, y) => {
    // Twist about the quarter chord.
    const dx = x - 0.25;
    const rx = 0.25 + dx * Math.cos(twist) - y * Math.sin(twist);
    const ry = dx * Math.sin(twist) + y * Math.cos(twist);
    ring.push(new THREE.Vector3(section.x - rx * section.chord, section.y + ry * section.chord, section.z));
  };
  for (const x of xs) place(x, camber(x) - thick(x)); // lower surface, `from` -> `to`
  for (let i = xs.length - 1; i >= 0; i--) place(xs[i], camber(xs[i]) + thick(xs[i])); // upper surface back
  return ring;
}

/**
 * Loft a (right) wing panel between spans z0..z1 and chord fractions xf0..xf1.
 * With xf0 = 0 and xf1 = 1 this is a whole wing; flaps/ailerons use the aft slice.
 */
export function wingGeometry(sections, z0, z1, { xf0 = 0, xf1 = 1, detail = HIGH, capRoot = false } = {}) {
  const points = [5, 9, 14][detail];
  const slices = Math.max(1, Math.round([1, 2, 4][detail] * Math.max(1, (z1 - z0) / 3)));
  const rings = [];
  for (let i = 0; i <= slices; i++) {
    const z = z0 + ((z1 - z0) * i) / slices;
    rings.push(airfoilRing(sectionAt(sections, z), xf0, xf1, points));
  }
  const pos = [];
  const idx = [];
  const n = rings[0].length;
  for (const ring of rings) for (const v of ring) pos.push(v.x, v.y, v.z);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      idx.push(a, a + n, b, b, a + n, b + n);
    }
  }
  const cap = (ringIndex, flip) => {
    const base = pos.length / 3;
    const c = new THREE.Vector3();
    rings[ringIndex].forEach((v) => c.add(v));
    c.divideScalar(n);
    pos.push(c.x, c.y, c.z);
    for (let i = 0; i < n; i++) {
      const a = ringIndex * n + i;
      const b = ringIndex * n + ((i + 1) % n);
      if (flip) idx.push(base, b, a); else idx.push(base, a, b);
    }
  };
  cap(rings.length - 1, false);
  if (capRoot) cap(0, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return finishGeometry(geo, (g) => {
    // Upper surface normals must face +Y: test with samples on the upper half of the ring.
    g.computeVertexNormals();
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    let score = 0;
    for (let r = 0; r < rings.length; r++) {
      for (let i = Math.floor(n / 2) + 1; i < n - 1; i++) score += nrm.getY(r * n + i);
    }
    if (score < 0) {
      const index = g.index.array;
      for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    }
    void p;
  });
}

/**
 * A hinged control surface: a pivot Object3D at the hinge line carrying the aft slice
 * of the wing between spans z0..z1. Returns { pivot, axis } for the animation rig.
 */
export function controlSurface(sections, z0, z1, hingeFraction, material, detail = HIGH) {
  const geo = wingGeometry(sections, z0, z1, { xf0: hingeFraction, xf1: 1, detail });
  const s0 = sectionAt(sections, z0);
  const s1 = sectionAt(sections, z1);
  const h0 = new THREE.Vector3(s0.x - hingeFraction * s0.chord, s0.y, z0);
  const h1 = new THREE.Vector3(s1.x - hingeFraction * s1.chord, s1.y, z1);
  const axis = h1.clone().sub(h0).normalize();
  geo.translate(-h0.x, -h0.y, -h0.z);
  const pivot = new THREE.Object3D();
  pivot.position.copy(h0);
  const mesh = new THREE.Mesh(geo, material);
  pivot.add(mesh);
  return { pivot, axis, mesh };
}

// ---- revolved parts --------------------------------------------------------------------------
/** Surface of revolution about the X axis. `profile`: [[x, radius], ...] nose to tail or any order. */
export function revolveX(profile, segments = 24) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0005), x));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateZ(-Math.PI / 2); // lathe axis Y -> X
  return geo;
}

const _ray = new THREE.Raycaster();

/**
 * A thin panel laid on a mesh's surface where a ray from outside (at angle `ang` degrees around the
 * X axis, 0 = right side, 90 = top, 180 = left) hits it at station x. Used for windscreens.
 */
export function surfacePanel(mesh, { x, ang, yc = 0, w, h, material, lift = 0.012 }) {
  const a = (ang * Math.PI) / 180;
  const dir = new THREE.Vector3(0, -Math.sin(a), -Math.cos(a));
  const origin = new THREE.Vector3(x, yc, 0).addScaledVector(dir, -30);
  _ray.set(origin, dir);
  const hit = _ray.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const normal = hit.face.normal.clone();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  panel.position.copy(hit.point).addScaledVector(normal, lift);
  panel.up.set(0, 1, 0);
  panel.lookAt(hit.point.clone().add(normal));
  return panel;
}

export function box(w, h, d, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
}

export function cylinderX(radius, length, material, segments = 16, radiusEnd = radius) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radiusEnd, radius, length, segments), material);
  m.rotation.z = Math.PI / 2;
  return m;
}

// ---- propellers and fans -----------------------------------------------------------------------
/** Propeller rotating about +X. Spin it with group.rotation.x. userData.disc is the high-RPM blur disc. */
export function makeProp({ blades, radius, chord, hubRadius = 0.12 }, mats, detail = HIGH) {
  const group = new THREE.Group();
  // Blade outline in (chordwise, radial) coordinates, rotated so radial = +Y and chord = Z.
  const c = chord;
  const outline = new THREE.Shape();
  [[-0.4, 0], [-0.5, 0.25], [-0.45, 0.7], [-0.22, 1], [0.12, 1], [0.4, 0.7], [0.5, 0.25], [0.4, 0]].forEach(([cx, r], i) => {
    if (i === 0) outline.moveTo(cx * c, r * radius); else outline.lineTo(cx * c, r * radius);
  });
  const bladeGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.014, bevelEnabled: false });
  bladeGeo.translate(0, 0, -0.007);
  bladeGeo.rotateY(Math.PI / 2); // thickness -> X, chord -> Z
  const tipGeo = new THREE.BoxGeometry(0.018, radius * 0.09, chord * 0.55);
  const bladeGroups = [];
  for (let i = 0; i < blades; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = (i / blades) * Math.PI * 2;
    const holder = new THREE.Group();
    holder.rotation.y = 0.45; // blade pitch about the radial axis
    holder.add(new THREE.Mesh(bladeGeo, mats.prop));
    if (detail > LOW) {
      const tip = new THREE.Mesh(tipGeo, mats.propTip);
      tip.position.y = radius * 0.955;
      holder.add(tip);
    }
    pivot.add(holder);
    group.add(pivot);
    bladeGroups.push(pivot);
  }
  const spinner = new THREE.Mesh(revolveX([[hubRadius * 1.9, 0.001], [hubRadius * 1.5, hubRadius * 0.65], [0, hubRadius]], 16), mats.metal);
  group.add(spinner);
  // Translucent disc shown at high RPM instead of the individual blades.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.rotation.y = Math.PI / 2;
  group.add(disc);
  group.userData.disc = disc;
  group.userData.blades = bladeGroups;
  return group;
}

/** Turbofan fan face rotating about +X inside an intake of radius `radius`. */
export function makeFan(radius, mats, detail = HIGH) {
  const group = new THREE.Group();
  const count = detail > MEDIUM ? 18 : 10;
  const bladeGeo = new THREE.BoxGeometry(radius * 0.06, radius * 0.86, radius * 0.18);
  for (let i = 0; i < count; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = (i / count) * Math.PI * 2;
    const b = new THREE.Mesh(bladeGeo, mats.metal);
    b.rotation.y = 0.5;
    b.position.y = radius * 0.5;
    pivot.add(b);
    group.add(pivot);
  }
  const hub = new THREE.Mesh(revolveX([[radius * 0.15, 0.001], [radius * 0.08, radius * 0.22], [-radius * 0.1, radius * 0.24]], 12), mats.steel);
  group.add(hub);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.95, 24),
    new THREE.MeshBasicMaterial({ color: 0x20252b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.rotation.y = Math.PI / 2;
  group.add(disc);
  group.userData.disc = disc;
  return group;
}

// ---- landing gear ---------------------------------------------------------------------------------
/**
 * One gear leg. `pivot` is placed at the attachment point; the leg hangs down -Y by `length`.
 * `lower` (piston + wheels) slides up by the strut compression.
 */
export function makeGearLeg({
  length, wheelRadius, wheelWidth, wheels = 1, track = 0.2, strutRadius = 0.035, axles = 1, axleSpacing = 1.2,
}, mats, detail = HIGH) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(strutRadius * 1.5, strutRadius * 1.6, length * 0.55, 10), mats.metal);
  upper.position.y = -length * 0.275;
  pivot.add(upper);
  const lower = new THREE.Group();
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(strutRadius, strutRadius, length * 0.55, 10), mats.steel);
  piston.position.y = -length * 0.55 + length * 0.2;
  lower.add(piston);
  const axleY = -length + wheelRadius;
  const wheelMeshes = [];
  const lateral = wheels === 2 ? [-track / 2, track / 2] : [0];
  // Bogies: `axles` rows of wheels spaced along the aircraft's X axis.
  const offsets = [];
  for (let a = 0; a < axles; a++) {
    const x = (a - (axles - 1) / 2) * axleSpacing;
    for (const z of lateral) offsets.push([x, z]);
  }
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, detail > LOW ? 24 : 12);
  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, wheelWidth * 1.04, 16);
  for (const [offX, off] of offsets) {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, mats.rubber);
    tire.rotation.x = Math.PI / 2;
    wheel.add(tire);
    if (detail > LOW) {
      const rim = new THREE.Mesh(rimGeo, mats.metal);
      rim.rotation.x = Math.PI / 2;
      wheel.add(rim);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(wheelRadius * 0.9, wheelRadius * 0.08, wheelWidth * 1.08), mats.dark);
      wheel.add(mark);
    }
    wheel.position.set(offX, axleY, off);
    lower.add(wheel);
    wheelMeshes.push(wheel);
  }
  if (axles > 1) {
    // Bogie beam joining the axles.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(axleSpacing * (axles - 1) + 0.3, strutRadius * 2.4, strutRadius * 3), mats.steel);
    beam.position.y = axleY + wheelRadius * 0.55;
    lower.add(beam);
  }
  if (wheels === 2) {
    for (let a = 0; a < axles; a++) {
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(strutRadius, strutRadius, track, 8), mats.steel);
      axle.rotation.x = Math.PI / 2;
      axle.position.set((a - (axles - 1) / 2) * axleSpacing, axleY, 0);
      lower.add(axle);
    }
  } else if (detail > LOW) {
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.06, wheelRadius * 1.1, wheelWidth + 0.06), mats.steel);
    fork.position.y = axleY + wheelRadius * 0.4;
    lower.add(fork);
  }
  pivot.add(lower);
  pivot.userData = { lower, wheels: wheelMeshes, length };
  return pivot;
}

// ---- lights -------------------------------------------------------------------------------------------
export function makeLight(color, size = 0.06, glow = 0.7) {
  const group = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color }));
  group.add(bulb);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  sprite.scale.setScalar(size * 18 * glow);
  group.add(sprite);
  group.userData = { bulb, sprite, baseScale: sprite.scale.x };
  return group;
}

export function seededNoise(seed) {
  return createNoise(seed);
}
