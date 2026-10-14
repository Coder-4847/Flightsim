import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeLight, makeProp, revolveX, wingGeometry,
} from './builders.js';
import {
  addCabinWindows, addFin, addGlass, addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';

// King Air-style twin turboprop: low wing, T-tail, retractable gear, four-blade props.

const STATIONS = [
  { x: -7.0, w: 0.04, top: 0.1, bottom: 0.1, yc: 0.78, n: 2.2 },
  { x: -6.2, w: 0.12, top: 0.22, bottom: 0.2, yc: 0.66, n: 2.2 },
  { x: -4.8, w: 0.3, top: 0.45, bottom: 0.4, yc: 0.5, n: 2.3 },
  { x: -3.2, w: 0.56, top: 0.7, bottom: 0.66, yc: 0.32, n: 2.4 },
  { x: -1.5, w: 0.74, top: 0.86, bottom: 0.82, yc: 0.22, n: 2.5 },
  { x: 1.0, w: 0.76, top: 0.87, bottom: 0.83, yc: 0.2, n: 2.5 },
  { x: 2.8, w: 0.72, top: 0.83, bottom: 0.78, yc: 0.18, n: 2.4 },
  { x: 4.2, w: 0.62, top: 0.68, bottom: 0.62, yc: 0.08, n: 2.3 },
  { x: 5.4, w: 0.42, top: 0.46, bottom: 0.42, yc: -0.02, n: 2.2 },
  { x: 6.0, w: 0.22, top: 0.26, bottom: 0.24, yc: -0.05, n: 2.1 },
  { x: 6.25, w: 0.05, top: 0.08, bottom: 0.08, yc: -0.05, n: 2 },
];
const WING = [
  { z: 0.75, x: 0.6, y: -0.3, chord: 2.3, t: 0.15, camber: 0.03 },
  { z: 3.2, x: 0.4, y: -0.25, chord: 2.05, t: 0.13, camber: 0.03 },
  { z: 8.3, x: 0.1, y: 0.12, chord: 1.05, t: 0.1, camber: 0.02, twist: -1.5 },
];
const FIN = [
  { z: 0, x: -4.7, y: 0, chord: 2.3, t: 0.1 },
  { z: 2.4, x: -6.0, y: 0, chord: 1.25, t: 0.08 },
];
const STAB = [
  { z: 0.12, x: -6.1, y: 2.9, chord: 1.15, t: 0.09 },
  { z: 2.6, x: -6.45, y: 2.95, chord: 0.75, t: 0.08 },
];

export function buildKingAir(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const fuselage = new THREE.Mesh(fuselageGeometry(STATIONS, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  if (detail > LOW) {
    addGlass(root, mats, [
      { w: 0.012, h: 0.5, x: 3.7, y: 0.66, z: 0.3, rz: 0.72, ry: 0.35 },
      { w: 0.012, h: 0.5, x: 3.7, y: 0.66, z: -0.3, rz: 0.72, ry: -0.35 },
      { w: 0.5, h: 0.3, x: 3.2, y: 0.55, z: 0.655, ry: -0.0 },
      { w: 0.5, h: 0.3, x: 3.2, y: 0.55, z: -0.655, ry: 0 },
    ]);
    addCabinWindows(root, mats, { x0: -2.4, x1: 1.6, count: 6, y: 0.5, z: 0.745 });
    const door = box(0.8, 1.2, 0.012, mats.dark);
    door.position.set(-2.9, 0.2, 0.704);
    root.add(door);
    // Dorsal strakes and antenna.
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.35, 6), mats.dark);
    ant.position.set(-0.4, 1.12, 0);
    root.add(ant);
  }

  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(WING, 0.75, 8.3, { xf0: 0, xf1: 0.68, detail }), mats.wing));
    const flap = controlSurface(WING, 0.75, 5.1, 0.68, mats.wing, detail);
    const aileron = controlSurface(WING, 5.1, 8.3, 0.68, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    addTipLights(g, rig, side, { x: 0.0, y: 0.14, z: 8.3 });

    // Engine nacelle at the spec position.
    const ez = 2.6;
    const nacelle = new THREE.Mesh(revolveX([
      [2.0, 0.26], [1.85, 0.36], [1.3, 0.44], [0.2, 0.5], [-1.0, 0.46], [-2.0, 0.26], [-2.5, 0.06],
    ], detail > LOW ? 24 : 10), mats.skin);
    nacelle.position.set(-0.15, -0.02, ez);
    g.add(nacelle);
    if (detail > LOW) {
      const scoop = new THREE.Mesh(revolveX([[0.95, 0.001], [0.7, 0.14], [0.2, 0.2], [-0.2, 0.001]], 12), mats.intake);
      scoop.position.set(1.0, -0.38, ez);
      scoop.scale.set(1, 1, 1.5);
      g.add(scoop);
      for (const zo of [-0.16, 0.16]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8), mats.steel);
        stack.rotation.z = Math.PI / 2 + 0.2;
        stack.position.set(-0.6, 0.36, ez + zo * 2);
        g.add(stack);
      }
    }
    const prop = makeProp({ blades: 4, radius: 1.18, chord: 0.2, hubRadius: 0.17 }, mats, detail);
    prop.position.set(1.85, -0.02, ez);
    g.add(prop);
    rig.props.push(prop);
    if (side < 0) {
      const beacon = makeLight(0xff2a2a, 0.045, 1.2);
      beacon.position.set(-5.2, 2.0, 0);
      rig.lights.beacon.push(beacon);
      root.add(beacon);
    }
    return g;
  };
  // The engine order is left, right: props.push order must match spec.engines.positions.
  root.add(buildWing(-1), buildWing(1));

  addFin(root, rig, mats, FIN, { baseY: 0.5, height: 2.4, hinge: 0.6, rudderFrom: 0.15, detail });
  addStabilizer(root, rig, mats, STAB, { z0: 0.12, z1: 2.6, hinge: 0.6, detail });
  const tailNav = makeLight(0xffffff, 0.04);
  tailNav.position.set(-7.05, 0.75, 0);
  root.add(tailNav);
  rig.lights.nav.push(tailNav);

  addRetractableGear(root, rig, spec, mats, detail, {
    noseAttachY: -0.55, mainAttachY: -0.35, noseWheelRadius: 0.24, mainWheelRadius: 0.35, mainWheelWidth: 0.22, mainTrack: 0.5, doorOffset: 0.32,
  });
  return { group: root, rig };
}
