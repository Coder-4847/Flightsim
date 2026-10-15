import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, bodyPatch, cylX, cylZ, hingedSurface, loftBody, revolve, roundedBox, sectionAt, setUV0, std, tubeBetween, vec, wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, makeProPropeller, probeGeometry, whipGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { paintAtlas } from './paintkit.js';
import { paintBody, quadAt, rad, mirrorQuad } from './bodypaint.js';
import { newRig } from './common.js';

// Cirrus 72 (ATR 72 analogue): twin high-wing turboprop regional airliner with a T-tail. Length 27.2 m, span 27.05 m.

registerPro(['turboprop72'], 'flush');

const S = (x, w, yTop, yBot, n = 2.2) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-13.6, 0.02, 0.7, 0.52, 2),
  S(-13.35, 0.12, 0.8, 0.34, 2),
  S(-12.3, 0.4, 0.97, -0.05, 2.1),
  S(-10.4, 0.8, 1.15, -0.55, 2.1),
  S(-8.0, 1.2, 1.31, -1.05, 2.1),
  S(-5.5, 1.38, 1.41, -1.34, 2.1),
  S(-3.0, 1.43, 1.435, -1.43, 2.1),
  S(8.8, 1.43, 1.435, -1.43, 2.1),
  S(10.2, 1.39, 1.38, -1.4, 2.1),
  S(11.5, 1.2, 1.2, -1.25, 2.1),
  S(12.5, 0.86, 0.86, -1.0, 2.2),
  S(13.2, 0.45, 0.4, -0.65, 2.2),
  S(13.52, 0.2, 0.12, -0.3, 2.1),
  S(13.6, 0.02, -0.08, -0.15, 2),
];
const WING = [
  { z: 1.3, x: 1.2, y: 1.2, chord: 2.95, t: 0.16, camber: 0.025, cp: 0.4 },
  { z: 4.4, x: 1.2, y: 1.26, chord: 2.85, t: 0.145, camber: 0.025, cp: 0.4 },
  { z: 13.5, x: 1.2, y: 1.35, chord: 1.45, t: 0.115, camber: 0.02, cp: 0.4, twist: -2 },
];
const STAB = [
  { z: 0.1, x: -11.7, y: 5.28, chord: 2.0, t: 0.09 },
  { z: 3.65, x: -12.55, y: 5.3, chord: 1.05, t: 0.08 },
];
const FIN = [
  { z: 0, x: -8.9, y: 0, chord: 4.7, t: 0.1 },
  { z: 4.4, x: -11.7, y: 0, chord: 1.95, t: 0.085 },
];
const FIN_BASE = 0.9;
const HINGE = 0.72;
const FLAPS = [[1.6, 3.9], [4.95, 9.3]];
const AIL = [9.75, 13.0];
const finHinge = (z) => {
  const s = sectionAt(FIN, z);
  const xh = -11.4 + (-12.0 + 11.4) * (z / 4.4);
  return (s.x - xh) / s.chord;
};
const NAC = { x: 2.9, y: 0.5, z: 4.4 };
const PROP_X = 3.4;

const CABIN_X = []; for (let i = 0; i < 24; i++) CABIN_X.push(7.0 - i * 0.5);
const CABIN = CABIN_X.map((x) => quadAt(x, 0.125, 9, 23.5));
const COCKPIT = [[10.0, 6], [11.4, 6], [11.5, 36], [10.2, 38]];
const WINDSHIELD = [[11.7, 30], [12.6, 38], [12.6, 142], [11.7, 150]];
const DOOR_FWD = [[7.6, -22], [8.5, -22], [8.5, 40], [7.6, 40]];

