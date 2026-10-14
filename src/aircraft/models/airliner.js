import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  LOW, MEDIUM, box, controlSurface, fuselageGeometry, makeFan, makeLight, revolveX, sectionAt, surfacePanel, wingGeometry,
} from './builders.js';
import {
  addFin, addRetractableGear, addStabilizer, addTipLights, newRig,
} from './common.js';

// Parametric transport / business-jet builder. Every dimension lives in a config table below, in
// the body frame (origin at the CG, +X forward, +Y up, +Z right), so each aircraft is data.

// ---- fuselage ---------------------------------------------------------------------------------
export function fuselageStations(c) {
  const { R, yc } = c;
  const st = [];
  const xb = c.tailX + c.tailLen;
  for (const [s, f] of [[0, 0.07], [0.2, 0.3], [0.45, 0.6], [0.72, 0.86], [1, 1]]) {
    st.push({
      x: c.tailX + (xb - c.tailX) * s, w: R * f * (c.widthScale ?? 1), top: R * f, bottom: R * f,
      yc: yc + c.upsweep * (1 - s) ** 1.6, n: s < 0.5 ? 2.2 : 2.05,
    });
  }
  const xn = c.noseX - c.noseLen;
  st.push({ x: (xb + xn) / 2, w: R * (c.widthScale ?? 1), top: R, bottom: R, yc, n: 2.05 });
  const tip = c.noseTip ?? 0;
  const noseSamples = tip ? [0, 0.25, 0.5, 0.7, 0.85, 1, 1.02] : [0, 0.25, 0.5, 0.7, 0.85, 0.95, 0.99, 1];
  for (const u of noseSamples) {
    const uu = Math.min(u, 1);
    let f = tip + (1 - tip) * Math.sqrt(Math.max(0.0001, 1 - uu ** 2.3));
    if (u > 1) f = 0.01; // closing cap just past a blunt (cowled) nose
    st.push({
      x: xn + c.noseLen * u, w: R * f * (c.widthScale ?? 1), top: R * f, bottom: R * f,
      yc: yc - (c.noseDrop ?? 0.12) * R * uu * uu, n: 2.1,
    });
  }
  return st;
}

/** Half-width and top/bottom of the body at x (linear between stations; good enough for placement). */
export function bodyAt(stations, x) {
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    if (x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      const mix = (k) => a[k] + (b[k] - a[k]) * t;
      return { w: mix('w'), top: mix('top'), bottom: mix('bottom'), yc: mix('yc') };
    }
  }
  const l = stations[stations.length - 1];
  return { w: l.w, top: l.top, bottom: l.bottom, yc: l.yc };
}

/** One merged mesh of cabin windows for both sides. */
export function windowGeometry(stations, o, detail) {
  const geos = [];
  const step = detail > MEDIUM ? 1 : 2;
  const count = Math.max(2, Math.round(o.count / step));
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const x = o.x0 + ((o.x1 - o.x0) * i) / Math.max(1, count - 1);
      const body = bodyAt(stations, x);
      const dy = (o.dy ?? 0.3) * body.top;
      const z = body.w * Math.sqrt(Math.max(0.05, 1 - (dy / body.top) ** 2.1)) + 0.012;
      const g = new THREE.BoxGeometry(o.w ?? 0.26, o.h ?? 0.34, 0.03);
      g.rotateX(side * -Math.asin(Math.min(0.9, dy / body.top)));
      g.translate(x, body.yc + dy + (o.yOffset ?? 0), side * z);
      geos.push(g);
    }
  }
  return mergeGeometries(geos);
}

// ---- engine pods ---------------------------------------------------------------------------------
export function nacelle(r, len, mats, detail) {
  const group = new THREE.Group();
  const seg = detail > LOW ? 28 : 12;
  group.add(new THREE.Mesh(revolveX([
    [0.55 * len, 0.88 * r], [0.5 * len, 0.97 * r], [0.35 * len, r], [0, 0.98 * r], [-0.25 * len, 0.82 * r], [-0.42 * len, 0.66 * r],
  ], seg), mats.wing));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.86 * r, seg), mats.intake);
  disc.rotation.y = Math.PI / 2;
  disc.position.x = 0.5 * len;
  group.add(disc);
  const fan = makeFan(0.84 * r, mats, detail);
  fan.position.x = 0.52 * len;
  group.add(fan);
  group.add(new THREE.Mesh(revolveX([[-0.3 * len, 0.5 * r], [-0.55 * len, 0.36 * r], [-0.78 * len, 0.03 * r]], 14), mats.steel));
  return { group, fan };
}

