// Single-aisle twin-jet airliner (A320 class): fly-by-wire, sidestick, 150 seats.
export default {
  id: 'narrowbody',
  name: 'Meridian 320',
  maker: 'Single-aisle airliner',
  blurb: 'The workhorse twin-jet. Stable, forgiving, and a good first airliner.',
  class: 'Airliner',
  registration: 'N320FS',

  mass: { empty: 42600, payload: 14500, fuelCapacity: 18700, fuelStart: 8500, ref: 64500 },
  inertia: { roll: 2400000, pitch: 3200000, yaw: 5400000 },
  cg: { empty: 0.22, full: 0.3, ref: 0.27 },
  wing: { area: 122.6, span: 34.1, chord: 4.29, sweep: 25 },

  aero: {
    cl0: 0.22, cd0: 0.021, oswald: 0.8, gearCd: 0.02, speedbrakeCd: 0.04,
    cm0: 0.04, cmAlpha: -1.5, cmq: -30, cmDe: 1.15,
    clBeta: -0.12, clp: -0.46, clr: 0.1, clDa: 0.274, clDr: 0.01,
    cnBeta: 0.11, cnr: -0.17, cnDr: 0.085, cnDa: -0.03,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.78, waveDrag: 0.03,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 50 },
  flaps: {
    rate: 2.5, takeoffStage: 1, landingStage: 3,
    stages: [
      { deg: 0, vs: 150, cd: 0 },
      { deg: 15, vs: 128, cd: 0.02, cm: -0.03 },
      { deg: 25, vs: 118, cd: 0.045, cm: -0.05 },
      { deg: 40, vs: 108, cd: 0.1, cm: -0.08 },
    ],
  },

  gear: {
    retractable: true, transitTime: 9, travel: 0.45, wheelRadius: 0.55, brakeMu: 0.55, steerMax: 70,
    nose: { x: 11.2, y: -3.3, z: 0 },
    mainLeft: { x: -1.4, y: -3.3, z: -3.8 },
    mainRight: { x: -1.4, y: -3.3, z: 3.8 },
  },
  strike: [
    { x: -16.0, y: -0.4, z: 0 }, // tail
    { x: -4.0, y: 1.2, z: -17.2 }, { x: -4.0, y: 1.2, z: 17.2 }, // sharklet tips
    { x: 0.0, y: -1.8, z: 0 }, { x: 7.5, y: -1.6, z: 0 }, // belly
    { x: 0.8, y: -2.8, z: -5.7 }, { x: 0.8, y: -2.8, z: 5.7 }, // engine nacelles
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 120000, altitudeLapse: 0.82, machSlope: -0.5, idle: 0.2,
      spoolUp: 5, spoolDown: 3.5, fuelFlowIdle: 0.17, fuelFlowMax: 1.0, rpmMax: 100,
    },
    positions: [{ x: 1.5, y: -1.85, z: -5.7 }, { x: 1.5, y: -1.85, z: 5.7 }],
  },

  limits: { vne: 350, mmo: 0.82, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.5, crashLanding: 4.2 },
  speeds: { cruise: 280, vr: 140, vx: 150, vy: 250, vapp: 135, vfe: 230, vno: 310 },

  livery: { regSize: 20, base: '#f4f5f7', stripe: '#1b5cc9', stripe2: '#9fb7dc', belly: '#d7dbe0', wing: '#e8ebee' },
  cockpit: {
    eye: { x: 16.8, y: 0.95, z: -0.55 }, panel: 'airliner', seats: 150, yoke: 'sidestick', width: 1.05,
  },

  minRunway: 1900, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -1.1, length: 37.6 },
};
