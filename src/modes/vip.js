import { getAircraft } from '../aircraft/index.js';
import { buildMap } from '../world/mapBuilder.js';
import { economyOf } from '../progress/catalog.js';
import { CRUISE_BURN } from './missions.js';

// VIP Escort: carry an important passenger to a destination. The fare depends on how comfortable
// the flight was (the comfort meter) and on how hard the touchdown was.

const V = (id, tier, title, aircraft, map, from, to, vip, o = {}) => ({ id, tier, title, aircraft, map, from, to, vip, kind: 'vip', ...o });

export const VIP_CONTRACTS = [
  V('v01', 1, 'Minister in a hurry', 'kingair', 'grasslands', 'VPME', 'VPFA', 'Minister Okafor', {
    brief: 'The minister is nervous about flying. A calm, level ride is worth more than a quick one.', pax: 2 }),
  V('v02', 1, 'Desert delegation', 'citation', 'desert', 'DSAL', 'DSWA', 'Ambassador Lindqvist', {
    brief: 'A short hop to Wadi Haven for a signing ceremony. Keep the cabin steady.', pax: 3, arriveBy: 25 }),
  V('v03', 2, 'Ski-resort summit', 'citation', 'snow', 'FRNO', 'FRFR', 'Chairwoman Ramos', {
    brief: 'Mountain turbulence is likely. Fly smoothly and avoid steep banks.', pax: 4, sky: 'overcast', arriveBy: 40 }),
  V('v04', 2, 'Night arrival', 'bizjet', 'grasslands', 'VPHA', 'VPME', 'Prince Aldar', {
    brief: 'The prince flies at night and expects a landing so gentle he will not wake.', pax: 5, hour: 21 }),
  V('v05', 2, 'Afternoon thermals', 'bizjet', 'desert', 'DSTA', 'DSAL', 'Dr. Weiss', {
    brief: 'Hot afternoon air makes for a bumpy climb. Ride it out gently.', pax: 4, hour: 14.5, arriveBy: 40 }),
  V('v06', 3, 'Snowbound inspection', 'kingair', 'snow', 'FRSK', 'FRHV', 'Inspector Varga', {
    brief: 'A long leg across the range in falling snow.', pax: 3, sky: 'snow', weather: 'gusty' }),
  V('v07', 3, 'Trade delegation', 'turboprop72', 'desert', 'DSQA', 'DSTA', 'Trade Envoy Haddad', {
    brief: 'Forty delegates in the cabin. Smooth handling is everything.', pax: 40, arriveBy: 50 }),
  V('v08', 3, 'Rain in the Plains', 'regional', 'grasslands', 'VPST', 'VPHA', 'President Novak', {
    brief: 'Rain and gusts on arrival. Do not rush the landing.', pax: 20, sky: 'rain', weather: 'gusty', arriveBy: 35 }),
  V('v09', 4, 'State visit', 'narrowbody', 'snow', 'FRNO', 'FRSK', 'Head of State Mercer', {
    brief: 'Full ceremony on arrival. The ambassador wants it flawless.', pax: 60, sky: 'overcast', arriveBy: 30 }),
  V('v10', 4, 'Royal sightseeing', 'widebody', 'grasslands', 'VPME', 'VPME', 'Queen Marisol', {
    brief: 'A circuit over Stonebridge for an honoured guest. Gentle turns and a feather-light touchdown.', pax: 40, via: ['Stonebridge'], hour: 17, arriveBy: 30 }),
];

const BY_ID = new Map(VIP_CONTRACTS.map((v) => [v.id, v]));
export const vipById = (id) => BY_ID.get(id) ?? null;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function resolveVip(def) {
  const map = buildMap(def.map);
  const from = map.airports.find((a) => a.code === def.from);
  const to = map.airports.find((a) => a.code === def.to);
  if (!from || !to) throw new Error(`VIP ${def.id}: unknown airport`);
  const spec = getAircraft(def.aircraft);
  const eco = economyOf(def.aircraft);
  const via = (def.via ?? []).map((name) => {
    const c = map.cities.find((x) => x.name === name);
    if (!c) throw new Error(`VIP ${def.id}: unknown city ${name}`);
    return { id: c.id, name: c.name, x: c.x, z: c.z, radius: c.radius + 1500 };
  });
  let route = 0;
  let prev = from;
  for (const v of via) { route += dist(prev, v); prev = v; }
  route += dist(prev, to);
  const routeKm = route / 1000;
  const kmPerMin = (spec.speeds.cruise * 1.852) / 60;
  const estMinutes = 5 + routeKm / (kmPerMin * 0.8);
  const burn = CRUISE_BURN[def.aircraft] ?? 500;
  const fuelKg = Math.round(Math.min(spec.mass.fuelCapacity, Math.max(spec.mass.fuelStart, burn * (estMinutes / 60) * 1.5 + burn * 0.3)));
  const base = Math.max(1500, Math.round((Math.max(routeKm, 10) * eco.rate * 4 + 2400 * def.tier + (def.pax ?? 0) * 8) / 50) * 50);
  return {
    ...def, mapData: map, fromAirport: from, toAirport: to, via, spec, routeKm, estMinutes, fuelKg, base, startMode: 'runway',
    hour: def.hour ?? 11, sky: def.sky ?? 'clear', weatherPreset: def.weather ?? (def.tier === 1 ? 'calm' : 'breeze'), goals: [], arriveBy: def.arriveBy ?? null,
  };
}

/** The comfort a passenger feels, 0 - 100. Updated at 10 Hz from telemetry. */
export class ComfortMeter {
  constructor(tolerance = 1) {
    this.value = 100;
    this.tolerance = tolerance; // below 1 = the cabin pack damps the ride
    this.reason = null;
    this.worstReason = null;
    this.events = [];
  }

  /** @param t telemetry; dt seconds */
  update(dt, t) {
    // On the ground only the touchdown itself (see touchdown()) matters; the roll-out and taxi are gentle by comparison.
    if (t.onGround) { this.reason = null; return; }
    let loss = 0;
    let why = null;
    const note = (amount, text) => { if (amount > 0) { loss += amount; if (!why || amount > why.amount) why = { amount, text }; } };
    const dn = Math.abs(t.nz - 1);
    note((dn - 0.45) * 8 + Math.max(0, dn - 0.9) * 40, dn > 0.9 ? 'hard pull' : 'turbulence');
    note((Math.abs(t.bank) - 40) * 0.15, 'steep bank');
    note((Math.abs(t.pitchRate) - 9) * 0.2, 'abrupt pitch change');
    note((Math.abs(t.rollRate) - 20) * 0.15, 'abrupt roll');
    note((-t.vsFpm - 3000) / 450, 'steep descent');
    note(t.vsFpm > 4500 ? (t.vsFpm - 4500) / 600 : 0, 'steep climb');
    if (t.stalled) note(6, 'stall');
    else if (t.stallWarning) note(1.5, 'stall warning');
    if (t.overspeed) note(2, 'overspeed buffet');
    loss *= this.tolerance;
    if (loss > 0) {
      this.value = Math.max(0, this.value - loss * dt);
      this.reason = why.text;
      this.worstReason = why.text;
    } else {
      this.reason = null;
      this.value = Math.min(100, this.value + 0.9 * dt);
    }
  }

  /** One-off knock from the touchdown. */
  touchdown(grade) {
    const hit = { Smooth: 0, Good: 1, Firm: 6, Hard: 18, 'Very hard': 40 }[grade] ?? 0;
    this.value = Math.max(0, this.value - hit * this.tolerance);
    return hit;
  }
}
