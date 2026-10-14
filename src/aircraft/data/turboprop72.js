// Twin-turboprop regional airliner (ATR 72 class): high wing, big slow props, glass cockpit.
export default {
  id: 'turboprop72',
  name: 'Cirrus 72',
  maker: 'Regional turboprop airliner',
  blurb: 'Seventy-seat twin turboprop. Heavy, stable, and happy on short runways.',
  class: 'Airliner',
  registration: 'N72FS',

  mass: { empty: 13010, payload: 5200, fuelCapacity: 5000, fuelStart: 2600, ref: 21000 },
  inertia: { roll: 150000, pitch: 280000, yaw: 400000 },
  cg: { empty: 0.25, full: 0.3, ref: 0.28 },
  wing: { area: 61.0, span: 27.05, chord: 2.45, sweep: 2 },

  aero: {
    cl0: 0.28, cd0: 0.03, oswald: 0.8, gearCd: 0.015, speedbrakeCd: 0,
    cm0: 0.08, cmAlpha: -1.3, cmq: -26, cmDe: 1.25,
    clBeta: -0.1, clp: -0.5, clr: 0.1, clDa: 0.22, clDr: 0.012,
    cnBeta: 0.09, cnr: -0.16, cnDr: 0.07, cnDa: -0.03,
    cyBeta: -0.42, cyDr: 0.2,
    propwash: 0.55,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 60 },
  flaps: {
    rate: 2.5, takeoffStage: 1, landingStage: 2,
    stages: [
      { deg: 0, vs: 112, cd: 0 },
      { deg: 15, vs: 98, cd: 0.025, cm: -0.03 },
      { deg: 30, vs: 88, cd: 0.08, cm: -0.07 },
    ],
  },

  gear: {
    retractable: true, transitTime: 8, travel: 0.4, wheelRadius: 0.5, brakeMu: 0.55, steerMax: 60,
    nose: { x: 8.8, y: -2.35, z: 0 },
    mainLeft: { x: -0.9, y: -2.35, z: -2.0 },
    mainRight: { x: -0.9, y: -2.35, z: 2.0 },
  },
  strike: [
    { x: -12.4, y: -0.5, z: 0 }, // tail
    { x: -1.0, y: 0.6, z: -13.5 }, { x: -1.0, y: 0.6, z: 13.5 }, // wing tips
    { x: 0.5, y: -1.5, z: 0 }, { x: 6.5, y: -1.2, z: 0 }, // belly
    { x: 2.9, y: -1.45, z: -4.4 }, { x: 2.9, y: -1.45, z: 4.4 }, // propeller tips
  ],

  engines: {
    spec: {
      type: 'turboprop', power: 1530 * 1000, propEfficiency: 0.83, staticThrust: 25000, propArea: 12.1,
      propTorque: 3500, propYaw: 1600, idle: 0.16, spoolUp: 4, spoolDown: 3,
      fuelFlowIdle: 0.05, fuelFlowMax: 0.2, rpmMax: 100,
    },
    positions: [{ x: 2.9, y: 0.5, z: -4.4 }, { x: 2.9, y: 0.5, z: 4.4 }],
  },

  limits: { vne: 250, mmo: 0.55, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.4, crashLanding: 4.2 },
  speeds: { cruise: 215, vr: 106, vx: 110, vy: 140, vapp: 105, vfe: 170, vno: 235 },

  livery: { regSize: 20, base: '#f3f4f6', stripe: '#0e7c86', stripe2: '#f0a83c', belly: '#d6dadf', wing: '#e9ecef', tip: 0xf0a83c },
  cockpit: {
    eye: { x: 11.2, y: 0.9, z: -0.45 }, panel: 'glass', seats: 4, yoke: 'yoke', width: 1.0,
  },

  geometry: { wingHeight: 1.0, length: 27.2 },
};
