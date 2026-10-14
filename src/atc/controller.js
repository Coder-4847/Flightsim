import * as THREE from 'three';
import { Emitter } from '../core/events.js';
import { AirportOps } from './aiTraffic.js';
import {
  approachFor, bestEnd, departureRoute, dirOf, findEnd, headingOf, isTowered,
} from './geometry.js';
import {
  altitudeShort, altitudeWords, callsignWords, clock, compassWord, COMPASS, digits, formatFreq, frequencyWords, heading as hdgWords,
  runwayWords, squawkWords, windWords,
} from './phraseology.js';

// The player's air traffic control. A state machine follows the flight phase (parked, taxi, hold,
// takeoff, departure, enroute, approach, final, landing, taxi in); each phase offers a short menu of
// standard phrases, and the controller replies with instructions built from a phraseology table.
// Responses come from the right station: Ground, Tower, Departure, Center, Approach.

const KT = 0.514444;
const FT = 3.28084;
const NM = 1852;

const CRUISE_ALT = {
  cessna172: 4500, caravan: 7500, trainer: 15000, kingair: 14000, turboprop72: 17000, citation: 31000, bizjet: 41000,
  regional: 29000, narrowbody: 35000, widebody: 37000, jumbo: 35000, fighter: 25000, hornet: 25000, heavyfighter: 28000,
};
const CEILING = { cessna172: 13000, caravan: 20000, trainer: 30000, kingair: 30000, turboprop72: 25000, citation: 45000, bizjet: 51000, regional: 37000, narrowbody: 39000, widebody: 43000, jumbo: 43000, fighter: 50000, hornet: 45000, heavyfighter: 50000 };

const pick = (list, n) => list[Math.abs(n) % list.length];

export class AtcController extends Emitter {
  constructor({ map, settings, getFlightScene, getSky }) {
    super();
    this.map = map;
    this.settings = settings;
    this.getFlightScene = getFlightScene;
    this.getSky = getSky;
    this.transcript = [];
    this.enabled = false;
    this.pending = [];
    this.menuPath = [];
    this.version = 0;
    this.ops = null;
    this.violations = [];
  }

