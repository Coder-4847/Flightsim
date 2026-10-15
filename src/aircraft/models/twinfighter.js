import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, bodyPatch, boxG, hingedSurface, loftBody, roundedBox, sectionAt, setUV0, std, tubeBetween, vec, wingSurface,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, probeGeometry,
} from './kitparts.js';
import { registerPro, shade } from './skins.js';
import { paintAtlas, roundel } from './paintkit.js';
import { paintBody, rad } from './bodypaint.js';
import {
  burnerFlame, canopyBow, coamingParts, missileParts, nozzleParts, railParts, seatParts,
} from './jetkit.js';
import { newRig } from './common.js';

// Twin-engine fighters: the carrier-based Corsair F/18 (F/A-18 Hornet analogue) and the long-range Warden S-27
// (Su-27 Flanker analogue). One configurable builder, two configurations.

registerPro(['hornet', 'heavyfighter'], 'fighter');

const S = (x, w, yTop, yBot, n = 2.4) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const N = (x, w, yTop, yBot, zc, yc, n = 2.2) => ({ x, w, top: yTop, bottom: yBot, zc, yc, n });

const CONFIGS = {
  hornet: {
    stations: [
      S(-7.0, 0.78, 0.5, -0.5, 2.5), S(-5.5, 1.2, 0.62, -0.58, 2.7), S(-3.5, 1.35, 0.7, -0.65, 2.8), S(-1.0, 1.35, 0.78, -0.75, 2.8),
      S(1.0, 1.25, 0.8, -0.8, 2.7), S(2.6, 1.0, 0.78, -0.75, 2.5), S(3.8, 0.8, 0.75, -0.6, 2.35), S(5.0, 0.6, 0.68, -0.42, 2.2),
      S(6.2, 0.38, 0.55, -0.2, 2.1), S(7.1, 0.17, 0.4, 0.02, 2), S(7.8, 0.02, 0.3, 0.12, 2),
    ],
    canopy: [
      { x: 2.2, w: 0.04, top: 0.04, bottom: 0.04, yc: 0.82, n: 2 }, { x: 2.8, w: 0.36, top: 0.34, bottom: 0.12, yc: 0.84, n: 2.2 },
      { x: 3.7, w: 0.5, top: 0.52, bottom: 0.14, yc: 0.88, n: 2.3 }, { x: 4.5, w: 0.44, top: 0.46, bottom: 0.14, yc: 0.82, n: 2.3 },
      { x: 5.1, w: 0.3, top: 0.28, bottom: 0.14, yc: 0.74, n: 2.2 }, { x: 5.5, w: 0.1, top: 0.1, bottom: 0.1, yc: 0.68, n: 2.1 }, { x: 5.6, w: 0.01, top: 0.02, bottom: 0.02, yc: 0.64, n: 2 },
    ],
    canopyBows: [2.9, 5.2], seats: [{ x: 3.7, y: 0.5 }], coaming: { x: 4.8, y: 0.8 },
    wing: [
      { z: 1.1, x: 1.2, y: -0.2, chord: 4.9, t: 0.05, camber: 0.012, cp: 0.4 },
      { z: 5.715, x: -1.04, y: -0.1, chord: 1.5, t: 0.04, camber: 0.008, cp: 0.4, twist: -1 },
    ],
    wingRoot: 0.8, flap: [1.4, 3.5], ail: [3.6, 5.55], hinge: 0.72,
    lerx: [{ z: 0.6, x: 5.8, y: -0.05, chord: 4.1, t: 0.03 }, { z: 1.2, x: 3.5, y: -0.12, chord: 2.05, t: 0.03 }, { z: 1.9, x: 0.85, y: -0.18, chord: 0.35, t: 0.03 }],
    stab: { sections: [{ z: 0.8, x: -4.3, y: 0.0, chord: 2.8, t: 0.04 }, { z: 3.3, x: -6.5, y: 0.04, chord: 1.1, t: 0.035 }], z0: 0.8, z1: 3.3 },
    fins: { sections: [{ z: 0, x: -3.2, y: 0, chord: 3.7, t: 0.05 }, { z: 2.24, x: -4.8, y: 0, chord: 1.6, t: 0.04 }], base: { y: 0.7, z: 1.05 }, cant: 0.35, height: 2.24, hinge: 0.7 },
    intake: { right: [N(-0.6, 0.5, 0.5, 0.5, 0.98, -0.45, 2.8), N(0.8, 0.52, 0.52, 0.5, 1.0, -0.45, 3), N(2.4, 0.5, 0.5, 0.48, 1.02, -0.47, 3), N(3.05, 0.44, 0.47, 0.45, 1.02, -0.5, 3), N(3.12, 0.4, 0.43, 0.42, 1.02, -0.5, 3)], lip: 3.0, a: [-105, 105] },
    nacelles: { right: [N(-5.2, 0.55, 0.52, 0.52, 0.72, 0, 2.2), N(-6.8, 0.54, 0.52, 0.52, 0.72, 0, 2.2), N(-8.2, 0.5, 0.48, 0.48, 0.72, 0, 2.2), N(-8.75, 0.49, 0.47, 0.47, 0.72, 0, 2.2)] },
    nozzle: { x: -8.7, r0: 0.5, r1: 0.46, len: 0.6, z: 0.72, y: 0 },
    flame: { r: 0.44, len: 3.4 },
    airbrake: { x: -2.2, y: 0.8, len: 1.3, w: 0.9 },
    tail: 'hook',
    rail: { x: -0.6, y: -0.1 },
    probe: { x: 7.7, y: 0.22 },
    gear: { nose: { attach: -0.65, wheels: [[0, -0.1], [0, 0.1]], r: 0.27, w: 0.14, strut: 0.05, retract: 1 }, main: { attach: -0.55, r: 0.35, w: 0.22, strut: 0.065 } },
    insignia: '#2b4170', strobe: [-6.2, 3.0],
    text: 'CORSAIR  F/18', textX: 4.4,
  },
  heavyfighter: {
    stations: [
      S(-9.0, 0.9, 0.62, -0.6, 2.5), S(-6.5, 1.45, 0.85, -0.8, 2.8), S(-3.0, 1.6, 1.0, -0.95, 2.9), S(0.0, 1.6, 1.1, -1.0, 2.9),
      S(3.0, 1.35, 1.05, -0.9, 2.7), S(5.0, 1.0, 0.95, -0.7, 2.4), S(6.5, 0.78, 0.82, -0.5, 2.2), S(8.0, 0.45, 0.68, -0.15, 2.1),
      S(9.2, 0.2, 0.5, 0.08, 2), S(9.85, 0.02, 0.35, 0.17, 2),
    ],
    canopy: [
      { x: 4.8, w: 0.04, top: 0.04, bottom: 0.04, yc: 1.0, n: 2 }, { x: 5.5, w: 0.4, top: 0.4, bottom: 0.14, yc: 1.0, n: 2.2 },
      { x: 6.6, w: 0.56, top: 0.62, bottom: 0.16, yc: 1.04, n: 2.3 }, { x: 7.6, w: 0.5, top: 0.54, bottom: 0.16, yc: 0.98, n: 2.3 },
      { x: 8.3, w: 0.34, top: 0.32, bottom: 0.16, yc: 0.86, n: 2.2 }, { x: 8.7, w: 0.1, top: 0.1, bottom: 0.1, yc: 0.78, n: 2.1 }, { x: 8.8, w: 0.01, top: 0.02, bottom: 0.02, yc: 0.74, n: 2 },
    ],
    canopyBows: [5.7, 8.4], seats: [{ x: 6.7, y: 0.6 }], coaming: { x: 7.9, y: 0.92 },
    wing: [
      { z: 1.9, x: 3.6, y: -0.1, chord: 8.4, t: 0.05, camber: 0.012, cp: 0.4 },
      { z: 7.35, x: -1.3, y: 0.1, chord: 1.9, t: 0.04, camber: 0.008, cp: 0.4, twist: -1.5 },
    ],
    wingRoot: 1.4, flap: [2.3, 4.7], ail: [4.8, 7.2], hinge: 0.78,
    lerx: [{ z: 0.75, x: 8.2, y: 0.18, chord: 6.0, t: 0.03 }, { z: 1.5, x: 5.6, y: 0.1, chord: 3.0, t: 0.03 }, { z: 2.2, x: 3.4, y: 0.0, chord: 1.0, t: 0.03 }],
    stab: { sections: [{ z: 1.9, x: -7.6, y: 0.0, chord: 3.4, t: 0.04 }, { z: 4.8, x: -9.8, y: 0.1, chord: 1.3, t: 0.035 }], z0: 1.9, z1: 4.8 },
    fins: { sections: [{ z: 0, x: -4.0, y: 0, chord: 4.8, t: 0.05 }, { z: 3.1, x: -7.0, y: 0, chord: 2.0, t: 0.04 }], base: { y: 0.55, z: 2.35 }, cant: 0.0, height: 3.1, hinge: 0.7 },
    intake: { right: [N(-1.0, 0.7, 0.68, 0.68, 1.38, -0.12, 2.3), N(1.0, 0.68, 0.64, 0.66, 1.38, -0.22, 2.4), N(2.4, 0.66, 0.55, 0.55, 1.38, -0.4, 2.4), N(3.3, 0.56, 0.42, 0.44, 1.38, -0.55, 2.3), N(3.42, 0.5, 0.38, 0.4, 1.38, -0.56, 2.3)], lip: 3.35, a: [-110, 110] },
    nacelles: { right: [N(-1.0, 0.72, 0.7, 0.7, 1.38, -0.1, 2.2), N(-4.5, 0.78, 0.74, 0.74, 1.38, -0.06, 2.2), N(-7.4, 0.72, 0.68, 0.68, 1.38, -0.05, 2.2), N(-9.3, 0.7, 0.66, 0.66, 1.38, -0.05, 2.2), N(-9.7, 0.68, 0.64, 0.64, 1.38, -0.05, 2.2)] },
    nozzle: { x: -9.65, r0: 0.66, r1: 0.62, len: 0.8, z: 1.38, y: -0.05 },
    flame: { r: 0.6, len: 4.6 },
    airbrake: { x: -2.6, y: 1.1, len: 1.7, w: 1.4 },
    tail: 'stinger',
    rail: { x: -2.4, y: 0.0 },
    probe: { x: 9.8, y: 0.25 },
    gear: { nose: { attach: -0.9, wheels: [[0, -0.12], [0, 0.12]], r: 0.28, w: 0.16, strut: 0.06, retract: 1 }, main: { attach: -0.85, r: 0.4, w: 0.26, strut: 0.08 } },
    insignia: '#27406e', strobe: [-8.5, 3.55],
    text: 'WARDEN  S-27', textX: 7.6,
  },
};

