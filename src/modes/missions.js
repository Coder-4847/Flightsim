import { getAircraft } from '../aircraft/index.js';
import { buildMap } from '../world/mapBuilder.js';
import { economyOf } from '../progress/catalog.js';
import { loadFactor } from './economy.js';

// The Career: 37 contracts across the three maps and the whole roster, from light props through
// turboprops, jets and fighters to the airliners. A mission pays out when you land at the
// destination and unlocks the next one. Airports are named by their (fixed-seed) codes.
//
// kind     'pax' | 'cargo' | 'ferry' | 'precision' | 'tour'
// via      cities to overfly (in order doesn't matter) before landing
// start    'runway' (default), 'final' or 'air'
// goals    bonus objectives, one extra star each (two bonus goals => three stars):
//          grade {value}, time {minutes?}, frugal {}, pois {n}, runway {}
// deadline true = hard time limit (the mission fails if you are not down in time)
// tightFuel true = fuel load is just enough, so economy matters

export const TIERS = [
  { id: 1, name: 'Flight school', blurb: 'Light single-engine props. Learn to take off, navigate and land.' },
  { id: 2, name: 'Bush and turboprop', blurb: 'Utility turboprops and twin props on bigger loads.' },
  { id: 3, name: 'Jet age', blurb: 'The jet trainer and business jets: faster, heavier, less forgiving.' },
  { id: 4, name: 'Military', blurb: 'Fighters: ferry flights and precision approaches.' },
  { id: 5, name: 'Airline', blurb: 'Regional, narrow-body and wide-body jets, then the biggest in the fleet.' },
];

const M = (id, tier, title, aircraft, map, from, to, kind, o = {}) => ({ id, tier, title, aircraft, map, from, to, kind, ...o });

