// Emulates a keyboard pilot (keys ramp like FlightControls) against the flight model, 60 Hz decisions.
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { approach, clamp } from '../src/flight/units.js';

const only = process.argv[2];
const assist = process.argv[3] ?? 'light';
for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  const m = new FlightModel(spec, new SimWorld());
  m.assist = assist;
  const stick = { pitch: 0, roll: 0, yaw: 0 };
  let master = 0; let t = 0; let liftoff = null; let maxPitch = 0; let maxHdgErr = 0;
  const dt = 1 / 120;
  const keys = { up: false, down: false, left: false, right: false, rl: false, rr: false, thr: false };
  while (t < 90) {
    if (Math.round(t * 120) % 2 === 0) { // decide at 60 Hz
      const tel = m.telemetry; const hdgErr = tel.heading > 180 ? tel.heading - 360 : tel.heading;
      const target = spec.fcs ? 12 : 9;
      keys.thr = m.controls.throttle[0] < 0.99;
      keys.rr = hdgErr < -2 && tel.onGround; keys.rl = hdgErr > 2 && tel.onGround;
      keys.up = tel.ias > spec.speeds.vr + 2 && tel.pitch < target && tel.altitudeFt < 400;
      keys.down = tel.pitch > target + 3 && !tel.onGround;
      maxHdgErr = Math.max(maxHdgErr, Math.abs(hdgErr));
    }
    const axis = (neg, pos) => (pos ? 1 : 0) - (neg ? 1 : 0);
    const tp = axis(keys.down, keys.up); const ty = axis(keys.rl, keys.rr);
    stick.pitch = approach(stick.pitch, tp * 0.7, (tp === 0 ? 5 : 1.5) * dt);
    stick.yaw = approach(stick.yaw, ty * 0.85, (ty === 0 ? 5 : 2.0) * dt);
    master = clamp(master + (keys.thr ? 0.35 * dt : 0), 0, 1);
    const c = m.controls; c.pitch = stick.pitch; c.yaw = stick.yaw; c.steer = stick.yaw; c.throttle.fill(master);
    m.step(dt); t += dt;
    const tel = m.telemetry;
    maxPitch = Math.max(maxPitch, tel.pitch);
    if (!tel.onGround && !liftoff) liftoff = { t: +t.toFixed(1), ias: +tel.ias.toFixed(0), dist: +(-m.pos.z + (spec.id ? 0 : 0)).toFixed(0), z0: 1140 };
    if (m.crashed || (liftoff && t > liftoff.t + 20)) break;
  }
  const tel = m.telemetry;
  console.log(spec.id.padEnd(10), assist, JSON.stringify({ liftoff, ias: +tel.ias.toFixed(0), alt: +tel.altitudeFt.toFixed(0), vs: +tel.vsFpm.toFixed(0), maxPitch: +maxPitch.toFixed(1), maxHdgErr: +maxHdgErr.toFixed(1), crashed: m.crashed?.reason, damage: m.damage }));
}
