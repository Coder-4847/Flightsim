import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, bodyPatch, boxG, hingedSurface, loftBody, roundedBox, sectionAt, setUV0, std, tubeBetween, vec, wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, probeGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { camoBlobs, paintAtlas, roundel } from './paintkit.js';
import { paintBody, quadAt, rad } from './bodypaint.js';
import {
  burnerFlame, canopyBow, coamingParts, missileParts, nozzleParts, railParts, seatParts,
} from './jetkit.js';
import { newRig } from './common.js';

// Falcon F-16 (F-16 Fighting Falcon analogue): single-engine light fighter with a blended wing-body, ventral intake,
// bubble canopy, leading-edge root extensions and all-moving tailplanes. Length 15 m, span 9.45 m.

registerPro(['fighter'], 'fighter');

const S = (x, w, yTop, yBot, n = 2.4) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-7.35, 0.52, 0.52, -0.52, 2.1),
  S(-6.6, 0.56, 0.58, -0.56, 2.15),
  S(-5.5, 0.62, 0.62, -0.62, 2.2),
  S(-4.4, 0.72, 0.72, -0.7, 2.3),
  S(-3.0, 0.8, 0.86, -0.74, 2.5),
  S(-1.2, 0.84, 0.95, -0.78, 2.6),
  S(0.6, 0.84, 0.95, -0.8, 2.6),
  S(2.0, 0.78, 0.86, -0.76, 2.5),
  S(3.3, 0.66, 0.78, -0.62, 2.4),
  S(4.4, 0.54, 0.72, -0.42, 2.3),
  S(5.4, 0.4, 0.62, -0.18, 2.2),
  S(6.2, 0.22, 0.5, 0.0, 2.1),
  S(6.7, 0.09, 0.36, 0.13, 2),
  S(6.9, 0.012, 0.28, 0.22, 2),
];
const CANOPY = [
  { x: 1.7, w: 0.04, top: 0.04, bottom: 0.04, yc: 0.86, n: 2 },
  { x: 2.2, w: 0.3, top: 0.3, bottom: 0.1, yc: 0.82, n: 2.2 },
  { x: 2.9, w: 0.42, top: 0.5, bottom: 0.12, yc: 0.86, n: 2.3 },
  { x: 3.7, w: 0.4, top: 0.48, bottom: 0.12, yc: 0.82, n: 2.3 },
  { x: 4.3, w: 0.3, top: 0.3, bottom: 0.12, yc: 0.76, n: 2.2 },
  { x: 4.75, w: 0.14, top: 0.12, bottom: 0.1, yc: 0.7, n: 2.1 },
  { x: 4.9, w: 0.01, top: 0.02, bottom: 0.02, yc: 0.66, n: 2 },
];
const INTAKE = [
  { x: 0.0, w: 0.3, top: 0.2, bottom: 0.3, yc: -0.6, n: 2.2 },
  { x: 0.8, w: 0.46, top: 0.25, bottom: 0.2, yc: -0.68, n: 2.3 },
  { x: 2.3, w: 0.56, top: 0.35, bottom: 0.14, yc: -0.64, n: 2.3 },
  { x: 3.7, w: 0.54, top: 0.38, bottom: 0.1, yc: -0.6, n: 2.2 },
  { x: 4.0, w: 0.5, top: 0.36, bottom: 0.1, yc: -0.62, n: 2.1 },
  { x: 4.08, w: 0.44, top: 0.32, bottom: 0.08, yc: -0.62, n: 2.1 },
];
const WING = [
  { z: 0.7, x: 1.6, y: -0.16, chord: 4.9, t: 0.04, camber: 0.008, cp: 0.4 },
  { z: 4.725, x: -1.76, y: -0.2, chord: 1.2, t: 0.035, camber: 0.006, cp: 0.4, twist: -1 },
];
const LERX = [
  { z: 0.45, x: 4.6, y: -0.1, chord: 2.7, t: 0.03 },
  { z: 1.0, x: 2.6, y: -0.12, chord: 1.1, t: 0.03 },
  { z: 1.5, x: 0.9, y: -0.14, chord: 0.2, t: 0.03 },
];
const STAB = [
  { z: 0.75, x: -4.75, y: 0.0, chord: 3.0, t: 0.04 },
  { z: 2.8, x: -6.4, y: 0.03, chord: 1.15, t: 0.035 },
];
const FIN = [
  { z: 0, x: -3.0, y: 0, chord: 4.0, t: 0.05 },
  { z: 2.9, x: -5.3, y: 0, chord: 1.5, t: 0.04 },
];
const FIN_BASE = 0.6;
const HINGE = 0.72;
const FLAP = [0.95, 2.9];
const AIL = [3.0, 4.5];
const RUDDER_XF = 0.7;
const WINDSHIELD_BOW = 4.5;

