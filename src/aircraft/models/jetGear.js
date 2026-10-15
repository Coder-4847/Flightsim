import * as THREE from 'three';
import {
  DEG, TAU, boxGeo, clamp, cylinderGeo, merge, placed, revolve, std,
} from './jetKit.js';
import { rrect } from './jetFuselage.js';

// Landing gear for the jet models: oleo struts with chrome pistons and torque links, bogies, tyres with sidewall text and tread
// grooves, wheels with hubs and brake stacks, and belly doors that open while the gear is in transit.

function tyreGeometry(R, w, rim, detail) {
  const seg = [10, 22, 40][detail];
  const h = R - rim;
  const prof = [
    [-w * 0.46, rim * 1.02], [-w * 0.5, rim + h * 0.3], [-w * 0.46, rim + h * 0.72], [-w * 0.38, R - h * 0.06],
    [-w * 0.28, R], [0, R * 1.003], [w * 0.28, R], [w * 0.38, R - h * 0.06],
    [w * 0.46, rim + h * 0.72], [w * 0.5, rim + h * 0.3], [w * 0.46, rim * 1.02],
  ];
  const g = revolve(prof, seg, { crease: 45 });
  g.rotateY(Math.PI / 2); // axis X -> axis Z
  return g;
}

function wheelRimGeometry(R, w, rim, detail) {
  const seg = [8, 16, 28][detail];
  const geos = [];
  const prof = [
    [-w * 0.52, rim * 0.98], [-w * 0.55, rim * 0.8], [-w * 0.3, rim * 0.62], [-w * 0.18, rim * 0.34], [-w * 0.22, rim * 0.16], [-w * 0.25, 0.001],
  ];
  const outer = revolve(prof, seg, { crease: 50 });
  const inner = revolve([[w * 0.52, rim * 0.98], [w * 0.55, rim * 0.8], [w * 0.3, rim * 0.62], [w * 0.2, rim * 0.4], [w * 0.2, 0.001]], seg, { crease: 50 });
  for (const g of [outer, inner]) { g.rotateY(Math.PI / 2); geos.push(g); }
  if (detail > 1) {
    // bolt circle on the outer hub
    const bolt = cylinderGeo(rim * 0.035, rim * 0.035, w * 0.08, 6, { axis: 'z' });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      geos.push(placed(bolt, Math.cos(a) * rim * 0.42, Math.sin(a) * rim * 0.42, -w * 0.3));
    }
  }
  return merge(geos);
}

/**
 * A gear leg. pivot at the attachment point, leg hangs along -Y. opts: { length, wheelR, wheelW, abreast (1|2), axles, axleSpacing,
 * track, strutR, nose }.
 */
