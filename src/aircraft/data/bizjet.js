// Large-cabin long-range business jet: swept wing, rear engines, T-tail, Mach 0.9 cruise.
export default {
  id: 'bizjet',
  name: 'Stratos G6',
  maker: 'Long-range business jet',
  blurb: 'Large-cabin jet that cruises near Mach 0.9. Fast, clean and hungry for runway.',
  class: 'Business jet',
  registration: 'N6FS',

  mass: { empty: 24500, payload: 1200, fuelCapacity: 19000, fuelStart: 9500, ref: 36000 },
  inertia: { roll: 420000, pitch: 900000, yaw: 1250000 },
  cg: { empty: 0.22, full: 0.27, ref: 0.25 },
  wing: { area: 119.2, span: 30.4, chord: 4.2, sweep: 36 },

  aero: {
    cl0: 0.2, cd0: 0.019, oswald: 0.8, gearCd: 0.017, speedbrakeCd: 0.03,
    cm0: 0.05, cmAlpha: -1.4, cmq: -28, cmDe: 1.2,
    clBeta: -0.12, clp: -0.45, clr: 0.1, clDa: 0.18, clDr: 0.01,
    cnBeta: 0.1, cnr: -0.17, cnDr: 0.08, cnDa: -0.03,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.84, waveDrag: 0.03,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 55 },
  flaps: {
    rate: 3, takeoffStage: 1, landingStage: 3,
    stages: [
      { deg: 0, vs: 125, cd: 0 },
      { deg: 10, vs: 110, cd: 0.015, cm: -0.02 },
      { deg: 20, vs: 101, cd: 0.035, cm: -0.04 },
      { deg: 39, vs: 93, cd: 0.09, cm: -0.07 },
    ],
  },

  gear: {
    retractable: true, transitTime: 8, travel: 0.4, wheelRadius: 0.5, brakeMu: 0.6, steerMax: 70,
    nose: { x: 9.6, y: -2.45, z: 0 },
    mainLeft: { x: -1.3, y: -2.45, z: -2.1 },
    mainRight: { x: -1.3, y: -2.45, z: 2.1 },
  },
  strike: [
    { x: -12.8, y: -0.7, z: 0 }, // tail cone
    { x: -3.5, y: 1.4, z: -15.0 }, { x: -3.5, y: 1.4, z: 15.0 }, // wing tips
    { x: 0.5, y: -1.3, z: 0 }, { x: 6.5, y: -1.2, z: 0 }, // belly
    { x: -9.0, y: -0.5, z: -2.2 }, { x: -9.0, y: -0.5, z: 2.2 }, // engine pods
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 71600, altitudeLapse: 0.8, machSlope: -0.35, idle: 0.2,
      spoolUp: 4.5, spoolDown: 3, fuelFlowIdle: 0.1, fuelFlowMax: 0.75, rpmMax: 100,
    },
    positions: [{ x: -9.0, y: 0.7, z: -2.1 }, { x: -9.0, y: 0.7, z: 2.1 }],
  },

  limits: { vne: 340, mmo: 0.925, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.8, crashLanding: 4.6 },
  speeds: { cruise: 300, vr: 125, vx: 140, vy: 190, vapp: 120, vfe: 200, vno: 300 },

  livery: { regSize: 20, base: '#f5f6f8', stripe: '#6a4a8f', stripe2: '#c9b26e', belly: '#d8dce2', wing: '#eceef1' },
  cockpit: {
    eye: { x: 11.4, y: 0.95, z: -0.42 }, panel: 'glass', seats: 12, yoke: 'sidestick', width: 1.0,
  },

  geometry: { wingHeight: -0.9, length: 30.4 },
};