// ---- configurations --------------------------------------------------------------------------------
// Sections follow wingGeometry's convention: z span, x leading edge, y height, chord, t thickness.
const CONFIGS = {
  narrowbody: {
    body: { noseX: 19.0, tailX: -18.6, R: 2.05, yc: 0.3, noseLen: 5.2, tailLen: 10.0, upsweep: 1.0 },
    wing: {
      sections: [
        { z: 1.9, x: 3.3, y: -1.25, chord: 5.4, t: 0.125, camber: 0.02 },
        { z: 6.5, x: 0.9, y: -1.0, chord: 3.6, t: 0.11, camber: 0.02 },
        { z: 16.9, x: -4.3, y: 0.6, chord: 1.4, t: 0.09, camber: 0.015, twist: -2 },
      ],
      z0: 2.0, flapTo: 10.6, aileronFrom: 12.6, aileronTo: 16.4, hinge: 0.72, spoilerFrom: 3.4, spoilerTo: 10.6,
      winglet: { height: 1.7, chord: 1.4, tipChord: 0.6, sweep: 1.0 },
    },
    tail: {
      fin: [{ z: 0, x: -10.8, y: 0, chord: 6.3, t: 0.09 }, { z: 6.0, x: -15.9, y: 0, chord: 2.4, t: 0.08 }],
      finBaseY: 1.0, finHeight: 6.0, finHinge: 0.68,
      stab: [{ z: 0.2, x: -14.6, y: 1.35, chord: 3.4, t: 0.09 }, { z: 6.2, x: -17.6, y: 1.55, chord: 1.3, t: 0.07 }],
      stabZ1: 6.2,
    },
    engines: { kind: 'under', r: 1.0, len: 4.2 },
    windows: { x0: -8.5, x1: 12.4, count: 38, dy: 0.33, w: 0.26, h: 0.36 },
    cockpit: { x: 16.0, panelSize: 0.38 },
    gear: {
      noseAttachY: -1.35, mainAttachY: -1.3, noseWheelRadius: 0.35, noseWheelWidth: 0.2, noseWheels: 2, noseTrack: 0.5,
      mainWheelRadius: 0.55, mainWheelWidth: 0.3, mainWheels: 2, mainTrack: 0.9, mainStrut: 0.07, noDoors: true,
    },
    beacon: [[-4.0, 2.4], [4.0, -1.8]],
    tailNavX: -18.4,
  },
  regional: {
    body: { noseX: 15.0, tailX: -16.7, R: 1.5, yc: 0.2, noseLen: 4.2, tailLen: 9.0, upsweep: 0.9 },
    wing: {
      sections: [
        { z: 1.4, x: 2.4, y: -0.9, chord: 4.6, t: 0.125, camber: 0.02 },
        { z: 5.0, x: 0.6, y: -0.8, chord: 3.1, t: 0.11, camber: 0.02 },
        { z: 12.9, x: -3.0, y: 0.35, chord: 1.1, t: 0.09, camber: 0.015, twist: -2 },
      ],
      z0: 1.5, flapTo: 8.2, aileronFrom: 9.4, aileronTo: 12.4, hinge: 0.72, spoilerFrom: 2.6, spoilerTo: 8.2,
      winglet: { height: 1.4, chord: 1.1, tipChord: 0.5, sweep: 0.9 },
    },
    tail: {
      fin: [{ z: 0, x: -9.8, y: 0, chord: 4.6, t: 0.09 }, { z: 4.6, x: -13.3, y: 0, chord: 1.9, t: 0.08 }],
      finBaseY: 0.8, finHeight: 4.6, finHinge: 0.68,
      stab: [{ z: 0.2, x: -13.0, y: 1.0, chord: 2.6, t: 0.09 }, { z: 4.8, x: -15.3, y: 1.2, chord: 1.0, t: 0.07 }],
      stabZ1: 4.8,
    },
    engines: { kind: 'under', r: 0.86, len: 3.8 },
    windows: { x0: -8.5, x1: 9.8, count: 28, dy: 0.33, w: 0.24, h: 0.32 },
    cockpit: { x: 12.6, panelSize: 0.3 },
    gear: {
      noseAttachY: -1.15, mainAttachY: -1.1, noseWheelRadius: 0.3, noseWheelWidth: 0.18, noseWheels: 2, noseTrack: 0.4,
      mainWheelRadius: 0.5, mainWheelWidth: 0.28, mainWheels: 2, mainTrack: 0.8, mainStrut: 0.06, noDoors: true,
    },
    beacon: [[-3.0, 1.9], [3.0, -1.4]],
    tailNavX: -16.5,
  },
  bizjet: {
    body: { noseX: 14.4, tailX: -16.0, R: 1.32, yc: 0.35, noseLen: 4.6, tailLen: 8.5, upsweep: 0.8, widthScale: 0.98 },
    wing: {
      sections: [
        { z: 1.3, x: 4.7, y: -0.85, chord: 6.2, t: 0.11, camber: 0.018 },
        { z: 5.5, x: 1.6, y: -0.7, chord: 3.9, t: 0.1, camber: 0.018 },
        { z: 15.1, x: -6.0, y: 0.5, chord: 1.4, t: 0.085, camber: 0.012, twist: -2.5 },
      ],
      z0: 1.4, flapTo: 9.6, aileronFrom: 11.2, aileronTo: 14.6, hinge: 0.74, spoilerFrom: 2.6, spoilerTo: 9.6,
      winglet: { height: 1.5, chord: 1.2, tipChord: 0.5, sweep: 1.1 },
    },
    tail: {
      fin: [{ z: 0, x: -9.2, y: 0, chord: 5.5, t: 0.09 }, { z: 4.6, x: -13.3, y: 0, chord: 2.5, t: 0.08 }],
      finBaseY: 0.9, finHeight: 4.6, finHinge: 0.68,
      stab: [{ z: 0.1, x: -13.6, y: 5.45, chord: 2.8, t: 0.08 }, { z: 5.1, x: -15.6, y: 5.55, chord: 1.2, t: 0.07 }],
      stabZ1: 5.1,
    },
    engines: { kind: 'rear', r: 0.64, len: 3.4, pylonZ: 1.2 },
    windows: { x0: -9.5, x1: 8.5, count: 16, dy: 0.36, w: 0.34, h: 0.4 },
    cockpit: { x: 12.0, panelSize: 0.3 },
    gear: {
      noseAttachY: -1.0, mainAttachY: -1.0, noseWheelRadius: 0.28, noseWheelWidth: 0.16, noseWheels: 2, noseTrack: 0.36,
      mainWheelRadius: 0.5, mainWheelWidth: 0.26, mainWheels: 2, mainTrack: 0.7, mainStrut: 0.06, noDoors: true,
    },
    beacon: [[-3.0, 1.9], [3.0, -1.0]],
    tailNavX: -15.8,
  },
  widebody: {
    body: { noseX: 36.5, tailX: -37.4, R: 3.1, yc: 0.85, noseLen: 9.0, tailLen: 19.0, upsweep: 1.9 },
    wing: {
      sections: [
        { z: 3.0, x: 7.6, y: -2.1, chord: 12.2, t: 0.12, camber: 0.02 },
        { z: 12.0, x: 1.6, y: -1.5, chord: 6.6, t: 0.105, camber: 0.02 },
        { z: 32.2, x: -12.0, y: 2.0, chord: 2.7, t: 0.085, camber: 0.012, twist: -2.5 },
      ],
      z0: 3.2, flapTo: 22.0, aileronFrom: 24.0, aileronTo: 31.0, hinge: 0.74, spoilerFrom: 6.0, spoilerTo: 22.0,
      raked: { height: 1.2, chord: 2.0, tipChord: 0.9, sweep: 1.4 },
    },
    tail: {
      fin: [{ z: 0, x: -21.0, y: 0, chord: 12.0, t: 0.09 }, { z: 10.0, x: -32.0, y: 0, chord: 4.6, t: 0.08 }],
      finBaseY: 2.0, finHeight: 10.0, finHinge: 0.7,
      stab: [{ z: 0.3, x: -30.0, y: 1.9, chord: 7.0, t: 0.09 }, { z: 10.8, x: -36.3, y: 2.4, chord: 2.6, t: 0.07 }],
      stabZ1: 10.8,
    },
    engines: { kind: 'under', r: 2.0, len: 7.6 },
    windows: { x0: -24, x1: 26, count: 62, dy: 0.3, w: 0.3, h: 0.4 },
    cockpit: { x: 33.5, panelSize: 0.7 },
    gear: {
      noseAttachY: -2.4, mainAttachY: -2.4, noseWheelRadius: 0.55, noseWheelWidth: 0.3, noseWheels: 2, noseTrack: 0.7,
      mainWheelRadius: 0.65, mainWheelWidth: 0.4, mainWheels: 2, mainTrack: 1.2, mainAxles: 3, mainAxleSpacing: 1.4, mainStrut: 0.14, noDoors: true,
    },
    beacon: [[-8.0, 4.0], [6.0, -2.3]],
    tailNavX: -37.2,
  },
  jumbo: {
    body: { noseX: 34.0, tailX: -36.7, R: 3.2, yc: 0.4, noseLen: 8.5, tailLen: 18.0, upsweep: 2.1, widthScale: 1.0 },
    hump: { x0: -2.0, x1: 29.5, w: 1.7, h: 1.25, yc: 3.35 },
    wing: {
      sections: [
        { z: 3.2, x: 10.9, y: -2.2, chord: 16.6, t: 0.12, camber: 0.02 },
        { z: 12.5, x: 2.5, y: -1.4, chord: 9.0, t: 0.105, camber: 0.02 },
        { z: 32.0, x: -15.0, y: 3.0, chord: 3.8, t: 0.085, camber: 0.012, twist: -2.5 },
      ],
      z0: 3.4, flapTo: 27.0, aileronFrom: 27.5, aileronTo: 31.4, hinge: 0.76, spoilerFrom: 6.0, spoilerTo: 26.0,
      winglet: { height: 3.4, chord: 3.2, tipChord: 1.1, sweep: 2.4 },
    },
    tail: {
      fin: [{ z: 0, x: -22.0, y: 0, chord: 11.5, t: 0.09 }, { z: 8.7, x: -31.0, y: 0, chord: 4.5, t: 0.08 }],
      finBaseY: 2.8, finHeight: 8.7, finHinge: 0.7,
      stab: [{ z: 0.3, x: -30.5, y: 1.7, chord: 8.0, t: 0.09 }, { z: 11.0, x: -36.0, y: 2.1, chord: 2.8, t: 0.07 }],
      stabZ1: 11.0,
    },
    engines: { kind: 'under', r: 1.6, len: 6.4 },
    windows: { x0: -26, x1: 26, count: 60, dy: 0.3, w: 0.3, h: 0.4 },
    upperWindows: { x0: 3, x1: 26, count: 26 },
    cockpit: { x: 31.5, panelSize: 0.6, y: 4.2 },
    gear: {
      noseAttachY: -2.6, mainAttachY: -2.4, noseWheelRadius: 0.55, noseWheelWidth: 0.3, noseWheels: 2, noseTrack: 0.7,
      mainWheelRadius: 0.65, mainWheelWidth: 0.4, mainWheels: 2, mainTrack: 1.2, mainAxles: 2, mainAxleSpacing: 1.5, mainStrut: 0.14, noDoors: true,
      extraMains: [{ x: -6.8, z: -2.6 }, { x: -6.8, z: 2.6 }],
    },
    beacon: [[-8.0, 4.0], [6.0, -2.5]],
    tailNavX: -36.4,
  },
};

