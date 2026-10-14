import { getAircraft } from '../aircraft/index.js';
import { createTrafficModel } from '../traffic/fleet.js';
import { Rng } from '../util/random.js';
import { layoutAirport } from '../world/airportLayout.js';
import { approachFor, arrivalRoute, departureRoute, dirOf, headingOf } from './geometry.js';

// AI aircraft that use the airport the player is at: departures taxi out from parked stands, wait
// for takeoff clearance and climb away; arrivals fly the final approach, land, vacate and taxi in.
// They are scripted (no flight model) but obey the same runway rules as the player, so the tower
// has real conflicts to manage.

const TAN3 = Math.tan((3 * Math.PI) / 180);
const KT = 0.514444;
const TAXI_SPEED = 9;
const AIRLINES = ['Skyline', 'Northwind', 'Coastal', 'Summit', 'Meridian Air', 'Pioneer'];

const POOLS = {
  hub: ['narrowbody', 'narrowbody', 'regional', 'widebody', 'bizjet', 'turboprop72', 'jumbo'],
  regional: ['turboprop72', 'regional', 'regional', 'citation', 'narrowbody', 'kingair'],
  small: ['cessna172', 'caravan', 'cessna172', 'kingair', 'citation'],
  strip: ['cessna172', 'caravan'],
};
const AIRLINER = new Set(['narrowbody', 'regional', 'widebody', 'jumbo', 'turboprop72']);

export const DENSITY = {
  off: { arrivals: Infinity, departures: Infinity, max: 0 },
  light: { arrivals: 330, departures: 300, max: 3 },
  moderate: { arrivals: 190, departures: 170, max: 5 },
  busy: { arrivals: 110, departures: 100, max: 8 },
};

/** Moves along a polyline at a given speed; reports position and heading. */
class PathFollower {
  constructor(points) {
    this.pts = points;
    this.seg = 0;
    this.t = 0;
    this.done = points.length < 2;
    this.heading = points.length > 1 ? headingOf(points[1].x - points[0].x, points[1].z - points[0].z) : 0;
    this.x = points[0].x;
    this.z = points[0].z;
  }

  remaining() {
    if (this.done) return 0;
    let r = Math.hypot(this.pts[this.seg + 1].x - this.x, this.pts[this.seg + 1].z - this.z);
    for (let i = this.seg + 1; i < this.pts.length - 1; i++) r += Math.hypot(this.pts[i + 1].x - this.pts[i].x, this.pts[i + 1].z - this.pts[i].z);
    return r;
  }

  advance(distance) {
    let left = distance;
    while (left > 0 && !this.done) {
      const a = this.pts[this.seg];
      const b = this.pts[this.seg + 1];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      const rest = segLen * (1 - this.t);
      const target = headingOf(b.x - a.x, b.z - a.z);
      let diff = ((target - this.heading + 540) % 360) - 180;
      diff = Math.max(-1, Math.min(1, diff / 25));
      this.heading = (this.heading + diff * Math.min(1, distance / 6) * 25 + 360) % 360;
      if (left >= rest) {
        left -= rest;
        this.seg++;
        this.t = 0;
        if (this.seg >= this.pts.length - 1) { this.done = true; this.x = b.x; this.z = b.z; break; }
      } else {
        this.t += left / segLen;
        left = 0;
      }
      if (!this.done) {
        const p = this.pts[this.seg];
        const q = this.pts[this.seg + 1];
        this.x = p.x + (q.x - p.x) * this.t;
        this.z = p.z + (q.z - p.z) * this.t;
      }
    }
  }
}

let flightNumber = 100;

