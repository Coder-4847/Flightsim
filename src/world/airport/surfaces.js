import { BufSet } from './mesh.js';
import * as P from './paint.js';

// Pavement, ground cover and every painted marking of an airport, written into one MeshBuf per material.
// Frame coordinates: x = u (along the main runway heading), z = v (to its right), y up (metres).

const DEG = Math.PI / 180;
export const Y = { ground: 0.03, asphalt: 0.06, concrete: 0.066, patch: 0.072, decal: 0.078, paint: 0.09, paintHi: 0.092, glyph: 0.095 };

const sCurve = (p0, d0, p1, d1, k, n = 12) => {
  const c0 = { x: p0.x + d0.x * k, z: p0.z + d0.z * k }; const c1 = { x: p1.x - d1.x * k, z: p1.z - d1.z * k };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; const m = 1 - t;
    out.push({
      x: m * m * m * p0.x + 3 * m * m * t * c0.x + 3 * m * t * t * c1.x + t * t * t * p1.x,
      z: m * m * m * p0.z + 3 * m * m * t * c0.z + 3 * m * t * t * c1.z + t * t * t * p1.z,
    });
  }
  return out;
};

/** Stripe count of the threshold marking by runway width. */
const stripeCount = (w) => (w >= 55 ? 16 : w >= 40 ? 12 : w >= 28 ? 8 : w >= 20 ? 6 : 4);

