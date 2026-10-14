import { Emitter } from '../core/events.js';
import { loadJSON, removeKey, saveJSON } from '../storage/store.js';
import { AIRCRAFT_IDS, START_AIRCRAFT, START_MONEY, UPGRADES } from './catalog.js';

// Save slots: three pilots in localStorage, each with money, unlocks and progress. Slots can be
// exported to a JSON file and imported again (the importer validates and repairs the data).

export const SLOT_COUNT = 3;
export const SAVE_VERSION = 1;
const SLOT_KEY = (n) => `save:${n}`;
const ACTIVE_KEY = 'activeSlot';

const num = (v, fallback = 0, min = 0, max = 1e12) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback);
const str = (v, fallback = '', max = 40) => (typeof v === 'string' ? v.slice(0, max) : fallback);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function newSave(name = 'Pilot') {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    name,
    created: now,
    updated: now,
    money: START_MONEY,
    aircraft: [...START_AIRCRAFT],
    liveries: {}, // aircraftId -> [owned livery ids]
    equipped: {}, // aircraftId -> livery id
    upgrades: [],
    stats: { flights: 0, landings: 0, crashes: 0, distanceKm: 0, airborneHours: 0, passengers: 0, cargoKg: 0, earned: 0, spent: 0, bestLandingFpm: null },
    career: { completed: {} }, // missionId -> { stars, payout, best: seconds, plays }
    vip: { completed: {} },
    emergency: { best: {}, played: 0 }, // seed -> { score, grade, time }
    last: {}, // remembered choices
  };
}

/** Validate and repair arbitrary data into a well-formed save. Returns null if it is not a save. */
export function sanitizeSave(raw) {
  if (!isObj(raw) || !isObj(raw.stats) && raw.money == null && raw.aircraft == null) return null;
  const base = newSave(str(raw.name, 'Pilot'));
  const stats = isObj(raw.stats) ? raw.stats : {};
  const out = {
    ...base,
    created: num(raw.created, base.created, 0, 4e12),
    updated: num(raw.updated, base.updated, 0, 4e12),
    money: Math.floor(num(raw.money, START_MONEY, 0, 1e10)),
    aircraft: [...new Set([...START_AIRCRAFT, ...(Array.isArray(raw.aircraft) ? raw.aircraft : []).filter((id) => AIRCRAFT_IDS.includes(id))])],
    upgrades: [...new Set((Array.isArray(raw.upgrades) ? raw.upgrades : []).filter((id) => UPGRADES.some((u) => u.id === id)))],
    liveries: {}, equipped: {},
    stats: {
      flights: num(stats.flights), landings: num(stats.landings), crashes: num(stats.crashes), distanceKm: num(stats.distanceKm),
      airborneHours: num(stats.airborneHours), passengers: num(stats.passengers), cargoKg: num(stats.cargoKg), earned: num(stats.earned),
      spent: num(stats.spent), bestLandingFpm: stats.bestLandingFpm == null ? null : num(stats.bestLandingFpm, null, 0, 5000),
    },
    career: { completed: {} }, vip: { completed: {} }, emergency: { best: {}, played: num(raw.emergency?.played) }, last: {},
  };
  if (isObj(raw.liveries)) {
    for (const [id, list] of Object.entries(raw.liveries)) if (AIRCRAFT_IDS.includes(id) && Array.isArray(list)) out.liveries[id] = [...new Set(list.map((l) => str(l, '', 24)).filter(Boolean))];
  }
  if (isObj(raw.equipped)) {
    for (const [id, l] of Object.entries(raw.equipped)) if (AIRCRAFT_IDS.includes(id)) out.equipped[id] = str(l, 'factory', 24);
  }
  const copyDone = (src, dst) => {
    if (!isObj(src?.completed)) return;
    for (const [id, r] of Object.entries(src.completed)) {
      if (!isObj(r)) continue;
      dst.completed[str(id, '', 24)] = { stars: Math.round(num(r.stars, 1, 0, 3)), payout: Math.floor(num(r.payout)), best: num(r.best, null, 0, 1e7), plays: Math.floor(num(r.plays, 1, 0, 1e6)), score: num(r.score, null, 0, 1000) };
    }
  };
  copyDone(raw.career, out.career);
  copyDone(raw.vip, out.vip);
  if (isObj(raw.emergency?.best)) {
    for (const [seed, r] of Object.entries(raw.emergency.best).slice(0, 500)) {
      if (isObj(r)) out.emergency.best[str(seed, '', 16)] = { score: Math.round(num(r.score, 0, 0, 100)), grade: str(r.grade, 'F', 2), time: num(r.time, 0, 0, 1e7) };
    }
  }
  if (isObj(raw.last)) out.last = JSON.parse(JSON.stringify(raw.last).slice(0, 4000));
  return out;
}

export class SaveManager extends Emitter {
  constructor() {
    super();
    this.slots = [];
    this.activeSlot = null;
    this.active = null;
    this.reload();
    const stored = loadJSON(ACTIVE_KEY, null);
    if (stored && this.slots[stored - 1]) this.activate(stored, false);
  }

  /** Re-read every slot from storage. */
  reload() {
    this.slots = [];
    for (let n = 1; n <= SLOT_COUNT; n++) this.slots.push(sanitizeSave(loadJSON(SLOT_KEY(n), null)));
    if (this.activeSlot) this.active = this.slots[this.activeSlot - 1];
  }

  /** Slot summaries for the saves screen. */
  list() {
    return this.slots.map((s, i) => ({ slot: i + 1, save: s, active: this.activeSlot === i + 1 }));
  }

