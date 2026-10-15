import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, airfoilStrut, bodyPatch, cylX, cylY, cylZ, hingedSurface, loftBody, roundedBox, sectionAt, setUV0, std, tubeBetween, vec,
  wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, makeProPropeller, makeWheelGroup, probeGeometry, whipGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { paintAtlas } from './paintkit.js';
import { paintBody, quadAt, rad, mirrorQuad } from './bodypaint.js';
import { newRig } from './common.js';

// Trekker 208 (Cessna 208 Caravan analogue): strut-braced high-wing single turboprop with a cargo pod and fixed gear.
// Length 11.5 m, span 15.88 m.

registerPro(['caravan'], 'rivet');

const S = (x, w, yTop, yBot, n = 2.6) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-6.5, 0.03, 0.56, 0.44, 2),
  S(-5.9, 0.1, 0.68, 0.32, 2.2),
  S(-4.8, 0.28, 0.86, 0.04, 2.3),
  S(-3.7, 0.5, 0.99, -0.3, 2.5),
  S(-2.6, 0.7, 1.03, -0.6, 2.7),
  S(-1.5, 0.78, 1.035, -0.76, 2.9),
  S(-0.2, 0.8, 1.035, -0.78, 3.0),
  S(1.0, 0.8, 1.03, -0.78, 3.0),
  S(1.5, 0.79, 1.0, -0.77, 2.8),
  S(2.1, 0.76, 0.88, -0.74, 2.6),
  S(2.8, 0.7, 0.8, -0.66, 2.5),
  S(3.5, 0.65, 0.76, -0.58, 2.4),
  S(4.05, 0.58, 0.7, -0.5, 2.35),
  S(4.4, 0.5, 0.6, -0.42, 2.3),
  S(4.5, 0.33, 0.42, -0.28, 2.2),
  S(4.545, 0.1, 0.12, -0.1, 2),
  S(4.555, 0.01, 0.015, -0.015, 2),
];
const POD = [
  S(-3.5, 0.04, -0.62, -0.84, 2.1),
  S(-2.9, 0.3, -0.58, -1.0, 2.3),
  S(-1.8, 0.5, -0.55, -1.13, 2.4),
  S(0.6, 0.52, -0.5, -1.16, 2.5),
  S(1.9, 0.44, -0.55, -1.1, 2.4),
  S(2.7, 0.1, -0.62, -0.9, 2.1),
];
const WING = [
  { z: 0.7, x: 0.5, y: 1.04, chord: 1.78, t: 0.14, camber: 0.025, cp: 0.4 },
  { z: 4.4, x: 0.5, y: 1.13, chord: 1.78, t: 0.13, camber: 0.025, cp: 0.4, twist: -0.5 },
  { z: 7.94, x: 0.5, y: 1.24, chord: 1.17, t: 0.11, camber: 0.02, cp: 0.4, twist: -2.5 },
];
const STAB = [
  { z: 0.1, x: -5.2, y: 0.74, chord: 1.4, t: 0.09 },
  { z: 2.75, x: -5.7, y: 0.76, chord: 0.85, t: 0.08 },
];
const FIN = [
  { z: 0, x: -3.55, y: 0, chord: 2.95, t: 0.09 },
  { z: 2.4, x: -5.4, y: 0, chord: 1.2, t: 0.075 },
];
const FIN_BASE = 0.52;
const HINGE = 0.7;
const FLAP = [0.85, 4.9];
const AIL = [5.05, 7.65];
const finHinge = (z) => {
  const s = sectionAt(FIN, z);
  const xh = -5.55 + (-5.45 + 5.55) * (z / 2.4);
  return (s.x - xh) / s.chord;
};
const PROP_X = 4.52;

const WINDOWS = [-2.35, -1.45, -0.55, 0.35].map((x) => quadAt(x, 0.22, 10, 44));
const PILOT = [[0.9, 8], [1.9, 8], [1.78, 42], [0.9, 44]];
const WINDSHIELD = [[1.3, 33], [2.2, 47], [2.2, 133], [1.3, 147]];
const BIG_DOOR = [[-3.5, -18], [-2.25, -18], [-2.25, 52], [-3.5, 52]];

