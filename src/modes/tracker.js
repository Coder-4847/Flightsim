import { Emitter } from '../core/events.js';
import { gradeIndex } from './economy.js';

// Watches a flight and reports what happened in terms the game modes care about: where the
// aircraft took off and landed, how far it flew, how it touched down, which sights it flew over.
// It reads the flight model directly (cheap fields only) and runs at 10 Hz.

const DEG = Math.PI / 180;
const FT = 0.3048;
const STEP = 0.1;
const STOP_SPEED = 2.6; // m/s (5 kt)
const STOP_TIME = 2;

/** The airport whose field the point is on (inside its flat radius), or null. */
export function airportAt(map, x, z, scale = 1) {
  let best = null;
  for (const a of map.airports) {
    const d = Math.hypot(x - a.x, z - a.z);
    if (d <= a.flatRadius * scale && (!best || d < best.d)) best = { airport: a, d };
  }
  return best?.airport ?? null;
}

/** The runway rectangle containing the point (with a small margin), or null. */
export function runwayAt(airport, x, z, margin = 12) {
  for (const rw of airport.runways) {
    const h = rw.heading * DEG;
    const dx = Math.sin(h);
    const dz = -Math.cos(h);
    const px = x - rw.cx;
    const pz = z - rw.cz;
    const along = px * dx + pz * dz;
    const across = px * -dz + pz * dx;
    if (Math.abs(along) <= rw.length / 2 + margin && Math.abs(across) <= rw.width / 2 + margin) return rw;
  }
  return null;
}

/** Sights worth flying over: towns, cities and lakes. */
export function pointsOfInterest(map) {
  const out = [];
  for (const c of map.cities) {
    if (c.kind === 'village') continue;
    out.push({ id: c.id, name: c.name, x: c.x, z: c.z, radius: c.radius + 500 });
  }
  map.lakes.forEach((l, i) => {
    if (l.radius < 500) return;
    const near = map.cities.reduce((b, c) => (!b || Math.hypot(c.x - l.x, c.z - l.z) < Math.hypot(b.x - l.x, b.z - l.z) ? c : b), null);
    out.push({ id: `lake${i}`, name: near ? `${near.name} Lake` : `Lake ${i + 1}`, x: l.x, z: l.z, radius: l.radius + 300 });
  });
  return out;
}

export class FlightTracker extends Emitter {
  constructor(map, model, origin = null) {
    super();
    this.map = map;
    this.model = model;
    this.pois = pointsOfInterest(map);
    this.visited = new Set();
    this.origin = origin; // airport the flight began at
    this.resetLeg();
    this.flightTime = 0;
    this.acc = 0;
    this.airborne = !model.gear.weightOnWheels && model.agl > 30 * FT;
    this.legStart = this.airborne ? { x: model.pos.x, z: model.pos.z, airport: origin?.code ?? null } : null;
    this.last = { x: model.pos.x, z: model.pos.z };
    this.lastEmittedLanding = null;
  }

  /** Start tallying a new leg (after a landing has been banked). */
  resetLeg() {
    this.trackM = 0;
    this.airborneSec = 0;
    this.fuelAtStart = this.model.fuel;
    this.touchdowns = [];
    this.landing = null; // { grade, fpm, airport, runway, time, x, z }
    this.stoppedFor = 0;
    this.landed = false;
    this.belly = false;
    this.legPois = 0;
    this.maxAltFt = 0;
    this.legStart = this.airborne ? { x: this.model.pos.x, z: this.model.pos.z, airport: this.legStart?.airport ?? this.origin?.code ?? null } : null;
    this.last = { x: this.model.pos.x, z: this.model.pos.z };
  }

  get fuelUsed() { return Math.max(0, this.fuelAtStart - this.model.fuel); }
  get trackKm() { return this.trackM / 1000; }
  get straightKm() {
    if (!this.legStart) return 0;
    const end = this.landing ?? { x: this.model.pos.x, z: this.model.pos.z };
    return Math.hypot(end.x - this.legStart.x, end.z - this.legStart.z) / 1000;
  }

