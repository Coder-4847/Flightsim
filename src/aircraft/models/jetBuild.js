import * as THREE from 'three';
import { makeLight } from './builders.js';
import { newRig } from './common.js';
import { JET_CONFIGS } from './jetConfigs.js';
import { Fuselage, ellipse, rrect, scalePoly } from './jetFuselage.js';
import { buildGear } from './jetGear.js';
import { buildNacelle, buildPylon } from './jetEngine.js';
import { PartSet, boxGeo, cylinderGeo, loftFrames, mirrorZ, placed, std, DEG } from './jetKit.js';
import { getJetMaterials } from './jetMaterials.js';
import { JetWingBuilder } from './jetWing.js';
import { addDetails } from './jetDetails.js';

// Assembles one jet / airliner model (any LOD) from its JET_CONFIGS entry.

function inRanges(x, ranges) { return ranges.some(([a, b]) => x >= a && x <= b); }

function addWindows(fus, cfg, J, hull, detail) {
  const set = new PartSet();
  const addRow = (W) => {
    const count = Math.floor((W.x1 - W.x0) / W.pitch) + 1;
    const poly = rrect(W.w, W.h, W.r ?? 0.1, detail > 1 ? 3 : 1);
    const rim = scalePoly(poly, 1 + 0.09 / W.w, 1 + 0.09 / W.h);
    for (let i = 0; i < count; i++) {
      const x = W.x1 - i * W.pitch;
      if (W.skip && inRanges(x, W.skip)) continue;
      for (const side of [1, -1]) {
        const y = fus.yc + W.y;
        if (detail > 0) set.add(J.rim, fus.sidePatch(side, x, y, rim, { lift: 0.0025, rings: 1 }));
        set.add(J.window, fus.sidePatch(side, x, y, poly, { lift: 0.006, rings: detail > 1 ? 2 : 1 }));
      }
    }
  };
  if (cfg.windows) addRow(cfg.windows);
  if (cfg.upperWindows) addRow(cfg.upperWindows);
  set.addTo(hull, 'windows');
}

function addWindshield(fus, cfg, J, hull, detail) {
  const k = cfg.cockpit;
  const set = new PartSet();
  const f = k.front;
  const x = k.x;
  // Two front panes either side of the centre post; trapezoids narrowing toward the roof.
  for (const s of [-1, 1]) {
    const th = Math.PI / 2 - s * f.ang * DEG;
    const w = f.w;
    const h = f.h;
    // outline in (dx, ds): ds increases with theta, i.e. toward the left side of the aircraft
    const poly = [
      [h * 0.5, -s * w * 0.5], [h * 0.5, s * w * 0.5], [-h * 0.5, s * w * 0.42], [-h * 0.5 - h * 0.05, -s * w * 0.4],
    ];
    const ordered = s > 0 ? poly : poly.slice().reverse();
    set.add(J.rim, fus.patch(x, th, scalePoly(ordered, 1.1, 1.1), { lift: 0.004, rings: 3 }));
    set.add(J.glass, fus.patch(x, th, ordered, { lift: 0.009, rings: 3 }));
  }
  // Side windows.
  const sd = k.side;
  for (const side of [1, -1]) {
    const w = sd.w;
    const h = sd.h;
    const poly = [[w * 0.5, h * 0.5], [-w * 0.35, h * 0.5], [-w * 0.5, -h * 0.5], [w * 0.5, -h * 0.5]];
    set.add(J.rim, fus.sidePatch(side, sd.x, fus.yc + sd.y, scalePoly(poly, 1.12), { lift: 0.004, rings: 2 }));
    set.add(J.glass, fus.sidePatch(side, sd.x, fus.yc + sd.y, poly, { lift: 0.009, rings: 2 }));
  }
  void detail;
  set.addTo(hull, 'windshield');
}

export function buildJet(spec, mats, detail, id = spec.id) {
  const cfg = JET_CONFIGS[id];
  const J = getJetMaterials(spec, mats);
  const root = new THREE.Group();
  const rig = newRig();
  const hull = new THREE.Group();
  hull.name = 'hull';
  root.add(hull);
  rig.fuselage = hull;
  const fus = new Fuselage(cfg.fuselage);
  const hullParts = new PartSet();
  hullParts.add(J.skin, fus.geometry(detail));
  hullParts.add(J.hot, fus.tailEnd());
  hullParts.addTo(hull, 'fuselage');
  addWindshield(fus, cfg, J, hull, detail);
  if (detail > 0) addWindows(fus, cfg, J, hull, detail);

  const parts = new PartSet();
  const wb = new JetWingBuilder({ cfg, detail, J, parts, root, rig });
  const wingPf = wb.buildWing();
  wb.buildFin();
  wb.buildStab();

  // Engines and pylons.
  const E = cfg.engines;
  spec.engines.positions.forEach((pos) => {
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);
    const nac = buildNacelle(E, J, detail, parts, at);
    root.add(nac.fan);
    rig.fans.push(nac.fan);
    if (E.rear) {
      const side = Math.sign(pos.z);
      const bodyW = fus.halfWidth(pos.x) * 0.85;
      const zIn = bodyW;
      const zOut = Math.abs(pos.z) - E.r * 0.5;
      const len = E.len;
      const mk = (z, le, te, y) => ({ p: new THREE.Vector3(le, y, z), c: new THREE.Vector3(te - le, 0, 0), u: new THREE.Vector3(0, 1, 0), t: 0.12, m: 0, v: 0 });
      const yE = pos.y + E.r * 0.1;
      const frames = [mk(zIn, pos.x + len * 0.28, pos.x - len * 0.6, yE + 0.12), mk(zOut, pos.x + len * 0.22, pos.x - len * 0.55, yE)];
      const g = loftFrames(frames, { nChord: detail > 1 ? 14 : 8, capStart: false, capEnd: true, crease: 50 });
      parts.add(J.wing, side > 0 ? g : mirrorZ(g));
    } else {
      buildPylon(E, J, parts, at, wingPf, Math.abs(pos.z), detail);
    }
  });

  buildGear(spec, cfg, J, detail, root, rig, fus);
  addDetails({ spec, cfg, J, fus, wb, detail, parts, hullParts: hull, root, rig, hull });
  parts.addTo(root, 'static');

  // Lights.
  const tip = wb.tipPoint();
  for (const side of [1, -1]) {
    const nav = makeLight(side < 0 ? 0xff2a2a : 0x2aff5a, 0.07, 1.2);
    nav.position.set(tip.le.x - 0.1, tip.le.y, side * tip.le.z);
    root.add(nav);
    rig.lights.nav.push(nav);
    const strobe = makeLight(0xffffff, 0.08, 1.8);
    strobe.position.set(tip.te.x + 0.05, tip.te.y, side * tip.te.z);
    root.add(strobe);
    rig.lights.strobes.push(strobe);
    const land = makeLight(0xfff3d0, 0.1, 1.6);
    const w0 = wingPf.frame(cfg.wing.stations[1].z * 0.55);
    land.position.set(w0.p.x - 0.1, w0.p.y - 0.15, side * w0.p.z);
    root.add(land);
    rig.lights.landing.push(land);
  }
  return { group: root, rig };
}

export { std, boxGeo, cylinderGeo, placed, ellipse };
