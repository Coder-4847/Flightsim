import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, TAU, std, tubeBetween, cylX, cylY, cylZ, revolve, vec, curve1, nacaThickness, nacaCamber, roundedBox, extrudeShape, sphereG,
} from './kit.js';
import { makeLight } from './builders.js';
import { canvas } from './skins.js';

// Detailed small assemblies: propellers, wheels and landing-gear legs, lights, antennas.

// ---- propellers ---------------------------------------------------------------------------------------------
/**
 * One propeller blade, root at the hub axis (blade along +Y, leading edge toward +Z, spinning about +X).
 * chord(r), beta(r) [degrees at radius fraction], thick(r) as curve1 functions of r/R; sweep(r) shifts the section aft (m).
 */
export function propBladeGeometry({
  radius, hubR = 0.1, chord, beta, thick, sweep = () => 0, camber = 0.05, detail = HIGH, shank = true,
}) {
  const nR = [4, 8, 14][detail];
  const nC = [4, 7, 12][detail];
  const pos = [];
  const idx = [];
  const rings = [];
  for (let i = 0; i <= nR; i++) {
    const f = i / nR;
    const r = hubR + (radius - hubR) * f;
    const fr = r / radius;
    // Round the tip.
    const tipK = f > 0.94 ? Math.sqrt(Math.max(0.0001, 1 - ((f - 0.94) / 0.06) ** 2)) : 1;
    const c = chord(fr) * tipK;
    const t = thick(fr) * (shank && fr < 0.2 ? 1 + (0.2 - fr) * 2.5 : 1);
    const b = (beta(fr) * Math.PI) / 180;
    const sw = sweep(fr);
    const ring = [];
    for (let j = 0; j <= nC * 2; j++) {
      const k = j <= nC ? j / nC : (2 * nC - j) / nC; // 0..1..0
      const xf = (1 - Math.cos(Math.PI * k)) / 2;
      const side = j <= nC ? -1 : 1; // lower (pressure) first then upper (suction)
      const yy = (nacaCamber(xf, camber, 0.4) + side * nacaThickness(xf, t)) * c;
      const xi = (xf - 0.3) * c + sw;
      const ax = -Math.sin(b) * xi + Math.cos(b) * yy;
      const cz = -Math.cos(b) * xi - Math.sin(b) * yy;
      ring.push([ax, r, cz]);
    }
    rings.push(ring);
  }
  const n = rings[0].length;
  for (const ring of rings) for (const p of ring) pos.push(...p);
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Outward check at mid blade.
  const mid = Math.floor(nR / 2) * n + Math.floor(n / 4);
  const pm = vec(pos[mid * 3], pos[mid * 3 + 1], pos[mid * 3 + 2]);
  const ctr = vec(0, pos[mid * 3 + 1], 0);
  for (const j of [0]) void j;
  const rc = rings[Math.floor(nR / 2)];
  ctr.x = rc.reduce((s, p) => s + p[0], 0) / n; ctr.z = rc.reduce((s, p) => s + p[2], 0) / n;
  const nm = vec(g.attributes.normal.getX(mid), g.attributes.normal.getY(mid), g.attributes.normal.getZ(mid));
  if (nm.dot(pm.sub(ctr)) < 0) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.computeVertexNormals();
  }
  return std(g);
}

const discTextures = new Map();
function discTexture(tip) {
  const key = String(tip);
  if (discTextures.has(key)) return discTextures.get(key);
  const c = canvas(128, 128);
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(60,64,70,0.9)');
  rg.addColorStop(0.18, 'rgba(70,74,80,0.55)');
  rg.addColorStop(0.5, 'rgba(100,104,110,0.45)');
  rg.addColorStop(0.86, 'rgba(120,124,130,0.5)');
  rg.addColorStop(0.9, `#${new THREE.Color(tip).getHexString()}`);
  rg.addColorStop(0.97, `#${new THREE.Color(tip).getHexString()}`);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shared = true;
  discTextures.set(key, t);
  return t;
}

/**
 * Propeller group rotating about +X (animation contract: userData.disc, userData.blades). `p`: {blades, radius, hubR,
 * chord, beta, thick, sweep, spinner: profile [[x, r]...] (x forward of the hub plane), tipColor, tipLen, backplate}
 */
