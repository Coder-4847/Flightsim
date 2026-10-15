import * as THREE from 'three';
import {
  HIGH, LOW, MEDIUM, Parts, T, TAU, DEG, airfoilStrut, bodyPatch, boxG, cylX, cylY, cylZ, hingedSurface, loftBody, mirrorZ, patchOutline,
  revolve, roundedBox, sectionAt, std, tubeBetween, vec, wingSurface, xf, sphereG,
} from './kit.js';
import {
  bladeAntennaGeometry, glowLight, lensGeometry, makeProGearLeg, makeProPropeller, makeWheelGroup, probeGeometry, whipGeometry,
} from './kitparts.js';
import { AtlasPaint, BodyPaint, FONT, blot, mix, mottle, registerPro, shade, texSize, attachMap } from './skins.js';
import { paintPanel } from './paintkit.js';
import { newRig } from './common.js';

// Skyhawk 172 (Cessna 172S analogue): high-wing four-seat single, fixed tricycle gear with wheel fairings.
// Body frame: +X nose, +Y up, +Z right, origin at the CG. Length 8.3 m, span 11.0 m.

registerPro(['cessna172'], 'rivet');

const S = (x, w, yTop, yBot, n = 2.4) => ({ x, w, top: (yTop - yBot) / 2, bottom: (yTop - yBot) / 2, yc: (yTop + yBot) / 2, n });
const STATIONS = [
  S(-5.80, 0.003, 0.25, 0.21, 2),
  S(-5.74, 0.026, 0.275, 0.185, 2),
  S(-5.62, 0.052, 0.31, 0.15, 2.1),
  S(-5.40, 0.08, 0.36, 0.10, 2.2),
  S(-4.60, 0.135, 0.41, -0.02, 2.2),
  S(-3.70, 0.235, 0.47, -0.20, 2.3),
  S(-2.90, 0.37, 0.55, -0.37, 2.4),
  S(-2.30, 0.47, 0.68, -0.48, 2.5),
  S(-1.80, 0.53, 0.77, -0.55, 2.6),
  S(-0.90, 0.555, 0.785, -0.60, 2.7),
  S(0.00, 0.555, 0.785, -0.605, 2.7),
  S(0.50, 0.55, 0.74, -0.60, 2.7),
  S(0.95, 0.54, 0.60, -0.595, 2.6),
  S(1.30, 0.51, 0.48, -0.56, 2.5),
  S(1.70, 0.475, 0.455, -0.50, 2.4),
  S(2.05, 0.44, 0.42, -0.43, 2.35),
  S(2.24, 0.405, 0.36, -0.37, 2.35),
  S(2.30, 0.33, 0.29, -0.30, 2.3),
  S(2.335, 0.14, 0.12, -0.12, 2.1),
  S(2.345, 0.012, 0.015, -0.015, 2),
];

const WING = [
  { z: 0.3, x: 0.15, y: 0.86, chord: 1.63, t: 0.12, camber: 0.02, cp: 0.4 },
  { z: 2.9, x: 0.15, y: 0.94, chord: 1.63, t: 0.12, camber: 0.02, cp: 0.4, twist: -0.5 },
  { z: 5.5, x: 0.15, y: 1.02, chord: 1.13, t: 0.1, camber: 0.02, cp: 0.4, twist: -3 },
];
const STAB = [
  { z: 0.08, x: -4.15, y: 0.31, chord: 1.15, t: 0.09 },
  { z: 1.72, x: -4.6, y: 0.33, chord: 0.7, t: 0.08 },
];
const FIN = [
  { z: 0, x: -3.45, y: 0, chord: 2.15, t: 0.09 },
  { z: 1.2, x: -4.95, y: 0, chord: 0.78, t: 0.075 },
];
const FIN_BASE = 0.36;
const FLAP_XF = 0.7;
const FLAP = [0.55, 2.7];
const AIL = [2.8, 5.0];
const finHinge = (z) => {
  const s = sectionAt(FIN, z);
  const xh = -5.12 + (-5.28 + 5.12) * (z / 1.2);
  return (s.x - xh) / s.chord;
};

