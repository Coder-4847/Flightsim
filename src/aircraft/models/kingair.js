import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, bodyPatch, hingedSurface, loftBody, roundedBox, sectionAt, setUV0, std, tubeBetween, vec, wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, makeProPropeller, probeGeometry, whipGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { paintAtlas } from './paintkit.js';
import { paintBody, quadAt, rad, mirrorQuad } from './bodypaint.js';
import { newRig } from './common.js';

// Regal 200 (Beechcraft King Air 200 analogue): pressurised twin turboprop, low wing, T-tail, retractable gear.
// Length 13.3 m, span 16.6 m.

registerPro(['kingair'], 'flush');

const S = (x, w, yTop, yBot, n = 2.2) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-6.7, 0.03, 0.52, 0.36, 2),
  S(-6.0, 0.12, 0.58, 0.2, 2),
  S(-4.8, 0.3, 0.66, -0.2, 2.1),
  S(-3.5, 0.55, 0.78, -0.55, 2.1),
  S(-2.3, 0.72, 0.85, -0.78, 2.1),
  S(-1.0, 0.77, 0.87, -0.83, 2.1),
  S(1.8, 0.77, 0.87, -0.83, 2.1),
  S(3.0, 0.72, 0.83, -0.79, 2.1),
  S(4.2, 0.6, 0.7, -0.68, 2.1),
  S(5.2, 0.4, 0.5, -0.5, 2.1),
  S(6.0, 0.2, 0.26, -0.3, 2.1),
  S(6.5, 0.07, 0.1, -0.15, 2),
  S(6.62, 0.01, 0.015, -0.03, 2),
];
const WING = [
  { z: 0.7, x: -0.1, y: -0.34, chord: 2.3, t: 0.17, camber: 0.025, cp: 0.4 },
  { z: 2.6, x: -0.15, y: -0.26, chord: 2.05, t: 0.15, camber: 0.025, cp: 0.4 },
  { z: 4.2, x: -0.2, y: -0.16, chord: 1.75, t: 0.13, camber: 0.022, cp: 0.4, twist: -0.5 },
  { z: 8.3, x: -0.35, y: 0.1, chord: 1.02, t: 0.105, camber: 0.018, cp: 0.4, twist: -2.5 },
];
const STAB = [
  { z: 0.1, x: -6.2, y: 3.0, chord: 1.25, t: 0.09 },
  { z: 2.75, x: -6.75, y: 3.06, chord: 0.78, t: 0.075 },
];
const FIN = [
  { z: 0, x: -4.4, y: 0, chord: 2.45, t: 0.1 },
  { z: 2.45, x: -6.05, y: 0, chord: 1.15, t: 0.08 },
];
const FIN_BASE = 0.55;
const HINGE = 0.68;
const FLAPS = [[0.85, 2.15], [3.1, 5.0]];
const AIL = [5.3, 8.0];
const finHinge = (z) => {
  const s = sectionAt(FIN, z);
  const xh = -6.3 + (-6.75 + 6.3) * (z / 2.45);
  return (s.x - xh) / s.chord;
};
const ENGINES = [{ x: 1.85, y: 0, z: -2.6 }, { x: 1.85, y: 0, z: 2.6 }];
const CABIN = [-3.0, -2.2, -1.4, -0.6, 0.2, 1.0].map((x) => quadAt(x, 0.19, 12, 36));
const COCKPIT = [[3.25, 14], [4.1, 14], [4.05, 44], [3.3, 46]];
const WINDSHIELD = [[3.9, 38], [4.7, 52], [4.7, 128], [3.9, 142]];
const AIRSTAIR = [[-3.8, -20], [-2.6, -20], [-2.6, 46], [-3.8, 46]]; // left side only
const EXIT_R = [[-0.2, 8], [0.4, 8], [0.4, 40], [-0.2, 40]]; // right side emergency exit

