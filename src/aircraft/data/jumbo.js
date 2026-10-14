// Four-engine double-deck jumbo (747 class). Multi-tank fuel system: burning order shifts the CG.
export default {
  id: 'jumbo',
  name: 'Titan 400',
  maker: 'Four-engine jumbo',
  blurb: 'Four engines, six fuel tanks and a CG that moves as you burn. The big one.',
  class: 'Airliner',
  registration: 'N400FS',

  mass: { empty: 183500, payload: 38000, fuelCapacity: 173000, fuelStart: 80000, ref: 280000 },
  inertia: { roll: 30000000, pitch: 46000000, yaw: 71000000 },
  cg: { empty: 0.27, full: 0.33, ref: 0.3 },
  wing: { area: 541.2, span: 64.4, chord: 8.3, sweep: 37.5 },

  // Fuel tanks. `arm` is the tank CG as a fraction of MAC (the stabiliser tank sits far aft).
  // Engines draw from `order` ascending: centre and trim tank first (feed every engine), then each
  // engine's own main tank. Fuel loads in reverse order, so the mains fill first.
  tanks: [
    { id: 'ctr', name: 'Centre', capacity: 67000, arm: 0.3, order: 0, feeds: null },
    { id: 'stab', name: 'Trim', capacity: 12000, arm: 1.3, order: 1, feeds: null },
    { id: 'm1', name: 'Main 1', capacity: 13000, arm: 0.44, order: 2, feeds: [0] },
    { id: 'm2', name: 'Main 2', capacity: 34000, arm: 0.34, order: 2, feeds: [1] },
    { id: 'm3', name: 'Main 3', capacity: 34000, arm: 0.34, order: 2, feeds: [2] },
    { id: 'm4', name: 'Main 4', capacity: 13000, arm: 0.44, order: 2, feeds: [3] },
  ],

  aero: {
    cl0: 0.18, cd0: 0.02, oswald: 0.8, gearCd: 0.024, speedbrakeCd: 0.05,
    cm0: 0.04, cmAlpha: -1.5, cmq: -36, cmDe: 1.4,
    clBeta: -0.13, clp: -0.45, clr: 0.1, clDa: 0.3, clDr: 0.01,
    cnBeta: 0.12, cnr: -0.18, cnDr: 0.085, cnDa: -0.03,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.85, waveDrag: 0.03,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 36 },
  flaps: {
    rate: 1.8, takeoffStage: 2, landingStage: 3,
    stages: [
      { deg: 0, vs: 160, cd: 0 },
      { deg: 10, vs: 142, cd: 0.015, cm: -0.02 },
      { deg: 20, vs: 130, cd: 0.04, cm: -0.05 },
      { deg: 30, vs: 121, cd: 0.1, cm: -0.08 },
    ],
  },

  gear: {
    retractable: true, transitTime: 14, travel: 0.5, wheelRadius: 0.65, brakeMu: 0.5, steerMax: 60,
    nose: { x: 24.0, y: -5.3, z: 0 },
    mainLeft: { x: -3.0, y: -5.3, z: -5.5 },
    mainRight: { x: -3.0, y: -5.3, z: 5.5 },
  },
  strike: [
    { x: -33.0, y: 0.4, z: 0 }, // tail
    { x: -17.0, y: 5.5, z: -30.0 }, { x: -17.0, y: 5.5, z: 30.0 }, // wing tips (winglets)
    { x: 0.0, y: -2.75, z: 0 }, { x: 14.0, y: -2.6, z: 0 }, // belly
    { x: 2.0, y: -4.6, z: -21.0 }, { x: 2.0, y: -4.6, z: 21.0 }, // outer nacelles
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 250000, altitudeLapse: 0.85, machSlope: -0.5, idle: 0.2,
      spoolUp: 7, spoolDown: 5, fuelFlowIdle: 0.25, fuelFlowMax: 1.8, rpmMax: 100,
    },
    positions: [
      { x: 3.0, y: -3.1, z: -21.0 }, { x: 8.0, y: -3.1, z: -12.0 },
      { x: 8.0, y: -3.1, z: 12.0 }, { x: 3.0, y: -3.1, z: 21.0 },
    ],
  },

  limits: { vne: 365, mmo: 0.92, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.2, crashLanding: 3.8 },
  speeds: { cruise: 290, vr: 160, vx: 170, vy: 250, vapp: 150, vfe: 255, vno: 335 },

  livery: { regSize: 20, base: '#f3f4f5', stripe: '#13407a', stripe2: '#c9a24a', belly: '#d3d7db', wing: '#e4e7ea' },
  cockpit: {
    eye: { x: 33.0, y: 4.1, z: -0.62 }, panel: 'airliner', seats: 400, yoke: 'yoke', width: 1.15,
  },

  minRunway: 3300, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -2.2, length: 70.7 },
};