// Windows as quads in (x, angle degrees) space on the right side (the left side mirrors the angle about 90 degrees).
const WINDOWS = {
  door: [[-0.32, 21], [0.85, 21], [0.78, 53], [-0.32, 57]],
  rear: [[-1.9, 20], [-0.45, 20], [-0.5, 53], [-1.75, 50]],
};
const WINDSHIELD = [[0.47, 38], [1.12, 50], [1.12, 130], [0.47, 142]];
const REAR_WINDOW = [[-2.4, 60], [-1.98, 57], [-1.98, 123], [-2.4, 120]];
const mirrorQuad = (q) => q.map(([x, a]) => [x, 180 - a]);
const rad = (q) => q.map(([x, a]) => [x, a * DEG]);

function paintFuselage(mats, body, spec) {
  const L = spec.livery;
  const W = texSize(mats, 2048);
  const P = new BodyPaint(body, { W, H: W / 2 });
  const base = L.base;
  P.fill(base);
  // Belly colour with a soft shoulder.
  P.band(-90, -28, L.belly ?? shade(base, -0.06));
  const g = P.g;
  const grad = g.createLinearGradient(0, P.py(-34 * DEG), 0, P.py(-18 * DEG));
  grad.addColorStop(0, rgbaOf(L.belly ?? shade(base, -0.06), 1)); grad.addColorStop(1, rgbaOf(L.belly ?? shade(base, -0.06), 0));
  g.fillStyle = grad; g.fillRect(0, P.py(-34 * DEG) - (P.py(-18 * DEG) - P.py(-34 * DEG)) * 0, W, P.py(-18 * DEG) - P.py(-34 * DEG));
  // Cheat-line swooshes on both sides: wide stripe plus a thin second stripe below, rising toward the tail and up the fin.
  const cheat = (flip) => {
    const A = (a) => (flip ? 180 - a : a);
    const ribbon = (offLo, offHi, color) => {
      const pts = []; const back = [];
      for (let i = 0; i <= 80; i++) {
        const x = 2.05 - (7.65 * i) / 80;
        const l = (flip ? 180 - (-6 + offLo + Math.max(0, 0.4 - x) * 9.5 + Math.max(0, -2.6 - x) * 4) : -6 + offLo + Math.max(0, 0.4 - x) * 9.5 + Math.max(0, -2.6 - x) * 4);
        const h = (flip ? 180 - (-6 + offHi + Math.max(0, 0.4 - x) * 9.5 + Math.max(0, -2.6 - x) * 4) : -6 + offHi + Math.max(0, 0.4 - x) * 9.5 + Math.max(0, -2.6 - x) * 4);
        pts.push([x, l]); back.push([x, h]);
      }
      P.poly([...pts, ...back.reverse()], color);
    };
    ribbon(0, 13, L.stripe ?? '#1f5fa8');
    ribbon(15, 19.5, L.stripe2 ?? '#c8362f');
  };
  cheat(false); cheat(true);
  // Cowling: matte anti-glare panel, split line and fastener rows.
  P.poly([[1.28, 60], [1.28, 120], [2.2, 128], [2.2, 52]], '#1b1d20', 0.0);
  P.seam(1.3, -90, 1.3, 270, 'rgba(30,34,38,0.7)', 2);
  // Doors, access panels and fuel vent lines (painted gaps).
  for (const flip of [false, true]) {
    const A = (a) => (flip ? 180 - a : a);
    const line = (x0, a0, x1, a1) => P.seam(x0, A(a0), x1, A(a1), 'rgba(35,38,44,0.75)', 1.6);
    // Front door outline
    line(-0.42, -14, 0.92, -14); line(0.92, -14, 0.92, 58); line(-0.42, -14, -0.42, 60);
    // Rear cabin seams and cowl access
    line(-2.1, -20, -2.1, 40); line(1.3, -40, 2.2, -40); line(1.7, 30, 1.7, 80);
    // Static port
    P.blob(-1.35, A(-2), 0.012, 0.012, '#20242a', 0.9);
  }
  // Windows: dark gasket outlines (the glass itself is geometry).
  const frame = (q) => P.quad(q, patchOutline(rad(q), { p: 4, n: 48 }), { fill: '#181a1e', stroke: '#101113', width: 3 });
  frame(WINDSHIELD); frame(REAR_WINDOW);
  for (const q of Object.values(WINDOWS)) { frame(q); frame(mirrorQuad(q)); }
  g.strokeStyle = '#101113'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(P.px(0.5), P.py(90 * DEG)); g.lineTo(P.px(1.14), P.py(90 * DEG)); g.stroke();
  // Registration on the tail cone, both sides.
  const regColor = L.regColor ?? '#1a2230';
  P.text(spec.registration, -3.25, 43, 1, 0.3, { color: regColor, stretch: 0.95 });
  P.text(spec.registration, -3.25, 43, -1, 0.3, { color: regColor, stretch: 0.95 });
  // Small stencils.
  for (const flip of [1, -1]) {
    P.text('SKYHAWK 172', 1.65, 10, flip, 0.07, { color: '#2a2e34', weight: 'bold', alpha: 0.8 });
    P.text('NO STEP', -2.55, -30, flip, 0.035, { color: '#a02020', alpha: 0.8 });
  }
  // Weathering: oil run behind the cowl and exhaust soot, belly dirt, wheel-spray.
  P.airflowStreak(1.5, -62, 3.6, 0.1, '#25211a', 0.35);
  P.airflowStreak(1.0, -52, 2.9, 0.06, '#2a251c', 0.3);
  P.airflowStreak(0.9, -48, 4.6, 0.09, '#2f2a22', 0.14);
  for (let i = 0; i < 24; i++) P.airflowStreak(2.1 - i * 0.28, 5 + ((i * 37) % 60) - 30, 0.9 + (i % 3) * 0.5, 0.04, '#6d6a60', 0.06);
  mottle(g, P.W, P.H, '#7a7466', 0.1, 9, 17);
  // Ambient occlusion where the wing root meets the roof and under the tailplane.
  P.blob(-0.6, 90, 1.0, 0.18, '#000', 0.12);
  P.blob(-4.4, 0, 0.7, 0.12, '#000', 0.12);
  const tex = P.texture();
  attachMap(mats.skin, tex);
  return tex;
}
const rgbaOf = (c, a) => { const col = new THREE.Color(c); return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`; };

function paintLifting(mats, spec) {
  const L = spec.livery;
  const W = texSize(mats, 2048);
  const atlas = new AtlasPaint({
    wing: { span: 5.4, chord: 1.75, z0: 0.3 },
    stab: { span: 1.8, chord: 1.2, z0: 0.0 },
    fin: { span: 1.3, chord: 2.2, z0: 0.0 },
  }, { W, H: W / 2 });
  const base = L.wing ?? L.base;
  atlas.g.fillStyle = base; atlas.g.fillRect(0, 0, W, W / 2);
  paintPanel(atlas.rects.wing, {
    sections: WING, z0: 0.3, z1: 5.5, base, under: shade(base, -0.08), tip: { color: shade(base, -0.02), len: 0.0 },
    seams: [{ z0: FLAP[0], z1: FLAP[1], xf: FLAP_XF }, { z0: AIL[0], z1: AIL[1], xf: FLAP_XF }, { z0: 5.0, z1: 5.5, xf: FLAP_XF, ends: false }],
    walkway: { z0: 0.5, z1: 1.05, p0: 0.38, p1: 0.62 },
    caps: [{ z: 2.15, p: 0.42 }],
    dirt: 0.7,
    stripes: [{ p0: 0.0, p1: 0.0, color: base }],
    text: [{ str: 'NO STEP', z: 1.9, p: 1.0, size: 0.045, rot: 0, color: '#aa2222' }, { str: spec.registration, z: 3.6, p: 0.7, size: 0.2, rot: Math.PI / 2, color: L.regColor ?? '#1a2230', upper: false }],
    seed: 21,
  });
  paintPanel(atlas.rects.stab, {
    sections: STAB, z0: 0.08, z1: 1.72, base, under: shade(base, -0.08), seams: [{ z0: 0.1, z1: 1.7, xf: 0.6 }], dirt: 0.6, seed: 5,
  });
  paintPanel(atlas.rects.fin, {
    sections: FIN, z0: 0, z1: 1.2, base, under: base, seams: [{ z0: 0.12, z1: 1.2, xf: finHinge }], dirt: 0.5, seed: 8,
    stripes: [{ p0: -0.2, p1: 1.0, color: L.stripe ?? '#1f5fa8', z0: 0.62, z1: 0.9, both: true }, { p0: -0.2, p1: 1.0, color: L.stripe2 ?? '#c8362f', z0: 0.93, z1: 1.0, both: true }],
  });
  const tex = atlas.texture();
  attachMap(mats.wing, tex);
  return atlas;
}

export function buildCessna172(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  rig.gear.fixed = true;
  const HI = detail === HIGH;
  const MID = detail >= MEDIUM;
  const exterior = new THREE.Group(); // hidden when the cockpit camera is active
  root.add(exterior);
  rig.fuselage = exterior;

  // Plain painted fairings (wheel pants, dorsal fillet) must not carry the fuselage's windows and stripes.
  if (!mats.plain) {
    mats.plain = mats.skin.clone();
    mats.plain.map = null;
    mats.plain.color = new THREE.Color(spec.livery.base);
    mats.__envMats?.push(mats.plain);
  }
  const body = loftBody(STATIONS, { detail, step: 0.2 });
  if (!mats.__painted) {
    mats.__painted = { skin: paintFuselage(mats, body, spec), atlas: paintLifting(mats, spec) };
  }
  const atlas = mats.__painted.atlas;
  const uvWing = atlas.rects.wing.uv; const uvStab = atlas.rects.stab.uv; const uvFin = atlas.rects.fin.uv;
  const skinMesh = new THREE.Mesh(body.geo, mats.skin);
  exterior.add(skinMesh);

  const fixed = new Parts(mats); // visible in every camera
  const ext = new Parts(mats); // exterior-only extras (glass, interior silhouettes)

  // ---- glazing ---------------------------------------------------------------------------------------------
  if (MID) {
    const patch = (q, mat = 'glass') => ext.add(mat, bodyPatch(body, rad(q), { lift: 0.004, p: 4, nu: HI ? 12 : 4, nv: HI ? 8 : 3 }));
    patch(WINDSHIELD);
    patch(REAR_WINDOW);
    for (const q of Object.values(WINDOWS)) { patch(q); patch(mirrorQuad(q)); }
    // Seat and panel silhouettes seen through the glass.
    if (HI) {
      for (const s of [-1, 1]) {
        ext.add('trim', roundedBox(0.12, 0.5, 0.42, 0.04), T(-0.22, 0.12, s * 0.27, 0, 0, -0.18 * 0 + 0.12));
        ext.add('trim', roundedBox(0.46, 0.1, 0.42, 0.04), T(0.0, -0.18, s * 0.27));
        ext.add('trim', roundedBox(0.08, 0.16, 0.2, 0.03), T(-0.26, 0.45, s * 0.27));
        ext.add('dark', cylX(0.013, 0.013, 0.34, 6), T(0.55, 0.12, s * 0.27));
        ext.add('dark', cylZ(0.17, 0.17, 0.02, 14), T(0.43, 0.14, s * 0.27, 0, 0, 0.5));
      }
      ext.add('trim', roundedBox(0.3, 0.52, 1.0, 0.04), T(-1.0, 0.1, 0));
      ext.add('trim', roundedBox(0.62, 0.1, 0.96, 0.04), T(-0.75, -0.2, 0));
      ext.add('dark', roundedBox(0.45, 0.3, 1.0, 0.03), T(0.78, 0.3, 0));
      ext.add('dark', roundedBox(0.22, 0.04, 1.02, 0.02), T(0.9, 0.46, 0));
    }
  }

  // ---- wings -------------------------------------------------------------------------------------------------
  const tipR = 0.12;
  const fwd = wingSurface(WING, 0.3, 5.5, { xf0: 0, xf1: FLAP_XF, detail, tipRound: tipR, map: uvWing, dz: 0.5 });
  fixed.addPair('wing', fwd);
  fixed.addPair('wing', wingSurface(WING, 2.7, 2.8, { xf0: FLAP_XF, xf1: 1, detail, roundNose: true, capA: true, capB: true, map: uvWing }));
  fixed.addPair('wing', wingSurface(WING, 5.0, 5.5, { xf0: FLAP_XF, xf1: 1, detail, roundNose: true, capA: true, tipRound: tipR, map: uvWing }));
  for (const side of [1, -1]) {
    const flap = hingedSurface(WING, FLAP[0], FLAP[1], FLAP_XF, mats.wing, { detail, side, map: uvWing });
    const ail = hingedSurface(WING, AIL[0], AIL[1], FLAP_XF, mats.wing, { detail, side, map: uvWing });
    root.add(flap.pivot, ail.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: ail.pivot, axis: ail.axis, side });
  }
  // Tail surfaces.
  fixed.addPair('wing', wingSurface(STAB, 0.08, 1.72, { xf0: 0, xf1: 0.6, detail, tipRound: 0.05, map: uvStab }));
  for (const side of [1, -1]) {
    const el = hingedSurface(STAB, 0.08, 1.72, 0.6, mats.wing, { detail, side, map: uvStab, kind: 'wing' });
    root.add(el.pivot);
    rig.elevators.push({ pivot: el.pivot, axis: el.axis });
  }
  const finM = T(0, FIN_BASE, 0, -Math.PI / 2, 0, 0);
  fixed.add('wing', wingSurface(FIN, 0, 1.2, { xf0: 0, xf1: finHinge, detail, tipRound: 0.06, map: uvFin }), finM);
  const rud = hingedSurface(FIN, 0.1, 1.2, finHinge, mats.wing, { detail, m: finM, side: 1, map: uvFin, kind: 'rudder' });
  root.add(rud.pivot);
  rig.rudders.push({ pivot: rud.pivot, axis: rud.axis });

  // Dorsal fillet blending the cabin roof into the fin: a long, flat half-ellipsoid.
  if (MID) fixed.add('plain', sphereG(1, HI ? 20 : 10, HI ? 12 : 6), T(-3.5, 0.53, 0, 0, 0, 0.1, 0.95, 0.14, 0.055));

  // ---- struts, fairings and wing details ------------------------------------------------------------------------
  if (MID) {
    for (const s of [1, -1]) {
      const m = s < 0 ? new THREE.Matrix4().makeScale(1, 1, -1) : null;
      const add = (geo) => fixed.add('wing', geo, m);
      add(airfoilStrut(vec(-0.12, -0.42, 0.5), vec(-0.28, 0.82, 2.72), 0.11, 0.2));
      if (HI) {
        add(airfoilStrut(vec(-0.2, 0.28, 1.62), vec(-0.3, 0.84, 1.95), 0.055, 0.2));
        fixed.add('steel', roundedBox(0.16, 0.05, 0.06, 0.01), T(-0.13, -0.42, s * 0.52));
        fixed.add('steel', roundedBox(0.16, 0.04, 0.07, 0.01), T(-0.29, 0.84, s * 2.72));
        // Flap tracks, tie-down rings, fuel-cap bosses.
        for (const z of [1.0, 2.1]) fixed.add('dark', roundedBox(0.16, 0.035, 0.05, 0.01), T(-1.0, 0.79 + (z - 0.3) * 0.03, s * z));
        fixed.add('steel', std(new THREE.TorusGeometry(0.03, 0.007, 6, 12)), T(-0.3, 0.88 + 0.03 * 2.1, s * 2.4, Math.PI / 2, 0, 0));
        // Wing root fillet
        fixed.add('wing', roundedBox(1.0, 0.06, 0.12, 0.03), T(-0.45, 0.76, s * 0.58));
      }
      // Nav and strobe lenses at the tips (strobe in the wingtip trailing portion).
      const tip = sectionAt(WING, 5.5);
      fixed.add(s > 0 ? 'lensGreen' : 'lensRed', lensGeometry(0.035, 1.4), T(tip.x - 0.05, tip.y, s * 5.5, 0, 0, 0)); // placeholder for the nav lens on the leading edge
    }
  }

  // ---- engine installation ---------------------------------------------------------------------------------------
  const propX = 2.335;
  if (MID) {
    // Cowl inlets either side of the spinner: oval openings on the nose face, a dark lip around each, and the cooling-air outlet under the cowl.
    for (const s of [1, -1]) {
      fixed.add('black', std(new THREE.CircleGeometry(1, 24)), T(2.336, -0.035, s * 0.2, 0, Math.PI / 2, 0, 0.1, 0.075, 1));
      fixed.add('trim', std(new THREE.RingGeometry(0.93, 1.08, 24)), T(2.334, -0.035, s * 0.2, 0, Math.PI / 2, 0, 0.1, 0.075, 1));
      fixed.add('black', roundedBox(0.5, 0.012, 0.22, 0.004), T(1.4, -0.545, s * 0.12));
    }
    // Exhaust tailpipe (right lower side, bent aft) and the oil door.
    fixed.add('exhaust', tubeBetween(vec(1.28, -0.5, 0.3), vec(0.5, -0.62, 0.34), 0.034, 0.03, 10));
    fixed.add('steel', tubeBetween(vec(1.28, -0.5, 0.3), vec(1.45, -0.46, 0.27), 0.038, 0.038, 10));
    fixed.add('black', std(new THREE.CircleGeometry(0.028, 10)), T(0.5, -0.62, 0.34, 0, -Math.PI / 2, 0));
  }
  const prop = makeProPropeller({
    blades: 2, radius: 0.94, hubR: 0.065,
    chord: (f) => (f < 0.25 ? 0.07 + f * 0.2 : f < 0.7 ? 0.12 + (f - 0.25) * 0.09 : 0.16 - (f - 0.7) * 0.28),
    beta: (f) => 48 - 40 * f + 8 * f * f,
    thick: (f) => 0.2 - 0.14 * Math.min(1, f * 1.2),
    sweep: (f) => 0.02 * f,
    camber: 0.06,
    spinner: [[0.3, 0.001], [0.27, 0.035], [0.2, 0.085], [0.1, 0.13], [0.01, 0.15], [0, 0.15]],
    tipColor: spec.livery.tip, tipLen: 0.1,
  }, mats, detail);
  prop.position.set(propX, -0.002, 0);
  root.add(prop);
  rig.props.push(prop);

  // ---- antennas, probes, lights -------------------------------------------------------------------------------
  if (MID) {
    fixed.add('black', bladeAntennaGeometry(0.2, 0.09, 0.012), T(-1.25, 0.785, 0.0));
    fixed.add('black', bladeAntennaGeometry(0.16, 0.07, 0.012), T(-0.3, -0.6, 0.0, 0, 0, Math.PI));
    if (HI) {
      fixed.add('black', whipGeometry(0.34, 0.004, 0.55), T(-2.7, 0.545, 0.03));
      fixed.add('metal', probeGeometry(0.34, 0.01), T(-0.3, 0.7, -2.3, 0, 0, 0)); // pitot under the left wing
      fixed.add('metal', cylY(0.02, 0.02, 0.1, 8), T(-0.3, 0.64, -2.3));
    }
  }
  const nav = (side, x, y, z) => {
    const l = glowLight(side > 0 ? 0x2aff5a : 0xff2a2a, 0.05, 0.6);
    l.position.set(x, y, z);
    root.add(l); rig.lights.nav.push(l);
  };
  const tip = sectionAt(WING, 5.5);
  nav(1, tip.x - 0.02, tip.y + 0.02, 5.5); nav(-1, tip.x - 0.02, tip.y + 0.02, -5.5);
  for (const s of [1, -1]) {
    const strobe = glowLight(0xffffff, 0.05, 0.9);
    strobe.position.set(tip.x - 1.0, tip.y + 0.03, s * 5.4);
    root.add(strobe); rig.lights.strobes.push(strobe);
  }
  const beacon = glowLight(0xff2a2a, 0.045, 1.2);
  beacon.position.set(-5.25, FIN_BASE + 1.28, 0);
  root.add(beacon); rig.lights.beacon.push(beacon);
  const tailNav = glowLight(0xffffff, 0.04);
  tailNav.position.set(-5.78, FIN_BASE + 0.35, 0);
  root.add(tailNav); rig.lights.nav.push(tailNav);
  const landing = glowLight(0xfff3d0, 0.07, 1.1);
  landing.position.set(0.18, 0.9, -2.0);
  root.add(landing); rig.lights.landing.push(landing);

  // ---- landing gear (fixed) ----------------------------------------------------------------------------------------
  const g = spec.gear;
  const axleY = g.mainLeft.y + 0.3;
  const noseAttachY = -0.5;
  const noseLeg = makeProGearLeg({ length: noseAttachY - g.nose.y, strutR: 0.028, wheelRadius: 0.23, wheelWidth: 0.12, fork: 'single', outerFrac: 0.62, fender: true, rim: 0.55 }, mats, detail);
  noseLeg.position.set(g.nose.x, noseAttachY, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg };
  for (const [pos, side, wheelIndex] of [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]]) {
    const leg = new THREE.Group();
    leg.position.set(pos.x, axleY, pos.z);
    const lower = new THREE.Group();
    const wheel = makeWheelGroup({ radius: 0.3, width: 0.155, rim: 0.52, disc: 0.5, spokes: 5, discSide: -side }, mats, detail);
    lower.add(wheel);
    const lp = new Parts(mats);
    // Wheel fairing (pant): a teardrop loft around the wheel, with an opening below.
    if (MID) {
      const pant = loftBody([
        { x: -0.62, w: 0.012, top: 0.03, bottom: 0.03, yc: 0.03, n: 2 },
        { x: -0.4, w: 0.09, top: 0.22, bottom: 0.16, yc: 0.06, n: 2.2 },
        { x: -0.15, w: 0.125, top: 0.34, bottom: 0.22, yc: 0.07, n: 2.3 },
        { x: 0.2, w: 0.125, top: 0.34, bottom: 0.22, yc: 0.07, n: 2.3 },
        { x: 0.42, w: 0.07, top: 0.2, bottom: 0.12, yc: 0.04, n: 2.1 },
        { x: 0.52, w: 0.006, top: 0.02, bottom: 0.02, yc: 0.0, n: 2 },
      ], { detail, step: 0.2, segs: HI ? 28 : 12 });
      lp.add('plain', pant.geo, T(0, -0.01, 0, 0, 0, 0));
    }
    lp.build(lower);
    leg.add(lower);
    // Gear leg: streamlined spring-steel strut from the fuselage side down to the axle, plus its fairing.
    const sp = new Parts(mats);
    sp.add('steel', airfoilStrut(vec(0.0, 0.0, 0), vec(0.05, 0.62, -side * 0.72), 0.13, 0.24));
    if (HI) sp.add('wing', roundedBox(0.3, 0.07, 0.16, 0.03), T(0.05, 0.62, -side * 0.72));
    sp.build(leg);
    root.add(leg);
    rig.gear.mains.push({ leg, lower, wheels: [wheel], wheelIndex, side });
  }
  rig.gear.nose.lower = noseLeg.userData.lower;
  rig.gear.nose.wheels = noseLeg.userData.wheels;

  fixed.build(root);
  ext.build(exterior);
  for (const m of exterior.children) if (m !== skinMesh) m.userData.exteriorOnly = true;
  void MID; void mirrorZ; void xf; void revolve; void boxG; void sphereG; void blot; void mix; void FONT; void LOW; void TAU;
  return { group: root, rig };
}
