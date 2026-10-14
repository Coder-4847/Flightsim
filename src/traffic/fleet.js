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

/** Position, normal and uv only, non-indexed, in the group's local space: mergeable with any other. */
function bakedGeometry(mesh) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

/**
 * Collapse one LOD level (a rigged hierarchy of dozens of meshes) into one mesh per material, plus
 * its light sprites. AI aircraft never animate, so this cuts draw calls by an order of magnitude.
 */
function bakeLevel(level, withSprites) {
  level.updateMatrixWorld(true);
  const byMaterial = new Map();
  const sprites = [];
  level.traverse((o) => {
    if (o.isSprite) { if (withSprites) sprites.push(o); }
    else if (o.isMesh && o.visible) {
      if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
      byMaterial.get(o.material).push(bakedGeometry(o));
    }
  });
  const out = new THREE.Group();
  for (const [material, geos] of byMaterial) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    merged.computeBoundingSphere();
    out.add(new THREE.Mesh(merged, material));
  }
  for (const sprite of sprites) {
    const copy = sprite.clone();
    sprite.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    out.add(copy);
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
