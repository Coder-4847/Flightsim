import * as THREE from 'three';
import { makeLight } from './builders.js';

// Small parts: beacons, tail light, antennas, probes (added to the hull so they hide with it in the cockpit view).

export function addDetails({ cfg, fus, root, rig }) {
  for (const [x, where] of cfg.beacons ?? []) {
    const beacon = makeLight(0xff2a2a, 0.08, 1.6);
    const p = where === 'top' ? fus.point(x, Math.PI / 2) : fus.point(x, -Math.PI / 2);
    beacon.position.set(p.x, p.y + (where === 'top' ? 0.05 : -0.05), 0);
    root.add(beacon);
    rig.lights.beacon.push(beacon);
  }
  const tail = makeLight(0xffffff, 0.07, 1.2);
  const tp = fus.point(fus.xTail + 0.05, Math.PI / 2);
  tail.position.set(tp.x - 0.1, fus.prof(fus.xTail).yc + 0.2, 0);
  root.add(tail);
  rig.lights.nav.push(tail);
  void THREE;
}
