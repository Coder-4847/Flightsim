// Large twin-engine air-superiority fighter (Su-27 class): huge fuel load, long range, high alpha.
export default {
  id: 'heavyfighter',
  name: 'Warden S-27',
  maker: 'Heavy air-superiority fighter',
  blurb: 'Big, thirsty and brutally powerful. Enormous thrust and a wing that keeps flying at high alpha.',
  class: 'Fighter',
  registration: 'BLUE 27',

  mass: { empty: 16380, payload: 300, fuelCapacity: 9400, fuelStart: 6000, ref: 22000 },
  inertia: { roll: 60000, pitch: 320000, yaw: 360000 },
  cg: { empty: 0.28, full: 0.31, ref: 0.3 },
  wing: { area: 62.0, span: 14.7, chord: 6.0, sweep: 42 },

  aero: {
    cl0: 0.05, cd0: 0.0195, oswald: 0.78, gearCd: 0.02, speedbrakeCd: 0.03,
    cm0: 0.01, cmAlpha: -0.3, cmq: -6.5, cmDe: 0.6,
    clBeta: -0.09, clp: -0.35, clr: 0.06, clDa: 0.11, clDr: 0.01,
    cnBeta: 0.16, cnr: -0.2, cnDr: 0.07, cnDa: -0.02,
    cyBeta: -0.8, cyDr: 0.2,
    machCrit: 0.9, waveDrag: 0.025,
  },
  controls: { elevatorUp: 25, elevatorDown: 25, aileron: 22, rudder: 30, rate: 70 },
  fcs: { type: 'fbw', nzMax: 9, nzMin: -3, alphaLimit: 30, rollRate: 200, kq: 0.9, kp: 0.35 },
  flaps: {
    rate: 8, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 122, cd: 0 },
      { deg: 15, vs: 113, cd: 0.01, cm: -0.01 },
      { deg: 30, vs: 105, cd: 0.035, cm: -0.025 },
    ],
  },

  gear: {
    retractable: true, transitTime: 7, travel: 0.4, wheelRadius: 0.4, brakeMu: 0.6, steerMax: 30,
    nose: { x: 5.2, y: -2.2, z: 0 },
    mainLeft: { x: -1.2, y: -2.2, z: -1.9 },
    mainRight: { x: -1.2, y: -2.2, z: 1.9 },
  },
  strike: [
    { x: -8.8, y: 0.0, z: 0 }, // tail sting
    { x: -2.0, y: 0.0, z: -7.2 }, { x: -2.0, y: 0.0, z: 7.2 }, // wing tips
    { x: 1.0, y: -1.2, z: 0 }, { x: 3.5, y: -1.3, z: 0 }, // belly
    { x: -5.8, y: -1.0, z: -1.5 }, { x: -5.8, y: -1.0, z: 1.5 }, // engine fairings
  ],

  engines: {
    spec: {
      type: 'turbofan', afterburner: true, thrust: 122600, thrustDry: 74500, abThreshold: 0.85,
      altitudeLapse: 0.8, machSlope: 0.3, idle: 0.22, spoolUp: 3.5, spoolDown: 2.2,
      fuelFlowIdle: 0.15, fuelFlowMax: 0.85, fuelFlowAb: 3.2, rpmMax: 100,
    },
    positions: [{ x: -5.4, y: -0.1, z: -1.4 }, { x: -5.4, y: -0.1, z: 1.4 }],
  },

  limits: { vne: 750, mmo: 2.0, nzPos: 9, nzNeg: -3, hardLanding: 4.0, crashLanding: 6.2 },
  speeds: { cruise: 380, vr: 155, vx: 280, vy: 380, vapp: 145, vfe: 270, vno: 700 },

  livery: { base: '#8f979f', belly: '#7e868e', wing: '#868e96', roughness: 0.5, metalness: 0.15, regColor: '#1f3a5c', tip: 0x474e56 },
  cockpit: {
    eye: { x: 4.6, y: 1.05, z: 0 }, panel: 'fighter', seats: 1, yoke: 'stick',
  },

  minRunway: 900, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -0.1, length: 21.9 },
};
