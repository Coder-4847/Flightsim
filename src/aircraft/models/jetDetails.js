import * as THREE from 'three';
import { makeLight } from './builders.js';
import {
  DEG, PartSet, boxGeo, cylinderGeo, merge, mirrorZ, placed, revolve, std,
} from './jetKit.js';
import { ellipse, rrect } from './jetFuselage.js';

// Small parts: probes, antennas, wipers, lamps, vents, the APU exhaust and the fin/wing-tip fittings. Hull attached parts are
// added to the hull group so they hide together with the fuselage in the cockpit view.

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Matrix placing a local frame on the skin at (x, theta): local +Y = outward normal, local +X = along the fuselage (nose). */
function skinMatrix(fus, x, theta, lift = 0) {
  fus.point(x, theta, _p);
  fus.normal(x, theta, _y);
  _x.set(1, 0, 0).addScaledVector(_y, -_y.x).normalize();
  _z.crossVectors(_x, _y).normalize();
  _p.addScaledVector(_y, lift);
  return new THREE.Matrix4().makeBasis(_x.clone(), _y.clone(), _z.clone()).setPosition(_p.clone());
}

/** A thin blade (swept triangle-ish plate) standing on the skin: length along x, height along the normal. */
function bladeGeo(len, height, thick, sweep = 0.5) {
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2, 0);
  shape.lineTo(len / 2, 0);
  shape.lineTo(len / 2 - len * sweep * 0.9, height);
  shape.lineTo(-len / 2 + len * 0.15, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  return std(g);
}