class AiPlane {
  constructor(ops, role, id, variant, standIndex) {
    this.ops = ops;
    this.role = role;
    this.id = id;
    this.variant = variant;
    this.spec = getAircraft(id);
    this.standIndex = standIndex;
    this.state = 'new';
    this.stateTime = 0;
    this.speed = 0;
    this.pos = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.pitch = 0;
    this.gearUp = false;
    this.root = null;
    this.path = null;
    this.gone = false;
    this.goAround = false;
    this.cleared = false;
    flightNumber += 1 + Math.floor(Math.random() * 17);
    const airliner = AIRLINER.has(id);
    const airline = AIRLINES[variant % AIRLINES.length];
    this.callsign = airliner ? `${airline} ${flightNumber}` : `N${100 + (flightNumber * 7) % 800}${'ABCDEFGHJK'[flightNumber % 10]}${'LMNPQRSTUV'[(flightNumber * 3) % 10]}`;
    this.spoken = airliner ? `${airline} ${[...String(flightNumber)].join(' ')}` : `November ${[...String(this.callsign.slice(1, 4))].join(' ')} ${this.callsign.slice(4).split('').join(' ')}`;
    this.heavy = this.spec.mass.ref > 100000;
  }

  setModel(gearUp) {
    const old = this.root;
    const { root } = createTrafficModel(this.id, this.variant, { gearUp });
    root.rotation.order = 'YZX';
    this.ops.scene.add(root);
    if (old) this.ops.scene.remove(old);
    this.root = root;
    this.gearUp = gearUp;
    this.#sync();
  }

  get gearHeight() { return -this.spec.gear.mainLeft.y - 0.1; }

