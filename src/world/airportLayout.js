// Site plan of an airport as plain data (no rendering, runs in Node): oriented rectangles for runways,
// taxiways and aprons (used by the physics for surface friction), the taxi route graph (used by ATC and AI
// traffic), stands, hold lines, and the placement of every building and facility for the builder.
//
// Everything is first laid out in the airport frame: u along the main runway heading, v to the right of it,
// origin at the airport reference point. World coordinates are derived with `frame.toWorld`.

import { Rng } from '../util/random.js';

const DEG = Math.PI / 180;
const dirOf = (h) => ({ x: Math.sin(h * DEG), z: -Math.cos(h * DEG) });
const wrap360 = (h) => ((h % 360) + 360) % 360;

/** Oriented rectangle: centre, half-length along (ux, uz), half-width across. */
function rect(cx, cz, hl, hw, heading, kind, surface = 'paved') {
  const d = dirOf(heading);
  return { cx, cz, hl, hw, ux: d.x, uz: d.z, heading, kind, surface };
}

/** Class parameters of the site plan. */
const PLAN = {
  hub: { corner: 22, taxiHalf: 11.5, taxiV: 122, holdV: 150, nose: 11.2, standCount: 14, shoulder: 7.5 },
  regional: { corner: 20, taxiHalf: 9, taxiV: 100, holdV: 68, nose: 10, standCount: 6, shoulder: 5 },
  small: { corner: 14, taxiHalf: 6, taxiV: 70, holdV: 40, nose: 3, standCount: 3, shoulder: 3 },
  strip: { corner: 8, taxiHalf: 2.5, taxiV: 22, holdV: 22, nose: 1.5, standCount: 2, shoulder: 0 },
};

/** Cubic Bezier through two tangents, sampled. P0, P1 are {u,v}; directions are unit {u,v}. */
function sCurve(p0, d0, p1, d1, k, n = 14) {
  const c0 = { u: p0.u + d0.u * k, v: p0.v + d0.v * k };
  const c1 = { u: p1.u - d1.u * k, v: p1.v - d1.v * k };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; const m = 1 - t;
    out.push({
      u: m * m * m * p0.u + 3 * m * m * t * c0.u + 3 * m * t * t * c1.u + t * t * t * p1.u,
      v: m * m * m * p0.v + 3 * m * m * t * c0.v + 3 * m * t * t * c1.v + t * t * t * p1.v,
    });
  }
  return out;
}

class Graph {
  constructor(frame) { this.nodes = []; this.edges = []; this.keys = new Map(); this.frame = frame; this.pending = new Map(); }

  node(u, v, key) {
    if (key && this.keys.has(key)) return this.keys.get(key);
    const w = this.frame.toWorld(u, v);
    const i = this.nodes.push({ u, v, x: w.x, z: w.z, key }) - 1;
    if (key) this.keys.set(key, i);
    return i;
  }

  /** Edge with optional intermediate frame points. */
  edge(a, b, mid = []) {
    const pts = [this.nodes[a], ...mid.map((p) => ({ ...p, ...this.frame.toWorld(p.u, p.v) })), this.nodes[b]];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    this.edges.push({ a, b, len, pts: pts.map((p) => ({ x: p.x, z: p.z })) });
  }

  /** Register a list of nodes lying on a straight line; they are joined in sorted order by `finalize`. */
  chain(indices, coord) { this.pending.set(indices, coord); }

  finalize() {
    for (const [indices, coord] of this.pending) {
      const s = [...new Set(indices)].sort((p, q) => this.nodes[p][coord] - this.nodes[q][coord]);
      for (let i = 1; i < s.length; i++) this.edge(s[i - 1], s[i]);
    }
    this.pending.clear();
  }

