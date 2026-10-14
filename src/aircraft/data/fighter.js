// F-16-style light fighter. Fly-by-wire: the stick commands g and roll rate.
export default {
  id: 'fighter',
  name: 'Falcon F-16',
  maker: 'Light fighter',
  blurb: 'Single-engine fighter with afterburner and 9 g fly-by-wire.',
  class: 'Fighter',
  registration: '87-0001',

  mass: { empty: 8570, payload: 100, fuelCapacity: 3100, fuelStart: 2000, ref: 9500 },
  inertia: { roll: 12875, pitch: 75674, yaw: 85552 },
  cg: { empty: 0.3, full: 0.33, ref: 0.32 },
  wing: { area: 27.9, span: 9.45, chord: 3.45, sweep: 32 },

  aero: {
    cl0: 0.05, cd0: 0.0185, oswald: 0.8, gearCd: 0.018, speedbrakeCd: 0.02,
    cm0: 0.01, cmAlpha: -0.3, cmq: -6, cmDe: 0.6,
    clBeta: -0.08, clp: -0.35, clr: 0.06, clDa: 0.12, clDr: 0.01,
    cnBeta: 0.15, cnr: -0.2, cnDr: 0.07, cnDa: -0.02,
    cyBeta: -0.8, cyDr: 0.2,
    machCrit: 0.9, waveDrag: 0.025,
  },
  controls: { elevatorUp: 25, elevatorDown: 25, aileron: 21, rudder: 30, rate: 80 },
  fcs: { type: 'fbw', nzMax: 9, nzMin: -3, alphaLimit: 25, rollRate: 240, kq: 0.9, kp: 0.35 },
  flaps: {
    rate: 10, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 114, cd: 0 },
      { deg: 10, vs: 108, cd: 0.01, cm: -0.01 },
      { deg: 20, vs: 100, cd: 0.03, cm: -0.02 },
    ],
  },

  gear: {
    retractable: true, transitTime: 6, travel: 0.3, wheelRadius: 0.31, brakeMu: 0.65, steerMax: 32,
    nose: { x: 3.4, y: -1.5, z: 0 },
    mainLeft: { x: -0.55, y: -1.5, z: -1.2 },
    mainRight: { x: -0.55, y: -1.5, z: 1.2 },
  },
  strike: [
    { x: -5.3, y: -0.25, z: 0 }, // exhaust nozzle
    { x: -0.5, y: -0.3, z: -4.7 }, { x: -0.5, y: -0.3, z: 4.7 }, // wing tip rails
    { x: 0.5, y: -0.9, z: 0 }, { x: 1.5, y: -1.0, z: 0 }, // belly and intake
  ],

  engines: {
    spec: {
      type: 'turbofan', afterburner: true, thrust: 129000, thrustDry: 79200, abThreshold: 0.85,
      altitudeLapse: 0.8, machSlope: 0.3, idle: 0.22, spoolUp: 3, spoolDown: 2,
      fuelFlowIdle: 0.12, fuelFlowMax: 0.65, fuelFlowAb: 3.0, rpmMax: 100,
    },
    positions: [{ x: -4.5, y: 0, z: 0 }],
  },

  limits: { vne: 750, mmo: 2.0, nzPos: 9, nzNeg: -3, hardLanding: 3.8, crashLanding: 6.0 },
  speeds: { cruise: 350, vr: 150, vx: 250, vy: 350, vapp: 150, vfe: 280, vno: 700 },

  livery: { base: '#8a9199', belly: '#767d85', wing: '#80878f', roughness: 0.5, metalness: 0.15, regColor: '#2a2f36', tip: 0x444b53 },
  cockpit: {
    eye: { x: 2.9, y: 0.78, z: 0 }, panel: 'fighter', seats: 1, yoke: 'stick',
  },

  minRunway: 800, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.2, length: 15 },
};
