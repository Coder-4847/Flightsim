import { WEATHER_PRESETS } from '../flight/world.js';
import { crashPenalty, comfortTier, missionPayout, vipLandingFactor, vipPayout } from './economy.js';
import { describeGoal, goalMet, missionById, missionUnlocked, resolveMission, MISSIONS } from './missions.js';
import { ComfortMeter, VIP_CONTRACTS, resolveVip, vipById } from './vip.js';

// Career missions and VIP escorts share one flow: fly the aircraft you are given from A (optionally
// past some waypoints) to B, land, and be paid on a scale that depends on how well you did.

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** The runway end facing most nearly into the wind. */
export function pickEnd(airport, weatherId) {
  const wind = WEATHER_PRESETS[weatherId] ?? WEATHER_PRESETS.calm;
  const ends = airport.runways[0].ends;
  if (!wind.speed) return ends[0];
  return ends.reduce((best, e) => (angDiff(e.heading, wind.direction) < angDiff(best.heading, wind.direction) ? e : best), ends[0]);
}

const hashId = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function resolvePlan(plan) {
  if (plan.mode === 'vip') return resolveVip(vipById(plan.id));
  return resolveMission(missionById(plan.id));
}

export class ContractMode {
  constructor(plan, runner) {
    this.plan = plan;
    this.runner = runner;
    this.isVip = plan.mode === 'vip';
    this.def = resolvePlan(plan);
    this.title = this.def.title;
  }

  startOptions() {
    const d = this.def;
    const gate = this.plan.startMode === 'gate' && d.startMode === 'runway';
    return {
      aircraftId: d.aircraft, mapId: d.map, airportCode: d.from, endId: pickEnd(d.fromAirport, d.weatherPreset).id,
      startMode: gate ? 'gate' : d.startMode, hour: d.hour, sky: d.sky, weather: d.weatherPreset, fuelKg: d.fuelKg, seed: hashId(d.id),
      liveryId: 'factory', tuning: this.runner.saves.tuningFor(d.aircraft),
    };
  }

  begin() {
    this.elapsed = 0;
    this.viaDone = new Set();
    this.failed = null;
    this.comfort = this.isVip ? new ComfortMeter(this.runner.upgrades.includes('cabin') ? 0.75 : 1) : null;
    this.lastGrade = null;
    this.warnedWrong = false;
    this.runner.toast(`${this.isVip ? 'VIP' : 'Mission'}: ${this.def.title}`);
  }

  tick(dt, tel) {
    const d = this.def;
    const m = this.runner.session.model;
    this.elapsed += dt;
    // Waypoints.
    if (!tel.onGround) {
      for (const v of d.via) {
        if (this.viaDone.has(v.id)) continue;
        if (Math.hypot(m.pos.x - v.x, m.pos.z - v.z) < v.radius) {
          this.viaDone.add(v.id);
          this.runner.toast(`Waypoint reached: ${v.name}`);
        }
      }
    }
    this.comfort?.update(dt, tel);
    if (this.comfort && this.comfort.value <= 0 && !this.failed) this.#fail(`${d.vip} has demanded that the flight be abandoned`, false);
    if (d.deadline && this.elapsed / 60 > d.deadline && !this.failed) this.#fail('You missed the deadline', false);
  }

  onTracker(type, p) {
    if (this.failed) return;
    if (type === 'poi') this.runner.toast(`Sightseeing: ${p.name}`);
    else if (type === 'touchdown') {
      this.lastGrade = p.grade;
      this.comfort?.touchdown(p.grade);
    } else if (type === 'landed') this.#landed(p);
    else if (type === 'crash') this.#fail(p.reason, true);
  }

