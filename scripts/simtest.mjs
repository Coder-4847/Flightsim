// Headless flight-model checks: node scripts/simtest.mjs [aircraftId]
import { AIRCRAFT } from '../src/aircraft/index.js';
import { FlightModel } from '../src/flight/flightModel.js';
import { SimWorld } from '../src/flight/world.js';
import { FT, FPM, KT } from '../src/flight/units.js';

const only = process.argv[2];
const dt = 1 / 120;
const fmt = (x, d = 1) => Number(x).toFixed(d);

function takeoff(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'light';
  m.controls.throttle.fill(1);
  m.controls.parkingBrake = false;
  let liftoffAt = null; let rolled = false; let t = 0; let maxPitch = 0;
  while (t < 90) {
    const tel = m.telemetry;
    // Rotate at Vr: pull to ~ 10 deg pitch (fighters pull a little less).
    if (tel.ias >= spec.speeds.vr) {
      const target = spec.fcs ? 12 : 10;
      m.controls.pitch = Math.max(-1, Math.min(1, (target - tel.pitch) * 0.12));
      rolled = true;
    } else m.controls.pitch = 0;
    // Keep straight with rudder/nosewheel.
    m.controls.steer = m.controls.yaw = Math.max(-1, Math.min(1, -(tel.heading > 180 ? tel.heading - 360 : tel.heading) * 0.15));
    m.step(dt); t += dt;
    maxPitch = Math.max(maxPitch, m.telemetry.pitch);
    if (!m.gear.weightOnWheels && liftoffAt === null && t > 1) liftoffAt = { t, ias: m.telemetry.ias, dist: -m.pos.z };
    if (m.crashed) return { crashed: m.crashed.reason, t, dist: -m.pos.z };
    if (liftoffAt && t > liftoffAt.t + 25) break;
  }
  const tel = m.telemetry;
  return { liftoffAt, climbFpm: tel.vsFpm, ias: tel.ias, altFt: tel.altitudeFt, pitch: tel.pitch, maxPitch, rolled, heading: tel.heading, crashed: m.crashed?.reason };
}

function cruiseHold(spec, assist = 'light') {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = assist;
  m.reset({ mode: 'air', altitude: 1500, heading: 0, speed: spec.speeds.cruise * KT, x: 0, z: 0 });
  const start = m.telemetry;
  let t = 0; let minAlt = 1e9; let maxAlt = -1e9;
  while (t < 60) { m.step(dt); t += dt; const a = m.telemetry.altitudeFt; minAlt = Math.min(minAlt, a); maxAlt = Math.max(maxAlt, a); if (m.crashed) break; }
  const end = m.telemetry;
  return { start: { ias: start.ias, alt: start.altitudeFt }, end: { ias: end.ias, alt: end.altitudeFt, vs: end.vsFpm, pitch: end.pitch, bank: end.bank, hdg: end.heading }, band: maxAlt - minAlt, crashed: m.crashed?.reason };
}

function stallTest(spec, flapStage = 0, assist = 'off') {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = spec.fcs ? 'light' : assist;
  m.reset({ mode: 'air', altitude: 3000, heading: 0, speed: spec.speeds.cruise * KT * 0.7 });
  m.controls.flapsStage = flapStage; m.surfaces.flap = spec.flaps.stages[flapStage].deg;
  const gearDown = flapStage > 0; m.gear.extension = m.gear.target = gearDown ? 1 : 0; m.controls.gearDown = gearDown;
  m.controls.throttle.fill(0);
  let t = 0; let minIas = 1e9; let stallIas = null; let res = {};
  let maxBank = 0; let pitchAtStall = null;
  while (t < 120) {
    const tel = m.telemetry;
    // Hold altitude by pulling progressively (1 kt/s deceleration target).
    m.controls.pitch = Math.min(1, m.controls.pitch + 0.004 * dt * 120 / 120 * 5);
    m.step(dt); t += dt;
    maxBank = Math.max(maxBank, Math.abs(tel.bank));
    if (m.stalled && stallIas === null) { stallIas = tel.ias; pitchAtStall = tel.pitch; }
    minIas = Math.min(minIas, tel.ias);
    if (stallIas !== null && t > 0 && m.telemetry.vsFpm < -3000) break;
    if (m.crashed) break;
  }
  return { stallIas, minIas, pitchAtStall, maxBank, vs: m.telemetry.vsFpm, t, crashed: m.crashed?.reason };
}