  #sync() {
    if (!this.root) return;
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.set(0, Math.PI / 2 - (this.heading * Math.PI) / 180, this.pitch, 'YZX');
  }

  place(x, z, heading, height = 0) {
    this.pos.x = x; this.pos.z = z; this.pos.y = this.ops.airport.elevation + this.gearHeight + height;
    this.heading = heading;
    this.#sync();
  }

  setState(state) { this.state = state; this.stateTime = 0; }

  dispose() {
    if (this.root) this.ops.scene.remove(this.root);
    this.root = null;
    this.gone = true;
  }

  /** Seconds until the aircraft crosses the threshold (arrivals only). */
  etaToThreshold() {
    if (this.role !== 'arrival' || this.state !== 'final') return Infinity;
    return Math.max(0, this.distToThreshold) / Math.max(this.speed, 20);
  }

  update(dt) {
    this.stateTime += dt;
    const ops = this.ops;
    const ap = ops.approach;
    switch (this.state) {
      case 'taxi_out': {
        const rem = this.path.remaining();
        const v = Math.min(TAXI_SPEED, 3 + rem * 0.15);
        this.speed = v;
        this.path.advance(v * dt);
        this.pos.x = this.path.x; this.pos.z = this.path.z; this.heading = this.path.heading;
        if (this.path.done) { this.setState('hold'); this.speed = 0; }
        break;
      }
      case 'hold':
        this.speed = 0;
        break;
      case 'lineup': {
        const dep = ops.depRoute;
        const dx = dep.entry.x - this.pos.x; const dz = dep.entry.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        this.speed = Math.min(6, 2 + dist * 0.2);
        const step = Math.min(dist, this.speed * dt);
        if (dist > 0.5) { this.pos.x += (dx / dist) * step; this.pos.z += (dz / dist) * step; }
        const target = ops.activeEnd.heading;
        let diff = ((target - this.heading + 540) % 360) - 180;
        this.heading = (this.heading + Math.sign(diff) * Math.min(Math.abs(diff), 30 * dt) + 360) % 360;
        if (dist < 1 && Math.abs(diff) < 3) { this.setState('roll'); this.rollStart = { x: this.pos.x, z: this.pos.z }; this.heading = target; this.cleared = true; }
        break;
      }
      case 'roll': {
        const d = dirOf(ops.activeEnd.heading);
        const spec = this.spec;
        const vLift = spec.speeds.vr * KT * 1.04;
        const rollDist = Math.min(spec.minRunway * 0.5, 2400);
        const accel = (vLift * vLift) / (2 * rollDist);
        this.speed += accel * dt;
        this.pos.x += d.x * this.speed * dt;
        this.pos.z += d.z * this.speed * dt;
        if (this.speed >= vLift) { this.setState('climb'); this.climbSpeed = this.speed; }
        else this.pitch = this.speed > vLift * 0.9 ? 0.05 : 0;
        break;
      }
      case 'climb': {
        const d = dirOf(ops.activeEnd.heading);
        const spec = this.spec;
        const fpm = this.heavy ? 1900 : spec.mass.ref > 15000 ? 2600 : spec.class === 'Fighter' ? 9000 : 900;
        const vy = fpm * 0.00508;
        const target = spec.speeds.vy * KT;
        this.speed += Math.max(-1, Math.min(1.2, (target - this.speed) * 0.2)) * dt;
        this.pitch = Math.min(0.2, Math.atan2(vy, Math.max(this.speed, 30)));
        this.pos.x += d.x * this.speed * dt;
        this.pos.z += d.z * this.speed * dt;
        this.pos.y += vy * dt;
        if (!this.gearUp && this.pos.y - ops.airport.elevation > 25) this.setModel(true);
        if (Math.hypot(this.pos.x - ops.airport.x, this.pos.z - ops.airport.z) > 18000) this.dispose();
        break;
      }
      case 'final': {
        const toThr = ap.local(this.pos.x, this.pos.z);
        this.distToThreshold = -toThr.along;
        const d = this.distToThreshold;
        const vapp = this.spec.speeds.vapp * KT;
        const v = vapp + Math.min(1, Math.max(0, (d - 3500) / 6000)) * 45 * KT;
        this.speed += Math.max(-1.5, Math.min(1.5, (v - this.speed) * 0.3)) * dt;
        const dirv = ap.dir;
        this.pos.x += dirv.x * this.speed * dt;
        this.pos.z += dirv.z * this.speed * dt;
        // Stay on the localiser and glidepath, flaring in the last 12 m.
        const local = ap.local(this.pos.x, this.pos.z);
        const h = Math.max(0, -local.along) * TAN3 + 8;
        const flareH = Math.max(0, Math.min(h, 8 + (local.along > -150 ? (local.along + 150) * -0.04 : 0)));
        this.pos.y = ops.airport.elevation + this.gearHeight + (local.along > -150 ? Math.max(0, 8 * (1 - (local.along + 150) / 450)) : h);
        void flareH;
        this.pitch = 0.05;
        if (local.along > 200 || this.pos.y <= ops.airport.elevation + this.gearHeight + 0.05) {
          this.pos.y = ops.airport.elevation + this.gearHeight;
          this.touchdownAlong = Math.max(80, local.along);
          this.setState('rollout');
          this.pitch = 0.02;
          const route = arrivalRoute(ops.airport, ap.end.id, this.standIndex, this.touchdownAlong);
          this.route = route;
          ops.onAiEvent?.({ type: 'landed', plane: this });
        }
        if (this.goAround) this.setState('goaround');
        break;
      }
      case 'goaround': {
        const dirv = ap.dir;
        this.speed = Math.max(this.speed, this.spec.speeds.vapp * KT);
        this.pitch = 0.17;
        this.pos.x += dirv.x * this.speed * dt;
        this.pos.z += dirv.z * this.speed * dt;
        this.pos.y += 8 * dt;
        if (!this.gearUp && this.stateTime > 3) this.setModel(true);
        if (this.stateTime > 70) this.dispose();
        break;
      }
      case 'rollout': {
        const dirv = ap.dir;
        const first = this.route.points[0];
        const dist = Math.hypot(first.x - this.pos.x, first.z - this.pos.z);
        // Brake along a profile that reaches taxi speed at the exit point.
        const profile = Math.sqrt(144 + 2 * 2.6 * Math.max(0, dist - 15));
        this.speed = Math.max(12, Math.min(this.speed - 1.6 * dt, profile));
        this.pos.y = ops.airport.elevation + this.gearHeight;
        this.pitch = 0;
        const toX = first.x - this.pos.x; const toZ = first.z - this.pos.z;
        if (dist > 20) {
          const tx = dirv.x; const tz = dirv.z;
          // Run down the centreline toward the exit point.
          const l = ap.local(this.pos.x, this.pos.z);
          const steer = -l.lateral * 0.02;
          this.pos.x += (tx + -tz * steer) * this.speed * dt;
          this.pos.z += (tz + tx * steer) * this.speed * dt;
          this.heading = ap.heading;
        } else {
          this.path = new PathFollower(this.route.points);
          this.path.heading = this.heading;
          this.setState('exit');
        }
        void toX; void toZ;
        break;
      }
      case 'exit':
      case 'taxi_in': {
        const rem = this.path.remaining();
        const v = Math.min(TAXI_SPEED, 2.5 + rem * 0.12);
        this.speed = v;
        this.path.advance(v * dt);
        this.pos.x = this.path.x; this.pos.z = this.path.z; this.heading = this.path.heading;
        if (this.state === 'exit' && this.path.seg >= 1) { ops.onAiEvent?.({ type: 'vacated', plane: this }); this.setState('taxi_in'); }
        if (this.path.done) { this.setState('parked'); this.speed = 0; }
        break;
      }
      case 'parked':
        this.speed = 0;
        if (this.stateTime > 150) this.dispose();
        break;
      default: break;
    }
    this.#sync();
  }
}

