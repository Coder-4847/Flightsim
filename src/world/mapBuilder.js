import { Rng } from '../util/random.js';
import { createBaseHeight, createHeightfield } from './heightfield.js';
import { AIRPORT_CLASSES, MAPS, MAP_HALF } from './maps.js';
import { PolylineSet } from './polyline.js';

// Turns a static map definition into a world: height function, rivers, lakes, cities, airports
// (with runways and ILS data), navaids, waypoints and roads. Pure data, no rendering, so it also
// runs headless for tests and for the physics.

const DEG = Math.PI / 180;
const HALF_USABLE = MAP_HALF * 0.82; // keep features away from the mountain rim

const dirOf = (headingDeg) => ({ x: Math.sin(headingDeg * DEG), z: -Math.cos(headingDeg * DEG) });
const pad2 = (n) => String(n).padStart(2, '0');
const runwayNumber = (heading) => pad2(Math.round(((heading % 360) + 360) % 360 / 10) % 36 || 36);

// ---- rivers -------------------------------------------------------------------------------------
function generateRivers(cfg, base, rng) {
  const lines = [];
  const step = 450;
  for (let r = 0; r < cfg.rivers.count; r++) {
    // Start from the highest of several random points near the rim and run downhill.
    let best = null;
    for (let i = 0; i < 30; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rad = MAP_HALF * rng.range(0.55, 0.8);
      const p = { x: Math.cos(a) * rad, z: Math.sin(a) * rad };
      p.h = base(p.x, p.z);
      if (!best || p.h > best.h) best = p;
    }
    let { x, z } = best;
    let heading = Math.atan2(-z, -x) + rng.range(-0.6, 0.6); // roughly toward the centre
    const pts = [];
    for (let i = 0; i < 260; i++) {
      pts.push({ x, z });
      // Look ahead at three headings and flow toward the lowest ground, with meander noise.
      let bestScore = Infinity;
      let bestHeading = heading;
      for (const d of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const h2 = heading + d;
        const score = base(x + Math.cos(h2) * 1400, z + Math.sin(h2) * 1400) + rng.range(-6, 6) + Math.abs(d) * 4;
        if (score < bestScore) { bestScore = score; bestHeading = h2; }
      }
      heading += Math.max(-0.28, Math.min(0.28, bestHeading - heading)) + rng.range(-0.1, 0.1);
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
      if (Math.abs(x) > MAP_HALF * 0.97 || Math.abs(z) > MAP_HALF * 0.97) break;
    }
    if (pts.length < 20) continue;
    // Bed profile: smoothed terrain along the path, never rising downstream.
    let prev = Infinity;
    const [wMin, wMax] = cfg.rivers.width;
    pts.forEach((p, i) => {
      const avg = (base(p.x, p.z) + base(pts[Math.max(0, i - 1)].x, pts[Math.max(0, i - 1)].z) + base(pts[Math.min(pts.length - 1, i + 1)].x, pts[Math.min(pts.length - 1, i + 1)].z)) / 3;
      prev = Math.min(prev - 0.25, avg - 3);
      p.y = prev;
      p.w = wMin + (wMax - wMin) * (i / pts.length);
    });
    lines.push({ points: pts, kind: 'river' });
  }
  return lines;
}

// ---- site search -----------------------------------------------------------------------------------
function flatness(fn, x, z, radius) {
  let lo = fn(x, z);
  let hi = lo;
  for (let i = 0; i < 8; i++) {
    const h = fn(x + Math.cos(i * 0.785) * radius, z + Math.sin(i * 0.785) * radius);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return hi - lo;
}

/**
 * Random site search: flat enough, clear of `taken` features (by radius), at least `spacing` from
 * every site in `apart`, optionally near an anchor. `reject(x, z)` vetoes a position.
 */
function findSite(rng, fn, o) {
  const { radius, spacing = 0, taken = [], apart = [], near, nearMin = 0, nearMax = 1e9, limit = HALF_USABLE, reject } = o;
  let allowed = o.maxRange;
  for (let attempt = 0; attempt < 6000; attempt++) {
    if (attempt % 700 === 699) allowed *= 1.35; // relax if the map is rugged
    let x;
    let z;
    if (near) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(nearMin, nearMax);
      x = near.x + Math.cos(a) * d;
      z = near.z + Math.sin(a) * d;
    } else {
      x = rng.range(-limit, limit);
      z = rng.range(-limit, limit);
    }
    if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
    if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < (t.radius ?? 0) + radius + 300)) continue;
    if (apart.some((t) => Math.hypot(t.x - x, t.z - z) < spacing)) continue;
    if (reject?.(x, z)) continue;
    if (flatness(fn, x, z, radius) > allowed) continue;
    return { x, z };
  }
  return null;
}