export function buildFighter(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;

  const body = loftBody(STATIONS, { detail, step: 0.35 });
  const canopy = loftBody(CANOPY, { detail, step: 0.3, segs: HI ? 36 : 14 });
  if (!mats.__painted) {
    const light = L.base; const low = L.belly ?? shade(L.base, -0.06);
    const skinTex = paintBody(mats, body, spec, {
      base: light, belly: low, bellyAngle: -35,
      // Crisp-edged radome and anti-glare panel (soft blobs read as burn marks).
      extra: (P) => {
        P.poly([[5.45, -90], [7.2, -90], [7.2, 270], [5.45, 270]], shade(light, -0.24));
        P.poly([[4.85, 62], [5.45, 66], [5.45, 114], [4.85, 118]], '#2a2d31');
      },
      blobs: [
        { x: -7.2, a: 0, rx: 1.0, ry: 0.5, color: '#3a3430', alpha: 0.5 }, // heat staining
        { x: -6.2, a: 90, rx: 1.4, ry: 0.3, color: '#2c2824', alpha: 0.35 },
      ],
      rings: [-6.0, -4.8, -3.4, -2.0, -0.6, 0.8, 2.2, 3.4, 5.0, 6.0],
      seams: [[-6, 10, 0.8, 10], [-6, 45, 0.8, 45], [-6, 70, 2, 70], [-6, -20, 2, -20], [-6, -50, 3, -50], [3.4, 20, 6, 20], [3.4, -15, 6, -10]],
      stencils: [{ str: 'NO STEP', x: -2.3, a: 80, size: 0.05, color: '#a02020' }, { str: 'RESCUE', x: 3.6, a: 52, size: 0.06, color: '#a02020' }, { str: 'DANGER', x: 4.5, a: 20, size: 0.035, color: '#a02020' }],
      regs: [{ x: -5.4, a: 42, size: 0.2, stretch: 0.9, weight: 'normal', alpha: 0.9 }],
      dirt: { streaks: [{ x: -5.0, a: 0, len: 2.5, w: 0.2, alpha: 0.18 }, { x: 5.5, a: 40, len: 3, w: 0.05, alpha: 0.22 }, { x: 1.2, a: 60, len: 4, w: 0.05, alpha: 0.14 }], mottle: 0.12 },
      ao: [{ x: -0.8, a: -50, rx: 2.5, ry: 0.15, alpha: 0.2 }],
      extra: (P) => {
        for (const s of [1, -1]) P.local(1.2, 20, s, (g) => roundel(g, 0, 0, 0.32, ['#2b4170', '#c9ced4', '#8a2f30'], 0.85));
        for (const s of [1, -1]) P.text('FALCON  F-16', -0.2, 52, s, 0.06, { color: '#c9ced4', alpha: 0.5 });
      },
    });
    const wb = L.wing ?? L.base;
    const under = L.belly ?? shade(wb, -0.08);
    const atlas = paintAtlas(mats, wb, { wing: { span: 4.1, chord: 2.6, z0: 0.7 }, lerx: { span: 1.1, chord: 1.4, z0: 0.45 }, stab: { span: 2.1, chord: 1.6, z0: 0.75 }, fin: { span: 3.0, chord: 2.2, z0: 0 } }, {
      wing: {
        sections: WING, z0: 0.7, z1: 4.725, base: wb, under, seams: [{ z0: FLAP[0], z1: FLAP[1], xf: HINGE }, { z0: AIL[0], z1: AIL[1], xf: HINGE }],
        tip: { color: L.tip ? `#${new THREE.Color(L.tip).getHexString()}` : shade(wb, -0.3), len: 0.05 }, dirt: 0.4,
        text: [{ str: 'NO STEP', z: 1.4, p: 0.9, size: 0.04, color: '#a02020' }],
        extra: (g) => { roundel(g, 3.2, 0.9, 0.28, ['#2b4170', '#c9ced4', '#8a2f30'], 0.85); roundel(g, 3.2, -0.9, 0.28, ['#2b4170', '#c9ced4', '#8a2f30'], 0.85); },
        seed: 81,
      },
      lerx: { sections: LERX, z0: 0.45, z1: 1.5, base: wb, under, dirt: 0.35, seed: 4 },
      stab: { sections: STAB, z0: 0.75, z1: 2.8, base: shade(wb, -0.04), under, dirt: 0.4, seed: 6 },
      fin: {
        sections: FIN, z0: 0, z1: 2.9, base: wb, under: wb, seams: [{ z0: 0.5, z1: 2.9, xf: RUDDER_XF }], dirt: 0.4, seed: 9,
        text: [{ str: spec.registration, z: 1.0, p: 1.4, size: 0.2, rot: Math.PI / 2, color: L.regColor ?? '#2a2f36' }],
        extra: (g) => { g.fillStyle = shade(wb, -0.12); g.fillRect(2.3, -2, 0.7, 4); roundel(g, 1.5, 1.8, 0.0, ['#000'], 0); },
      },
    });
    mats.__painted = { skinTex, atlas };
  }
  const { atlas } = mats.__painted;
  const uvW = atlas.rects.wing.uv; const uvL = atlas.rects.lerx.uv; const uvS = atlas.rects.stab.uv; const uvF = atlas.rects.fin.uv;
  const skinMesh = new THREE.Mesh(body.geo, mats.skin);
  exterior.add(skinMesh);
  const fixed = new Parts(mats);
  const ext = new Parts(mats);
  const flat = (g) => setUV0(std(g), 0.0015, 0.0015);

  // Canopy with its frame, seat and cockpit coaming.
  ext.add('glass', canopy.geo);
  if (MID) {
    canopyBow(ext, canopy, 4.55, 0.1, Math.PI - 0.1, 0.012, 0.03);
    canopyBow(ext, canopy, 2.25, 0.1, Math.PI - 0.1, 0.012, 0.03);
    ext.add('dark', tubeBetween(vec(4.6, 0.8, 0.0), vec(1.9, 0.9, 0), 0.016, 0.016, 6)); // centre rail
    for (const s of [-1, 1]) ext.add('dark', tubeBetween(vec(4.6, 0.8, s * 0.28), vec(2.0, 0.84, s * 0.39), 0.025, 0.025, 6));
    if (HI) {
      seatParts(ext, { x: 3.0, y: 0.45, scale: 1.0 });
      coamingParts(ext, { x: 4.0, y: 0.78, w: 0.7, d: 0.55 });
      ext.add('dark', roundedBox(0.3, 0.05, 0.5, 0.02), T(4.35, 0.92, 0)); // HUD
    }
  }

  // Ventral intake with lip and splitter.
  if (MID) {
    const intake = loftBody(INTAKE, { detail, step: 0.4, segs: HI ? 32 : 14 });
    fixed.add('wing', flat(intake.geo.clone()));
    fixed.add('intake', std(new THREE.CircleGeometry(1, 28)), T(4.09, -0.62, 0, 0, Math.PI / 2, 0, 0.44, 0.32, 1));
    fixed.add('metal', std(new THREE.TorusGeometry(1, 0.045, 6, 28)), T(4.1, -0.62, 0, 0, Math.PI / 2, 0, 0.45, 0.33, 1));
    fixed.add('wing', boxG(0.8, 0.07, 0.8), T(3.7, -0.37, 0)); // boundary-layer diverter
  }

  // LERX, wings, flaps and ailerons, tailplanes, fin and rudder, ventral fins.
  fixed.addPair('wing', wingSurface(LERX, 0.45, 1.5, { detail, tipRound: 0.01, map: uvL, dz: 0.3 }));
  fixed.addPair('wing', wingSurface(WING, 0.5, 4.725, { xf0: 0, xf1: HINGE, detail, tipRound: 0.06, map: uvW, dz: 0.8 }));
  fixed.addPair('wing', wingSurface(WING, FLAP[1], AIL[0], { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(WING, AIL[1], 4.725, { xf0: HINGE, xf1: 1, detail, roundNose: true, capA: true, tipRound: 0.06, map: uvW }));
  for (const side of [1, -1]) {
    const flap = hingedSurface(WING, FLAP[0], FLAP[1], HINGE, mats.wing, { detail, side, map: uvW });
    const ail = hingedSurface(WING, AIL[0], AIL[1], HINGE, mats.wing, { detail, side, map: uvW });
    root.add(flap.pivot, ail.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
    // Stabilator: whole surface pivots about its 40 % chord.
    const px = STAB[0].x - 0.4 * STAB[0].chord;
    let geo = wingSurface(STAB, 0.75, 2.8, { detail, tipRound: 0.04, capA: true, map: uvS, dz: 0.5 });
    geo.translate(-px, -STAB[0].y, 0);
    if (side < 0) { geo = std(geo); geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1)); const ia = geo.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } }
    const pivot = new THREE.Object3D();
    pivot.position.set(px, STAB[0].y, 0);
    pivot.add(new THREE.Mesh(geo, mats.wing));
    root.add(pivot);
    rig.elevators.push({ pivot, axis: new THREE.Vector3(0, 0, 1) });
  }
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 2.9, { xf0: 0, xf1: RUDDER_XF, detail, tipRound: 0.05, map: uvF, dz: 0.6 }), finM);
  const rud = hingedSurface(FIN, 0.5, 2.9, RUDDER_XF, mats.wing, { detail, m: finM, side: 1, map: uvF, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });
  if (MID) {
    for (const s of [1, -1]) {
      // Ventral fin, canted outward.
      const vs = [{ z: 0, x: -4.5, y: 0, chord: 1.7, t: 0.035 }, { z: 0.75, x: -5.3, y: 0, chord: 0.9, t: 0.03 }];
      const m = T(0, -0.55, s * 0.5, s > 0 ? Math.PI / 2 + 0.38 : -Math.PI / 2 - 0.38, 0, 0);
      fixed.add('wing', wingSurface(vs, 0, 0.75, { detail: LOW, tipRound: 0.03, map: () => [0.0015, 0.0015] }), m);
    }
    // Dorsal spine fairing: antennas, the refuelling receptacle and a dorsal blade.
    fixed.add('black', bladeAntennaGeometry(0.3, 0.14, 0.014), T(-2.0, 0.95, 0));
    fixed.add('black', bladeAntennaGeometry(0.2, 0.09, 0.012), T(-4.6, 0.73, 0));
    fixed.add('black', roundedBox(0.7, 0.01, 0.34, 0.004), T(-0.8, 0.965, 0)); // receptacle door seam
    fixed.add('metal', probeGeometry(1.15, 0.013), T(6.75, 0.25, 0)); // nose pitot boom
    fixed.add('trim', boxG(0.3, 0.04, 0.12), T(6.3, 0.23, 0.2));
    fixed.add('black', std(new THREE.CylinderGeometry(0.1, 0.05, 0.18, 8)), T(6.2, 0.1, -0.22, 0, 0, Math.PI / 2 - 0.1));
    fixed.add('steel', tubeBetween(vec(-6.4, -0.52, 0), vec(-8.1, -0.45, 0), 0.035, 0.03, 8)); // arrestor hook
    fixed.add('steel', roundedBox(0.3, 0.06, 0.12, 0.02), T(-6.5, -0.52, 0));
  }

  // Engine exhaust and the afterburner flame.
  const nozzleX = -7.3;
  nozzleParts(fixed, { x: nozzleX, y: 0, z: 0, r0: 0.54, r1: 0.5, len: 0.85, petals: 18, detail });
  const flame = burnerFlame(0.48, 3.6);
  flame.group.position.set(nozzleX - 0.85, 0, 0);
  root.add(flame.group);
  rig.burners.push(flame);

  // Wingtip missile rails with training rounds.
  if (MID) {
    for (const s of [1, -1]) {
      railParts(fixed, { x: -1.45, y: -0.2, z: s * 4.8, len: 2.2 });
      missileParts(fixed, { x: -1.45, y: -0.2, z: s * 4.8, len: 2.9, detail });
    }
  }

  // Lights.
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    nav.position.set(-0.3, -0.2, s * 4.9);
    root.add(nav); rig.lights.nav.push(nav);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.035, 1.3), T(-0.3, -0.2, s * 4.9));
    const landing = glowLight(0xfff3d0, 0.07, 0.9);
    landing.position.set(0.0, -0.74, s * 0.9);
    root.add(landing); rig.lights.landing.push(landing);
  }
  const strobeTail = glowLight(0xffffff, 0.05, 0.9);
  strobeTail.position.set(-6.2, FIN_BASE + 2.9, 0);
  root.add(strobeTail); rig.lights.strobes.push(strobeTail);
  const beacon = glowLight(0xff2a2a, 0.045, 1.0);
  beacon.position.set(-3.8, 0.9, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);

  // Retractable gear: the nose leg folds aft, the mains fold inward and forward.
  const g = spec.gear;
  const noseAttach = -0.55;
  const noseLeg = makeProGearLeg({ length: noseAttach - g.nose.y, strutR: 0.045, wheelRadius: 0.23, wheelWidth: 0.12, wheels: [[0, -0.1], [0, 0.1]], fork: 'double', outerFrac: 0.5, lightMount: [0.14, -0.55, 0], linkDir: -1 }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: -1 };
  const mainAttach = -0.45;
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = makeProGearLeg({ length: mainAttach - pos.y, strutR: 0.055, wheelRadius: 0.31, wheelWidth: 0.2, fork: 'single', outerFrac: 0.5, brake: true, drag: 0.3 }, mats, detail);
    leg.position.set(pos.x, mainAttach, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: Math.PI / 2 });
    if (MID) {
      const door = new THREE.Object3D();
      door.position.set(pos.x, mainAttach - 0.02, pos.z + side * 0.28);
      const dp = new Parts(mats);
      dp.add('wing', flat(boxG(0.9, 0.02, 0.4)), T(0, 0, -side * 0.2));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.15 });
    }
  }
  if (MID) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x - 0.3, noseAttach - 0.03, s * 0.2);
      const dp = new Parts(mats);
      dp.add('wing', flat(boxG(0.7, 0.015, 0.18)), T(0, 0, -s * 0.09));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void quadAt; void rad; void sectionAt; void WINDSHIELD_BOW; void bodyPatch;
  return { group: root, rig };
}
