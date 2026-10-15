import { hash2 } from '../util/random.js';

// Lakes are discs of radius `radius` made irregular: the shore radius varies with the angle by a
// few low harmonics (fixed per lake), so lakes read as natural shapes from the air. Every module
// that needs the shore (carving, water mesh, wetness, clearance) uses these two functions.

function phases(l) {
  if (!l.sh) {
    const k = Math.round(l.x) * 31 + Math.round(l.z);
    l.sh = [hash2(k, 1, 5) * 6.283, hash2(k, 2, 5) * 6.283, hash2(k, 3, 5) * 6.283, hash2(k, 4, 5) * 6.283];
  }
  return l.sh;
}

/** Shore radius factor (about 0.65..1.35) in direction `theta`. */
export function lakeFactor(l, theta) {
  const p = phases(l);
  return 1 + 0.15 * Math.sin(2 * theta + p[0]) + 0.1 * Math.sin(3 * theta + p[1]) + 0.07 * Math.sin(5 * theta + p[2]) + 0.04 * Math.sin(8 * theta + p[3]);
}

/** Normalised distance from the lake centre: 1 at the shore, 0 at the centre. */
export function lakeD(l, dx, dz) {
  return Math.hypot(dx, dz) / (l.radius * lakeFactor(l, Math.atan2(dz, dx)));
}
