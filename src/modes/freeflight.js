import { economyOf } from '../progress/catalog.js';
import { crashPenalty, freeFlightPayout, loadFactor, paidDistanceKm } from './economy.js';

// Free Flight: fly anywhere in any aircraft you own. Every landing at an airport pays for the
// distance flown, the passengers or cargo carried, the quality of the touchdown and any sights you
// flew over on the way.

export class FreeFlightMode {
  constructor(plan, runner) {
    this.plan = plan;
    this.runner = runner;
    this.title = 'Free Flight';
    this.legs = 0;
    this.earned = 0;
    this.lastLine = null;
  }

  startOptions() {
    const p = this.plan;
    const save = this.runner.saves.active;
    return {
      aircraftId: p.aircraftId, mapId: p.mapId, airportCode: p.airportCode, endId: p.endId, startMode: p.startMode,
      hour: p.hour, sky: p.sky, liveryId: save ? this.runner.saves.equippedLivery(p.aircraftId) : 'factory',
      tuning: save ? this.runner.saves.tuningFor(p.aircraftId) : undefined,
    };
  }

  begin() {
    this.legs = 0;
    this.earned = 0;
    this.#load();
  }

  /** Passengers or cargo for the next leg, varied a little from flight to flight. */
  #load() {
    const eco = economyOf(this.plan.aircraftId);
    const n = (this.runner.saves.active?.stats.flights ?? 0) + this.legs + 1;
    const lf = loadFactor(n);
    this.pax = eco.role === 'pax' ? Math.max(1, Math.round(eco.pax * lf)) : 0;
    this.cargoKg = eco.role === 'cargo' ? Math.round(eco.cargoKg * lf / 10) * 10 : 0;
  }

  tick() {}

  onTracker(type, p) {
    const r = this.runner;
    if (type === 'poi') r.toast(`Sightseeing bonus: ${p.name}`);
    else if (type === 'landed') this.#landed(p);
    else if (type === 'crash') this.#crashed(p);
  }

  #landed(p) {
    const r = this.runner;
    const t = r.tracker;
    if (paidDistanceKm(p.trackKm, p.straightKm) < 1.0) {
      r.toast('Flight too short to pay a fare');
      t.resetLeg();
      return;
    }
    const upgrades = r.upgrades;
    const pay = p.stopAirport
      ? freeFlightPayout({
        aircraftId: this.plan.aircraftId, trackKm: p.trackKm, straightKm: p.straightKm, grade: p.grade, atAirport: true, onRunway: !!p.runway,
        pax: this.pax, cargoKg: this.cargoKg, pois: p.pois, multiplier: r.multiplier, upgrades,
      })
      : { lines: [{ label: 'Landed away from an airport: no fare', amount: 0 }], total: 0 };
    const { paid } = r.bank({
      total: pay.total, landed: true, trackKm: p.trackKm, airborneSec: p.airborneSec, pax: p.stopAirport ? this.pax : 0,
      cargoKg: p.stopAirport ? this.cargoKg : 0, fpm: p.fpm,
    });
    this.legs++;
    this.earned += paid;
    const from = this.#airportName(p.origin);
    const notes = [];
    if (this.pax) notes.push(`${this.pax} passengers`);
    if (this.cargoKg) notes.push(`${this.cargoKg} kg of cargo`);
    notes.push(`${p.trackKm.toFixed(1)} km flown · ${p.fuelUsed.toFixed(0)} kg fuel · ${(p.airborneSec / 60).toFixed(0)} min airborne`);
    notes.push(`Touchdown: ${p.grade}${p.fpm != null ? ` (${Math.round(p.fpm)} ft/min)` : ''}${p.bounces ? `, ${p.bounces} bounce${p.bounces > 1 ? 's' : ''}` : ''}`);
    r.finish({
      mode: 'free', title: 'Landing report', success: true, canContinue: true,
      subtitle: `${from ? `${from} → ` : ''}${p.stopAirport ? p.stopAirport.name : 'Off-airport landing'}`,
      lines: pay.lines, total: paid, notes, grade: p.grade,
    });
    this.#load();
    t.resetLeg();
  }

  #crashed(p) {
    const r = this.runner;
    const insured = r.upgrades.includes('insurance');
    const bill = crashPenalty(this.plan.aircraftId, insured);
    const { charged } = r.bank({ penalty: bill, crashed: true, trackKm: r.tracker.trackKm, airborneSec: r.tracker.airborneSec, reason: 'crash' });
    r.finish({
      mode: 'free', crash: true, success: false, title: 'Crashed', subtitle: p.reason,
      lines: [{ label: `Repair bill${insured ? ' (insured)' : ''}`, amount: -charged }], total: -charged,
      notes: [`${r.tracker.trackKm.toFixed(1)} km flown on this leg is lost.`],
    });
  }

  #airportName(code) {
    if (!code) return null;
    return this.runner.tracker.map.airports.find((a) => a.code === code)?.name ?? null;
  }

  info() {
    const t = this.runner.tracker;
    const km = t ? paidDistanceKm(t.trackKm, t.straightKm) : 0;
    const eco = economyOf(this.plan.aircraftId);
    const est = t ? freeFlightPayout({
      aircraftId: this.plan.aircraftId, trackKm: t.trackKm, straightKm: t.straightKm, grade: 'Good', atAirport: true, onRunway: true,
      pax: this.pax, cargoKg: this.cargoKg, pois: t.legPois, multiplier: this.runner.multiplier, upgrades: this.runner.upgrades,
    }).total : 0;
    const near = t?.nearestPoi(12000);
    return {
      title: 'Free Flight',
      subtitle: 'Land at an airport to be paid.',
      rows: [
        ['Distance flown', `${(t?.trackKm ?? 0).toFixed(1)} km${km < (t?.trackKm ?? 0) - 0.05 ? ` (${km.toFixed(1)} paid)` : ''}`],
        ['Carrying', this.pax ? `${this.pax} passengers` : this.cargoKg ? `${this.cargoKg} kg cargo` : eco.role === 'none' ? 'Nothing (no payload)' : '—'],
        ['Sights seen', `${t?.legPois ?? 0}${near ? ` · next: ${near.poi.name} ${(near.d / 1000).toFixed(1)} km` : ''}`],
        ['Fare if landed now', `${est.toLocaleString('en-US')} cr`],
        ['Earned this flight', `${this.earned.toLocaleString('en-US')} cr`],
      ],
      goals: [],
    };
  }
}
