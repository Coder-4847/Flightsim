
// Cessna 172-style light trainer. The most forgiving aircraft in the roster.
// Numbers are representative of a 180 hp, 1,157 kg (2,550 lb) high-wing single.
export default {
  id: 'cessna172',
  name: 'Skyhawk 172',
  maker: 'Light single-engine prop',
  blurb: 'Forgiving trainer. Slow, stable and easy to land.',
  class: 'Light prop',
  registration: 'N172FS',

  mass: { empty: 767, payload: 150, fuelCapacity: 144, fuelStart: 100, ref: 1157 },
  inertia: { roll: 1285, pitch: 1825, yaw: 2667 },
  cg: { empty: 0.24, full: 0.26, ref: 0.25 }, // fraction of MAC
  wing: { area: 16.2, span: 11.0, chord: 1.49, sweep: 0 },

  aero: {
    cl0: 0.25, cd0: 0.031, oswald: 0.75, gearCd: 0, speedbrakeCd: 0,
    cm0: 0.07, cmAlpha: -0.89, cmq: -12.4, cmDe: 1.28,
    clBeta: -0.089, clp: -0.47, clr: 0.096, clDa: 0.178, clDr: 0.0147,
    cnBeta: 0.0657, cnr: -0.099, cnDr: 0.0657, cnDa: -0.053,
    cyBeta: -0.31, cyDr: 0.187,
    propwash: 0.9,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 20, rudder: 25, rate: 120 },
  flaps: {
    rate: 4, takeoffStage: 0, landingStage: 3,
    // Stall speeds (KCAS) at the reference weight set CLmax for each flap setting.
    stages: [
      { deg: 0, vs: 53, cd: 0 },
      { deg: 10, vs: 51, cd: 0.008, cm: -0.015 },
      { deg: 20, vs: 49, cd: 0.02, cm: -0.03 },
      { deg: 30, vs: 47, cd: 0.035, cm: -0.045 },
    ],
  },

  gear: {
    retractable: false, transitTime: 1, travel: 0.22, wheelRadius: 0.3, brakeMu: 0.5, steerMax: 10,
    nose: { x: 1.35, y: -1.18, z: 0 },
    mainLeft: { x: -0.3, y: -1.18, z: -1.25 },
    mainRight: { x: -0.3, y: -1.18, z: 1.25 },
  },
  strike: [
    { x: -4.6, y: -0.1, z: 0 }, // tail skid
    { x: 0.2, y: 0.9, z: -5.5 }, { x: 0.2, y: 0.9, z: 5.5 }, // wing tips
    { x: 0.3, y: -0.65, z: 0 }, // belly
    { x: 1.9, y: -0.95, z: 0 }, // propeller tip
  ],

  engines: {
    spec: {
      type: 'piston', power: 134 * 1000, propEfficiency: 0.8, staticThrust: 2500, propArea: 2.84,
      propTorque: 110, propYaw: 120, idle: 0.12, spoolUp: 0.8, spoolDown: 0.8,
      fuelFlowIdle: 0.0014, fuelFlowMax: 0.0072, rpmMax: 2700,
    },
    positions: [{ x: 1.9, y: 0, z: 0 }],
  },

  limits: { vne: 163, nzPos: 3.8, nzNeg: -1.5, hardLanding: 2.6, crashLanding: 4.6 },
  speeds: { cruise: 100, vr: 55, vx: 62, vy: 74, vapp: 65, vfe: 85, vno: 129 },

  livery: { base: '#f2f4f6', stripe: '#1f5fa8', stripe2: '#c8362f', belly: '#dfe3e7', wing: '#f2f4f6', tip: 0xf2c230 },
  cockpit: {
    eye: { x: 0.35, y: 0.43, z: -0.3 }, panel: 'steam', seats: 4, yoke: 'yoke',
  },

  geometry: { wingHeight: 0.9, length: 8.3 },
};