export function makeProPropeller(p, mats, detail = HIGH) {
  const group = new THREE.Group();
  const blades = [];
  const radius = p.radius;
  const bladeGeo = propBladeGeometry({ ...p, detail, hubR: p.hubR ?? 0.1 });
  const parts = new Parts(mats);
  for (let i = 0; i < p.blades; i++) parts.add('prop', bladeGeo, T(0, 0, 0, (i / p.blades) * TAU, 0, 0));
  // Tip bands (painted tips) as slightly larger tip slices are cheaper as a second geometry.
  if (detail > LOW) {
    const tipGeo = propBladeGeometry({ ...p, detail: LOW, hubR: radius * (1 - (p.tipLen ?? 0.09)), thick: (f) => p.thick(f) * 1.04, chord: (f) => p.chord(f) * 1.02, shank: false });
    for (let i = 0; i < p.blades; i++) parts.add('propTip', tipGeo, T(0, 0, 0, (i / p.blades) * TAU, 0, 0));
  }
  // Hub, blade clamps and spinner.
  const spin = p.spinner ?? [[0.3, 0.001], [0.22, 0.09], [0.1, 0.15], [0, 0.17]];
  parts.add('metal', revolve(spin, detail > LOW ? 32 : 12));
  if (detail > LOW) {
    for (let i = 0; i < p.blades; i++) parts.add('steel', cylY(p.hubR * 0.9, p.hubR * 0.9, (p.hubR ?? 0.1) * 1.6, 12), T(0, (p.hubR ?? 0.1) * 0.9, 0, (i / p.blades) * TAU));
  }
  const meshes = parts.build(group);
  // Blades live in their own meshes so the rig can hide them behind the blur disc.
  const bladeMeshes = meshes.filter((m) => m.material === mats.prop || m.material === mats.propTip);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({ map: discTexture(mats.propTip.color.getHex()), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true }),
  );
  disc.rotation.y = Math.PI / 2;
  group.add(disc);
  group.userData.disc = disc;
  group.userData.blades = bladeMeshes;
  return group;
}

// ---- wheels -------------------------------------------------------------------------------------------------------
/** Tyre: lathe about the Z axis, tread in the middle, UV (u around, v across) for the shared tyre texture. */
export function tireGeometry(radius, width, rimR, segs = 28) {
  const w2 = width / 2;
  const sh = (radius - rimR) * 0.22; // shoulder rounding
  const prof = [];
  // from inner bead, up the sidewall, across the tread, down the outer sidewall (r, axial)
  const side = (s) => {
    const pts = [];
    pts.push([rimR + 0.004, s * (w2 * 0.62)]);
    pts.push([rimR + (radius - rimR) * 0.3, s * (w2 * 0.98)]);
    pts.push([rimR + (radius - rimR) * 0.62, s * w2]);
    pts.push([radius - sh * 0.55, s * (w2 * 0.9)]);
    return pts;
  };
  const inner = side(-1);
  const outer = side(1).reverse();
  prof.push(...inner);
  const tread = 6;
  for (let i = 0; i <= tread; i++) {
    const a = -1 + (2 * i) / tread;
    prof.push([radius - sh * 0.12 * a * a, a * w2 * 0.74]);
  }
  prof.push(...outer);
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateX(Math.PI / 2);
  return std(g);
}

/**
 * Wheel group (spins about its local Z). Returns the group; tyre + hub merge into two meshes.
 * o: {radius, width, rim (rim radius fraction), disc (brake disc radius fraction or 0), spokes (bolt count)}
 */