export function buildTurboprop72(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;

  const body = loftBody(STATIONS, { detail, step: 0.6, tile: 3 });
  if (!mats.__painted) {
    const rise = (x) => Math.max(0, -5.5 - x) * 3.2;
    const skinTex = paintBody(mats, body, spec, {
      W: 4096, base: L.base, belly: L.belly, bellyAngle: -32,
      ribbons: [
        { lo: (x) => -9 + rise(x) * 0.6, hi: (x) => -1 + rise(x), color: L.stripe ?? '#0e7c86', x0: -13.3, x1: 12.4 },
        { lo: (x) => 0 + rise(x), hi: (x) => 2.4 + rise(x), color: L.stripe2 ?? '#f0a83c', x0: -13.3, x1: 12.4 },
      ],
      rings: [-12, -9, -6, -3, 0, 3, 6, 9],
      windows: CABIN, frames: [{ quad: COCKPIT }, { quad: DOOR_FWD, fill: 'rgba(0,0,0,0)' }],
      single: [WINDSHIELD],
      seams: [[7.6, -22, 7.6, 40], [8.5, -22, 8.5, 40], [7.6, 40, 8.5, 40], [-4.5, -10, -4.5, 40], [-3.2, -10, -3.2, 40], [-4.5, 40, -3.2, 40], [-4.5, -10, -3.2, -10]],
      lines: [{ x0: 11.7, a0: 90, x1: 12.6, a1: 90, width: 5 }, { x0: 11.7, a0: 64, x1: 12.6, a1: 64, width: 4 }, { x0: 11.7, a0: 116, x1: 12.6, a1: 116, width: 4 }],
      regs: [{ x: -9.8, a: 24, size: 0.45, stretch: 1.0 }],
      stencils: [{ str: 'CIRRUS 72', x: 9.4, a: -4, size: 0.2, alpha: 0.9, color: L.stripe ?? '#0e7c86' }, { str: 'NO STEP', x: -2, a: -36, size: 0.07, color: '#a02020' }],
      blobs: [{ x: 11.5, a: 20, rx: 1.6, ry: 0.12, color: '#2a2a2a', alpha: 0.15 }],
      dirt: { streaks: [{ x: 3.0, a: -45, len: 6, w: 0.25, alpha: 0.18 }, { x: 2.6, a: 12, len: 7, w: 0.3, alpha: 0.12 }, { x: 8, a: -70, len: 5, w: 0.3, alpha: 0.1 }], mottle: 0.1 },
      ao: [{ x: 1.8, a: 90, rx: 3.2, ry: 0.2, alpha: 0.15 }, { x: -11, a: 0, rx: 1.5, ry: 0.15, alpha: 0.12 }],
    });
    const wb = L.wing ?? L.base;
    const atlas = paintAtlas(mats, wb, { wing: { span: 12.3, chord: 3.0, z0: 1.3 }, stab: { span: 3.7, chord: 2.1, z0: 0 }, fin: { span: 4.5, chord: 4.8, z0: 0 } }, {
      wing: {
        sections: WING, z0: 1.3, z1: 13.5, base: wb, under: shade(wb, -0.1),
        seams: [...FLAPS.map(([a, b]) => ({ z0: a, z1: b, xf: HINGE })), { z0: AIL[0], z1: AIL[1], xf: HINGE }],
        boots: { len: 0.16, z0: 1.3, z1: 13.3 }, walkway: { z0: 1.5, z1: 3.6, p0: 0.9, p1: 1.5 }, caps: [{ z: 8.4, p: 0.8 }],
        tip: { color: L.stripe ?? '#0e7c86', len: 0.5 }, dirt: 0.6,
        text: [{ str: 'NO STEP', z: 6.3, p: 1.6, size: 0.08, color: '#aa2222' }],
        stripes: [{ p0: -1.0, p1: 1.0, color: L.stripe ?? '#0e7c86', z0: 12.8, z1: 13.6 }],
        seed: 41,
      },
      stab: { sections: STAB, z0: 0.1, z1: 3.65, base: wb, under: shade(wb, -0.08), seams: [{ z0: 0.12, z1: 3.6, xf: 0.62 }], boots: { len: 0.14, z0: 0.1, z1: 3.6 }, dirt: 0.5, seed: 6 },
      fin: {
        sections: FIN, z0: 0, z1: 4.4, base: L.stripe ?? '#0e7c86', under: L.stripe ?? '#0e7c86', seams: [{ z0: 0.2, z1: 4.4, xf: finHinge }], boots: { len: 0.14, z0: 0.3, z1: 4.3 }, dirt: 0.4, seed: 9,
        stripes: [{ p0: -1.2, p1: 1.2, color: L.stripe2 ?? '#f0a83c', z0: 0.9, z1: 1.35, both: true }],
        text: [{ str: spec.registration, z: 0.0, p: 0.0, size: 0.1 }],
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

  // Glazing: cockpit, windshield and the passenger window row.
  if (MID) {
    const patch = (q, mat = 'glass') => ext.add(mat, bodyPatch(body, rad(q), { lift: 0.004, p: 4, nu: HI ? 12 : 4, nv: HI ? 8 : 3 }));
    patch(WINDSHIELD); patch(COCKPIT); patch(mirrorQuad(COCKPIT));
    const win = (q) => ext.add('window', bodyPatch(body, rad(q), { lift: 0.004, p: 3.4, nu: HI ? 5 : 2, nv: HI ? 4 : 2 }));
    for (const q of CABIN) { win(q); win(mirrorQuad(q)); }
    if (HI) {
      for (const s of [-1, 1]) {
        ext.add('trim', roundedBox(0.2, 0.7, 0.6, 0.05), T(10.8, 0.2, s * 0.5));
        ext.add('dark', roundedBox(0.6, 0.5, 0.5, 0.04), T(11.8, 0.5, s * 0.4));
      }
    }
  }

  // Wings.
  const tipR = 0.16;
  fixed.addPair('wing', wingSurface(WING, 1.3, 13.5, { xf0: 0, xf1: HINGE, detail, tipRound: tipR, map: uvW, dz: 1.0 }));
  fixed.addPair('wing', wingSurface(WING, FLAPS[0][1], FLAPS[1][0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, FLAPS[1][1], AIL[0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, AIL[1], 13.5, { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, tipRound: tipR, map: uvW }));
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
  // Tail.
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 4.4, { xf0: 0, xf1: finHinge, detail, tipRound: 0.08, map: uvF, dz: 0.8 }), finM);
  const rud = hingedSurface(FIN, 0.3, 4.4, finHinge, mats.wing, { detail, m: finM, side: 1, map: uvF, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });
  fixed.addPair('wing', wingSurface(STAB, 0.1, 3.65, { xf0: 0, xf1: 0.62, detail, tipRound: 0.07, map: uvS }));
  for (const side of [1, -1]) {
    const el = hingedSurface(STAB, 0.1, 3.65, 0.62, mats.wing, { detail, side, map: uvS });
    root.add(el.pivot);
    rig.elevators.push({ pivot: el.pivot, axis: el.axis });
  }
  if (MID) fixed.add('wing', setUV0(std(new THREE.SphereGeometry(0.2, 12, 8)), 0.0015, 0.0015), T(-12.1, 5.3, 0, 0, 0, 0, 3.0, 0.5, 0.5)); // fin-stab fairing

  // Nacelles, propellers, gear sponsons.
  for (const s of [-1, 1]) {
    if (MID) {
      const nac = loftBody([
        { x: -4.2, w: 0.08, top: 0.1, bottom: 0.1, yc: 0.62, n: 2 },
        { x: -3.0, w: 0.3, top: 0.3, bottom: 0.3, yc: 0.5, n: 2.1 },
        { x: -1.2, w: 0.52, top: 0.56, bottom: 0.56, yc: 0.5, n: 2.2 },
        { x: 0.6, w: 0.6, top: 0.62, bottom: 0.6, yc: 0.5, n: 2.3 },
        { x: 2.4, w: 0.58, top: 0.6, bottom: 0.58, yc: 0.5, n: 2.3 },
        { x: 3.2, w: 0.5, top: 0.52, bottom: 0.5, yc: 0.5, n: 2.2 },
        { x: 3.42, w: 0.3, top: 0.3, bottom: 0.3, yc: 0.5, n: 2.1 },
        { x: 3.44, w: 0.1, top: 0.1, bottom: 0.1, yc: 0.5, n: 2 },
        { x: 3.445, w: 0.01, top: 0.01, bottom: 0.01, yc: 0.5, n: 2 },
      ], { detail, step: 0.4 });
      fixed.add('wing', setUV0(std(nac.geo.clone()), 0.0015, 0.0015), T(0, 0, s * NAC.z));
      const lip = [[3.0, -125], [3.36, -125], [3.36, -55], [3.0, -55]];
      fixed.add('intake', bodyPatch(nac, rad(lip), { lift: 0.004, p: 2.6, nu: 8, nv: 6 }), T(0, 0, s * NAC.z));
      fixed.add('exhaust', tubeBetween(vec(1.0, 0.82, s * (NAC.z + 0.58)), vec(0.4, 0.95, s * (NAC.z + 0.66)), 0.07, 0.09, 10));
      // Gear sponsons on the lower fuselage.
      const sp = loftBody([
        { x: -3.4, w: 0.02, top: 0.2, bottom: 0.2, yc: 0, n: 2 },
        { x: -2.2, w: 0.26, top: 0.4, bottom: 0.4, yc: -0.05, n: 2.3 },
        { x: 0.0, w: 0.36, top: 0.5, bottom: 0.5, yc: -0.1, n: 2.4 },
        { x: 1.8, w: 0.3, top: 0.46, bottom: 0.46, yc: -0.08, n: 2.3 },
        { x: 3.2, w: 0.02, top: 0.22, bottom: 0.22, yc: 0, n: 2 },
      ], { detail, step: 0.4 });
      fixed.add('wing', setUV0(std(sp.geo.clone()), 0.0015, 0.0015), T(-0.6, -1.05, s * 1.78));
    }
    const prop = makeProPropeller({
      blades: 6, radius: 1.97, hubR: 0.2,
      chord: (f) => (f < 0.25 ? 0.2 + f * 0.7 : 0.38 - (f - 0.25) * 0.15 - Math.max(0, f - 0.85) * 1.2),
      beta: (f) => 52 - 40 * f + 6 * f * f, thick: (f) => 0.16 - 0.1 * Math.min(1, f), sweep: (f) => 0.22 * f * f, camber: 0.05,
      spinner: [[0.6, 0.001], [0.55, 0.06], [0.4, 0.16], [0.2, 0.24], [0.05, 0.28], [0, 0.28]],
      tipColor: L.tip, tipLen: 0.07,
    }, mats, detail);
    prop.position.set(PROP_X, NAC.y, s * NAC.z);
    root.add(prop);
    rig.props.push(prop);
  }

  // Antennas, probes, lights.
  if (MID) {
    fixed.add('black', bladeAntennaGeometry(0.4, 0.16, 0.02), T(3.5, 1.43, 0));
    fixed.add('black', bladeAntennaGeometry(0.4, 0.16, 0.02), T(-1.5, -1.43, 0, 0, 0, Math.PI));
    if (HI) {
      fixed.add('metal', probeGeometry(0.55, 0.014), T(11.6, 0.0, 1.0));
      fixed.add('metal', probeGeometry(0.55, 0.014), T(11.6, 0.0, -1.0));
      fixed.add('black', whipGeometry(0.6, 0.006, 0.4), T(-1.0, 1.43, 0.3));
    }
  }
  const tip = sectionAt(WING, 13.5);
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.06, 0.6);
    nav.position.set(tip.x - 0.1, tip.y + 0.04, s * 13.5);
    root.add(nav); rig.lights.nav.push(nav);
    const strobe = glowLight(0xffffff, 0.06, 0.9);
    strobe.position.set(tip.x - 1.2, tip.y + 0.04, s * 13.4);
    root.add(strobe); rig.lights.strobes.push(strobe);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.05, 1.3), T(tip.x - 0.1, tip.y + 0.02, s * 13.5));
    const beacon = glowLight(0xff2a2a, 0.06, 1.0);
    beacon.position.set(-3.0, s > 0 ? 1.45 : -1.45, 0);
    if (s > 0) { root.add(beacon); rig.lights.beacon.push(beacon); }
    const landing = glowLight(0xfff3d0, 0.08, 0.9);
    landing.position.set(NAC.x + 0.4, 1.2, s * 3.4);
    root.add(landing); rig.lights.landing.push(landing);
  }
  const tailNav = glowLight(0xffffff, 0.05, 0.6);
  tailNav.position.set(-13.65, 0.6, 0);
  root.add(tailNav); rig.lights.nav.push(tailNav);
  const beaconTop = glowLight(0xff2a2a, 0.06, 1.0);
  beaconTop.position.set(-12.9, FIN_BASE + 4.55, 0);
  root.add(beaconTop); rig.lights.beacon.push(beaconTop);

  // Retractable gear: twin-wheel nose leg and twin-wheel mains in the sponsons.
  const g = spec.gear;
  const noseAttach = -1.0;
  const noseLeg = makeProGearLeg({ length: noseAttach - g.nose.y, strutR: 0.05, wheelRadius: 0.32, wheelWidth: 0.2, wheels: [[0, -0.2], [0, 0.2]], fork: 'double', outerFrac: 0.5, lightMount: [0.15, -0.5, 0] }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  const mainAttach = -1.0;
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = makeProGearLeg({ length: mainAttach - pos.y, strutR: 0.07, wheelRadius: 0.5, wheelWidth: 0.26, wheels: [[0, -0.22], [0, 0.22]], fork: 'double', outerFrac: 0.5, brake: true, drag: 0.5 }, mats, detail);
    leg.position.set(pos.x, mainAttach, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: Math.PI / 2 });
    if (MID) {
      const door = new THREE.Object3D();
      door.position.set(pos.x, mainAttach - 0.36, pos.z + side * 0.4);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(2.2, 0.03, 0.5)), 0.0015, 0.0015), T(0, 0, -side * 0.25));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.2 });
    }
  }
  if (MID) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x + 0.2, -1.38, s * 0.2);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(1.4, 0.03, 0.4)), 0.0015, 0.0015), T(0, 0, -s * 0.2));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void cylX; void cylZ; void revolve;
  return { group: root, rig };
}
