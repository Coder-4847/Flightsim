import { economyOf } from '../progress/catalog.js';

// How flights turn into money. Everything here is pure arithmetic over plain objects so it can be
// unit-tested without a browser. Amounts are whole credits.

/** More realistic settings pay more. */
export const MODE_MULTIPLIER = { arcade: 1, custom: 1.1, simulation: 1.3 };
export const modeMultiplier = (preset) => MODE_MULTIPLIER[preset] ?? 1;

export const GRADES = ['Smooth', 'Good', 'Firm', 'Hard', 'Very hard'];
export const gradeIndex = (g) => Math.max(0, GRADES.indexOf(g));

/** Free Flight fare multiplier for the touchdown: a smooth landing adds up to 20%, a rough one takes up to 30% off. */
export const LANDING_FARE = { Smooth: 1.2, Good: 1.05, Firm: 0.9, Hard: 0.8, 'Very hard': 0.7 };
/** A very short hop pays only part of the landing fee, so shuttling between neighbouring airports is not the best earner. */
export const SHORT_HOP_KM = 15;
export const shortHopFactor = (km) => Math.max(0.3, Math.min(1, km / SHORT_HOP_KM));

/** VIP payout tiers: the harder the landing, the smaller the cheque. */
export const VIP_TIERS = [
  { grade: 'Smooth', factor: 1, text: 'Full fare' },
  { grade: 'Good', factor: 0.8, text: '80% of the fare' },
  { grade: 'Firm', factor: 0.55, text: '55% of the fare' },
  { grade: 'Hard', factor: 0.25, text: '25% of the fare' },
  { grade: 'Very hard', factor: 0, text: 'No fare' },
];
export const vipLandingFactor = (grade) => VIP_TIERS.find((t) => t.grade === grade)?.factor ?? 0;

/** Comfort (0-100) to a pay multiplier, with a readable label. */
export function comfortTier(comfort) {
  if (comfort >= 85) return { label: 'Delighted', factor: 1 };
  if (comfort >= 65) return { label: 'Comfortable', factor: 0.9 };
  if (comfort >= 40) return { label: 'Uneasy', factor: 0.7 };
  if (comfort > 0) return { label: 'Distressed', factor: 0.45 };
  return { label: 'Terrified', factor: 0 };
}

/** Passenger load factor 0.55 - 0.95, repeatable from a number. */
export function loadFactor(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return 0.55 + 0.4 * (x - Math.floor(x));
}

/** Free Flight pays for the straight-line distance between airports plus a modest allowance for the route flown. */
export function paidDistanceKm(trackKm, straightKm) {
  return Math.max(0, Math.min(trackKm, straightKm * 1.5 + 15));
}

export const SIGHTSEEING_BONUS = (aircraftId) => Math.round(300 + economyOf(aircraftId).rate * 8);

const line = (label, amount) => ({ label, amount: Math.round(amount) });

/**
 * Free Flight payout for one completed leg.
 * @param o {aircraftId, trackKm, straightKm, grade, atAirport, onRunway, pax, cargoKg, pois, multiplier, upgrades:[ids]}
 */
