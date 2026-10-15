import * as THREE from 'three';
import {
  DEG, TAU, clamp, merge, ringsGeometry, smooth, sgnPow, std,
} from './jetKit.js';

// Lofted fuselage with an analytic surface S(x, theta) so windows, windscreens, doors and antennas can be laid exactly on
// the skin. theta: 0 = right side (+Z), PI/2 = top, PI = left side, -PI/2 = belly (the texture seam).
// Texture coordinates: u = (x - xTail) / length (tail -> nose), v = (theta + PI/2) / TAU.

const gauss = (d, sigma) => Math.exp(-((d / sigma) ** 2));
const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

export class Fuselage {
  /**
   * cfg: { xTail, xNose, w, top, bot, yc, n, nBot?, nose: {len, p, q, droop, botFull, wPow}, tail: {len, p, q, up, topKeep, tipR},
   *        waist?: {amount, y, width}, bumps?: [{kind, x0, x1, ramp, ramp2, h, sigma, theta}], scale?: [{x, w, h}] }
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.xTail = cfg.xTail;
    this.xNose = cfg.xNose;
    this.length = cfg.xNose - cfg.xTail;
    this.yc = cfg.yc;
    this.xn0 = cfg.xNose - cfg.nose.len;
    this.xt0 = cfg.xTail + cfg.tail.len;
    this._cache = new Map();
  }

  /** Section parameters at station x. */
  prof(x) {
    const c = this.cfg;
    let w = c.w;
    let top = c.top;
    let bot = c.bot;
    let yc = c.yc;
    let wasteScale = 1;
    if (c.scale) {
      let a = c.scale[0];
      let b = c.scale[c.scale.length - 1];
      if (x <= a.x) b = a; else if (x >= b.x) a = b; else {
        for (let i = 0; i < c.scale.length - 1; i++) if (x <= c.scale[i + 1].x) { a = c.scale[i]; b = c.scale[i + 1]; break; }
      }
      const t = a === b ? 0 : (x - a.x) / (b.x - a.x);
      w *= a.w + (b.w - a.w) * t;
      const hs = a.h + (b.h - a.h) * t;
      top *= hs;
      bot *= hs;
      wasteScale = hs;
    }
    let nT = c.n ?? 2.1;
    let nB = c.nBot ?? nT;
    let tipRing = false;
    if (x > this.xn0) {
      const nz = c.nose;
      const s = clamp((x - this.xn0) / nz.len, 0, 1);
      const base = (1 - s ** (nz.p ?? 2.1)) ** (1 / (nz.q ?? 2));
      const f = Math.max(0.004, nz.tipF ? nz.tipF + (1 - nz.tipF) * base : base);
      w *= f ** (nz.wPow ?? 1);
      top *= f ** (nz.topPow ?? 1);
      bot *= f ** (nz.botPow ?? 0.85);
      yc -= (nz.droop ?? 0) * s ** (nz.droopPow ?? 2);
      nT = nB = (c.n ?? 2.1) + (nz.nBoost ?? 0) * 4 * s * (1 - s);
      tipRing = s >= 1;
    } else if (x < this.xt0) {
      const tl = c.tail;
      const s = clamp((this.xt0 - x) / tl.len, 0, 1);
      const base = (1 - s ** (tl.p ?? 1.7)) ** (1 / (tl.q ?? 1.15));
      const f = tl.tipR ? Math.max(tl.tipR / c.w, base) : Math.max(0.004, base);
      w *= f ** (tl.wPow ?? 1);
      top *= f ** (tl.topPow ?? 0.9);
      bot *= f ** (tl.botPow ?? 1.25);
      yc += (tl.up ?? 0) * s ** (tl.upPow ?? 1.6);
      nT = nB = (c.n ?? 2.1) - (tl.nDrop ?? 0.05) * s;
    }
    void tipRing;
    return { w, top, bot, yc, nT, nB, scaleH: wasteScale };
  }

