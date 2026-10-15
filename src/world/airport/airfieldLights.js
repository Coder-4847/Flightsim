import { MODE } from './lightField.js';
import { endBasis, ptST, roundPath } from './paint.js';

// Places the airfield lighting: runway edge, centreline, threshold and end lights, approach systems,
// PAPI, REILs, taxiway edge and centreline lights, stop bars. Frame coordinates (x = u, z = v).

const DEG = Math.PI / 180;

export function addAirfieldLights(set, { a, layout }) {
  const cls = a.cls;
  const out = { papi: [], als: [], stopBars: [] };
  const spec = a.spec;
  for (const info of layout.runways) {
    if (!info.paved) continue;
    const { rw, W, L } = info;
    const dirR = { x: Math.cos(info.rel * DEG), z: Math.sin(info.rel * DEG) };
    const rightR = { x: -dirR.z, z: dirR.x };
    const pc = (s, t) => ({ x: info.cu + dirR.x * s + rightR.x * t, z: info.cv + dirR.z * s + rightR.z * t });
    const zone = Math.min(600, L / 3);
    // edge lights every 60 m; the last stretch is amber when seen from the landing direction
    for (let s = -L / 2; s <= L / 2 + 0.1; s += 60) {
      for (const sd of [-1, 1]) {
        const p = pc(s, sd * (W / 2 + 1.6));
        const nearA = s < -L / 2 + zone; const nearB = s > L / 2 - zone;
        if (!nearA && !nearB) { set.add(p.x, 0.45, p.z, { color: 'white', size: 0.3, int: 0.9, day: 0.15 }); continue; }
        // amber toward a pilot rolling/landing toward this end, white the other way
        const toward = nearB ? 1 : -1; // landing direction that ends here
        const dv = [dirR.x * toward, 0.05, dirR.z * toward];
        const dvOpp = [-dv[0], 0.05, -dv[2]];
        set.add(p.x, 0.45, p.z, { color: 'amber', size: 0.3, int: 0.9, day: 0.15, dir: [-dv[0], 0.05, -dv[2]], k: 0.6 });
        set.add(p.x, 0.45, p.z, { color: 'white', size: 0.3, int: 0.9, day: 0.15, dir: [-dvOpp[0], 0.05, -dvOpp[2]], k: 0.6 });
      }
    }
    // centreline lights (flush), white with red toward the end
    if (cls === 'hub' || (cls === 'regional' && info.main)) {
      const step = cls === 'hub' ? 15 : 30;
      for (let s = -L / 2 + 15; s <= L / 2 - 14; s += step) {
        const p = pc(s, 0);
        const dEnd = Math.min(s + L / 2, L / 2 - s);
        if (dEnd > 300) { set.add(p.x, 0.06, p.z, { color: 'white', size: 0.2, int: 0.7, day: 0.12 }); continue; }
        const toward = s > 0 ? 1 : -1;
        set.add(p.x, 0.06, p.z, { color: 'red', size: 0.2, int: 0.7, day: 0.12, dir: [-dirR.x * toward, 0.2, -dirR.z * toward], k: 0.8 });
        set.add(p.x, 0.06, p.z, { color: 'white', size: 0.2, int: 0.7, day: 0.12, dir: [dirR.x * toward, 0.2, dirR.z * toward], k: 0.8 });
      }
    }
    rw.ends.forEach((end, i) => {
      const B = endBasis(layout, info, i);
      const out3 = [-B.dir.x, 0.12, -B.dir.z]; const in3 = [B.dir.x, 0.12, B.dir.z];
      // threshold (green, facing the approach) and end (red, facing the runway) rows
      for (let t = -W / 2 + 1; t <= W / 2 - 0.9; t += cls === 'hub' ? 2.5 : 3.5) {
        const g = ptST(B, 0.8, t); const r = ptST(B, -1.2, t);
        set.add(g.x, 0.3, g.z, { color: 'green', size: 0.32, int: 1.2, day: 0.3, dir: out3, k: 2.2, minK: 1.3 });
        set.add(r.x, 0.3, r.z, { color: 'red', size: 0.3, int: 1.0, day: 0.25, dir: in3, k: 2.2 });
      }
      // threshold wing bars outside the edges
      for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {
        const g = ptST(B, 0.8, sd * (W / 2 + 3 + k * 1.6));
        set.add(g.x, 0.3, g.z, { color: 'green', size: 0.32, int: 1.2, day: 0.3, dir: out3, k: 2.2, minK: 1.3 });
      }
      // approach lighting
      if (spec.approachLights && end.ils) {
        const reach = cls === 'hub' ? 900 : 420;
        for (let s = 30; s <= reach; s += 30) {
          const idx = (reach - s) / 30;
          const bar = s === 300 || s === 150 || s === 600;
          for (let t = -2; t <= 2; t += 1) {
            const p = ptST(B, -s, t);
            set.add(p.x, 1.3, p.z, { color: 'white', size: 0.34, int: 1.5, day: 0.55, dir: out3, k: 1.6, minK: 1.3 });
          }
          if (cls === 'hub' && (s === 300 || s === 150)) {
            for (let t = -14; t <= 14; t += 1.6) if (Math.abs(t) > 2.5) {
              const p = ptST(B, -s, t);
              set.add(p.x, 1.3, p.z, { color: 'white', size: 0.34, int: 1.4, day: 0.5, dir: out3, k: 1.6 });
            }
          }
          if (cls === 'hub' && s <= 270) for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) {
            const p = ptST(B, -s, sd * (6 + k * 1.5));
            if (s % 60 === 0 && s <= 240) set.add(p.x, 1.3, p.z, { color: 'red', size: 0.3, int: 1.3, day: 0.5, dir: out3, k: 1.8 });
          }
          if (s >= 60 && (cls === 'hub' || s >= 120)) {
            const p = ptST(B, -s, 0);
            set.add(p.x, 1.8, p.z, { color: 'strobe', size: 0.55, int: 1.0, day: 0.9, dir: out3, k: 1.2, mode: MODE.SEQ, phase: idx, minK: 2.0 });
          }
          void bar;
        }
        out.als.push({ B, reach });
      } else if (cls !== 'hub') {
        // runway end identifier lights
        for (const sd of [-1, 1]) {
          const p = ptST(B, -2, sd * (W / 2 + 9));
          set.add(p.x, 0.9, p.z, { color: 'strobe', size: 0.5, int: 1, day: 0.9, dir: out3, k: 1.5, mode: MODE.SYNC, minK: 2.0 });
        }
      }
      // PAPI: four units, left of the runway as the pilot sees it, 300 m from the threshold
      if (spec.papi && (cls !== 'small' || i === 0 || L > 1000)) {
        const gs = (end.ils?.glideslope ?? 3.0);
        const units = [];
        for (let k = 0; k < 4; k++) {
          const t = -(W / 2 + 15 + (3 - k) * 9);
          const p = ptST(B, 300, t);
          const thr = gs + [-0.5, -0.17, 0.17, 0.5][k];
          // k = 0 is the outermost unit (lowest angle); the one nearest the runway needs the highest
          set.add(p.x - B.dir.x * 1.1, 0.8, p.z - B.dir.z * 1.1, { color: 'white', size: 0.95, int: 1.5, day: 1, dir: [-B.dir.x, 0, -B.dir.z], k: 0, mode: MODE.PAPI, thr, minK: 2.6 });
          units.push({ x: p.x, z: p.z, dirx: -B.dir.x, dirz: -B.dir.z });
        }
        out.papi.push({ units, B });
      }
    });
  }

  // ---- taxiway lights --------------------------------------------------------------------------------------------
  const full = cls === 'hub' || cls === 'regional';
  for (const t of layout.taxiways) {
    if (t.render === false || t.kind === 'track') continue;
    let pts = t.pts.map((p) => ({ x: p.u, z: p.v }));
    if (t.round) pts = roundPath(pts, t.round, 2.5);
    // resample at constant spacing
    const resample = (list, step) => {
      const res = []; let acc = 0; let next = 0;
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1]; const q = list[i]; const len = Math.hypot(q.x - p.x, q.z - p.z);
        if (len < 1e-6) continue;
        while (next <= acc + len) {
          const d = next - acc;
          res.push({ x: p.x + ((q.x - p.x) * d) / len, z: p.z + ((q.z - p.z) * d) / len, tx: (q.x - p.x) / len, tz: (q.z - p.z) / len });
          next += step;
        }
        acc += len;
      }
      return res;
    };
    for (const s of resample(pts, full ? 25 : 30)) {
      for (const sd of [-1, 1]) set.add(s.x - s.tz * sd * (t.half + 1.3), 0.32, s.z + s.tx * sd * (t.half + 1.3), { color: 'blue', size: 0.26, int: 0.85, day: 0.08 });
    }
    if (full) for (const s of resample(pts, 15)) set.add(s.x, 0.05, s.z, { color: 'green', size: 0.2, int: 0.8, day: 0.08 });
  }
  // stop bars at the hold lines
  if (full) {
    for (const h of layout.holds) {
      const n = { x: h.nu, z: h.nv }; const m = { x: -n.z, z: n.x };
      for (let t = -h.half + 1; t <= h.half - 0.9; t += 3) {
        set.add(h.u - n.x * 1.4 + m.x * t, 0.05, h.v - n.z * 1.4 + m.z * t, { color: 'red', size: 0.22, int: 0.9, day: 0.12, dir: [-n.x, 0.1, -n.z], k: 1.5 });
      }
      out.stopBars.push(h);
    }
  }
  return out;
}
