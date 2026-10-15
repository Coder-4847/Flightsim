import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AircraftView } from '../aircraft/aircraftView.js';
import { getAircraft } from '../aircraft/index.js';

// Shared AI aircraft models. Each type (and livery variant) is built once; instances are clones
// that share geometry and materials, so a crowded apron costs draw calls but not memory.

const VARIANTS = {
  narrowbody: [{}, { stripe: '#d94a2a', stripe2: '#f0b429' }, { stripe: '#14805a', stripe2: '#bfe3d4' }],
  regional: [{}, { stripe: '#2b6fb8', stripe2: '#e8eef5' }, { stripe: '#7a3fa0', stripe2: '#e5d4f0' }],
  widebody: [{}, { stripe: '#1c4d8a', stripe2: '#9cc3e8' }],
  jumbo: [{}, { stripe: '#b3262e', stripe2: '#f4d8a0' }],
  bizjet: [{}, { stripe: '#1d6e6a', stripe2: '#d6b25e' }, { stripe: '#222a35', stripe2: '#c9ccd1' }],
  turboprop72: [{}, { stripe: '#c25b1a', stripe2: '#f6dfa8' }],
  cessna172: [{}, { stripe: '#b02a2a', stripe2: '#e9e9e9' }, { stripe: '#1c7a4f', stripe2: '#e9e9e9' }],
  caravan: [{}, { stripe: '#2b5fa8', stripe2: '#f0f0f0' }],
  kingair: [{}, { stripe: '#7a1f2f', stripe2: '#d9c27a' }],
  citation: [{}, { stripe: '#b8561c', stripe2: '#2b3a4a' }],
};

const cache = new Map();

// Plain-colour parts of every aircraft (paint, engines, struts, tyres, intakes ...) are merged into two shared
// vertex-coloured materials, so a baked aircraft needs about five draw calls instead of twenty. Textured skin,
// transparent glass and glowing windows keep their own materials.
let flatMat = null; let flatMetalMat = null; let glassMat = null; let windowMat = null;
function flatMaterials() {
  if (!flatMat) {
    glassMat = new THREE.MeshStandardMaterial({ color: 0x28435c, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
    windowMat = new THREE.MeshStandardMaterial({ color: 0x1a2531, roughness: 0.1, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0 });
    glassMat.userData.shared = true; windowMat.userData.shared = true;
    flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.12, side: THREE.DoubleSide });
    flatMetalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
    flatMat.userData.shared = true; flatMetalMat.userData.shared = true;
  }
  return [flatMat, flatMetalMat, glassMat, windowMat];
}

/** Cabin windows of every baked aircraft glow after dark (0 = day .. 1 = night). */
export function setFleetNight(level) { flatMaterials(); windowMat.emissiveIntensity = 0.9 * level; }

const glows = (m) => m.emissive && m.emissive.getHex() !== 0;
const isPlain = (m) => !m.map && !m.transparent && !glows(m) && !m.alphaTest && m.color;

/** Position, normal and uv (plus the material colour for plain parts) in the group's local space: mergeable with any other. */
function bakedGeometry(mesh, withColor) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(mesh.matrixWorld);
  if (withColor) {
    const c = mesh.material.color; const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

/**
 * Collapse one LOD level (a rigged hierarchy of dozens of meshes) into a few meshes, plus its light
 * sprites. AI aircraft never animate, so this cuts draw calls by an order of magnitude.
 */
function bakeLevel(level, withSprites) {
  level.updateMatrixWorld(true);
  const groups = new Map(); // key (material or 'flat'/'metal') -> geometries
  const sprites = [];
  const [flat, flatMetal, glass, windowM] = flatMaterials();
  level.traverse((o) => {
    if (o.isSprite) { if (withSprites) sprites.push(o); }
    else if (o.isMesh && o.visible) {
      const m = o.material;
      let key = m; let color = false;
      if (isPlain(m)) { key = m.metalness >= 0.5 ? flatMetal : flat; color = true; }
      else if (m.transparent) key = glass;
      else if (glows(m)) key = windowM;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bakedGeometry(o, color));
    }
  });
  const out = new THREE.Group();
  for (const [material, geos] of groups) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    merged.computeBoundingSphere();
    out.add(new THREE.Mesh(merged, material));
  }
  // light sprites become one Points object (one draw call instead of one per light)
  if (sprites.length) {
    const pos = new Float32Array(sprites.length * 3); const col = new Float32Array(sprites.length * 3);
    const p = new THREE.Vector3(); const sc = new THREE.Vector3(); const q = new THREE.Quaternion();
    let size = 0;
    sprites.forEach((sp, i) => {
      sp.matrixWorld.decompose(p, q, sc);
      pos.set([p.x, p.y, p.z], i * 3);
      const c = sp.material.color ?? new THREE.Color(1, 1, 1);
      col.set([c.r, c.g, c.b], i * 3);
      size = Math.max(size, sc.x);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const src = sprites[0].material;
    const m = new THREE.PointsMaterial({
      size: size * 1.7, sizeAttenuation: true, vertexColors: true, map: src.map, transparent: true, depthWrite: false,
      blending: src.blending ?? THREE.AdditiveBlending,
    });
    m.userData.shared = true;
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    out.add(pts);
  }
  return out;
}

function bakeView(view, maxRange, gearUp) {
  if (gearUp) {
    for (const rig of view.rigs) {
      if (rig.gear.nose) rig.gear.nose.leg.visible = false;
      for (const main of rig.gear.mains) main.leg.visible = false;
      for (const door of rig.gear.doors) door.pivot.visible = false;
    }
  }
  const lod = new THREE.LOD();
  view.lod.levels.forEach((level, i) => lod.addLevel(bakeLevel(level.object, i !== 1), level.distance));
  lod.addLevel(new THREE.Group(), maxRange); // beyond this the aircraft is not drawn at all
  const root = new THREE.Group();
  root.add(lod);
  return root;
}

/** Fake registrations so parked aircraft are not all the same airframe. */
function registration(spec, n) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `N${100 + ((n * 37) % 800)}${letters[(n * 7) % letters.length]}${letters[(n * 11 + 3) % letters.length]}`;
}

/** A parked/flying model for `id`, variant `n` (wraps). Returns { root, spec }. */
export function createTrafficModel(id, n = 0, { gearUp = false } = {}) {
  const base = getAircraft(id);
  const variants = VARIANTS[id] ?? [{}];
  const vi = ((n % variants.length) + variants.length) % variants.length;
  const key = `${id}:${vi}:${n % 5}:${gearUp ? 'u' : 'd'}`;
  let entry = cache.get(key);
  if (!entry) {
    const spec = { ...base, registration: registration(base, n), livery: { ...base.livery, ...variants[vi] } };
    const view = new AircraftView(spec, null);
    entry = { source: bakeView(view, spec.geometry.length * 160, gearUp), spec };
    cache.set(key, entry);
  }
  const root = entry.source.clone();
  // Lights stay on but do not blink (sprites share materials across clones).
  return { root, spec: entry.spec };
}

export function disposeFleetCache() {
  for (const { source } of cache.values()) source.traverse((o) => { o.geometry?.dispose?.(); });
  cache.clear();
}

/** Orient a model so its nose points along `heading` degrees (0 = north). */
export function setHeading(object, headingDeg) {
  object.rotation.set(0, Math.PI / 2 - (headingDeg * Math.PI) / 180, 0, 'YXZ');
}

export const _v = new THREE.Vector3();
