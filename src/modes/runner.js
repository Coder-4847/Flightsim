import { Emitter } from '../core/events.js';
import { ContractMode } from './contract.js';
import { modeMultiplier } from './economy.js';
import { EmergencyMode } from './emergency.js';
import { FreeFlightMode } from './freeflight.js';
import { FlightTracker } from './tracker.js';

// Ties a game mode (Free Flight, Career, Emergency, VIP Escort) to the running flight session:
// builds the start options, watches the flight with a tracker, forwards what happens to the mode,
// and banks the result in the active save.
//
// Lifecycle: prepare(plan) -> session.start(runner.startOptions) -> attach() -> update(dt) ...

const MODES = { free: FreeFlightMode, career: ContractMode, vip: ContractMode, emergency: EmergencyMode };

export class ModeRunner extends Emitter {
  constructor({ session, saves, settings }) {
    super();
    this.session = session;
    this.saves = saves;
    this.settings = settings;
    this.plan = null;
    this.mode = null;
    this.tracker = null;
    this.result = null;
    this.acc = 0;
  }

  get active() { return !!this.mode; }
  get kind() { return this.plan?.mode ?? null; }

  /** Choose a mode and plan; returns the options for FlightSession.start. */
  prepare(plan) {
    this.plan = plan;
    this.mode = new MODES[plan.mode](plan, this);
    this.tracker = null;
    this.result = null;
    return this.mode.startOptions();
  }

  /** Call once the session has started (or restarted) and the aircraft exists. */
  attach() {
    if (!this.mode) return;
    const { session } = this;
    this.result = null;
    this.acc = 0;
    this.tracker = new FlightTracker(session.flightScene.map, session.model, session.airport);
    for (const type of ['takeoff', 'touchdown', 'landed', 'poi', 'crash']) {
      this.tracker.on(type, (payload) => {
        this.mode?.onTracker(type, payload);
        this.emit(type, payload);
      });
    }
    this.mode.begin();
    this.emit('begin', this.mode);
  }

  clear() {
    this.mode = null;
    this.plan = null;
    this.tracker = null;
    this.result = null;
  }

  /** Physics-rate update. */
  update(dt) {
    if (!this.mode || !this.tracker || this.result) return;
    this.tracker.update(dt);
    this.acc += dt;
    if (this.acc >= 0.1) {
      const step = this.acc;
      this.acc = 0;
      const tel = this.session.model.telemetry;
      this.mode.tick(step, tel);
    }
  }

  handleEvents(events) {
    if (!this.mode || !this.tracker) return;
    for (const e of events) this.tracker.onEvent(e);
  }

  info() {
    return this.mode ? this.mode.info() : null;
  }

  /** The mode is over; show the debrief. */
  finish(result) {
    if (this.result) return;
    this.result = result;
    this.emit('result', result);
  }

  toast(text) { this.session.onToast?.(text); }

  get multiplier() { return modeMultiplier(this.settings?.get('preset')); }
  get upgrades() { return this.saves.active?.upgrades ?? []; }

  /** Apply money and statistics from a finished leg to the active save, then autosave. */
  bank({ total = 0, penalty = 0, landed = false, crashed = false, trackKm = 0, airborneSec = 0, pax = 0, cargoKg = 0, fpm = null, reason = 'landing' }) {
    const save = this.saves.active;
    if (!save) return { paid: 0, charged: 0 };
    const paid = this.saves.earn(total, reason);
    const charged = this.saves.charge(penalty, 'repair');
    const s = save.stats;
    s.flights += 1;
    if (landed) s.landings += 1;
    if (crashed) s.crashes += 1;
    s.distanceKm += trackKm;
    s.airborneHours += airborneSec / 3600;
    s.passengers += pax;
    s.cargoKg += cargoKg;
    if (landed && fpm != null && (s.bestLandingFpm == null || fpm < s.bestLandingFpm)) s.bestLandingFpm = Math.round(fpm);
    this.saves.autosave(reason);
    return { paid, charged };
  }
}
