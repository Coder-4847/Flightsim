import * as THREE from 'three';
import {
  LOW, box, controlSurface, fuselageGeometry, makeLight, makeProp, revolveX, surfacePanel, wingGeometry,
} from './builders.js';
import {
  addFin, addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';
import { bodyAt, fuselageStations, windowGeometry } from './airliner.js';

// High-wing turboprops: the strut-braced single utility turboprop and the twin regional airliner.

const CONFIGS = {
  caravan: {
    body: { noseX: 4.2, tailX: -6.0, R: 0.92, yc: 0.15, noseLen: 3.2, tailLen: 3.8, upsweep: 0.45, noseDrop: 0.05, noseTip: 0.42 },
    wing: {
      sections: [
        { z: 0.8, x: 0.4, y: 0.98, chord: 1.85, t: 0.14, camber: 0.03 },
        { z: 7.94, x: 0.4, y: 1.0, chord: 1.45, t: 0.12, camber: 0.025, twist: -1.5 },
      ],
      flapTo: 4.9, aileronFrom: 5.1, aileronTo: 7.8, hinge: 0.72, z0: 0.85,
    },
    tail: {
      fin: [{ z: 0, x: -3.6, y: 0, chord: 2.6, t: 0.09 }, { z: 2.7, x: -4.9, y: 0, chord: 1.3, t: 0.08 }],
      finBaseY: 0.3, finHeight: 2.7, finHinge: 0.62,
      stab: [{ z: 0.1, x: -4.9, y: 0.55, chord: 1.4, t: 0.09 }, { z: 2.1, x: -5.3, y: 0.55, chord: 0.9, t: 0.08 }],
      stabZ1: 2.1,
    },
    prop: { blades: 3, radius: 1.35, chord: 0.17, hub: 0.2, x: 4.45, y: 0.1, z: 0 },
    struts: true,
    windows: { x0: -2.2, x1: 0.8, count: 4, dy: 0.28, w: 0.22, h: 0.26 },
    windshield: { x: 1.9 },
    gear: {
      fixed: true, noseAttachY: -0.7, mainAttachY: -0.6, noseWheelRadius: 0.27, noseWheelWidth: 0.16, mainWheelRadius: 0.37, mainWheelWidth: 0.2, mainTrack: 0.5,
    },
    pod: true,
    navs: [[-5.9, 0.3]],
  },
  turboprop72: {
    body: { noseX: 13.0, tailX: -14.2, R: 1.43, yc: 0.25, noseLen: 3.8, tailLen: 9.0, upsweep: 0.9 },
    wing: {
      sections: [
        { z: 1.4, x: 1.6, y: 1.2, chord: 3.0, t: 0.15, camber: 0.03 },
        { z: 4.4, x: 1.5, y: 1.2, chord: 2.8, t: 0.14, camber: 0.03 },
        { z: 13.5, x: 1.0, y: 1.35, chord: 1.55, t: 0.11, camber: 0.02, twist: -1.5 },
      ],
      flapTo: 9.3, aileronFrom: 9.6, aileronTo: 13.0, hinge: 0.7, z0: 1.5,
    },
    tail: {
      fin: [{ z: 0, x: -8.6, y: 0, chord: 4.2, t: 0.09 }, { z: 4.0, x: -12.2, y: 0, chord: 1.9, t: 0.08 }],
      finBaseY: 1.0, finHeight: 4.0, finHinge: 0.62,
      stab: [{ z: 0.1, x: -11.6, y: 4.95, chord: 2.0, t: 0.09 }, { z: 3.7, x: -13.0, y: 5.0, chord: 1.1, t: 0.07 }],
      stabZ1: 3.7,
    },
    nacelles: { r: 0.58, len: 4.8, prop: { blades: 6, radius: 1.97, chord: 0.2, hub: 0.24, dx: 0.28 } },
    windows: { x0: -7.5, x1: 9.0, count: 24, dy: 0.3, w: 0.24, h: 0.3 },
    windshield: { x: 11.0 },
    gear: {
      noseAttachY: -1.0, mainAttachY: -0.95, noseWheelRadius: 0.32, noseWheelWidth: 0.18, noseWheels: 2, noseTrack: 0.4,
      mainWheelRadius: 0.48, mainWheelWidth: 0.26, mainWheels: 2, mainTrack: 0.7, mainStrut: 0.06, noDoors: true,
    },
    sponson: { x: -0.9, z: 1.75, len: 3.6 },
    navs: [[-13.9, 1.2]],
    beacon: [[-3.0, 1.9], [3.0, -1.2]],
  },
};

const strut = (a, b, radius, material) => {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 8), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
};

