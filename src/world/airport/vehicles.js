import * as THREE from 'three';
import { lift } from './materials.js';
import { MeshBuf } from './mesh.js';

// Ground vehicles and small equipment: each model is a small merged mesh with vertex colours, drawn as one
// InstancedMesh per type for the whole airport. Models face +X, centred on the origin, wheels on y = 0.

const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const C = {
  white: col(0xdfe2e5), grey: col(0x8c9298), dark: col(0x1b1d20), black: col(0x0c0d0e), yellow: col(0xe6b422), orange: col(0xe0701a), red: col(0xb3261e),
  blue: col(0x2d5ea8), glass: col(0x10161c), green: col(0x2f7d4f), steel: col(0x6d737a), rubber: col(0x0e0e0f),
};

const wheel = (b, x, r, z, w = 0.3, seg = 8) => {
  const prof = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; prof.push([Math.cos(a) * r, Math.sin(a) * r]); }
  b.extrude(prof, z - w / 2, z + w / 2, { x, y: r, z: 0, color: 0.05, ao: 0, smooth: false, tint: C.rubber });
};
const wheels = (b, xs, track, r, w) => { for (const x of xs) for (const sd of [-1, 1]) wheel(b, x, r, sd * track / 2, w); };
const bx = (b, x, y, z, w, h, d, tint, o = {}) => b.box(x, y, z, w, h, d, { tint, ao: 0.08, bottom: true, ...o });
const circle = (r, n = 12) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
/** Horizontal cylinder along X. */
const cylX = (b, x, y, z, len, r, tint, n = 12) => b.extrude(circle(r, n), -len / 2, len / 2, { x, y, z, ry: Math.PI / 2, smooth: true, tint, ao: 0, color: 1 });