  /** Dijkstra: world polyline from node `from` to node `to` (inclusive), or null. */
  path(from, to) {
    const n = this.nodes.length;
    const dist = new Array(n).fill(Infinity); const prev = new Array(n).fill(null); const done = new Array(n).fill(false);
    const adj = Array.from({ length: n }, () => []);
    this.edges.forEach((e, i) => { adj[e.a].push([e.b, i]); adj[e.b].push([e.a, i]); });
    dist[from] = 0;
    for (;;) {
      let u = -1; let best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === to) break;
      done[u] = true;
      for (const [w, ei] of adj[u]) {
        const nd = dist[u] + this.edges[ei].len;
        if (nd < dist[w]) { dist[w] = nd; prev[w] = [u, ei]; }
      }
    }
    if (dist[to] === Infinity) return null;
    const seq = [];
    for (let c = to; c !== from; c = prev[c][0]) seq.push([prev[c][0], c, prev[c][1]]);
    seq.reverse();
    const res = [{ x: this.nodes[from].x, z: this.nodes[from].z }];
    for (const [p, , ei] of seq) {
      const e = this.edges[ei];
      const arr = e.a === p ? e.pts : e.pts.slice().reverse();
      for (let k = 1; k < arr.length; k++) res.push({ x: arr[k].x, z: arr[k].z });
    }
    return res;
  }
}

