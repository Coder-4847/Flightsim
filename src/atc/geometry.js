import { layoutAirport } from '../world/airportLayout.js';

// Airfield geometry for ATC and AI traffic: active runway selection, taxi routes between stands
// and runway ends (a shortest path over the airport's taxi graph, built by airportLayout.js), and the
// approach path. All coordinates are world metres.

const DEG = Math.PI / 180;
export const dirOf = (headingDeg) => ({ x: Math.sin(headingDeg * DEG), z: -Math.cos(headingDeg * DEG) });
export const headingOf = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360;
export const isTowered = (airport) => airport.spec.tower;

/** Find a runway end by id across every runway of an airport. */
export function findEnd(airport, endId) {
  for (const rw of airport.runways) for (const end of rw.ends) if (end.id === endId) return { runway: rw, end, index: rw.ends.indexOf(end) };
  const rw = airport.runways[0];
  return { runway: rw, end: rw.ends[0], index: 0 };
}

/** The runway end best into the wind. `windVec` is the wind velocity (m/s, the way the air moves). */
export function bestEnd(airport, windVec, preferRunway = null) {
  const rwList = preferRunway ? airport.runways.filter((r) => r === preferRunway) : airport.runways.slice(0, 1);
  let best = null;
  for (const rw of rwList) {
    for (const end of rw.ends) {
      const d = dirOf(end.heading);
      const head = -(windVec.x * d.x + windVec.z * d.z); // positive = headwind
      if (!best || head > best.head) best = { runway: rw, end, head };
    }
  }
  return best;
}

/** Approach geometry for a runway end: threshold, heading, unit direction, glidepath helpers. */
export function approachFor(airport, endId) {
  const { runway, end, index } = findEnd(airport, endId);
  const dir = dirOf(end.heading);
  const farEnd = runway.ends[1 - index].threshold;
  return {
    airport, runway, end, dir, heading: end.heading, threshold: end.threshold, far: farEnd, length: runway.length,
    elevation: airport.elevation,
    /** Point on the extended centreline `back` metres before the threshold. */
    before(back, lateral = 0) {
      return { x: end.threshold.x - dir.x * back + -dir.z * lateral, z: end.threshold.z - dir.z * back + dir.x * lateral };
    },
    /** Distance along the runway (from the threshold) and lateral offset (right positive) of a point. */
    local(x, z) {
      const dx = x - end.threshold.x;
      const dz = z - end.threshold.z;
      return { along: dx * dir.x + dz * dir.z, lateral: dx * -dir.z + dz * dir.x };
    },
  };
}

const standOf = (layout, i) => layout.stands[Math.max(0, Math.min(i, layout.stands.length - 1))];

/**
 * Taxi route from a stand to the hold-short point of a runway end, over the airport's taxi graph.
 * Returns { points, hold, entry, heading } where `entry` is the runway centreline point reached after
 * the hold point.
 */
export function departureRoute(airport, endId, standIndex = 0) {
  const layout = layoutAirport(airport);
  const { graph } = layout;
  const { runway, end } = findEnd(airport, endId);
  const stand = standOf(layout, standIndex);
  const hn = graph.keys.get(`hold:${end.id}`);
  const en = graph.keys.get(`entry:${end.id}`);
  const route = hn != null && en != null && stand.node != null ? graph.path(stand.node, hn) : null;
  if (route) {
    const hold = { x: graph.nodes[hn].x, z: graph.nodes[hn].z };
    const entry = { x: graph.nodes[en].x, z: graph.nodes[en].z };
    return { points: route, hold, entry, heading: end.heading, runway, end };
  }
  // No taxiway reaches this runway end (for example the far end of a cross runway): straight to a point beside the threshold.
  const d = dirOf(end.heading);
  const hw = runway.width / 2;
  const entry = { x: end.threshold.x + d.x * 40, z: end.threshold.z + d.z * 40 };
  const hold = { x: entry.x + -d.z * (hw + 30), z: entry.z + d.x * (hw + 30) };
  return { points: [{ x: stand.park.x, z: stand.park.z }, hold], hold, entry, heading: end.heading, runway, end };
}

/** Taxi route from a runway exit to a stand, for arrivals that landed on `endId`. */
export function arrivalRoute(airport, endId, standIndex = 0, touchdownAlong = 350) {
  const layout = layoutAirport(airport);
  const { graph } = layout;
  const ap = approachFor(airport, endId);
  const { runway, end } = ap;
  const stand = standOf(layout, standIndex);
  // candidate exits on this runway, ahead of the touchdown point
  const cands = [];
  for (const [key, idx] of graph.keys) {
    if (!key.startsWith('exit:')) continue;
    const who = key.split(':')[1];
    if (who !== end.id && who !== 'mid') continue;
    const n = graph.nodes[idx];
    const loc = ap.local(n.x, n.z);
    if (Math.abs(loc.lateral) > 4 || loc.along < touchdownAlong + 120 || loc.along > runway.length - 80) continue;
    cands.push({ idx, along: loc.along });
  }
  cands.sort((p, q) => p.along - q.along);
  const pick = cands.find((c) => c.along - touchdownAlong > 650) ?? cands[cands.length - 1];
  const route = pick && stand.node != null ? graph.path(pick.idx, stand.node) : null;
  if (route && route.length > 1) {
    // leave the runway by a straight chord to the first point clear of its edge, so "vacated" means off the pavement
    let k = 1;
    while (k < route.length - 1 && Math.abs(ap.local(route[k].x, route[k].z).lateral) < runway.width / 2 + 4) k++;
    return { points: [route[0], ...route.slice(k)], runway, end, exitAlong: pick.along };
  }
  const d = dirOf(end.heading);
  const exit = { x: end.threshold.x + d.x * (touchdownAlong + 700), z: end.threshold.z + d.z * (touchdownAlong + 700) };
  return { points: [exit, { x: stand.park.x, z: stand.park.z }], runway, end };
}

/** Total length of a polyline. */
export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}
