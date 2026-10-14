import { DEG, G, clamp } from './units.js';

// Flight control system: turns pilot stick input (-1..1) into control-surface
// commands (-1..1 of full deflection), depending on the assist level.
//   off   : direct law, stick = surface
//   light : direct law + extra rate damping and turn coordination
//   full  : stick commands bank angle / pitch attitude (centred stick holds), with stall protection
//   fighters use fly-by-wire (g and roll-rate command) at every level except "off" protections
//
// State passed in (standard aero axes): p roll rate, q pitch rate, r yaw rate (rad/s),
// alpha, beta, bank, pitch (rad), qbar (Pa), tas (m/s), alphaStall (rad).

const Q_REF = 6000; // Pa, dynamic pressure the fly-by-wire gains are tuned at

export class FlightControlSystem {
  constructor(spec) {
    this.spec = spec;
    this.pitchTarget = 0;
    this.integrator = 0;
    this.out = { elevator: 0, aileron: 0, rudder: 0 };
  }

  /** `trim` seeds the fly-by-wire integrator so a trimmed start stays trimmed. */
  reset(pitch = 0, trim = 0) {
    this.pitchTarget = pitch;
    this.integrator = this.spec.fcs?.type === 'fbw' ? trim : 0;
  }

  update(dt, input, s, assist, trim) {
    const out = this.out;
    const spec = this.spec;
    if (spec.fcs?.type === 'fbw') return this.#fbw(dt, input, s, assist, out);

    let elevator = input.pitch + trim;
    let aileron = input.roll;
    let rudder = input.yaw;

    if (assist !== 'off') {
      const damp = spec.fcs?.damping ?? { p: 0.18, q: 0.45, r: 0.5 };
      elevator += -damp.q * s.q;
      aileron += -damp.p * s.p;
      rudder += -damp.r * s.r + clamp(0.9 * s.beta, -0.3, 0.3); // yaw damper + turn coordination
    }

    if (assist === 'full') {
      // Bank-angle command: stick sets a target bank, centred stick returns wings level.
      const bankMax = 60 * DEG;
      const bankCmd = input.roll * bankMax;
      if (Math.abs(s.bank) < 100 * DEG) {
        aileron = clamp(input.roll * 0.35 + 1.4 * (bankCmd - s.bank) - 0.25 * s.p, -1, 1);
      }
      // Pitch attitude hold: release the stick and the nose stays where it was.
      if (Math.abs(input.pitch) > 0.02 || Math.abs(s.bank) > 70 * DEG) {
        this.pitchTarget = s.pitch;
        this.integrator = 0;
      } else {
        const error = this.pitchTarget - s.pitch;
        this.integrator = clamp(this.integrator + error * dt * 0.25, -0.25, 0.25);
        elevator = clamp(2.0 * error - 0.9 * s.q + this.integrator + trim, -1, 1);
      }
      // Stall protection: lose elevator authority and push the nose down near the stall angle.
      const limit = 0.85 * s.alphaStall;
      if (s.alpha > limit) {
        const over = (s.alpha - limit) / (0.15 * s.alphaStall);
        elevator = Math.min(elevator, 0.4 - 1.6 * over);
        this.pitchTarget = Math.min(this.pitchTarget, s.pitch - 0.02);
      }
    }
    out.elevator = clamp(elevator, -1, 1);
    out.aileron = clamp(aileron, -1, 1);
    out.rudder = clamp(rudder, -1, 1);
    return out;
  }

  /** Fly-by-wire: pitch stick commands load factor, roll stick commands roll rate. */
  #fbw(dt, input, s, assist, out) {
    const f = this.spec.fcs;
    const sched = clamp(Q_REF / Math.max(s.qbar, 800), 0.25, 3);
    const protect = assist !== 'off';

    // Neutral stick holds the flight path: the load factor that keeps gamma-dot at zero in the
    // current bank is cos(gamma)/cos(phi). The stick adds to that, up to the g limits.
    const cosBank = Math.max(Math.cos(s.bank), 0.34);
    const nzHold = Math.cos(s.pathAngle) / cosBank;
    const nzCmd = input.pitch >= 0
      ? nzHold + input.pitch * (f.nzMax - nzHold)
      : nzHold + input.pitch * (nzHold - f.nzMin);
    const v = Math.max(s.tas, 40);
    // Body pitch rate for the commanded flight-path rate, plus the pitch rate a banked turn needs.
    let qCmd = (G / v) * ((nzCmd * cosBank - Math.cos(s.pathAngle)) / cosBank + Math.sin(s.bank) * Math.tan(s.bank));
    if (protect) {
      // Angle-of-attack limiter: fade out nose-up command as alpha nears the limit.
      const aLim = f.alphaLimit * DEG;
      if (s.alpha > aLim * 0.8) {
        const room = clamp((aLim - s.alpha) / (aLim * 0.2), -1, 1);
        qCmd = Math.min(qCmd, room * 0.5 - 0.25 * (1 - room));
      }
    }
    const err = qCmd - s.q;
    this.integrator = clamp(this.integrator + err * dt * 0.25 * sched, -0.3, 0.3);
    out.elevator = clamp(f.kq * sched * err + this.integrator - 0.05 * s.q, -1, 1);

    const pMax = f.rollRate * DEG * clamp(1.2 - s.alpha / (20 * DEG), 0.35, 1);
    out.aileron = clamp(f.kp * sched * (input.roll * pMax - s.p), -1, 1);
    out.rudder = clamp(input.yaw - 0.55 * s.r + 0.8 * clamp(s.beta, -0.3, 0.3), -1, 1);
    return out;
  }
}
