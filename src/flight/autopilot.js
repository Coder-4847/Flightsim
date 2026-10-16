import { computeApproach } from '../game/approachGuide.js';

// A general-purpose autopilot that flies any aircraft in the roster by moving the same stick and
// throttle the pilot uses.
//   lateral:  HDG (heading bug), NAV (track to a chosen airport or point), LOC (localiser, from APPR)
//   vertical: ALT (hold / capture), VS (vertical speed to the altitude), GS (glide slope, from APPR)
//   autothrottle holds an indicated airspeed.
// It disconnects when the pilot moves the stick, on a stall warning, or at the decision height of an
// approach (the pilot lands the aircraft).

const DEG = Math.PI / 180;
const FT = 3.28084;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const angle = (a) => ((a % 360) + 540) % 360 - 180;

export class Autopilot {
  constructor() {
    this.on = false;
    this.at = false; // autothrottle
    this.lat = 'HDG';
    this.vert = 'ALT';
    this.appr = false; // approach armed or captured
    this.hdg = 0;
    this.alt = 3000;
    this.vs = 0;
    this.ias = 120;
    this.nav = null; // { x, z, name }
    this.target = null; // { airport, endId } of the captured approach
    this.out = { pitch: 0, roll: 0 };
    this.message = '';
    this.onEvent = null; // (text, level) => void
    this.acc = 0;
    this.lastIas = null;
    this.decision = 80; // ft AGL where an approach hands back control
  }

  /** The profile of an aircraft: how hard it may bank and climb, and which control law fits. */
  profile(spec) {
    const fbw = spec.fcs?.type === 'fbw';
    const heavy = spec.mass.ref > 15000;
    const fighter = spec.class === 'Fighter';
    return {
      fbw, heavy,
      bankMax: fighter ? 45 : heavy ? 25 : spec.class === 'Business jet' ? 28 : 30,
      vsUp: fighter ? 4000 : heavy ? 2200 : spec.mass.ref > 3500 ? 1800 : 700,
      vsDown: fighter ? 4000 : heavy ? 2500 : 1500,
      pitchMax: fighter ? 18 : heavy ? 12 : 12,
      kRoll: fbw ? 0.06 : heavy ? 0.06 : 0.05,
    };
  }

  /** Switch on, capturing the current heading, altitude and speed. */
  engage(model, tel) {
    this.on = true;
    this.hdg = Math.round(tel.heading) % 360;
    this.alt = Math.round(tel.altitudeFt / 100) * 100;
    this.vs = 0;
    this.ias = Math.round(tel.iasTrue / 5) * 5;
    this.lat = 'HDG';
    this.vert = 'ALT';
    this.appr = false;
    this.lastIas = tel.iasTrue;
    this.vsInt = 0;
    this.#note('Autopilot engaged', 'info');
  }

  disengage(reason = 'Autopilot disconnected', level = 'info') {
    if (!this.on) return;
    this.on = false;
    this.appr = false;
    this.target = null;
    this.out.pitch = this.out.roll = 0;
    this.vsInt = 0;
    this.#note(reason, level);
  }

