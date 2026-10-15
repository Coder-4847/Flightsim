import * as THREE from 'three';
import { DEG, patchOutline } from './kit.js';
import { BodyPaint, mottle, shade, texSize, attachMap, rgba } from './skins.js';

// Declarative fuselage livery painter shared by the civil aircraft and the jets.
// All coordinates are (x metres, angle degrees on the RIGHT side: -90 belly, 0 side, 90 top); the left side mirrors them.

export const rad = (q) => q.map(([x, a]) => [x, a * DEG]);
export const mirrorQuad = (q) => q.map(([x, a]) => [x, 180 - a]);
export const quadAt = (xc, hl, a0, a1) => [[xc - hl, a0], [xc + hl, a0], [xc + hl, a1], [xc - hl, a1]];
const A = (a, flip) => (flip ? 180 - a : a);

/**
 * Options: base, belly (colour), bellyAngle (deg, default -28), ribbons: [{lo(x), hi(x), color, x0, x1}], windows: [quad, ...]
 * (both sides, painted as dark frames), frames: [{quad, fill}], single: [quad] (one-sided painted quads, right side only),
 * seams: [[x0,a0,x1,a1]] (both sides), ring seams: [x] circumferential, regs: [{x, a, size, color, str, stretch}], stencils,
 * dirt: {streaks: [{x, a, len, w, alpha}], mottle: alpha}, extra: (P, flip) => void.
 */
export function paintBody(mats, body, spec, o) {
  const W = texSize(mats, o.W ?? 2048);
  const P = new BodyPaint(body, { W, H: o.H ?? W / 2 });
  const g = P.g;
  const base = o.base ?? spec.livery.base;
  P.fill(base);
  if (o.belly) {
    const a = o.bellyAngle ?? -28;
    P.band(-90, a, o.belly);
    const y0 = P.py((a - 14) * DEG); const y1 = P.py(a * DEG);
    const grad = g.createLinearGradient(0, y1, 0, y0);
    grad.addColorStop(0, rgba(o.belly, 1)); grad.addColorStop(1, rgba(o.belly, 0));
    g.fillStyle = grad; g.fillRect(0, y0, P.W, y1 - y0);
  }
  for (const flip of [false, true]) {
    for (const r of o.ribbons ?? []) {
      const xa = r.x0 ?? P.x0; const xb = r.x1 ?? P.x1;
      const lo = []; const hi = [];
      for (let i = 0; i <= 90; i++) {
        const x = xa + ((xb - xa) * i) / 90;
        lo.push([x, A(r.lo(x), flip)]); hi.push([x, A(r.hi(x), flip)]);
      }
      P.poly([...lo, ...hi.reverse()], r.color, r.alpha ?? 1);
    }
  }
  for (const r of o.rings ?? []) P.seam(r, -90, r, 270, 'rgba(32,36,42,0.6)', 1.7);
  for (const flip of [false, true]) {
    for (const s of o.seams ?? []) P.seam(s[0], A(s[1], flip), s[2], A(s[3], flip), s[4] ?? 'rgba(32,36,42,0.7)', s[5] ?? 1.6);
    for (const bl of o.blobs ?? []) P.blob(bl.x, A(bl.a, flip), bl.rx, bl.ry, bl.color, bl.alpha);
  }
  const frame = (q, fill = '#15171b') => P.quad(q, patchOutline(rad(q), { p: o.windowP ?? 4, n: 48 }), { fill, stroke: '#0e0f11', width: o.frameWidth ?? 3 });
  for (const q of o.windows ?? []) { frame(q); frame(mirrorQuad(q)); }
  for (const q of o.single ?? []) frame(q);
  for (const f of o.frames ?? []) { frame(f.quad, f.fill); if (f.both !== false) frame(mirrorQuad(f.quad), f.fill); }
  for (const l of o.lines ?? []) {
    g.strokeStyle = l.color ?? '#0e0f11'; g.lineWidth = l.width ?? 5;
    g.beginPath(); g.moveTo(P.px(l.x0), P.py(l.a0 * DEG)); g.lineTo(P.px(l.x1), P.py(l.a1 * DEG)); g.stroke();
  }
  for (const t of o.regs ?? []) {
    for (const s of [1, -1]) P.text(t.str ?? spec.registration, t.x, t.a, s, t.size, { color: t.color ?? spec.livery.regColor ?? '#1a2230', stretch: t.stretch ?? 1, alpha: t.alpha ?? 1, weight: t.weight ?? 'bold' });
  }
  for (const t of o.stencils ?? []) {
    for (const s of t.sides ?? [1, -1]) P.text(t.str, t.x, t.a, s, t.size ?? 0.04, { color: t.color ?? '#2a2e34', alpha: t.alpha ?? 0.8, weight: t.weight ?? 'bold', stretch: t.stretch ?? 1 });
  }
  for (const d of o.dirt?.streaks ?? []) {
    for (const flip of [false, true]) P.airflowStreak(d.x, A(d.a, flip), d.len, d.w, d.color ?? '#2a251c', d.alpha ?? 0.25);
  }
  if (o.dirt?.mottle) mottle(g, P.W, P.H, o.dirt.color ?? '#7a7466', o.dirt.mottle, 9, 17);
  for (const b of o.ao ?? []) P.blob(b.x, b.a, b.rx, b.ry, '#000', b.alpha ?? 0.12);
  o.extra?.(P);
  const tex = P.texture();
  attachMap(mats.skin, tex);
  return tex;
}

export { shade, texSize, THREE };
