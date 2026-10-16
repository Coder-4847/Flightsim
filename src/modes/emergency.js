import { getAircraft } from '../aircraft/index.js';
import { FAILURE_NAMES } from '../game/failures.js';
import { buildMap } from '../world/mapBuilder.js';
import { MAPS, MAP_HALF } from '../world/maps.js';
import { Rng } from '../util/random.js';
import { emergencyGrade, emergencyPayout, crashPenalty } from './economy.js';

// Emergency Landing: something breaks in flight and you must get the aircraft down safely at an
// airport that can take it. A scenario is generated entirely from a seed (map, aircraft, position,
// weather and the failures with their timings), so the same seed always plays the same way.

const KT = 0.514444;
const FT = 0.3048;

export const POOLS = {
  1: ['cessna172', 'caravan', 'kingair', 'trainer'],
  2: ['turboprop72', 'citation', 'bizjet', 'regional', 'fighter'],
  3: ['narrowbody', 'widebody', 'jumbo', 'hornet', 'heavyfighter'],
};
/** Rough glide ratios (no thrust) used to place engine-out scenarios within reach of an airport. */
const GLIDE = {
  cessna172: 9, caravan: 9, kingair: 11, trainer: 10, turboprop72: 11, citation: 12, bizjet: 13, regional: 13, fighter: 6.5,
  narrowbody: 15, widebody: 16, jumbo: 14, hornet: 6.5, heavyfighter: 6.5,
};
/** Typical cruising height above the airport (feet) by rough class. */
const ALT_RANGE = {
  'Light prop': [3500, 7500], Turboprop: [4000, 9000], 'Jet trainer': [6000, 14000], 'Business jet': [8000, 22000], Airliner: [9000, 24000], Fighter: [7000, 18000],
};
const SKIES = [['clear', 4], ['scattered', 3], ['overcast', 2], ['rain', 1.5], ['fog', 0.5], ['snow', 0.5], ['storm', 0.4]];
const WEATHERS = [['calm', 2], ['breeze', 3], ['crosswind', 1.5], ['gusty', 1]];
const FAIL_WEIGHTS = { engine_failure: 4, engine_fire: 1.5, electrical: 2, flaps: 2, pitot: 1.5, jam: 1.2, fuel_leak: 1.5, hydraulic: 1.5, gear: 2 };

const pickWeighted = (rng, list) => {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rng.float() * total;
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[0][0];
};

/** Today's challenge number: the same for everyone on a given (UTC) day. */
export function dailySeed(date = new Date()) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** Airports whose longest runway suits the aircraft. */
export function suitableAirports(map, spec) {
  return map.airports.filter((a) => Math.max(...a.runways.map((r) => r.length)) >= spec.minRunway * 1.05);
}

function terrainMax(map, x0, z0, x1, z1, n = 14) {
  let max = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    for (const o of [0, 2500, -2500]) max = Math.max(max, map.hf.height(x0 + (x1 - x0) * t + o, z0 + (z1 - z0) * t + o * 0.6));
  }
  return max;
}

/**
 * Build a scenario from a seed.
 * @returns {{seed, difficulty, mapId, aircraftId, target, spawn, hour, sky, weather, failures:[{at, type, engine?, axis?}], parSeconds}}
 */
