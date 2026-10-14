// Long-haul twin-engine widebody (777 class): enormous fans, six-wheel bogies, 350 seats.
export default {
  id: 'widebody',
  name: 'Atlas 300',
  maker: 'Long-haul widebody',
  blurb: 'Huge twin-engine long-hauler. Slow to turn, heavy on the brakes, serene at altitude.',
  class: 'Airliner',
  registration: 'N300FS',

  mass: { empty: 168000, payload: 42000, fuelCapacity: 145000, fuelStart: 42000, ref: 250000 },
  inertia: { roll: 25000000, pitch: 40000000, yaw: 62000000 },
  cg: { empty: 0.2, full: 0.3, ref: 0.26 },
  wing: { area: 427.8, span: 64.8, chord: 8.5, sweep: 31.6 },

  aero: {
    cl0: 0.2, cd0: 0.0195, oswald: 0.82, gearCd: 0.022, speedbrakeCd: 0.05,
    cm0: 0.04, cmAlpha: -1.6, cmq: -34, cmDe: 1.4,
    clBeta: -0.12, clp: -0.45, clr: 0.1, clDa: 0.33, clDr: 0.01,
    cnBeta: 0.11, cnr: -0.17, cnDr: 0.09, cnDa: -0.03,
    cyBeta: -0.5, cyDr: 0.2,
    machCrit: 0.82, waveDrag: 0.03,
  },
  controls: { elevatorUp: 25, elevatorDown: 20, aileron: 18, rudder: 25, rate: 40 },
  flaps: {
    rate: 2, takeoffStage: 2, landingStage: 3,
    stages: [
      { deg: 0, vs: 165, cd: 0 },
      { deg: 5, vs: 148, cd: 0.012, cm: -0.02 },
      { deg: 20, vs: 130, cd: 0.04, cm: -0.05 },
      { deg: 30, vs: 121, cd: 0.1, cm: -0.08 },
    ],
  },

  gear: {
    retractable: true, transitTime: 12, travel: 0.5, wheelRadius: 0.65, brakeMu: 0.5, steerMax: 65,
    nose: { x: 19.5, y: -5.0, z: 0 },
    mainLeft: { x: -2.2, y: -5.0, z: -5.5 },
    mainRight: { x: -2.2, y: -5.0, z: 5.5 },
  },
  strike: [
    { x: -30.5, y: -0.6, z: 0 }, // tail
    { x: -6.0, y: 3.0, z: -32.0 }, { x: -6.0, y: 3.0, z: 32.0 }, // wing tips
    { x: 0.0, y: -2.3, z: 0 }, { x: 12.0, y: -2.2, z: 0 }, // belly
    { x: 3.0, y: -4.5, z: -10.0 }, { x: 3.0, y: -4.5, z: 10.0 }, // engine nacelles
  ],

  engines: {
    spec: {
      type: 'turbofan', thrust: 400000, altitudeLapse: 0.85, machSlope: -0.5, idle: 0.2,
      spoolUp: 7, spoolDown: 5, fuelFlowIdle: 0.3, fuelFlowMax: 2.4, rpmMax: 100,
    },
    positions: [{ x: 4.5, y: -2.45, z: -10.0 }, { x: 4.5, y: -2.45, z: 10.0 }],
  },

  limits: { vne: 360, mmo: 0.89, nzPos: 2.5, nzNeg: -1.0, hardLanding: 2.2, crashLanding: 3.8 },
  speeds: { cruise: 290, vr: 155, vx: 165, vy: 250, vapp: 148, vfe: 255, vno: 330 },

  livery: { regSize: 20, base: '#f4f5f6', stripe: '#8c1d2f', stripe2: '#d6a84a', belly: '#d5d8dc', wing: '#e6e9ec' },
  cockpit: {
    eye: { x: 31.5, y: 1.0, z: -0.62 }, panel: 'airliner', seats: 350, yoke: 'yoke', width: 1.15,
  },

  fuelDump: 45, // kg/s
  minRunway: 2600, // metres: comfortable takeoff or landing distance at typical weights
  geometry: { wingHeight: -1.8, length: 73.9 },
};