export function makeWheelGroup(o, mats, detail = HIGH) {
  const group = new THREE.Group();
  const r = o.radius; const w = o.width;
  const rimR = r * (o.rim ?? 0.55);
  const tire = new THREE.Mesh(tireGeometry(r, w, rimR, detail === HIGH ? 40 : detail === MEDIUM ? 22 : 12), mats.tire);
  group.add(tire);
  if (detail > LOW) {
    const parts = new Parts(mats);
    // Rim barrel and hub face with bolts.
    parts.add('hub', cylZ(rimR + 0.002, rimR + 0.002, w * 0.9, detail === HIGH ? 28 : 14, false));
    for (const s of [-1, 1]) {
      parts.add('hub', revolve([[0, 0.001], [0, rimR * 0.9]].map(([x, rr]) => [x, rr]), 20), T(0, 0, s * w * 0.46, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
      if (detail === HIGH) {
        parts.add('metal', cylZ(rimR * 0.2, rimR * 0.2, w * 0.14, 12), T(0, 0, s * w * 0.5));
        const nb = o.spokes ?? 6;
        for (let i = 0; i < nb; i++) {
          const a = (i / nb) * TAU;
          parts.add('steel', cylZ(rimR * 0.045, rimR * 0.045, w * 0.06, 6), T(Math.cos(a) * rimR * 0.68, Math.sin(a) * rimR * 0.68, s * w * 0.475));
        }
        // Rim lip ring
        parts.add('hub', std(new THREE.TorusGeometry(rimR * 1.0, w * 0.035, 6, 28)), T(0, 0, s * w * 0.46));
      }
    }
    if (o.disc) {
      parts.add('steel', cylZ(r * o.disc, r * o.disc, w * 0.05, 24), T(0, 0, w * 0.2 * (o.discSide ?? 1)));
    }
    parts.build(group);
  }
  return group;
}

// ---- landing gear legs ----------------------------------------------------------------------------------------------
/**
 * Detailed strut assembly hanging down -Y from its pivot. Animation contract (see aircraftView): leg.userData = {lower,
 * wheels}; `lower` slides up with strut compression, each wheel spins about Z.
 * o: {length, strutR, wheelRadius, wheelWidth, wheels: [[x, z], ...], axleZ..., links (torque links), brake, brakeDisc,
 *     steer (nose: adds a steering collar), fork ('single'|'double'|'bogie'), pistonFrac}
 */
export function makeProGearLeg(o, mats, detail = HIGH) {
  const pivot = new THREE.Group();
  const lower = new THREE.Group();
  const L = o.length;
  const sr = o.strutR ?? 0.04;
  const wr = o.wheelRadius;
  const ww = o.wheelWidth;
  const axleY = -L + wr;
  const outerLen = L * (o.outerFrac ?? 0.5);
  const seg = detail === HIGH ? 18 : detail === MEDIUM ? 10 : 6;
  const up = new Parts(mats);
  const lo = new Parts(mats);
  // Outer cylinder (fixed) and chrome piston (moving).
  up.add('steel', cylY(sr * 1.55, sr * 1.65, outerLen, seg), T(0, -outerLen / 2, 0));
  if (detail > LOW) {
    up.add('steel', cylY(sr * 1.75, sr * 1.75, sr * 1.1, seg), T(0, -outerLen, 0)); // gland nut
    up.add('metal', cylY(sr * 1.9, sr * 1.9, sr * 0.9, seg), T(0, -sr * 0.5, 0)); // top fitting
    up.add('black', cylY(sr * 1.25, sr * 1.25, outerLen * 0.1, seg), T(0, -outerLen * 0.12, 0));
  }
  const pistonLen = (L - wr) - outerLen + sr * 2;
  lo.add('chrome', cylY(sr, sr, pistonLen + outerLen * 0.35, seg), T(0, -outerLen - pistonLen / 2 + outerLen * 0.175, 0));
  const wheelList = o.wheels ?? [[0, 0]];
  const forkW = o.forkSpan ?? Math.max(...wheelList.map((w) => Math.abs(w[1]))) * 2 + ww;
  const tw = o.track ?? 0;
  // Axle(s) and fork.
  const xs = [...new Set(wheelList.map((w) => w[0]))];
  if (detail > LOW) {
    for (const x of xs) {
      const zs = wheelList.filter((w) => w[0] === x).map((w) => w[1]);
      const span = Math.max(...zs.map(Math.abs)) * 2 + ww + 0.04;
      lo.add('steel', cylZ(sr * 0.7, sr * 0.7, span, 10), T(x, axleY, 0));
    }
    if (o.fork === 'single') {
      // Single-sided fork (nose gear): arm on the inboard side.
      lo.add('steel', std(new THREE.BoxGeometry(sr * 2.4, wr * 1.6, sr * 0.9)), T(0, axleY + wr * 0.55, ww * 0.5 + sr * 0.6));
      lo.add('steel', std(new THREE.BoxGeometry(sr * 2.4, wr * 1.6, sr * 0.9)), T(0, axleY + wr * 0.55, -ww * 0.5 - sr * 0.6));
      lo.add('steel', cylY(sr * 1.25, sr * 1.25, wr * 0.8, 10), T(0, axleY + wr * 1.05, 0));
    } else if (o.fork === 'bogie') {
      const span = Math.max(...xs) - Math.min(...xs);
      lo.add('steel', std(new THREE.BoxGeometry(span + sr * 3, sr * 2.4, sr * 3)), T((Math.max(...xs) + Math.min(...xs)) / 2, axleY + wr * 0.7, 0));
      lo.add('steel', cylY(sr * 1.3, sr * 1.3, wr * 0.8, 10), T(0, axleY + wr * 0.85, 0));
    } else {
      // Double fork: legs either side of the wheel pair.
      lo.add('steel', cylY(sr * 1.15, sr * 1.15, wr * 1.1, 10), T(0, axleY + wr * 0.62, 0));
      lo.add('steel', std(new THREE.BoxGeometry(sr * 2.2, sr * 1.6, forkW)), T(0, axleY + wr * 1.2, 0));
    }
  }
  // Torque links (scissors) between the fixed cylinder and the piston.
  if (o.links !== false && detail > LOW) {
    const top = vec(0.0, -outerLen * 0.82, 0);
    const mid = vec(0.0, -outerLen * 0.82 - L * 0.1, 0);
    const kx = (o.linkDir ?? 1) * sr * 4.5;
    up.add('steel', tubeBetween(vec(0, -outerLen * 0.55, 0), vec(kx, -outerLen * 0.8, 0), sr * 0.55, sr * 0.55, 8));
    up.add('steel', std(new THREE.BoxGeometry(sr * 3, sr * 0.9, sr * 2.4)), T(kx * 0.5, -outerLen * 0.62, 0));
    lo.add('steel', tubeBetween(vec(kx, -outerLen * 0.8, 0), vec(0, -outerLen * 0.95, 0), sr * 0.5, sr * 0.5, 8));
    void top; void mid;
  }
  if (o.drag) { // drag brace on retractable mains
    up.add('steel', tubeBetween(vec(0, -outerLen * 0.55, 0), vec(-o.drag, -outerLen * 0.1, 0), sr * 0.6, sr * 0.6, 8));
  }
  if (o.lightMount && detail > LOW) up.add('black', roundedBox(0.16, 0.1, 0.12, 0.02), T(o.lightMount[0], o.lightMount[1], o.lightMount[2]));
  if (o.fender && detail > LOW) { // nose fender/mudguard over a nosewheel
    up.add('steel', std(new THREE.CylinderGeometry(wr * 1.18, wr * 1.18, ww * 1.5, 20, 1, true, -Math.PI * 0.45, Math.PI * 0.9)), T(0, axleY, 0, Math.PI / 2, Math.PI, 0));
  }
  up.build(pivot);
  lo.build(lower);
  const wheelMeshes = [];
  for (const [x, z] of wheelList) {
    const wheel = makeWheelGroup({ radius: wr, width: ww, rim: o.rim ?? 0.56, disc: o.brake ? 0.5 : 0, discSide: z >= 0 ? -1 : 1 }, mats, detail);
    wheel.position.set(x, axleY, z);
    lower.add(wheel);
    wheelMeshes.push(wheel);
    if (o.brake && detail > LOW) {
      const cal = new Parts(mats);
      cal.add('steel', roundedBox(wr * 0.38, wr * 0.22, ww * 0.35, 0.01), T(x - wr * 0.08, axleY + wr * 0.42, z + (z >= 0 ? -1 : 1) * ww * 0.3));
      cal.build(lower);
    }
  }
  void tw;
  pivot.add(lower);
  pivot.userData = { lower, wheels: wheelMeshes, length: L };
  return pivot;
}

// ---- lights ----------------------------------------------------------------------------------------------------
/** Glow-sprite light (rig contract: group with userData {bulb, sprite, baseScale}); the lens is a separate static mesh. */
export const glowLight = (color, size = 0.05, glow = 1) => makeLight(color, size, glow);

/** Static lens geometry (a small flattened dome) for a navigation/strobe/beacon light. */
export function lensGeometry(r, sx = 1) {
  const g = std(new THREE.SphereGeometry(r, 12, 8, 0, TAU, 0, Math.PI / 2));
  g.scale(sx, 1, 1);
  return g;
}

/** Blade (shark-fin) antenna, `len` along X, `height` up. */
export function bladeAntennaGeometry(len, height, thick = 0.012) {
  return extrudeShape([[0, 0], [len, 0], [len * 0.75, height * 0.98], [len * 0.2, height], [len * 0.05, height * 0.6]], thick, thick * 0.3);
}

/** Pitot / probe: a cylinder with a tapered nose along +X. */
export function probeGeometry(len, r) {
  return revolve([[len, 0.0008], [len * 0.97, r * 0.6], [len * 0.88, r], [len * 0.2, r], [len * 0.12, r * 1.8], [0, r * 1.8]], 10);
}

/** Whip antenna: thin tapered rod, leaning aft. */
export function whipGeometry(len, r = 0.004, lean = 0.5) {
  return xfRod(len, r, lean);
}
function xfRod(len, r, lean) {
  const g = tubeBetween(vec(0, 0, 0), vec(-Math.sin(lean) * len, Math.cos(lean) * len, 0), r * 1.4, r * 0.7, 5);
  return g;
}

/** A plain painted material in the livery base colour, for fairings that must not carry the fuselage's windows and stripes. */
export function ensurePlain(mats, spec) {
  if (!mats.plain) {
    mats.plain = mats.skin.clone();
    mats.plain.map = null;
    mats.plain.color = new THREE.Color(spec.livery.base);
    mats.__envMats?.push(mats.plain);
  }
  return mats.plain;
}

export { cylX, curve1, sphereG };
