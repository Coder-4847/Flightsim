import { AIRCRAFT, getAircraft } from '../aircraft/index.js';

// What can be bought, and what each aircraft earns. All prices and rates are in credits (cr).
// Quick Flight ignores this catalogue (everything is available, nothing is earned); the save-based
// modes (Free Flight, Career, Emergency, VIP) use it.

export const START_MONEY = 10000;
export const START_AIRCRAFT = ['cessna172'];

/**
 * price     purchase price
 * role      'pax' | 'cargo' | 'none': what the aircraft carries in Free Flight
 * pax       passengers at full load (pax role); cargoKg for the cargo role
 * rate      credits per km flown (hull / crew)
 * paxRate   credits per passenger-km;  cargoRate credits per kg-km
 * landing   landing fee base (credits) for a smooth touchdown at an airport
 */
export const ECONOMY = {
  cessna172: { price: 0, role: 'pax', pax: 3, rate: 8, paxRate: 0.6, landing: 120, repair: 0.02 },
  caravan: { price: 18000, role: 'cargo', cargoKg: 900, rate: 11, cargoRate: 0.045, landing: 160, repair: 0.02 },
  trainer: { price: 30000, role: 'none', rate: 14, landing: 200, repair: 0.02 },
  kingair: { price: 45000, role: 'pax', pax: 7, rate: 18, paxRate: 1.0, landing: 260, repair: 0.02 },
  turboprop72: { price: 90000, role: 'pax', pax: 58, rate: 30, paxRate: 0.5, landing: 420, repair: 0.02 },
  citation: { price: 110000, role: 'pax', pax: 5, rate: 25, paxRate: 1.6, landing: 380, repair: 0.02 },
  bizjet: { price: 190000, role: 'pax', pax: 12, rate: 40, paxRate: 2.0, landing: 520, repair: 0.02 },
  regional: { price: 240000, role: 'pax', pax: 70, rate: 40, paxRate: 0.5, landing: 700, repair: 0.02 },
  narrowbody: { price: 420000, role: 'pax', pax: 150, rate: 60, paxRate: 0.45, landing: 1000, repair: 0.02 },
  widebody: { price: 800000, role: 'pax', pax: 330, rate: 90, paxRate: 0.4, landing: 1600, repair: 0.02 },
  jumbo: { price: 1200000, role: 'pax', pax: 410, rate: 110, paxRate: 0.4, landing: 2000, repair: 0.02 },
  fighter: { price: 300000, role: 'none', rate: 28, landing: 400, repair: 0.02 },
  hornet: { price: 520000, role: 'none', rate: 34, landing: 500, repair: 0.02 },
  heavyfighter: { price: 700000, role: 'none', rate: 40, landing: 600, repair: 0.02 },
};

export const economyOf = (aircraftId) => ECONOMY[aircraftId] ?? ECONOMY.cessna172;
export const aircraftPrice = (aircraftId) => economyOf(aircraftId).price;

// ---- liveries ---------------------------------------------------------------------------------------------------
// Fictional paint schemes. A scheme overrides the colours of an aircraft's factory livery.
export const CIVIL_PAINTS = [
  { id: 'skyline', name: 'Skyline Blue', paint: { base: '#f4f5f7', stripe: '#1e66d0', stripe2: '#8fb8ee', belly: '#dfe3e8', wing: '#f1f3f6', tip: 0x1e66d0 } },
  { id: 'ember', name: 'Ember Freight', paint: { base: '#eceae6', stripe: '#d9541e', stripe2: '#2b2b2b', belly: '#d4d1cb', wing: '#e6e3de', tip: 0xd9541e } },
  { id: 'evergreen', name: 'Evergreen Air', paint: { base: '#f2f4f1', stripe: '#1f7a4d', stripe2: '#c8d86a', belly: '#d9dfd6', wing: '#eaeee8', tip: 0x1f7a4d } },
  { id: 'midnight', name: 'Midnight Charter', paint: { base: '#262b33', stripe: '#c9a24a', stripe2: '#5a6270', belly: '#1c2027', wing: '#2e343d', tip: 0xc9a24a } },
  { id: 'sunburst', name: 'Sunburst', paint: { base: '#f6e7b5', stripe: '#e0662b', stripe2: '#a1311c', belly: '#e6d49a', wing: '#f1dfa6', tip: 0xe0662b } },
];
export const MILITARY_PAINTS = [
  { id: 'dune', name: 'Dune Camouflage', paint: { base: '#b09a72', belly: '#9a8662', wing: '#a8936b', tip: 0x6b5d42 } },
  { id: 'arctic', name: 'Arctic Grey', paint: { base: '#dfe5ea', belly: '#c9d1d8', wing: '#d5dce2', tip: 0x7b8793 } },
  { id: 'shadow', name: 'Shadow', paint: { base: '#3a3f47', belly: '#30343b', wing: '#363b42', tip: 0x22262b, regColor: '#9aa3ad' } },
];

