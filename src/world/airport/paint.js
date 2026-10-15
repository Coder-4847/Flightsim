import { GLYPH_CELL, glyphUV } from './textures.js';

// 2D helpers for ground markings. Coordinates are frame metres: x = u (along the main runway),
// z = v (to its right). All quads face up and sit at height y.

/** Quad from four ground corners, wound to face up. `uvs` as for MeshBuf.quad. */
export function quadUp(buf, p, y, uvs = null, color = 1) {
  const a = (p[1].x - p[0].x) * (p[2].z - p[0].z) - (p[1].z - p[0].z) * (p[2].x - p[0].x);
  // from above: (x right, z toward the viewer) the winding that gives a +Y normal has negative `a` in this expression
  const order = a < 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
  const q = order.map((i) => [p[i].x, y, p[i].z]);
  let t = uvs;
  if (t) { t = []; order.forEach((i) => { t.push(uvs[i * 2], uvs[i * 2 + 1]); }); }
  buf.quad(q[0], q[1], q[2], q[3], t ?? order.flatMap((i) => [p[i].x, p[i].z]), new Array(12).fill(color), [0, 1, 0]);
}

/** Rectangle covering the segment p -> q with the given width, y height. */
export function segment(buf, p, q, w, y, color = 1) {
  const dx = q.x - p.x; const dz = q.z - p.z; const l = Math.hypot(dx, dz);
  if (l < 1e-4) return;
  const nx = (-dz / l) * (w / 2); const nz = (dx / l) * (w / 2);
  quadUp(buf, [{ x: p.x + nx, z: p.z + nz }, { x: q.x + nx, z: q.z + nz }, { x: q.x - nx, z: q.z - nz }, { x: p.x - nx, z: p.z - nz }], y, null, color);
}

/** Polyline as a chain of segments (extended slightly so joints close). */
export function line(buf, pts, w, y, color = 1) {
  for (let i = 1; i < pts.length; i++) segment(buf, pts[i - 1], pts[i], w, y, color);
}

/** Dashed segment p -> q. */
export function dashed(buf, p, q, w, dash, gap, y, color = 1, phase = 0) {
  const dx = q.x - p.x; const dz = q.z - p.z; const l = Math.hypot(dx, dz);
  if (l < 1e-4) return;
  const ux = dx / l; const uz = dz / l;
  for (let s = phase; s < l; s += dash + gap) {
    const e = Math.min(l, s + dash);
    segment(buf, { x: p.x + ux * s, z: p.z + uz * s }, { x: p.x + ux * e, z: p.z + uz * e }, w, y, color);
  }
}

/** Offset a polyline sideways by `d` (positive = to the right of travel in u/v with v to the right). */
export function offsetLine(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x; let tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.push({ x: pts[i].x - tz * d, z: pts[i].z + tx * d });
  }
  return out;
}