export function buildHighWing(spec, mats, detail, key = spec.id) {
  const c = CONFIGS[key];
  const root = new THREE.Group();
  const rig = newRig();
  const stations = fuselageStations(c.body);
  const fuselage = new THREE.Mesh(fuselageGeometry(stations, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  if (detail > LOW) {
    root.add(new THREE.Mesh(windowGeometry(stations, c.windows, detail), mats.window));
    const yc = bodyAt(stations, c.windshield.x).yc;
    for (const [dx, ang, w, h] of [[0.7, 58, 0.5, 0.34], [0.7, 122, 0.5, 0.34], [-0.1, 30, 0.6, 0.3], [-0.1, 150, 0.6, 0.3]]) {
      const panel = surfacePanel(fuselage, { x: c.windshield.x + dx, ang, yc, w, h, material: mats.glass });
      if (panel) root.add(panel);
    }
  }

  // ---- wing -------------------------------------------------------------------------------------
  const w = c.wing;
  const tip = w.sections[w.sections.length - 1];
  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.z0, tip.z, { xf0: 0, xf1: w.hinge, detail }), mats.wing));
    const flap = controlSurface(w.sections, w.z0, w.flapTo, w.hinge, mats.wing, detail);
    const aileron = controlSurface(w.sections, w.aileronFrom, w.aileronTo, w.hinge, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.flapTo, w.aileronFrom, { xf0: w.hinge, xf1: 1, detail }), mats.wing));
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.aileronTo, tip.z, { xf0: w.hinge, xf1: 1, detail }), mats.wing));
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    addTipLights(g, rig, side, { x: tip.x - tip.chord * 0.5, y: tip.y, z: tip.z });

    if (c.struts && detail > LOW) {
      g.add(strut(new THREE.Vector3(0.0, -0.62, 0.78), new THREE.Vector3(0.1, 0.95, 3.6), 0.035, mats.metal));
      g.add(strut(new THREE.Vector3(0.0, -0.62, 0.78), new THREE.Vector3(0.7, 0.95, 3.6), 0.02, mats.metal));
    }
    return g;
  };
  root.add(buildWing(-1), buildWing(1));

  // ---- propulsion -----------------------------------------------------------------------------------
  if (c.prop) {
    // Single nose-mounted turboprop: the cowl is part of the fuselage; add the prop and a spinner.
    const p = c.prop;
    const prop = makeProp({ blades: p.blades, radius: p.radius, chord: p.chord, hubRadius: p.hub }, mats, detail);
    prop.position.set(p.x, p.y, p.z);
    root.add(prop);
    rig.props.push(prop);
    if (detail > LOW) {
      // Exhaust stacks on the cowl.
      for (const s of [-1, 1]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), mats.steel);
        stack.rotation.z = Math.PI / 2 + 0.3;
        stack.position.set(2.6, 0.45, s * 0.55);
        root.add(stack);
      }
      const intake = new THREE.Mesh(revolveX([[3.9, 0.27], [3.7, 0.3], [3.5, 0.28]], 16), mats.intake);
      intake.scale.set(1, 0.7, 1.4);
      intake.position.set(0.0, -0.25, 0);
      root.add(intake);
    }
  }
  if (c.pod && detail > LOW) {
    const pod = new THREE.Mesh(revolveX([[2.4, 0.04], [2.0, 0.28], [0.8, 0.4], [-1.8, 0.4], [-2.8, 0.2], [-3.2, 0.04]], 20), mats.wing);
    pod.scale.set(1, 0.75, 1.1);
    pod.position.set(0, -0.78, 0);
    root.add(pod);
  }
  if (c.nacelles) {
    const n = c.nacelles;
    spec.engines.positions.forEach((pos) => {
      const g = new THREE.Group();
      g.position.set(pos.x - n.len * 0.38 - 0.0, pos.y, pos.z);
      g.add(new THREE.Mesh(revolveX([
        [n.len * 0.5, 0.18 * n.r], [n.len * 0.44, 0.72 * n.r], [n.len * 0.32, n.r], [0, 0.96 * n.r], [-n.len * 0.3, 0.9 * n.r], [-n.len * 0.5, 0.35 * n.r],
      ], detail > LOW ? 24 : 10), mats.wing));
      if (detail > LOW) {
        const scoop = new THREE.Mesh(revolveX([[n.len * 0.3, 0.001], [n.len * 0.18, n.r * 0.3], [0, 0.001]], 12), mats.intake);
        scoop.scale.set(1, 1, 1.4);
        scoop.position.set(n.len * 0.12, -n.r * 0.85, 0);
        g.add(scoop);
      }
      root.add(g);
      const prop = makeProp({ blades: n.prop.blades, radius: n.prop.radius, chord: n.prop.chord, hubRadius: n.prop.hub }, mats, detail);
      prop.position.set(pos.x + n.prop.dx, pos.y, pos.z);
      root.add(prop);
      rig.props.push(prop);
    });
  }
  if (c.sponson && detail > LOW) {
    for (const s of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mats.wing);
      sp.scale.set(c.sponson.len / 2, 0.55, 0.5);
      sp.position.set(c.sponson.x, -0.85, s * c.sponson.z);
      root.add(sp);
    }
  }

  // ---- tail ----------------------------------------------------------------------------------------------
  const t = c.tail;
  addFin(root, rig, mats, t.fin, { baseY: t.finBaseY, height: t.finHeight, hinge: t.finHinge, rudderFrom: 0.15, detail, material: c.nacelles ? mats.accent : mats.wing });
  addStabilizer(root, rig, mats, t.stab, { z0: t.stab[0].z, z1: t.stabZ1, hinge: 0.62, detail });

  for (const [x, y] of c.navs ?? []) {
    const nav = makeLight(0xffffff, 0.05);
    nav.position.set(x, y, 0);
    root.add(nav);
    rig.lights.nav.push(nav);
  }
  for (const [x, y] of c.beacon ?? [[-2.0, 1.15]]) {
    const beacon = makeLight(0xff2a2a, 0.05, 1.3);
    beacon.position.set(x, y, 0);
    root.add(beacon);
    rig.lights.beacon.push(beacon);
  }
  const landing = makeLight(0xfff3d0, 0.07, 1.1);
  landing.position.set(c.nacelles ? 2.6 : 0.5, c.nacelles ? 1.1 : 0.98, c.nacelles ? 4.4 : 3.2);
  root.add(landing);
  rig.lights.landing.push(landing);

  if (c.gear.fixed) {
    // Fixed tricycle gear: legs hang permanently, with wheel fairings omitted for a utility look.
    addRetractableGear(root, rig, spec, mats, detail, { ...c.gear, noDoors: true });
    rig.gear.fixed = true;
  } else {
    addRetractableGear(root, rig, spec, mats, detail, c.gear);
  }
  void box;
  return { group: root, rig };
}

export const buildCaravan = (spec, mats, detail) => buildHighWing(spec, mats, detail, 'caravan');
export const buildTurboprop72 = (spec, mats, detail) => buildHighWing(spec, mats, detail, 'turboprop72');
