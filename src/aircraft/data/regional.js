// Regional jet (E175 class): under-wing engines, winglets, 78 seats, yoke.
export default {
  id: 'regional',
  name: 'Regional 175',
  maker: 'Regional jet',
  blurb: 'Seventy-eight-seat twin jet. Nimble for an airliner and quick to climb.',
  class: 'Airliner',
  registration: 'N175FS',

  mass: { empty: 21800, payload: 8000, fuelCapacity: 9300, fuelStart: 4300, ref: 35000 },
  inertia: { roll: 520000, pitch: 1100000, yaw: 1600000 },
  cg: { empty: 0.22, full: 0.29, ref: 0.26 },
  wing: { area: 72.7, span: 26.0, chord: 3.2, sweep: 23 },

  aero: {
    cl0: 0.22, cd0: 0.022, oswald: 0.8, gearCd: 0.019, speedbrakeCd: 0.035,
    cm0: 0.04, cmAlpha: -1.5, cmq: -28, cmDe: 1.2,
    clBeta: -0.11, clp: -0.46, clr: 0.1, clDa: 0.18, clDr: 0.01,
    cnBeta: 0.1, cnr: -0.17, cnDr: 0.08, cnDa: -0.03,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.78, waveDrag: 0.03,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 55 },
  flaps: {
    rate: 3, takeoffStage: 1, landingStage: 3,
    stages: [
      { deg: 0, vs: 138, cd: 0 },
      { deg: 8, vs: 120, cd: 0.012, cm: -0.02 },
      { deg: 20, vs: 109, cd: 0.04, cm: -0.04 },
      { deg: 35, vs: 101, cd: 0.095, cm: -0.07 },
    ],
  },

  gear: {
    retractable: true, transitTime: 8, travel: 0.4, wheelRadius: 0.5, brakeMu: 0.55, steerMax: 70,
    nose: { x: 10.0, y: -2.7, z: 0 },
    mainLeft: { x: -1.0, y: -2.7, z: -2.6 },
    mainRight: { x: -1.0, y: -2.7, z: 2.6 },
  },
  strike: [
    { x: -13.8, y: -0.4, z: 0 }, // tail
    { x: -3.0, y: 1.0, z: -13.2 }, { x: -3.0, y: 1.0, z: 13.2 }, // winglets
    { x: 0.0, y: -1.6, z: 0 }, { x: 6.5, y: -1.5, z: 0 }, // belly
    { x: 0.6, y: -2.3, z: -4.0 }, { x: 0.6, y: -2.3, z: 4.0 }, // nacelles
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 62000, altitudeLapse: 0.82, machSlope: -0.5, idle: 0.2,
      spoolUp: 4.5, spoolDown: 3, fuelFlowIdle: 0.1, fuelFlowMax: 0.55, rpmMax: 100,
    },
    positions: [{ x: 1.4, y: -1.45, z: -4.0 }, { x: 1.4, y: -1.45, z: 4.0 }],
  },

  limits: { vne: 320, mmo: 0.82, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.6, crashLanding: 4.3 },
  speeds: { cruise: 270, vr: 128, vx: 140, vy: 230, vapp: 125, vfe: 230, vno: 290 },

  livery: { regSize: 20, base: '#f3f4f6', stripe: '#c93a2e', stripe2: '#2a3340', belly: '#d6dade', wing: '#e8ebee' },
  cockpit: {
    eye: { x: 13.4, y: 0.95, z: -0.5 }, panel: 'airliner', seats: 78, yoke: 'yoke', width: 1.0,
  },

  minRunway: 1500, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.9, length: 31.7 },
};