// ---- lakes -------------------------------------------------------------------------------------------
function generateLakes(cfg, base, rng, taken) {
  const lakes = [];
  if (!cfg.lakes.count || cfg.biome === 'desert') return lakes;
  // Candidate basins: low relative to the ring around them.
  const cands = [];
  for (let i = 0; i < 700; i++) {
    const x = rng.range(-HALF_USABLE, HALF_USABLE);
    const z = rng.range(-HALF_USABLE, HALF_USABLE);
    let ring = 0;
    for (let k = 0; k < 6; k++) ring += base(x + Math.cos(k * 1.047) * 3200, z + Math.sin(k * 1.047) * 3200);
    cands.push({ x, z, score: base(x, z) - ring / 6 });
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands) {
    if (lakes.length >= cfg.lakes.count) break;
    const radius = rng.range(cfg.lakes.radius[0], cfg.lakes.radius[1]);
    if (lakes.some((l) => Math.hypot(l.x - c.x, l.z - c.z) < 12000)) continue;
    if (taken.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 6000)) continue;
    lakes.push({
      x: c.x, z: c.z, radius, level: base(c.x, c.z) + 2, frozen: cfg.biome === 'snow', oasis: false,
    });
  }
  return lakes;
}

// ---- cities -----------------------------------------------------------------------------------------------
const lakeObstacles = (hf) => hf.lakes.map((l) => ({ x: l.x, z: l.z, radius: l.radius * 1.8 }));

function generateCities(cfg, hf, rng) {
  const cities = [];
  const names = [...cfg.cityNames];
  const nextName = () => names.shift() ?? `Settlement ${cities.length + 1}`;
  const add = (kind, radius, maxRange, spacing, extra = {}) => {
    const site = findSite(rng, hf.carved, {
      radius, maxRange, spacing, apart: cities, taken: lakeObstacles(hf), reject: (x, z) => hf.rivers && hf.rivers.nearest(x, z).dist < radius * 0.4 + 200, ...extra,
    });
    if (!site) return null;
    const city = {
      id: `city${cities.length}`, name: nextName(), kind, x: site.x, z: site.z, radius,
      angle: rng.range(-0.2, 0.2), density: kind === 'major' ? 1 : kind === 'town' ? 0.7 : 0.5,
    };
    cities.push(city);
    return city;
  };
  add('major', 6500, 140, 30000, { limit: MAP_HALF * 0.45 });
  for (let i = 0; i < cfg.cities.towns; i++) add('town', rng.range(1500, 2300), 90, 16000);
  for (let i = 0; i < cfg.cities.villages; i++) add('village', rng.range(380, 700), 60, 8000);
  return cities;
}

// ---- airports -----------------------------------------------------------------------------------------------
function makeIlsFrequency(index) {
  return +(108.1 + ((index * 2) % 40) * 0.1).toFixed(2); // odd tenths 108.10 .. 111.90
}

