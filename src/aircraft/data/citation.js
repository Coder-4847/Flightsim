// Citation-style light business jet: quick, clean, and unforgiving of speed mistakes.
export default {
  id: 'citation',
  name: 'Zenith CJ',
  maker: 'Light business jet',
  blurb: 'Small twin jet. Fast and slippery: plan your descents.',
  class: 'Business jet',
  registration: 'N525FS',

  mass: { empty: 4300, payload: 400, fuelCapacity: 1990, fuelStart: 1100, ref: 6291 },
  inertia: { roll: 15000, pitch: 30000, yaw: 42000 },
  cg: { empty: 0.2, full: 0.24, ref: 0.22 },
  wing: { area: 28.0, span: 16.2, chord: 1.85, sweep: 2 },

  aero: {
    cl0: 0.15, cd0: 0.022, oswald: 0.82, gearCd: 0.015, speedbrakeCd: 0.02,
    cm0: 0.04, cmAlpha: -1.2, cmq: -22, cmDe: 1.4,
    clBeta: -0.12, clp: -0.5, clr: 0.1, clDa: 0.17, clDr: 0.01,
    cnBeta: 0.11, cnr: -0.18, cnDr: 0.08, cnDa: -0.03,
    cyBeta: -0.55, cyDr: 0.22,
    machCrit: 0.74, waveDrag: 0.02,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 80 },
  flaps: {
    rate: 3, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 101, cd: 0 },
      { deg: 15, vs: 90, cd: 0.025, cm: -0.02 },
      { deg: 35, vs: 83, cd: 0.075, cm: -0.06 },
    ],
  },

  gear: {
    retractable: true, transitTime: 5, travel: 0.3, wheelRadius: 0.34, brakeMu: 0.6, steerMax: 15,
    nose: { x: 4.6, y: -1.5, z: 0 },
    mainLeft: { x: -0.7, y: -1.5, z: -1.45 },
    mainRight: { x: -0.7, y: -1.5, z: 1.45 },
  },
  strike: [
    { x: -6.0, y: -0.2, z: 0 }, // tail cone
    { x: -0.5, y: -0.3, z: -8.1 }, { x: -0.5, y: -0.3, z: 8.1 }, // wing tips
    { x: 0.5, y: -0.9, z: 0 }, { x: 3.5, y: -0.7, z: 0 }, // belly
    { x: -3.6, y: 0.05, z: -1.0 }, { x: -3.6, y: 0.05, z: 1.0 }, // engine pods
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 12460, altitudeLapse: 0.8, machSlope: -0.4, idle: 0.22,
      spoolUp: 3.5, spoolDown: 2.5, fuelFlowIdle: 0.04, fuelFlowMax: 0.32, rpmMax: 100,
    },
    positions: [{ x: -3.6, y: 0.45, z: -1.0 }, { x: -3.6, y: 0.45, z: 1.0 }],
  },

  limits: { vne: 305, mmo: 0.77, nzPos: 3.6, nzNeg: -1.44, hardLanding: 3.0, crashLanding: 5.0 },
  speeds: { cruise: 230, vr: 105, vx: 115, vy: 160, vapp: 110, vfe: 200, vno: 260 },

  livery: { base: '#f6f7f9', stripe: '#0f6b6f', stripe2: '#9aa5b1', belly: '#d9dde3', wing: '#f6f7f9' },
  cockpit: {
    eye: { x: 3.9, y: 0.42, z: -0.42 }, panel: 'glass', seats: 6, yoke: 'yoke',
  },

  minRunway: 1000, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.3, length: 15.5 },
};