  // ---- lifecycle ---------------------------------------------------------------------------------
  /** Begin controlling a flight that starts at `airport` on runway end `endId`. */
  start(model, airport, endId, startMode, enabled = true) {
    this.dispose();
    this.model = model;
    this.enabled = enabled;
    this.home = airport;
    this.spec = model.spec;
    this.reg = model.spec.registration;
    this.cs = callsignWords(this.reg);
    this.csShort = this.cs; // ATC uses the full callsign (short forms are confusing for registrations with digits)
    this.transcript.length = 0;
    this.pending.length = 0;
    this.menuPath.length = 0;
    this.violations.length = 0;
    this.squawk = 4100 + Math.floor(Math.random() * 800);
    this.clr = { ifr: false, taxi: false, lineup: false, takeoff: false, approach: false, land: false, hold: false };
    this.ctx = { alt: null, hdg: null, directTo: null, hold: null, emergency: false, approachAirport: null, approachEnd: null, towerContacted: false, vector: 0, lastAlertAt: {}, contactedStations: new Set(), seq: 0 };
    this.station = null;
    this.phase = startMode === 'final' || startMode === 'air' ? 'enroute' : 'parked';
    this.tick = 0;
    this.msgTimes = {};
    this.me = {};
    this.ctx.standPos = { x: model.pos.x, z: model.pos.z };
    this.atisLetter = 'A';
    const wind = new THREE.Vector3();
    model.world.wind(new THREE.Vector3(airport.x, airport.elevation + 10, airport.z), 0, wind);
    const preferred = startMode === 'runway' || startMode === 'gate' ? findEnd(airport, endId) : null;
    const best = preferred ? { runway: preferred.runway, end: preferred.end } : bestEnd(airport, wind);
    this.homeEndId = best.end.id;
    if (startMode === 'gate') this.phase = 'parked';
    else if (startMode === 'runway') this.phase = 'lineup_ready';
    if (enabled) this.#setupOps(airport, best.end.id);
    else this.pendingEnd = best.end.id;
    if (this.phase === 'enroute' && startMode === 'air') this.station = this.#station('center');
    if (this.phase === 'enroute' && startMode === 'final') {
      this.ctx.approachAirport = airport;
      this.ctx.approachEnd = best.end.id;
      this.ctx.vectorStage = 2;
      this.phase = 'approach';
      this.station = this.#station('approach', airport);
      this.clr.approach = true;
    }
    if (this.phase === 'parked') this.station = this.#station(isTowered(airport) ? 'ground' : 'unicom');
    if (this.phase === 'lineup_ready') { this.phase = 'hold'; this.station = this.#station(isTowered(airport) ? 'tower' : 'unicom'); }
    this.#bump();
  }

  /** Turn the controller on or off during a flight (the ATC toggle in the settings). */
  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on && this.home && !this.ops) this.#setupOps(this.ctx.approachAirport ?? this.home, this.ctx.approachEnd ?? this.pendingEnd ?? this.homeEndId);
    if (!on) { this.ops?.dispose(); this.ops = null; this.pending.length = 0; }
    this.#bump();
  }

  dispose() {
    this.ops?.dispose();
    this.ops = null;
    this.opsAirport = null;
  }

  #setupOps(airport, endId) {
    const scene = this.getFlightScene();
    if (!scene || airport.cls === 'strip') return;
    const group = scene.airports?.built.get(airport.code) ?? null;
    this.ops?.dispose();
    this.ops = new AirportOps({
      scene: scene.scene, airport, group, density: this.settings.get('atcTraffic'), seed: airport.x ^ airport.z,
    });
    this.opsAirport = airport;
    this.ops.setActiveEnd(endId);
  }

  // ---- stations and messages -----------------------------------------------------------------------
  #station(role, airport = this.home) {
    const f = airport.frequencies;
    const name = airport.name.replace(/ (International|Regional|Municipal|Field|Airpark|Strip)$/, '');
    switch (role) {
      case 'ground': return { role, airport, freq: f.ground, name: `${name} Ground`, spoken: `${name} Ground` };
      case 'tower': return { role, airport, freq: f.tower, name: `${name} Tower`, spoken: `${name} Tower` };
      case 'approach': return { role, airport, freq: f.approach, name: `${name} Approach`, spoken: `${name} Approach` };
      case 'departure': return { role, airport, freq: f.approach + 0.1, name: `${name} Departure`, spoken: `${name} Departure` };
      case 'center': return { role, airport: null, freq: 132.4 + (this.map.cfg?.seed ?? 0) % 7 * 0.1, name: `${this.map.cfg?.name?.split(' ')[0] ?? 'Regional'} Center`, spoken: `${this.map.cfg?.name?.split(' ')[0] ?? 'Regional'} Center` };
      default: return { role: 'unicom', airport, freq: 122.8, name: `${name} traffic`, spoken: `${name} traffic` };
    }
  }

  get stationLabel() {
    return this.station ? `${this.station.name} ${formatFreq(this.station.freq)}` : 'No frequency';
  }

  #say(who, text, spoken = text) {
    const msg = { time: this.model?.time ?? 0, who, station: who === 'ATC' ? this.station?.name : this.reg, text, spoken };
    this.transcript.push(msg);
    if (this.transcript.length > 150) this.transcript.shift();
    this.emit('message', msg);
  }

  /** Controller transmission after a short delay, then `after` runs (state changes). */
  #reply(text, after, delay = 1.6, spoken = text) {
    this.pending.push({ at: (this.model?.time ?? 0) + delay + Math.random() * 0.8, text, spoken, after });
  }

  #atc(text, spoken) {
    this.#say('ATC', text, spoken ?? text);
  }

  #bump() { this.version++; this.emit('menu'); }

  // ---- sensing ------------------------------------------------------------------------------------------
  #sense() {
    const m = this.model;
    const t = m.telemetry;
    const me = this.me;
    me.x = m.pos.x; me.z = m.pos.z;
    me.altFt = t.altitudeFt; me.aglFt = t.aglFt;
    me.gsKt = t.groundSpeed; me.iasKt = t.iasTrue ?? t.ias; me.hdg = t.heading;
    me.onGround = t.onGround; me.vsFpm = t.vsFpm;
    me.t = m.time;
    const ap = this.ops?.approach;
    if (ap) {
      const loc = ap.local(me.x, me.z);
      me.along = loc.along; me.lateral = loc.lateral;
      me.onRunway = me.onGround && Math.abs(loc.lateral) < ap.runway.width / 2 + 3 && loc.along > -60 && loc.along < ap.length + 60;
      me.alignedDiff = Math.abs(((t.heading - ap.heading + 540) % 360) - 180);
      me.distToThr = Math.max(0, -loc.along);
      me.etaToThreshold = loc.along < 0 && !me.onGround && this.#approachingActive() ? me.distToThr / Math.max(me.gsKt * KT, 25) : Infinity;
    } else { me.onRunway = false; me.etaToThreshold = Infinity; }
    return t;
  }

  #approachingActive() {
    return this.phase === 'approach' || this.phase === 'final' || this.phase === 'landing';
  }

  #bearingTo(x, z) { return headingOf(x - this.me.x, z - this.me.z); }
  #distNm(x, z) { return Math.hypot(x - this.me.x, z - this.me.z) / NM; }

  // ---- per-frame update ------------------------------------------------------------------------------------
  update(dt) {
    if (!this.model || this.model.crashed) return;
    const m = this.model;
    // Delayed controller replies.
    while (this.pending.length && this.pending[0].at <= m.time) {
      const p = this.pending.shift();
      if (p.text) this.#say('ATC', p.text, p.spoken);
      p.after?.();
      this.#bump();
    }
    this.tick += dt;
    const t = this.#sense();
    this.ops?.update(dt, {
      onRunway: this.me.onRunway, cleared: this.clr.takeoff && ['hold', 'lineup', 'rolling'].includes(this.phase),
      etaToThreshold: this.me.etaToThreshold,
    });
    if (this.ops) this.ops.playerBlockingRunway = this.me.onRunway && this.phase !== 'rollout' && this.phase !== 'landing';
    if (this.tick < 0.5) return;
    this.tick = 0;
    if (!this.enabled) { this.#trackPhaseOnly(t); return; }
    this.#phaseLogic(t);
    this.#monitors(t);
  }

  /** With ATC off the phase still follows the flight (the HUD and scoring use it). */
  #trackPhaseOnly(t) {
    if (t.onGround) this.phase = this.me.onRunway && this.me.gsKt > 25 ? 'rolling' : 'parked';
    else if (this.phase === 'rolling' || this.phase === 'parked') this.phase = 'departure';
  }

  // ---- phase logic ---------------------------------------------------------------------------------------------
  #phaseLogic(t) {
    const me = this.me;
    const m = this.model;
    const ap = this.ops?.approach;
    const towered = this.home && isTowered(this.home);
    switch (this.phase) {
      case 'parked':
        if (!me.onGround) { this.phase = 'departure'; this.#bump(); }
        else if ((me.gsKt > 3 || (this.ctx.standPos && Math.hypot(me.x - this.ctx.standPos.x, me.z - this.ctx.standPos.z) > 30)) && (this.clr.taxi || !towered)) { this.phase = 'taxi'; this.#bump(); }
        else if (me.gsKt > 6) { this.#violation('taxi', towered ? 'Taxiing without clearance' : null); this.phase = 'taxi'; this.#bump(); }
        break;
      case 'taxi': {
        const hold = this.holdPoint();
        if (hold && Math.hypot(hold.x - me.x, hold.z - me.z) < 55 && me.gsKt < 12) { this.phase = 'hold'; this.#hold(); this.#bump(); }
        else if (me.onRunway && me.gsKt > 3 && !this.clr.lineup && !this.clr.takeoff && towered) this.#incursion();
        break;
      }
      case 'hold':
      case 'lineup': {
        if (me.onRunway && me.alignedDiff < 20 && me.gsKt < 6 && this.phase === 'hold') { this.phase = 'lineup'; this.#bump(); }
        if (me.onRunway && me.gsKt > 25) {
          if (towered && !this.clr.takeoff) this.#violation('takeoff', 'Takeoff without clearance');
          this.phase = 'rolling';
          this.#bump();
        } else if (this.clr.takeoff === false && this.pendingTakeoff) this.#takeoffDecision(false);
        else if (this.pendingTakeoff) this.#takeoffDecision(false);
        break;
      }
      case 'rolling':
        if (!me.onGround && me.aglFt > 80) { this.phase = 'departure'; this.ctx.departedAt = m.time; this.#bump(); this.#handoffDeparture(); }
        else if (me.onGround && me.gsKt < 15) { this.phase = me.onRunway ? 'lineup' : 'taxi'; this.clr.takeoff = false; this.#bump(); }
        break;
      case 'departure':
        if (me.onGround && me.gsKt < 60) { this.phase = 'rollout'; this.#bump(); break; }
        if (this.station.role === 'tower' && me.aglFt > 400 && !this.ctx.handoffNagged && m.time - this.ctx.departedAt > 70) {
          this.ctx.handoffNagged = true;
          this.#atc(`${this.csShort}, contact departure ${formatFreq(this.#station('departure').freq)}.`, `${this.csShort}, contact departure ${frequencyWords(this.#station('departure').freq)}.`);
        }
        break;
      case 'enroute':
        if (me.onGround && me.gsKt < 60) { this.phase = 'rollout'; this.#bump(); }
        break;
      case 'approach':
      case 'final':
        this.#approachLogic();
        break;
      case 'landing':
        if (me.onGround) { this.phase = 'rollout'; this.#bump(); }
        break;
      case 'rollout':
        if (me.gsKt < 35) {
          if (!this.ctx.vacateCalled) {
            this.ctx.vacateCalled = true;
            const st = this.#station(isTowered(this.landedAirport ?? this.home) ? 'tower' : 'unicom', this.landedAirport ?? this.home);
            this.station = st;
            if (isTowered(st.airport)) {
              const g = this.#station('ground', st.airport);
              this.#atc(`${this.csShort}, vacate when able, contact ground ${formatFreq(g.freq)}.`, `${this.csShort}, vacate when able, contact ground ${frequencyWords(g.freq)}.`);
            }
            this.#bump();
          }
          const ap2 = this.ops?.approach;
          if (ap2 && !me.onRunway && me.gsKt < 30) { this.phase = 'taxi_in'; this.#bump(); }
          else if (!ap2) { this.phase = 'taxi_in'; this.#bump(); }
        }
        if (!me.onGround) { this.phase = 'departure'; this.#bump(); } // touch and go
        break;
      case 'taxi_in':
        if (me.gsKt < 2.5 && me.onGround && !me.onRunway) {
          this.ctx.parkedTimer = (this.ctx.parkedTimer ?? 0) + 0.5;
          if (this.ctx.parkedTimer > 8) this.#newFlightAtGate();
        } else this.ctx.parkedTimer = 0;
        if (!me.onGround) { this.phase = 'departure'; this.#bump(); }
        break;
      default: break;
    }
    if (this.phase === 'hold' || this.phase === 'lineup') this.#holdWatch();
  }

  #newFlightAtGate() {
    this.phase = 'parked';
    this.clr = { ifr: false, taxi: false, lineup: false, takeoff: false, approach: false, land: false, hold: false };
    this.ctx.alt = null; this.ctx.hdg = null; this.ctx.directTo = null; this.ctx.vacateCalled = false; this.ctx.towerContacted = false;
    this.ctx.handoffNagged = false;
    const apt = this.landedAirport ?? this.home;
    this.home = apt;
    this.#setupOps(apt, this.ops?.activeEnd?.id ?? apt.runways[0].ends[0].id);
    this.station = this.#station(isTowered(apt) ? 'ground' : 'unicom', apt);
    this.#bump();
  }

  holdPoint() {
    const ap = this.ops?.approach;
    if (!ap || !this.home) return null;
    if (!this._hold || this._holdFor !== ap.end.id) {
      this._hold = departureRoute(this.home, ap.end.id, 0).hold;
      this._holdFor = ap.end.id;
    }
    return this._hold;
  }

  // ---- takeoff clearance --------------------------------------------------------------------------------------------
  #hold() {
    if (!isTowered(this.home) || this.ctx.holdingReported) return;
    this.ctx.holdingReported = true;
    if (this.station.role === 'ground') {
      const tw = this.#station('tower');
      this.#atc(`${this.csShort}, contact tower ${formatFreq(tw.freq)} when ready.`, `${this.csShort}, contact tower ${frequencyWords(tw.freq)} when ready.`);
    }
  }

  /** Decide, each half second, whether the pending departure may go. */
  #takeoffDecision(first) {
    if (!this.pendingTakeoff) return;
    const ops = this.ops;
    const ap = ops?.approach;
    const rw = ap ? runwayWords(ap.end.id) : '';
    const eta = Math.min(ops ? ops.nextArrivalEta() : Infinity, Infinity);
    const busy = ops ? ops.runwayBusy() : false;
    const clearNow = !busy && eta > 100 && !this.ctx.emergencyBlock;
    if (clearNow) {
      this.pendingTakeoff = false;
      this.clr.takeoff = true; this.clr.lineup = true;
      this.#atc(`${this.csShort}, runway ${ap.end.id}, cleared for takeoff, ${this.#windText()}.`, `${this.csShort}, runway ${rw}, cleared for takeoff, ${this.#windSpoken()}.`);
      this.#bump();
    } else if (first || !this.ctx.heldMsgAt || this.me.t - this.ctx.heldMsgAt > 40) {
      this.ctx.heldMsgAt = this.me.t;
      const why = busy ? 'traffic on the runway' : 'traffic on final';
      if (this.phase === 'hold' && eta < 240 && !busy && !this.clr.lineup && eta > 100) {
        this.clr.lineup = true;
        this.#atc(`${this.csShort}, runway ${ap.end.id}, line up and wait, ${why}.`, `${this.csShort}, runway ${rw}, line up and wait, ${why}.`);
      } else if (first) {
        this.#atc(`${this.csShort}, hold position, ${why}.`);
      }
    }
  }

  #holdWatch() {
    // A player lined up with an arrival close behind gets told to go or vacate.
    const ops = this.ops;
    if (!ops || !this.me.onRunway || this.clr.takeoff) return;
    const eta = ops.nextArrivalEta();
    if (eta < 55 && (!this.ctx.vacMsgAt || this.me.t - this.ctx.vacMsgAt > 30)) {
      this.ctx.vacMsgAt = this.me.t;
      this.#atc(`${this.csShort}, traffic on short final, cleared for immediate takeoff or vacate the runway.`);
    }
  }

  #incursion() {
    if (this.ctx.incursionAt && this.me.t - this.ctx.incursionAt < 45) return;
    this.ctx.incursionAt = this.me.t;
    this.#violation('incursion', 'Runway incursion');
    this.#atc(`${this.csShort}, you are on the runway without clearance. Hold position and report.`);
  }

  #violation(kind, text) {
    if (!text) return;
    this.violations.push({ time: this.me.t, kind, text });
    this.emit('violation', { kind, text });
  }

  // ---- departure handoffs -----------------------------------------------------------------------------------------
  #handoffDeparture() {
    if (!this.enabled) return;
    if (this.station.role === 'tower' || this.station.role === 'ground' || this.station.role === 'unicom') {
      const dep = this.#station('departure');
      if (this.station.role === 'unicom') return;
      this.#atc(`${this.csShort}, contact departure ${formatFreq(dep.freq)}.`, `${this.csShort}, contact departure ${frequencyWords(dep.freq)}.`);
    }
  }

  // ---- approach ------------------------------------------------------------------------------------------------------
  #approachLogic() {
    const me = this.me;
    const m = this.model;
    const ctx = this.ctx;
    const ap = this.ops?.approach;
    if (!ap || !ctx.approachAirport) return;
    const apt = ctx.approachAirport;
    const dist = me.distToThr;
    const loc = Math.abs(me.lateral) / Math.max(dist, 300); // approximate localiser deviation (tangent)
    const locDeg = (Math.atan(loc) * 180) / Math.PI;
    if (me.onGround) { this.landedAirport = apt; this.phase = 'rollout'; this.#bump(); return; }

    // Vectors: initial fix, then intercept, then cleared.
    const nowS = m.time;
    if (!ctx.vectorStage) ctx.vectorStage = 0;
    const iaf = ap.before(16000, 0);
    const distIaf = this.#distNm(iaf.x, iaf.z) * NM;
    if (ctx.vectorStage === 1 && this.#cooldown('revector', 20)) {
      const want = Math.round(headingOf(iaf.x - me.x, iaf.z - me.z)) || 360;
      if (ctx.hdg == null || Math.abs(((want - ctx.hdg + 540) % 360) - 180) > 12) {
        ctx.hdg = want; ctx.hdgSetAt = null;
        this.#atc(`${this.csShort}, fly heading ${String(want).padStart(3, '0')} for the approach.`, `${this.csShort}, fly heading ${hdgWords(want)} for the approach.`);
      }
    }
    if (ctx.vectorStage === 1 && distIaf < 5500 || (ctx.vectorStage === 1 && dist < 21000 && Math.abs(me.lateral) < 7000 && me.along < 0)) {
      ctx.vectorStage = 2;
      const side = me.lateral > 0 ? -1 : 1; // right of the course: turn left to intercept
      const hdg = (ap.heading + side * 30 + 360) % 360;
      ctx.hdg = hdg;
      ctx.alt = Math.min(Math.max(apt.elevation * FT + 2800, 2500), Math.max(ctx.alt ?? 99999, 2500));
      this.clr.approach = true;
      const turn = side < 0 ? 'left' : 'right';
      const text = `${this.csShort}, turn ${turn} heading ${String(Math.round(hdg)).padStart(3, '0')}, descend and maintain ${altitudeShort(ctx.alt)}, cleared ${ap.end.ils ? 'ILS' : 'visual'} runway ${ap.end.id} approach. Report established.`;
      const spoken = `${this.csShort}, turn ${turn} heading ${hdgWords(hdg)}, descend and maintain ${altitudeWords(ctx.alt)}, cleared ${ap.end.ils ? 'I L S' : 'visual'} runway ${runwayWords(ap.end.id)} approach. Report established.`;
      this.#atc(text, spoken);
      this.#bump();
    }
    // Established on the localiser.
    if (ctx.vectorStage === 2 && dist < 24000 && locDeg < 2.5 && me.along < 0) {
      ctx.vectorStage = 3;
      this.phase = 'final';
      ctx.hdg = null;
      this.#atc(`${this.csShort}, roger, established. Contact tower ${formatFreq(this.#station('tower', apt).freq)}.`,
        `${this.csShort}, roger, established. Contact tower ${frequencyWords(this.#station('tower', apt).freq)}.`);
      this.#bump();
    }
    if (ctx.vectorStage >= 3 && this.phase === 'approach') this.phase = 'final';
    // Landing clearance from the tower.
    if (this.station.role === 'tower' && ctx.towerContacted && !this.clr.land && this.phase !== 'approach') this.#landingDecision(dist);
    // Landed: handled above. Go around call-out from the tower.
    if (this.clr.land && dist < 1500 && !this.me.onGround && this.ops?.runwayBusy() && !ctx.goAroundCalled && ctx.towerContacted && !ctx.emergency) {
      ctx.goAroundCalled = true;
      this.#atc(`${this.csShort}, go around, traffic on the runway. Climb and maintain ${altitudeShort(Math.round((apt.elevation * FT + 2500) / 100) * 100)}, fly runway heading.`);
      this.#violation('goaround', null);
      this.clr.land = false;
      this.phase = 'approach';
      ctx.vectorStage = 1;
      ctx.towerContacted = false;
      this.station = this.#station('approach', apt);
      this.#bump();
    }
    void nowS;
  }

  #landingDecision(dist) {
    const ctx = this.ctx;
    const ops = this.ops;
    const ap = ops.approach;
    const rw = runwayWords(ap.end.id);
    const ahead = ops.arrivalsOnFinal().filter((p) => p.distToThreshold < dist - 200);
    const busy = ops.runwayBusy();
    const emergency = ctx.emergency;
    if ((!busy && !ahead.length) || emergency) {
      if (dist > 10000 && !emergency) return;
      this.clr.land = true;
      this.#atc(`${this.csShort}, runway ${ap.end.id}, ${this.#windText()}, cleared to land.`, `${this.csShort}, runway ${rw}, ${this.#windSpoken()}, cleared to land.`);
      this.#bump();
    } else if (!ctx.seqMsgAt || this.me.t - ctx.seqMsgAt > 50) {
      ctx.seqMsgAt = this.me.t;
      const n = ahead.length + 1;
      this.#atc(`${this.csShort}, continue approach, number ${n === 1 ? 'one, runway occupied' : `${n}, traffic landing ahead`}.`);
    }
  }

  // ---- monitors: altitude, heading, traffic ------------------------------------------------------------------------
  #monitors(t) {
    const me = this.me;
    const ctx = this.ctx;
    if (!me.onGround && ['departure', 'enroute', 'approach'].includes(this.phase)) {
      // Altitude assignment.
      if (ctx.alt != null && this.station?.role !== 'tower') {
        const dev = me.altFt - ctx.alt;
        if (ctx.altSetAt == null) ctx.altSetAt = me.t;
        const settle = me.t - ctx.altSetAt > 90 + Math.abs(dev) / 20;
        if (settle && Math.abs(dev) > 450 && this.#cooldown('alt', 80)) this.#atc(`${this.csShort}, check your altitude, assigned ${altitudeShort(ctx.alt)}.`);
      }
      if (ctx.hdg != null && this.phase !== 'enroute' || (ctx.hdg != null && this.phase === 'enroute')) {
        const diff = Math.abs(((me.hdg - ctx.hdg + 540) % 360) - 180);
        if (ctx.hdgSetAt == null) ctx.hdgSetAt = me.t;
        if (me.t - ctx.hdgSetAt > 45 + diff / 3 && diff > 25 && this.#cooldown('hdg', 80)) this.#atc(`${this.csShort}, fly heading ${String(Math.round(ctx.hdg)).padStart(3, '0')}.`, `${this.csShort}, fly heading ${hdgWords(ctx.hdg)}.`);
      }
      if (ctx.hold && me.t > ctx.hold.until) {
        ctx.hold = null;
        this.#atc(`${this.csShort}, cleared out of holding. Resume own navigation.`);
        this.#bump();
      }
    }
    if (!me.onGround) this.#traffic();
    // Tower pushes the departure handoff after takeoff if the player forgot.
    if (this.pendingTakeoff) this.#takeoffDecision(false);
    // Controller reminders on the ground.
  }

  #cooldown(key, seconds) {
    const last = this.ctx.lastAlertAt[key] ?? -1e9;
    if (this.me.t - last < seconds) return false;
    this.ctx.lastAlertAt[key] = this.me.t;
    return true;
  }

  #traffic() {
    const scene = this.getFlightScene();
    const me = this.me;
    const targets = [];
    for (const f of scene?.airTraffic?.flights ?? []) targets.push({ id: `ai${f.root.id}`, x: f.root.position.x, y: f.root.position.y, z: f.root.position.z, tag: f.spec.class === 'Fighter' ? 'fighter' : 'traffic' });
    for (const p of this.ops?.planes ?? []) if (p.root && ['final', 'climb', 'goaround'].includes(p.state)) targets.push({ id: `p${p.callsign}`, x: p.pos.x, y: p.pos.y, z: p.pos.z, tag: 'traffic' });
    for (const tg of targets) {
      const dist = Math.hypot(tg.x - me.x, tg.z - me.z);
      if (dist > 7000) continue;
      const dAlt = (tg.y * FT) - me.altFt;
      if (Math.abs(dAlt) > 1500) continue;
      if (!this.#cooldown(`tfc${tg.id}`, 75)) continue;
      const brg = this.#bearingTo(tg.x, tg.z);
      const rel = brg - me.hdg;
      const where = dAlt > 400 ? `${Math.round(dAlt / 100) * 100} feet above` : dAlt < -400 ? `${Math.round(-dAlt / 100) * 100} feet below` : 'same altitude';
      const miles = Math.max(1, Math.round(dist / NM));
      this.#atc(`${this.csShort}, traffic, ${clock(rel)}, ${miles} mile${miles > 1 ? 's' : ''}, ${where}.`);
    }
  }

  // ---- menu -----------------------------------------------------------------------------------------------------------
  /** Current menu entries: [{ id, label, hint?, children? }]. */
  get menu() {
    if (!this.model) return [];
    const root = this.#buildMenu();
    let level = root;
    for (const id of this.menuPath) {
      const item = level.find((x) => x.id === id);
      if (!item?.children) break;
      level = item.children;
    }
    return level;
  }

  get inSubmenu() { return this.menuPath.length > 0; }

  back() { this.menuPath.pop(); this.#bump(); }
  resetMenu() { this.menuPath.length = 0; this.#bump(); }

  #buildMenu() {
    const m = this.model;
    const me = this.me;
    const out = [];
    const towered = this.home && isTowered(this.home);
    const item = (id, label, extra = {}) => out.push({ id, label, ...extra });
    if (!m.sys.radioOk) {
      item('squawk7600', 'Squawk 7600 and transmit blind', { hint: 'Radio failure procedure' });
      return out;
    }
    const emergencyItem = () => item('mayday', 'Declare emergency (Mayday)', { hint: 'Priority handling for landing' });
    switch (this.phase) {
      case 'parked':
        item('atis', 'Request airport information (ATIS)');
        if (towered) {
          if (!this.clr.ifr) item('clearance', 'Request departure clearance');
          else item('taxi', 'Request taxi to the active runway');
          if (!this.clr.ifr) item('taxi', 'Request taxi to the active runway');
        } else {
          item('unicom_taxi', 'Announce taxi to the runway');
        }
        item('radiocheck', 'Radio check');
        break;
      case 'taxi':
        item('atis', 'Request airport information (ATIS)');
        if (towered) item('taxi', 'Request taxi instructions again');
        else item('unicom_taxi', 'Announce taxi to the runway');
        item('radiocheck', 'Radio check');
        break;
      case 'hold':
      case 'lineup':
        if (towered) {
          if (this.phase === 'hold' && !this.clr.lineup) item('depart', 'Ready for departure');
          else if (!this.clr.takeoff) item('depart', 'Request takeoff clearance');
          item('taxi_back', 'Request taxi back to parking');
        } else {
          item('unicom_depart', 'Announce departure from the runway');
        }
        item('atis', 'Request airport information (ATIS)');
        break;
      case 'rolling':
        item('abort', 'Reject takeoff (stop on the runway)');
        break;
      case 'departure':
      case 'enroute':
        item('altitude', 'Request altitude change', { children: this.#altitudeMenu() });
        item('heading', 'Request heading or direct routing', { children: this.#headingMenu() });
        item('approach_req', 'Request approach', { children: this.#airportMenu('approach') });
        if (this.station && this.station.role === 'tower') item('contact_departure', 'Contact departure');
        else if (this.station && this.station.role === 'departure' && this.#distHome() > 35 * NM) item('contact_center', 'Contact center');
        else if (this.station?.role === 'unicom') item('contact_center', 'Request flight following (center)');
        item('hold', 'Request holding');
        item('position', 'Report position');
        if (this.phase === 'departure' && this.station?.role === 'tower') item('contact_departure', 'Contact departure');
        emergencyItem();
        break;
      case 'approach':
        item('established', 'Report established on the approach');
        item('altitude', 'Request altitude change', { children: this.#altitudeMenu() });
        item('approach_req', 'Request a different airport', { children: this.#airportMenu('approach') });
        item('missed', 'Go around / missed approach');
        if (this.clr.approach || this.ctx.vectorStage >= 3) item('contact_tower', 'Contact tower');
        emergencyItem();
        break;
      case 'final':
      case 'landing':
        if (!this.ctx.towerContacted) item('contact_tower', 'Contact tower');
        else if (!this.clr.land) item('landing_req', 'Request landing clearance');
        item('missed', 'Go around');
        emergencyItem();
        break;
      case 'rollout':
        item('contact_ground', 'Contact ground');
        break;
      case 'taxi_in':
        if (towered) item('contact_ground', 'Request taxi to parking');
        item('radiocheck', 'Radio check');
        break;
      default: break;
    }
    if (this.phase !== 'parked' && !out.some((x) => x.id === 'mayday') && !['rolling', 'taxi', 'hold', 'lineup'].includes(this.phase)) emergencyItem();
    return out;
  }

  #distHome() {
    return this.home ? Math.hypot(this.home.x - this.me.x, this.home.z - this.me.z) : 0;
  }

  #altitudeMenu() {
    const me = this.me;
    const ceiling = CEILING[this.spec.id] ?? 30000;
    const floor = this.#minAltitude();
    const cur = Math.round(me.altFt / 1000) * 1000;
    const cruise = CRUISE_ALT[this.spec.id] ?? 10000;
    const steps = [1000, 2000, 3000, 5000, 10000].map((d) => cur + d).concat([cruise], [-1000, -2000, -4000].map((d) => cur + d));
    const list = [...new Set(steps.map((v) => Math.round(v / 500) * 500))]
      .filter((v) => v <= ceiling && v >= Math.max(floor, 1500) && Math.abs(v - me.altFt) > 400)
      .sort((a, b) => b - a)
      .slice(0, 9);
    return list.map((v) => ({ id: `alt:${v}`, label: `${v > me.altFt ? 'Climb' : 'Descend'} to ${altitudeShort(v)} ft`, arg: v }));
  }

  /** Lowest altitude that clears terrain around the aircraft. */
  #minAltitude() {
    const hf = this.map.hf;
    const me = this.me;
    let max = hf.height(me.x, me.z);
    for (const r of [4000, 9000]) for (let i = 0; i < 12; i++) max = Math.max(max, hf.height(me.x + Math.cos(i * 0.5236) * r, me.z + Math.sin(i * 0.5236) * r));
    return Math.round((max * FT + 1500) / 500) * 500;
  }

  #headingMenu() {
    const list = [];
    for (let i = 0; i < 8; i++) list.push({ id: `hdg:${i * 45}`, label: `Fly heading ${String(i * 45 || 360).padStart(3, '0')} (${COMPASS[i]})`, arg: i * 45 });
    for (const a of this.#nearAirports(4)) list.push({ id: `direct:${a.code}`, label: `Direct to ${a.name} (${a.code}, ${Math.round(this.#distNm(a.x, a.z))} nm)`, arg: a.code });
    return list;
  }

  #nearAirports(n) {
    return [...this.map.airports].sort((a, b) => Math.hypot(a.x - this.me.x, a.z - this.me.z) - Math.hypot(b.x - this.me.x, b.z - this.me.z)).slice(0, n);
  }

  #airportMenu(kind) {
    return this.#nearAirports(6).map((a) => ({
      id: `${kind}:${a.code}`, label: `${a.name} (${a.code}) ${Math.round(this.#distNm(a.x, a.z))} nm, runway ${Math.max(...a.runways.map((r) => r.length))} m`, arg: a.code,
    }));
  }

  // ---- text helpers -------------------------------------------------------------------------------------------------------
  #windVector() {
    const apt = this.ctx.approachAirport ?? this.home;
    const v = new THREE.Vector3();
    this.model.world.wind(new THREE.Vector3(apt.x, apt.elevation + 10, apt.z), 0, v);
    return v;
  }

  #windFrom() {
    const v = this.#windVector();
    const speed = Math.hypot(v.x, v.z) / KT;
    const dir = (Math.atan2(-v.x, v.z) * 180) / Math.PI;
    return { speed, dir: ((dir % 360) + 360) % 360 };
  }

  #windText() {
    const w = this.#windFrom();
    return w.speed < 2 ? 'wind calm' : `wind ${String(Math.round(w.dir / 10) * 10 || 360).padStart(3, '0')} at ${Math.round(w.speed)}`;
  }

  #windSpoken() {
    const w = this.#windFrom();
    return windWords(Math.round(w.dir / 10) * 10, w.speed);
  }

  #atisText() {
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(this.model.time / 900) % 26];
    const sky = this.getSky?.() ?? 'clear';
    const apt = this.ctx.approachAirport ?? this.home;
    const sk = {
      clear: ['sky clear', 'visibility 10'], scattered: ['scattered clouds at 4,500', 'visibility 10'], overcast: ['overcast at 2,500', 'visibility 8'],
      rain: ['broken clouds at 1,800, rain', 'visibility 4'], storm: ['broken clouds at 1,500, thunderstorms', 'visibility 3'], fog: ['vertical visibility 200, fog', 'visibility 1/4'],
      snow: ['overcast at 1,200, snow', 'visibility 2'],
    }[sky] ?? ['sky clear', 'visibility 10'];
    const rw = this.ops?.approach?.end.id ?? apt.runways[0].ends[0].id;
    const temp = 15 - Math.round(apt.elevation / 150);
    const text = `${apt.name} information ${letter}. ${this.#windText()}, ${sk[1]}, ${sk[0]}, temperature ${temp}, altimeter 2 9 9 2. Runway ${rw} in use.`;
    const spoken = `${apt.name} information ${callsignWords(letter)}. ${this.#windSpoken()}, ${sk[1]}, ${sk[0]}, temperature ${digits(temp)}, altimeter two niner niner two. Runway ${runwayWords(rw)} in use.`;
    return { letter, text, spoken };
  }

  // ---- pilot requests ---------------------------------------------------------------------------------------------------------
  /** Make a request by menu id. Pilot transmission is shown at once; the controller answers after a short delay. */
  request(id, arg) {
    if (!this.model || !this.enabled) return;
    const item = this.menu.find((x) => x.id === id);
    if (item?.children) { this.menuPath.push(id); this.#bump(); return; }
    this.#handleRequest(id, arg ?? item?.arg);
    this.menuPath.length = 0;
    this.#bump();
  }

  #pilot(text) { this.#say('PILOT', text); }

  #handleRequest(id, arg) {
    const m = this.model;
    const me = this.me;
    const apt = this.home;
    const st = this.station;
    const cs = this.cs;
    const csS = this.csShort;
    const pilot = (text) => this.#pilot(`${st.name}, ${this.reg}, ${text}`);
    const ap = this.ops?.approach;
    const rw = ap ? ap.end.id : '';
    const [kind, value] = id.includes(':') ? id.split(':') : [id, arg];
    switch (kind) {
      case 'radiocheck':
        pilot('radio check.');
        this.#reply(`${csS}, loud and clear.`, null, 1.4);
        break;
      case 'atis': {
        pilot('request airport information.');
        const a = this.#atisText();
        this.#reply(a.text, null, 1.4, a.spoken);
        break;
      }
      case 'clearance': {
        pilot(`request departure clearance, VFR, departing runway ${rw}.`);
        const cruise = CRUISE_ALT[this.spec.id] ?? 8000;
        const initial = Math.min(5000, Math.max(3000, Math.round((apt.elevation * FT + 3000) / 1000) * 1000));
        this.#reply(`${csS}, cleared out of the control zone, runway heading, climb and maintain ${altitudeShort(initial)}, expect ${altitudeShort(cruise)} after departure, squawk ${this.squawk}.`, () => {
          this.clr.ifr = true; this.ctx.alt = initial; this.ctx.hdg = null; this.ctx.initialAlt = initial;
        }, 1.8, `${csS}, cleared out of the control zone, runway heading, climb and maintain ${altitudeWords(initial)}, expect ${altitudeWords(cruise)} after departure, squawk ${squawkWords(this.squawk)}.`);
        break;
      }
      case 'taxi':
        pilot(`ready to taxi, with information ${this.#atisText().letter}.`);
        if (!this.clr.ifr && isTowered(apt)) {
          this.#reply(`${csS}, request your departure clearance first.`, null, 1.4);
        } else {
          const route = departureRoute(apt, rw, 0);
          void route;
          this.#reply(`${csS}, runway ${rw}, taxi via the parallel taxiway, hold short of runway ${rw}. ${this.#windText()}.`, () => { this.clr.taxi = true; this.ctx.holdingReported = false; },
            1.8, `${csS}, runway ${runwayWords(rw)}, taxi via the parallel taxiway, hold short of runway ${runwayWords(rw)}. ${this.#windSpoken()}.`);
        }
        break;
      case 'unicom_taxi':
        pilot(`taxiing to runway ${rw}, any traffic please advise.`);
        this.#reply('No traffic reported.', () => { this.clr.taxi = true; }, 1.6);
        break;
      case 'unicom_depart':
        pilot(`departing runway ${rw}, departure to the ${compassWord(this.me.hdg)}.`);
        this.#reply('No traffic reported. Good day.', () => { this.clr.takeoff = true; this.clr.lineup = true; }, 1.6);
        break;
      case 'depart':
        if (st.role === 'ground') this.station = this.#station('tower');
        if (this.phase === 'hold' && !this.clr.lineup) pilot(`holding short runway ${rw}, ready for departure.`);
        else pilot(`runway ${rw}, ready, request takeoff clearance.`);
        this.#reply('', () => { this.pendingTakeoff = true; this.#takeoffDecision(true); }, 1.6);
        break;
      case 'taxi_back':
        pilot('request taxi back to parking.');
        this.#reply(`${csS}, taxi to parking via the parallel taxiway.`, () => { this.phase = 'taxi'; this.clr.takeoff = false; this.clr.lineup = false; this.pendingTakeoff = false; this.station = this.#station('ground'); }, 1.6);
        break;
      case 'abort':
        pilot('rejecting takeoff.');
        this.#reply(`${csS}, roger, vacate the runway when able.`, () => { this.clr.takeoff = false; this.pendingTakeoff = false; }, 1.2);
        break;
      case 'contact_departure': {
        const dep = this.#station('departure');
        this.#pilot(`${dep.name}, ${this.reg}, passing ${Math.round(me.altFt / 100) * 100} feet.`);
        this.station = dep;
        const alt = this.ctx.alt ?? this.ctx.initialAlt ?? Math.round((me.altFt + 3000) / 1000) * 1000;
        this.#reply(`${csS}, radar contact. Climb and maintain ${altitudeShort(Math.max(alt, 5000))}, fly runway heading.`, () => { this.ctx.alt = Math.max(alt, 5000); this.ctx.altSetAt = null; this.phase = 'enroute'; }, 1.8,
          `${csS}, radar contact. Climb and maintain ${altitudeWords(Math.max(alt, 5000))}, fly runway heading.`);
        break;
      }
      case 'contact_center': {
        const c = this.#station('center');
        this.#pilot(`${c.name}, ${this.reg}, ${Math.round(me.altFt / 100) * 100} feet.`);
        this.station = c;
        this.#reply(`${csS}, ${c.name}, radar contact. Maintain present altitude, expect higher in ten minutes.`, () => { this.phase = 'enroute'; }, 1.8);
        break;
      }
      case 'alt': {
        const target = Number(value);
        const up = target > me.altFt;
        this.#pilot(`${st.name}, ${this.reg}, request ${up ? 'climb' : 'descent'} to ${altitudeShort(target)}.`);
        if (target < this.#minAltitude() - 250) {
          this.#reply(`${csS}, unable, minimum safe altitude ${altitudeShort(this.#minAltitude())} for terrain.`, null, 1.6);
        } else {
          this.#reply(`${csS}, ${up ? 'climb' : 'descend'} and maintain ${altitudeShort(target)}.`, () => { this.ctx.alt = target; this.ctx.altSetAt = null; }, 1.6,
            `${csS}, ${up ? 'climb' : 'descend'} and maintain ${altitudeWords(target)}.`);
        }
        break;
      }
      case 'hdg': {
        const h = Number(value);
        this.#pilot(`${st.name}, ${this.reg}, request heading ${String(h || 360).padStart(3, '0')}.`);
        this.#reply(`${csS}, fly heading ${String(h || 360).padStart(3, '0')}.`, () => { this.ctx.hdg = h || 360; this.ctx.hdgSetAt = null; this.ctx.directTo = null; }, 1.6, `${csS}, fly heading ${hdgWords(h)}.`);
        break;
      }
      case 'direct': {
        const a = this.map.airports.find((x) => x.code === value);
        this.#pilot(`${st.name}, ${this.reg}, request direct ${a.name}.`);
        const brg = headingOf(a.x - me.x, a.z - me.z);
        this.#reply(`${csS}, proceed direct ${a.name}, heading ${String(Math.round(brg)).padStart(3, '0')}.`, () => { this.ctx.hdg = Math.round(brg) || 360; this.ctx.hdgSetAt = null; this.ctx.directTo = a.code; }, 1.8,
          `${csS}, proceed direct ${a.name}, heading ${hdgWords(brg)}.`);
        break;
      }
      case 'hold':
        this.#pilot(`${st.name}, ${this.reg}, request holding at present position.`);
        this.#reply(`${csS}, hold at present position, left turns, one minute legs. Expect further clearance in 5 minutes.`, () => { this.ctx.hold = { until: me.t + 300 }; }, 1.8);
        break;
      case 'position': {
        const near = this.#nearAirports(1)[0];
        this.#pilot(`${st.name}, ${this.reg}, ${Math.round(me.altFt / 100) * 100} feet.`);
        this.#reply(`${csS}, radar contact, ${Math.round(this.#distNm(near.x, near.z))} miles ${compassWord(this.#bearingTo(near.x, near.z) + 180)} of ${near.name}.`, null, 1.5);
        break;
      }
      case 'approach': {
        const a = this.map.airports.find((x) => x.code === value);
        this.#requestApproach(a);
        break;
      }
      case 'established':
        this.#pilot(`${st.name}, ${this.reg}, established.`);
        this.#reply(this.ctx.vectorStage >= 3 ? `${csS}, roger. Contact tower.` : `${csS}, you are not yet established, continue present heading.`, null, 1.4);
        break;
      case 'contact_tower': {
        const apt2 = this.ctx.approachAirport ?? this.home;
        const tw = this.#station(isTowered(apt2) ? 'tower' : 'unicom', apt2);
        this.#pilot(`${tw.name}, ${this.reg}, ${Math.round(this.me.distToThr / NM * 10) / 10 || 0} miles out, runway ${this.ops?.approach?.end.id ?? ''}.`);
        this.station = tw;
        this.ctx.towerContacted = true;
        if (!isTowered(apt2)) {
          this.#reply('Traffic none reported. Runway is yours.', () => { this.clr.land = true; }, 1.4);
        } else {
          this.#reply(`${csS}, ${tw.name}, report short final.`, () => { this.#landingDecision(this.me.distToThr); }, 1.6);
        }
        break;
      }
      case 'landing_req':
        this.#pilot(`${st.name}, ${this.reg}, request landing clearance.`);
        this.#reply('', () => this.#landingDecision(this.me.distToThr), 1.4);
        break;
      case 'missed':
        this.#pilot(`${st.name}, ${this.reg}, going around.`);
        this.#reply(`${csS}, roger, climb and maintain ${altitudeShort(Math.round(((this.ctx.approachAirport ?? this.home).elevation * FT + 3000) / 500) * 500)}, fly runway heading.`, () => {
          this.clr.land = false; this.phase = 'approach'; this.ctx.vectorStage = 1; this.ctx.towerContacted = false;
          this.station = this.#station('approach', this.ctx.approachAirport ?? this.home);
          this.ctx.alt = Math.round(((this.ctx.approachAirport ?? this.home).elevation * FT + 3000) / 500) * 500; this.ctx.altSetAt = null;
        }, 1.4);
        break;
      case 'contact_ground': {
        const apt2 = this.landedAirport ?? this.ctx.approachAirport ?? this.home;
        const g = this.#station('ground', apt2);
        this.#pilot(`${g.name}, ${this.reg}, clear of the runway, request taxi to parking.`);
        this.station = g;
        this.#reply(`${csS}, taxi to parking via the parallel taxiway.`, null, 1.5);
        break;
      }
      case 'mayday': {
        this.#say('PILOT', `Mayday, mayday, mayday, ${this.reg}, ${this.#problemText()}, request immediate landing.`);
        const near = this.#nearAirports(1)[0];
        const target = this.ctx.approachAirport ?? near;
        this.#reply(`${csS}, roger mayday. Fly heading ${String(Math.round(headingOf(target.x - me.x, target.z - me.z))).padStart(3, '0')} direct ${target.name}, runway available, emergency services standing by. Contact tower when able.`, () => {
          this.ctx.emergency = true;
          if (this.ops) this.ops.holdAll = true;
          if (!this.ctx.approachAirport) this.#requestApproach(target, true);
        }, 1.2);
        break;
      }
      case 'squawk7600':
        this.#pilot(`(transmitting blind) ${this.reg} radio failure, squawk 7600.`);
        this.#reply('', null, 0.1);
        this.#say('ATC', '(No reply. Traffic has been cleared from your area.)');
        if (this.ops) this.ops.holdAll = true;
        this.ctx.emergency = true;
        break;
      default: break;
    }
  }

  #problemText() {
    const f = this.model.sys.describe(this.model).find((x) => x.level !== 'info');
    return f ? f.text.toLowerCase() : 'declaring an emergency';
  }

  /** Approach request: assign the runway, set up vectors, hand over to Approach. */
  #requestApproach(a, silent = false) {
    const m = this.model;
    const me = this.me;
    const st = this.station;
    if (!silent) this.#pilot(`${st.name}, ${this.reg}, request approach at ${a.name}.`);
    const wind = new THREE.Vector3();
    m.world.wind(new THREE.Vector3(a.x, a.elevation + 10, a.z), 0, wind);
    const pick1 = bestEnd(a, wind, a.runways[0]);
    const endId = pick1.end.id;
    const appr = this.#station(a.cls === 'strip' || a.cls === 'small' ? 'unicom' : 'approach', a);
    const speak = () => {
      this.ops?.dispose();
      this.home = this.home ?? a;
      this.ctx.approachAirport = a;
      this.ctx.approachEnd = endId;
      this.ctx.vectorStage = 1;
      this.ctx.towerContacted = false;
      this.clr.land = false; this.clr.approach = false;
      this.station = appr;
      this.phase = 'approach';
      this.#setupOps(a, endId);
      this.ctx.towerContacted = false;
      const iaf = approachFor(a, endId).before(16000, 0);
      const hdg = Math.round(headingOf(iaf.x - me.x, iaf.z - me.z)) || 360;
      const alt = Math.max(a.elevation * FT + 4500, 3000);
      this.ctx.hdg = hdg; this.ctx.hdgSetAt = null;
      this.ctx.alt = Math.round(Math.min(Math.max(alt, 4000), Math.max(me.altFt, 4000)) / 500) * 500; this.ctx.altSetAt = null;
      const body = a.cls === 'strip' || a.cls === 'small'
        ? `${this.csShort}, uncontrolled airfield. Descend and maintain ${altitudeShort(this.ctx.alt)}, fly heading ${String(hdg).padStart(3, '0')} for runway ${endId}, report on the airfield frequency.`
        : `${this.csShort}, ${a.name} Approach, expect ${a.runways[0].ends.find((e) => e.id === endId)?.ils ? 'ILS' : 'visual'} runway ${endId}. Fly heading ${String(hdg).padStart(3, '0')}, descend and maintain ${altitudeShort(this.ctx.alt)}.`;
      this.#atc(body);
      this.#bump();
    };
    const dist = Math.round(this.#distNm(a.x, a.z));
    this.#reply(`${this.csShort}, roger, ${dist} miles from ${a.name}.`, speak, 1.6);
  }
}
