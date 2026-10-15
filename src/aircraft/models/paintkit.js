import { sectionAt } from './kit.js';
import { FONT, blot, rgba, shade, streak, rng } from './skins.js';

// Painting recipes shared by the aircraft models: wing/tail atlas panels (control-surface seams, boots, walkways, dirt)
// and common fuselage markings.

const chordAt = (sections, z) => sectionAt(sections, z).chord;
const xfOf = (xf, z) => (typeof xf === 'function' ? xf(z) : xf);

/**
 * Paint one unrolled lifting-surface panel. rect: from AtlasPaint. o:
 *  sections, z0, z1 (painted span), base, under (lower surface colour), tip: {color, len}, seams: [{z0, z1, xf, ends}],
 *  boots: {len (m of skin), color}, walkway: {z0, z1, p0, p1}, dirt (0..1), caps: [{z, p}], stripes: [{p0, p1, color, z0, z1}],
 *  text: [{str, z, p, size, rot, color, upper}], seed
 */
export function paintPanel(rect, o) {
  const R = rng(o.seed ?? 3);
  const cmax = Math.max(...o.sections.map((s) => s.chord)) * 1.06;
  rect.paint((g) => {
    const z0 = o.z0 - 0.05; const z1 = o.z1 + 0.3;
    g.fillStyle = o.base; g.fillRect(z0, 0, z1 - z0, cmax);
    g.fillStyle = o.under ?? shade(o.base, -0.05); g.fillRect(z0, -cmax, z1 - z0, cmax);
    // Colour stripes across the span (as p ranges, mirrored over both surfaces when `both`).
    for (const s of o.stripes ?? []) {
      g.fillStyle = s.color;
      const a = s.z0 ?? z0; const b = s.z1 ?? z1;
      g.fillRect(a, s.p0, b - a, s.p1 - s.p0);
      if (s.both) g.fillRect(a, -s.p1, b - a, s.p1 - s.p0);
    }
    if (o.tip) {
      g.fillStyle = o.tip.color;
      g.fillRect(o.z1 - o.tip.len, -cmax, o.tip.len + 0.4, cmax * 2);
    }
    if (o.boots) {
      const L = o.boots.len;
      g.fillStyle = o.boots.color ?? '#161719';
      const zb0 = o.boots.z0 ?? o.z0; const zb1 = o.boots.z1 ?? o.z1 - 0.05;
      g.fillRect(zb0, -L, zb1 - zb0, L * 2);
      // Boot edge strips and chordwise stitching
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(zb0, L - 0.012, zb1 - zb0, 0.01); g.fillRect(zb0, -L + 0.002, zb1 - zb0, 0.01);
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 0.004;
      for (let zz = zb0; zz < zb1; zz += 0.28) { g.beginPath(); g.moveTo(zz, -L); g.lineTo(zz, L); g.stroke(); }
    }
    // Control-surface seams: dark gap lines along the hinge and at the ends.
    g.strokeStyle = 'rgba(25,28,32,0.8)'; g.lineWidth = 0.0055;
    for (const s of o.seams ?? []) {
      for (const side of [1, -1]) {
        g.beginPath();
        const n = 14;
        for (let i = 0; i <= n; i++) {
          const z = s.z0 + ((s.z1 - s.z0) * i) / n;
          const p = side * chordAt(o.sections, z) * xfOf(s.xf, z);
          if (i) g.lineTo(z, p); else g.moveTo(z, p);
        }
        g.stroke();
        for (const z of [s.z0, s.z1]) {
          if (s.ends === false) continue;
          const c = chordAt(o.sections, z);
          g.beginPath(); g.moveTo(z, side * c * xfOf(s.xf, z)); g.lineTo(z, side * c * 1.01); g.stroke();
        }
      }
      // Soft shadow in the hinge gap for depth
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (const side of [1, -1]) {
        for (let i = 0; i < 12; i++) {
          const z = s.z0 + ((s.z1 - s.z0) * i) / 12;
          g.fillRect(z, side * chordAt(o.sections, z) * xfOf(s.xf, z) - 0.006, (s.z1 - s.z0) / 12 + 0.002, 0.012);
        }
      }
    }
    if (o.walkway) {
      const w = o.walkway;
      g.fillStyle = '#2b2d30'; g.fillRect(w.z0, w.p0, w.z1 - w.z0, w.p1 - w.p0);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = 0; i < 400; i++) g.fillRect(w.z0 + R() * (w.z1 - w.z0), w.p0 + R() * (w.p1 - w.p0), 0.006, 0.006);
      g.strokeStyle = '#d6d6d0'; g.lineWidth = 0.008; g.strokeRect(w.z0, w.p0, w.z1 - w.z0, w.p1 - w.p0);
    }
    for (const c of o.caps ?? []) {
      g.fillStyle = '#2a2d31'; g.beginPath(); g.arc(c.z, c.p, 0.055, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9aa0a6'; g.beginPath(); g.arc(c.z, c.p, 0.045, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#30343a'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(c.z - 0.04, c.p); g.lineTo(c.z + 0.04, c.p); g.stroke();
    }
    // Weathering: leading-edge grime and bugs, soot near the trailing edge, streaks.
    const dirt = o.dirt ?? 0.5;
    for (const side of [1, -1]) {
      for (let z = z0; z < z1; z += 0.06) {
        const c = chordAt(o.sections, Math.min(z, o.z1));
        blot(g, z, side * c * 0.03, 0.12, 0.05, '#3a3326', 0.1 * dirt);
      }
      for (let i = 0; i < 26; i++) {
        const z = z0 + R() * (z1 - z0); const c = chordAt(o.sections, Math.min(z, o.z1));
        streak(g, z, side * c * (0.05 + R() * 0.2), c * (0.4 + R() * 0.5), 0.03 + R() * 0.05, side > 0 ? Math.PI / 2 : -Math.PI / 2, '#4a4a42', (0.04 + R() * 0.06) * dirt);
      }
    }
    // Lower surface is dirtier.
    g.fillStyle = rgba('#3c3a33', 0.07 * dirt); g.fillRect(z0, -cmax, z1 - z0, cmax);
    for (const t of o.text ?? []) {
      g.save();
      g.translate(t.z, t.upper === false ? -t.p : t.p);
      g.rotate(t.rot ?? 0);
      g.scale(1, -1);
      if (t.upper === false) g.scale(1, -1);
      g.fillStyle = t.color ?? '#1a1c20';
      g.font = `bold ${(t.size ?? 0.05) * 100}px ${FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.scale(0.01, 0.01); g.fillText(t.str, 0, 0); g.restore();
      g.restore();
    }
  });
}