export function generateScenario(seed, difficulty = null) {
  const rng = new Rng((seed >>> 0) * 2654435761 + 12345);
  const diff = difficulty ?? rng.pick([1, 1, 2, 2, 3]);
  // Mostly aircraft of the difficulty's own tier, sometimes something smaller.
  const aircraftId = diff > 1 && rng.chance(0.3) ? rng.pick(POOLS[rng.int(1, diff - 1)]) : rng.pick(POOLS[diff]);
  const spec = getAircraft(aircraftId);
  const mapId = rng.pick(Object.keys(MAPS));
  const map = buildMap(mapId);
  const suitable = suitableAirports(map, spec);
  const target = rng.pick(suitable.length ? suitable : map.airports.filter((a) => a.cls === 'hub'));

  // Failures.
  const types = Object.keys(FAIL_WEIGHTS).filter((t) => (t !== 'gear' || spec.gear.retractable) && (t !== 'hydraulic' || spec.gear.retractable));
  const count = diff === 1 ? 1 : diff === 2 ? rng.pick([1, 2]) : rng.pick([2, 3]);
  const failures = [];
  let at = rng.range(6, 18);
  const engines = spec.engines.positions.length;
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const avail = types.filter((t) => !used.has(t) && !(used.has('engine_failure') && t === 'engine_fire') && !(used.has('engine_fire') && t === 'engine_failure'));
    const type = pickWeighted(rng, avail.map((t) => [t, FAIL_WEIGHTS[t]]));
    used.add(type);
    const f = { at: Math.round(at), type };
    if (type === 'engine_failure' || type === 'engine_fire') f.engine = rng.int(0, engines - 1);
    if (type === 'jam') f.axis = rng.pick(['elevator', 'aileron', 'rudder']);
    failures.push(f);
    at += rng.range(20, 50);
  }
  const engineOut = failures.some((f) => (f.type === 'engine_failure' || f.type === 'engine_fire') && engines === 1);

  // Position: distance and altitude chosen so an engine-out single can glide to the field.
  const glide = GLIDE[aircraftId] ?? 10;
  const [altLo, altHi] = ALT_RANGE[spec.class] ?? [4000, 12000];
  let aboveFt = rng.range(altLo, altHi);
  let distM;
  if (engineOut) {
    aboveFt = Math.min(aboveFt, spec.class === 'Light prop' ? 6500 : aboveFt);
    distM = Math.max(5000, aboveFt * FT * glide * rng.range(0.28, 0.5));
  } else {
    distM = rng.range(12000, 38000) * (spec.class === 'Fighter' ? 1.2 : 1);
  }
  const bound = MAP_HALF * 0.92;
  let spawn = null;
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 24 * 4 && !spawn; i++) {
    const a = a0 + i * 0.2618;
    // The map is small: when no direction fits, come in a little closer.
    const dist = distM * 0.82 ** Math.floor(i / 24);
    const x = target.x + Math.cos(a) * dist;
    const z = target.z + Math.sin(a) * dist;
    if (Math.abs(x) > bound || Math.abs(z) > bound) continue;
    const ceiling = terrainMax(map, x, z, target.x, target.z);
    const altitude = Math.max(target.elevation + aboveFt * FT, ceiling + 450);
    const bearing = ((Math.atan2(target.x - x, -(target.z - z)) * 180) / Math.PI + 360) % 360;
    const heading = (bearing + rng.range(-100, 100) + 360) % 360;
    spawn = { x, z, altitude, heading, speed: spec.speeds.cruise * KT * (spec.class === 'Fighter' ? 0.75 : 0.88) };
  }
  if (!spawn) spawn = { x: target.x + 8000, z: target.z, altitude: target.elevation + 2500, heading: 270, speed: spec.speeds.cruise * KT * 0.88 };

  const night = rng.chance(0.15);
  const hour = night ? rng.pick([21, 22, 23.5, 3]) : rng.range(7, 18);
  let sky = pickWeighted(rng, SKIES.filter(([s]) => (s !== 'storm' || diff >= 3) && (s !== 'snow' || mapId === 'snow')));
  if (diff === 1 && (sky === 'storm' || sky === 'fog')) sky = 'scattered';
  const weather = pickWeighted(rng, WEATHERS.filter(([w]) => diff >= 2 || w !== 'gusty'));
  const kmPerMin = (spec.speeds.cruise * 1.852) / 60;
  const parSeconds = Math.round(((Math.hypot(spawn.x - target.x, spawn.z - target.z) / 1000) / (kmPerMin * 0.6) + 6) * 60);
  return { seed, difficulty: diff, mapId, aircraftId, target, spawn, hour, sky, weather, failures, parSeconds, engineOut };
}