export function buildKingAir(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;

  const body = loftBody(STATIONS, { detail, step: 0.3 });
  if (!mats.__painted) {
    const rise = (x) => Math.max(0, -3.2 - x) * 4.5;
    const skinTex = paintBody(mats, body, spec, {
      base: L.base, belly: L.belly, bellyAngle: -30,
      ribbons: [
        { lo: (x) => -5 + rise(x) * 0.8 + Math.max(0, x - 3) * 7, hi: (x) => 6 + rise(x) + Math.max(0, x - 3) * 8, color: L.stripe ?? '#17365f', x0: -6.5, x1: 6.2 },
        { lo: (x) => 8 + rise(x) + Math.max(0, x - 3) * 8, hi: (x) => 10.5 + rise(x) + Math.max(0, x - 3) * 8.5, color: L.stripe2 ?? '#c9a24a', x0: -6.5, x1: 6.2 },
      ],
      rings: [-3.8, -2.6, 3.1, 5.0],
      windows: CABIN, frames: [{ quad: COCKPIT }], single: [WINDSHIELD],
      seams: [[-3.8, -20, -3.8, 46], [-2.6, -20, -2.6, 46], [-3.8, 46, -2.6, 46], [-3.8, -20, -2.6, -20], [4.4, -10, 5.2, -10], [4.4, 30, 5.2, 30], [4.4, -10, 4.4, 30], [5.2, -10, 5.2, 30]],
      lines: [{ x0: 3.9, a0: 90, x1: 4.7, a1: 90, width: 5 }],
      regs: [{ x: -4.6, a: 30, size: 0.34, stretch: 1.0 }],
      stencils: [{ str: 'REGAL 200', x: 5.2, a: 4, size: 0.07 }, { str: 'NO STEP', x: -1.4, a: -38, size: 0.05, color: '#a02020' }],
      dirt: { streaks: [{ x: 1.8, a: -46, len: 3.6, w: 0.12, alpha: 0.2 }, { x: 1.4, a: 8, len: 3.2, w: 0.07, alpha: 0.16 }], mottle: 0.1 },
      ao: [{ x: -0.4, a: -45, rx: 1.6, ry: 0.2, alpha: 0.16 }, { x: -5.0, a: 0, rx: 0.8, ry: 0.12, alpha: 0.1 }],
    });
    const wb = L.wing ?? L.base;
    const atlas = paintAtlas(mats, wb, { wing: { span: 7.8, chord: 2.4, z0: 0.7 }, stab: { span: 2.8, chord: 1.3, z0: 0 }, fin: { span: 2.5, chord: 2.6, z0: 0 } }, {
      wing: {
        sections: WING, z0: 0.7, z1: 8.3, base: wb, under: shade(wb, -0.1),
        seams: [...FLAPS.map(([a, b]) => ({ z0: a, z1: b, xf: HINGE })), { z0: AIL[0], z1: AIL[1], xf: HINGE }],
        boots: { len: 0.2, z0: 0.8, z1: 8.2 }, walkway: { z0: 0.8, z1: 2.1, p0: 0.7, p1: 1.1 }, caps: [{ z: 3.6, p: 0.6 }],
        tip: { color: shade(L.stripe ?? '#17365f', 0.0), len: 0.35 }, dirt: 0.55,
        text: [{ str: 'NO STEP', z: 3.0, p: 1.1, size: 0.05, color: '#aa2222' }],
        seed: 51,
      },
      stab: { sections: STAB, z0: 0.1, z1: 2.75, base: wb, under: shade(wb, -0.08), seams: [{ z0: 0.12, z1: 2.7, xf: 0.6 }], boots: { len: 0.12, z0: 0.1, z1: 2.7 }, dirt: 0.5, seed: 6 },
      fin: {
        sections: FIN, z0: 0, z1: 2.45, base: wb, under: wb, seams: [{ z0: 0.12, z1: 2.45, xf: finHinge }], boots: { len: 0.12, z0: 0.15, z1: 2.4 }, dirt: 0.5, seed: 9,
        stripes: [{ p0: -0.8, p1: 1.4, color: L.stripe ?? '#17365f', z0: 0.5, z1: 1.2, both: true }, { p0: -0.8, p1: 1.4, color: L.stripe2 ?? '#c9a24a', z0: 1.28, z1: 1.4, both: true }],
      },
    });
    mats.__painted = { skinTex, atlas };
  }
  const { atlas } = mats.__painted;
  const uvW = atlas.rects.wing.uv; const uvS = atlas.rects.stab.uv; const uvF = atlas.rects.fin.uv;
  const skinMesh = new THREE.Mesh(body.geo, mats.skin);
  exterior.add(skinMesh);
  const fixed = new Parts(mats);
  const ext = new Parts(mats);

  if (MID) {
    const patch = (q, mat = 'glass') => ext.add(mat, bodyPatch(body, rad(q), { lift: 0.004, p: 4, nu: HI ? 12 : 4, nv: HI ? 8 : 3 }));
    patch(WINDSHIELD); patch(COCKPIT); patch(mirrorQuad(COCKPIT));
    for (const q of CABIN) { patch(q, 'window'); patch(mirrorQuad(q), 'window'); }
    if (HI) {
      for (const s of [-1, 1]) {
        ext.add('trim', roundedBox(0.16, 0.6, 0.5, 0.05), T(3.4, 0.05, s * 0.38));
        ext.add('dark', roundedBox(0.7, 0.3, 0.5, 0.04), T(4.3, 0.22, s * 0.3));
      }
      for (const x of [-2.6, -0.6, 0.6]) ext.add('trim', roundedBox(0.24, 0.5, 1.0, 0.05), T(x, 0.0, 0));
    }
  }

  // Wings, flaps and ailerons.
  const tipR = 0.1;
  fixed.addPair('wing', wingSurface(WING, 0.7, 8.3, { xf0: 0, xf1: HINGE, detail, tipRound: tipR, map: uvW, dz: 0.8 }));
  fixed.addPair('wing', wingSurface(WING, FLAPS[0][1], FLAPS[1][0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, FLAPS[1][1], AIL[0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, AIL[1], 8.3, { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, tipRound: tipR, map: uvW }));
  for (const side of [1, -1]) {
    for (const [a, b] of FLAPS) {
      const flap = hingedSurface(WING, a, b, HINGE, mats.wing, { detail, side, map: uvW });
      root.add(flap.pivot);
      rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    }
    const ail = hingedSurface(WING, AIL[0], AIL[1], HINGE, mats.wing, { detail, side, map: uvW });
    root.add(ail.pivot);
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
  }
  // T-tail.
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 2.45, { xf0: 0, xf1: finHinge, detail, tipRound: 0.07, map: uvF }), finM);
  const rud = hingedSurface(FIN, 0.12, 2.45, finHinge, mats.wing, { detail, m: finM, side: 1, map: uvF, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });
  fixed.addPair('wing', wingSurface(STAB, 0.1, 2.75, { xf0: 0, xf1: 0.6, detail, tipRound: 0.06, map: uvS }));
  for (const side of [1, -1]) {
    const el = hingedSurface(STAB, 0.1, 2.75, 0.6, mats.wing, { detail, side, map: uvS });
    root.add(el.pivot);
    rig.elevators.push({ pivot: el.pivot, axis: el.axis });
  }
  if (MID) {
    fixed.add('wing', setUV0(std(new THREE.SphereGeometry(0.2, 12, 8)), 0.0015, 0.0015), T(-6.4, 3.02, 0, 0, 0, 0, 1.5, 0.35, 0.4)); // stab/fin junction fairing
  }

  // Nacelles, exhausts and propellers (props in engine order: left then right).
  for (const e of ENGINES) {
    const s = Math.sign(e.z);
    if (MID) {
      const nac = loftBody([
        { x: -2.8, w: 0.1, top: 0.12, bottom: 0.1, yc: 0.02, n: 2 },
        { x: -2.0, w: 0.3, top: 0.32, bottom: 0.3, yc: 0.0, n: 2.2 },
        { x: -0.8, w: 0.44, top: 0.46, bottom: 0.46, yc: 0.0, n: 2.3 },
        { x: 0.6, w: 0.47, top: 0.48, bottom: 0.5, yc: 0.0, n: 2.3 },
        { x: 1.4, w: 0.44, top: 0.45, bottom: 0.5, yc: 0.0, n: 2.2 },
        { x: 1.86, w: 0.36, top: 0.36, bottom: 0.38, yc: 0.0, n: 2.1 },
        { x: 2.0, w: 0.22, top: 0.22, bottom: 0.22, yc: 0.0, n: 2.1 },
        { x: 2.03, w: 0.06, top: 0.06, bottom: 0.06, yc: 0.0, n: 2 },
        { x: 2.035, w: 0.01, top: 0.01, bottom: 0.01, yc: 0.0, n: 2 },
      ], { detail, step: 0.4 });
      fixed.add('wing', setUV0(std(nac.geo.clone()), 0.0015, 0.0015), T(0, 0, e.z));
      fixed.add('intake', bodyPatch(nac, rad([[1.52, -128], [1.88, -128], [1.88, -52], [1.52, -52]]), { lift: 0.004, p: 2.6, nu: 10, nv: 8 }), T(0, 0, e.z));
      for (const dz of [-0.17, 0.17]) {
        fixed.add('exhaust', tubeBetween(vec(1.15, 0.34, e.z + dz * 1.7), vec(0.5, 0.52, e.z + dz * 2.4), 0.04, 0.06, 10));
      }
      fixed.add('black', roundedBox(0.4, 0.02, 0.2, 0.006), T(-1.4, -0.46, e.z));
    }
    const prop = makeProPropeller({
      blades: 4, radius: 1.18, hubR: 0.13,
      chord: (f) => (f < 0.25 ? 0.12 + f * 0.5 : 0.25 - (f - 0.25) * 0.1 - Math.max(0, f - 0.85) * 0.6),
      beta: (f) => 50 - 40 * f + 8 * f * f, thick: (f) => 0.17 - 0.11 * Math.min(1, f), sweep: (f) => 0.05 * f * f, camber: 0.055,
      spinner: [[0.4, 0.001], [0.36, 0.05], [0.26, 0.12], [0.12, 0.17], [0.02, 0.19], [0, 0.19]],
      tipColor: L.tip, tipLen: 0.08,
    }, mats, detail);
    prop.position.set(e.x + 0.18, e.y, e.z);
    root.add(prop);
    rig.props.push(prop);
  }

  // Antennas, probes, lights.
  if (MID) {
    fixed.add('black', bladeAntennaGeometry(0.28, 0.12, 0.014), T(-0.6, 0.87, 0));
    fixed.add('black', bladeAntennaGeometry(0.22, 0.1, 0.014), T(-1.8, -0.83, 0, 0, 0, Math.PI));
    if (HI) {
      fixed.add('black', whipGeometry(0.45, 0.005, 0.5), T(-2.2, 0.85, 0.2));
      fixed.add('metal', probeGeometry(0.4, 0.012), T(4.6, -0.1, 0.5));
      fixed.add('metal', probeGeometry(0.4, 0.012), T(4.6, -0.1, -0.5));
      fixed.add('black', roundedBox(0.3, 0.12, 0.2, 0.03), T(5.6, 0.0, 0)); // radome bulge line
    }
  }
  const tip = sectionAt(WING, 8.3);
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    nav.position.set(tip.x - 0.1, tip.y + 0.03, s * 8.3);
    root.add(nav); rig.lights.nav.push(nav);
    const strobe = glowLight(0xffffff, 0.05, 0.9);
    strobe.position.set(tip.x - 0.8, tip.y + 0.03, s * 8.25);
    root.add(strobe); rig.lights.strobes.push(strobe);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.04, 1.3), T(tip.x - 0.1, tip.y + 0.01, s * 8.3));
    const landing = glowLight(0xfff3d0, 0.07, 0.9);
    landing.position.set(0.15, -0.2, s * 3.3);
    root.add(landing); rig.lights.landing.push(landing);
  }
  const beacon = glowLight(0xff2a2a, 0.05, 1.0);
  beacon.position.set(-5.8, FIN_BASE + 1.9, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);
  const tailNav = glowLight(0xffffff, 0.045, 0.6);
  tailNav.position.set(-6.72, 0.45, 0);
  root.add(tailNav); rig.lights.nav.push(tailNav);

  // Retractable tricycle gear.
  const g = spec.gear;
  const noseAttach = -0.5;
  const noseLeg = makeProGearLeg({ length: noseAttach - g.nose.y, strutR: 0.042, wheelRadius: 0.24, wheelWidth: 0.13, fork: 'single', outerFrac: 0.5, lightMount: [0.1, -0.45, 0] }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  const mainAttach = -0.55;
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = makeProGearLeg({ length: mainAttach - pos.y, strutR: 0.05, wheelRadius: 0.36, wheelWidth: 0.22, fork: 'single', outerFrac: 0.5, brake: true, drag: 0.4, linkDir: -1 }, mats, detail);
    leg.position.set(pos.x, mainAttach, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: Math.PI / 2 });
    if (MID) {
      const door = new THREE.Object3D();
      door.position.set(pos.x, mainAttach - 0.04, pos.z + side * 0.3);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(1.0, 0.02, 0.36)), 0.0015, 0.0015), T(0, 0, -side * 0.18));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.15 });
    }
  }
  if (MID) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x, noseAttach - 0.2, s * 0.16);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(0.7, 0.015, 0.16)), 0.0015, 0.0015), T(0, 0, -s * 0.08));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void AIRSTAIR; void EXIT_R;
  return { group: root, rig };
}
