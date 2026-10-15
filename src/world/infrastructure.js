import { Rng } from '../util/random.js';
import { MAP_HALF } from './maps.js';
import { lakeD } from './lakeShape.js';
import { airportReach } from './placement.js';

// Deterministic infrastructure for a map: the road network (highways, roads, minor roads), railways
// with stations, power lines, desert pipelines, wind and solar farms, quarries, ski lifts and runs,
// lakeside jetties, and radio masts. Pure data; the scenery turns it into geometry.

const HALF_USABLE = MAP_HALF * 0.82;
const DEG = Math.PI / 180;

function makeEnv(map) {
  const reaches = map.airports.map((a) => airportReach(a) + 260);
  const inLake = (x, z, k = 1.25) => map.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.radius * 1.4 && lakeD(l, x - l.x, z - l.z) < k);
  const inAirport = (x, z, extra = 0) => map.airports.some((a, i) => Math.hypot(x - a.x, z - a.z) < reaches[i] + extra);
  const airportDist = (x, z) => Math.min(...map.airports.map((a) => Math.hypot(x - a.x, z - a.z) - airportReach(a)));
  return { inLake, inAirport, airportDist };
}

/**
 * A polyline from a to b that wanders gently, avoids lakes and airports, and relaxes towards flat
 * ground (`slopeWeight` larger for railways).
 */
function route(map, env, a, b, rng, { step = 150, amp = 0, slopeWeight = 1, relax = 4 } = {}) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(3, Math.round(len / step));
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  const phase = rng.range(0, 6.28);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const wig = Math.sin(t * Math.PI * 2.5 + phase) * amp * Math.sin(t * Math.PI);
    pts.push({ x: a.x + (b.x - a.x) * t + nx * wig, z: a.z + (b.z - a.z) * t + nz * wig });
  }
  const H = map.hf.carved;
  const cost = (p, prev, next) => {
    let c = 0;
    const h = H(p.x, p.z);
    c += slopeWeight * (Math.abs(h - H(prev.x, prev.z)) + Math.abs(h - H(next.x, next.z)));
    if (env.inLake(p.x, p.z, 1.3)) c += 4000;
    if (env.inAirport(p.x, p.z)) c += 4000;
    if (map.rivers) { const r = map.rivers.nearest(p.x, p.z); if (r.dist < r.w * 1.3) c += 40; }
    return c;
  };
  for (let it = 0; it < relax; it++) {
    for (let k = 1; k < pts.length - 1; k++) {
      const p = pts[k];
      let best = p;
      let bc = cost(p, pts[k - 1], pts[k + 1]);
      for (const off of [-180, -90, 90, 180]) {
        const q = { x: p.x + nx * off, z: p.z + nz * off };
        const c = cost(q, pts[k - 1], pts[k + 1]) + Math.abs(off) * 0.05;
        if (c < bc) { bc = c; best = q; }
      }
      pts[k] = best;
    }
    for (let k = 1; k < pts.length - 1; k++) {
      pts[k] = { x: 0.25 * pts[k - 1].x + 0.5 * pts[k].x + 0.25 * pts[k + 1].x, z: 0.25 * pts[k - 1].z + 0.5 * pts[k].z + 0.25 * pts[k + 1].z };
    }
  }
  // Push anything still inside an airport or lake outwards.
  for (const p of pts) {
    for (let i = 0; i < map.airports.length; i++) {
      const ap = map.airports[i];
      const d = Math.hypot(p.x - ap.x, p.z - ap.z);
      if (d < reaches(ap)) { const k = reaches(ap) / Math.max(d, 1); p.x = ap.x + (p.x - ap.x) * k; p.z = ap.z + (p.z - ap.z) * k; }
    }
    for (const l of map.lakes) {
      const d = lakeD(l, p.x - l.x, p.z - l.z);
      if (d < 1.2) { const k = 1.25 / Math.max(d, 0.05); p.x = l.x + (p.x - l.x) * k; p.z = l.z + (p.z - l.z) * k; }
    }
  }
  return pts;
}
const reaches = (a) => airportReach(a) + 260;

