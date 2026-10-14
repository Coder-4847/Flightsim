import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeGearLeg, makeLight, makeProp,
  wingGeometry,
} from './builders.js';

// Cessna 172-style: high wing with struts, single piston engine, fixed tricycle gear.
// Body frame: +X nose, +Y up, +Z right, origin at the CG.

const STATIONS = [
  { x: -6.0, w: 0.02, top: 0.04, bottom: 0.04, yc: 0.5, n: 2.2 },
  { x: -5.0, w: 0.1, top: 0.2, bottom: 0.18, yc: 0.46, n: 2.2 },
  { x: -3.6, w: 0.26, top: 0.4, bottom: 0.38, yc: 0.3, n: 2.3 },
  { x: -2.4, w: 0.46, top: 0.6, bottom: 0.58, yc: 0.14, n: 2.4 },
  { x: -1.2, w: 0.56, top: 0.67, bottom: 0.66, yc: 0.08, n: 2.5 },
  { x: 0.2, w: 0.57, top: 0.68, bottom: 0.67, yc: 0.07, n: 2.5 },
  { x: 1.0, w: 0.54, top: 0.6, bottom: 0.6, yc: 0.0, n: 2.4 },
  { x: 1.9, w: 0.44, top: 0.46, bottom: 0.46, yc: -0.05, n: 2.2 },
  { x: 2.2, w: 0.3, top: 0.32, bottom: 0.32, yc: -0.05, n: 2.1 },
  { x: 2.32, w: 0.08, top: 0.09, bottom: 0.09, yc: -0.05, n: 2 },
];

const WING = [
  { z: 0.5, x: 0.2, y: 0.8, chord: 1.65, t: 0.13, camber: 0.03 },
  { z: 3.2, x: 0.2, y: 0.84, chord: 1.4, t: 0.12, camber: 0.028 },
  { z: 5.5, x: 0.2, y: 0.95, chord: 1.1, t: 0.1, camber: 0.025, twist: -1.5 },
];
const STAB = [
  { z: 0.25, x: -4.55, y: 0.52, chord: 1.0, t: 0.09, camber: 0 },
  { z: 1.75, x: -4.85, y: 0.55, chord: 0.7, t: 0.08, camber: 0 },
];
const FIN = [
  { z: 0, x: -4.45, y: 0, chord: 1.5, t: 0.1, camber: 0 },
  { z: 1.4, x: -5.2, y: 0, chord: 0.78, t: 0.08, camber: 0 },
];

