// Per-aircraft upgrades, headless: node scripts/tuningtest.mjs [aircraftId]
// Measures every aircraft stock and fully upgraded (all six tracks at level 5): take-off roll, climb rate 25 s after
// lift-off, level top speed (handling excluded: it only changes the stick gain of the altitude-hold loop used here), roll rate and braking, and checks that nothing breaks (no crash, autopilot-free hands-off cruise).
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { KT, FT } from '../src/flight/units.js';
import { MAX_LEVEL, TRACKS, specWithTuning } from '../src/progress/tuning.js';

const only = process.argv[2];
const dt = 1 / 120;
const maxed = Object.fromEntries(TRACKS.map((t) => [t.id, MAX_LEVEL]));

function takeoff(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.controls.throttle.fill(1);
  m.controls.parkingBrake = false;
  let t = 0; let lift = null;
  while (t < 90) {
    const tel = m.telemetry;
    if (tel.ias >= spec.speeds.vr) m.controls.pitch = Math.max(-1, Math.min(1, ((spec.fcs ? 12 : 10) - tel.pitch) * 0.12)); else m.controls.pitch = 0;
    m.controls.steer = m.controls.yaw = Math.max(-1, Math.min(1, -(tel.heading > 180 ? tel.heading - 360 : tel.heading) * 0.15));
    m.step(dt); t += dt;
    if (!m.gear.weightOnWheels && !lift && t > 1) lift = { t, dist: -m.pos.z };
    if (m.crashed) return { crashed: m.crashed.reason };
    if (lift && t > lift.t + 25) break;
  }
  return { roll: lift?.dist, climb: m.telemetry.vsFpm, crashed: m.crashed?.reason };
}

function topSpeed(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.reset({ mode: 'air', altitude: 900, heading: 0, speed: spec.speeds.cruise * KT, x: 0, z: 0 });
  m.damageEnabled = false;
  m.controls.throttle.fill(1);
  const hold = m.telemetry.altitudeFt;
  let t = 0;
  // Hold the altitude with a little stick, so the speed settles at the level-flight maximum (thrust = drag).
  while (t < 300) {
    const tel = m.telemetry;
    m.controls.pitch = Math.max(-1, Math.min(1, -tel.vsFpm / 2500 + (hold - tel.altitudeFt) * 0.0004));
    m.step(dt); t += dt; if (m.crashed) break;
  }
  const tel = m.telemetry;
  return { ias: tel.ias, mach: tel.mach, alt: tel.altitudeFt, crashed: m.crashed?.reason };
}

function rollRate(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.reset({ mode: 'air', altitude: 900, heading: 0, speed: spec.speeds.cruise * KT, x: 0, z: 0 });
  m.controls.roll = 1;
  let peak = 0; let t = 0;
  while (t < 3) { m.step(dt); t += dt; peak = Math.max(peak, Math.abs(m.telemetry.rollRate)); }
  return peak;
}

function braking(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.reset({ mode: 'runway', heading: 0, x: 0, z: 0 });
  m.controls.parkingBrake = false;
  m.vel.set(0, 0, -50 * KT);
  m.controls.throttle.fill(0);
  m.controls.brakeLeft = m.controls.brakeRight = 1;
  m.controls.brake = 1;
  let t = 0; const z0 = m.pos.z;
  while (t < 60 && Math.hypot(m.vel.x, m.vel.z) > 1) { m.step(dt); t += dt; if (m.crashed) break; }
  return Math.abs(m.pos.z - z0);
}

const f = (x, d = 0) => (x == null ? 'n/a' : Number(x).toFixed(d));
const pct = (a, b) => (a && b ? `${(b / a * 100 - 100 >= 0 ? '+' : '')}${f(b / a * 100 - 100, 0)}%` : '');
let bad = 0;
for (const base of AIRCRAFT) {
  if (only && base.id !== only) continue;
  const up = specWithTuning(base, maxed);
  const a = { to: takeoff(base), ts: topSpeed(base), rr: rollRate(base), br: braking(base) };
  const b = { to: takeoff(up), ts: topSpeed(specWithTuning(base, { ...maxed, handling: 0 })), rr: rollRate(up), br: braking(up) };
  const crashed = [a.to.crashed, a.ts.crashed, b.to.crashed, b.ts.crashed].filter(Boolean);
  if (crashed.length) bad++;
  console.log(`${base.id.padEnd(13)} roll ${f(a.to.roll)} -> ${f(b.to.roll)} m ${pct(a.to.roll, b.to.roll)} | climb ${f(a.to.climb)} -> ${f(b.to.climb)} ${pct(a.to.climb, b.to.climb)} | top ${f(a.ts.ias)} -> ${f(b.ts.ias)} kt ${pct(a.ts.ias, b.ts.ias)} (vne ${base.limits.vne}->${up.limits.vne}) | roll rate ${f(a.rr)} -> ${f(b.rr)} ${pct(a.rr, b.rr)} | brake ${f(a.br)} -> ${f(b.br)} m ${pct(a.br, b.br)}${crashed.length ? '  CRASHED: ' + crashed.join('; ') : ''}`);
}
console.log(bad ? `${bad} aircraft crashed` : 'all ran without crashes');
process.exit(bad ? 1 : 0);
