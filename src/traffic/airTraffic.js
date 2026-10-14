import * as THREE from 'three';
import { Rng } from '../util/random.js';
import { createTrafficModel } from './fleet.js';

// Airborne traffic: a handful of aircraft flying between the airports of a map on straight legs
// at a safe altitude. They are scripted (no physics) and only matter for atmosphere until the ATC
// phase gives them proper circuits.

const FLEET = [['narrowbody', 3], ['regional', 2], ['turboprop72', 2], ['widebody', 1], ['jumbo', 1], ['bizjet', 2], ['citation', 1], ['kingair', 1], ['caravan', 1], ['cessna172', 2]];

export class AirTraffic {
  constructor(scene, map, count = 8) {
    this.scene = scene;
    this.map = map;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rng = new Rng(map.seed ?? 1234);
    this.flights = [];
    const pool = FLEET.flatMap(([id, w]) => Array(w).fill(id));
    for (let i = 0; i < count; i++) this.flights.push(this.#spawn(this.rng.pick(pool), i));
  }

  /** Highest ground along the leg, so the leg can be flown clear of terrain. */
  #ceiling(a, b) {
    let max = Math.max(a.elevation, b.elevation);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      max = Math.max(max, this.map.hf.height(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
    }
    return max;
  }

  #leg(flight) {
    const airports = this.map.airports;
    const from = flight.to ?? this.rng.pick(airports);
    let to = this.rng.pick(airports);
    for (let n = 0; n < 8 && (to === from || Math.hypot(to.x - from.x, to.z - from.z) < 8000); n++) to = this.rng.pick(airports);
    flight.from = from;
    flight.to = to;
    flight.length = Math.hypot(to.x - from.x, to.z - from.z);
    flight.alt = Math.max(this.#ceiling(from, to) + 500, Math.max(from.elevation, to.elevation) + (flight.fast ? 2500 : 900));
    flight.heading = Math.atan2(to.x - from.x, -(to.z - from.z));
    flight.t = 0;
  }

  #spawn(id, n) {
    const { root, spec } = createTrafficModel(id, n, { gearUp: true });
    this.group.add(root);
    const flight = { root, spec, fast: spec.speeds.cruise > 180, speed: spec.speeds.cruise * 0.514 * 0.8, to: null };
    this.#leg(flight);
    flight.t = this.rng.float() * 0.9; // spread the fleet along its first leg
    return flight;
  }

  update(dt) {
    for (const f of this.flights) {
      f.t += (f.speed * dt) / f.length;
      if (f.t >= 1) this.#leg(f);
      const t = f.t;
      const x = f.from.x + (f.to.x - f.from.x) * t;
      const z = f.from.z + (f.to.z - f.from.z) * t;
      // Climb out of the origin and descend into the destination over the first / last 12%.
      const y = t < 0.5
        ? f.from.elevation + (f.alt - f.from.elevation) * Math.min(1, t / 0.12)
        : f.to.elevation + (f.alt - f.to.elevation) * Math.min(1, (1 - t) / 0.12);
      f.root.position.set(x, y, z);
      f.root.rotation.y = Math.PI / 2 - f.heading;
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
