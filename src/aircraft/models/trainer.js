import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeLight, revolveX, wingGeometry,
} from './builders.js';
import {
  addFin, addRetractableGear, addStabilizer, newRig,
} from './common.js';

// L-39-style jet trainer: mid wing with tip tanks, side intakes, tandem bubble canopy.

const STATIONS = [
  { x: -6.1, w: 0.1, top: 0.1, bottom: 0.1, yc: 0.15, n: 2 },
  { x: -5.2, w: 0.2, top: 0.22, bottom: 0.2, yc: 0.15, n: 2.1 },
  { x: -3.4, w: 0.4, top: 0.46, bottom: 0.36, yc: 0.1, n: 2.2 },
  { x: -1.2, w: 0.55, top: 0.62, bottom: 0.46, yc: 0.08, n: 2.3 },
  { x: 0.8, w: 0.62, top: 0.62, bottom: 0.46, yc: 0.08, n: 2.3 },
  { x: 2.6, w: 0.52, top: 0.52, bottom: 0.38, yc: 0.06, n: 2.2 },
  { x: 4.2, w: 0.38, top: 0.38, bottom: 0.3, yc: 0.0, n: 2.1 },
  { x: 5.4, w: 0.2, top: 0.2, bottom: 0.18, yc: -0.04, n: 2.0 },
  { x: 6.05, w: 0.04, top: 0.05, bottom: 0.05, yc: -0.06, n: 2 },
];
const WING = [
  { z: 0.6, x: 0.95, y: -0.12, chord: 3.0, t: 0.14, camber: 0.02 },
  { z: 4.35, x: 0.55, y: -0.05, chord: 1.4, t: 0.1, camber: 0.015, twist: -1 },
];
const FIN = [
  { z: 0, x: -3.6, y: 0, chord: 2.6, t: 0.09 },
  { z: 2.0, x: -4.9, y: 0, chord: 1.2, t: 0.07 },
];
const STAB = [
  { z: 0.1, x: -4.8, y: 0.3, chord: 1.5, t: 0.08 },
  { z: 1.9, x: -5.4, y: 0.35, chord: 0.8, t: 0.07 },
];

export function buildTrainer(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const fuselage = new THREE.Mesh(fuselageGeometry(STATIONS, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  // Tandem canopy: two bubbles under one frame.
  for (const [x, scale] of [[2.7, 0.6], [1.0, 0.62]]) {
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.glass);
    bubble.scale.set(scale * 1.15, 0.42, 0.42);
    bubble.position.set(x, 0.62, 0);
    root.add(bubble);
  }
  if (detail > LOW) {
    const frame = box(0.05, 0.1, 0.84, mats.dark);
    frame.position.set(1.85, 0.7, 0);
    root.add(frame);
    // Side intakes at the wing roots.
    for (const s of [-1, 1]) {
      const intake = new THREE.Mesh(revolveX([[1.1, 0.26], [0.9, 0.3], [0.2, 0.3], [-0.6, 0.24]], 18), mats.skin);
      intake.scale.set(1, 1.1, 0.8);
      intake.position.set(0.6, 0.0, s * 0.75);
      root.add(intake);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.27, 16), mats.intake);
      mouth.scale.set(0.8, 1.1, 1);
      mouth.position.set(1.72, 0.0, s * 0.75);
      mouth.rotation.y = Math.PI / 2;
      root.add(mouth);
    }
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.9, 6), mats.metal);
    pitot.rotation.z = -Math.PI / 2;
    pitot.position.set(6.4, -0.05, 0);
    root.add(pitot);
  }

  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(WING, 0.6, 4.35, { xf0: 0, xf1: 0.7, detail }), mats.wing));
    const flap = controlSurface(WING, 0.6, 2.4, 0.7, mats.wing, detail);
    const aileron = controlSurface(WING, 2.45, 4.3, 0.7, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    // Tip tank.
    const tank = new THREE.Mesh(revolveX([[1.45, 0.02], [1.2, 0.18], [0.6, 0.27], [-0.4, 0.27], [-1.2, 0.14], [-1.5, 0.02]], 18), mats.skin);
    tank.position.set(-0.05, -0.02, 4.65);
    g.add(tank);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.02), mats.accent);
    fin.position.set(-0.9, 0.0, 4.65);
    g.add(fin);
    const nav = makeLight(side < 0 ? 0xff2a2a : 0x2aff5a, 0.05);
    nav.position.set(0.15, 0.0, 4.95);
    g.add(nav);
    rig.lights.nav.push(nav);
    const strobe = makeLight(0xffffff, 0.05, 1.3);
    strobe.position.set(-1.45, 0.0, 4.65);
    g.add(strobe);
    rig.lights.strobes.push(strobe);
    // Speedbrake panel on the lower wing, hinged at its front edge.
    if (detail > LOW) {
      const brake = box(0.5, 0.012, 0.9, mats.wing);
      brake.position.set(-0.25, 0, 0.45);
      const pivot = new THREE.Object3D();
      pivot.position.set(0.0, -0.24, 1.3);
      pivot.add(brake);
      g.add(pivot);
      rig.speedbrakes.push({ pivot, axis: new THREE.Vector3(0, 0, 1), angle: -1.0 });
    }
    return g;
  };
  root.add(buildWing(-1), buildWing(1));

  addFin(root, rig, mats, FIN, { baseY: 0.45, height: 2.0, hinge: 0.62, rudderFrom: 0.1, detail });
  addStabilizer(root, rig, mats, STAB, { z0: 0.1, z1: 1.9, hinge: 0.58, detail });

  // Exhaust.
  root.add(new THREE.Mesh(revolveX([[-5.7, 0.18], [-6.1, 0.17], [-6.25, 0.14]], 14), mats.steel));
  const beacon = makeLight(0xff2a2a, 0.045, 1.2);
  beacon.position.set(-2.5, 0.75, 0);
  root.add(beacon);
  rig.lights.beacon.push(beacon);
  const tailNav = makeLight(0xffffff, 0.04);
  tailNav.position.set(-5.0, 2.4, 0);
  root.add(tailNav);
  rig.lights.nav.push(tailNav);

  addRetractableGear(root, rig, spec, mats, detail, {
    noseAttachY: -0.35, mainAttachY: -0.3, noseWheelRadius: 0.2, noseWheelWidth: 0.12, mainWheelRadius: 0.33, mainWheelWidth: 0.16, mainTrack: 0.4, doorOffset: 0.22,
  });
  return { group: root, rig };
}
