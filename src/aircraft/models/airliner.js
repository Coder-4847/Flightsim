import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MEDIUM } from './builders.js';
import { buildJet } from './jetBuild.js';

// Transports and business jets: Meridian 320 (A320-class), Regional 175 (E175), Stratos G6 (G650), Atlas 300 (777), Titan 400 (747).
// The geometry lives in jetBuild.js and the jet*.js modules (config table in jetConfigs.js). fuselageStations, bodyAt and
// windowGeometry below are the older lofting helpers that the turboprop models (highwing.js) still use.

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

export const buildNarrowbody = (spec, mats, detail) => buildJet(spec, mats, detail, 'narrowbody');
export const buildRegional = (spec, mats, detail) => buildJet(spec, mats, detail, 'regional');
export const buildBizjet = (spec, mats, detail) => buildJet(spec, mats, detail, 'bizjet');
export const buildWidebody = (spec, mats, detail) => buildJet(spec, mats, detail, 'widebody');
export const buildJumbo = (spec, mats, detail) => buildJet(spec, mats, detail, 'jumbo');