export const MISSIONS = [
  // ---- tier 1: flight school (Verdant Plains, light prop) ----
  M('c01', 1, 'First solo', 'cessna172', 'grasslands', 'VPAS', 'VPEL', 'ferry', {
    brief: 'A short hop to Elmhurst Strip to get your licence stamped. Take off, follow the heading to the strip and land.',
    goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c02', 1, 'Mail run', 'cessna172', 'grasslands', 'VPAS', 'VPLA', 'pax', {
    pax: 2, brief: 'Two passengers are waiting for the morning flight to Larkfield.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c03', 1, 'Short-field landing', 'cessna172', 'grasslands', 'VPTH', 'VPTH', 'precision', {
    start: 'final', brief: 'Thornby Strip is just 760 m of grass. You are on final: put it down and stop before the end.',
    goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),
  M('c04', 1, 'Seed delivery', 'cessna172', 'grasslands', 'VPOA', 'VPWE', 'cargo', {
    cargoKg: 220, brief: 'Seed sacks for the farms around Wexcombe. Watch the weight and the sink rate.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c05', 1, 'Scenic charter', 'cessna172', 'grasslands', 'VPST', 'VPHA', 'tour', {
    pax: 2, hour: 17.5, brief: 'Two sightseers want to see the countryside. Fly over at least two towns on the way to Harrowgate.',
    goals: [{ type: 'pois', n: 2 }, { type: 'grade', value: 'Good' }] }),
  M('c06', 1, 'Night mail', 'cessna172', 'grasslands', 'VPLA', 'VPME', 'cargo', {
    cargoKg: 150, hour: 22, deadline: true, brief: 'The post must reach Meridian tonight. Lights on, watch the altitude, and look for the runway.',
    goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c07', 1, 'Crosswind practice', 'cessna172', 'grasslands', 'VPKI', 'VPKI', 'precision', {
    start: 'final', weather: 'crosswind', sky: 'scattered', brief: 'A stiff crosswind at Kingsmere. Crab in, straighten up and land on the centreline.',
    goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),
  M('c08', 1, 'Hill-country hop', 'cessna172', 'grasslands', 'VPHA', 'VPKI', 'pax', {
    pax: 3, sky: 'overcast', tightFuel: true, brief: 'Low cloud over the hills. Keep clear of the terrain and land at Kingsmere.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),

  // ---- tier 2: bush and turboprop ----
  M('c09', 2, 'Supply drop', 'caravan', 'desert', 'DSWA', 'DSRA', 'cargo', {
    cargoKg: 800, deadline: true, brief: 'Water and medical supplies for Ramla, and the clinic is waiting: you must be down in time. The Caravan is built for this.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c10', 2, 'Strip to strip', 'caravan', 'desert', 'DSDA', 'DSJE', 'cargo', {
    cargoKg: 700, brief: 'Both ends are short sand strips. Fly the numbers.', goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),
  M('c11', 2, 'Ski-lift parts', 'caravan', 'snow', 'FRVA', 'FRAL', 'cargo', {
    cargoKg: 850, weather: 'gusty', sky: 'snow', brief: 'Gearbox parts for the Alpenrose ski lift in gusty snow showers.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c12', 2, 'Valley mail', 'caravan', 'snow', 'FRHV', 'FRRI', 'cargo', {
    cargoKg: 600, hour: 7, brief: 'Early morning mail to Rimeford. Keep the ridges on your wingtips.', goals: [{ type: 'frugal' }, { type: 'grade', value: 'Good' }] }),
  M('c13', 2, 'Commuter run', 'kingair', 'grasslands', 'VPME', 'VPHA', 'pax', {
    pax: 7, brief: 'Seven commuters for Harrowgate. Retract the gear, trim and enjoy the ride.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c14', 2, 'Desert shuttle', 'kingair', 'desert', 'DSAL', 'DSTA', 'pax', {
    pax: 6, hour: 14, tightFuel: true, brief: 'Mid-afternoon heat and thermals on the way to Tarfa. The tanks are only part full, so fly an efficient profile.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c15', 2, 'Northern link', 'kingair', 'snow', 'FRNO', 'FRSK', 'pax', {
    pax: 7, sky: 'overcast', brief: 'Join the two northern towns. Ice is possible on the way down.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c16', 2, 'Regional turboprop', 'turboprop72', 'grasslands', 'VPHA', 'VPFA', 'pax', {
    pax: 52, deadline: true, brief: 'A full 72-seat turboprop on a tight schedule: the connecting flights will not wait.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),

  // ---- tier 3: jet age ----
  M('c17', 3, 'Jet conversion', 'trainer', 'desert', 'DSWA', 'DSWA', 'precision', {
    start: 'final', brief: 'Your first jet. Fly the approach at the right speed and land it gently.', goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),
  M('c18', 3, 'Executive shuttle', 'citation', 'desert', 'DSAL', 'DSQA', 'pax', {
    pax: 5, brief: 'Five executives to Qasr Noor, briefcases and all.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c19', 3, 'Mountain charter', 'citation', 'snow', 'FRSK', 'FRFR', 'pax', {
    pax: 4, sky: 'overcast', deadline: true, brief: 'Over the range to Frostholm for a connecting flight that will not wait. Mind the freezing level.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c20', 3, 'Board meeting', 'bizjet', 'grasslands', 'VPME', 'VPST', 'pax', {
    pax: 10, hour: 8, brief: 'A board meeting at Stonebridge starts in an hour.', goals: [{ type: 'grade', value: 'Smooth' }, { type: 'time' }] }),
  M('c21', 3, 'Long hop', 'bizjet', 'desert', 'DSTA', 'DSSI', 'pax', {
    pax: 9, brief: 'The longest leg on the Basin: across the whole map to Sidi Khalid.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c22', 3, 'Powder weekend', 'bizjet', 'snow', 'FRFR', 'FRNO', 'pax', {
    pax: 10, sky: 'snow', brief: 'Guests heading home from the slopes. Contact the tower early; visibility is poor.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),

  // ---- tier 4: military ----
  M('c23', 4, 'Ferry flight', 'fighter', 'grasslands', 'VPLA', 'VPWE', 'ferry', {
    brief: 'Move the jet to Wexcombe. Fast and light on the controls: be gentle on the throttle.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c24', 4, 'Rapid redeploy', 'hornet', 'desert', 'DSRA', 'DSQA', 'ferry', {
    hour: 6.5, deadline: true, brief: 'The squadron is moving and the deadline is hard. Get there quickly.', goals: [{ type: 'time' }, { type: 'grade', value: 'Good' }] }),
  M('c25', 4, 'Northern redeploy', 'heavyfighter', 'snow', 'FRNO', 'FRHV', 'ferry', {
    brief: 'The big twin-engine interceptor heads to Hvitfjell.', goals: [{ type: 'time' }, { type: 'grade', value: 'Good' }] }),
  M('c26', 4, 'Canyon sightseer', 'hornet', 'desert', 'DSMI', 'DSRA', 'tour', {
    brief: 'A public-relations flight: fly over two settlements, then land at Ramla.', goals: [{ type: 'pois', n: 2 }, { type: 'grade', value: 'Good' }] }),
  M('c27', 4, 'Short-field fighter', 'fighter', 'snow', 'FRSK', 'FRSK', 'precision', {
    start: 'final', sky: 'overcast', brief: 'Wet runway, tight approach. Hold the speed and touch down gently.', goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),

  // ---- tier 5: airline ----
  M('c28', 5, 'Regional jet service', 'regional', 'grasslands', 'VPHA', 'VPME', 'pax', {
    pax: 60, brief: 'Seventy seats of connecting passengers for the hub.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c29', 5, 'Frostline connection', 'regional', 'snow', 'FRSK', 'FRNO', 'pax', {
    pax: 58, sky: 'overcast', brief: 'Connecting flight to Northgard International.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c30', 5, 'Narrow-body shuttle', 'narrowbody', 'grasslands', 'VPME', 'VPHA', 'pax', {
    pax: 130, brief: 'A full 150-seat jet. Configure early and fly a stable approach.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c31', 5, 'Return to Al Sahra', 'narrowbody', 'desert', 'DSTA', 'DSAL', 'pax', {
    pax: 140, hour: 19, tightFuel: true, brief: 'Evening flight home to the desert hub, on a tight fuel plan.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c32', 5, 'Mountain airline', 'narrowbody', 'snow', 'FRNO', 'FRFR', 'pax', {
    pax: 120, sky: 'rain', brief: 'Rain on the range. Intercept the ILS and use the autoflaps as a guide.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c33', 5, 'Heavy approach', 'widebody', 'grasslands', 'VPME', 'VPME', 'precision', {
    start: 'final', brief: 'A wide-body on short final at Meridian. Hold the glidepath and put it down within the zone.', goals: [{ type: 'grade', value: 'Good' }, { type: 'runway' }] }),
  M('c34', 5, 'Wide-body sightseeing', 'widebody', 'grasslands', 'VPME', 'VPME', 'tour', {
    pax: 280, via: ['Harrowgate'], hour: 16, brief: 'A scenic charter: out past Harrowgate and back to Meridian. Smooth handling matters with 280 passengers.',
    goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c35', 5, 'Desert circuit', 'widebody', 'desert', 'DSAL', 'DSAL', 'pax', {
    pax: 300, via: ['Qasr Noor'], brief: 'A positioning circuit via Qasr Noor and back to Al Sahra International.', goals: [{ type: 'grade', value: 'Good' }, { type: 'frugal' }] }),
  M('c36', 5, 'Northern jumbo', 'jumbo', 'snow', 'FRNO', 'FRNO', 'pax', {
    pax: 380, via: ['Skyvik'], sky: 'overcast', brief: 'The biggest aircraft in the fleet, out to Skyvik and home to Northgard.', goals: [{ type: 'grade', value: 'Good' }, { type: 'time' }] }),
  M('c37', 5, 'Jumbo captain', 'jumbo', 'grasslands', 'VPME', 'VPME', 'pax', {
    pax: 400, via: ['Harrowgate'], hour: 5.8, brief: 'The final test: a full jumbo around Harrowgate and back, smooth enough to impress the airline.',
    goals: [{ type: 'grade', value: 'Smooth' }, { type: 'time' }] }),
];

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));
export const missionById = (id) => BY_ID.get(id) ?? null;

/** Cruise fuel burn (kg per hour) of each aircraft, measured on the flight model at 60% throttle. */
export const CRUISE_BURN = {
  cessna172: 18, caravan: 193, trainer: 706, kingair: 410, turboprop72: 1009, citation: 1497, bizjet: 3527, regional: 2663,
  narrowbody: 4807, widebody: 11226, jumbo: 16987, fighter: 1775, hornet: 2748, heavyfighter: 4629,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Add airports, route length, timing, load, fuel and pay to a mission definition. */
export function resolveMission(def) {
  const map = buildMap(def.map);
  const from = map.airports.find((a) => a.code === def.from);
  const to = map.airports.find((a) => a.code === def.to);
  if (!from || !to) throw new Error(`Mission ${def.id}: unknown airport`);
  const spec = getAircraft(def.aircraft);
  const eco = economyOf(def.aircraft);
  const via = (def.via ?? []).map((name) => {
    const city = map.cities.find((c) => c.name === name);
    if (!city) throw new Error(`Mission ${def.id}: unknown city ${name}`);
    return { id: city.id, name: city.name, x: city.x, z: city.z, radius: city.radius + 1500 };
  });
  // Route length: origin -> each via in turn -> destination.
  let route = 0;
  let prev = from;
  for (const v of via) { route += dist(prev, v); prev = v; }
  route += dist(prev, to);
  const routeKm = route / 1000;
  const kmPerMin = (spec.speeds.cruise * 1.852) / 60;
  const estMinutes = 5 + routeKm / (kmPerMin * 0.8);
  const timeLimit = Math.ceil((estMinutes * 1.35) / 5) * 5;
  // Starting fuel: the aircraft's usual load, or more if the route needs it (up to the tanks).
  const burn = CRUISE_BURN[def.aircraft] ?? 500;
  const needKg = burn * (estMinutes / 60) * 1.5 + burn * 0.3;
  const tightKg = Math.max(10, Math.ceil((burn * (estMinutes / 60) * 1.25 + burn * 0.15) / 5) * 5);
  const fuelKg = def.tightFuel ? Math.min(spec.mass.fuelCapacity, tightKg) : Math.round(Math.min(spec.mass.fuelCapacity, Math.max(spec.mass.fuelStart, needKg)));
  const deadline = def.deadline === true ? Math.ceil((estMinutes * 1.7) / 5) * 5 : def.deadline ?? null;
  const frugalKg = Math.round(burn * (estMinutes / 60) * 1.2 / 5) * 5 + 2;
  // Load and base pay: the contract pays about twice the free-flight rate for the same flight.
  const load = def.pax ?? 0;
  const cargo = def.cargoKg ?? 0;
  const km = Math.max(routeKm, 5);
  const core = km * eco.rate + (load ? load * km * (eco.paxRate ?? 0.5) : 0) + (cargo ? cargo * km * (eco.cargoRate ?? 0.045) : 0) + eco.landing;
  const base = Math.max(500, Math.round((core * 2 + 250 * def.tier + (def.kind === 'precision' ? 600 + 250 * def.tier : 0)) / 50) * 50);
  const goals = (def.goals ?? []).map((g) => ({
    ...g,
    minutes: g.type === 'time' ? (g.minutes ?? timeLimit) : undefined,
    kg: g.type === 'frugal' ? (g.kg ?? frugalKg) : undefined,
  }));
  return {
    ...def, map: def.map, mapData: map, fromAirport: from, toAirport: to, via, spec, routeKm, estMinutes, timeLimit,
    fuelKg, frugalKg, deadline, base, goals, startMode: def.start ?? 'runway', hour: def.hour ?? 12, sky: def.sky ?? 'clear', weatherPreset: def.weather ?? (def.tier === 1 ? 'calm' : 'breeze'),
    pax: load, cargoKg: cargo,
  };
}

export function describeGoal(g) {
  switch (g.type) {
    case 'grade': return `Touch down ${g.value === 'Smooth' ? 'smoothly (under 150 ft/min)' : 'gently (Good or better, under 300 ft/min)'}`;
    case 'time': return `Land within ${g.minutes} minutes`;
    case 'frugal': return `Burn no more than ${g.kg} kg of fuel`;
    case 'pois': return `Fly over ${g.n} towns or lakes on the way`;
    case 'runway': return 'Stop on the runway';
    default: return g.type;
  }
}

/** Evaluate one bonus goal against the final report. */
export function goalMet(g, r) {
  switch (g.type) {
    case 'grade': return ['Smooth', 'Good'].slice(0, g.value === 'Smooth' ? 1 : 2).includes(r.grade);
    case 'time': return r.minutes <= g.minutes;
    case 'frugal': return r.fuelUsed <= g.kg;
    case 'pois': return r.pois >= g.n;
    case 'runway': return !!r.onRunway;
    default: return false;
  }
}

/** A mission is available when the one before it has been completed. */
export function missionUnlocked(save, id) {
  const i = MISSIONS.findIndex((m) => m.id === id);
  if (i <= 0) return i === 0;
  return !!save?.career.completed[MISSIONS[i - 1].id];
}

/** Passenger count with a repeatable bit of variation (missions already fix `pax`). */
export function paxFor(def, n = 0) {
  return def.pax ? Math.max(1, Math.round(def.pax * (0.9 + 0.1 * loadFactor(n)))) : 0;
}