  /** Point on the skin. */
  point(x, theta, out = new THREE.Vector3()) {
    const P = this.prof(x);
    const c = this.cfg;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const nn = st >= 0 ? P.nT : P.nB;
    let z = P.w * sgnPow(ct, 2 / nn);
    let y = (st >= 0 ? P.top : P.bot) * sgnPow(st, 2 / nn);
    if (c.waist) {
      const wa = c.waist;
      z *= 1 - wa.amount * Math.exp(-(((y - wa.y) / wa.width) ** 2));
    }
    y += P.yc;
    if (c.bumps) {
      for (const b of c.bumps) {
        if (x < b.x0 || x > b.x1) continue;
        const f = smooth((x - b.x0) / (b.ramp ?? 4)) * smooth((b.x1 - x) / (b.ramp2 ?? b.ramp ?? 4));
        const g = gauss(wrapAngle(theta - b.theta), b.sigma);
        y += (b.theta > 0 ? 1 : -1) * b.h * f * g * (b.scaleByH ? P.scaleH : 1);
        if (b.wide) z *= 1 + b.wide * f * g;
      }
    }
    return out.set(x, y, z);
  }

  /** Outward unit normal at (x, theta) by finite differences. */
  normal(x, theta, out = new THREE.Vector3()) {
    const dx = 0.02;
    const dt = 0.01;
    const a = this.point(x + dx, theta);
    const b = this.point(x - dx, theta);
    const c = this.point(x, theta + dt);
    const d = this.point(x, theta - dt);
    const tx = a.sub(b);
    const tt = c.sub(d);
    out.copy(tt).cross(tx).normalize(); // (dP/dtheta) x (dP/dx)
    // Make sure it points away from the axis.
    const p = this.point(x, theta);
    const axisY = this.prof(x).yc;
    if (out.y * (p.y - axisY) + out.z * p.z < 0) out.negate();
    return out;
  }

  /** Metres of skin per radian around the section at (x, theta). */
  radius(x, theta) {
    const c = this.point(x, theta + 0.01);
    const d = this.point(x, theta - 0.01);
    return c.distanceTo(d) / 0.02;
  }

  /** theta on the given side (+1 right, -1 left) where the skin is at height y (absolute) at station x. */
  thetaForY(x, y, side = 1) {
    let lo = -Math.PI / 2;
    let hi = Math.PI / 2;
    const p = new THREE.Vector3();
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      this.point(x, mid, p);
      if (p.y < y) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    return side > 0 ? t : Math.PI - t;
  }

  /** Texture coordinate of the skin point at (x, theta). */
  uv(x, theta) {
    return [(x - this.xTail) / this.length, (wrapNeg(theta) + Math.PI / 2) / TAU];
  }

  /** Texture coordinate of the skin at height y on one side: [u, v]. */
  uvAt(x, y, side) { return this.uv(x, this.thetaForY(x, y, side)); }

  halfWidth(x) { return this.prof(x).w; }
  topY(x) { const P = this.prof(x); return P.yc + P.top; }
  bottomY(x) { const P = this.prof(x); return P.yc - P.bot; }

