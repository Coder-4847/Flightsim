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

  /**
   * Fly-by-wire: pitch stick commands load factor, roll stick commands roll rate.
   *
   * Pitch is a two-loop law. The inner loop tracks a body pitch rate computed from the commanded load
   * factor (pure kinematics, no singularities at any bank angle). The outer loop integrates the error
   * between commanded and MEASURED load factor straight into the elevator, so the achieved g matches the
   * command at every speed and a centred stick really holds the flight path: it does not drift nose-up as
   * the aircraft accelerates (the old law only controlled pitch rate, so lift grew with speed squared).
   */
  #fbw(dt, input, s, assist, out) {
    const f = this.spec.fcs;
    const sched = clamp(Q_REF / Math.max(s.qbar, 800), 0.25, 3);
    const protect = assist !== 'off';
    const airborne = !s.onGround && s.tas > 50;

    // Load factor that keeps the flight path straight with the stick centred: cos(gamma)/cos(phi). Beyond 60
    // degrees of bank that would demand ever more g, so it fades out to zero g at the knife edge and carries
    // on, negative, through inverted flight (level inverted flight is -1 g).
    const cosB = Math.cos(s.bank);
    const cosG = Math.cos(s.pathAngle);
    const hold = Math.abs(cosB) >= 0.5 ? 1 / cosB : 4 * cosB;
    const nzHold = clamp(cosG * hold, f.nzMin, f.nzMax);
    let nzCmd = input.pitch >= 0
      ? nzHold + input.pitch * (f.nzMax - nzHold)
      : nzHold + input.pitch * (nzHold - f.nzMin);
    if (protect && airborne && nzCmd > s.nz && s.nz > 0.3) {
      // Angle-of-attack limiter: lift grows with (alpha - alpha0), so the g available at the limit angle is the
      // measured g scaled by the angle ratio. Capping the command there keeps alpha at the limit smoothly,
      // looking a fifth of a second ahead so a fast pull-up is caught in time.
      const alpha0 = -2 * DEG;
      const aPred = s.alpha + 0.2 * Math.max(s.q, 0);
      const nzAtLimit = s.nz * (f.alphaLimit * DEG - alpha0) / Math.max(aPred - alpha0, 0.05);
      nzCmd = Math.min(nzCmd, nzAtLimit);
    }
    const v = Math.max(s.tas, 40);
    // Body pitch rate that makes the aircraft's normal acceleration nzCmd: (g/V) (nz - cos(gamma) cos(phi)).
    const qCmd = (G / v) * (nzCmd - cosG * cosB);
    const nzErr = airborne ? nzCmd - s.nz : 0;
    const err = qCmd + (G / v) * (f.knz ?? 1.2) * nzErr - s.q; // proportional load-factor feedback speeds the response up
    let elevator = f.kq * sched * err - 0.05 * s.q;
    if (airborne) {
      // Outer loop: integrate the load-factor error into the elevator (effectiveness follows dynamic pressure).
      // Anti-windup: stop integrating while the elevator is already at its stop in the direction of the error.
      const total = elevator + this.integrator;
      if (!((total >= 1 && nzErr > 0) || (total <= -1 && nzErr < 0))) {
        this.integrator = clamp(this.integrator + nzErr * dt * (f.ki ?? 0.5) * sched, -0.85, 0.85);
      }
    } else {
      this.integrator *= 1 - Math.min(1, dt * 0.5); // on the ground the elevator is the pilot's alone
    }
    elevator += this.integrator;
    out.elevator = clamp(elevator, -1, 1);

    const pMax = f.rollRate * DEG * clamp(1.2 - s.alpha / (20 * DEG), 0.35, 1);
    out.aileron = clamp(f.kp * sched * (input.roll * pMax - s.p), -1, 1);
    out.rudder = clamp(input.yaw - 0.55 * s.r + 0.8 * clamp(s.beta, -0.3, 0.3), -1, 1);
    return out;
  }
}
