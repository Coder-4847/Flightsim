import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeLight, revolveX, wingGeometry,
} from './builders.js';
import {
  addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';

// Twin-engine fighters: a canted-twin-fin carrier fighter and a large long-range heavy.

const CONFIGS = {
  hornet: {
    stations: [
      { x: -6.4, w: 0.8, top: 0.55, bottom: 0.5, yc: 0.0, n: 2.2 },
      { x: -4.5, w: 1.1, top: 0.68, bottom: 0.62, yc: 0.05, n: 2.5 },
      { x: -1.5, w: 1.2, top: 0.74, bottom: 0.66, yc: 0.1, n: 2.6 },
      { x: 1.5, w: 1.1, top: 0.76, bottom: 0.62, yc: 0.12, n: 2.4 },
      { x: 3.5, w: 0.8, top: 0.62, bottom: 0.5, yc: 0.1, n: 2.2 },
      { x: 5.5, w: 0.52, top: 0.42, bottom: 0.36, yc: 0.04, n: 2.1 },
      { x: 7.0, w: 0.28, top: 0.24, bottom: 0.22, yc: -0.02, n: 2.0 },
      { x: 8.1, w: 0.04, top: 0.05, bottom: 0.05, yc: -0.06, n: 2 },
    ],
    wing: [
      { z: 1.0, x: 1.7, y: -0.1, chord: 4.6, t: 0.05, camber: 0.012 },
      { z: 5.715, x: -1.2, y: 0.05, chord: 1.5, t: 0.04, camber: 0.008 },
    ],
    lex: [{ z: 0.7, x: 5.6, y: 0.1, chord: 4.0, t: 0.03 }, { z: 1.25, x: 2.2, y: 0.05, chord: 0.8, t: 0.03 }],
    flapTo: 3.4, aileronFrom: 3.5, aileronTo: 5.6, z0: 1.0,
    fin: { base: { z: 1.1, y: 0.7 }, height: 2.5, cant: 0.35, sections: [{ z: 0, x: -3.4, y: 0, chord: 3.6, t: 0.04 }, { z: 2.5, x: -5.5, y: 0, chord: 1.4, t: 0.03 }] },
    stab: { sections: [{ z: 0.9, x: -4.6, y: 0.1, chord: 2.7, t: 0.04 }, { z: 2.8, x: -6.2, y: 0.1, chord: 1.2, t: 0.03 }], z0: 0.9, z1: 2.8 },
    canopy: { x: 3.7, y: 0.98, scale: [1.8, 0.5, 0.5] },
    intakes: { x: 1.9, y: -0.15, z: 1.05, len: 2.4, h: 0.5 },
    engines: { r: 0.5, len: 3.6, x: -6.6 },
    missile: { x: -0.7, z: 5.85 },
    nose: 0.3,
    tipLight: { x: -1.1, y: 0.05, z: 5.7 },
    gear: { noseAttachY: -0.6, mainAttachY: -0.45, noseWheelRadius: 0.27, noseWheelWidth: 0.14, noseWheels: 2, mainWheelRadius: 0.35, mainWheelWidth: 0.22, doorOffset: 0.3 },
    beacon: [-5.0, 0.8],
  },
  heavyfighter: {
    stations: [
      { x: -6.5, w: 0.5, top: 0.5, bottom: 0.45, yc: 0.1, n: 2.2 },
      { x: -4.5, w: 1.0, top: 0.72, bottom: 0.6, yc: 0.2, n: 2.5 },
      { x: -1.5, w: 1.6, top: 0.9, bottom: 0.7, yc: 0.3, n: 2.8 },
      { x: 1.5, w: 1.7, top: 0.95, bottom: 0.65, yc: 0.35, n: 2.8 },
      { x: 4.0, w: 1.2, top: 0.82, bottom: 0.52, yc: 0.3, n: 2.4 },
      { x: 6.5, w: 0.62, top: 0.5, bottom: 0.38, yc: 0.22, n: 2.1 },
      { x: 8.5, w: 0.32, top: 0.28, bottom: 0.26, yc: 0.15, n: 2.0 },
      { x: 10.2, w: 0.05, top: 0.06, bottom: 0.06, yc: 0.1, n: 2 },
    ],
    wing: [
      { z: 1.7, x: 3.4, y: 0.0, chord: 8.2, t: 0.05, camber: 0.012 },
      { z: 7.35, x: -1.8, y: 0.15, chord: 1.7, t: 0.04, camber: 0.008 },
    ],
    lex: [{ z: 0.6, x: 8.0, y: 0.25, chord: 5.5, t: 0.03 }, { z: 1.85, x: 3.6, y: 0.1, chord: 1.0, t: 0.03 }],
    flapTo: 4.2, aileronFrom: 4.3, aileronTo: 7.2, z0: 1.7,
    fin: { base: { z: 2.45, y: 0.8 }, height: 3.6, cant: 0.0, sections: [{ z: 0, x: -3.8, y: 0, chord: 4.6, t: 0.04 }, { z: 3.6, x: -7.2, y: 0, chord: 1.7, t: 0.03 }] },
    stab: { sections: [{ z: 1.7, x: -6.0, y: 0.2, chord: 3.3, t: 0.04 }, { z: 4.5, x: -8.4, y: 0.25, chord: 1.4, t: 0.03 }], z0: 1.7, z1: 4.5 },
    canopy: { x: 5.2, y: 1.28, scale: [2.5, 0.58, 0.55] },
    intakes: { x: 3.6, y: -0.5, z: 1.35, len: 3.6, h: 0.75 },
    engines: { r: 0.72, len: 4.4, x: -6.6, z: 1.45 },
    missile: { x: -2.5, z: 7.5 },
    nose: 0.3,
    tipLight: { x: -2.2, y: 0.15, z: 7.4 },
    gear: { noseAttachY: -0.7, mainAttachY: -0.55, noseWheelRadius: 0.28, noseWheelWidth: 0.16, noseWheels: 2, mainWheelRadius: 0.4, mainWheelWidth: 0.26, doorOffset: 0.35 },
    beacon: [-7.0, 1.0],
    stinger: { x: -9.2, len: 3.2 },
  },
};

export function buildTwinFighter(spec, mats, detail, key = spec.id) {
  const c = CONFIGS[key];
  const root = new THREE.Group();
  const rig = newRig();
  const fuselage = new THREE.Mesh(fuselageGeometry(c.stations, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.glass);
  canopy.scale.set(...c.canopy.scale);
  canopy.position.set(c.canopy.x, c.canopy.y, 0);
  root.add(canopy);

  // Engine nacelles with nozzles at the engine positions in the data.
  const eng = c.engines;
  spec.engines.positions.forEach((pos) => {
    const pod = new THREE.Group();
    pod.position.set(pos.x, pos.y, pos.z);
    pod.add(new THREE.Mesh(revolveX([[0.6, eng.r * 0.92], [0.2, eng.r], [-0.6, eng.r * 0.95], [-eng.len * 0.45, eng.r * 0.85]], detail > LOW ? 22 : 10), mats.skin));
    const nozzle = new THREE.Mesh(revolveX([[-eng.len * 0.45, eng.r * 0.78], [-eng.len * 0.62, eng.r * 0.72], [-eng.len * 0.78, eng.r * 0.62], [-eng.len * 0.78, eng.r * 0.52], [-eng.len * 0.6, eng.r * 0.6]], 18), mats.steel);
    pod.add(nozzle);
    root.add(pod);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const flameGroup = new THREE.Group();
    const flame = new THREE.Mesh(new THREE.ConeGeometry(eng.r * 0.55, 4.2, 14, 1, true), flameMat);
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -2.1;
    const core = new THREE.Mesh(new THREE.ConeGeometry(eng.r * 0.3, 2.4, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    core.rotation.z = Math.PI / 2;
    core.position.x = -1.2;
    flameGroup.add(flame, core);
    flameGroup.position.set(pos.x - eng.len * 0.78, pos.y, pos.z);
    flameGroup.visible = false;
    root.add(flameGroup);
    rig.burners.push({ group: flameGroup, mat: flameMat });
  });
  if (c.stinger) {
    const st = new THREE.Mesh(revolveX([[c.stinger.x + c.stinger.len, 0.28], [c.stinger.x + c.stinger.len * 0.5, 0.2], [c.stinger.x, 0.05]], 12), mats.skin);
    root.add(st);
  }

  // Intakes: dark rectangular mouths under the leading-edge extensions.
  const it = c.intakes;
  for (const s of [-1, 1]) {
    const duct = new THREE.Mesh(new THREE.BoxGeometry(it.len, it.h, it.h * 1.1), mats.skin);
    duct.position.set(it.x - it.len / 2 + 0.2, it.y, s * it.z);
    root.add(duct);
    if (detail > LOW) {
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(it.h * 1.0, it.h * 0.9), mats.intake);
      mouth.rotation.y = Math.PI / 2;
      mouth.position.set(it.x + it.len * 0.0 + 0.21, it.y, s * it.z);
      root.add(mouth);
    }
  }
  if (detail > LOW) {
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.0, 6), mats.metal);
    pitot.rotation.z = -Math.PI / 2;
    pitot.position.set(c.stations[c.stations.length - 1].x + 0.4, -0.05, 0);
    root.add(pitot);
  }

  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    const tipZ = c.wing[c.wing.length - 1].z;
    g.add(new THREE.Mesh(wingGeometry(c.wing, c.z0, tipZ, { xf0: 0, xf1: 0.7, detail }), mats.wing));
    const flap = controlSurface(c.wing, c.z0, c.flapTo, 0.7, mats.wing, detail);
    const aileron = controlSurface(c.wing, c.aileronFrom, c.aileronTo, 0.7, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    g.add(new THREE.Mesh(wingGeometry(c.lex, c.lex[0].z, c.lex[1].z, { detail }), mats.wing));
    if (detail > LOW) {
      const m = c.missile;
      const missile = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 10), mats.metal);
      body.rotation.z = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 10), mats.metal);
      nose.rotation.z = -Math.PI / 2;
      nose.position.x = 1.55;
      const fins = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.6), mats.metal);
      fins.position.x = -1.1;
      missile.add(body, nose, fins);
      missile.position.set(m.x, 0.03, m.z);
      g.add(missile);
    }
    addTipLights(g, rig, side, c.tipLight);
    return g;
  };
  root.add(buildWing(-1), buildWing(1));

  // Twin fins (canted on the carrier fighter), one rudder each. Order matters only for symmetry.
  for (const side of [-1, 1]) {
    const f = c.fin;
    const holder = new THREE.Group();
    holder.position.set(0, f.base.y, side * f.base.z);
    holder.rotation.x = side * f.cant; // lean outward
    const fin = new THREE.Group();
    fin.rotation.x = -Math.PI / 2;
    fin.add(new THREE.Mesh(wingGeometry(f.sections, 0, f.height, { xf0: 0, xf1: 0.68, detail }), mats.wing));
    const rudder = controlSurface(f.sections, 0.3, f.height, 0.68, mats.wing, detail);
    fin.add(rudder.pivot);
    rig.rudders.push({ pivot: rudder.pivot, axis: rudder.axis });
    holder.add(fin);
    root.add(holder);
  }
  addStabilizer(root, rig, mats, c.stab.sections, { z0: c.stab.z0, z1: c.stab.z1, hinge: 0.6, detail, allMoving: true });

  const beacon = makeLight(0xff2a2a, 0.04, 1.2);
  beacon.position.set(c.beacon[0], c.beacon[1], 0);
  root.add(beacon);
  rig.lights.beacon.push(beacon);

  addRetractableGear(root, rig, spec, mats, detail, c.gear);
  void box;
  return { group: root, rig };
}

export const buildHornet = (spec, mats, detail) => buildTwinFighter(spec, mats, detail, 'hornet');
export const buildHeavyFighter = (spec, mats, detail) => buildTwinFighter(spec, mats, detail, 'heavyfighter');