  /** Feed physics events (touchdown, crash...) from the session. */
  onEvent(e) {
    const m = this.model;
    if (e.type === 'touchdown') {
      if (!this.airborne && this.airborneSec < 15) return; // rolling over a bump on the ground
      const airport = airportAt(this.map, m.pos.x, m.pos.z, 1);
      const rw = airport ? runwayAt(airport, m.pos.x, m.pos.z) : null;
      this.touchdowns.push({ grade: e.grade, fpm: e.fpm, time: this.flightTime });
      const worst = this.touchdowns.reduce((a, b) => (gradeIndex(b.grade) > gradeIndex(a.grade) ? b : a));
      const first = this.landing;
      this.landing = {
        grade: worst.grade, fpm: Math.max(...this.touchdowns.map((t) => t.fpm)), airport: first?.airport ?? airport, runway: first?.runway ?? rw,
        time: first?.time ?? this.flightTime, x: first?.x ?? m.pos.x, z: first?.z ?? m.pos.z,
        bounces: this.touchdowns.length - 1,
      };
      this.airborne = false;
      this.stoppedFor = 0;
      this.emit('touchdown', this.landing);
    } else if (e.type === 'strike' && !this.landing && (this.airborne || this.airborneSec > 15)) {
      // Belly landing (gear up) or a scrape: there is no wheel touchdown, so count the strike as a hard one.
      const sink = Math.max(0, -m.vel.y) / (FT / 60);
      const airport = airportAt(this.map, m.pos.x, m.pos.z, 1);
      const rw = airport ? runwayAt(airport, m.pos.x, m.pos.z) : null;
      this.belly = true;
      this.landing = { grade: sink > 600 ? 'Very hard' : 'Hard', fpm: sink, airport, runway: rw, time: this.flightTime, x: m.pos.x, z: m.pos.z, bounces: 0 };
      this.airborne = false;
      this.stoppedFor = 0;
      this.emit('touchdown', this.landing);
    } else if (e.type === 'crash') {
      this.emit('crash', { reason: e.reason, airport: airportAt(this.map, m.pos.x, m.pos.z, 1) });
    }
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < STEP) return;
    const step = this.acc;
    this.acc = 0;
    const m = this.model;
    if (m.crashed) return;
    this.flightTime += step;
    const onGround = m.gear.weightOnWheels;
    const agl = m.agl / FT;
    const gs = Math.hypot(m.vel.x, m.vel.z);

    if (!this.airborne) {
      if (!onGround && agl > 30 && gs > 20) {
        this.airborne = true;
        // A departure after a banked landing (or the first one) starts a fresh leg; lifting off again
        // after a bounce or touch-and-go carries on with the same leg.
        const ap = airportAt(this.map, m.pos.x, m.pos.z, 1.6);
        if (this.landed || !this.legStart) {
          this.resetLeg();
          this.legStart = { x: m.pos.x, z: m.pos.z, airport: ap?.code ?? null };
        } else {
          this.landing = null;
          this.touchdowns = [];
        }
        this.emit('takeoff', { airport: ap, x: m.pos.x, z: m.pos.z });
      }
    } else if (onGround) {
      this.airborne = false;
    }

    if (this.airborne) {
      this.airborneSec += step;
      this.trackM += Math.hypot(m.pos.x - this.last.x, m.pos.z - this.last.z);
      this.maxAltFt = Math.max(this.maxAltFt, m.pos.y / FT);
      // Sightseeing.
      if (agl > 300 && agl < 8000) {
        for (const p of this.pois) {
          if (this.visited.has(p.id)) continue;
          if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < p.radius) {
            this.visited.add(p.id);
            this.legPois++;
            this.emit('poi', p);
          }
        }
      }
    }
    this.last.x = m.pos.x;
    this.last.z = m.pos.z;

    // Landing complete: touched down, then slow and still on the ground for a couple of seconds.
    if (this.landing && !this.landed && (onGround || this.belly)) {
      this.stoppedFor = gs < STOP_SPEED ? this.stoppedFor + step : 0;
      if (this.stoppedFor >= STOP_TIME) {
        this.landed = true;
        const airport = airportAt(this.map, m.pos.x, m.pos.z, 1);
        const rw = airport ? runwayAt(airport, m.pos.x, m.pos.z, 40) : null;
        this.emit('landed', {
          ...this.landing, stopAirport: airport, stopRunway: rw, x: m.pos.x, z: m.pos.z,
          trackKm: this.trackKm, straightKm: this.straightKm, airborneSec: this.airborneSec, fuelUsed: this.fuelUsed, pois: this.legPois,
          fuelLeft: m.fuel, origin: this.legStart?.airport ?? null,
        });
      }
    }
  }

  /** Nearest unvisited sight within `range` metres, for the HUD. */
  nearestPoi(range = 15000) {
    const m = this.model;
    let best = null;
    for (const p of this.pois) {
      if (this.visited.has(p.id)) continue;
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d < range && (!best || d < best.d)) best = { poi: p, d };
    }
    return best;
  }
}