function landing(spec, sinkTarget = 150, assist = 'light') {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = assist;
  // 3 degree glide to the threshold at z = +1200 (south end), heading north.
  const dist = 3000;
  m.reset({ mode: 'final', heading: 0, x: 0, z: 1200 + dist, altitude: dist * Math.tan(3 * Math.PI / 180) + 12, speed: spec.speeds.vapp * KT, pathAngle: -3 });
  const approachPitch = m.telemetry.pitch;
  const flareHeight = spec.id === 'cessna172' ? 30 : 45; // ft
  let t = 0; let td = null; let flarePitch = approachPitch;
  while (t < 300) {
    const tel = m.telemetry;
    const agl = tel.aglFt;
    const dx = tel.heading > 180 ? tel.heading - 360 : tel.heading;
    m.controls.roll = Math.max(-0.3, Math.min(0.3, -0.05 * dx - 0.02 * tel.bank));
    m.controls.steer = m.controls.yaw = tel.onGround ? Math.max(-1, Math.min(1, -dx * 0.2)) : 0;
    const speedErr = spec.speeds.vapp - tel.ias;
    // 3 degree path: sink = groundspeed * tan(3 deg)
    const glideFpm = -tel.groundSpeed * 0.514444 * 0.0524 / 0.00508;
    if (!tel.onGround) {
      const thr = Math.max(0.03, Math.min(1, m.controls.throttle[0] + speedErr * 0.0006 + (glideFpm - tel.vsFpm) * -0.000003));
      m.controls.throttle.fill(agl < (spec.fcs ? 8 : flareHeight) ? 0 : thr);
      let pitchTarget;
      if (agl > flareHeight) pitchTarget = approachPitch + (glideFpm - tel.vsFpm) * 0.004;
      else { flarePitch = Math.min(flarePitch + 1.6 * dt, Math.max(spec.id === 'cessna172' ? 7 : 6, approachPitch + 2)); pitchTarget = flarePitch; }
      if (spec.fcs) {
        // Fly-by-wire: the stick commands load factor, so control the sink rate directly.
        const sinkTgt = agl > 25 ? glideFpm : -(120 + agl * 4);
        m.controls.pitch = Math.max(-0.15, Math.min(0.25, (sinkTgt - tel.vsFpm) * 0.0003));
      } else {
        m.controls.pitch = Math.max(-1, Math.min(1, (pitchTarget - tel.pitch) * 0.2 - tel.pitchRate * 0.6));
      }
    } else {
      m.controls.pitch = 0; m.controls.throttle.fill(0);
      if (!td) td = { ...m.gear.touchdown, ias: tel.ias, z: m.pos.z, pitch: tel.pitch };
      m.controls.brakeLeft = m.controls.brakeRight = 0.8;
    }
    m.step(dt); t += dt;
    if (m.crashed) return { crashed: m.crashed.reason, t: fmt(t, 0), td: td && { fpm: fmt(td.sink / FPM, 0) }, z: fmt(m.pos.z, 0), alt: fmt(tel.altitudeFt, 0) };
    if (td && tel.groundSpeed < 5) break;
  }
  const events = m.events.filter((e) => e.type === 'touchdown');
  return { td: td && { fpm: fmt(td.sink / FPM, 0), ias: fmt(td.ias, 0), pitch: fmt(td.pitch, 1), z: fmt(td.z, 0) }, grade: events[0]?.grade, rolloutEnd: fmt(m.pos.z, 0), t: fmt(t, 0), speed: fmt(m.telemetry.groundSpeed, 1), crashed: m.crashed?.reason };
}

function hardLanding(spec) {
  const m = new FlightModel(spec, new SimWorld());
  m.assist = 'off';
  m.reset({ mode: 'final', heading: 0, x: 0, z: 1500, altitude: 60, speed: spec.speeds.vapp * KT, pathAngle: -14 });
  let t = 0;
  while (t < 30) { m.controls.pitch = 0; m.step(dt); t += dt; if (m.crashed || m.gear.weightOnWheels && t > 5) break; }
  return { crashed: m.crashed?.reason, events: m.events.map((e) => `${e.type}:${e.grade ?? e.reason ?? ''}${e.fpm ? ' ' + Math.round(e.fpm) + 'fpm' : ''}`) };
}

for (const spec of AIRCRAFT) {
  if (only && spec.id !== only) continue;
  console.log(`\n=== ${spec.name} (${spec.id}) ===`);
  console.log('takeoff', JSON.stringify(takeoff(spec), (k, v) => typeof v === 'number' ? Number(v.toFixed(1)) : v));
  for (const assist of ['off', 'light', 'full']) console.log(`cruise hold [${assist}]`, JSON.stringify(cruiseHold(spec, assist), (k, v) => typeof v === 'number' ? Number(v.toFixed(1)) : v));
  console.log('stall clean', JSON.stringify(stallTest(spec, 0), (k, v) => typeof v === 'number' ? Number(v.toFixed(1)) : v));
  console.log('stall landing cfg', JSON.stringify(stallTest(spec, spec.flaps.landingStage), (k, v) => typeof v === 'number' ? Number(v.toFixed(1)) : v));
  console.log('landing', JSON.stringify(landing(spec)));
  console.log('hard landing', JSON.stringify(hardLanding(spec)));
}
void FT; void KT;