  #landed(p) {
    const d = this.def;
    const r = this.runner;
    if (!p.stopAirport || p.stopAirport.code !== d.toAirport.code) {
      r.toast(p.stopAirport ? `Wrong airport: your destination is ${d.toAirport.name}` : `Off-airport landing: get to ${d.toAirport.name}`);
      r.tracker.resetLeg();
      return;
    }
    const missing = d.via.filter((v) => !this.viaDone.has(v.id));
    if (missing.length) {
      r.toast(`Fly over ${missing.map((v) => v.name).join(', ')} first`);
      r.tracker.resetLeg();
      return;
    }
    const minutes = this.elapsed / 60;
    const report = { grade: p.grade, minutes, fuelUsed: r.tracker.fuelUsed, pois: r.tracker.visited.size, onRunway: !!p.runway };
    const save = r.saves.active;
    const prior = save?.[this.isVip ? 'vip' : 'career'].completed[d.id];
    const notes = [`${p.trackKm.toFixed(1)} km flown · ${p.fuelUsed.toFixed(0)} kg fuel · ${minutes.toFixed(1)} min`, `Touchdown: ${p.grade} (${Math.round(p.fpm)} ft/min)`];
    let pay;
    let stars = 1;
    let goals = [];
    let score = null;
    if (this.isVip) {
      const onTime = !d.arriveBy || minutes <= d.arriveBy;
      pay = vipPayout({ base: d.base, comfort: this.comfort.value, grade: p.grade, multiplier: r.multiplier, upgrades: r.upgrades, onTime });
      score = Math.round(this.comfort.value);
      const tier = comfortTier(this.comfort.value);
      stars = vipLandingFactor(p.grade) >= 0.8 && tier.factor >= 0.9 ? (onTime ? 3 : 2) : vipLandingFactor(p.grade) > 0.25 && tier.factor >= 0.7 ? 2 : 1;
      notes.push(`Comfort: ${tier.label} (${Math.round(this.comfort.value)}%)${this.comfort.worstReason ? ` · rough moments: ${this.comfort.worstReason}` : ''}`);
      if (d.arriveBy) notes.push(onTime ? `On time (due within ${d.arriveBy} min)` : `Late: due within ${d.arriveBy} min`);
    } else {
      goals = d.goals.map((g) => ({ text: describeGoal(g), met: goalMet(g, report) }));
      stars = 1 + goals.filter((g) => g.met).length;
      let base = d.base;
      const lines = [];
      if (p.grade === 'Hard') lines.push({ label: 'Rough landing: damage claim −25%', f: 0.75 });
      else if (p.grade === 'Very hard') lines.push({ label: 'Very rough landing: damage claim −50%', f: 0.5 });
      const factor = lines.length ? lines[0].f : 1;
      pay = missionPayout({ base: Math.round(base * factor), stars, multiplier: r.multiplier, kind: d.kind, upgrades: r.upgrades });
      if (lines.length) pay.lines.splice(1, 0, { label: lines[0].label, amount: 0 });
    }
    let total = pay.total;
    if (prior) {
      const half = Math.floor(total / 2);
      pay.lines.push({ label: 'Replay: half pay', amount: half - total });
      total = half;
    }
    const { paid } = r.bank({ total, landed: true, trackKm: p.trackKm, airborneSec: p.airborneSec, pax: d.pax ?? 0, cargoKg: d.cargoKg ?? 0, fpm: p.fpm, reason: this.isVip ? 'vip' : 'career' });
    // Progress.
    if (save) {
      const book = save[this.isVip ? 'vip' : 'career'].completed;
      const best = book[d.id];
      book[d.id] = {
        stars: Math.max(best?.stars ?? 0, stars), payout: Math.max(best?.payout ?? 0, paid), best: Math.min(best?.best ?? 1e9, Math.round(this.elapsed)),
        plays: (best?.plays ?? 0) + 1, score: Math.max(best?.score ?? 0, score ?? 0) || null,
      };
      r.saves.autosave('mission');
    }
    const list = this.isVip ? VIP_CONTRACTS : MISSIONS;
    const next = list[list.findIndex((x) => x.id === d.id) + 1] ?? null;
    r.finish({
      mode: this.plan.mode, title: this.isVip ? 'Escort complete' : 'Mission complete', subtitle: d.title, success: true, stars,
      goals, lines: pay.lines, total: paid, notes, grade: p.grade, missionId: d.id, nextId: next?.id ?? null,
      nextUnlocked: next ? (this.isVip ? !!save?.vip.completed[d.id] : missionUnlocked(save, next.id)) : false,
      replay: !!prior,
    });
  }

  #fail(reason, crashed) {
    this.failed = reason;
    const r = this.runner;
    const d = this.def;
    const insured = r.upgrades.includes('insurance');
    const bill = crashed ? Math.max(250, Math.round((crashPenalty(d.aircraft, false) * 0.6) / 10) * 10) : 0;
    const penalty = Math.round(bill * (insured ? 0.25 : 1));
    const { charged } = r.bank({ penalty, crashed, trackKm: r.tracker.trackKm, airborneSec: r.tracker.airborneSec, reason: 'mission-failed' });
    r.finish({
      mode: this.plan.mode, crash: crashed, success: false, title: crashed ? 'Crashed' : 'Mission failed', subtitle: reason,
      lines: charged ? [{ label: `Repair bill${insured ? ' (insured)' : ''}`, amount: -charged }] : [], total: -charged, notes: [d.title], missionId: d.id,
    });
  }

  info() {
    const d = this.def;
    const t = this.runner.tracker;
    const m = this.runner.session.model;
    const rows = [];
    const toDest = m ? Math.hypot(m.pos.x - d.toAirport.x, m.pos.z - d.toAirport.z) / 1000 : 0;
    const pending = d.via.find((v) => !this.viaDone.has(v.id));
    const target = pending ?? d.toAirport;
    const tx = target.x - (m?.pos.x ?? 0);
    const tz = target.z - (m?.pos.z ?? 0);
    const brg = ((Math.atan2(tx, -tz) * 180) / Math.PI + 360) % 360;
    rows.push([pending ? 'Next waypoint' : 'Destination', `${pending ? pending.name : `${d.toAirport.name} (${d.toAirport.code})`}`]);
    rows.push(['Bearing / distance', `${String(Math.round(brg)).padStart(3, '0')}° · ${(Math.hypot(tx, tz) / 1000).toFixed(1)} km${pending ? ` (${toDest.toFixed(1)} km to the field)` : ''}`]);
    rows.push(['Time', `${(this.elapsed / 60).toFixed(1)} min${d.arriveBy ? ` · due ${d.arriveBy} min` : d.deadline ? ` · deadline ${d.deadline} min` : ''}`]);
    rows.push(['Fuel used', `${(t?.fuelUsed ?? 0).toFixed(0)} kg`]);
    const goals = [{ text: `Land at ${d.toAirport.name}`, done: false }];
    for (const v of d.via) goals.unshift({ text: `Overfly ${v.name}`, done: this.viaDone.has(v.id) });
    const mins = this.elapsed / 60;
    const used = t?.fuelUsed ?? 0;
    const visited = t?.visited.size ?? 0;
    for (const g of d.goals) {
      goals.push({
        text: describeGoal(g), bonus: true,
        done: g.type === 'pois' && visited >= g.n,
        failed: (g.type === 'time' && mins > g.minutes) || (g.type === 'frugal' && used > g.kg),
      });
    }
    const out = { title: d.title, subtitle: this.isVip ? `${d.vip} · fare ${d.base.toLocaleString('en-US')} cr` : `Contract ${d.base.toLocaleString('en-US')} cr`, rows, goals };
    if (this.comfort) {
      const tier = comfortTier(this.comfort.value);
      out.bars = [{ label: 'Passenger comfort', value: this.comfort.value, max: 100, tone: this.comfort.value > 65 ? 'good' : this.comfort.value > 40 ? 'warn' : 'bad', text: `${Math.round(this.comfort.value)}% · ${tier.label}${this.comfort.reason ? ` · ${this.comfort.reason}` : ''}` }];
    }
    return out;
  }
}
