import * as THREE from 'three';
import {
  LOW, controlSurface, fuselageGeometry, makeLight, revolveX, wingGeometry,
} from './builders.js';
import {
  addFin, addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';

// F-16-style light fighter: blended wing-body with strakes, ventral intake, bubble canopy.

const STATIONS = [
  { x: -8.0, w: 0.52, top: 0.5, bottom: 0.5, yc: 0.05, n: 2.0 },
  { x: -6.5, w: 0.6, top: 0.62, bottom: 0.55, yc: 0.1, n: 2.1 },
  { x: -4.5, w: 0.85, top: 0.8, bottom: 0.7, yc: 0.15, n: 2.3 },
  { x: -2.0, w: 0.95, top: 0.8, bottom: 0.72, yc: 0.2, n: 2.6 },
  { x: 0.5, w: 0.85, top: 0.8, bottom: 0.6, yc: 0.28, n: 2.5 },
  { x: 2.5, w: 0.75, top: 0.72, bottom: 0.55, yc: 0.3, n: 2.3 },
  { x: 4.5, w: 0.55, top: 0.52, bottom: 0.38, yc: 0.28, n: 2.1 },
  { x: 6.0, w: 0.32, top: 0.3, bottom: 0.26, yc: 0.24, n: 2.0 },
  { x: 7.0, w: 0.05, top: 0.08, bottom: 0.08, yc: 0.2, n: 2 },
];
const WING = [
  { z: 0.7, x: 1.3, y: 0.0, chord: 5.0, t: 0.04, camber: 0.012 },
  { z: 4.725, x: -2.2, y: 0.05, chord: 1.45, t: 0.04, camber: 0.008 },
];
const LEX = [
  { z: 0.55, x: 3.6, y: 0.2, chord: 3.6, t: 0.03 },
  { z: 1.1, x: 1.6, y: 0.1, chord: 0.8, t: 0.03 },
];
const STAB = [
  { z: 0.75, x: -4.6, y: 0.1, chord: 2.4, t: 0.04 },
  { z: 2.75, x: -6.3, y: 0.1, chord: 1.2, t: 0.035 },
];
const FIN = [
  { z: 0, x: -4.5, y: 0, chord: 3.7, t: 0.04 },
  { z: 2.6, x: -6.9, y: 0, chord: 1.5, t: 0.03 },
];

export function buildFighter(spec, mats, detail) {
  const root = new THREE.Group();
  const rig = newRig();
  const fuselage = new THREE.Mesh(fuselageGeometry(STATIONS, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  // Ventral intake with a dark mouth, and the bubble canopy.
  const intake = new THREE.Mesh(revolveX([[3.6, 0.45], [3.3, 0.5], [1.0, 0.62], [-0.6, 0.6]], detail > LOW ? 20 : 10), mats.skin);
  intake.scale.set(1, 0.85, 1.2);
  intake.position.set(0.9, -0.45, 0);
  root.add(intake);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.46, 16), mats.intake);
  mouth.scale.set(1, 0.85, 1.2);
  mouth.position.set(4.52, -0.45, 0);
  mouth.rotation.y = Math.PI / 2;
  if (detail > LOW) root.add(mouth);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.glass);
  canopy.scale.set(1.9, 0.52, 0.5);
  canopy.position.set(3.1, 0.92, 0);
  root.add(canopy);
  if (detail > LOW) {
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 20, Math.PI), mats.dark);
    rail.rotation.y = Math.PI / 2;
    rail.scale.set(1, 1, 1);
    rail.position.set(2.6, 0.82, 0);
    root.add(rail);
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.2, 6), mats.metal);
    pitot.rotation.z = -Math.PI / 2;
    pitot.position.set(7.4, 0.2, 0);
    root.add(pitot);
  }

  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(WING, 0.7, 4.725, { xf0: 0, xf1: 0.7, detail }), mats.wing));
    const flap = controlSurface(WING, 0.7, 2.7, 0.7, mats.wing, detail);
    const aileron = controlSurface(WING, 2.7, 4.7, 0.7, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    g.add(new THREE.Mesh(wingGeometry(LEX, 0.55, 1.1, { detail }), mats.wing));
    if (detail > LOW) {
      // Wingtip missile rail with a training missile.
      const missile = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 10), mats.metal);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 10), mats.metal);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 1.55;
      const fins = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.6), mats.metal);
      fins.position.x = -1.1;
      missile.add(body, nose, fins);
      missile.position.set(-1.4, 0.03, 4.85);
      g.add(missile);
    }
    addTipLights(g, rig, side, { x: -2.0, y: 0.06, z: 4.8 });
    return g;
  };
  root.add(buildWing(-1), buildWing(1));

  addStabilizer(root, rig, mats, STAB, { z0: 0.75, z1: 2.75, hinge: 0.6, detail, allMoving: true });
  addFin(root, rig, mats, FIN, { baseY: 0.55, height: 2.6, hinge: 0.7, rudderFrom: 0.2, detail });
  if (detail > LOW) {
    for (const s of [-1, 1]) { // ventral fins
      const vf = new THREE.Mesh(wingGeometry([
        { z: 0, x: -4.2, y: 0, chord: 1.6, t: 0.03 }, { z: 0.7, x: -4.9, y: 0, chord: 0.9, t: 0.03 },
      ], 0, 0.7, { detail }), mats.wing);
      vf.rotation.x = s * (Math.PI / 2 + 0.35) * -1;
      vf.position.set(0, -0.35, s * 0.55);
      root.add(vf);
    }
  }

  // Exhaust nozzle and afterburner flame.
  const nozzle = new THREE.Mesh(revolveX([[-8.0, 0.5], [-8.5, 0.46], [-8.9, 0.42], [-8.9, 0.36], [-8.5, 0.4], [-8.0, 0.44]], 20), mats.steel);
  nozzle.material = mats.steel;
  root.add(nozzle);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flameGroup = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 5, 14, 1, true), flameMat);
  flame.rotation.z = Math.PI / 2;
  flame.position.x = -2.5;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.2, 3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  core.rotation.z = Math.PI / 2;
  core.position.x = -1.5;
  flameGroup.add(flame, core);
  flameGroup.position.set(-8.9, 0.05, 0);
  flameGroup.visible = false;
  root.add(flameGroup);
  rig.burners.push({ group: flameGroup, mat: flameMat });

  const beacon = makeLight(0xff2a2a, 0.04, 1.2);
  beacon.position.set(-5.0, 0.62, 0);
  root.add(beacon);
  rig.lights.beacon.push(beacon);

  addRetractableGear(root, rig, spec, mats, detail, {
    noseAttachY: -0.5, mainAttachY: -0.4, noseWheelRadius: 0.23, noseWheelWidth: 0.14, noseWheels: 2, mainWheelRadius: 0.31, mainWheelWidth: 0.2, doorOffset: 0.25,
    mainRetractAngle: Math.PI / 2,
  });
  return { group: root, rig };
}