const MODELS = {
  car(b) {
    bx(b, 0, 0.32, 0, 4.4, 0.7, 1.8, [1, 1, 1], { ao: 0.2 });
    bx(b, -0.25, 1.0, 0, 2.5, 0.62, 1.62, [1, 1, 1], { ao: 0.1 });
    bx(b, -0.25, 1.06, 0, 2.52, 0.4, 1.66, C.glass, { ao: 0, bottom: false });
    wheels(b, [-1.4, 1.4], 1.56, 0.32, 0.22);
  },
  bus(b) {
    bx(b, 0, 0.5, 0, 11.5, 2.5, 2.7, [1, 1, 1], { ao: 0.12 });
    bx(b, 0, 1.6, 0, 11.52, 0.8, 2.72, C.glass, { ao: 0, bottom: false });
    bx(b, 0, 3.0, 0, 11.0, 0.15, 2.5, C.grey, { ao: 0 });
    for (const x of [-4, 0, 4]) bx(b, x, 0.4, 1.38, 1.6, 2.0, 0.05, C.dark, { ao: 0, bottom: false });
    wheels(b, [-3.8, 3.8], 2.4, 0.5, 0.35);
  },
  tug(b) {
    bx(b, 0, 0.35, 0, 2.7, 0.7, 1.35, C.yellow);
    bx(b, 0.4, 1.05, 0, 1.3, 0.9, 1.3, C.yellow);
    bx(b, 0.4, 1.35, 0, 1.2, 0.5, 1.32, C.glass, { ao: 0, bottom: false });
    bx(b, 0.4, 1.95, 0, 1.6, 0.1, 1.5, C.grey, { ao: 0 });
    wheels(b, [-0.9, 0.9], 1.25, 0.32, 0.22);
  },
  cart(b) {
    bx(b, 0, 0.5, 0, 3.3, 0.15, 1.9, C.grey, { ao: 0.1 });
    bx(b, 0, 0.62, 0.9, 3.3, 1.0, 0.07, C.blue, { ao: 0 });
    bx(b, 0, 0.62, -0.9, 3.3, 1.0, 0.07, C.blue, { ao: 0 });
    bx(b, 1.62, 0.62, 0, 0.07, 1.0, 1.9, C.blue, { ao: 0 });
    bx(b, -2.2, 0.55, 0, 1.2, 0.08, 0.1, C.steel, { ao: 0 });
    for (const x of [-1.2, 0.6]) bx(b, x, 0.9, 0, 0.9, 0.5, 0.9, [0.5, 0.35, 0.2], { ao: 0.1 });
    wheels(b, [-1.2, 1.2], 1.7, 0.25, 0.2);
  },
  beltloader(b) {
    bx(b, 0, 0.45, 0, 4.0, 0.9, 2.0, C.grey);
    bx(b, -1.2, 1.3, 0, 1.3, 1.1, 1.8, C.yellow);
    b.boxT(2.3, 1.9, 0, 5.2, 0.3, 1.0, { pitch: 0.38, tint: C.dark });
    b.boxT(2.3, 2.1, 0.55, 5.2, 0.12, 0.08, { pitch: 0.38, tint: C.yellow });
    b.boxT(2.3, 2.1, -0.55, 5.2, 0.12, 0.08, { pitch: 0.38, tint: C.yellow });
    wheels(b, [-1.4, 1.2], 1.7, 0.4, 0.3);
  },
  stairs(b) {
    bx(b, 0, 0.5, 0, 4.6, 0.8, 2.2, C.white);
    bx(b, -1.6, 1.3, 0, 1.4, 1.2, 2.0, C.white);
    b.boxT(1.0, 1.8, 0, 4.2, 0.2, 1.3, { pitch: 0.5, tint: C.grey });
    for (const sd of [-1, 1]) b.boxT(1.0, 2.5, sd * 0.7, 4.2, 0.9, 0.06, { pitch: 0.5, tint: C.blue });
    bx(b, 3.0, 3.1, 0, 0.9, 0.12, 1.4, C.grey, { ao: 0 });
    wheels(b, [-1.5, 1.4], 1.9, 0.42, 0.3);
  },
  gpu(b) {
    bx(b, 0, 0.45, 0, 2.2, 1.0, 1.1, C.yellow);
    bx(b, 0.4, 1.45, 0, 0.8, 0.5, 0.9, C.dark, { ao: 0 });
    bx(b, 1.3, 0.6, 0, 0.5, 0.7, 0.6, C.steel);
    wheels(b, [-0.7, 0.7], 1.0, 0.28, 0.18);
  },
  fuel(b) {
    bx(b, 2.4, 0.5, 0, 6.0, 0.5, 2.3, C.grey);
    cylX(b, 2.2, 1.9, 0, 5.8, 1.15, C.white);
    bx(b, -2.0, 0.5, 0, 2.2, 2.2, 2.35, C.white);
    bx(b, -2.65, 1.9, 0, 0.9, 0.9, 2.3, C.glass, { ao: 0, bottom: false });
    bx(b, 2.2, 3.1, 0, 5.2, 0.1, 0.3, C.red, { ao: 0 });
    bx(b, 2.2, 1.1, 0, 5.9, 0.35, 2.38, C.red, { ao: 0 });
    wheels(b, [-2.4, 1.6, 3.4], 2.1, 0.55, 0.4);
  },
  caterer(b) {
    bx(b, -1.7, 0.6, 0, 2.4, 1.8, 2.4, C.white);
    bx(b, -2.4, 1.5, 0, 1.0, 0.8, 2.3, C.glass, { ao: 0, bottom: false });
    bx(b, 1.8, 0.6, 0, 5.4, 0.6, 2.3, C.grey);
    bx(b, 1.8, 2.2, 0, 5.4, 2.7, 2.4, C.white, { ao: 0.1 });
    bx(b, 1.8, 3.2, 0, 5.42, 0.3, 2.42, C.blue, { ao: 0 });
    for (const x of [-0.2, 3.8]) for (const sd of [-1, 1]) bx(b, x, 1.2, sd * 1.0, 0.15, 1.1, 0.15, C.steel, { ao: 0 });
    wheels(b, [-2.4, 3.2], 2.1, 0.5, 0.35);
  },
  pushback(b) {
    bx(b, 0, 0.35, 0, 7.0, 0.9, 3.0, C.dark);
    bx(b, 1.2, 1.2, 0, 2.2, 0.9, 2.4, C.yellow);
    bx(b, 1.6, 1.6, 0, 1.2, 0.5, 2.3, C.glass, { ao: 0, bottom: false });
    bx(b, -2.4, 1.2, 0, 2.6, 0.5, 2.7, C.grey);
    wheels(b, [-2.4, 2.4], 2.9, 0.55, 0.5);
  },
  arff(b) {
    bx(b, 0.2, 0.7, 0, 9.4, 1.5, 2.9, C.red);
    bx(b, 3.4, 2.0, 0, 2.4, 1.6, 2.8, C.red);
    bx(b, 4.0, 2.3, 0, 1.0, 0.8, 2.82, C.glass, { ao: 0, bottom: false });
    bx(b, -0.8, 2.2, 0, 6.2, 1.2, 2.7, C.red, { ao: 0.1 });
    bx(b, -0.8, 2.9, 0, 6.2, 0.3, 2.72, C.white, { ao: 0 });
    bx(b, 1.8, 3.4, 0, 1.0, 0.6, 0.6, C.yellow, { ao: 0 });
    b.boxT(2.4, 3.9, 0, 1.8, 0.14, 0.14, { pitch: 0.1, tint: C.grey });
    bx(b, 3.4, 3.6, 0, 1.2, 0.18, 2.4, C.dark, { ao: 0, bottom: false });
    wheels(b, [-3.0, -0.6, 3.5], 2.4, 0.62, 0.45);
  },
  followme(b) {
    bx(b, 0, 0.35, 0, 4.4, 0.7, 1.85, C.yellow, { ao: 0.2 });
    bx(b, -0.2, 1.0, 0, 2.5, 0.62, 1.65, C.yellow, { ao: 0.1 });
    bx(b, -0.2, 1.06, 0, 2.52, 0.4, 1.69, C.glass, { ao: 0, bottom: false });
    bx(b, -0.2, 1.62, 0, 0.4, 0.3, 1.2, C.black, { ao: 0 });
    bx(b, -0.4, 1.95, 0, 0.1, 0.9, 1.5, C.yellow, { ao: 0 });
    bx(b, -0.45, 2.05, 0, 0.08, 0.7, 1.4, [0.05, 0.05, 0.05], { ao: 0 });
    wheels(b, [-1.4, 1.4], 1.6, 0.32, 0.22);
  },
  pickup(b) {
    bx(b, 0.5, 0.5, 0, 2.0, 1.0, 1.9, [1, 1, 1], { ao: 0.2 });
    bx(b, 0.7, 1.5, 0, 1.2, 0.6, 1.7, C.glass, { ao: 0, bottom: false });
    bx(b, -1.4, 0.8, 0, 1.9, 0.5, 1.9, [1, 1, 1], { ao: 0.2 });
    wheels(b, [-1.4, 1.6], 1.65, 0.38, 0.28);
  },
  cone(b) {
    b.cyl(0, 0.04, 0, 0.02, 0.17, 0.5, 8, { tint: C.orange, ao: 0, capTop: false });
    bx(b, 0, 0, 0, 0.36, 0.05, 0.36, C.orange, { ao: 0 });
    b.cyl(0, 0.2, 0, 0.1, 0.12, 0.08, 8, { tint: C.white, ao: 0, capTop: false });
  },
  chock(b) {
    b.extrude([[0, 0], [0.4, 0], [0, 0.18]], -0.15, 0.15, { x: -0.2, y: 0, z: 0, tint: C.yellow, ao: 0, caps: true });
  },
  drum(b) { b.cyl(0, 0, 0, 0.28, 0.28, 0.9, 10, { tint: [1, 1, 1], ao: 0.1, capTop: true }); },
  marker(b) { b.cyl(0, 0, 0, 0.05, 0.2, 0.55, 8, { tint: [1, 1, 1], ao: 0, capTop: false }); },
  bale(b) { b.cyl(0, 0, 0, 0.9, 0.9, 1.2, 12, { tint: [0.6, 0.5, 0.2], ao: 0.1, capTop: true }); },
};

