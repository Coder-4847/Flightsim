import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, TAU, cylX, loftBody, revolve, roundedBox, std, tubeBetween, vec, extrudeShape, sphereG,
} from './kit.js';

// Jet-specific assemblies: exhaust nozzles with afterburner flames, missiles, canopy bows, seats, pylons.

/** Convergent-divergent nozzle shell with overlapping petals, a dark liner and a flame-holder, opening aft along -X. */
export function nozzleParts(parts, { x, y = 0, z = 0, r0, r1, len, petals = 16, detail = HIGH, liner = true }) {
  const m = T(x, y, z);
  // Petal skin: alternate petals sit slightly proud so the pleats read as overlapping plates.
  const rings = detail === HIGH ? 7 : 3;
  const seg = petals * 2;
  const pos = []; const idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = r0 + (r1 - r0) * (t < 0.55 ? t / 0.55 * 0.7 : 0.7 + (t - 0.55) / 0.45 * 0.3);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      const pleat = detail === HIGH ? (s % 2 ? 1 : 0) * 0.012 * r : 0;
      pos.push(-len * t, Math.sin(a) * (r + pleat), Math.cos(a) * (r + pleat));
    }
  }
  const cols = seg + 1;
  for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) { const a = i * cols + s; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Face outward.
  const n = g.attributes.normal; const p = g.attributes.position;
  const mid = (Math.floor(rings / 2) * cols + 2);
  if (n.getY(mid) * p.getY(mid) + n.getZ(mid) * p.getZ(mid) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.computeVertexNormals(); }
  parts.add('exhaust', std(g), m);
  // Inner liner (visible inside the exit) and the afterburner ring/flame-holder.
  if (liner) {
    // Double-sided dark liner plus a turbine face deep inside, so nothing can be seen through the exit from behind.
    parts.add('intake', revolve([[-len * 0.98, r1 * 0.97], [-len * 0.4, r0 * 0.95], [0, r0 * 0.9]], 20), m);
    parts.add('intake', std(new THREE.CircleGeometry(r0 * 0.92, 20)), T(x - len * 0.12, y, z, 0, -Math.PI / 2, 0));
    parts.add('steel', std(new THREE.ConeGeometry(r0 * 0.34, len * 0.34, 16).rotateZ(Math.PI / 2)), T(x - len * 0.2, y, z));
    if (detail > LOW) {
      parts.add('steel', revolve([[-len * 0.35, r0 * 0.78], [-len * 0.35, r0 * 0.62], [-len * 0.4, r0 * 0.62], [-len * 0.4, r0 * 0.78]], 16), m);
      parts.add('exhaust', std(new THREE.TorusGeometry(r1 * 0.92, r1 * 0.035, 6, 24).rotateY(Math.PI / 2)), T(x - len * 0.995, y, z));
    }
  }
}

/** Afterburner flame group for the rig: origin at the nozzle exit, flame along -X. Returns { group, mat }. */
export function burnerFlame(radius, length) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const group = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.98, length, 20, 1, true), mat);
  outer.rotation.z = Math.PI / 2; outer.position.x = -length / 2;
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const core = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.55, length * 0.6, 16, 1, true), coreMat);
  core.rotation.z = Math.PI / 2; core.position.x = -length * 0.3;
  const hot = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.3, length * 0.28, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  hot.rotation.z = Math.PI / 2; hot.position.x = -length * 0.14;
  group.add(outer, core, hot);
  // Shock diamonds.
  for (let i = 1; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(radius * (0.34 - i * 0.05), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    d.scale.set(1.6, 1, 1); d.position.x = -length * (0.12 + i * 0.18);
    group.add(d);
  }
  group.visible = false;
  return { group, mat };
}

/** Short-range missile along +X (nose forward): body, seeker, four fins and canard fins. Origin at the middle of the body. */
export function missileParts(parts, { x, y, z, len = 2.9, r = 0.063, detail = HIGH, paint = 'radome' }) {
  const m = T(x, y, z);
  parts.add(paint, revolve([[-len * 0.5, r * 0.85], [-len * 0.45, r], [len * 0.35, r], [len * 0.4, r * 0.92], [len * 0.47, r * 0.55], [len * 0.5, 0.002]], 14), m);
  parts.add('dark', revolve([[len * 0.38, r * 0.96], [len * 0.4, r * 0.92], [len * 0.47, r * 0.55], [len * 0.5, 0.002]], 14), m);
  if (detail > LOW) {
    const fin = (px, span, chord, rot) => parts.add('steel', std(new THREE.BoxGeometry(chord, span, 0.006)), T(x + px, y, z, rot, 0, 0).multiply(new THREE.Matrix4().makeTranslation(0, r + span / 2 - 0.005, 0)));
    for (let i = 0; i < 4; i++) { fin(-len * 0.4, 0.17, 0.32, (i * Math.PI) / 2); fin(len * 0.2, 0.09, 0.18, (i * Math.PI) / 2 + Math.PI / 4); }
    parts.add('black', std(new THREE.CylinderGeometry(r * 1.0, r * 1.0, 0.02, 12)).rotateZ(Math.PI / 2), T(x + len * 0.12, y, z));
  }
}

/** Launcher rail with a pylon stub. */
export function railParts(parts, { x, y, z, len = 2.2 }) {
  parts.add('steel', roundedBox(len, 0.045, 0.08, 0.01), T(x, y, z));
  parts.add('steel', roundedBox(len * 0.5, 0.08, 0.05, 0.01), T(x, y + 0.04, z));
}

/** Bow of a canopy frame: an arch around the X axis at station x, from angle a0 to a1 (radians about +X from +Z). */
export function canopyBow(parts, body, x, a0, a1, lift = 0.012, width = 0.04) {
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(body.at(x, a, lift).p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  parts.add('dark', std(new THREE.TubeGeometry(curve, n * 2, width, 6, false)));
}

/** Ejection seat silhouette with a head, headrest and parachute box, origin at the seat base. */
export function seatParts(parts, { x, y, z = 0, scale = 1 }) {
  const s = scale;
  parts.add('trim', roundedBox(0.34 * s, 0.1 * s, 0.38 * s, 0.03), T(x, y, z));
  parts.add('trim', roundedBox(0.1 * s, 0.62 * s, 0.4 * s, 0.04), T(x - 0.2 * s, y + 0.32 * s, z, 0, 0, 0.12));
  parts.add('dark', roundedBox(0.14 * s, 0.14 * s, 0.34 * s, 0.04), T(x - 0.22 * s, y + 0.72 * s, z));
  parts.add('metal', sphereG(0.115 * s, 12, 8), T(x - 0.05 * s, y + 0.62 * s, z)); // helmet
  parts.add('dark', roundedBox(0.12 * s, 0.3 * s, 0.34 * s, 0.04), T(x - 0.02 * s, y + 0.28 * s, z)); // torso
}

/** Instrument coaming and glare-shield blocks seen through the canopy. */
export function coamingParts(parts, { x, y, w = 0.9, d = 0.5 }) {
  parts.add('dark', roundedBox(d, 0.22, w, 0.03), T(x, y, 0));
  parts.add('black', roundedBox(0.12, 0.04, w * 0.96, 0.01), T(x + d * 0.3, y + 0.13, 0));
}

export { HIGH, LOW, MEDIUM, cylX, loftBody, tubeBetween, vec, extrudeShape };