export function buildSurfaces({ a, layout, rng, style, biome }) {
  const bufs = new BufSet();
  const asp = bufs.get('asphalt'); const con = bufs.get('concrete'); const grv = bufs.get('gravel');
  const inf = bufs.get('infield'); const pw = bufs.get('paintW'); const py = bufs.get('paintY'); const pr = bufs.get('paintR');
  const gw = bufs.get('glyphW'); const gy = bufs.get('glyphY');
  const rub = bufs.get('rubber'); const stk = bufs.get('streak');
  const { frame, plan } = layout;
  const cls = a.cls;

  // ---- ground cover --------------------------------------------------------------------------------------------------
  const rwInfo = layout.runways;
  rwInfo.forEach((info, idx) => {
    const dirR = { x: Math.cos(info.rel * DEG), z: Math.sin(info.rel * DEG) };
    const rightR = { x: -dirR.z, z: dirR.x };
    const c = { x: info.cu, z: info.cv };
    const grass = !info.paved;
    const len = info.L + (info.paved ? 260 : 90);
    const wid = grass ? info.W + 56 : cls === 'hub' ? 250 : cls === 'regional' ? 170 : 110;
    const y = Y.ground + idx * 0.004;
    const P = (s, t) => ({ x: c.x + dirR.x * s + rightR.x * t, z: c.z + dirR.z * s + rightR.z * t });
    const corners = [P(-len / 2, -wid / 2), P(len / 2, -wid / 2), P(len / 2, wid / 2), P(-len / 2, wid / 2)];
    const uv = [-wid / 2 / 12, -len / 2 / 12, -wid / 2 / 12 + 0, 0]; void uv;
    const uvs = [-wid / 24, -len / 24, -wid / 24, len / 24, wid / 24, len / 24, wid / 24, -len / 24];
    // corners: (s-,t-), (s+,t-), (s+,t+), (s-,t+); uv = (t, s)/12
    P2quad(inf, corners, y, [uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7]]);
    if (grass) {
      // mown strip: lighter, stripes along the runway
      const wm = info.W;
      const cs = [P(-info.L / 2, -wm / 2), P(info.L / 2, -wm / 2), P(info.L / 2, wm / 2), P(-info.L / 2, wm / 2)];
      P2quad(bufs.get('strip'), cs, y + 0.012, [-wm / 24, -info.L / 24, -wm / 24, info.L / 24, wm / 24, info.L / 24, wm / 24, -info.L / 24]);
    }
  });
  function P2quad(buf, cs, y, uvs) {
    P.quadUp(buf, cs, y, [uvs[0] + 7, uvs[1] + 3, uvs[2] + 7, uvs[3] + 3, uvs[4] + 7, uvs[5] + 3, uvs[6] + 7, uvs[7] + 3], 1);
  }

  // ---- runway pavement ---------------------------------------------------------------------------------------------------
  for (const info of rwInfo) {
    if (!info.paved) continue;
    const dirR = { x: Math.cos(info.rel * DEG), z: Math.sin(info.rel * DEG) };
    const half = info.L / 2 + 60;
    const pts = [{ x: info.cu - dirR.x * half, z: info.cv - dirR.z * half }, { x: info.cu + dirR.x * half, z: info.cv + dirR.z * half }];
    asp.ribbon(pts, info.W / 2, Y.asphalt, { shoulder: plan.shoulder, shoulderShade: 0.8, uvScale: 1 });
  }

  // ---- taxiways ------------------------------------------------------------------------------------------------------------
  for (const t of layout.taxiways) {
    if (t.render === false) continue;
    let pts = t.pts.map((p) => ({ x: p.u, z: p.v }));
    if (t.round) pts = P.roundPath(pts, t.round, 2.5);
    if (t.kind === 'track') { grv.ribbon(pts, t.half, Y.asphalt, { color: 0.9 }); continue; }
    asp.ribbon(pts, t.half, Y.asphalt + 0.001, { shoulder: plan.shoulder * 0.55, shoulderShade: 0.82 });
  }
  // fillets where perpendicular connectors meet the runway edge
  for (const t of layout.taxiways) {
    if (t.kind !== 'connector' || t.runway === undefined) continue;
    const info = rwInfo.find((r) => r.rw.name === t.runway);
    if (!info || Math.abs(info.rel) > 1) continue;
    const e = t.pts[t.pts.length - 1]; const s0 = t.pts[0];
    if (Math.abs(e.u - s0.u) > 0.5) continue; // only straight perpendicular connectors
    const toward = Math.sign(s0.v - e.v); // direction from the runway toward the taxiway
    const R = cls === 'hub' ? 28 : cls === 'regional' ? 22 : 15;
    for (const sd of [-1, 1]) {
      P.fillet(asp, { x: e.u + sd * t.half, z: e.v }, { x: sd, z: 0 }, { x: 0, z: toward }, R, Y.asphalt + 0.001, 1, 1);
    }
  }

  // ---- aprons ------------------------------------------------------------------------------------------------------------------
  for (const ap of layout.aprons) {
    const buf = ap.surface === 'concrete' ? con : ap.surface === 'gravel' ? grv : asp;
    const y = ap.surface === 'concrete' ? Y.concrete : Y.asphalt + 0.002;
    buf.flat(ap.u0, ap.v0, ap.u1, ap.v1, y);
  }

  // ---- paint: runways --------------------------------------------------------------------------------------------------------------
  const wearBoost = style.wear;
  for (const info of rwInfo) {
    const { rw } = info;
    const dirR = { x: Math.cos(info.rel * DEG), z: Math.sin(info.rel * DEG) };
    const rightR = { x: -dirR.z, z: dirR.x };
    const c = { x: info.cu, z: info.cv };
    const pc = (s, t) => ({ x: c.x + dirR.x * s + rightR.x * t, z: c.z + dirR.z * s + rightR.z * t });
    const W = info.W; const L = info.L;
    const big = W >= 45;

    if (!info.paved) {
      // grass / dirt strip: threshold bars, numbers, a few boundary markers
      rw.ends.forEach((end, i) => {
        const B = endBasis(layout, info, i);
        P.quadUp(pw, [pt(B, 8, -W / 2 + 2), pt(B, 8, W / 2 - 2), pt(B, 9.4, W / 2 - 2), pt(B, 9.4, -W / 2 + 2)], Y.paint);
        for (const sd of [-1, 1]) P.quadUp(pw, [pt(B, 8, sd * (W / 2 - 2)), pt(B, 14, sd * (W / 2 - 2)), pt(B, 14, sd * (W / 2 - 3.4)), pt(B, 8, sd * (W / 2 - 3.4))], Y.paint);
        P.text(gw, `${end.id.replace(/\D/g, '')}`, pt(B, 22, 0), B.dir, 4.2, Y.glyph);
      });
      // faint centre mark
      P.dashed(pw, pc(-L / 2 + 40, 0), pc(L / 2 - 40, 0), 0.25, 6, 14, Y.paint);
      continue;
    }

    // exits and connectors open the runway edge line
    const gaps = { '-1': [], '1': [] };
    for (const t of layout.taxiways) {
      if (t.runway !== rw.name) continue;
      const samples = [];
      for (let k = 1; k < t.pts.length; k++) {
        const p = t.pts[k - 1]; const q = t.pts[k];
        const n = Math.max(1, Math.ceil(Math.hypot(q.u - p.u, q.v - p.v)));
        for (let j = 0; j <= n; j++) samples.push({ x: p.u + ((q.u - p.u) * j) / n, z: p.v + ((q.v - p.v) * j) / n });
      }
      const near = { '-1': [], '1': [] };
      for (const sp of samples) {
        const dx = sp.x - c.x; const dz = sp.z - c.z;
        const sl = dx * dirR.x + dz * dirR.z; const tl = dx * rightR.x + dz * rightR.z;
        if (Math.abs(tl) >= W / 2 - 2 && Math.abs(tl) <= W / 2 + 14 && Math.abs(sl) < L / 2 + 20) near[tl < 0 ? '-1' : '1'].push(sl);
      }
      for (const sg of ['-1', '1']) {
        const arr = near[sg].sort((m, n) => m - n);
        let start = 0;
        for (let k = 1; k <= arr.length; k++) {
          if (k === arr.length || arr[k] - arr[k - 1] > 30) {
            gaps[sg].push([arr[start] - t.half * 0.95, arr[k - 1] + t.half * 0.95]);
            start = k;
          }
        }
      }
    }
    // edge lines
    const lw = big ? 0.9 : 0.45;
    for (const sg of [-1, 1]) {
      const list = gaps[String(sg)].sort((m, n) => m[0] - n[0]);
      let s0 = -L / 2;
      const segs = [];
      for (const [g0, g1] of list) { if (g0 > s0) segs.push([s0, Math.min(g0, L / 2)]); s0 = Math.max(s0, g1); }
      if (s0 < L / 2) segs.push([s0, L / 2]);
      for (const [x0, x1] of segs) if (x1 - x0 > 1) P.segment(pw, pc(x0, sg * (W / 2 - 1.6)), pc(x1, sg * (W / 2 - 1.6)), lw, Y.paint);
    }
    // centreline dashes: 30 m dash, 20 m gap, symmetric about the middle
    const cw = big ? 0.9 : 0.45;
    const start = 100; const usable = L - 2 * start;
    const nD = Math.max(1, Math.floor((usable + 20) / 50));
    const span = nD * 50 - 20; const off0 = -span / 2;
    for (let k = 0; k < nD; k++) P.segment(pw, pc(off0 + k * 50, 0), pc(off0 + k * 50 + 30, 0), cw, Y.paint);

    // each end
    rw.ends.forEach((end, i) => {
      const B = endBasis(layout, info, i);
      const prec = !!end.ils;
      // threshold stripes
      const n = stripeCount(W);
      const usable2 = W - 7; const pitch = usable2 / n;
      for (let k = 0; k < n; k++) {
        const t = -usable2 / 2 + pitch * (k + 0.5);
        P.quadUp(pw, [pt(B, 6, t - 0.9), pt(B, 36, t - 0.9), pt(B, 36, t + 0.9), pt(B, 6, t + 0.9)], Y.paint);
      }
      // designator: number above the letter (as read by the pilot), starting 12 m after the stripes
      const id = end.id; const num = id.replace(/[LRC]/g, ''); const letter = id.replace(/\d/g, '');
      const gh = big ? 9 : 7;
      const sNum = 48 + (letter ? gh + 6 : 0) + gh / 2;
      P.text(gw, num, pt(B, sNum, 0), B.dir, gh, Y.glyph, { gap: 0.3 });
      if (letter) P.text(gw, letter, pt(B, 48 + gh / 2, 0), B.dir, gh, Y.glyph);
      // aiming point
      if (L >= 1200) {
        const sA = L >= 2400 ? 400 : 300; const bl = L >= 2400 ? 45 : 30; const bw = L >= 2400 ? (W >= 55 ? 10 : 8) : 6; const inner = L >= 2400 ? 11 : 7;
        for (const sd of [-1, 1]) P.quadUp(pw, [pt(B, sA, sd * inner), pt(B, sA + bl, sd * inner), pt(B, sA + bl, sd * (inner + bw)), pt(B, sA, sd * (inner + bw))], Y.paint);
      }
      // touchdown zone bars on precision ends
      if (prec) {
        const groups = L >= 2400 ? [[150, 3], [300, 2], [600, 1], [750, 1], [900, 1]] : [[150, 2], [300, 1], [450, 1]];
        const maxJ = Math.floor((W / 2 - 4 - 9) / 4.5) + 1;
        for (const [sT, nPairs] of groups) {
          if (sT + 25 > L / 2 - 20) continue;
          for (let j = 0; j < Math.min(nPairs, maxJ); j++) for (const sd of [-1, 1]) {
            const t0 = 9 + 4.5 * j;
            P.quadUp(pw, [pt(B, sT, sd * t0), pt(B, sT + 22.5, sd * t0), pt(B, sT + 22.5, sd * (t0 + 3)), pt(B, sT, sd * (t0 + 3))], Y.paint);
          }
        }
      }
      // blast pad chevrons beyond the threshold
      if (cls === 'hub' || cls === 'regional') {
        for (let k = 0; k < 3; k++) {
          const sc = -10 - k * 16;
          for (const sd of [-1, 1]) P.segment(py, pt(B, sc, 0), pt(B, sc - 13, sd * (W / 2 - 6)), 1.6, Y.paint);
        }
        // pavement edge bar at the end of the paved overrun
        P.segment(py, pt(B, -58, -W / 2 + 2), pt(B, -58, W / 2 - 2), 0.5, Y.paint);
      }
      // tyre rubber in the touchdown zone
      if (L >= 1200) {
        const s0 = 120; const len = Math.min(512, L * 0.2);
        const rubberCorners = [pt(B, s0, -16), pt(B, s0 + len, -16), pt(B, s0 + len, 16), pt(B, s0, 16)];
        // map: u along the runway 0..1 (len of 512 m = full texture), v across; clipped by simply scaling u
        const uMax = len / 512;
        P.quadUp(rub, rubberCorners, Y.decal, [0, 0, uMax, 0, uMax, 1, 0, 1], 1);
      }
    });
    // wear streak along the centreline
    {
      const half = L / 2 - 20;
      const hh = half / 60;
      P.quadUp(stk, [pc(-half, -3), pc(half, -3), pc(half, 3), pc(-half, 3)], Y.decal, [0, -hh, 0, hh, 1, hh, 1, -hh], 1);
    }
    // repaired patches and darker seams
    const nPatch = Math.floor((L / 70) * wearBoost);
    for (let k = 0; k < nPatch; k++) {
      const s = rng.range(-L / 2 + 30, L / 2 - 30); const t = rng.range(-W / 2 + 3, W / 2 - 3);
      const pl = rng.range(2.5, 9); const pwid = rng.range(1.2, 3.6);
      const shade = rng.range(0.7, 1.3);
      P.quadUp(asp, [pc(s - pl / 2, t - pwid / 2), pc(s + pl / 2, t - pwid / 2), pc(s + pl / 2, t + pwid / 2), pc(s - pl / 2, t + pwid / 2)], Y.patch, null, shade);
    }
  }

  // streak quad needs proper uv: rebuild explicitly (the loop above wrote a placeholder)
  // (kept simple: the decal material repeats vertically, so the stretch is encoded in the placeholder)

  // ---- paint: taxiways, hold lines, stands ----------------------------------------------------------------------------------------
  const lead = cls === 'hub' ? 45 : cls === 'regional' ? 32 : 22;
  for (const t of layout.taxiways) {
    if (t.kind === 'track') continue;
    if (t.render === false) continue;
    let pts = t.pts.map((p) => ({ x: p.u, z: p.v }));
    if (t.round) pts = P.roundPath(pts, t.round, 2.5);
    P.line(py, pts, 0.22, Y.paintHi);
    // runway-side edge marking (double line) on the main taxiway
    if (t.kind === 'taxiway' && (cls === 'hub' || cls === 'regional') && t.pts.length === 4) {
      const trunk = [t.pts[1], t.pts[2]].map((p) => ({ x: p.u, z: p.v }));
      const rwv = rwInfo.find((r) => r.rw.name === t.runway).cv;
      const sg = Math.sign(rwv - trunk[0].z); // side of the trunk facing the runway
      const off = sg * (t.half - 0.7);
      // the line is on the +z side when sg > 0; offsetLine uses the right of travel (+z for +x travel)
      const side1 = P.offsetLine(trunk, off); const side2 = P.offsetLine(trunk, off - sg * 0.35);
      const skip = layout.taxiways.filter((q) => q.kind === 'exit' && q.runway === t.runway);
      const cut = (pl) => {
        // drop stretches where an exit joins
        const from = pl[0].x; const to = pl[1].x;
        const trim = (t.round ?? 0) + t.half;
        const lo = Math.min(from, to) + trim; const hi = Math.max(from, to) - trim;
        const ranges = skip.map((q) => { const us = q.pts.map((p) => p.u); return [Math.min(...us) - 14, Math.max(...us) + 6]; }).sort((m, n) => m[0] - n[0]);
        let x = lo;
        for (const [r0, r1] of ranges) { if (r0 > x) P.segment(py, { x, z: pl[0].z }, { x: Math.min(r0, hi), z: pl[0].z }, 0.15, Y.paintHi); x = Math.max(x, r1); }
        if (x < hi) P.segment(py, { x, z: pl[0].z }, { x: hi, z: pl[0].z }, 0.15, Y.paintHi);
      };
      cut(side1); cut(side2);
    }
  }
  // lead-on curves from connectors onto the runway centreline, hold lines and painted instruction signs
  for (const h of layout.holds) {
    const info = rwInfo.find((r) => r.rw.name === h.rwName);
    const n = { x: h.nu, z: h.nv }; const m = { x: -n.z, z: n.x };
    const H = { x: h.u, z: h.v };
    // pattern A: two continuous lines on the taxiway side, two dashed on the runway side
    for (const [off, dash] of [[-0.9, false], [-0.3, false], [0.3, true], [0.9, true]]) {
      const c0 = { x: H.x + n.x * off, z: H.z + n.z * off };
      const p = { x: c0.x - m.x * h.half, z: c0.z - m.z * h.half }; const q = { x: c0.x + m.x * h.half, z: c0.z + m.z * h.half };
      if (dash) P.dashed(py, p, q, 0.3, 1.5, 1.5, Y.paintHi); else P.segment(py, p, q, 0.3, Y.paintHi);
    }
    // painted runway-holding sign: white designators on a red box, read by the pilot facing the runway
    const label = h.rwName.replace('/', '-');
    const tw = P.textWidth(label, 1.8, 0.3);
    const Cx = { x: H.x - n.x * 7.2, z: H.z - n.z * 7.2 };
    const bw = Math.min(h.half * 2 - 3, tw + 1.6);
    P.quadUp(pr, [
      { x: Cx.x - n.x * 1.8 - m.x * bw / 2, z: Cx.z - n.z * 1.8 - m.z * bw / 2 }, { x: Cx.x + n.x * 1.8 - m.x * bw / 2, z: Cx.z + n.z * 1.8 - m.z * bw / 2 },
      { x: Cx.x + n.x * 1.8 + m.x * bw / 2, z: Cx.z + n.z * 1.8 + m.z * bw / 2 }, { x: Cx.x - n.x * 1.8 + m.x * bw / 2, z: Cx.z - n.z * 1.8 + m.z * bw / 2 },
    ], Y.paintHi);
    P.text(gw, label, Cx, n, tw + 1.6 > bw ? 1.8 * (bw - 1.2) / tw : 1.8, Y.glyph + 0.001, { gap: 0.3 });
    // lead-on arcs: from the runway edge along the connector, curving to both runway directions
    if (info && info.paved && Math.abs(info.rel) < 1) {
      const R = cls === 'hub' ? 50 : cls === 'regional' ? 36 : 24;
      const edge = { x: h.u, z: info.cv - Math.sign(n.z) * (info.W / 2) * -1 };
      void edge;
      const E = { x: h.u, z: info.cv - n.z * (info.W / 2) };
      for (const sg of [-1, 1]) {
        const end = { x: h.u + sg * R, z: info.cv };
        const pts = sCurve(E, n, end, { x: sg, z: 0 }, R * 0.55, 10);
        P.line(py, pts, 0.22, Y.paintHi);
      }
    }
    void m;
  }
  // mid connectors on small fields also get lead-on curves
  for (const t of layout.taxiways) {
    if (t.kind !== 'connector' || t.render === false || t.name === 'C') continue;
    const info = rwInfo.find((r) => r.rw.name === t.runway);
    if (!info) continue;
    const E = { x: t.pts[1].u, z: t.pts[1].v }; const n = { x: 0, z: Math.sign(info.cv - t.pts[0].v) };
    const R = cls === 'regional' ? 36 : 24;
    for (const sg of [-1, 1]) P.line(py, sCurve(E, n, { x: E.x + sg * R, z: info.cv }, { x: sg, z: 0 }, R * 0.55, 10), 0.22, Y.paintHi);
  }

  // stands: lead-in line with a curved entry, stop bar and number
  for (const st of layout.stands) {
    if (!st.lane && st.lane !== 0) continue;
    const ax = st.frameAxis; const S = { x: st.S.u, z: st.S.v };
    const lane = st.lane;
    const R = cls === 'hub' ? 24 : cls === 'regional' ? 18 : 12;
    const dirTo = Math.sign(ax.v);
    const j = { x: st.u, z: lane + dirTo * R };
    P.line(py, [j, S], 0.25, Y.paintHi);
    for (const sg of [-1, 1]) {
      const pts = sCurve({ x: st.u + sg * R, z: lane }, { x: -sg, z: 0 }, j, { x: 0, z: dirTo }, R * 0.55, 8);
      P.line(py, pts, 0.25, Y.paintHi);
    }
    // stop bar (T) at the nose gear mark
    P.segment(py, { x: S.x - 2.4, z: S.z + ax.v * 0.0 }, { x: S.x + 2.4, z: S.z }, 0.3, Y.paintHi);
    if (st.name) P.text(gy, st.name, { x: S.x + 3.4, z: S.z - ax.v * 9 }, { x: ax.u, z: ax.v }, cls === 'hub' ? 1.6 : 1.2, Y.glyph, { gap: 0.2 });
    // safety margin around the stand for large stands: faint red corner marks are skipped
  }
  void biome;
  return { bufs };

  // ---- local helpers ---------------------------------------------------------------------------------------------------
  function endBasis(lay, info, i) {
    const sg = i === 0 ? 1 : -1;
    const dir = { x: sg * Math.cos(info.rel * DEG), z: sg * Math.sin(info.rel * DEG) };
    const right = { x: -dir.z, z: dir.x };
    const e = info.rw.ends[i];
    const f = lay.frame.toFrame(e.threshold.x, e.threshold.z);
    return { dir, right, thr: { x: f.u, z: f.v } };
  }
  function pt(B, s, t) { return { x: B.thr.x + B.dir.x * s + B.right.x * t, z: B.thr.z + B.dir.z * s + B.right.z * t }; }
}
