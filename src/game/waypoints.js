// The pilot's route: waypoints set on the map. The first one is active; its bearing shows on the compass,
// the autopilot's NAV mode flies to it, and it is dropped when the aircraft gets close.

const REACH_M = 1000;
const MAX = 12;
const DEG = 180 / Math.PI;

export class Waypoints {
  constructor() {
    this.list = []; // { x, z, name }
    this.onReach = null; // (waypoint) => void
    this.counter = 0;
  }

  get active() { return this.list[0] ?? null; }

  add(x, z, name) {
    if (this.list.length >= MAX) return null;
    const wpt = { x, z, name: name ?? `WPT${++this.counter}` };
    this.list.push(wpt);
    return wpt;
  }

  remove(index) { this.list.splice(index, 1); }

  /** Make waypoint `index` the active one (the ones before it are dropped). */
  direct(index) { this.list.splice(0, index); }

  clear() { this.list.length = 0; this.counter = 0; }

  /** Bearing (degrees true) and distance (m) from the aircraft to the active waypoint, or null. */
  to(model) {
    const w = this.active;
    if (!w) return null;
    const dx = w.x - model.pos.x;
    const dz = w.z - model.pos.z;
    return { name: w.name, brg: (Math.atan2(dx, -dz) * DEG + 360) % 360, dist: Math.hypot(dx, dz), x: w.x, z: w.z };
  }

  /** Call regularly: drops the active waypoint once reached. */
  update(model) {
    const t = this.to(model);
    if (t && t.dist < REACH_M) {
      const reached = this.list.shift();
      this.onReach?.(reached);
    }
  }
}