export function buildAirliner(spec, mats, detail, key = spec.id) {
  const c = CONFIGS[key];
  const root = new THREE.Group();
  const rig = newRig();
  const stations = fuselageStations(c.body);
  const fuselage = new THREE.Mesh(fuselageGeometry(stations, detail), mats.skin);
  root.add(fuselage);
  rig.fuselage = fuselage;

  // Upper deck hump (jumbo).
  if (c.hump) {
    const h = c.hump;
    const hs = [
      { x: h.x0, w: 0.08, top: 0.08, bottom: 0.08, yc: h.yc - 0.25, n: 2.2 },
      { x: h.x0 + 6, w: h.w * 0.85, top: h.h * 0.9, bottom: h.h, yc: h.yc, n: 2.2 },
      { x: (h.x0 + h.x1) / 2, w: h.w, top: h.h, bottom: h.h, yc: h.yc, n: 2.1 },
      { x: h.x1 - 3, w: h.w * 0.9, top: h.h * 0.9, bottom: h.h * 0.85, yc: h.yc - 0.1, n: 2.1 },
      { x: h.x1, w: h.w * 0.35, top: h.h * 0.4, bottom: h.h * 0.4, yc: h.yc - 0.45, n: 2.1 },
    ];
    const hump = new THREE.Mesh(fuselageGeometry(hs, detail), mats.wing);
    root.add(hump);
    rig.hump = hump;
  }

  if (detail > LOW) {
    const win = new THREE.Mesh(windowGeometry(stations, c.windows, detail), mats.window);
    root.add(win);
    if (c.upperWindows && c.hump) {
      const u = c.upperWindows;
      const hs = [{ x: u.x0, w: c.hump.w, top: c.hump.h, bottom: c.hump.h, yc: c.hump.yc }, { x: u.x1, w: c.hump.w, top: c.hump.h, bottom: c.hump.h, yc: c.hump.yc }];
      root.add(new THREE.Mesh(windowGeometry(hs, { ...u, w: 0.24, h: 0.3, dy: 0.1 }, detail), mats.window));
    }
    // Cockpit windscreen: two front panes and two side panes laid on the nose surface.
    const k = c.cockpit;
    const yc = k.y ?? bodyAt(stations, k.x).yc;
    const p = k.panelSize;
    for (const [dx, ang, w, h] of [[0.8, 62, p * 1.9, p], [0.8, 118, p * 1.9, p], [-0.4, 35, p * 1.7, p * 0.9], [-0.4, 145, p * 1.7, p * 0.9]]) {
      const panel = surfacePanel(fuselage, { x: k.x + dx, ang, yc, w, h, material: mats.glass });
      if (panel) root.add(panel);
    }
  }

  // ---- wings, flaps, ailerons, spoilers ------------------------------------------------------
  const w = c.wing;
  const tip = w.sections[w.sections.length - 1];
  const buildWing = (side) => {
    const g = new THREE.Group();
    if (side < 0) g.scale.z = -1;
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.z0, tip.z, { xf0: 0, xf1: w.hinge, detail }), mats.wing));
    const flap = controlSurface(w.sections, w.z0, w.flapTo, w.hinge, mats.wing, detail);
    const aileron = controlSurface(w.sections, w.aileronFrom, w.aileronTo, w.hinge, mats.wing, detail);
    g.add(flap.pivot, aileron.pivot);
    // Plain wing between the flap and aileron so there is no gap in the trailing edge.
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.flapTo, w.aileronFrom, { xf0: w.hinge, xf1: 1, detail }), mats.wing));
    g.add(new THREE.Mesh(wingGeometry(w.sections, w.aileronTo, tip.z, { xf0: w.hinge, xf1: 1, detail }), mats.wing));
    rig.flaps.push({ pivot: flap.pivot, axis: flap.axis });
    rig.ailerons.push({ pivot: aileron.pivot, axis: aileron.axis, side });
    if (detail > LOW && w.spoilerFrom) {
      const span = w.spoilerTo - w.spoilerFrom;
      const mid = (w.spoilerFrom + w.spoilerTo) / 2;
      const sec = sectionAt(w.sections, mid);
      const panel = box(sec.chord * 0.2, 0.02, span, mats.wing);
      panel.position.set(-sec.chord * 0.1, 0, span / 2);
      const pivot = new THREE.Object3D();
      pivot.position.set(sec.x - sec.chord * (w.hinge - 0.05), sec.y + sec.chord * sec.t * 0.45, w.spoilerFrom);
      pivot.add(panel);
      g.add(pivot);
      rig.speedbrakes.push({ pivot, axis: new THREE.Vector3(0, 0, 1), angle: 0.75 });
    }
    const wl = w.winglet ?? w.raked;
    if (wl) {
      const fin = new THREE.Group();
      fin.rotation.x = -Math.PI / 2;
      fin.position.set(tip.x, tip.y, tip.z);
      const secs = [
        { z: 0, x: 0, y: 0, chord: wl.chord, t: 0.07 },
        { z: wl.height, x: -wl.sweep, y: 0, chord: wl.tipChord, t: 0.06 },
      ];
      fin.add(new THREE.Mesh(wingGeometry(secs, 0, wl.height, { detail }), mats.wing));
      g.add(fin);
    }
    addTipLights(g, rig, side, { x: tip.x - tip.chord * 0.6, y: tip.y + 0.05, z: tip.z });
    return g;
  };
  root.add(buildWing(-1), buildWing(1));

  // ---- engines ---------------------------------------------------------------------------------
  const e = c.engines;
  spec.engines.positions.forEach((pos) => {
    const pod = nacelle(e.r, e.len, mats, detail);
    pod.group.position.set(pos.x, pos.y, pos.z);
    root.add(pod.group);
    rig.fans.push(pod.fan);
    if (detail <= LOW) return;
    const side = Math.sign(pos.z);
    if (e.kind === 'under') {
      // Pylon: a slab from the top of the nacelle up to the wing's leading edge.
      const sec = sectionAt(w.sections, Math.abs(pos.z));
      const p0 = new THREE.Vector3(pos.x - e.len * 0.05, pos.y + e.r * 0.8, pos.z);
      const p1 = new THREE.Vector3(sec.x - sec.chord * 0.18, sec.y - sec.chord * sec.t * 0.2, pos.z);
      const len = p0.distanceTo(p1);
      const pylon = box(len, 0.12 + e.r * 0.1, e.r * 0.28, mats.wing);
      pylon.position.copy(p0).add(p1).multiplyScalar(0.5);
      pylon.rotation.z = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      root.add(pylon);
    } else {
      const body = bodyAt(stations, pos.x);
      const run = Math.abs(pos.z) - body.w * 0.9;
      const pylon = box(e.len * 0.55, e.r * 0.28, run + e.r * 0.3, mats.wing);
      pylon.position.set(pos.x - e.len * 0.05, pos.y - e.r * 0.1, side * (body.w * 0.9 + run / 2 - e.r * 0.1));
      root.add(pylon);
    }
  });

  // ---- tail ---------------------------------------------------------------------------------------
  const t = c.tail;
  addFin(root, rig, mats, t.fin, { baseY: t.finBaseY, height: t.finHeight, hinge: t.finHinge, rudderFrom: 0.1, detail, material: mats.accent });
  addStabilizer(root, rig, mats, t.stab, { z0: t.stab[0].z, z1: t.stabZ1, hinge: 0.66, detail });

  // ---- lights ---------------------------------------------------------------------------------------
  for (const [x, y] of c.beacon) {
    const beacon = makeLight(0xff2a2a, 0.07, 1.4);
    beacon.position.set(x, y, 0);
    root.add(beacon);
    rig.lights.beacon.push(beacon);
  }
  const tailNav = makeLight(0xffffff, 0.06);
  tailNav.position.set(c.tailNavX, c.body.yc + c.body.upsweep + 0.1, 0);
  root.add(tailNav);
  rig.lights.nav.push(tailNav);
  for (const side of [-1, 1]) {
    const lamp = makeLight(0xfff3d0, 0.08, 1.2);
    const sec = w.sections[0];
    lamp.position.set(sec.x - 0.4, sec.y - 0.2, side * (sec.z + 1.2));
    root.add(lamp);
    rig.lights.landing.push(lamp);
  }

  addRetractableGear(root, rig, spec, mats, detail, c.gear);
  return { group: root, rig };
}

export const buildNarrowbody = (spec, mats, detail) => buildAirliner(spec, mats, detail, 'narrowbody');
export const buildRegional = (spec, mats, detail) => buildAirliner(spec, mats, detail, 'regional');
export const buildBizjet = (spec, mats, detail) => buildAirliner(spec, mats, detail, 'bizjet');
export const buildWidebody = (spec, mats, detail) => buildAirliner(spec, mats, detail, 'widebody');
export const buildJumbo = (spec, mats, detail) => buildAirliner(spec, mats, detail, 'jumbo');