export function addDetails({ spec, cfg, J, fus, wb, detail, parts, hull, root, rig }) {
  const hp = new PartSet();
  const side = [1, -1];
  const add = (mat, geo, m) => hp.add(mat, geo, m);
  const ck = cfg.cockpit;
  const sc = fus.cfg.w / 1.975;

  // ---- beacons and the tail light ------------------------------------------------------------------------------------
  for (const [x, where] of cfg.beacons ?? []) {
    const th = where === 'top' ? Math.PI / 2 : -Math.PI / 2;
    const beacon = makeLight(0xff2a2a, 0.09, 1.7);
    const p = fus.point(x, th);
    beacon.position.set(p.x, p.y + (where === 'top' ? 0.06 : -0.06), 0);
    root.add(beacon);
    rig.lights.beacon.push(beacon);
    if (detail > 0) {
      const dome = std(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
      const m = skinMatrix(fus, x, th, 0);
      if (where === 'belly') m.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
      add(J.lensRed, dome, m);
    }
  }
  const tail = makeLight(0xffffff, 0.07, 1.3);
  const tp = fus.prof(fus.xTail);
  tail.position.set(fus.xTail - 0.12, tp.yc, 0);
  root.add(tail);
  rig.lights.nav.push(tail);

  if (detail === 0) { hp.addTo(hull, 'details'); return; }

  // ---- nose: pitots, static ports, AOA vanes, wipers ---------------------------------------------------------------------
  const pitotX = ck.side.x - 0.2;
  for (const s of side) {
    const yBase = fus.yc + ck.side.y - 0.55;
    for (let i = 0; i < 3; i++) {
      const th = fus.thetaForY(pitotX - i * 0.0 + 0.0, yBase - i * 0.16, s);
      const m = skinMatrix(fus, pitotX - 0.45 * i, th, 0.0);
      const probe = merge([
        placed(cylinderGeo(0.014, 0.016, 0.3, 6, { axis: 'x' }), 0.17, 0.016, 0),
        placed(cylinderGeo(0.05, 0.05, 0.03, 8, { axis: 'y' }), 0, 0.01, 0),
      ]);
      add(J.steel, probe, m);
    }
    // static ports (small dark patches)
    for (let i = 0; i < 2; i++) {
      const x = pitotX - 1.0 - i * 0.35;
      add(J.black, fus.sidePatch(s, x, fus.yc + ck.side.y - 0.78, rrect(0.13, 0.09, 0.02, 1), { lift: 0.003, rings: 1 }));
    }
    // AOA vane
    const thA = fus.thetaForY(pitotX - 1.9, fus.yc + ck.side.y - 0.2, s);
    add(J.steel, placed(boxGeo(0.12, 0.06, 0.01), 0.0, 0.035, 0), skinMatrix(fus, pitotX - 1.9, thA, 0));
  }

  // ---- antennas, vents and drains -----------------------------------------------------------------------------------------
  const topAnt = [[fus.xNose - 8.0 - 0.15 * fus.length * 0.1, 0.5], [fus.xTail + fus.length * 0.62, 0.45], [fus.xTail + fus.length * 0.52, 0.3]];
  for (const [x, h] of topAnt) add(J.dark, bladeGeo(h * 0.8 * sc, h * 0.5 * sc, 0.025, 0.6), skinMatrix(fus, x, Math.PI / 2, 0));
  // SATCOM / long blade on the belly and the fuselage top (airliners)
  if (spec.id !== 'citation') {
    add(J.dark, bladeGeo(0.5 * sc, 0.3 * sc, 0.025, 0.6), skinMatrix(fus, fus.xNose - fus.length * 0.28, -Math.PI / 2, 0));
    add(J.dark, bladeGeo(0.5 * sc, 0.3 * sc, 0.025, 0.6), skinMatrix(fus, fus.xTail + fus.length * 0.3, -Math.PI / 2, 0));
  }
  if (spec.id === 'widebody' || spec.id === 'jumbo' || spec.id === 'bizjet') {
    const sx = spec.id === 'jumbo' ? 13.0 : spec.id === 'widebody' ? 6.0 : 1.5;
    const sat = std(new THREE.SphereGeometry(spec.id === 'bizjet' ? 0.3 : 0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    sat.scale(1.6, 0.45, 1);
    const topTheta = Math.PI / 2;
    add(J.nacelle, sat, skinMatrix(fus, sx, topTheta, -0.02));
  }
  if (cfg.ventral) {
    const v = cfg.ventral;
    for (const dth of [-0.22, 0.22]) add(J.skin, bladeGeo(v.len, v.h, 0.03, 0.45), skinMatrix(fus, v.x, -Math.PI / 2 + dth, 0));
  }
  // drain masts and the outflow valve
  for (const s of side) {
    const th = fus.thetaForY(fus.xTail + fus.length * 0.42, fus.yc - fus.cfg.w * 0.9, s);
    add(J.steel, placed(cylinderGeo(0.015, 0.012, 0.22, 5, { axis: 'x' }), -0.1, 0.03, 0), skinMatrix(fus, fus.xTail + fus.length * 0.42, th, 0));
  }
  add(J.dark, fus.patch(fus.xTail + fus.length * 0.2, -Math.PI / 2 + 0.55, rrect(0.7, 0.28, 0.05, 2), { lift: 0.004, rings: 1 }));
  add(J.dark, fus.patch(fus.xTail + fus.length * 0.2, -Math.PI / 2 - 0.55, rrect(0.7, 0.28, 0.05, 2), { lift: 0.004, rings: 1 }));
  // belly air inlet and exhaust scoops
  add(J.dark, fus.patch(fus.xNose - fus.length * 0.33, -Math.PI / 2 + 0.2, rrect(0.5, 0.18, 0.03, 1), { lift: 0.004, rings: 1 }));
  // tail skid pad
  add(J.black, fus.patch(fus.xTail + fus.cfg.tail.len * 0.9, -Math.PI / 2, rrect(0.9, 0.35, 0.06, 1), { lift: 0.006, rings: 2 }));

  // ---- door windows and handles -----------------------------------------------------------------------------------------------
  for (const d of cfg.doors ?? []) {
    if (d.h < 1.5) continue;
    for (const s of d.sides ?? [1, -1]) {
      add(J.window, fus.sidePatch(s, d.x, fus.yc + d.y0 + d.h * 0.66, ellipse(0.19, 0.26, 12), { lift: 0.006, rings: 2 }));
      add(J.rim, fus.sidePatch(s, d.x, fus.yc + d.y0 + d.h * 0.66, ellipse(0.25, 0.32, 12), { lift: 0.0025, rings: 1 }));
      add(J.steel, fus.sidePatch(s, d.x + d.w * 0.28, fus.yc + d.y0 + d.h * 0.45, rrect(0.1, 0.05, 0.01, 1), { lift: 0.004, rings: 1 }));
    }
  }

  // ---- APU exhaust at the tail ---------------------------------------------------------------------------------------------------
  const tpf = fus.prof(fus.xTail);
  const ex = revolve([[fus.xTail + 0.25, tpf.w * 1.05], [fus.xTail + 0.02, tpf.w * 0.85], [fus.xTail - 0.12, tpf.w * 0.7], [fus.xTail - 0.12, tpf.w * 0.52], [fus.xTail - 0.02, tpf.w * 0.3]], 16, { crease: 60 });
  add(J.hot, placed(ex, 0, tpf.yc, 0));

  // ---- wing details -----------------------------------------------------------------------------------------------------------------
  const tip = wb.tipPoint();
  for (const s of side) {
    const lensM = new THREE.Matrix4().makeTranslation(tip.le.x - 0.0, tip.le.y, s * tip.le.z);
    const lens = std(new THREE.SphereGeometry(0.06, 8, 6));
    parts.add(s > 0 ? J.lensGreen : J.lensRed, lens, lensM);
    parts.add(J.lensClear, std(new THREE.SphereGeometry(0.06, 8, 6)), new THREE.Matrix4().makeTranslation(tip.te.x + 0.05, tip.te.y, s * tip.te.z));
  }
  void DEG; void mirrorZ;
  hp.addTo(hull, 'details');
}
