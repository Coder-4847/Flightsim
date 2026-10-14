import { layoutAirport } from '../world/airportLayout.js';

// Airfield geometry for ATC and AI traffic: active runway selection, taxi routes between stands
// and runway ends, and the approach path. All coordinates are world metres.

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

/** Which runway edge side the taxiway sits on, and the connector positions along the runway axis. */
function taxiPlan(airport, runway) {
  const layout = layoutAirport(airport);
  const t = layout.taxi;
  const h = layout.heading; // heading of the main runway's first end
  const main = airport.runways[0];
  const origin = { x: airport.x, z: airport.z };
  const d = dirOf(h);
  const right = { x: -d.z, z: d.x };
  const at = (along, perp) => ({ x: origin.x + d.x * along + right.x * perp, z: origin.z + d.z * along + right.z * perp });
  if (!t) return { layout, at, d, right, h, t: null, main };
  void runway;
  return { layout, at, d, right, h, t, main };
}

const aligned = (runway, plan) => {
  const diff = Math.abs(((runway.heading - plan.h + 540) % 360) - 180);
  return diff < 1; // runway parallel to the main one, so the taxiways serve it
};

/** Perpendicular offsets (from the main axis) of the taxiway and the runway centreline for a runway. */
function lanes(airport, runway, plan) {
  const t = plan.t;
  const rwIndex = airport.runways.indexOf(runway);
  const perpTaxi = t.hasPair ? t.perp[rwIndex === 0 ? 0 : 1] : t.perp[0];
  const rwPerp = t.hasPair ? (rwIndex === 0 ? -240 : 240) : 0;
  const apronPerp = t.hasPair ? Math.sign(perpTaxi) * 85 : t.terminalSide * (runway.width / 2 + 95 + 12);
  return { perpTaxi, rwPerp, apronPerp };
}

/**
 * Taxi route from a stand to the hold-short point of a runway end.
 * Returns { points, hold, entry, heading } where `entry` is the runway centreline point reached after
 * the hold point.
 */
export function departureRoute(airport, endId, standIndex = 0) {
  const { runway, end, index } = findEnd(airport, endId);
  const plan = taxiPlan(airport, runway);
  const stand = plan.layout.stands[Math.min(standIndex, plan.layout.stands.length - 1)];
  const pts = [{ x: stand.x, z: stand.z }];
  const hw = runway.width / 2;
  const d = dirOf(end.heading);
  if (!plan.t || !aligned(runway, plan)) {
    // Grass strips and cross runways have no taxiway: go straight to the threshold.
    const entry = { x: end.threshold.x + d.x * 40, z: end.threshold.z + d.z * 40 };
    const hold = { x: entry.x + -d.z * (hw + 30), z: entry.z + d.x * (hw + 30) };
    pts.push(hold);
    return { points: pts, hold, entry, heading: end.heading, runway, end };
  }
  const { perpTaxi, rwPerp, apronPerp } = lanes(airport, runway, plan);
  const connector = (index === 0 ? -1 : 1) * plan.t.len * 0.95;
  const standLocal = (stand.x - airport.x) * plan.d.x + (stand.z - airport.z) * plan.d.z;
  pts.push(plan.at(standLocal, apronPerp));
  pts.push(plan.at(standLocal, perpTaxi));
  pts.push(plan.at(connector, perpTaxi));
  const towardRunway = Math.sign(rwPerp - perpTaxi) || -1;
  const hold = plan.at(connector, rwPerp - towardRunway * (hw + 45));
  pts.push(hold);
  const entry = plan.at(connector, rwPerp);
  return { points: pts, hold, entry, heading: end.heading, runway, end };
}

/** Taxi route from a runway exit to a stand, for arrivals that landed on `endId`. */
export function arrivalRoute(airport, endId, standIndex = 0, touchdownAlong = 350) {
  const { runway, end, index } = findEnd(airport, endId);
  const plan = taxiPlan(airport, runway);
  const stand = plan.layout.stands[Math.min(standIndex, plan.layout.stands.length - 1)];
  const d = dirOf(end.heading);
  if (!plan.t || !aligned(runway, plan)) {
    const exit = { x: end.threshold.x + d.x * (touchdownAlong + 700), z: end.threshold.z + d.z * (touchdownAlong + 700) };
    return { points: [exit, { x: stand.x, z: stand.z }], runway, end };
  }
  const { perpTaxi, rwPerp, apronPerp } = lanes(airport, runway, plan);
  const len = plan.t.len;
  const connectors = (plan.t.hasPair ? [-0.95, 0, 0.95] : [-0.95, 0.95]).map((c) => c * len);
  // Along-axis coordinate of the touchdown point; the roll runs toward +along on the first end, -along on the second.
  const dirSign = index === 0 ? 1 : -1;
  const touchdown = -dirSign * (runway.length / 2) + dirSign * touchdownAlong;
  const ahead = connectors.filter((c) => (c - touchdown) * dirSign > 0).sort((p, q) => (p - q) * dirSign);
  let exit = ahead.find((c) => (c - touchdown) * dirSign > 650) ?? ahead[ahead.length - 1] ?? connectors[connectors.length - 1];
  if (exit == null) exit = connectors[0];
  const standLocal = (stand.x - airport.x) * plan.d.x + (stand.z - airport.z) * plan.d.z;
  const points = [plan.at(exit, rwPerp), plan.at(exit, perpTaxi), plan.at(standLocal, perpTaxi), plan.at(standLocal, apronPerp), { x: stand.x, z: stand.z }];
  return { points, runway, end, exitAlong: exit };
}

/** Total length of a polyline. */
export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}