export function makeJetLeg(o, J, detail) {
  const {
    length, wheelR, wheelW, abreast = 2, axles = 1, axleSpacing = 1.2, track = 0.3, strutR = 0.06, nose = false, side = 1,
  } = o;
  const pivot = new THREE.Group();
  const seg = [6, 10, 16][detail];
  const upperLen = length * 0.5;
  // Upper (outer cylinder, painted) is part of the pivot; piston, links and wheels move with `lower`.
  const upper = new THREE.Mesh(cylinderGeo(strutR * 1.55, strutR * 1.7, upperLen, seg), J.gearPaint);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const trunnion = new THREE.Mesh(cylinderGeo(strutR * 1.1, strutR * 1.1, strutR * 5, 8, { axis: 'z' }), J.steel);
  trunnion.position.y = -strutR * 0.5;
  if (detail > 0) pivot.add(trunnion);
  const lower = new THREE.Group();
  const lowerParts = [];
  const axleY = -length + wheelR;
  // chrome piston: from inside the outer cylinder down to the axle level
  const pTop = -upperLen + 0.15;
  const pBot = axleY + wheelR * 0.2;
  lowerParts.push([J.chrome, cylinderGeo(strutR, strutR, pTop - pBot, seg), 0, (pTop + pBot) / 2, 0]);
  // bogie / axle
  const lateral = abreast === 2 ? [-track / 2, track / 2] : [0];
  const wheelMeshes = [];
  const wheelGroups = [];
  const beamY = axleY + wheelR * 0.0;
  const span = (axles - 1) * axleSpacing;
  if (axles > 1) {
    // bogie beam along X
    lowerParts.push([J.gearPaint, boxGeo(span + wheelR * 0.8, strutR * 2.2, strutR * 2.8), 0, beamY + strutR * 0.2, 0]);
    lowerParts.push([J.steel, cylinderGeo(strutR * 1.3, strutR * 1.3, strutR * 4, 8, { axis: 'z' }), 0, beamY + strutR * 2.6, 0]);
  }
  for (let a = 0; a < axles; a++) {
    const x = (a - (axles - 1) / 2) * axleSpacing;
    // axle tube
    lowerParts.push([J.steel, cylinderGeo(strutR * 0.8, strutR * 0.8, track + wheelW * 1.2, 8, { axis: 'z' }), x, axleY, 0]);
    if (abreast === 1) {
      // fork arms either side of a single wheel (not used for jets)
    }
    for (const z of lateral) {
      const wheel = new THREE.Group();
      if (detail === 0) {
        wheel.add(new THREE.Mesh(cylinderGeo(wheelR, wheelR, wheelW, 8, { axis: 'z' }), J.rubber));
        wheel.position.set(x, axleY, z);
        lower.add(wheel);
        wheelMeshes.push(wheel);
        wheelGroups.push(wheel);
        continue;
      }
      const tyre = new THREE.Mesh(tyreGeometry(wheelR, wheelW, wheelR * 0.56, detail), J.rubber);
      wheel.add(tyre);
      const rim = new THREE.Mesh(wheelRimGeometry(wheelR, wheelW, wheelR * 0.56, detail), J.wheel);
      wheel.add(rim);
      if (detail > 0) {
        const brake = new THREE.Mesh(cylinderGeo(wheelR * 0.44, wheelR * 0.44, wheelW * 0.55, 14, { axis: 'z' }), J.brake);
        wheel.add(brake);
      }
      wheel.position.set(x, axleY, z);
      lower.add(wheel);
      wheelMeshes.push(wheel);
      wheelGroups.push(wheel);
    }
  }
  if (axles === 1 && detail > 0) {
    // short strut stub between the piston end and the axle
    lowerParts.push([J.steel, boxGeo(strutR * 1.8, wheelR * 0.5, track * 0.5), 0, axleY + wheelR * 0.45, 0]);
  }
  if (detail > 0) {
    // torque links (scissors)
    const link = boxGeo(strutR * 0.5, length * 0.2, strutR * 0.9);
    const ly = -upperLen - length * 0.06;
    lowerParts.push([J.steel, link, strutR * 1.9, ly, 0, 0.35]);
    lowerParts.push([J.steel, link, strutR * 1.9, ly - length * 0.12, 0, -0.35]);
    // hydraulic lines
    lowerParts.push([J.black, cylinderGeo(strutR * 0.18, strutR * 0.18, length * 0.4, 5), -strutR * 1.7, -length * 0.32, strutR * 0.8]);
  }
  if (detail > 0 && !nose) {
    // side stay (drag brace) from the leg to the wing / fuselage structure, part of the fixed pivot
    const dy = upperLen * 0.75;
    const dz = (o.stay ?? 0.9) * -side;
    const len = Math.hypot(dy, dz);
    const stay = new THREE.Mesh(boxGeo(strutR * 1.2, len, strutR * 1.2), J.gearPaint);
    stay.position.set(strutR * 1.2, -dy * 0.5 - upperLen * 0.0, dz * 0.5);
    stay.rotation.x = Math.atan2(dz, dy);
    pivot.add(stay);
  }
  const byMat = new Map();
  for (const [mat, geo, x, y, z, rz = 0] of lowerParts) {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(placed(geo, x, y, z, 0, 0, rz));
  }
  for (const [mat, list] of byMat) lower.add(new THREE.Mesh(merge(list), mat));
  pivot.add(lower);
  pivot.userData = { lower, wheels: wheelMeshes, length };
  void nose;
  void clamp;
  void rrect;
  void std;
  void DEG;
  return pivot;
}

