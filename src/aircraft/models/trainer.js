import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, bodyPatch, boxG, hingedSurface, loftBody, roundedBox, sectionAt, setUV0, std, tubeBetween, vec, wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, probeGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { paintAtlas } from './paintkit.js';
import { paintBody, quadAt, rad } from './bodypaint.js';
import { canopyBow, coamingParts, nozzleParts, seatParts } from './jetkit.js';
import { newRig } from './common.js';

// Tutor T-39 (Aero L-39 Albatros analogue): tandem-seat jet trainer, straight wing with tip tanks, lateral intakes.
// Length 12.1 m, span 9.46 m over the tip tanks.

registerPro(['trainer'], 'flush');

const S = (x, w, yTop, yBot, n = 2.3) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-6.05, 0.33, 0.3, -0.3, 2.1),
  S(-5.2, 0.45, 0.46, -0.45, 2.15),
  S(-3.8, 0.58, 0.58, -0.54, 2.2),
  S(-2.0, 0.65, 0.68, -0.52, 2.3),
  S(0.0, 0.68, 0.78, -0.5, 2.4),
  S(1.2, 0.64, 0.78, -0.47, 2.4),
  S(2.5, 0.52, 0.62, -0.43, 2.3),
  S(3.7, 0.4, 0.5, -0.36, 2.2),
  S(4.8, 0.3, 0.38, -0.3, 2.1),
  S(5.6, 0.16, 0.2, -0.2, 2.05),
  S(6.0, 0.05, 0.07, -0.08, 2),
  S(6.07, 0.008, 0.012, -0.012, 2),
];
const CANOPY = [
  { x: 0.1, w: 0.01, top: 0.01, bottom: 0.01, yc: 0.76, n: 2 },
  { x: 0.4, w: 0.2, top: 0.28, bottom: 0.08, yc: 0.76, n: 2.2 },
  { x: 0.9, w: 0.34, top: 0.6, bottom: 0.1, yc: 0.74, n: 2.3 },
  { x: 1.7, w: 0.37, top: 0.6, bottom: 0.1, yc: 0.7, n: 2.3 },
  { x: 2.5, w: 0.34, top: 0.56, bottom: 0.1, yc: 0.62, n: 2.3 },
  { x: 3.1, w: 0.26, top: 0.32, bottom: 0.1, yc: 0.56, n: 2.2 },
  { x: 3.55, w: 0.12, top: 0.12, bottom: 0.06, yc: 0.52, n: 2.1 },
  { x: 3.7, w: 0.01, top: 0.02, bottom: 0.02, yc: 0.48, n: 2 },
];
const WING = [
  { z: 0.55, x: 0.95, y: -0.14, chord: 3.0, t: 0.14, camber: 0.015, cp: 0.4 },
  { z: 1.8, x: 0.75, y: -0.1, chord: 2.35, t: 0.12, camber: 0.015, cp: 0.4 },
  { z: 4.35, x: 0.5, y: -0.03, chord: 1.4, t: 0.1, camber: 0.012, cp: 0.4, twist: -1.5 },
];
const STAB = [
  { z: 0.1, x: -4.75, y: 0.3, chord: 1.75, t: 0.08 },
  { z: 1.95, x: -5.5, y: 0.36, chord: 0.85, t: 0.07 },
];
const FIN = [
  { z: 0, x: -3.3, y: 0, chord: 2.9, t: 0.09 },
  { z: 2.55, x: -5.3, y: 0, chord: 1.25, t: 0.07 },
];
const FIN_BASE = 0.48;
const HINGE = 0.7;
const FLAP = [0.6, 2.35];
const AIL = [2.45, 4.25];
const finHinge = (z) => {
  const s = sectionAt(FIN, z);
  const xh = -5.15 + (-5.7 + 5.15) * (z / 2.55);
  return (s.x - xh) / s.chord;
};
const TANK = { z: 4.6, x: 0.1, y: -0.02 };
const WINDSHIELD = [[3.05, 38], [3.45, 46], [3.45, 134], [3.05, 142]];

