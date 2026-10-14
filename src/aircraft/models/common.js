import * as THREE from 'three';
import {
  LOW, box, controlSurface, makeGearLeg, makeLight, wingGeometry,
} from './builders.js';

// Shared assemblies used by several aircraft models.

export function newRig() {
  return {
    ailerons: [], elevators: [], rudders: [], flaps: [], speedbrakes: [], props: [], fans: [], burners: [],
    gear: { fixed: false, nose: null, mains: [], doors: [] },
    lights: { nav: [], strobes: [], beacon: [], landing: [] },
  };
}

/** Tricycle retractable gear with doors. Positions come from the aircraft data (contact points). */
export function addRetractableGear(root, rig, spec, mats, detail, o) {
  const g = spec.gear;
  const noseLen = o.noseAttachY - g.nose.y;
  const noseLeg = makeGearLeg({
    length: noseLen, wheelRadius: o.noseWheelRadius ?? 0.25, wheelWidth: o.noseWheelWidth ?? 0.16, wheels: o.noseWheels ?? 1, track: 0.3,
  }, mats, detail);
  noseLeg.position.set(g.nose.x, o.noseAttachY, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  if (detail > LOW) {
    // Taxi/landing light on the nose leg.
    const light = makeLight(0xfff3d0, 0.07, 1.1);
    light.position.set(0.12, -noseLen * 0.55, 0);
    noseLeg.add(light);
    rig.lights.landing.push(light);
    const link = box(0.04, noseLen * 0.35, 0.05, mats.steel);
    link.position.set(-0.1, -noseLen * 0.3, 0);
    noseLeg.add(link);
  }
  [[g.mainLeft, -1, 1], [g.mainRight, 1, 2]].forEach(([pos, side, wheelIndex]) => {
    const len = o.mainAttachY - pos.y;
    const leg = makeGearLeg({
      length: len, wheelRadius: o.mainWheelRadius ?? 0.33, wheelWidth: o.mainWheelWidth ?? 0.2, wheels: o.mainWheels ?? 1,
      track: o.mainTrack ?? 0.5, strutRadius: o.mainStrut ?? 0.045, axles: o.mainAxles ?? 1, axleSpacing: o.mainAxleSpacing ?? 1.2,
    }, mats, detail);
    leg.position.set(pos.x, o.mainAttachY, pos.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: o.mainRetractAngle ?? Math.PI / 2 });
    if (detail > LOW && !o.noDoors) {
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), mats.steel);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(0, -len + (o.mainWheelRadius ?? 0.33), side * 0.12);
      leg.userData.lower.add(brake);
      // Main gear door: hinged on the outboard edge, opens while the gear is in transit.
      const door = new THREE.Object3D();
      door.position.set(pos.x, o.mainAttachY + 0.02, pos.z + side * (o.doorOffset ?? 0.28));
      const plate = box(0.9, 0.018, 0.34, mats.skin);
      plate.position.set(0, 0, -side * 0.17);
      door.add(plate);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: side * 1.15 });
    }
  });
  // Extra body-gear legs (jumbo): follow the nearest main strut's compression.
  for (const extra of o.extraMains ?? []) {
    const side = Math.sign(extra.z);
    const len = o.mainAttachY - g.mainLeft.y;
    const leg = makeGearLeg({
      length: len, wheelRadius: o.mainWheelRadius ?? 0.33, wheelWidth: o.mainWheelWidth ?? 0.2, wheels: o.mainWheels ?? 1,
      track: o.mainTrack ?? 0.5, strutRadius: o.mainStrut ?? 0.045, axles: o.mainAxles ?? 1, axleSpacing: o.mainAxleSpacing ?? 1.2,
    }, mats, detail);
    leg.position.set(extra.x, o.mainAttachY, extra.z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex: side < 0 ? 1 : 2, side, retractAngle: o.mainRetractAngle ?? Math.PI / 2 });
  }
  if (detail > LOW && !o.noDoors) {
    for (const s of [-1, 1]) {
      const door = new THREE.Object3D();
      door.position.set(g.nose.x, o.noseAttachY + 0.03, s * 0.18);
      const plate = box(0.7, 0.016, 0.2, mats.skin);
      plate.position.set(0, 0, -s * 0.1);
      door.add(plate);
      root.add(door);
      rig.gear.doors.push({ pivot: door, axis: new THREE.Vector3(1, 0, 0), open: s * 1.2 });
    }
  }
}

/** Glass panels: a list of {w, h, x, y, z, ry, rz}. */
export function addGlass(root, mats, panels) {
  for (const p of panels) {
    const m = box(p.w, p.h, 0.012, mats.glass);
    m.position.set(p.x, p.y, p.z);
    m.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
    root.add(m);
  }
}

/** Row of cabin windows (rounded rectangles as thin dark boxes) on both fuselage sides. */
export function addCabinWindows(root, mats, { x0, x1, count, y, z, w = 0.26, h = 0.3 }) {
  for (const s of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const x = x0 + ((x1 - x0) * i) / Math.max(1, count - 1);
      const m = box(w, h, 0.012, mats.glass);
      m.position.set(x, y, z * s);
      root.add(m);
    }
  }
}

/** Vertical stabiliser + rudder built as an upright wing. Returns the pivot rig entry. */
export function addFin(root, rig, mats, sections, { baseY, height, hinge, rudderFrom = 0.1, detail, material = mats.wing }) {
  const fin = new THREE.Group();
  fin.rotation.x = -Math.PI / 2;
  fin.position.y = baseY;
  fin.add(new THREE.Mesh(wingGeometry(sections, 0, height, { xf0: 0, xf1: hinge, detail }), material));
  const rudder = controlSurface(sections, rudderFrom, height, hinge, material, detail);
  fin.add(rudder.pivot);
  rig.rudders.push({ pivot: rudder.pivot, axis: rudder.axis });
  root.add(fin);
  return fin;
}

/** Horizontal stabiliser pair with elevators (or `allMoving` stabilators). */
export function addStabilizer(root, rig, mats, sections, { z0, z1, hinge, detail, allMoving = false }) {
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    if (allMoving) {
      const geo = wingGeometry(sections, z0, z1, { xf0: 0, xf1: 1, detail });
      const pivotX = sections[0].x - 0.3 * sections[0].chord;
      geo.translate(-pivotX, -sections[0].y, 0);
      const pivot = new THREE.Object3D();
      pivot.position.set(pivotX, sections[0].y, 0);
      pivot.add(new THREE.Mesh(geo, mats.wing));
      g.add(pivot);
      rig.elevators.push({ pivot, axis: new THREE.Vector3(0, 0, 1) });
    } else {
      g.add(new THREE.Mesh(wingGeometry(sections, z0, z1, { xf0: 0, xf1: hinge, detail }), mats.wing));
      const elev = controlSurface(sections, z0, z1, hinge, mats.wing, detail);
      g.add(elev.pivot);
      rig.elevators.push({ pivot: elev.pivot, axis: elev.axis });
    }
    root.add(g);
  }
}

/** Wing tip navigation + strobe lights. `tip`: {x, y, z} of the right tip trailing/leading area. */
export function addTipLights(group, rig, side, tip) {
  const nav = makeLight(side < 0 ? 0xff2a2a : 0x2aff5a, 0.05);
  nav.position.set(tip.x, tip.y, tip.z);
  const strobe = makeLight(0xffffff, 0.05, 1.3);
  strobe.position.set(tip.x - 0.5, tip.y, tip.z - 0.05);
  group.add(nav, strobe);
  rig.lights.nav.push(nav);
  rig.lights.strobes.push(strobe);
}