function buildRunways(cls, rng, cfg, ilsCounter, code) {
  const defs = AIRPORT_CLASSES[cls].runways;
  const mainHeading = Math.round((cfg.prevailingWind + rng.pick([-20, -10, 0, 0, 10, 20])) / 10) * 10;
  return defs.map((def, i) => {
    let heading = mainHeading;
    if (def.cross) heading = mainHeading + rng.pick([-60, -50, 50, 60]);
    heading = ((heading % 360) + 360) % 360;
    const dir = dirOf(heading);
    const side = { x: -dir.z, z: dir.x }; // 90 degrees to the right of the runway heading
    const offset = 480; // spacing of a parallel pair; the main runway sits half of it to the left, the parallel half to the right
    const label = (h) => runwayNumber(h);
    // The lower-numbered end names the runway: "09/27".
    const endA = { heading, id: label(heading) };
    const endB = { heading: (heading + 180) % 360, id: label(heading + 180) };
    let suffixA = '';
    let suffixB = '';
    if (defs.some((d) => d.parallel)) {
      if (def.parallel) { suffixA = 'R'; suffixB = 'L'; } else { suffixA = 'L'; suffixB = 'R'; }
    }
    endA.id += suffixA;
    endB.id += suffixB;
    const rw = {
      length: def.length, width: def.width, surface: def.grass ? 'grass' : 'asphalt', heading,
      offsetX: side.x * (def.parallel ? offset / 2 : !def.cross && defs.some((d) => d.parallel) ? -offset / 2 : 0),
      offsetZ: side.z * (def.parallel ? offset / 2 : !def.cross && defs.some((d) => d.parallel) ? -offset / 2 : 0),
      ends: [endA, endB],
    };
    rw.name = [endA.id, endB.id].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).join('/');
    // ILS on both ends of the main runway(s) of ILS-equipped airports.
    if (AIRPORT_CLASSES[cls].ils && !def.cross) {
      for (const e of rw.ends) {
        e.ils = { ident: `I${code.slice(2)}${e.id.slice(-1) === 'L' ? 'L' : e.id.slice(-1) === 'R' ? 'R' : e.id.slice(0, 1)}`.slice(0, 4), frequency: makeIlsFrequency(ilsCounter.n++), glideslope: 3.0, course: e.heading };
      }
    }
    return rw;
  });
}

