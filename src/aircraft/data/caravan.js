// Single-engine utility turboprop (Caravan class): high wing, fixed gear, big flaps.
export default {
  id: 'caravan',
  name: 'Trekker 208',
  maker: 'Utility turboprop',
  blurb: 'Rugged single turboprop with short-field flaps. Hauls a lot, lands almost anywhere.',
  class: 'Turboprop',
  registration: 'N208FS',

  mass: { empty: 2145, payload: 520, fuelCapacity: 1000, fuelStart: 620, ref: 3400 },
  inertia: { roll: 7200, pitch: 9800, yaw: 15000 },
  cg: { empty: 0.22, full: 0.25, ref: 0.24 },
  wing: { area: 25.96, span: 15.88, chord: 1.64, sweep: 0 },

  aero: {
    cl0: 0.25, cd0: 0.034, oswald: 0.78, gearCd: 0, speedbrakeCd: 0,
    cm0: 0.07, cmAlpha: -1.0, cmq: -14, cmDe: 1.25,
    clBeta: -0.09, clp: -0.5, clr: 0.1, clDa: 0.16, clDr: 0.014,
    cnBeta: 0.075, cnr: -0.12, cnDr: 0.065, cnDa: -0.05,
    cyBeta: -0.34, cyDr: 0.19,
    propwash: 0.8,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 20, rudder: 25, rate: 100 },
  flaps: {
    rate: 4, takeoffStage: 1, landingStage: 3,
    stages: [
      { deg: 0, vs: 69, cd: 0 },
      { deg: 10, vs: 64, cd: 0.012, cm: -0.02 },
      { deg: 20, vs: 61, cd: 0.03, cm: -0.04 },
      { deg: 30, vs: 58, cd: 0.055, cm: -0.06 },
    ],
  },

  gear: {
    retractable: false, transitTime: 1, travel: 0.3, wheelRadius: 0.37, brakeMu: 0.5, steerMax: 12,
    nose: { x: 2.9, y: -1.62, z: 0 },
    mainLeft: { x: -0.35, y: -1.62, z: -1.6 },
    mainRight: { x: -0.35, y: -1.62, z: 1.6 },
  },
  strike: [
    { x: -5.9, y: 0.0, z: 0 }, // tail
    { x: -0.3, y: 1.0, z: -7.9 }, { x: -0.3, y: 1.0, z: 7.9 }, // wing tips
    { x: 0.2, y: -0.95, z: 0 }, // belly pod
    { x: 4.1, y: -1.3, z: 0 }, // propeller tip
  ],

  engines: {
    spec: {
      type: 'turboprop', power: 503 * 1000, propEfficiency: 0.82, staticThrust: 7600, propArea: 5.7,
      propTorque: 900, propYaw: 450, idle: 0.14, spoolUp: 2.5, spoolDown: 2,
      fuelFlowIdle: 0.02, fuelFlowMax: 0.076, rpmMax: 100,
    },
    positions: [{ x: 4.0, y: 0.1, z: 0 }],
  },

  limits: { vne: 175, nzPos: 3.4, nzNeg: -1.4, hardLanding: 2.8, crashLanding: 4.8 },
  speeds: { cruise: 150, vr: 72, vx: 78, vy: 90, vapp: 78, vfe: 150, vno: 148 },

  livery: { base: '#f1f2f0', stripe: '#b8561c', stripe2: '#2b3a4a', belly: '#d4d7d8', wing: '#f1f2f0', tip: 0xd9a21b },
  cockpit: {
    eye: { x: 1.35, y: 0.78, z: -0.42 }, panel: 'steam', seats: 4, yoke: 'yoke',
  },

  geometry: { wingHeight: 1.2, length: 11.5 },
};
