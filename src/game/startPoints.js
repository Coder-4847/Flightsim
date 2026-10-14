import { getAircraft } from '../aircraft/index.js';
import { KT } from '../flight/units.js';

// Where and how a flight begins on a map: at a runway threshold, on a 3-degree final, or in
// flight above the airport.

const DEG = Math.PI / 180;
const dirOf = (h) => ({ x: Math.sin(h * DEG), z: -Math.cos(h * DEG) });

export const START_MODES = [
  { id: 'runway', label: 'On the runway', hint: 'Lined up at the threshold, ready for takeoff.' },
  { id: 'final', label: 'Final approach', hint: 'About 4.5 km out on a 3° glide path, gear and flaps set.' },
  { id: 'air', label: 'In flight', hint: 'Trimmed and cruising above the airfield.' },
];

/** Find a runway end by id ('07R') in an airport, or the first end of the first runway. */
export function findRunwayEnd(airport, endId) {
  for (const rw of airport.runways) {
    for (const end of rw.ends) if (end.id === endId) return { runway: rw, end };
  }
  return { runway: airport.runways[0], end: airport.runways[0].ends[0] };
}

/** Highest terrain within `radius` of a point, sampled on rings (used to pick a safe altitude). */
function terrainCeiling(map, x, z, radius) {
  let max = -Infinity;
  for (const r of [radius * 0.33, radius * 0.66, radius]) {
    for (let i = 0; i < 24; i++) max = Math.max(max, map.hf.height(x + Math.cos(i * 0.2618) * r, z + Math.sin(i * 0.2618) * r));
  }
  return max;
}

/**
 * @returns {{ x, y, z, heading, reset: object }} spawn point plus the arguments for FlightModel.reset
 */
export function startPoint(map, airport, endId, mode, aircraftId) {
  const spec = getAircraft(aircraftId);
  const { end } = findRunwayEnd(airport, endId);
  const d = dirOf(end.heading);
  const t = end.threshold;
  if (mode === 'final') {
    const dist = 4500 + (spec.speeds.vapp > 120 ? 2500 : 0);
    const x = t.x - d.x * dist;
    const z = t.z - d.z * dist;
    const ground = map.hf.height(x, z);
    const alt = Math.max(airport.elevation + dist * Math.tan(3 * DEG) + 14, ground + 150);
    return { x, y: alt, z, heading: end.heading, reset: { mode: 'final', heading: end.heading, x, z, altitude: alt, speed: spec.speeds.vapp * KT, pathAngle: -3 } };
  }
  if (mode === 'air') {
    const ceiling = terrainCeiling(map, airport.x, airport.z, 10000);
    const alt = Math.min(Math.max(airport.elevation + 1500, ceiling + 400), 6500);
    return { x: airport.x, y: alt, z: airport.z, heading: end.heading, reset: { mode: 'air', heading: end.heading, x: airport.x, z: airport.z, altitude: alt, speed: spec.speeds.cruise * KT } };
  }
  const x = t.x + d.x * 60;
  const z = t.z + d.z * 60;
  return { x, y: airport.elevation + 2, z, heading: end.heading, reset: { mode: 'runway', heading: end.heading, x, z } };
}
