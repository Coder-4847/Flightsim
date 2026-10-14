import { Rng } from '../util/random.js';
import { FAILURE_TYPES } from '../flight/systems.js';

// Schedules and applies failures. Random mode (the "Random failures" toggle) picks one every few
// minutes of flight from a seeded generator, so the same seed always breaks the same things at
// the same times. Scenario modes (Phase 5) call `trigger` directly.

const WEIGHTS = {
  engine_failure: 3, engine_fire: 1, hydraulic: 1, electrical: 1.5, flaps: 1.5, gear: 1, pitot: 1.5, jam: 1, fuel_leak: 1, radio: 1,
};

export const FAILURE_NAMES = {
  engine_failure: 'Engine failure', engine_fire: 'Engine fire', hydraulic: 'Hydraulic failure', electrical: 'Electrical failure',
  flaps: 'Flap jam', gear: 'Landing gear fault', pitot: 'Pitot icing', jam: 'Control jam', fuel_leak: 'Fuel leak', radio: 'Radio failure',
};

export class FailureManager {
  constructor(model, seed = 1) {
    this.model = model;
    this.rng = new Rng(seed);
    this.flightTime = 0;
    this.next = this.rng.range(150, 420);
    this.log = []; // [{ time, type, detail }]
  }

  /** Types that make sense for this aircraft right now. */
  applicable() {
    const m = this.model;
    const sys = m.sys;
    return FAILURE_TYPES.filter((type) => {
      if (sys.active.has(type) && type !== 'engine_failure') return false;
      if (type === 'gear' && !m.spec.gear.retractable) return false;
      if (type === 'engine_failure' || type === 'engine_fire') return m.engines.filter((e) => !e.failed).length > (m.engines.length > 1 ? 1 : 0);
      if (type === 'hydraulic') return !sys.hydLost;
      return true;
    });
  }

  /** Apply a failure now. `opt`: { engine, axis, rate }. Returns the failure record or null. */
  trigger(type, opt = {}) {
    const m = this.model;
    const o = { ...opt };
    if ((type === 'engine_failure' || type === 'engine_fire') && o.engine == null) {
      const working = m.engines.map((e, i) => (e.failed ? -1 : i)).filter((i) => i >= 0);
      if (!working.length) return null;
      o.engine = this.rng.pick(working);
    }
    if (type === 'jam' && !o.axis) o.axis = this.rng.pick(['elevator', 'aileron', 'rudder']);
    m.sys.apply(type, m, o);
    const detail = o.engine != null ? `engine ${o.engine + 1}` : o.axis ?? '';
    const record = { time: m.time, type, detail };
    this.log.push(record);
    m.events.push({ type: 'failure', failure: type, detail, text: FAILURE_NAMES[type] + (detail && type !== 'jam' ? ` (${detail})` : detail ? ` (${detail})` : '') });
    return record;
  }

  pickRandom() {
    const list = this.applicable();
    if (!list.length) return null;
    const total = list.reduce((s, t) => s + WEIGHTS[t], 0);
    let r = this.rng.float() * total;
    for (const t of list) { r -= WEIGHTS[t]; if (r <= 0) return t; }
    return list[0];
  }

  /** Call every physics step while random failures are on. */
  update(dt, enabled) {
    const m = this.model;
    if (!enabled || m.crashed) return;
    const t = m.telemetry;
    if (t.onGround || t.aglFt < 400 || t.iasTrue < m.spec.speeds.vr) return; // only once properly airborne
    this.flightTime += dt;
    if (this.flightTime < this.next) return;
    const type = this.pickRandom();
    this.flightTime = 0;
    this.next = this.rng.range(420, 900);
    if (type) this.trigger(type);
  }
}
