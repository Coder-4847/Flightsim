// Twin-engine carrier-style multirole fighter (F/A-18 class): LEX, canted twin fins, FBW.
export default {
  id: 'hornet',
  name: 'Corsair F/18',
  maker: 'Twin-engine fighter',
  blurb: 'Rugged twin-engine fighter. Docile at high alpha, with a landing gear built for hard arrivals.',
  class: 'Fighter',
  registration: '16-3000',

  mass: { empty: 10400, payload: 300, fuelCapacity: 4900, fuelStart: 3200, ref: 14300 },
  inertia: { roll: 31200, pitch: 205000, yaw: 230400 },
  cg: { empty: 0.22, full: 0.25, ref: 0.24 },
  wing: { area: 37.2, span: 11.43, chord: 3.5, sweep: 20 },

  aero: {
    cl0: 0.06, cd0: 0.0205, oswald: 0.78, gearCd: 0.02, speedbrakeCd: 0.025,
    cm0: 0.01, cmAlpha: -0.3, cmq: -7, cmDe: 0.6,
    clBeta: -0.09, clp: -0.35, clr: 0.06, clDa: 0.12, clDr: 0.01,
    cnBeta: 0.16, cnr: -0.2, cnDr: 0.07, cnDa: -0.02,
    cyBeta: -0.8, cyDr: 0.2,
    machCrit: 0.88, waveDrag: 0.028,
  },
  controls: { elevatorUp: 24, elevatorDown: 24, aileron: 25, rudder: 30, rate: 80 },
  fcs: { type: 'fbw', nzMax: 7.5, nzMin: -3, alphaLimit: 30, rollRate: 220, kq: 0.9, kp: 0.35 },
  flaps: {
    rate: 10, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 128, cd: 0 },
      { deg: 15, vs: 116, cd: 0.012, cm: -0.01 },
      { deg: 30, vs: 105, cd: 0.04, cm: -0.025 },
    ],
  },

  gear: {
    retractable: true, transitTime: 6, travel: 0.4, wheelRadius: 0.35, brakeMu: 0.6, steerMax: 35,
    nose: { x: 4.2, y: -1.85, z: 0 },
    mainLeft: { x: -0.7, y: -1.85, z: -1.55 },
    mainRight: { x: -0.7, y: -1.85, z: 1.55 },
  },
  strike: [
    { x: -6.2, y: -0.2, z: 0 }, // tail hook / stinger
    { x: -1.0, y: -0.1, z: -5.6 }, { x: -1.0, y: -0.1, z: 5.6 }, // wing tips
    { x: 0.8, y: -1.0, z: 0 }, { x: 2.5, y: -1.1, z: 0 }, // belly
    { x: -4.5, y: -0.9, z: -0.8 }, { x: -4.5, y: -0.9, z: 0.8 }, // engine fairings
  ],

  engines: {
    spec: {
      type: 'turbofan', afterburner: true, thrust: 78700, thrustDry: 48900, abThreshold: 0.85,
      altitudeLapse: 0.8, machSlope: 0.3, idle: 0.22, spoolUp: 3, spoolDown: 2,
      fuelFlowIdle: 0.1, fuelFlowMax: 0.5, fuelFlowAb: 2.2, rpmMax: 100,
    },
    positions: [{ x: -4.5, y: 0, z: -0.7 }, { x: -4.5, y: 0, z: 0.7 }],
  },

  limits: { vne: 700, mmo: 1.8, nzPos: 7.5, nzNeg: -3, hardLanding: 4.2, crashLanding: 6.5 },
  speeds: { cruise: 350, vr: 140, vx: 250, vy: 350, vapp: 140, vfe: 250, vno: 650 },

  livery: { base: '#7c848c', belly: '#6c747c', wing: '#737b83', roughness: 0.5, metalness: 0.15, regColor: '#23282e', tip: 0x3d4349 },
  cockpit: {
    eye: { x: 3.4, y: 0.85, z: 0 }, panel: 'fighter', seats: 1, yoke: 'stick',
  },

  minRunway: 800, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.1, length: 17.1 },
};