function generateAirports(cfg, hf, cities, rng) {
  const airports = [];
  const names = [...cfg.airportNames];
  const major = cities.find((c) => c.kind === 'major');
  const towns = cities.filter((c) => c.kind === 'town');
  const villages = cities.filter((c) => c.kind === 'village');
  const ilsCounter = { n: 0 };
  const taken = [...cities.map((c) => ({ x: c.x, z: c.z, radius: c.radius })), ...lakeObstacles(hf)];
  const sites = [];
  const place = (cls, o) => {
    const spec = AIRPORT_CLASSES[cls];
    const site = findSite(rng, hf.carved, {
      radius: spec.flatRadius * 0.8, maxRange: cls === 'hub' ? 30 : 45, spacing: 9000, taken, apart: sites,
      reject: (x, z) => hf.rivers && hf.rivers.nearest(x, z).dist < spec.flatRadius * 1.6, ...o,
    });
    if (!site) return;
    sites.push({ ...site, cls });
  };

  // The hub sits a short drive from the major city; regionals near towns; the rest are scattered.
  if (cfg.airports.hub && major) place('hub', { near: major, nearMin: major.radius + 3000, nearMax: major.radius + 9000, spacing: 5000 });
  else if (cfg.airports.hub) place('hub', {});
  for (let i = 0; i < cfg.airports.regional; i++) {
    const t = towns[i % Math.max(1, towns.length)];
    place('regional', t ? { near: t, nearMin: t.radius + 2200, nearMax: t.radius + 6500, spacing: 7000 } : {});
  }
  for (let i = 0; i < cfg.airports.small; i++) place('small', {});
  for (let i = 0; i < cfg.airports.strip; i++) {
    const v = villages[i % Math.max(1, villages.length)];
    place('strip', v ? { near: v, nearMin: v.radius + 1000, nearMax: v.radius + 4000, spacing: 7000 } : {});
  }

  sites.forEach((s, i) => {
    const spec = AIRPORT_CLASSES[s.cls];
    const name = names.shift() ?? `Field ${i + 1}`;
    let code = (cfg.codePrefix + name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase();
    while (airports.some((a) => a.code === code)) code = code.slice(0, 3) + String.fromCharCode(65 + (code.charCodeAt(3) - 64) % 26);
    // Elevation: mean of the surrounding natural terrain.
    let e = hf.carved(s.x, s.z);
    for (let k = 0; k < 6; k++) e += hf.carved(s.x + Math.cos(k * 1.047) * 500, s.z + Math.sin(k * 1.047) * 500);
    const elevation = e / 7;
    const runways = buildRunways(s.cls, rng, cfg, ilsCounter, code);
    // Runway end threshold coordinates and the along-runway unit vectors.
    runways.forEach((rw) => {
      const dir = dirOf(rw.heading);
      const cx = s.x + rw.offsetX;
      const cz = s.z + rw.offsetZ;
      rw.cx = cx; rw.cz = cz;
      rw.ends[0].threshold = { x: cx - dir.x * rw.length / 2, z: cz - dir.z * rw.length / 2 };
      rw.ends[1].threshold = { x: cx + dir.x * rw.length / 2, z: cz + dir.z * rw.length / 2 };
    });
    airports.push({
      id: code, code, name, cls: s.cls, classLabel: spec.label, x: s.x, z: s.z, elevation, flatRadius: spec.flatRadius,
      runways, spec,
      frequencies: { tower: +(118.1 + i * 0.35).toFixed(2), ground: +(121.7 + i * 0.05).toFixed(2), approach: +(119.1 + i * 0.3).toFixed(2), atis: +(127.2 + i * 0.1).toFixed(2) },
      towerPos: { x: s.x + 160, z: s.z - 120 }, // refined by the airport builder
    });
  });
  return airports;
}

// ---- navaids and waypoints -------------------------------------------------------------------------------------
const FIX_SYLLABLES = ['AL', 'BA', 'CO', 'DA', 'EL', 'FA', 'GO', 'HA', 'IL', 'JU', 'KA', 'LO', 'MA', 'NE', 'OR', 'PA', 'RI', 'SO', 'TA', 'UN', 'VA', 'WE', 'ZO'];

function generateNavaids(cfg, airports, rng) {
  const navaids = [];
  const waypoints = [];
  let vorFreq = 112.3;
  const ident3 = (name) => name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  airports.forEach((a) => {
    if (a.cls === 'hub' || a.cls === 'regional') {
      const dir = dirOf(a.runways[0].heading);
      navaids.push({ type: 'VOR', ident: ident3(a.name), name: `${a.name.split(' ')[0]} VOR`, frequency: +(vorFreq).toFixed(2), x: a.x - dir.x * 1800 + 900, z: a.z - dir.z * 1800 - 600, airport: a.code });
      vorFreq += 0.45;
    } else if (a.cls === 'small') {
      navaids.push({ type: 'NDB', ident: ident3(a.name), name: `${a.name.split(' ')[0]} NDB`, frequency: 320 + navaids.length * 11, x: a.x + 700, z: a.z + 500, airport: a.code });
    }
    // Initial approach fix 14 km out on each ILS centreline.
    a.runways.forEach((rw) => rw.ends.forEach((e) => {
      if (!e.ils) return;
      const dir = dirOf(e.heading);
      const name = `${rng.pick(FIX_SYLLABLES)}${rng.pick(FIX_SYLLABLES)}${rng.pick('ABCDEFGHKLMNPRSTUVWXYZ')}`;
      waypoints.push({ ident: name, x: e.threshold.x - dir.x * 14000, z: e.threshold.z - dir.z * 14000, kind: 'IAF', airport: a.code, runway: e.id });
    }));
  });
  // En-route fixes and a few stand-alone beacons.
  for (let i = 0; i < 14; i++) {
    waypoints.push({
      ident: `${rng.pick(FIX_SYLLABLES)}${rng.pick(FIX_SYLLABLES)}${rng.pick('ABCDEFGHKLMNPRSTUVWXYZ')}`,
      x: rng.range(-HALF_USABLE, HALF_USABLE), z: rng.range(-HALF_USABLE, HALF_USABLE), kind: 'ENR',
    });
  }
  for (let i = 0; i < 3; i++) {
    navaids.push({
      type: i === 0 ? 'NDB' : 'VOR', ident: `${rng.pick('ABCDEFGHKLMNPRSTUVWXYZ')}${rng.pick('ABCDEFGHKLMNPRSTUVWXYZ')}${rng.pick('ABCDEFGHKLMNPRSTUVWXYZ')}`,
      name: 'En-route beacon', frequency: i === 0 ? 395 : +(vorFreq + i * 0.35).toFixed(2), x: rng.range(-HALF_USABLE, HALF_USABLE), z: rng.range(-HALF_USABLE, HALF_USABLE), airport: null,
    });
  }
  return { navaids, waypoints };
}

// ---- roads ---------------------------------------------------------------------------------------------------------
/** Connect settlements and airports with a minimum spanning tree of gently wiggling roads. */
function generateRoads(cfg, cities, airports, rng) {
  const nodes = [
    ...cities.map((c) => ({ x: c.x, z: c.z, kind: c.kind })),
    ...airports.filter((a) => a.cls !== 'strip').map((a) => ({ x: a.x + 450, z: a.z + 450, kind: 'airport' })),
  ];
  const lines = [];
  const inTree = [0];
  const rest = new Set(nodes.map((_, i) => i).filter((i) => i > 0));
  const sparse = cfg.biome === 'desert';
  while (rest.size) {
    let best = null;
    for (const i of inTree) for (const j of rest) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
      if (!best || d < best.d) best = { i, j, d };
    }
    if (!best) break;
    inTree.push(best.j);
    rest.delete(best.j);
    const a = nodes[best.i];
    const b = nodes[best.j];
    const len = best.d;
    const pts = [];
    const steps = Math.max(2, Math.round(len / 160));
    const phase = rng.range(0, 6);
    const amp = Math.min(900, len * 0.06);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const wig = Math.sin(t * Math.PI * 3 + phase) * amp * Math.sin(t * Math.PI);
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      pts.push({ x: a.x + (b.x - a.x) * t + nx * wig, z: a.z + (b.z - a.z) * t + nz * wig });
    }
    lines.push({ points: pts, width: sparse ? 7 : best.d > 20000 ? 9 : 8, major: !sparse && (nodes[best.i].kind === 'major' || nodes[best.j].kind === 'major') });
  }
  return lines;
}