  /** x positions of the rings for a detail level. */
  xSamples(detail) {
    const c = this.cfg;
    const dens = [0.3, 0.42, 1.1][detail];
    const xs = [];
    const nN = Math.max(5, Math.round(c.nose.len * 4.2 * dens));
    const nT = Math.max(4, Math.round(c.tail.len * 2.4 * dens));
    const cylLen = this.xn0 - this.xt0;
    const nC = Math.max(2, Math.round(cylLen * 0.95 * dens));
    for (let i = 0; i <= nT; i++) xs.push(this.xt0 - c.tail.len * Math.sin(((i / nT) * Math.PI) / 2));
    for (let i = 1; i < nC; i++) xs.push(this.xt0 + (cylLen * i) / nC);
    for (let i = 0; i <= nN; i++) xs.push(this.xn0 + c.nose.len * Math.sin(((i / nN) * Math.PI) / 2));
    // Bump ramps add stations so the hump does not alias.
    if (c.bumps) {
      for (const b of c.bumps) {
        const steps = Math.round(8 * dens);
        for (let i = 0; i <= steps; i++) {
          xs.push(b.x0 + ((b.ramp ?? 4) * i) / steps);
          xs.push(b.x1 - ((b.ramp2 ?? b.ramp ?? 4) * i) / steps);
        }
      }
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (const x of xs) if (!out.length || x - out[out.length - 1] > 0.02) out.push(x);
    out[0] = this.xTail;
    out[out.length - 1] = this.xNose;
    return out;
  }

  geometry(detail) {
    const segs = [12, 30, 60][detail];
    const xs = this.xSamples(detail);
    const rings = [];
    const p = new THREE.Vector3();
    for (const x of xs) {
      const ring = [];
      for (let s = 0; s <= segs; s++) {
        const theta = -Math.PI / 2 + (s / segs) * TAU;
        this.point(x, theta, p);
        ring.push([p.x, p.y, p.z, (x - this.xTail) / this.length, s / segs]);
      }
      rings.push(ring);
    }
    const geo = ringsGeometry(rings, {
      crease: 60,
      outward: (v) => new THREE.Vector3(0, v.y - this.yc, v.z),
    });
    return geo;
  }

  /** The closing disc at the tail end (exhaust) as geometry; position & radius from the last ring. */
  tailEnd() {
    const P = this.prof(this.xTail);
    const g = new THREE.CircleGeometry(Math.max(P.w, P.top) * 1.0, 16);
    g.rotateY(-Math.PI / 2);
    g.translate(this.xTail, P.yc, 0);
    return std(g);
  }

  /**
   * A convex polygon (offsets [dx, ds] in metres from the centre, ds along increasing theta) laid on the skin at (x, theta),
   * lifted along the normal. Subdivided into concentric rings so it follows the curvature.
   */
  patch(x, theta, polyIn, { lift = 0.004, rings = 3, centre = null, maxSeg = 0.14 } = {}) {
    const R = this.radius(x, theta);
    const cen = centre ?? [0, 0];
    // Resample the outline so long edges follow the curvature of the skin.
    const poly = [];
    for (let i = 0; i < polyIn.length; i++) {
      const a = polyIn[i];
      const b = polyIn[(i + 1) % polyIn.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
      for (let k = 0; k < n; k++) poly.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    const M = poly.length;
    const pos = [];
    const nor = [];
    const uvs = [];
    const idx = [];
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const place = (dx, ds) => {
      const xx = x + dx;
      const th = theta + ds / R;
      this.point(xx, th, p);
      this.normal(xx, th, n);
      pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift);
      nor.push(n.x, n.y, n.z);
      const [u, v] = this.uv(xx, th);
      uvs.push(u, v);
    };
    place(cen[0], cen[1]);
    for (let k = 1; k <= rings; k++) {
      const f = k / rings;
      for (let i = 0; i < M; i++) place(cen[0] + (poly[i][0] - cen[0]) * f, cen[1] + (poly[i][1] - cen[1]) * f);
    }
    for (let i = 0; i < M; i++) idx.push(0, 1 + i, 1 + ((i + 1) % M));
    for (let k = 1; k < rings; k++) {
      const a0 = 1 + (k - 1) * M;
      const b0 = 1 + k * M;
      for (let i = 0; i < M; i++) {
        const i2 = (i + 1) % M;
        idx.push(a0 + i, b0 + i, a0 + i2, a0 + i2, b0 + i, b0 + i2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    // Orient: geometric normal of the first triangle should agree with the surface normal.
    const a = new THREE.Vector3().fromArray(pos, 0);
    const b = new THREE.Vector3().fromArray(pos, 3 * idx[1]);
    const c = new THREE.Vector3().fromArray(pos, 3 * idx[2]);
    const gn = b.sub(a).cross(c.sub(a));
    if (gn.dot(new THREE.Vector3(nor[0], nor[1], nor[2])) < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      geo.setIndex(idx);
    }
    return geo.toNonIndexed();
  }

  /** Patch on one side at height y: dx, dy offsets are in metres, up positive on both sides. */
  sidePatch(side, x, y, poly, opts = {}) {
    const theta = this.thetaForY(x, y, side);
    const fixed = side > 0 ? poly : poly.map(([a, b]) => [a, -b]);
    return this.patch(x, theta, fixed, opts);
  }
}

const wrapNeg = (t) => {
  // Map theta into [-PI/2, 3PI/2).
  let a = t;
  while (a < -Math.PI / 2) a += TAU;
  while (a >= (3 * Math.PI) / 2) a -= TAU;
  return a;
};

/** Outline helpers (offsets [dx, ds]) for the patches. */
export function rrect(w, h, r, steps = 3) {
  const out = [];
  const rr = Math.min(r, w / 2, h / 2);
  const cs = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 90], [-w / 2 + rr, -h / 2 + rr, 180], [w / 2 - rr, -h / 2 + rr, 270]];
  for (const [cx, cy, a0] of cs) {
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + (90 * i) / steps) * DEG;
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return out;
}

export function ellipse(w, h, n = 14) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; out.push([Math.cos(a) * w / 2, Math.sin(a) * h / 2]); }
  return out;
}

export function scalePoly(poly, f, g = f) { return poly.map(([a, b]) => [a * f, b * g]); }

export { merge };
