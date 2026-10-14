import { Rng } from '../util/random.js';
import { createTrafficModel, setHeading } from './fleet.js';
import { layoutAirport } from '../world/airportLayout.js';

// Aircraft parked on the stands of each airport, chosen by airport size.

const POOLS = {
  hub: [['narrowbody', 5], ['regional', 3], ['bizjet', 2], ['turboprop72', 1], ['widebody', 2], ['jumbo', 1]],
  regional: [['turboprop72', 3], ['regional', 3], ['narrowbody', 1], ['citation', 2], ['kingair', 1]],
  small: [['cessna172', 4], ['caravan', 2], ['kingair', 1], ['citation', 1]],
  strip: [['cessna172', 3], ['caravan', 1]],
};
// Wide aircraft take over the neighbouring stand as well.
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
  const fill = { hub: 0.7, regional: 0.65, small: 0.6, strip: 0.5 }[airport.cls];
  let skip = false;
  layout.stands.forEach((stand, i) => {
    if (skip) { skip = false; return; }
    if (!rng.chance(fill)) return;
    const id = pickWeighted(rng, POOLS[airport.cls]);
    const variant = rng.int(0, 7);
    const { root, spec } = createTrafficModel(id, variant);
    setHeading(root, stand.heading);
    // Nosewheel/mainwheel contact height plus the struts' static compression.
    root.position.set(stand.x - airport.x, -spec.gear.mainLeft.y - 0.1, stand.z - airport.z);
    root.userData.traffic = id;
    root.userData.stand = i;
    root.userData.variant = variant;
    group.add(root);
    (group.userData.parked ??= []).push({ stand: i, id, root, spec });
    if (WIDE.has(id) && airport.cls === 'hub') skip = true;
    void i;
  });
}