export function buildCessna172(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = {
    ailerons: [], elevators: [], rudders: [], flaps: [], speedbrakes: [], props: [], fans: [], burners: [],
    gear: { fixed: true, nose: null, mains: [], doors: [] },
    lights: { nav: [], strobes: [], beacon: [], landing: [] },
  };

  // Fuselage + glass.
  const fuselage = new THREE.Mesh(fuselageGeometry(STATIONS, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;
  if (detail > LOW) {
    const glass = (w, h, x, y, z, ry, rx = 0) => {
      const g = box(w, h, 0.012, mats.glass);
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, 0, 'YXZ');
      root.add(g);
      return g;
    };
    // Windshield (leans back), side windows, rear window.
    const ws = box(0.012, 0.42, 1.0, mats.glass);
    ws.position.set(0.55, 0.57, 0);
    ws.rotation.z = 0.78;
    root.add(ws);
    glass(1.9, 0.3, -0.5, 0.47, 0.585, 0).scale.set(1, 1, 1);
    glass(1.9, 0.3, -0.5, 0.47, -0.585, 0);
    glass(0.5, 0.26, -1.8, 0.47, 0.5, -0.3); glass(0.5, 0.26, -1.8, 0.47, -0.5, 0.3);
    // Door lines and a roof antenna.
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.28, 6), mats.dark);
    ant.position.set(-1.5, 0.82, 0.1);
    root.add(ant);
    // Cowl intakes and exhaust stubs.
    for (const s of [-1, 1]) {
      const intake = new THREE.Mesh(new THREE.CircleGeometry(0.11, 16), mats.intake);
      intake.position.set(2.16, -0.1, 0.22 * s);
      intake.rotation.y = Math.PI / 2 - 0.15 * s;
      root.add(intake);
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.5, 8), mats.steel);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(1.2, -0.52, 0.2 * s);
      root.add(ex);
    }
  }

  // Wings (right built with +Z span; the left is a mirror).
  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(WING, 0.5, 5.5, { xf0: 0, xf1: 0.7, detail }), mats.wing));
    const flap = controlSurface(WING, 0.5, 2.8, 0.7, mats.wing, detail);
    const aileron = controlSurface(WING, 2.8, 5.5, 0.7, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    // Lift strut from the lower fuselage to mid-wing.
    const strutStart = new THREE.Vector3(-0.2, -0.38, 0.52);
    const strutEnd = new THREE.Vector3(-0.1, 0.84, 2.7);
    const dir = strutEnd.clone().sub(strutStart);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, dir.length(), 0.14), mats.skin);
    strut.position.copy(strutStart).add(strutEnd).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    if (detail > LOW) g.add(strut);
    // Tip lights and fittings.
    const tip = WING[2];
    const nav = makeLight(side < 0 ? 0xff2a2a : 0x2aff5a, 0.05);
    nav.position.set(tip.x - 0.4, tip.y + 0.02, 5.48);
    const strobe = makeLight(0xffffff, 0.05, 1.3);
    strobe.position.set(tip.x - 1.0, tip.y + 0.02, 5.4);
    g.add(nav, strobe);
    rig.lights.nav.push(nav);
    rig.lights.strobes.push(strobe);
    if (side < 0) {
      const landing = makeLight(0xfff3d0, 0.07, 1.1);
      landing.position.set(0.25, 0.88, 2.2);
      g.add(landing);
      rig.lights.landing.push(landing);
      if (detail > LOW) {
        const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), mats.metal);
        pitot.rotation.z = Math.PI / 2;
        pitot.position.set(0.4, 0.5, 2.0);
        g.add(pitot);
      }
    }
    return g;
  };
  root.add(buildWing(1), buildWing(-1));

  // Horizontal tail and elevators.
  const buildStab = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(STAB, 0.25, 1.75, { xf0: 0, xf1: 0.55, detail }), mats.wing));
    const elev = controlSurface(STAB, 0.25, 1.75, 0.55, mats.wing, detail);
    g.add(elev.pivot);
    rig.elevators.push({ pivot: elev.pivot, axis: elev.axis });
    return g;
  };
  root.add(buildStab(1), buildStab(-1));

  // Vertical fin + rudder (built as a wing and stood upright).
  const fin = new THREE.Group();
  fin.rotation.x = -Math.PI / 2;
  fin.position.y = 0.38;
  fin.add(new THREE.Mesh(wingGeometry(FIN, 0, 1.4, { xf0: 0, xf1: 0.62, detail }), mats.wing));
  const rudder = controlSurface(FIN, 0.04, 1.4, 0.62, mats.wing, detail);
  fin.add(rudder.pivot);
  rig.rudders.push({ pivot: rudder.pivot, axis: rudder.axis });
  const beacon = makeLight(0xff2a2a, 0.045, 1.2);
  beacon.position.set(-5.05, 0.0, 1.43);
  fin.add(beacon);
  rig.lights.beacon.push(beacon);
  const tailNav = makeLight(0xffffff, 0.04);
  tailNav.position.set(-5.45, 0, 1.0);
  fin.add(tailNav);
  rig.lights.nav.push(tailNav);
  root.add(fin);

  // Propeller + spinner at the nose.
  const prop = makeProp({ blades: 2, radius: 0.95, chord: 0.13, hubRadius: 0.11 }, mats, detail);
  prop.position.set(2.3, -0.05, 0);
  root.add(prop);
  rig.props.push(prop);

  // Landing gear: steerable nose leg, sprung-steel main legs (fixed).
  const gear = spec.gear;
  const noseLeg = makeGearLeg({ length: 0.75, wheelRadius: 0.25, wheelWidth: 0.1 }, mats, detail);
  noseLeg.position.set(gear.nose.x, gear.nose.y + 0.75, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, wheel: 0 };
  [[gear.mainLeft, -1, 1], [gear.mainRight, 1, 2]].forEach(([pos, side, wheelIndex]) => {
    const leg = new THREE.Group();
    leg.position.set(pos.x, pos.y, pos.z);
    const lower = new THREE.Group();
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.13, detail > LOW ? 24 : 12), mats.rubber);
    tire.rotation.x = Math.PI / 2;
    wheel.add(tire);
    if (detail > LOW) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 14), mats.metal);
      rim.rotation.x = Math.PI / 2;
      wheel.add(rim);
      wheel.add(box(0.26, 0.03, 0.15, mats.dark));
    }
    wheel.position.y = 0.3;
    lower.add(wheel);
    leg.add(lower);
    // Strut from the fuselage side down to the axle.
    // The strut runs from the axle (leg origin, at ground level) up and inboard to the fuselage side.
    const rise = 0.43;
    const inboard = 0.7;
    const strutLen = Math.hypot(rise, inboard);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, strutLen, 0.05), mats.steel);
    strut.position.set(0, 0.3 + rise / 2, -side * inboard / 2);
    strut.rotation.x = -side * Math.atan2(inboard, rise);
    leg.add(strut);
    root.add(leg);
    rig.gear.mains.push({ leg, lower, wheels: [wheel], wheelIndex, side });
  });
  rig.gear.nose.lower = noseLeg.userData.lower;
  rig.gear.nose.wheels = noseLeg.userData.wheels;
  return { group: root, rig };
}