export function buildTrainer(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;

  const body = loftBody(STATIONS, { detail, step: 0.3 });
  const canopy = loftBody(CANOPY, { detail, step: 0.3, segs: HI ? 36 : 14 });
  if (!mats.__painted) {
    const rise = (x) => Math.max(0, -2.5 - x) * 5;
    const skinTex = paintBody(mats, body, spec, {
      base: L.base, belly: L.belly, bellyAngle: -22,
      ribbons: [
        { lo: (x) => -10 + rise(x) * 0.5, hi: (x) => -2 + rise(x) * 0.7, color: L.stripe ?? '#c53030', x0: -5.8, x1: 5.0 },
        { lo: (x) => -1 + rise(x) * 0.7, hi: (x) => 1.4 + rise(x) * 0.7, color: L.stripe2 ?? '#1d2b44', x0: -5.8, x1: 5.0 },
      ],
      rings: [-4.6, -2.6, -0.4, 1.0, 2.8],
      frames: [],
      seams: [[-3.0, -35, -3.0, 40], [-2.0, -50, -2.0, 50], [3.5, -30, 4.6, 0], [4.2, -40, 4.2, 40], [0.0, 60, 3.0, 62]],
      regs: [{ x: -2.6, a: 18, size: 0.34, stretch: 1.0 }],
      stencils: [{ str: 'TUTOR T-39', x: 4.3, a: 8, size: 0.11 }, { str: 'NO STEP', x: -1.2, a: -34, size: 0.05, color: '#a02020' }, { str: 'DANGER  INTAKE', x: 1.6, a: -10, size: 0.045, color: '#a02020' }],
      blobs: [
        { x: 4.2, a: 80, rx: 1.0, ry: 0.35, color: '#101214', alpha: 0.85 }, // anti-glare panel
        { x: -5.4, a: 0, rx: 1.0, ry: 0.4, color: '#3a2c22', alpha: 0.6 }, // jet-pipe heat stain
        { x: -5.0, a: 90, rx: 1.4, ry: 0.3, color: '#2d251d', alpha: 0.4 },
      ],
      dirt: { streaks: [{ x: -4.8, a: -10, len: 1.5, w: 0.1, alpha: 0.3 }, { x: 5.0, a: 30, len: 3, w: 0.03, alpha: 0.2 }, { x: 0.6, a: 20, len: 4, w: 0.04, alpha: 0.15 }], mottle: 0.12 },
      ao: [{ x: 0.9, a: -30, rx: 1.6, ry: 0.18, alpha: 0.18 }, { x: 0.4, a: 70, rx: 1.0, ry: 0.12, alpha: 0.12 }],
    });
    const wb = L.wing ?? L.base;
    const atlas = paintAtlas(mats, wb, { wing: { span: 3.9, chord: 3.2, z0: 0.55 }, stab: { span: 1.9, chord: 1.9, z0: 0 }, fin: { span: 2.6, chord: 3.0, z0: 0 }, tank: { span: 3.0, chord: 0.8, z0: -1.5 } }, {
      wing: {
        sections: WING, z0: 0.55, z1: 4.35, base: wb, under: shade(wb, -0.1),
        seams: [{ z0: FLAP[0], z1: FLAP[1], xf: HINGE }, { z0: AIL[0], z1: AIL[1], xf: HINGE }],
        walkway: { z0: 0.65, z1: 1.5, p0: 0.7, p1: 1.0 }, tip: { color: L.stripe ?? '#c53030', len: 0.3 }, dirt: 0.5,
        text: [{ str: 'NO STEP', z: 1.6, p: 1.1, size: 0.05, color: '#aa2222' }], seed: 61,
      },
      stab: { sections: STAB, z0: 0.1, z1: 1.95, base: wb, under: shade(wb, -0.1), seams: [{ z0: 0.1, z1: 1.95, xf: 0.58 }], dirt: 0.5, seed: 6 },
      fin: {
        sections: FIN, z0: 0, z1: 2.55, base: wb, under: wb, seams: [{ z0: 0.12, z1: 2.55, xf: finHinge }], dirt: 0.5, seed: 9,
        stripes: [{ p0: -0.6, p1: 1.6, color: L.stripe ?? '#c53030', z0: 1.9, z1: 2.55, both: true }, { p0: -0.6, p1: 1.6, color: L.stripe2 ?? '#1d2b44', z0: 1.82, z1: 1.9, both: true }],
        text: [{ str: spec.registration, z: 1.0, p: 0.9, size: 0.22, rot: Math.PI / 2, color: L.regColor ?? '#1a2230' }],
      },
      tank: { sections: [{ z: -1.5, x: 0, y: 0, chord: 0.8, t: 0.1 }, { z: 1.5, x: 0, y: 0, chord: 0.8, t: 0.1 }], z0: -1.5, z1: 1.5, base: L.stripe ?? '#c53030', under: L.stripe ?? '#c53030', stripes: [{ p0: -0.3, p1: 0.3, color: wb, z0: -0.6, z1: 0.6 }], dirt: 0.3, seed: 12 },
    });
    mats.__painted = { skinTex, atlas };
  }
  const { atlas } = mats.__painted;
  const uvW = atlas.rects.wing.uv; const uvS = atlas.rects.stab.uv; const uvF = atlas.rects.fin.uv; const uvT = atlas.rects.tank.uv;
  const skinMesh = new THREE.Mesh(body.geo, mats.skin);
  exterior.add(skinMesh);
  const fixed = new Parts(mats);
  const ext = new Parts(mats);

  // Canopy, bows and the pilots' seats.
  ext.add('glass', canopy.geo);
  if (MID) {
    const flat = (g) => setUV0(std(g), 0.0015, 0.0015);
    for (const x of [0.7, 1.55, 3.15]) canopyBow(ext, canopy, x, 0.12, Math.PI - 0.12, 0.012, 0.022);
    ext.add('dark', tubeBetween(vec(3.5, 0.62, 0), vec(0.35, 0.82, 0), 0.03, 0.03, 6));
    for (const s of [-1, 1]) ext.add('dark', tubeBetween(vec(3.4, 0.56, s * 0.2), vec(0.5, 0.72, s * 0.3), 0.022, 0.022, 6));
    if (HI) {
      seatParts(ext, { x: 2.35, y: 0.28, scale: 1.0 });
      seatParts(ext, { x: 0.95, y: 0.34, scale: 1.0 });
      coamingParts(ext, { x: 3.1, y: 0.5, w: 0.6, d: 0.5 });
      coamingParts(ext, { x: 1.7, y: 0.56, w: 0.6, d: 0.35 });
      ext.add('dark', roundedBox(0.4, 0.04, 0.34, 0.01), T(2.0, 0.62, 0)); // sight / rear-view mirror
    }
    void flat;
  }

  // Wings, flaps, ailerons, airbrakes and tip tanks.
  const tipR = 0.1;
  fixed.addPair('wing', wingSurface(WING, 0.55, 4.35, { xf0: 0, xf1: HINGE, detail, tipRound: tipR, map: uvW, dz: 0.8 }));
  fixed.addPair('wing', wingSurface(WING, FLAP[1], AIL[0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, AIL[1], 4.35, { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, tipRound: tipR, map: uvW }));
  for (const side of [1, -1]) {
    const flap = hingedSurface(WING, FLAP[0], FLAP[1], HINGE, mats.wing, { detail, side, map: uvW });
    const ail = hingedSurface(WING, AIL[0], AIL[1], HINGE, mats.wing, { detail, side, map: uvW });
    root.add(flap.pivot, ail.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
  }
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 2.55, { xf0: 0, xf1: finHinge, detail, tipRound: 0.06, map: uvF }), finM);
  const rud = hingedSurface(FIN, 0.1, 2.55, finHinge, mats.wing, { detail, m: finM, side: 1, map: uvF, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });
  fixed.addPair('wing', wingSurface(STAB, 0.1, 1.95, { xf0: 0, xf1: 0.58, detail, tipRound: 0.05, map: uvS }));
  for (const side of [1, -1]) {
    const el = hingedSurface(STAB, 0.1, 1.95, 0.58, mats.wing, { detail, side, map: uvS });
    root.add(el.pivot);
    rig.elevators.push({ pivot: el.pivot, axis: el.axis });
  }
  // Tip tanks (loft) with a stabilising fin and the nav lens.
  if (MID) {
    const tank = loftBody([
      { x: -1.45, w: 0.01, top: 0.01, bottom: 0.01, yc: 0, n: 2 },
      { x: -1.1, w: 0.11, top: 0.11, bottom: 0.11, yc: 0, n: 2 },
      { x: -0.3, w: 0.19, top: 0.19, bottom: 0.19, yc: 0, n: 2 },
      { x: 0.6, w: 0.2, top: 0.2, bottom: 0.2, yc: 0, n: 2 },
      { x: 1.3, w: 0.17, top: 0.17, bottom: 0.17, yc: 0, n: 2 },
      { x: 1.65, w: 0.1, top: 0.1, bottom: 0.1, yc: 0, n: 2 },
      { x: 1.8, w: 0.01, top: 0.01, bottom: 0.01, yc: 0, n: 2 },
    ], { detail, step: 0.3, segs: HI ? 24 : 10 });
    const tg = std(tank.geo.clone());
    // Map the tank's texture panel: u along the length, v around.
    const uvA = tg.attributes.uv;
    const r = atlas.rects.tank;
    for (let i = 0; i < uvA.count; i++) { const [u, v] = r.uv(-1.5 + (uvA.getX(i)) * 3.0, (uvA.getY(i) - 0.5) * 0.7); uvA.setXY(i, u, v); }
    fixed.addPair('wing', tg, T(TANK.x, TANK.y, TANK.z));
    void uvT;
    for (const s of [1, -1]) {
      fixed.add('wing', wingSurface([{ z: 0, x: -0.2, y: 0, chord: 0.75, t: 0.05 }, { z: 0.32, x: -0.75, y: 0, chord: 0.3, t: 0.05 }], 0, 0.32, { detail: LOW, map: () => [0.0015, 0.0015] }), T(TANK.x - 0.5, 0.0, s * TANK.z, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0));
    }
  }
  // Airbrakes: flush panels on the fuselage sides aft of the wing, hinged on their forward vertical edge.
  if (MID) {
    for (const s of [1, -1]) {
      const pivot = new THREE.Object3D();
      const hit = body.at(-2.1, s > 0 ? 0.02 : Math.PI - 0.02, 0.012);
      pivot.position.copy(hit.p);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(0.85, 0.3, 0.012)), 0.0015, 0.0015), T(-0.42, 0, 0));
      dp.build(pivot);
      root.add(pivot);
      rig.speedbrakes.push({ pivot, axis: new THREE.Vector3(0, 1, 0), angle: s * 1.0 });
    }
  }

  // Lateral intakes with lips and splitters, nozzle, probes, antennas.
  if (MID) {
    for (const s of [1, -1]) {
      const intake = loftBody([
        { x: 0.0, w: 0.2, top: 0.2, bottom: 0.2, yc: 0.05, zc: s * 0.58, n: 2 },
        { x: 0.8, w: 0.3, top: 0.3, bottom: 0.3, yc: 0.07, zc: s * 0.7, n: 2 },
        { x: 1.5, w: 0.27, top: 0.3, bottom: 0.28, yc: 0.06, zc: s * 0.72, n: 2 },
        { x: 1.75, w: 0.23, top: 0.26, bottom: 0.25, yc: 0.06, zc: s * 0.72, n: 2 },
      ], { detail, step: 0.3, segs: HI ? 28 : 12 });
      fixed.add('wing', setUV0(std(intake.geo.clone()), 0.0015, 0.0015));
      fixed.add('intake', std(new THREE.CircleGeometry(1, 20)), T(1.74, 0.06, s * 0.72, 0, Math.PI / 2, 0, 0.215, 0.245, 1));
      fixed.add('metal', std(new THREE.TorusGeometry(1, 0.06, 6, 24)), T(1.76, 0.06, s * 0.72, 0, Math.PI / 2, 0, 0.23, 0.26, 1));
      fixed.add('wing', boxG(1.1, 0.5, 0.012), T(1.2, 0.05, s * 0.5)); // boundary-layer splitter plate
    }
    nozzleParts(fixed, { x: -5.95, y: 0, z: 0, r0: 0.34, r1: 0.27, len: 0.6, petals: 12, detail });
    fixed.add('black', std(new THREE.CircleGeometry(0.25, 16)), T(-6.56, 0, 0, 0, -Math.PI / 2, 0));
    fixed.add('metal', probeGeometry(1.1, 0.012), T(6.0, -0.02, 0));
    fixed.add('black', bladeAntennaGeometry(0.3, 0.12, 0.014), T(-1.4, 0.7, 0));
    fixed.add('black', bladeAntennaGeometry(0.25, 0.1, 0.014), T(-0.4, -0.5, 0, 0, 0, Math.PI));
    if (HI) {
      fixed.add('black', tubeBetween(vec(-5.3, 0.2, 0.02), vec(-5.35, 1.4, 0.02), 0.004, 0.003, 4));
      fixed.add('metal', roundedBox(0.4, 0.04, 0.14, 0.01), T(-5.8, 0.55, 0));
    }
  }

  // Lights.
  const tankTip = (s) => ({ x: TANK.x + 1.8, y: TANK.y, z: s * TANK.z });
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    nav.position.set(TANK.x + 1.0, TANK.y + 0.0, s * (TANK.z + 0.22));
    root.add(nav); rig.lights.nav.push(nav);
    const strobe = glowLight(0xffffff, 0.05, 0.9);
    strobe.position.set(TANK.x - 1.35, TANK.y, s * TANK.z);
    root.add(strobe); rig.lights.strobes.push(strobe);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.04, 1.3), T(TANK.x + 1.0, TANK.y, s * (TANK.z + 0.22), 0, 0, 0));
    const landing = glowLight(0xfff3d0, 0.07, 0.9);
    landing.position.set(0.7, -0.22, s * 1.2);
    root.add(landing); rig.lights.landing.push(landing);
  }
  void tankTip;
  const beacon = glowLight(0xff2a2a, 0.045, 1.0);
  beacon.position.set(-2.4, 0.76, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);
  const tailNav = glowLight(0xffffff, 0.04, 0.6);
  tailNav.position.set(-5.5, FIN_BASE + 2.6, 0);
  root.add(tailNav); rig.lights.nav.push(tailNav);

  // Retractable gear.
  const g = spec.gear;
  const noseAttach = -0.36;
  const noseLeg = makeProGearLeg({ length: noseAttach - g.nose.y, strutR: 0.04, wheelRadius: 0.2, wheelWidth: 0.1, fork: 'single', outerFrac: 0.5, lightMount: [0.12, -0.45, 0] }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  const mainAttach = -0.32;
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = makeProGearLeg({ length: mainAttach - pos.y, strutR: 0.045, wheelRadius: 0.33, wheelWidth: 0.16, fork: 'single', outerFrac: 0.5, brake: true, drag: 0.35 }, mats, detail);
    leg.position.set(pos.x, mainAttach, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: Math.PI / 2 });
    if (MID) {
      const door = new THREE.Object3D();
      door.position.set(pos.x, mainAttach - 0.03, pos.z + side * 0.25);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(0.8, 0.02, 0.3)), 0.0015, 0.0015), T(0, 0, -side * 0.15));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.15 });
    }
  }
  if (MID) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x, noseAttach - 0.04, s * 0.17);
      const dp = new Parts(mats);
      dp.add('wing', setUV0(std(new THREE.BoxGeometry(0.6, 0.015, 0.16)), 0.0015, 0.0015), T(0, 0, -s * 0.08));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void quadAt;
  return { group: root, rig };
}
