import { Rng } from '../util/random.js';
import { createTrafficModel, setHeading } from './fleet.js';
import { layoutAirport, standPlacement } from '../world/airportLayout.js';

// Aircraft parked nose-in on the stands of each airport, chosen by airport size and stand type.
// Positions come from the stand's nose-gear stop mark, so every aircraft type sits correctly at its
// jet bridge or tie-down regardless of its length.

const POOLS = {
  hub: [['narrowbody', 6], ['regional', 3], ['bizjet', 1], ['widebody', 3], ['jumbo', 1]],
  regional: [['turboprop72', 3], ['regional', 3], ['narrowbody', 1], ['citation', 1], ['kingair', 1]],
  small: [['cessna172', 4], ['caravan', 2], ['kingair', 1], ['citation', 1]],
  strip: [['cessna172', 3], ['caravan', 1]],
};
const WIDE = new Set(['widebody', 'jumbo']);

function pickWeighted(rng, pool) {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rng.float() * total;
  for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
  return pool[0][0];
}

/** Adds parked aircraft to an airport group (positioned at the airport's origin). */
export function addParkedTraffic(group, airport) {
  const layout = layoutAirport(airport);
  let seed = 0;
  for (const ch of airport.code) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = new Rng(seed ^ 0x5eed);
  const fill = { hub: 0.78, regional: 0.7, small: 0.62, strip: 0.5 }[airport.cls];
  const playerStand = Math.floor(layout.stands.length / 2); // the gate start position: keep it free
  const blocked = new Set([playerStand]);
  const placed = [];
  layout.stands.forEach((stand, i) => {
    if (blocked.has(i)) return;
    if (!rng.chance(fill)) return;
    let id = pickWeighted(rng, POOLS[airport.cls]);
    // wide-body aircraft need the neighbouring stand on the same side to stay empty
    if (WIDE.has(id)) {
      const next = i + 2;
      if (next >= layout.stands.length || blocked.has(next) || placed.includes(i - 2)) id = 'narrowbody';
      else blocked.add(next);
    }
    // jet bridges and the regional stands serve airliners; remote and tie-down stands take the rest
    const variant = rng.int(0, 7);
    const { root, spec } = createTrafficModel(id, variant);
    const p = standPlacement(stand, spec);
    setHeading(root, p.heading);
    root.position.set(p.x - airport.x, -spec.gear.mainLeft.y - 0.1, p.z - airport.z);
    root.userData.traffic = id;
    root.userData.stand = i;
    root.userData.variant = variant;
    group.add(root);
    placed.push(i);
    (group.userData.parked ??= []).push({ stand: i, id, root, spec });
  });
}
