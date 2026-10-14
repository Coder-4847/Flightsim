import { approach, clamp, smoothstep } from './units.js';

// One engine. Three families share an interface:
//   piston / turboprop : shaft power -> thrust through a propeller, T = eta*P / sqrt(V^2 + Vc^2)
//                        (Vc fixes the static thrust; thrust falls with speed as a real prop does)
//   turbofan           : thrust = Tmax * spool^2.5 * density lapse * Mach lapse, optional afterburner
// `spec` fields (see aircraft data files): type, power/thrust, idle, spoolUp/Down, fuelFlow, ...

export class Engine {
  constructor(spec, position) {
    this.spec = spec;
    this.position = position; // body frame {x, y, z}, metres from the CG
    this.spool = spec.idle ?? 0.1; // 0..1 core speed, lags the throttle
    this.thrust = 0; // N along the body +X axis
    this.fuelFlow = 0; // kg/s
    this.afterburner = 0; // 0..1 for the exhaust glow
    this.failed = false;
    this.fire = false;
    this.running = true;
  }

  /** Spool fraction the engine settles at for a given throttle. */
  static targetSpool(spec, throttle) {
    const idle = spec.idle ?? 0.1;
    return idle + (1 - idle) * clamp(throttle, 0, 1);
  }

  /** Thrust from a (possibly steady-state) spool value. */
  thrustAt(spool, env) {
    const s = this.spec;
    if (s.type === 'turbofan') {
      const dry = (s.afterburner ? s.thrustDry : s.thrust) * spool ** 2.5;
      const lapse = env.sigma ** (s.altitudeLapse ?? 0.8);
      const mach = env.mach * (s.machSlope ?? -0.4);
      const abBoost = s.afterburner ? this.afterburnerAmount * ((s.thrust - s.thrustDry) / s.thrustDry) : 0;
      return Math.max(0, dry * (1 + abBoost) * lapse * Math.max(0.15, 1 + mach));
    }
    // Propeller engines: power lapses with density; static thrust sets Vc.
    const power = s.power * clamp((env.sigma - 0.12) / 0.88, 0.05, 1) * spool ** 1.35;
    const vc = (s.propEfficiency * s.power) / s.staticThrust;
    const prop = (s.propEfficiency * power) / Math.sqrt(env.tas * env.tas + vc * vc);
    // Turboprops also have a small residual jet thrust.
    return prop + (s.type === 'turboprop' ? 0.06 * prop : 0);
  }

  get afterburnerAmount() {
    return this._ab ?? 0;
  }

  /**
   * @param throttle 0..1 lever position (afterburner engages above spec.abThreshold)
   * @param env {sigma, mach, tas}
   * @param hasFuel  false when tanks are dry
   */
  step(dt, throttle, env, hasFuel) {
    const s = this.spec;
    this.running = !this.failed && hasFuel;
    let lever = throttle;
    let ab = 0;
    if (s.afterburner) {
      const t = s.abThreshold ?? 0.85;
      ab = throttle > t ? (throttle - t) / (1 - t) : 0;
      lever = Math.min(throttle / t, 1);
    }
    const target = this.running ? Engine.targetSpool(s, lever) : 0;
    const rate = target > this.spool ? 1 / (s.spoolUp ?? 2) : 1 / (s.spoolDown ?? 1.5);
    this.spool = approach(this.spool, target, rate * dt * (this.running ? 1 : 2));
    this._ab = this.running && this.spool > 0.9 ? ab : 0;
    this.afterburner = approach(this.afterburner, this._ab, dt * 2.5);
    this.thrust = this.running || this.spool > 0.02 ? this.thrustAt(this.spool, env) : 0;

    const fuelLevel = (this.spool - (s.idle ?? 0.1)) / (1 - (s.idle ?? 0.1));
    this.fuelFlow = this.spool > 0.02
      ? s.fuelFlowIdle + (s.fuelFlowMax - s.fuelFlowIdle) * clamp(fuelLevel, 0, 1)
        + (s.afterburner ? (s.fuelFlowAb - s.fuelFlowMax) * this.afterburner : 0)
      : 0;
  }

  /** Spool value and afterburner fraction an engine settles at for a throttle setting. */
  steadyState(throttle) {
    const s = this.spec;
    let lever = throttle;
    let ab = 0;
    if (s.afterburner) {
      const t = s.abThreshold ?? 0.85;
      ab = throttle > t ? (throttle - t) / (1 - t) : 0;
      lever = Math.min(throttle / t, 1);
    }
    return { spool: Engine.targetSpool(s, lever), ab };
  }

  /** Steady-state thrust for a throttle setting (used by the trim solver). */
  steadyThrust(throttle, env) {
    const { spool, ab } = this.steadyState(throttle);
    this._ab = ab;
    const thrust = this.thrustAt(spool, env);
    this._ab = 0;
    return thrust;
  }

  /** Jump straight to the steady state for a throttle setting (spawning in flight). */
  settleAt(throttle) {
    const { spool, ab } = this.steadyState(throttle);
    this.spool = spool;
    this._ab = ab;
    this.afterburner = ab;
  }

  /** Display values for engine instruments. */
  get gauges() {
    const s = this.spec;
    const n = this.spool;
    return {
      n1: n * 100,
      rpm: s.type === 'piston' ? 700 + 1800 * smoothstep(0.1, 1, n) : n * (s.rpmMax ?? 100),
      fuelFlow: this.fuelFlow,
      afterburner: this.afterburner,
    };
  }
}