/** Describe a scenario in a sentence for the setup screen. */
export function describeScenario(sc) {
  const spec = getAircraft(sc.aircraftId);
  const list = sc.failures.map((f) => FAILURE_NAMES[f.type]).join(' + ');
  return `${spec.name} · ${MAPS[sc.mapId].name} · ${list} · ${sc.sky}`;
}

/**
 * Score a finished scenario, 0-100.
 * @param o {landed: bool, crashed: bool, airport: obj|null, suitable: bool, onRunway: bool, grade, intact: bool, seconds, par}
 */
export function scoreEmergency(o) {
  if (o.crashed || !o.landed) return { score: 0, parts: [{ label: 'Aircraft lost', amount: 0 }] };
  const parts = [];
  const base = o.airport ? (o.suitable ? 60 : 45) : 30;
  parts.push({ label: o.airport ? (o.suitable ? 'Landed at a suitable airport' : `Landed at ${o.airport.name} (runway too short for the aircraft)`) : 'Forced landing away from an airport', amount: base });
  const q = { Smooth: 20, Good: 14, Firm: 8, Hard: 2, 'Very hard': 0 }[o.grade] ?? 0;
  parts.push({ label: `Touchdown: ${o.grade}`, amount: q });
  if (o.onRunway) parts.push({ label: 'Stopped on the runway', amount: 8 });
  if (o.intact) parts.push({ label: 'Airframe undamaged', amount: 6 });
  if (o.seconds <= o.par) parts.push({ label: 'Quick decision', amount: 6 });
  const score = Math.min(100, parts.reduce((s, p) => s + p.amount, 0));
  return { score, parts };
}

export class EmergencyMode {
  constructor(plan, runner) {
    this.plan = plan;
    this.runner = runner;
    this.sc = generateScenario(plan.seed, plan.difficulty ?? null);
    this.title = 'Emergency Landing';
  }

  startOptions() {
    const sc = this.sc;
    return {
      aircraftId: sc.aircraftId, mapId: sc.mapId, airportCode: sc.target.code, endId: sc.target.runways[0].ends[0].id, startMode: 'custom', spawn: sc.spawn,
      hour: sc.hour, sky: sc.sky, weather: sc.weather, seed: sc.seed, liveryId: 'factory', tuning: this.runner.saves.tuningFor(sc.aircraftId), scripted: true,
    };
  }

  begin() {
    this.elapsed = 0;
    this.pending = this.sc.failures.map((f) => ({ ...f, done: false }));
    this.fired = [];
    this.map = this.runner.session.flightScene.map;
    this.spec = getAircraft(this.sc.aircraftId);
    this.airports = suitableAirports(this.map, this.spec);
    this.runner.toast('Emergency scenario ready — watch your instruments');
  }

  tick(dt) {
    this.elapsed += dt;
    const s = this.runner.session;
    if (!s.model || s.model.crashed) return;
    for (const f of this.pending) {
      if (f.done || this.elapsed < f.at) continue;
      f.done = true;
      const rec = s.failures.trigger(f.type, { ...(f.engine != null ? { engine: f.engine } : {}), ...(f.axis ? { axis: f.axis } : {}) });
      if (rec) this.fired.push(FAILURE_NAMES[f.type]);
    }
  }

  onTracker(type, p) {
    if (type === 'landed') this.#landed(p);
    else if (type === 'crash') this.#lost(p.reason);
  }