/** Gear doors laid on the belly of the fuselage: patch geometry hinged along one edge. Returns door rig entries. */
function bellyDoor(fus, J, root, rig, { x, dx, theta, hingeSide, w, h, open, name }) {
  // Door outline in metres on the skin, centred at (x, theta); rectangle w (along x) by h (around).
  const poly = rrect(w, h, 0.04, 2);
  const geo = fus.patch(x, theta, poly, { lift: 0.02, rings: 2 });
  const hingeZ = (() => {
    // hinge edge: the edge toward the fuselage centre (hingeSide -1) or away from it (+1) along the section
    const R = fus.radius(x, theta);
    const t = theta + (hingeSide * h) / 2 / R;
    return fus.point(x, t);
  })();
  const pivot = new THREE.Object3D();
  pivot.position.set(hingeZ.x - w / 2, hingeZ.y, hingeZ.z);
  const mesh = new THREE.Mesh(geo, J.skin);
  mesh.position.set(-pivot.position.x, -pivot.position.y, -pivot.position.z);
  pivot.add(mesh);
  root.add(pivot);
  rig.gear.doors.push({ pivot, axis: new THREE.Vector3(1, 0, 0), open });
  void dx; void name;
  return pivot;
}

/**
 * Landing gear: nose gear and mains from the aircraft data (spec.gear) plus the cfg.gear dimensions.
 */
export function buildGear(spec, cfg, J, detail, root, rig, fus) {
  const g = spec.gear;
  const o = cfg.gear;
  const noseLen = o.noseAttachY - g.nose.y;
  const noseLeg = makeJetLeg({
    length: noseLen, wheelR: o.noseWheelR, wheelW: o.noseWheelW, abreast: 2, axles: 1, track: o.noseTrack ?? 0.5, strutR: o.noseStrut ?? 0.07, nose: true,
  }, J, detail);
  noseLeg.position.set(g.nose.x, o.noseAttachY, 0);
  root.add(noseLeg);
  rig.gear.nose = { leg: noseLeg, retract: 1 };
  if (detail > 0) {
    // drag brace and steering collar + taxi light housing
    const brace = new THREE.Mesh(merge([placed(boxGeo(0.06, noseLen * 0.45, 0.07), -0.22, -noseLen * 0.2, 0, 0, 0, 0.5)]), J.gearPaint);
    noseLeg.add(brace);
    const light = new THREE.Mesh(cylinderGeo(0.07, 0.07, 0.05, 10, { axis: 'x' }), J.lensWhite);
    light.position.set(0.14, -noseLen * 0.38, 0);
    noseLeg.userData.lower.add(light);
  }
  const mains = o.mains ?? [];
  const idx = { left: 1, right: 2 };
  const makeMain = (x, z, wheelIndex, side) => {
    const base = side < 0 ? g.mainLeft : g.mainRight;
    const len = o.mainAttachY - base.y;
    const leg = makeJetLeg({
      length: len, wheelR: o.mainWheelR, wheelW: o.mainWheelW, abreast: 2, axles: o.mainAxles ?? 1, axleSpacing: o.mainAxleSpacing ?? 1.2,
      track: o.mainTrack ?? 0.9, strutR: o.mainStrut ?? 0.07, side, stay: (o.stayLen ?? 1.0),
    }, J, detail);
    leg.position.set(x, o.mainAttachY, z);
    root.add(leg);
    rig.gear.mains.push({ leg, wheelIndex, side, retractAngle: o.mainRetract ?? Math.PI / 2 });
    if (detail > 0) {
      // leg door: a thin panel on the outboard face of the strut
      const door = new THREE.Mesh(boxGeo(0.45, len * 0.42, 0.025), J.gearPaint);
      door.position.set(0.05, -len * 0.27, side * 0.16);
      leg.add(door);
    }
    return leg;
  };
  makeMain(g.mainLeft.x, g.mainLeft.z, idx.left, -1);
  makeMain(g.mainRight.x, g.mainRight.z, idx.right, 1);
  for (const m of mains) makeMain(m.x, m.z, m.z < 0 ? idx.left : idx.right, Math.sign(m.z));
  if (detail > 0 && fus && o.doors !== false) {
    // belly doors in transit
    for (const side of [-1, 1]) {
      bellyDoor(fus, J, root, rig, {
        x: g.mainLeft.x, theta: side > 0 ? -Math.PI / 2 + 0.55 : -Math.PI / 2 - 0.55 + 0.0, hingeSide: -side, w: o.doorW ?? 1.8, h: o.doorH ?? 0.6, open: side * 1.2, name: 'main',
      });
    }
    for (const side of [-1, 1]) {
      bellyDoor(fus, J, root, rig, {
        x: g.nose.x - 0.1, theta: -Math.PI / 2 + side * 0.28, hingeSide: side * 1, w: 1.5, h: 0.4, open: -side * 1.1, name: 'nose',
      });
    }
  }
  void clamp;
}