  create(slot, name = 'Pilot') {
    const save = newSave(str(name, 'Pilot').trim() || 'Pilot');
    this.#write(slot, save);
    return this.activate(slot);
  }

  activate(slot, remember = true) {
    if (!this.slots[slot - 1]) return null;
    this.activeSlot = slot;
    this.active = this.slots[slot - 1];
    if (remember) saveJSON(ACTIVE_KEY, slot);
    this.emit('change', { reason: 'activate' });
    return this.active;
  }

  deactivate() {
    this.activeSlot = null;
    this.active = null;
    removeKey(ACTIVE_KEY);
    this.emit('change', { reason: 'deactivate' });
  }

  delete(slot) {
    removeKey(SLOT_KEY(slot));
    this.slots[slot - 1] = null;
    if (this.activeSlot === slot) this.deactivate();
    this.emit('change', { reason: 'delete' });
  }

  rename(slot, name) {
    const s = this.slots[slot - 1];
    if (!s) return;
    s.name = str(name, 'Pilot').trim() || 'Pilot';
    this.#write(slot, s);
    this.emit('change', { reason: 'rename' });
  }

  /** Write the active slot to storage. `reason` is for the log/UI ("landing", "pause", "purchase"...). */
  autosave(reason = 'autosave') {
    if (!this.active) return false;
    this.active.updated = Date.now();
    const ok = saveJSON(SLOT_KEY(this.activeSlot), this.active);
    this.lastSave = { reason, time: Date.now(), ok };
    this.emit('saved', this.lastSave);
    return ok;
  }

  #write(slot, save) {
    save.updated = Date.now();
    this.slots[slot - 1] = save;
    return saveJSON(SLOT_KEY(slot), save);
  }

  // ---- export and import -----------------------------------------------------------------------------------------------
  exportJSON(slot) {
    const s = this.slots[slot - 1];
    if (!s) return null;
    return JSON.stringify({ game: 'flightsim', ...s }, null, 2);
  }

  /** Import text into a slot. Throws an Error with a readable message when the file is not a save. */
  importJSON(slot, text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    const save = sanitizeSave(data);
    if (!save) throw new Error('That file does not look like a Flight Sim save.');
    this.#write(slot, save);
    if (this.activeSlot === slot) this.active = save;
    this.emit('change', { reason: 'import' });
    return save;
  }

  // ---- economy ------------------------------------------------------------------------------------------------------------------
  get money() { return this.active?.money ?? 0; }

  earn(amount, reason) {
    if (!this.active || !(amount > 0)) return 0;
    const v = Math.floor(amount);
    this.active.money += v;
    this.active.stats.earned += v;
    this.emit('money', { delta: v, reason });
    return v;
  }

  /** Remove money (never below zero). Returns the amount actually taken. */
  charge(amount, reason) {
    if (!this.active || !(amount > 0)) return 0;
    const v = Math.min(this.active.money, Math.floor(amount));
    this.active.money -= v;
    this.active.stats.spent += v;
    this.emit('money', { delta: -v, reason });
    return v;
  }

  canAfford(price) { return !!this.active && this.active.money >= price; }
  ownsAircraft(id) { return !this.active || this.active.aircraft.includes(id); }
  ownsUpgrade(id) { return !!this.active?.upgrades.includes(id); }
  ownsLivery(aircraftId, liveryId) { return liveryId === 'factory' || !!this.active?.liveries[aircraftId]?.includes(liveryId); }
  equippedLivery(aircraftId) { return this.active?.equipped[aircraftId] ?? 'factory'; }

  /** @returns {{ ok: boolean, reason?: string }} */
  buyAircraft(id, price) {
    const s = this.active;
    if (!s) return { ok: false, reason: 'No save selected' };
    if (s.aircraft.includes(id)) return { ok: false, reason: 'Already owned' };
    if (s.money < price) return { ok: false, reason: 'Not enough money' };
    this.charge(price, `aircraft:${id}`);
    s.aircraft.push(id);
    this.autosave('purchase');
    this.emit('change', { reason: 'purchase' });
    return { ok: true };
  }

  buyUpgrade(id, price) {
    const s = this.active;
    if (!s) return { ok: false, reason: 'No save selected' };
    if (s.upgrades.includes(id)) return { ok: false, reason: 'Already installed' };
    if (s.money < price) return { ok: false, reason: 'Not enough money' };
    this.charge(price, `upgrade:${id}`);
    s.upgrades.push(id);
    this.autosave('purchase');
    this.emit('change', { reason: 'purchase' });
    return { ok: true };
  }

  buyLivery(aircraftId, liveryId, price) {
    const s = this.active;
    if (!s) return { ok: false, reason: 'No save selected' };
    if (!s.aircraft.includes(aircraftId)) return { ok: false, reason: 'Buy the aircraft first' };
    if (this.ownsLivery(aircraftId, liveryId)) return { ok: false, reason: 'Already owned' };
    if (s.money < price) return { ok: false, reason: 'Not enough money' };
    this.charge(price, `livery:${aircraftId}:${liveryId}`);
    (s.liveries[aircraftId] ??= []).push(liveryId);
    s.equipped[aircraftId] = liveryId;
    this.autosave('purchase');
    this.emit('change', { reason: 'purchase' });
    return { ok: true };
  }

  equipLivery(aircraftId, liveryId) {
    const s = this.active;
    if (!s || !this.ownsLivery(aircraftId, liveryId)) return false;
    s.equipped[aircraftId] = liveryId;
    this.autosave('livery');
    this.emit('change', { reason: 'livery' });
    return true;
  }

  remember(key, value) {
    if (this.active) this.active.last[key] = value;
  }
}
