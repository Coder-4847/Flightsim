import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeFan, makeLight, revolveX, wingGeometry,
} from './builders.js';
import {
  addCabinWindows, addFin, addGlass, addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';

// Citation-style light jet: low wing, rear fuselage-mounted turbofans, T-tail.

const STATIONS = [
  { x: -8.5, w: 0.05, top: 0.12, bottom: 0.1, yc: 0.75, n: 2.2 },
  { x: -7.6, w: 0.15, top: 0.3, bottom: 0.26, yc: 0.62, n: 2.2 },
  { x: -6.0, w: 0.42, top: 0.55, bottom: 0.5, yc: 0.42, n: 2.3 },
  { x: -4.2, w: 0.66, top: 0.76, bottom: 0.72, yc: 0.28, n: 2.4 },
  { x: -2.0, w: 0.75, top: 0.8, bottom: 0.76, yc: 0.2, n: 2.5 },
  { x: 2.0, w: 0.75, top: 0.8, bottom: 0.76, yc: 0.2, n: 2.5 },
  { x: 4.0, w: 0.68, top: 0.72, bottom: 0.66, yc: 0.16, n: 2.4 },
  { x: 5.6, w: 0.5, top: 0.52, bottom: 0.48, yc: 0.08, n: 2.2 },
  { x: 6.6, w: 0.24, top: 0.28, bottom: 0.24, yc: 0.02, n: 2.1 },
  { x: 7.0, w: 0.05, top: 0.08, bottom: 0.08, yc: 0.0, n: 2 },
];
const WING = [
  { z: 0.75, x: 1.0, y: -0.4, chord: 2.9, t: 0.13, camber: 0.02 },
  { z: 4.2, x: 0.5, y: -0.3, chord: 2.1, t: 0.11, camber: 0.02 },
  { z: 8.1, x: -0.3, y: 0.0, chord: 1.2, t: 0.1, camber: 0.015, twist: -2 },
];
const FIN = [
  { z: 0, x: -7.0, y: 0, chord: 2.6, t: 0.1 },
  { z: 2.1, x: -8.1, y: 0, chord: 1.3, t: 0.08 },
];
const STAB = [
  { z: 0.1, x: -8.2, y: 2.7, chord: 1.3, t: 0.08 },
  { z: 2.6, x: -8.9, y: 2.75, chord: 0.8, t: 0.07 },
];

export function buildCitation(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const fuselage = new THREE.Mesh(fuselageGeometry(STATIONS, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  if (detail > LOW) {
    addGlass(root, mats, [
      { w: 0.012, h: 0.4, x: 5.0, y: 0.55, z: 0.28, rz: 0.55, ry: 0.5 },
      { w: 0.012, h: 0.4, x: 5.0, y: 0.55, z: -0.28, rz: 0.55, ry: -0.5 },
      { w: 0.5, h: 0.26, x: 4.45, y: 0.52, z: 0.69 },
      { w: 0.5, h: 0.26, x: 4.45, y: 0.52, z: -0.69 },
    ]);
    addCabinWindows(root, mats, { x0: -3.4, x1: 2.4, count: 6, y: 0.5, z: 0.752, w: 0.22, h: 0.26 });
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.3, 6), mats.dark);
    ant.position.set(1.2, 1.0, 0);
    root.add(ant);
  }

  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(WING, 0.75, 8.1, { xf0: 0, xf1: 0.7, detail }), mats.wing));
    const flap = controlSurface(WING, 0.75, 4.8, 0.7, mats.wing, detail);
    const aileron = controlSurface(WING, 4.8, 8.0, 0.7, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    // Upper-surface spoiler panel used as the speedbrake.
    if (detail > LOW) {
      const brake = box(0.7, 0.012, 1.5, mats.wing);
      brake.position.set(-0.3, 0, 0.75);
      const pivot = new THREE.Object3D();
      pivot.position.set(0.55 - 0.15, -0.28 + 0.12, 2.0);
      pivot.add(brake);
      g.add(pivot);
      rig.speedbrakes.push({ pivot, axis: new THREE.Vector3(0, 0, 1), angle: 0.9 });
    }
    addTipLights(g, rig, side, { x: -0.1, y: 0.02, z: 8.1 });

    // Rear-mounted engine pod (matches spec.engines.positions: x -3.6, y 0.45, z +/-1.0).
    const pod = new THREE.Group();
    pod.position.set(-3.6, 0.45, 1.15);
    pod.add(new THREE.Mesh(revolveX([
      [1.4, 0.38], [1.25, 0.43], [0.4, 0.47], [-0.8, 0.43], [-1.5, 0.3], [-1.75, 0.27],
    ], detail > LOW ? 24 : 10), mats.skin));
    const lip = new THREE.Mesh(revolveX([[1.4, 0.36], [1.32, 0.33]], 20), mats.intake);
    pod.add(lip);
    const fan = makeFan(0.33, mats, detail);
    fan.position.set(1.32, 0, 0);
    pod.add(fan);
    rig.fans.push(fan);
    const nozzle = new THREE.Mesh(revolveX([[-1.75, 0.27], [-2.0, 0.24], [-2.0, 0.17]], 16), mats.steel);
    pod.add(nozzle);
    g.add(pod);
    // Pylon from the fuselage.
    const pylon = box(1.6, 0.14, 0.4, mats.skin);
    pylon.position.set(-3.4, 0.42, 0.78);
    g.add(pylon);
    return g;
  };
  root.add(buildWing(-1), buildWing(1));
  // Pods are built on both wings' groups; mirror handles the left side. Reorder fans so index 0 = left.

  addFin(root, rig, mats, FIN, { baseY: 0.55, height: 2.1, hinge: 0.62, rudderFrom: 0.1, detail });
  addStabilizer(root, rig, mats, STAB, { z0: 0.1, z1: 2.6, hinge: 0.62, detail });
  const beacon = makeLight(0xff2a2a, 0.045, 1.2);
  beacon.position.set(-5.0, 0.95, 0);
  root.add(beacon);
  rig.lights.beacon.push(beacon);
  const tailNav = makeLight(0xffffff, 0.04);
  tailNav.position.set(-8.6, 2.65, 0);
  root.add(tailNav);
  rig.lights.nav.push(tailNav);

  addRetractableGear(root, rig, spec, mats, detail, {
    noseAttachY: -0.55, mainAttachY: -0.45, noseWheelRadius: 0.22, mainWheelRadius: 0.32, mainWheelWidth: 0.18, doorOffset: 0.3,
  });
  return { group: root, rig };
}