export const FACTORY = { id: 'factory', name: 'Factory', price: 0 };

const isMilitary = (spec) => spec.class === 'Fighter' || spec.class === 'Jet trainer';
const roundTo = (v, step) => Math.round(v / step) * step;

/** Paint schemes for one aircraft, factory first. */
export function liveriesFor(aircraftId) {
  const spec = getAircraft(aircraftId);
  const price = Math.max(1500, roundTo(aircraftPrice(aircraftId) * 0.04, 500));
  const list = (isMilitary(spec) ? MILITARY_PAINTS : CIVIL_PAINTS).map((p) => ({ ...p, price: isMilitary(spec) ? Math.round(price * 0.7 / 100) * 100 : price }));
  return [{ ...FACTORY, paint: null }, ...list];
}

export function findLivery(aircraftId, liveryId) {
  return liveriesFor(aircraftId).find((l) => l.id === liveryId) ?? liveriesFor(aircraftId)[0];
}

const paintedSpecs = new Map();

/** A copy of the aircraft spec wearing the given livery (the original is untouched). Copies are cached. */
export function specWithLivery(aircraftId, liveryId) {
  const spec = getAircraft(aircraftId);
  const livery = findLivery(aircraftId, liveryId);
  if (!livery.paint) return spec;
  const key = `${spec.id}:${livery.id}`;
  if (!paintedSpecs.has(key)) paintedSpecs.set(key, { ...spec, livery: { ...spec.livery, ...livery.paint }, liveryId: livery.id });
  return paintedSpecs.get(key);
}

// ---- upgrades -------------------------------------------------------------------------------------------------------------
export const UPGRADES = [
  { id: 'gps', name: 'Moving-map GPS', price: 4000, blurb: 'Adds the navigation map (M): airports, runways, navaids, traffic and your track.' },
  { id: 'approach', name: 'Approach assist', price: 6500, blurb: 'Adds the approach guide (F8): localiser and glide-path needles, runway distance and a live landing score.' },
  { id: 'gpws', name: 'Terrain awareness', price: 9000, blurb: 'Adds "TERRAIN — PULL UP" warnings with a voice call when the ground is rising towards you.' },
  { id: 'cabin', name: 'Cabin comfort pack', price: 15000, blurb: 'Quieter, better-damped cabins: passengers and VIPs tolerate 25% more rough handling and every passenger or VIP fare pays 20% more.' },
  { id: 'cargo', name: 'Cargo handling pack', price: 12000, blurb: 'Faster loading and secured pallets: cargo fares pay 20% more and cargo shifts matter less.' },
  { id: 'insurance', name: 'Hull insurance', price: 20000, blurb: 'Crash repair bills drop by 75%.' },
];

export const upgradeById = (id) => UPGRADES.find((u) => u.id === id);
export const ALL_UPGRADE_IDS = UPGRADES.map((u) => u.id);

export const AIRCRAFT_IDS = AIRCRAFT.map((a) => a.id);