  #note(text, level) {
    this.message = text;
    this.onEvent?.(text, level);
  }

  setVertical(mode, model, tel) {
    this.vert = mode;
    if (mode === 'VS') this.vs = Math.round(tel.vsFpm / 100) * 100;
    if (mode === 'ALT') this.alt = Math.round(tel.altitudeFt / 100) * 100;
  }

  /** Arm or cancel the approach mode. */
  toggleApproach() {
    this.appr = !this.appr;
    if (!this.appr && (this.lat === 'LOC' || this.vert === 'GS')) { this.lat = 'HDG'; this.vert = 'ALT'; this.target = null; }
    this.#note(this.appr ? 'Approach armed: it captures the localiser and glide slope' : 'Approach cancelled', 'info');
  }

  /** Call every physics step. Runs its control loops at 20 Hz and holds the output in between. */
  update(dt, model, controls, input) {
    if (!this.on || model.crashed) return false;
    const tel = model.telemetry;
    const spec = model.spec;
    const prof = this.profile(spec);
    // The inner loops run every physics step (rate damping needs it); guidance and automation run at 20 Hz.
    this.acc += dt;
    if (this.acc < 0.05) { this.#inner(prof, tel); return true; }
    const step = this.acc;
    this.acc = 0;

    // Disconnect rules.
    if (Math.abs(controls.stick.pitch) > 0.3 || Math.abs(controls.stick.roll) > 0.3) { this.disengage('Autopilot disconnected: stick moved', 'info'); return false; }
    if (input?.pad?.connected && input.pad.active && (Math.abs(input.pad.axes.leftX) > 0.4 || Math.abs(input.pad.axes.leftY) > 0.4)) { this.disengage('Autopilot disconnected: stick moved', 'info'); return false; }
    if (input?.touch && (input.touch.yoke && (Math.abs(input.touch.pitch) > 0.3 || Math.abs(input.touch.roll) > 0.3))) { this.disengage('Autopilot disconnected: stick moved', 'info'); return false; }
    if (tel.stallWarning || tel.stalled) { this.disengage('Autopilot disconnected: stall warning', 'warn'); return false; }
    if (tel.onGround && tel.groundSpeed > 20) { this.disengage('Autopilot off: on the ground', 'info'); return false; }
    if (!tel.powered && spec.cockpit.panel !== 'steam') { /* fly on: the autopilot is electro-mechanical here */ }
    if (model.assist === 'off') model.assist = 'light'; // the autopilot needs rate damping and turn coordination

    // ---- approach logic ----
    let guide = null;
    // Once captured the autopilot stays on its own runway, however the aircraft is aligned later.
    if (this.appr || this.lat === 'LOC') guide = computeApproach(model, model.nav.airports, this.lat === 'LOC' ? this.target : null, tel);
    if (this.appr && guide && this.lat !== 'LOC' && guide.distM < 28000 && Math.abs(guide.locDeg) < 3.5 && guide.headingDiff < 60) {
      this.lat = 'LOC';
      this.target = { airport: guide.airport, endId: guide.end.id };
      this.#note(`Localiser captured: runway ${guide.end.id}`, 'info');
    }
    if (this.lat === 'LOC' && !guide) { this.lat = 'HDG'; this.hdg = Math.round(tel.heading); this.appr = false; this.#note('Localiser lost', 'warn'); }
    if (this.lat === 'LOC' && this.vert !== 'GS' && guide && guide.gsDots < 1.0 && guide.gsDots > -1.5 && guide.distM < 25000) {
      this.vert = 'GS';
      this.#note('Glide slope captured', 'info');
    }
    if (this.vert === 'GS' && (!guide || guide.distM > 30000)) { this.vert = 'ALT'; this.alt = Math.round(tel.altitudeFt / 100) * 100; }
    if (this.vert === 'GS' && tel.aglFt < this.decision) {
      this.disengage('Autopilot disconnected at decision height: land the aircraft', 'warn');
      return false;
    }

    // ---- lateral ----
    let hdgT = this.hdg;
    if (this.lat === 'NAV' && this.nav) {
      const dx = this.nav.x - model.pos.x;
      const dz = this.nav.z - model.pos.z;
      hdgT = (Math.atan2(dx, -dz) / DEG + 360) % 360;
      if (Math.hypot(dx, dz) < 700) { this.lat = 'HDG'; this.hdg = Math.round(hdgT) % 360; this.#note(`Reached ${this.nav.name ?? 'the waypoint'}`, 'info'); }
    } else if (this.lat === 'LOC' && guide) {
      hdgT = guide.end.heading - clamp(guide.lateral * 0.03, -30, 30);
    }
    const err = angle(hdgT - tel.heading);
    const bankMax = this.lat === 'LOC' && tel.aglFt < 600 ? 12 : prof.bankMax;
    this.bankT = clamp(err * 1.0, -bankMax, bankMax);

    // ---- vertical ----
    const alt = tel.altitudeFt;
    let vsT;
    const altErr = this.alt - alt;
    if (this.vert === 'GS' && guide) {
      const gsFpm = -tel.groundSpeed * 0.514444 * 0.0524 / 0.00508; // sink for a 3 degree path
      const wantAlt = (guide.airport.elevation + 12 + Math.max(0, guide.distM) * Math.tan(3 * DEG)) * FT;
      vsT = clamp(gsFpm + (wantAlt - alt) * 3, -1500, 600); // close a height error in about 20 s
    } else if (this.vert === 'VS') {
      vsT = clamp(this.vs, -prof.vsDown, prof.vsUp);
      const lead = Math.abs(vsT) * 0.12;
      if ((vsT > 0 && altErr < lead + 50) || (vsT < 0 && altErr > -lead - 50)) { this.vert = 'ALT'; this.#note(`Altitude capture ${this.alt} ft`, 'info'); }
    } else {
      vsT = clamp(altErr * 0.9, -prof.vsDown, prof.vsUp);
      if (Math.abs(altErr) < 120) vsT *= Math.max(0.15, Math.abs(altErr) / 120);
    }
    // Never climb into a stall: ease off when the airspeed is within 25% of the clean stall speed.
    const vsClean = spec.flaps.stages[0].vs;
    if (vsT > 0 && tel.iasTrue < vsClean * 1.25) vsT = Math.min(vsT, Math.max(0, (tel.iasTrue - vsClean * 1.1) * 40));
    this.vsT = vsT;
    this.#inner(prof, tel);

    // ---- autothrottle ----
    if (this.at) {
      let iasT = this.ias;
      if (this.vert === 'GS' && guide) iasT = spec.speeds.vapp + 5 + clamp((guide.distM - 6000) / 1000, 0, 6) * 4;
      // Throttle rate per second: proportional to the speed error, damped by the acceleration.
      const accel = (tel.iasTrue - (this.lastIas ?? tel.iasTrue)) / step;
      const rate = clamp((iasT - tel.iasTrue) * 0.03 - accel * 0.12, -0.3, 0.3);
      this.lastIas = tel.iasTrue;
      const cap = prof.fbw ? 0.85 : 1;
      const target = clamp(controls.master + rate * step, 0, cap);
      controls.setMaster(target);
    }
    return true;
  }

  #inner(prof, tel) {
    const bankT = this.bankT ?? 0;
    const vsT = this.vsT ?? 0;
    if (prof.fbw) this.out.roll = clamp((bankT - tel.bank) * 0.012, -0.5, 0.5); // the stick commands a roll rate: aim to close the error in ~0.5 s
    else this.out.roll = clamp((bankT - tel.bank) * prof.kRoll - tel.rollRate * 0.006, -0.5, 0.5);
    if (prof.fbw) {
      this.out.pitch = clamp((vsT - tel.vsFpm) * 0.00025, -0.25, 0.3);
    } else {
      // The integral term removes the steady vertical-speed error a proportional pitch loop leaves.
      const vsErr = vsT - tel.vsFpm;
      if (Math.abs(vsErr) < 400) this.vsInt = clamp((this.vsInt ?? 0) + vsErr * 0.0008 * (1 / 120), -4, 4);
      const pT = clamp(tel.pitch + (vsT - tel.vsFpm) * 0.0022 + this.vsInt, -9, prof.pitchMax);
      this.out.pitch = prof.heavy ? clamp((pT - tel.pitch) * 0.6 - tel.pitchRate * 0.5, -0.6, 0.6) : clamp((pT - tel.pitch) * 0.2 - tel.pitchRate * 0.6, -0.5, 0.6);
    }
  }

  /** Status for the HUD. */
  get status() {
    if (!this.on) return 'OFF';
    return `${this.lat} · ${this.vert}${this.at ? ' · A/T' : ''}${this.appr && this.lat !== 'LOC' ? ' · APPR ARMED' : ''}`;
  }
}
