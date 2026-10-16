import { getAircraft } from '../aircraft/index.js';
import { FPM } from '../flight/units.js';
import { economyOf } from './catalog.js';

// Per-aircraft upgrades ("tuning"). Every aircraft has its own six tracks of five levels each; the levels are bought
// with credits in the shop and stored per aircraft in the save. A tuned flight uses a modified copy of the aircraft
// spec (the original is never touched), so the flight model needs no special cases. Quick Flight is always stock.

export const MAX_LEVEL = 5;

/**
 * Each track changes a handful of spec numbers, `per` of them per level (all levels stack linearly).
 * apply(spec, L) mutates a private copy of the spec for level L (1..5).
 */
const scale = (obj, key, k) => { if (obj && obj[key] != null) obj[key] *= k; };

export const TRACKS = [
  {
    id: 'engine', name: 'Engine tuning',
    blurb: 'More power or thrust: faster acceleration, a shorter take-off, a better climb and a higher top speed.',
    per: 0.05,
    apply(spec, L) {
      const e = spec.engines.spec;
      const k = 1 + 0.05 * L;
      scale(e, 'power', k); scale(e, 'staticThrust', k); scale(e, 'thrust', k); scale(e, 'thrustDry', k);
      scale(e, 'fuelFlowMax', 1 + 0.02 * L); scale(e, 'fuelFlowAb', 1 + 0.02 * L);
      spec.tuneRatio.thrust = k; // the autopilot lowers its throttle gain by this much
    },
    stat(spec) {
      const e = spec.engines.spec;
      const n = spec.engines.positions.length;
      return e.type === 'turbofan' ? `Thrust ${Math.round(e.thrust * n / 1000)} kN` : `Power ${Math.round(e.power * n / 1000)} kW`;
    },
  },
  {
    id: 'drag', name: 'Streamlining',
    blurb: 'Fairings, sealed gaps and a polished skin: less drag, so a higher top speed, a higher never-exceed speed and a better fuel economy.',
    per: 0.04,
    apply(spec, L) {
      scale(spec.aero, 'cd0', 1 - 0.04 * L); scale(spec.aero, 'gearCd', 1 - 0.04 * L);
      spec.limits.vne = Math.round(spec.limits.vne * (1 + 0.015 * L));
      if (spec.limits.mmo) spec.limits.mmo = Math.round((spec.limits.mmo + 0.01 * L) * 100) / 100;
    },
    stat(spec) { return `Drag ${Math.round((spec.aero.cd0 / getAircraft(spec.id).aero.cd0 - 1) * 100) || 0}% · Vne ${spec.limits.vne} kt`; },
  },
  {
    id: 'weight', name: 'Lightweight airframe',
    blurb: 'Carbon panels and stripped fittings: a lighter aircraft climbs faster, takes off shorter and stalls slower.',
    per: 0.02,
    apply(spec, L) { scale(spec.mass, 'empty', 1 - 0.02 * L); },
    stat(spec) { return `Empty weight ${Math.round(spec.mass.empty).toLocaleString('en-US')} kg`; },
  },
  {
    id: 'handling', name: 'Control surfaces',
    blurb: 'Bigger, better-balanced control surfaces and faster actuators: a sharper roll, pitch and rudder response.',
    per: 0.05,
    apply(spec, L) {
      const k = 1 + 0.05 * L;
      for (const key of ['clDa', 'cmDe', 'clDr', 'cnDr']) scale(spec.aero, key, k);
      scale(spec.controls, 'rate', 1 + 0.04 * L);
      scale(spec.fcs, 'rollRate', 1 + 0.06 * L);
      spec.tuneRatio.control = k; // the autopilot lowers its stick gains by this much
    },
    stat(spec) {
      const base = getAircraft(spec.id);
      const pct = Math.round((spec.aero.clDa / base.aero.clDa - 1) * 100);
      return spec.fcs ? `Roll rate ${Math.round(spec.fcs.rollRate)}°/s` : `Control response +${pct}%`;
    },
  },
  {
    id: 'gear', name: 'Gear and brakes',
    blurb: 'Stronger legs and bigger brakes: more grip on the runway and a harder touchdown before the gear is damaged or the aircraft is lost.',
    per: 0.04,
    apply(spec, L) {
      scale(spec.gear, 'brakeMu', 1 + 0.06 * L);
      scale(spec.limits, 'hardLanding', 1 + 0.04 * L); scale(spec.limits, 'crashLanding', 1 + 0.04 * L);
    },
    stat(spec) { return `Hard-landing limit ${Math.round(spec.limits.hardLanding / FPM / 10) * 10} ft/min`; },
  },
  {
    id: 'fuel', name: 'Fuel efficiency',
    blurb: 'Better fuel metering and lean burn: every engine burns less fuel, so you fly further on a tank.',
    per: 0.05,
    apply(spec, L) {
      const k = 1 - 0.05 * L;
      for (const key of ['fuelFlowIdle', 'fuelFlowMax', 'fuelFlowAb']) scale(spec.engines.spec, key, k);
    },
    stat(spec) {
      // Rough still-air range: a full tank at about 60% of the maximum flow, flown at cruise speed.
      const e = spec.engines.spec;
      const flow = e.fuelFlowMax * 0.6 * spec.engines.positions.length;
      const km = spec.mass.fuelCapacity / flow * spec.speeds.cruise * 1.852 / 3600;
      return `Range about ${Math.round(km / 10) * 10} km`;
    },
  },
];

