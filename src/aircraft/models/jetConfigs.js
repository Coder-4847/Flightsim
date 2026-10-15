// Per-aircraft descriptions for the jet models (jetBuild.js turns them into geometry). Body frame: +X nose, +Y up, +Z right wing,
// origin at the CG, metres. Dimensions follow the real analogues; the flight-model data files fix the length, span, gear and
// engine positions, which this table respects.

const rad = (d) => (d * Math.PI) / 180;
const BELLY = -Math.PI / 2;

export const JET_CONFIGS = {
  // ---- Meridian 320 (A320-class) --------------------------------------------------------------------------------
  narrowbody: {
    fuselage: {
      xTail: -18.6, xNose: 19.0, w: 1.975, top: 2.07, bot: 2.07, yc: 0.3, n: 2.06,
      nose: { len: 6.2, p: 1.7, q: 1.8, droop: 0.5, botPow: 0.9, wPow: 1.05, nBoost: 0.6 },
      tail: { len: 11.5, p: 1.5, q: 1.15, up: 1.15, tipR: 0.17, topPow: 0.9, botPow: 1.2 },
      bumps: [{ theta: BELLY, x0: -5.5, x1: 5.5, ramp: 2.5, ramp2: 2.5, h: 0.3, sigma: 0.8 }],
    },
    livery: {
      belly: -1.0, stripe: { x0: -18.0, x1: 13.5, y: -0.25, rise: 0.9, drop: 0.1, w: 0.2, gap: 0.12, w2: 0.07 },
      title: { xc: 1.0, y: 0.95, size: 0.55 }, reg: { xc: -13.0, y: 0.75, size: 0.34 }, tailPaint: 'stripe', logoY: 0.42,
    },
    windows: { x0: -10.8, x1: 11.9, pitch: 0.508, y: 0.52, w: 0.24, h: 0.34, r: 0.1, skip: [[-12.7, -11.3], [12.3, 14.0]] },
    doors: [
      { x: 13.1, w: 0.85, h: 1.85, y0: -0.55 }, { x: -12.0, w: 0.85, h: 1.85, y0: -0.55 },
      { x: 0.2, w: 0.55, h: 0.95, y0: 0.0 }, { x: -0.9, w: 0.55, h: 0.95, y0: 0.0 },
      { x: 9.0, w: 1.82, h: 1.2, y0: -1.45, sides: [1] }, { x: -5.5, w: 1.82, h: 1.2, y0: -1.45, sides: [1] },
    ],
    cockpit: { x: 16.8, front: { ang: 27, w: 1.0, h: 0.55 }, side: { x: 15.6, y: 0.95, w: 0.62, h: 0.46 } },
    wing: {
      rootZ: 1.2, hinge: 0.74, slatCf: 0.13,
      stations: [
        { z: 0, x: 4.05, y: -1.05, c: 6.6, t: 0.15, tw: 2.0 },
        { z: 5.8, x: 0.675, y: -0.52, c: 3.9, t: 0.122, tw: 0.8 },
        { z: 17.05, x: -5.16, y: 0.55, c: 1.55, t: 0.098, tw: -1.8 },
      ],
      flaps: [{ z0: 1.9, z1: 5.9 }, { z0: 6.1, z1: 10.9 }],
      ailerons: [{ z0: 12.5, z1: 16.3, cf: 0.78 }],
      slats: [{ z0: 2.6, z1: 5.0 }, { z0: 5.1, z1: 7.4 }, { z0: 7.5, z1: 10.2 }, { z0: 10.3, z1: 13.5 }, { z0: 13.6, z1: 16.8 }],
      spoilers: { z0: 3.0, z1: 11.4, n: 5, cf: 0.63, cfEnd: 0.77, angle: 0.85 },
      canoes: [{ z: 3.3, len: 1.35, r: 0.15 }, { z: 5.3, len: 1.4, r: 0.16 }, { z: 7.6, len: 1.2, r: 0.14 }, { z: 9.9, len: 1.1, r: 0.13 }],
      tip: { type: 'sharklet', height: 2.0, tipChord: 0.75, sweep: 40, cant: 80, t: 0.07 },
      walkway: { z0: 2.5, z1: 5.5 },
    },
    fin: {
      stations: [{ y: 1.2, x: -10.0, c: 5.9, t: 0.1 }, { y: 4.8, x: -13.5, c: 3.3, t: 0.09 }, { y: 8.4, x: -16.2, c: 1.95, t: 0.085 }],
      hinge: 0.7, rudderFrom: 1.9,
    },
    stab: {
      stations: [{ z: 0, x: -13.7, y: 1.4, c: 3.8, t: 0.095, tw: 0 }, { z: 6.22, x: -17.35, y: 2.0, c: 1.3, t: 0.075, tw: 0 }],
      hinge: 0.66, rootZ: 0.4,
    },
    engines: { r: 1.0, len: 4.3, rHi: 0.9, fanR: 0.86, rn: 0.74, rc: 0.46, blades: 24, paint: 'base', pylonZ: 5.7 },
    gear: {
      noseAttachY: -1.2, mainAttachY: -1.0, noseWheelR: 0.35, noseWheelW: 0.2, noseTrack: 0.5, mainWheelR: 0.55, mainWheelW: 0.4, mainTrack: 0.9, mainStrut: 0.07, noseStrut: 0.07, doorW: 1.8,
    },
    beacons: [[-2.0, 'top'], [1.5, 'belly']],
  },

  // ---- Regional 175 (E175-class) ------------------------------------------------------------------------------------
  regional: {
    fuselage: {
      xTail: -16.7, xNose: 15.0, w: 1.5, top: 1.68, bot: 1.58, yc: 0.2, n: 2.1,
      nose: { len: 5.0, p: 1.7, q: 1.8, droop: 0.33, botPow: 0.9, wPow: 1.05, nBoost: 0.5 },
      tail: { len: 9.5, p: 1.5, q: 1.15, up: 1.0, tipR: 0.14, topPow: 0.9, botPow: 1.2 },
      waist: { amount: 0.06, y: -0.35, width: 0.55 },
      bumps: [{ theta: BELLY, x0: -4.0, x1: 4.0, ramp: 2.0, ramp2: 2.0, h: 0.22, sigma: 0.8 }],
    },
    livery: {
      belly: -0.8, stripe: { x0: -16.0, x1: 11.0, y: -0.15, rise: 0.8, drop: 0.1, w: 0.17, gap: 0.1, w2: 0.06 },
      title: { xc: 0.5, y: 0.8, size: 0.45 }, reg: { xc: -11.0, y: 0.65, size: 0.28 }, tailPaint: 'stripe', logoY: 0.35,
    },
    windows: { x0: -8.6, x1: 9.2, pitch: 0.53, y: 0.42, w: 0.23, h: 0.32, r: 0.1, skip: [[-10.4, -9.2], [9.8, 11.4]] },
    doors: [
      { x: 10.4, w: 0.8, h: 1.7, y0: -0.5 }, { x: -9.8, w: 0.8, h: 1.7, y0: -0.5 }, { x: 0.6, w: 0.5, h: 0.9, y0: -0.05 }, { x: -0.3, w: 0.5, h: 0.9, y0: -0.05 },
      { x: 7.0, w: 1.2, h: 0.95, y0: -1.1, sides: [1] }, { x: -5.0, w: 1.2, h: 0.95, y0: -1.1, sides: [1] },
    ],
    cockpit: { x: 13.1, front: { ang: 27, w: 0.8, h: 0.44 }, side: { x: 11.9, y: 0.82, w: 0.6, h: 0.42 } },
    wing: {
      rootZ: 1.0, hinge: 0.72, slatCf: 0.13,
      stations: [
        { z: 0, x: 2.94, y: -0.85, c: 4.9, t: 0.14, tw: 1.8 },
        { z: 4.0, x: 0.86, y: -0.52, c: 3.4, t: 0.118, tw: 0.8 },
        { z: 12.3, x: -3.21, y: 0.2, c: 1.2, t: 0.095, tw: -1.8 },
      ],
      flaps: [{ z0: 1.6, z1: 4.2 }, { z0: 4.4, z1: 8.6 }],
      ailerons: [{ z0: 9.2, z1: 12.0, cf: 0.76 }],
      slats: [{ z0: 2.0, z1: 5.2 }, { z0: 5.3, z1: 8.9 }, { z0: 9.0, z1: 12.2 }],
      spoilers: { z0: 2.2, z1: 8.8, n: 4, cf: 0.62, cfEnd: 0.75, angle: 0.85 },
      canoes: [{ z: 2.6, len: 1.0, r: 0.12 }, { z: 6.4, len: 1.0, r: 0.12 }],
      tip: { type: 'winglet', height: 1.2, tipChord: 0.55, sweep: 40, cant: 72, t: 0.07 },
    },
    fin: {
      stations: [{ y: 0.8, x: -8.8, c: 5.2, t: 0.1 }, { y: 4.0, x: -11.4, c: 3.0, t: 0.09 }, { y: 6.4, x: -13.3, c: 2.1, t: 0.085 }],
      hinge: 0.7, rudderFrom: 1.4,
    },
    stab: {
      stations: [{ z: 0, x: -13.0, y: 6.45, c: 2.7, t: 0.09, tw: 0 }, { z: 5.0, x: -16.1, y: 6.55, c: 1.0, t: 0.075, tw: 0 }],
      hinge: 0.66, rootZ: 0.2,
    },
    engines: { r: 0.8, len: 3.7, rHi: 0.71, fanR: 0.68, rn: 0.58, rc: 0.36, blades: 22, paint: 'base' },
    gear: {
      noseAttachY: -1.0, mainAttachY: -0.9, noseWheelR: 0.3, noseWheelW: 0.18, noseTrack: 0.4, mainWheelR: 0.5, mainWheelW: 0.3, mainTrack: 0.8, mainStrut: 0.06, noseStrut: 0.06, doorW: 1.4,
    },
    beacons: [[-2.0, 'top'], [1.0, 'belly']],
  },

  // ---- Stratos G6 (G650-class) ------------------------------------------------------------------------------------------
  bizjet: {
    fuselage: {
      xTail: -16.0, xNose: 14.4, w: 1.32, top: 1.34, bot: 1.26, yc: 0.35, n: 2.12,
      nose: { len: 5.6, p: 1.6, q: 1.75, droop: 0.28, botPow: 0.88, nBoost: 0.5 },
      tail: { len: 9.5, p: 1.35, q: 1.2, up: 0.7, tipR: 0.12, topPow: 0.9, botPow: 1.1 },
      bumps: [{ theta: BELLY, x0: -3.0, x1: 4.0, ramp: 2.0, ramp2: 2.0, h: 0.18, sigma: 0.9 }],
    },
    livery: {
      belly: -0.65, stripe: { x0: -15.0, x1: 9.0, y: -0.08, rise: 0.55, drop: 0.1, w: 0.14, gap: 0.09, w2: 0.05 },
      title: { xc: -1.0, y: 0.8, size: 0.34 }, reg: { xc: -9.8, y: 0.55, size: 0.26 }, tailPaint: 'stripe', logoY: 0.4,
    },
    windows: { x0: -8.4, x1: 7.4, pitch: 1.05, y: 0.42, w: 0.4, h: 0.5, r: 0.22, skip: [[-10.4, -9.0], [8.0, 9.4]] },
    doors: [{ x: 8.9, w: 0.75, h: 1.6, y0: -0.7, sides: [-1] }, { x: -10.2, w: 0.6, h: 0.7, y0: -0.2, sides: [1] }, { x: 0.5, w: 0.5, h: 0.8, y0: 0.0, sides: [1] }],
    cockpit: { x: 12.4, front: { ang: 28, w: 0.74, h: 0.42 }, side: { x: 11.2, y: 0.75, w: 0.62, h: 0.4 } },
    wing: {
      rootZ: 0.9, hinge: 0.74, slatCf: 0.12,
      stations: [
        { z: 0, x: 5.66, y: -0.75, c: 6.9, t: 0.13, tw: 2.0 },
        { z: 5.5, x: 1.6, y: -0.55, c: 3.9, t: 0.11, tw: 0.8 },
        { z: 14.5, x: -5.3, y: 0.0, c: 1.55, t: 0.09, tw: -1.5 },
      ],
      flaps: [{ z0: 1.4, z1: 5.8 }, { z0: 6.0, z1: 10.0 }],
      ailerons: [{ z0: 10.8, z1: 14.2, cf: 0.76 }],
      slats: [{ z0: 2.0, z1: 7.0 }, { z0: 7.1, z1: 14.3 }],
      spoilers: { z0: 2.4, z1: 10.0, n: 3, cf: 0.63, cfEnd: 0.77, angle: 0.85 },
      canoes: [{ z: 3.3, len: 1.1, r: 0.12 }, { z: 8.0, len: 1.0, r: 0.1 }],
      tip: { type: 'winglet', height: 1.45, tipChord: 0.85, sweep: 42, cant: 68, t: 0.07 },
    },
    fin: {
      stations: [{ y: 0.9, x: -9.2, c: 5.8, t: 0.1 }, { y: 3.2, x: -11.6, c: 3.8, t: 0.09 }, { y: 5.3, x: -13.2, c: 2.5, t: 0.085 }],
      hinge: 0.68, rudderFrom: 1.3,
    },
    stab: {
      stations: [{ z: 0, x: -13.0, y: 5.35, c: 2.9, t: 0.09, tw: 0 }, { z: 4.8, x: -16.2, y: 5.45, c: 1.2, t: 0.075, tw: 0 }],
      hinge: 0.66, rootZ: 0.2,
    },
    engines: { r: 0.62, len: 3.5, rHi: 0.54, fanR: 0.5, rn: 0.46, rc: 0.3, blades: 22, paint: 'base', rear: true },
    gear: {
      noseAttachY: -0.9, mainAttachY: -0.8, noseWheelR: 0.28, noseWheelW: 0.16, noseTrack: 0.36, mainWheelR: 0.5, mainWheelW: 0.26, mainTrack: 0.7, mainStrut: 0.06, noseStrut: 0.055, doorW: 1.2,
    },
    beacons: [[-3.0, 'top'], [1.0, 'belly']],
  },

  // ---- Zenith CJ (Citation CJ-class) --------------------------------------------------------------------------------------
  citation: {
    fuselage: {
      xTail: -8.5, xNose: 7.0, w: 0.75, top: 0.8, bot: 0.76, yc: 0.2, n: 2.15,
      nose: { len: 3.4, p: 1.6, q: 1.7, droop: 0.14, botPow: 0.88, nBoost: 0.4 },
      tail: { len: 6.8, p: 1.3, q: 1.2, up: 0.55, tipR: 0.07, topPow: 0.9, botPow: 1.05 },
    },
    livery: {
      belly: -0.38, stripe: { x0: -8.0, x1: 4.2, y: -0.05, rise: 0.4, drop: 0.05, w: 0.1, gap: 0.06, w2: 0.035 },
      title: { xc: -1.0, y: 0.45, size: 0.2 }, reg: { xc: -5.2, y: 0.32, size: 0.17 }, tailPaint: 'stripe', logoY: 0.4,
    },
    windows: { x0: -3.4, x1: 2.4, pitch: 0.95, y: 0.28, w: 0.3, h: 0.4, r: 0.15, skip: [[-6.4, -4.0]] },
    doors: [{ x: 3.3, w: 0.62, h: 1.25, y0: -0.5, sides: [-1] }, { x: -1.0, w: 0.5, h: 0.65, y0: 0.0, sides: [1] }],
    cockpit: { x: 5.35, front: { ang: 28, w: 0.52, h: 0.34 }, side: { x: 4.7, y: 0.48, w: 0.42, h: 0.3 } },
    wing: {
      rootZ: 0.6, hinge: 0.72, slatCf: 0.1,
      stations: [
        { z: 0, x: 1.0, y: -0.55, c: 2.5, t: 0.14, tw: 1.5 },
        { z: 8.0, x: 0.52, y: -0.2, c: 1.2, t: 0.1, tw: -1.5 },
      ],
      flaps: [{ z0: 0.9, z1: 4.9 }],
      ailerons: [{ z0: 5.2, z1: 7.8, cf: 0.74 }],
      slats: [],
      spoilers: { z0: 1.5, z1: 4.6, n: 1, cf: 0.6, cfEnd: 0.74, angle: 0.9 },
      canoes: [],
      tip: { type: 'round', ext: 0.28 },
    },
    fin: {
      stations: [{ y: 0.55, x: -6.8, c: 2.8, t: 0.1 }, { y: 1.8, x: -7.7, c: 1.7, t: 0.09 }, { y: 2.95, x: -8.3, c: 1.3, t: 0.085 }],
      hinge: 0.64, rudderFrom: 0.9,
    },
    stab: {
      stations: [{ z: 0, x: -8.1, y: 2.75, c: 1.4, t: 0.09, tw: 0 }, { z: 3.0, x: -9.3, y: 2.85, c: 0.75, t: 0.075, tw: 0 }],
      hinge: 0.64, rootZ: 0.1,
    },
    engines: { r: 0.34, len: 2.4, rHi: 0.29, fanR: 0.26, rn: 0.27, rc: 0.17, blades: 18, paint: 'base', rear: true },
    gear: {
      noseAttachY: -0.55, mainAttachY: -0.45, noseWheelR: 0.22, noseWheelW: 0.12, noseTrack: 0.0, mainWheelR: 0.32, mainWheelW: 0.17, mainTrack: 0.0, mainStrut: 0.04, noseStrut: 0.035, doorW: 0.8, single: true,
    },
    beacons: [[-5.0, 'top'], [0.8, 'belly']],
  },

  // ---- Atlas 300 (777-300ER-class) -------------------------------------------------------------------------------------------
  widebody: {
    fuselage: {
      xTail: -37.4, xNose: 36.5, w: 3.1, top: 3.1, bot: 3.1, yc: 0.85, n: 2.04,
      nose: { len: 10.0, p: 1.7, q: 1.8, droop: 0.9, botPow: 0.9, wPow: 1.05, nBoost: 0.6 },
      tail: { len: 21.0, p: 1.4, q: 1.15, up: 2.2, tipR: 0.3, topPow: 0.9, botPow: 1.2 },
      bumps: [{ theta: BELLY, x0: -9.0, x1: 12.0, ramp: 4.0, ramp2: 4.0, h: 0.5, sigma: 0.8 }],
    },
    livery: {
      belly: -1.6, stripe: { x0: -36.0, x1: 28.0, y: -0.4, rise: 1.4, drop: 0.2, w: 0.34, gap: 0.2, w2: 0.1 },
      title: { xc: 4.0, y: 1.55, size: 1.0 }, reg: { xc: -28.0, y: 1.2, size: 0.5 }, tailPaint: 'stripe', logoY: 0.45,
    },
    windows: { x0: -29, x1: 26.5, pitch: 0.508, y: 0.85, w: 0.27, h: 0.38, r: 0.12, skip: [[-33, -30], [-20.3, -17.7], [-9.8, -7.6], [-1, 1], [12.6, 14.8], [27.2, 29.5]] },
    doors: [
      { x: 28.5, w: 1.07, h: 1.9, y0: -0.7 }, { x: 15.6, w: 1.07, h: 1.9, y0: -0.7 }, { x: 7.9, w: 1.07, h: 1.9, y0: -0.7 }, { x: -8.7, w: 1.07, h: 1.9, y0: -0.7 },
      { x: -19.0, w: 1.07, h: 1.9, y0: -0.7 }, { x: -31.0, w: 0.8, h: 1.6, y0: -0.5 },
      { x: 17.5, w: 2.7, h: 1.7, y0: -2.2, sides: [1] }, { x: -14.0, w: 2.7, h: 1.7, y0: -2.2, sides: [1] },
    ],
    cockpit: { x: 33.2, front: { ang: 27, w: 1.2, h: 0.62 }, side: { x: 31.0, y: 1.0, w: 0.9, h: 0.58 } },
    wing: {
      rootZ: 2.6, hinge: 0.75, slatCf: 0.12,
      stations: [
        { z: 0, x: 9.6, y: -2.3, c: 14.1, t: 0.15, tw: 2.0 },
        { z: 12, x: 1.6, y: -1.5, c: 6.6, t: 0.115, tw: 0.8 },
        { z: 31.0, x: -11.2, y: 1.8, c: 2.9, t: 0.092, tw: -1.8 },
      ],
      flaps: [{ z0: 4.0, z1: 11.6 }, { z0: 12.0, z1: 22.2 }],
      ailerons: [{ z0: 23.2, z1: 30.4, cf: 0.78 }],
      slats: [{ z0: 5.0, z1: 11.0 }, { z0: 11.2, z1: 16.6 }, { z0: 16.8, z1: 22.4 }, { z0: 22.6, z1: 30.8 }],
      spoilers: { z0: 5.5, z1: 22.5, n: 7, cf: 0.64, cfEnd: 0.78, angle: 0.8 },
      canoes: [{ z: 6.0, len: 2.2, r: 0.3 }, { z: 9.6, len: 2.2, r: 0.28 }, { z: 14.5, len: 1.9, r: 0.24 }, { z: 19.2, len: 1.6, r: 0.2 }],
      tip: { type: 'raked', ext: 1.45, tipChord: 1.55, sweep: 1.6, rise: 0.35 },
    },
    fin: {
      stations: [{ y: 2.6, x: -21.0, c: 12.4, t: 0.1 }, { y: 8.0, x: -26.6, c: 7.2, t: 0.09 }, { y: 13.5, x: -31.6, c: 4.7, t: 0.085 }],
      hinge: 0.72, rudderFrom: 3.2,
    },
    stab: {
      stations: [{ z: 0, x: -27.5, y: 2.1, c: 7.0, t: 0.1, tw: 0 }, { z: 10.75, x: -35.0, y: 3.1, c: 2.5, t: 0.075, tw: 0 }],
      hinge: 0.68, rootZ: 1.0,
    },
    engines: { r: 2.0, len: 7.6, rHi: 1.78, fanR: 1.6, rn: 1.5, rc: 0.9, blades: 22, paint: 'base' },
    gear: {
      noseAttachY: -2.4, mainAttachY: -2.1, noseWheelR: 0.55, noseWheelW: 0.3, noseTrack: 0.7, mainWheelR: 0.65, mainWheelW: 0.4, mainTrack: 1.2,
      mainAxles: 3, mainAxleSpacing: 1.4, mainStrut: 0.14, noseStrut: 0.1, doorW: 3.0, doorH: 0.9,
    },
    beacons: [[-8.0, 'top'], [6.0, 'belly']],
  },

  // ---- Titan 400 (747-400-class) ----------------------------------------------------------------------------------------------
  jumbo: {
    fuselage: {
      xTail: -36.7, xNose: 34.0, w: 3.25, top: 3.25, bot: 3.25, yc: 0.4, n: 2.0,
      nose: { len: 9.4, p: 1.7, q: 1.8, droop: 0.75, botPow: 0.9, wPow: 1.04, nBoost: 0.5 },
      tail: { len: 20.0, p: 1.4, q: 1.15, up: 2.3, tipR: 0.3, topPow: 0.9, botPow: 1.2 },
      bumps: [
        { theta: Math.PI / 2, x0: -1.0, x1: 27.0, ramp: 14, ramp2: 4.5, h: 1.9, sigma: 0.55 },
        { theta: BELLY, x0: -6.0, x1: 13.0, ramp: 4.0, ramp2: 4.0, h: 0.5, sigma: 0.8 },
      ],
    },
    livery: {
      belly: -1.6, stripe: { x0: -35.0, x1: 27.0, y: -0.5, rise: 1.4, drop: 0.2, w: 0.34, gap: 0.2, w2: 0.1 },
      title: { xc: 8.0, y: 1.5, size: 1.0 }, reg: { xc: -28.0, y: 1.1, size: 0.5 }, tailPaint: 'stripe', logoY: 0.45,
    },
    windows: { x0: -26, x1: 24.5, pitch: 0.508, y: 0.9, w: 0.27, h: 0.38, r: 0.12, skip: [[-32, -29], [-22, -19], [-8, -5.5], [10, 12], [22, 23.4], [26, 28.5]] },
    upperWindows: { x0: 2.0, x1: 22.0, pitch: 0.508, y: 3.35, w: 0.25, h: 0.34, r: 0.11 },
    doors: [
      { x: 26.5, w: 1.07, h: 1.9, y0: -0.6 }, { x: 14.5, w: 1.07, h: 1.9, y0: -0.6 }, { x: -4.0, w: 1.07, h: 1.9, y0: -0.6 }, { x: -20.5, w: 1.07, h: 1.9, y0: -0.6 },
      { x: -30.0, w: 0.9, h: 1.7, y0: -0.6 }, { x: 18.0, w: 2.6, h: 1.7, y0: -2.3, sides: [1] }, { x: -13.0, w: 2.6, h: 1.7, y0: -2.3, sides: [1] },
    ],
    cockpit: { x: 31.0, front: { ang: 27, w: 1.15, h: 0.6 }, side: { x: 29.0, y: 1.0, w: 0.88, h: 0.56 } },
    wing: {
      rootZ: 2.6, hinge: 0.76, slatCf: 0.12,
      stations: [
        { z: 0, x: 13.8, y: -2.5, c: 19.2, t: 0.15, tw: 2.0 },
        { z: 12.5, x: 2.5, y: -1.4, c: 9.0, t: 0.115, tw: 0.8 },
        { z: 31.4, x: -14.5, y: 3.0, c: 3.9, t: 0.092, tw: -1.8 },
      ],
      flaps: [{ z0: 4.0, z1: 12.2 }, { z0: 12.6, z1: 26.8 }],
      ailerons: [{ z0: 27.2, z1: 31.0, cf: 0.78 }, { z0: 11.0, z1: 12.4, cf: 0.76 }],
      slats: [{ z0: 5.0, z1: 12.0 }, { z0: 12.2, z1: 19.0 }, { z0: 19.2, z1: 26.0 }, { z0: 26.2, z1: 31.0 }],
      spoilers: { z0: 6.0, z1: 26.0, n: 6, cf: 0.65, cfEnd: 0.79, angle: 0.8 },
      canoes: [{ z: 6.5, len: 2.6, r: 0.34 }, { z: 10.5, len: 2.6, r: 0.32 }, { z: 15.5, len: 2.2, r: 0.28 }, { z: 21.0, len: 1.9, r: 0.24 }],
      tip: { type: 'winglet', height: 1.9, tipChord: 1.35, sweep: 40, cant: 62, t: 0.07 },
    },
    fin: {
      stations: [{ y: 3.0, x: -21.5, c: 13.0, t: 0.1 }, { y: 8.5, x: -26.5, c: 7.8, t: 0.09 }, { y: 14.1, x: -31.4, c: 4.7, t: 0.085 }],
      hinge: 0.72, rudderFrom: 3.8,
    },
    stab: {
      stations: [{ z: 0, x: -26.5, y: 1.9, c: 8.2, t: 0.1, tw: 0 }, { z: 11.1, x: -34.5, y: 3.0, c: 2.6, t: 0.075, tw: 0 }],
      hinge: 0.68, rootZ: 1.0,
    },
    engines: { r: 1.4, len: 6.2, rHi: 1.25, fanR: 1.12, rn: 1.05, rc: 0.7, blades: 20, paint: 'base' },
    gear: {
      noseAttachY: -2.6, mainAttachY: -2.2, noseWheelR: 0.55, noseWheelW: 0.3, noseTrack: 0.7, mainWheelR: 0.65, mainWheelW: 0.4, mainTrack: 1.2,
      mainAxles: 2, mainAxleSpacing: 1.5, mainStrut: 0.13, noseStrut: 0.1, doorW: 3.0, doorH: 0.9,
      mains: [{ x: -6.8, z: -2.6 }, { x: -6.8, z: 2.6 }],
    },
    beacons: [[-8.0, 'top'], [6.0, 'belly']],
  },
};

void rad;