/** Replace sharp corners of a polyline by circular arcs of radius R. */
export function roundPath(pts, R, step = 3) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]; const p1 = pts[i]; const p2 = pts[i + 1];
    let ax = p0.x - p1.x; let az = p0.z - p1.z; const al = Math.hypot(ax, az);
    let bx = p2.x - p1.x; let bz = p2.z - p1.z; const bl = Math.hypot(bx, bz);
    ax /= al; az /= al; bx /= bl; bz /= bl;
    const cos = Math.max(-1, Math.min(1, ax * bx + az * bz));
    const ang = Math.acos(cos); // interior angle
    if (ang > Math.PI - 0.02 || ang < 0.05) { out.push(p1); continue; }
    let r = R;
    const t = r / Math.tan(ang / 2);
    const tMax = Math.min(al, bl) * 0.48;
    if (t > tMax) r = tMax * Math.tan(ang / 2);
    const tt = r / Math.tan(ang / 2);
    const A = { x: p1.x + ax * tt, z: p1.z + az * tt };
    const B = { x: p1.x + bx * tt, z: p1.z + bz * tt };
    // arc centre along the bisector
    let mx = ax + bx; let mz = az + bz; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const dc = r / Math.sin(ang / 2);
    const C = { x: p1.x + mx * dc, z: p1.z + mz * dc };
    let a0 = Math.atan2(A.z - C.z, A.x - C.x); let a1 = Math.atan2(B.z - C.z, B.x - C.x);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const n = Math.max(3, Math.ceil((Math.abs(da) * r) / step));
    for (let k = 0; k <= n; k++) { const a = a0 + da * (k / n); out.push({ x: C.x + Math.cos(a) * r, z: C.z + Math.sin(a) * r }); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Concave corner fill: the area between two meeting edges and a circular arc of radius R. */
export function fillet(buf, corner, dirA, dirB, R, y, color = 1, uvScale = 1) {
  // corner C, unit directions along the two edges (pointing away from C); arc centre at C + (dirA + dirB) R
  const O = { x: corner.x + (dirA.x + dirB.x) * R, z: corner.z + (dirA.z + dirB.z) * R };
  const a0 = Math.atan2(corner.z + dirA.z * R - O.z, corner.x + dirA.x * R - O.x);
  const a1 = Math.atan2(corner.z + dirB.z * R - O.z, corner.x + dirB.x * R - O.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const n = 8;
  const base = buf.n;
  buf.vert(corner.x, y, corner.z, 0, 1, 0, corner.x * uvScale, corner.z * uvScale, color);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + da * (k / n);
    const x = O.x + Math.cos(a) * R; const z = O.z + Math.sin(a) * R;
    pts.push(buf.vert(x, y, z, 0, 1, 0, x * uvScale, z * uvScale, color));
  }
  const area = (pts.length ? 1 : 0);
  void area;
  // winding: decide by the sign of the first triangle
  const p0 = { x: corner.x, z: corner.z };
  const p1 = { x: buf.pos[pts[0] * 3], z: buf.pos[pts[0] * 3 + 2] };
  const p2 = { x: buf.pos[pts[1] * 3], z: buf.pos[pts[1] * 3 + 2] };
  const cross = (p1.x - p0.x) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.x - p0.x);
  for (let k = 0; k < n; k++) { if (cross < 0) buf.tri(base, pts[k], pts[k + 1]); else buf.tri(base, pts[k + 1], pts[k]); }
}

/**
 * Painted text. `c` is the centre of the string, `up` the unit direction the glyph tops point to (the
 * reader looks along it); letters run to the reader's right. `height` is the ink height in metres.
 */
export function text(buf, str, c, up, height, y, { gap = 0.22, color = 1 } = {}) {
  const right = { x: -up.z, z: up.x };
  const inkW = height * (GLYPH_CELL.inkW / GLYPH_CELL.inkH);
  const cellH = height * (GLYPH_CELL.h / GLYPH_CELL.inkH);
  const cellW = inkW * (GLYPH_CELL.w / GLYPH_CELL.inkW);
  const adv = inkW * (1 + gap);
  const total = (str.length - 1) * adv;
  [...str].forEach((ch, i) => {
    const uv = glyphUV(ch);
    if (!uv) return;
    const off = -total / 2 + i * adv;
    const cx = c.x + right.x * off; const cz = c.z + right.z * off;
    const hx = (right.x * cellW) / 2; const hz = (right.z * cellW) / 2;
    const vx = (up.x * cellH) / 2; const vz = (up.z * cellH) / 2;
    const BL = { x: cx - hx - vx, z: cz - hz - vz }; const BR = { x: cx + hx - vx, z: cz + hz - vz };
    const TR = { x: cx + hx + vx, z: cz + hz + vz }; const TL = { x: cx - hx + vx, z: cz - hz + vz };
    quadUp(buf, [BL, BR, TR, TL], y, [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], color);
  });
}

/** Width of a painted string. */
export function textWidth(str, height, gap = 0.22) {
  const inkW = height * (GLYPH_CELL.inkW / GLYPH_CELL.inkH);
  return inkW * (1 + gap) * (str.length - 1) + inkW;
}
