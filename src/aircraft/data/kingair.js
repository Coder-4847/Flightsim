// King Air-style twin turboprop. Heavier, with real engine-out yaw and torque effects.
export default {
  id: 'kingair',
  name: 'Regal 200',
  maker: 'Twin turboprop',
  blurb: 'Fast, stable twin. Practise asymmetric thrust and retractable gear.',
  class: 'Light prop',
  registration: 'N200FS',

  mass: { empty: 3640, payload: 450, fuelCapacity: 1640, fuelStart: 800, ref: 5670 },
  inertia: { roll: 18000, pitch: 26000, yaw: 36000 },
  cg: { empty: 0.22, full: 0.25, ref: 0.24 },
  wing: { area: 28.15, span: 16.6, chord: 1.84, sweep: 0 },

  aero: {
    cl0: 0.2, cd0: 0.027, oswald: 0.8, gearCd: 0.018, speedbrakeCd: 0,
    cm0: 0.06, cmAlpha: -0.95, cmq: -18, cmDe: 1.3,
    clBeta: -0.1, clp: -0.5, clr: 0.12, clDa: 0.16, clDr: 0.012,
    cnBeta: 0.1, cnr: -0.15, cnDr: 0.08, cnDa: -0.04,
    cyBeta: -0.45, cyDr: 0.2,
    propwash: 0.5,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 90 },
  flaps: {
    rate: 3, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 96, cd: 0 },
      { deg: 14, vs: 88, cd: 0.02, cm: -0.02 },
      { deg: 35, vs: 82, cd: 0.07, cm: -0.06 },
    ],
  },

  gear: {
    retractable: true, transitTime: 6, travel: 0.35, wheelRadius: 0.36, brakeMu: 0.55, steerMax: 12,
    nose: { x: 3.8, y: -1.55, z: 0 },
    mainLeft: { x: -0.5, y: -1.55, z: -1.95 },
    mainRight: { x: -0.5, y: -1.55, z: 1.95 },
  },
  strike: [
    { x: -6.2, y: -0.2, z: 0 }, // tail
    { x: -0.5, y: -0.3, z: -8.3 }, { x: -0.5, y: -0.3, z: 8.3 }, // wing tips
    { x: 0.5, y: -0.9, z: 0 }, { x: 3.0, y: -0.7, z: 0 }, // belly
    { x: 1.6, y: -1.18, z: -2.6 }, { x: 1.6, y: -1.18, z: 2.6 }, // propeller tips
  ],

  engines: {
    spec: {
      type: 'turboprop', power: 634 * 1000, propEfficiency: 0.8, staticThrust: 6200, propArea: 4.4,
      propTorque: 700, propYaw: 400, idle: 0.15, spoolUp: 3, spoolDown: 2,
      fuelFlowIdle: 0.03, fuelFlowMax: 0.075, rpmMax: 100,
    },
    positions: [{ x: 1.6, y: 0, z: -2.6 }, { x: 1.6, y: 0, z: 2.6 }],
  },

  limits: { vne: 260, nzPos: 3.2, nzNeg: -1.3, hardLanding: 3.0, crashLanding: 5.0 },
  speeds: { cruise: 200, vr: 95, vx: 100, vy: 110, vapp: 105, vfe: 200, vno: 181 },

  livery: { base: '#f4f5f7', stripe: '#17365f', stripe2: '#c9a24a', belly: '#d8dce2', wing: '#f4f5f7', tip: 0xd6d9de },
  cockpit: {
    eye: { x: 3.0, y: 0.5, z: -0.4 }, panel: 'steam2', seats: 8, yoke: 'yoke',
  },

  minRunway: 1100, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.3, length: 13.3 },
};