  #landed(p) {
    const r = this.runner;
    const m = r.session.model;
    const airport = p.stopAirport;
    const suitable = !!airport && Math.max(...airport.runways.map((x) => x.length)) >= this.spec.minRunway * 1.05;
    const intact = m.damage.landing < 0.5 && (m.damage.scrape ?? 0) < 0.3;
    const sc = this.sc;
    const { score, parts } = scoreEmergency({
      landed: true, crashed: false, airport, suitable, onRunway: !!p.stopRunway, grade: p.grade, intact, seconds: this.elapsed, par: sc.parSeconds,
    });
    const pay = emergencyPayout({ score, aircraftId: sc.aircraftId, difficulty: sc.difficulty, multiplier: r.multiplier });
    const { paid } = r.bank({ total: pay.total, landed: true, trackKm: p.trackKm, airborneSec: p.airborneSec, fpm: p.fpm, reason: 'emergency' });
    const grade = emergencyGrade(score);
    this.#record(score, grade);
    r.finish({
      mode: 'emergency', title: 'Emergency resolved', subtitle: `${this.spec.name} · seed ${sc.seed}`, success: true, score, scoreGrade: grade,
      lines: [...parts.map((x) => ({ ...x, kind: 'score' })), ...pay.lines], total: paid,
      notes: [`${this.fired.join(' + ') || 'No failure triggered'} · ${Math.round(this.elapsed / 60 * 10) / 10} min`, `Touchdown: ${p.grade} (${Math.round(p.fpm)} ft/min)`],
      seed: sc.seed, grade: p.grade,
    });
  }

  #lost(reason) {
    const r = this.runner;
    const insured = r.upgrades.includes('insurance');
    const penalty = Math.round(crashPenalty(this.sc.aircraftId, insured) * 0.6 / 10) * 10;
    const { charged } = r.bank({ penalty, crashed: true, trackKm: r.tracker.trackKm, airborneSec: r.tracker.airborneSec, reason: 'crash' });
    this.#record(0, 'F');
    r.finish({
      mode: 'emergency', crash: true, success: false, title: 'Aircraft lost', subtitle: reason, score: 0, scoreGrade: 'F', seed: this.sc.seed,
      lines: charged ? [{ label: `Repair bill${insured ? ' (insured)' : ''}`, amount: -charged }] : [], total: -charged,
      notes: [`${this.fired.join(' + ') || 'No failure triggered'}`],
    });
  }

  #record(score, grade) {
    const save = this.runner.saves.active;
    if (!save) return;
    save.emergency.played += 1;
    const key = String(this.sc.seed);
    const best = save.emergency.best[key];
    if (!best || score > best.score) save.emergency.best[key] = { score, grade, time: Math.round(this.elapsed) };
    this.runner.saves.autosave('emergency');
  }

  info() {
    const sc = this.sc;
    const m = this.runner.session.model;
    const rows = [
      ['Seed', `${sc.seed} · difficulty ${sc.difficulty}`],
      ['Failures', this.fired.length ? this.fired.join(' + ') : 'none yet'],
      ['Time', `${(this.elapsed / 60).toFixed(1)} min`],
    ];
    const list = [];
    if (m) {
      const near = this.airports
        .map((a) => {
          const dx = a.x - m.pos.x;
          const dz = a.z - m.pos.z;
          return { a, d: Math.hypot(dx, dz), brg: ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360 };
        })
        .sort((p, q) => p.d - q.d)
        .slice(0, 4);
      for (const n of near) list.push({ text: `${n.a.code} ${n.a.name}`, detail: `${String(Math.round(n.brg)).padStart(3, '0')}° · ${(n.d / 1000).toFixed(1)} km · ${Math.max(...n.a.runways.map((x) => x.length))} m`, good: true });
    }
    const best = this.runner.saves.active?.emergency.best[String(sc.seed)];
    return {
      title: 'Emergency Landing',
      subtitle: best ? `Your best on this seed: ${best.grade} (${best.score})` : 'Land safely at a suitable airport.',
      rows, goals: [{ text: 'Land at an airport with a long enough runway', done: false }, { text: 'Touch down gently and stop on the runway', done: false, bonus: true }],
      list, listTitle: 'Suitable airports',
    };
  }
}