export class AirportOps {
  /**
   * @param o {scene, airport, group (airport group with userData.parked), density, seed}
   */
  constructor(o) {
    this.scene = o.scene;
    this.airport = o.airport;
    layoutAirport(o.airport);
    this.group = o.group;
    this.density = DENSITY[o.density] ?? DENSITY.moderate;
    this.rng = new Rng((o.seed ?? 7) ^ 0x7a7a);
    this.planes = [];
    this.hidden = new Map(); // stand -> parked entry hidden because an AI plane took it
    this.activeEnd = null;
    this.approach = null;
    this.depRoute = null;
    this.timers = { arrival: this.rng.range(25, 70), departure: this.rng.range(20, 50) };
    this.holdAll = false; // emergency: nothing new moves
    this.runwayOccupied = null; // plane or 'player'
    this.onAiEvent = null;
    this.pool = POOLS[o.airport.cls] ?? POOLS.small;
  }

  /** Choose the runway end in use (the traffic and tower both follow it). */
  setActiveEnd(endId) {
    if (this.activeEnd?.id === endId) return;
    this.approach = approachFor(this.airport, endId);
    this.activeEnd = this.approach.end;
    // Stands are matched to the route when a plane is created.
  }

  #standFor(role) {
    const parked = this.group?.userData.parked ?? [];
    const stands = this.airport.layout?.stands ?? [];
    const busy = new Set(this.planes.filter((p) => !p.gone && p.state !== 'climb').map((p) => p.standIndex));
    if (role === 'departure') {
      const options = parked.filter((e) => e.root.visible && !busy.has(e.stand));
      return options.length ? this.rng.pick(options) : null;
    }
    const taken = new Set([...busy, ...parked.filter((e) => e.root.visible).map((e) => e.stand)]);
    const free = stands.map((_, i) => i).filter((i) => !taken.has(i));
    return free.length ? { stand: this.rng.pick(free) } : null;
  }

  spawnDeparture() {
    const entry = this.#standFor('departure');
    if (!entry) return null;
    const plane = new AiPlane(this, 'departure', entry.id, entry.root.userData.variant ?? 0, entry.stand);
    entry.root.visible = false;
    plane.parkedEntry = entry;
    const route = departureRoute(this.airport, this.activeEnd.id, entry.stand);
    plane.depRoute = route;
    plane.path = new PathFollower(route.points);
    plane.setModel(false);
    plane.place(route.points[0].x, route.points[0].z, entry.root.rotation.y != null ? plane.path.heading : 0);
    plane.setState('taxi_out');
    this.planes.push(plane);
    return plane;
  }

  spawnArrival(startDistance = 11000) {
    const slot = this.#standFor('arrival');
    if (!slot) return null;
    const id = this.rng.pick(this.pool);
    const plane = new AiPlane(this, 'arrival', id, this.rng.int(0, 7), slot.stand);
    // Short fields cannot take heavy aircraft.
    if (plane.spec.minRunway > this.approach.length) return null;
    const p = this.approach.before(startDistance, 0);
    plane.setModel(false);
    plane.place(p.x, p.z, this.approach.heading, startDistance * TAN3);
    plane.speed = plane.spec.speeds.vapp * KT + 40 * KT;
    plane.distToThreshold = startDistance;
    plane.setState('final');
    this.planes.push(plane);
    return plane;
  }

  /** Arrivals on final, nearest first. */
  arrivalsOnFinal() {
    return this.planes.filter((p) => !p.gone && p.role === 'arrival' && p.state === 'final').sort((a, b) => a.distToThreshold - b.distToThreshold);
  }

  /** Seconds until the next arrival (AI) reaches the threshold. */
  nextArrivalEta() {
    const list = this.arrivalsOnFinal();
    return list.length ? list[0].etaToThreshold() : Infinity;
  }

  waitingDeparture() {
    return this.planes.find((p) => !p.gone && p.role === 'departure' && p.state === 'hold') ?? null;
  }

  /** Is anything on or about to use the runway? */
  runwayBusy() {
    return this.planes.some((p) => !p.gone && (['lineup', 'roll', 'rollout'].includes(p.state) || (p.state === 'exit' && p.path.seg < 1)));
  }

  releaseDeparture(plane) {
    plane.setState('lineup');
    plane.depRoute = plane.depRoute ?? this.depRoute;
    this.depRoute = plane.depRoute;
  }

  /** Called by the tower when the player will use the runway: AI arrivals too close must go around. */
  clearRunwayFor(playerBusy) {
    this.playerOnRunway = playerBusy;
  }

  update(dt, player) {
    if (!this.activeEnd) return;
    // Spawning.
    const active = this.planes.filter((p) => !p.gone).length;
    if (!this.holdAll && active < this.density.max) {
      this.timers.arrival -= dt;
      this.timers.departure -= dt;
      if (this.timers.arrival <= 0) {
        const eta = this.nextArrivalEta();
        const playerEta = player?.etaToThreshold ?? Infinity;
        // Spawn time at the threshold, about two minutes from now; keep it a minute clear of the player and the AI ahead.
        const mine = 11000 / 85;
        const clear = (eta === Infinity || Math.abs(eta - mine) > 70 && eta > 25) && Math.abs(playerEta - mine) > 70;
        if (clear && this.spawnArrival()) this.timers.arrival = this.density.arrivals * this.rng.range(0.7, 1.3);
        else this.timers.arrival = 8;
      }
      if (this.timers.departure <= 0) {
        if (this.spawnDeparture()) this.timers.departure = this.density.departures * this.rng.range(0.7, 1.3);
        else this.timers.departure = 15;
      }
    }
    // Tower sequencing for AI departures.
    const waiting = this.waitingDeparture();
    if (waiting && !this.holdAll) {
      const playerBlocking = player?.onRunway || player?.cleared;
      const arrivalSoon = this.nextArrivalEta() < 105 || (player?.etaToThreshold ?? Infinity) < 95;
      if (!this.runwayBusy() && !arrivalSoon && !playerBlocking) this.releaseDeparture(waiting);
    }
    // Arrivals go around if the runway is blocked when they are about to land.
    for (const p of this.arrivalsOnFinal()) {
      if (p.distToThreshold < 1600 && !p.goAround && (this.playerBlockingRunway || this.planes.some((q) => q !== p && ['lineup', 'roll'].includes(q.state)))) {
        p.goAround = true;
        this.onAiEvent?.({ type: 'goaround', plane: p });
      }
    }
    for (const p of [...this.planes]) {
      p.update(dt);
      if (p.gone) {
        this.planes.splice(this.planes.indexOf(p), 1);
        if (p.parkedEntry && !p.parkedEntry.root.visible && p.role === 'departure') { /* the stand stays empty */ }
      }
    }
  }

  dispose() {
    for (const p of this.planes) p.dispose();
    for (const e of this.group?.userData.parked ?? []) e.root.visible = true;
    this.planes.length = 0;
  }
}