// ---- entry point ---------------------------------------------------------------------------------------------------------
const cache = new Map();

export function buildMap(id) {
  if (cache.has(id)) return cache.get(id);
  const cfg = MAPS[id];
  const rng = new Rng(cfg.seed * 7 + 3);
  const base = createBaseHeight(cfg);

  const riverLines = cfg.rivers.count ? generateRivers(cfg, base, rng) : [];
  const rivers = riverLines.length ? new PolylineSet(riverLines, 2500) : null;
  const lakes = generateLakes(cfg, base, rng, []);
  const hf = createHeightfield(cfg, { rivers, lakes });

  const cities = generateCities(cfg, hf, rng);
  if (cfg.biome === 'desert') {
    // Oasis ponds beside the oasis towns.
    cities.filter((c) => c.kind === 'town').slice(0, cfg.lakes.count).forEach((c) => {
      const a = rng.range(0, 6.28);
      const radius = rng.range(cfg.lakes.radius[0], cfg.lakes.radius[1]);
      const d = c.radius + radius + 250;
      lakes.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, radius, level: hf.carved(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d) - 2, frozen: false, oasis: true });
    });
  }
  const airports = generateAirports(cfg, hf, cities, rng);
  hf.setAirports(airports);
  const { navaids, waypoints } = generateNavaids(cfg, airports, rng);
  const roads = generateRoads(cfg, cities, airports, rng);

  const map = { id, cfg, hf, rivers, riverLines, lakes, cities, airports, navaids, waypoints, roads, half: MAP_HALF };
  cache.set(id, map);
  return map;
}

export function getAirport(map, code) {
  return map.airports.find((a) => a.code === code) ?? map.airports[0];
}