export function layoutAirport(a) {
  if (a.layout) return a.layout;
  const cls = a.cls;
  const spec = a.spec;
  const plan = PLAN[cls];
  const main = a.runways[0];
  const h = main.heading;
  const d = dirOf(h);
  const side = { x: -d.z, z: d.x };
  const frame = {
    toWorld: (u, v) => ({ x: a.x + d.x * u + side.x * v, z: a.z + d.z * u + side.z * v }),
    toFrame: (x, z) => ({ u: (x - a.x) * d.x + (z - a.z) * d.z, v: (x - a.x) * side.x + (z - a.z) * side.z }),
    heading: (du, dv) => wrap360(h + (Math.atan2(dv, du) / DEG)),
  };
  let seed = 0;
  for (const ch of a.code) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = new Rng(seed ^ 0xa17f);
  const hasPair = a.runways.some((r) => r.ends[0].id.endsWith('L') || r.ends[0].id.endsWith('R'));
  // side of the main runway where the terminal complex sits
  const s = hasPair ? 1 : rng.sign();

  const rects = [];
  const taxiways = []; // { name, pts:[{u,v}], half, kind }
  const aprons = []; // { u0, u1, v0, v1, surface }
  const sites = []; // buildings and facilities, in frame coordinates
  const holds = [];
  const stands = [];
  const roads = [];
  const graph = new Graph(frame);
  const taxiLines = new Map(); // v -> node indices on that straight line

  const addTaxiRect = (p, q, half, surface = 'paved') => {
    const du = q.u - p.u; const dv = q.v - p.v;
    const len = Math.hypot(du, dv);
    if (len < 0.5) return;
    const c = frame.toWorld((p.u + q.u) / 2, (p.v + q.v) / 2);
    rects.push(rect(c.x, c.z, len / 2 + half * 0.6, half, frame.heading(du, dv), 'taxiway', surface));
  };
  const addPolyRects = (pts, half, surface) => { for (let i = 1; i < pts.length; i++) addTaxiRect(pts[i - 1], pts[i], half, surface); };
  const lineNode = (v, u, key) => {
    const i = graph.node(u, v, key);
    const k = v.toFixed(1);
    if (!taxiLines.has(k)) taxiLines.set(k, []);
    taxiLines.get(k).push(i);
    return i;
  };

  // ---- runways -------------------------------------------------------------------------------------------
  const rwInfo = a.runways.map((rw, idx) => {
    const c = frame.toFrame(rw.cx, rw.cz);
    const paved = rw.surface !== 'grass';
    const ext = paved ? 60 : 15;
    rects.push({ ...rect(rw.cx, rw.cz, rw.length / 2 + ext, rw.width / 2 + (paved ? plan.shoulder : 3), rw.heading, 'runway', paved ? 'paved' : 'grass'), runway: rw.name });
    const rel = ((rw.heading - h + 540) % 360) - 180; // -180..180
    return { rw, idx, cu: c.u, cv: c.v, paved, rel, L: rw.length, W: rw.width, main: idx === 0, cross: Math.abs(Math.sin(rel * DEG)) > 0.2 };
  });

  // ---- apron placement -------------------------------------------------------------------------------------
  let uc = 0; // apron centre along the runway
  const cross = rwInfo.find((r) => r.cross);
  let away = 1;
  if (cross) { away = -s * Math.sign(Math.sin(cross.rel * DEG)) || 1; uc = away * (cls === 'regional' ? 270 : 120); }

  const mainInfo = rwInfo[0];
  const frameHeadingAway = (ds) => frame.heading(0, -ds); // heading pointing away from the terminal (ds = +1 means terminal toward +v)

  // ---- taxiway helpers -----------------------------------------------------------------------------------
  /** Perpendicular departure connector + exits for a runway served by a parallel taxiway at v = vt. */
  function serveRunway(info, vt, holdV, name, opts) {
    const { rw, cu, cv, L } = info;
    const half = plan.taxiHalf;
    const dep = opts.dep;
    void holdV;
    const toward = Math.sign(vt - cv) || 1; // direction from the runway to the taxiway
    const ends = [
      { end: rw.ends[0], sgn: 1, uThr: cu - L / 2 },
      { end: rw.ends[1], sgn: -1, uThr: cu + L / 2 },
    ];
    const uA = cu - L / 2 + dep; const uB = cu + L / 2 - dep;
    const tline = [];
    let cIdx = 1;
    // taxiway: straight between the two end connectors
    const trunk = [{ u: uA, v: vt }, { u: uB, v: vt }];
    const edgeV = cv + toward * (info.W / 2);
    // one ribbon: connector, rounded corner, trunk, rounded corner, connector
    taxiways.push({ name, pts: [{ u: uA, v: edgeV }, ...trunk, { u: uB, v: edgeV }], half, kind: 'taxiway', runway: rw.name, round: plan.corner });
    addPolyRects(trunk, half);
    // end connectors (departure entries): taxiway corner, hold line, runway centreline
    for (const e of ends) {
      const u = e.sgn === 1 ? uA : uB;
      const holdPos = cv + toward * opts.holdFromRunway;
      const tn = lineNode(vt, u, `T:${name}:${e.end.id}`);
      const hnode = graph.node(u, holdPos, `hold:${e.end.id}`);
      const enode = graph.node(u, cv, `entry:${e.end.id}`);
      graph.edge(tn, hnode);
      graph.edge(hnode, enode);
      tline.push(tn);
      const conn = [{ u, v: vt }, { u, v: cv + toward * (info.W / 2) }];
      taxiways.push({ name: `${name}${cIdx}`, pts: conn, half, kind: 'connector', runway: rw.name, render: false });
      addPolyRects(conn, half);
      holds.push({
        endId: e.end.id, rwName: rw.name, u, v: holdPos, nu: 0, nv: -toward, taxi: `${name}${cIdx}`, half, runwayV: cv, sgn: e.sgn,
        heading: frame.heading(0, -toward),
      });
      cIdx++;
    }
    // rapid exits: S-curves from the runway centreline to the taxiway, leaning forward
    const dv = Math.abs(vt - cv);
    const Lu = Math.max(110, dv * opts.exitStretch);
    const exits = [];
    for (const e of ends) {
      const list = opts.exitFracs[e.sgn === 1 ? 0 : 1];
      list.forEach((f, k) => {
        const us = e.uThr + e.sgn * f * L;
        const ue = us + e.sgn * Lu;
        const margin = e.sgn === 1 ? (ue < uB - 60) : (ue > uA + 60);
        if (!margin) return;
        const p0 = { u: us, v: cv }; const p1 = { u: ue, v: vt };
        const pts = sCurve(p0, { u: e.sgn, v: 0 }, p1, { u: e.sgn, v: 0 }, Lu * 0.55);
        taxiways.push({ name: `${name}${cIdx}`, pts, half, kind: 'exit', runway: rw.name, sgn: e.sgn });
        addPolyRects(pts, half);
        const a0 = graph.node(us, cv, `exit:${e.end.id}:${k}`);
        const a1 = lineNode(vt, ue, `X:${name}:${e.end.id}:${k}`);
        graph.edge(a0, a1, pts.slice(1, -1));
        exits.push({ endId: e.end.id, u: us, node: a0, name: `${name}${cIdx}`, sgn: e.sgn });
        cIdx++;
        tline.push(a1);
      });
    }
    // mid-field perpendicular connector (small fields) for variety
    if (opts.midConnector) {
      const u = cu;
      const conn = [{ u, v: vt }, { u, v: cv + toward * (info.W / 2) }];
      taxiways.push({ name: `${name}${cIdx}`, pts: conn, half, kind: 'connector', runway: rw.name, fillet: true });
      addPolyRects(conn, half);
      const tn = lineNode(vt, u, `T:${name}:mid`);
      const en = graph.node(u, cv, `exit:mid:${rw.name}`);
      graph.edge(tn, en);
      tline.push(tn);
      exits.push({ endId: null, u, node: en, name: `${name}${cIdx}`, sgn: 0 });
      cIdx++;
    }
    return { tline, exits, vt, trunk, uA, uB };
  }

  // ---- layouts by class ----------------------------------------------------------------------------------------
  const startFor = (S, axis, cgBack) => {
    // player start: aircraft centre `cgBack` metres farther from the terminal than the stop point, facing away
    const p = { u: S.u - axis.u * cgBack, v: S.v - axis.v * cgBack };
    const w = frame.toWorld(p.u, p.v);
    return { x: w.x, z: w.z, heading: frame.heading(-axis.u, -axis.v), u: p.u, v: p.v };
  };

  let towerFrame = { u: 0, v: 0, h: 28 };
  let nodesOnApronLine = [];
  let serve;

  if (hasPair) {
    // ---------------------------------------------------------------------------- INTERNATIONAL
    const second = rwInfo[1];
    const half = plan.taxiHalf;
    const opts = { dep: 125, holdFromRunway: 90, exitStretch: 2.2, exitFracs: [[0.22, 0.46, 0.7], [0.33, 0.58]], midConnector: false };
    const A = serveRunway(mainInfo, mainInfo.cv + 118, plan.holdV, 'A', { ...opts }); // v = -122
    const B = serveRunway(second, second.cv - 118, plan.holdV, 'B', { ...opts, exitFracs: [[0.3, 0.56], [0.22, 0.46, 0.7]] });
    serve = [A, B];
    // main apron between the taxiways, with the terminal spine down the middle
    aprons.push({ u0: -238, u1: 238, v0: -112, v1: 112, surface: 'concrete', name: 'main' });
    rects.push(rect(a.x, a.z, 238, 112, h, 'apron'));
    // east zone: cargo, maintenance and fire station
    aprons.push({ u0: 238, u1: 700, v0: -112, v1: 112, surface: 'concrete', name: 'east' });
    rects.push({ ...rect(frame.toWorld(469, 0).x, frame.toWorld(469, 0).z, 231, 112, h, 'apron') });
    const vA = A.vt; const vB = B.vt;
    // cross links between the two taxiways at the east end of the terminal and at the west landside
    const linkU = 207;
    const la = lineNode(vA, linkU, 'L:A'); const lb = lineNode(vB, linkU, 'L:B');
    graph.edge(la, lb);
    A.tline.push(la); B.tline.push(lb);
    // stands: 7 per side, alternating (index even = left/-v, odd = right/+v)
    const pitch = 50; const S0 = 35; const axisFor = (sd) => ({ u: 0, v: -sd }); // axis points to the terminal at v=0
    for (let k = 0; k < 7; k++) {
      for (const sd of [-1, 1]) {
        const u = -150 + k * pitch;
        const S = { u, v: sd * S0 };
        const axis = axisFor(sd);
        const park = { u: S.u - axis.u * plan.nose, v: S.v - axis.v * plan.nose };
        const start = startFor(S, axis, 78 - S0);
        stands.push({ u, v: park.v, S, axis, side: sd, k, bridge: true, name: `${sd < 0 ? 'A' : 'B'}${k + 1}`, wide: true, start, lane: sd * 122 });
      }
    }
    // taxi junction node per stand
    stands.forEach((st) => {
      const sn = graph.node(st.u, st.v, `S:${st.name}`);
      const jn = lineNode(st.side < 0 ? vA : vB, st.u, `J:${st.name}`);
      graph.edge(sn, jn);
      (st.side < 0 ? A : B).tline.push(jn);
      st.node = sn;
    });
    graph.chain(A.tline, 'u'); graph.chain(B.tline, 'u');
    // buildings
    sites.push({ type: 'terminal', variant: 'hub', u: 0, v: 0, concourse: { u0: -175, u1: 175, half: 14, h: 11 }, hall: { u0: -292, u1: -175, half: 56, h: 25 } });
    sites.push({ type: 'tower', u: 262, v: 0, h: 52, kind: 'big' });
    towerFrame = { u: 262, v: 0, h: 52 };
    sites.push({ type: 'cargo', u: 372, v: 0, w: 150, d: 46, h: 14 });
    sites.push({ type: 'maint', u: 520, v: 0, w: 110, d: 74, h: 26 });
    sites.push({ type: 'fire', u: 650, v: 0, w: 46, d: 24, h: 8 });
    sites.push({ type: 'carpark', u: -405, v: 0, w: 84, d: 96, h: 20 });
    sites.push({ type: 'hotel', u: -520, v: 0, w: 46, d: 26, h: 50 });
    sites.push({ type: 'portal', u: -660, v: 0 });
    sites.push({ type: 'tanks', u: -950, v: 470, count: 6 });
    sites.push({ type: 'atis', u: 700, v: 330 });
    sites.push({ type: 'radar', u: 640, v: 345 });
    sites.push({ type: 'depot', u: 300, v: 270 });
    roads.push({ pts: [{ u: -318, v: -95 }, { u: -318, v: 95 }], w: 16, kind: 'forecourt' });
    roads.push({ pts: [{ u: -318, v: 0 }, { u: -675, v: 0 }], w: 14, kind: 'access' });
    roads.push({ pts: [{ u: -365, v: -56 }, { u: -318, v: -56 }], w: 9, kind: 'access' });
    roads.push({ pts: [{ u: -365, v: 56 }, { u: -318, v: 56 }], w: 9, kind: 'access' });
    sites.push({ type: 'lot', u: -412, v: -78, w: 110, d: 36 });
    sites.push({ type: 'lot', u: -412, v: 78, w: 110, d: 36 });
    sites.push({ type: 'lot', u: -540, v: -62, w: 70, d: 36 });
    sites.push({ type: 'lot', u: -540, v: 62, w: 70, d: 36 });
    sites.push({ type: 'hangarRow', u: 760, v: 0 });
    void half; void second;
  } else {
    // ---------------------------------------------------------------------------- REGIONAL / AIRFIELD / STRIP
    const rwv = mainInfo.cv; // 0
    const L = mainInfo.L;
    const vt = rwv + s * plan.taxiV;
    if (cls === 'strip') {
      // dirt track beside the runway, apron of tie-downs, a shed
      const half = plan.taxiHalf;
      const dep = 40;
      const uA = mainInfo.cu - L / 2 + dep; const uB = mainInfo.cu + L / 2 - dep;
      const trunk = [{ u: uA, v: vt }, { u: uB, v: vt }];
      taxiways.push({ name: 'A', pts: trunk, half, kind: 'track', runway: main.name });
      addPolyRects(trunk, half, 'grass');
      const tl = [];
      main.ends.forEach((e, i) => {
        const sg = i === 0 ? 1 : -1; const u = i === 0 ? uA : uB;
        const tn = lineNode(vt, u, `T:A:${e.id}`);
        const hn = graph.node(u, rwv + s * (main.width / 2 + 9), `hold:${e.id}`);
        const en = graph.node(u, rwv, `entry:${e.id}`);
        graph.edge(tn, hn); graph.edge(hn, en);
        const conn = [{ u, v: vt }, { u, v: rwv + s * (main.width / 2) }];
        taxiways.push({ name: `A${i + 1}`, pts: conn, half, kind: 'track', runway: main.name });
        addPolyRects(conn, half, 'grass');
        holds.push({ endId: e.id, rwName: main.name, u, v: rwv + s * (main.width / 2 + 9), nu: 0, nv: -s, taxi: `A${i + 1}`, half, runwayV: rwv, sgn: sg, heading: frame.heading(0, -s) });
        tl.push(tn);
      });
      aprons.push({ u0: -26, u1: 26, v0: Math.min(s * 30, s * 62), v1: Math.max(s * 30, s * 62), surface: 'gravel', name: 'tie' });
      rects.push({ ...rect(frame.toWorld(0, s * 46).x, frame.toWorld(0, s * 46).z, 26, 16, h, 'apron', 'grass') });
      const axis = { u: 0, v: s }; // aircraft nose toward +s side (the shed)
      [-12, 12].forEach((u, k) => {
        const S = { u, v: s * 52 };
        const park = { u, v: S.v - axis.v * plan.nose };
        const start = startFor(S, axis, 12);
        const st = { u, v: park.v, S, axis, side: s, k, bridge: false, name: `T${k + 1}`, wide: false, start, small: true };
        const sn = graph.node(u, park.v, `S:${st.name}`);
        const jn = lineNode(vt, u, `J:${st.name}`);
        graph.edge(sn, jn);
        tl.push(jn); st.node = sn;
        stands.push(st);
      });
      graph.chain(tl, 'u');
      serve = [{ tline: tl, exits: [] }];
      sites.push({ type: 'shed', u: -6, v: s * 74, w: 12, d: 8, h: 3.6, face: -s });
      sites.push({ type: 'drums', u: 14, v: s * 68 });
      sites.push({ type: 'windsock', u: -L * 0.2, v: s * (main.width / 2 + 28) });
      sites.push({ type: 'trees', u: 0, v: s * 95, count: 14, spread: 55 });
      towerFrame = { u: 0, v: s * 74, h: 8 };
    } else {
      const small = cls === 'small';
      const opts = small
        ? { dep: 55, holdFromRunway: mainInfo.W / 2 + 28, exitStretch: 2.0, exitFracs: [[0.5, 0.75], [0.55, 0.8]], midConnector: true }
        : { dep: 110, holdFromRunway: 65, exitStretch: 2.2, exitFracs: [[0.3, 0.55, 0.75], [0.36, 0.62]], midConnector: false };
      const A = serveRunway(mainInfo, vt, plan.holdV, 'A', opts);
      serve = [A];
      const half = plan.taxiHalf;
      if (small) {
        const aprDepth = 64;
        const v0 = s * (plan.taxiV + half + 1); const v1 = s * (plan.taxiV + half + aprDepth);
        aprons.push({ u0: -70, u1: 70, v0: Math.min(v0, v1), v1: Math.max(v0, v1), surface: 'asphalt', name: 'main' });
        const c = frame.toWorld(0, (v0 + v1) / 2);
        rects.push(rect(c.x, c.z, 70, aprDepth / 2, h, 'apron'));
        const axis = { u: 0, v: s };
        [-36, 0, 36].forEach((u, k) => {
          const S = { u, v: s * (plan.taxiV + half + aprDepth - 14) };
          const park = { u, v: S.v - axis.v * plan.nose };
          const start = startFor(S, axis, 30);
          const st = { u, v: park.v, S, axis, side: s, k, bridge: false, name: `T${k + 1}`, wide: false, start, small: true, lane: vt };
          const sn = graph.node(u, park.v, `S:${st.name}`);
          const jn = lineNode(vt, u, `J:${st.name}`);
          graph.edge(sn, jn);
          A.tline.push(jn); st.node = sn;
          stands.push(st);
        });
        graph.chain(A.tline, 'u');
        const vFront = s * (plan.taxiV + half + aprDepth + 8);
        sites.push({ type: 'terminal', variant: 'small', u: 0, v: vFront + s * 6, w: 34, d: 12, h: 5.5, face: -s });
        sites.push({ type: 'hangarArch', u: -105, v: s * 108, w: 26, d: 30, h: 8.5, face: -s });
        sites.push({ type: 'hangarGable', u: 105, v: s * 108, w: 24, d: 26, h: 7.5, face: -s });
        aprons.push({ u0: -122, u1: -88, v0: Math.min(s * 76, s * 92), v1: Math.max(s * 76, s * 92), surface: 'asphalt', name: 'h1' });
        aprons.push({ u0: 88, u1: 122, v0: Math.min(s * 76, s * 92), v1: Math.max(s * 76, s * 92), surface: 'asphalt', name: 'h2' });
        const c1 = frame.toWorld(-105, s * 84); const c2 = frame.toWorld(105, s * 84);
        rects.push(rect(c1.x, c1.z, 17, 8, h, 'apron'), rect(c2.x, c2.z, 17, 8, h, 'apron'));
        for (const u of [-105, 105]) {
          const jn = lineNode(vt, u, `J:H${u}`);
          const hn = graph.node(u, s * 84, `H:${u}`);
          graph.edge(jn, hn); A.tline.push(jn);
        }
        graph.chain(A.tline, 'u');
        sites.push({ type: 'lot', u: 0, v: vFront + s * 28, w: 60, d: 26 });
        sites.push({ type: 'fuel', u: 52, v: s * 120 });
        sites.push({ type: 'windsock', u: -mainInfo.L * 0.18, v: s * (mainInfo.W / 2 + 34) });
        sites.push({ type: 'trees', u: 0, v: vFront + s * 60, count: 28, spread: 80 });
        roads.push({ pts: [{ u: -90, v: vFront + s * 44 }, { u: 90, v: vFront + s * 44 }], w: 7, kind: 'access' });
        towerFrame = { u: 0, v: vFront, h: 12 };
      } else {
        // regional
        const aprFront = s * 232; // terminal front face
        const vLane = s * 150;
        aprons.push({ u0: uc - 140, u1: uc + 140, v0: Math.min(s * 96, aprFront), v1: Math.max(s * 96, aprFront), surface: 'concrete', name: 'main' });
        {
          const c = frame.toWorld(uc, s * 164);
          rects.push(rect(c.x, c.z, 140, 68, h, 'apron'));
        }
        const axis = { u: 0, v: s };
        const tl = A.tline;
        const lane = [];
        [-105, -63, -21, 21, 63, 105].forEach((du, k) => {
          const u = uc + du;
          const S = { u, v: s * 215 };
          const park = { u, v: S.v - axis.v * plan.nose };
          const start = startFor(S, axis, 65);
          const bridge = Math.abs(du) <= 22;
          const st = { u, v: park.v, S, axis, side: s, k, bridge, name: `${k + 1}`, wide: false, start, lane: vLane };
          const sn = graph.node(u, park.v, `S:${st.name}`);
          const ln = graph.node(u, vLane, `LN:${k}`);
          graph.edge(sn, ln);
          lane.push(ln); st.node = sn;
          stands.push(st);
        });
        // apron lane ends connect to the parallel taxiway
        for (const sg of [-1, 1]) {
          const u = uc + sg * 128;
          const ln = graph.node(u, vLane, `LN:end${sg}`);
          const jn = lineNode(vt, u, `J:apron${sg}`);
          lane.push(ln); tl.push(jn);
          graph.edge(ln, jn);
        }
        graph.chain(lane, 'u'); graph.chain(tl, 'u');
        sites.push({ type: 'terminal', variant: 'regional', u: uc, v: s * 245, w: 140, d: 26, h: 13, face: -s });
        sites.push({ type: 'tower', u: uc + 105, v: s * 250, h: 28, kind: 'regional' });
        towerFrame = { u: uc + 105, v: s * 250, h: 28 };
        [0, 1, 2].forEach((k) => {
          const u = uc + away * (205 + k * 58);
          sites.push({ type: k === 1 ? 'hangarGable' : k === 0 ? 'hangarArch' : 'hangarGable', u, v: s * 190, w: 36, d: 38, h: 11, face: -s });
          aprons.push({ u0: u - 24, u1: u + 24, v0: Math.min(s * 105, s * 170), v1: Math.max(s * 105, s * 170), surface: 'concrete', name: `h${k}` });
          const c = frame.toWorld(u, s * 138);
          rects.push(rect(c.x, c.z, 24, 33, h, 'apron'));
          const jn = lineNode(vt, u, `J:H${k}`);
          const hn = graph.node(u, s * 160, `H:${k}`);
          graph.edge(jn, hn); tl.push(jn);
        });
        graph.chain(tl, 'u');
        sites.push({ type: 'fire', u: uc - away * 150, v: s * 250, w: 34, d: 18, h: 7 });
        sites.push({ type: 'tanks', u: uc + away * 100, v: s * 330, count: 3 });
        sites.push({ type: 'lot', u: uc, v: s * 300, w: 100, d: 40 });
        sites.push({ type: 'lot', u: uc - 110, v: s * 300, w: 60, d: 40 });
        sites.push({ type: 'atis', u: uc + 160, v: s * 280 });
        sites.push({ type: 'trees', u: uc, v: s * 335, count: 40, spread: 130 });
        sites.push({ type: 'windsock', u: mainInfo.L * 0.18, v: -s * (mainInfo.W / 2 + 40) });
        roads.push({ pts: [{ u: uc - 160, v: s * 280 }, { u: uc + 160, v: s * 280 }], w: 9, kind: 'access' });
        // cross runway link from the parallel taxiway to the threshold on the terminal side
        if (cross) {
          const thrs = cross.rw.ends.map((e) => ({ e, ...frame.toFrame(e.threshold.x, e.threshold.z) }));
          const near = thrs.reduce((p, q) => (q.v * s > p.v * s ? q : p));
          const ol = Math.hypot(near.u - cross.cu, near.v - cross.cv) || 1;
          const out = { u: (near.u - cross.cu) / ol, v: (near.v - cross.cv) / ol };
          const uh = near.u + out.u * 70; const vh = near.v + out.v * 70;
          if (Math.abs(vh - vt) < 700) {
            const linkPts = [{ u: uh, v: vt }, { u: uh, v: vh }, { u: near.u + out.u * 6, v: near.v + out.v * 6 }];
            taxiways.push({ name: 'C', pts: linkPts, half, kind: 'connector', runway: cross.rw.name });
            addPolyRects(linkPts, half);
            const jn = lineNode(vt, uh, 'J:cross');
            const lk = graph.node(uh, vh, 'LK:cross');
            const hold = graph.node(near.u + out.u * 34, near.v + out.v * 34, `hold:${near.e.id}`);
            const entry = graph.node(near.u - out.u * 40, near.v - out.v * 40, `entry:${near.e.id}`);
            graph.edge(jn, lk); graph.edge(lk, hold); graph.edge(hold, entry);
            tl.push(jn);
            holds.push({ endId: near.e.id, rwName: cross.rw.name, u: near.u + out.u * 34, v: near.v + out.v * 34, nu: -out.u, nv: -out.v, taxi: 'C', half, runwayV: cross.cv, sgn: 1, heading: frame.heading(-out.u, -out.v) });
          }
          graph.chain(tl, 'u');
        }
      }
    }
  }

  graph.finalize();

  // ---- tower position (camera for the tower view) --------------------------------------------------------------
  const tw = frame.toWorld(towerFrame.u, towerFrame.v);
  a.towerPos = { x: tw.x, z: tw.z, y: towerFrame.h + (spec.tower ? 4 : 0) };

  // ---- stand fields for consumers -------------------------------------------------------------------------------
  const standOut = stands.map((st) => {
    const w = frame.toWorld(st.u, st.v);
    const S = frame.toWorld(st.S.u, st.S.v);
    const axisW = { x: d.x * st.axis.u + side.x * st.axis.v, z: d.z * st.axis.u + side.z * st.axis.v };
    return {
      // x, z, heading: where a player's aircraft starts (nose out, ready to taxi); park: nose-in parking position
      x: st.start.x, z: st.start.z, heading: st.start.heading,
      park: { x: w.x, z: w.z, heading: frame.heading(st.axis.u, st.axis.v) },
      nose: { x: S.x, z: S.z }, axis: axisW, u: st.u, v: st.v, S: st.S, frameAxis: st.axis,
      name: st.name, bridge: st.bridge, wide: !!st.wide, small: !!st.small, side: st.side, node: st.node, lane: st.lane,
    };
  });

  // ---- world copies of rendering data ---------------------------------------------------------------------------------
  a.layout = {
    heading: h, hasPair, frame, plan, side: s, uc, away,
    rects, taxiways, aprons, sites, holds, roads, stands: standOut, graph, runways: rwInfo,
    apronCenter: frame.toWorld(uc, 0),
    seed,
  };
  return a.layout;
}

/** Aircraft centre position and heading for parking `spec` nose-in on `stand` (nose gear on the stop mark). */
export function standPlacement(stand, spec) {
  const nx = spec?.gear?.nose?.x ?? (spec?.geometry?.length ?? 8) * 0.3;
  return { x: stand.nose.x - stand.axis.x * nx, z: stand.nose.z - stand.axis.z * nx, heading: stand.park.heading };
}

const SURFACES_BY_KIND = { runway: null, taxiway: 'paved', apron: 'paved' };

/** Which surface lies at (x, z) within `airport`, or null if off every airport rectangle. */
export function airportSurfaceAt(airport, x, z) {
  const layout = layoutAirport(airport);
  if (Math.hypot(x - airport.x, z - airport.z) > airport.flatRadius * 1.3) return null;
  for (const r of layout.rects) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const along = dx * r.ux + dz * r.uz;
    if (Math.abs(along) > r.hl) continue;
    const perp = -dx * r.uz + dz * r.ux;
    if (Math.abs(perp) <= r.hw) return r.surface ?? SURFACES_BY_KIND[r.kind];
  }
  return null;
}