/** Cut a route short where it enters a settlement (the street grid takes over there). */
function trim(pts, from, to) {
  let out = pts;
  const cut = (list, c, k) => {
    const r = c.radius * k;
    let i = 0;
    while (i < list.length - 1 && Math.hypot(list[i].x - c.x, list[i].z - c.z) < r) i++;
    return list.slice(i);
  };
  if (from?.radius) out = cut(out, from, 0.86);
  if (to?.radius) out = cut(out.slice().reverse(), to, 0.86).reverse();
  return out;
}

export function generateInfrastructure(map, seed) {
  const rng = new Rng(seed);
  const { cfg, cities, airports, hf } = map;
  const env = makeEnv(map);
  const major = cities.find((c) => c.kind === 'major');
  const towns = cities.filter((c) => c.kind === 'town');
  const villages = cities.filter((c) => c.kind === 'village');
  // Civic blocks: a church/mosque square at the centre of every town and village, a stadium in the big city.
  for (const c of [...towns, ...villages]) {
    const bx = Math.floor(c.x / 88); const bz = Math.floor(c.z / 88);
    c.civic = { bx, bz, x: bx * 88 + 44, z: bz * 88 + 44 };
    c.reserved = new Set([`${bx},${bz}`]);
  }
  let stadium = null;
  if (major) {
    const a = rng.range(0, 6.28);
    const bx = Math.round((major.x + Math.cos(a) * major.radius * 0.3) / 88);
    const bz = Math.round((major.z + Math.sin(a) * major.radius * 0.3) / 88);
    major.reserved = new Set([`${bx},${bz}`, `${bx - 1},${bz}`, `${bx},${bz - 1}`, `${bx - 1},${bz - 1}`, `${bx + 1},${bz}`, `${bx + 1},${bz - 1}`, `${bx - 2},${bz}`, `${bx - 2},${bz - 1}`]);
    stadium = { x: bx * 88, z: bz * 88, yaw: rng.pick([0, Math.PI]) };
  }
  const roads = [];
  const rails = [];
  const stations = [];
  const power = [];
  const pipelines = [];
  const biome = cfg.biome;

  // ---- road network ------------------------------------------------------------------------------------------
  const nodes = [
    ...cities.map((c) => ({ x: c.x, z: c.z, radius: c.radius, kind: c.kind, city: c })),
    ...airports.filter((a) => a.cls !== 'strip').map((a) => ({ x: a.x + 520, z: a.z + 360, radius: 0, kind: 'airport', ap: a })),
  ];
  const edges = [];
  const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const have = new Set();
  const inTree = [0];
  const rest = new Set(nodes.map((_, i) => i).filter((i) => i > 0));
  const d = (i, j) => Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
  while (rest.size) {
    let best = null;
    for (const i of inTree) for (const j of rest) { const dd = d(i, j); if (!best || dd < best.d) best = { i, j, d: dd }; }
    inTree.push(best.j); rest.delete(best.j);
    edges.push(best); have.add(key(best.i, best.j));
  }
  // Loops: connect every node to its second-nearest neighbour when that is not yet linked.
  nodes.forEach((n, i) => {
    const near = nodes.map((m, j) => ({ j, dd: d(i, j) })).filter((o) => o.j !== i).sort((p, q) => p.dd - q.dd);
    for (const o of near.slice(0, 2)) if (!have.has(key(i, o.j)) && o.dd < 15000 && (biome !== 'desert' || o.dd < 12000)) { edges.push({ i, j: o.j, d: o.dd }); have.add(key(i, o.j)); break; }
  });
  const rank = { major: 3, town: 2, airport: 2, village: 1 };
  for (const e of edges) {
    const A = nodes[e.i]; const B = nodes[e.j];
    const r = Math.min(rank[A.kind], rank[B.kind]);
    const hw = (A.kind === 'major' || B.kind === 'major') && r >= 2;
    const type = hw ? 'highway' : r >= 2 ? 'road' : 'minor';
    const pts = trim(route(map, env, A, B, rng, { amp: Math.min(700, e.d * 0.05), slopeWeight: 1 }), A, B);
    if (pts.length < 2) continue;
    roads.push({ points: pts, width: type === 'highway' ? 15 : type === 'road' ? 9.5 : 6.5, type, major: type === 'highway' });
  }
  // Airstrips and small airfields without an airport node: a minor road to the nearest settlement.
  for (const a of airports.filter((x) => x.cls === 'strip')) {
    let best = null;
    for (const c of cities) { const dd = Math.hypot(c.x - a.x, c.z - a.z); if (!best || dd < best.d) best = { c, d: dd }; }
    if (!best) continue;
    const pts = trim(route(map, env, { x: a.x + 120, z: a.z + 330 }, { x: best.c.x, z: best.c.z }, rng, { amp: 200 }), null, best.c);
    if (pts.length > 1) roads.push({ points: pts, width: 6, type: 'minor', major: false });
  }

  // ---- railways -------------------------------------------------------------------------------------------------
  const railNodes = [major, ...towns].filter(Boolean);
  if (railNodes.length > 1) {
    const done = [railNodes[0]];
    const left = railNodes.slice(1);
    while (left.length) {
      let best = null;
      for (const a of done) for (const b of left) { const dd = Math.hypot(a.x - b.x, a.z - b.z); if (!best || dd < best.d) best = { a, b, d: dd }; }
      left.splice(left.indexOf(best.b), 1); done.push(best.b);
      if (biome === 'desert' && rails.length >= 2) continue;
      const pts = trim(route(map, env, best.a, best.b, rng, { step: 200, amp: 250, slopeWeight: 4, relax: 6 }), best.a, best.b);
      if (pts.length < 3) continue;
      rails.push({ points: pts, width: 7, type: 'rail' });
      for (const [p, c] of [[pts[0], best.a], [pts[pts.length - 1], best.b]]) {
        const q = p === pts[0] ? pts[1] : pts[pts.length - 2];
        stations.push({ x: p.x, z: p.z, heading: Math.atan2(p.x - q.x, -(p.z - q.z)), city: c.name });
      }
    }
  }

  // ---- point features ----------------------------------------------------------------------------------------
  const free = (x, z, o = {}) => {
    if (Math.abs(x) > HALF_USABLE || Math.abs(z) > HALF_USABLE) return false;
    if (env.inLake(x, z, 1.5) || env.airportDist(x, z) < (o.airport ?? 2500)) return false;
    for (const c of cities) if (Math.hypot(x - c.x, z - c.z) < c.radius * 1.15 + (o.city ?? 500)) return false;
    return true;
  };
  const slopeAt = (x, z) => Math.hypot(hf.carved(x + 30, z) - hf.carved(x - 30, z), hf.carved(x, z + 30) - hf.carved(x, z - 30)) / 60;
  const searchSites = (count, test, o = {}) => {
    const out = [];
    for (let attempt = 0; attempt < 900 && out.length < count; attempt++) {
      const x = rng.range(-HALF_USABLE, HALF_USABLE);
      const z = rng.range(-HALF_USABLE, HALF_USABLE);
      if (!free(x, z, o)) continue;
      if (out.some((s) => Math.hypot(s.x - x, s.z - z) < (o.spacing ?? 6000))) continue;
      const q = test(x, z);
      if (q) out.push({ x, z, ...q });
    }
    return out;
  };

  // Wind farms: on rises with gentle ground, rows across the prevailing wind.
  const windFarms = [];
  const nWind = biome === 'grass' ? 3 : biome === 'snow' ? 1 : 2;
  const rise = (x, z) => hf.carved(x, z) - (hf.carved(x + 1200, z) + hf.carved(x - 1200, z) + hf.carved(x, z + 1200) + hf.carved(x, z - 1200)) / 4;
  const cand = searchSites(40, (x, z) => (slopeAt(x, z) < 0.1 ? { score: rise(x, z) } : null), { airport: 4500, city: 1200, spacing: 3000 });
  cand.sort((p, q) => q.score - p.score);
  for (const c of cand.slice(0, nWind)) {
    const dir = (cfg.prevailingWind + 90) * DEG;
    const ux = Math.sin(dir); const uz = -Math.cos(dir);
    const turbines = [];
    const rows = 2; const per = 6 + Math.floor(rng.range(0, 4));
    for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
      const along = (i - per / 2) * 430 + rng.range(-40, 40);
      const across = r * 520 + rng.range(-40, 40);
      const x = c.x + ux * along - uz * across; const z = c.z + uz * along + ux * across;
      if (!free(x, z, { airport: 4000, city: 800 }) || slopeAt(x, z) > 0.2) continue;
      turbines.push({ x, z });
    }
    if (turbines.length > 3) windFarms.push({ x: c.x, z: c.z, turbines });
  }

  // Solar farms on flat land.
  const solarFarms = [];
  const nSolar = biome === 'desert' ? 3 : biome === 'grass' ? 2 : 0;
  for (const s of searchSites(nSolar, (x, z) => (slopeAt(x, z) < 0.02 && slopeAt(x + 300, z + 200) < 0.025 ? { yaw: 0 } : null), { airport: 3000, city: 900, spacing: 9000 })) {
    solarFarms.push({ x: s.x, z: s.z, w: 520, d: 340, rowSpacing: 11 });
  }

  // Quarries on hillsides (grass and desert).
  const quarries = [];
  if (biome !== 'snow') {
    for (const q of searchSites(biome === 'grass' ? 2 : 1, (x, z) => { const sl = slopeAt(x, z); return sl > 0.06 && sl < 0.2 ? { r: rng.range(230, 330), depth: rng.range(22, 34) } : null; }, { airport: 4000, city: 1500, spacing: 12000 })) quarries.push(q);
  }

  // Ski lifts and runs above the snow-map towns.
  const skiLifts = [];
  const skiRuns = [];
  if (biome === 'snow') {
    for (const t of towns.slice(0, 3)) {
      let best = null;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const x0 = t.x + Math.cos(a) * (t.radius + 500);
        const z0 = t.z + Math.sin(a) * (t.radius + 500);
        const x1 = t.x + Math.cos(a) * (t.radius + 2300);
        const z1 = t.z + Math.sin(a) * (t.radius + 2300);
        if (env.inLake(x1, z1) || env.inAirport(x1, z1, 300) || env.inAirport(x0, z0, 300)) continue;
        const gain = hf.carved(x1, z1) - hf.carved(x0, z0);
        if (gain > 120 && gain < 700 && (!best || gain > best.gain)) best = { a, gain, x0, z0, x1, z1 };
      }
      if (!best) continue;
      skiLifts.push({ points: [{ x: best.x0, z: best.z0 }, { x: best.x1, z: best.z1 }], town: t.name });
      for (let k = -1; k <= 1; k++) {
        const ox = -Math.sin(best.a) * k * 190; const oz = Math.cos(best.a) * k * 190;
        const mid = k === 0 ? 0 : 0.3 * k;
        const pts = [];
        for (let s = 0; s <= 8; s++) {
          const f = s / 8;
          const sway = Math.sin(f * 5 + k) * 90 * (k === 0 ? 0.3 : 1);
          pts.push({ x: best.x0 + (best.x1 - best.x0) * f + ox * (0.4 + f * 0.9) - Math.sin(best.a) * sway + mid * 0, z: best.z0 + (best.z1 - best.z0) * f + oz * (0.4 + f * 0.9) + Math.cos(best.a) * sway });
        }
        skiRuns.push({ points: pts, width: k === 0 ? 70 : 55 });
      }
    }
  }

  // Lakeside jetties and boathouses.
  const harbours = [];
  map.lakes.forEach((l, i) => {
    if (l.oasis || l.radius < 600) return;
    if (biome === 'desert') return;
    const th = rng.range(0, Math.PI * 2);
    const f = 1;
    harbours.push({ lake: i, theta: th, x: l.x + Math.cos(th) * l.radius * f, z: l.z + Math.sin(th) * l.radius * f });
  });

  // Radio and cell masts on high ground near the larger settlements, and one by each regional field.
  const masts = [];
  for (const c of [major, ...towns].filter(Boolean)) {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = rng.range(0, 6.28); const rr = c.radius * rng.range(1.2, 2.6);
      const x = c.x + Math.cos(a) * rr; const z = c.z + Math.sin(a) * rr;
      if (!free(x, z, { airport: 2500, city: 100 })) continue;
      const h = hf.carved(x, z);
      if (!best || h > best.h) best = { x, z, h };
    }
    if (best) masts.push({ x: best.x, z: best.z, h: c.kind === 'major' ? 190 : 120, kind: 'radio' });
  }

  // Power lines: from the big city's substation to each town and every wind and solar farm.
  const substations = [];
  const subFor = (c) => {
    const a = rng.range(0, 6.28);
    for (let i = 0; i < 12; i++) {
      const x = c.x + Math.cos(a + i * 0.5) * c.radius * 1.25; const z = c.z + Math.sin(a + i * 0.5) * c.radius * 1.25;
      if (free(x, z, { airport: 2200, city: 50 })) { const s = { x, z, name: c.name }; substations.push(s); return s; }
    }
    return null;
  };
  const targets = [];
  if (major) { const s = subFor(major); if (s) targets.push(s); }
  for (const t of towns) { const s = subFor(t); if (s) targets.push(s); }
  for (const w of windFarms) { const s = { x: w.x, z: w.z + 300, name: 'wind' }; substations.push(s); targets.push(s); }
  for (const w of solarFarms) { const s = { x: w.x - 340, z: w.z, name: 'solar' }; substations.push(s); targets.push(s); }
  if (targets.length > 1) {
    const done = [targets[0]];
    const left = targets.slice(1);
    while (left.length) {
      let best = null;
      for (const a of done) for (const b of left) { const dd = Math.hypot(a.x - b.x, a.z - b.z); if (!best || dd < best.d) best = { a, b, d: dd }; }
      left.splice(left.indexOf(best.b), 1); done.push(best.b);
      const pts = route(map, env, best.a, best.b, rng, { step: 500, amp: 0, slopeWeight: 0.2, relax: 2 });
      const towers = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]; const b = pts[k + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.round(len / 280));
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const x = a.x + (b.x - a.x) * t; const z = a.z + (b.z - a.z) * t;
          towers.push({ x, z, yaw: Math.atan2(b.x - a.x, -(b.z - a.z)) });
        }
      }
      const last = pts[pts.length - 1];
      towers.push({ x: last.x, z: last.z, yaw: towers.length ? towers[towers.length - 1].yaw : 0 });
      power.push({ points: pts, towers: towers.filter((t) => !env.inLake(t.x, t.z, 1.15) && !env.inAirport(t.x, t.z, 100)) });
    }
  }

  // Desert pipelines from the major city to the far towns.
  if (biome === 'desert' && major) {
    for (const t of towns.slice(0, 2)) {
      const pts = trim(route(map, env, t, major, rng, { step: 300, amp: 150, slopeWeight: 1.5 }), t, major);
      if (pts.length > 2) pipelines.push({ points: pts, width: 3 });
    }
  }

  return { stadium, roads, rails, stations, power, substations, pipelines, windFarms, solarFarms, quarries, skiLifts, skiRuns, harbours, masts };
}
