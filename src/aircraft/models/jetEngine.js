import * as THREE from 'three';
import {
  DEG, TAU, boxGeo, clamp, cylinderGeo, disc, loftFrames, merge, placed, revolve, std,
} from './jetKit.js';

// Turbofan nacelles with real inlet lips, a visible fan (blades + spinner), fan nozzle, core cowl and plug, pylons.

/** One twisted fan blade as geometry about the X axis (blade along +Y), unrotated. */
function fanBlade(R, hub, chordTip, chordRoot, bladeAngle, thickness, detail = 2) {
  const frames = [];
  const n = detail > 1 ? 5 : 3;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = hub + (R - hub) * t;
    const chord = chordRoot + (chordTip - chordRoot) * t;
    const twist = (70 - 38 * t) * DEG + bladeAngle; // blade stagger: steeper near the hub
    // chord direction lies in the plane normal to the radial axis (x-z plane)
    const cv = new THREE.Vector3(-Math.cos(twist), 0, Math.sin(twist)).multiplyScalar(chord);
    const u = new THREE.Vector3(Math.sin(twist), 0, Math.cos(twist));
    frames.push({ p: new THREE.Vector3(chord * 0.1 * Math.cos(twist), r, -chord * 0.5 * Math.sin(twist)), c: cv, u, t: thickness * (1 - 0.5 * t), m: 0.03, v: t });
  }
  return loftFrames(frames, { nChord: detail > 1 ? 4 : 2, capStart: true, capEnd: true, crease: 50 });
}

