// Time compression: the simulation runs 2x to 16x faster to shorten long legs. It is only allowed where it is safe:
// high up with nothing wrong. Above 2x the autopilot must be flying (keys act per simulated second, so a human pilot
// cannot control the aircraft at those speeds). When a condition is lost the speed drops back to 1x with a message.

export const TIME_SCALES = [1, 2, 4, 8, 16];
const FT = 3.28084;
const MIN_AGL_FT = 1500; // below this the sim always runs in real time
const LOOKAHEAD_S = 25; // seconds of flight path checked against the terrain
const TERRAIN_CLEARANCE_FT = 1200;

export class TimeControl {
  constructor() {
    this.scale = 1; // the speed the simulation is running at now
    this.onChange = null; // (scale, reason) => void
    this.terrainCheck = 0;
  }

  /** The fastest allowed speed right now, with the reason when it is below 16x. */
  limit(model, autopilot) {
    const tel = model.telemetry;
    if (model.crashed) return { max: 1, reason: 'Aircraft down' };
    if (tel.onGround) return { max: 1, reason: 'Time compression is for airborne cruising' };
    if (tel.aglFt < MIN_AGL_FT) return { max: 1, reason: `Real time below ${MIN_AGL_FT} ft` };
    if (tel.stallWarning || tel.stalled) return { max: 1, reason: 'Stall warning: back to real time' };
    if (model.engines.some((e) => e.fire)) return { max: 1, reason: 'Engine fire: back to real time' };
    if (!autopilot.on) return { max: 2, reason: 'Engage the autopilot (2) for more than 2x' };
    if (this.#terrainAhead(model, tel)) return { max: 1, reason: 'Terrain ahead: back to real time' };
    return { max: 16 };
  }

  #terrainAhead(model, tel) {
    const v = model.vel;
    const t = LOOKAHEAD_S;
    // Three samples along the projected path, each compared with the altitude at that point.
    for (const f of [0.4, 0.7, 1]) {
      const x = model.pos.x + v.x * t * f;
      const z = model.pos.z + v.z * t * f;
      const y = model.pos.y + Math.min(0, v.y) * t * f;
      if ((y - model.world.groundHeight(x, z)) * FT < TERRAIN_CLEARANCE_FT) return true;
    }
    return false;
  }

  set(requested, model, autopilot, notify = true) {
    const { max, reason } = this.limit(model, autopilot);
    const next = Math.min(requested, max);
    const changed = next !== this.scale;
    this.scale = next;
    if (requested > max && notify) this.onChange?.(next, reason);
    else if (changed && notify) this.onChange?.(next, null);
    return next;
  }

  faster(model, autopilot) {
    const i = TIME_SCALES.indexOf(this.scale);
    return this.set(TIME_SCALES[Math.min(TIME_SCALES.length - 1, i + 1)], model, autopilot);
  }

  slower(model, autopilot) {
    const i = TIME_SCALES.indexOf(this.scale);
    return this.set(TIME_SCALES[Math.max(0, i - 1)], model, autopilot);
  }

  normal(model, autopilot) {
    return this.set(1, model, autopilot);
  }

  /** Call about 5 times a second while flying: drop out of time compression when it stops being safe. */
  watch(model, autopilot) {
    if (this.scale === 1) return;
    const { max, reason } = this.limit(model, autopilot);
    if (this.scale > max) {
      this.scale = max;
      this.onChange?.(max, reason);
    }
  }

  reset() {
    this.scale = 1;
  }
}