export function buildCaravan(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  rig.gear.fixed = true;
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;

  const body = loftBody(STATIONS, { detail, step: 0.25 });
  if (!mats.__painted) {
    const base = L.base;
    const rise = (x) => Math.max(0, -1.6 - x) * 6;
    const skinTex = paintBody(mats, body, spec, {
      base, belly: L.belly, bellyAngle: -30,
      ribbons: [
        { lo: (x) => -4 + rise(x) * 0.8, hi: (x) => 10 + rise(x), color: L.stripe ?? '#b8561c', x0: -6.2, x1: 3.9 },
        { lo: (x) => 12 + rise(x), hi: (x) => 16.5 + rise(x), color: L.stripe2 ?? '#2b3a4a', x0: -6.2, x1: 3.9 },
      ],
      rings: [2.1, 4.0],
      windows: [...WINDOWS], frames: [{ quad: PILOT }, { quad: BIG_DOOR, fill: 'rgba(0,0,0,0)' }],
      single: [WINDSHIELD],
      seams: [[-3.5, -18, -3.5, 52], [-2.25, -18, -2.25, 52], [0.85, -20, 0.85, 52], [1.95, -20, 1.95, 52], [-3.5, 52, -2.25, 52], [-3.5, -18, -2.25, -18], [0.85, -20, 1.95, -20], [3.2, 20, 3.9, 20]],
      lines: [{ x0: 1.3, a0: 90, x1: 2.2, a1: 90, width: 6 }],
      regs: [{ x: -4.2, a: 38, size: 0.34, stretch: 0.95 }],
      stencils: [{ str: 'TREKKER 208', x: 3.1, a: 22, size: 0.08 }, { str: 'NO STEP', x: -1.0, a: -34, size: 0.04, color: '#a02020' }],
      blobs: [{ x: 3.6, a: 5, rx: 1.5, ry: 0.07, color: '#1c1a16', alpha: 0.35 }, { x: 3.2, a: -12, rx: 1.0, ry: 0.05, color: '#1c1a16', alpha: 0.25 }],
      dirt: { streaks: [{ x: 3.3, a: -50, len: 6, w: 0.12, alpha: 0.3 }, { x: 3.0, a: 24, len: 3.2, w: 0.08, alpha: 0.25 }, { x: 3.4, a: 40, len: 2.4, w: 0.05, alpha: 0.2 }], mottle: 0.1 },
      ao: [{ x: -0.6, a: 90, rx: 1.2, ry: 0.2, alpha: 0.14 }, { x: -5.0, a: 0, rx: 0.8, ry: 0.12, alpha: 0.12 }],
    });
    const wb = L.wing ?? L.base;
    const atlas = paintAtlas(mats, wb, { wing: { span: 7.5, chord: 1.9, z0: 0.7 }, stab: { span: 2.9, chord: 1.5, z0: 0 }, fin: { span: 2.5, chord: 3.1, z0: 0 } }, {
      wing: {
        sections: WING, z0: 0.7, z1: 7.94, base: wb, under: shade(wb, -0.08),
        seams: [{ z0: FLAP[0], z1: FLAP[1], xf: HINGE }, { z0: AIL[0], z1: AIL[1], xf: HINGE }],
        boots: { len: 0.11, z0: 0.7, z1: 7.8 }, walkway: { z0: 0.75, z1: 1.9, p0: 0.5, p1: 0.9 }, caps: [{ z: 3.1, p: 0.45 }],
        tip: { color: L.stripe ?? '#b8561c', len: 0.42 }, dirt: 0.7,
        text: [{ str: 'NO STEP', z: 2.6, p: 1.15, size: 0.05, color: '#aa2222' }, { str: spec.registration, z: 4.4, p: 0.9, size: 0.26, rot: Math.PI / 2, color: L.regColor ?? '#1a2230', upper: false }],
        seed: 31,
      },
      stab: { sections: STAB, z0: 0.1, z1: 2.75, base: wb, under: shade(wb, -0.08), seams: [{ z0: 0.12, z1: 2.73, xf: 0.62 }], boots: { len: 0.1, z0: 0.1, z1: 2.7 }, dirt: 0.6, seed: 6 },
      fin: {
        sections: FIN, z0: 0, z1: 2.4, base: wb, under: wb, seams: [{ z0: 0.15, z1: 2.4, xf: finHinge }], boots: { len: 0.1, z0: 0.2, z1: 2.35 }, dirt: 0.5, seed: 9,
        stripes: [{ p0: -0.6, p1: 1.0, color: L.stripe ?? '#b8561c', z0: 1.2, z1: 1.55, both: true }, { p0: -0.6, p1: 1.0, color: L.stripe2 ?? '#2b3a4a', z0: 1.6, z1: 1.72, both: true }],
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

  // Glazing and seats.
  if (MID) {
    const patch = (q, mat = 'glass') => ext.add(mat, bodyPatch(body, rad(q), { lift: 0.004, p: 4, nu: HI ? 12 : 4, nv: HI ? 8 : 3 }));
    patch(WINDSHIELD);
    patch(PILOT); patch(mirrorQuad(PILOT));
    for (const q of WINDOWS) { patch(q, 'tint'); patch(mirrorQuad(q), 'tint'); }
    if (HI) {
      for (const s of [-1, 1]) {
        ext.add('trim', roundedBox(0.14, 0.62, 0.5, 0.05), T(1.0, 0.1, s * 0.36));
        ext.add('trim', roundedBox(0.55, 0.12, 0.5, 0.05), T(1.3, -0.25, s * 0.36));
        ext.add('dark', roundedBox(0.5, 0.45, 0.35, 0.04), T(2.0, 0.35, s * 0.3));
      }
      ext.add('dark', roundedBox(0.4, 0.3, 1.2, 0.03), T(2.1, 0.4, 0));
      for (const x of [-0.4, -1.6]) ext.add('trim', roundedBox(0.2, 0.55, 0.9, 0.04), T(x, 0.05, 0));
    }
  }

  // Lifting surfaces.
  const tipR = 0.14;
  fixed.addPair('wing', wingSurface(WING, 0.7, 7.94, { xf0: 0, xf1: HINGE, detail, tipRound: tipR, map: uvW, dz: 0.6 }));
  fixed.addPair('wing', wingSurface(WING, FLAP[1], AIL[0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, AIL[1], 7.94, { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, tipRound: tipR, map: uvW }));
  for (const side of [1, -1]) {
    const flap = hingedSurface(WING, FLAP[0], FLAP[1], HINGE, mats.wing, { detail, side, map: uvW });
    const ail = hingedSurface(WING, AIL[0], AIL[1], HINGE, mats.wing, { detail, side, map: uvW });
    root.add(flap.pivot, ail.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
  }
  fixed.addPair('wing', wingSurface(STAB, 0.1, 2.75, { xf0: 0, xf1: 0.62, detail, tipRound: 0.06, map: uvS }));
  for (const side of [1, -1]) {
    const el = hingedSurface(STAB, 0.1, 2.75, 0.62, mats.wing, { detail, side, map: uvS });
    root.add(el.pivot);
    rig.elevators.push({ pivot: el.pivot, axis: el.axis });
  }
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 2.4, { xf0: 0, xf1: finHinge, detail, tipRound: 0.07, map: uvF }), finM);
  const rud = hingedSurface(FIN, 0.12, 2.4, finHinge, mats.wing, { detail, m: finM, side: 1, map: uvF, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });

  // Cargo pod and struts.
  if (MID) {
    const pod = loftBody(POD, { detail, step: 0.3 });
    fixed.add('wing', setUV0(std(pod.geo.clone()), 0.0015, 0.0015));
    for (const s of [1, -1]) {
      const m = s < 0 ? new THREE.Matrix4().makeScale(1, 1, -1) : null;
      fixed.add('wing', airfoilStrut(vec(-0.1, -0.52, 0.78), vec(0.1, 1.06, 4.5), 0.14, 0.2), m);
      if (HI) {
        fixed.add('wing', airfoilStrut(vec(0.08, 0.35, 2.7), vec(0.2, 1.1, 3.05), 0.07, 0.2), m);
        fixed.add('steel', roundedBox(0.2, 0.05, 0.08, 0.01), T(-0.1, -0.52, s * 0.78));
        fixed.add('steel', roundedBox(0.2, 0.05, 0.1, 0.01), T(0.1, 1.06, s * 4.5));
        // Stabiliser struts to the tail cone.
        fixed.add('wing', airfoilStrut(vec(-4.9, 0.3, s * 0.3), vec(-5.35, 0.74, s * 1.9), 0.07, 0.18));
        fixed.add('steel', roundedBox(0.4, 0.04, 0.5, 0.01), T(0.35, 1.1, s * 5.0)); // flap track fairing
      }
    }
  }

  // Engine installation: exhaust stacks, chin inlet, spinner and propeller.
  if (MID) {
    const inlet = [[4.36, -128], [4.505, -128], [4.505, -52], [4.36, -52]];
    fixed.add('intake', bodyPatch(body, rad(inlet), { lift: 0.004, p: 2.6, nu: 10, nv: 8 }));
    for (const s of [1, -1]) {
      for (const dx of [0, 0.34]) {
        fixed.add('exhaust', tubeBetween(vec(3.25 + dx, 0.2, s * 0.62), vec(2.85 + dx, 0.5, s * 0.74), 0.045, 0.06, 10));
        fixed.add('steel', tubeBetween(vec(3.28 + dx, 0.18, s * 0.6), vec(3.22 + dx, 0.2, s * 0.62), 0.07, 0.06, 10));
      }
      fixed.add('black', roundedBox(0.36, 0.02, 0.28, 0.006), T(2.6, -0.7, s * 0.3));
    }
  }
  const prop = makeProPropeller({
    blades: 3, radius: 1.3, hubR: 0.11,
    chord: (f) => (f < 0.25 ? 0.12 + f * 0.3 : 0.2 - (f - 0.25) * 0.08 - Math.max(0, f - 0.8) * 0.5),
    beta: (f) => 50 - 42 * f + 10 * f * f,
    thick: (f) => 0.2 - 0.14 * Math.min(1, f * 1.2),
    sweep: (f) => 0.04 * f * f, camber: 0.06,
    spinner: [[0.46, 0.001], [0.42, 0.05], [0.32, 0.12], [0.18, 0.18], [0.04, 0.215], [0, 0.215]],
    tipColor: L.tip, tipLen: 0.09,
  }, mats, detail);
  prop.position.set(PROP_X, -0.0, 0);
  root.add(prop);
  rig.props.push(prop);

  // Antennas, probes and lights.
  if (MID) {
    fixed.add('black', bladeAntennaGeometry(0.22, 0.1, 0.012), T(-1.3, 1.035, 0));
    fixed.add('black', bladeAntennaGeometry(0.2, 0.09, 0.012), T(0.4, -0.78, 0, 0, 0, Math.PI));
    if (HI) {
      fixed.add('black', whipGeometry(0.5, 0.005, 0.6), T(-4.2, 0.9, 0.02));
      fixed.add('metal', probeGeometry(0.4, 0.011), T(0.3, 1.1, -3.4));
    }
  }
  const tip = sectionAt(WING, 7.94);
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    nav.position.set(tip.x - 0.1, tip.y + 0.02, s * 7.94);
    root.add(nav); rig.lights.nav.push(nav);
    const strobe = glowLight(0xffffff, 0.05, 0.9);
    strobe.position.set(tip.x - 0.9, tip.y + 0.03, s * 7.9);
    root.add(strobe); rig.lights.strobes.push(strobe);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.035, 1.3), T(tip.x - 0.1, tip.y + 0.01, s * 7.94));
  }
  const beacon = glowLight(0xff2a2a, 0.045, 1.0);
  beacon.position.set(-5.35, FIN_BASE + 2.45, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);
  const tailNav = glowLight(0xffffff, 0.04, 0.6);
  tailNav.position.set(-6.52, FIN_BASE + 0.1, 0);
  root.add(tailNav); rig.lights.nav.push(tailNav);
  const landing = glowLight(0xfff3d0, 0.07, 0.9);
  landing.position.set(0.55, 1.1, -2.2);
  root.add(landing); rig.lights.landing.push(landing);

  // Fixed gear.
  const g = spec.gear;
  const axleY = g.mainLeft.y + 0.37;
  const noseAttach = -0.72;
  const noseLeg = makeProGearLeg({ length: noseAttach - g.nose.y, strutR: 0.042, wheelRadius: 0.27, wheelWidth: 0.16, fork: 'single', outerFrac: 0.55, fender: true }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, lower: noseLeg.userData.lower, wheels: noseLeg.userData.wheels };
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = new THREE.Group();
    leg.position.set(pos.x, axleY, pos.z);
    const lower = new THREE.Group();
    const wheel = makeWheelGroup({ radius: 0.37, width: 0.2, rim: 0.5, disc: 0.52, spokes: 6, discSide: -side }, mats, detail);
    lower.add(wheel);
    leg.add(lower);
    const sp = new Parts(mats);
    // Tapered spring-steel leg from the fuselage side, with an axle stub and brake line.
    sp.add('steel', airfoilStrut(vec(0.0, 0.0, 0.0), vec(0.04, 0.58, -side * 0.82), 0.17, 0.22));
    if (HI) {
      sp.add('steel', roundedBox(0.3, 0.08, 0.2, 0.03), T(0.04, 0.58, -side * 0.82));
      sp.add('steel', cylZ(0.04, 0.04, 0.2, 10), T(0, 0, -side * 0.05));
      sp.add('black', tubeBetween(vec(0.08, 0.02, side * 0.0), vec(0.1, 0.56, -side * 0.8), 0.008, 0.008, 5));
    }
    sp.build(leg);
    root.add(leg);
    rig.gear.mains.push({ leg, lower, wheels: [wheel], wheelIndex, side });
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void cylX; void cylY;
  return { group: root, rig };
}