export function buildTwinFighter(spec, mats, detail, key = spec.id) {
  const c = CONFIGS[key];
  const root = new THREE.Group();
  const rig = newRig();
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group();
  root.add(exterior);
  rig.fuselage = exterior;
  const L = spec.livery;
  const wingTip = c.wing[c.wing.length - 1];

  const body = loftBody(c.stations, { detail, step: 0.4 });
  const canopy = loftBody(c.canopy, { detail, step: 0.3, segs: HI ? 36 : 14 });
  if (!mats.__painted) {
    const light = L.base; const low = L.belly ?? shade(L.base, -0.06);
    const x0 = c.stations[0].x; const xn = c.stations[c.stations.length - 1].x;
    const skinTex = paintBody(mats, body, spec, {
      base: light, belly: low, bellyAngle: -30,
      extra: (P) => {
        P.poly([[xn - 1.6, -90], [xn + 0.3, -90], [xn + 0.3, 270], [xn - 1.6, 270]], shade(light, -0.22)); // radome
        P.poly([[xn - 3.4, 62], [xn - 1.6, 66], [xn - 1.6, 114], [xn - 3.4, 118]], '#2a2d31'); // anti-glare panel
      },
      blobs: [
        { x: x0 + 1.5, a: 0, rx: 1.6, ry: 0.5, color: '#3a3430', alpha: 0.5 },
      ],
      rings: [x0 + 2, x0 + 4, x0 + 6.5, x0 + 9, x0 + 11, xn - 4, xn - 2.8],
      seams: [[x0 + 1, 20, xn - 3, 20], [x0 + 1, 50, xn - 4, 50], [x0 + 1, 75, xn - 5, 75], [x0 + 2, -25, xn - 5, -25], [x0 + 3, -55, xn - 5, -55]],
      stencils: [{ str: 'NO STEP', x: (x0 + xn) / 2 - 1, a: 82, size: 0.06, color: '#a02020' }, { str: 'RESCUE', x: xn - 3.4, a: 55, size: 0.07, color: '#a02020' }, { str: 'DANGER', x: xn - 2.4, a: 20, size: 0.04, color: '#a02020' }],
      regs: [{ x: xn - 3.1, a: 36, size: 0.22, stretch: 0.9, weight: 'normal', alpha: 0.9 }],
      dirt: { streaks: [{ x: x0 + 2, a: 0, len: 3, w: 0.25, alpha: 0.2 }, { x: xn - 2, a: 40, len: 3, w: 0.05, alpha: 0.22 }], mottle: 0.12 },
      ao: [{ x: (x0 + xn) / 2, a: -50, rx: 3, ry: 0.15, alpha: 0.2 }],
      extra: (P) => {
        for (const s of [1, -1]) P.local(c.textX - 5.5, 20, s, (g) => roundel(g, 0, 0, 0.34, [c.insignia, '#c9ced4', '#8a2f30'], 0.85));
        for (const s of [1, -1]) P.text(c.text, c.textX - 1.3, 30, s, 0.07, { color: '#c9ced4', alpha: 0.5 });
      },
    });
    const wb = L.wing ?? L.base;
    const under = L.belly ?? shade(wb, -0.08);
    const finLen = c.fins.height / Math.cos(c.fins.cant);
    const atlas = paintAtlas(mats, wb, {
      wing: { span: wingTip.z - c.wing[0].z + 0.3, chord: Math.max(...c.wing.map((s) => s.chord)) / 1 + 0.3, z0: c.wing[0].z },
      lerx: { span: 1.5, chord: c.lerx[0].chord / 2 + 0.4, z0: c.lerx[0].z },
      stab: { span: c.stab.z1 - c.stab.z0 + 0.2, chord: c.stab.sections[0].chord / 1.4 + 0.2, z0: c.stab.z0 },
      fin: { span: finLen + 0.3, chord: c.fins.sections[0].chord / 1.0 * 0.6 + 0.3, z0: 0 },
    }, {
      wing: {
        sections: c.wing, z0: c.wing[0].z, z1: wingTip.z, base: wb, under,
        seams: [{ z0: c.flap[0], z1: c.flap[1], xf: c.hinge }, { z0: c.ail[0], z1: c.ail[1], xf: c.hinge }],
        tip: { color: L.tip ? `#${new THREE.Color(L.tip).getHexString()}` : shade(wb, -0.3), len: 0.05 }, dirt: 0.4,
        extra: (g) => { const z = (c.wing[0].z + wingTip.z) * 0.55; roundel(g, z, 1.2, 0.3, [c.insignia, '#c9ced4', '#8a2f30'], 0.85); roundel(g, z, -1.2, 0.3, [c.insignia, '#c9ced4', '#8a2f30'], 0.85); },
        text: [{ str: 'NO STEP', z: c.wing[0].z + 0.6, p: 1.0, size: 0.05, color: '#a02020' }], seed: 91,
      },
      lerx: { sections: c.lerx, z0: c.lerx[0].z, z1: c.lerx[2].z, base: wb, under, dirt: 0.35, seed: 4 },
      stab: { sections: c.stab.sections, z0: c.stab.z0, z1: c.stab.z1, base: shade(wb, -0.04), under, dirt: 0.4, seed: 6 },
      fin: {
        sections: c.fins.sections, z0: 0, z1: finLen, base: wb, under: wb, seams: [{ z0: 0.5, z1: finLen, xf: c.fins.hinge }], dirt: 0.4, seed: 9,
        text: [{ str: spec.registration, z: finLen * 0.35, p: 1.0, size: 0.22, rot: Math.PI / 2, color: L.regColor ?? '#2a2f36' }],
        extra: (g) => { roundel(g, finLen * 0.6, 1.3, 0.25, [c.insignia, '#c9ced4', '#8a2f30'], 0.8); },
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

  // Canopy, frame bows, seat and coaming.
  ext.add('glass', canopy.geo);
  if (MID) {
    for (const x of c.canopyBows) canopyBow(ext, canopy, x, 0.1, Math.PI - 0.1, 0.012, 0.03);
    const cs = c.canopy;
    ext.add('dark', tubeBetween(vec(cs[cs.length - 2].x, cs[cs.length - 2].yc - 0.02, 0), vec(cs[1].x, cs[1].yc, 0), 0.016, 0.016, 6));
    if (HI) {
      for (const s of c.seats) seatParts(ext, { x: s.x, y: s.y, scale: 1.05 });
      coamingParts(ext, { x: c.coaming.x, y: c.coaming.y, w: 0.9, d: 0.6 });
    }
  }

  // Intake ducts and engine nacelles (mirrored pairs), splitter plates, lips.
  if (MID) {
    const ik = loftBody(c.intake.right, { detail, step: 0.4, segs: HI ? 28 : 12 });
    fixed.addPair('wing', flat(ik.geo.clone()));
    const first = c.intake.right[c.intake.right.length - 1];
    const lipPatch = bodyPatch(ik, rad([[c.intake.lip - 0.12, c.intake.a[0]], [c.intake.lip + 0.01, c.intake.a[0]], [c.intake.lip + 0.01, c.intake.a[1]], [c.intake.lip - 0.12, c.intake.a[1]]]), { lift: 0.004, p: 2.6, nu: 6, nv: 10 });
    void first; void lipPatch;
    fixed.addPair('intake', std(new THREE.CircleGeometry(1, 24)), T(c.intake.right[c.intake.right.length - 1].x + 0.012, c.intake.right[c.intake.right.length - 1].yc, c.intake.right[c.intake.right.length - 1].zc, 0, Math.PI / 2, 0, c.intake.right[c.intake.right.length - 1].w * 0.92, (c.intake.right[c.intake.right.length - 1].top + c.intake.right[c.intake.right.length - 1].bottom) / 2 * 0.95, 1));
    const lp = c.intake.right[c.intake.right.length - 1];
    fixed.addPair('metal', std(new THREE.TorusGeometry(1, 0.035, 6, 28)), T(lp.x + 0.013, lp.yc, lp.zc, 0, Math.PI / 2, 0, lp.w, (lp.top + lp.bottom) / 2, 1));
    fixed.addPair('wing', boxG(1.2, (lp.top + lp.bottom) * 1.2, 0.012), T(lp.x - 0.7, lp.yc, lp.zc - lp.w - 0.06)); // boundary-layer splitter plate
    const nac = loftBody(c.nacelles.right, { detail, step: 0.5, segs: HI ? 28 : 12 });
    fixed.addPair('wing', flat(nac.geo.clone()));
  }
  // Nozzles and afterburner flames (engine order: left then right).
  const nz = c.nozzle;
  for (const s of [-1, 1]) {
    nozzleParts(fixed, { x: nz.x, y: nz.y, z: s * nz.z, r0: nz.r0, r1: nz.r1, len: nz.len, petals: 18, detail });
    const flame = burnerFlame(c.flame.r, c.flame.len);
    flame.group.position.set(nz.x - nz.len, nz.y, s * nz.z);
    root.add(flame.group);
    rig.burners.push(flame);
  }

  // LERX, wings, flaps, ailerons, stabilators, fins and rudders.
  fixed.addPair('wing', wingSurface(c.lerx, c.lerx[0].z, c.lerx[2].z, { detail, tipRound: 0.01, map: uvL, dz: 0.3 }));
  const w0 = c.wing[0].z;
  fixed.addPair('wing', wingSurface(c.wing, c.wingRoot, wingTip.z, { xf0: 0, xf1: c.hinge, detail, tipRound: 0.07, map: uvW, dz: 0.8 }));
  fixed.addPair('wing', wingSurface(c.wing, c.flap[1], c.ail[0], { xf0: c.hinge, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvW }));
  fixed.addPair('wing', wingSurface(c.wing, c.ail[1], wingTip.z, { xf0: c.hinge, xf1: 1, detail, roundNose: true, capA: true, tipRound: 0.07, map: uvW }));
  fixed.addPair('wing', wingSurface(c.wing, c.wingRoot, c.flap[0], { xf0: c.hinge, xf1: 1, detail, roundNose: true, capB: true, map: uvW }));
  for (const side of [1, -1]) {
    const flap = hingedSurface(c.wing, c.flap[0], c.flap[1], c.hinge, mats.wing, { detail, side, map: uvW });
    const ail = hingedSurface(c.wing, c.ail[0], c.ail[1], c.hinge, mats.wing, { detail, side, map: uvW });
    root.add(flap.pivot, ail.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
    // Stabilator
    const st = c.stab.sections;
    const px = st[0].x - 0.4 * st[0].chord;
    let geo = wingSurface(st, c.stab.z0, c.stab.z1, { detail, tipRound: 0.04, capA: true, map: uvS, dz: 0.5 });
    geo.translate(-px, -st[0].y, 0);
    if (side < 0) { geo = std(geo); geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1)); const ia = geo.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } }
    const pivot = new THREE.Object3D();
    pivot.position.set(px, st[0].y, 0);
    pivot.add(new THREE.Mesh(geo, mats.wing));
    root.add(pivot);
    rig.elevators.push({ pivot, axis: new THREE.Vector3(0, 0, 1) });
  }
  const f = c.fins;
  const finLen = f.height / Math.cos(f.cant);
  for (const side of [-1, 1]) {
    const m = T(0, f.base.y, f.base.z, f.cant - Math.PI / 2, 0, 0);
    // The right fin is built, the left is its mirror image (rudders share one rotation sense).
    const fm = side > 0 ? m : null;
    if (side > 0) fixed.add('wing', wingSurface(f.sections, 0, finLen, { xf0: 0, xf1: f.hinge, detail, tipRound: 0.06, map: uvF, dz: 0.6 }), fm);
    else fixed.add('wing', wingSurface(f.sections, 0, finLen, { xf0: 0, xf1: f.hinge, detail, tipRound: 0.06, map: uvF, dz: 0.6 }), new THREE.Matrix4().makeScale(1, 1, -1).multiply(m));
    const rud = hingedSurface(f.sections, 0.5, finLen, f.hinge, mats.wing, { detail, m, side, map: uvF, kind: 'rudder' });
    // Mirrored fins need their base moved to the other side: hingedSurface mirrors positions already.
    root.add(rud.pivot);
    rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });
  }

  // Airbrake panel on the spine, hinged at its forward edge.
  if (MID) {
    const ab = c.airbrake;
    const pivot = new THREE.Object3D();
    pivot.position.set(ab.x, ab.y, 0);
    const dp = new Parts(mats);
    dp.add('wing', flat(boxG(ab.len, 0.02, ab.w)), T(-ab.len / 2, 0, 0));
    dp.build(pivot);
    root.add(pivot);
    rig.speedbrakes.push({ pivot, axis: new THREE.Vector3(0, 0, 1), angle: -1.0 });
  }

  // Tail details, probes and antennas.
  if (MID) {
    if (c.tail === 'stinger') {
      const st = loftBody([
        { x: -9.5, w: 0.3, top: 0.3, bottom: 0.3, yc: 0.2, n: 2 }, { x: -10.5, w: 0.3, top: 0.28, bottom: 0.28, yc: 0.2, n: 2 },
        { x: -11.5, w: 0.2, top: 0.2, bottom: 0.2, yc: 0.2, n: 2 }, { x: -11.9, w: 0.08, top: 0.08, bottom: 0.08, yc: 0.2, n: 2 }, { x: -12.0, w: 0.01, top: 0.01, bottom: 0.01, yc: 0.2, n: 2 },
      ], { detail, step: 0.5, segs: HI ? 16 : 8 });
      fixed.add('wing', flat(st.geo.clone()));
      for (const s of [1, -1]) { // tail booms carrying the fins and stabilators
        const bm = loftBody([
          { x: -1.5, w: 0.3, top: 0.3, bottom: 0.3, yc: 0.2, zc: s * 2.0, n: 2.2 }, { x: -5.0, w: 0.46, top: 0.4, bottom: 0.4, yc: 0.2, zc: s * 2.3, n: 2.2 },
          { x: -9.0, w: 0.42, top: 0.38, bottom: 0.38, yc: 0.12, zc: s * 2.35, n: 2.2 }, { x: -10.4, w: 0.2, top: 0.2, bottom: 0.2, yc: 0.1, zc: s * 2.35, n: 2 }, { x: -10.6, w: 0.01, top: 0.01, bottom: 0.01, yc: 0.1, zc: s * 2.35, n: 2 },
        ], { detail, step: 0.6, segs: HI ? 20 : 8 });
        fixed.add('wing', flat(bm.geo.clone()));
      }
      fixed.add('black', std(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8)), T(-12.0, 0.2, 0, 0, 0, Math.PI / 2));
    } else {
      fixed.add('steel', tubeBetween(vec(-7.0, -0.4, 0), vec(-8.7, -0.35, 0), 0.04, 0.035, 8)); // arrestor hook
      fixed.add('steel', roundedBox(0.3, 0.07, 0.14, 0.02), T(-7.1, -0.42, 0));
    }
    fixed.add('metal', probeGeometry(1.2, 0.014), T(c.probe.x, c.probe.y, 0));
    fixed.add('black', bladeAntennaGeometry(0.3, 0.14, 0.014), T(c.canopy[1].x - 1.0, 0.82, 0.3));
    fixed.add('black', bladeAntennaGeometry(0.3, 0.14, 0.014), T(-4.0, 0.76, 0));
    fixed.add('black', bladeAntennaGeometry(0.22, 0.1, 0.012), T(0.5, -0.8, 0, 0, 0, Math.PI));
    for (const s of [1, -1]) {
      railParts(fixed, { x: c.rail.x, y: c.rail.y, z: s * (wingTip.z + 0.1), len: 2.2 });
      missileParts(fixed, { x: c.rail.x, y: c.rail.y, z: s * (wingTip.z + 0.1), len: key === 'heavyfighter' ? 2.9 : 2.9, detail });
    }
  }

  // Lights.
  for (const s of [1, -1]) {
    const nav = glowLight(s > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    nav.position.set(wingTip.x + 0.6, wingTip.y, s * (wingTip.z + 0.1));
    root.add(nav); rig.lights.nav.push(nav);
    fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.04, 1.3), T(wingTip.x + 0.6, wingTip.y, s * (wingTip.z + 0.1)));
    const landing = glowLight(0xfff3d0, 0.07, 0.9);
    landing.position.set(spec.gear.mainLeft.x + 0.3, spec.gear.mainLeft.y + 1.2, s * 1.2);
    root.add(landing); rig.lights.landing.push(landing);
    const strobe = glowLight(0xffffff, 0.05, 0.9);
    strobe.position.set(c.strobe[0], f.base.y + f.height, s * (f.base.z + Math.tan(f.cant) * f.height));
    root.add(strobe); rig.lights.strobes.push(strobe);
  }
  const beacon = glowLight(0xff2a2a, 0.045, 1.0);
  beacon.position.set(c.airbrake.x - 1.5, c.airbrake.y + 0.05, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);

  // Retractable gear.
  const g = spec.gear;
  const ng = c.gear.nose;
  const noseLeg = makeProGearLeg({ length: ng.attach - g.nose.y, strutR: ng.strut, wheelRadius: ng.r, wheelWidth: ng.w, wheels: ng.wheels, fork: 'double', outerFrac: 0.5, lightMount: [0.16, -0.6, 0] }, mats, detail);
  noseLeg.position.set(g.nose.x, ng.attach, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  const mg = c.gear.main;
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = makeProGearLeg({ length: mg.attach - pos.y, strutR: mg.strut, wheelRadius: mg.r, wheelWidth: mg.w, fork: 'single', outerFrac: 0.5, brake: true, drag: 0.35 }, mats, detail);
    leg.position.set(pos.x, mg.attach, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: Math.PI / 2 });
    if (MID) {
      const door = new THREE.Object3D();
      door.position.set(pos.x, mg.attach - 0.02, pos.z + side * 0.3);
      const dp = new Parts(mats);
      dp.add('wing', flat(boxG(1.0, 0.02, 0.42)), T(0, 0, -side * 0.21));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.15 });
    }
  }
  if (MID) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x, ng.attach - 0.03, s * 0.22);
      const dp = new Parts(mats);
      dp.add('wing', flat(boxG(0.8, 0.015, 0.2)), T(0, 0, -s * 0.1));
      dp.build(door);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void LOW; void sectionAt; void w0;
  return { group: root, rig };
}

export const buildHornet = (spec, mats, detail) => buildTwinFighter(spec, mats, detail, 'hornet');
export const buildHeavyFighter = (spec, mats, detail) => buildTwinFighter(spec, mats, detail, 'heavyfighter');