export const trackById = (id) => TRACKS.find((t) => t.id === id);
export const TRACK_IDS = TRACKS.map((t) => t.id);
export const MAX_UPGRADES = TRACKS.length * MAX_LEVEL;

// ---- levels ------------------------------------------------------------------------------------------------------

/** { engine: 2, ... } with every track clamped to 0..5 (unknown keys dropped). */
export function cleanLevels(raw) {
  const out = {};
  for (const t of TRACKS) {
    const v = Math.floor(Number(raw?.[t.id]));
    if (v > 0) out[t.id] = Math.min(MAX_LEVEL, v);
  }
  return out;
}

export const levelOf = (levels, trackId) => levels?.[trackId] ?? 0;
export const totalLevels = (levels) => TRACKS.reduce((s, t) => s + levelOf(levels, t.id), 0);

// ---- prices ------------------------------------------------------------------------------------------------------

/**
 * What a 15 km hop pays in this aircraft (75% load, Good landing): the yardstick the upgrade prices are scaled to,
 * so a Skyhawk owner and a jumbo pilot both pay about the same number of flights per upgrade.
 */
export function referenceFare(aircraftId) {
  const e = economyOf(aircraftId);
  const load = e.role === 'pax' ? e.pax * 0.75 * 15 * e.paxRate : e.role === 'cargo' ? e.cargoKg * 0.75 * 15 * e.cargoRate : 0;
  return e.rate * 15 + load + e.landing;
}

export const PRICE_START = 1.2; // first upgrade, in reference fares
export const PRICE_GROWTH = 1.1; // every upgrade bought on that aircraft costs 10% more than the one before

/**
 * Price of the next upgrade on an aircraft once `bought` levels have been bought on it (across all six tracks, so each
 * purchase costs more than the last whichever track it goes into).
 */
export function upgradePrice(aircraftId, bought) {
  return Math.max(500, Math.round(referenceFare(aircraftId) * PRICE_START * PRICE_GROWTH ** bought / 50) * 50);
}

/** Total price of every remaining upgrade for an aircraft that already has `bought` levels. */
export function remainingCost(aircraftId, bought) {
  let sum = 0;
  for (let n = bought; n < MAX_UPGRADES; n++) sum += upgradePrice(aircraftId, n);
  return sum;
}

// ---- applying ----------------------------------------------------------------------------------------------------

const cache = new Map();
const signature = (levels) => TRACKS.map((t) => levelOf(levels, t.id)).join('');

/** A copy of the spec with the tuning applied. Untuned flights get the very same object back. Copies are cached. */
export function specWithTuning(spec, levels) {
  const clean = cleanLevels(levels);
  if (!totalLevels(clean)) return spec;
  const key = `${spec.id}:${spec.liveryId ?? 'factory'}:${signature(clean)}`;
  let out = cache.get(key);
  if (!out) {
    out = {
      ...spec,
      mass: { ...spec.mass }, aero: { ...spec.aero }, controls: { ...spec.controls }, gear: { ...spec.gear }, limits: { ...spec.limits },
      engines: { ...spec.engines, spec: { ...spec.engines.spec } },
      ...(spec.fcs ? { fcs: { ...spec.fcs } } : {}),
      tuning: clean, tuneRatio: { thrust: 1, control: 1 },
    };
    for (const t of TRACKS) if (clean[t.id]) t.apply(out, clean[t.id]);
    cache.set(key, out);
  }
  return out;
}

/** The aircraft as it is with one track at a given level (for the shop's before/after numbers). */
export function tunedSpec(aircraftId, levels) {
  return specWithTuning(getAircraft(aircraftId), levels);
}