export function freeFlightPayout(o) {
  const eco = economyOf(o.aircraftId);
  const has = (id) => o.upgrades?.includes(id);
  const km = paidDistanceKm(o.trackKm, o.straightKm);
  const lines = [];
  lines.push(line(`Distance (${km.toFixed(1)} km)`, km * eco.rate));
  let load = 0;
  if (eco.role === 'pax' && o.pax > 0) {
    load = o.pax * km * eco.paxRate * (has('cabin') ? 1.2 : 1);
    lines.push(line(`Passengers (${o.pax})`, load));
  } else if (eco.role === 'cargo' && o.cargoKg > 0) {
    load = o.cargoKg * km * eco.cargoRate * (has('cargo') ? 1.2 : 1);
    lines.push(line(`Cargo (${Math.round(o.cargoKg)} kg)`, load));
  }
  if (o.atAirport) lines.push(line('Landing fee', eco.landing * shortHopFactor(km) * (o.onRunway ? 1 : 0.5)));
  if (o.pois > 0) lines.push(line(`Sightseeing (${o.pois})`, o.pois * SIGHTSEEING_BONUS(o.aircraftId)));
  let subtotal = lines.reduce((s, l) => s + l.amount, 0);
  if (o.atAirport) {
    const factor = LANDING_FARE[o.grade] ?? LANDING_FARE['Very hard'];
    const pct = Math.round((factor - 1) * 100);
    lines.push(line(`Touchdown: ${o.grade}${pct ? ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)}%)` : ''}`, subtotal * (factor - 1)));
    subtotal += subtotal * (factor - 1);
  }
  const mult = o.multiplier ?? 1;
  if (mult !== 1) lines.push(line(`Realism bonus ×${mult.toFixed(1)}`, subtotal * (mult - 1)));
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/** The repair bill after a crash: a flat amount per aircraft (about a flight's pay, a little more for big aircraft). */
export function crashPenalty(aircraftId, insured) {
  const raw = Math.max(250, economyOf(aircraftId).repair);
  return Math.round(raw * (insured ? 0.25 : 1) / 10) * 10;
}

/** Career mission payout: the contract's base, plus 15% for each extra star. */
export function missionPayout({ base, stars, multiplier = 1, kind, upgrades = [] }) {
  const lines = [line('Contract', base)];
  if (stars > 1) lines.push(line(`Bonus objectives (${stars - 1})`, base * 0.15 * (stars - 1)));
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const perk = kind === 'pax' && upgrades.includes('cabin') ? 'Cabin pack +20%' : kind === 'cargo' && upgrades.includes('cargo') ? 'Cargo pack +20%' : null;
  if (perk) lines.push(line(perk, sub * 0.2));
  const sub2 = lines.reduce((s, l) => s + l.amount, 0);
  if (multiplier !== 1) lines.push(line(`Realism bonus ×${multiplier.toFixed(1)}`, sub2 * (multiplier - 1)));
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

/** VIP escort payout from the contract fare, passenger comfort and landing tier. */
export function vipPayout({ base, comfort, grade, multiplier = 1, upgrades = [], onTime = true }) {
  const lines = [line('Charter fare', base)];
  const tier = comfortTier(comfort);
  const landing = vipLandingFactor(grade);
  let total = base * tier.factor * landing;
  if (tier.factor !== 1) lines.push(line(`Comfort: ${tier.label} (${Math.round(comfort)}%)`, base * tier.factor - base));
  else lines.push(line(`Comfort: ${tier.label} (${Math.round(comfort)}%)`, 0));
  const afterComfort = base * tier.factor;
  lines.push(line(`Landing: ${grade} (${Math.round(landing * 100)}%)`, afterComfort * landing - afterComfort));
  if (upgrades.includes('cabin')) { lines.push(line('Cabin pack +20%', total * 0.2)); total *= 1.2; }
  if (!onTime) { lines.push(line('Late arrival −15%', -total * 0.15)); total *= 0.85; }
  if (multiplier !== 1) lines.push(line(`Realism bonus ×${multiplier.toFixed(1)}`, total * (multiplier - 1)));
  return { lines, total: Math.max(0, lines.reduce((s, l) => s + l.amount, 0)) };
}

/** Emergency Landing score (0-100) to a letter and a payout. */
export function emergencyGrade(score) {
  return score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score > 0 ? 'D' : 'F';
}

export function emergencyPayout({ score, aircraftId, difficulty = 1, multiplier = 1 }) {
  const eco = economyOf(aircraftId);
  const base = Math.round((900 + eco.rate * 55) * (0.8 + difficulty * 0.3));
  const lines = [line('Hazard pay', base * (score / 100))];
  if (multiplier !== 1) lines.push(line(`Realism bonus ×${multiplier.toFixed(1)}`, lines[0].amount * (multiplier - 1)));
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}