let sharedMat = null;
function vehicleMaterial() {
  if (!sharedMat) {
    sharedMat = lift(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 }));
    sharedMat.userData.shared = true;
  }
  return sharedMat;
}
export function disposeVehicleAssets() { sharedMat?.dispose(); sharedMat = null; geoCache.clear(); }

const geoCache = new Map();
function modelGeometry(type) {
  let g = geoCache.get(type);
  if (!g) {
    const b = new MeshBuf();
    MODELS[type](b);
    g = b.toGeometry();
    geoCache.set(type, g);
  }
  return g;
}

export const CAR_COLORS = [0xd8d9dc, 0x1b1c1f, 0x8e9196, 0xa9232a, 0x23476f, 0xc9c1ab, 0x4a5a4e, 0x6d4a2b, 0xe9e9ea, 0x303a45].map((h) => new THREE.Color(h));

/** Collects vehicle placements and builds one InstancedMesh per type (positions in airport-frame metres). */
export class VehicleField {
  constructor() { this.list = new Map(); }

  /** dirU/dirV: forward direction in the frame; y: lift above the ground. */
  add(type, u, v, dirU, dirV, { color = null, scale = 1, y = 0 } = {}) {
    if (!this.list.has(type)) this.list.set(type, []);
    this.list.get(type).push({ u, v, ry: -Math.atan2(dirV, dirU), color, scale, y });
  }

  get count() { let n = 0; for (const l of this.list.values()) n += l.length; return n; }

  build() {
    const group = new THREE.Group();
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [type, items] of this.list) {
      const mesh = new THREE.InstancedMesh(modelGeometry(type), vehicleMaterial(), items.length);
      items.forEach((it, i) => {
        q.setFromAxisAngle(up, it.ry);
        s.setScalar(it.scale);
        p.set(it.u, it.y + 0.05, it.v);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, it.color ?? WHITE);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.name = `veh-${type}`;
      group.add(mesh);
    }
    return group;
  }
}
const WHITE = new THREE.Color(1, 1, 1);
