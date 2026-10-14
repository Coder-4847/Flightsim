// Tandem-seat jet trainer (L-39 class): straight wing, tip tanks, a single small turbofan.
export default {
  id: 'trainer',
  name: 'Tutor T-39',
  maker: 'Jet trainer',
  blurb: 'Your first jet. Honest handling, tip tanks, and just enough thrust to be interesting.',
  class: 'Jet trainer',
  registration: 'N39FS',

  mass: { empty: 3455, payload: 200, fuelCapacity: 1000, fuelStart: 650, ref: 4300 },
  inertia: { roll: 4200, pitch: 7200, yaw: 10200 },
  cg: { empty: 0.24, full: 0.27, ref: 0.26 },
  wing: { area: 18.18, span: 9.46, chord: 2.1, sweep: 4 },

  aero: {
    cl0: 0.14, cd0: 0.024, oswald: 0.8, gearCd: 0.015, speedbrakeCd: 0.03,
    cm0: 0.04, cmAlpha: -0.9, cmq: -14, cmDe: 1.2,
    clBeta: -0.1, clp: -0.5, clr: 0.1, clDa: 0.19, clDr: 0.012,
    cnBeta: 0.1, cnr: -0.15, cnDr: 0.075, cnDa: -0.04,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.76, waveDrag: 0.02,
  },
  controls: { elevatorUp: 25, elevatorDown: 22, aileron: 20, rudder: 25, rate: 90 },
  flaps: {
    rate: 6, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 100, cd: 0 },
      { deg: 25, vs: 90, cd: 0.025, cm: -0.025 },
      { deg: 44, vs: 84, cd: 0.07, cm: -0.05 },
    ],
  },

  gear: {
    retractable: true, transitTime: 5, travel: 0.3, wheelRadius: 0.33, brakeMu: 0.6, steerMax: 35,
    nose: { x: 3.0, y: -1.5, z: 0 },
    mainLeft: { x: -0.6, y: -1.5, z: -1.35 },
    mainRight: { x: -0.6, y: -1.5, z: 1.35 },
  },
  strike: [
    { x: -5.4, y: 0.1, z: 0 }, // tail
    { x: -0.6, y: 0.0, z: -4.9 }, { x: -0.6, y: 0.0, z: 4.9 }, // tip tanks
    { x: 0.5, y: -0.85, z: 0 }, { x: 2.0, y: -0.8, z: 0 }, // belly
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 16900, altitudeLapse: 0.8, machSlope: -0.3, idle: 0.22,
      spoolUp: 4, spoolDown: 2.5, fuelFlowIdle: 0.04, fuelFlowMax: 0.3, rpmMax: 100,
    },
    positions: [{ x: -2.3, y: 0.1, z: 0 }],
  },

  limits: { vne: 470, mmo: 0.8, nzPos: 8, nzNeg: -4, hardLanding: 3.2, crashLanding: 5.2 },
  speeds: { cruise: 300, vr: 108, vx: 135, vy: 185, vapp: 115, vfe: 180, vno: 400 },

  livery: { base: '#d9dde1', stripe: '#c53030', stripe2: '#1d2b44', belly: '#c3c8ce', wing: '#cfd3d8', tip: 0xc53030 },
  cockpit: {
    eye: { x: 2.4, y: 0.82, z: 0 }, panel: 'trainer', seats: 2, yoke: 'stick',
  },

  minRunway: 900, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.05, length: 12.1 },
};