/** The rotating assembly (blades + spinner) in a Group about X; userData.disc = translucent blur disc. */
export function makeFanAssembly(R, J, detail, { blades = 24, spinnerLen = R * 0.55, spinnerR = R * 0.3, spinnerMat = null } = {}) {
  const group = new THREE.Group();
  const count = detail > 1 ? blades : detail > 0 ? Math.round(blades * 0.6) : Math.round(blades * 0.4);
  if (detail > 0) {
    const bl = fanBlade(R * 0.985, spinnerR * 0.9, R * 0.3, R * 0.2, 0, 0.07, detail);
    const geos = [];
    for (let i = 0; i < count; i++) geos.push(placed(bl, 0, 0, 0, (i / count) * TAU, 0, 0));
    const bm = new THREE.Mesh(merge(geos), J.fanBlade);
    group.add(bm);
  }
  const spinner = new THREE.Mesh(revolve([
    [spinnerLen, 0.002], [spinnerLen * 0.88, spinnerR * 0.38], [spinnerLen * 0.55, spinnerR * 0.78], [spinnerLen * 0.18, spinnerR * 0.97], [0, spinnerR], [-0.05, spinnerR],
  ], detail > 0 ? 28 : 12, { crease: 70 }), spinnerMat ?? J.nacelle);
  group.add(spinner);
  const blur = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.97, detail > 0 ? 28 : 12),
    new THREE.MeshBasicMaterial({ color: 0x3a3f46, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  blur.rotation.y = Math.PI / 2;
  blur.position.x = 0.1;
  group.add(blur);
  group.userData.disc = blur;
  return group;
}

/**
 * Nacelle centred at the engine position (x forward). e: { r, len, rHi, fanR, fanAt (fraction from front), nozzleAt, coreAt, plugAt, rn, rc }.
 * Static geometry is added to `parts`; returns the fan group (positioned in the nacelle frame, to be added to the root by the caller).
 */
export function buildNacelle(e, J, detail, parts, at) {
  const { r, len } = e;
  const xf = len / 2; // front
  const seg = detail > 1 ? 44 : detail > 0 ? 24 : 12;
  const rHi = e.rHi ?? r * 0.88;
  const rn = e.rn ?? r * 0.74; // fan nozzle exit radius
  const xFanNozzle = xf - len * (e.nozzleAt ?? 0.68);
  const xCore = xf - len * (e.coreAt ?? 0.88);
  const xPlug = xf - len;
  const rc = e.rc ?? r * 0.5;
  const xFan = xf - (e.fanDepth ?? Math.min(0.65, len * 0.15));
  const fanR = e.fanR ?? rHi * 0.94;
  const place = (geo, mat) => parts.add(mat, geo, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
  if (detail === 0) {
    // Cheap pod: a cowl, a dark intake face and a plug.
    const prof = [[xf - 0.02, rHi + 0.04], [xf - len * 0.2, r], [xf - len * 0.55, r * 0.97], [xFanNozzle, rn]];
    place(revolve(prof, seg, { crease: 70 }), J.nacelle);
    place(disc(xf - 0.12, 0.001, rHi, seg, 1), J.intake);
    place(revolve([[xFanNozzle + 0.02, rc * 1.1], [xCore, rc * 0.5], [xPlug, 0.01]], seg, { crease: 70 }), J.hot);
    const fanLow = makeFanAssembly(fanR, J, 0, { blades: 0 });
    fanLow.position.set(at.x + xf - 0.14, at.y, at.z);
    return { fan: fanLow, extent: { front: at.x + xf, back: at.x + xPlug, rMax: r } };
  }

  // Outer cowl (painted): from just behind the lip to the fan nozzle.
  const outer = [];
  const nOut = detail > 1 ? 14 : 8;
  for (let i = 0; i <= nOut; i++) {
    const t = i / nOut;
    const x = xf - 0.04 - (xf - 0.04 - xFanNozzle) * t;
    // radius: grows quickly to r at ~25% then holds and tapers
    const grow = clamp(t / 0.28, 0, 1);
    let rad = rHi + 0.05 + (r - rHi - 0.05) * Math.sin((grow * Math.PI) / 2);
    if (t > 0.55) rad = rad - (rad - rn) * ((t - 0.55) / 0.45) ** 1.7;
    outer.push([x, rad]);
  }
  place(revolve(outer, seg, { crease: 60 }), J.nacelle);
  // Inlet lip ring (bare metal).
  const lipProfile = [];
  const rl = 0.055;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (i / 10);
    lipProfile.push([xf - 0.04 + Math.sin(a) * rl, rHi + rl - rl * Math.cos(a)]);
  }
  place(revolve(lipProfile, seg, { crease: 80 }), J.engineMetal);
  // Inner duct.
  place(revolve([
    [xf - 0.04, rHi], [xf - 0.3, rHi * 0.985], [xf - 0.6, (rHi + fanR) / 2], [xFan, fanR * 1.005],
  ], seg, { crease: 80 }), J.intake);
  // Dark disc behind the fan.
  place(disc(xFan - 0.34, 0.001, fanR * 1.01, seg, 1), J.intake);
  // Fan nozzle ring and core cowl.
  const core = [
    [xFanNozzle + 0.02, rn * 0.9], [xFanNozzle - 0.05, rn * 0.8], [xFanNozzle - 0.3, rc * 1.12], [xCore + 0.1, rc * 0.72], [xCore, rc * 0.5], [xPlug + 0.25, rc * 0.2], [xPlug, 0.01],
  ];
  place(revolve(core, seg, { crease: 55 }), J.hot);
  const nozzleOuter = revolve([[xFanNozzle + 0.02, rn], [xFanNozzle - 0.06, rn * 0.9], [xFanNozzle - 0.06, rc * 1.15]], seg, { crease: 70 });
  place(nozzleOuter, J.hot);
  // The fan assembly sits in the nacelle frame at x = xFan.
  const fan = makeFanAssembly(fanR, J, detail, { blades: e.blades ?? 24, spinnerMat: e.spinnerMat ?? J.nacelle });
  fan.position.set(at.x + xFan, at.y, at.z);
  return { fan, extent: { front: at.x + xf, back: at.x + xPlug, rMax: r } };
}

/** Pylon: a vertical airfoil joining the nacelle top to the wing underside. */
export function buildPylon(e, J, parts, at, wing, z, detail, side = 1) {
  const f = wing.frame(z);
  const wingLo = f.p.y - f.c.length() * f.t * 0.7; // inside the wing
  const yTop = f.p.y + f.rec.c * 0.0 - 0.1 + (wingLo - f.p.y) * 0 + 0.0;
  void yTop;
  const yBot = at.y + e.r * 0.55;
  const yUp = wingLo + f.c.length() * f.t * 1.0 + 0.2;
  const xFront = at.x + e.len * 0.5 * (e.pylonFront ?? 0.1);
  const xRear = at.x - e.len * (e.pylonRear ?? 0.62);
  const mk = (y, le, te, t) => ({
    p: new THREE.Vector3(le, y, at.z), c: new THREE.Vector3(te - le, 0, 0), u: new THREE.Vector3(0, 0, 1), t, m: 0, v: 0,
  });
  const leTop = Math.max(f.p.x - 0.2, xFront + 0.6);
  const frames = [
    mk(yBot, xFront, xRear, 0.09),
    mk((yBot + yUp) / 2, (xFront + leTop) / 2, xRear + 0.05, 0.085),
    mk(yUp, leTop, xRear + 0.15, 0.075),
  ];
  parts.add(J.wing, loftFrames(frames, { nChord: detail > 1 ? 16 : 8, capStart: false, capEnd: false, crease: 50 }));
  void side;
  void boxGeo;
  void cylinderGeo;
  void std;
}
